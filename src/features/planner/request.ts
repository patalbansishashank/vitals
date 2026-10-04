/**
 * Goals screen state → engine `PlannerRequest` (src/engine/planner/domain/types.ts, MODEL_SPEC §10).
 *
 * - Goals keep their rank order; each goal's phrasing (lose/keep/gain/raise/lower/reach) becomes a direction, a
 *   target (change or absolute) and, for must/nice strengths, an explicit degradation tolerance.
 * - Practical limits map onto `PracticalConstraints`, including the user's own limits as first-class fields: the
 *   longest fast they accept (`maxFastHours`), the protein floor (`proteinFloorGPerKg`) and the net-carbohydrate floor
 *   (`carbFloorGPerDay`). Screening locks travel unchanged in `safety.plannerLocks`; the engine applies the stricter
 *   of the two.
 * - The safety input is the onboarding `ScreeningOutcome` + current opt-ins, passed structurally; the profile also
 *   carries the screening as engine `SafetyFlags` (profileStore: "safety flags are merged by the caller").
 * - `requestHash` is a stable FNV-1a hash of the canonical JSON: equal requests → equal hashes (stale detection).
 */
import type { HabitProfile, PersonProfile, SafetyFlags, SafetyMode } from '@/engine/types/profile';
import { supplementPlannerInputs, toSectionV2 } from '@/catalogues/supplements';
import type { PlannerRequest, PlannerSafetyInput, PracticalConstraints, RankedGoal, Strictness, Weekday } from '@/engine/planner/domain/types';
import { expertModeOn, type ScreeningOutcome, type OptInTier, type PlannerLock } from '@/features/onboarding/safetyRules';
import type { ConstraintDraft, GoalDraft, LongestFast } from '@/state/plannerStore';
import { goalMetric, modeSpec, toleranceFor } from './catalogue';

/* ---------------------------------------------------------------------------------------------------- dates */

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The next Monday after `today` (plans start on a Monday so weeks read naturally). */
export function nextMondayISO(today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const wd = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() + (wd === 0 ? 7 : 7 - wd));
  return isoOf(d);
}

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoOf(new Date(y, m - 1, d + n));
}

/* -------------------------------------------------------------------------------------------- constraints */

export const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const LONGEST_FAST_OPTIONS: readonly LongestFast[] = [12, 16, 20, 24, 48, 72];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, step: number) => Math.round(x / step) * step;

/**
 * Limits pre-filled from Habits (planner-goals.md §8 "limits pre-filled from Habits"). `habits` may be partial; missing
 * fields use the engine's population defaults.
 */
export function defaultConstraints(habits: HabitProfile | undefined): ConstraintDraft {
  const h = habits ?? {};
  const sessions = clamp(Math.round(h.sessionsPerWeek ?? 2), 0, 14);
  const liftShare = 1 - clamp(h.lifingCardioMix ?? 0.5, 0, 1);
  const rtHabit = clamp(Math.round(sessions * liftShare), 0, 6);
  const novice = h.trainingHistory === 'none' || h.trainingHistory === 'lt1y';
  const rtMax = clamp(Math.max(rtHabit + 1, novice ? 3 : 4), 1, 6);
  const steps = clamp(round(h.typicalSteps ?? 7000, 500), 2000, 20000);
  const winStart = h.habitualWindowStartH ?? 8;
  const winLen = h.habitualWindowLengthH ?? 12;
  const earliest = clamp(Math.floor(Math.min(winStart, 8)), 5, 12);
  const bed = h.bedTimeH ?? 23;
  const latestByBed = (bed < 12 ? bed + 24 : bed) - 3;
  const latest = clamp(Math.max(Math.min(winStart + winLen, latestByBed), earliest + 8), 14, 23);
  const sleepH = (((h.wakeTimeH ?? 7) - bed + 24) % 24) || 8;
  return {
    trainingDays: [Math.min(2, rtMax), rtMax],
    trainingWeekdays: ALL_WEEKDAYS.slice(),
    trainingTimeH: 18,
    maxSessionMin: 75,
    cardioDays: [0, 3],
    cardioModality: h.trainingHistory === 'none' ? 'walk' : 'cycle',
    earliestH: earliest,
    latestH: latest,
    mealsPerDay: [2, clamp(Math.round(h.habitualMealsPerDay ?? 3) + 1, 3, 5)],
    steps: [clamp(steps - 1000, 2000, 18000), clamp(Math.max(steps + 3000, 10000), 4000, 20000)],
    longestFastH: 24,
    prefersFasting: false,
    excluded: [],
    proteinFloor: null,
    carbFloorG: 0,
    sleepFixed: sleepH >= 7,
    hungerTolerance: 'medium',
  };
}

/**
 * The longest fast while the user has never set one (PLANNER_V2_SPEC §3.7): it follows the opted-in fasting tier (T2 →
 * 48 h, T3 → 72 h; the expert tier is offered no further than the limit's 72 h), else 24 h, never above the effective cap
 * the safety answers allow when that cap is known and at least 24 h.
 */
export function defaultLongestFast(optedTier?: OptInTier | null, safetyMaxFastH?: number): LongestFast {
  const tierMax: LongestFast = optedTier === 'T3' || optedTier === 'T4' ? 72 : optedTier === 'T2' ? 48 : 24;
  if (safetyMaxFastH === undefined || !Number.isFinite(safetyMaxFastH) || safetyMaxFastH < 24) return tierMax;
  const fit = LONGEST_FAST_OPTIONS.filter((h) => h >= 24 && h <= Math.min(tierMax, safetyMaxFastH));
  return fit.length ? fit[fit.length - 1]! : 24;
}

/**
 * Stored overrides on top of the Habits defaults. `fasting` (the opted-in tier and the effective cap) sets the longest
 * fast until the user sets it themselves.
 */
export function effectiveConstraints(
  overrides: Partial<ConstraintDraft>,
  habits: HabitProfile | undefined,
  fasting?: { optedTier?: OptInTier | null; maxFastHours?: number },
): ConstraintDraft {
  const base = defaultConstraints(habits);
  if (fasting) base.longestFastH = defaultLongestFast(fasting.optedTier, fasting.maxFastHours);
  const out: ConstraintDraft = { ...base };
  for (const k of Object.keys(overrides) as Array<keyof ConstraintDraft>) {
    const v = overrides[k];
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Levers implied by the longest fast the user accepts (registry ids, dossier 13 §4C / 18 §4.4.1). */
export function fastExclusions(longest: LongestFast): string[] {
  if (longest < 24) return ['fastDay24', 'zeroDay', 'waterFast'];
  if (longest < 36) return ['zeroDay', 'waterFast'];
  if (longest < 48) return ['waterFast'];
  return [];
}

export function toPracticalConstraints(c: ConstraintDraft): PracticalConstraints {
  const excluded = new Set<string>([...c.excluded, ...fastExclusions(c.longestFastH)]);
  if (c.sleepFixed) excluded.add('L5');
  const weekdays = [...new Set(c.trainingWeekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b) as Weekday[];
  return {
    trainingDaysPerWeek: { min: Math.min(c.trainingDays[0], c.trainingDays[1]), max: Math.max(c.trainingDays[0], c.trainingDays[1]) },
    allowedTrainingWeekdays: weekdays,
    trainingTimeH: c.trainingTimeH,
    maxSessionMin: c.maxSessionMin,
    cardioDaysPerWeek: { min: Math.min(c.cardioDays[0], c.cardioDays[1]), max: Math.max(c.cardioDays[0], c.cardioDays[1]) },
    cardioModality: c.cardioModality,
    eatingWindow: { earliestH: c.earliestH, latestH: c.latestH },
    mealsPerDay: { min: c.mealsPerDay[0], max: c.mealsPerDay[1] },
    steps: { min: c.steps[0], max: c.steps[1] },
    excludedLevers: [...excluded].sort(),
    fasting: c.longestFastH < 24 ? 'none' : 'allowed',
    prefersFasting: c.prefersFasting,
    sleepFixed: c.sleepFixed,
    hungerTolerance: c.hungerTolerance,
    maxFastHours: c.longestFastH,
    ...(c.proteinFloor !== null ? { proteinFloorGPerKg: c.proteinFloor } : {}),
    ...(c.carbFloorG > 0 ? { carbFloorGPerDay: c.carbFloorG } : {}),
  };
}

/* ------------------------------------------------------------------------------------------------- goals */

/** One goal row → engine `RankedGoal` (rank = index in the list). */
export function toRankedGoal(g: GoalDraft, rankIndex: number): RankedGoal {
  const metric = goalMetric(g.metric);
  const spec = metric ? modeSpec(metric, g.mode) : null;
  const out: RankedGoal = { metric: g.metric, direction: spec?.direction ?? 'maximise' };
  if (spec) {
    if (spec.target === 'zero') {
      out.target = 0;
      out.targetKind = 'change';
    } else if (spec.target === 'change' && g.amount !== null) {
      out.target = spec.sign * Math.abs(g.amount);
      out.targetKind = 'change';
    } else if (spec.target === 'absolute' && g.amount !== null) {
      out.target = g.amount;
      out.targetKind = 'absolute';
    }
  }
  if (g.functional) out.functional = g.functional;
  const tol = toleranceFor(g.strength, rankIndex);
  if (tol !== undefined) out.tolerance = tol;
  return out;
}

/* ------------------------------------------------------------------------------------------------ safety */

/** The subset of `useSafetyAccess()` the request needs. */
export interface SafetySnapshot {
  outcome: Pick<ScreeningOutcome, 'plannerAccess' | 'mode' | 'restrictions' | 'plannerLocks' | 'fasting' | 'flags'>;
  plannerAccess: ScreeningOutcome['plannerAccess'];
  optedTier: OptInTier | null;
  shortWindowOn: boolean;
  /** Expert mode (T4) is available in this build (default: the app flag `EXPERT_MODE_AVAILABLE`, off). */
  expertModeAvailable?: boolean;
  /** The food chapter's supplement stance is "open": supplements with evidence (creatine) may be planned. */
  supplementsOpen?: boolean;
  /**
   * Per-row supplement answers (SUITE_SPEC §13.2, `supplementPlannerInputs`): levers consented (taking, have at home, or
   * the open stance's catalogue opt-in) and lever ids refused ("not for me"). When given, `supplementLevers` replaces
   * the `supplementsOpen` default; refusals join `constraints.excludedLevers` (the consent-refusal path the Ideal keeps).
   */
  supplementLevers?: readonly string[];
  supplementRefusals?: readonly string[];
}

type Lock = { id: string; value?: number; reasons?: ReadonlyArray<{ rule: string }> };

const FLOOR_LOCKS = new Set(['protein-floor', 'carb-floor', 'fat-floor', 'min-eating-window']);
const CAP_LOCKS = new Set(['deficit-cap', 'rate-cap', 'max-fast', 'protein-cap']);

/** Merge lock lists: one entry per id, the stricter value wins (max for floors, min for caps). */
export function mergeLocks(...lists: ReadonlyArray<ReadonlyArray<Lock>>): Lock[] {
  const byId = new Map<string, Lock>();
  for (const list of lists)
    for (const l of list) {
      const prev = byId.get(l.id);
      if (!prev) {
        byId.set(l.id, { id: l.id, ...(l.value !== undefined ? { value: l.value } : {}), reasons: [...(l.reasons ?? [])] });
        continue;
      }
      const reasons = [...(prev.reasons ?? []), ...(l.reasons ?? [])];
      let value = prev.value;
      if (l.value !== undefined) {
        if (value === undefined) value = l.value;
        else if (FLOOR_LOCKS.has(l.id)) value = Math.max(value, l.value);
        else if (CAP_LOCKS.has(l.id)) value = Math.min(value, l.value);
      }
      byId.set(l.id, { id: l.id, ...(value !== undefined ? { value } : {}), reasons });
    }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function toSafetyInput(s: SafetySnapshot): PlannerSafetyInput {
  const o = s.outcome;
  return {
    plannerAccess: s.plannerAccess,
    mode: o.mode,
    restrictions: [...o.restrictions],
    // screening locks only: the user's own limits are request constraints (maxFastHours, protein/carb floors)
    plannerLocks: mergeLocks(
      (o.plannerLocks as readonly PlannerLock[]).map((l) => ({ id: l.id, ...(l.value !== undefined ? { value: l.value } : {}), reasons: l.reasons.map((r) => ({ rule: r.rule })) })),
    ),
    fasting: {
      maxFastHours: o.fasting.maxFastHours,
      maxEligibleTier: o.fasting.maxEligibleTier,
      effectiveTier: o.fasting.effectiveTier,
      optInTiers: [...o.fasting.optInTiers],
      shortWindowAvailable: o.fasting.shortWindowAvailable,
    },
    flags: [...o.flags],
    // supplements are planned only with consent (QA LIV-13): the intake's "open to supplements" answer
    optIns: { fastingTier: s.optedTier, shortEatingWindow: s.shortWindowOn, levers: s.supplementLevers ? [...s.supplementLevers] : s.supplementsOpen ? ['creatine'] : [] },
    // T4 (3-7-day fasts) needs expert mode in the engine's tier compiler; it was never passed (PLAN item 8 decision 6).
    // Only set when on, so requests (and their hashes) without expert mode are unchanged.
    ...(expertModeOn(s.optedTier, s.expertModeAvailable) ? { expertMode: true } : {}),
  };
}

const MED_FLAGS = new Set(['diuretic', 'raas-blocker', 'other-antihypertensive', 'lithium', 'topiramate-zonisamide', 'corticosteroid', 'qt-prolonging', 'chemotherapy', 'antacid', 'anticoagulant', 'thyroid-hormone', 'other-medication']);

/** Screening flags (onboarding vocabulary) → engine `SafetyFlags` on the profile. */
export function profileSafetyFrom(flags: readonly string[], mode: SafetyMode, optedTier: OptInTier | null): { mode: SafetyMode; flags: SafetyFlags } {
  const f = new Set(flags);
  const out: SafetyFlags = {};
  if (f.has('pregnant')) out.pregnantOrBreastfeeding = true;
  if (f.has('planning-pregnancy')) out.planningPregnancy = true;
  if (f.has('ed-history') || f.has('scoff-risk')) out.eatingDisorderRisk = true;
  if (f.has('type-1-diabetes')) out.type1Diabetes = true;
  if (f.has('insulin')) out.diabetesMedication = 'insulin';
  else if (f.has('sulfonylurea')) out.diabetesMedication = 'sulfonylurea';
  else if (f.has('sglt2-inhibitor')) out.diabetesMedication = 'sglt2';
  else if (f.has('glp1')) out.diabetesMedication = 'glp1';
  else if (f.has('metformin')) out.diabetesMedication = 'metforminOnly';
  else if (f.has('diabetes-diet-only')) out.diabetesMedication = 'dietOnly';
  if (f.has('heart-condition') || f.has('high-blood-pressure') || f.has('stroke')) out.cardiovascularOrBp = true;
  if (f.has('kidney-disease')) out.kidneyDisease = true;
  if (f.has('liver-disease')) out.liverDisease = true;
  if (f.has('gout')) out.gout = true;
  if (f.has('kidney-stones')) out.kidneyStones = true;
  if (f.has('gallstones')) out.gallstones = true;
  if (f.has('pancreatitis')) out.pancreatitis = true;
  if (f.has('rare-metabolic')) out.fatOxidationDisorderOrPorphyria = true;
  if ([...f].some((x) => MED_FLAGS.has(x))) out.medicationInteraction = true;
  if (f.has('exercise-symptoms')) out.faintingOrChestPain = true;
  if (f.has('supervised-exercise-only') || f.has('musculoskeletal')) out.exerciseRestriction = true;
  if (f.has('heavy-alcohol')) out.heavyAlcoholUse = true;
  if (f.has('recent-illness')) out.acuteIllnessLast4Weeks = true;
  out.fastingOptIn = optedTier ?? 'none';
  return { mode, flags: out };
}

/* ----------------------------------------------------------------------------------------------- request */

export interface RequestInput {
  goals: readonly GoalDraft[];
  horizonDays: number;
  startDate: string;
  constraints: ConstraintDraft;
  strictness: Strictness;
  profile: PersonProfile;
  safety: SafetySnapshot;
}

/** The supplement fields of the safety snapshot from the stored section (v1 or v2); empty when unanswered. */
export function supplementSnapshot(raw: unknown): Pick<SafetySnapshot, 'supplementsOpen' | 'supplementLevers' | 'supplementRefusals'> {
  const section = toSectionV2(raw);
  if (!section) return {};
  const p = supplementPlannerInputs(section);
  return {
    ...(section.stance === 'open' ? { supplementsOpen: true } : {}),
    supplementLevers: p.optInLevers,
    ...(p.excludedLevers.length ? { supplementRefusals: p.excludedLevers } : {}),
  };
}

/** "Not for me" supplement levers join the excluded levers (sorted, once each); unchanged when there are none. */
export function withSupplementRefusals(c: PracticalConstraints, refused: readonly string[] | undefined): PracticalConstraints {
  if (!refused?.length) return c;
  return { ...c, excludedLevers: [...new Set([...(c.excludedLevers ?? []), ...refused])].sort() };
}

export function buildPlannerRequest(i: RequestInput): PlannerRequest {
  const profile: PersonProfile = {
    ...i.profile,
    startDate: i.startDate,
    safety: profileSafetyFrom(i.safety.outcome.flags, i.safety.outcome.mode, i.safety.optedTier),
  };
  return {
    profile,
    goals: i.goals.map(toRankedGoal),
    horizonDays: Math.round(i.horizonDays),
    startDate: i.startDate,
    constraints: withSupplementRefusals(toPracticalConstraints(i.constraints), i.safety.supplementRefusals),
    safety: toSafetyInput(i.safety),
    strictness: i.strictness,
  };
}

/* ---------------------------------------------------------------------------------------------------- hash */

/** Canonical JSON: sorted keys, no undefined, finite numbers only. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
    return v === undefined ? 'null' : JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** What changed between the request a result was found for and the current one (for the stale notice). */
export function staleReason(prev: PlannerRequest | null, next: PlannerRequest | null): 'body' | 'safety' | 'goals' {
  if (!prev || !next) return 'goals';
  const body = (r: PlannerRequest) => canonicalJson({ ...r.profile, startDate: undefined, safety: undefined });
  if (body(prev) !== body(next)) return 'body';
  if (canonicalJson([prev.safety, prev.profile.safety]) !== canonicalJson([next.safety, next.profile.safety])) return 'safety';
  return 'goals';
}

/** FNV-1a (32-bit) of the canonical request, hex. */
export function requestHash(req: PlannerRequest): string {
  const s = canonicalJson(req);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
