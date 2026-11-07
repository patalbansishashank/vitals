/**
 * Request compilation (dossier 18 §2 `ctx = compile(request)`): resolved profile, dossier-17 caps, practical
 * constraints with defaults, goal definitions and goal classes. Built identically on the coordinator and in every
 * evaluator worker from the same `PlannerRequest`, so all sides agree on the structure list and genome layouts.
 */
import { resolveProfile } from '../../core/resolveProfile';
import { freezeMuscleRetention, muscleRetentionProblems } from './muscleRetention';
import { cardiometabolicObservedAnchors } from '../../model/cardiometabolic/constants';
import {
  GOAL_CAPABILITY,
  SERIES,
  SERIES_INDEX,
  type MetricId,
  type SeriesDef,
  type SeriesId,
} from '../../types/metrics';
import type { LabBaselines, MedicationChange, PersonProfile, ResolvedProfile } from '../../types/profile';
import type { CardioModality } from '../../types/schedule';
import { HC, compileSafetyCaps, type SafetyCaps } from './safety';
import type { GoalDirection, PlannerRequest, RankedGoal } from './types';
import { allowedModalities, idealGeneFlags, idealSleepEnvelope, type IdealGeneFlags } from './ideal';
import { compileDisabledGates, gateOn } from './gates';
import { servesFasting } from './evidenceGraph';
import {
  goalResolutionText,
  resolveObjectiveShape,
  resolveGoalCapability,
  type GoalCapabilityResolution,
} from './capabilities';
import type { HabitualActiveExposure } from './decode';

export const HORIZON_MIN_DAYS = 28;
export const HORIZON_MAX_DAYS = 183;
export const MAX_GOALS = 6;

/**
 * Goal classes a fast can serve (ruling R-FAST-GATE; 20 §4C): transient markers, fat loss as a deficit-delivery pattern,
 * glycaemia and triglycerides / blood pressure through the deficit, and the hunger burden. Whether a fast actually helps
 * is left to the optimiser. A goal outside these classes is served too when the evidence graph credits a zero-intake
 * mechanism to it (`fastingServes`; owner ruling 2026-10-01: LDL down, glycogen down); a metric without an optimizable
 * capability earns no fasting credit (C6).
 */
export const FASTING_SERVED: ReadonlySet<GoalClass> = new Set<GoalClass>([
  'transient',
  'fatLoss',
  'glycaemia',
  'tgBp',
  'comfort',
]);
/** 18 §4.9 hunger tolerance → h_tol on the normalised [0,1] hunger index (UNVERIFIED placeholders). */
export const HUNGER_TOLERANCE = { low: 0.4, medium: 0.55, high: 0.7 } as const;

/**
 * Minimum spacing between planned meals, h (18 §4.4.4 step 7 "meals fit the window at ≥ minimum spacing"; 08 §4.15:
 * protein in ≥ 3 feedings spaced ≥ 3 h; QA item 9: no 4 meals in a 6-hour window).
 */
export const MIN_MEAL_SPACING_H = 3;
/** 21 §4J L19: last meal ≥ 3 h before bed (default lever; shift workers exempt). */
export const LATE_EATING_GAP_H = 3;

export interface ResolvedPractical {
  rtDays: { min: number; max: number };
  allowedTrainingWeekdays: number[];
  trainingTimeH: number;
  maxSessionMin: number;
  maxCardioSessionMin: number;
  cardioDays: { min: number; max: number };
  cardioModality: CardioModality;
  earliestH: number;
  latestH: number;
  meals: { min: number; max: number };
  steps: { min: number; max: number };
  excluded: ReadonlySet<string>;
  fastingRefused: boolean;
  prefersFasting: boolean;
  sleepFixed: boolean;
  hTol: number;
  bedH: number;
  wakeH: number;
  habitualSleepH: number;
  /** Ideal-only genes of this request (PLANNER_V2_SPEC §2.2, `ideal.ts`); all false for an ordinary request. */
  idealGenes: IdealGeneFlags;
  /** Cardio modalities the safety caps allow, in the order of the Ideal's `cardio.modality` gene (HC-X4/X5). */
  idealModalities: CardioModality[];
}

export type GoalClass =
  | 'fatLoss'
  | 'muscle'
  | 'transient'
  | 'lipids'
  | 'tgBp'
  | 'glycaemia'
  | 'endurance'
  | 'comfort'
  | 'expenditure'
  | 'weightGain'
  | 'other';

export interface ResolvedGoal {
  index: number;
  spec: RankedGoal;
  metric: MetricId;
  def: SeriesDef;
  direction: GoalDirection;
  functional: 'end' | 'mean';
  /** Scale weight is displayed, never optimised: the functional reads tissue mass (18 §4.5 rule 1). */
  useTissueMass: boolean;
  classes: GoalClass[];
  /** Start value estimated from the profile (classification only; the real y(0) comes from the baseline run). */
  startEstimate: number;
}

export interface PlanningContext {
  request: PlannerRequest;
  rp: ResolvedProfile;
  caps: SafetyCaps;
  horizonDays: number;
  startDate: string;
  startWeekday: number;
  practical: ResolvedPractical;
  goals: ResolvedGoal[];
  /** Classes present, with the best (smallest) rank of each. */
  classRank: Partial<Record<GoalClass, number>>;
  /** Zero-intake levers are considered only when this is true (ruling R-FAST-GATE, `compileRequest`). */
  fastingRelevant: boolean;
  /** Why fasting levers were or were not offered (plain language, for explanations; ruling 18:10). */
  fastingReason: string;
  /** Index of the goal fasting would serve (ruling R-FAST-GATE `servedGoal`), or null. */
  fastingServedGoal: number | null;
  /** Validation problems of the request (empty = valid). */
  problems: string[];
  /** Gates switched off for this context (coverage audit only, `gates.ts`; safety gates stay on outside the audit). */
  disabledGates?: ReadonlySet<string>;
  /**
   * C6: goals of the request that do not plan, with their capability resolution (a saved/imported goal on a metric that
   * lost its objective is `pendingReview` with alternatives and what stays tracked; never remapped, never dropped silently).
   */
  goalReviews?: readonly GoalCapabilityResolution[];
  /**
   * D7-04: active ingredients the person already takes (observed chronology): part of the baseline, continued by a plan only
   * as allowed, never added again. Absent = none known.
   */
  habitualActives?: readonly HabitualActiveExposure[];
}

const clampNum = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function isoWeekday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const TIME_INTEGRATED = new Set<string>([
  'bhb',
  'hoursInKetosis',
  'autophagyIdx',
  'glucose',
  'hunger',
  'insulin',
]);

function startEstimate(rp: ResolvedProfile, id: MetricId): number {
  switch (id) {
    case 'scaleWeight':
      return rp.weightKg;
    case 'fatMass':
      return rp.fm0Kg;
    case 'bodyFatPct':
      return rp.body.bodyFatPct;
    case 'waist':
      return rp.input.body.waistCm ?? rp.body.circumferences.waistCm;
    case 'leanTissue':
    case 'leanMass':
      return rp.ffm0Kg;
    case 'skeletalMuscle':
      return rp.body.skeletalMuscleKg;
    case 'visceralFat':
      return rp.body.fat.vatKg;
    default:
      return NaN;
  }
}

function classify(id: MetricId, dir: GoalDirection, target: number | undefined, start: number): GoalClass[] {
  // effective sense for target goals (down if the target lies below the start estimate)
  const down =
    dir === 'minimise' ||
    (dir === 'target' && target !== undefined && Number.isFinite(start) && target < start);
  const up =
    dir === 'maximise' ||
    (dir === 'target' && target !== undefined && Number.isFinite(start) && target > start);
  switch (id) {
    case 'fatMass':
    case 'bodyFatPct':
    case 'waist':
    case 'visceralFat':
    case 'liverFat':
      return down ? ['fatLoss'] : up ? ['weightGain'] : ['other'];
    case 'scaleWeight':
      return down ? ['fatLoss'] : up ? ['weightGain', 'muscle'] : ['other'];
    case 'leanTissue':
    case 'skeletalMuscle':
    case 'rtMuscleGain':
    case 'strength':
      return up ? ['muscle'] : ['other'];
    // C6: IGF-1, the keto-adaptation states, the adherence index and the generic endurance index never compile as goals
    // (`resolveGoalCapability`), so no class routes them (D2-06, D2-07, D2-08, D8-09)
    case 'bhb':
    case 'hoursInKetosis':
      return ['transient'];
    case 'ldl':
    case 'apoB':
      return ['lipids'];
    case 'triglycerides':
    case 'sbp':
      return ['tgBp', 'fatLoss'];
    case 'insulinSensitivity':
    case 'fastingGlucose':
    case 'glucose':
    case 'crp':
      return ['glycaemia', 'fatLoss'];
    case 'vo2max':
    case 'glycogenTotal':
    case 'muscleGlycogen':
      return ['endurance'];
    case 'hunger':
    case 'ketoInduction':
      return ['comfort'];
    case 'tdee':
    case 'rmr':
    case 'metabolicAdaptation':
      return ['expenditure'];
    default:
      return ['other'];
  }
}

function resolvePractical(
  req: PlannerRequest,
  rp: ResolvedProfile,
  caps: SafetyCaps,
  gates?: { disabledGates?: ReadonlySet<string> },
): ResolvedPractical {
  const c = req.constraints ?? {};
  const allowed = (c.allowedTrainingWeekdays ?? [0, 1, 2, 3, 4, 5, 6])
    .filter((d) => d >= 0 && d <= 6)
    .map((d) => Math.floor(d));
  const uniq = [...new Set(allowed)].sort((a, b) => a - b);
  let rtMax = c.trainingDaysPerWeek?.max ?? 4;
  let rtMin = c.trainingDaysPerWeek?.min ?? 0;
  // ≥ 1 full rest day per week (17 §2.5 exercise.rest_days_per_week_min) and novice 2-3 d/wk (HC-X2)
  rtMax = Math.min(rtMax, uniq.length, 6, caps.rtNovice && gateOn(gates, 'rt.noviceCap') ? 3 : 6);
  if (!caps.exercise.allowed || !caps.exercise.rtAllowed) rtMax = 0;
  rtMin = clampNum(rtMin, 0, rtMax);
  let cMax = c.cardioDaysPerWeek?.max ?? 3;
  let cMin = c.cardioDaysPerWeek?.min ?? 0;
  cMax = Math.min(cMax, uniq.length, 6);
  if (!caps.exercise.allowed || !caps.exercise.cardioAllowed) cMax = 0;
  cMin = clampNum(cMin, 0, cMax);
  let modality: CardioModality =
    c.cardioModality ?? (rp.habits.trainingHistory === 'none' ? 'walk' : 'cycle');
  // HC-X4 (light-moderate only, low impact) and HC-X5 (hot climate: no vigorous outdoor sessions): no running, no HIIT
  if (
    (caps.exercise.lowImpact || caps.exercise.lightModerateOnly || caps.exercise.noVigorousOutdoor) &&
    modality === 'run'
  )
    modality = 'walk';
  if (modality === 'hiit' && (caps.exercise.lightModerateOnly || caps.exercise.noVigorousOutdoor))
    modality = 'cycle';

  const bedH = rp.habits.bedTimeH;
  const wakeH = rp.habits.wakeTimeH;
  const habitualSleepH = rp.habits.habitualSleepDurationH ?? ((wakeH - bedH + 24) % 24 || 24);
  let earliest = c.eatingWindow?.earliestH ?? 7;
  let latest = c.eatingWindow?.latestH ?? 21;
  earliest = clampNum(earliest, 0, 23);
  latest = clampNum(latest, earliest, 23.5);
  // L19: last meal ≥ 3 h before bed (bed after midnight counts as bed + 24); with the Ideal's sleep genes, against the
  // latest bed they allow (the decoder narrows the window to the decoded night)
  const idealGenes = idealGeneFlags(req);
  const bedClock = idealGenes.sleep
    ? idealSleepEnvelope(bedH, wakeH).latestBedClock
    : bedH < 12
      ? bedH + 24
      : bedH;
  const l19Latest = bedClock - LATE_EATING_GAP_H;
  if (l19Latest - earliest >= caps.minWindowH) latest = Math.min(latest, l19Latest);
  if (latest - earliest < caps.minWindowH) {
    // the safety minimum window wins over the user's window: widen symmetrically inside the day
    const mid = (earliest + latest) / 2;
    earliest = clampNum(mid - caps.minWindowH / 2, 0, 23.5 - caps.minWindowH);
    latest = earliest + caps.minWindowH;
  }
  const mealsMin = Math.max(2, Math.floor(c.mealsPerDay?.min ?? 2));
  const mealsMax = Math.max(mealsMin, Math.floor(c.mealsPerDay?.max ?? 4));
  const habSteps = rp.habits.typicalSteps;
  let stepsMin = c.steps?.min ?? clampNum(habSteps, 3000, 15000);
  let stepsMax = Math.max(stepsMin, c.steps?.max ?? Math.max(12000, stepsMin));
  // D4-02: under the symptom gate / an envelope's ceiling no step progression above the documented baseline (or the
  // envelope's ceiling): the 3 000 / 12 000 defaults never clamp upward and the Ideal's relaxation cannot lift it
  const ceil = caps.exercise.stepsCeiling;
  if (ceil !== null) {
    stepsMax = Math.min(stepsMax, ceil);
    stepsMin = Math.min(stepsMin, stepsMax);
    if (!caps.exercise.stepsBaselineDocumented) stepsMin = stepsMax;
  }
  const hTol = HUNGER_TOLERANCE[c.hungerTolerance ?? 'medium'];
  const maxSessionMin = clampNum(c.maxSessionMin ?? 90, 20, 180);
  return {
    rtDays: { min: rtMin, max: rtMax },
    allowedTrainingWeekdays: uniq,
    trainingTimeH: clampNum(c.trainingTimeH ?? 18, 5, 22),
    maxSessionMin,
    maxCardioSessionMin: Math.min(maxSessionMin, clampNum(c.maxCardioSessionMin ?? 90, 5, 90)),
    cardioDays: { min: cMin, max: cMax },
    cardioModality: modality,
    earliestH: earliest,
    latestH: latest,
    meals: { min: mealsMin, max: mealsMax },
    steps: { min: stepsMin, max: stepsMax },
    excluded: new Set(c.excludedLevers ?? []),
    fastingRefused: c.fasting === 'none',
    prefersFasting: !!c.prefersFasting,
    // the Ideal's sleep genes replace the fixed sleep (and the sleep-extension lever)
    sleepFixed: idealGenes.sleep ? false : (c.sleepFixed ?? habitualSleepH >= 7),
    hTol,
    bedH,
    wakeH,
    habitualSleepH,
    idealGenes,
    idealModalities: allowedModalities(caps),
  };
}

/** Effective sense of a goal: `up` = wants the metric higher (a target above the start estimate counts), else `down`. */
function goalSense(g: Pick<ResolvedGoal, 'direction' | 'spec' | 'startEstimate'>): 'up' | 'down' | null {
  if (g.direction === 'maximise') return 'up';
  if (g.direction === 'minimise') return 'down';
  const t = g.spec.target;
  if (t === undefined || !Number.isFinite(t)) return null;
  if (g.spec.targetKind === 'change') return t > 0 ? 'up' : t < 0 ? 'down' : null;
  if (!Number.isFinite(g.startEstimate)) return null;
  const target = t;
  return target > g.startEstimate ? 'up' : target < g.startEstimate ? 'down' : null;
}

/**
 * Whether a fast can serve this goal (PLANNER_V2_SPEC §3.1; owner ruling 2026-10-01 "fasts appear exactly when they
 * help"): its class is in `FASTING_SERVED`, or the evidence graph attaches a zero-intake mechanism whose sign credits the
 * goal's direction (sign 0, "either way", counts). The union keeps the class-only pairs (hunger burden, keto-induction
 * symptoms, lower ketones) offered; the audit records them as known divergences. A metric without an optimizable
 * capability (adherence index, IGF-1, keto adaptation; C6) never compiles as a goal, so it never reaches the gate. The
 * optimiser rejects a fast that brings no gain.
 */
export function fastingServes(
  g: Pick<ResolvedGoal, 'metric' | 'classes' | 'direction' | 'spec' | 'startEstimate'>,
): boolean {
  if (g.classes.some((c) => FASTING_SERVED.has(c))) return true;
  const sense = goalSense(g);
  return sense !== null && servesFasting(g.metric, sense);
}

/** Outcome of the fasting gate (ruling R-FAST-GATE; PLANNER_V2_SPEC §3.1). */
export interface FastingGate {
  offered: boolean;
  /** Plain-language reason, completing "Fasting was considered because …" / "Fasting was not considered: …". */
  reason: string;
  /** The goal fasting would serve (index), or null. */
  servedGoal: number | null;
}

/**
 * The fasting gate (ruling R-FAST-GATE, 2026-10-01; PLANNER_V2_SPEC §3.1). It replaces the reading "a transient marker
 * above lean mass, never with a muscle goal in the top two", which no dossier states. Zero-intake levers enter the
 * structure set when
 *   - fasting is not refused and the effective longest fast (tier cap ∩ the user's longest fast ∩ locks) is ≥ 24 h,
 *   - a fasting tier is held — the default 24-h tier counts (no consent needed unless the screening excludes it), so a
 *     transient-marker-first user without an opt-in keeps the 24-h fasts; opt-ins only widen which fasts (48-72 h,
 *     zero days) the grammar builds,
 *   - a goal exists that fasting can serve (`fastingServes`: the classes of `FASTING_SERVED` — transient markers, fat loss
 *     as a deficit-delivery pattern, glycaemia, triglycerides / blood pressure and the hunger burden — or a goal the
 *     evidence graph credits to a zero-intake mechanism, e.g. LDL down, glycogen down; with "I prefer fasting" the
 *     top-ranked goal of any class, 20 §4C allows the person's preference as a reason), and
 *   - no muscle goal ranks above that goal.
 * Offered is not used: the optimiser keeps a fast only where it helps the ranked goals (at equal weekly energy a fast
 * gives the same fat loss, a lean cost and higher hunger peaks, so fat-loss-first plans keep the no-fast result by search
 * and the explanation says why).
 */
export function fastingGate(
  goals: readonly ResolvedGoal[],
  classRank: Partial<Record<GoalClass, number>>,
  practical: Pick<ResolvedPractical, 'fastingRefused' | 'prefersFasting'>,
  caps: Pick<SafetyCaps, 'fastTierAllowed' | 'maxFastH' | 'fastingLimitReason' | 'fastingOptIn'>,
  gates?: { disabledGates?: ReadonlySet<string> },
): FastingGate {
  const label = (g: ResolvedGoal) =>
    `goal ${g.index + 1} (${g.def.label.length > 1 && g.def.label[1] === g.def.label[1]!.toLowerCase() ? g.def.label.charAt(0).toLowerCase() + g.def.label.slice(1) : g.def.label})`;
  const served =
    practical.prefersFasting || !gateOn(gates, 'fasting.servedGoal')
      ? goals[0]
      : goals.find((g) => fastingServes(g));
  const servedGoal = served ? served.index : null;
  const tierHeld =
    caps.fastTierAllowed.T1 || caps.fastTierAllowed.T2 || caps.fastTierAllowed.T3 || caps.fastTierAllowed.T4;
  // the shortest fast the fasting structures use is a 24-h fast (17 HC-F1 T1 upper bound, meal to meal)
  const longEnough = tierHeld && caps.maxFastH >= HC.tierMaxH.T1 - 1e-6;
  const muscleRank = classRank.muscle ?? Infinity;
  if (!longEnough && gateOn(gates, 'fasting.longestFast'))
    return { offered: false, reason: caps.fastingLimitReason, servedGoal };
  if (practical.fastingRefused && gateOn(gates, 'fasting.refused'))
    return { offered: false, reason: 'you ruled out fasting', servedGoal };
  if (!served) return { offered: false, reason: 'none of your goals gains from fasting', servedGoal };
  if (muscleRank < served.index && gateOn(gates, 'fasting.muscleAbove')) {
    const m = goals.find((g) => g.index === muscleRank)!;
    return {
      offered: false,
      reason: `${label(m)} ranks above ${label(served)}, and long gaps without protein slow muscle gain`,
      servedGoal,
    };
  }
  const why = practical.prefersFasting
    ? 'you said you prefer fasting as a way to eat'
    : `it can serve ${label(served)}`;
  const ceiling =
    caps.maxFastH <= HC.tierMaxH.T1 + 1e-6 && caps.fastingOptIn === null
      ? '; without an opt-in in your safety settings only 24-hour fasts are used'
      : '';
  return { offered: true, reason: `${why}${ceiling}`, servedGoal };
}

/**
 * Metrics whose goal capability says there is no health objective (C6/D2-02): the legacy autophagy research index and the
 * mTOR / AMPK signalling indices. Their mechanism stays educational; they never earn objective or fasting credit.
 */
export const NON_HEALTH_OBJECTIVE: ReadonlySet<string> = new Set(
  (Object.keys(GOAL_CAPABILITY) as MetricId[]).filter(
    (m) => GOAL_CAPABILITY[m].reasonCode === 'noHealthObjective',
  ),
);

/** Goal metric → the measured lab baseline that anchors its forecast (D7-02). */
export const GOAL_LAB_BASELINE: Readonly<Partial<Record<MetricId, keyof LabBaselines>>> = {
  ldl: 'ldlMmolL',
  apoB: 'apoBgL',
  hdl: 'hdlMmolL',
  triglycerides: 'tgMmolL',
  fastingGlucose: 'fastingGlucoseMmolL',
  sbp: 'sbpMmHg',
  liverFat: 'liverFatPct',
  crp: 'crpMgL',
  testosterone: 'testosteroneNmolL',
  igf1: 'igf1NgMl',
  leptin: 'leptinNgMl',
  vo2max: 'vo2maxMlKgMin',
};

/**
 * Why a goal's forecast is unsupported by a measured lab baseline outside the model's calibration domain (D7-02): `own`
 * when its own baseline is outside (the provenance flag `PersonProfile.labMeta`, or the engine's domain check of the
 * accepted baselines, `cardiometabolicObservedAnchors` — the rule the run applies to its series status), `dependency`
 * when it is forecast from another out-of-domain baseline (ApoB from LDL/TG), else null. The measurement is kept exactly;
 * only the numeric forecast is unsupported. A generated prior is not a measurement; unknown provenance alone is not out
 * of domain.
 */
export function labBaselineDomainIssue(
  profile: Pick<PersonProfile, 'labs' | 'labMeta'>,
  metric: string,
): 'own' | 'dependency' | null {
  const key = GOAL_LAB_BASELINE[metric as MetricId];
  const v = key ? profile.labs?.[key] : undefined;
  if (key && typeof v === 'number' && Number.isFinite(v) && profile.labMeta?.[key]?.outOfDomain === true)
    return 'own';
  if (!profile.labs) return null;
  let measured: LabBaselines = profile.labs;
  const meta = profile.labMeta;
  if (meta) {
    const generated = (Object.keys(meta) as (keyof LabBaselines)[]).filter(
      (k) => meta[k]?.source === 'generated',
    );
    if (generated.length) {
      measured = { ...profile.labs };
      for (const k of generated) delete measured[k];
    }
  }
  const st = cardiometabolicObservedAnchors(measured).outputStatus[metric as SeriesId];
  if (st?.status !== 'outOfDomain') return null;
  return st.reasonCode === 'dependsOnOutOfDomainBaseline' ? 'dependency' : 'own';
}

/** Whether a goal's forecast is unsupported by an out-of-domain measured baseline (`labBaselineDomainIssue`). */
export function labBaselineOutsideDomain(
  profile: Pick<PersonProfile, 'labs' | 'labMeta'>,
  metric: string,
): boolean {
  return labBaselineDomainIssue(profile, metric) !== null;
}

/** Medication classes whose start, stop or dose change segments a glycaemic baseline (D7-09; no dose advice is derived). */
export const GLYCAEMIC_MEDICATION_CLASSES: ReadonlySet<MedicationChange['medicationClass']> = new Set([
  'insulin',
  'sulfonylurea',
  'sglt2',
  'glp1',
  'metformin',
]);
/** Goals whose forecast a glycaemic medication change makes unattributable (D7-09). */
export const GLYCAEMIC_GOALS: ReadonlySet<string> = new Set([
  'fastingGlucose',
  'glucose',
  'insulinSensitivity',
]);
/** Minimum calorie-free hours of an eligible fasting-glucose sample under the adopted ADA policy (D7-09; an existing guideline value). */
export const FASTING_SAMPLE_MIN_H = 8;

/**
 * Why a lab-anchored goal cannot be planned for this profile, beyond the calibration domain (`labBaselineDomainIssue`):
 *  - `stale` (D7-05): the baseline's freshness window expired — quantitative baseline use stops; the reading, a needed
 *    repeat and any unresolved review stay where they are (markers), never erased by expiry;
 *  - `nonFastingSample` (D7-09): the fasting-glucose baseline was explicitly non-fasting (or under 8 h without calories):
 *    its value stays observed, but it is not a fasting sample to forecast fasting glucose from; an unknown fasting status
 *    is not assumed eligible for classification and stays a labelled scenario here;
 *  - `medicationChange` (D7-09): a glucose-lowering medication started, stopped or changed on or after the baseline sample
 *    (or with no dated sample): the treatment change segments the baseline, so the plan cannot claim causal credit or
 *    target achievement for a glycaemic goal.
 * Null when the goal plans normally. The measurement is never altered.
 */
export function labBaselineForecastIssue(
  profile: Pick<PersonProfile, 'labs' | 'labMeta' | 'medications'>,
  metric: string,
): { issue: 'own' | 'dependency' | 'stale' | 'nonFastingSample' | 'medicationChange'; date?: string } | null {
  const domain = labBaselineDomainIssue(profile, metric);
  if (domain) return { issue: domain };
  const key = GOAL_LAB_BASELINE[metric as MetricId];
  const meta = key ? profile.labMeta?.[key] : undefined;
  if (meta?.freshness === 'expired')
    return { issue: 'stale', ...(meta.measuredOn ? { date: meta.measuredOn } : {}) };
  if (
    metric === 'fastingGlucose' &&
    meta &&
    (meta.fastingStatus === 'nonFasting' ||
      (typeof meta.fastingHours === 'number' && meta.fastingHours < FASTING_SAMPLE_MIN_H))
  )
    return { issue: 'nonFastingSample' };
  if (GLYCAEMIC_GOALS.has(metric)) {
    const sampled = profile.labMeta?.fastingGlucoseMmolL?.measuredOn ?? profile.labMeta?.hba1cPct?.measuredOn;
    const change = (profile.medications ?? [])
      .filter(
        (m) =>
          GLYCAEMIC_MEDICATION_CLASSES.has(m.medicationClass) && (sampled === undefined || m.date >= sampled),
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    if (change) return { issue: 'medicationChange', date: change.date };
  }
  return null;
}

/** Plain short problem text of a lab-anchored goal that cannot be planned (`labBaselineForecastIssue`). */
function labIssueText(label: string, f: NonNullable<ReturnType<typeof labBaselineForecastIssue>>): string {
  switch (f.issue) {
    case 'own':
      return `"${label}": your measured value is outside the range the model supports, so it cannot be planned as a goal.`;
    case 'dependency':
      return `"${label}": a measured value it is forecast from is outside the range the model supports, so it cannot be planned as a goal.`;
    case 'stale':
      return `"${label}": the measured baseline${f.date ? ` from ${f.date}` : ''} is out of date (Repeat due), so it cannot be planned as a goal.`;
    case 'nonFastingSample':
      return `"${label}": the glucose reading was not a fasting sample, so it cannot be planned as a goal.`;
    case 'medicationChange':
      return `"${label}": a glucose-lowering medication changed${f.date ? ` on ${f.date}` : ''}; changes cannot be credited to the plan, so it cannot be planned as a goal.`;
  }
}

/** Compile a request (pure, deterministic). */
export function compileRequest(request: PlannerRequest): PlanningContext {
  const problems: string[] = [];
  const startDate = request.startDate ?? request.profile.startDate ?? '2026-01-05';
  const profile = { ...request.profile, startDate };
  const rp = resolveProfile(profile);
  request = freezeMuscleRetention(request, rp.body.skeletalMuscleKg);
  problems.push(...muscleRetentionProblems(request.constraints?.muscleRetention));
  const caps = compileSafetyCaps(rp, request.safety, request.constraints);
  const horizonDays = Math.round(request.horizonDays);
  if (!(horizonDays >= HORIZON_MIN_DAYS && horizonDays <= HORIZON_MAX_DAYS))
    problems.push(`The horizon must be between ${HORIZON_MIN_DAYS} and ${HORIZON_MAX_DAYS} days.`);
  if (request.goals.length < 1 || request.goals.length > MAX_GOALS)
    problems.push(`Rank between 1 and ${MAX_GOALS} goals.`);
  // the safety caps read BMI and body fat (deficit and rate caps, the body-fat floor): a measure that is not a number
  // would switch those protections off silently, so the request is invalid instead
  const finitePos = (v: number) => Number.isFinite(v) && v > 0;
  if (!finitePos(rp.weightKg) || !finitePos(rp.heightM) || !finitePos(rp.body.bodyFatPct))
    problems.push(
      'Your height, weight and body fat estimate must be numbers to plan; please check your profile.',
    );
  const disabledGates = compileDisabledGates();
  const practical = resolvePractical(request, rp, caps, { disabledGates });

  const goals: ResolvedGoal[] = [];
  const goalReviews: GoalCapabilityResolution[] = [];
  const seen = new Set<string>();
  request.goals.forEach((g, index) => {
    const i = SERIES_INDEX[g.metric as keyof typeof SERIES_INDEX];
    const def = i === undefined ? undefined : (SERIES[i] as SeriesDef);
    if (!def || def.kind !== 'metric') {
      problems.push(`"${g.metric}" cannot be used as a goal${def?.goalNote ? ` (${def.goalNote})` : ''}.`);
      return;
    }
    // D2-02: a research/signalling index with no validated link to a health outcome is never an objective (no benefit
    // credit, no fasting or protein steering); a saved or imported goal is not remapped to another numeric objective
    if (NON_HEALTH_OBJECTIVE.has(g.metric)) {
      goalReviews.push(resolveGoalCapability(g));
      problems.push(
        `"${def.label}" cannot be used as a goal: it is a research index, not a measure of a health outcome.`,
      );
      return;
    }
    // C6 (D2-06, D2-07, D2-08, D8-05, D8-08, D8-09): every request route, saved or imported goal goes through the
    // capability registry; a series without an optimizable capability (no probability semantics, exploratory mechanism,
    // generic index, fabricated precision, no personal forecast) is display/monitoring only. A saved or imported goal
    // (no current capability version) stays visible for review with its alternatives; it is never remapped
    const cap = resolveGoalCapability(g);
    if (cap.resolution === 'pendingReview' || cap.resolution === 'unavailable') {
      goalReviews.push(cap);
      if (cap.reasonCode !== 'legacyEndpointBasis') problems.push(goalResolutionText(def.label, cap));
      return;
    }
    // D4-05: glycaemia and blood pressure are non-monotone quantities whose capability requires a target/band (satiation):
    // open-ended minimisation is never compiled, and no universal target is invented — the person enters one (e.g. a
    // clinician's range); the readings stay tracked either way
    const shape = resolveObjectiveShape(g);
    if (!shape.supported) {
      goalReviews.push({
        ...cap,
        resolution: 'pendingReview',
        status: 'review',
        reasonCode: shape.reasonCode,
      });

      return;
    }
    // D7-02: a measured baseline outside the model's calibration domain stays exactly as measured; its forecast is
    // unsupported, so it cannot be a plan goal (other goals plan normally once it is removed). D7-05: an expired baseline
    // stops quantitative use; D7-09: a non-fasting sample or a glycaemic medication change makes a glycaemic goal
    // unattributable. The reading and any review stay intact
    const lab = labBaselineForecastIssue(request.profile, g.metric);
    if (lab) {
      problems.push(labIssueText(def.label, lab));
      return;
    }
    if (seen.has(g.metric)) problems.push(`"${def.label}" appears twice in the goal list.`);
    seen.add(g.metric);
    if (g.direction === 'target' && (g.target === undefined || !Number.isFinite(g.target)))
      problems.push(`"${def.label}": a target goal needs a target value.`);
    let normalized = shape.direction === g.direction ? g : { ...g, direction: shape.direction };
    let start = startEstimate(rp, g.metric);
    if (['sbp', 'glucose', 'fastingGlucose'].includes(g.metric) && g.targetKind === 'change') {
      // Fresh preview requests carry an actual initial-operator binding. An old relative goal never rebases on a profile.
      const origin = g.targetOrigin;
      if (!origin || origin.kind !== 'change' || origin.delta !== g.target || !Number.isFinite(origin.baseline) || !Number.isFinite(origin.delta)) {
        goalReviews.push({ ...cap, resolution: 'pendingReview', status: 'review', reasonCode: 'needsAbsoluteTarget' });
        return;
      }
      start = origin.baseline;
      normalized = { ...normalized, target: origin.baseline + origin.delta, targetKind: 'absolute' };
    }
    const target = normalized.target === undefined ? undefined : normalized.targetKind === 'change' ? start + normalized.target : normalized.target;
    const classes = classify(g.metric, normalized.direction, target, start);
    if (
      caps.noWeightLossGoal &&
      classes.includes('fatLoss') &&
      ['scaleWeight', 'fatMass', 'bodyFatPct', 'waist'].includes(g.metric)
    )
      problems.push(
        `"${def.label}": weight-loss goals are not available for this profile (safety screening).`,
      );
    goals.push({
      index,
      spec: normalized,
      metric: g.metric,
      def,
      direction: normalized.direction,
      functional: g.functional ?? (TIME_INTEGRATED.has(g.metric) || def.agg === 'mean' ? 'mean' : 'end'),
      useTissueMass: g.metric === 'scaleWeight',
      classes,
      startEstimate: start,
    });
  });
  if (!goals.length && goalReviews.length && !problems.length)
    problems.push('Review goals: select a supported goal and confirm its target and basis.');
  const classRank: Partial<Record<GoalClass, number>> = {};
  for (const g of goals) for (const c of g.classes) if (classRank[c] === undefined) classRank[c] = g.index;

  const gate = fastingGate(goals, classRank, practical, caps, { disabledGates });
  return {
    request,
    rp,
    caps,
    horizonDays: clampNum(horizonDays, HORIZON_MIN_DAYS, HORIZON_MAX_DAYS),
    startDate,
    startWeekday: isoWeekday(startDate),
    practical,
    goals,
    classRank,
    fastingRelevant: gate.offered,
    fastingReason: gate.reason,
    fastingServedGoal: gate.servedGoal,
    problems,
    ...(disabledGates ? { disabledGates } : {}),
    ...(goalReviews.length ? { goalReviews } : {}),
    ...habitualActivesOf(request),
  };
}

/**
 * D7-04: habitual active exposure the request carries (forward-compatible read: `habitualActives` on the request once the
 * request contract transports it; absent = none known, never invented from on-hand stock or consent).
 */
function habitualActivesOf(request: PlannerRequest): { habitualActives?: readonly HabitualActiveExposure[] } {
  const h = (request as PlannerRequest & { habitualActives?: readonly HabitualActiveExposure[] })
    .habitualActives;
  return h && h.length ? { habitualActives: h } : {};
}

/** Same context with a different horizon (time-to-target runs, 18 §4.14.3; may exceed 183 d up to 365 d). */
export function withHorizon(ctx: PlanningContext, horizonDays: number): PlanningContext {
  return { ...ctx, horizonDays: Math.round(horizonDays) };
}
