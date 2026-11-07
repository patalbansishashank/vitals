/**
 * What the planner receives from the supplements section (SUITE_SPEC §13.2 "Planner and Food rules").
 *
 * Supplements with a planner lever (creatine L7, omega-3 L8, psyllium L9 "viscous fibre"; others are display-only,
 * §8.5) map per row:
 * | state | planner |
 * |---|---|
 * | taking | consented (`optIns.levers`); listed as `habitual` (the person already takes it) |
 * | onHand | consented (`optIns.levers`) with zero purchase cost (`onHand`, never in "things to buy") |
 * | notForMe | refused: `constraints.excludedLevers` (the planner's consent-refusal path, kept by the Ideal) |
 * | unknown / no row | stance `open` → the catalogue opt-in as before (creatine); otherwise not offered |
 *
 * Output lists are in a fixed order (L7, L8, L9) so request hashes are stable; the stance `open` with no rows gives
 * exactly `['creatine']`, the pre-v2 request.
 *
 * Shared suggestion policy (D7-03): with a policy (`supplementPlannerInputs(section, policy)`), a lever the person does
 * not already take is consented only when its product's decision allows a suggestion (allow / caution); a clinician
 * stop (`clinicianStop` on a row) excludes the lever and ends its planned continuation while the row and its history stay.
 * `supplementSuggestionPolicy` gives every surface (Food, Coach, commands) the same decisions and row statuses.
 *
 * Observed exposure (D7-04): `habitualActives` carries what the person actually TAKES of a lever product — its active
 * ingredient's dose-day amount, daily average and recurrence, from the row's label or catalogue unit (unknown potency stays
 * unknown) — so a plan treats it as baseline and charges only planned increments (an existing 5 g/day creatine has no new
 * loading or water effect). On-hand stock has none (purchase cost only). A clinician stop keeps the observed history but
 * marks it `stopped`: the plan neither continues nor escalates it. Taking is not consent to continue indefinitely, a
 * proven saturation, or a reason to raise the dose.
 */
import { isSuggestible, suggestionDecision, takenProductStatus, type PolicyProduct, type SuggestionSafetyInput } from '@/lib/safetyPolicy';
import { convertMass, type SuggestionDecision } from '@/lib/bodyContracts';
import type { HabitualActiveExposure } from '@/engine/planner/domain/decode';
import { supplementRecord } from './dose';
import { rowActives, type ScheduledActive } from './exposure';
import type { RecurrenceKind } from './schedule';
import type { SupplementsSectionV2 } from './types';

export interface SupplementLever {
  supplementId: string;
  lever: 'L7' | 'L8' | 'L9';
  /** Lever family the planner's consent check accepts (`optIns.levers` holds an id or a family). */
  family: 'creatine' | 'omega3' | 'fibre';
}

export const SUPPLEMENT_LEVERS: readonly SupplementLever[] = [
  { supplementId: 'creatine_monohydrate', lever: 'L7', family: 'creatine' },
  { supplementId: 'omega3_epa_dha', lever: 'L8', family: 'omega3' },
  { supplementId: 'psyllium', lever: 'L9', family: 'fibre' },
];

/** The catalogue opt-in the stance `open` grants without rows (unchanged from v1). */
const OPEN_DEFAULT: readonly string[] = ['creatine'];

/** Observed exposure of a lever product the person takes (D7-04): baseline, never re-added by a plan. */
export interface HabitualActive {
  lever: SupplementLever['lever'];
  family: SupplementLever['family'];
  supplementId: string;
  /** The active ingredient and its amounts (null = unknown potency or frequency; never zero). */
  active: Pick<ScheduledActive, 'ingredient' | 'unit' | 'perOccasion' | 'peakDay' | 'dailyAverage' | 'weeklyTotal' | 'provenance'> | null;
  /** The product amount as recorded (dose each time × times of day on a dose day). */
  product: { amount: number | null; unit: string | null };
  recurrence: RecurrenceKind;
  /** First day of the observed use, when known (exposure duration is otherwise unknown). */
  since?: string;
  /** A clinician stop: the observed history stays, the plan does not continue it. */
  continuation: 'asTaken' | 'stopped';
}

export interface SupplementPlannerInputs {
  /** For `safety.optIns.levers` (families, fixed order). */
  optInLevers: string[];
  /** For `constraints.excludedLevers` (lever ids, fixed order). */
  excludedLevers: string[];
  /** Lever ids the person already takes: part of the baseline, never "added" by a plan. */
  habitual: string[];
  /** Lever ids the person has at home: no purchase needed. */
  onHand: string[];
  /** (D7-04) observed active exposure of the lever products taken (fixed L7, L8, L9 order; empty when none). */
  habitualActives: HabitualActive[];
}

/** The observed exposure of one taken lever row. */
function habitualActiveOf(l: SupplementLever, row: SupplementsSectionV2['rows'][number]): HabitualActive {
  const actives = rowActives(row);
  const a = actives.find((x) => x.value !== null) ?? actives[0];
  const times = Math.max(1, row.schedule?.timesOfDay?.length ?? row.timesOfDay.length);
  return {
    lever: l.lever,
    family: l.family,
    supplementId: l.supplementId,
    active: a ? { ingredient: a.ingredient, unit: a.unit, perOccasion: a.perOccasion, peakDay: a.peakDay, dailyAverage: a.dailyAverage, weeklyTotal: a.weeklyTotal, provenance: a.provenance } : null,
    product: { amount: row.dose === undefined ? null : row.dose * times, unit: row.unit ?? null },
    recurrence: a?.recurrence ?? (row.schedule ? row.schedule.kind : 'assumedDaily'),
    ...(row.since ? { since: row.since } : {}),
    continuation: row.clinicianStop ? 'stopped' : 'asTaken',
  };
}

export function supplementPlannerInputs(section: SupplementsSectionV2 | null, policy?: SuggestionSafetyInput): SupplementPlannerInputs {
  const out: SupplementPlannerInputs = { optInLevers: [], excludedLevers: [], habitual: [], onHand: [], habitualActives: [] };
  if (!section) return out;
  const rowOf = (id: string) => section.rows.find((r) => (r.supplementId ? supplementRecord(r.supplementId)?.id ?? r.supplementId : null) === id);
  // a new (not already taken) lever needs a suggestible decision when a policy is given; absent policy = legacy behaviour
  const mayAdd = (id: string): boolean => {
    if (!policy) return true;
    const rec = supplementRecord(id);
    return rec ? isSuggestible(suggestionDecision(rec, policy)) : false;
  };
  for (const l of SUPPLEMENT_LEVERS) {
    const row = rowOf(l.supplementId);
    const s = row?.state;
    // observed taking is exposure history whatever happens next (a clinician stop ends the continuation, not the history)
    if (row && s === 'taking') out.habitualActives.push(habitualActiveOf(l, row));
    if (row?.clinicianStop) out.excludedLevers.push(l.lever);
    else if (s === 'taking') {
      out.optInLevers.push(l.family);
      out.habitual.push(l.lever);
    } else if (s === 'onHand') {
      if (mayAdd(l.supplementId)) out.optInLevers.push(l.family);
      out.onHand.push(l.lever);
    } else if (s === 'notForMe') out.excludedLevers.push(l.lever);
    else if (section.stance === 'open' && OPEN_DEFAULT.includes(l.family) && mayAdd(l.supplementId)) out.optInLevers.push(l.family);
  }
  return out;
}

/**
 * The planner request's `habitualActives` (D7-04, the Planner's `HabitualActiveExposure` contract) from the observed
 * exposure: the actives the planner models (creatine today) with their known daily dose in g/day. A legacy row without a
 * schedule keeps the app's existing reading (taking every day at its times) and so counts as daily; weekly, alternate-day,
 * dated or as-needed regimens keep their shape (never averaged into a daily dose here); unknown potency is `gPerDay: null`
 * (a valid record with no numeric contribution); a clinician stop is `stopped` history the plan never continues. Fixed
 * lever order, so the request hash is stable.
 */
export function plannerHabitualActives(habitual: readonly HabitualActive[]): HabitualActiveExposure[] {
  const out: HabitualActiveExposure[] = [];
  for (const h of habitual) {
    if (h.family !== 'creatine') continue;
    const a = h.active?.ingredient === 'creatine' ? h.active : null;
    const g = a?.dailyAverage == null ? null : convertMass(a.dailyAverage, a.unit, 'g');
    const schedule: HabitualActiveExposure['schedule'] =
      h.recurrence === 'daily' || h.recurrence === 'assumedDaily' ? 'daily' : h.recurrence === 'weekly' || h.recurrence === 'alternateDay' || h.recurrence === 'asNeeded' ? h.recurrence : 'unknown';
    out.push({
      active: 'creatine',
      gPerDay: g !== null && Number.isFinite(g) ? g : null,
      schedule,
      state: h.continuation === 'stopped' ? 'stopped' : 'taking',
      ...(h.continuation === 'stopped' ? { clinicianStop: true } : {}),
    });
  }
  return out;
}

export interface SupplementSuggestionPolicy {
  /** One decision per product, in catalogue order. */
  decisions: SuggestionDecision[];
  /** Products a suggestion card may show (allow or caution). */
  suggestible: ReadonlySet<string>;
  /** Products whose suggestion is withheld (not suggested, clinician review, unchecked), with reasons. */
  withheld: SuggestionDecision[];
  /** Status of the person's own taking / on-hand rows (logging always allowed; status shown, never a stop/start). */
  rowStatus: Array<{ supplementId: string; status: 'caution' | 'review' | 'unchecked'; decision: SuggestionDecision }>;
}

/**
 * The shared suggestion policy over a product list for this person (D7-03): the section's refusals and clinician stops
 * join the safety input; rows the person takes or has keep their row with a status.
 */
export function supplementSuggestionPolicy(section: SupplementsSectionV2 | null, products: readonly PolicyProduct[], safety: SuggestionSafetyInput): SupplementSuggestionPolicy {
  const rows = section?.rows ?? [];
  const idOf = (sid: string | null): string | null => (sid ? (supplementRecord(sid)?.id ?? sid) : null);
  const refused = rows.filter((r) => r.state === 'notForMe').map((r) => idOf(r.supplementId)).filter((x): x is string => !!x);
  const stops = rows.filter((r) => r.clinicianStop).map((r) => idOf(r.supplementId)).filter((x): x is string => !!x);
  const input: SuggestionSafetyInput = { ...safety, refused: [...(safety.refused ?? []), ...refused], clinicianStops: [...(safety.clinicianStops ?? []), ...stops] };
  const decisions = products.map((p) => suggestionDecision(p, input));
  const suggestible = new Set(decisions.filter(isSuggestible).map((d) => d.subject));
  const withheld = decisions.filter((d) => !isSuggestible(d));
  const rowStatus: SupplementSuggestionPolicy['rowStatus'] = [];
  for (const r of rows) {
    const id = idOf(r.supplementId);
    if (!id || (r.state !== 'taking' && r.state !== 'onHand')) continue;
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    // the person's own row: their refusal list does not apply, a clinician stop does
    const d = suggestionDecision(p, { ...input, refused: safety.refused ?? [] });
    const status = takenProductStatus(d);
    if (status !== 'none') rowStatus.push({ supplementId: id, status, decision: d });
  }
  return { decisions, suggestible, withheld, rowStatus };
}

/**
 * Catalogue ids the Food tab and the Coach may suggest as cards: only when the stance is `open`, never a `notForMe`
 * row and never one the person already takes or has at home (those show as their own rows).
 */
export function suggestible(section: SupplementsSectionV2 | null): { allowed: boolean; skip: ReadonlySet<string> } {
  const skip = new Set((section?.rows ?? []).map((r) => r.supplementId).filter((x): x is string => !!x));
  return { allowed: section?.stance === 'open', skip };
}
