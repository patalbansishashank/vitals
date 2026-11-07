/**
 * The Lumen store of one person (`persons/<id>/lumen.db`, better-sqlite3, WAL; docs/SERVER.md "Gauge"): the
 * CloudEvents the Gauge app (formerly Lumen Health) uploads, kept apart from the person's Vitals data. Nothing here reads or writes the
 * Evolu replica, `local.db` or any Vitals collection, and the Vitals apps never sync this file.
 *
 * - `events`: raw and append-only, one row per event id (Lumen's deterministic `pl-<sha256…>`); a re-sent id is a
 *   duplicate. A changed value has a new id; every version stays here.
 * - `deletions`: the `com.pulseloop.deletion.v1` events (also kept in `events`). A deletion hides the matching events of
 *   its installation that Lumen had received before the deletion (soft delete): its category (exact, or a group such
 *   as `metrics` for `metrics/<kind>`, or `*` for everything), its time range, and its `kind` when given. An event Lumen receives again
 *   later (the ring hands a night back after "Reset App Data", `category: '*'`) keeps its id, so it is a duplicate here,
 *   but its newer `received_at` is noted (`last_received_ms`) and it shows again.
 * - The schema and its migrations (`PRAGMA user_version`) are in `./lumenMigrate.ts`, with `event_spans`: each
 *   span-bearing event's support `[start, end)` and §2.3 lineage, written at ingest (energy SPEC §S1).
 * - Views (`visible_events` → `current_events` → `metric_series`, `daily_activity`, `activity_buckets`,
 *   `sleep_timeline`, `insights`, `device_state`): soft-deleted rows are gone, and for one `(installation, category,
 *   subject, observed_at)` only the newest version (`data.received_at`, then ingest order) is kept: two sources never
 *   replace each other, and new categories carry their lineage in the subject. Lumen's `time` equals its
 *   `observed_at`, so it never orders versions.
 * - §2.1 evidence views over `current_spans` (the same rule, driven from `event_spans`): `ring_step_intervals` (both
 *   ring subjects; legacy `activity_bucket` rows are `legacyUnknown`), `phone_step_intervals`, `sport_telemetry`,
 *   `gps_points`, `acquisition`; and `hc_records` (latest Health Connect revision minus tombstones). S2 reads them
 *   through `readIntervals` / `readMetricSamples` (overlap, stable order, cursor pages). `short_video_days` (`habits/short_video`, subject = the local date)
 *   keeps one row per date: the newest version by the same order, whatever its `observed_at`.
 * - `workout_sessions` (`activity/session`, subject = the session id): one row per session, the newest version by
 *   `data.received_at`, then ingest order, whatever its `observed_at`; when that newest version is soft-deleted the
 *   session is gone (an older version never shows again in its place).
 * - `vitals-server gauge dedupe` (`dedupe`, `./lumenDedupe.ts`) soft-deletes the copies Gauge 2.7.3's clock correction
 *   left, as exact-instant rows in `deletions` with ids `srv-dedupe-<event id>` (never in `events`): `undoDedupe` removes
 *   them and the copies show again.
 * - `installationId` is any 8–64 character id of letters, digits and dashes: Lumen sends its MQTT id (32 lowercase hex,
 *   a UUID without dashes); a dashed UUID is accepted too.
 */
import Database from 'better-sqlite3';
import { chmodSync, existsSync } from 'node:fs';
import { findDuplicates, inferClockOffset, type DedupeRow, type Removal } from './lumenDedupe.ts';
import {
  backfillSpans, BUCKET_SUPPORT, instantMs, isSpanCategory, LEGACY_BUCKET_SUBJECT, LEGACY_SUPPORT, MAX_SPAN_MS, migrateLumen, OWN_ORIGIN, RING_STEPS_SUBJECT, spanMaxMs, spanOf, spanWriter,
  type Lineage, type SpanCategory,
} from './lumenMigrate.ts';
import { rebuildState, stateStale, stateWriter } from './lumenState.ts';
import { createDetectionStore, type DetectionStore } from './detect/episodes.ts';
import { mergeRanges, touchOf } from './detect/queue.ts';

export { instantMs, LUMEN_SCHEMA_VERSION, MAX_SPAN_MS, SPAN_CATEGORIES, type Lineage, type SpanCategory } from './lumenMigrate.ts';

export const LUMEN_MAX_BATCH = 500;
export const LUMEN_MAX_BYTES = 1024 * 1024;
export const DELETION_TYPE = 'com.pulseloop.deletion.v1';
export const DELETION_CATEGORY = 'deletion';
export const SHORT_VIDEO_CATEGORY = 'habits/short_video';
export const WORKOUT_CATEGORY = 'activity/session';
export const WORKOUT_TYPE = 'com.pulseloop.activity.session.v1';


export interface Rejection {
  id: string | null;
  index: number;
  reason: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: Rejection[];
}

export interface LumenStatus {
  lastEventAt: string | null;
  lastObservedAt: string | null;
  counts: Record<string, number>;
  deletions: number;
  installations: InstallationRow[];
}

/** Which app an installation is: the standalone Gauge app, or the Gauge engine built into the Vitals app (r070). */
export type InstallationApp = 'gauge' | 'vitals';

export interface InstallationRow {
  id: string;
  deviceName: string | null;
  appVersion: string | null;
  pairedAt: string | null;
  lastIngestAt: string | null;
  /** `vitals` when the installation is the engine embedded in the Vitals app (`POST /v1/lumen/pair-device`), else `gauge`. */
  app: InstallationApp;
  /** When the installation unpaired itself (embedded installations only matter while this is null). */
  unpairedAt: string | null;
  /**
   * `unpaired` once it unpaired itself; `superseded` when another installation of this person, embedded in Vitals, is paired and active: the standalone Gauge
   * app being retired. Its data stays (history, a late backlog still arrives); only its role changes. `active` otherwise.
   */
  status: 'active' | 'superseded' | 'unpaired';
  /** The embedded installation that replaced it (the one paired last), or null. */
  supersededBy: string | null;
}

export const DEDUPE_ID_PREFIX = 'srv-dedupe-';
export const DEDUPE_CATEGORIES = ['sleep/timeline', 'activity/buckets', 'metrics'] as const;
/** A category `gauge dedupe` may clean: ring history only (date-stamped day totals and state are not copies by time). */
export const dedupeCategoryOk = (c: string) => c === 'sleep/timeline' || c === 'activity/buckets' || c === 'metrics' || /^metrics\/[a-z0-9_-]+$/.test(c);

export interface DedupeOptions {
  /** Default `sleep/timeline`; `metrics` means every `metrics/<kind>`. */
  categories?: readonly string[];
  /** The ring's clock offset (raw − corrected, ms) for every installation; by default inferred from its sleep packets. */
  offsetMs?: number | null;
  /** Nothing is kept: the deletions are written, `inspect` runs, and the transaction is rolled back. */
  dryRun?: boolean;
  nowMs?: number;
  /** Runs inside the transaction once the deletions are in (dry run too): read the views as they would be. */
  inspect?: () => void;
}

export interface DedupeResult {
  /** Per installation: the offset used, where it came from and how many sleep twins showed it. */
  offsets: Array<{ installationId: string; offsetMs: number | null; source: 'given' | 'inferred' | 'none'; twins: number }>;
  removals: Removal[];
  /** Deletion rows written (0 in a dry run). */
  written: number;
}

export const READ_DEFAULT_LIMIT = 2000;
export const READ_MAX_LIMIT = 10_000;

/** A read helper's bad argument: the routes answer it with a 400 (`code`). */
export class LumenReadError extends Error {
  // a plain field, not a parameter property: `vitals-server` runs this file through Node's strip-only type stripping
  readonly code: 'invalid_cursor' | 'invalid_range' | 'invalid_limit' | 'unknown_category' | 'invalid_kind';
  constructor(code: LumenReadError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'LumenReadError';
  }
}

export interface PageOptions {
  /** The `next` of the previous page; absent for the first. Only valid for the same helper. */
  cursor?: string | null;
  /** Rows per page: default 2000, at most 10 000. */
  limit?: number;
}

/** One page; `next` is null on the last one (nothing is ever cut silently). */
export interface Page<T> {
  rows: T[];
  next: string | null;
}

/** One current event with a time support (`readIntervals`). */
export interface IntervalRow {
  id: string;
  /** The events rowid (ingest order). */
  seq: number;
  installationId: string;
  category: SpanCategory;
  subject: string;
  /** §2.3 lineage; null for a workout. */
  lineage: Lineage | null;
  /** See `Span.support`; `legacyUnknown` for the ring's pre-§2.1 buckets. */
  support: string | null;
  startMs: number;
  /** Exclusive end; null when the duration is unknown (`legacyUnknown`); equal to `startMs` for a point. */
  endMs: number | null;
  /** Health Connect `last_modified`. */
  revMs: number | null;
  observedMs: number;
  receivedMs: number;
  ingestedMs: number;
  data: Record<string, unknown>;
}

export interface IntervalOptions extends PageOptions {
  /** Only this installation. */
  installationId?: string;
  /** `hc/record` only: one Health Connect record type. */
  recordType?: HcRecordType;
}

/** One current metric reading (`readMetricSamples`). */
export interface MetricSample {
  id: string;
  seq: number;
  installationId: string;
  category: string;
  kind: string;
  tMs: number;
  value: number | null;
  systolic: number | null;
  diastolic: number | null;
  unit: string | null;
  quality: string | null;
  provenance: string | null;
  deviceKey: string | null;
  firmware: string | null;
  /** The physical source: `ring:<device_key>`, or `ring:installation:<id>` for a row without one (every Gauge metric is ring-derived). */
  source: string;
}

export interface LumenStore {
  readonly file: string;
  /** Stores a batch in one transaction; malformed events are rejected one by one. */
  ingest(installationId: string, events: readonly unknown[], nowMs?: number): IngestResult;
  /** Records (or refreshes) an installation at pairing. */
  noteInstallation(id: string, o: { deviceName?: string; appVersion?: string; pairedAt: string; app?: InstallationApp }): void;
  /** Records that an installation unpaired (its token is revoked); an embedded one then stops superseding the standalone Gauge. */
  retireInstallation(id: string, atIso: string): void;
  status(): LumenStatus;
  installations(): InstallationRow[];
  /** Soft-deletes the copies Gauge 2.7.3's clock correction left (`./lumenDedupe.ts`); reversible with `undoDedupe`. */
  dedupe(o?: DedupeOptions): DedupeResult;
  /** Removes every `dedupe` deletion (or counts them, `dryRun`); the copies show again. */
  undoDedupe(o?: { dryRun?: boolean }): number;
  /**
   * The current events of a span category whose support overlaps `[fromMs, toMs)` (`start < to AND end > from`; a
   * point or a `legacyUnknown` row counts when `from ≤ start < to`), ordered by `(start, id)` and paged. Currentness
   * is the category's rule: `current_events` (per installation, category, subject and observed_at), `hc_records`
   * (latest revision minus tombstones) or `workout_sessions`. Page in one synchronous loop: an ingest between pages
   * can add rows before the cursor.
   */
  readIntervals(category: SpanCategory, fromMs: number, toMs: number, o?: IntervalOptions): Page<IntervalRow>;
  /** The current readings of one metric kind (`metric_series`) in `[fromMs, toMs)`, ordered by `(t, id)` and paged. */
  readMetricSamples(kind: string, fromMs: number, toMs: number, o?: PageOptions): Page<MetricSample>;
  /** (r067 AD-SERVER) The detection episodes and the queue ingest fills (`./detect/episodes.ts`). */
  readonly detections: DetectionStore;
  /** Read-only SQL over the views (the MCP tools' queries). */
  all<T>(sql: string, ...params: unknown[]): T[];
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  close(): void;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const NAME = /^[A-Za-z0-9._-]{1,128}$/;
/** A subject may carry its lineage and record id after colons (`phone_steps:<boot>:<ns>`, `Steps:<hc id>`, §2.1). */
const SUBJECT = /^[A-Za-z0-9._:-]{1,128}$/;
const CATEGORY = /^[a-z0-9_]+(?:\/[a-z0-9_-]+)?$/;
export const INSTALLATION_ID = /^[A-Za-z0-9-]{8,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000;
/** Gauge's short-video day (`habits/short_video`): subject and `data.date` are the phone's local date, counts per app. */
function shortVideoOk(subject: string, d: Record<string, unknown>): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subject);
  if (!m) return false;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.toISOString().slice(0, 10) !== subject) return false;
  if (d.date !== undefined && d.date !== subject) return false;
  const c = d.counts;
  if (!isObj(c) || Object.keys(c).length > 16 || !Object.entries(c).every(([k, v]) => /^[a-z0-9_]{1,32}$/.test(k) && count(v))) return false;
  return [d.limit, d.limit_hits, d.cancels].every((v) => v === undefined || v === null || count(v));
}

const MAX_WORKOUT_MS = 7 * 24 * 3_600_000;
const amount = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max);
const heartRate = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 20 && v <= 260);
const label = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && /^[\p{L}\p{N} _.:/()-]+$/u.test(v);
/**
 * A recorded workout (`activity/session`, `com.pulseloop.activity.session.v1`): subject = the session id; `start` ≤ `end`
 * (instants, at most 7 days apart); `type` and `source` short labels; `durationS` (moving time) up to the span; the
 * optional `distanceM`, `kcal`, `steps` non-negative, `avgHr` / `maxHr` 20–260 bpm, `zones` seconds per heart-rate zone
 * (`{ <zone>: s }`), `route` `{ polyline: <encoded polyline>, points: n }`.
 */
function workoutOk(type: string, d: Record<string, unknown>): boolean {
  if (type !== WORKOUT_TYPE) return false;
  const start = instantMs(d.start);
  const end = instantMs(d.end);
  if (start === null || end === null || end < start || end - start > MAX_WORKOUT_MS) return false;
  if (!label(d.type, 40) || !label(d.source, 64)) return false;
  if (typeof d.durationS !== 'number' || !amount(d.durationS, (end - start) / 1000 + 60)) return false;
  if (!amount(d.distanceM, 2_000_000) || !amount(d.kcal, 50_000) || !heartRate(d.avgHr) || !heartRate(d.maxHr)) return false;
  if (d.steps !== undefined && d.steps !== null && !count(d.steps)) return false;
  const z = d.zones;
  if (z !== undefined && z !== null && (!isObj(z) || Object.keys(z).length > 16 || !Object.entries(z).every(([k, v]) => /^[a-z0-9_]{1,32}$/.test(k) && amount(v, MAX_WORKOUT_MS / 1000)))) return false;
  const r = d.route;
  if (r !== undefined && r !== null && (!isObj(r) || typeof r.polyline !== 'string' || r.polyline.length > 256 * 1024 || !/^[\x3f-\x7e]*$/.test(r.polyline) || !count(r.points))) return false;
  // §2.1 additions (GA): pauses inside the session, moving time up to the span
  const p = d.pauses;
  if (p !== undefined && p !== null && (!Array.isArray(p) || p.length > 1000 || !p.every((x) => {
    const a = isObj(x) ? instantMs(x.start) : null;
    const b = isObj(x) ? instantMs(x.end) : null;
    return a !== null && b !== null && a <= b && a >= start - 60_000 && b <= end + 60_000;
  }))) return false;
  if (!amount(d.moving_s, (end - start) / 1000 + 60)) return false;
  return true;
}

// --- §2.1 evidence validators (energy SPEC §S1.4)

export const BUCKET_CATEGORY = 'activity/buckets';
export const BUCKET_TYPE = 'health.activity.bucket.observed';
export const PHONE_STEPS_CATEGORY = 'activity/phone_steps';
export const PHONE_STEPS_TYPE = 'com.pulseloop.activity.phone_steps.v1';
export const HC_RECORD_CATEGORY = 'hc/record';
export const HC_RECORD_TYPE = 'com.pulseloop.hc.record.v1';
export const HC_DELETED_CATEGORY = 'hc/deleted';
export const HC_DELETED_TYPE = 'com.pulseloop.hc.deleted.v1';
export const GPS_CATEGORY = 'activity/gps';
export const GPS_TYPE = 'com.pulseloop.activity.gps.v1';
export const GPS_MAX_POINTS = 500;
/** The Health Connect record types Gauge may upload (§2.1); anything else is `bad_hc_record`. */
export const HC_RECORD_TYPES = [
  'Steps', 'Distance', 'Speed', 'Power', 'HeartRate', 'ExerciseSession', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'BasalMetabolicRate', 'Weight', 'RestingHeartRate', 'SleepSession',
] as const;
export type HcRecordType = (typeof HC_RECORD_TYPES)[number];
const isHcType = (v: unknown): v is HcRecordType => typeof v === 'string' && (HC_RECORD_TYPES as readonly string[]).includes(v);

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v: unknown, lo: number, hi: number) => v === undefined || v === null || num(v, lo, hi);
const optInstant = (v: unknown) => v === undefined || v === null || instantMs(v) !== null;
/** A monotonic nanosecond counter: a non-negative integer, as a JSON number or (past 2^53) a digit string. */
const nanos = (v: unknown): bigint | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return BigInt(v);
  return null;
};

/**
 * Ring step detail (`activity/buckets`). The `ring_steps` subject (§2.1) needs `start`, `duration_s` ∈ {60, 600, 900},
 * `steps` and the matching `support`; the legacy `activity_bucket` rows carry none of them (their duration is unknown)
 * and only a stated `duration_s` is checked.
 */
function bucketOk(type: string, subject: string, d: Record<string, unknown>): boolean {
  if (type !== BUCKET_TYPE) return false;
  const dur = d.duration_s;
  const durOk = dur === 60 || dur === 600 || dur === 900;
  if (subject === LEGACY_BUCKET_SUBJECT) return dur === undefined || dur === null || durOk;
  if (subject !== RING_STEPS_SUBJECT || !durOk) return false;
  if (instantMs(d.start) === null || !count(d.steps) || !amount(d.distance_m, 100_000)) return false;
  if (d.support !== BUCKET_SUPPORT[dur]) return false;
  return (d.parent_total_steps === undefined || d.parent_total_steps === null || count(d.parent_total_steps)) && optInstant(d.parent_record_start);
}

/**
 * Phone steps (`activity/phone_steps`, §2.1, GB): `[start, end)` at most 7 days; a `minute` record lies inside one
 * minute; a `counterSpan` comes from counter timing; the subject is `phone_steps:<boot_id>:<m_start_ns>`. Cadence is
 * never a reason to reject (fusion flags it, §2.3 step 3).
 */
function phoneStepsOk(type: string, subject: string, d: Record<string, unknown>): boolean {
  if (type !== PHONE_STEPS_TYPE) return false;
  const start = instantMs(d.start);
  const end = instantMs(d.end);
  if (start === null || end === null || end <= start || end - start > MAX_SPAN_MS) return false;
  if (!count(d.steps) || (d.parent_steps !== undefined && d.parent_steps !== null && !count(d.parent_steps))) return false;
  if (d.timing !== 'detector' && d.timing !== 'counter') return false;
  if (d.support === 'minute') {
    if (end - start > 60_000 || Math.floor(start / 60_000) !== Math.floor((end - 1) / 60_000)) return false;
  } else if (d.support !== 'counterSpan' || d.timing !== 'counter') return false;
  if (typeof d.boot_id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(d.boot_id)) return false;
  const a = nanos(d.m_start_ns);
  const b = nanos(d.m_end_ns);
  if (a === null || b === null || b < a) return false;
  if (typeof d.utc_anchor_id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(d.utc_anchor_id)) return false;
  // the ns tail is not compared: a JSON number past 2^53 loses digits before it reaches here
  const prefix = `phone_steps:${d.boot_id}:`;
  return subject.startsWith(prefix) && /^\d{1,20}$/.test(subject.slice(prefix.length));
}

const MAX_SAMPLES = 20_000;
const samplesOk = (v: unknown, key: string, lo: number, hi: number) =>
  Array.isArray(v) && v.length <= MAX_SAMPLES && v.every((x) => isObj(x) && instantMs(x.t) !== null && num(x[key], lo, hi));
const PAYLOAD: Record<HcRecordType, (p: Record<string, unknown>) => boolean> = {
  Steps: (p) => count(p.count),
  Distance: (p) => num(p.m, 0, 1_000_000),
  Speed: (p) => samplesOk(p.samples, 'mps', 0, 200),
  Power: (p) => samplesOk(p.samples, 'w', 0, 5000),
  HeartRate: (p) => samplesOk(p.samples, 'bpm', 1, 300),
  ExerciseSession: (p) =>
    (Number.isInteger(p.exercise_type) || label(p.exercise_type, 64)) && (p.title === undefined || p.title === null || (typeof p.title === 'string' && p.title.length <= 200)) &&
    Array.isArray(p.segments) && p.segments.length <= 1000 && Array.isArray(p.laps) && p.laps.length <= 1000 &&
    (p.route_state === 'none' || p.route_state === 'available' || p.route_state === 'consentRequired'),
  ActiveCaloriesBurned: (p) => num(p.kcal, 0, 50_000),
  TotalCaloriesBurned: (p) => num(p.kcal, 0, 50_000),
  BasalMetabolicRate: (p) => num(p.kcal_per_day, 0, 20_000),
  Weight: (p) => num(p.kg, 1, 1000),
  RestingHeartRate: (p) => num(p.bpm, 1, 300),
  SleepSession: (p) => Array.isArray(p.stages) && p.stages.length <= 5000,
};
const hcSubjectOk = (subject: string, recordType: string) => subject.startsWith(`${recordType}:`) && /^[A-Za-z0-9._-]{1,100}$/.test(subject.slice(recordType.length + 1));

/**
 * A Health Connect record (`hc/record`, §2.1, GB): an allowed type whose subject is `<recordType>:<hc id>`, never
 * Gauge's own (`com.pulseloop`, or a `pl-` client id: `own_origin`), `[start, end]` at most 7 days, `last_modified`
 * (its revision order) and a payload of that type's shape.
 */
function hcRecordReason(type: string, subject: string, d: Record<string, unknown>): string | null {
  if (type !== HC_RECORD_TYPE) return 'bad_hc_record';
  if (d.origin_package === OWN_ORIGIN || (typeof d.client_record_id === 'string' && d.client_record_id.startsWith('pl-'))) return 'own_origin';
  if (!isHcType(d.record_type) || !hcSubjectOk(subject, d.record_type)) return 'bad_hc_record';
  if (typeof d.origin_package !== 'string' || !/^[A-Za-z0-9._]{1,255}$/.test(d.origin_package) || typeof d.origin_is_device_native !== 'boolean') return 'bad_hc_record';
  const dev = d.device;
  if (dev !== undefined && dev !== null && (!isObj(dev) || !(dev.type === undefined || dev.type === null || Number.isInteger(dev.type) || label(dev.type, 32)) ||
    ![dev.manufacturer, dev.model].every((v) => v === undefined || v === null || (typeof v === 'string' && v.length <= 128)))) return 'bad_hc_record';
  if (!(d.recording_method === undefined || d.recording_method === null || Number.isInteger(d.recording_method) || label(d.recording_method, 32))) return 'bad_hc_record';
  if (d.client_record_id !== undefined && d.client_record_id !== null && (typeof d.client_record_id !== 'string' || d.client_record_id.length > 256)) return 'bad_hc_record';
  const start = instantMs(d.start);
  const end = instantMs(d.end);
  if (instantMs(d.last_modified) === null || start === null || end === null || end < start || end - start > MAX_SPAN_MS) return 'bad_hc_record';
  if (d.zone_offsets !== undefined && d.zone_offsets !== null && typeof d.zone_offsets !== 'object') return 'bad_hc_record';
  return isObj(d.payload) && PAYLOAD[d.record_type](d.payload) ? null : 'bad_hc_record';
}

/** A Health Connect deletion (`hc/deleted`): the tombstone of `<recordType>:<hc id>`. */
function hcDeletedOk(type: string, subject: string, d: Record<string, unknown>): boolean {
  return type === HC_DELETED_TYPE && isHcType(d.record_type) && hcSubjectOk(subject, d.record_type);
}

/** A GPS chunk (`activity/gps`, §2.1, GA): subject `<session id>:<n>`, 1–500 points `{t, lat, lon, alt?, acc, speed?, accepted}`. */
function gpsOk(type: string, subject: string, d: Record<string, unknown>): boolean {
  if (type !== GPS_TYPE || !/^[A-Za-z0-9._-]{1,100}:\d{1,6}$/.test(subject)) return false;
  const pts = d.points;
  if (!Array.isArray(pts) || pts.length < 1 || pts.length > GPS_MAX_POINTS) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of pts) {
    if (!isObj(x)) return false;
    const t = instantMs(x.t);
    if (t === null || !num(x.lat, -90, 90) || !num(x.lon, -180, 180) || !optNum(x.alt, -1000, 10_000) || !num(x.acc, 0, 100_000) || !optNum(x.speed, 0, 200) || typeof x.accepted !== 'boolean') return false;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return hi - lo <= MAX_SPAN_MS;
}

// --- (r067 AD-SERVER) Android activity recognition (r065 autodetect CONTRACT §1)

export const AR_TRANSITION_CATEGORY = 'phone/activity_transition';
export const AR_ACQUISITION_CATEGORY = 'phone/activity_recognition_acquisition';
const AR_ACTIVITY = ['IN_VEHICLE', 'ON_BICYCLE', 'RUNNING', 'WALKING', 'STILL'];
const AR_STATES = ['listening', 'noPermission', 'unsupported', 'failed', 'stopped'];
const epochOk = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2_147_483_647;

/**
 * One Transition API event: subject = the activity, `transition` ENTER or EXIT, `occurred_at` (from elapsed realtime
 * through the boot anchor), `boot_id`, `elapsed_ns` as a decimal string, `registration_epoch`. The CloudEvent type is not
 * checked (Gauge names it); no confidence is expected or read.
 */
function transitionOk(subject: string, d: Record<string, unknown>): boolean {
  return AR_ACTIVITY.includes(String(d.activity)) && subject === d.activity && (d.transition === 'ENTER' || d.transition === 'EXIT') && instantMs(d.occurred_at) !== null &&
    typeof d.boot_id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(d.boot_id) && typeof d.elapsed_ns === 'string' && /^\d{1,20}$/.test(d.elapsed_ns) && epochOk(d.registration_epoch);
}

/** A recognition acquisition interval: `from` ≤ `to` (at most 7 days), its state, `registration_epoch`, optional `open`. */
function arAcquisitionOk(d: Record<string, unknown>): boolean {
  const a = instantMs(d.from);
  const b = instantMs(d.to);
  return a !== null && b !== null && b >= a && b - a <= MAX_SPAN_MS && AR_STATES.includes(String(d.state)) &&
    (d.registration_epoch === undefined || d.registration_epoch === null || epochOk(d.registration_epoch)) && (d.open === undefined || typeof d.open === 'boolean');
}

type Checked =
  | { ok: false; reason: string }
  | {
      ok: true;
      row: { id: string; type: string; category: string; subject: string; time: string; time_ms: number; observed_at: string; observed_ms: number; received_at: string; received_ms: number; data: string };
      /** The parsed `data` (the row holds it as JSON). */
      data: Record<string, unknown>;
      deletion?: { category: string; kind: string | null; from_ms: number | null; to_ms: number | null; at_ms: number };
    };

/** One CloudEvent from Lumen's mapper (`BroadcastEventMapper.kt`) plus the added `category` (its MQTT topic suffix). */
export function checkEvent(e: unknown, installationId: string): Checked {
  if (!isObj(e)) return { ok: false, reason: 'not_an_object' };
  if (e.specversion !== '1.0') return { ok: false, reason: 'bad_specversion' };
  if (typeof e.id !== 'string' || !ID.test(e.id)) return { ok: false, reason: 'bad_id' };
  if (typeof e.type !== 'string' || !NAME.test(e.type)) return { ok: false, reason: 'bad_type' };
  if (e.source !== `urn:pulseloop:installation:${installationId}`) return { ok: false, reason: 'source_mismatch' };
  if (typeof e.subject !== 'string' || !SUBJECT.test(e.subject)) return { ok: false, reason: 'bad_subject' };
  const time = instantMs(e.time);
  if (time === null) return { ok: false, reason: 'bad_time' };
  if (typeof e.category !== 'string' || e.category.length > 96 || !CATEGORY.test(e.category)) return { ok: false, reason: 'bad_category' };
  const d = e.data;
  if (!isObj(d) || d.schema_version !== 1) return { ok: false, reason: 'bad_data' };
  const observed = instantMs(d.observed_at);
  const received = instantMs(d.received_at);
  if (observed === null || received === null) return { ok: false, reason: 'bad_data_times' };
  const isDeletion = e.type === DELETION_TYPE;
  if (isDeletion !== (e.category === DELETION_CATEGORY)) return { ok: false, reason: 'deletion_category' };
  const row = {
    id: e.id, type: e.type, category: e.category, subject: e.subject, time: e.time as string, time_ms: time,
    observed_at: d.observed_at as string, observed_ms: observed, received_at: d.received_at as string, received_ms: received, data: JSON.stringify(d),
  };
  if (e.category === SHORT_VIDEO_CATEGORY && !shortVideoOk(e.subject, d)) return { ok: false, reason: 'bad_short_video' };
  if (e.category === WORKOUT_CATEGORY && !workoutOk(e.type, d)) return { ok: false, reason: 'bad_workout' };
  if (e.category === BUCKET_CATEGORY && !bucketOk(e.type, e.subject, d)) return { ok: false, reason: 'bad_bucket' };
  if (e.category === PHONE_STEPS_CATEGORY && !phoneStepsOk(e.type, e.subject, d)) return { ok: false, reason: 'bad_phone_steps' };
  if (e.category === HC_RECORD_CATEGORY) {
    const why = hcRecordReason(e.type, e.subject, d);
    if (why) return { ok: false, reason: why };
  }
  if (e.category === HC_DELETED_CATEGORY && !hcDeletedOk(e.type, e.subject, d)) return { ok: false, reason: 'bad_hc_record' };
  if (e.category === GPS_CATEGORY && !gpsOk(e.type, e.subject, d)) return { ok: false, reason: 'bad_gps' };
  if (e.category === AR_TRANSITION_CATEGORY && !transitionOk(e.subject, d)) return { ok: false, reason: 'bad_activity_transition' };
  if (e.category === AR_ACQUISITION_CATEGORY && !arAcquisitionOk(d)) return { ok: false, reason: 'bad_ar_acquisition' };
  if (!isDeletion) return { ok: true, row, data: d };
  const t = d.target;
  if (!isObj(t) || typeof t.category !== 'string' || (t.category !== '*' && (!CATEGORY.test(t.category) || t.category === DELETION_CATEGORY))) return { ok: false, reason: 'bad_target' };
  if (t.kind !== undefined && t.kind !== null && (typeof t.kind !== 'string' || !SUBJECT.test(t.kind))) return { ok: false, reason: 'bad_target' };
  const from = t.from === undefined || t.from === null ? null : instantMs(t.from);
  const to = t.to === undefined || t.to === null ? null : instantMs(t.to);
  if ((t.from != null && from === null) || (t.to != null && to === null)) return { ok: false, reason: 'bad_target_range' };
  // a range deletion names both ends; only "everything from this installation" may leave them out
  if (t.category !== '*' && (from === null || to === null)) return { ok: false, reason: 'bad_target_range' };
  if (from !== null && to !== null && from > to) return { ok: false, reason: 'bad_target_range' };
  return { ok: true, row, data: d, deletion: { category: t.category, kind: typeof t.kind === 'string' ? t.kind : null, from_ms: from, to_ms: to, at_ms: Math.max(observed, received) } };
}

// --- paging: an opaque cursor names the last row's (time, id) and the helper it came from

type After = [number, string];
const encodeCursor = (tag: string, a: After) => Buffer.from(JSON.stringify([tag, ...a])).toString('base64url');
function decodeCursor(tag: string, cursor: string): After {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 3 && v[0] === tag && Number.isSafeInteger(v[1]) && typeof v[2] === 'string' && ID.test(v[2])) return [v[1] as number, v[2]];
  } catch {
    // falls through
  }
  throw new LumenReadError('invalid_cursor', 'Not a cursor from this query.');
}
function pageArgs(tag: string, fromMs: number, toMs: number, o: PageOptions): { limit: number; after: After | null } {
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs > toMs) throw new LumenReadError('invalid_range', 'from and to are epoch milliseconds with from ≤ to.');
  const limit = o.limit ?? READ_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_MAX_LIMIT) throw new LumenReadError('invalid_limit', `limit is 1–${READ_MAX_LIMIT}.`);
  return { limit, after: o.cursor ? decodeCursor(tag, o.cursor) : null };
}
function page<R, T>(rows: R[], limit: number, key: (r: R) => After, tag: string, map: (r: R) => T): Page<T> {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  return { rows: kept.map(map), next: more ? encodeCursor(tag, key(kept[kept.length - 1]!)) : null };
}

export function openLumenStore(file: string): LumenStore {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 2000');
  migrateLumen(db);
  // rows an older server appended to a migrated file (and, the first time, every row) get their span; a file another
  // writer changed since the state was last kept gets its state rebuilt (one set-based pass)
  db.transaction(() => {
    backfillSpans(db);
    if (stateStale(db)) rebuildState(db);
  }).immediate();
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);

  const q = {
    insert: db.prepare(`INSERT OR IGNORE INTO events (id, type, category, subject, time, time_ms, observed_at, observed_ms, received_at, received_ms, last_received_ms, installation_id, data, ingested_at, ingested_ms)
      VALUES (@id, @type, @category, @subject, @time, @time_ms, @observed_at, @observed_ms, @received_at, @received_ms, @received_ms, @installation_id, @data, @ingested_at, @ingested_ms)`),
    // (r070) any installation's re-delivery counts: the event ids are the content's, so the Vitals app's engine re-sending what the standalone Gauge app stored (and later deleted) shows it again
    redelivered: db.prepare('UPDATE events SET last_received_ms = ? WHERE id = ? AND last_received_ms < ?'),
    deletion: db.prepare(`INSERT OR IGNORE INTO deletions (id, installation_id, category, kind, from_ms, to_ms, at_ms, observed_at, received_at, data, ingested_at)
      VALUES (@id, @installation_id, @category, @kind, @from_ms, @to_ms, @at_ms, @observed_at, @received_at, @data, @ingested_at)`),
    touch: db.prepare(`INSERT INTO installations (id, last_ingest_at) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET last_ingest_at = excluded.last_ingest_at`),
    note: db.prepare(`INSERT INTO installations (id, device_name, app_version, paired_at, app) VALUES (@id, @device_name, @app_version, @paired_at, @app)
      ON CONFLICT (id) DO UPDATE SET device_name = COALESCE(excluded.device_name, device_name), app_version = COALESCE(excluded.app_version, app_version), paired_at = excluded.paired_at,
        app = COALESCE(excluded.app, app), unpaired_at = NULL`),
    retire: db.prepare('UPDATE installations SET unpaired_at = ? WHERE id = ?'),
    installations: db.prepare<[], { id: string; device_name: string | null; app_version: string | null; paired_at: string | null; last_ingest_at: string | null; app: string | null; unpaired_at: string | null }>(
      'SELECT id, device_name, app_version, paired_at, last_ingest_at, app, unpaired_at FROM installations ORDER BY id'),
    counts: db.prepare<[], { category: string; n: number }>('SELECT category, COUNT(*) AS n FROM event_state WHERE hidden = 0 GROUP BY category ORDER BY category'),
    deletions: db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM deletions'),
    // every visible version group has its current row at the same instant, so the newest visible reading is the newest current one
    last: db.prepare<[], { ingested: string | null; observed: number | null }>(
      'SELECT (SELECT ingested_at FROM events ORDER BY ingested_ms DESC LIMIT 1) AS ingested, (SELECT MAX(observed_ms) FROM event_state WHERE current = 1) AS observed'),
  };

  const writeSpan = spanWriter(db);
  const state = stateWriter(db);
  const detections = createDetectionStore(db);
  // (r067) a Health Connect tombstone touches the record it retracts (every version's span, through the subject index)
  // (r070) a Health Connect record is the store's, not the installation's: every installation's versions of it
  const hcSpan = db.prepare<[string], { a: number | null; b: number | null }>(`SELECT MIN(s.start_ms) AS a, MAX(s.end_ms) AS b FROM events e JOIN event_spans s ON s.id = e.id
    WHERE e.subject = ? AND e.category = 'hc/record'`);
  const ingestTx = db.transaction((installationId: string, events: readonly unknown[], nowMs: number): IngestResult => {
    const at = new Date(nowMs).toISOString();
    const out: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };
    // (r067) the ranges detection must look at again, queued in this transaction
    const touched: Array<readonly [number, number]> = [];
    const touch = (row: { category: string; subject: string; observed_ms: number }, data: Record<string, unknown>, deletion?: { category: string; from_ms: number | null; to_ms: number | null }) => {
      const t = touchOf({ category: row.category, subject: row.subject, observedMs: row.observed_ms, data }, isSpanCategory(row.category) ? spanOf(row.category, row.subject, data, row.observed_ms) : null, deletion, nowMs);
      if (!t) return;
      if (Array.isArray(t)) touched.push(t as readonly [number, number]);
      else {
        const r = hcSpan.get((t as { hcSubject: string }).hcSubject);
        if (r?.a != null && r.b != null) touched.push([r.a, Math.max(r.b, r.a + 60_000)]);
      }
    };
    events.forEach((e, index) => {
      const c = checkEvent(e, installationId);
      if (!c.ok) {
        const id = isObj(e) && typeof e.id === 'string' ? e.id.slice(0, 128) : null;
        out.rejected.push({ id, index, reason: c.reason });
        return;
      }
      const ins = q.insert.run({ ...c.row, installation_id: installationId, ingested_at: at, ingested_ms: nowMs });
      const inserted = ins.changes > 0;
      if (!inserted) {
        if (q.redelivered.run(c.row.received_ms, c.row.id, c.row.received_ms).changes > 0) {
          state.redelivered(c.row.id);
          touch(c.row, c.data);
        }
        out.duplicates++;
        return;
      }
      writeSpan({ ...c.row, installation_id: installationId }, c.data);
      if (c.deletion) {
        const d = { id: c.row.id, installation_id: installationId, ...c.deletion, observed_at: c.row.observed_at, received_at: c.row.received_at, data: c.row.data, ingested_at: at };
        if (q.deletion.run(d).changes > 0) state.deletionAdded(d);
      } else {
        state.added({ seq: Number(ins.lastInsertRowid), installation_id: installationId, category: c.row.category, subject: c.row.subject, observed_ms: c.row.observed_ms }, c.row.received_ms, c.row.data, c.data.device_key);
      }
      touch(c.row, c.data, c.deletion);
      out.accepted++;
    });
    if (touched.length) detections.enqueue(mergeRanges(touched, nowMs), nowMs);
    state.mark();
    q.touch.run(installationId, at);
    return out;
  });

  // the current version of each record: a slot whose newest version is a copy goes whole (every version at that instant)
  const dedupeSelect = db.prepare<{ c: string }, DedupeRow>(`SELECT id, installation_id, category, subject, observed_ms, received_ms, data FROM current_events
    WHERE category = @c OR (category >= @c || '/' AND category < @c || '0') ORDER BY installation_id, category, subject, observed_ms`);
  const dedupeRows = (category: string) => dedupeSelect.all({ c: category });
  const exactDeletion = db.prepare(`INSERT OR IGNORE INTO deletions (id, installation_id, category, kind, from_ms, to_ms, at_ms, observed_at, received_at, data, ingested_at)
    VALUES (@id, @installation_id, @category, @kind, @at, @at, @at_ms, @now, @now, @data, @now)`);

  function dedupe(o: DedupeOptions = {}): DedupeResult {
    const categories = [...new Set(o.categories?.length ? o.categories : ['sleep/timeline'])];
    const bad = categories.filter((c) => !dedupeCategoryOk(c));
    if (bad.length) throw new Error(`Not a ring-history category: ${bad.join(', ')} (use ${DEDUPE_CATEGORIES.join(', ')} or metrics/<kind>).`);
    const nowMs = o.nowMs ?? Date.now();
    const now = new Date(nowMs).toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const sleepRows = dedupeRows('sleep/timeline');
      const installs = [...new Set(categories.flatMap((c) => dedupeRows(c).map((r) => r.installation_id)))].sort();
      const offsets: DedupeResult['offsets'] = installs.map((id) => {
        if (o.offsetMs !== undefined) return { installationId: id, offsetMs: o.offsetMs, source: o.offsetMs === null ? 'none' : 'given', twins: 0 };
        const inferred = inferClockOffset(sleepRows.filter((r) => r.installation_id === id));
        return inferred ? { installationId: id, offsetMs: inferred.offsetMs, source: 'inferred', twins: inferred.twins } : { installationId: id, offsetMs: null, source: 'none', twins: 0 };
      });
      const removals: Removal[] = [];
      for (const c of categories) {
        const rows = dedupeRows(c);
        for (const off of offsets) removals.push(...findDuplicates(rows.filter((r) => r.installation_id === off.installationId), off.offsetMs));
      }
      // one removal per event, even when two categories overlap (`metrics` and `metrics/hr`)
      const unique = [...new Map(removals.map((r) => [r.row.id, r])).values()].sort((a, b) => a.row.observed_ms - b.row.observed_ms);
      let written = 0;
      for (const r of unique) {
        const data = JSON.stringify({ source: 'vitals-server gauge dedupe', reason: r.reason, removed: r.row.id, kept: r.keptId, observed_at: now, received_at: now });
        written += exactDeletion.run({ id: `${DEDUPE_ID_PREFIX}${r.row.id}`, installation_id: r.row.installation_id, category: r.row.category, kind: r.row.subject, at: r.row.observed_ms, at_ms: nowMs, now, data }).changes;
      }
      // many deletions at once: one set-based pass
      if (written > 0) state.rebuild();
      o.inspect?.();
      db.exec(o.dryRun ? 'ROLLBACK' : 'COMMIT');
      return { offsets, removals: unique, written: o.dryRun ? 0 : written };
    } catch (e) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw e;
    }
  }

  const readIntervals = (category: SpanCategory, fromMs: number, toMs: number, o: IntervalOptions = {}): Page<IntervalRow> => {
    if (!isSpanCategory(category)) throw new LumenReadError('unknown_category', `Not a category with time support: ${String(category)}.`);
    const { limit, after } = pageArgs('i', fromMs, toMs, o);
    if (o.recordType !== undefined && (category !== HC_RECORD_CATEGORY || !isHcType(o.recordType))) throw new LumenReadError('invalid_kind', `recordType is a Health Connect record type, for hc/record only.`);
    const src = category === HC_RECORD_CATEGORY ? 'hc_records' : category === WORKOUT_CATEGORY ? 'workout_sessions' : 'current_spans';
    // only as far back as the category's longest stored span (a ring minute: one minute; never more than MAX_SPAN_MS)
    const back = spanMaxMs(db, category);
    const sql = `SELECT seq, id, installation_id, category, subject, lineage, support, start_ms, end_ms, rev_ms, observed_ms, received_ms, ingested_ms, data FROM ${src}
      WHERE category = @c AND start_ms >= @lo AND start_ms < @to AND MAX(COALESCE(end_ms, start_ms), start_ms + 1) > @from
        AND (start_ms > @cs OR (start_ms = @cs AND id > @cid))${o.installationId !== undefined ? ' AND installation_id = @inst' : ''}${o.recordType !== undefined ? " AND json_extract(data, '$.record_type') = @rt" : ''}
      ORDER BY start_ms, id LIMIT @n`;
    const rows = stmt(sql).all({
      c: category, from: fromMs, to: toMs, lo: Math.max(fromMs - back, after?.[0] ?? -Infinity), cs: after?.[0] ?? -1e15, cid: after?.[1] ?? '', n: limit + 1,
      ...(o.installationId !== undefined ? { inst: o.installationId } : {}), ...(o.recordType !== undefined ? { rt: o.recordType } : {}),
    }) as Array<{ seq: number; id: string; installation_id: string; category: SpanCategory; subject: string; lineage: Lineage | null; support: string | null; start_ms: number; end_ms: number | null; rev_ms: number | null; observed_ms: number; received_ms: number; ingested_ms: number; data: string }>;
    return page(rows, limit, (r) => [r.start_ms, r.id], 'i', (r) => ({
      id: r.id, seq: r.seq, installationId: r.installation_id, category: r.category, subject: r.subject, lineage: r.lineage, support: r.support,
      startMs: r.start_ms, endMs: r.support === LEGACY_SUPPORT ? null : r.end_ms ?? r.start_ms, revMs: r.rev_ms,
      observedMs: r.observed_ms, receivedMs: r.received_ms, ingestedMs: r.ingested_ms, data: JSON.parse(r.data) as Record<string, unknown>,
    }));
  };

  const readMetricSamples = (kind: string, fromMs: number, toMs: number, o: PageOptions = {}): Page<MetricSample> => {
    if (typeof kind !== 'string' || !NAME.test(kind)) throw new LumenReadError('invalid_kind', `Not a metric kind: ${String(kind)}.`);
    const { limit, after } = pageArgs('m', fromMs, toMs, o);
    const rows = stmt(`SELECT seq, id, installation_id, category, kind, observed_ms, value, systolic, diastolic, unit, quality, provenance, device_key, firmware FROM metric_series
      WHERE kind = @k AND observed_ms >= @lo AND observed_ms < @to AND (observed_ms > @cs OR (observed_ms = @cs AND id > @cid))
      ORDER BY observed_ms, id LIMIT @n`).all({ k: kind, lo: Math.max(fromMs, after?.[0] ?? -Infinity), to: toMs, cs: after?.[0] ?? -1e15, cid: after?.[1] ?? '', n: limit + 1 }) as Array<{
      seq: number; id: string; installation_id: string; category: string; kind: string; observed_ms: number; value: number | null; systolic: number | null; diastolic: number | null;
      unit: string | null; quality: string | null; provenance: string | null; device_key: string | null; firmware: string | null;
    }>;
    return page(rows, limit, (r) => [r.observed_ms, r.id], 'm', (r) => ({
      id: r.id, seq: r.seq, installationId: r.installation_id, category: r.category, kind: r.kind, tMs: r.observed_ms, value: r.value, systolic: r.systolic, diastolic: r.diastolic,
      unit: r.unit, quality: r.quality, provenance: r.provenance, deviceKey: r.device_key, firmware: r.firmware,
      source: r.device_key ? `ring:${r.device_key}` : `ring:installation:${r.installation_id}`,
    }));
  };

  const prepared = new Map<string, Database.Statement>();
  const stmt = (sql: string) => {
    let st = prepared.get(sql);
    if (!st) prepared.set(sql, (st = db.prepare(sql)));
    return st;
  };
  const installations = (): InstallationRow[] => {
    const rows = q.installations.all();
    // the embedded installation paired last and not unpaired supersedes every standalone Gauge installation
    const embedded = rows.filter((r) => r.app === 'vitals' && !r.unpaired_at).sort((a, b) => (b.paired_at ?? '').localeCompare(a.paired_at ?? '') || (a.id < b.id ? -1 : 1))[0];
    return rows.map((r) => {
      const app: InstallationApp = r.app === 'vitals' ? 'vitals' : 'gauge';
      const by = app === 'gauge' && !r.unpaired_at && embedded ? embedded.id : null;
      return {
        id: r.id, deviceName: r.device_name, appVersion: r.app_version, pairedAt: r.paired_at, lastIngestAt: r.last_ingest_at,
        app, unpairedAt: r.unpaired_at, status: r.unpaired_at ? 'unpaired' : by ? 'superseded' : 'active', supersededBy: by,
      };
    });
  };

  return {
    file,
    detections,
    ingest: (installationId, events, nowMs = Date.now()) => ingestTx(installationId, events, nowMs),
    noteInstallation(id, o) {
      q.note.run({ id, device_name: o.deviceName ?? null, app_version: o.appVersion ?? null, paired_at: o.pairedAt, app: o.app ?? null });
    },
    retireInstallation(id, atIso) {
      q.retire.run(atIso, id);
    },
    status() {
      const last = q.last.get();
      return {
        lastEventAt: last?.ingested ?? null,
        lastObservedAt: last?.observed != null ? new Date(last.observed).toISOString() : null,
        counts: Object.fromEntries(q.counts.all().map((r) => [r.category, r.n])),
        deletions: q.deletions.get()?.n ?? 0,
        installations: installations(),
      };
    },
    installations,
    readIntervals,
    readMetricSamples,
    dedupe,
    undoDedupe({ dryRun = false } = {}) {
      const like = `${DEDUPE_ID_PREFIX}%`;
      if (dryRun) return db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM deletions WHERE id LIKE ?').get(like)?.n ?? 0;
      return db.transaction(() => {
        const n = db.prepare('DELETE FROM deletions WHERE id LIKE ?').run(like).changes;
        if (n > 0) state.rebuild();
        return n;
      }).immediate();
    },
    all: <T>(sql: string, ...params: unknown[]) => stmt(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: unknown[]) => stmt(sql).get(...params) as T | undefined,
    close() {
      if (db.open) db.close();
    },
  };
}
