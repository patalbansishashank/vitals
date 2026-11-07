/**
 * Person profile contracts (docs/MODEL_SPEC.md §5.1).
 *
 * `PersonProfile` is what the UI collects (Your body + Habits + safety screen). Body-composition estimation is owned by
 * `src/engine/body` (dossier 14); its `BodyInputs` are embedded unchanged so the two cannot drift. `ResolvedProfile`
 * is produced once per run by `core/resolveProfile` and is read-only for every module.
 */
import type { BodyEstimate, BodyInputs, Sex } from '../body/types';
import type { ClinicalNutritionEnvelope, ClinicianExerciseEnvelope, RenalContextStatus, ScreeningAnswer, SymptomReport } from '@/lib/bodyContracts';
import type { GfrQuantityKind, LabSampleContext } from '@/lib/measurementOperators';
import type { StepsScope } from './schedule';
import type { RenalScope } from '@/lib/renalScope';

export type { Sex } from '../body/types';

/** Physiological sex used by the equations. `unspecified` = average of both equation sets with wider bands (your-body.md). */
export type PhysiologySex = Sex | 'unspecified';

export type StressLevel = 'low' | 'moderate' | 'high';
export type SleepQuality = 'poor' | 'fair' | 'good';
export type TrainingHistory = 'none' | 'lt1y' | '1to3y' | 'gt3y';
export type DietAnimalLevel = 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan';
export type ContraceptionKind = 'none' | 'combinedOral' | 'progestinOnly' | 'iud' | 'other';

/** Dossier 17 §1.1 user modes (derived by the onboarding gate; only flags are stored, never raw answers). */
export type SafetyMode = 'M0' | 'R1' | 'R2' | 'H';

/** Dossier 17 §4.1-4.4 flags. All optional; absent = false. The engine only reads them for warnings/tiers. */
export interface SafetyFlags {
  pregnantOrBreastfeeding?: boolean;
  planningPregnancy?: boolean;
  eatingDisorderRisk?: boolean;
  diabetesMedication?: 'none' | 'insulin' | 'sulfonylurea' | 'sglt2' | 'metforminOnly' | 'glp1' | 'dietOnly';
  type1Diabetes?: boolean;
  cardiovascularOrBp?: boolean;
  kidneyDisease?: boolean;
  /** Current evaluated nutrition-guidance scope, with lossless review and rejection reasons. */
  renalScope?: RenalScope;
  liverDisease?: boolean;
  gout?: boolean;
  kidneyStones?: boolean;
  gallstones?: boolean;
  pancreatitis?: boolean;
  fatOxidationDisorderOrPorphyria?: boolean;
  medicationInteraction?: boolean;
  faintingOrChestPain?: boolean;
  exerciseRestriction?: boolean;
  heavyAlcoholUse?: boolean;
  acuteIllnessLast4Weeks?: boolean;
  /** SARC-F score (age >= 65 only). */
  sarcF?: number;
  /** Fasting-tier opt-ins granted by the user (17 §4.3): T2/T3 opt-in, T4 expert mode + clinician attestation. */
  fastingOptIn?: 'none' | 'T2' | 'T3' | 'T4';
  hotClimate?: boolean;
  // ---- contract additions 2026-10-18 (C5; optional, absent = not entered)
  /**
   * Tri-state answers behind the boolean flags (C5/D7-03): 'unknown'/'preferNot' stay distinct from a negative screen.
   * Keyed by flag name. Absent = the legacy reading of the boolean (the gate may still ask).
   */
  answers?: Readonly<Partial<Record<string, ScreeningAnswer>>>;
  /** D4-02: reported symptoms with status/date; unresolved concerning exertional symptoms suspend exercise progression. */
  symptoms?: readonly SymptomReport[];
  /** D4-02: reviewed exercise envelopes (permitted activities, intensity, steps ceiling, progression, dates). */
  exerciseEnvelopes?: readonly ClinicianExerciseEnvelope[];
  /** D4-07: renal context (legacy kidneyDisease=true reads as 'contextIncomplete', never as a stage). */
  renalContext?: RenalContextStatus;
  /** D4-07: clinician-directed nutrition envelopes with explicit weight basis and bounds. */
  nutritionEnvelopes?: readonly ClinicalNutritionEnvelope[];
}

/** Training growth state with provenance (D3-05); legacy "currently training" never becomes 'plateaued'. */
export type TrainingGrowthState = 'progressing' | 'plateaued' | 'resuming' | 'unknown';

/** Documented weekly cardio routine. Intensity remains a model assumption, not an observation. */
export interface HabitualCardio {
  modality: 'cycle';
  sessionsPerWeek: number;
  minutesPerSession: number;
  /** Monday = 0; explicit days preserve a reported rest day. */
  weekdays: readonly number[];
  source: 'userReport';
  /** Exact raw recreation row reclassified as this training routine, when it came through activity intake. */
  recreationSourceId?: string;
}

/** Habitual behaviour (Your body → Habits). Every field has a default in core/defaults.ts (MODEL_SPEC §5.1). */
export interface HabitProfile {
  trainingHistory?: TrainingHistory;
  /** Resistance + cardio sessions per week, 0..14. */
  sessionsPerWeek?: number;
  /** 0 = only lifting, 1 = only cardio. */
  lifingCardioMix?: number;
  /** Additional documented cardio alongside the legacy session mix; record it here instead of recreation. */
  habitualCardio?: HabitualCardio;
  typicalSteps?: number;
  /** Clock hours (0..24) of habitual bedtime and wake time. */
  bedTimeH?: number;
  wakeTimeH?: number;
  /** Documented habitual asleep duration, independent of unknown bed/wake clock times. */
  habitualSleepDurationH?: number;
  habitualSleepDurationSource?: 'deviceSummary' | 'userReport';
  sleepQuality?: SleepQuality;
  stress?: StressLevel;
  /** Habitual intake composition used for baseline (EI0 macro split, glycogen/ketone burn-in). */
  habitualProteinGPerKg?: number;
  habitualCarbPctEnergy?: number;
  habitualFibreGPer1000Kcal?: number;
  habitualSodiumG?: number;
  habitualCaffeineMg?: number;
  habitualAlcoholDrinksPerWeek?: number;
  habitualMealsPerDay?: number;
  habitualWindowStartH?: number;
  habitualWindowLengthH?: number;
  dietAnimalLevel?: DietAnimalLevel;
  /** 0..1 energy share from ultra-processed food (dossier 15 default 0.55). */
  upfShare?: number;
  /** Food quality/variety selector 1..3 (dossier 15 §4.9). */
  foodQuality?: 1 | 2 | 3;
  multivitamin?: boolean;
  /**
   * Current smoker (dossier 16 §4.2.1: caffeine half-life ×0.56). Default false. Added 2026-09-30 (additive).
   */
  smoker?: boolean;
  /**
   * Habitual energy from beverages, kcal/d (dossier 12 §4.9.2 satiety reference). Resolved NaN when not given = the
   * appetite module's population reference. Added 2026-09-30 (additive).
   */
  habitualLiquidKcal?: number;
  /**
   * Habitual non-beverage energy density, kcal/g (dossier 12 §4.9.2 / 15 §4.6). Resolved NaN when not given = derived
   * from `upfShare` like a day without an override. Added 2026-09-30 (additive).
   */
  habitualEnergyDensityKcalPerG?: number;
  /**
   * Structured "what does a normal day look like" answers (plan/01-after-launch R1 §3.5; MODEL_SPEC §5.5). Absent = the
   * pre-intake behaviour (steps = `typicalSteps` ?? 7 000, no non-step activity terms). Present = TDEE0 by the R1 §3.1
   * equation (steps + occupation + home + commute + recreation, all inside NEAT0); every field may be skipped and then
   * takes the R1 default (an all-skipped intake resolves to the population mixture, PAL ≈ 1.55). Added 2026-10-01 (additive).
   */
  activity?: ActivityIntake;
  /** D3-07: what the habitual step number counts (legacy = unknown, never assumed either way). */
  stepsScope?: StepsScope;
  /**
   * D3-07/A1-040: whether (and how many of) the habitual sessions' locomotor steps are inside `typicalSteps`. Absent or
   * `status: 'unknown'` = the habitual reference overlap is unresolved: the run keeps a named no-subtraction reference
   * scenario and discloses it, even when every current-day overlap is known. Never derived from a generic cardio mix,
   * a guessed cadence or a copy of current steps without physical bout identity.
   */
  habitualStepsOverlap?: HabitualStepsOverlap;
  /** D3-05: growth state and where it came from (default unknown; numerical burn-in anchoring stays until it ships). */
  trainingGrowthState?: TrainingGrowthState;
  trainingGrowthStateSource?: 'user' | 'observedTrend' | 'unknown';
}

/**
 * Habitual step/session overlap (D3-07/A1-040), the reference-side twin of a current day's `sessionIncludedSteps`. With the
 * same known physical bouts on both sides the step-only current − habitual difference is exactly 0; `excludesTraining`
 * scope subtracts neither side.
 */
export interface HabitualStepsOverlap {
  status: 'known' | 'unknown';
  /** Weekly-mean locomotor steps of the habitual sessions inside `typicalSteps`, steps/d (known only; 0 = known none). */
  includedStepsPerDay?: number;
  /** Identified habitual bouts behind it (stable identities a current logged bout can match), when known. */
  bouts?: ReadonlyArray<{ boutId: string; weekday?: number; stepsIncluded: number }>;
  source?: 'user' | 'observedHistory' | 'unknown';
}

// ------------------------------------------------------------------ activity intake (R1, MODEL_SPEC §5.5; additive 2026-10-01)

/**
 * Work or study outside the home on a work day (R1 Q1-Q2). People classify by example better than by label; the UI shows
 * 2-3 job examples per class (R1 §5). `notWorking` = retired, at home, caring (no occupational term, no work days);
 * `unknown` = skipped (population mixture of the classes, R1 §3.2 prior shares).
 *  desk           sitting at a desk or driving (office, driving, call centre)
 *  mixed          a mix of sitting and moving (lab, teaching at a desk, managers on the floor)
 *  onFeet         on my feet most of the time (retail, hospitality, nursing, teaching, hairdressing)
 *  manualModerate physical work: lifting, carrying (trades, warehouse, cleaning, moderate farming)
 *  manualHeavy    heavy physical work (construction, heavy farming, forestry, removals)
 */
export type WorkClass = 'desk' | 'mixed' | 'onFeet' | 'manualModerate' | 'manualHeavy' | 'notWorking' | 'unknown';
/** How the person gets to work (R1 Q4): `none` = works from home; `walk` / `mixed` = walks all or part of it; `cycle`. */
export type CommuteMode = 'none' | 'passive' | 'walk' | 'cycle' | 'mixed';
/**
 * Where the step number comes from (R1 Q5): wrist device history > phone app > a rough number > not known. (SPEC V1.4,
 * 2026-10-27) `fused` = the ring/phone step fusion `steps-fuse/1` (one selected source per interval); cv 0.10 like a wrist
 * device until validated (product default (P), RESEARCH II.5 — no 95 % claim).
 */
export type StepsSource = 'wrist' | 'phone' | 'fused' | 'estimate' | 'unknown';
/** A day off (R1 Q6). */
export type OffDayPattern = 'mostlyHome' | 'mixed' | 'outAndAbout';
/** Time on feet at home: chores, cooking, children (R1 Q7): a little (< 1 h), some (1-2 h), a lot (3 h +). */
export type OnFeetAtHome = 'little' | 'some' | 'aLot';
export type RecreationIntensity = 'light' | 'moderate' | 'vigorous';

/** A sport or active hobby that is NOT the planned training (R1 Q8; listing gym or running belongs to Training). */
export interface RecreationEntry {
  /** Stable source identity, when one is supplied; never inferred from a label. */
  id?: string;
  /** Free text shown back to the user (football, hiking, dancing, gardening …). */
  label: string;
  intensity: RecreationIntensity;
  /** Minutes per week, ≥ 0. */
  minPerWeek: number;
}

/** Step answer (R1 Q5). Prefer the last 2-4 weeks of history recorded before the app (a fresh baseline week reads high). */
export interface StepsAnswer {
  source: StepsSource;
  /** Mean steps on a work day / a day off, steps/d. Either may be given alone; the other is derived from the answers. */
  workday?: number;
  offDay?: number;
  /** One weekly-mean number, steps/d (wins over workday/offDay). */
  weeklyMean?: number;
  /** Days of history behind the number (informational: R1 gives no numeric correction; UI asks for 14-30). */
  daysOfHistory?: number;
  /** Phone source only: is the phone with the person most of the day? false → wider band (R1 Q5a). */
  phoneCarried?: boolean;
}

/** Answers of the activity intake (R1 §3.5, §5). Every field optional ("I don't know" is first-class); defaults in DEFAULTS.activity. */
export interface ActivityIntake {
  /** Engine-only projection record: the named source rows are represented by habitualCardio instead. */
  recreationProjection?: { basis: 'reclassifiedHabitualCardio'; removedSourceIds: readonly string[]; sourceMinutesPerWeek: number };
  /** R1 Q1-Q2. Default 'unknown'. */
  work?: WorkClass;
  /** Work days per week, 0..7. Default 5 (0 when notWorking). */
  workDaysPerWeek?: number;
  /** Hours per work day, 2..14. Default 8. */
  workHoursPerDay?: number;
  /** R1 Q4. Default passive, 0 min. `activeMinPerWorkday` = walking or cycling minutes per work day (both ways). */
  commute?: { mode: CommuteMode; activeMinPerWorkday?: number };
  /** R1 Q5. Default unknown (derived from the work and off-day answers). */
  steps?: StepsAnswer;
  /** R1 Q6. Default 'mixed'. */
  offDay?: OffDayPattern;
  /** R1 Q7. Default 'some'. */
  onFeetAtHome?: OnFeetAtHome;
  /** R1 Q8. Default none. */
  recreation?: readonly RecreationEntry[];
}

/** Components of the baseline maintenance, R1 §6 display order; kcal/d each, Σ = TDEE0. */
export type ActivityDriverId = 'rmr' | 'dailyLiving' | 'steps' | 'work' | 'home' | 'commute' | 'recreation' | 'training' | 'digestion';

export interface ActivityDriver {
  readonly id: ActivityDriverId;
  /** Contribution to TDEE0, kcal/d. */
  readonly kcal: number;
  /** This component's 1-SD uncertainty on the TDEE0 scale, kcal/d (0 for exact terms); Σ of squares ≈ σ² before the floor. */
  readonly sigmaKcal: number;
}

/** NASEM 2023 PAL category of PAL0 = TDEE0/RMR0 (02 §4.6: < 1.53 / < 1.68 / < 1.85 / ≥ 1.85) — a comparison, never a self-label. */
export type NeatLevel = 'inactive' | 'lowActive' | 'active' | 'veryActive';

/** What `resolveActivity` needs from the profile (all at t = 0). `ResolvedActivity.base` echoes it for live what-ifs. */
export interface ActivityBase {
  /** Body mass, kg. */
  readonly weightKg: number;
  /** RMR0, kcal/d. */
  readonly rmr0Kcal: number;
  /** Habitual exercise energy EAT0, kcal/d (sessions; unchanged by the intake). */
  readonly eat0Kcal: number;
  /** TEF fraction α0 of the habitual diet at TDEE0 (TDEE0 = numerator/(1 − α0)). */
  readonly tefFraction: number;
  /** RMR route (02 §4.1): measured, FFM-based (body fat measured), or the size-and-age equation. */
  readonly rmrRoute: 'measured' | 'ffm' | 'equation';
  /** The old "typical steps" tick (`habits.typicalSteps`), used as a rough steps answer when the intake has none. */
  readonly typicalSteps?: number;
}

/** Resolved habitual activity and baseline maintenance (MODEL_SPEC §5.5). All energies kcal/d, weekly means. */
export interface ResolvedActivity {
  /** 'intake' = `habits.activity` given; 'default' = pre-intake behaviour (steps tick or 7 000, no non-step terms). */
  readonly source: 'default' | 'intake';
  /** True when a core question (work class or a step number) was answered; drives the band floor (R1 §3.4). */
  readonly answered: boolean;
  /** Weekly-mean habitual steps S_hab = engine `habits.typicalSteps` (activity `habSteps`), steps/d. */
  readonly steps: number;
  /** Steps on a work day / a day off, steps/d (equal to `steps` when only a mean is known). */
  readonly stepsWorkday: number;
  readonly stepsOffDay: number;
  /** Where the step number came from ('default' = 7 000 population default). */
  readonly stepsSource: StepsSource | 'default';
  /** Relative SD of the step number (R1 §3.4: wrist 0.10, phone 0.25 / 0.35, rough or derived 0.40). */
  readonly stepsCv: number;
  /** Resolved answers (defaults applied). */
  readonly work: WorkClass;
  readonly workDaysPerWeek: number;
  readonly workHoursPerDay: number;
  /** Step energy kBW·S_hab, kcal/d. */
  readonly stepsKcal: number;
  /** E_occ = BW·h_work·e_occ·d_w/7, kcal/d (above seated rest, steps excluded). */
  readonly occupationalKcal: number;
  /** E_home = BW·h_feet_home·e_home, kcal/d. */
  readonly homeKcal: number;
  /** Commute: cycling E_cyc plus, when steps were derived from the answers, the walking commute's step energy, kcal/d. */
  readonly commuteKcal: number;
  /** E_rec (sport and hobbies that are not planned training), kcal/d. */
  readonly recreationKcal: number;
  /** E_occ + E_home + E_cyc + E_rec (after the PAL cap), kcal/d — lives inside NEAT0. */
  readonly nonStepKcal: number;
  /** Habitual net activity above seated rest excluding planned training: (steps + non-step energy)/BW, MET-h/d. */
  readonly metHoursPerDay: number;
  /** NEAT0 before the burn-in calibration = TDEE0 − RMR0 − TEF0 − EAT0, kcal/d. */
  readonly neatKcal: number;
  /** PAL0 = TDEE0/RMR0 (after the cap). */
  readonly pal0: number;
  /** NASEM category of PAL0. */
  readonly neatLevel: NeatLevel;
  /** 'high' = PAL0 above 2.4 (hard to sustain, warn); 'capped' = the answers gave > 2.5 and the non-step terms were scaled down. */
  readonly palFlag: 'ok' | 'high' | 'capped';
  /** Baseline maintenance TDEE0 = EI0, kcal/d (equals `ResolvedProfile.tdee0Kcal`). */
  readonly tdee0Kcal: number;
  /** R1 §3.4 band: σ = max(√Σσ²_i/(1 − α0), floor·TDEE0); p10/p90 = TDEE0 ∓ 1.2816σ. */
  readonly uncertainty: {
    readonly sigmaKcal: number;
    /** σ/TDEE0. */
    readonly relSigma: number;
    readonly p10: number;
    readonly p90: number;
    /** Relative floor applied (0.12 skip-all / no body composition, 0.10 answered or BF measured, 0.08 RMR measured). */
    readonly floor: number;
    /** True when the floor, not the components, set σ. */
    readonly floorApplied: boolean;
    /** Driver with the largest share of the component variance — the "biggest unknown" to offer a fix for (R1 §6). */
    readonly largest: ActivityDriverId;
  };
  /** Components in R1 §6 order; Σ kcal = TDEE0. */
  readonly drivers: readonly ActivityDriver[];
  /** The inputs used, for live what-ifs: `resolveActivity(changedIntake, resolved.activity.base)`. */
  readonly base: ActivityBase;
}

export interface CycleProfile {
  tracking: boolean;
  cycleLengthD?: number;
  /** ISO date of the last period start; day 0 of the simulation is placed relative to it. */
  lastPeriodStart?: string;
  contraception?: ContraceptionKind;
  // ---- contract additions 2026-10-18 (D8-07, D8-08, D4-04; optional)
  /** Observed period starts (ISO dates, any order); the calendar phase stays an estimate. */
  periodStarts?: readonly string[];
  /** Cycle regularity as told; irregular/unknown cycles use phase-average (mean-zero) effects. */
  regularity?: 'regular' | 'irregular' | 'unknown';
  /** Manually confirmed ovulation (LH test or clinician); never inferred from weight. */
  ovulation?: ReadonlyArray<{ date: string; method: 'lhTest' | 'clinician' | 'other' }>;
  /** Whether the person currently menstruates; never inferred from sex or menopause status alone (D8-08). */
  menstruating?: 'yes' | 'no' | 'unknown';
  /** Recent change in pattern (D4-04 concern input, not a diagnosis). */
  recentChange?: 'none' | 'missedPeriods' | 'newIrregularity' | 'unknown';
}

/**
 * Provenance of a lab baseline value (C4, D7-02/05/06/07): sample date/identity, quantity kind, fasting status, source,
 * freshness and whether it lies outside the model's calibration domain. Kept beside (not inside) `LabBaselines`.
 */
export interface LabBaselineMeta {
  /** Sample date (ISO local date, as confirmed). */
  measuredOn?: string;
  sampleId?: string;
  /**
   * (D7-06/A1-034) Sampling instant (ISO with offset) when known; absent = time unknown (never a guessed clock). Equivalent
   * instants in different offsets are the same draw; a date-only sample is compared by date only.
   */
  sampledAt?: string;
  /** (A1-034) Local clock hour of the draw when stated without a full instant. */
  sampleLocalClockH?: number;
  /** (A1-034) The person confirmed this value was drawn together with the reading of this sample id. */
  confirmedPairWith?: string;
  /** (A1-034) Exogenous insulin around the draw (pair rules refuse it); absent = unknown. */
  exogenousInsulin?: boolean;
  /**
   * (D7-06/A1-047) Explicitly known sample context (`LabSampleContext`, the shared pairing operator's own shape), retained
   * atomically with the chosen value (never inferred): illness at the draw, hard training in the previous 48 h, hours since
   * a fast ended, an explicit prolonged-fast protocol, hours into a logged fast. Absent fields stay unknown; missing context
   * alone never blocks an ordinary panel.
   */
  sampleContext?: LabSampleContext;
  source: 'marker' | 'manual' | 'body' | 'derived' | 'generated';
  /** eGFR: indexed vs absolute vs clearance vs ambiguous (no staging until confirmed). */
  quantityKind?: GfrQuantityKind;
  fastingStatus?: 'fasting' | 'nonFasting' | 'unknown';
  fastingHours?: number;
  /** D7-05: baseline usability, separate from unresolved history or a clinician-confirmed condition. */
  freshness?: 'current' | 'repeatDue' | 'expired';
  outOfDomain?: boolean;
  /** Derived values (nonHDL = TC − HDL from a matched panel) name their inputs and method. */
  derived?: { from: readonly string[]; method: string };
  /** Unit as entered/printed and the original value, when converted. */
  original?: { value: number; unit: string };
}

/** A dated medication change (D7-09): segments calibration and defers causal attribution; no dose advice is derived. */
export interface MedicationChange {
  id: string;
  medicationClass: 'insulin' | 'sulfonylurea' | 'sglt2' | 'glp1' | 'metformin' | 'antihypertensive' | 'statin' | 'thyroid' | 'hormonal' | 'other';
  change: 'start' | 'stop' | 'doseChange';
  date: string;
  note?: string;
}

/** Optional measured baselines. When absent, blood markers are shown as change from baseline only (17 §4.6). */
export interface LabBaselines {
  measuredRmrKcal?: number;
  vo2maxMlKgMin?: number;
  ldlMmolL?: number;
  hdlMmolL?: number;
  tgMmolL?: number;
  apoBgL?: number;
  fastingGlucoseMmolL?: number;
  fastingInsulinUuMl?: number;
  hba1cPct?: number;
  sbpMmHg?: number;
  dbpMmHg?: number;
  liverFatPct?: number;
  crpMgL?: number;
  urateMgDl?: number;
  leptinNgMl?: number;
  testosteroneNmolL?: number;
  igf1NgMl?: number;
  /** Blood-marker baselines (SUITE_SPEC §13.5.4); set from confirmed `markers` readings. Lp(a) keeps its entered unit. */
  lpaMgDl?: number;
  lpaNmolL?: number;
  nonHdlMmolL?: number;
  altUL?: number;
  astUL?: number;
  ggtUL?: number;
  creatinineMgDl?: number;
  egfr?: number;
  uacrMgG?: number;
  tshMiuL?: number;
  ft3PmolL?: number;
  hbGdL?: number;
  ferritinUgL?: number;
  b12PgMl?: number;
  vitDNgMl?: number;
  sodiumMmolL?: number;
  potassiumMmolL?: number;
}

export interface PersonProfile {
  schemaVersion: 1;
  /** Body inputs as collected by the Your-body screen (dossier 14); `sex` there is the physiology sex. */
  body: BodyInputs;
  /** When the user chose "prefer not to say", `body.sex` holds the equation set used for the P50 run and this is set. */
  sexUnspecified?: boolean;
  habits?: HabitProfile;
  cycle?: CycleProfile;
  menopause?: 'pre' | 'peri' | 'post';
  labs?: LabBaselines;
  safety?: { mode: SafetyMode; flags: SafetyFlags };
  /** ISO date of day 0 of every simulation built on this profile (weekday alignment). */
  startDate?: string;
  /** Contract addition 2026-10-18: provenance of each `labs` value (C4). Absent key = provenance unknown (legacy). */
  labMeta?: Readonly<Partial<Record<keyof LabBaselines, LabBaselineMeta>>>;
  /** Contract addition 2026-10-18 (D7-09): dated medication class changes. */
  medications?: readonly MedicationChange[];
}

/**
 * Derived, read-only profile for one run. Built once (never inside the step loop).
 * Every baseline quantity that more than one module needs is computed exactly once here (MODEL_SPEC §5.1.3).
 */
export interface ResolvedProfile {
  readonly input: PersonProfile;
  readonly sex: Sex;
  readonly ageYears: number;
  readonly heightM: number;
  readonly weightKg: number;
  readonly body: BodyEstimate;
  /**
   * Resolved habits with every default applied. With an activity intake `typicalSteps` is the intake's weekly-mean S_hab
   * (MODEL_SPEC §5.5); `activity` echoes the raw intake (undefined when not asked).
   */
  readonly habits: ResolvedHabits;
  readonly cycle: CycleProfile;
  readonly menopause: 'pre' | 'peri' | 'post';
  readonly safety: { mode: SafetyMode; flags: SafetyFlags };
  readonly labs: LabBaselines;
  /** Day-of-week of day 0 (0 = Monday). */
  readonly startWeekday: number;
  /** Baseline resting metabolic rate, kcal/d (energy module's RMR0 selection rule, 02 §4.1). */
  readonly rmr0Kcal: number;
  /** Baseline total energy expenditure = weight-stable intake EI0, kcal/d (02 §4.13 init). */
  readonly tdee0Kcal: number;
  /**
   * Habitual exercise energy inside TDEE0, kcal/d (weekly mean): sessionsPerWeek·(MET_mix − 1)·BW·1 h/7 with 4.0 MET
   * RT / 5.0 MET cardio (10 §4.1). Energy's NEAT0 = TDEE0 − RMR0 − TEF0 − EAT0 before the burn-in calibration (§3.4).
   */
  readonly eat0Kcal: number;
  /** Habitual protein, carbohydrate (available), fat, fibre, g/d at EI0. */
  readonly habitualProteinG: number;
  readonly habitualCarbG: number;
  readonly habitualFatG: number;
  readonly habitualFibreG: number;
  readonly habitualSodiumMg: number;
  /** Fat-free mass and fat mass at t = 0, kg (from body estimate). */
  readonly ffm0Kg: number;
  readonly fm0Kg: number;
  /**
   * Habitual activity and the baseline-maintenance breakdown with its p10/p90 band (MODEL_SPEC §5.5, R1). Always set by
   * `resolveProfile`; optional so hand-built test profiles stay valid. Added 2026-10-01 (additive).
   */
  readonly activity?: ResolvedActivity;
}

/** Habit fields that carry context, not engine defaults: they stay optional after resolution (2026-10-18 contracts). */
export type HabitContextKey = 'activity' | 'stepsScope' | 'trainingGrowthState' | 'trainingGrowthStateSource' | 'habitualStepsOverlap' | 'habitualSleepDurationH' | 'habitualSleepDurationSource' | 'habitualCardio';

/** `HabitProfile` with every default applied; context fields (`activity`, steps scope, growth state) stay optional. */
export type ResolvedHabits = Required<Omit<HabitProfile, HabitContextKey>> & {
  readonly activity?: ActivityIntake;
  readonly habitualCardio?: HabitualCardio;
  readonly habitualSleepDurationH?: number;
  readonly habitualSleepDurationSource?: HabitProfile['habitualSleepDurationSource'];
  readonly stepsScope?: StepsScope;
  readonly trainingGrowthState?: TrainingGrowthState;
  readonly trainingGrowthStateSource?: HabitProfile['trainingGrowthStateSource'];
  /** (A1-040) Habitual reference overlap; absent = unknown (resolved, hashed and disclosed, never defaulted to known). */
  readonly habitualStepsOverlap?: HabitualStepsOverlap;
};
