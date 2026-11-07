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
import type { CausalResolution, ChannelCoverage, ChannelCoverageMap, MacroKnowledge, QuantityProvenance } from '@/lib/bodyContracts';
import type {
  CardioModality,
  ContractionType,
  DayTemplate,
  DoseFieldProvenance,
  EffortScale,
  EnergyReference,
  HealthClassSource,
  HealthIntensityClass,
  IntervalPhase,
  MealForm,
  MealNutrientKey,
  StepsScope,
  TrainingRegion,
  UnknownDoseScenario,
} from './schedule';

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
/**
 * Resistance set groups kept per day in the preallocated resolved arrays (D3-01). Generous so heterogeneous groups keep
 * their dose without averaging; a day beyond it gets the compile note `setGroupsTruncated` (never silent loss).
 */
export const MAX_SET_GROUPS_PER_DAY = 64;

export const CARDIO_MODALITY_CODE: Readonly<Record<CardioModality, number>> = {
  walk: 1,
  run: 2,
  cycle: 3,
  swim: 4,
  row: 5,
  hiit: 6,
  other: 7,
};

/**
 * Per-meal nutrient knowledge (D6-02/A1-014): which of the meal's protein/carbohydrate/fat/fibre/ethanol grams are known
 * analysis ('known', an explicit 0 included), a named scenario fill ('imputed') or absent analysis ('unknown': the numeric
 * field then holds a compatibility 0 that no consumer may read as a measured or prescribed zero).
 */
export type MealNutrientMask = Readonly<Record<MealNutrientKey, MacroKnowledge>>;

/**
 * Bit per nutrient for allocation-free hot-loop masks (`HourInput.nutrientUnknownMask`, `DayInput.nutrientUnknownMask`):
 * a set bit = some ingested amount of that nutrient in the hour/day has unknown analysis (its known sum is a lower bound).
 */
export const NUTRIENT_UNKNOWN_BIT: Readonly<Record<MealNutrientKey, number>> = { protein: 1, carbohydrate: 2, fat: 4, fibre: 8, ethanol: 16 };

/**
 * The nutrient mask of a resolved meal, with the conservative legacy read (A1-014): an explicit `nutrientMask` wins; a
 * legacy reported-energy meal (`reportedKcal` set, no mask) knows only the nutrients with a positive amount (a zero there
 * may be an absent analysis, so it is unknown, never a known zero); an ordinary prescription meal is complete by
 * construction.
 */
export function mealNutrientMaskOf(m: Pick<MealResolved, 'nutrientMask' | 'reportedKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'alcoholG'>): MealNutrientMask {
  if (m.nutrientMask) return m.nutrientMask;
  if (m.reportedKcal === undefined) return { protein: 'known', carbohydrate: 'known', fat: 'known', fibre: 'known', ethanol: 'known' };
  const k = (g: number): MacroKnowledge => (Number.isFinite(g) && g > 0 ? 'known' : 'unknown');
  return { protein: k(m.proteinG), carbohydrate: k(m.carbG), fat: k(m.fatG), fibre: k(m.fibreG), ethanol: k(m.alcoholG) };
}

/** Unknown-nutrient bits of a mask; 'imputed' counts as not analysed (a scenario value, never a known amount). */
export function nutrientUnknownBits(mask: MealNutrientMask | null | undefined): number {
  if (!mask) return 0;
  let bits = 0;
  for (const k of Object.keys(NUTRIENT_UNKNOWN_BIT) as MealNutrientKey[]) if (mask[k] !== 'known') bits |= NUTRIENT_UNKNOWN_BIT[k];
  return bits;
}

/**
 * Stable physical-bout key (D3-01/A1-020): the bout's explicit id (`boutId`, else `sessionId`), or for a legacy
 * identity-less schedule the origin day and the session's index on that day. Per-bout nonlinear accumulators are keyed by it,
 * never by clock-hour adjacency.
 */
export function boutKeyOf(identity: { boutId?: string; sessionId?: string }, originDay: number, sessionIndex: number): string {
  if (identity.boutId) return `bout:${identity.boutId}`;
  if (identity.sessionId) return `bout:${identity.sessionId}`;
  return `legacy:${originDay}:${sessionIndex}`;
}

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
  // ---- contract additions 2026-10-18 (optional; the compiler sets them when the source carries the information)
  /** Reported ME of an energy-only/partial-macro meal, kcal (D6-02); `kcal` equals it. */
  reportedKcal?: number;
  /** Part of `kcal` not explained by the known grams (D6-02): energy-only, never routed into a named substrate pool. */
  unallocatedKcal?: number;
  /** Energy-ledger status of the meal (D6-02). */
  energyStatus?: 'consistent' | 'energyOnly' | 'conflict';
  /** Carbohydrate of unknown mixture, g (part of carbG; D6-07). */
  carbUnknownMixG?: number;
  intakeDurationH?: number;
  form?: MealForm;
  /** Originating log/event id (C2). */
  eventId?: string;
  /**
   * (D6-02/A1-014) Nutrient knowledge of this meal, retained through reported-meal resolution, day aggregation, runtime
   * re-resolution, fast-window removal and hourly ingestion. Absent = legacy: every field known EXCEPT on an energy-only/
   * partial reported meal (`reportedKcal` set), where an adapter must treat the macros it cannot prove as unknown (never
   * inferred from a zero compatibility number, `energyStatus`, day completeness or a superseded macro template).
   */
  nutrientMask?: MealNutrientMask;
  /** (A1-014) Provenance of each known nutrient (label, reported, estimated, asPlanned…); absent = legacy unknown provenance. */
  nutrientProvenance?: Readonly<Partial<Record<MealNutrientKey, QuantityProvenance>>>;
  /**
   * (D6-01/A1-031) Polyols of the meal by identity, g (`POLYOL_IDENTITY_UNKNOWN` = identity-unknown total): outside `carbG`,
   * energy inside `kcal`; their substrate route is unmodelled (a named conditional status on affected outputs).
   */
  polyolsG?: Readonly<Record<string, number>>;
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
  // ---- contract additions 2026-10-18 (optional)
  /** Stable bout identity (D3-01). */
  sessionId?: string;
  /**
   * (A1-020) Physical-bout key (`boutKeyOf`): parts of one bout share it, distinct bouts in the same clock hour do not.
   * `boutEndH` = clock hour (fractional, may exceed 24 for a bout crossing midnight) the compiled bout interval ends; bout
   * state ends by it (and by identity), never by an empty hour.
   */
  boutKey?: string;
  boutEndH?: number;
  /** (r063) The whole physical bout's moving minutes when this session is one moving part of it (EPOC's duration factor). */
  boutDurationMin?: number;
  /** Resistance: this session's groups are `DayInput.rtGroups[groupStart … groupStart + groupCount − 1]` (D3-01). */
  groupStart?: number;
  groupCount?: number;
  /** Cardio interval phases (D3-03) and the public-health class (unknown is not zero). */
  phases?: readonly IntervalPhase[];
  healthIntensityClass?: HealthIntensityClass;
  /** (A1-062) How the class was established, and the declared scale of `rpe` (phases inherit only an explicit one). */
  healthClassSource?: HealthClassSource;
  rpeScale?: EffortScale;
  /** (A1-022) Status of the session's hard-set dose and the named scenario behind an unknown count. */
  doseStatus?: DoseFieldProvenance;
  unknownDoseScenario?: UnknownDoseScenario;
  /** Share of during-exercise carbohydrate that is fructose when the mixture is known (D6-07); NaN/undefined = unknown. */
  carbDuringFructoseShare?: number;
  /** Locomotor steps this session contributes to a total-day count (D3-07). */
  stepsIncluded?: number;
  /** (SPEC V1.5) Chosen gross energy of the whole bout, kcal; booked first by the activity module when finite and > 0. */
  realisedGrossKcal?: number;
}

/**
 * One resolved resistance set group (D3-01). The muscle module applies its drawn factors per group (fType exactly once,
 * isometric groups bypass fRIR/fLoad) and sums afterwards. Preallocated by the compiler (`MAX_SET_GROUPS_PER_DAY`).
 */
export interface ResistanceGroupResolved {
  /** Index of the owning session in `DayInput.sessions`. */
  session: number;
  /** Physical sets. */
  sets: number;
  /** Per-set region weights, length N_REGIONS (TRAINING_REGIONS order). */
  regionWeights: Float64Array;
  contraction: ContractionType;
  /** `regionWeights` already include the contraction-type factor (legacy merged dose). */
  typeFactorIncluded: boolean;
  /** NaN = unknown (the module's default is then an assumption, flagged by `provenance`). */
  loadPct1RM: number;
  rir: number;
  restSec: number;
  /** Clock hour (fractional, may exceed 24 for a carried bout) of the group's first set and its duration, min. */
  startH: number;
  durationMin: number;
  /** 1 when any dose field of the group is a default/inferred value rather than reported (D3-09). */
  assumed: number;
  /**
   * Bout identity carried with the group (D3-01), so a copy carried past midnight (`session` −1) keeps its origin: the
   * day index and session id of the owning bout, and the bout's cold-water immersion and to-failure flags. Optional;
   * absent means read them from `sessions[session]`.
   */
  originDay?: number;
  sessionId?: string;
  coldWaterImmersion?: boolean;
  toFailure?: boolean;
  /**
   * (A1-020) Physical-bout key of the owning bout (`boutKeyOf`; survives a carry past midnight and a snapshot) and the clock
   * hour its compiled interval ends (relative to the group's own day, may exceed 24). Groups of one bout share the key.
   */
  boutKey?: string;
  boutEndH?: number;
  /**
   * (A1-022) 1 when the group's set count is UNKNOWN (minutes-only record): `sets` is then the named `unknownDoseScenario`,
   * and outputs that depend on it carry a conditional status. Distinct from `assumed` (any defaulted/inferred field, e.g.
   * an ordinary region mapping). Absent/0 = known count.
   */
  setsUnknown?: number;
  unknownDoseScenario?: UnknownDoseScenario;
  /** (A1-022) Field-level provenance of the group's dose (absent = only the collapsed `assumed` flag is known). */
  provenance?: Readonly<Partial<Record<'sets' | 'regions' | 'load' | 'rir' | 'rest', DoseFieldProvenance>>>;
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

  // ---- contract additions 2026-10-18 (C1–C3, D2-01, D3-01, D3-07, D6-02, D8-04, D8-06, D8-08; optional, compiler-set)
  /** Resolved resistance set groups of the day's sessions (D3-01) and how many are used. */
  rtGroups?: ResistanceGroupResolved[];
  nRtGroups?: number;
  /** Scope of `steps` and the session steps inside it (D3-07). */
  stepsScope?: StepsScope;
  sessionIncludedSteps?: number;
  /** Per-channel coverage of a realised day (C1); absent on prescribed days. Energy coverage gates EA/calibration claims. */
  coverage?: ChannelCoverageMap;
  /** Scope of exercise knowledge; covered sessions alone do not establish whole-day actual exercise. */
  exerciseCoverageScope?: 'actualDay' | 'coveredSessions' | 'prescribedScenario' | 'unknown';
  /** Causal resolution of the day's inputs (C2/D2-01): daily-native whole-day reads mark observed days 'daily'. */
  resolution?: CausalResolution;
  /** Energy of energy-only meals not allocated to macros, kcal (D6-02); part of `energyKcal`. */
  unallocatedKcal?: number;
  energyStatus?: 'consistent' | 'energyOnly' | 'conflict';
  /**
   * Planned fast metadata (D2-01): duration and start of a planned fast for policy, consent and forecast labels only.
   * History-driven physiology must not read it (the immediate D2-01 invariant).
   */
  fastPolicy?: { plannedDurationH: number; startDay: number; source: 'planned' | 'observed' | 'censored' };
  /** Where the day's sleep came from (D8-06) and the episode ending on this day (observed episodes map to the wake date). */
  sleepSource?: 'observed' | 'planned' | 'habitual';
  sleepEndingToday?: SleepEndingToday;
  /** Known exposure totals with nutrient-specific coverage (C3/D6-03/D8-08), canonical units, keyed by exposure id. */
  exposure?: Readonly<Record<string, DayExposureSummary>>;
  /**
   * (A1-014) Union of the day's meal `nutrientUnknownBits` (`NUTRIENT_UNKNOWN_BIT`): a set bit = that nutrient's day total is
   * only a known lower bound. Absent/0 = every included contribution known (or a legacy day; see `MealResolved.nutrientMask`).
   */
  nutrientUnknownMask?: number;
  /** (A1-031) Polyol grams of the day by identity (outside `carbG`); a positive total seeds the unmodelled-route status. */
  polyolsG?: Readonly<Record<string, number>>;
}

/**
 * (D8-06/A1-053) The observed sleep of a waking day as compiled: MAIN-episode timing (`bedClockH`/`wakeClockH`/`hours`,
 * which place hourly sleep) kept separate from the known TOTAL asleep hours (`totalAsleepHours`: union of every episode,
 * naps included, counted once). `quality` is the entered code (0 poor, 1 fair, 2 good, the `sleepQuality` code);
 * absent with `qualityStatus: 'unrated'` = an observed unrated night (no planned quality is inherited, nothing is read as
 * good or poor).
 */
export interface SleepEndingToday {
  bedClockH: number;
  wakeClockH: number;
  /** Main-episode duration, h (timing). */
  hours: number;
  /** Known total asleep hours of the waking day, h; absent = equals `hours` (legacy single-episode days). */
  totalAsleepHours?: number;
  /** Entered quality code of the main episode: 0 poor, 1 fair, 2 good (the `sleepQuality` code); absent = not entered. */
  quality?: number;
  qualityStatus?: 'rated' | 'unrated';
  restfulness?: number;
  eventIds?: readonly string[];
  /** `partial` = only part of the day's sleep is known (nap-only record): a scenario dose, not a full night. */
  coverage?: 'complete' | 'partial';
}

/**
 * A day's known sum of one exposure and its coverage (C3): `knownSum` is a lower bound unless coverage is complete. The
 * interval a cap/floor is evaluated on is `exposureInterval` (C5): complete ⇒ [sum, sum]; partial ⇒ [knownSum, unbounded];
 * unknown ⇒ [0, unbounded], unless a supported tighter bound is carried in `lowerBound`/`upperBound`.
 */
export interface DayExposureSummary {
  knownSum: number;
  unit: string;
  coverage: ChannelCoverage;
  /** (A1-014) Included contributions with known / unknown analysis (complete only when `unknownContributions` is 0). */
  knownContributions?: number;
  unknownContributions?: number;
  /** (A1-014) A supported tighter bound than the coverage default (null upper = unbounded). */
  lowerBound?: number;
  upperBound?: number | null;
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
  /**
   * Sets started in this hour per day group index (length MAX_SET_GROUPS_PER_DAY; D3-01). Optional: allocated by the loop
   * when groups are compiled; muscle iterates every group overlapping the hour instead of one session at a time.
   */
  rtGroupSets?: Float64Array;
  /** Unallocated energy (energy-only meals) starting this hour, kcal (D6-02); part of `kcal`. */
  unallocatedKcal?: number;
  /**
   * (A1-014) Unknown-nutrient bits of the meals starting this hour (`NUTRIENT_UNKNOWN_BIT`): the numeric gram fields above
   * are then known lower bounds, so rings/warnings must not assert a deficiency or a passed cap from them. 0 = all known.
   */
  nutrientUnknownMask?: number;
  /** (A1-031) Polyol grams ingested this hour (all identities), outside `carbG`; no substrate route is modelled. */
  polyolG?: number;
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
    /** D2-01/D5-05: planned (policy metadata only), observed (completed interval) or censored at `asOf`. */
    source?: 'planned' | 'observed' | 'censored';
    protocol?: 'zeroCalorie' | 'modified';
    eventId?: string;
  }>;
  /** Behavioural adherence levers (21 §4G) with defaults applied; undefined in hand-built test schedules = none. */
  readonly adherence?: Readonly<{ selfMonitoring: boolean; mealReplacement: boolean; preMealWater: boolean; flexibleRestraint: boolean }>;
  /** Compiler notes (e.g. meals moved out of a fast span, macros exceeding energy). */
  readonly notes: ReadonlyArray<{ day: number; code: CompileNoteCode; message: string }>;
  /**
   * D8-06: sleep timing of the last observed episode before day 0 (initialises the carried sleep state). (A1-053) Day zero
   * carries the same observation as a later waking day: the known total asleep hours and the entered quality (absent with
   * `qualityStatus: 'unrated'` = unrated, never a planned flag).
   */
  readonly initialSleep?: Readonly<{
    bedClockH: number;
    sleepHours: number;
    totalAsleepHours?: number;
    /** Entered quality code: 0 poor, 1 fair, 2 good; absent = not entered. */
    quality?: number;
    qualityStatus?: 'rated' | 'unrated';
    restfulness?: number;
    coverage?: 'complete' | 'partial';
  }>;
  /** C2: echo of `Schedule.realised` (observed prefix, history hash, contract version). */
  readonly realised?: Readonly<{ historyHash: string; asOf: string; contractVersion: number; throughDay: number }>;
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
  | 'pastHorizonDropped'
  /** D6-02: a meal carries reported energy with unknown macros; the unexplained part stays unallocated energy. */
  | 'energyOnlyMeal'
  /** D6-02: known macros exceed the reported energy (source conflict); the reported energy is kept. */
  | 'mealEnergyConflict'
  /** D3-01: more set groups than MAX_SET_GROUPS_PER_DAY on a day. */
  | 'setGroupsTruncated'
  /** A1-021: a cardio bout's phase durations disagreed with its booked duration (clipped; the gap kept as an unknown remainder). */
  | 'phaseDurationMismatch'
  /** A1-022: a resistance dose with an unknown hard-set count compiled as the named legacy minute-conversion scenario. */
  | 'unknownDoseScenario'
  /** A1-031: polyols with no modelled substrate route (glucose/insulin/fuel/ketone outputs carry a conditional status). */
  | 'polyolRouteUnmodelled'
  /** A1-053: an observed sleep total differs from the main episode (naps/segments kept in the total, not in the timing). */
  | 'sleepTotalFromEpisodes';
