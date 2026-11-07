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
import { plannerHabitualActives } from '@/catalogues/supplements/planner';
import { baselineSchedule, type HabitualActiveExposure } from '@/engine/planner/domain/decode';
import { scenarioStartValues } from '@/engine/planner/domain/replan';
import type {
  PlannerRequest,
  PlannerRequestV2,
  PlannerSafetyInput,
  PracticalConstraints,
  RankedGoal,
  Strictness,
  Weekday,
} from '@/engine/planner/domain/types';
import type { TrainingProfile } from '@/catalogues/types';
import { compileRequest, labBaselineDomainIssue } from '@/engine/planner/domain/context';
import {
  LOCK_UNIT,
  expertModeOn,
  type ScreeningOutcome,
  type OptInTier,
  type PlannerLock,
  type PlannerLockId,
} from '@/features/onboarding/safetyRules';
import { LAB_LOCK_DEFS, type LabLockId } from '@/markers/types';
import {
  CONTRACT_VERSIONS,
  type ClinicianExerciseEnvelope,
  type ConstraintComparator,
  type ScreeningAnswer,
  type SymptomReport,
} from '@/lib/bodyContracts';
import { renalSafetyFlags, type RenalScope } from '@/lib/renalScope';
import type { SuggestionSafetyInput } from '@/lib/safetyPolicy';
import type { ConstraintDraft, GoalDraft, LongestFast } from '@/state/plannerStore';
import { resolveSavedGoal, toleranceFor } from './catalogue';

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
  const sleepH = h.habitualSleepDurationH ?? (((h.wakeTimeH ?? 7) - bed + 24) % 24 || 8);
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
  const weekdays = [...new Set(c.trainingWeekdays)]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b) as Weekday[];
  return {
    ...(c.maxMuscleLossPct !== undefined
      ? { muscleRetention: c.maxMuscleLossPct === null ? null : { maxLossPct: c.maxMuscleLossPct } }
      : {}),
    trainingDaysPerWeek: {
      min: Math.min(c.trainingDays[0], c.trainingDays[1]),
      max: Math.max(c.trainingDays[0], c.trainingDays[1]),
    },
    allowedTrainingWeekdays: weekdays,
    trainingTimeH: c.trainingTimeH,
    maxSessionMin: c.maxSessionMin,
    ...(c.maxCardioSessionMin != null ? { maxCardioSessionMin: c.maxCardioSessionMin } : {}),
    cardioDaysPerWeek: {
      min: Math.min(c.cardioDays[0], c.cardioDays[1]),
      max: Math.max(c.cardioDays[0], c.cardioDays[1]),
    },
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

/** Only limits the person actually changed, for starting a custom scenario without adding unrelated form defaults. */
export function explicitPracticalConstraints(c: Partial<ConstraintDraft>): PracticalConstraints {
  const all = toPracticalConstraints({ ...defaultConstraints(undefined), ...c });
  const sources: Partial<Record<keyof PracticalConstraints, readonly (keyof ConstraintDraft)[]>> = {
    muscleRetention: ['maxMuscleLossPct'], trainingDaysPerWeek: ['trainingDays'], allowedTrainingWeekdays: ['trainingWeekdays'],
    trainingTimeH: ['trainingTimeH'], maxSessionMin: ['maxSessionMin'], maxCardioSessionMin: ['maxCardioSessionMin'],
    cardioDaysPerWeek: ['cardioDays'], cardioModality: ['cardioModality'], eatingWindow: ['earliestH', 'latestH'],
    mealsPerDay: ['mealsPerDay'], steps: ['steps'], excludedLevers: ['excluded', 'longestFastH', 'sleepFixed'],
    fasting: ['longestFastH'], prefersFasting: ['prefersFasting'], sleepFixed: ['sleepFixed'], hungerTolerance: ['hungerTolerance'],
    maxFastHours: ['longestFastH'], proteinFloorGPerKg: ['proteinFloor'], carbFloorGPerDay: ['carbFloorG'],
  };
  return Object.fromEntries(Object.entries(all).filter(([key]) => sources[key as keyof PracticalConstraints]?.some((source) => Object.hasOwn(c, source)))) as PracticalConstraints;
}

/* ------------------------------------------------------------------------------------------------- goals */

/** One goal row → engine `RankedGoal` (rank = index in the list). */
export function toRankedGoal(g: GoalDraft, rankIndex: number): RankedGoal {
  const resolved = resolveSavedGoal(g);
  // Invalid saved intent remains an invalid target shape if a caller bypasses the runnable subset.
  const out: RankedGoal = resolved.goal ?? {
    metric: g.metric,
    direction: 'target',
    ...(g.endpointSemantics ? { endpointSemantics: { ...g.endpointSemantics } } : {}),
  };
  const tol = toleranceFor(g.strength, rankIndex);
  if (tol !== undefined) out.tolerance = tol;
  return out;
}

/* ------------------------------------------------------------------------------------------------ safety */

/** The subset of `useSafetyAccess()` the request needs. */
export interface SafetySnapshot {
  outcome: Pick<
    ScreeningOutcome,
    'plannerAccess' | 'mode' | 'restrictions' | 'plannerLocks' | 'fasting' | 'flags'
  > &
    Partial<Pick<ScreeningOutcome, 'renal'>>;
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
  /** (D7-04) observed active-ingredient exposure of the products the person takes (`plannerHabitualActives`). */
  habitualActives?: readonly HabitualActiveExposure[];
  /**
   * (C5/D7-03) Tri-state answers behind the screening flags (`screeningAnswerMap`): unknown / prefer not stay distinct
   * from a negative screen in the planner's gates and certificate. Absent = legacy (the flags alone).
   */
  answers?: Readonly<Partial<Record<string, ScreeningAnswer>>>;
  /** (D4-02) structured symptom reports and reviewed exercise envelopes, when the person entered them. */
  symptoms?: readonly SymptomReport[];
  exerciseEnvelopes?: readonly ClinicianExerciseEnvelope[];
  renal?: RenalScope;
}

type Lock = {
  id: string;
  value?: number;
  reasons?: ReadonlyArray<{ rule: string }>;
  /** D4-01: the unit as supplied (never inferred from the value's magnitude); kept when an input carries it. */
  unit?: string;
};

const FLOOR_LOCKS = new Set(['protein-floor', 'carb-floor', 'fat-floor', 'min-eating-window']);
const CAP_LOCKS = new Set(['deficit-cap', 'rate-cap', 'max-fast', 'protein-cap']);

/**
 * Comparator of a lock id (C5/D4-01): the typed lab definition when there is one, else the screening floors and caps,
 * else the id's own wording ("-cap" / "-floor"). Null = a lock without a numeric bound or an unknown comparator.
 */
export function lockComparator(id: string): ConstraintComparator | null {
  const lab = (LAB_LOCK_DEFS as Readonly<Record<string, { comparator: ConstraintComparator }>>)[id];
  if (lab) return lab.comparator;
  if (FLOOR_LOCKS.has(id) || /-floor$/.test(id) || /^min-/.test(id)) return 'floor';
  if (CAP_LOCKS.has(id) || /-cap$/.test(id) || /^max-/.test(id)) return 'cap';
  return null;
}

/**
 * Merge lock lists: one entry per id; caps keep the minimum and floors the maximum (C5: independent of order). A lock
 * whose comparator is unknown keeps the smaller value, so the result never depends on which list came first; reasons of
 * every input are kept.
 */
export function mergeLocks(...lists: ReadonlyArray<ReadonlyArray<Lock>>): Lock[] {
  const byId = new Map<string, Lock>();
  for (const list of lists)
    for (const l of list) {
      const prev = byId.get(l.id);
      if (!prev) {
        byId.set(l.id, {
          id: l.id,
          ...(l.value !== undefined ? { value: l.value } : {}),
          reasons: [...(l.reasons ?? [])],
          ...(l.unit ? { unit: l.unit } : {}),
        });
        continue;
      }
      const reasons = [...(prev.reasons ?? []), ...(l.reasons ?? [])];
      let value = prev.value;
      if (l.value !== undefined) {
        if (value === undefined) value = l.value;
        else value = lockComparator(l.id) === 'floor' ? Math.max(value, l.value) : Math.min(value, l.value);
      }
      const unit = prev.unit ?? l.unit;
      byId.set(l.id, {
        id: l.id,
        ...(value !== undefined ? { value } : {}),
        reasons,
        ...(unit ? { unit } : {}),
      });
    }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Screening lock units in the constraint contract's vocabulary (`CONSTRAINT_UNITS`), where the quantity has one. */
const SCREENING_CONSTRAINT_UNIT: Readonly<Partial<Record<PlannerLockId, string>>> = {
  'protein-floor': 'g/kg/d',
  'fat-floor': 'g/d',
  'min-eating-window': 'h',
};

/**
 * The unit a lock value is in (D4-01): explicit, from the typed definitions (the lab table's constraint units first, then
 * the screening floors in the same vocabulary, then the screening table's own wording), never from the magnitude.
 */
export function lockUnit(id: string): string | undefined {
  const lab = LAB_LOCK_DEFS[id as LabLockId];
  if (lab) return lab.unit;
  return SCREENING_CONSTRAINT_UNIT[id as PlannerLockId] ?? LOCK_UNIT[id as PlannerLockId];
}

export function toSafetyInput(s: SafetySnapshot): PlannerSafetyInput {
  const o = s.outcome;
  return {
    plannerAccess: s.plannerAccess,
    mode: o.mode,
    restrictions: [...o.restrictions],
    // screening locks only: the user's own limits are request constraints (maxFastHours, protein/carb floors)
    // D4-01: each screening lock carries its explicit unit and is mandatory (unsupported mandatory bounds block the
    // prescription in the planner, never a silent relaxation)
    plannerLocks: mergeLocks(
      (o.plannerLocks as readonly PlannerLock[]).map((l) => ({
        id: l.id,
        ...(l.value !== undefined ? { value: l.value } : {}),
        reasons: l.reasons.map((r) => ({ rule: r.rule })),
      })),
    ).map((l) => {
      const unit = l.value !== undefined ? (l.unit ?? lockUnit(l.id)) : undefined;
      return { ...l, ...(unit ? { unit } : {}), source: 'screening' as const, mandatory: true };
    }),
    fasting: {
      maxFastHours: o.fasting.maxFastHours,
      maxEligibleTier: o.fasting.maxEligibleTier,
      effectiveTier: o.fasting.effectiveTier,
      optInTiers: [...o.fasting.optInTiers],
      shortWindowAvailable: o.fasting.shortWindowAvailable,
    },
    flags: [...o.flags],
    // supplements are planned only with consent (QA LIV-13): the intake's "open to supplements" answer
    optIns: {
      fastingTier: s.optedTier,
      shortEatingWindow: s.shortWindowOn,
      levers: s.supplementLevers ? [...s.supplementLevers] : s.supplementsOpen ? ['creatine'] : [],
    },
    // T4 (3-7-day fasts) needs expert mode in the engine's tier compiler; it was never passed (PLAN item 8 decision 6).
    // Only set when on, so requests (and their hashes) without expert mode are unchanged.
    ...(expertModeOn(s.optedTier, s.expertModeAvailable) ? { expertMode: true } : {}),
  };
}

const MED_FLAGS = new Set([
  'diuretic',
  'raas-blocker',
  'other-antihypertensive',
  'lithium',
  'topiramate-zonisamide',
  'corticosteroid',
  'qt-prolonging',
  'chemotherapy',
  'antacid',
  'anticoagulant',
  'thyroid-hormone',
  'other-medication',
]);

/**
 * Screening flags (onboarding vocabulary) → engine `SafetyFlags` on the profile. `extra` carries the contract facts behind
 * the booleans when the caller has them (C5/D4-02/D7-03): the tri-state answers, symptom reports and reviewed exercise
 * envelopes. Absent fields are left out, so requests (and their hashes) without them are unchanged.
 */
export function profileSafetyFrom(
  flags: readonly string[],
  mode: SafetyMode,
  optedTier: OptInTier | null,
  extra: Pick<SafetySnapshot, 'answers' | 'symptoms' | 'exerciseEnvelopes' | 'renal'> = {},
): { mode: SafetyMode; flags: SafetyFlags } {
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
  if (f.has('heart-condition') || f.has('high-blood-pressure') || f.has('stroke'))
    out.cardiovascularOrBp = true;
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
  if (extra.answers && Object.keys(extra.answers).length) out.answers = { ...extra.answers };
  if (extra.symptoms?.length) out.symptoms = [...extra.symptoms];
  if (extra.exerciseEnvelopes?.length) out.exerciseEnvelopes = [...extra.exerciseEnvelopes];
  if (extra.renal) Object.assign(out, renalSafetyFlags(extra.renal));
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
  training?: TrainingProfile;
}

/**
 * The supplement fields of the safety snapshot from the stored section (v1 or v2); empty when unanswered. With the shared
 * suggestion-policy input (D7-03, `suggestionSafetyFrom`) a lever the person does not already take is opted in only when
 * the policy suggests it (allow or caution); without it, the legacy consent reading.
 */
export function supplementSnapshot(
  raw: unknown,
  policy?: SuggestionSafetyInput,
): Pick<SafetySnapshot, 'supplementsOpen' | 'supplementLevers' | 'supplementRefusals' | 'habitualActives'> {
  const section = toSectionV2(raw);
  if (!section) return {};
  const p = supplementPlannerInputs(section, policy);
  const habitualActives = plannerHabitualActives(p.habitualActives);
  return {
    ...(section.stance === 'open' ? { supplementsOpen: true } : {}),
    supplementLevers: p.optInLevers,
    ...(p.excludedLevers.length ? { supplementRefusals: p.excludedLevers } : {}),
    ...(habitualActives.length ? { habitualActives } : {}),
  };
}

/** "Not for me" supplement levers join the excluded levers (sorted, once each); unchanged when there are none. */
export function withSupplementRefusals(
  c: PracticalConstraints,
  refused: readonly string[] | undefined,
): PracticalConstraints {
  if (!refused?.length) return c;
  return { ...c, excludedLevers: [...new Set([...(c.excludedLevers ?? []), ...refused])].sort() };
}

/**
 * The goals the Planner can optimise (C6): eligible under the capability registry and, given the profile, not forecast
 * from a measured lab baseline outside the model's calibration domain (D7-02: the measurement stays exactly as entered,
 * its forecast is Unsupported, so it cannot be a goal; the other goals plan normally). A run needs at least one; the
 * screen gates Find plans on this, not on the raw list (a saved autophagy goal alone is information, not a goal, D2-02).
 */
export function plannableGoals<G extends GoalDraft>(
  goals: readonly G[],
  profile?: Pick<PersonProfile, 'labs' | 'labMeta' | 'medications'>,
): G[] {
  return goals.filter(
    (g) => resolveSavedGoal(g, profile).runnable && !(profile && labBaselineDomainIssue(profile, g.metric)),
  );
}

/** Why a goal's forecast is Unsupported for this profile (D7-02): its own measured baseline, or one it is forecast from. */
export function goalDomainIssue(
  profile: Pick<PersonProfile, 'labs' | 'labMeta'> | null | undefined,
  metric: string,
): 'own' | 'dependency' | null {
  return profile ? labBaselineDomainIssue(profile, metric) : null;
}

export function buildPlannerRequest(i: RequestInput): PlannerRequestV2 {
  const profile: PersonProfile = {
    ...i.profile,
    startDate: i.startDate,
    safety: profileSafetyFrom(i.safety.outcome.flags, i.safety.outcome.mode, i.safety.optedTier, {
      ...i.safety,
      renal: i.safety.outcome.renal ?? i.safety.renal,
    }),
  };
  // C6/D2-02: only goals the capability registry allows are optimised; a saved goal on a metric that can no longer be a
  // goal (the autophagy index) stays in the list as information and never reaches the planner; nor does a goal whose
  // forecast is unsupported by an out-of-domain measured lab baseline (D7-02, shown as Unsupported on the goal row).
  // Ranks follow the goals that remain; each carries the capability version it was validated under.
  const goals = plannableGoals(i.goals, profile).map((g, rank) => ({
    ...resolveSavedGoal(g).goal!,
    ...(() => {
      const tolerance = toleranceFor(g.strength, rank);
      return tolerance === undefined ? {} : { tolerance };
    })(),
    capabilityVersion: CONTRACT_VERSIONS.goalCapability,
  }));
  const request: PlannerRequestV2 = {
    profile,
    goals,
    horizonDays: Math.round(i.horizonDays),
    startDate: i.startDate,
    constraints: withSupplementRefusals(toPracticalConstraints(i.constraints), i.safety.supplementRefusals),
    safety: toSafetyInput(i.safety),
    strictness: i.strictness,
    ...(i.training ? { training: i.training } : {}),
    // D7-04: observed habitual actives enter the request (and so its hash) only when there are any
    ...(i.safety.habitualActives?.length ? { habitualActives: i.safety.habitualActives } : {}),
  };
  if (
    goals.some((g) => g.targetKind === 'change' && ['sbp', 'glucose', 'fastingGlucose'].includes(g.metric))
  ) {
    try {
      // Preview only: use this new subject's actual initial operator. Keep the original delta so final scenario
      // adoption can freeze it again against the final scenario start rather than this preview's baseline.
      const baseline = baselineSchedule({ ...compileRequest({ ...request, goals: [] }), horizonDays: 1 });
      const initial = scenarioStartValues(baseline, request);
      request.goals = goals.map((g, k) => {
        const value = initial.get(k);
        return g.targetKind === 'change' &&
          ['sbp', 'glucose', 'fastingGlucose'].includes(g.metric) &&
          g.target !== undefined &&
          value !== undefined &&
          Number.isFinite(value)
          ? { ...g, targetOrigin: { kind: 'change', delta: g.target, baseline: value } }
          : g;
      });
    } catch {
      /* A missing compatible initial operator stays Review; never supply a population target. */
    }
  }
  return request;
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
export function staleReason(
  prev: PlannerRequest | null,
  next: PlannerRequest | null,
): 'body' | 'safety' | 'goals' {
  if (!prev || !next) return 'goals';
  const body = (r: PlannerRequest) =>
    canonicalJson({ ...r.profile, startDate: undefined, safety: undefined });
  if (body(prev) !== body(next)) return 'body';
  if (canonicalJson([prev.safety, prev.profile.safety]) !== canonicalJson([next.safety, next.profile.safety]))
    return 'safety';
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
