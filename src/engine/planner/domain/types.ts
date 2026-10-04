/**
 * Public contracts of the Vitals planner domain layer (docs/MODEL_SPEC.md §10; dossier 18 §3, §4.4, §4.14, §4.17, §6).
 *
 * These are the types the Planner UI builds (`PlannerRequest`) and renders (`PlannerResult`). Everything is plain
 * data (structured-clone safe) so it crosses worker boundaries unchanged. No diet brand names appear anywhere: blocks
 * and levers are defined by energy %, macro g/kg, timing and durations only (orchestrator ruling).
 */
import type { MetricId, SeriesId } from '../../types/metrics';
import type { PersonProfile } from '../../types/profile';
import type { CardioModality, Schedule } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import type { ConcreteSession, TrainingProfile } from '@/catalogues';

/** 0 = Monday … 6 = Sunday (MODEL_SPEC §0.1). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ---------------------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------------------

/** How the user states a goal on a metric (dossier 18 §3; the metric's `SERIES.goal` says which are offered). */
export type GoalDirection = 'target' | 'maximise' | 'minimise';

/**
 * One ranked goal. Goals are honoured lexicographically with degradation tolerances (dossier 18 §4.7, orchestrator
 * ruling): goal k may lose at most δ_k of its achievable range to help lower-ranked goals.
 */
export interface RankedGoal {
  /** A goal-eligible metric id from `src/engine/types/metrics.ts` (`SERIES[i].goal !== 'none'`). */
  metric: MetricId;
  direction: GoalDirection;
  /**
   * Target in metric units. Required for `'target'`; optional aspiration (satiation point) for maximise/minimise.
   * Interpreted per `targetKind`.
   */
  target?: number;
  /** `'absolute'` (default): a metric value; `'change'`: a signed change from the start value (e.g. −8 kg). */
  targetKind?: 'absolute' | 'change';
  /** Functional: `'end'` = mean of the last 7 days (stocks), `'mean'` = mean over the horizon (signals). Default by metric. */
  functional?: 'end' | 'mean';
  /** Explicit degradation tolerance δ in desirability units (default: 5 / 10 / 15 % ladder × strictness). */
  tolerance?: number;
}

/** User hard constraints and soft preferences (dossier 18 §3). All optional; defaults come from the profile. */
export interface PracticalConstraints {
  /** Resistance-training sessions per week the user can do (inclusive range). Default [0, 4] around the habit. */
  trainingDaysPerWeek?: { min: number; max: number };
  /** Weekdays on which training may be scheduled. Default all. */
  allowedTrainingWeekdays?: readonly Weekday[];
  /** Clock hour for sessions (default 18). */
  trainingTimeH?: number;
  /** Longest single session, min (default 90). */
  maxSessionMin?: number;
  /** Cardio sessions per week (inclusive range). Default [0, 3]. */
  cardioDaysPerWeek?: { min: number; max: number };
  /** Cardio modality the user does (default 'cycle'; 'walk' for people without training history). */
  cardioModality?: CardioModality;
  /** Earliest first meal and latest last meal, clock hours (default 07:00-21:00). */
  eatingWindow?: { earliestH: number; latestH: number };
  /** Meals per day allowed (default 2-4). */
  mealsPerDay?: { min: number; max: number };
  /** Daily steps allowed (default [habitual − 1000, 12 000]). */
  steps?: { min: number; max: number };
  /** Lever or block ids the user refuses (e.g. 'waterFast', 'fastDay24', 'refeedDay', 'creatine', 'B2'). */
  excludedLevers?: readonly string[];
  /** 'none' refuses every zero-intake lever regardless of tier (dossier 18 §3 "fasting refusal"). */
  fasting?: 'allowed' | 'none';
  /** Schedule preference for fasting-based delivery (dossier 20 §4C: fasting only when preferred or goal-relevant). */
  prefersFasting?: boolean;
  /** Keep sleep as it is (default true unless the habitual sleep is < 7 h). */
  sleepFixed?: boolean;
  /** Hunger tolerance → h_tol 0.40 / 0.55 / 0.70 of the normalised index (dossier 18 §4.9, UNVERIFIED). */
  hungerTolerance?: 'low' | 'medium' | 'high';
  /**
   * Longest acceptable fast, h (meal to meal). Only ever lowers the safety tier's limit; below 24 h no fasting levers
   * are used and the daily eating window is at least 24 − value. (Also accepted as a `max-fast` planner lock.)
   */
  maxFastHours?: number;
  /** Protein floor, g per kg reference weight (min(BW, 27.5·H²)); raises the 17 HC-M1 floor. (Or a `protein-floor` lock.) */
  proteinFloorGPerKg?: number;
  /** Net-carbohydrate floor, g/day (≥ 50 excludes very-low-carbohydrate blocks). (Or a `carb-floor` lock.) */
  carbFloorGPerDay?: number;
}

/**
 * Screening outcome as produced by the onboarding safety gate (`src/features/onboarding/safetyRules.ts`), consumed
 * structurally so the engine does not import UI code. Every field is optional; absent = nothing restricted beyond the
 * profile-derived 17 §2 bounds the planner always applies.
 */
export interface PlannerSafetyInput {
  plannerAccess?: 'full' | 'restricted' | 'blocked';
  /** 17 §1.1 user mode (M0 standard, R1 ED-risk, R2 clinician-first, H hard stop). */
  mode?: 'M0' | 'R1' | 'R2' | 'H';
  restrictions?: readonly ('R1' | 'R2')[];
  /** `ScreeningOutcome.plannerLocks` (ids per safetyRules `PlannerLockId`; values in `LOCK_UNIT`). */
  plannerLocks?: ReadonlyArray<{ id: string; value?: number; reasons?: ReadonlyArray<{ rule: string }> }>;
  /**
   * `ScreeningOutcome.fasting` (only the fields the planner reads). `maxFastHours` is the effective cap after opt-ins;
   * a value above 24 h / 48 h implies the T2 / T3 consent.
   */
  fasting?: {
    maxFastHours?: number;
    maxEligibleTier?: FastingTierId | null;
    effectiveTier?: FastingTierId | null;
    optInTiers?: readonly ('T2' | 'T3' | 'T4')[];
    shortWindowAvailable?: boolean;
  };
  /** `ScreeningOutcome.flags` (e.g. 'kidney-disease', 'gout'); unknown flags are ignored. */
  flags?: readonly string[];
  /** Consents granted by the user (`SafetyOptIns`) plus per-lever opt-ins (e.g. 'omega3'). */
  optIns?: { fastingTier?: 'T2' | 'T3' | 'T4' | null; shortEatingWindow?: boolean; levers?: readonly string[] };
  /** Expert mode (T4 / V tier). `EXPERT_MODE_AVAILABLE` is false in the app; the planner still never proposes T5. */
  expertMode?: boolean;
}

/**
 * How a schedule uses fasting (PLANNER_V2_SPEC §3.5): an event > 24 h (`multiDay`), zero-intake days (`zeroDays`),
 * events of 20-24 h (`fast24`), a daily eating window ≤ 8 h without any fast (`eatingWindow`, time-restricted eating,
 * never called a fast), or `none`.
 */
export type FastingKind = 'none' | 'eatingWindow' | 'fast24' | 'zeroDays' | 'multiDay';

/**
 * Why the best plan with a fast lost to an option without one (ruling R-FAST-GATE; PLANNER_V2_SPEC §3.6), precedence
 * validator, safetyMargin, chance > goalLoss > difficulty > shortlist > noGoalGain:
 *   validator     the independent validator or the Simulator-mode run rejected it (a caution or danger it may not carry)
 *   safetyMargin  it breaks a state-space margin (which, by how much, on which day: `detail`)
 *   chance        it fails the P90 chance constraint across the model's uncertainty range
 *   goalLoss      worse on the first goal (priority order) whose quantised level differs
 *   difficulty    better on goals but above a ladder rung's difficulty (plan ladder, not produced yet)
 *   shortlist     safe and no worse on the goals, but it did not reach the final, rounded and validated shortlist
 *                 (E2 addition: the search kept the plan without the fast; reported rather than hidden)
 *   alternative   this option is a distinct alternative (B, C) that the rival beats on the goals while option A itself
 *                 uses fasting (E2 addition; when option A has no fast the rival's loss to A is reported instead)
 *   noGoalGain    tied on every goal level; lost on hunger, lean tissue or complexity (named in `detail`)
 *   notEvaluated  no plan with a fast was evaluated (only on tier S after the rival search found nothing)
 */
export type FastingRejectReason =
  | 'goalLoss'
  | 'noGoalGain'
  | 'safetyMargin'
  | 'chance'
  | 'validator'
  | 'difficulty'
  | 'shortlist'
  | 'alternative'
  | 'notEvaluated';

/** Whether an option fasts, and why (ruling 18:10; R-FAST-GATE; PLANNER_V2_SPEC §3.6). */
export interface FastingVerdict {
  used: boolean;
  /** Always filled by the planner; optional in the type only so older result fixtures keep compiling. */
  kind?: FastingKind;
  /** Longest planned zero-intake span, h (meal to meal; 0 without one). Always filled, optional like `kind`. */
  longestFastH?: number;
  /** Plain language, numbers in user units, no internal references. */
  text: string;
  /** Options without a fast, when fasting was offered: the best evaluated plan that has one, and why it lost. */
  rival?: {
    kind: FastingKind;
    longestFastH: number;
    structureId: string;
    reason: FastingRejectReason;
    /** Rival − this option per goal, metric units (Simulator-mode runs of both). */
    goalDeltas: Array<{ goal: number; delta: number; unit: string }>;
    /** Rival − this option: hunger 7-day peak (0-100) and lean-tissue change (kg), or null when not modelled. */
    hungerPeakDelta: number | null;
    leanTissueDeltaKg: number | null;
    /** Rival − this option, weighted goal score G (the final comparator's first goal term). */
    deltaD: number;
    /** The deciding fact in plain words ("energy availability 28 kcal per kg fat-free mass on day 23"). */
    detail: string;
  };
}

/** Water-only fasting tiers by consecutive hours ≤ 50 kcal (17 §4.3.2), same ids as the onboarding module. */
export type FastingTierId = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export type Strictness = 'strict' | 'balanced' | 'flexible';
export type BudgetTier = 'S' | 'M' | 'L' | 'X';

export interface PlannerRequest {
  profile: PersonProfile;
  /** Ranked goals, most important first (1 ≤ K ≤ 6). */
  goals: readonly RankedGoal[];
  /** Planning horizon, days (28-183). */
  horizonDays: number;
  /** ISO date of day 0 (default: the profile's start date). */
  startDate?: string;
  constraints?: PracticalConstraints;
  safety?: PlannerSafetyInput;
  // E20: markers — additive, optional. Blood-marker warnings shown before the ladder and on the rungs they touch
  // (structural `MarkerNote`s; the search does not read them) and the ranking bias of `prefer` rules (≤ 0.02 each,
  // regulariser only; recorded on the request, not yet read by the search).
  markerWarnings?: readonly unknown[];
  preferLevers?: ReadonlyArray<{ lever: string; weight: number; rule?: string }>;
  /** Priority strictness: multiplies δ by 0.5 / 1 / 2 (dossier 18 §3). */
  strictness?: Strictness;
  /** Seed of every random stream (default: a hash of the request). */
  seed?: number | string;
  /** Budget override; default chosen from device calibration by the worker binding. */
  budget?: { tier?: BudgetTier; totalEU?: number; ensembleSize?: number };
  /**
   * Internal (planner v2, §2.2): this request is the Ideal transform of a user request (`idealRequest`), so the grammar
   * adds the Ideal-only genes (sleep duration and midpoint, training clock, cardio modality). Never set by the UI.
   */
  ideal?: boolean;
  /**
   * Internal (planner v2, §2.4): the limit groups relaxed to their Ideal values (`idealRequest`: all; `relaxGroup`: one,
   * for its shadow price). The Ideal-only gene of a relaxed group exists in the grammar (sleep → sleep genes, sessionTime
   * → training clock, cardio → modality). Never set by the UI. Additive (A8).
   */
  relaxedGroups?: readonly LimitGroupId[];
}

// ---------------------------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------------------------

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/** One row of an option's per-goal scorecard (dossier 18 §4.17 item 1, §6). */
export interface GoalScore {
  goal: number;
  metric: MetricId;
  label: string;
  unit: string;
  direction: GoalDirection;
  /** Start value (t = 0, after burn-in) and the value the functional sees (end mean or horizon mean). */
  start: number;
  value: number;
  change: number;
  target: number | null;
  /** "% of what was achievable" (P_g, dossier 18 §4.6), 0-100 (may exceed 100 slightly). */
  percentOfAchievable: number;
  /** "% of target" (Q_g), null without a target. */
  percentOfTarget: number | null;
  /** Target met (for a "keep" goal: held within `keepTolerance` of the start). */
  met: boolean | null;
  /**
   * One verdict for every place that shows this goal (scorecard, titles, tooltips; release check 2026-10-01):
   * 'reached' (target met), 'kept' (a "keep" goal — a target of zero change — held within `keepTolerance`),
   * 'notReached' (target or keep missed), null without a target. Additive.
   */
  verdict?: 'reached' | 'kept' | 'notReached' | null;
  /** "Keep" goals: how far the value may drift the wrong way and still count as kept (metric units). Additive. */
  keepTolerance?: number;
  /** What this option gives up vs option A, desirability points × 100 (0 for A). */
  costVsA: number;
  /** Ensemble band of the functional (P10, P50, P90) and P(target met), when the ensemble ran. */
  band: { p10: number; p50: number; p90: number; pTargetMet: number | null } | null;
  grade: EvidenceGrade;
}

export interface HungerAssessment {
  /** Mean and peak 7-day mean of the hunger index (0-100). */
  meanIdx: number;
  peak7Idx: number;
  daysAboveTolerance: number;
  /** Plan-survival probability at the end, % (appetite module; NaN until implemented). */
  adherencePct: number;
  rating: 'low' | 'moderate' | 'high' | 'unknown';
  text: string;
}

export interface PhaseExplanation {
  name: string;
  blockId: string;
  startDay: number;
  endDay: number;
  weeks: number;
  /** Measurable definition (energy %, protein g/kg, carbs, fat, training). */
  summary: string;
  /** Why this phase is here, in plain language, never crediting sequencing itself (MODEL_SPEC R-SEQ). */
  why: string;
}

/** A safety note with its severity (17 §3 severities: info · caution · danger). */
export interface SafetyNote {
  text: string;
  severity: 'info' | 'caution' | 'danger';
  /** Rule or warning id when the note comes from one (e.g. 'W-F03', 'HC-P4'). */
  rule?: string;
}

/** Daily P10 / P50 / P90 of a series over the robustness ensemble, index 0 = t = 0 (length horizonDays + 1). */
export interface DailyBand {
  p10: Float32Array;
  p50: Float32Array;
  p90: Float32Array;
}

export interface ConstraintNote {
  rule: string;
  share: number;
  text: string;
}

export interface PlanOption {
  id: 'A' | 'B' | 'C';
  name: string;
  schedule: Schedule;
  /** Nominal simulation of the option (daily series of every metric). */
  simulation: SimulationResult;
  scorecard: GoalScore[];
  utility: number;
  hunger: HungerAssessment;
  complexity: { score: number; dayTypes: number; phases: number; events: number };
  phases: PhaseExplanation[];
  /** Plain-language explanation paragraphs (templates, dossier 18 §4.17). */
  explanation: string[];
  /** Conflict / synergy notes touching this option's goals. */
  notes: string[];
  /** Safety notes as plain text (same order as `safetyItems`). */
  safetyNotes: string[];
  /** Safety notes with severity (plan-specific notes and the simulation's caution/danger warnings). */
  safetyItems?: SafetyNote[];
  /**
   * Whether this option uses fasting, and why (ruling 18:10: the explanation says why a fast was or was not used). An
   * option without a fast, when fasting was offered, carries the comparison with the best plan with a fast the search
   * evaluated (`rival`, ruling R-FAST-GATE).
   */
  fasting?: FastingVerdict;
  /**
   * (The fields added on 2026-09-30 — `safetyItems`, `fasting`, `bands` here, `score` in progress and `fasting` in the
   * result — are always filled by the planner; they are optional in the type only so existing fixtures keep compiling.)
   * Daily P10-P90 bands of the goal metrics and the main curves (scale weight, fat mass, lean tissue, body fat, hunger)
   * over the robustness ensemble; null when the ensemble was off. Change-from-baseline metrics are banded on the change
   * and re-based on the nominal start value (as the Simulator does).
   */
  bands?: { draws: number; series: Partial<Record<SeriesId, DailyBand>> } | null;
  bindingConstraints: ConstraintNote[];
  /** Lowest evidence grade among goal metrics and blocks/levers used. */
  confidence: EvidenceGrade;
  /** Share of ensemble draws in which option A beats this option on goal 1 (null for A / no ensemble). */
  aBeatsThisShare: number | null;
  /**
   * Top lever contributions by ablation (label, Δ desirability of goal 1 × 100 = plan − variant). `deltaGoal1Metric` is
   * the same difference in goal 1's own units (plan − variant; positive = the lever raises the metric); `safe` is false when
   * the neutralised variant would break a safety margin (then it says nothing about what the lever is worth).
   */
  contributions: Array<{ label: string; deltaGoal1: number; deltaGoal1Metric?: number; safe?: boolean }>;
}

export type GoalFeasibilityStatus =
  | 'attainable'
  | 'unattainable'
  | 'attainableAloneNotJointly'
  | 'metAtBaseline'
  | 'notImprovable'
  | 'directional';

/** Canonical route kind of the fastest-safe-rate search (R-TTT). */
export type RouteKind = 'loss' | 'gain';

/** Per-goal answer of the fastest-safe-rate search (additive public API, R-TTT). */
export interface TargetReach {
  /** Index in `request.goals`. */
  goal: number;
  metric: MetricId;
  /** A canonical route exists for this goal (body-composition loss or gain goals); other metrics: false, rest null. */
  supported: boolean;
  /** 'loss' or 'gain' route. */
  kind: RouteKind | null;
  /** Start value y(0) and the absolute target (metric units; target null for maximise/minimise goals). */
  start: number;
  target: number | null;
  /** Value at the end of the request horizon on the route, and the change from the start (signed, metric units). */
  valueAtHorizon: number;
  changeAtHorizon: number;
  /** The target is reached within the request horizon at the fastest safe rate. */
  reachableInHorizon: boolean | null;
  /** Weeks to the target on the route (null: no target, past a safety floor, or more than `ROUTE_MAX_WEEKS`). */
  weeks: number | null;
  /** Target further than two years at the safe rate. */
  beyondTwoYears: boolean;
  /** Target past a safety floor of one plan (body-fat floor, BMI 19, 20 % total loss): no horizon helps. */
  beyondSafetyLimits: boolean;
  /** Mean rate toward the goal over the first min(horizon, 12) weeks, metric units a week (≥ 0 toward the goal). */
  ratePerWeek: number;
  /** Plain-language sentence (the planner's time-to-target text uses the same one). */
  text: string;
}

export interface GoalFeasibility {
  goal: number;
  metric: MetricId;
  label: string;
  status: GoalFeasibilityStatus;
  baseline: number;
  bestAchievable: number;
  target: number | null;
  /** When unattainable: the nearest attainable target (best value found), metric units. */
  nearestAttainableTarget: number | null;
  /** Time-to-target on an extended horizon (dossier 18 §4.14.3); null when not computed or not reached. */
  requiredWeeks: number | null;
  requiredHorizonDays: number | null;
  /** Longest horizon the time-to-target search ran on, weeks (set when it ran; 52 when not reached earlier). */
  searchedWeeks?: number;
  /**
   * Not reached within `searchedWeeks`: extrapolated weeks at the pace the best safe plan sustains over its last 8
   * weeks (an estimate, less certain than `requiredWeeks`); null when that plan is not moving toward the target.
   */
  estimatedWeeks?: number | null;
  /** That pace, metric units per week toward the target. */
  fastestRatePerWeek?: number | null;
  /** True when the target lies past a safety floor of one plan (body-fat floor, BMI 19, 20 % total loss): no horizon helps. */
  beyondSafetyLimits?: boolean;
  /** True when the target lies more than two years away at the fastest safe rate (R-TTT; no week count is claimed). Additive. */
  beyondTwoYears?: boolean;
  /**
   * The fastest-safe-rate answer for this goal (R-TTT): the same `targetReach` the Goals screen calls before the run, so
   * the pre-run "reachable in this horizon" hint and this time-to-target never disagree. Absent for metrics without a
   * canonical route (the planner then runs its extended-horizon search, capped at two years). Additive.
   */
  reach?: TargetReach;
  text: string;
}

export interface PlannerProgressInfo {
  stage: string;
  fraction: number;
  euUsed: number;
  euBudget: number;
  /** Provisional (anytime) options, from the end of the first priority stage: A first, A/B/C after the diversity stage. */
  provisional: Array<{ structureId: string; name: string; percentOfAchievable: number[]; schedule: Schedule }>;
  /** Utility of the current best plan (ROC-weighted desirability minus regulariser, ≈ 0..1); null before one exists. */
  score?: number | null;
  /**
   * True when `provisional` differs from the previously delivered option set (such events are never throttled; once
   * A/B/C exist, later ticks keep carrying all of them).
   */
  optionsChanged?: boolean;
  /** The planner v2 progress event this v1 view was made from (ladder UI). Additive. */
  v2?: PlannerProgressV2;
}

export interface PlannerResult {
  status: 'ok' | 'noSafePlan' | 'blocked' | 'invalid';
  complete: boolean;
  stoppedAt: string | null;
  options: PlanOption[];
  feasibility: GoalFeasibility[];
  /** Conflict / synergy messages between goals (dossier 18 §4.13). */
  relations: string[];
  /** When no safe plan exists: the constraints violated by the least-infeasible candidate. */
  noSafePlanReasons: string[];
  /** Blocked or invalid request explanation. */
  message: string | null;
  /** Modules still running as stubs when the plan was made (results are placeholders for their outputs). */
  stubModules: string[];
  /**
   * Whether fasting levers were offered to the optimiser, and why (ruling R-FAST-GATE): the goal fasting would serve
   * (index, or null) and the longest fast the tiers and the user's limits allow, h.
   */
  fasting?: { offered: boolean; reason: string; servedGoal?: number | null; tierMaxH?: number };
  provenance: {
    seed: string;
    tier: BudgetTier;
    budgetEU: number;
    euUsed: number;
    registryHash: string;
    engineVersion: string;
    libraryVersion: number;
    structures: number;
  };
  /**
   * The planner v2 result this v1 view was made from (PLANNER_V2_SPEC §9.6: `planRegimes` is a deprecated wrapper; the
   * ladder UI reads this). Additive.
   */
  v2?: PlannerResultV2;
}

// ===============================================================================================================
// Planner v2: plan ladder (Hard · Medium · Easy) and the Ideal plan (docs/PLANNER_V2_SPEC.md §1, §2, §7-§9)
// ===============================================================================================================
// The v1 shapes above stay for one minor release behind the deprecated `planRegimes` wrapper (§9.6): it returns the
// v1 `PlannerResult` (options = Hard, Medium, Easy in that order, ids 'A'/'B'/'C') and attaches the v2 result as `v2`.
// New code reads `PlannerResultV2`; no user-visible text says A, B or C.

/** The three startable rungs of the ladder (§1). */
export type RungId = 'hard' | 'medium' | 'easy';
/** A rung or the Ideal (never startable as it is, §2.3). */
export type PlanKind = RungId | 'ideal';
export const RUNG_IDS: readonly RungId[] = ['hard', 'medium', 'easy'];
export type PlannerTier = 'S' | 'M' | 'L' | 'X';

/** The seven burdens of the difficulty axis D (§1.1). */
export type DifficultyComponentId = 'deficit' | 'hunger' | 'trainingTime' | 'fastingLoad' | 'windowTightness' | 'decisions' | 'habitDistance';
export const DIFFICULTY_COMPONENTS: readonly DifficultyComponentId[] = ['deficit', 'hunger', 'trainingTime', 'fastingLoad', 'windowTightness', 'decisions', 'habitDistance'];
export interface DifficultyComponent {
  id: DifficultyComponentId;
  /** c_i ∈ [0, 1]: 0 at today's habit, 1 at the user's own limit (or the safety cap when no limit is given). */
  value: number;
  /** v_i, h_i, ℓ_i in the component's own unit (`unit`). */
  raw: number;
  habit: number;
  limit: number;
  unit: string;
  /** ℓ_i − h_i ≥ ε_i (otherwise the user's limits leave no room on this burden and c_i = 0). */
  active: boolean;
  /** "Training time", and the plain sentence "4 h a week, 2 h more than now". */
  label: string;
  text: string;
}
export interface DifficultyBreakdown {
  /** D = mean of the seven c_i (equal weights, §1.7). */
  D: number;
  Dmax: number;
  /** Always seven entries, in `DIFFICULTY_COMPONENTS` order. */
  components: DifficultyComponent[];
  /** The component with the largest c_i ("hardest part"), or null when D = 0. */
  hardest: DifficultyComponentId | null;
}

/** One goal's outcome on a rung (§1.5); numbers come from the holdout ensemble. */
export interface GoalOutcome {
  goal: number;
  metric: MetricId;
  label: string;
  unit: string;
  /** Holdout-ensemble P50 of the functional (nominal value when the ensemble did not run). */
  p50: number;
  band: { p10: number; p90: number } | null;
  /** p50 − start (metric units). */
  change: number;
  start: number;
  target: number | null;
  pTargetMet: number | null;
  percentOfAchievable: number;
  verdict: 'reached' | 'kept' | 'notReached' | null;
  weeksToTarget: number | null;
  beyondTwoYears: boolean;
  tttSource: 'ownRun' | 'route' | null;
  /** Plain sentence: "reached in about 15 weeks" / "about 23 weeks at this plan's effort" / "kept". */
  tttText: string | null;
  /** This − Hard in metric units (0 for Hard). */
  vsHard: number;
  grade: EvidenceGrade;
}

/** The user's practical limits, grouped as the Ideal relaxes them (§2.1, `LIMIT_CLASS`). */
export type LimitGroupId = 'trainingDays' | 'sessionTime' | 'cardio' | 'eatingWindow' | 'steps' | 'sleep' | 'fasting' | 'foodFloors' | 'hunger' | 'equipment';
export const LIMIT_GROUPS: readonly LimitGroupId[] = ['trainingDays', 'sessionTime', 'cardio', 'eatingWindow', 'steps', 'sleep', 'fasting', 'foodFloors', 'hunger', 'equipment'];
/** A limit this plan presses against: binding on ≥ 20 % of days, or a gene at its bound (§2.4). */
export interface LimitBinding {
  group: LimitGroupId;
  label: string;
  /** Share of days the limit binds (1 for a gene sitting at the bound the limit sets). */
  share: number;
  text: string;
}

/** E8 shopping-list row (§8.5), re-declared structurally so the engine does not depend on the catalogue's module. */
export interface ShoppingItemV2 {
  equipmentId: string;
  /** Every item that must be bought together (E8 bundle, e.g. barbell + plates); `equipmentId` is the first. Additive (A6). */
  equipmentIds?: string[];
  name: string;
  /** R3 price tier 0-4 (0 = free or household). */
  priceTier: number;
  /** The rung's dose cannot be delivered without it. */
  required: boolean;
  unlocks: string[];
  /** With − without, holdout P50, per goal in metric units (top 3 items; empty when not re-run). */
  benefit: Array<{ goal: number; delta: number; unit: string }>;
  text: string;
}

/** Everything a ladder card and the comparison table show for one plan (§1.5). */
export interface RungSummary {
  kind: PlanKind;
  /** "Hard", "Medium", "Easy", "Ideal". */
  title: string;
  /** Measurable name, e.g. "Deficit 18 % · 4 sessions · 24-h fast weekly". */
  subtitle: string;
  difficulty: DifficultyBreakdown;
  outcomes: GoalOutcome[];
  weeklyTrainingMin: number;
  meanWindowH: number;
  hunger: HungerAssessment;
  fasting: FastingVerdict;
  bindingLimits: LimitBinding[];
  equipment: { required: ShoppingItemV2[]; optional: ShoppingItemV2[]; text: string };
  safetyItems: SafetyNote[];
}

/** What relaxing one limit group alone would buy (§2.4). */
export interface LimitCost {
  group: LimitGroupId;
  label: string;
  /** "3 training days" → "5 training days". */
  current: string;
  relaxedTo: string;
  /** Relaxed − Hard per goal, metric units (holdout P50 when available). */
  deltas: Array<{ goal: number; delta: number; unit: string }>;
  deltaD: number;
  text: string;
  /** Evaluations spent (never rendered). */
  euSpent: number;
  /** The value the "Adopt some of these limits" panel writes back (limit group → new constraint value). */
  adopt: Partial<PracticalConstraints>;
}
export interface IdealExtras {
  relaxed: Array<{ field: string; from: string; to: string; group: LimitGroupId }>;
  /** Advised-only items (mechanism known, no engine channel; never counted in the numbers). */
  advised: Array<{ domain: string; text: string }>;
  limitCosts: LimitCost[];
  gapVsHard: Array<{ goal: number; delta: number; unit: string }>;
  interactionRemainder: Array<{ goal: number; delta: number; unit: string }>;
  /** "Your limits cost nothing measurable for these goals." when the Ideal beats Hard on no goal beyond the quantum. */
  nothingBinds: boolean;
  /**
   * Ideal equals Hard (§12.3, `idealSameAsHard`): the UI renders no Ideal card; Hard's card says "None of your limits is
   * binding; the Ideal is this same plan." and lists the limits lifted without effect. Null/absent otherwise.
   */
  sameAsHard?: { liftedWithoutEffect: Array<{ group: LimitGroupId; label: string; from: string; to: string }> } | null;
}

/** v1 GoalScore with the A-relative field renamed (§9.2). */
export type GoalScoreV2 = Omit<GoalScore, 'costVsA'> & { costVsHard: number };
/** Everything a v1 PlanOption carried, minus `id`; A-relative fields renamed to Hard-relative ones (§9.2). */
export type PlanPayload = Omit<PlanOption, 'id' | 'aBeatsThisShare' | 'fasting' | 'scorecard'> & {
  scorecard: GoalScoreV2[];
  fasting: FastingVerdict;
  genome: { structureId: string; x: number[] };
  hardBeatsThisShare: number | null;
  /** Composed sessions (E8), one per training session of the horizon, when a training profile was given (§8.3). */
  sessions?: ConcreteSession[];
};
/**
 * Where a rung came from (PLANNER_V2_SPEC §12.1-12.2): this run's own ladder solve, the previous (shorter) search of the
 * same request carried forward after re-checking it against this run's Hard, or the dedicated Easy search.
 */
export type RungProvenance = 'own' | 'carried' | 'easySearch';
export interface RungPlan extends PlanPayload {
  kind: RungId;
  summary: RungSummary;
  /** Absent on results from before batch 02 (read as 'own'). */
  provenance?: RungProvenance;
  /** Tier of the search a carried rung came from. */
  fromTier?: PlannerTier;
}
export interface IdealPlanV2 extends PlanPayload, IdealExtras {
  kind: 'ideal';
  summary: RungSummary;
}

export type LadderCollapseReason = 'tooClose' | 'notDistinct' | 'belowMinimal' | 'infeasible' | 'stopped';
/**
 * Proof of absence of the dedicated Easy search (§12.2): no plan with less effort than Hard (D ≤ D_H − gap) met Easy's
 * goal constraints. Shares are of Hard's goal-1 progress (d̃₁ / d̃₁(Hard)).
 */
export interface EasyProof {
  /** Start points searched. */
  starts: number;
  /** Best goal-1 share reached by a safe plan with D ≤ D_H − gap that keeps the other goals (0 when none). */
  bestG1: number;
  /** Goal-1 share Easy needs (max(easyShare, g_min / g_H)). */
  needed: number;
  /** Effort (0-1) of that closest plan (NaN when none). */
  D: number;
  /** Evaluations the search made. */
  evaluated: number;
  /** Plans that met the goal constraints but failed a later check (validation, the uncertainty check, distinctness). */
  rejected: Array<{ why: 'validation' | 'chance' | 'distinct'; g1: number; D: number }>;
}
export interface LadderInfo {
  /** `detail`: the numbers of the failing check (machine-readable; never rendered); `carried`: a carried rung failed. */
  collapsed: Array<{ rung: RungId; reason: LadderCollapseReason; text: string; detail?: Record<string, number>; carried?: boolean }>;
  /** Present when the dedicated Easy search ran and found no Easy (§12.2). */
  easyProof?: EasyProof | null;
  checks: { dHM: number; dME: number; gowerMin: number; ordered: boolean };
  /** The attainment-difficulty frontier F(D̄) from the archive staircase (goal score G vs D), for the ladder strip. */
  frontier: Array<{ D: number; g: number }>;
}

/** One point of the convergence curve (tier X streams these; every tier records them). */
export interface ConvergencePoint {
  eu: number;
  wallMs: number;
  stage: string;
  /** Hard's stage key (first three entries) at this point, for the harness. */
  keyHard: number[];
  /** Weighted goal score of the incumbent Hard. */
  G: number;
  /** Ladder hypervolume of {(g, 1 − D)} over the staircase, reference (0, 0). */
  hvLadder: number;
}

export interface PlannerResultV2 {
  status: 'ok' | 'noSafePlan' | 'blocked' | 'invalid';
  complete: boolean;
  stoppedAt: string | null;
  /** Hard is always present when status is 'ok'. */
  rungs: Partial<Record<RungId, RungPlan>>;
  ladder: LadderInfo;
  /** Null when switched off or when no safe plan exists even without the practical limits. */
  ideal: IdealPlanV2 | null;
  /** Why the Ideal is null although it was asked for: 'stopped' = the search was stopped before the Ideal search ran. */
  idealSkipped?: 'stopped' | null;
  /**
   * This is the earlier search's ladder, kept because a longer search of the same request (`tier`) was stopped with a
   * result worse than or less complete than it (`why`, `stoppedResultWorse` in stoppedLadder.ts). Absent otherwise.
   */
  keptAfterStop?: { tier: PlannerTier; stoppedAt: string | null; why: 'noPlan' | 'fewerRungs' | 'weakerHard' | 'nothingNew' } | null;
  /** Texts say "the Hard plan". */
  feasibility: GoalFeasibility[];
  relations: string[];
  noSafePlanReasons: string[];
  message: string | null;
  stubModules: string[];
  fasting: { offered: boolean; reason: string; servedGoal: number | null; tierMaxH: number };
  convergence: ConvergencePoint[];
  provenance: Omit<PlannerResult['provenance'], 'tier'> & {
    plannerVersion: 2;
    tier: PlannerTier;
    holdoutGap: number[];
    difficultyWeights: number[];
    checkpointKey?: string;
  };
}

export interface PlannerProgressV2 {
  stage: string;
  fraction: number;
  euUsed: number;
  euBudget: number;
  score: number | null;
  provisional: Partial<Record<PlanKind, { structureId: string; title: string; D: number; percentOfAchievable: number[]; schedule: Schedule }>>;
  /** Rung set or any rung changed: never throttled. */
  changed: boolean;
  convergence?: ConvergencePoint;
}

/** §9.2: the request with the optional training profile (E8 `TrainingProfile`, structural here) and ladder shares. */
export interface PlannerRequestV2 extends PlannerRequest {
  training?: TrainingProfile;
  ladder?: { easyShare?: number; mediumFallbackShare?: number };
  /**
   * The last ladder of the same request (§12.1): its Medium and Easy genomes are re-checked against this run's Hard and
   * carried forward when this run's own rungs collapse. Never part of the request's seed or checkpoint key.
   */
  previous?: { tier: PlannerTier; rungs: Partial<Record<'hard' | 'medium' | 'easy', { structureId: string; x: number[] }>> };
}
