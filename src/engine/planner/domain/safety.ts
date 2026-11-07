/**
 * Dossier-17 bounds compiled for one planner request (17 §2.2 constraint table, §2.3 parametrised caps, §2.5 constants,
 * §4.2 population rules, §4.3 fasting tiers). Two inputs are intersected (the stricter value always wins):
 *   1. the profile itself (body, age, `PersonProfile.safety.flags`) — always applied, so the planner is safe even when
 *      no screening outcome is supplied;
 *   2. the onboarding screening outcome (`PlannerSafetyInput`: plannerLocks, fasting eligibility, opt-ins) produced by
 *      `src/features/onboarding/safetyRules.ts`, consumed structurally.
 *
 * Every number below is copied from dossier 17 §2.5 (single source of truth); `PROPOSED` marks the dossier's own
 * engineering values. Nothing here runs the engine.
 */
import {
  CONTRACT_VERSIONS,
  CONCERNING_EXERTIONAL_SYMPTOMS,
  intersectConstraints,
  interpretSurplusCap,
  isConcerningUnresolved,
  type ClinicalNutritionEnvelope,
  type ClinicianExerciseEnvelope,
  type ConstraintComparator,
  type ConstraintConflict,
  type ConstraintDef,
  type ConstraintQuantity,
  type ConstraintSource,
  type ConstraintUnit,
  type ConstraintWindow,
  type RenalContextStatus,
  type SymptomReport,
  type WeightBasis,
} from '@/lib/bodyContracts';
import { resolveClinicalNutritionScope, renalEnvelopeState, type RenalScope } from '@/lib/renalScope';
import type { ResolvedProfile, SafetyFlags } from '../../types/profile';
import { documentedHabitualNutrition } from '../../core/resolveProfile';
import type { Schedule } from '../../types/schedule';
import type { PlannerSafetyInput, PracticalConstraints } from './types';

/** 17 §2.5 constants (version 1). */
export const HC = {
  /** HC-E1: 7-d mean intake floor, kcal/d. */
  energyFloorKcal: { female: 1200, male: 1500 },
  /** HC-E2: restricted days (50 < EI < upper): ≥ min kcal, ≤ 2 per rolling 7 d, never consecutive. */
  restrictedDay: { upperKcal: { female: 1000, male: 1200 }, minKcal: { female: 500, male: 600 }, maxPer7d: 2 },
  /** HC-E3 / §2.3 deficit cap, % of TDEE_7 (PROPOSED shape). */
  deficitCapPct: { default: 25, bmiGe30: 30, bmiLt25: 20, ageGe65: 15, leanWithin4: 10 },
  /** HC-E4 energy availability floor, kcal/kg FFM/d. */
  eaMin: 30,
  /** HC-E5 / §2.3 rate cap, % BW per week (PROPOSED shape) and absolute kg/wk. */
  rateCapPct: { default: 0.75, leanWithin6: 0.5, highAdiposity: 1.0, age65to74: 0.5 },
  rateCapAbsKg: 1.5,
  /** HC-E6 cumulative loss cap, % of starting BW. */
  cumLossMaxPct: 20,
  /** HC-E7 continuous-deficit blocks (PROPOSED). */
  deficitBlocks: { highThresholdPct: 15, highMaxWeeks: 12, highBreakWeeksDefault: 2, moderateLowPct: 5, moderateMaxWeeks: 26, moderateBreakWeeks: 2 },
  /** HC-E8 surplus. */
  surplus: { maxPctTdee: 120, gainPctBwWk: 0.5, gainPctBwWkWhtr: 0.25, blockWaistCm: { male: 102, female: 88 }, blockWhtr: 0.6, blockBmi: 30, cautionWaistCm: { male: 102, female: 88 }, cautionWhtr: 0.5 },
  /** HC-P4 BMI margins (PROPOSED) and HC-P5 body-fat floors (PROPOSED). */
  bmi: { startDeficitMin: 20, projectedMin: 19 },
  bfFloorPct: { male: 10, female: 18 },
  /** HC-M1 / HC-M2 protein, g/kg reference weight RW = min(BW, 27.5·H²) unless stated. */
  protein: { floor: 0.8, floorDeficitOrAge65: 1.2, floorAge65Maintenance: 1.0, capPctEnergy: 35, capGPerKgFfm: 3.1, softCapRw: 2.2, ckdCapRw: 1.3 },
  /**
   * Planning headroom under the 3.1 g/kg FFM cap (R-PLAN-SAFETY): the Simulator's W-M04 divides by the run-time FFM,
   * which falls in a deficit, so a plan written at exactly 3.1 g/kg FFM0 is flagged within weeks.
   */
  proteinPlanCapGPerKgFfm: 2.9,
  /** HC-M1: "deficit" for the 1.2 g/kg floor means deficit_pct_7 > 10 %. */
  proteinDeficitThresholdPct: 10,
  /** HC-M3 fat. */
  fat: { minPctEnergy: 15, minG: 30, mealMinG: 10, mealRuleDeficitPct: 20, appliesAboveKcal: 800 },
  /** HC-M4 carbohydrate: ketogenic range and block length. */
  carbs: { ketogenicG: 50, maxBlockWeeks: 12 },
  /** HC-M5 fibre soft floor, g per 1000 kcal. */
  fibreSoftGPer1000: 14,
  /** HC-M12 creatine maintenance maximum, g/d. */
  creatineMaxG: 5,
  /** HC-M9 fasting-day beverages, L/d (T2-T4 2.0-3.0). */
  fastingFluidL: { min: 2.0, max: 3.0 },
  /** 17 §4.3.3 fasting sodium (elemental) g/d: T2 ≥ 36 h 1.5-2.5; T3/T4 2.0-3.0. */
  fastingSodiumG: { t2: [1.5, 2.5] as const, t3: [2.0, 3.0] as const },
  /** HC-F5 daily eating window, h. */
  window: { defaultMin: 6, optInMin: 4, r1Min: 12 },
  /** HC-F2 cumulative zero-intake hours in any 7 d (tiers T0-T3; a single T4 fast follows its own tier rule, R-T4CAP). */
  fastH7Max: 108,
  /** HC-F2 normal eating between consecutive fasts, h: T1/T2 24 h, 7 d if either is T3, 28 d if either is T4 (engine gapT*MinH). */
  gapH: { T12: 24, T3: 168, T4: 672 },
  /** HC-F2 counts (engine t1MaxPerWeek, t2SplitH, t2MaxPerWeekGt36, t3MaxPer30d, t4MaxPer12wk, t4MaxPerYear). */
  fastsPerWeekMax: 3,
  t2SplitH: 36,
  fastsGt36PerWeekMax: 2,
  t3Per30dMax: 2,
  t4Per12wkMax: 1,
  t4PerYearMax: 4,
  /** HC-F1 tier upper bounds, h (T0 ≤ 20, T1 ≤ 24, T2 ≤ 48, T3 ≤ 72, T4 ≤ 168, T5 never). */
  tierMaxH: { T0: 20, T1: 24, T2: 48, T3: 72, T4: 168 },
  /** 17 §4.3.2 tier eligibility beyond the gate. */
  tierBmiMin: { T2: 20, T3: 22, T4: 25 },
  t3BfMinPct: { male: 15, female: 25 },
  /** HC-X2 novice RT (PROPOSED): ≤ 10 hard sets per muscle per week at start, ≤ +2 sets/wk, 2-3 sessions/wk. */
  rtNovice: { startSetsMax: 10, setsIncreasePerWeek: 2, sessionsMax: 3 },
  /** HC-X3 sedentary start (PROPOSED): ≤ 150 min/wk moderate at start, ≤ +30 %/wk, ≥ 1 rest day/wk. */
  sedentary: { startMinPerWeek: 150, increasePct: 30, restDaysMin: 1 },
  /** Zero-energy threshold per day / intake event (17 §2.5). */
  zeroKcal: 50,
} as const;

export type FastTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

/** Tier of a zero-intake span of `h` hours (1e-6 h tolerance for floating-point meal clocks). */
export function tierForHours(h: number): FastTier {
  const x = h - 1e-6;
  if (x <= HC.tierMaxH.T0) return 'T0';
  if (x <= HC.tierMaxH.T1) return 'T1';
  if (x <= HC.tierMaxH.T2) return 'T2';
  if (x <= HC.tierMaxH.T3) return 'T3';
  if (x <= HC.tierMaxH.T4) return 'T4';
  return 'T5';
}

/** Compiled safety caps for one request (all values already intersected; the stricter wins). */
export interface SafetyCaps {
  blocked: string | null;
  sex: 'male' | 'female';
  ageYears: number;
  bmi: number;
  bodyFatPct: number;
  bfFloorPct: number;
  whtr: number;
  /** Reference weight for protein RW = min(BW, 27.5·H²), kg (17 §2.1, PROPOSED). */
  rwKg: number;
  weightKg: number;
  ffmKg: number;
  tdee0Kcal: number;
  /** HC-E3 cap, % (0 = no deficit allowed). */
  deficitCapPct: number;
  /** HC-E5 cap, % BW / wk and kg/wk. */
  rateCapPct: number;
  rateCapKg: number;
  /** HC-E8: surplus allowed and its limits. */
  surplusAllowed: boolean;
  gainCapPct: number;
  maxPctTdee: number;
  /**
   * Largest planned surplus of a gaining phase, % of maintenance: HC-E8's 120 %, or 104.5 % when the waist is above
   * 102 / 88 cm or the waist-to-height ratio is ≥ 0.5 (17 §3 W-S03: a surplus above 5 % is a caution then; 0.5 point of
   * headroom, R-PLAN-SAFETY). Refeed days inside a deficit are not gaining phases and keep `maxPctTdee`.
   */
  surplusPhaseMaxPct: number;
  /** HC-E1 planning floor, kcal/d: min(1200 F / 1500 M, TDEE0). */
  energyFloorKcal: number;
  restrictedDayUpperKcal: number;
  restrictedDayMinKcal: number;
  proteinFloorRw: number;
  /** Floor used for deficit days (HC-M1: 1.2 when deficit > 10 %, age ≥ 65, or RT ≥ 2 d/wk in deficit). */
  proteinFloorDeficitRw: number;
  proteinCapRw: number;
  proteinCapGPerKgFfm: number;
  fatFloorG: number;
  /** Carbohydrate floor g/d (0 = none; 50 = no ketogenic range; 100 in R1). */
  carbFloorG: number;
  ketogenicAllowed: boolean;
  creatineAllowed: boolean;
  /** Longest zero-intake span (meal to meal) the planner may schedule, h (T4 up to 168 h only in expert mode; T5 never). */
  maxFastH: number;
  /** Plain-language reason for the fasting limit (explanations: why a fast was or was not used). */
  fastingLimitReason: string;
  /** Tiers usable by the planner given eligibility and consent. */
  fastTierAllowed: Record<FastTier, boolean>;
  /**
   * The fasting tier the user opted into (explicit opt-in, implied by the screening's effective cap, or the profile flag),
   * null without one — consent only; eligibility and the user's longest fast are in `fastTierAllowed` / `maxFastH`
   * (ruling R-FAST-GATE: fasting structures are offered when a tier is opted in).
   */
  fastingOptIn: 'T2' | 'T3' | 'T4' | null;
  /** Minimum daily eating window, h (HC-F5, R1, max-fast lock). */
  minWindowH: number;
  /**
   * Exercise permission. `allowed` = any exercise prescription (resistance or cardio); `rtAllowed` / `cardioAllowed` per
   * domain (a reviewed envelope may permit one and not the other). `gate` (D4-02): 'suspended' = an unresolved concerning
   * exertional symptom without a covering reviewed envelope; 'reviewNeeded' = the symptom screen is incomplete (legacy yes,
   * unknown or prefer-not answer) — both stop autonomous exercise prescription and step progression; 'envelope' = a
   * reviewed envelope sets what is permitted. `stepsCeiling`: the most steps/d the plan may prescribe (documented
   * baseline or the envelope's ceiling; null = no symptom ceiling). `stepsBaselineDocumented` false = the ceiling is the
   * resolved habit default, so the plan holds steps at the habit and sets no new numeric target.
   */
  exercise: {
    allowed: boolean;
    rtAllowed: boolean;
    cardioAllowed: boolean;
    lightModerateOnly: boolean;
    lowImpact: boolean;
    noVigorousOutdoor: boolean;
    gate: ExerciseGate;
    stepsCeiling: number | null;
    stepsBaselineDocumented: boolean;
    /** "Training as usual" days may stay in the plan (false while the gate stops exercise prescription). */
    habitualTrainingAllowed: boolean;
    /** Unresolved concerning symptom ids behind the gate, and the envelope that governs (if any). */
    symptomIds: readonly string[];
    envelopeId: string | null;
    /**
     * (D4-02/A1-003) Every clinician intensity maximum of an envelope in force on the start date, kept with its original
     * entry and its normalized comparable channel. Intersected with the generic bands (never dropped); repair lowers a
     * comparable dose to it, and a limit with no comparable channel leaves the affected session Unchecked.
     */
    intensityCaps: readonly ExerciseIntensityCap[];
    /**
     * (D4-02/A1-004) The first plan day on which the governing envelope no longer applies (its own review date passed or a
     * recorded withdrawal) and the gate that then holds ('suspended' / 'reviewNeeded': no sessions, no training as usual,
     * steps at the habit). Null when the gate does not change within the envelope dates. No expiry is invented.
     */
    gateChange: { day: number; date: string; gate: ExerciseGate } | null;
  };
  /** Most creatine per day the plan may add, g (HC-M12 maximum ∩ a positive creatine-cap lock). */
  creatineMaxG: number;
  /** Total caffeine cap, mg/d, from a caffeine-cap lock (null = none beyond HC-M11). */
  caffeineMaxMgPerDay: number | null;
  /** Total-fat cap, % of energy, from a fat-cap lock (null = none). */
  fatMaxPctEnergy: number | null;
  /**
   * Typed lock constraints (C5/D4-01): every lock with a typed quantity, intersected (caps by min, floors by max,
   * order-independent), the empty intersections (conflicts with their units and values), definitions rejected by
   * validation, and locks that need review (ambiguous surplus unit, unknown unit, missing value) or contradict policy.
   */
  constraints: SafetyConstraintSet;
  /**
   * D4-07 renal nutrition scope: whether the planner may set renal-targeted numbers on its own. Without an applicable
   * clinician-directed envelope (`incomplete` / `review`) protein is held at the person's habitual intake and no
   * sodium/potassium/fluid number is prescribed; an `entered` envelope's bounds apply with their own weight basis.
   * Activity, logging and independent goals are untouched.
   */
  renal: RenalScopeCaps;
  /** Novice / sedentary progression limits apply (HC-X2 / HC-X3). */
  rtNovice: boolean;
  sedentaryStart: boolean;
  mode: 'M0' | 'R1' | 'R2' | 'H';
  flags: ReadonlySet<string>;
  optInLevers: ReadonlySet<string>;
  noWeightLossGoal: boolean;
  /** Plain-language reasons for every restriction beyond the defaults (feeds safety notes and explanations). */
  reasons: string[];
}

export type ExerciseGate = 'none' | 'suspended' | 'reviewNeeded' | 'envelope';

/**
 * Comparable channel of a clinician intensity maximum (D4-02/A1-003): the fraction of VO2max a cardio session states
 * (`pctVo2max`, 0..1), a stated gross MET, or a stated Borg CR-10 rating. Nothing else is converted (no %HRmax, talk test,
 * cross-scale RPE or net-MET equivalence is invented).
 */
export type IntensityChannel = 'pctVo2maxFraction' | 'grossMet' | 'cr10';

/** One clinician intensity maximum as the planner reads it (original entry kept beside its normalized value). */
export interface ExerciseIntensityCap {
  envelopeId: string;
  assessedAt: string;
  reviewBy?: string;
  /** The entry exactly as supplied. */
  original: { convention: string; max: number; unit: string };
  comparator: 'cap';
  /**
   * 'supported': `normalized` is comparable; 'unknownUnit' / 'invalidValue': the entry cannot be read (Review);
   * 'noComparableChannel': a convention (%HRmax, talk test, a non-CR-10 RPE scale, net MET) the prescription has no
   * comparable dose for (Unchecked).
   */
  status: 'supported' | 'unknownUnit' | 'invalidValue' | 'noComparableChannel';
  normalized: { channel: IntensityChannel; max: number } | null;
}

/** Unit spellings read as percent of VO2max (max / 100) or as a fraction of VO2max (max as is); never by magnitude. */
const PCT_VO2MAX_PERCENT_UNITS: ReadonlySet<string> = new Set(['%', 'percent', '% vo2max', '%vo2max', '% of vo2max', 'pct']);
const PCT_VO2MAX_FRACTION_UNITS: ReadonlySet<string> = new Set(['fraction', 'unitless-fraction', 'fraction of vo2max', '0-1']);
const GROSS_MET_UNITS: ReadonlySet<string> = new Set(['met', 'mets', 'gross met', 'gross mets']);
const NET_MET_UNITS: ReadonlySet<string> = new Set(['net met', 'net mets']);
const CR10_UNITS: ReadonlySet<string> = new Set(['cr10', 'cr-10', 'borg cr10', 'borg cr-10', 'borgcr10']);
const OTHER_RPE_UNITS: ReadonlySet<string> = new Set(['borg 6-20', 'rpe 6-20', '6-20', 'borg']);

/**
 * Normalize one envelope intensity entry (A1-003). pctVo2max with an explicit percent unit → max/100; with an explicit
 * fraction unit → max; MET only as gross MET; RPE only on the CR-10 scale. A missing or unknown unit is never guessed from
 * the value's size. Pure.
 */
export function normalizeIntensityCap(env: Pick<ClinicianExerciseEnvelope, 'id' | 'assessedAt' | 'reviewBy' | 'intensity'>): ExerciseIntensityCap | null {
  const it = env.intensity;
  if (!it) return null;
  const base = {
    envelopeId: env.id,
    assessedAt: env.assessedAt,
    ...(env.reviewBy ? { reviewBy: env.reviewBy } : {}),
    original: { convention: String(it.convention), max: it.max, unit: String(it.unit ?? '') },
    comparator: 'cap' as const,
  };
  const unit = String(it.unit ?? '').trim().toLowerCase();
  if (typeof it.max !== 'number' || !Number.isFinite(it.max) || it.max <= 0) return { ...base, status: 'invalidValue', normalized: null };
  switch (it.convention) {
    case 'pctVo2max':
      if (PCT_VO2MAX_PERCENT_UNITS.has(unit)) return { ...base, status: 'supported', normalized: { channel: 'pctVo2maxFraction', max: it.max / 100 } };
      if (PCT_VO2MAX_FRACTION_UNITS.has(unit)) return { ...base, status: 'supported', normalized: { channel: 'pctVo2maxFraction', max: it.max } };
      return { ...base, status: 'unknownUnit', normalized: null };
    case 'MET':
      if (GROSS_MET_UNITS.has(unit)) return { ...base, status: 'supported', normalized: { channel: 'grossMet', max: it.max } };
      if (NET_MET_UNITS.has(unit)) return { ...base, status: 'noComparableChannel', normalized: null };
      return { ...base, status: 'unknownUnit', normalized: null };
    case 'RPE':
      if (CR10_UNITS.has(unit)) return { ...base, status: 'supported', normalized: { channel: 'cr10', max: it.max } };
      if (OTHER_RPE_UNITS.has(unit)) return { ...base, status: 'noComparableChannel', normalized: null };
      return { ...base, status: 'unknownUnit', normalized: null };
    case 'pctHRmax':
    case 'talkTest':
      return { ...base, status: 'noComparableChannel', normalized: null };
    default:
      return { ...base, status: 'unknownUnit', normalized: null };
  }
}

/** Renal-targeted numeric domains (D4-07): withheld from autonomous prescription without an applicable envelope. */
export type RenalDomain = 'protein' | 'sodium' | 'potassium' | 'fluid';
export const RENAL_DOMAINS: readonly RenalDomain[] = ['protein', 'sodium', 'potassium', 'fluid'];

/** One explicit conflict between a renal bound and another bound (both values in one unit; neither silently clipped). */
export interface RenalConflict {
  id: string;
  /** The bound that yielded and the one that governs, g/kg reference weight per day. */
  yielded: { id: string; value: number };
  governs: { id: string; value: number };
  unit: 'g/kg/d';
}

export interface RenalScopeCaps {
  /** Inline word: none / Incomplete / Review / Entered. */
  status: 'none' | 'incomplete' | 'review' | 'entered';
  /** The profile's renal context (legacy kidneyDisease = true reads as 'contextIncomplete', never a stage). */
  context: RenalContextStatus;
  /** Domains the planner may not set numbers for on its own (empty when none or an envelope governs). */
  withheld: readonly RenalDomain[];
  /** Applicable clinician-directed envelopes (ids). */
  envelopeIds: readonly string[];
  /** Entered protein bounds, g/day (clinician value × the clinician's basis kg), and the basis they came from. */
  proteinGPerDay: { floor: number | null; cap: number | null; basis: WeightBasis | null } | null;
  /** Protein held at the habitual intake while withheld, g/kg reference weight per day (null otherwise). */
  heldProteinGPerKgRw: number | null;
  /** Why (stable code): 'none' | 'contextIncomplete' | 'priorAbnormality' | 'envelopeNotApplicable' | 'envelopeEntered'. */
  reasonCode: string;
  conflicts: RenalConflict[];
  /** Original and validated clinical definitions, including unresolved mandatory entries. */
  clinical: RenalScope;
  /** Only an explicitly documented habitual estimate may authorize routine continuation. */
  habitualProteinG: number | null;
  habitualProvenance: ReturnType<typeof documentedHabitualNutrition>;
}

/** A recorded renal envelope (the contract carries the clinician's basis kg and any withdrawal date). */
type RenalEnvelopeView = ClinicalNutritionEnvelope;

/**
 * Whether a clinician-directed renal envelope applies on `today` (D4-07): a CKD envelope dated on or before today, not
 * revoked, its own review date not passed (Vitals invents no expiry), stable context, known dialysis status, and every
 * per-kg protein bound names its kg (actual weight, or the clinician's own kg for any other basis — never the app's
 * reference weight).
 */
export function renalEnvelopeApplies(env: RenalEnvelopeView, today: string): boolean {
  return renalEnvelopeState(env, { today }).state === 'applicable';
}

/** A lock that needs review or contradicts policy (never silently reinterpreted or relaxed). */
export interface LockReview {
  id: string;
  /** 'review': clarify (ambiguous/unknown unit, missing or non-finite value); 'conflict': contradicts a policy bound. */
  status: 'review' | 'conflict';
  /** Reason code; 'unsupportedDefinition' = an id the planner has no definition for (A1-006). */
  reason: string;
  value?: number;
  unit?: string;
  mandatory: boolean;
  /** Where the entry came from, as supplied (A1-006: kept for an unsupported definition). */
  source?: ConstraintSource['kind'];
}

export interface SafetyConstraintSet {
  /** `CONTRACT_VERSIONS.constraintPolicy` these were resolved under. */
  policyVersion: number;
  /** Strictest bound per key and comparator (lock-derived plus the policy bounds they meet). */
  merged: ConstraintDef[];
  /** Every original supported definition; final evaluation does not discard looser sources. */
  definitions?: ConstraintDef[];
  conflicts: ConstraintConflict[];
  rejected: Array<{ def: ConstraintDef; reason: string }>;
  review: LockReview[];
}

type LockEntry = NonNullable<PlannerSafetyInput['plannerLocks']>[number];

interface LockSemantics {
  quantity: ConstraintQuantity;
  unit: ConstraintUnit;
  comparator: ConstraintComparator;
  basis: WeightBasis;
  window: ConstraintWindow;
  scope: ConstraintDef['scope'];
  /** Unit spellings the producers use for this id (screening `LOCK_UNIT`, markers `LAB_LOCK_UNIT`, the typed unit). */
  units: readonly string[];
}

const PER_KG_UNITS = ['g/kg/d', 'g/kg', 'g/kg reference weight'] as const;
const G_PER_DAY = ['g/d', 'g/day'] as const;
const PCT_ENERGY = ['%E', '% of energy', '%energy'] as const;

/**
 * Typed semantics of the lock ids with a constraint quantity (C5/D4-01, constraint policy v1). Lab locks mirror
 * `LAB_LOCK_DEFS` (src/markers/types.ts); screening locks follow safetyRules' `LOCK_UNIT`. The unit is fixed per id and
 * never inferred from the value's magnitude; an explicit unit that is not one of `units` makes the lock need review.
 */
export const PLANNER_LOCK_DEFS: Readonly<Record<string, LockSemantics>> = {
  'deficit-cap': { quantity: 'deficitPct', unit: '%', comparator: 'cap', basis: 'notApplicable', window: { kind: 'rolling', days: 7 }, scope: 'total', units: ['%', '% of maintenance'] },
  'max-fast': { quantity: 'fastHours', unit: 'h', comparator: 'cap', basis: 'notApplicable', window: { kind: 'event' }, scope: 'total', units: ['h'] },
  'protein-cap': { quantity: 'proteinPerKg', unit: 'g/kg/d', comparator: 'cap', basis: 'reference', window: { kind: 'day' }, scope: 'total', units: PER_KG_UNITS },
  'protein-floor': { quantity: 'proteinPerKg', unit: 'g/kg/d', comparator: 'floor', basis: 'reference', window: { kind: 'day' }, scope: 'total', units: PER_KG_UNITS },
  'carb-floor': { quantity: 'carbPerDay', unit: 'g/d', comparator: 'floor', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: G_PER_DAY },
  'satfat-cap': { quantity: 'satFatPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: PCT_ENERGY },
  'fat-cap': { quantity: 'fatPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: PCT_ENERGY },
  'creatine-cap': { quantity: 'creatinePerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: G_PER_DAY },
  'potassium-supp-cap': { quantity: 'potassiumSupplementPerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'supplementOnly', units: G_PER_DAY },
  'alcohol-cap': { quantity: 'alcoholPerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: G_PER_DAY },
  'added-sugar-cap': { quantity: 'addedSugarPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: PCT_ENERGY },
  'surplus-cap': { quantity: 'energyPctOfMaintenance', unit: '% of maintenance', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: ['% of maintenance', 'pctOfMaintenance'] },
  'caffeine-cap': { quantity: 'caffeinePerDay', unit: 'mg/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total', units: ['mg/d', 'mg/day'] },
};

/** Numeric locks without a typed quantity: comparator and accepted units (screening `LOCK_UNIT`). */
const UNTYPED_LOCKS: Readonly<Record<string, { comparator: ConstraintComparator; units: readonly string[] }>> = {
  'rate-cap': { comparator: 'cap', units: ['% body weight per week', '%BW/wk', '% BW/wk'] },
  'min-eating-window': { comparator: 'floor', units: ['h'] },
  'fat-floor': { comparator: 'floor', units: G_PER_DAY },
};

/**
 * Supported nonnumeric planner locks (A1-006) and the rule that enforces each: the registry is complete, so any other id
 * is an unsupported definition (a mandatory one needs review; an optional one is kept for explanation only).
 */
export const SEMANTIC_PLANNER_LOCKS: Readonly<Record<string, string>> = {
  'no-deficit': 'deficit cap 0 (compileSafetyCaps)',
  'no-ketogenic': 'carbohydrate floor 50 g/d',
  'no-exercise-prescription': 'no sessions, no training as usual',
  'exercise-light-moderate': 'light-moderate cardio only',
  'exercise-low-impact': 'low-impact sessions',
  'no-creatine': 'no creatine added',
  'no-weight-loss-goal': 'no weight-loss goal',
  'no-vled': 'intake floor (no very-low-energy diet)',
  'no-potassium-supplement': 'potassium supplement cap 0 g/d (typed)',
};

/** Every lock id the planner supports: typed numeric, untyped numeric and semantic (A1-006). */
export function isSupportedLockId(id: string): boolean {
  return id in PLANNER_LOCK_DEFS || id in UNTYPED_LOCKS || id in SEMANTIC_PLANNER_LOCKS;
}

/** Lock ids only the blood-marker rules write (a lock without a source is a generated marker lock). */
const MARKER_ONLY_LOCKS: ReadonlySet<string> = new Set(['satfat-cap', 'fat-cap', 'creatine-cap', 'potassium-supp-cap', 'alcohol-cap', 'added-sugar-cap', 'surplus-cap', 'caffeine-cap']);

function lockSource(l: LockEntry): ConstraintSource['kind'] {
  if (l.source) return l.source;
  return MARKER_ONLY_LOCKS.has(l.id) ? 'marker' : 'screening';
}

/** Mandatory unless the person entered it as their own preference (clinician, marker, screening and imported locks block). */
const lockMandatory = (l: LockEntry): boolean => l.mandatory ?? lockSource(l) !== 'user';

function unitAccepted(unit: string | undefined, units: readonly string[]): boolean {
  return unit === undefined || unit === '' || units.includes(unit);
}

function hasLock(locks: ReadonlyArray<{ id: string; value?: number }>, id: string): boolean {
  return locks.some((l) => l.id === id);
}

/**
 * Strictest value of an untyped numeric lock across duplicates (caps by min, floors by max; order-independent). Entries
 * with a non-finite value or a unit outside the accepted spellings are skipped here and reported for review.
 */
function strictestUntyped(locks: readonly LockEntry[], id: string): number | undefined {
  const sem = UNTYPED_LOCKS[id]!;
  let v: number | undefined;
  for (const l of locks) {
    if (l.id !== id || typeof l.value !== 'number' || !Number.isFinite(l.value) || !unitAccepted(l.unit, sem.units)) continue;
    v = v === undefined ? l.value : sem.comparator === 'cap' ? Math.min(v, l.value) : Math.max(v, l.value);
  }
  return v;
}

/** Policy bounds a lock can meet in the same key (17 constants; no new clinical numbers). */
function policyDef(id: string, sem: Omit<LockSemantics, 'units'>, value: number): ConstraintDef {
  return { id, ...sem, value, applicability: 'applicable', mandatory: true, source: { kind: 'policy', ref: id }, policyVersion: CONTRACT_VERSIONS.constraintPolicy };
}

/**
 * Resolve the request's locks into typed constraints (C5/D4-01): one definition per typed lock entry, the surplus cap read
 * as percent OF maintenance (never by magnitude), duplicates intersected (caps min, floors max, any order), empty
 * intersections reported as conflicts, unknown units / missing values reported for review. `policy` are the dossier-17
 * bounds that share a key with a lock (HC-M3 fat floor, the kidney protein cap), so a lock below/above them conflicts
 * instead of being silently clipped.
 */
export function resolveLockConstraints(locks: readonly LockEntry[], policy: readonly ConstraintDef[] = []): SafetyConstraintSet {
  const defs: ConstraintDef[] = [...policy];
  const review: LockReview[] = [];
  for (const l of locks) {
    const mandatory = lockMandatory(l);
    const sem = PLANNER_LOCK_DEFS[l.id];
    const untyped = UNTYPED_LOCKS[l.id];
    if (!sem) {
      if (untyped) {
        if (typeof l.value !== 'number' || !Number.isFinite(l.value)) review.push({ id: l.id, status: 'review', reason: 'missingOrNonFiniteValue', mandatory, ...(l.unit ? { unit: l.unit } : {}) });
        else if (!unitAccepted(l.unit, untyped.units)) review.push({ id: l.id, status: 'review', reason: 'unknownUnit', value: l.value, unit: l.unit!, mandatory });
      } else if (l.id === 'no-potassium-supplement') {
        // the semantic lock is the typed supplement-only bound 0 g/d, checked on every schedule source (A1-006/A1-007)
        const ps = PLANNER_LOCK_DEFS['potassium-supp-cap']!;
        const { units: _pu, ...typed } = ps;
        const source = lockSource(l);
        defs.push({ id: l.id, ...typed, value: 0, applicability: 'applicable', mandatory, source: { kind: source, ref: l.id }, policyVersion: CONTRACT_VERSIONS.constraintPolicy });
      } else if (!(l.id in SEMANTIC_PLANNER_LOCKS)) {
        // (A1-006) an id without a definition is never silently dropped: kept with what was supplied, for review
        review.push({
          id: l.id,
          status: 'review',
          reason: 'unsupportedDefinition',
          mandatory,
          source: lockSource(l),
          ...(typeof l.value === 'number' ? { value: l.value } : {}),
          ...(l.unit ? { unit: l.unit } : {}),
        });
      }
      continue;
    }
    if (typeof l.value !== 'number' || !Number.isFinite(l.value)) {
      review.push({ id: l.id, status: 'review', reason: 'missingOrNonFiniteValue', mandatory, ...(l.unit ? { unit: l.unit } : {}) });
      continue;
    }
    const source = lockSource(l);
    let value = l.value;
    if (l.id === 'surplus-cap') {
      const r = interpretSurplusCap({ value, unit: l.unit ?? null, origin: source === 'import' ? 'imported' : source === 'user' ? 'user' : 'generatedMarker' });
      if (r.status === 'review') {
        review.push({ id: l.id, status: 'review', reason: r.reason, value, mandatory, ...(l.unit ? { unit: l.unit } : {}) });
        continue;
      }
      if (r.status === 'conflict') {
        review.push({ id: l.id, status: 'conflict', reason: r.reason, value, unit: sem.unit, mandatory });
        continue;
      }
      value = r.pctOfMaintenance;
    } else if (!unitAccepted(l.unit, sem.units)) {
      review.push({ id: l.id, status: 'review', reason: 'unknownUnit', value, unit: l.unit!, mandatory });
      continue;
    }
    const { units: _u, ...typed } = sem;
    defs.push({
      id: l.id,
      ...typed,
      value,
      applicability: 'applicable',
      mandatory,
      source: { kind: source, ref: l.id, ...(source === 'marker' && !l.source ? { legacyOrigin: 'generatedMarker' as const } : {}) },
      policyVersion: CONTRACT_VERSIONS.constraintPolicy,
      ...(typed.unit === '%E' ? { zeroDenominator: 'notApplicable' as const } : {}),
    });
  }
  const x = intersectConstraints(defs);
  review.sort((a, b) => (a.id + a.reason < b.id + b.reason ? -1 : a.id + a.reason > b.id + b.reason ? 1 : (a.value ?? 0) - (b.value ?? 0)));
  return { policyVersion: CONTRACT_VERSIONS.constraintPolicy, definitions: defs.filter((d) => !x.rejected.some((r) => r.def === d)), merged: x.merged, conflicts: x.conflicts, rejected: x.rejected, review };
}

/** The merged value of a typed lock quantity and comparator, if any lock (or policy bound) set it. */
function mergedValue(set: SafetyConstraintSet, quantity: ConstraintQuantity, comparator: ConstraintComparator, fromLocksOnly = true): number | undefined {
  const d = set.merged.find((m) => m.quantity === quantity && m.comparator === comparator && (!fromLocksOnly || m.source.kind !== 'policy'));
  return d?.value;
}

/** ISO date `iso` or the date part of an instant; '' when absent. */
const dateOf = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : '');

/** ISO date plus `n` days (UTC calendar arithmetic). */
function addIsoDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + n * 86_400_000).toISOString().slice(0, 10) : date;
}

/** Whole days from ISO date `a` to `b`. */
function isoDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Whether a reviewed envelope governs the given unresolved symptoms on `today` (D4-02): not revoked, its review date not
 * passed, assessed on or after every symptom it must cover (a later, materially new symptom invalidates it regardless of
 * date) and listing each covered symptom id. No universal clearance lifetime is invented; `reviewBy` is the clinician's own.
 */
export function envelopeCovers(env: ClinicianExerciseEnvelope, symptoms: readonly SymptomReport[], today: string): boolean {
  if (!envelopeCurrent(env, today)) return false;
  for (const s of symptoms) {
    if (!env.coversSymptomIds?.includes(s.id)) return false;
    const at = dateOf(s.occurredOn) || dateOf(s.reportedAt);
    if (at && dateOf(env.assessedAt) < at) return false;
  }
  return true;
}

/** An envelope in force on `today`: not assessed after today (lib `envelopeValid`), not revoked, review date not passed. */
function envelopeCurrent(env: ClinicianExerciseEnvelope, today: string): boolean {
  if (today && dateOf(env.assessedAt) > today) return false;
  if (env.revokedAt && (!today || dateOf(env.revokedAt) <= today)) return false;
  if (env.reviewBy && today && dateOf(env.reviewBy) < today) return false;
  return true;
}

/**
 * Exercise gate of a profile (C5/D4-02). Unresolved concerning exertional symptoms (chest discomfort, syncope or
 * presyncope, disproportionate breathlessness) suspend autonomous exercise prescription and step progression; a legacy
 * "fainting or chest pain" yes or an unknown / prefer-not answer without a clarified report makes the screen incomplete
 * (review, not a diagnosis). A reviewed envelope that covers the symptoms restores what it permits. Asymptomatic risk
 * factors and musculoskeletal limitations are not this gate (they keep their own light-moderate / low-impact rules).
 */
export function exerciseGateOf(
  pf: SafetyFlags,
  today: string,
): { gate: ExerciseGate; symptomIds: string[]; envelope: ClinicianExerciseEnvelope | null } {
  const symptoms = pf.symptoms ?? [];
  const concerning = symptoms.filter(isConcerningUnresolved);
  const answer = pf.answers?.faintingOrChestPain;
  const clarified = symptoms.some((s) => CONCERNING_EXERTIONAL_SYMPTOMS.has(s.category) && s.status !== 'unknown');
  const legacyOpen = !clarified && (pf.faintingOrChestPain === true || answer === 'yes' || answer === 'unknown' || answer === 'preferNot');
  if (!concerning.length && !legacyOpen) return { gate: 'none', symptomIds: [], envelope: null };
  const envs = [...(pf.exerciseEnvelopes ?? [])].sort((a, b) => (a.assessedAt < b.assessedAt ? 1 : a.assessedAt > b.assessedAt ? -1 : a.id < b.id ? -1 : 1));
  // the legacy screen is covered by any current envelope (no symptom id to match); reported symptoms need explicit cover
  const env = envs.find((e) => (concerning.length ? envelopeCovers(e, concerning, today) : envelopeCurrent(e, today))) ?? null;
  const ids = concerning.map((s) => s.id).sort();
  if (env) return { gate: 'envelope', symptomIds: ids, envelope: env };
  return { gate: concerning.length ? 'suspended' : 'reviewNeeded', symptomIds: ids, envelope: null };
}

/**
 * Compile the 17 bounds for a person. Pure; deterministic. `input` may be undefined (then only profile rules apply).
 */
export function compileSafetyCaps(rp: ResolvedProfile, input: PlannerSafetyInput | undefined, practical?: PracticalConstraints): SafetyCaps {
  const reasons: string[] = [];
  const sex: 'male' | 'female' = rp.sex === 'female' ? 'female' : 'male';
  const age = rp.ageYears;
  const bmi = rp.body.bmi;
  const bf = rp.body.bodyFatPct;
  const bfFloor = HC.bfFloorPct[sex];
  const whtr = Number.isFinite(rp.body.whtr) ? rp.body.whtr : NaN;
  const waist = rp.input.body.waistCm ?? rp.body.circumferences?.waistCm ?? NaN;
  const pf = rp.safety.flags;
  const flags = new Set<string>(input?.flags ?? []);
  // The screening encoder repeats the general adult policy as a lock. Turning that preset off must remove its
  // generated duplicate too, while retaining clinician, marker, imported and condition-specific screening bounds.
  const locks = (input?.plannerLocks ?? []).filter((l) => !(practical?.enforceDefaultDeficitCap === false && l.id === 'deficit-cap' && (l.value === HC.deficitCapPct.default || practical.experimentalTracking === true) && l.source === 'screening' && !!l.reasons?.length && l.reasons.every((r) => r.rule === 'HC-E3')));
  const mode: SafetyCaps['mode'] = input?.mode ?? rp.safety.mode ?? 'M0';
  const restr = new Set(input?.restrictions ?? []);
  if (mode === 'R1') restr.add('R1');
  if (mode === 'R2') restr.add('R2');
  const rwKg = Math.min(rp.weightKg, 27.5 * rp.heightM * rp.heightM);
  const kidney = !!pf.kidneyDisease || flags.has('kidney-disease');
  // D4-07 renal scope: a kidney answer (legacy boolean included) is context incomplete, never a stage; a prior abnormal
  // kidney result under review is a neutral review; only an applicable clinician-directed envelope sets renal numbers
  const today0 = rp.input.startDate ?? '';
  const renalCtx: RenalContextStatus = pf.renalContext ?? (kidney ? 'contextIncomplete' : 'none');
  const clinical = resolveClinicalNutritionScope({ ...pf, ...(kidney ? { kidneyDisease: true } : {}) }, today0, rp.weightKg);
  const renalActive = kidney || renalCtx !== 'none' || clinical.context !== 'none';
  const policy: ConstraintDef[] = [policyDef('HC-M3', { quantity: 'fatPctEnergy', unit: '%E', comparator: 'floor', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' }, HC.fat.minPctEnergy)];
  for (const b of clinical.bounds) if (b.status === 'enforceable' && b.normalized) policy.push(b.normalized);
  const constraints = resolveLockConstraints(locks, policy);
  for (const b of clinical.bounds) if (b.status === 'invalid') constraints.rejected.push({ def: b.def, reason: b.reason ?? 'invalidClinicalDefinition' });
  const lockCapOf = (q: ConstraintQuantity) => mergedValue(constraints, q, 'cap');
  const lockFloorOf = (q: ConstraintQuantity) => mergedValue(constraints, q, 'floor');

  // ---- hard blocks (HC-P1, HC-P2, HC-P6, mode H)
  let blocked: string | null = null;
  if (input?.plannerAccess === 'blocked' || mode === 'H') blocked = 'The planner is not available for this profile (safety screening).';
  // fails closed: an age that is not a number (a damaged or imported profile) cannot pass the adults-only gate
  if (!(age >= 18)) blocked = 'The planner is for adults only (see Evidence › Safety limits).';
  if (pf.pregnantOrBreastfeeding) blocked = 'The planner is off during pregnancy and breastfeeding (see Evidence › Safety limits).';
  const med = pf.diabetesMedication;
  if (pf.type1Diabetes || med === 'insulin' || med === 'sulfonylurea' || med === 'sglt2')
    blocked = 'The planner is off with type 1 diabetes or insulin, sulfonylurea or SGLT2-inhibitor treatment (see Evidence › Safety limits).';

  // ---- deficit cap (17 §2.3)
  let cap: number = practical?.enforceDefaultDeficitCap === false ? 100 : HC.deficitCapPct.default;
  if (practical?.enforceDefaultDeficitCap === false)
    reasons.push('The general 25% deficit preset is off. Other applicable limits and warnings still apply.');
  if (bmi >= 30) cap = HC.deficitCapPct.bmiGe30;
  if (bmi < 25) cap = HC.deficitCapPct.bmiLt25;
  if (age >= 65) cap = Math.min(cap, HC.deficitCapPct.ageGe65);
  if (bf <= bfFloor + 4) cap = Math.min(cap, HC.deficitCapPct.leanWithin4);
  const lockCap = lockCapOf('deficitPct');
  if (lockCap !== undefined && lockCap < cap) {
    cap = lockCap;
    reasons.push(`Energy deficit limited to ${lockCap} % by your safety screening.`);
  }
  let noDeficit = hasLock(locks, 'no-deficit') || restr.has('R1');
  if (bmi < HC.bmi.startDeficitMin) {
    noDeficit = true;
    reasons.push('No energy deficit: BMI is below 20 (see Evidence › Safety limits).');
  }
  if (bf < bfFloor + 2) {
    noDeficit = true;
    reasons.push(`No energy deficit: estimated body fat is within 2 points of the ${bfFloor} % floor (see Evidence › Safety limits).`);
  }
  if (age >= 75 || (pf.sarcF ?? 0) >= 4) {
    noDeficit = true;
    reasons.push('No energy deficit at age 75+ or with a SARC-F score of 4 or more (see Evidence › Safety limits).');
  }
  if (restr.has('R2') || pf.cardiovascularOrBp || pf.liverDisease) cap = Math.min(cap, 15);
  if (pf.planningPregnancy) noDeficit = true;
  if (noDeficit) cap = 0;

  // ---- rate cap (17 §2.3)
  let rate: number = HC.rateCapPct.default;
  if (bf <= bfFloor + 6) rate = HC.rateCapPct.leanWithin6;
  if (bmi >= 30 || bf >= (sex === 'male' ? 30 : 40)) rate = HC.rateCapPct.highAdiposity;
  if (age >= 65 && age < 75) rate = Math.min(rate, HC.rateCapPct.age65to74);
  if (pf.gout || pf.gallstones) rate = Math.min(rate, 0.5);
  const lockRate = strictestUntyped(locks, 'rate-cap');
  if (lockRate !== undefined) rate = Math.min(rate, lockRate);
  const rateKg = Math.min((rate / 100) * rp.weightKg, HC.rateCapAbsKg);

  // ---- surplus (HC-E8)
  let surplusAllowed = true;
  if (waist > HC.surplus.blockWaistCm[sex] || whtr >= HC.surplus.blockWhtr || bmi >= HC.surplus.blockBmi) {
    surplusAllowed = false;
    reasons.push('No planned weight-gain surplus at this waist, waist-to-height ratio or BMI (see Evidence › Safety limits).');
  }
  const gainCap = whtr >= 0.5 && whtr < 0.6 ? HC.surplus.gainPctBwWkWhtr : HC.surplus.gainPctBwWk;

  // ---- protein (HC-M1/M2)
  let pFloor: number = age >= 65 ? HC.protein.floorAge65Maintenance : HC.protein.floor;
  let pFloorDef: number = HC.protein.floorDeficitOrAge65;
  // hard caps are 35 %E and 3.1 g/kg FFM (applied per day by repair); 2.2 g/kg RW is only a soft target (17 HC-M2)
  let pCap = Infinity;
  let lpFloor = lockFloorOf('proteinPerKg');
  if (practical?.proteinFloorGPerKg !== undefined && Number.isFinite(practical.proteinFloorGPerKg))
    lpFloor = Math.max(lpFloor ?? 0, practical.proteinFloorGPerKg);
  if (lpFloor !== undefined) {
    pFloor = Math.max(pFloor, lpFloor);
    pFloorDef = Math.max(pFloorDef, lpFloor);
  }
  const lpCap = lockCapOf('proteinPerKg');
  if (lpCap !== undefined) pCap = Math.min(pCap, lpCap);
  // a preference floor yields to a safety cap; a mandatory lock floor above a cap is reported as a conflict
  // (`constraints.conflicts`), never silently passed as compliant

  // Clinical orders retain their original sources and applicability. Planning caps guide repair only; the final
  // evaluator independently checks the unclipped conjunction on the actual schedule.
  const renalConflicts: RenalConflict[] = [];
  let gFloor: number | null = null;
  let gCap: number | null = null;
  let basis: WeightBasis | null = null;
  for (const b of clinical.bounds) {
    const d = b.normalized;
    if (b.status !== 'enforceable' || !d || d.quantity !== 'proteinPerDay' || d.scope !== 'total' || d.window.kind !== 'day') continue;
    basis ??= b.def.basis;
    if (d.comparator === 'cap') gCap = gCap === null ? d.value : Math.min(gCap, d.value);
    else gFloor = gFloor === null ? d.value : Math.max(gFloor, d.value);
  }
  const habitualProvenance = documentedHabitualNutrition(rp.input);
  const habitualProteinG = habitualProvenance.protein ? habitualProvenance.protein.value * habitualProvenance.protein.basisKg : null;
  const withheld = renalActive ? clinical.withheld.length ? clinical.withheld : (clinical.context === 'none' ? RENAL_DOMAINS : []) : [];
  const hold = withheld.includes('protein') && habitualProteinG !== null ? habitualProteinG / rwKg : null;
  if (gCap !== null) pCap = Math.min(pCap, gCap / rwKg);
  if (gFloor !== null) {
    pFloor = Math.max(pFloor, gFloor / rwKg);
    pFloorDef = Math.max(pFloorDef, gFloor / rwKg);
  }
  if (gCap !== null) {
    for (const [id, v] of [['HC-M1', pFloor], ['HC-M1.deficit', pFloorDef]] as const)
      if (v > gCap / rwKg + 1e-9) renalConflicts.push({ id, yielded: { id, value: v }, governs: { id: 'renal.cap', value: gCap / rwKg }, unit: 'g/kg/d' });
  }
  if (hold !== null) {
    for (const [id, v] of [['HC-M1', pFloor], ['HC-M1.deficit', pFloorDef]] as const)
      if (v > hold + 1e-9) renalConflicts.push({ id, yielded: { id, value: v }, governs: { id: 'renal.held', value: hold }, unit: 'g/kg/d' });
    // Repair must retain the documented routine even where another mandatory policy conflicts with it.
    pFloor = hold;
    pFloorDef = hold;
    pCap = hold;
  }
  const hasReview = clinical.status === 'review' || clinical.needsReview.length > 0 || renalCtx === 'priorAbnormalityReview';
  const renal: RenalScopeCaps = {
    status: !renalActive ? 'none' : withheld.length ? (hasReview ? 'review' : 'incomplete') : 'entered',
    context: clinical.context === 'none' ? renalCtx : clinical.context,
    withheld,
    envelopeIds: clinical.applicable.map((e) => e.id),
    proteinGPerDay: gFloor !== null || gCap !== null ? { floor: gFloor, cap: gCap, basis } : null,
    heldProteinGPerKgRw: hold,
    reasonCode: !renalActive ? 'none' : hasReview ? (renalCtx === 'priorAbnormalityReview' ? 'priorAbnormality' : 'envelopeNotApplicable') : withheld.length ? 'contextIncomplete' : 'envelopeEntered',
    conflicts: renalConflicts, clinical, habitualProteinG, habitualProvenance,
  };
  if (renalActive) reasons.push(hold !== null ? 'Kidney: protein stays at your documented usual intake; other limits follow entered guidance.' : withheld.includes('protein') ? 'Kidney: protein authority needs documented routine or applicable clinician guidance.' : 'Kidney: nutrition follows the applicable values entered from your clinician.');

  // ---- fat (HC-M3 + lock)
  let fatFloor: number = HC.fat.minG;
  const lf = strictestUntyped(locks, 'fat-floor');
  if (lf !== undefined) fatFloor = Math.max(fatFloor, lf);

  // ---- carbohydrate (HC-M4, HC-P3, 17 §4.2 keto exclusions)
  let carbFloor = 0;
  let keto = mode === 'M0' && !restr.has('R1') && !restr.has('R2');
  if (pf.kidneyDisease || pf.liverDisease || pf.gout || pf.pancreatitis || pf.fatOxidationDisorderOrPorphyria || med === 'sglt2' || pf.type1Diabetes)
    keto = false;
  if (hasLock(locks, 'no-ketogenic')) keto = false;
  if (!keto) carbFloor = HC.carbs.ketogenicG;
  if (restr.has('R1')) carbFloor = Math.max(carbFloor, 100);
  const lc = lockFloorOf('carbPerDay');
  if (lc !== undefined) carbFloor = Math.max(carbFloor, lc);
  if (practical?.carbFloorGPerDay !== undefined && Number.isFinite(practical.carbFloorGPerDay)) carbFloor = Math.max(carbFloor, practical.carbFloorGPerDay);

  // ---- fasting tiers (HC-F1, 17 §4.3.2 / §4.3.4)
  // consent: explicit opt-in, else implied by the screening's effective cap (> 24 h ⇒ T2, > 48 h ⇒ T3), else the profile flag
  const capH = input?.fasting?.maxFastHours;
  const impliedTier = capH === undefined ? null : capH > HC.tierMaxH.T3 ? 'T4' : capH > HC.tierMaxH.T2 ? 'T3' : capH > HC.tierMaxH.T1 ? 'T2' : null;
  const optTier = input?.optIns?.fastingTier ?? impliedTier ?? (pf.fastingOptIn && pf.fastingOptIn !== 'none' ? pf.fastingOptIn : null);
  const exAll12 = pf.pregnantOrBreastfeeding || pf.planningPregnancy || restr.has('R1') || pf.eatingDisorderRisk || (med && med !== 'none') || pf.type1Diabetes;
  const exT2 =
    pf.kidneyDisease || pf.liverDisease || pf.cardiovascularOrBp || pf.gout || pf.fatOxidationDisorderOrPorphyria || pf.heavyAlcoholUse ||
    pf.acuteIllnessLast4Weeks || pf.medicationInteraction || restr.has('R2');
  const exT3 = exT2 || pf.kidneyStones || pf.gallstones;
  const tiers: Record<FastTier, boolean> = { T0: true, T1: true, T2: false, T3: false, T4: false, T5: false };
  if (exAll12 || pf.heavyAlcoholUse || pf.acuteIllnessLast4Weeks) tiers.T1 = false;
  // D4-07: without an applicable renal envelope no autonomous fasting prescription (zero days carry sodium and fluid
  // numbers, renal-targeted domains); kidney context already excludes fasts beyond 24 h (exT2)
  const renalNoFast = renal.withheld.length > 0;
  if (renalNoFast) tiers.T1 = false;
  if (!exAll12 && !exT2 && age < 65 && (optTier === 'T2' || optTier === 'T3' || optTier === 'T4') && bmi >= HC.tierBmiMin.T2 && bf >= bfFloor + 2)
    tiers.T2 = true;
  if (tiers.T2 && !exT3 && (optTier === 'T3' || optTier === 'T4') && bmi >= HC.tierBmiMin.T3 && bf >= HC.t3BfMinPct[sex]) tiers.T3 = true;
  // T4 (> 72 h to 7 d): expert mode with clinician attestation (ruling 18:10; the UI keeps it flagged off), BMI ≥ 25, no
  // medication (17 §4.3.2 T4 row) and T3 eligibility; T5 (> 7 d) is never prescribed.
  if (tiers.T3 && input?.expertMode === true && optTier === 'T4' && bmi >= HC.tierBmiMin.T4 && !(med && med !== 'none') && !pf.medicationInteraction)
    tiers.T4 = true;
  let maxFast = exAll12 ? 12 : tiers.T4 ? HC.tierMaxH.T4 : tiers.T3 ? HC.tierMaxH.T3 : tiers.T2 ? HC.tierMaxH.T2 : tiers.T1 ? HC.tierMaxH.T1 : HC.tierMaxH.T0;
  const profileMaxFast = maxFast;
  const userFast = practical?.maxFastHours;
  if (userFast !== undefined && Number.isFinite(userFast)) maxFast = Math.min(maxFast, userFast);
  const lockFast = lockCapOf('fastHours');
  if (lockFast !== undefined) maxFast = Math.min(maxFast, lockFast);
  const inFast = input?.fasting?.maxFastHours;
  if (inFast !== undefined && Number.isFinite(inFast)) maxFast = Math.min(maxFast, inFast);
  // a tier is usable only when the effective cap reaches into it
  if (maxFast <= HC.tierMaxH.T0) tiers.T1 = false;
  if (maxFast <= HC.tierMaxH.T1) tiers.T2 = false;
  if (maxFast <= HC.tierMaxH.T2) tiers.T3 = false;
  if (maxFast <= HC.tierMaxH.T3) tiers.T4 = false;
  if (exAll12) reasons.push('No fasting longer than 12 hours for this profile (see Evidence › Safety limits).');
  const fastingLimitReason = exAll12
    ? 'fasting beyond 12 hours is excluded for your profile by the safety screening'
    : renalNoFast
      ? 'fasting needs your clinician’s kidney nutrition limits first'
    : userFast !== undefined && userFast < profileMaxFast
      ? `you set your longest acceptable fast to ${Math.round(userFast)} hours`
      : maxFast <= HC.tierMaxH.T1
        ? 'fasts longer than 24 hours need an opt-in in your safety settings'
        : maxFast <= HC.tierMaxH.T3
          ? `your fasting opt-in allows fasts up to ${Math.round(maxFast)} hours`
          : 'expert mode allows fasts up to 7 days';

  // ---- eating window (HC-F5)
  const shortWin = !!(input?.optIns?.shortEatingWindow && (input?.fasting?.shortWindowAvailable ?? true));
  let minWindow: number = shortWin ? HC.window.optInMin : HC.window.defaultMin;
  if (restr.has('R1')) minWindow = Math.max(minWindow, HC.window.r1Min);
  const lw = strictestUntyped(locks, 'min-eating-window');
  if (lw !== undefined) minWindow = Math.max(minWindow, lw);
  if (maxFast < HC.tierMaxH.T0) minWindow = Math.max(minWindow, 24 - maxFast);

  // ---- exercise (HC-X2..X5, locks; D4-02 symptom gate and reviewed envelopes)
  const today = rp.input.startDate ?? '';
  const g = exerciseGateOf(pf, today);
  const lockAllowed = !hasLock(locks, 'no-exercise-prescription');
  const env = g.envelope;
  const envPermits = (d: ClinicianExerciseEnvelope['permitted'][number]) => !!env && env.progressionAllowed && env.permitted.includes(d);
  const gated = g.gate === 'suspended' || g.gate === 'reviewNeeded';
  const rtAllowed = lockAllowed && (g.gate === 'none' || (g.gate === 'envelope' && envPermits('resistance')));
  const cardioAllowed = lockAllowed && (g.gate === 'none' || (g.gate === 'envelope' && envPermits('cardio')));
  // steps: under the gate no step progression above the documented baseline or the envelope's ceiling; without a
  // documented baseline the plan holds the habit (no new numeric step target, never a 3 000 / 12 000 default)
  const documented = rp.input.habits?.typicalSteps;
  const stepsBaselineDocumented = typeof documented === 'number' && Number.isFinite(documented) && documented >= 0;
  const habitSteps = Math.max(0, rp.habits.typicalSteps);
  let stepsCeiling: number | null = null;
  if (gated) stepsCeiling = habitSteps;
  else if (g.gate === 'envelope') {
    const own = env!.stepsCeiling;
    const progress = env!.progressionAllowed && (env!.permitted.includes('steps') || env!.permitted.includes('walking'));
    stepsCeiling = typeof own === 'number' && Number.isFinite(own) ? Math.max(0, own) : progress ? null : habitSteps;
  }
  // (A1-003) every clinician intensity maximum of an envelope in force on the start date (the governing one included),
  // in a deterministic order; a missing intensity adds nothing (the generic bands stay)
  const intensityCaps: ExerciseIntensityCap[] = [...(pf.exerciseEnvelopes ?? [])]
    .filter((e) => !!e.intensity && envelopeCurrent(e, today))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => normalizeIntensityCap(e)!)
    .filter((c): c is ExerciseIntensityCap => c !== null);
  // (A1-004) date-dependent envelope eligibility over the prescription's own dates: the first entered review date or
  // withdrawal after the start at which no envelope governs the symptoms any more
  let gateChange: SafetyCaps['exercise']['gateChange'] = null;
  if (g.gate === 'envelope' && today) {
    const dates = new Set<string>();
    for (const e of pf.exerciseEnvelopes ?? []) {
      if (e.reviewBy) dates.add(addIsoDays(dateOf(e.reviewBy), 1));
      if (e.revokedAt) dates.add(dateOf(e.revokedAt));
    }
    for (const date of [...dates].filter((x) => x > today).sort()) {
      const later = exerciseGateOf(pf, date).gate;
      if (later === 'suspended' || later === 'reviewNeeded') {
        gateChange = { day: isoDaysBetween(today, date), date, gate: later };
        break;
      }
    }
  }
  if (g.gate === 'suspended') reasons.push('No new exercise or step increase while a reported symptom is unresolved.');
  else if (g.gate === 'reviewNeeded') reasons.push('No new exercise or step increase until the symptom questions are answered.');
  else if (g.gate === 'envelope') reasons.push('Exercise follows the activity limits you entered from your clinician.');
  const exercise: SafetyCaps['exercise'] = {
    allowed: rtAllowed || cardioAllowed,
    rtAllowed,
    cardioAllowed,
    // a reviewed envelope keeps light-moderate intensity unless it states otherwise; the historical symptom flag keeps
    // its light-moderate rule; asymptomatic BP risk and musculoskeletal limits keep their own rules
    lightModerateOnly: hasLock(locks, 'exercise-light-moderate') || !!pf.exerciseRestriction || !!pf.faintingOrChestPain || !!pf.cardiovascularOrBp || g.gate !== 'none',
    lowImpact: hasLock(locks, 'exercise-low-impact'),
    noVigorousOutdoor: !!pf.hotClimate,
    gate: g.gate,
    stepsCeiling,
    stepsBaselineDocumented,
    habitualTrainingAllowed: lockAllowed && !gated && (g.gate !== 'envelope' || (env!.permitted.includes('resistance') || env!.permitted.includes('cardio'))),
    symptomIds: g.symptomIds,
    envelopeId: env?.id ?? null,
    intensityCaps,
    gateChange,
  };
  let creatineAllowed = !hasLock(locks, 'no-creatine') && !pf.kidneyDisease && !flags.has('kidney-disease');

  // E20/D4-01: numeric lab locks (blood-marker rules), typed and intersected above. Creatine, caffeine, total fat,
  // alcohol and the surplus cap are enforced on the plan (repair, validator, final resolved check); saturated fat and
  // added sugar have no resolved exposure channel in a macro prescription (unsupported: the plan's safety stays
  // unchecked for a mandatory one). No enforcement sentence is written here: verified limits are reported after the
  // final check (`safetyAudit.ts`).
  const creatineCap = lockCapOf('creatinePerDay');
  if (creatineCap !== undefined && creatineCap <= 0 && creatineAllowed) {
    creatineAllowed = false;
    reasons.push('The plan will not add creatine because of a blood result (your own use is not refused).');
  }
  const creatineMaxG = creatineCap !== undefined && creatineCap > 0 ? Math.min(HC.creatineMaxG, creatineCap) : HC.creatineMaxG;
  let surplusPhaseMaxPct = !surplusAllowed ? 100 : waist > HC.surplus.cautionWaistCm[sex] || whtr >= HC.surplus.cautionWhtr ? 104.5 : HC.surplus.maxPctTdee;
  let maxPctTdee: number = surplusAllowed ? HC.surplus.maxPctTdee : 100;
  const surplusLock = lockCapOf('energyPctOfMaintenance');
  // a surplus cap that needs review or contradicts policy plans no surplus (conservative) and keeps its status
  const surplusOpen = constraints.review.some((r) => r.id === 'surplus-cap');
  const surplusMax = surplusOpen ? Math.min(100, surplusLock ?? 100) : surplusLock;
  if (surplusMax !== undefined && surplusMax < maxPctTdee) {
    maxPctTdee = Math.max(100, surplusMax);
    surplusPhaseMaxPct = Math.min(surplusPhaseMaxPct, maxPctTdee);
    if (!surplusOpen) reasons.push(`Planned intake kept at or below ${Math.round(maxPctTdee)} % of maintenance because of a blood result.`);
  }
  const caffeineMaxMgPerDay = lockCapOf('caffeinePerDay') ?? null;
  const fatMaxPctEnergy = lockCapOf('fatPctEnergy') ?? null;

  return {
    blocked,
    sex,
    ageYears: age,
    bmi,
    bodyFatPct: bf,
    bfFloorPct: bfFloor,
    whtr,
    rwKg,
    weightKg: rp.weightKg,
    ffmKg: rp.ffm0Kg,
    tdee0Kcal: rp.tdee0Kcal,
    deficitCapPct: cap,
    rateCapPct: rate,
    rateCapKg: rateKg,
    surplusAllowed,
    gainCapPct: gainCap,
    maxPctTdee,
    surplusPhaseMaxPct,
    // HC-E1 applies to deficits only: when maintenance itself is below the floor, the effective planning floor is
    // maintenance (no deficit possible, maintenance allowed)
    energyFloorKcal: Math.min(HC.energyFloorKcal[sex], rp.tdee0Kcal),
    restrictedDayUpperKcal: HC.restrictedDay.upperKcal[sex],
    restrictedDayMinKcal: HC.restrictedDay.minKcal[sex],
    proteinFloorRw: pFloor,
    proteinFloorDeficitRw: pFloorDef,
    proteinCapRw: pCap,
    proteinCapGPerKgFfm: HC.protein.capGPerKgFfm,
    fatFloorG: fatFloor,
    carbFloorG: carbFloor,
    ketogenicAllowed: carbFloor < HC.carbs.ketogenicG,
    creatineAllowed,
    maxFastH: maxFast,
    fastingLimitReason,
    fastTierAllowed: tiers,
    fastingOptIn: optTier === 'T2' || optTier === 'T3' || optTier === 'T4' ? optTier : null,
    minWindowH: minWindow,
    exercise,
    creatineMaxG,
    caffeineMaxMgPerDay,
    fatMaxPctEnergy,
    constraints,
    renal,
    rtNovice: rp.habits.trainingHistory === 'none' || rp.habits.trainingHistory === 'lt1y',
    sedentaryStart: rp.habits.sessionsPerWeek === 0,
    mode,
    flags,
    optInLevers: new Set(input?.optIns?.levers ?? []),
    noWeightLossGoal: hasLock(locks, 'no-weight-loss-goal') || restr.has('R1'),
    reasons,
  };
}

/** Withheld domains cannot acquire autonomous targets through alternate decode or repair paths. */
export function retainRenalRoutine(schedule: Schedule, caps: SafetyCaps): Schedule {
  const withheld = caps.renal.withheld;
  if (!withheld.length) return schedule;
  const apply = (t: Partial<Schedule['programs'][number]>) => {
    if (withheld.includes('protein') && caps.renal.habitualProteinG !== null && t.macros)
      t.macros = { ...t.macros, protein: { unit: 'g', value: caps.renal.habitualProteinG } };
    if (t.hydration) {
      const h = { ...t.hydration };
      if (withheld.includes('sodium')) delete h.sodiumG;
      if (withheld.includes('fluid')) delete h.fluidL;
      if (withheld.some((d) => d === 'sodium' || d === 'potassium')) delete h.electrolytes;
      t.hydration = Object.keys(h).length ? h : undefined;
    }
  };
  schedule.programs.forEach(apply);
  schedule.days.forEach((d) => { if (d.override) apply(d.override); });
  return schedule;
}

/** Unclipped general protein requirement for one actual resolved exposure window (HC-M1). */
export function generalProteinFloor(caps: Pick<SafetyCaps, 'ageYears' | 'rwKg'>, deficitPct: number): ConstraintDef {
  const deficit = deficitPct > HC.proteinDeficitThresholdPct;
  const perKg = deficit ? HC.protein.floorDeficitOrAge65 : caps.ageYears >= 65 ? HC.protein.floorAge65Maintenance : HC.protein.floor;
  return policyDef(deficit ? 'HC-M1.deficit' : 'HC-M1', { quantity: 'proteinPerDay', unit: 'g/d', comparator: 'floor', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' }, perKg * caps.rwKg);
}

/** Fasting tier permission for a planned zero-intake span of `h` hours (HC-F1, §10.3 tier data). */
export function fastAllowed(caps: SafetyCaps, h: number): boolean {
  if (h > caps.maxFastH + 1e-6) return false;
  return caps.fastTierAllowed[tierForHours(h)];
}
