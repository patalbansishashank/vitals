/**
 * UI-level schedule contracts (docs/MODEL_SPEC.md §5.2).
 *
 * Mirrors the Simulator's "programs painted over days" model (design/screens/simulator-schedule.md) and is the target
 * of the planner's decoder (dossier 18 §4.4: phases → day-types → weekly pattern → overlays → events). A Plan is
 * compiled to a Schedule (one program per distinct day-type, a dense day→program map, fast events), so any planner
 * option opens unchanged in the Simulator.
 *
 * No diet names appear anywhere: presets (UI) fill these fields with numbers.
 */

/** What "% of maintenance" is relative to (orchestrator ruling; `blockStart` = dossier 18 `phaseStart`). */
export type EnergyReference = 'baseline' | 'current' | 'blockStart';

export type EnergySpec =
  /**
   * Percent of maintenance, e.g. 80 = 20 % deficit. Default reference: the schedule's `defaults.energyReference` ('baseline').
   * Maintenance means weight-stable **for the activity this schedule prescribes** (ruling R-MAINT, MODEL_SPEC §5.2): the
   * reference is habitual maintenance − habitual exercise energy + the schedule's planned exercise energy (averaged over the
   * day's phase or week). `activity: 'habitual'` (added 2026-09-30, additive; default 'planned') keeps the reference at the
   * habitual activity instead — "% of the habitual intake", for study protocols that prescribe intake that way.
   */
  | { kind: 'pctMaintenance'; pct: number; reference?: EnergyReference; activity?: 'planned' | 'habitual' }
  /** Absolute metabolisable energy, kcal/d (engine convention 4P + 9F + 4·netC + 2·fibre + 7·alcohol, dossier 15 §4.2). */
  | { kind: 'kcal'; kcal: number }
  /** Water-only day: zero energy, zero protein (owner addendum). Electrolytes per `hydration.electrolytes`. */
  | { kind: 'zero' };

/**
 * One macronutrient amount. Body-mass references follow the day's energy reference: 'baseline' → day-0 values,
 * 'current'/'blockStart' → state at the start of that day / block (MODEL_SPEC §5.2.2).
 */
export type MacroAmount =
  | { unit: 'g'; value: number }
  | { unit: 'gPerKgBw'; value: number }
  | { unit: 'gPerKgFfm'; value: number }
  | { unit: 'pctEnergy'; value: number }
  /** Takes whatever energy is left after the other macros (exactly one macro may be 'remainder'). */
  | { unit: 'remainder' };

export type ProteinSource =
  | 'mixedOmnivore'
  | 'mixedVegetarian'
  | 'mixedVegan'
  | 'whey'
  | 'casein'
  | 'milk'
  | 'egg'
  | 'meat'
  | 'soy'
  | 'pea'
  | 'peaRiceBlend'
  | 'rice'
  | 'wheat'
  | 'collagen';

export interface FatTypeSpec {
  /** Shares of total fat, 0..1 (defaults: typical Western mix, MODEL_SPEC §5.2.3). */
  satShare?: number;
  mufaShare?: number;
  pufaShare?: number;
  /** EPA+DHA, g/d (not a share). */
  omega3G?: number;
  /** Medium-chain triglyceride, g/d, counted inside total fat. */
  mctG?: number;
}

export interface MacroSpec {
  /**
   * Review m8 (18 §4.4.2 `carbShareNonProtein`, "% of non-protein energy"): when set (0..1), carbohydrate and fat are
   * resolved from the energy left after protein, fibre and alcohol — carbs = share·E_np/4, fat = (1 − share)·E_np/9,
   * E_np = E − 4·protein − 2·fibre − 7·alcohol — and `carbs`/`fat` are ignored. Protein must not be 'remainder'.
   * (Expressed as a field rather than a new MacroAmount unit so existing consumers of MacroAmount stay valid.)
   */
  carbShareNonProtein?: number;
  protein: MacroAmount;
  /** Net (available, digestible) carbohydrate, i.e. excluding fibre. */
  carbs: MacroAmount;
  fat: MacroAmount;
  /** Total dietary fibre (AOAC). Default 8 g per 1000 kcal (dossier 15 §1.1). */
  fibre?: MacroAmount | { unit: 'gPer1000Kcal'; value: number };
  /** Share of total fibre that is viscous soluble (default 0.15, dossier 15 §3). */
  viscousFibreShare?: number;
  fatTypes?: FatTypeSpec;
  /** Share of net carbohydrate that is sugars (mono + di), 0..1. */
  sugarsShare?: number;
  /** Share of sugars that is fructose (free + ½ sucrose), 0..1. */
  fructoseShareOfSugars?: number;
  proteinSource?: ProteinSource;
}

export interface FoodQualitySpec {
  /** Glucose-scale glycaemic index of the carbohydrate mix, 0..100 (default 55). */
  glycaemicIndex?: number;
  /** Energy share from ultra-processed food 0..1 (dossier 15 default 0.55). Affects hunger/adherence only. */
  upfShare?: number;
  /** Non-beverage energy density override, kcal/g (advanced). */
  energyDensityKcalPerG?: number;
  /** Whole nuts eaten, g/d, and their form (ME correction, dossier 15 §4.2). */
  nutsG?: number;
  nutForm?: 'wholeRaw' | 'wholeRoasted' | 'chopped' | 'butter';
  /** Energy from beverages (liquid calories), kcal/d (satiety credit, dossier 12 §4.9.2). */
  liquidKcal?: number;
  foodQuality?: 1 | 2 | 3;
  /**
   * Dietary cholesterol, mg/d (06 §3, Keys square-root law). Absent = the person's habitual intake (no change; the
   * cardiometabolic module then sees no cholesterol effect). Added 2026-09-30 (integration, additive).
   */
  cholesterolMg?: number;
  /**
   * DASH-pattern adherence 0..1 (06 §4.8 BP, §4.13 urate; 1 = full DASH diet). Absent = derived from `foodQuality`
   * (quality 3 → the registry's `cardiometabolic.dash.q3Fraction`, else 0). Added 2026-09-30 (additive).
   */
  dashFraction?: number;
}

export type MealSplit = 'even' | 'biggerLast' | 'biggerFirst';

export interface MealSpec {
  /** Clock hour 0..24 (fractional allowed, e.g. 12.5 = 12:30). */
  clockH: number;
  /** Share of the day's energy (and of every macro unless `macros` given). Shares are renormalised. */
  share?: number;
  /** Explicit grams for this meal (overrides share for the given macros). */
  macros?: Partial<Record<'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'alcoholG', number>>;
  proteinSource?: ProteinSource;
}

export interface MealPlan {
  /** Number of meals when `meals` is not given (default: habitual, 3). */
  count?: number;
  /** Eating window shorthand; meals are placed evenly from start to end (MODEL_SPEC §5.2.4). */
  window?: { startH: number; lengthH: number };
  split?: MealSplit;
  meals?: MealSpec[];
}

/** The nine training regions of dossier 09 §4.15. */
export type TrainingRegion =
  | 'chest'
  | 'upperBack'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves';

/** Dossier 09 §4.1 simple-descriptor presets (effective sets per major region per week). */
export type RtVolumePreset = 'minimal' | 'light' | 'moderate' | 'high' | 'veryHigh';

export interface ResistanceSession {
  kind: 'resistance';
  startH: number;
  /** Default: 2.5 min per set incl. rest (dossier 09 §4.13). */
  durationMin?: number;
  /** Hard sets per region in this session (direct = 1, indirect already fractionated by the UI's exercise library). */
  setsByRegion?: Partial<Record<TrainingRegion, number>>;
  /** Overall descriptor when sets are not entered; distributed over regions by the weekly frequency (MODEL_SPEC §5.2.5). */
  volume?: RtVolumePreset;
  /** Reps in reserve (proximity to failure), default 2. */
  rir?: number;
  /** Load, % of 1RM (default 70). */
  loadPct1RM?: number;
  /** Inter-set rest, s (default 120). */
  restSec?: number;
  toFailure?: boolean;
  /** Compendium category for the energy cost (dossier 09 §4.13 METs). */
  style?: 'general' | 'heavyCompound' | 'bodybuilding' | 'circuit' | 'bodyweight';
  /**
   * Gross MET of the session's resistance part, overriding the `style` MET for its energy cost (catalogue items such as
   * mudgar, gada or kettlebell swings have their own MET; PLANNER_V2_SPEC §8.3). Absent → the `style` MET, exactly as
   * before. Added 2026-10-01 (additive).
   */
  met?: number;
  /**
   * Cold-water immersion straight after this session (dossier 21 intervention catalogue; blunts the hypertrophy
   * response of the session, muscle module). Default false. Added 2026-09-30 (additive).
   */
  coldWaterImmersion?: boolean;
}

export type CardioModality = 'walk' | 'run' | 'cycle' | 'swim' | 'row' | 'hiit' | 'other';

export interface CardioSession {
  kind: 'cardio';
  modality: CardioModality;
  startH: number;
  durationMin: number;
  /** Any one of these; default intensity is modality-specific moderate (MODEL_SPEC §5.2.5). */
  pctVo2max?: number;
  met?: number;
  speedKmh?: number;
  powerW?: number;
  /** Borg CR-10 rating. */
  rpe?: number;
  /** Carbohydrate eaten during the session, g/h (spares liver glycogen, dossier 04 §4.3). */
  carbDuringGPerH?: number;
}

export type ExerciseSession = ResistanceSession | CardioSession;

export interface SleepSpec {
  bedH?: number;
  wakeH?: number;
  /** Overrides bed/wake difference. */
  hours?: number;
  quality?: 'poor' | 'fair' | 'good';
  shiftWork?: boolean;
}

export interface SubstanceSpec {
  caffeine?: { clockH: number; mg: number }[];
  alcohol?: { clockH: number; drinks: number; withMeal?: boolean }[];
  creatineG?: number;
  creatineLoading?: boolean;
  exogenousKetones?: { clockH: number; gBhb: number; form: 'ester' | 'salt' }[];
}

export interface HydrationSpec {
  sodiumG?: number;
  potassiumG?: number;
  magnesiumMg?: number;
  /** Beverages, L/d. Default: thirst-driven need (dossier 15 §4.8) → no hydration deficit. */
  fluidL?: number;
  sweatLPerH?: number;
  /** Electrolyte supplementation during fasts (addendum; dossier 17 §4.3). */
  electrolytes?: boolean;
}

export interface ModifierSpec {
  stress?: 'low' | 'moderate' | 'high';
  /** Illness pauses training effects (simulator-schedule.md). */
  illness?: boolean;
  travelJetLag?: boolean;
  hotClimate?: boolean;
  /**
   * Dry-sauna sessions per week while this program is followed (dossier 21 X7; BP lever −4·min(1, n/3) mmHg in the
   * cardiometabolic module). Default 0. Added 2026-09-30 (additive).
   */
  saunaSessionsPerWeek?: number;
}

/** A program (lettered key) = one day configuration. Every field except `energy` and `macros` is optional. */
export interface DayTemplate {
  id: string;
  label: string;
  energy: EnergySpec;
  macros: MacroSpec;
  food?: FoodQualitySpec;
  meals?: MealPlan;
  exercise?: ExerciseSession[];
  /**
   * "Training as usual" (ruling R-DETRAIN (2), release check 2026-10-01; MODEL_SPEC §5.2.5): when true the day's sessions
   * are the profile's habitual sessions for the day's weekday — exactly those of the burn-in habitual week
   * (`core/compileSchedule.habitualSessionsFor(profile, weekday)`: `habits.sessionsPerWeek` × 60 min at 18:00, the
   * `lifingCardioMix` share cardio, resistance at the 'moderate' weekly volume) — followed by this template's own `exercise`
   * entries as extra sessions (at most MAX_SESSIONS in all). Default false (no implicit sessions). A per-day override can
   * set it either way; "no training" = false with no `exercise`. Added 2026-10-01 (additive).
   */
  habitualTraining?: boolean;
  steps?: number;
  sleep?: SleepSpec;
  substances?: SubstanceSpec;
  hydration?: HydrationSpec;
  modifiers?: ModifierSpec;
}

/** Per-day entry: which program, plus an optional override (the "this day" edit scope). */
export interface ScheduleDay {
  program: number;
  override?: Partial<Omit<DayTemplate, 'id' | 'label'>>;
}

/** Named phase band (phase column / dossier 18 phase). Also defines `blockStart` for energy references. */
export interface ScheduleBlock {
  name: string;
  startDay: number;
  /** Exclusive. */
  endDay: number;
  /** Optional dossier 13 §4C block id the phase was built from (display/provenance only). */
  buildingBlockId?: string;
}

/**
 * Hour-exact zero-intake span; may cross day, week and block boundaries (dossier 18 §4.4.5).
 *
 * Duration semantics (orchestrator ruling 2026-09-30 18:10): `durationH` is **meal to meal** — from the last intake
 * before the fast (at `startDay`·24 + `startH`, which may be fractional) to the first intake after it. Intake exactly at
 * either boundary is allowed; meals strictly inside are dropped (their grams leave the day's totals, the other meals keep
 * their planned size; compile note `mealDroppedInFast`). A 24-h fast after a 19:00 dinner is `{startH: 19, durationH: 24}`: the next meal may start at 19:00 the
 * following day and the intake clocks see exactly 24 h. The compiled zero-intake hours are the whole hours strictly
 * between the hour holding the last intake and the hour holding the first (so `durationH − 1` hours for whole-hour
 * boundaries); `CompiledSchedule.fastSpans[i].mealToMealH` carries the meal-to-meal duration that tiers and the fasting
 * regime (≥ 24 h, M7) use.
 */
export interface FastEvent {
  kind: 'fast';
  startDay: number;
  /** Clock hour on `startDay` of the last intake before the fast (fractional allowed). */
  startH: number;
  /** Meal-to-meal duration, h (last intake → first intake). */
  durationH: number;
  electrolytes?: boolean;
  /** Graded refeed after the fast (dossier 17 HC-F3); 'auto' = the tier's default ramp. Default 'none'. */
  refeed?: 'none' | 'auto';
  /**
   * Custom refeed ramp (per-fast refeed descriptor): fraction (0..1] of each following day's planned energy, day 1 = the
   * calendar day on which the fast ends; all macros scale with it. When given it replaces the tier default and implies a
   * refeed (as if `refeed: 'auto'`). Added 2026-09-30 (additive).
   */
  refeedFactors?: readonly number[];
}

export type ScheduleEvent = FastEvent;

export interface ScheduleDefaults {
  energyReference?: EnergyReference;
}

/**
 * Behavioural adherence levers (dossier 21 §4G) chosen for the whole schedule. They never change intake (orchestrator
 * ruling: intake is authoritative); the appetite module turns them into a multiplicative shift of the attrition hazard
 * (12 §4.10a). All default false. Added 2026-09-30 (additive).
 */
export interface AdherenceLevers {
  /** Daily self-monitoring (food log and/or weighing). */
  selfMonitoring?: boolean;
  /** Meal replacements (1-2 portion-controlled meals per day). */
  mealReplacement?: boolean;
  /** ~500 mL water before main meals. */
  preMealWater?: boolean;
  /** Flexible (not rigid) dietary-restraint coaching. */
  flexibleRestraint?: boolean;
}

export interface Schedule {
  schemaVersion: 1;
  /** ISO date of day 0. */
  startDate: string;
  horizonDays: number;
  programs: DayTemplate[];
  /** Dense, length === horizonDays. */
  days: ScheduleDay[];
  blocks?: ScheduleBlock[];
  events?: ScheduleEvent[];
  defaults?: ScheduleDefaults;
  /** Behavioural adherence levers (21 §4G), default none. Added 2026-09-30 (additive). */
  adherence?: AdherenceLevers;
}
