/**
 * Canonical biometrics contract `vitals.biometrics/1` (SUITE_SPEC §4). Tier P: pure types only.
 * Wire and storage names are snake_case to match the published schema; Vitals-internal interfaces are camelCase.
 */

/** 'YYYY-MM-DD' in the user's IANA time zone. */
export type LocalDate = string;
/** ISO-8601 UTC with 'Z', millisecond precision. */
export type Instant = string;

export const BIO_SCHEMA = 'vitals.biometrics/1' as const;

export type DeviceTier = 'A' | 'B' | 'C';
export type DeviceType = 'ring' | 'watch' | 'band' | 'phone' | 'scale' | 'strap' | 'manual';

export type BioChannel =
  | 'manual'
  | 'file:apple_health'
  | 'file:health_auto_export'
  | 'file:health_connect'
  | 'file:gadgetbridge'
  | 'file:canonical'
  | 'file:lumen_cloudevents'
  | 'file:lumen_archive'
  | 'share'
  | 'bridge:android'
  | 'shortcut:ios'
  | 'mqtt:lumen'
  | `ble:${string}`
  | `oauth:${string}`
  | 'companion:ingest';

export type BioStream =
  | 'hr'
  | 'ibi'
  | 'hrv'
  | 'spo2'
  | 'skin_temp'
  | 'body_temp'
  | 'resp_rate'
  | 'steps'
  | 'distance'
  | 'active_kcal'
  | 'motion'
  | 'sleep_state'
  | 'sleep_stage'
  | `vendor:${string}`;

/** The raw series streams E10 stores as chunks (§4.2); vendor streams are allowed too. */
export const RAW_STREAMS = [
  'hr', 'ibi', 'hrv', 'spo2', 'skin_temp', 'body_temp', 'resp_rate', 'steps', 'distance', 'active_kcal', 'motion', 'sleep_state', 'sleep_stage',
] as const satisfies readonly BioStream[];

/** Provenance: where a value came from and how it was produced. `recording_method`/`modality` + `quality.validation`
 * together carry "measured | estimated | vendor". */
export interface BioProvenance {
  channel: BioChannel;
  source_app?: string;
  device?: { type: DeviceType; manufacturer?: string; model?: string; firmware?: string; tier: DeviceTier };
  recording_method: 'automatic' | 'active' | 'manual' | 'unknown';
  modality: 'sensed' | 'self_reported' | 'derived';
  native_id?: string;
  native_version?: string;
  source_created_at?: string;
  ingested_at: string;
  /** e.g. 'jstyle2301/V0789@1' */
  decoder?: string;
  algorithm?: { name: string; version: string; doc_url?: string };
}

export type QualityFlag =
  | 'provisional_stages'
  | 'hrv_vendor_defined'
  | 'apple_sdnn'
  | 'out_of_range'
  | 'partial_day'
  | 'estimated_vo2'
  | 'ai_extracted'
  | 'clock_drift';

export interface BioQuality {
  validation: 'measured' | 'vendor_proprietary' | 'estimated' | 'self_reported';
  confidence: 'low' | 'medium' | 'high' | null;
  /** 0..1 */
  completeness?: number;
  vendor_state?: string;
  flags: QualityFlag[];
}

export interface BioTime {
  start?: string;
  end?: string;
  at?: string;
  tz_offset_s: number;
  local_date: LocalDate;
}

export interface BioCommon {
  kind: 'daily' | 'sleep' | 'workout' | 'series' | 'spot' | 'device_profile';
  /** UUIDv5(source, native_id) or of (kind, metric, start, source); stored as `${record_id}@${version}`. */
  record_id: string;
  /** Monotonic for upserts; readers take the highest. */
  version: number;
  time: BioTime;
  provenance: BioProvenance;
  quality: BioQuality;
}

export interface HrvValue {
  metric: 'rmssd' | 'sdnn' | 'vendor';
  value_ms: number;
}

export interface VendorOpinion {
  stress?: { value: number; scale: string };
  readiness?: number;
  sleep?: number;
  recovery?: number;
  strain?: number;
  body_battery?: number;
}

export interface DailyRecord extends BioCommon {
  kind: 'daily';
  steps?: number;
  distance_m?: number;
  active_kcal?: number;
  total_kcal?: number;
  /** minutes */
  active_min?: { light: number; moderate: number; vigorous: number };
  resting_hr_bpm?: number;
  hr_avg_bpm?: number;
  hr_min_bpm?: number;
  hr_max_bpm?: number;
  hrv?: HrvValue & { window: 'night' | 'deep_sleep' | 'first_4h' | 'morning' | 'spot'; n?: number };
  spo2_avg_pct?: number;
  spo2_min_pct?: number;
  resp_rate_brpm?: number;
  skin_temp_delta_c?: number;
  skin_temp_c?: number;
  body_temp_c?: number;
  vo2max?: { ml_kg_min: number; method: 'lab' | 'field_test' | 'vendor_estimate' | 'derived' };
  /** Vendor opinion only; never an input to a score, the engine or the plan. */
  vendor?: VendorOpinion;
  main_sleep_id?: string;
}

export type SleepStageName = 'unknown' | 'awake' | 'awake_in_bed' | 'out_of_bed' | 'asleep_unspecified' | 'light' | 'deep' | 'rem';

export interface SleepStageInterval {
  start: string;
  end: string;
  stage: SleepStageName;
}

export interface SleepRecord extends BioCommon {
  kind: 'sleep';
  is_main: boolean;
  in_bed_s?: number;
  asleep_s: number;
  awake_s?: number;
  light_s?: number;
  deep_s?: number;
  rem_s?: number;
  unknown_s?: number;
  latency_s?: number;
  waso_s?: number;
  awakenings?: number;
  efficiency_pct?: number;
  /** Apple "core" maps to light. */
  stages?: SleepStageInterval[];
  /** chunkId of the vendor's raw stage codes + firmware, so a corrected map can rescore. */
  raw_codes_chunk?: string;
  night?: { hr_min_bpm?: number; hrv?: HrvValue; spo2_avg_pct?: number; resp_rate_brpm?: number; skin_temp_delta_c?: number };
}

export interface WorkoutRecord extends BioCommon {
  kind: 'workout';
  exercise_type: string;
  native_type?: string;
  title?: string;
  active_duration_s: number;
  distance_m?: number;
  active_kcal?: number;
  hr_avg_bpm?: number;
  hr_max_bpm?: number;
  hr_zones_s?: number[];
  rpe_0_10?: number;
  load?: { value: number; method: 'trimp' | 'srpe' | 'vendor' };
  percent_recorded?: number;
  hr_chunk_ids?: string[];
}

export type SeriesAggregation = 'sample' | 'avg' | 'min' | 'max' | 'sum';
export type SeriesContext = 'sleep' | 'rest' | 'exercise' | 'unknown';

/** Wire form of a raw series. Stored as chunks (§4.2); `values[i]` is at `time.start + t_offset_s[i]`
 * (or `+ i * interval_s` when `t_offset_s` is omitted). */
export interface SeriesRecord extends BioCommon {
  kind: 'series';
  metric: BioStream;
  unit: string;
  aggregation: SeriesAggregation;
  interval_s?: number;
  sampling: { mode: 'continuous' | 'periodic' | 'spot' | 'event'; nominal_interval_s?: number; device_tier?: DeviceTier };
  context?: SeriesContext;
  t_offset_s?: number[];
  values: number[];
  /** Off-wrist intervals as [start_offset_s, end_offset_s]. */
  wear?: Array<[number, number]>;
  quality_mask?: number[];
}

export type SpotMetric =
  | 'weight_kg' | 'body_fat_pct' | 'lean_mass_kg' | 'waist_cm' | 'bp_sys_mmhg' | 'bp_dia_mmhg' | 'glucose_mg_dl' | 'body_temp_c' | 'hr_bpm' | 'spo2_pct' | 'hrv_ms';

export interface SpotRecord extends BioCommon {
  kind: 'spot';
  metric: SpotMetric;
  value: number;
  context?: 'fasting' | 'morning' | 'post_workout';
}

/** Own validation of a device model (R9 §3); replaces tier-C bands for that model. */
export interface DeviceProfileRecord extends BioCommon {
  kind: 'device_profile';
  model: string;
  firmware_range?: string;
  metric: BioStream;
  bias: number;
  loa_lo: number;
  loa_hi: number;
  n_nights: number;
  reference_device: string;
}

export type BioRecord = DailyRecord | SleepRecord | WorkoutRecord | SeriesRecord | SpotRecord | DeviceProfileRecord;
export type BioRecordKind = BioRecord['kind'];

export interface BioBatch {
  schema: typeof BIO_SCHEMA;
  producer: { name: string; version: string };
  exported_at: string;
  tz: string;
  records: BioRecord[];
}

// ---------------------------------------------------------------- raw sample chunks (§4.2)

export type SampleOrigin = 'history' | 'spot' | 'live' | 'workout_stream' | 'import';
export const SAMPLE_ORIGINS: readonly SampleOrigin[] = ['history', 'spot', 'live', 'workout_stream', 'import'];

/** One raw sample in memory. `t` is epoch milliseconds UTC. Identity inside a chunk is `(origin, t)`. */
export interface RawSample {
  t: number;
  value: number;
  origin: SampleOrigin;
  /** 0 = good; non-zero = artefact or rejected. */
  quality?: number;
}

/** Key of one chunk: (source, stream, local date[, UTC hour when split]). */
export interface ChunkKey {
  sourceKey: string;
  stream: BioStream;
  local_date: LocalDate;
  hourStartUtc?: string;
}

export interface BioChunkManifest {
  chunkId: string;
  sourceKey: string;
  stream: BioStream;
  local_date: LocalDate;
  hourStartUtc?: string;
  n: number;
  min: number;
  max: number;
  bytes: number;
  contentHash: string;
  schemaVersion: 1;
  decoder?: string;
  createdAt: Instant;
  /** A re-sync with more samples writes a merged chunk that supersedes the old one. */
  supersedes?: string;
}

/** Decoded chunk header. */
export interface ChunkHeader {
  t0_ms: number;
  /** null when irregular (delta-coded offsets follow). */
  dt_ms: number | null;
  /** values are stored as round(value * scale) in Int16 when scale > 0, else Float32. */
  scale: number;
  n: number;
  tz_offset_s: number;
}

// ---------------------------------------------------------------- sources and stream policy (§4.3, §4.5)

/** The policy target: a raw stream or a record family. */
export type PolicyStream = BioStream | 'workouts' | 'sleep_sessions' | 'vendor_scores' | 'daily_summary' | 'body';

export interface StreamPolicy {
  stream: PolicyStream;
  /** Data from this stream is stored at all. */
  imported: boolean;
  /** What the Coach (AI trainer) may see; series only through a visible tool call. */
  coach: 'hidden' | 'daily' | 'daily+series';
  /** May replace assumed inputs / feed observations (engine-eligible streams only). */
  engine: boolean;
  /** May feed Vitals' own scores. */
  scores: boolean;
}

export interface BioSourceDoc {
  sourceKey: string;
  label: string;
  tier: DeviceTier;
  /** Retired (SUITE_SPEC §14.6 "No priority lists"): ignored by `resolveDays`, dropped by `biometrics.dropPriorities`,
   * never written for new sources. Kept optional so documents stored before v0.4.0 still read. */
  priority?: number;
  /** Retired with `priority`. */
  priorityByMetric?: Record<string, number>;
  policies: StreamPolicy[];
  /** A new device starts a new baseline; epochs are the LocalDates baselines restart. */
  baselineEpochs: LocalDate[];
}

export interface IngestReport {
  batches: number;
  records: number;
  samples: number;
  chunks: number;
  duplicates: number;
  sources: string[];
  days: { from: LocalDate; to: LocalDate } | null;
  warnings: string[];
}

export interface ImportContext {
  tz: string;
  now: Instant;
  signal: AbortSignal;
  onProgress(p: number): void;
}

export interface BiometricsImporter {
  id: string;
  label: string;
  accepts: { mime: string[]; extensions: string[]; sniff(head: Uint8Array): boolean };
  /** SQLite imports need sql.js, which needs 'wasm-unsafe-eval' in script-src (SUITE_SPEC §9.1, decision 3). */
  needs?: Array<'sqljs'>;
  run(input: Blob, ctx: ImportContext): AsyncIterable<BioBatch>;
}

// ---------------------------------------------------------------- evidence (SUITE_SPEC §8.6; owned by E8, mirrored here until E8 lands)

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';
export interface EvidenceLabel {
  mechanism: { status: 'modelled' | 'mapped' | 'infoOnly'; pathway: string; engineNodes: string[] };
  certainty: EvidenceGrade;
  indirectness?: { population: 0 | 1 | 2; intervention: 0 | 1 | 2; outcome: 0 | 1 | 2 };
  refs: Array<{ topicSlug: string; refIds: string[] }>;
}

// ---------------------------------------------------------------- scores (§4.4)

export type ScoreWindow = 'main_sleep' | 'night' | '7d' | '14d' | '28d' | '60d' | '90d' | 'workout' | 'all';
export type PlanEffectTarget =
  | 'training_intensity' | 'training_volume' | 'fast_permission' | 'replan_trigger' | 'engine_observation' | 'trainer_briefing' | 'display_only';
export type ProfileInputName = 'age' | 'sex' | 'massKg' | 'hrMaxObs' | 'sleepNeedH';

export interface ScoreParam {
  name: string;
  value: number;
  range?: [number, number];
  unit: string;
  sourceRef: string;
  kind: 'published' | 'proposed' | 'engineering';
}

export interface ScoreContributor {
  id: string;
  raw?: number;
  unit?: string;
  component?: number;
  weightConfigured: number;
  weightApplied: number;
  available: boolean;
}

export type ScoreStatus = 'ok' | 'withheld' | 'insufficient_baseline' | 'borderline';

export interface ScoreResult {
  scoreId: string;
  version: string;
  scope: { kind: 'night' | 'day' | 'week' | 'workout'; localDate: LocalDate; workoutId?: string };
  status: ScoreStatus;
  value: number | null;
  state?: string;
  /** Reason when status is withheld / insufficient_baseline. */
  reason?: string;
  band?: { lo: number; hi: number; level: 0.8 | 0.95 };
  confidence: 'low' | 'medium' | 'high';
  contributors: ScoreContributor[];
  inputsHash: string;
  sourceIds: string[];
  computedAt: Instant;
  build: string;
  /** Score-specific structured detail (e.g. VO2 posterior SD, NightSignal day state). */
  detail?: Record<string, number | string | boolean | null>;
}

/** Profile values a score may read. */
export interface ScoreProfile {
  ageY?: number;
  sex?: 'male' | 'female';
  massKg?: number;
  heightCm?: number;
  /** Highest HR observed in the last 90 days. */
  hrMaxObs?: number;
  /** Sleep need, hours (dossier 16 h_ref default 7.5). */
  sleepNeedH?: number;
  /** Self-reported physical activity rating 0..10 (Jackson NASA PA-R) for the non-exercise VO2 prior. */
  paRating?: number;
  restingHrBpm?: number;
}

/** Everything a score may read, for the day being scored. All arrays sorted ascending by time. */
export interface ScoreInput {
  /** The day being scored (the wake date for night scores). */
  localDate: LocalDate;
  tz: string;
  profile: ScoreProfile;
  /** Daily views already resolved to one source per metric per day (§4.3), ascending by date, history up to and incl. localDate. */
  days: ResolvedDay[];
  /** Raw series for the window the score asked for, by stream. Samples: epoch ms + value. */
  series: Partial<Record<BioStream, Array<{ t: number; value: number; tier: DeviceTier; sourceKey: string }>>>;
  workouts: WorkoutRecord[];
  /** Results of scores this one depends on (e.g. sleep.index for readiness), by scoreId, ascending by date. */
  prior: Record<string, ScoreResult[]>;
  /** Pinned for determinism (no clock in tier P). */
  computedAt: Instant;
  build: string;
}

/** Where a resolved metric came from (§14.6): a correction, else a device, else (only for streams no device owns) an entry
 * by hand. */
export type Basis = 'correction' | 'device' | 'manual';

/** One day's resolved view (one source per metric). */
export interface ResolvedDay {
  localDate: LocalDate;
  daily?: DailyRecord;
  mainSleep?: SleepRecord;
  sleeps: SleepRecord[];
  workouts: WorkoutRecord[];
  spots: SpotRecord[];
  /** sourceKey chosen per metric. */
  sourceByMetric: Record<string, string>;
  tierByMetric: Record<string, DeviceTier>;
  /** Basis per resolved metric (keys as `sourceByMetric`). */
  basisByMetric: Record<string, Basis>;
  /** Corrections applied to this day, with the device value they replaced (null when the device had none). */
  corrections: Array<{ key: string; correctionId: string; deviceValue: unknown | null }>;
}

// ---------------------------------------------------------------- corrections (§14.6 b)

export const BIO_CORRECTION_SCHEMA = 'vitals.bio_correction/1' as const;

/** Daily metric groups a correction may target (`DAILY_METRIC_GROUPS` keys in ./resolve.ts). */
export type DailyMetricGroup =
  | 'steps' | 'distance_m' | 'active_kcal' | 'total_kcal' | 'active_min' | 'resting_hr_bpm' | 'hr' | 'hrv' | 'spo2' | 'resp_rate_brpm' | 'skin_temp' | 'body_temp_c' | 'vo2max' | 'vendor';

export type CorrectionTarget =
  | { kind: 'sleep'; localDate: LocalDate }
  | { kind: 'daily'; localDate: LocalDate; metric: DailyMetricGroup }
  | { kind: 'spot'; localDate: LocalDate; metric: SpotMetric; at?: Instant };

export type CorrectionValue = { asleepS: number; bedAt?: Instant; wakeAt?: Instant } | { fields: Partial<DailyRecord> } | { value: number };

/** A `bioCorrections` document body; the document id is `key`. Ingest never writes this collection. */
export interface BioCorrection {
  /** Stable id of this correction (a score's `sourceIds` carries it). */
  correctionId: string;
  key: string;
  target: CorrectionTarget;
  value: CorrectionValue;
  note?: string;
  createdAt: Instant;
  /** Actor kind and id that made it (`ai:…` when the person applied a Coach proposal). */
  actor: string;
  replaced: { sourceKey: string; recordId: string; version: number } | null;
  /** Set by `biometrics.clearCorrection`: the device value is used again. */
  clearedAt?: Instant;
}

export interface ScoreDef {
  scoreId: string;
  title: string;
  /** semver */
  version: string;
  released: LocalDate;
  supersedes?: string;
  kind: 'derived_measurement' | 'estimate' | 'index' | 'flag';
  label: 'measurement' | 'estimate' | 'convenience_index' | 'flag';
  inputs: Array<{
    stream: BioStream | string;
    window: ScoreWindow;
    minCoverage?: number;
    minCount?: number;
    tiersAllowed: DeviceTier[];
    sameSourceRequired: boolean;
  }>;
  profileInputs: ProfileInputName[];
  /** Machine-readable; unmet → status 'withheld' with a reason, never a fabricated value. */
  gates: string[];
  /** fn = `${scoreId}@${version}` */
  formula: { fn: string; text: string };
  params: ScoreParam[];
  output: { unit: string; range?: [number, number]; goodDirection?: 'up' | 'down'; display: 'number' | 'band' | 'state' };
  uncertainty: { method: 'propagated' | 'empirical_profile' | 'fixed_band' | 'none'; notes: string };
  evidence: EvidenceLabel;
  /** How device tiers A/B/C are handled. */
  tierHandling: string;
  planEffects: Array<{ target: PlanEffectTarget; rule: string; priority: number }>;
  optInStreams: PolicyStream[];
  /** Scores this one reads from `ScoreInput.prior`. */
  dependsOn?: string[];
  compute(input: ScoreInput): ScoreResult;
}

export interface DecisionLogEntry {
  at: Instant;
  scoreId?: string;
  version?: string;
  value?: number | null;
  band?: ScoreResult['band'];
  decision: string;
  planVersion?: string;
  conversationId?: string;
}
