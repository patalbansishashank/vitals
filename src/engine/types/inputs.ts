/**
 * Resolved engine inputs (docs/MODEL_SPEC.md §5.3-5.4).
 *
 * `compileSchedule(schedule, profile)` turns the UI-level `Schedule` into one `DayInput` per day. Days whose energy
 * or macros depend on the simulated body (energy reference 'current'/'blockStart', or g/kg with those references)
 * are marked `runtime`: the loop re-resolves them in place at the start of that day with `resolveDayInPlace`,
 * without allocating. The loop then expands the day into 24 `HourInput` rows (a preallocated struct-of-arrays).
 *
 * Canonical units: g, kcal, mg, mL, h (clock hours 0..24), minutes for exercise duration.
 */
import type { CardioModality, DayTemplate, EnergyReference, TrainingRegion } from './schedule';

/** Region order used by every per-region array in the engine (dossier 09 §4.15). */
export const TRAINING_REGIONS: readonly TrainingRegion[] = [
  'chest',
  'upperBack',
  'shoulders',
  'arms',
  'core',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
] as const;
export const N_REGIONS = 9;

/** Maximum meals and sessions per day kept in the fixed-size resolved arrays. */
export const MAX_MEALS = 8;
export const MAX_SESSIONS = 6;

export const CARDIO_MODALITY_CODE: Readonly<Record<CardioModality, number>> = {
  walk: 1,
  run: 2,
  cycle: 3,
  swim: 4,
  row: 5,
  hiit: 6,
  other: 7,
};

export interface MealResolved {
  /** Clock hour (fractional) of the meal start. */
  clockH: number;
  proteinG: number;
  carbG: number;
  /** Components of carbG, g (glucose-equivalents include starch, ½ sucrose, ½ lactose). */
  glucoseEqG: number;
  fructoseG: number;
  galactoseG: number;
  fatG: number;
  satFatG: number;
  mctG: number;
  fibreG: number;
  viscousFibreG: number;
  alcoholG: number;
  /** Engine-convention energy of this meal, kcal. */
  kcal: number;
  /** Protein quality multipliers (dossier 03 §4.10) and digestion-speed factor s. */
  proteinQDaily: number;
  proteinQMeal: number;
  proteinSpeed: number;
  /** Glycaemic index (glucose scale) and time-to-peak t_p (h) for the glucose/insulin kernels (dossier 04 §4.16). */
  glycaemicIndex: number;
  timeToPeakH: number;
}

export interface SessionResolved {
  kind: 'resistance' | 'cardio';
  startH: number;
  durationMin: number;
  /** Cardio: modality code (CARDIO_MODALITY_CODE), 0 for resistance. */
  modality: number;
  /** Fraction of VO2max during the work when given (cardio pctVo2max or modality default); NaN for resistance. */
  intensityFrac: number;
  /** Gross MET of the session when known (Compendium/user), else NaN; activity resolves from speed/power/VO2max. */
  met: number;
  /** Optional cardio descriptors (NaN when absent); the activity module converts them (10 §4.1). */
  speedKmh: number;
  powerW: number;
  rpe: number;
  /** Effective hard sets per region, length N_REGIONS (resistance only; zeros for cardio). */
  setsByRegion: Float64Array;
  rir: number;
  loadPct1RM: number;
  restSec: number;
  toFailure: boolean;
  carbDuringGPerH: number;
  /** Resistance only: cold-water immersion straight after the session (21; muscle blunts the session's stimulus). */
  coldWaterImmersion: boolean;
}

/** One fully resolved day. Created by the compiler; numeric fields may be overwritten in place for runtime days. */
export interface DayInput {
  readonly day: number;
  readonly dateISO: string;
  /** 0 = Monday. */
  readonly weekday: number;
  readonly program: number;
  readonly blockIndex: number;
  readonly blockStartDay: number;
  /** The template actually used (program merged with the day's override), for runtime re-resolution and UI. */
  readonly template: DayTemplate;

  energyMode: 'pct' | 'kcal' | 'zero';
  energyReference: EnergyReference;
  /** Requested % of maintenance (NaN unless energyMode === 'pct'). */
  energyPct: number;
  /** True when the day must be re-resolved at runtime (MODEL_SPEC §5.3.2). */
  runtime: boolean;
  /**
   * Maintenance reference of the day, kcal/d (NaN until resolved): the energy that keeps the day-0 body (static days) or the
   * current body ('current'/'blockStart' days, set at run time) weight-stable **at the planned activity** (ruling R-MAINT) —
   * habitual maintenance plus `activityAdjKcal`. It is what a 'pctMaintenance' day's percent resolves against, and the
   * reference of `plannedBalanceKcal` on every day (kcal and water-only days included).
   */
  maintenanceKcal: number;

  /**
   * Resolved daily totals (engine energy convention). Since the 2026-09-30 review (M8) `energyKcal`, `carbG` and
   * `glucoseEqG` include carbohydrate eaten during exercise (`exerciseCarbG`); meals never contain it.
   */
  energyKcal: number;
  proteinG: number;
  carbG: number;
  glucoseEqG: number;
  /** Carbohydrate eaten during exercise sessions (glucose-equivalent g, part of carbG/glucoseEqG/energyKcal; M8). */
  exerciseCarbG: number;
  fructoseG: number;
  galactoseG: number;
  sugarsG: number;
  fibreG: number;
  viscousFibreG: number;
  fatG: number;
  satFatG: number;
  mufaG: number;
  pufaG: number;
  omega3G: number;
  mctG: number;
  alcoholG: number;

  proteinQDaily: number;
  glycaemicIndex: number;
  upfShare: number;
  /** NaN = auto from upfShare (dossier 15 §4.6). */
  energyDensityKcalPerG: number;
  nutsG: number;
  nutDelta: number;
  liquidKcal: number;
  foodQuality: number;

  meals: MealResolved[];
  nMeals: number;
  windowStartH: number;
  windowLengthH: number;

  /** Whole calendar day inside a zero-intake span or a 'zero' energy day. */
  zeroIntake: boolean;
  /** Hours of this calendar day covered by planned fast spans. */
  fastHours: number;
  electrolytes: boolean;
  /** Day index where the current planned fast started (−1 when not in a fast). */
  fastStartDay: number;

  sessions: SessionResolved[];
  nSessions: number;
  /**
   * True when the day's sessions include the profile's habitual sessions (`DayTemplate.habitualTraining`, "training as
   * usual"); they come first in `sessions`. Absent/false otherwise. Added 2026-10-01 (additive).
   */
  habitualTraining?: boolean;
  steps: number;

  sleepBedH: number;
  sleepWakeH: number;
  sleepHours: number;
  /** 0 poor, 1 fair, 2 good. */
  sleepQuality: number;
  shiftWork: boolean;

  sodiumMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  /** NaN = thirst-driven (need met). */
  fluidL: number;
  sweatLPerH: number;

  caffeineMg: number;
  creatineG: number;
  creatineLoading: boolean;
  exoKetoneG: number;

  /** 0 low, 1 moderate, 2 high. */
  stress: number;
  illness: boolean;
  travelJetLag: boolean;
  hotClimate: boolean;

  // ---- additive fields of the 2026-09-30 integration pass (optional so hand-built test days stay valid; the compiler
  // always sets them)
  /**
   * Graded-refeed factor applied to this day's planned intake (17 HC-F3; 1 = normal day, < 1 = refeed day after a planned
   * fast with `refeed: 'auto'` or `refeedFactors`). Undefined = 1.
   */
  refeedFactor?: number;
  /** Dietary cholesterol, mg/d; NaN/undefined = not given (habitual, no effect). */
  cholesterolMg?: number;
  /** DASH-pattern adherence 0..1; NaN/undefined = derive from `foodQuality` (cardiometabolic). */
  dashFraction?: number;
  /** Dry-sauna sessions per week (21 X7). Undefined = 0. */
  saunaSessionsPerWeek?: number;
  /**
   * Bit i set = meal i of the day's plan lies strictly inside a planned fast window and is dropped: it stays in `meals` with
   * zero content (kcal 0) and its grams are removed from the day's totals (never relocated as a bolus). Undefined/0 = none.
   */
  mealDropMask?: number;

  // ---- R-MAINT (QA ruling 2026-09-30; additive, optional so hand-built test days stay valid; the compiler always sets them)
  /**
   * Activity adjustment contained in `maintenanceKcal`, kcal/d: planned minus habitual activity energy as the activity
   * module books it, averaged over the day's phase/week, converted to intake — static days: the steady state incl.
   * metabolic compensation, TEF and adaptive thermogenesis; runtime days: Δ/(1 − α0) on top of the engine's instantaneous
   * maintenance (see `core/activityReference.ts`). 0 when the day opts out (`activity: 'habitual'`). Undefined = 0.
   */
  activityAdjKcal?: number;
  /**
   * Planned minus habitual activity energy as booked (sessions net of RMR and displaced baseline, EPOC, post-RT REE, steps
   * above habitual), averaged over the day's phase/week, kcal/d — before compensation, TEF and AT (the raw Δ; the energy
   * module adds Δ/(1 − α) to its maintenance at habitual activity for the `maintenance` metric). Undefined = 0.
   */
  activityDeltaKcal?: number;
  /**
   * The day's true planned energy balance, kcal/d: `energyKcal − maintenanceKcal` (< 0 deficit, > 0 surplus) — what the UI
   * labels a block with (deficit / maintenance / surplus). Runtime days are updated when the loop re-resolves them.
   */
  plannedBalanceKcal?: number;
}

/**
 * What the loop hands every module each hour. One instance per run, overwritten in place (never allocate).
 * Intake fields are *ingested* amounts starting in this hour; absorption kinetics are the intake module's job.
 */
export interface HourInput {
  day: number;
  hourOfDay: number;
  /** Absolute hour index since t = 0. */
  hourIndex: number;

  kcal: number;
  proteinG: number;
  carbG: number;
  glucoseEqG: number;
  fructoseG: number;
  galactoseG: number;
  fatG: number;
  satFatG: number;
  mctG: number;
  fibreG: number;
  alcoholG: number;
  proteinQMeal: number;
  proteinSpeed: number;
  timeToPeakH: number;
  glycaemicIndex: number;
  /** 1 when a meal starts in this hour. */
  mealStart: number;
  caffeineMg: number;
  exoKetoneG: number;

  /** Minutes of exercise work inside this hour and its intensity (fraction VO2max), modality code, gross MET. */
  exMin: number;
  exIntensityFrac: number;
  exModality: number;
  exMet: number;
  /** Carbohydrate eaten during exercise in this hour, g/min equivalent. */
  exCarbDuringGPerMin: number;
  /**
   * Carbohydrate (glucose-equivalent g) ingested during exercise in this hour (M8). NOT included in the meal fields
   * above (kcal, carbG, glucoseEqG, mealStart): intake absorbs it as a glucose slot with t_p 0.5 h and adds it to its
   * 24-h intake rings. Total energy ingested this hour = kcal + 4·exCarbG.
   */
  exCarbG: number;
  /** Resistance sets started in this hour, per region (length N_REGIONS), plus summary descriptors. */
  rtSetsByRegion: Float64Array;
  rtSetsTotal: number;
  rtRir: number;
  rtLoadPct1RM: number;
  rtToFailure: number;
  steps: number;
  /** Fraction of the hour asleep, 0..1. */
  asleep: number;
  /** 1 when the hour lies inside a planned zero-intake span. */
  plannedFast: number;
  electrolytes: number;
}

/** Output of compileSchedule. */
export interface CompiledSchedule {
  readonly nDays: number;
  readonly startDate: string;
  readonly startWeekday: number;
  readonly days: DayInput[];
  /**
   * All planned zero-intake spans (merged; absolute hours from t = 0; `[startHour, endHour)` = the whole hours with no
   * intake). Since 2026-09-30 each span also carries (optional so hand-built test schedules stay valid):
   * `mealToMealH` — last intake before the span to first intake after it, h (the fast's duration for tiers and for the
   * ≥ 24 h fasting regime, ruling 18:10; = the event's `durationH` for a fast event between meals; horizon edges count
   * as intake); `refeed` — 'auto' when a graded refeed follows (event `refeed: 'auto'` or `refeedFactors`), else 'none';
   * `refeedDays` — number of graded-refeed days after it.
   */
  readonly fastSpans: ReadonlyArray<{
    startHour: number;
    endHour: number;
    electrolytes: boolean;
    mealToMealH?: number;
    refeed?: 'none' | 'auto';
    refeedDays?: number;
  }>;
  /** Behavioural adherence levers (21 §4G) with defaults applied; undefined in hand-built test schedules = none. */
  readonly adherence?: Readonly<{ selfMonitoring: boolean; mealReplacement: boolean; preMealWater: boolean; flexibleRestraint: boolean }>;
  /** Compiler notes (e.g. meals moved out of a fast span, macros exceeding energy). */
  readonly notes: ReadonlyArray<{ day: number; code: CompileNoteCode; message: string }>;
}

export type CompileNoteCode =
  | 'mealMovedOutOfFast'
  | 'mealDroppedInFast'
  | 'macrosExceedEnergy'
  | 'remainderNegative'
  | 'multipleRemainder'
  | 'sessionsTruncated'
  | 'mealsTruncated'
  | 'programIndexInvalid'
  /** M8: carbohydrate eaten during exercise was added to the day's carbohydrate and energy totals. */
  | 'carbsDuringExerciseAdded'
  /** M8: carbohydrate during a session inside a planned zero-intake span was dropped. */
  | 'carbsDuringExerciseDropped'
  /** m8: `carbShareNonProtein` used with protein 'remainder' (undefined) — protein set to 0. */
  | 'nonProteinShareNeedsProtein'
  /** V1a-L5: a drink (alcohol) planned inside a fast is counted and breaks the fast. */
  | 'drinkInFast'
  /** V1a-L5: exogenous ketones planned inside a fast are counted and break the fast. */
  | 'ketonesInFast'
  /** V1a-M2/L2: items after midnight on the last day fall after the horizon and are not simulated. */
  | 'pastHorizonDropped';
