/**
 * Client for the person's Gauge data on their home server (vitals-research/step1/BRIEF.md): `GET /v1/gauge/*` with this
 * device's token, through the paired server's own fetch (`ServerClient.chatModelOptions()`: the bearer only to the paired
 * origin, and a 401 ends the pairing there). Each endpoint returns the JSON of the matching read-only `gauge_*` MCP tool
 * (`packages/companion/src/home/lumenTools.ts`); the types below are that JSON.
 *
 * Every method answers the tool JSON (the `data` of the server's `{ ok, status, summary, data }` body), or `null` when this
 * device is not paired or the server cannot be reached (or says no). The last good answer of each request is kept in
 * memory with its ETag / Last-Modified, with bounded recent GET snapshots in IndexedDB: a repeat asks conditionally and a 304 answers the cached body; offline, a request
 * asked before answers what it got then (pass `{ cached: false }` to get `null` instead). `status()` says when the server
 * last answered and why it did not. In a cached body the `minutesSince…` freshness fields may be stale; `lastUploadAt`
 * is not. Queries carry only the tool's own parameters (the server refuses unknown or repeated ones: no cache-busters),
 * plus `tz` = the device zone app days are dated in (FIX-CONTRACT F10); a server too old to take `tz` (400) is asked again
 * without it. S2's answers pass one adapter (`adaptGaugeData`) into the V2-facing types below (audit F4).
 *
 * Screens call `snapshot(load)` alongside a normal read: disk never becomes a fresh import, device/control state is
 * excluded, and saved figures are labelled until conditional validation finishes.
 *
 * Requests leave through one queue (`./gaugeQueue`): three with the server at a time, the questions of mounted screens
 * first (`priority`). Identical reads share one request, except that a caller who needs an answer newer than some
 * moment (`since`) never joins a request sent before it. A request's 20 seconds start when it leaves the queue; when
 * they run out, that read failed (`server_error` for that read) but the client is not marked offline. It is only when
 * the requests sent after a full round of those also hear nothing, or when a request cannot be sent at all. The 20
 * seconds and the queue slot last until the answer's body has been read. A 429 is waited out (`Retry-After`, 5 seconds
 * at most, no slot held) and the request sent once more before it counts as a failure.
 *
 * Gauge readings are device estimates, not medical measurements. Nothing here writes.
 */
import { ServerError, getServerClient, type ServerClient } from './server';
import { registerEraseHook } from '@/state/persistence';
import { gaugeCacheStore, gaugeSnapshotShape, persistGaugeQuery, type GaugeCacheStore, type GaugeCacheEntry } from './gaugeCache';
import { GAUGE_MAX_IN_FLIGHT, createGaugeQueue, type GaugeLane, type GaugePriority } from './gaugeQueue';
import type { GaugeSocialTime } from './gaugeSocial';

export type { GaugePriority } from './gaugeQueue';
export type { GaugeSocialTime, GaugeSocialTimeDay, SocialAppKey } from './gaugeSocial';

/* ---- the tools' JSON ------------------------------------------------------------------------------------------- */

/** Every result names the Lumen/Gauge installations it drew on and how fresh the data is. */
export interface GaugeProvenance {
  source: 'lumen_health';
  timeZone: string;
  /** (contract F10) The zone the server used for day boundaries, echoed when the server takes `tz`. */
  tz?: string;
  installations: Array<{ id: string; deviceName: string | null; appVersion: string | null; lastUploadAt: string | null }>;
  freshness: {
    lastUploadAt: string | null;
    lastReadingAt: string | null;
    minutesSinceLastUpload: number | null;
    minutesSinceLastReading: number | null;
  };
}

/** `gauge_data_availability`. */
export interface GaugeAvailability extends GaugeProvenance {
  categories: Array<{ category: string; count: number; firstReadingAt: string; lastReadingAt: string; readWith: string | null }>;
  metricKinds: string[];
  shortVideoDays: number;
  /** Recorded workouts the server holds (read with `workouts()`). */
  workoutSessions?: number;
  /** (0.6.7) The server's passive activity detector (`detect/2`), when it runs one. */
  detection?: string;
  deletions: number;
}

export type GaugeBucket = 'raw' | 'hour' | 'day';

export interface GaugeSeriesQuery {
  /** `hr`, `spo2`, `hrv`, `temp`, `stress`, `fatigue`, `glucose`, `resp_rate`, `vo2max`, `blood_pressure`, `vendor.<key>`. */
  kind: string;
  /** YYYY-MM-DD (the whole day) or a date-time in the person's zone. */
  from: string;
  to: string;
  bucket?: GaugeBucket;
}

export interface GaugeStats {
  count: number;
  mean: number;
  min: number;
  max: number;
}

/** A raw reading: `value`, or `systolic`/`diastolic` for blood pressure. */
export interface GaugeRawPoint {
  at: string;
  value?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  provenance: string | null;
  /** Only when the readings came from more than one installation. */
  installationId?: string;
}

/** An hour or day aggregate: the stats (`{ count: 0 }` when the bucket holds no value), or per-component stats for blood pressure. */
export interface GaugeBucketPoint {
  /** Day buckets only. */
  date?: string;
  start: string;
  count?: number;
  mean?: number;
  min?: number;
  max?: number;
  systolic?: GaugeStats | null;
  diastolic?: GaugeStats | null;
}

/** `gauge_metric_series`. `count`/`truncated` are absent when the server holds no Gauge data at all. */
export interface GaugeSeries extends GaugeProvenance {
  kind: string;
  bucket: GaugeBucket;
  unit: string | null;
  from: string;
  to: string;
  count?: number;
  /** True only when readings are still missing after every page was followed (a page failed, or the page cap). */
  truncated?: boolean;
  note?: string;
  availableKinds?: string[];
  points: Array<GaugeRawPoint | GaugeBucketPoint>;
  /**
   * (SPEC §2.2 `cursor/next`) The cursor of the next page; the client follows it to the end (Codex UI #15), so a
   * returned series has none. `nextCursor` is the same field under the name some servers send.
   */
  next?: string | null;
  nextCursor?: string | null;
}

/** At most this many pages per series read (a server that never ends its cursor cannot hold the screen). */
export const GAUGE_SERIES_MAX_PAGES = 50;

/** The next page's cursor of a series page (`next`, or `nextCursor`), or null at the end. */
export function seriesCursor(p: Pick<GaugeSeries, 'next' | 'nextCursor'> | null | undefined): string | null {
  const c = p?.next ?? p?.nextCursor ?? null;
  return typeof c === 'string' && c !== '' ? c : null;
}

export type GaugeSleepStage = 'deep' | 'light' | 'rem' | 'awake' | 'unknown';

/** One sleep session, grouped by the day of waking (sleep from 19:00 counts toward the next day). */
export interface GaugeSleepSession {
  wakingDate: string;
  start: string;
  end: string;
  inBedMinutes: number;
  /** deep + light + REM. */
  asleepMinutes: number;
  minutes: Record<GaugeSleepStage, number>;
  efficiencyPercent: number | null;
  blocks: Array<{ start: string; end: string; stage: string; minutes: number }>;
  /** (SPEC §2.2) The new name of `inBedMinutes` (kept one release). */
  recordedWindowMinutes?: number;
  /** (SPEC §S2.4, A.1.1) Nightly metrics. */
  metrics?: GaugeSleepMetrics;
  /**
   * (r071) A night recorded in parts: the wake breaks between them (the blocks there are `no_data`; the server counts them
   * as awake after sleep onset, in `metrics.wasoMin` and `stageMinutes.awake`). `asleepMinutes` is the sum of the parts.
   * Absent: the night has no break (and on an older server, which showed the second part as a nap).
   */
  awakeBreaks?: Array<{ start: string; end: string; minutes: number }>;
  /**
   * (0.6.3 FX5) Where the night came from: the ring (absent on older servers: the ring), or Health Connect's SleepSession
   * of one origin (`origin`) for a night the ring has no sleep for; `sourceLabel` "from Health Connect".
   */
  source?: 'ring' | 'healthConnect';
  origin?: string | null;
  sourceLabel?: string;
}

/** `gauge_sleep`. */
export interface GaugeSleep extends GaugeProvenance {
  from: string;
  to: string;
  units: Record<string, string>;
  sessions: GaugeSleepSession[];
}

export interface GaugeActivityDay {
  date: string;
  /** The ring's daily total (the largest it reported that day). */
  steps: number | null;
  activeMinutes: number | null;
  /** Sum of the ring's history buckets. */
  bucketSteps: number | null;
  distanceM: number | null;
  /** Device estimate. */
  caloriesKcal: number | null;
  bucketDistanceM: number | null;
  lastUpdate: string;
  /** (A.1.1) The ring's own step goal setting. */
  ringStepGoal?: number | null;
  /** (0.6.3 FX5) Present when `distanceM` is Health Connect's (one origin) on a day the ring gave none. */
  distanceSource?: 'healthConnect';
  distanceOrigin?: string;
  distanceLabel?: string;
}

/** `gauge_activity`; `hourly` only when the range spans at most 7 days. */
export interface GaugeActivity extends GaugeProvenance {
  from: string;
  to: string;
  units: Record<string, string>;
  days: Array<GaugeActivityDay & { fusedHeadline?: number | null }>;
  fusionVersion?: string;
  hourly?: Array<{ start: string; steps: number; distanceM: number }>;
}

export interface GaugeScore {
  date: string;
  scopeStart: string;
  value: number | null;
  unit: string | null;
  confidence: string | null;
  algorithmVersion: string | null;
  note: string | null;
  inputs: unknown;
}

/** `gauge_scores`: by insight key (`sleep_score`, `recovery_score`, …). */
export interface GaugeScores extends GaugeProvenance {
  from: string;
  to: string;
  units: Record<string, string>;
  scores: Record<string, GaugeScore[]>;
}

/** `gauge_device_state`: the latest of each `state/*` category per installation (`battery`, `connection`, …). */
export interface GaugeDeviceState extends GaugeProvenance {
  units: Record<string, string>;
  devices: Array<{ installationId: string; deviceName: string | null; state: Record<string, Record<string, unknown> & { event: string; at: string }> }>;
}

export interface GaugeShortVideoDay {
  date: string;
  counts: Record<string, number>;
  total: number;
  limit: number | null;
  limitHits: number | null;
  cancels: number | null;
}

export interface GaugeShortVideoAverage {
  from: string;
  to: string;
  daysWithData: number;
  total: number | null;
  counts: Record<string, number | null>;
  limitHits: number | null;
  cancels: number | null;
}

/** `gauge_short_video`: counts only, never content. */
export interface GaugeShortVideo extends GaugeProvenance {
  from: string;
  to: string;
  units: Record<string, string>;
  days: GaugeShortVideoDay[];
  averages: { last7Days: GaugeShortVideoAverage; last30Days: GaugeShortVideoAverage };
}

export type GaugeDayMetric =
  | { unit: string | null; count: number; mean: number | null; min: number | null; max: number | null; latest: { at: string; value: number | null } | null }
  | { unit: string | null; count: number; meanSystolic: number | null; meanDiastolic: number | null; latest: { at: string; systolic: number | null; diastolic: number | null } | null };

/** `gauge_daily_summary`. Only `date` and the provenance are present when the server holds no Gauge data at all. */
export interface GaugeDailySummary extends GaugeProvenance {
  date: string;
  from?: string;
  to?: string;
  units?: Record<string, string>;
  activity?: GaugeActivityDay | null;
  sleep?: GaugeSleepSession[];
  scores?: Record<string, GaugeScore>;
  metrics?: Record<string, GaugeDayMetric & { medianGapS?: number | null }>;
  /** (A.1.1) `day-metrics/1`. */
  derived?: GaugeDayDerived;
}

/** One recorded workout (`activity/session`), the latest version of the session. */
export interface GaugeWorkout {
  /** The session id (updates supersede by it). */
  id: string;
  /** Local date of the start. */
  date: string;
  start: string;
  end: string;
  type: string;
  source: string;
  /** Moving time. */
  durationS: number;
  distanceM: number | null;
  /** Device estimate. */
  kcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Seconds per heart-rate zone. */
  zones: Record<string, number> | null;
  steps: number | null;
  /** The GPS route as an encoded polyline and its point count. */
  route: { polyline: string; points: number } | null;
  updatedAt: string;
  /** Only when the sessions came from more than one installation. */
  installationId?: string;
  /** (SPEC §2.2) Pauses, the kcal method and its energy basis (`gross`). */
  pauses?: Array<{ start: string; end: string }>;
  kcalMethod?: string | null;
  energyBasis?: 'gross' | null;
  /** (SPEC §2.1) Gauge's legacy zone convention (`gauge-220-age-5min`): never shown as Vitals zone time. */
  zonesVersion?: string | null;
  /** Moving seconds (the window minus pauses), as Gauge reports them. */
  movingS?: number | null;
  kcalVersion?: string | null;
  kcalLabel?: string | null;
  /**
   * (0.6.3 S26) The catalogue activity the recording was started as (Gauge 2.8.1 uploads `activity_type_id`): the
   * activity to review suggests it instead of the coarse type's guess. Absent for older sessions.
   */
  activityTypeId?: string | null;
}

/** `gauge_workouts`: sessions that started in the range. */
export interface GaugeWorkouts extends GaugeProvenance {
  from: string;
  to: string;
  units: Record<string, string>;
  sessions: GaugeWorkout[];
  totals: { count: number; durationS: number; distanceM: number; kcal: number; sessions?: number; overlapping?: number };
  /**
   * (0.6.3 FX5) The ring's sport telemetry windows of the range (`sport:<first point ms>`), each with the Gauge workout it
   * belongs to (`workoutId`, null when on its own): detector evidence, never a second copy of a recorded workout.
   */
  sportWindows?: GaugeSportWindow[];
}

/** (0.6.3 FX5) One window of the ring's sport telemetry (`gauge_workouts` `sportWindows`). */
export interface GaugeSportWindow {
  id: string;
  revision: string;
  start: string;
  end: string;
  points: number;
  workoutId: string | null;
  source?: 'ring';
}

/* ---- energy SPEC §2.2 / Addendum A.1.1 additions (S2 `steps-fuse/1`, `timeline`, `sleep-metrics/1`, baselines, `hc`) ---- */
/*
 * Types of the new server derivations (S2). Two layers (audit F4, 2026-10-27):
 *  - `…Wire` types are what S2 emits, read from its fixtures (`packages/companion/fixtures/gauge-v2/*.json`; Vitals reads
 *    them and never edits them);
 *  - the plain types (`GaugeSleepMetrics`, `GaugeBaselines`, `GaugeHcRecord`, …) are the V2-facing shape the screens and V2
 *    read. `adaptGaugeData` (below) maps one into the other as each answer arrives, in this one place.
 * Arrays use null for unknown; a null never becomes 0 (SPEC §1.2).
 */

/** Why a figure is absent (SPEC §S2.4, A.1.1). */
export type GaugeNullReason = 'unsupported' | 'cadenceUnknown' | 'tooFewReadings' | 'incomplete' | 'learning' | 'suppressed' | 'noSleep' | 'noReadings' | 'insufficientSupport' | 'dispersed';

export type GaugeStepLineage = 'ring' | 'phone' | `hc-other:${string}` | 'unknown';
export type GaugeStepSupport = 'minute' | 'tenMinuteFallback' | 'quarterHour' | 'counterSpan' | 'coarse';
/**
 * `coverage` (r063): the only lineage covering a coarse unit (the others covered only part of it). `boutCount` (r068): a
 * walking bout the phone clearly out-counted the ring over, the ring having missed part of it, is counted by the phone.
 */
export type GaugeSelectionReason = 'userCorrection' | 'activityContext' | 'soleSustainedGait' | 'soleObserved' | 'coverage' | 'boutCount' | 'wristStall' | 'preference';

/** One selected interval of `steps-fuse/1` (§2.3). */
export interface GaugeStepInterval {
  start: string;
  end: string;
  steps: number;
  source: string;
  lineage: GaugeStepLineage;
  support: GaugeStepSupport;
  /** The fusion unit the interval belongs to (`minute`, `component`, …). */
  unit?: string;
  selectionReason: GaugeSelectionReason;
  alternatives: Array<{ source: string; steps: number; support: GaugeStepSupport }>;
  disagreement?: boolean;
  nonActivitySuspect?: boolean;
}

export interface GaugeStepDay {
  date: string;
  /** The authoritative fused total (Σ selected over disjoint units). */
  located: number;
  ringDailyTotal?: number | null;
  /** Unlocated ring evidence, never added. */
  ringResidual?: number | null;
  phoneDailyTotal?: number | null;
  /** D3: `located`, or max(located, ringDailyTotal) as a labelled scenario. */
  headline: number;
  headlinePolicy: 'located' | 'atLeast';
  resolved?: boolean;
  headlineLabel?: string;
  coverage: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number };
}

/** `steps?from&to` / `gauge_steps`. */
export interface GaugeSteps extends GaugeProvenance {
  fusionVersion: string;
  from?: string;
  to?: string;
  /** (contract F10) The zone the server used for the day boundaries. */
  tz?: string;
  intervals: GaugeStepInterval[];
  days: GaugeStepDay[];
  inputsHash?: string;
}

/** (r063 S1) A timeline minute's step support: `minute` where `selected` holds a minute unit's count; `coarse` inside a coarse unit (`selected` null there). */
export type GaugeTimelineSupport = 'minute' | 'coarse';

/** (r063 S16) Which source each timeline stream used: lineage, minutes and quality. */
export interface GaugeEvidenceSource {
  source: string;
  lineage?: string | null;
  minutes: number;
  supportedS?: number;
  /** HR from Health Connect: its cadence inferred from the record's regular spacing, or none (sampled only). */
  cadence?: 'inferred' | 'none';
  records?: number;
  recordingMethod?: unknown;
  /** Power from Health Connect is never verified on this path. */
  verified?: boolean;
}

/** (r068 B1) A lineage's coarse record in the timeline: its steps over `[start, end)`, never placed in a minute. */
export interface GaugeLaneCoarse {
  start: string;
  end: string;
  steps: number;
  support?: string;
}

/** `timeline?date` / `gauge_timeline`: one value per local minute (1440; 1380 or 1500 on a DST day). */
export interface GaugeTimeline extends GaugeProvenance {
  date: string;
  tz: string;
  /** UTC start of the first minute (ISO). */
  start?: string;
  minutes: number;
  end?: string;
  /**
   * `support` (r063 S1) is always present after `normaliseTimeline` (an older server without it: a non-null `selected`
   * is a minute unit's count, the only kind the server places in a minute).
   */
  steps: {
    selected: Array<number | null>; source: Array<string | null>; ring: Array<number | null>; phone: Array<number | null>; support: Array<GaugeTimelineSupport | null>;
    /** Coarse units, whole; (r068 B1) `placed` ones have their minutes in `selected`, an unplaced one lists its `parts` (each record's steps at its last instant). */
    coarse?: unknown[];
    /** (r068 B1) Each lineage's coarse records (a counter span, a ten-minute fallback), whole; absent from an older server. */
    ringCoarse?: GaugeLaneCoarse[];
    phoneCoarse?: GaugeLaneCoarse[];
  };
  /**
   * Time-weighted minute mean over `hr-support/1` supported seconds; `sampledBpm` the minute's plain sampled mean.
   * (r063 S16) `source`: whose readings each minute holds (`gauge`, or `hc:<origin>` where Gauge has none).
   */
  hr: { bpm: Array<number | null>; supportedS: Array<number | null>; sampledBpm?: Array<number | null>; source?: Array<string | null> };
  /** (r063 S16) Health Connect speed (m/s) and power (W) per minute with their source; null when the day has none. */
  hc?: { speedMps: Array<number | null> | null; speedSource: Array<string | null> | null; powerW: Array<number | null> | null; powerSource: Array<string | null> | null } | null;
  /**
   * (0.6.3 FX5) Gauge's route-derived moving speed per minute (m/s) inside its GPS workouts, `accepted` where it is a
   * measurement, and the workout it came from; null when the day has none.
   */
  gps?: { speedMps: Array<number | null>; accepted: boolean[]; session: Array<string | null> } | null;
  /** (r063 S16) The sources each stream used; (0.6.3 FX5) `gpsSpeed`: the GPS workouts the day's speed came from. */
  evidence?: { hr: GaugeEvidenceSource[]; speed: GaugeEvidenceSource[]; power: GaugeEvidenceSource[]; gpsSpeed?: Array<{ source: 'gauge_gps'; session: string; type: string | null; method: 'route' | 'sessionMean'; minutes: number; accepted: number }> };
  sleep: { stage: Array<'light' | 'deep' | 'rem' | 'asleepUnspecified' | 'awake' | 'unknown' | null> };
  sessions: Array<{ id: string; start: string; end: string; type: string; source: string }>;
  /** `originPackage` is the adapter's name for S2's `origin` (kept too). */
  hcExercise: Array<{ id: string; start: string; end: string; exerciseType: number | null; title?: string | null; origin?: string | null; originPackage: string; lineage?: string | null }>;
  /** One acquisition state per minute (`observed`, `listening`, …; null = no state known), as S2 emits it. */
  acquisition: { ring: Array<string | null>; phone: Array<string | null> };
  stress?: { readings: Array<{ at: string; value: number }>; medianGapS: number | null };
  fusionVersion?: string;
  hrSupportVersion?: string;
  inputsHash?: string;
}

/** One raw HR reading of `hr-intervals` with its `hr-support/1` interval (UTC epoch ms; null support = no declared cadence). */
export interface GaugeHrInterval {
  t: number;
  bpm: number;
  cadenceS: number | null;
  nextT: number | null;
  start: number | null;
  end: number | null;
}

/**
 * `hr-intervals?from&to` / `gauge_hr_intervals`: the raw HR readings of a window of at most 36 h with each one's supported
 * interval, every page followed. `truncated` is true when a page did not arrive, the page cap was reached or the pages
 * disagreed on `inputsHash` (the data changed while paging): exact zone time then must not be computed from it.
 */
export interface GaugeHrIntervals extends GaugeProvenance {
  from: string;
  to: string;
  hrSupportVersion?: string;
  intervals: GaugeHrInterval[];
  count: number;
  supportedS: number;
  inputsHash?: string;
  truncated: boolean;
}

/** At most this many pages per `hr-intervals` read (2000 readings each: more than a day of the 10-s workout stream). */
export const GAUGE_HR_MAX_PAGES = 20;

/**
 * `sleep` session `metrics` (`sleep-metrics/1`, §S2.4 + A.1.1), V2-facing: the nightly figures as plain numbers (the
 * adapter reads them out of S2's `{bpm, bins}`, `{ms, n, firmware}` and `{c, n}` objects, `GaugeSleepMetricsWire`). Clock
 * fields are ISO date-times in the person's zone.
 */
export interface GaugeSleepMetrics {
  version: string;
  /** Minutes known asleep, awake, unknown and gap. */
  K: number;
  A: number;
  U: number;
  G: number;
  tstLowerMin: number;
  tstUpperMin: number;
  onset: string | null;
  finalWake: string | null;
  midpoint: string | null;
  windowContinuityPct: number | null;
  wasoMin: number | null;
  awakeningRuns: number | null;
  restorativeEstimatedMin: number | null;
  avgSleepHr: number | null;
  /** (A.1.1 #17: n always shown) The night's HR reading count behind `avgSleepHr` (S2 `hrReadings`). */
  hrReadings?: number | null;
  /** Supported seconds the time-weighted average covers (S2 `avgSleepHrSupportedS`). */
  avgSleepHrSupportedS?: number | null;
  sampledMeanSleepHr: { bpm: number; n: number } | null;
  /** bpm (S2 `nightlyLowHrP10.bpm`); `nightlyLowHrBins` = its `bins`. */
  nightlyLowHrP10: number | null;
  nightlyLowHrBins?: number | null;
  timeToLowMin: number | null;
  timeToLowReason?: GaugeNullReason;
  /** The 5-min bins' bpm from the onset, in order (S2's `trace5min[].bpm`; null = an empty bin). */
  trace5min: Array<number | null>;
  /** The ring's nightly HRV, ms (S2 `hrvNightlyMs.ms`); `hrvNightlyN` = its reading count. */
  hrvNightlyMs: number | null;
  hrvNightlyN?: number | null;
  /** Skin temperature, °C (S2 `skinTempNightC.c`); `skinTempNightN` = its reading count. */
  skinTempNightC: number | null;
  skinTempNightN?: number | null;
  respRate: null;
  tossesTurns: null;
  sleepLatency: null;
  reason?: Partial<Record<'respRate' | 'tossesTurns' | 'sleepLatency', 'unsupported'>>;
  /** Why each null field is null (S2 `reasons`, as sent). */
  reasons?: Record<string, GaugeNullReason>;
  nativeEpochS: number | null;
  coveragePct: number | null;
  // A.1.1
  /** (S2 also sends `gap` minutes here; the V2 type leaves it out, the value passes through.) */
  stageMinutes?: { deep: number; light: number; rem: number; asleepUnspecified: number; awake: number; unknown: number };
  leadingWakeMin?: number | null;
  wakeUps?: number | null;
  namedCoveragePct?: number | null;
  restorativeSharePct?: number | null;
  incomplete?: boolean;
  hrTrend?: { word: 'steady' | 'rising' | 'falling'; magnitude: 'slight' | 'moderate' | 'strong' | null; deltaBpm: number } | null;
  tooFewHrReadings?: boolean;
  hrvWithinNightMs?: number | null;
  spo2Night?: { meanPct: number; minPct: number; count: number } | null;
  minutesBelow90?: number | null;
  minutesBelow90Reason?: GaugeNullReason;
}

/** What S2 emits for `metrics` (`packages/companion/fixtures/gauge-v2/sleep.json`): the V2 fields that differ. */
export interface GaugeSleepMetricsWire extends Omit<GaugeSleepMetrics, 'nightlyLowHrP10' | 'hrvNightlyMs' | 'skinTempNightC' | 'trace5min' | 'reason' | 'stageMinutes'> {
  stageMinutes: { deep: number; light: number; rem: number; asleepUnspecified: number; awake: number; unknown: number; gap: number };
  nightlyLowHrP10: { bpm: number; bins: number } | null;
  hrvNightlyMs: { ms: number; n: number; firmware: string[] } | null;
  skinTempNightC: { c: number; n: number } | null;
  trace5min: Array<{ start: string; bpm: number | null; n: number }>;
  reasons: Record<string, GaugeNullReason>;
  hrMedianGapS?: number | null;
  statuses?: Record<string, string>;
}

/**
 * A circular clock baseline, V2-facing: minutes after local midnight, R̄ (mean resultant length) and n; `suppressed`
 * whenever S2 does not call it ready (still learning, or R̄ < 0.3: then `minutes` is null).
 */
export interface GaugeClockBaseline {
  minutes: number | null;
  Rbar: number;
  n: number;
  suppressed?: boolean;
  /** S2's own fields, kept: `clock` (HH:MM), `ready` and why not (`learning` | `dispersed`). */
  clock?: string | null;
  ready?: boolean;
  reason?: 'learning' | 'dispersed';
}

/**
 * `baselines?date` / `gauge_baselines` (§S2.5 + A.1.1), excluding that night, V2-facing. A baseline object is present when
 * S2 has its value; `ready` is S2's own gate (n ≥ 7 over ≥ 6 days) and V2 compares only against a ready one.
 */
export interface GaugeBaselines extends GaugeProvenance {
  date: string;
  usualOnset: GaugeClockBaseline | null;
  usualWake: GaugeClockBaseline | null;
  usualMidpoint: GaugeClockBaseline | null;
  /** "Sleeping low HR": 14-night median of `nightlyLowHrP10` (S2 `medianBpm`), scale s = max(IQR/1.349, 3 bpm). */
  sleepLowHr: { median: number; s: number; n: number; spanDays: number; ready?: boolean } | null;
  /** On ln(HRV): `median` and `s` are in ln units (S2 `lnMedian`, `lnS`); `medianMs` is exp(median). */
  hrvBaseline: { median: number; s: number; medianMs?: number; n: number; spanDays: number; ready?: boolean } | null;
  /** °C: `median` = S2 `medianC`; `deltaT` = S2 `deltaC` (tonight − median, when tonight is known). */
  tempBaseline: { median: number; n: number; spanDays: number; deltaT: number | null; ready?: boolean } | null;
  /** "Sampled non-exercise HR" (S2 `medianBpm`). */
  sampledIdleHr: { median: number; n: number } | null;
  /**
   * (0.6.3 FX5) Health Connect's resting HR while `sleepLowHr` is not ready (the server sends it only then), labelled with
   * its source; the same gate (`ready`: 7 days over 6). Null otherwise.
   */
  restingHrFallback?: { median: number; s: number; n: number; spanDays: number; ready: boolean; source: 'healthConnect'; origins: string[]; label: string } | null;
  learning: { nights: number; needed: number; learning: boolean };
  inputsHash?: string;
}

/**
 * (0.6.3 FX5) The resting-HR stand-in of a baselines answer: the ring's sleeping low when ready, else Health Connect's
 * resting HR when ready (labelled), else null. One source, never a blend.
 */
export function restingProxyOf(b: GaugeBaselines | null | undefined): { bpm: number; source: 'ring' | 'healthConnect' } | null {
  if (b?.sleepLowHr && b.sleepLowHr.ready !== false && Number.isFinite(b.sleepLowHr.median)) return { bpm: b.sleepLowHr.median, source: 'ring' };
  const f = b?.restingHrFallback;
  if (f && f.ready === true && f.source === 'healthConnect' && Number.isFinite(f.median)) return { bpm: f.median, source: 'healthConnect' };
  return null;
}

/** What S2 emits for `/baselines` (`fixtures/gauge-v2/baselines.json`). */
export interface GaugeBaselinesWire extends GaugeProvenance {
  date: string;
  usualOnset: GaugeClockBaselineWire | null;
  usualWake: GaugeClockBaselineWire | null;
  usualMidpoint: GaugeClockBaselineWire | null;
  sleepLowHr: { medianBpm: number | null; s: number | null; n: number; spanDays: number; ready: boolean } | null;
  hrvBaseline: { medianMs: number | null; lnMedian: number | null; lnS: number | null; n: number; spanDays: number; ready: boolean } | null;
  tempBaseline: { medianC: number | null; deltaC: number | null; n: number; spanDays: number; ready: boolean } | null;
  sampledIdleHr?: { medianBpm: number | null; n: number; days?: number; label?: string } | null;
  /** (0.6.3 FX5) Only while `sleepLowHr` is not ready. */
  restingHrFallback?: { source: 'healthConnect'; origins: string[]; medianBpm: number | null; s: number | null; n: number; spanDays: number; ready: boolean; label: string } | null;
  learning: { nights: number; needed: number; learning: boolean };
  inputsHash?: string;
}

export interface GaugeClockBaselineWire {
  minutes: number | null;
  clock: string | null;
  R: number | null;
  n: number;
  ready: boolean;
  reason?: 'learning' | 'dispersed';
}

/** `daily?date` `derived` block (`day-metrics/1`, A.1.1). A figure S2 could not make (its value null) reads null. */
export interface GaugeDayDerived {
  version?: string;
  peakHr: { bpm: number; at: string; source: string; lowerBound: boolean; label?: string } | null;
  nonExerciseHr: { median: number; n: number; label?: string } | null;
  avgWorkoutHr: { bpm: number; workoutS: number } | null;
  ringStepGoal?: number | null;
}

/**
 * One Health Connect record (`hc?type&from&to` / `gauge_hc`), lineage-labelled, V2-facing. S2 sends `origin` and
 * `deviceNative`; the adapter adds them as `originPackage` and `originIsDeviceNative` (an absent origin reads '').
 */
export interface GaugeHcRecord {
  id: string;
  recordType: string;
  originPackage: string;
  originIsDeviceNative: boolean;
  origin?: string | null;
  deviceNative?: boolean;
  lineage?: string | null;
  device?: { type?: string | number; manufacturer?: string; model?: string } | null;
  recordingMethod?: string | number | null;
  lastModified: string | null;
  start: string;
  end: string;
  zoneOffsets?: { start?: number; end?: number } | null;
  payload: Record<string, unknown>;
  installationId?: string;
}

/** (r063) A Health Connect record of the type that was deleted upstream (its latest revision retracted by a tombstone). */
export interface GaugeHcDeleted {
  id: string;
  recordType: string;
  start: string;
  end: string;
  originPackage?: string | null;
  lastModified?: string | null;
  deletedAt: string | null;
  installationId?: string;
}

export interface GaugeHc extends GaugeProvenance {
  type: string;
  from: string;
  to: string;
  /** Every page's records (r063 S15: `hc` follows `next` to the end). */
  records: GaugeHcRecord[];
  /** First page only; absent from servers before 0.6.3. */
  deleted?: GaugeHcDeleted[];
  next?: string | null;
  inputsHash?: string;
  /** (r063 S15) A page did not arrive, or the page cap was reached: the records are not all of them. */
  truncated?: boolean;
}

/** At most this many `hc` pages per read (2000 records each). */
export const GAUGE_HC_MAX_PAGES = 25;

/** (r063 S13) One imported record that changed upstream (`/v1/gauge/changes`): its state now. */
export interface GaugeChange {
  kind: 'workout' | 'hcExercise' | 'hcWeight';
  id: string;
  /** `gauge:<session id>` or `hc:<record id>`: what the imports are keyed by. */
  ref: string;
  change: 'revised' | 'deleted';
  start: string | null;
  end: string | null;
  at: string | null;
  installationId?: string;
}

/** (r063 S13) The change feed after a cursor, every page followed. */
export interface GaugeChanges {
  cursor: string;
  /** Read the import window again (no cursor yet, a restored store, or a reset): the feed cannot list it all. */
  resync: boolean;
  changes: GaugeChange[];
  /** A page did not arrive or the page cap was reached: `cursor` is where it stopped (re-read from there). */
  truncated: boolean;
}

/** At most this many change-feed pages per read. */
export const GAUGE_CHANGES_MAX_PAGES = 20;

/**
 * (0.6.7 AD-VITALS) One detection episode of the server's `detect/2` (`GET /v1/gauge/detections`, contract §2): a bout the
 * server saw in the phone, ring, HR and activity-recognition evidence. Identity (`id`) is assigned once and revised
 * (`revision`); `open` while the evidence is still arriving, `final` once it ended, `withdrawn` when the server no longer
 * holds it. Never an activity by itself: Vitals turns a final one into a pending candidate the person reviews.
 */
export interface GaugeDetectionEpisode {
  id: string;
  revision: number;
  detector: string;
  config?: string;
  start: string;
  end: string;
  moving: Array<{ start: string; end: string }>;
  state: 'open' | 'final' | 'withdrawn';
  /** walk | walk_possibly_treadmill | treadmill_walk | run | treadmill_run | cycling | possible_cycling | possible_workout | possible_strength (others read as a possible workout). */
  label: string;
  alternatives: string[];
  /** Evidence that a sustained bout happened, 0–0.95 (a ranking heuristic, not a probability). */
  existence: number;
  /** Evidence for the label, 0–0.95. */
  typeScore: number;
  level: 'low' | 'medium' | 'high';
  /** Reason codes (server vocabulary), turned into words by Vitals. */
  reasons: string[];
  coverage?: { phone?: number; ring?: number; hr?: number; ar?: number; gps?: number };
  evidenceHash?: string;
  /** Recordings the server linked to the episode (`gauge:<id>`, `hc:<id>`). */
  recordingRefs?: string[];
}

/** (0.6.7 AD-VITALS) The detections of a range (every page followed): episodes, withdrawn ids, the cursor and the detector. */
export interface GaugeDetections {
  episodes: GaugeDetectionEpisode[];
  withdrawn: string[];
  /** Where a later read can continue from (`since`). */
  cursor: string | null;
  /** The server processed evidence up to here (ISO), null when unknown. */
  processedThrough: string | null;
  /** The detector the server runs (`detect/2`). */
  detector: string | null;
  /** A page did not arrive or the page cap was reached: the episodes are not all of them. */
  truncated: boolean;
}

/** At most this many detection pages per read. */
export const GAUGE_DETECTIONS_MAX_PAGES = 20;
/** At most this many episodes kept from one read (the command takes 500). */
export const GAUGE_DETECTIONS_MAX = 500;

/** (0.6.3 FX1) One imported record whose state a resync asks: its kind and upstream id. */
export interface GaugeSubjectRef {
  kind: GaugeChange['kind'];
  id: string;
}

/** (0.6.3 FX1) A subject's state now (`/v1/gauge/changes-state`): present, deleted upstream, or unknown to the server. */
export interface GaugeSubjectState extends GaugeSubjectRef {
  ref: string;
  state: 'present' | 'deleted' | 'unknown';
  at: string | null;
}

/** (0.6.3 FX1) At most this many subjects per `changes-state` request (the query stays a few kB). */
export const GAUGE_STATE_MAX_REFS = 100;

/** (r063 S6) `POST /v1/gauge/fusion-context`: the person's fusion context for the activities and corrections starting in `window`. */
export interface GaugeFusionContextRequest {
  window: { start: string; end: string };
  activities: GaugeFuseActivity[];
  corrections?: GaugeFuseCorrection[];
  preference?: { stepsPreference?: readonly string[]; soleSustainedGait?: boolean };
  tz?: string;
  /** (r063 FX2) The person's day rollover (local hour): the server breaks merged step intervals there. */
  rolloverH?: number;
}

export interface GaugeFusionContextResult {
  revision: string;
  changed: boolean;
}

/** One approved activity window for step fusion (contract F3): gait types are `locomotor`, the rest `nonLocomotor`. */
export interface GaugeFuseActivity {
  start: string;
  end: string;
  kind: 'locomotor' | 'nonLocomotor' | 'unknown';
  /** (0.6.3 S7/A10) Where the phone was, when the person said so in the activity sheet; absent = not stated. */
  carry?: 'pocket' | 'hand' | 'desk';
}

/** The person's step correction for fusion (SPEC §2.3 4(a)): use this lineage for the steps of [start, end). */
export interface GaugeFuseCorrection {
  start: string;
  end: string;
  /** `ring`, `phone` or `hc-other:<origin>`. */
  use: string;
}

/** The body of `POST /v1/gauge/steps/fuse` (FIX-CONTRACT F3); every field after `from`/`to` is optional. */
export interface GaugeStepsFuseRequest {
  from: string;
  to: string;
  tz?: string;
  bucket?: string;
  activities?: GaugeFuseActivity[];
  corrections?: GaugeFuseCorrection[];
  preference?: { stepsPreference?: readonly string[]; soleSustainedGait?: boolean };
  /** (r063 FX2) The person's day rollover (local hour): merged intervals break there too. */
  rolloverH?: number;
}

/** The SPEC §2.2 routes (an extension of `GaugeApi`, so existing clients and fakes keep compiling). */
export interface GaugeV2Api {
  steps(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeSteps | null>;
  /**
   * (contract F3) `POST /v1/gauge/steps/fuse`: the fused steps with Vitals' approved activity windows and the person's D1
   * preference. An older server without the route (404) is asked `GET /steps` for the same range and zone instead.
   */
  stepsFuse(body: GaugeStepsFuseRequest, opts?: GaugeCallOptions): Promise<GaugeSteps | null>;
  timeline(date: string, opts?: GaugeCallOptions): Promise<GaugeTimeline | null>;
  baselines(date: string, opts?: GaugeCallOptions): Promise<GaugeBaselines | null>;
  hc(type: string, from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeHc | null>;
  /** `GET /v1/gauge/hr-intervals` with every page (null when the server could not answer, or has no such route). */
  hrIntervals(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeHrIntervals | null>;
  /** (r063 S13) `GET /v1/gauge/changes` after `since` (null: the current cursor), every page; null without the route. */
  changes?(since: string | null, opts?: GaugeCallOptions): Promise<GaugeChanges | null>;
  /**
   * (0.6.3 FX1, sR02/aR04) `GET /v1/gauge/changes-state?refs=`: the authoritative state now of up to
   * `GAUGE_STATE_MAX_REFS` imported records (a resync pages through what Vitals imported). Null when the server could not
   * answer (or has no such route: `status().problem` is then `not_supported`).
   */
  changesState?(refs: readonly GaugeSubjectRef[], opts?: GaugeCallOptions): Promise<GaugeSubjectState[] | null>;
  /**
   * (0.6.7 AD-VITALS) `GET /v1/gauge/detections?from&to[&since]`: the server's `detect/2` episodes of the range with the
   * withdrawn ids, every page followed (`next` or `more`, bounded). Null when the server could not answer (or has no such
   * route: `status().problem` is then `not_supported`).
   */
  detections?(q: { from: string; to: string; since?: string | null }, opts?: GaugeCallOptions): Promise<GaugeDetections | null>;
  /**
   * (r063 S6) `POST /v1/gauge/fusion-context`: the person's fusion context, which every fused read then uses. A new
   * revision drops the cached answers and tells `onFusionContextChange` listeners. Null without the route.
   */
  fusionContext?(body: GaugeFusionContextRequest, opts?: GaugeCallOptions): Promise<GaugeFusionContextResult | null>;
}

/* ---- the client ------------------------------------------------------------------------------------------------ */

export interface GaugeCallOptions {
  signal?: AbortSignal;
  /**
   * Where the request waits when the server is busy (`./gaugeQueue`): `screen` for a question a mounted screen is
   * showing, `background` (the default) for everything else.
   */
  priority?: GaugePriority;
  /**
   * The answer must come from a request sent after this moment (epoch ms): the data changed then (new readings, a
   * write, the app came back from a pause). An identical read already with the server from before it is not joined.
   */
  since?: number;
  /** false: offline answers null instead of the last good answer (default true). */
  cached?: boolean;
  /** (contract F10) The IANA zone the server dates days in; default the client's zone (the device zone of app days). */
  tz?: string;
}

/** Why the last request got no fresh answer: not paired, the server could not be reached, the pairing ended or the token may not read Gauge data (401/403), the server has no such route, or another error. */
export type GaugeProblem = 'not_paired' | 'offline' | 'unauthorized' | 'not_supported' | 'server_error';

export interface GaugeStatus {
  /** When the server last answered a Gauge request (ISO), null when never in this session. */
  lastOkAt: string | null;
  /** The last request's problem, null when it answered. */
  problem: GaugeProblem | null;
}

export interface GaugeApi {
  availability(opts?: GaugeCallOptions): Promise<GaugeAvailability | null>;
  series(q: GaugeSeriesQuery, opts?: GaugeCallOptions): Promise<GaugeSeries | null>;
  daily(date: string, opts?: GaugeCallOptions): Promise<GaugeDailySummary | null>;
  sleep(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeSleep | null>;
  activity(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeActivity | null>;
  scores(from: string, to: string, key?: string, opts?: GaugeCallOptions): Promise<GaugeScores | null>;
  device(opts?: GaugeCallOptions): Promise<GaugeDeviceState | null>;
  shortVideo(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeShortVideo | null>;
  /**
   * (social-time) `GET /v1/gauge/social-time`: whole-app foreground time across the social apps, per local day. Null when
   * this device is not paired or the server could not answer (or has no such route: `status().problem` is `not_supported`).
   * Optional so an older client or a test fake without it still type-checks; the screens read it through a guard.
   */
  socialTime?(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeSocialTime | null>;
  workouts(from: string, to: string, opts?: GaugeCallOptions): Promise<GaugeWorkouts | null>;
  status(): GaugeStatus;
  /** Listeners hear every status change. */
  subscribe(listener: () => void): () => void;
  /** Forget every cached answer (pairing ended, tests). */
  clearCache(): void;
  /** Screen-only snapshot read: never a network request or an import source. */
  snapshot?<T>(load: (api: GaugeApi & GaugeV2Api) => Promise<T | null>): Promise<{ data: T | null; savedAt: number | null }>;
  /** Same client with per-consumer cancellation and queue priority; useful for composed screen queries. */
  withOptions?(options: GaugeCallOptions): GaugeApi & GaugeV2Api;
}

/** Once a request has left the queue for the server, it may not take longer than this. */
export const GAUGE_REQUEST_TIMEOUT_MS = 20_000;
/** A 429 is waited out for the server's `Retry-After`, never longer than this, and for this long when it names none. */
export const GAUGE_RETRY_AFTER_MAX_MS = 5_000;
const GAUGE_RETRY_AFTER_DEFAULT_MS = 1_000;
/** A saved snapshot whose body a 304 confirmed gets its new date on disk at most this often. */
const SNAPSHOT_REDATE_MS = 10 * 60_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The tool JSON of an answer: the body itself, or the `data` of a tool-result envelope (`{ ok, status, summary, data }`)
 * when the server sends one; null for a rejected envelope or a body that is not an object.
 */
export function gaugeData(body: unknown): Record<string, unknown> | null {
  if (!isObj(body)) return null;
  if (typeof body.ok === 'boolean' && typeof body.status === 'string' && 'summary' in body) return body.ok && isObj(body.data) ? body.data : null;
  return body;
}

/* ---- the S2 → V2 adapter (audit F4): one place maps what S2 emits into the shapes Vitals reads --------------------- */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const DETECTION_STATES = new Set(['open', 'final', 'withdrawn']);
const DETECTION_LEVELS = new Set(['low', 'medium', 'high']);
const score = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.95, Math.max(0, v)) : 0);
const isoOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const shortStrings = (v: unknown, max: number, len = 64): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= len).slice(0, max) : []);

/** (0.6.7 AD-VITALS) One wire episode, checked field by field; null when it cannot be one (dropped alone). */
export function detectionEpisodeOf(x: unknown): GaugeDetectionEpisode | null {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id || x.id.length > 64) return null;
  if (!isoOk(x.start) || !isoOk(x.end) || !(Date.parse(x.end) > Date.parse(x.start))) return null;
  const state = typeof x.state === 'string' && DETECTION_STATES.has(x.state) ? (x.state as GaugeDetectionEpisode['state']) : null;
  if (!state || typeof x.label !== 'string' || !x.label || x.label.length > 48) return null;
  const revision = typeof x.revision === 'number' && Number.isInteger(x.revision) && x.revision >= 0 ? x.revision : 0;
  const moving = (Array.isArray(x.moving) ? x.moving : []).flatMap((m) => (isObj(m) && isoOk(m.start) && isoOk(m.end) && Date.parse(m.end) > Date.parse(m.start) ? [{ start: m.start, end: m.end }] : [])).slice(0, 200);
  const cov = isObj(x.coverage) ? x.coverage : null;
  const coverage = cov ? Object.fromEntries((['phone', 'ring', 'hr', 'ar', 'gps'] as const).flatMap((k) => (typeof cov[k] === 'number' && Number.isFinite(cov[k]) ? [[k, Math.min(1, Math.max(0, cov[k] as number))]] : []))) : null;
  return {
    id: x.id,
    revision,
    detector: typeof x.detector === 'string' && x.detector.length <= 32 ? x.detector : 'detect/2',
    ...(typeof x.config === 'string' && x.config.length <= 32 ? { config: x.config } : {}),
    start: new Date(Date.parse(x.start)).toISOString(),
    end: new Date(Date.parse(x.end)).toISOString(),
    moving,
    state,
    label: x.label,
    alternatives: shortStrings(x.alternatives, 8, 48),
    existence: score(x.existence),
    typeScore: score(x.typeScore),
    level: typeof x.level === 'string' && DETECTION_LEVELS.has(x.level) ? (x.level as GaugeDetectionEpisode['level']) : 'low',
    reasons: shortStrings(x.reasons, 16),
    ...(coverage && Object.keys(coverage).length ? { coverage } : {}),
    ...(typeof x.evidenceHash === 'string' && x.evidenceHash.length <= 128 ? { evidenceHash: x.evidenceHash } : {}),
    ...(Array.isArray(x.recordingRefs) ? { recordingRefs: shortStrings(x.recordingRefs, 16, 160) } : {}),
  };
}
/** A figure S2 sends as `{ <field>: n, … }`; a plain number (an older or a V2-shaped answer) passes as it is. */
const inner = (v: unknown, field: string): number | null => (isObj(v) ? num(v[field]) : num(v));

/** S2 `sleep-metrics/1` → `GaugeSleepMetrics` (idempotent: an already-mapped object maps to itself). */
export function adaptSleepMetrics(raw: unknown): GaugeSleepMetrics | undefined {
  if (!isObj(raw)) return undefined;
  const reasons = isObj(raw.reasons) ? (raw.reasons as Record<string, GaugeNullReason>) : isObj(raw.reason) ? (raw.reason as Record<string, GaugeNullReason>) : undefined;
  const trace = Array.isArray(raw.trace5min) ? raw.trace5min.map((b: unknown) => (isObj(b) ? num(b.bpm) : num(b))) : [];
  const pick = <K extends string>(keys: readonly K[]) => {
    const o: Partial<Record<K, 'unsupported'>> = {};
    for (const k of keys) if (reasons?.[k] === 'unsupported') o[k] = 'unsupported';
    return o;
  };
  const out: Record<string, unknown> = { ...raw };
  delete out.reasons;
  delete out.statuses;
  Object.assign(out, {
    nightlyLowHrP10: inner(raw.nightlyLowHrP10, 'bpm'),
    hrvNightlyMs: inner(raw.hrvNightlyMs, 'ms'),
    skinTempNightC: inner(raw.skinTempNightC, 'c'),
    trace5min: trace,
    reason: pick(['respRate', 'tossesTurns', 'sleepLatency'] as const),
  });
  if (isObj(raw.nightlyLowHrP10)) out.nightlyLowHrBins = num(raw.nightlyLowHrP10.bins);
  if (isObj(raw.hrvNightlyMs)) out.hrvNightlyN = num(raw.hrvNightlyMs.n);
  if (isObj(raw.skinTempNightC)) out.skinTempNightN = num(raw.skinTempNightC.n);
  if (reasons) {
    out.reasons = { ...reasons };
    if (reasons.timeToLowMin) out.timeToLowReason = reasons.timeToLowMin;
    if (reasons.minutesBelow90) out.minutesBelow90Reason = reasons.minutesBelow90;
  }
  return out as unknown as GaugeSleepMetrics;
}

function adaptClock(raw: unknown): GaugeClockBaseline | null {
  if (!isObj(raw)) return null;
  if ('Rbar' in raw) return raw as unknown as GaugeClockBaseline;
  const ready = raw.ready === true;
  const reason = raw.reason === 'learning' || raw.reason === 'dispersed' ? raw.reason : undefined;
  return { minutes: ready ? num(raw.minutes) : null, Rbar: num(raw.R) ?? 0, n: num(raw.n) ?? 0, suppressed: !ready, clock: str(raw.clock), ready, ...(reason ? { reason } : {}) };
}

/** S2 `/baselines` → `GaugeBaselines` (a baseline without a value reads null; S2's `ready` gate is kept). */
export function adaptBaselines(raw: Record<string, unknown>): GaugeBaselines {
  const out: Record<string, unknown> = { ...raw };
  out.usualOnset = adaptClock(raw.usualOnset);
  out.usualWake = adaptClock(raw.usualWake);
  out.usualMidpoint = adaptClock(raw.usualMidpoint);
  const ready = (b: Record<string, unknown>) => (typeof b.ready === 'boolean' ? { ready: b.ready } : {});
  const span = (b: Record<string, unknown>) => ({ n: num(b.n) ?? 0, spanDays: num(b.spanDays) ?? 0 });
  const lo = raw.sleepLowHr;
  if (isObj(lo)) {
    const median = num(lo.medianBpm) ?? num(lo.median);
    const s = num(lo.s);
    out.sleepLowHr = median !== null && s !== null ? { median, s, ...span(lo), ...ready(lo) } : null;
  } else out.sleepLowHr = null;
  const hv = raw.hrvBaseline;
  if (isObj(hv)) {
    const median = num(hv.lnMedian) ?? num(hv.median);
    const s = num(hv.lnS) ?? num(hv.s);
    const medianMs = num(hv.medianMs);
    out.hrvBaseline = median !== null && s !== null ? { median, s, ...(medianMs !== null ? { medianMs } : {}), ...span(hv), ...ready(hv) } : null;
  } else out.hrvBaseline = null;
  const tp = raw.tempBaseline;
  if (isObj(tp)) {
    const median = num(tp.medianC) ?? num(tp.median);
    out.tempBaseline = median !== null ? { median, ...span(tp), deltaT: num(tp.deltaC) ?? num(tp.deltaT), ...ready(tp) } : null;
  } else out.tempBaseline = null;
  const idle = raw.sampledIdleHr;
  if (isObj(idle)) {
    const median = num(idle.medianBpm) ?? num(idle.median);
    out.sampledIdleHr = median !== null ? { median, n: num(idle.n) ?? 0 } : null;
  } else out.sampledIdleHr = null;
  // (0.6.3 FX5) Health Connect's resting HR, only while the ring's sleeping low is not ready
  const rf = raw.restingHrFallback;
  if (isObj(rf)) {
    const median = num(rf.medianBpm) ?? num(rf.median);
    const s = num(rf.s);
    out.restingHrFallback = median !== null && s !== null && rf.source === 'healthConnect'
      ? { median, s, ...span(rf), ready: rf.ready === true, source: 'healthConnect', origins: Array.isArray(rf.origins) ? rf.origins.filter((x): x is string => typeof x === 'string') : [], label: str(rf.label) ?? 'Resting HR from Health Connect' }
      : null;
  } else out.restingHrFallback = null;
  if (!isObj(raw.learning)) out.learning = { nights: 0, needed: 7, learning: true };
  return out as unknown as GaugeBaselines;
}

function adaptSleepSessions(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((s: unknown) => (isObj(s) && isObj(s.metrics) ? { ...s, metrics: adaptSleepMetrics(s.metrics) } : s));
}

/** S2 HC records (`origin`, `deviceNative`) → `GaugeHcRecord` (`originPackage`, `originIsDeviceNative`). */
export function adaptHcRecord(raw: unknown): GaugeHcRecord | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const origin = str(raw.originPackage) ?? str(raw.origin) ?? '';
  const native = typeof raw.originIsDeviceNative === 'boolean' ? raw.originIsDeviceNative : raw.deviceNative === true;
  return { ...(raw as unknown as GaugeHcRecord), originPackage: origin, originIsDeviceNative: native, lastModified: str(raw.lastModified), payload: isObj(raw.payload) ? raw.payload : {} };
}

function adaptDerived(v: unknown): unknown {
  if (!isObj(v)) return v;
  const out: Record<string, unknown> = { ...v };
  if (isObj(v.nonExerciseHr) && num(v.nonExerciseHr.median) === null) out.nonExerciseHr = null;
  if (isObj(v.peakHr) && num(v.peakHr.bpm) === null) out.peakHr = null;
  if (isObj(v.avgWorkoutHr) && num(v.avgWorkoutHr.bpm) === null) out.avgWorkoutHr = null;
  return out;
}

const MAX_TIMELINE_MINUTES = 1500;

/**
 * (r063 S5, S1) A timeline answer in its full shape, whatever the server sent: every per-minute array present and
 * `minutes` long (a missing or short one is null-filled, a non-number value is null), `steps.support` present (an older
 * server without it: `minute` where `selected` holds a count, the only kind the server places in a minute). Null when the
 * answer cannot be a timeline at all (no date, or no minute count).
 */
export function normaliseTimeline(data: Record<string, unknown>): Record<string, unknown> | null {
  const date = str(data.date);
  const steps = isObj(data.steps) ? data.steps : {};
  const fromSteps = Array.isArray(steps.selected) ? steps.selected.length : null;
  const n = num(data.minutes) ?? fromSteps;
  if (date === null || n === null || !Number.isInteger(n) || n < 1 || n > MAX_TIMELINE_MINUTES) return null;
  const nums = (v: unknown) => Array.from({ length: n }, (_, i) => (Array.isArray(v) ? num(v[i]) : null));
  const strs = (v: unknown) => Array.from({ length: n }, (_, i) => (Array.isArray(v) ? str(v[i]) : null));
  const selected = nums(steps.selected);
  const support = Array.isArray(steps.support)
    ? Array.from({ length: n }, (_, i) => { const v = (steps.support as unknown[])[i]; return v === 'minute' || v === 'coarse' ? v : null; })
    : selected.map((v) => (v === null ? null : 'minute' as const));
  const hr = isObj(data.hr) ? data.hr : {};
  const sleep = isObj(data.sleep) ? data.sleep : {};
  const acq = isObj(data.acquisition) ? data.acquisition : {};
  const hc = Array.isArray(data.hcExercise) ? data.hcExercise : [];
  return {
    ...data, date, tz: str(data.tz) ?? 'UTC', minutes: n,
    steps: { ...steps, selected, source: strs(steps.source), ring: nums(steps.ring), phone: nums(steps.phone), support, coarse: Array.isArray(steps.coarse) ? steps.coarse : [] },
    hr: { ...hr, bpm: nums(hr.bpm), supportedS: nums(hr.supportedS), sampledBpm: nums(hr.sampledBpm), source: strs(hr.source) },
    sleep: { ...sleep, stage: strs(sleep.stage) },
    sessions: Array.isArray(data.sessions) ? data.sessions.filter(isObj) : [],
    hcExercise: hc.filter(isObj).map((x) => ({ ...x, originPackage: str(x.originPackage) ?? str(x.origin) ?? '' })),
    acquisition: { ring: strs(acq.ring), phone: strs(acq.phone) },
  };
}

/** The adapter of every answer, by route: S2's shapes in, the V2-facing types out. Unknown routes pass unchanged. */
export function adaptGaugeData(path: string, data: Record<string, unknown>): Record<string, unknown> {
  switch (path) {
    case '/v1/gauge/sleep':
      return { ...data, sessions: adaptSleepSessions(data.sessions) };
    case '/v1/gauge/daily':
      return { ...data, ...('sleep' in data ? { sleep: adaptSleepSessions(data.sleep) } : {}), ...('derived' in data ? { derived: adaptDerived(data.derived) } : {}) };
    case '/v1/gauge/baselines':
      return adaptBaselines(data) as unknown as Record<string, unknown>;
    case '/v1/gauge/hc':
      return { ...data, records: Array.isArray(data.records) ? data.records.map(adaptHcRecord).filter((r): r is GaugeHcRecord => r !== null) : [] };
    case '/v1/gauge/timeline':
      // (r063 S5) a partial answer is completed here; one that cannot be a timeline is refused (`gaugeAnswer` below)
      return normaliseTimeline(data) ?? {};
    default:
      return data;
  }
}

type Server = Pick<ServerClient, 'chatModelOptions' | 'isPaired' | 'subscribe'> & Partial<Pick<ServerClient, 'pairing'>>;

/** The device's zone (the zone app days are dated in on this device: `commands/bus.timeZone()` without a server source). */
function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type InternalCallOptions = GaugeCallOptions & { cacheOnly?: boolean; lane?: GaugeLane; onSent?: (at: number) => void; onSnapshot?: (at: number) => void; onProblem?: (problem: GaugeProblem) => void; onValidated?: (at: string) => void };
type Reader = Pick<InternalCallOptions, 'onProblem' | 'onValidated'>;
/**
 * One identical GET with the server, and everyone waiting for its answer. `sentAt`: when it left the queue for the
 * server (null while it waits there). `problem`: why it got no fresh answer.
 */
type Flight = { controller: AbortController; lane: GaugeLane; readers: Set<Reader>; promise: Promise<unknown>; sentAt: number | null; problem: GaugeProblem | null };

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('This read was cancelled.', 'AbortError');

/** `work`, or a rejection as soon as `signal` aborts: a body that stalls on the network must not outlive its request. */
const unlessAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => new Promise<T>((resolve, reject) => {
  const onAbort = () => reject(abortError(signal));
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  work.then(
    (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
    (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
  );
});

/** How long a 429 asks to wait (`Retry-After` in seconds or as a date), within `GAUGE_RETRY_AFTER_MAX_MS`. */
function retryAfterMs(header: string | null, nowMs: number): number {
  const text = header?.trim() ?? '';
  const seconds = /^\d+(\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - nowMs;
  const ms = text && Number.isFinite(seconds) ? seconds : GAUGE_RETRY_AFTER_DEFAULT_MS;
  return Math.min(GAUGE_RETRY_AFTER_MAX_MS, Math.max(0, ms));
}

export function createGaugeApi(opts: { server?: Server | (() => Server); now?: () => number; tz?: () => string; store?: GaugeCacheStore } = {}): GaugeApi & GaugeV2Api {
  const serverOf = (): Server => (typeof opts.server === 'function' ? opts.server() : (opts.server ?? getServerClient()));
  const now = opts.now ?? (() => Date.now());
  const zoneOf = (o: GaugeCallOptions): string => o.tz || (opts.tz ? opts.tz() : deviceZone());
  const store = opts.store ?? gaugeCacheStore;
  type Entry = Pick<GaugeCacheEntry, 'data' | 'etag' | 'lastModified' | 'savedAt' | 'context'>;
  const cache = new Map<string, Entry>();
  const reads = new Map<string, Promise<Entry | null>>();
  const inflight = new Map<string, Flight>();
  const controllers = new Set<AbortController>();
  const queue = createGaugeQueue();
  /** Answers the server gave or confirmed (304) in this session; a snapshot read from disk is not one until then. */
  const confirmed = new WeakSet<Entry>();
  /** Counts every HTTP answer, whatever its status: proof the server can be reached. */
  let answered = 0;
  /** Requests in a row that ran out of time with no answer to any request in between. */
  let silent = 0;
  /** What the disk holds of each snapshot: when it was last written there, and under which context. */
  const written = new Map<string, Pick<Entry, 'savedAt' | 'context'>>();
  let contextRevision: string | null = null;
  let refused = false;
  const listeners = new Set<() => void>();
  let status: GaugeStatus = { lastOkAt: null, problem: null };
  let unsub: (() => void) | null = null;
  let watched: Server | null = null;
  let pairingKey: string | null = null;
  let generation = 0;
  /** (F10) An older server refuses the `tz` parameter (400 "This endpoint takes …"): then it is left out this session. */
  let tzRefused = false;

  const set = (s: GaugeStatus) => {
    if (s.lastOkAt === status.lastOkAt && s.problem === status.problem) return;
    status = s;
    listeners.forEach((l) => l());
  };
  const fail = (problem: GaugeProblem) => set({ ...status, problem });
  /**
   * Drops every answer in memory and every request under way. `retire` also empties the saved snapshots: right when
   * the pairing ends or is refused, wrong for a new fusion context, whose snapshots are told apart by their `context`.
   */
  const forget = (retire = true) => {
    generation++;
    controllers.forEach((c) => c.abort());
    controllers.clear();
    cache.clear();
    written.clear();
    reads.clear();
    inflight.clear();
    if (retire && pairingKey && pairingKey !== 'paired') void store.clear(pairingKey).catch(() => undefined);
    tzRefused = false;
    silent = 0;
  };
  const remember = (key: string, entry: Entry) => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > 192) {
      const oldest = cache.keys().next().value!;
      cache.delete(oldest);
      written.delete(oldest);
    }
  };
  const restore = async (key: string, requestKey: string): Promise<Entry | null> => {
    if (refused) return null;
    const hit = cache.get(key);
    if (hit && hit.savedAt <= now() + 60_000 && now() - hit.savedAt <= 7 * 86_400_000) return hit;
    if (hit) cache.delete(key);
    if (!pairingKey || pairingKey === 'paired' || !persistGaugeQuery(requestKey, now())) return null;
    const pending = reads.get(key);
    if (pending) return pending;
    const gen = generation;
    const p = store.get(pairingKey, key, now()).catch(() => null).then((entry) => {
      if (gen !== generation || refused) return null;
      reads.delete(key);
      if (!entry || !gaugeSnapshotShape(requestKey, entry.data) || (contextRevision !== null && entry.context !== contextRevision)) return null;
      remember(key, entry);
      written.set(key, { savedAt: entry.savedAt, context: entry.context });
      return entry;
    });
    reads.set(key, p);
    return p;
  };
  const durable = (requestKey: string, entry: Entry) => !!pairingKey && pairingKey !== 'paired' && persistGaugeQuery(requestKey, now()) && !entry.data.next && !entry.data.nextCursor;
  const write = (scope: string, key: string, entry: Entry) => {
    written.set(key, { savedAt: entry.savedAt, context: entry.context });
    return store.put(scope, key, entry).catch(() => undefined);
  };
  /** `body` 'same': a 304 confirmed the body the disk already holds, and only its date moved. */
  const save = (key: string, requestKey: string, entry: Entry, body: 'new' | 'same' = 'new') => {
    confirmed.add(entry);
    remember(key, entry);
    if (!durable(requestKey, entry)) return;
    // Writing a snapshot again sizes and copies all of it. For a new date alone that is done every few minutes, not on every poll.
    const disk = body === 'same' ? written.get(key) : undefined;
    if (disk && disk.context === entry.context && entry.savedAt - disk.savedAt < SNAPSHOT_REDATE_MS) return;
    void write(pairingKey!, key, entry);
  };
  /**
   * The session's first word on the fusion context, and it has not changed. Every answer the server gave or confirmed
   * before now was made under this revision, so it is marked with it (on disk too: the next start then reads it back as
   * current). A snapshot from disk under another revision, or none, is let go; the read that is validating it keeps its
   * own copy for a 304.
   */
  const adoptContext = (revision: string) => {
    const gen = generation;
    const scope = pairingKey;
    const marked: Array<[string, Entry]> = [];
    for (const [key, entry] of [...cache]) {
      if (entry.context === revision) continue;
      if (!confirmed.has(entry)) { cache.delete(key); continue; }
      const next = { ...entry, context: revision };
      confirmed.add(next);
      cache.set(key, next);
      if (durable(key, next)) marked.push([key, next]);
    }
    // one write at a time, each after the last has finished: sizing a snapshot is work on the main thread
    void (async () => {
      for (const [key, entry] of marked) {
        if (gen !== generation || scope !== pairingKey || cache.get(key) !== entry) continue;
        await write(scope!, key, entry);
      }
    })();
  };

  /** The cache and its HTTP validators belong to one pairing, including direct replacement without an unpair. */
  const checkPairing = (s: Server) => {
    const p = s.pairing?.();
    const key = s.isPaired() ? (p ? JSON.stringify([p.baseUrl.replace(/\/+$/, ''), p.person.id, p.deviceId, p.pairedAt]) : 'paired') : null;
    if (key === pairingKey) return;
    forget();
    pairingKey = key;
    contextRevision = null;
    refused = false;
    if (key && key !== 'paired') void store.retain(key, now()).catch(() => undefined);
  };
  const watchPairing = (s: Server) => {
    if (watched === s) {
      checkPairing(s);
      return;
    }
    unsub?.();
    watched = s;
    forget();
    pairingKey = null;
    try {
      unsub = s.subscribe(() => {
        if (watched === s) checkPairing(s);
      });
    } catch {
      unsub = null;
    }
    checkPairing(s);
  };

  type Answer = { kind: 'data'; data: Record<string, unknown> } | { kind: 'null' } | { kind: 'status'; status: number };
  /** The server refused for now (429): ask again after `waitMs`, if the pairing is still the one of `generation`. */
  type Busy = { kind: 'busy'; waitMs: number; generation: number };

  /**
   * One request; `{kind:'status'}` hands a refused status back to the caller (tz fallback, the fuse route's 404).
   * A 429 is the rate limit, not a failed read: it is waited out with no slot held, and the request sent once more.
   */
  async function send(method: 'GET' | 'POST', path: string, key: string, body: unknown, o: InternalCallOptions, passStatus: (st: number) => boolean): Promise<Answer> {
    const first = await attempt(method, path, key, body, o, passStatus, true);
    if (first.kind !== 'busy') return first;
    await new Promise<void>((resolve) => {
      // `forget` (the pairing ended or changed) ends the wait as the caller's own signal does
      const ctl = new AbortController();
      controllers.add(ctl);
      const done = () => {
        clearTimeout(timer);
        controllers.delete(ctl);
        o.signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, first.waitMs);
      ctl.signal.addEventListener('abort', done, { once: true });
      if (o.signal?.aborted) done();
      else o.signal?.addEventListener('abort', done, { once: true });
    });
    if (o.signal?.aborted) throw abortError(o.signal);
    watchPairing(serverOf());
    if (generation !== first.generation) return { kind: 'null' };
    return (await attempt(method, path, key, body, o, passStatus, false)) as Answer;
  }

  /** `retryBusy`: a 429 comes back as `busy` for `send` to wait out; otherwise it is the read's failure. */
  async function attempt(method: 'GET' | 'POST', path: string, key: string, body: unknown, o: InternalCallOptions, passStatus: (st: number) => boolean, retryBusy: boolean): Promise<Answer | Busy> {
    const semantic = new URL(key, 'https://cache.invalid');
    semantic.searchParams.set('tz', zoneOf(o));
    semantic.searchParams.sort();
    const cacheKey = `${semantic.pathname}?${semantic.searchParams.toString()}`;
    /** No fresh answer: the last good one where the caller takes it. `everywhere` false keeps the client's own status. */
    const offline = (problem: GaugeProblem, everywhere = true): Answer => {
      if (stale()) return { kind: 'null' };
      o.onProblem?.(problem);
      if (everywhere) fail(problem);
      const hit = method === 'GET' && o.cached !== false ? cache.get(cacheKey)?.data : undefined;
      return hit ? { kind: 'data', data: hit } : { kind: 'null' };
    };
    const server = serverOf();
    watchPairing(server);
    const requestGeneration = generation;
    const stale = () => {
      watchPairing(serverOf());
      return requestGeneration !== generation || o.signal?.aborted === true;
    };
    if (!server.isPaired()) {
      forget();
      o.onProblem?.('not_paired');
      fail('not_paired');
      return { kind: 'null' };
    }
    if (refused) { o.onProblem?.('unauthorized'); return { kind: 'null' }; }
    // Only allowlisted historical GETs can be served as screen snapshots.
    if (o.cacheOnly && (o.cached === false || method !== 'GET' || !persistGaugeQuery(key, now()))) return { kind: 'null' };
    if (method === 'GET') await restore(cacheKey, key);
    if (stale()) return { kind: 'null' };
    if (o.cacheOnly) {
      const hit = cache.get(cacheKey);
      if (hit) o.onSnapshot?.(hit.savedAt);
      return hit ? { kind: 'data', data: hit.data } : { kind: 'null' };
    }
    const ctl = new AbortController();
    controllers.add(ctl);
    const onAbort = () => ctl.abort();
    if (o.signal?.aborted) ctl.abort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | null = null;
    let res: Response;
    /** The parsed body of a 2xx answer; `unread` when it did not arrive whole or is not JSON. */
    let parsed: unknown;
    let unread = false;
    // The body a 304 confirms. A fusion context that arrives meanwhile may let an unconfirmed snapshot go from memory.
    let asked: Entry | undefined;
    try {
      release = await queue.enter(o.lane ?? { priority: o.priority ?? 'background' }, ctl.signal);
      if (!release) {
        if (o.signal?.aborted) throw abortError(o.signal);
        return { kind: 'null' };
      }
      if (stale()) return { kind: 'null' };
      let base: string;
      let doFetch: typeof fetch;
      try {
        const w = serverOf().chatModelOptions();
        base = w.serverUrl.replace(/\/+$/, '');
        doFetch = w.deps.fetch;
      } catch (e) {
        if (e instanceof ServerError && e.code === 'not_paired') {
          forget();
          o.onProblem?.('not_paired');
          fail('not_paired');
          return { kind: 'null' };
        }
        return offline('server_error');
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (method === 'GET') {
        // a conditional poll: the server answers 304 while nothing changed, and the cached body stays
        asked = cache.get(cacheKey);
        if (asked?.etag) headers['if-none-match'] = asked.etag;
        else if (asked?.lastModified) headers['if-modified-since'] = asked.lastModified;
      } else headers['content-type'] = 'application/json';
      // The clock starts as the request leaves for the server: time spent waiting for a slot is not the server's.
      const sentAt = now();
      o.onSent?.(sentAt);
      const seen = answered;
      let timedOut = false;
      timer = setTimeout(() => { timedOut = true; ctl.abort(); }, GAUGE_REQUEST_TIMEOUT_MS);
      try {
        res = await doFetch(`${base}${key}`, { method, headers, signal: ctl.signal, cache: 'no-store', ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
        answered++;
        silent = 0;
      } catch (e) {
        if (o.signal?.aborted) throw e;
        if (stale()) return { kind: 'null' };
        if (e instanceof ServerError && e.code === 'not_paired') {
          forget();
          o.onProblem?.('not_paired');
          fail('not_paired');
          return { kind: 'null' };
        }
        if (timedOut) {
          // The server answered others while this one ran out of time: it is slow, not out of reach.
          if (answered !== seen) return offline('server_error', false);
          // A timer that fires long after it was due means the app was suspended; that says nothing about the network.
          if (now() - sentAt > GAUGE_REQUEST_TIMEOUT_MS * 2) return offline('offline', false);
          // A busy server can keep everything it was sent at once waiting too long. Only when the requests sent after
          // those hear nothing either is it out of reach; until then each slow read is its own failure.
          if (++silent <= GAUGE_MAX_IN_FLIGHT) return offline('server_error', false);
        }
        return offline('offline');
      }
      // The body is part of the answer: the timeout and the slot last until it has been read. A connection that
      // stalls after the headers would otherwise leave this read pending for good.
      if (res.ok) {
        try {
          parsed = await unlessAborted(res.json() as Promise<unknown>, ctl.signal);
        } catch {
          // cancelled (by the caller, or with the pairing): no answer, as for any answer that comes too late
          if (stale()) return { kind: 'null' };
          // The headers came, so the server can be reached: out of time here is this read's failure, as above.
          if (timedOut) return offline('server_error', false);
          unread = true;
        }
      }
    } finally {
      controllers.delete(ctl);
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      release?.();
    }
    if (stale()) return { kind: 'null' };
    if (res.status === 304 && method === 'GET') {
      const hit = cache.get(cacheKey) ?? asked;
      if (hit) {
        // confirmed now, so it stands under the context known now (its old mark is kept until the first is heard)
        save(cacheKey, key, { ...hit, savedAt: now(), context: contextRevision ?? hit.context }, 'same');
        o.onValidated?.(new Date(now()).toISOString());
        set({ lastOkAt: new Date(now()).toISOString(), problem: null });
        return { kind: 'data', data: hit.data };
      }
      return offline('server_error');
    }
    // 401: the pairing ended (the server client forgets it); 403: this token may not read Gauge data (`wrong_kind`)
    if (res.status === 401 || res.status === 403) {
      forget();
      refused = true;
      o.onProblem?.('unauthorized');
      fail('unauthorized');
      return { kind: 'null' };
    }
    if (!res.ok && passStatus(res.status)) return { kind: 'status', status: res.status };
    if (res.status === 429 && retryBusy) return { kind: 'busy', waitMs: retryAfterMs(res.headers.get('retry-after'), now()), generation: requestGeneration };
    if (!res.ok) return offline(res.status === 404 ? 'not_supported' : 'server_error');
    let data: Record<string, unknown> | null = unread ? null : gaugeData(parsed);
    if (!data) return offline('server_error');
    data = adaptGaugeData(path, data);
    // (r063 S5) an answer that cannot be a timeline is a server error, never an object a screen trips over
    if (path === '/v1/gauge/timeline' && typeof data.date !== 'string') return offline('server_error');
    if (method === 'GET') save(cacheKey, key, { data, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), savedAt: now(), context: contextRevision });
    o.onValidated?.(new Date(now()).toISOString());
    set({ lastOkAt: new Date(now()).toISOString(), problem: null });
    return { kind: 'data', data };
  }

  const keyOf = (path: string, query: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, v);
    return `${path}?${qs.toString()}`;
  };

  /** A read with the device zone (`tz`, contract F10); an older server that refuses `tz` is asked again without it. */
  async function getUnshared<T>(path: string, query: Record<string, string | undefined>, o: InternalCallOptions = {}): Promise<T | null> {
    if (!tzRefused) {
      const a = await send('GET', path, keyOf(path, { ...query, tz: zoneOf(o) }), undefined, o, (st) => st === 400);
      if (a.kind === 'data') return a.data as T;
      if (a.kind === 'null') return null;
      tzRefused = true;
    }
    const b = await send('GET', path, keyOf(path, query), undefined, o, () => false);
    return b.kind === 'data' ? (b.data as T) : null;
  }

  /**
   * Identical reads share one request, whoever asks and with whatever signal: a card, a composed screen question and
   * the importer wanting the same day send it once. A caller that cancels leaves the others their answer; the request
   * itself is cancelled only when nobody waits for it any more. Each caller still gets its own kind of answer when the
   * server gave none: the last good one, or null for a caller that asked for fresh data only (`cached: false`).
   *
   * A caller that names `since` needs an answer made after that moment. A request sent before it may carry what the
   * server knew then, so it is not joined: a new one goes out, and later callers join that one. A request still waiting
   * in the queue has not been asked of the server yet, and is joined.
   */
  function get<T>(path: string, query: Record<string, string | undefined>, o: InternalCallOptions = {}): Promise<T | null> {
    watchPairing(serverOf());
    // a snapshot read asks the disk, never the server
    if (o.cacheOnly) return getUnshared<T>(path, query, o);
    const signal = o.signal;
    if (signal?.aborted) return Promise.resolve(null);
    const key = JSON.stringify([generation, path, query, zoneOf(o)]);
    const reader: Reader = { onProblem: o.onProblem, onValidated: o.onValidated };
    let flight = inflight.get(key);
    // the same moment counts as before: the request left first
    if (flight && o.since !== undefined && flight.sentAt !== null && flight.sentAt <= o.since) flight = undefined;
    if (flight) {
      flight.readers.add(reader);
      // a screen now waits for it too: it moves ahead of the background reads still queued
      if (o.priority === 'screen') flight.lane.priority = 'screen';
      // it has failed already and is about to answer so: this caller hears why as the others did
      if (flight.problem) reader.onProblem?.(flight.problem);
    } else {
      const controller = new AbortController();
      const lane: GaugeLane = { priority: o.priority ?? 'background' };
      const readers = new Set<Reader>([reader]);
      const created: Flight = { controller, lane, readers, promise: Promise.resolve(null), sentAt: null, problem: null };
      // an older request for the same read keeps its own callers; whoever asks from now on joins this one
      inflight.set(key, created);
      created.promise = getUnshared<T>(path, query, {
        tz: zoneOf(o), signal: controller.signal, lane,
        // the first time it leaves: an older server that refuses `tz` is asked a second time, no earlier than this
        onSent: (at) => { created.sentAt ??= at; },
        // every problem ends the read with the last good answer or none: never with a fresh one
        onProblem: (problem) => { created.problem = problem; readers.forEach((r) => r.onProblem?.(problem)); },
        onValidated: (at) => readers.forEach((r) => r.onValidated?.(at)),
      }).finally(() => { if (inflight.get(key) === created) inflight.delete(key); });
      flight = created;
    }
    const joined = flight;
    const answer = (o.cached === false ? joined.promise.then((v) => (joined.problem ? null : v)) : joined.promise) as Promise<T | null>;
    if (!signal) return answer;
    return new Promise<T | null>((resolve, reject) => {
      const onAbort = () => {
        joined.readers.delete(reader);
        if (joined.readers.size > 0) return reject(abortError(signal));
        // nobody waits any more: cancel the request, and let no later caller join it
        if (inflight.get(key) === joined) inflight.delete(key);
        joined.controller.abort();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      answer.then(
        (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
        (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  }

  /**
   * `series` with its pages (SPEC §2.2): follows `next` (or `nextCursor`) with `cursor` until the server has none, so the
   * day facts are derived from every reading. A page that does not arrive, or the page cap, leaves `truncated: true`.
   */
  async function series(q: GaugeSeriesQuery, o: GaugeCallOptions = {}): Promise<GaugeSeries | null> {
    const query = { kind: q.kind, from: q.from, to: q.to, bucket: q.bucket };
    const first = await get<GaugeSeries>('/v1/gauge/series', query, o);
    if (!first) return null;
    let cursor = seriesCursor(first);
    if (cursor === null) return first;
    const points = [...(first.points ?? [])];
    const seen = new Set<string>();
    let pages = 1;
    let complete = true;
    while (cursor !== null) {
      if (seen.has(cursor) || pages >= GAUGE_SERIES_MAX_PAGES) {
        complete = false;
        break;
      }
      seen.add(cursor);
      const page = await get<GaugeSeries>('/v1/gauge/series', { ...query, cursor }, o);
      if (!page) {
        complete = false;
        break;
      }
      points.push(...(page.points ?? []));
      pages++;
      cursor = seriesCursor(page);
    }
    const { next: _n, nextCursor: _c, ...rest } = first;
    void _n;
    void _c;
    return { ...rest, points, count: points.length, truncated: !complete };
  }

  /**
   * `hr-intervals` with its pages: follows `next` with `cursor` to the end. A page that does not arrive, the page cap or a
   * page with another `inputsHash` (the readings changed meanwhile) leaves `truncated: true`, never a silent cut.
   */
  async function hrIntervals(from: string, to: string, o: GaugeCallOptions = {}): Promise<GaugeHrIntervals | null> {
    type Page = Omit<GaugeHrIntervals, 'truncated'> & { next?: string | null };
    const query = { from, to };
    const first = await get<Page>('/v1/gauge/hr-intervals', query, o);
    if (!first || !Array.isArray(first.intervals)) return null;
    const intervals = [...first.intervals];
    let cursor = typeof first.next === 'string' && first.next ? first.next : null;
    const seen = new Set<string>();
    let pages = 1;
    let complete = true;
    while (cursor !== null) {
      if (seen.has(cursor) || pages >= GAUGE_HR_MAX_PAGES) {
        complete = false;
        break;
      }
      seen.add(cursor);
      const page = await get<Page>('/v1/gauge/hr-intervals', { ...query, cursor }, o);
      if (!page || !Array.isArray(page.intervals) || page.inputsHash !== first.inputsHash) {
        complete = false;
        break;
      }
      intervals.push(...page.intervals);
      pages++;
      cursor = typeof page.next === 'string' && page.next ? page.next : null;
    }
    const { next: _n, ...rest } = first;
    void _n;
    return { ...rest, intervals, truncated: !complete };
  }

  /**
   * (r063 S15) `hc` with every page: follows `next` with `cursor` to the end. `deleted` comes with the first page. A page
   * that does not arrive, a repeated cursor or the page cap leaves `truncated: true` (the caller must not treat the
   * records as complete, nor advance its watermark).
   */
  async function hc(type: string, from: string, to: string, o: GaugeCallOptions = {}): Promise<GaugeHc | null> {
    const query = { type, from, to };
    const first = await get<GaugeHc>('/v1/gauge/hc', query, o);
    if (!first || !Array.isArray(first.records)) return null;
    let cursor = typeof first.next === 'string' && first.next ? first.next : null;
    if (cursor === null) return { ...first, truncated: false };
    const records = [...first.records];
    const seen = new Set<string>();
    let pages = 1;
    let complete = true;
    while (cursor !== null) {
      if (seen.has(cursor) || pages >= GAUGE_HC_MAX_PAGES) {
        complete = false;
        break;
      }
      seen.add(cursor);
      const page: GaugeHc | null = await get<GaugeHc>('/v1/gauge/hc', { ...query, cursor }, o);
      if (!page || !Array.isArray(page.records)) {
        complete = false;
        break;
      }
      records.push(...page.records);
      pages++;
      cursor = typeof page.next === 'string' && page.next ? page.next : null;
    }
    return { ...first, records, next: null, truncated: !complete };
  }

  /** (r063 S13) The change feed after `since`, every page (`more`) followed up to the cap. */
  async function changes(since: string | null, o: GaugeCallOptions = {}): Promise<GaugeChanges | null> {
    type Page = { cursor?: unknown; more?: unknown; resync?: unknown; changes?: unknown };
    const out: GaugeChange[] = [];
    let cursor = since;
    let resync = false;
    for (let pages = 0; pages < GAUGE_CHANGES_MAX_PAGES; pages++) {
      const page = await get<Page>('/v1/gauge/changes', { since: cursor ?? undefined }, { ...o, cached: false });
      if (!page || typeof page.cursor !== 'string') return pages === 0 ? null : { cursor: cursor ?? '', resync, changes: out, truncated: true };
      if (page.resync === true) resync = true;
      for (const c of Array.isArray(page.changes) ? page.changes : []) {
        if (!isObj(c) || typeof c.id !== 'string' || typeof c.ref !== 'string' || (c.change !== 'revised' && c.change !== 'deleted')) continue;
        if (c.kind !== 'workout' && c.kind !== 'hcExercise' && c.kind !== 'hcWeight') continue;
        out.push({ kind: c.kind, id: c.id, ref: c.ref, change: c.change, start: str(c.start), end: str(c.end), at: str(c.at), ...(typeof c.installationId === 'string' ? { installationId: c.installationId } : {}) });
      }
      cursor = page.cursor;
      if (page.more !== true) return { cursor, resync, changes: out, truncated: false };
    }
    return { cursor: cursor ?? '', resync, changes: out, truncated: true };
  }

  /** (0.6.3 FX1) The state now of up to `GAUGE_STATE_MAX_REFS` imported records; null when it could not be read. */
  async function changesState(refs: readonly GaugeSubjectRef[], o: GaugeCallOptions = {}): Promise<GaugeSubjectState[] | null> {
    const list = refs.filter((r) => r.id && !r.id.includes(',')).slice(0, GAUGE_STATE_MAX_REFS);
    if (list.length === 0) return [];
    type Page = { states?: unknown };
    const page = await get<Page>('/v1/gauge/changes-state', { refs: list.map((r) => `${r.kind}:${r.id}`).join(',') }, { ...o, cached: false });
    if (!page || !Array.isArray(page.states)) return null;
    const out: GaugeSubjectState[] = [];
    for (const x of page.states) {
      if (!isObj(x) || typeof x.id !== 'string' || typeof x.ref !== 'string') continue;
      if (x.kind !== 'workout' && x.kind !== 'hcExercise' && x.kind !== 'hcWeight') continue;
      if (x.state !== 'present' && x.state !== 'deleted' && x.state !== 'unknown') continue;
      out.push({ kind: x.kind, id: x.id, ref: x.ref, state: x.state, at: str(x.at) });
    }
    return out;
  }

  /**
   * (0.6.7 AD-VITALS) The detections of [from, to], every page: a page names the next one with `next` (sent back as
   * `cursor`) or says `more: true` (asked again with `since` = its `cursor`). Malformed episodes are dropped one by one;
   * a missing page, a repeated cursor or the cap leaves `truncated: true`.
   */
  async function detections(q: { from: string; to: string; since?: string | null }, o: GaugeCallOptions = {}): Promise<GaugeDetections | null> {
    type Page = { episodes?: unknown; withdrawn?: unknown; cursor?: unknown; next?: unknown; more?: unknown; processedThrough?: unknown; detector?: unknown };
    const base = { from: q.from, to: q.to };
    const first = await get<Page>('/v1/gauge/detections', { ...base, since: q.since ?? undefined }, { ...o, cached: false });
    if (!first || !Array.isArray(first.episodes)) return null;
    const episodes = new Map<string, GaugeDetectionEpisode>();
    const withdrawn = new Set<string>();
    let detector = str(first.detector);
    let processedThrough = str(first.processedThrough);
    let cursor = str(first.cursor);
    let truncated = false;
    const take = (p: Page) => {
      for (const x of Array.isArray(p.episodes) ? p.episodes : []) {
        const e = detectionEpisodeOf(x);
        if (!e) continue;
        // the newest revision of an id wins
        const had = episodes.get(e.id);
        if (!had || had.revision <= e.revision) episodes.set(e.id, e);
      }
      for (const w of Array.isArray(p.withdrawn) ? p.withdrawn : []) if (typeof w === 'string' && w && w.length <= 64) withdrawn.add(w);
    };
    take(first);
    const seen = new Set<string>();
    let page: Page = first;
    for (let pages = 1; ; pages++) {
      const next = typeof page.next === 'string' && page.next ? { cursor: page.next } : page.more === true && typeof page.cursor === 'string' && page.cursor ? { since: page.cursor } : null;
      if (!next) break;
      const key = 'cursor' in next ? `c:${next.cursor}` : `s:${next.since}`;
      if (seen.has(key) || pages >= GAUGE_DETECTIONS_MAX_PAGES) {
        truncated = true;
        break;
      }
      seen.add(key);
      const p = await get<Page>('/v1/gauge/detections', { ...base, ...next }, { ...o, cached: false });
      if (!p || !Array.isArray(p.episodes)) {
        truncated = true;
        break;
      }
      take(p);
      if (typeof p.cursor === 'string') cursor = p.cursor;
      detector = str(p.detector) ?? detector;
      processedThrough = str(p.processedThrough) ?? processedThrough;
      page = p;
    }
    // an id both listed and withdrawn is withdrawn
    for (const [id, e] of episodes) if (e.state === 'withdrawn') withdrawn.add(id);
    for (const id of withdrawn) episodes.delete(id);
    const list = [...episodes.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : 1));
    if (list.length > GAUGE_DETECTIONS_MAX) truncated = true;
    return { episodes: list.slice(-GAUGE_DETECTIONS_MAX), withdrawn: [...withdrawn].sort().slice(0, GAUGE_DETECTIONS_MAX), cursor, processedThrough, detector, truncated };
  }

  /**
   * (r063 S6) Stores the person's fusion context on the server; a new revision drops every cached fused answer.
   *
   * A session does not know the revision until its first post. When that post changes nothing, the answers already
   * read stand (`adoptContext`): starting the app is not a correction, and must not empty the screens.
   */
  async function fusionContext(body: GaugeFusionContextRequest, o: GaugeCallOptions = {}): Promise<GaugeFusionContextResult | null> {
    const tz = body.tz || zoneOf(o);
    // What this post decides can undo every fused read made before it, so it does not wait behind them.
    const first: InternalCallOptions = { ...o, lane: { priority: 'screen' } };
    const a = await send('POST', '/v1/gauge/fusion-context', '/v1/gauge/fusion-context', { ...body, tz }, first, (st) => st === 404 || st === 405 || st === 400);
    if (a.kind !== 'data' || typeof a.data.revision !== 'string') return null;
    const r = { revision: a.data.revision, changed: a.data.changed === true };
    // this post changed it, or another device did since this one last posted
    if (r.changed || (contextRevision !== null && contextRevision !== r.revision)) {
      // saved snapshots stay on disk: they carry the old revision and are not read back under the new one
      forget(false);
      contextRevision = r.revision;
      contextListeners.forEach((l) => l(r.revision));
    } else if (contextRevision === null) {
      contextRevision = r.revision;
      adoptContext(r.revision);
    }
    return r;
  }

  async function stepsFuse(body: GaugeStepsFuseRequest, o: GaugeCallOptions = {}): Promise<GaugeSteps | null> {
    const tz = body.tz || zoneOf(o);
    const a = await send('POST', '/v1/gauge/steps/fuse', '/v1/gauge/steps/fuse', { ...body, tz }, o, (st) => st === 404 || st === 405);
    if (a.kind === 'data') return a.data as unknown as GaugeSteps;
    if (a.kind === 'null') return null;
    // an older server without the route: GET /steps for the same range and zone (no activity context there)
    return get<GaugeSteps>('/v1/gauge/steps', { from: body.from, to: body.to, ...(body.bucket ? { bucket: body.bucket } : {}) }, { ...o, tz });
  }

  const api: GaugeApi & GaugeV2Api = {
    availability: (o) => get<GaugeAvailability>('/v1/gauge/availability', {}, o),
    series,
    daily: (date, o) => get<GaugeDailySummary>('/v1/gauge/daily', { date }, o),
    sleep: (from, to, o) => get<GaugeSleep>('/v1/gauge/sleep', { from, to }, o),
    activity: (from, to, o) => get<GaugeActivity>('/v1/gauge/activity', { from, to }, o),
    scores: (from, to, key, o) => get<GaugeScores>('/v1/gauge/scores', { from, to, key }, o),
    device: (o) => get<GaugeDeviceState>('/v1/gauge/device', {}, o),
    shortVideo: (from, to, o) => get<GaugeShortVideo>('/v1/gauge/short-video', { from, to }, o),
    socialTime: (from, to, o) => get<GaugeSocialTime>('/v1/gauge/social-time', { from, to }, o),
    workouts: (from, to, o) => get<GaugeWorkouts>('/v1/gauge/workouts', { from, to }, o),
    steps: (from, to, o) => get<GaugeSteps>('/v1/gauge/steps', { from, to }, o),
    stepsFuse,
    timeline: (date, o) => get<GaugeTimeline>('/v1/gauge/timeline', { date }, o),
    baselines: (date, o) => get<GaugeBaselines>('/v1/gauge/baselines', { date }, o),
    hc,
    hrIntervals,
    changes,
    changesState,
    detections,
    fusionContext,
    status: () => status,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    clearCache: () => forget(),
    withOptions: (options) => view(options),
    async snapshot(load) {
      let savedAt: number | null = null;
      const data = await load(view({ cacheOnly: true, onSnapshot: (at) => { savedAt = savedAt === null ? at : Math.min(savedAt, at); } }));
      return { data, savedAt };
    },
  };
  // Method argument positions are explicit; status/control methods are never made into cache reads.
  const optionAt: Record<string, number> = { availability: 0, series: 1, daily: 1, sleep: 2, activity: 2, scores: 3, device: 0, shortVideo: 2, socialTime: 2, workouts: 2, steps: 2, stepsFuse: 1, timeline: 1, baselines: 1, hc: 3, hrIntervals: 2, changes: 1, changesState: 1, detections: 1, fusionContext: 1 };
  function view(options: InternalCallOptions): GaugeApi & GaugeV2Api {
    let readStatus: GaugeStatus = { lastOkAt: status.lastOkAt, problem: null };
    const tracked: InternalCallOptions = { ...options,
      onProblem: (problem) => {
        options.onProblem?.(problem);
        // A healthy sibling endpoint must never make a partially offline composite look fresh.
        if (readStatus.problem !== 'unauthorized' && readStatus.problem !== 'not_paired') readStatus = { ...readStatus, problem };
      },
      onValidated: (lastOkAt) => { options.onValidated?.(lastOkAt); readStatus = { ...readStatus, lastOkAt }; },
    };
    return new Proxy(api, { get(target, property) {
      if (property === 'status') return () => readStatus;
      const method = Reflect.get(target, property);
      const index = optionAt[String(property)];
      if (index === undefined || typeof method !== 'function') return method;
      return (...args: unknown[]) => {
        args[index] = { ...(args[index] as GaugeCallOptions | undefined), ...tracked };
        return Reflect.apply(method, target, args);
      };
    } });
  }
  return api;
}

const contextListeners = new Set<(revision: string) => void>();
/**
 * (r063 S6) Hear when the person's fusion context on the server takes a new revision: every fused answer (timelines,
 * steps, the Ring's day) may have changed, so caches keyed only by date are dropped.
 */
export function onFusionContextChange(listener: (revision: string) => void): () => void {
  contextListeners.add(listener);
  return () => void contextListeners.delete(listener);
}

/** The app's Gauge client, over the app's server client (`getServerClient()`, read on every call). */
export const gaugeApi: GaugeApi & GaugeV2Api = createGaugeApi({ server: () => getServerClient() });

registerEraseHook(() => gaugeApi.clearCache());
