/**
 * The plan ladder as the screens read it (design/screens/plan-ladder.md; docs/PLANNER_V2_SPEC.md §1.5, §2.3-2.4, §3.6):
 * Hard · Medium · Easy ‖ Ideal in a fixed order, the default selection, collapsed slots, the seven burdens, goal rows,
 * the fasting line, limit costs, the "Adopt some of these limits" patches (engine limits → the goal screen's limits)
 * and the comparison table rows. Pure (no React, no stores) so every rule here is unit-tested.
 *
 * The store keeps the v1 `PlannerResult`; the ladder rides along on `result.v2`. Rungs are never named by letters.
 */
import { formatNumber, formatSigned } from '@/components';
import { RUNG_OF_V1_ID, V1_ID } from '@/engine/planner/domain/compat';
import {
  DIFFICULTY_COMPONENTS,
  RUNG_IDS,
  type DifficultyBreakdown,
  type DifficultyComponentId,
  type FastingVerdict,
  type ConvergencePoint,
  type GoalOutcome,
  type IdealPlanV2,
  type LimitCost,
  type LimitGroupId,
  type PlanKind,
  type PlanOption,
  type PlannerResult,
  type PlannerResultV2,
  type PracticalConstraints,
  type RankedGoal,
  type RungId,
  type RungPlan,
  type RungSummary,
} from '@/engine/planner/domain/types';
import type { ConstraintDraft, LongestFast } from '@/state/plannerStore';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { goalMetric } from './catalogue';
import { fmtMetric, fmtPct, fmtSignedRange, fmtMetricRange, toDisplay } from './format';
import { LONGEST_FAST_OPTIONS } from './request';

export { RUNG_IDS, RUNG_OF_V1_ID, V1_ID };
export type { PlanKind, RungId };

/** A rung or the Ideal: everything a v1 option carried plus its summary. */
export type LadderPlan = RungPlan | IdealPlanV2;

/** Fixed order of the ladder: results fall left to right inside the limits, the Ideal stands apart. */
export const PLAN_KINDS: readonly PlanKind[] = ['hard', 'medium', 'easy', 'ideal'];
export const RUNG_TITLE: Readonly<Record<PlanKind, string>> = { hard: 'Hard', medium: 'Medium', easy: 'Easy', ideal: 'Ideal' };
/** The rung key's initial (identity never by colour alone). */
export const RUNG_INITIAL: Readonly<Record<PlanKind, string>> = { hard: 'H', medium: 'M', easy: 'E', ideal: 'I' };
export const IDEAL_CAPTION = 'scientific ceiling — your practical limits removed, safety kept';

export const isRung = (k: string | null | undefined): k is RungId => k === 'hard' || k === 'medium' || k === 'easy';
export const isPlanKind = (k: string | null | undefined): k is PlanKind => isRung(k) || k === 'ideal';

/** The ladder of a stored result (null for results found before the ladder existed). */
export function ladderOf(result: PlannerResult | null | undefined): PlannerResultV2 | null {
  return result?.v2 ?? null;
}

export function planOf(v2: PlannerResultV2, kind: PlanKind): LadderPlan | null {
  return kind === 'ideal' ? v2.ideal : (v2.rungs[kind] ?? null);
}

/** Plans shown as cards, in ladder order (rungs, then the Ideal; an Ideal that equals Hard is not a card of its own). */
export function presentKinds(v2: PlannerResultV2): PlanKind[] {
  const same = idealSameAsHard(v2) !== null;
  return PLAN_KINDS.filter((k) => planOf(v2, k) !== null && !(k === 'ideal' && same));
}

/* ---------------------------------------------------------------------------------------- Ideal equals Hard */

/** Plain names of the limit groups (the lifted-limits list of an Ideal that equals Hard, for older results). */
export const LIMIT_GROUP_LABEL: Readonly<Record<LimitGroupId, string>> = {
  trainingDays: 'training days',
  sessionTime: 'session length',
  cardio: 'cardio',
  eatingWindow: 'eating window',
  steps: 'steps',
  sleep: 'sleep',
  fasting: 'fasting',
  foodFloors: 'food minimums',
  hunger: 'hunger',
  equipment: 'equipment',
};

export interface LiftedLimit {
  label: string;
  from: string;
  to: string;
}

export const SAME_AS_HARD_LINE = 'None of your limits is binding; the Ideal is this same plan.';

/**
 * The Ideal is Hard's own plan (no practical limit binds): the limits that were lifted without effect, else null. Reads
 * `ideal.sameAsHard`; results from before it existed signal the same with `nothingBinds` and list `relaxed`. The ladder
 * then draws no Ideal card; Hard's card says so in one line.
 */
export function idealSameAsHard(v2: Pick<PlannerResultV2, 'ideal' | 'rungs'>): LiftedLimit[] | null {
  const ideal = v2.ideal;
  if (!ideal || !v2.rungs.hard) return null;
  if (ideal.sameAsHard) return ideal.sameAsHard.liftedWithoutEffect.map((l) => ({ label: l.label || LIMIT_GROUP_LABEL[l.group] || l.group, from: l.from, to: l.to }));
  if (ideal.sameAsHard === undefined && ideal.nothingBinds) return ideal.relaxed.map((r) => ({ label: LIMIT_GROUP_LABEL[r.group] ?? r.group, from: r.from, to: r.to }));
  return null;
}

export const liftedText = (l: LiftedLimit): string => `${l.label}: ${l.from} → ${l.to}`;

/* ------------------------------------------------------------------------------------------- provenance */

/** "from the quick search": a rung kept from the previous, shorter search because this search's own rung collapsed. */
export function carriedNote(p: Pick<RungPlan, 'provenance' | 'fromTier'> | null | undefined): string | null {
  if (p?.provenance !== 'carried') return null;
  if (p.fromTier === 'S') return 'from the quick search';
  if (p.fromTier === 'L') return 'from the thorough search';
  return 'from the earlier search';
}

/** Default selection: Medium if present, else Hard (nothing is labelled "recommended"). */
export function defaultKind(v2: PlannerResultV2): PlanKind {
  if (v2.rungs.medium) return 'medium';
  if (v2.rungs.hard) return 'hard';
  if (v2.rungs.easy) return 'easy';
  return 'ideal';
}

/** The selected plan from the URL: `?rung=hard|medium|easy|ideal` (older `?plan=` links still land on their rung). */
export function kindFromParams(params: URLSearchParams, v2: PlannerResultV2): PlanKind {
  const raw = params.get('rung')?.toLowerCase() ?? null;
  const legacy = params.get('plan')?.toUpperCase();
  const asked: string | null = isPlanKind(raw) ? raw : legacy && legacy in RUNG_OF_V1_ID ? RUNG_OF_V1_ID[legacy as PlanOption['id']] : null;
  return isPlanKind(asked) && presentKinds(v2).includes(asked) ? asked : defaultKind(v2);
}

/** The v1 option the start sheet and the Simulator copy need (the store's own option when it has one). */
export function v1OptionOf(result: PlannerResult, kind: RungId): PlanOption | null {
  return result.options.find((o) => o.id === V1_ID[kind]) ?? null;
}

/** What a missing rung's chip says (the engine's sentence; the UI adds only the engraved rung name). */
export function collapsedSlot(v2: PlannerResultV2, rung: RungId): { title: string; text: string } | null {
  if (v2.rungs[rung]) return null;
  const c = v2.ladder.collapsed.find((x) => x.rung === rung);
  const text = c?.text?.trim() || (v2.complete ? 'No distinct plan at this effort.' : 'Not found before the search stopped.');
  return { title: RUNG_TITLE[rung].toLowerCase(), text };
}

/** Every rung that is not a card, in ladder order, as a chip under the ladder graph. */
export function collapsedChips(v2: PlannerResultV2): Array<{ kind: RungId; title: string; text: string }> {
  return RUNG_IDS.flatMap((k) => {
    const c = collapsedSlot(v2, k);
    return c ? [{ kind: k, ...c }] : [];
  });
}

/** "Hard plan · Deficit 22 % · 4 sessions" (scenario names, exports, print), clipped to `max` characters. */
export function planLabel(kind: PlanKind, subtitle: string, max = 120): string {
  const s = `${RUNG_TITLE[kind]} plan${subtitle ? ` · ${subtitle}` : ''}`;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/* --------------------------------------------------------------------------------------------- burdens */

/** Engraved labels of the seven burdens, fixed order (COMPONENTS §13.7). */
export const BURDEN_LABEL: Readonly<Record<DifficultyComponentId, string>> = {
  deficit: 'deficit',
  hunger: 'hunger',
  trainingTime: 'training time',
  fastingLoad: 'fasting load',
  windowTightness: 'eating window',
  decisions: 'daily decisions',
  habitDistance: 'change from now',
};
export const BURDEN_INACTIVE = 'no room to change here — your limit is where you are now.';
/** The second half of the Overview's footnote, after the footer line every card carries (`effortFooter`). */
export const BURDEN_TIGHT = 'When several limits are tight, effort stays low even for the hardest plan you can do.';
export const BURDEN_FOOTNOTE = `Effort averages all seven parts. ${BURDEN_TIGHT}`;
/** The card's footer under the seven rows: what the headline effort number is. */
export const effortFooter = (d: Pick<DifficultyBreakdown, 'D'>): string => `effort ${effortValue(d)} is the average of these seven parts.`;
export const PAST_LIMIT = 'past your limit';
/** The ladder caption (under the graph). */
export const IDEAL_NOT_HARDER = 'The Ideal is not meant to be harder, only free of your practical limits.';
/** The effort axis, in words. */
export const EFFORT_AXIS = 'Effort (0 = how you live now, 100 = your limits)';
/** Longest overflow drawn past the limit tick, as a share of the habit-to-limit track. */
export const OVER_CAP = 0.5;
const GENTLE_OFF: ReadonlySet<DifficultyComponentId> = new Set(['deficit', 'fastingLoad']);

export interface BurdenRow {
  id: DifficultyComponentId;
  label: string;
  /** c_i ∈ [0, 1]: 0 at today's habit, 1 at your limit. */
  value: number;
  /** The Ideal only: how far past your limit (0-0.5 of the habit-to-limit span), drawn hatched. */
  over: number;
  /** The overflow was cut at 0.5 of the track (the text carries the number). */
  capped: boolean;
  active: boolean;
  text: string;
}

/** Always seven rows in `DIFFICULTY_COMPONENTS` order. Gentle mode shows the deficit and fasting burdens as inactive. */
export function burdenRows(d: DifficultyBreakdown, opts: { ideal?: boolean; gentle?: boolean } = {}): BurdenRow[] {
  return DIFFICULTY_COMPONENTS.map((id) => {
    const c = d.components.find((x) => x.id === id);
    const hidden = opts.gentle && GENTLE_OFF.has(id);
    if (!c || !c.active || hidden) return { id, label: BURDEN_LABEL[id], value: 0, over: 0, capped: false, active: false, text: hidden ? 'not shown in gentle mode' : BURDEN_INACTIVE };
    // one scale on every card: 0 at today's habit, 1 at your limit (the tick at the track's right end)
    const span = c.limit - c.habit;
    const ratio = Number.isFinite(span) && Math.abs(span) > 1e-9 ? (c.raw - c.habit) / span : c.value;
    const past = opts.ideal && Number.isFinite(ratio) ? Math.max(0, ratio - 1) : 0;
    const over = past > 1e-6 ? Math.min(OVER_CAP, past) : 0;
    return { id, label: BURDEN_LABEL[id], value: clamp01(c.value), over, capped: past > OVER_CAP, active: true, text: c.text };
  });
}

/** "effort 64 / 100 · hardest part: hunger". */
export function effortHeader(d: DifficultyBreakdown): string {
  const hard = d.hardest ? ` · hardest part: ${BURDEN_LABEL[d.hardest]}` : '';
  return `effort ${effortValue(d)} / 100${hard}`;
}

export const effortValue = (d: Pick<DifficultyBreakdown, 'D'>): number => Math.round(clamp01(d.D) * 100);

/* ------------------------------------------------------------------------------------------- goal rows */

const WEIGHT_METRICS: ReadonlySet<string> = new Set(['fatMass', 'scaleWeight', 'bodyFatPct', 'waist', 'visceralFat', 'trendWeight']);
/** Weight-type numbers sit behind "show numbers" in gentle mode. */
export const isWeightMetric = (metric: string): boolean => WEIGHT_METRICS.has(metric);

export type OutcomeStatus = 'reached' | 'partial' | 'missed' | 'near' | 'directional';

export interface OutcomeView {
  rank: number;
  /** "fat mass" (engraved row name). */
  name: string;
  /** "−8.1 kg", or "↑ 62 % of what’s possible" for a goal without a target. */
  value: string;
  /** "likely 6.9–9.2 kg" (P10–P90 of the check runs), null without a band. */
  range: string | null;
  /** RangeBar glyph in display units (null without a band). */
  bar: { low: number; high: number; value: number } | null;
  status: OutcomeStatus;
  /** "reached in about 15 weeks · 82 % chance" / "kept" / "about 23 weeks at this plan’s effort". */
  verdict: string;
  /** "2.5 kg more lost than Hard" (every plan but Hard). */
  vsHard: string | null;
  weightType: boolean;
}

/** A goal kept on target is lost when its target lies below the start (fat mass "lose 8 kg"). */
export function isLoseGoal(g: Pick<RankedGoal, 'direction' | 'target' | 'targetKind'> | undefined, start?: number): boolean {
  if (!g) return false;
  if (g.direction === 'minimise') return true;
  if (g.target === undefined) return false;
  if (g.targetKind === 'change') return g.target < 0;
  return start !== undefined && g.target < start;
}

const chance = (p: number | null, round10: boolean): string | null => {
  if (p === null || !Number.isFinite(p)) return null;
  const pct = p <= 1 ? p * 100 : p;
  return `${fmtPct(round10 ? Math.round(pct / 10) * 10 : pct)} chance`;
};

/**
 * The goal's gap to Hard in words that say which way: "0.8 kg less lost than Hard" (a goal being lost), "1.1 kg more
 * gained than Hard", "0.4 kg higher than Hard"; "the same as Hard" when it rounds to zero.
 */
function vsHardText(o: GoalOutcome, goal: RankedGoal | undefined, change: boolean, units: UnitSystem, energy: EnergyUnit): string {
  const mag = fmtMetric(o.metric, Math.abs(o.vsHard), units, { energy });
  const zero = fmtMetric(o.metric, 0, units, { energy });
  if (!Number.isFinite(o.vsHard) || mag === zero) return 'the same as Hard';
  // both shown values round alike ("−0.1 kg" against "−0.1 kg"): no gap worth naming
  const mine = change ? o.change : o.p50;
  const show = (v: number) => fmtMetric(o.metric, v, units, { signed: change, energy });
  if (show(mine) === show(mine - o.vsHard)) return 'the same as Hard';
  const up = o.vsHard > 0;
  if (change) {
    const hardChange = o.change - o.vsHard;
    // the words follow what both plans actually do: both lose → "lost", both gain → "gained", else the goal's way
    const lose = o.change <= 0 && hardChange <= 0 ? true : o.change >= 0 && hardChange >= 0 ? false : isLoseGoal(goal, o.start);
    // a lost amount is the negative change: a higher end value means less was lost
    return lose ? `${mag} ${up ? 'less' : 'more'} lost than Hard` : `${mag} ${up ? 'more' : 'less'} gained than Hard`;
  }
  return `${mag} ${up ? 'higher' : 'lower'} than Hard`;
}

/** One goal row of a card or the table (rank order, never re-sorted). */
export function outcomeView(
  o: GoalOutcome,
  goal: RankedGoal | undefined,
  kind: PlanKind,
  units: UnitSystem,
  opts: { energy?: EnergyUnit; roundChance?: boolean } = {},
): OutcomeView {
  const energy = opts.energy ?? 'kcal';
  const m = goalMetric(o.metric);
  const name = (m?.label ?? o.label).toLowerCase();
  const directional = !goal || goal.target === undefined;
  const change = goal?.targetKind === 'change';
  const shift = change ? o.start : 0;
  let value: string;
  let range: string | null = null;
  let bar: OutcomeView['bar'] = null;
  if (directional) {
    const arrow = goal?.direction === 'minimise' ? '↓' : '↑';
    value = `${arrow} ${fmtPct(o.percentOfAchievable)} of what’s possible`;
  } else value = change ? fmtMetric(o.metric, o.change, units, { signed: true, energy }) : fmtMetric(o.metric, o.p50, units, { energy });
  if (o.band && Number.isFinite(o.band.p10) && Number.isFinite(o.band.p90)) {
    const lo = o.band.p10 - shift;
    const hi = o.band.p90 - shift;
    const lose = change && isLoseGoal(goal, o.start);
    range = `likely ${lose && lo < 0 && hi < 0 ? fmtMetricRange(o.metric, -hi, -lo, units, energy) : change ? fmtSignedRange(o.metric, lo, hi, units, energy) : fmtMetricRange(o.metric, lo, hi, units, energy)}`;
    const d = (v: number) => toDisplay(o.metric, v, units, energy).value;
    bar = { low: d(Math.min(lo, hi)), high: d(Math.max(lo, hi)), value: d(o.p50 - shift) };
  }
  let status: OutcomeStatus;
  let verdict: string;
  const tail = chance(o.pTargetMet, !!opts.roundChance);
  if (o.verdict === 'kept') {
    status = 'reached';
    verdict = 'kept';
  } else if (o.verdict === 'reached') {
    status = 'reached';
    const t = o.tttText?.trim();
    verdict = [t && /^reach/i.test(t) ? t : t ? `reached · ${t}` : 'reached', tail].filter(Boolean).join(' · ');
  } else if (o.verdict === 'notReached') {
    status = o.beyondTwoYears ? 'missed' : 'partial';
    verdict = o.tttText?.trim() || (o.beyondTwoYears ? 'more than two years at this plan’s effort' : 'not reached in this horizon');
  } else {
    const near = Math.round(o.percentOfAchievable) >= 90;
    status = near ? 'near' : 'directional';
    verdict = [near ? 'near its best' : 'partial', o.grade === 'D' ? 'grade D' : null].filter(Boolean).join(' · ');
  }
  const vsHard = kind === 'hard' || directional ? null : vsHardText(o, goal, change, units, energy);
  return { rank: o.goal + 1, name, value, range, bar, status, verdict, vsHard, weightType: isWeightMetric(o.metric) };
}

/* ---------------------------------------------------------------------------------------------- fasting */

const h0 = (h: number) => formatNumber(Math.round(h), 0);

function fastWords(kind: FastingVerdict['kind'], h: number): string {
  if (kind === 'multiDay') return `a ${h0(h)}-hour fast`;
  if (kind === 'zeroDays') return 'zero-energy days';
  if (kind === 'fast24') return `${h0(h)}-hour fasts`;
  if (kind === 'eatingWindow') return 'time-restricted eating';
  return 'no fast';
}

const lowerFirst = (t: string) => (t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);
const noStop = (t: string) => t.trim().replace(/[.!]+$/, '');

/**
 * The card's one-line fasting verdict: "a 24-hour fast", "time-restricted eating" (a short window is never called a
 * fast), "no fast · a plan with 24-hour fasts was considered" (the popover tells why), or why fasting was not offered.
 */
export function fastingLine(v: FastingVerdict, run: Pick<PlannerResultV2['fasting'], 'offered' | 'reason'> | null): { text: string; rival: boolean } {
  if (v.used) return { text: fastWords(v.kind ?? 'fast24', v.longestFastH ?? 24), rival: false };
  const tre = v.kind === 'eatingWindow' ? 'time-restricted eating · ' : '';
  if (v.rival) return { text: `${tre}no fast · a plan with ${fastWords(v.rival.kind, v.rival.longestFastH)} was considered`, rival: true };
  if (run && !run.offered && run.reason) return { text: `${tre}no fast · ${lowerFirst(noStop(run.reason))}`, rival: false };
  return { text: `${tre}no fast`, rival: false };
}

/** The 3-row "with the fast vs this plan" table under the rival sentence: goal deltas, hunger peak, lean tissue. */
export function rivalRows(v: FastingVerdict, goals: readonly RankedGoal[], units: UnitSystem, energy: EnergyUnit = 'kcal'): Array<{ label: string; value: string }> {
  const r = v.rival;
  if (!r) return [];
  const rows = r.goalDeltas.map((d) => {
    const metric = goals[d.goal]?.metric;
    const label = metric ? (goalMetric(metric)?.label ?? metric).toLowerCase() : `goal ${d.goal + 1}`;
    return { label, value: metric ? fmtMetric(metric, d.delta, units, { signed: true, energy }) : `${formatSigned(d.delta, 1)}\u2009${d.unit}` };
  });
  if (r.hungerPeakDelta !== null && Number.isFinite(r.hungerPeakDelta)) rows.push({ label: 'hunger peak', value: `${formatSigned(r.hungerPeakDelta, 0)} points` });
  if (r.leanTissueDeltaKg !== null && Number.isFinite(r.leanTissueDeltaKg)) rows.push({ label: 'lean tissue', value: fmtMetric('leanTissue', r.leanTissueDeltaKg, units, { signed: true, energy }) });
  return rows;
}

/* ------------------------------------------------------------------------------------------ limit costs */

const TINY = 1e-6;

/** A goal delta in goal words: "+0.6 kg fat mass loss" for goals that go down, "+0.3 kg lean tissue" otherwise. */
export function goalDelta(d: { goal: number; delta: number; unit: string }, goals: readonly RankedGoal[], units: UnitSystem, energy: EnergyUnit = 'kcal'): string {
  const g = goals[d.goal];
  if (!g) return `${formatSigned(d.delta, 1)}\u2009${d.unit}`;
  const label = (goalMetric(g.metric)?.label ?? g.metric).toLowerCase();
  if (isLoseGoal(g)) return `${fmtMetric(g.metric, -d.delta, units, { signed: true, energy })} ${label} loss`;
  return `${fmtMetric(g.metric, d.delta, units, { signed: true, energy })} ${label}`;
}

export interface LimitCostView {
  group: LimitCost['group'];
  /** "allowing 5 training days instead of 3 training days" / "buying a pull-up bar". */
  lead: string;
  strong: string;
  deltas: string[];
  effort: string | null;
}

export function limitCostView(c: LimitCost, goals: readonly RankedGoal[], units: UnitSystem, energy: EnergyUnit = 'kcal'): LimitCostView {
  const deltas = c.deltas.filter((d) => Math.abs(d.delta) > TINY && shownNonZero(d, goals, units, energy)).map((d) => goalDelta(d, goals, units, energy));
  const dD = Math.round(c.deltaD * 100);
  const lead = c.group === 'equipment' ? 'buying' : 'allowing';
  const tail = c.group === 'equipment' ? '' : ` instead of ${c.current}`;
  return { group: c.group, lead: `${lead} ${c.relaxedTo}${tail}`, strong: c.relaxedTo, deltas, effort: dD !== 0 ? `effort ${formatSigned(dD, 0)}` : null };
}

/** A delta that prints as something other than zero in its goal's display units. */
function shownNonZero(d: { goal: number; delta: number }, goals: readonly RankedGoal[], units: UnitSystem, energy: EnergyUnit): boolean {
  const g = goals[d.goal];
  const s = g ? toDisplay(g.metric, d.delta, units, energy) : { value: d.delta, decimals: 1 };
  return Number.isFinite(s.value) && Math.abs(s.value) >= 0.5 * 10 ** -s.decimals;
}

/** The top 3 limit costs (the engine sorted them by goal priority) and the "together, through interactions" remainder. */
export function idealCosts(ideal: IdealPlanV2, goals: readonly RankedGoal[], units: UnitSystem, energy: EnergyUnit = 'kcal', top = 3): { rows: LimitCostView[]; more: number; remainder: string | null } {
  const rows = ideal.limitCosts.slice(0, top).map((c) => limitCostView(c, goals, units, energy));
  const rem = ideal.interactionRemainder.filter((d) => shownNonZero(d, goals, units, energy));
  const remainder = rem.length ? `together, through interactions: ${rem.map((d) => goalDelta(d, goals, units, energy)).join(' · ')}` : null;
  return { rows, more: Math.max(0, ideal.limitCosts.length - top), remainder };
}

export const NOTHING_BINDS_LEAD = 'Your limits cost nothing measurable for these goals.';
export const NOTHING_BINDS_TAIL = 'Hard already matches the ceiling.';
export const NOTHING_BINDS = `${NOTHING_BINDS_LEAD} ${NOTHING_BINDS_TAIL}`;
export const IDEAL_KEEPS = 'Your food rules, allergies, safety answers and opt-ins still apply.';

/* ---------------------------------------------------------------------------- adopt some of these limits */

const LEVERS_FROM_LIMITS: ReadonlySet<string> = new Set(['fastDay24', 'zeroDay', 'waterFast', 'L5']);

/** The goal screen's limit patch for a limit-cost row (engine `PracticalConstraints` → `ConstraintDraft` fields). */
export function adoptPatch(adopt: Partial<PracticalConstraints>, current: ConstraintDraft): Partial<ConstraintDraft> {
  const p: Partial<ConstraintDraft> = {};
  const has = (k: keyof PracticalConstraints) => Object.prototype.hasOwnProperty.call(adopt, k);
  if (adopt.trainingDaysPerWeek) p.trainingDays = [adopt.trainingDaysPerWeek.min, adopt.trainingDaysPerWeek.max];
  if (adopt.allowedTrainingWeekdays) p.trainingWeekdays = [...adopt.allowedTrainingWeekdays];
  if (adopt.trainingTimeH !== undefined) p.trainingTimeH = adopt.trainingTimeH;
  if (adopt.maxSessionMin !== undefined) p.maxSessionMin = adopt.maxSessionMin;
  if (adopt.cardioDaysPerWeek) p.cardioDays = [adopt.cardioDaysPerWeek.min, adopt.cardioDaysPerWeek.max];
  if (adopt.cardioModality) p.cardioModality = adopt.cardioModality;
  if (adopt.eatingWindow) {
    p.earliestH = adopt.eatingWindow.earliestH;
    p.latestH = adopt.eatingWindow.latestH;
  }
  if (adopt.mealsPerDay) p.mealsPerDay = [adopt.mealsPerDay.min, adopt.mealsPerDay.max];
  if (adopt.steps) p.steps = [adopt.steps.min, adopt.steps.max];
  if (adopt.excludedLevers) p.excluded = adopt.excludedLevers.filter((id) => !LEVERS_FROM_LIMITS.has(id));
  if (adopt.prefersFasting !== undefined) p.prefersFasting = adopt.prefersFasting;
  if (adopt.sleepFixed !== undefined) p.sleepFixed = adopt.sleepFixed;
  if (adopt.hungerTolerance) p.hungerTolerance = adopt.hungerTolerance;
  if (adopt.maxFastHours !== undefined) p.longestFastH = snapLongestFast(adopt.maxFastHours, current.longestFastH);
  else if (adopt.fasting === 'allowed' && current.longestFastH < 24) p.longestFastH = 24;
  if (has('proteinFloorGPerKg')) p.proteinFloor = adopt.proteinFloorGPerKg ?? null;
  if (has('carbFloorGPerDay')) p.carbFloorG = adopt.carbFloorGPerDay ?? 0;
  // only what actually changes (an empty patch means "nothing on the goal screen sets this limit")
  for (const k of Object.keys(p) as Array<keyof ConstraintDraft>) if (sameValue(p[k], current[k])) delete p[k];
  return p;
}

/** The largest offered longest-fast value not above `h` (never below the current one). */
export function snapLongestFast(h: number, current: LongestFast): LongestFast {
  const fit = LONGEST_FAST_OPTIONS.filter((x) => x <= h + 1e-9);
  const v = fit.length ? fit[fit.length - 1]! : LONGEST_FAST_OPTIONS[0]!;
  return v < current ? current : v;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** An intermediate value for a limit row (bounded by the Ideal's value): one scalar per group where there is one. */
export interface AdoptKnob {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** The patch for a chosen value. */
  patch: (v: number) => Partial<ConstraintDraft>;
  /** Values a key bank offers instead of a stepper (longest fast). */
  options?: readonly number[];
}

export function adoptKnob(cost: LimitCost, current: ConstraintDraft): AdoptKnob | null {
  const full = adoptPatch(cost.adopt, current);
  const between = (a: number, b: number) => ({ min: Math.min(a, b), max: Math.max(a, b) });
  if (full.trainingDays && full.trainingDays[1] !== current.trainingDays[1]) {
    const lo = full.trainingDays[0];
    return { label: 'training days', unit: 'a week', ...between(current.trainingDays[1], full.trainingDays[1]), step: 1, decimals: 0, patch: (v) => ({ trainingDays: [Math.min(lo, v), v] }) };
  }
  if (full.maxSessionMin !== undefined) return { label: 'longest session', unit: 'min', ...between(current.maxSessionMin, full.maxSessionMin), step: 5, decimals: 0, patch: (v) => ({ maxSessionMin: v }) };
  if (full.cardioDays && full.cardioDays[1] !== current.cardioDays[1]) {
    const lo = full.cardioDays[0];
    return { label: 'cardio days', unit: 'a week', ...between(current.cardioDays[1], full.cardioDays[1]), step: 1, decimals: 0, patch: (v) => ({ cardioDays: [Math.min(lo, v), v] }) };
  }
  if (full.steps && full.steps[1] !== current.steps[1]) {
    const lo = full.steps[0];
    return { label: 'steps up to', unit: 'a day', ...between(current.steps[1], full.steps[1]), step: 500, decimals: 0, patch: (v) => ({ steps: [Math.min(lo, v), v] }) };
  }
  if (full.earliestH !== undefined || full.latestH !== undefined) {
    const e0 = current.earliestH;
    const l0 = current.latestH;
    const e1 = full.earliestH ?? e0;
    const l1 = full.latestH ?? l0;
    const len0 = l0 - e0;
    const len1 = l1 - e1;
    if (Math.abs(len1 - len0) < 0.25) return null;
    const q = (x: number) => Math.round(x * 4) / 4;
    return {
      label: 'eating window',
      unit: 'h',
      ...between(len0, len1),
      step: 0.5,
      decimals: 1,
      patch: (v) => {
        const t = (v - len0) / (len1 - len0);
        return { earliestH: q(e0 + t * (e1 - e0)), latestH: q(l0 + t * (l1 - l0)) };
      },
    };
  }
  if (full.longestFastH !== undefined) {
    const options = LONGEST_FAST_OPTIONS.filter((h) => h >= current.longestFastH && h <= full.longestFastH!);
    if (options.length < 3) return null;
    return { label: 'longest fast', unit: 'h', min: options[0]!, max: options[options.length - 1]!, step: 1, decimals: 0, options, patch: (v) => ({ longestFastH: snapLongestFast(v, current.longestFastH) }) };
  }
  return null;
}

/** Merge the chosen rows' patches (later rows win on the same field). */
export function mergePatches(patches: ReadonlyArray<Partial<ConstraintDraft>>): Partial<ConstraintDraft> {
  return Object.assign({}, ...patches) as Partial<ConstraintDraft>;
}

/* ------------------------------------------------------------------------------------- comparison table */

export interface ComparisonRow {
  id: string;
  label: string;
  /** Rows of one group share a band (effort with its seven parts). */
  group?: 'effort' | 'goals';
  cells: Partial<Record<PlanKind, string>>;
}

export function fmtTrainingTime(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return 'none';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m || !h ? `${m} min` : ''} a week`;
}

const hungerCell = (s: RungSummary) =>
  s.hunger.rating === 'unknown' ? 'not modelled yet' : `${s.hunger.rating}${Number.isFinite(s.hunger.peak7Idx) ? ` · peaks ${formatNumber(s.hunger.peak7Idx, 0)} / 100` : ''}`;

function safetyCell(s: RungSummary): string {
  const flagged = s.safetyItems.filter((i) => i.severity !== 'info' && !/model projections|not medical advice/i.test(i.text));
  if (!flagged.length) return 'within safety limits';
  const d = flagged.filter((i) => i.severity === 'danger').length;
  const c = flagged.length - d;
  return [d ? `${d} danger${d === 1 ? '' : 's'}` : null, c ? `${c} caution${c === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');
}

export function equipmentCell(s: RungSummary, kind: PlanKind): string {
  const req = s.equipment.required.map((i) => `${i.name} (needed)`);
  const opt = s.equipment.optional.map((i) => i.name);
  const all = [...req, ...opt];
  if (all.length) return all.join(' · ');
  return kind === 'ideal' ? 'nothing to buy' : 'uses only what you have';
}

/**
 * Comparison rows in the contract's order (plan-ladder.md §6.9): effort (0-100 and the seven burdens) · one row per
 * goal · time to target · hunger · weekly training time · eating window · fasting · things to buy · limits it presses
 * · safety · what your limits cost (Ideal column only).
 */
export function comparisonRows(
  v2: PlannerResultV2,
  goals: readonly RankedGoal[],
  units: UnitSystem,
  opts: { energy?: EnergyUnit; gentle?: boolean } = {},
): ComparisonRow[] {
  const energy = opts.energy ?? 'kcal';
  const kinds = presentKinds(v2);
  const sum = (k: PlanKind) => planOf(v2, k)!.summary;
  const each = (f: (s: RungSummary, k: PlanKind) => string): Partial<Record<PlanKind, string>> => Object.fromEntries(kinds.map((k) => [k, f(sum(k), k)]));
  const rows: ComparisonRow[] = [];
  rows.push({ id: 'effort', label: 'effort', group: 'effort', cells: each((s) => `${effortValue(s.difficulty)} / 100`) });
  for (const id of DIFFICULTY_COMPONENTS) {
    rows.push({
      id: `burden-${id}`,
      label: BURDEN_LABEL[id],
      group: 'effort',
      cells: each((s, k) => burdenRows(s.difficulty, { ideal: k === 'ideal', gentle: opts.gentle }).find((r) => r.id === id)!.text),
    });
  }
  goals.forEach((g, i) => {
    rows.push({
      id: `goal-${i}`,
      label: `${i + 1} · ${(goalMetric(g.metric)?.label ?? g.metric).toLowerCase()}`,
      group: 'goals',
      cells: each((s, k) => {
        const o = s.outcomes.find((x) => x.goal === i);
        if (!o) return '—';
        const v = outcomeView(o, g, k, units, { energy });
        if (opts.gentle && v.weightType) return 'hidden in gentle mode';
        return [v.value, v.range, v.status === 'reached' ? (o.verdict === 'kept' ? 'kept' : 'reached') : v.status === 'missed' || v.status === 'partial' ? 'not reached' : null].filter(Boolean).join(' · ');
      }),
    });
  });
  rows.push({
    id: 'time',
    label: 'time to target',
    cells: each((s) => {
      const t = s.outcomes.filter((o) => o.tttText && goals[o.goal]?.target !== undefined).map((o) => `goal ${o.goal + 1}: ${o.tttText}`);
      return t.length ? t.join(' · ') : '—';
    }),
  });
  rows.push({ id: 'hunger', label: 'hunger', cells: each(hungerCell) });
  rows.push({ id: 'training', label: 'weekly training time', cells: each((s) => fmtTrainingTime(s.weeklyTrainingMin)) });
  rows.push({ id: 'window', label: 'eating window', cells: each((s) => (Number.isFinite(s.meanWindowH) && s.meanWindowH > 0 ? `${formatNumber(s.meanWindowH, s.meanWindowH % 1 ? 1 : 0)} h` : '—')) });
  rows.push({ id: 'fasting', label: 'fasting', cells: each((s) => (opts.gentle ? 'not shown in gentle mode' : fastingLine(s.fasting, v2.fasting).text)) });
  rows.push({ id: 'buy', label: 'things to buy', cells: each(equipmentCell) });
  rows.push({ id: 'limits', label: 'limits it presses', cells: each((s) => (s.bindingLimits.length ? s.bindingLimits.map((b) => b.text || b.label).join(' · ') : 'none')) });
  rows.push({ id: 'safety', label: 'safety', cells: each(safetyCell) });
  if (v2.ideal && kinds.includes('ideal')) {
    const ideal = v2.ideal;
    const c = idealCosts(ideal, goals, units, energy);
    const text = ideal.nothingBinds || !c.rows.length ? NOTHING_BINDS : [...c.rows.map((r) => [r.lead, ...r.deltas, r.effort].filter(Boolean).join(' · ')), c.remainder].filter(Boolean).join('; ');
    rows.push({ id: 'cost', label: 'what your limits cost', cells: { ideal: text } });
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ ladder scale */

export interface ScalePoint {
  kind: RungId;
  /** Effort 0-100. */
  x: number;
  /** Goal 1 change in display units. */
  y: number;
  label: string;
}

/**
 * The ladder at a glance (COMPONENTS §13.5): each rung at (effort, goal 1 change), the frontier of the search (goal score
 * against effort, scaled to goal 1's units through Hard so the rungs sit on it) and the Ideal's ceiling.
 */
export function ladderScale(v2: PlannerResultV2, goal1: RankedGoal | undefined, units: UnitSystem, energy: EnergyUnit = 'kcal') {
  const metric = goal1?.metric;
  const disp = (v: number) => (metric ? toDisplay(metric, v, units, energy).value : v);
  const decimals = metric ? toDisplay(metric, 0, units, energy).decimals : 1;
  const unit = metric ? toDisplay(metric, 0, units, energy).unit : '';
  const points: ScalePoint[] = [];
  for (const k of RUNG_IDS) {
    const r = v2.rungs[k];
    const o = r?.summary.outcomes.find((x) => x.goal === 0);
    if (!r || !o) continue;
    const y = disp(o.change);
    points.push({ kind: k, x: effortValue(r.summary.difficulty), y, label: `${RUNG_TITLE[k]} ${formatSigned(y, decimals)}` });
  }
  const io = v2.ideal?.summary.outcomes.find((x) => x.goal === 0);
  const same = idealSameAsHard(v2) !== null;
  const ceiling = io ? { y: disp(io.change), label: `${same ? 'ceiling = Hard' : 'ceiling (Ideal)'} ${formatSigned(disp(io.change), decimals)}${unit ? `\u2009${unit}` : ''}` } : null;
  // the frontier F(D) in goal score units, mapped through Hard (score at Hard's effort ↔ Hard's change)
  const hard = points.find((p) => p.kind === 'hard');
  const front = [...(v2.ladder.frontier ?? [])].filter((p) => Number.isFinite(p.D) && Number.isFinite(p.g)).sort((a, b) => a.D - b.D);
  let frontier: Array<{ x: number; y: number }> = [];
  if (hard && front.length >= 2) {
    const atHard = front.filter((p) => p.D * 100 <= hard.x + 0.5).reduce((a, p) => Math.max(a, p.g), -Infinity);
    if (Number.isFinite(atHard) && atHard > 1e-9) frontier = front.map((p) => ({ x: Math.round(clamp01(p.D) * 1000) / 10, y: (p.g / atHard) * hard.y }));
  }
  if (!frontier.length && points.length) frontier = [{ x: 0, y: 0 }, ...[...points].sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y }))];
  const summary = [
    ...[...points].map((p) => `${RUNG_TITLE[p.kind]} reaches ${formatSigned(p.y, decimals)}${unit ? ` ${unit}` : ''} at effort ${formatNumber(p.x, 0)}`),
    ceiling ? `without your limits ${formatSigned(ceiling.y, decimals)}${unit ? ` ${unit}` : ''}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  return { points, ceiling, frontier, unit, decimals, summary: summary ? `${summary}.` : '' };
}

/* ------------------------------------------------------------------------------------------ ladder graph */

export interface SearchCurve {
  /** Plans searched → goal 1 change of the best Hard found so far (display units, through Hard's final value). */
  points: Array<{ eu: number; y: number }>;
  /** Hard's final value. */
  final: { eu: number; y: number; label: string };
  /** Plans searched when the best result last improved by more than the display rounding. */
  settledAt: number;
}

export interface LadderGraph {
  /** `ladder`: rung markers on the effort axis; `search`: fewer than two rung markers or an exhaustive search, the run's convergence instead. */
  mode: 'ladder' | 'search';
  /** Both views exist (an exhaustive search with two or more markers): a "ladder · search" switch picks one. */
  switchable: boolean;
  xLabel: string;
  /** "goal 1 · fat mass" (lower-case metric name). */
  yLabel: string;
  scale: ReturnType<typeof ladderScale>;
  search: SearchCurve | null;
  /** One sentence for screen readers. */
  summary: string;
}

/**
 * What the ladder graph plots (plan-ladder.md §12.4): with two or more rung markers, the rungs on the effort axis
 * (worded); with fewer, or after an exhaustive search (tier X), the search's convergence curve (the best Hard found so
 * far against plans searched), so a lone Hard still reads as a curve. When both exist `prefer` picks one (the
 * "ladder · search" switch; an exhaustive search opens on the curve). The convergence never sits on the effort axis.
 */
export function ladderGraphData(v2: PlannerResultV2, goal1: RankedGoal | undefined, units: UnitSystem, energy: EnergyUnit = 'kcal', prefer?: 'ladder' | 'search'): LadderGraph {
  const scale = ladderScale(v2, goal1, units, energy);
  const yLabel = `goal 1 · ${goal1 ? (goalMetric(goal1.metric)?.label ?? goal1.metric).toLowerCase() : 'goal'}`;
  const hard = scale.points.find((p) => p.kind === 'hard');
  // a stopped exhaustive search that left the earlier ladder in place still opens on its curve (keptAfterStop)
  const exhaustive = v2.provenance?.tier === 'X' || v2.keptAfterStop?.tier === 'X';
  const curve = (scale.points.length < 2 || exhaustive) && hard ? searchCurve(v2.convergence ?? [], hard, scale.decimals) : null;
  const switchable = !!curve && scale.points.length >= 2;
  const search = curve && (!switchable || prefer !== 'ladder') ? curve : null;
  const unit = scale.unit ? ` ${scale.unit}` : '';
  const summary = search
    ? `The search tried ${formatNumber(search.final.eu, 0)} plans; the best result stopped improving after about ${formatNumber(search.settledAt, 0)} at ${formatSigned(search.final.y, scale.decimals)}${unit}.`
    : scale.summary;
  return { mode: search ? 'search' : 'ladder', switchable, xLabel: EFFORT_AXIS, yLabel, scale, search, summary };
}

function searchCurve(conv: readonly ConvergencePoint[], hard: ScalePoint, decimals: number): SearchCurve | null {
  const pts = conv.filter((p) => Number.isFinite(p.eu) && Number.isFinite(p.G)).sort((a, b) => a.eu - b.eu);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1]!;
  // goal score → goal 1 units through Hard (the final score is Hard's value), as the frontier is mapped
  const scale = last.G > 1e-9 ? hard.y / last.G : 0;
  let best = -Infinity;
  const points = pts.map((p) => {
    best = Math.max(best, p.G);
    return { eu: p.eu, y: best * scale };
  });
  const tol = 0.5 * 10 ** -decimals;
  const settled = points.find((p) => Math.abs(p.y - hard.y) <= tol) ?? last;
  return { points, final: { eu: last.eu, y: hard.y, label: hard.label }, settledAt: settled.eu };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/* ---- E19 (goal suggestion): the ladder's "based on your answers" line. Owned by E19; keep this one function. ---- */
/**
 * "Goals based on your answers" when the goals being planned still include ones a suggestion added (`goals.suggested`
 * provenance), else null. `source` says who made the suggestion (the built-in rules or the Coach).
 */
export function basedOnAnswersLine(
  suggested: { provenance: { source: 'rule' | 'ai' }; goalKeys: readonly string[] } | null | undefined,
  goalKeys: readonly string[],
): string | null {
  if (!suggested || !suggested.goalKeys.some((k) => goalKeys.includes(k))) return null;
  return suggested.provenance.source === 'ai' ? 'Goals based on your answers, suggested by the Coach.' : 'Goals based on your answers.';
}
