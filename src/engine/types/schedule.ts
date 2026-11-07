/**
 * UI-level schedule contracts (docs/MODEL_SPEC.md §5.2).
 *
 * Mirrors the Simulator's "programs painted over days" model (design/screens/simulator-schedule.md) and is the target
 * of the planner's decoder (dossier 18 §4.4: phases → day-types → weekly pattern → overlays → events). A Plan is
 * compiled to a Schedule (one program per distinct day-type, a dense day→program map, fast events), so any planner
 * option opens unchanged in the Simulator.
 *
 * No diet names appear anywhere: presets (UI) fill these fields with numbers.
 *
 * Contract additions of 2026-10-18 (C1–C7, all optional so existing schedules stay valid; absent = the previous
 * behaviour): set groups and dose provenance on resistance sessions (D3-01, D3-09), interval phases and health-intensity
 * class on cardio (D3-03), steps scope (D3-07), reported meal energy with unknown macros (D6-02), carbohydrate mixture /
 * duration / form (D6-07), ME-correction binding (D6-08), active-ingredient doses (D7-04), observed sleep episodes (D8-06),
 * fast provenance (D2-01) and per-day observation metadata from the realised history (C1/C2).
 */
import type { CausalResolution, ChannelCoverageMap } from '@/lib/bodyContracts';

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
  /**
   * Food-matrix ME correction bound to its originating intake (D6-08): a measured food/form-specific ME REPLACES the
   * convention energy of that food (never stacks with another discount); absent = no correction (the conservative
   * design default, not a claim of no matrix effect).
   */
  meCorrection?: MeCorrectionSpec;
}

/** One food-matrix energy correction and what it represents (D6-08). */
export interface MeCorrectionSpec {
  kind: 'sourceMeasuredME' | 'unavailableSubstrate' | 'netEnergy' | 'sensitivityScenario';
  /** Signed correction to the day's ME, kcal (negative = less available energy). */
  kcal: number;
  /** Originating meal event and food (the correction follows that intake across midnight). */
  originEventId?: string;
  foodId?: string;
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
  /**
   * Reported metabolizable energy of this meal, kcal (D6-02, C3). When set, the meal's energy is exactly this value and
   * `macros` lists only the KNOWN grams: an absent macro is unknown, never zero, and the energy not explained by the known
   * grams is unallocated (never deposited in a named glucose/fat/amino-acid pool, never forced through 4/4/9 closure).
   * An explicit `0` in `macros` is a known zero.
   */
  energyKcal?: number;
  /**
   * (D6-02/A1-014) Explicit nutrient knowledge of `macros` when the producer has it: 'known' (analysed or stated, an
   * explicit 0 included), 'imputed' (a named scenario fill), 'unknown' (absent analysis; a compatibility 0 in `macros` is
   * then NOT a known zero). Absent = derive from `macros` key presence when `energyKcal` is set, else the prescription's
   * own construction (an ordinary fully specified macro prescription is complete by construction).
   */
  nutrientKnowledge?: Readonly<Partial<Record<MealNutrientKey, 'known' | 'imputed' | 'unknown'>>>;
  /**
   * (D6-01/D6-03/A1-031) Polyols of this meal by identity, g (`POLYOL_IDENTITY_UNKNOWN` = an identity-unknown total). They
   * are NOT part of `macros.carbG` (non-polyol available carbohydrate); their energy stays inside `energyKcal` under the
   * source's own convention. The engine has no polyol substrate route: glucose/insulin/fuel/ketone outputs that depend on
   * these grams carry a named conditional status (never a resolved zero, never 4 kcal/g glucose).
   */
  polyolsG?: Readonly<Record<string, number>>;
  /** How the polyols relate to the source's figures: inside the printed carbohydrate total or not, and the energy convention. */
  polyolBasis?: { inPrintedCarb: boolean | 'unknown'; energyConvention: 'insideReportedME' | 'sourceSpecific' | 'unknown' };
  /**
   * The exposure provider's verdict on `energyKcal` minus the convention energy of the known grams (D6-02, C3):
   * `reconciliation` = a source record's residual of either sign (specific vs general factors, rounding) — the report is
   * kept exactly and the signed residual is an energy-only correction, never a conflict; `unallocated` = energy of unknown
   * macros; `conflict` = typed numbers that disagree. Absent = the compiler classifies by its gram-rounding tolerance.
   */
  energyResidual?: 'unallocated' | 'reconciliation' | 'conflict';
  /** Id of the logged event this meal replays (binds ME corrections and identity across midnight, C2/D6-08). */
  eventId?: string;
  /** Duration of eating/drinking, h (D6-07); absent = the engine's point-meal convention. */
  intakeDurationH?: number;
  /** Physical form (D6-07). */
  form?: MealForm;
  /** Event-specific carbohydrate mixture, g (D6-07); `unknownG` keeps an unresolved remainder unknown (not glucose). */
  carbComposition?: CarbComposition;
}

/** Nutrients whose knowledge is tracked per meal (D6-02/A1-014; same keys as `EnergyLedger.macroMask`). */
export type MealNutrientKey = 'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol';

/** Key of an identity-unknown polyol total in a `polyolsG` map (A1-031); every other key is a named polyol ('maltitol'…). */
export const POLYOL_IDENTITY_UNKNOWN = 'unidentified';

/** Physical form of an intake event (D6-07). */
export type MealForm = 'solid' | 'liquid' | 'mixed' | 'unknown';

/** Carbohydrate mixture of one event, g (or g/h for during-exercise feeding); absent components are unknown. */
export interface CarbComposition {
  glucoseEqG?: number;
  fructoseG?: number;
  galactoseG?: number;
  unknownG?: number;
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

/** How the load acts in a set group: decides which effort/load factors apply (isometric holds bypass fRIR/fLoad, D3-01). */
export type ContractionType = 'dynamic' | 'isometric' | 'ballistic';

/** Field-level dose provenance (D3-09): a default or inferred field is never treated as a reported hard set. */
export type DoseFieldProvenance = 'reported' | 'inferred' | 'default' | 'unknown';

/**
 * (D3-09/A1-022) Named scenario behind a numeric dose whose hard-set count is unknown: `legacyMinuteConversion` = the
 * retained minutes → sets convention (e.g. 2.5 resistance-min per set). A labelled conditional scenario, not an observation.
 */
export type UnknownDoseScenario = 'legacyMinuteConversion';

/**
 * Identity of a subjective effort rating (D3-03/D3-09/A1-062). The scales have different anchors and are never aliases:
 *  - `rirRpe`: resistance RPE anchored on reps in reserve (RIR = 10 − RPE);
 *  - `cr10`: Borg CR10 (the serialized name of existing records is kept; 3 = moderate, 5 = strong);
 *  - `relativeEffort0To10`: the WHO/CDC generic relative-effort scale (0 sitting, 10 maximal; 5–6 moderate, 7–8 vigorous);
 *  - `unknown`: unscaled/legacy. Only `relativeEffort0To10` (or a stated class/talk test) classifies guideline minutes;
 *    a CR10, RIR-RPE or unscaled number alone leaves guideline minutes unknown.
 */
export type EffortScale = 'rirRpe' | 'cr10' | 'relativeEffort0To10' | 'unknown';
export const EFFORT_SCALES: readonly EffortScale[] = ['rirRpe', 'cr10', 'relativeEffort0To10', 'unknown'];

/** How a guideline intensity class was established (A1-062): stated, talk test, the declared generic scale, or not at all. */
export type HealthClassSource = 'stated' | 'talkTest' | 'relativeEffort0To10' | 'unknown';

/**
 * One homogeneous group of performed or prescribed sets inside a true physical bout (D3-01). The engine applies
 * e_r = Σ_g n_g·w_rg·fType_g·fRIR_g·fLoad_g·fRest_g per group with the run's drawn factors, then sums; groups never become
 * extra sessions and splitting identical groups changes nothing.
 */
export interface ResistanceSetGroup {
  /** Physical sets in the group (whole sets; not the sum of region weights). */
  sets: number;
  /** Per-set region weights w_rg (1 direct, 0.5 indirect…). */
  regionWeights: Partial<Record<TrainingRegion, number>>;
  contraction: ContractionType;
  /**
   * True when `regionWeights` already include the contraction-type factor (the legacy catalogue `setsByRegion` did): the
   * engine then must not apply fType again. Default false.
   */
  typeFactorIncluded?: boolean;
  /** Load, % of 1RM; RIR, reps; inter-set rest, s; absent = unknown (the engine's default is an assumption). */
  loadPct1RM?: number;
  rir?: number;
  restSec?: number;
  reps?: number;
  holdSec?: number;
  exerciseId?: string;
  /** Minutes from the session start to the group's first set, and its duration (keeps hour/midnight crossings exact). */
  startOffsetMin?: number;
  durationMin?: number;
  provenance?: Partial<Record<'sets' | 'regions' | 'load' | 'rir' | 'rest', DoseFieldProvenance>>;
}

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
   * (SPEC V1.5, 2026-10-27) Chosen gross energy of the whole approved bout, kcal (the V2 estimate: G of the shared ledger).
   * When finite and > 0 the activity module books exactly this gross — uniformly over the bout's minutes, or per phase when
   * phases carry their own — regardless of the engine's simulated body mass or drawn O2 energy equivalent; `met` should
   * still carry the equivalent MET (descriptors, hour table). Added because the equivalent-MET adapter alone failed the
   * replay gate (dated vs simulated mass, drawn kcal/L): see model/activity/realisedEnergy.test.ts. Absent = unchanged.
   */
  realisedGrossKcal?: number;
  /**
   * Cold-water immersion straight after this session (dossier 21 intervention catalogue; blunts the hypertrophy
   * response of the session, muscle module). Default false. Added 2026-09-30 (additive).
   */
  coldWaterImmersion?: boolean;
  /** Stable identity of the bout (log entry or prescription slot), carried through compilation (D3-01). */
  sessionId?: string;
  /**
   * (D3-01/A1-020/A1-021) Physical bout identity shared by every engine session part of ONE bout (a hybrid's resistance and
   * cardio parts, several exercises of one workout). Per-bout nonlinear terms are evaluated per bout id; absent = `sessionId`
   * (or, for legacy identity-less schedules, the origin day + session index).
   */
  boutId?: string;
  /**
   * (r063, additive) Moving minutes of the WHOLE physical bout (same `boutId`) when this session is one moving part of a
   * bout split around its pauses. EPOC's duration factor reads the bout's minutes, not the part's, so the parts book one
   * recovery (φ of the bout × Σ the parts' net). Absent = the session is the whole bout (`durationMin`), exactly as before.
   */
  boutDurationMin?: number;
  /** Homogeneous set groups (D3-01). When present they are the session's dose and `setsByRegion`/`volume` are ignored. */
  groups?: readonly ResistanceSetGroup[];
  /**
   * (D3-09/A1-022) Status of the session's quantitative hard-set dose: 'unknown' = the set count was not observed and the
   * groups are the named `unknownDoseScenario` (minute conversion), never observed parity or a reported dose.
   */
  doseStatus?: 'reported' | 'inferred' | 'default' | 'unknown';
  unknownDoseScenario?: UnknownDoseScenario;
  /**
   * Legacy marker (D3-01 migration): `setsByRegion` already includes the contraction-type factor (catalogue conversion
   * multiplied by the set factor). Absent = unknown; the compiler records it so fType is applied exactly once.
   */
  setsByRegionIncludesTypeFactor?: boolean;
  /** (SPEC V1.3, 2026-10-27) Heart-rate summary of the bout. INERT: no engine module reads it (display/audit only). */
  hr?: SessionHrSummary;
}

/**
 * Heart-rate summary of an approved bout (SPEC V1.3, additive). Inert for physiology: the engine never reads it, so an HR
 * estimate can never create training stimulus or change energy except through the booked equivalent MET.
 */
export interface SessionHrSummary {
  /** Time-weighted mean over supported seconds, bpm. */
  avgBpm: number;
  /** Raw maximum of the valid samples, bpm. */
  maxBpm: number;
  /** Seconds of supported HR (hr-support/1); 0 = sampled statistics only. */
  supportedS: number;
  /** How the summary was formed: 'hr-support/1' supported time, 'sampled' sparse samples, 'manual' a stated average. */
  method: 'hr-support/1' | 'sampled' | 'manual';
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
  /**
   * (SPEC V1.5, 2026-10-27) Chosen gross energy of the whole approved bout, kcal (the V2 estimate: G of the shared ledger).
   * When finite and > 0 the activity module books exactly this gross — uniformly over the bout's minutes, or per phase when
   * phases carry their own — regardless of the engine's simulated body mass or drawn O2 energy equivalent; `met` should
   * still carry the equivalent MET (descriptors, hour table). Added because the equivalent-MET adapter alone failed the
   * replay gate (dated vs simulated mass, drawn kcal/L): see model/activity/realisedEnergy.test.ts. Absent = unchanged.
   */
  realisedGrossKcal?: number;
  speedKmh?: number;
  powerW?: number;
  /** Borg CR-10 rating. */
  rpe?: number;
  /** Carbohydrate eaten during the session, g/h (spares liver glycogen, dossier 04 §4.3). */
  carbDuringGPerH?: number;
  /** Mixture of the carbohydrate eaten during the session, g/h by component (D6-07); absent = unknown mixture. */
  carbDuringComposition?: CarbComposition;
  /** Stable identity of the bout (D3-01/D3-07). */
  sessionId?: string;
  /** (A1-020/A1-021) Physical bout identity shared by the parts of one bout; absent = `sessionId` (see `ResistanceSession.boutId`). */
  boutId?: string;
  /**
   * (r063, additive) Moving minutes of the WHOLE physical bout (same `boutId`) when this session is one moving part of a
   * bout split around its pauses. EPOC's duration factor reads the bout's minutes, not the part's, so the parts book one
   * recovery (φ of the bout × Σ the parts' net). Absent = the session is the whole bout (`durationMin`), exactly as before.
   */
  boutDurationMin?: number;
  /**
   * Interval structure (D3-03): phases with their own durations and intensities summing to `durationMin`; energy and
   * high-intensity minutes are computed per phase, never from a session mean. (A1-021) Several doses of one bout are an
   * ordered concatenation of their phases, steady segments and unknown remainders (`kind: 'steady' | 'remainder'`), so
   * merging records never averages away work periods; a `remainder` has no invented intensity.
   */
  phases?: readonly IntervalPhase[];
  /**
   * Guideline activity class stated or classified for public-health minutes (D3-03); 'unknown' is not zero activity. A
   * whole-bout class is set only when every minute belongs to it (vigorous work + light recovery is not wholly vigorous).
   */
  healthIntensityClass?: HealthIntensityClass;
  /** (A1-062) How `healthIntensityClass` was established. */
  healthClassSource?: HealthClassSource;
  /**
   * Scale of `rpe` (D3-03/D3-09/A1-062). Existing serialized 'cr10' is Borg CR10 (never read as the generic guideline
   * scale); absent = unknown. Phases inherit it only when they declare no scale of their own.
   */
  rpeScale?: EffortScale;
  /** Locomotor steps this session contributes to a total-day step count (D3-07; subtracted from the step ledger only). */
  stepsIncluded?: number;
  /** (SPEC V1.3, 2026-10-27) Heart-rate summary of the bout. INERT: no engine module reads it (display/audit only). */
  hr?: SessionHrSummary;
}

/** Public-health intensity class (WHO moderate/vigorous minutes; light does not count; unknown stays unknown). */
export type HealthIntensityClass = 'light' | 'moderate' | 'vigorous' | 'unknown';

/**
 * One phase of an interval session (D3-03). (A1-021) `steady` is a non-interval segment of a concatenated bout with its own
 * intensity; `remainder` is booked time of unknown intensity (no MET, no class: unknown minutes, never invented work).
 */
export interface IntervalPhase {
  kind: 'work' | 'recovery' | 'warmup' | 'cooldown' | 'steady' | 'remainder';
  durationMin: number;
  pctVo2max?: number;
  met?: number;
  /**
   * (SPEC V1.5) Chosen gross energy of this phase, kcal (a supported speed or power segment of an approved bout). Booked
   * exactly when finite and > 0; when the phases carry it they must tile the bout and the session's value is their sum.
   */
  realisedGrossKcal?: number;
  rpe?: number;
  speedKmh?: number;
  powerW?: number;
  /** (A1-062) Scale of this phase's `rpe`; absent = the session's explicitly declared `rpeScale`, else unknown. */
  rpeScale?: EffortScale;
  /** (A1-021/A1-062) Guideline class of this phase's minutes (stated/talk test/generic scale) and how it was established. */
  healthIntensityClass?: HealthIntensityClass;
  healthClassSource?: HealthClassSource;
  /** (A1-021) Exercise and log record the phase came from (provenance inside a concatenated bout). */
  exerciseId?: string;
  sourceId?: string;
}

export type ExerciseSession = ResistanceSession | CardioSession;

export interface SleepSpec {
  bedH?: number;
  wakeH?: number;
  /** Overrides bed/wake difference. */
  hours?: number;
  quality?: 'poor' | 'fair' | 'good';
  shiftWork?: boolean;
  /**
   * An observed sleep episode (D8-06): an episode ending on day D affects waking day D (observed episodes map to the WAKE
   * date; planned template nights keep the starting-date convention). Raw instants are kept unchanged. It is the MAIN
   * episode: its bed/wake instants place hourly sleep (a nap never stretches it).
   */
  observed?: ObservedSleepEpisode;
  /**
   * (D8-06/A1-053) Every observed episode of the waking day (main + naps, duplicates/overlaps included as logged); the
   * compiler unions them once. Absent = only `observed`.
   */
  observedEpisodes?: readonly ObservedSleepEpisode[];
  /**
   * (A1-053) Known total asleep hours of the waking day (the union of every observed episode, h), as reduced from the logs.
   * The compiler honours it and never replaces it with the main interval's duration.
   */
  observedTotalHours?: number;
  /** (A1-053) `partial` = only part of the waking day's sleep is known (e.g. a nap-only record): its known dose is a scenario, never a full night. */
  observedCoverage?: 'complete' | 'partial';
}

/**
 * A logged sleep episode with its instants and zone (D8-06); subjective quality/restfulness only when actually entered. An
 * absent `quality` on an observed episode is UNRATED: it clears a planned template quality and is never read as good/poor.
 */
export interface ObservedSleepEpisode {
  bedAt: string;
  wakeAt: string;
  tz?: string;
  quality?: 'poor' | 'fair' | 'good';
  /** Subjective restfulness 0–10 when entered. */
  restfulness?: number;
  /** Main episode vs a nap (naps are added to duration, not to the main-episode timing). */
  kind?: 'main' | 'nap';
  eventId?: string;
}

export interface SubstanceSpec {
  caffeine?: { clockH: number; mg: number; eventId?: string }[];
  alcohol?: { clockH: number; drinks: number; withMeal?: boolean; eventId?: string }[];
  creatineG?: number;
  creatineLoading?: boolean;
  exogenousKetones?: { clockH: number; gBhb: number; form: 'ester' | 'salt'; eventId?: string }[];
  /**
   * Normalised active-ingredient doses of products actually taken or planned (D7-04, C3): identity, amount in the
   * identity's canonical unit, time and origin. Unknown potency is not listed as a number (it stays an unchecked log).
   */
  actives?: readonly ActiveDoseSpec[];
}

/** One active-ingredient dose event (D7-04). Bolus/peak dose is kept; daily averages are derived, never stored instead. */
export interface ActiveDoseSpec {
  ingredient: string;
  amount: number;
  unit: 'g' | 'mg' | 'ug' | 'mmol';
  clockH?: number;
  /** Product/log event it came from; a planned dose replaced by a linked log disappears from the plan side. */
  eventId?: string;
  origin: 'observed' | 'planned';
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
  /**
   * What `steps` counts (D3-07): `totalDay` includes the locomotor steps of sessions (they are subtracted from the step
   * energy ledger only, via `sessionIncludedSteps`/session `stepsIncluded`), `excludesTraining` does not, `unknown` =
   * legacy/unanswered (an explicit overlap scenario). Absent = 'unknown'.
   */
  stepsScope?: StepsScope;
  /** Steps of the day's sessions inside a total-day count, when known (D3-07). */
  sessionIncludedSteps?: number;
  /** Observation metadata of a realised (replayed) day from the shared history (C1/C2); absent on prescriptions. */
  observed?: DayObservationMeta;
}

/** Scope of a daily step count (D3-07). */
export type StepsScope = 'totalDay' | 'excludesTraining' | 'unknown';

/**
 * Per-day observation metadata a realised-history replay attaches (C1/C2): per-channel coverage, the causal resolution of
 * the day's inputs, and the canonical events/assumptions behind it. Physiology never drops a day for calibration reasons.
 */
export interface DayObservationMeta {
  coverage: ChannelCoverageMap;
  resolution: CausalResolution;
  eventIds?: readonly string[];
  assumptionIds?: readonly string[];
  /** Content hash of the realised history the day came from. */
  historyHash?: string;
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
  /**
   * Provenance of the fast (D2-01/D5-05): `planned` = prescription metadata (policy/consent/forecast; never a
   * physiological multiplier by its length), `observed` = an explicitly completed interval, `censored` = a running fast
   * observed only up to `asOf`. Absent = 'planned'.
   */
  source?: 'planned' | 'observed' | 'censored';
  /** `zeroCalorie` water-only clock vs a `modified` protocol with permitted intake (its identity is not zero intake). */
  protocol?: 'zeroCalorie' | 'modified';
  /** Canonical fast-interval id from the realised history. */
  eventId?: string;
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
  /**
   * The observed prefix of this schedule (C2): days [0, throughDay) were built from the realised history with this content
   * hash and contract version; later days are prospective. Absent = a purely prospective schedule.
   */
  realised?: { historyHash: string; asOf: string; contractVersion: number; throughDay: number };
}
