/**
 * Living-plan domain types (docs/SUITE_SPEC.md §3; docs/LIVING_PLAN.md). Pure data, structured-clone safe; persisted
 * documents are owned by E4's store (`plans`, `planVersions`, `dailyLogs`, `dayStatus`, `measurements`, `anchors`).
 * Additive fields beyond the spec are marked "(E5 additive)".
 */
import type { DayTemplate, FastEvent, MetricId, PersonProfile, Schedule, SeriesId } from '@/engine';
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
  goals: Array<{ metric: MetricId; endP50: number; dateRange: [LocalDate, LocalDate] | null }>;
  warnings: SafetyNote[];
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
  fast?: { lastIntakeAt: Instant; firstIntakeAt: Instant; hours: number; refeedFactor?: number };
  steps?: number;
  sleep?: { bedH: ClockH; wakeH: ClockH };
  supplements: Array<{ supplementId: string; dose: number; unit: string; clockH?: ClockH }>;
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
}

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
}

export type SleepQuality = 'poor' | 'fair' | 'good';
export type StressLevel = 'low' | 'moderate' | 'high';

export interface LogEntryBase {
  /** (E5 additive, store id) ULID of the entry; `supersedes`/`retract` refer to it. */
  id: Id;
  date: LocalDate;
  tz: string;
  at?: Instant;
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
    | { kind: 'meal'; clockH: ClockH; slot?: string; complete?: boolean; components: MealComponent[]; totals: NutrientEstimate;
        /** (E5 additive, optional) carbohydrate-weighted GI and NOVA-4 energy share when the catalogue supplies them. */
        glycaemicIndex?: number; upfShare?: number }
    | { kind: 'session'; status: 'done' | 'partial' | 'skipped'; startH?: ClockH; durationMin?: number; performed: PerformedExercise[];
        rpe?: number; hr?: { avgBpm?: number; maxBpm?: number }; bioWorkoutId?: string; stimulus: StimulusVector; catalogueVersion: string;
        /** (E5 additive) engine sessions of what was done (E8 `toEngineDose`), when the logging command resolved them. */
        engine?: NonNullable<DayTemplate['exercise']>;
        /** (Q1b additive) the device workout a `log.fromBiometrics` session stands for (type, active energy, distance). */
        workout?: DeviceWorkout }
    | { kind: 'fast'; lastIntakeAt: Instant; firstIntakeAt: Instant | null; broken?: boolean; electrolytes?: boolean }
    | { kind: 'steps'; steps: number }
    | { kind: 'sleep'; bedAt: Instant; wakeAt: Instant; quality?: SleepQuality }
    | { kind: 'substance'; substance: 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones'; clockH: ClockH; amount: number; unit: 'mg' | 'drinks' | 'g' }
    | { kind: 'supplement'; supplementId: string; dose: number; unit: string; clockH?: ClockH }
    | { kind: 'subjective'; difficulty?: 1 | 2 | 3 | 4 | 5; hunger?: number; energy?: number; mood?: number; stress?: StressLevel; illness?: boolean }
    | { kind: 'event'; event: 'illness' | 'travel' | 'noTraining' | 'socialMeal' | 'busy' | 'dietBreak' | 'creatineStart'; to?: LocalDate }
    | { kind: 'note' }
    | { kind: 'retract'; target: Id; keep?: Id; overrides?: Id[] }
  );

export type LogKind = LogEntry['kind'];

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
  context?: 'morningFasted' | 'evening' | 'postWorkout' | 'unknown';
  method?: 'scale' | 'tape' | 'dxa' | 'bia' | 'skinfold' | 'navy' | 'lab' | 'meter';
  source: EntrySource;
  supersedes?: Id;
  /** (E5 additive) backfilled/assumed entries are kept but never estimated from. */
  assumed?: boolean;
}

export type MeasurementEntryView = MeasurementEntry & { conflict?: { parentId: Id; versions: MeasurementEntry[] } };

export type Mark = 'asPlanned' | 'partly' | 'not';
export type MarkBlock = 'food' | 'train' | 'fast' | 'all';

export interface DayStatusDoc {
  date: LocalDate;
  planId?: Id;
  planDay?: number;
  marks?: Partial<Record<MarkBlock, Mark>>;
  assumed?: boolean;
  confirmedAt?: Instant;
  prescribed?: PrescribedDaySnapshot;
  score?: AdherenceScore;
  note?: string;
  /** (E5b additive) exercise swaps for this day only, per session slot (`plan.swapExercise`). */
  swaps?: Record<string, DaySwap[]>;
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
  final: boolean;
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
  causes: Array<{ cause: 'adherence' | 'expenditure' | 'waterNoise'; share: number; text: string }>;
  action: 'keepGoing' | 'easeOptions' | 'replan';
  text: string;
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
  label: string;
  energyKcal?: Est;
  source: EntrySource['by'];
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

export interface TodayView {
  date: LocalDate;
  tz: string;
  rolloverH: number;
  mode: 'living' | 'planning';
  minimalMode: boolean;
  quietMode: boolean;
  plan: { id: Id; name: string; rung: RungId | 'custom'; day: number; of: number; status: PlanStatus; version: number } | null;
  prescription: PrescribedDaySnapshot | null;
  logged: {
    entries: LogEntrySummary[];
    measurements?: MeasurementEntryView[];
    totals: { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG: Est };
    items: Array<{ itemId: string; status: 'done' | 'partial' | 'skipped' | 'unknown'; credit?: number }>;
    fast?: { state: 'notStarted' | 'running' | 'done' | 'broken'; sinceH?: number; remainingH?: number };
    steps?: number;
    sleepHours?: number;
  };
  remaining: { energyKcal: number; proteinG: number; carbG: number; fatG: number } | null;
  checklist: TodayChecklistItem[];
  adherence: { today: AdherenceScore | null; a7: number | null; a28: number | null; daysLogged7: number; spark: number[] };
  drift: Array<Pick<DriftGoal, 'metric' | 'state' | 'goalDate' | 'text'>> | null;
  trendWeight: { kg: number; sd: number; todayExpected: { p10: number; p50: number; p90: number }; measured?: number } | null;
  checkIn: { due: boolean; lastAt: LocalDate | null };
  biometrics: {
    lastNight?: { hours: number; efficiency?: number; source: string };
    restingHr?: { value: number; vsBaseline: number };
    hrv?: { state: 'below' | 'normal' | 'above'; metric: 'rmssd' | 'sdnn' };
    flags: Array<{ id: string; level: 'yellow' | 'amber' | 'red'; text: string }>;
  } | null;
  notices: Notice[];
  coachPrompts: string[];
}
