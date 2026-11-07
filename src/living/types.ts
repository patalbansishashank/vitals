/**
 * Living-plan domain types (docs/SUITE_SPEC.md §3; docs/LIVING_PLAN.md). Pure data, structured-clone safe; persisted
 * documents are owned by E4's store (`plans`, `planVersions`, `dailyLogs`, `dayStatus`, `measurements`, `anchors`).
 * Additive fields beyond the spec are marked "(E5 additive)"; the 2026-10-18 body-model contracts (C1–C7, `@/lib/bodyContracts`)
 * add optional fields marked "(C1)…(C7)". Absent contract fields mean "not known" (never false, zero or complete), so every
 * stored document keeps its meaning.
 */
import type { CarbComposition, DayTemplate, FastEvent, MealForm, MetricId, PersonProfile, Schedule, SeriesId, StepsScope } from '@/engine';
import type {
  BandMeta,
  CarbohydrateBasis,
  ChannelCoverage,
  ChannelCoverageMap,
  DayIntakeAttestation,
  DerivationLineage,
  DerivedVersionStamp,
  LineageInvalidation,
  EnergyLedger,
  ExerciseCostBreakdown,
  ExposureId,
  ExposureQuantity,
  OccurrenceTime,
  OutputStatus,
  PlanItemLink,
  QuantityProvenance,
  SafetyCertificate,
  SafetyCheckStatus,
  SafetyStatus,
  SearchOutcome,
  StatusValue,
  SupplementProduct,
  SymptomCategory,
  SymptomStatus,
} from '@/lib/bodyContracts';
import type { GirthLandmark, KetoneSpecimen, MeasurementContext, OperatorId } from '@/lib/measurementOperators';
import type { ExerciseGateStatus, ExerciseSymptomGate } from '@/lib/safetyPolicy';
import type { SafetyNote } from '@/engine/planner/domain/types';
import type {
  ConcreteSessionLike,
  PerformedExercise,
  PlanItemType,
  PlannerProvenanceV2,
  PlannerRequestV2,
  PlanSensitivities,
  ReplanResult,
  RungId,
  StimulusVector,
} from './plannerContract';

// ------------------------------------------------------------------------------------------------ scalars (§0.1)

/** The frozen zone boundaries of an approved session (structurally V2's `ZoneBoundaries`, `hr-zones/*`). */
export interface SessionZoneBoundaries {
  zonesVersion: string;
  basis: 'hrr' | 'pctMax';
  hrMax: number;
  hrRest: number | null;
  edgesBpm: readonly [number, number, number, number, number, number];
}
export type LocalDate = string;
export type Instant = string;
export type ClockH = number;
export type Id = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type CommandId = string;
export type Actor = { kind: 'user' | 'ai' | 'system' | 'device' | 'import'; id?: string };

// ------------------------------------------------------------------------------------------------ lifecycle (§3.1-3.2)
/** Stored status of a plan document. A draft (rung or scenario) is not a document yet. */
export type PlanStatus = 'scheduled' | 'active' | 'paused' | 'ended';
/** Lifecycle state including the pre-start draft. */
export type PlanState = 'draft' | PlanStatus;
export type EndReason = 'completed' | 'abandoned' | 'replaced' | 'safety';

export interface PlanIntentions {
  weighInClockH?: ClockH;
  trainingWeekdays?: Weekday[];
  missedSessionPlan?: 'nextDay' | 'skip' | 'shorter';
}

export interface PlanDoc {
  name: string;
  rung: RungId | 'custom';
  origin: { kind: 'planner'; requestHash: string; runAt: Instant } | { kind: 'scenario'; scenarioId: Id; scenarioRev: string };
  previousPlanId?: Id;
  status: PlanStatus;
  startDate: LocalDate;
  plannedEndDate: LocalDate;
  request: PlannerRequestV2;
  baselineProfile: PersonProfile;
  headVersion: number;
  pauses: Array<{ from: LocalDate; to: LocalDate | null; reason?: string }>;
  ended?: { at: Instant; date: LocalDate; reason: EndReason; note?: string };
  intentions: PlanIntentions;
  policy: { checkInWeekday: Weekday; autoApplyLoadLowering: boolean };
  /** (E5 additive) creation instant: decides which plan wins when sync merges two live plans. */
  createdAt: Instant;
}

export type VersionReason = 'start' | 'light' | 'weekly' | 'event' | 'user' | 'coach' | 'pause' | 'resume' | 'safety';

export interface ProjectionDigest {
  fromDay: number;
  asPrescribed: Partial<Record<SeriesId, { p10: number[]; p50: number[]; p90: number[] }>>;
  realistic: Partial<Record<SeriesId, { p10: number[]; p50: number[]; p90: number[] }>>;
  goals: Array<{ metric: MetricId; endP50: number; dateRange: [LocalDate, LocalDate] | null; outcome?: SearchOutcome; status?: OutputStatus }>;
  warnings: SafetyNote[];
  /**
   * (C2/D5-05) whether `realistic` holds bands or is explicitly unavailable; an empty `realistic` without this flag is legacy
   * and must not be relabelled realistic from `asPrescribed`.
   */
  realisticStatus?: 'available' | 'unavailable';
  /** (C6/D8-02) what the bands are; absent = legacy semantics (parameter-sensitivity range, unvalidated coverage). */
  bandMeta?: BandMeta;
  /** (C4/D5-02) the operator each banded series is expressed in (apply before quantiles; absent = legacy). */
  operators?: Partial<Record<SeriesId, OperatorId>>;
  /** (C2) content hash of the realised history the forecast started from. */
  historyHash?: string;
  /** (C7) what the digest was computed under; `origin` keeps original vs recomputed forecasts apart. */
  stamp?: DerivedVersionStamp;
}

export interface PlanVersionDoc {
  planId: Id;
  version: number;
  parent: number | null;
  status: 'proposed' | 'adopted' | 'rejected' | 'superseded';
  reason: VersionReason;
  effectiveFromDay: number;
  schedule: Schedule;
  genome: { structureId: string; x: number[] } | null;
  sessions: Record<string, ConcreteSessionLike>;
  sensitivities: PlanSensitivities;
  forecast: ProjectionDigest;
  diff?: ReplanResult['diff'];
  explanation: string[];
  provenance: PlannerProvenanceV2 | { engineVersion: string; registryHash: string; catalogueVersion: string };
  createdBy: Actor;
  createdAt: Instant;
  /** (E5b additive) the planned end date this version moves the plan to when adopted (`plan.shift` pushBack). */
  plannedEndDate?: LocalDate;
  /**
   * (C5/D4-01/D4-03) the safety certificate of this version's final schedule. Revalidated at start/adopt/resume/replan:
   * a missing or mismatching certificate is Unchecked, and a legacy boolean check never authorizes.
   */
  certificate?: SafetyCertificate;
  safetyStatus?: SafetyStatus;
  /** Preserved experimental-plan advisories, shown in collapsed Plan Details rather than recurring banners. */
  experimentalWarnings?: string[];
  /** (D4-09) comparison-policy version and (C7) contract fingerprint the version was produced under. */
  policyVersion?: number;
  contracts?: string;
}

export interface PlanStartInput {
  source: { rung: RungId } | { scenarioId: Id };
  startDate: LocalDate;
  name?: string;
  intentions?: PlanIntentions;
}

// ------------------------------------------------------------------------------------------------ prescription (§3.3)
export interface PrescribedItem {
  itemId: string;
  type: PlanItemType;
  /** Renormalised over the day's items (sums to 1). */
  weight: number;
  /** Item targets in engine units (energyKcal, proteinG, startH/endH, hours, steps, sleepH, dose, …). */
  target: Record<string, number>;
}

export interface PrescribedSession {
  slotKey: string;
  startH: ClockH;
  kind: 'resistance' | 'cardio';
  durationMin: number;
  /** Composed session when the version carries one (E8 `ConcreteSession`), else null. */
  concrete: ConcreteSessionLike | null;
  /** What the session should deliver (stimulus currency), when known. */
  stimulus: StimulusVector | null;
  /** Engine sessions of the prescription (exactly what the forecast simulated). */
  engine: NonNullable<DayTemplate['exercise']>;
  /**
   * True on a "training as usual" session (`DayTemplate.habitualTraining`): one of the profile's habitual sessions of the
   * weekday (`habitualSessionsFor`), shown and logged like any session. The engine adds it to the day's energy itself, so a
   * day that logs nothing keeps `habitualTraining` and never adds it again (`toLoggedDay`). Slot keys `<day>:u<k>`.
   */
  usual?: true;
}

export interface PrescribedDaySnapshot {
  planId: Id;
  version: number;
  planDay: number;
  dayType: string;
  energyKcal: number;
  macros: { proteinG: number; carbG: number; fatG: number; fibreG: number };
  window?: { startH: ClockH; endH: ClockH };
  meals: Array<{ slot: string; clockH: ClockH; energyKcal: number; proteinG: number; carbG: number; fatG: number; mealPlanId?: string }>;
  sessions: PrescribedSession[];
  fast?: { lastIntakeAt: Instant; firstIntakeAt: Instant; hours: number; refeedFactor?: number; protocol?: 'zeroCalorie' | 'modified' };
  steps?: number;
  sleep?: { bedH: ClockH; wakeH: ClockH };
  supplements: Array<{
    supplementId: string;
    dose: number;
    unit: string;
    clockH?: ClockH;
    /** (C2/D5-01) item identity a taking log links to (a linked log replaces this dose; an unlinked one is extra). */
    itemId?: string;
    /** (D7-04) label serving and actives frozen with the prescription. */
    product?: SupplementProduct;
  }>;
  items: PrescribedItem[];
  /** (E5 additive) the engine day template the prescription was frozen from (replays of unknown days use it). */
  template: DayTemplate;
  /** (E5 additive) maintenance reference of the day, kcal/d (energy taper and expected-credit replay). */
  maintenanceKcal: number;
  /** (E5 additive) the prescribed fast as an engine event (plan-day indices), when the day starts or holds one. */
  fastEvent?: FastEvent;
  /** (E5 additive) true on a paused day (habitual prescription; logs still count, nothing is scored). */
  paused?: boolean;
}

// ------------------------------------------------------------------------------------------------ daily log (§3.4)
export type LoggingTier = 'T0' | 'T1' | 'T2' | 'T3';

export interface EntrySource {
  by: 'user' | 'ai' | 'device' | 'import' | 'system';
  method: 'typed' | 'asPlanned' | 'aiText' | 'aiPhoto' | 'aiPhotoUserGrams' | 'label' | 'dbMatch' | 'biometrics' | 'import' | 'backfill';
  conversationId?: Id;
  toolCallId?: string;
  bioRecordId?: string;
  actorId?: string;
  /** (Q1b additive) natural key of an entry `log.fromBiometrics` made: `${date}:${stream}` (steps, sleep) or
   * `${date}:workouts:${recordId}`; a re-run finds its own entries by it. */
  deviceKey?: string;
  /**
   * (S1 import) the app the device value came from: `'gauge'` = the person's ring, read from their home server by the
   * Gauge import (`log.fromGauge`, `source.by: 'device'`, `method: 'biometrics'`, `deviceKey` `gauge:<stream>:<date>`).
   * A non-Gauge entry for the same day and item always wins over it (`isGaugeEntry`, `projectEntries`).
   */
  app?: typeof GAUGE_APP;
  /**
   * (energy SPEC §V3.6) The step lineages a fused Gauge steps entry used (`ring`, `phone`, `hc-other:<origin>`), as the
   * server's `steps-fuse/1` reported them; absent on ring-only and on non-Gauge entries.
   */
  sources?: readonly string[];
}

/** (energy SPEC §V3.2) What the inputs of an approved bout's energy estimate were (the cost itself is always `estimated`). */
export interface SessionInputsProvenance {
  hr: 'measured' | 'reported' | 'assumed';
  speed: 'measured' | 'reported' | 'assumed';
  power: 'measured' | 'reported' | 'assumed';
  duration: 'measured' | 'reported' | 'assumed';
}

/** (energy SPEC §V3.6, §2.2) The fused steps day behind a Gauge steps entry: lineages, headline policy and coverage. */
export interface StepsFusionDay {
  version: string;
  located: number;
  headlinePolicy: 'located' | 'atLeast';
  ringDailyTotal?: number | null;
  ringResidual?: number | null;
  coverage?: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number };
  /**
   * (r063 A12) The day's observed step coverage as disjoint [start, end) spans (the union of its located intervals). Today's
   * replay intersects them with the elapsed awake time; absent on older entries (the minute counts are used then).
   */
  spans?: ReadonlyArray<{ start: Instant; end: Instant }>;
}

/** `EntrySource.app` of the entries the Gauge import writes. */
export const GAUGE_APP = 'gauge' as const;

export interface Est {
  value: number;
  sd: number;
}

export interface NutrientEstimate {
  energyKcal: Est;
  proteinG: Est;
  carbG: Est;
  fatG: Est;
  fibreG?: Est;
  sugarsG?: Est;
  satFatG?: Est;
  alcoholG?: Est;
  sodiumMg?: Est;
  /**
   * (C3/D6-02) fields whose `Est` is a placeholder because the quantity is UNKNOWN (absent analysis), not a measured zero.
   * Legacy readers see `{ value: 0, sd: 0 }`; contract readers must treat listed fields as unknown.
   */
  unknown?: ReadonlyArray<Exclude<keyof NutrientEstimate, 'unknown'>>;
}

/** (D6-06) how a component's amount was obtained, independent of the numeric grams (numbers alone never imply weighed). */
export type AmountMethod = 'weighed' | 'labelServing' | 'household' | 'userEstimated' | 'photoEstimated' | 'unknown';

export type SleepQuality = 'poor' | 'fair' | 'good';
export type StressLevel = 'low' | 'moderate' | 'high';

export interface LogEntryBase {
  /** (E5 additive, store id) ULID of the entry; `supersedes`/`retract` refer to it. */
  id: Id;
  date: LocalDate;
  tz: string;
  /** Legacy write instant (audit time of the command; never the physiological occurrence time, C1). */
  at?: Instant;
  /** (C1) audit time of the record, explicitly; `at` is its legacy twin. */
  recordedAt?: Instant;
  /** (C1) when it actually happened (exact, interval, date-only or unknown). Absent = legacy: derive only with a known date meaning. */
  occurrence?: OccurrenceTime;
  /** (C1/C3) provenance of the entry's quantities. */
  provenance?: QuantityProvenance;
  /** (C1) catalogue/recipe/label version the values were resolved with at entry (snapshots never re-read today's tables). */
  sourceVersion?: string;
  /** (C1) `CONTRACT_VERSIONS.observation` at write (absent = legacy, version 0). */
  contract?: number;
  /** (C2) the planned item this entry explicitly replaces; with `extra: true` it is an explicit additional occurrence. */
  link?: PlanItemLink;
  extra?: boolean;
  planId?: Id;
  planDay?: number;
  source: EntrySource;
  confidence?: number;
  assumed?: boolean;
  supersedes?: Id;
  itemId?: string;
  text?: string;
  attachmentIds?: Id[];
}

export interface MealComponent {
  name: string;
  localName?: string;
  foodId?: string;
  recipeId?: Id;
  grams: Est;
  cookingMethod?: string;
  visibleFatCue?: 'none' | 'some' | 'glossy' | 'pooled';
  nutrients: NutrientEstimate;
  nutrientSource: 'table' | 'label' | 'user' | 'model';
  /** (D6-06) amount method; absent = legacy (method unknown, never assumed weighed). */
  amountMethod?: AmountMethod;
  /** (D6-01) carbohydrate basis of the source the nutrients came from (absent = legacy total-by-difference). */
  carbBasis?: CarbohydrateBasis;
  /** (C3/D6-06) shared-error groups (portion, source composition, recipe yield/oil, person bias) this component belongs to. */
  uncertaintyGroupIds?: readonly string[];
  /** (D6-03/D6-05) frozen per-100 g composition snapshot with its source version; null = analysed absent (unknown). */
  snapshot?: { source: 'food' | 'recipe' | 'label' | 'user'; id?: string; version?: string; per100g: Readonly<Record<string, number | null>> };
}

/** (Q1b additive) what a device recorded about a workout. */
export interface DeviceWorkout {
  exerciseType: string;
  kind: 'resistance' | 'cardio' | 'other';
  title?: string;
  activeKcal?: number;
  distanceM?: number;
}

export type LogEntry = LogEntryBase &
  (
    | { kind: 'meal'; clockH: ClockH; slot?: string;
        /** Meal-level completeness only (this meal fully logged); never day completeness (C1/D5-01). */
        complete?: boolean; components: MealComponent[]; totals: NutrientEstimate;
        /** (E5 additive, optional) carbohydrate-weighted GI and NOVA-4 energy share when the catalogue supplies them. */
        glycaemicIndex?: number; upfShare?: number;
        /** (C3/D6-02) energy ledger of the immutable snapshot (reported vs convention ME, residual, macro mask). */
        energy?: EnergyLedger;
        /** (C3/D6-03) normalised exposure quantities of the meal (canonical units, unknown ≠ zero). */
        exposures?: readonly ExposureQuantity[];
        /** (C3/D6-03) nutrient-specific coverage of the meal's totals. */
        nutrientCoverage?: Readonly<Partial<Record<ExposureId, ChannelCoverage>>>;
        /** (D6-07) intake duration, physical form and carbohydrate mixture when known. */
        intakeDurationH?: number; form?: MealForm; carbComposition?: CarbComposition }
    | { kind: 'session'; status: 'done' | 'partial' | 'skipped'; startH?: ClockH; durationMin?: number; performed: PerformedExercise[];
        rpe?: number; hr?: { avgBpm?: number; maxBpm?: number; supportedS?: number; method?: 'hr-support/1' | 'sampled' | 'manual' }; bioWorkoutId?: string; stimulus: StimulusVector; catalogueVersion: string;
        /** (E5 additive) engine sessions of what was done (E8 `toEngineDose`), when the logging command resolved them. */
        engine?: NonNullable<DayTemplate['exercise']>;
        /** (Q1b additive) the device workout a `log.fromBiometrics` session stands for (type, active energy, distance). */
        workout?: DeviceWorkout;
        /** (D3-09) whether the derived dose is reported, inferred, a default or unknown (minutes-only records stay unknown). */
        doseStatus?: 'reported' | 'inferred' | 'default' | 'unknown';
        /**
         * (D5-01) what this entry means for a usual (habitual) session: 'none' = not done (no habitual dose), 'scaled' =
         * partly done at `fraction` of the prescribed usual dose, 'unknown' = no dose can be reconstructed.
         */
        habitualDose?: { kind: 'none' | 'scaled' | 'unknown'; fraction?: number };
        /** (D3-07) locomotor steps inside the day's total-day step count, and the labelled energy terms of the bout. */
        stepsIncluded?: number; cost?: ExerciseCostBreakdown & { inputsProvenance?: SessionInputsProvenance };
        /**
         * (energy SPEC §V3.2) The physical bout an approved activity candidate stands for (its persisted candidate key), and the
         * review decision it was written under: the candidate key and its `decidedRevision` (part of the realised-history hash).
         */
        physicalBoutId?: string;
        candidate?: { key: string; decidedRevision: string; sourceRevision: string; estimateRevision: string | null; estimatorVersion: string; manual?: true };
        /** (energy SPEC §V2.1, audit F11) The HR zone boundaries frozen at approval (a later profile change never rewrites them). */
        zones?: SessionZoneBoundaries;
        /** (0.6.3 S7/A10) Where the phone was during an approved activity (the activity sheet's choice), for step fusion. */
        carry?: 'pocket' | 'hand' | 'desk';
        /**
         * (r063 S10/A15) The moving intervals of a paused bout (the occurrence keeps the whole window; pauses are never
         * exercise time). Absent = the bout moved for its whole interval. Its engine sessions are split at the pauses.
         */
        moving?: ReadonlyArray<{ start: Instant; end: Instant }> }
    | { kind: 'fast'; lastIntakeAt: Instant; firstIntakeAt: Instant | null; broken?: boolean; electrolytes?: boolean;
        /** (C2/D5-05) zero-calorie clock vs a modified protocol with permitted intake. */
        protocol?: 'zeroCalorie' | 'modified' }
    | { kind: 'steps'; steps: number;
        /** (D3-07) what the count includes; absent = legacy 'unknown'. */
        scope?: StepsScope;
        /** (energy SPEC §V3.6) the fused day of `steps-fuse/1` behind a Gauge steps entry (absent on ring-only and typed entries). */
        fusion?: StepsFusionDay }
    | { kind: 'sleep'; bedAt: Instant; wakeAt: Instant; quality?: SleepQuality;
        /** (D8-06) subjective restfulness 0–10 when entered, main episode vs nap, and the sleep-date contract version. */
        restfulness?: number; episodeKind?: 'main' | 'nap'; sleepDateContract?: number;
        /** (S1 import) minutes asleep inside [bedAt, wakeAt) as the device classified them (deep + light + REM); absent = not known. */
        asleepMin?: number;
        /**
         * (energy SPEC §V3.6, D11) The person's own lights-out and out-of-bed instants (user-entered, optional). They unlock true
         * sleep latency and efficiency (`sleepNight`); the ring never supplies them.
         */
        lightsOutAt?: Instant; outOfBedAt?: Instant }
    | { kind: 'substance'; substance: 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones'; clockH: ClockH; amount: number; unit: 'mg' | 'drinks' | 'g';
        /** (D5-01) the validated canonical dose (caffeine mg, ethanol g, creatine/BHB g); raw `amount`/`unit` stay as entered. */
        normalized?: { value: number; unit: 'mg' | 'g'; convention?: 'ethanol14gPerDrink' } }
    | { kind: 'supplement'; supplementId: string; dose: number; unit: string; clockH?: ClockH;
        /** (D7-04) servings taken and the label snapshot; exposure stays unknown when potency is unknown. */
        servings?: number; product?: SupplementProduct; exposures?: readonly ExposureQuantity[];
        /** (D7-04) dose-input validity and safety-check status are separate. */
        doseValidity?: 'valid' | 'invalid'; safetyCheck?: SafetyCheckStatus }
    | { kind: 'subjective'; difficulty?: 1 | 2 | 3 | 4 | 5; hunger?: number; energy?: number; mood?: number; stress?: StressLevel; illness?: boolean;
        /** (D2-06) fixed-time 0–10 ratings: fullness, craving and the clock hour they were rated at (felt hunger ≠ completion). */
        fullness?: number; craving?: number; ratedAtClockH?: ClockH;
        /** (D8-09) observed restfulness/fatigue 0–10 and (D4-04/D8-04) concern flags; never a diagnosis. */
        restfulness?: number; fatigue?: number; concerns?: readonly WellbeingConcern[];
        /** (D4-02) a symptom reported alongside the ratings (same semantics as a `symptom` event). */
        symptom?: LoggedSymptom }
    | { kind: 'event'; event: 'illness' | 'travel' | 'noTraining' | 'socialMeal' | 'busy' | 'dietBreak' | 'creatineStart' | 'symptom'; to?: LocalDate;
        /** (D4-02) a reported symptom: suspends autonomous exercise progression while concerning and unresolved. */
        symptom?: LoggedSymptom }
    | { kind: 'note' }
    | { kind: 'retract'; target: Id; keep?: Id; overrides?: Id[];
        /**
         * (r069) Retract the target and every earlier version of it (a rejected or withdrawn activity's edits): without it,
         * retracting the newest version brings the one before it back. One marker, so one undo restores the newest.
         */
        lineage?: true }
    | { kind: 'stepsCorrection';
        /**
         * (energy SPEC §2.3 4(a)) The person's "use this source" for the steps of [start, end): step fusion takes that
         * lineage there (`ring`, `phone` or `hc-other:<origin>`). Dated on the app day of `start`; removed by a retract.
         */
        start: Instant; end: Instant; use: StepsCorrectionUse }
  );

/** The lineage a step correction asks fusion to use (the server's `corrections[].use`). */
export type StepsCorrectionUse = 'ring' | 'phone' | `hc-other:${string}`;

export type LogKind = LogEntry['kind'];

/** (D4-02) a logged symptom report; never a diagnosis. `occurredOn` defaults to the entry's date. */
export interface LoggedSymptom {
  category: SymptomCategory;
  status: SymptomStatus;
  context?: 'exertional' | 'rest' | 'unknown';
  occurredOn?: LocalDate;
}

/** (D4-04/D8-04/D8-09) observed concern flags; persistent ones override a reassuring model tier. */
export type WellbeingConcern = 'persistentFatigue' | 'performanceDecline' | 'injury' | 'menstrualChange' | 'poorRecovery' | 'dizziness' | 'other';

export type MeasurementMetric =
  | 'weightKg' | 'waistCm' | 'hipCm' | 'neckCm' | 'chestCm' | 'armCm' | 'thighCm' | 'bodyFatPct' | 'sbpMmHg' | 'dbpMmHg'
  | 'ketonesMmolL' | 'glucoseMmolL' | 'ldlMmolL' | 'hdlMmolL' | 'tgMmolL' | 'apoBgL' | 'fastingGlucoseMmolL' | 'hba1cPct' | 'crpMgL';

export interface MeasurementEntry {
  id: Id;
  date: LocalDate;
  at?: Instant;
  metric: MeasurementMetric;
  value: number;
  repeats?: number[];
  /** Raw BP repeats: fullRawList is exhaustive (value is its mean); primaryPlusAdditional adds repeats to value.
   * Absent encoding with repeats preserves ambiguous legacy data. */
  repeatsEncoding?: 'fullRawList' | 'primaryPlusAdditional';
  context?: 'morningFasted' | 'evening' | 'postWorkout' | 'unknown';
  method?: 'scale' | 'tape' | 'dxa' | 'bia' | 'skinfold' | 'navy' | 'lab' | 'meter';
  source: EntrySource;
  supersedes?: Id;
  /** (E5 additive) backfilled/assumed entries are kept but never estimated from. */
  assumed?: boolean;
  // ---- (C1/C4) measurement contract additions (optional; absent = unknown, lower information)
  recordedAt?: Instant;
  occurrence?: OccurrenceTime;
  /** Observation operator (absent: derive from metric/method/specimen; never relabel legacy trend weight as scale). */
  operator?: OperatorId;
  /** Protocol context: unknown is not standardized (`legacyMeasurementContext` maps the legacy `context`). */
  measurementContext?: MeasurementContext;
  device?: string;
  protocol?: string;
  /** Revision of an edited observation (consumed once per revision) and the observations it was derived from. */
  revision?: number;
  parents?: readonly Id[];
  /** (D5-07) scan masses of a body-composition reading. */
  scanMassKg?: number;
  scanFatMassKg?: number;
  /** (D1-03) girth landmark. */
  landmark?: GirthLandmark;
  /** (D4-05) blood-pressure episode pairing and protocol facts. */
  episodeId?: string;
  restMin?: number;
  setting?: 'home' | 'clinic' | 'pharmacy' | 'other' | 'unknown';
  timeOfDay?: 'morning' | 'evening' | 'other';
  /** (D2-08) ketone specimen (urine/breath never become blood BHB). */
  specimen?: KetoneSpecimen;
  /** (D7-06/D7-09) lab sample identity and fasting duration, h. */
  sampleId?: string;
  fastingHours?: number;
}

export type MeasurementEntryView = MeasurementEntry & { conflict?: { parentId: Id; versions: MeasurementEntry[] } };

export type Mark = 'asPlanned' | 'partly' | 'not';
export type MarkBlock = 'food' | 'train' | 'fast' | 'all';

/**
 * A day's marks: the day-wide ones by block, and (additive, optional) each meal's own answer by its slot
 * (`{ meals: { breakfast: 'partly' } }`, `log.markDay` with `meal`). A meal's answer covers that meal only; a meal answered
 * "as planned" is logged as its planned meal instead, so `meals` holds what was said without an amount (partly, not).
 * Documents written before `meals` existed read as no meal answered.
 */
export type DayMarks = Partial<Record<MarkBlock, Mark>> & { meals?: Record<string, Mark> };

export interface DayStatusDoc {
  date: LocalDate;
  planId?: Id;
  planDay?: number;
  marks?: DayMarks;
  /**
   * (C1/D5-01) the person's explicit day-level food report: complete / partial / none (= confirmed zero intake). Absent =
   * no statement (legacy days and per-meal `complete` flags never imply day completeness).
   */
  intake?: DayIntakeAttestation;
  intakeAt?: Instant;
  assumed?: boolean;
  confirmedAt?: Instant;
  prescribed?: PrescribedDaySnapshot;
  score?: AdherenceScore;
  note?: string;
  /** (E5b additive) exercise swaps for this day only, per session slot (`plan.swapExercise`). */
  swaps?: Record<string, DaySwap[]>;
  /**
   * (energy SPEC §V3.6, D11, D21; `log.sleepTimes`) diary times for the night ending on this date, kept here only while
   * that night has no sleep entry yet ("Going to sleep" is tapped before the ring has the night). The next
   * `log.sleepTimes` after the night arrives moves them onto its entry; readers fall back to these until then.
   */
  sleepDiary?: { lightsOutAt?: Instant; outOfBedAt?: Instant; at: Instant };
}

/** One exercise swapped for another on a day, with how much of the prescribed session's stimulus the swap keeps. */
export interface DaySwap {
  slotKey: string;
  from: string;
  to: PerformedExercise;
  credit: number;
  band: string;
}

// ------------------------------------------------------------------------------------------------ estimation (§3.5)
export interface ConfirmedStateRecord {
  planId: Id;
  anchorDate: LocalDate;
  /** (E5 additive) plan-day index of the anchor. */
  anchorDay: number;
  trendWeight: { kg: number; sd: number };
  energyBiasKcal: { mean: number; sd: number };
  /** Tissue mass the engine was anchored to and how the residual was split. */
  residualSplit: { tissueMassKg: number; residualKg: number; fatKg: number; leanKg: number; source: 'engine' | 'bia' | 'girth' | 'bia+girth' | 'dxa'; fatFrac?: number };
  /** Hash of everything the replay up to the anchor depended on (logged inputs, anchors, δ steps, baseline profile). */
  inputsHash: string;
  engine: { engineVersion: string; registryHash: string };
  /** (E5 additive) why the anchor was set. */
  trigger: 'weekly' | 'hard';
  hardReason?: HardReanchorReason;
  // ---- (C2/C4/C7) estimator contract additions (optional; absent = legacy semantics)
  /**
   * Operator of `trendWeight` (D5-02): absent = 'legacyTrendWeight' (latent water-adjusted mass, never a raw scale value).
   */
  trendWeightOperator?: OperatorId;
  /** Raw scale trend kept separately from the water-adjusted estimate (D5-02). */
  rawScale?: { kg: number; sd: number | null };
  /**
   * Estimator strategy/version/params hash (D5-04): parameter changes invalidate filters and evidence. (A1-038)
   * `jointStateDeviceBias` = composition evidence under one own-time state + shared device-bias likelihood (innovations
   * consumed once; absolute bias variance never collapses), replacing lifetime precision subtraction.
   */
  estimator?: { strategy: 'fixedPriorRefit' | 'legacySequential' | 'jointStateDeviceBias'; version: number; paramsHash: string; windowDays?: number };
  /**
   * (D5-07/A1-017) Complete derivation lineage of this record's derived anchor (`residualSplit`): observation revisions and
   * values used, realised history, estimator/operator identity, previous-anchor dependency. Absent = legacy: the anchor
   * cannot be checked against the current observation graph and is historical/conditional only, never current inference.
   * The record itself (the original confirmed decision) is never rewritten; current state comes from `DerivedAnchorRecord`.
   */
  derivation?: DerivationLineage;
  /**
   * (D5-07/A1-038) Composition evidence the decision used, by stable device/method group (shared bias within a group,
   * repeatability per reading); `longitudinalSensitivity` unknown/unsupported keeps within-device change corroborative.
   */
  compositionEvidence?: CompositionEvidence;
  /** Observation (revision) ids consumed by this decision: an observation is never reused as new independent evidence. */
  consumedObservationIds?: readonly Id[];
  /** The confirmed decision that produced the record (hysteresis advances only per decision, D5-06). */
  decisionId?: Id;
  /** Balance correction ledger (D5-03): requested vs applied, controller saturation, the application law. */
  correction?: { requestedKcal: number; appliedKcal: number; saturated: boolean; stepLimited: boolean; mechanism: 'absorbedMacroImputation' };
  /** Shared realised history the replay used (C2) and what the record was computed under (C7). */
  historyHash?: string;
  stamp?: DerivedVersionStamp;
}

/**
 * (D5-07/A1-038) Composition evidence of one decision, by stable device/method group. Within a group the readings share
 * one provisional systematic bias (variance `systematicSdPct²`, never collapsing) and carry their own repeatability; the
 * state is evaluated at each reading's own time. Unknown device identity or a method change opens a new group.
 */
export interface CompositionEvidence {
  status: 'updated' | 'noNewReadings' | 'corroborativeOnly' | 'deviceBiasFloor' | 'none';
  groups: ReadonlyArray<{
    groupId: string;
    method: string;
    device?: string;
    protocol?: string;
    /** Observation (revision) ids of the group, in occurrence order; each innovation is consumed once. */
    observationIds: readonly Id[];
    /** Stable shared bias assumed within the group, or segmented because identity/method is unknown or changed. */
    bias: 'stableAssumed' | 'unknownDevice' | 'methodChanged';
    /** Whether within-device CHANGE may update tissue state; unknown/unsupported = corroborative/scenario only. */
    longitudinalSensitivity: 'supported' | 'unsupported' | 'unknown';
    repeatabilitySdPct?: number;
    systematicSdPct?: number;
  }>;
  uncertaintyKind: 'conditionalResidual' | 'scenario';
  coverage: 'unvalidated';
}

/**
 * (D5-07/A1-017) A recomputed CURRENT-state anchor, kept separately from the original confirmed decision it re-derives.
 * Rebuilt deterministically from the earliest unaffected fixed prior/anchor after an observation retraction/revision or
 * an incompatible estimator/operator change, then propagated forward. A refit is never a new confirmation, never a
 * controller step and never rewrites the original record, adopted prescriptions, issued forecasts or applied corrections.
 */
export interface DerivedAnchorRecord {
  kind: 'vitals.derivedAnchor';
  planId: Id;
  anchorDate: LocalDate;
  anchorDay: number;
  /** The original confirmed decision it re-derives (identity only; the decision count does not change). */
  sourceDecisionId?: Id;
  sourceInputsHash: string;
  trendWeight: { kg: number; sd: number };
  energyBiasKcal: { mean: number; sd: number };
  residualSplit: ConfirmedStateRecord['residualSplit'];
  /** Lineage of THIS recomputation (the current effective graph it matches). */
  derivation: DerivationLineage;
  /** `current` = valid current inference; `historicalOnly` = a legacy anchor that could not be reconstructed (conditional only). */
  compatibility: 'current' | 'historicalOnly';
  /** Why the source anchor was recomputed or declined. */
  reason: LineageInvalidation | 'none';
  stamp: DerivedVersionStamp & { origin: 'recomputed' };
}

/**
 * (D5-06) A check-in decision: a preview may be persisted by automatic refresh, but only an explicit Check in (or a stored
 * opt-in policy) confirms it, exactly once. Keys cover evidence ids, history hash, versions and decision point.
 */
export interface CheckInDecisionRecord {
  id: Id;
  planId: Id;
  /** The decision point (check-in date); catch-up never fabricates backdated confirmations. */
  decisionPoint: LocalDate;
  evidenceIds: readonly Id[];
  historyHash: string;
  stamp: DerivedVersionStamp;
  status: 'preview' | 'confirmed' | 'superseded';
  confirmedAt?: Instant;
  confirmedBy?: Actor;
  /** Proposed plan version prepared by this decision, if any (adoption stays with the existing apply/discard flow). */
  proposalVersion?: number;
}

/** (D5-08) semantics of a behavioural forecast: scenario family, version and seed; never a calibrated probability by default. */
export interface BehaviorForecastMeta {
  algorithm: 'asPrescribed' | 'plausibleExecution' | 'missingData' | 'pathEnsemble';
  version: number;
  seed?: number;
  paths?: number;
  /** Always 'heuristic' until prospective calibration exists. */
  calibration: 'heuristic' | 'prospectivelyCalibrated';
}

export type HardReanchorReason = 'illness' | 'travel' | 'dietBreak' | 'longFastEnd' | 'newBlock' | 'weighInGap' | 'dxa' | 'engineVersion';

// ------------------------------------------------------------------------------------------------ adherence (§3.7)
export interface AdherenceItemScore {
  itemId: string;
  type: PlanItemType;
  weight: number;
  credit: number | null;
  why: string;
}

export interface AdherenceScore {
  score: number | null;
  coverage: number;
  items: AdherenceItemScore[];
  /** The score is final (confirmed day); says nothing about food-log completeness (C1/D5-01). */
  final: boolean;
  /** (D3-02/D5-08) scoring semantics version (recomputed history keeps its version tag). */
  scoringVersion?: number;
}

export interface AdherenceTrend {
  a7: number | null;
  a28: number | null;
  /** Scored days in the last 7 / 28, and logged days in the last 7 (headline "6 of the last 7 days logged"). */
  scored7: number;
  scored28: number;
  daysLogged7: number;
  arrow: 'up' | 'down' | 'steady' | null;
  spark: number[];
}

// ------------------------------------------------------------------------------------------------ drift (§3.8)
export type DriftState = 'ahead' | 'onTrack' | 'behind';

export interface DriftGoal {
  goal: number;
  metric: MetricId;
  target: number | null;
  trend: { value: number; sd: number };
  band: { p10: number; p90: number };
  state: DriftState;
  checkInsOutside: number;
  goalDate: { range: [LocalDate, LocalDate] | null; shiftDays: number | null; shiftSd: number | null };
  /**
   * Legacy causal shares. D5-02: removed from new reports (always empty); kept so stored reports parse. Never shown.
   */
  causes: Array<{ cause: 'adherence' | 'expenditure' | 'waterNoise'; share: number; text: string }>;
  action: 'keepGoing' | 'easeOptions' | 'replan';
  text: string;
  // ---- (C4/C6, D5-02) drift contract additions (optional)
  /** Operator both trend and forecast are expressed in (matched observable and sample time). */
  operator?: OperatorId;
  /** 'unclear' = insufficient data or uncertainty too wide to classify (distinct from on track). */
  certainty?: 'clear' | 'unclear';
  /** Recorded mean intake difference vs prescription with its quantitative-day count (observed, not a cause). */
  loggedIntakeDiff?: { kcalPerDay: number; quantDays: number; daysInWindow: number } | null;
  /** Unexplained balance/model residual, kcal/day (a predictive correction, not measured expenditure). */
  residual?: StatusValue;
  /** Confirmed check-in decision ids the hysteresis count is based on. */
  decisionIds?: readonly Id[];
}

export interface DriftReport {
  asOf: LocalDate;
  goals: DriftGoal[];
}

// ------------------------------------------------------------------------------------------------ Today (§3.9)
export interface Notice {
  id: string;
  kind: 'safety' | 'proposal' | 'pendingChange' | 'sync' | 'welcomeBack' | 'checkIn' | 'completed' | 'burden' | 'info';
  level: 'info' | 'caution' | 'danger';
  text: string;
  command?: { id: CommandId; input: unknown };
}

export interface LogEntrySummary {
  id: Id;
  kind: LogKind;
  at?: Instant;
  clockH?: ClockH;
  /** (additive) A meal's slot when it was logged against one, so a meal's food and its answer are read by the same slot. */
  slot?: string;
  label: string;
  energyKcal?: Est;
  source: EntrySource['by'];
  /** (S1 import) 'gauge' when the value came from the person's ring through the Gauge import. */
  app?: EntrySource['app'];
  aiEstimated: boolean;
  confidence?: number;
  /** Effective descendants of one original entry; each version keeps its real command target id. */
  conflict?: { parentId: Id; versions: LogEntrySummary[] };
}

export interface TodayChecklistItem {
  id: string;
  at?: ClockH;
  kind: 'mark' | 'meal' | 'session' | 'fast' | 'supplement' | 'weigh' | 'measure' | 'sleep' | 'steps';
  label: string;
  done: boolean;
  command: { id: CommandId; input: unknown };
}

/** (D4-02/A1-005) Version of the current exercise-eligibility overlay semantics (`CurrentExerciseEligibility.version`). */
export const CURRENT_EXERCISE_ELIGIBILITY_VERSION = 1;

/** Exercise scopes an eligibility overlay permits or holds (the `ClinicianExerciseEnvelope.permitted` vocabulary). */
export type ExerciseScope = 'resistance' | 'cardio' | 'walking' | 'steps' | 'other';

/**
 * (D4-02/A1-005) The authoritative CURRENT exercise eligibility for unperformed current/future recommendations: one pure
 * derived evaluation of current screening, symptom reports/resolutions, clinician envelopes (with their current dates) and
 * the documented baseline (`exerciseSymptomGate` semantics), re-evaluated after any relevant log/profile/safety/envelope
 * change and at plan activation/date rollover — never waiting for a check-in, a lock window or a replan. An overlay only:
 * the original prescription snapshot stays as historical prescribed provenance, logged activity is never rewritten.
 */
export interface CurrentExerciseEligibility {
  /** `CURRENT_EXERCISE_ELIGIBILITY_VERSION` (a reader that does not know it uses its legacy screening/notice fallback). */
  version: number;
  /** The day evaluated (current state at that day). */
  asOf: LocalDate;
  status: ExerciseGateStatus;
  reasonCode: ExerciseSymptomGate['reasonCode'];
  /** Autonomous new RT/cardio prescription and dose/step progression allowed now. */
  allowsNewExercise: boolean;
  allowsProgression: boolean;
  /** Scopes permitted for unperformed current/future recommendations, and scopes on hold (shown as Review). */
  permitted: readonly ExerciseScope[];
  held: readonly ExerciseScope[];
  /**
   * The step instruction after the overlay: `unchanged` (the prescription applies), `capped` (never above the documented
   * baseline or the clinician's explicit ceiling), `noNumericTarget` (held with no documented baseline: no invented number).
   */
  steps: {
    status: 'unchanged' | 'capped' | 'noNumericTarget';
    /** Current target, steps/d (null = no numeric target). */
    target: number | null;
    /** The prescribed target it overlays (historical provenance, never rewritten); null = none prescribed. */
    prescribed: number | null;
    ceiling: number | null;
    /** `documentedBaseline` = manually entered habitual steps/d; `clinicianCeiling` = an explicit envelope ceiling. */
    ceilingSource: 'documentedBaseline' | 'clinicianCeiling' | 'none';
  };
  /** Concerning unresolved symptoms not covered by a valid envelope, and the envelope in force. */
  symptomIds: readonly string[];
  envelopeId?: string;
  /**
   * Hash of the symptom/envelope/screening/baseline inputs: a prescription assurance (certificate) keyed to another
   * fingerprint is no longer current for the affected scope (the old one stays as history).
   */
  fingerprint: string;
}

export interface TodayView {
  date: LocalDate;
  tz: string;
  rolloverH: number;
  mode: 'living' | 'planning';
  minimalMode: boolean;
  quietMode: boolean;
  plan: { id: Id; name: string; rung: RungId | 'custom'; day: number; of: number; status: PlanStatus; version: number } | null;
  /**
   * Today's prescription: the adopted snapshot with the current exercise-eligibility overlay already applied to its
   * unperformed session and step instructions (A1-005), so a steps-only consumer never reads a held target. The adopted
   * target stays in `exerciseEligibility.steps.prescribed` and in the projection days / frozen day status.
   */
  prescription: PrescribedDaySnapshot | null;
  /**
   * (D4-02/A1-005) Authoritative current exercise eligibility; consumers use it when present and fall back to the legacy
   * screening/notice reading only when absent (so a covering current envelope restores exactly its permitted scope).
   */
  exerciseEligibility?: CurrentExerciseEligibility;
  logged: {
    entries: LogEntrySummary[];
    measurements?: MeasurementEntryView[];
    totals: { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG: Est };
    items: Array<{ itemId: string; status: 'done' | 'partial' | 'skipped' | 'unknown'; credit?: number }>;
    /**
     * `sinceH` is the observed elapsed (running) or counted (ended) length; `remainingH` the plan's continuation only.
     * (D5-05, additive) `endedClockH`: the local clock hour the fast ended at, only when its end is an observed instant
     * (absent = end unknown or not ended).
     */
    fast?: { state: 'notStarted' | 'running' | 'done' | 'broken'; sinceH?: number; remainingH?: number; endedClockH?: number };
    steps?: number;
    sleepHours?: number;
    /** (D8-06, additive) the quality the person entered for last night's main sleep (absent = not entered; never modelled). */
    sleepQuality?: SleepQuality;
  };
  remaining: { energyKcal: number; proteinG: number; carbG: number; fatG: number } | null;
  /** (additive) The day's marks as given: the day-wide ones and each meal's own answer by slot (`DayMarks`). */
  marks?: DayMarks;
  /** (C1/D5-01) explicit day food report and the per-channel coverage of the day (absent channel = unknown). */
  intake?: DayIntakeAttestation;
  coverage?: ChannelCoverageMap;
  checklist: TodayChecklistItem[];
  adherence: { today: AdherenceScore | null; a7: number | null; a28: number | null; daysLogged7: number; spark: number[] };
  drift: Array<Pick<DriftGoal, 'metric' | 'state' | 'goalDate' | 'text'>> | null;
  trendWeight: { kg: number; sd: number; todayExpected: { p10: number; p50: number; p90: number }; measured?: number } | null;
  checkIn: { due: boolean; lastAt: LocalDate | null };
  notices: Notice[];
  coachPrompts: string[];
}
