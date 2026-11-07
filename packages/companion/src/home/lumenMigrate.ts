/**
 * The schema of `lumen.db` (`./lumenStore.ts`) and its migrations (energy SPEC §S1).
 *
 * - `PRAGMA user_version` names the applied step. Steps run in order, each in its own `BEGIN IMMEDIATE` transaction
 *   that re-reads the version first, so two processes opening one file never apply a step twice. Each step is also
 *   idempotent by itself (`IF NOT EXISTS`, `INSERT OR IGNORE`, `DROP VIEW IF EXISTS` + `CREATE VIEW`): re-running one
 *   changes nothing.
 * - No step ever rewrites `events` (raw and append-only). Derived facts that SQL cannot compute well (an instant in a
 *   JSON string, a record's lineage) live in `event_spans`, one row per event of a span-bearing category, written at
 *   ingest and back-filled here for the rows already stored.
 * - Version 0 is the schema the server shipped before §S1 (no `user_version`; `CREATE … IF NOT EXISTS` on open). Step 1
 *   is that schema's tables exactly, so on a live file it does nothing.
 * - A file whose `user_version` is newer than this code is refused rather than written with an older idea of it.
 */
import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { rebuildState } from './lumenState.ts';

/** An ISO 8601 instant with a zone (`Z` or an offset), as Gauge's `Instant.toString()` writes it. */
export const instantMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// --- spans: the support of one event, computed once in JS

/** No span is longer: the validators enforce it, so an overlap query only looks this far back from its window. */
export const MAX_SPAN_MS = 7 * 24 * 3_600_000;
/** The ring's minute-detail subject (§2.1); the legacy `activity_bucket` rows stay beside it, read as lineage `ring`. */
export const RING_STEPS_SUBJECT = 'ring_steps';
export const LEGACY_BUCKET_SUBJECT = 'activity_bucket';
export const BUCKET_SUPPORT = { 60: 'minute', 600: 'tenMinuteFallback', 900: 'quarterHour' } as const;
export const LEGACY_SUPPORT = 'legacyUnknown';
/** Gauge's own package: its Health Connect exports are never ingested (§2.1). */
export const OWN_ORIGIN = 'com.pulseloop';
export const FIT_ORIGIN = 'com.google.android.apps.fitness';

/** The categories with a time support, i.e. a row in `event_spans` and a place in `readIntervals`. */
export const SPAN_CATEGORIES = [
  'activity/buckets', 'activity/phone_steps', 'activity/sport_telemetry', 'activity/gps', 'activity/session', 'phone/acquisition', 'hc/record', 'sleep/timeline',
  // (r067 AD-SERVER, schema version 5) Android activity recognition: transitions (a point at `occurred_at`) and the
  // recognition acquisition intervals (`from`..`to`, support = the state)
  'phone/activity_transition', 'phone/activity_recognition_acquisition',
] as const;
export type SpanCategory = (typeof SPAN_CATEGORIES)[number];
export const isSpanCategory = (c: string): c is SpanCategory => (SPAN_CATEGORIES as readonly string[]).includes(c);

/** §2.3 lineage classes; `null` for an event that is not step evidence (a workout). */
export type Lineage = 'ring' | 'phone' | `hc-other:${string}` | 'unknown';

export interface Span {
  lineage: Lineage | null;
  /** `minute | tenMinuteFallback | quarterHour | legacyUnknown` (ring), `minute | counterSpan` (phone), the acquisition state, else null. */
  support: string | null;
  startMs: number;
  /** Equal to `startMs` for a point (telemetry) or an unknown duration (`legacyUnknown`). */
  endMs: number;
  /** A Health Connect record's `last_modified`: its revision order. */
  revMs: number | null;
}

/** A Health Connect device type the phone: HC's `Device.TYPE_PHONE` (2) or its name. */
const phoneDevice = (d: unknown) => isObj(d) && (d.type === 2 || d.type === 'phone' || d.type === 'TYPE_PHONE');

/**
 * The lineage of a Health Connect record (§2.3): the phone's own recorder, and Fit's steps from the phone, are the
 * `phone` lineage (one sensor, never independent of the direct counter); any other origin is `hc-other:<origin>`.
 */
export function hcLineage(d: Record<string, unknown>): Lineage {
  const origin = typeof d.origin_package === 'string' && d.origin_package ? d.origin_package : null;
  if (d.origin_is_device_native === true) return 'phone';
  if (origin === FIT_ORIGIN && phoneDevice(d.device)) return 'phone';
  return origin ? `hc-other:${origin}` : 'unknown';
}

const point = (lineage: Lineage | null, ms: number, support: string | null = null): Span => ({ lineage, support, startMs: ms, endMs: ms, revMs: null });
const range = (lineage: Lineage | null, a: unknown, b: unknown, support: string | null = null): Span | null => {
  const s = instantMs(a);
  const e = instantMs(b);
  return s === null || e === null || e < s ? null : { lineage, support, startMs: s, endMs: e, revMs: null };
};

/** The support of one stored event, or null when its category has none (or its data names none). */
export function spanOf(category: string, subject: string, data: Record<string, unknown>, observedMs: number): Span | null {
  switch (category) {
    case 'activity/buckets': {
      const start = instantMs(data.start) ?? observedMs;
      const dur = data.duration_s;
      const known = subject !== LEGACY_BUCKET_SUBJECT && (dur === 60 || dur === 600 || dur === 900);
      if (!known) return point('ring', start, LEGACY_SUPPORT);
      return { lineage: 'ring', support: typeof data.support === 'string' ? data.support : BUCKET_SUPPORT[dur], startMs: start, endMs: start + dur * 1000, revMs: null };
    }
    case 'activity/phone_steps':
      return range('phone', data.start, data.end, typeof data.support === 'string' ? data.support : null);
    case 'phone/acquisition':
      return range('phone', data.from, data.to, typeof data.state === 'string' ? data.state : null);
    case 'phone/activity_transition':
      // the event's own occurrence (elapsed realtime through the boot anchor), never the callback's arrival
      return point('phone', instantMs(data.occurred_at) ?? observedMs, typeof data.transition === 'string' ? data.transition : null);
    case 'phone/activity_recognition_acquisition':
      return range('phone', data.from, data.to, typeof data.state === 'string' ? data.state : null);
    case 'activity/sport_telemetry':
      return point('ring', instantMs(data.t) ?? observedMs);
    case 'activity/gps': {
      const ts = Array.isArray(data.points) ? data.points.map((p) => (isObj(p) ? instantMs(p.t) : null)).filter((t): t is number => t !== null) : [];
      return ts.length ? { lineage: 'phone', support: null, startMs: Math.min(...ts), endMs: Math.max(...ts), revMs: null } : point('phone', observedMs);
    }
    case 'activity/session':
      return range(null, data.start, data.end);
    case 'hc/record': {
      const s = range(hcLineage(data), data.start, data.end);
      return s && { ...s, revMs: instantMs(data.last_modified) };
    }
    case 'sleep/timeline': {
      const n = Array.isArray(data.stages) ? data.stages.length : 0;
      // `stages` is sampled every `sample_interval_minutes`; `native_epoch_s` only records the ring's own resolution.
      const minutes = typeof data.sample_interval_minutes === 'number' && data.sample_interval_minutes > 0 ? data.sample_interval_minutes : 1;
      return { lineage: 'ring', support: null, startMs: observedMs, endMs: observedMs + n * minutes * 60_000, revMs: null };
    }
    default:
      return null;
  }
}

interface SpanSource { id: string; installation_id: string; category: string; subject: string; observed_ms: number; data: string }

/** The `event_spans` row of one event (`INSERT OR IGNORE`: a span never changes once written). */
export function spanWriter(db: Database.Database) {
  const insert = db.prepare(`INSERT OR IGNORE INTO event_spans (id, installation_id, category, subject, observed_ms, lineage, support, start_ms, end_ms, rev_ms)
    VALUES (@id, @installation_id, @category, @subject, @observed_ms, @lineage, @support, @start_ms, @end_ms, @rev_ms)`);
  // the longest span of each category so far (`spanMaxMs`): an overlap read looks back only that far (version 4)
  const longest = db.prepare(`INSERT INTO lumen_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value)`);
  return (e: SpanSource, data?: Record<string, unknown>): boolean => {
    if (!isSpanCategory(e.category)) return false;
    let d = data;
    if (!d) {
      try {
        const parsed = JSON.parse(e.data) as unknown;
        if (!isObj(parsed)) return false;
        d = parsed;
      } catch {
        return false;
      }
    }
    const s = spanOf(e.category, e.subject, d, e.observed_ms);
    if (!s) return false;
    const wrote = insert.run({ id: e.id, installation_id: e.installation_id, category: e.category, subject: e.subject, observed_ms: e.observed_ms,
      lineage: s.lineage, support: s.support, start_ms: s.startMs, end_ms: s.endMs, rev_ms: s.revMs }).changes > 0;
    if (wrote) longest.run(SPAN_MAX_PREFIX + e.category, s.endMs - s.startMs);
    return wrote;
  };
}

const SPANS_MARK = 'spans_rowid';
/** `lumen_meta` key prefix of a category's longest span (ms), kept from version 4 on. */
export const SPAN_MAX_PREFIX = 'span_max:';

/** How far before a window an overlap read of `category` must look: its longest stored span, at most `MAX_SPAN_MS`. */
export function spanMaxMs(db: Database.Database, category: string): number {
  const v = (db.prepare('SELECT value FROM lumen_meta WHERE key = ?').get(SPAN_MAX_PREFIX + category) as { value: unknown } | undefined)?.value;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, MAX_SPAN_MS) : MAX_SPAN_MS;
}
const BACKFILL_CHUNK = 5000;

/**
 * Writes the missing `event_spans` rows for events stored after `lumen_meta.spans_rowid` (all of them the first time),
 * then moves the mark to the last event. Events are append-only, so the rowid only grows: this also repairs rows an
 * older server wrote into a migrated file. Returns the rows written.
 */
export function backfillSpans(db: Database.Database): number {
  const mark = (db.prepare('SELECT value FROM lumen_meta WHERE key = ?').get(SPANS_MARK) as { value: number } | undefined)?.value ?? 0;
  const last = (db.prepare('SELECT MAX(rowid) AS m FROM events').get() as { m: number | null }).m ?? 0;
  if (last <= mark) return 0;
  const write = spanWriter(db);
  const cats = SPAN_CATEGORIES.map(() => '?').join(', ');
  // in rowid chunks (a statement cannot write while another iterates)
  const rows = db.prepare(`SELECT e.rowid AS seq, e.id, e.installation_id, e.category, e.subject, e.observed_ms, e.data FROM events e
    WHERE e.rowid > ? AND e.rowid <= ? AND e.category IN (${cats}) AND NOT EXISTS (SELECT 1 FROM event_spans s WHERE s.id = e.id)`);
  let n = 0;
  for (let lo = mark; lo < last; lo += BACKFILL_CHUNK) {
    for (const r of rows.all(lo, Math.min(lo + BACKFILL_CHUNK, last), ...SPAN_CATEGORIES) as SpanSource[]) if (write(r)) n++;
  }
  db.prepare('INSERT INTO lumen_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SPANS_MARK, last);
  return n;
}

// --- the steps

/** Version 0's tables, exactly as the server created them before §S1. */
const TABLES_V1 = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    time TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    observed_ms INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    received_ms INTEGER NOT NULL,
    -- the latest delivery of this id (a re-sent duplicate can carry a newer received_at; the stored data never changes)
    last_received_ms INTEGER NOT NULL,
    installation_id TEXT NOT NULL,
    data TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    ingested_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_category_observed ON events (category, observed_ms);
  CREATE INDEX IF NOT EXISTS events_subject_observed ON events (subject, observed_ms);
  CREATE TABLE IF NOT EXISTS deletions (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    category TEXT NOT NULL,
    kind TEXT,
    from_ms INTEGER,
    to_ms INTEGER,
    at_ms INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    data TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deletions_installation ON deletions (installation_id, category);
  CREATE TABLE IF NOT EXISTS installations (
    id TEXT PRIMARY KEY,
    device_name TEXT,
    app_version TEXT,
    paired_at TEXT,
    last_ingest_at TEXT
  );
`;

const SPANS_V2 = `
  -- one row per event of a span-bearing category (SPAN_CATEGORIES); never updated (events never change)
  CREATE TABLE IF NOT EXISTS event_spans (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    observed_ms INTEGER NOT NULL,
    lineage TEXT,
    support TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    rev_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS event_spans_category_start ON event_spans (category, start_ms);
  CREATE TABLE IF NOT EXISTS lumen_meta (key TEXT PRIMARY KEY, value);
`;

/** Every view, dropped and recreated by each step that changes one (a view holds no data). */
export const VIEW_NAMES = [
  'visible_events', 'current_events', 'current_spans', 'metric_series', 'daily_activity', 'activity_buckets', 'sleep_timeline', 'insights', 'device_state',
  'short_video_days', 'workout_sessions', 'ring_step_intervals', 'phone_step_intervals', 'hc_records', 'sport_telemetry', 'gps_points', 'acquisition',
  'hc_deleted_records', 'activity_transitions', 'ar_acquisition',
] as const;

const j = (path: string, as = path.replace(/^.*\./, '')) => `json_extract(data, '$.${path}') AS ${as}`;
const RING_IDENTITY = [j('device_key'), j('device_model'), j('firmware'), j('decoder_version'), j('local_offset_min')].join(', ');

/** Version 3's views (exported for the v4 equivalence tests: `./lumenState.test.ts`). */
export const VIEWS_V3 = `
  CREATE VIEW visible_events AS
    SELECT e.rowid AS seq, e.* FROM events e
    WHERE e.category <> 'deletion' AND NOT EXISTS (
      SELECT 1 FROM deletions d
      WHERE d.installation_id = e.installation_id
        AND e.last_received_ms < d.at_ms
        AND (d.category = '*' OR d.category = e.category OR substr(e.category, 1, length(d.category) + 1) = d.category || '/')
        AND (d.kind IS NULL OR d.kind = e.subject OR d.kind = json_extract(e.data, '$.metric'))
        AND (d.from_ms IS NULL OR e.observed_ms >= d.from_ms)
        AND (d.to_ms IS NULL OR e.observed_ms <= d.to_ms)
    );
  -- source-aware: one installation's versions never replace another's, and the subject carries the lineage (§2.1)
  CREATE VIEW current_events AS
    SELECT * FROM (
      SELECT v.*, ROW_NUMBER() OVER (
        PARTITION BY v.installation_id, v.category, v.subject, v.observed_ms
        ORDER BY v.received_ms DESC, v.ingested_ms DESC, v.seq DESC
      ) AS version_rank
      FROM visible_events v
    ) WHERE version_rank = 1;
  -- the current_events rule, driven from event_spans (an overlap query reads its (category, start_ms) index): a visible
  -- event with no newer visible version in its (installation, category, subject, observed_at)
  CREATE VIEW current_spans AS
    SELECT v.seq, v.id, v.type, s.installation_id, s.category, s.subject, v.time_ms, s.observed_ms, v.received_ms, v.last_received_ms, v.ingested_ms, v.data,
      s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms
    FROM event_spans s JOIN visible_events v ON v.id = s.id
    WHERE NOT EXISTS (
      SELECT 1 FROM visible_events w
      WHERE w.subject = s.subject AND w.observed_ms = s.observed_ms AND w.category = s.category AND w.installation_id = s.installation_id
        AND (w.received_ms, w.ingested_ms, w.seq) > (v.received_ms, v.ingested_ms, v.seq)
    );
  CREATE VIEW metric_series AS
    SELECT id, installation_id, category, subject AS kind, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.systolic') AS systolic, json_extract(data, '$.diastolic') AS diastolic,
      json_extract(data, '$.unit') AS unit, json_extract(data, '$.provenance') AS provenance, json_extract(data, '$.quality') AS quality,
      seq, received_ms, ${j('device_key')}, ${j('firmware')}
    FROM current_events WHERE substr(category, 1, 8) = 'metrics/' OR substr(category, 1, 7) = 'vendor/';
  CREATE VIEW daily_activity AS
    SELECT id, installation_id, observed_ms, ingested_ms,
      json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m,
      json_extract(data, '$.calories_kcal') AS calories_kcal, json_extract(data, '$.active_minutes') AS active_minutes,
      json_extract(data, '$.provenance') AS provenance,
      seq, subject, received_ms, ${j('device_key')}, ${j('firmware')}
    FROM current_events WHERE category = 'activity/daily';
  -- the legacy ring buckets only (subject activity_bucket, duration unknown), as the pre-§S1 tools read them; the
  -- ring's minute detail (subject ring_steps) is read through ring_step_intervals, so the two are never summed here
  CREATE VIEW activity_buckets AS
    SELECT id, installation_id, observed_ms, ingested_ms, json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m
    FROM current_events WHERE category = 'activity/buckets' AND subject = '${LEGACY_BUCKET_SUBJECT}';
  CREATE VIEW sleep_timeline AS
    SELECT id, seq, installation_id, observed_ms, received_ms, ingested_ms,
      json_extract(data, '$.stages') AS stages, json_extract(data, '$.sample_interval_minutes') AS interval_minutes,
      json_extract(data, '$.complete_session') AS complete_session,
      ${j('native_epoch_s')}, ${j('stage_codes_raw')}, ${RING_IDENTITY}
    FROM current_events WHERE category = 'sleep/timeline';
  CREATE VIEW insights AS
    SELECT id, installation_id, subject AS key, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.unit') AS unit, json_extract(data, '$.confidence') AS confidence,
      json_extract(data, '$.algorithm_version') AS algorithm_version, json_extract(data, '$.note') AS note, json_extract(data, '$.inputs') AS inputs
    FROM current_events WHERE substr(category, 1, 9) = 'insights/';
  CREATE VIEW device_state AS
    SELECT * FROM (
      SELECT id, installation_id, category, type, observed_ms, ingested_ms, data,
        ROW_NUMBER() OVER (PARTITION BY installation_id, category ORDER BY observed_ms DESC, received_ms DESC, seq DESC) AS state_rank
      FROM visible_events WHERE substr(category, 1, 6) = 'state/'
    ) WHERE state_rank = 1;
  -- one row per local date (the subject): the newest version, whatever its observed_at (the counts grow through the day)
  CREATE VIEW short_video_days AS
    SELECT * FROM (
      SELECT id, seq, installation_id, subject AS date, observed_ms, received_ms, ingested_ms,
        json_extract(data, '$.counts') AS counts, json_extract(data, '$.limit') AS daily_limit,
        json_extract(data, '$.limit_hits') AS limit_hits, json_extract(data, '$.cancels') AS cancels,
        ROW_NUMBER() OVER (PARTITION BY subject ORDER BY received_ms DESC, ingested_ms DESC, seq DESC) AS day_rank
      FROM visible_events WHERE category = 'habits/short_video'
    ) WHERE day_rank = 1;
  -- one row per recorded workout (installation, session id): the newest version, whatever its observed_at; ranked over
  -- every version, so a deleted newest version hides the session rather than bringing an older one back
  CREATE VIEW workout_sessions AS
    SELECT w.id, w.seq, w.installation_id, w.subject AS session_id, w.observed_ms, w.received_ms, w.ingested_ms, w.data,
      w.category, w.subject, s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms
    FROM (
      SELECT e.rowid AS seq, e.*, ROW_NUMBER() OVER (PARTITION BY e.installation_id, e.subject ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC) AS session_rank
      FROM events e WHERE e.category = 'activity/session'
    ) w
    LEFT JOIN event_spans s ON s.id = w.id
    WHERE w.session_rank = 1 AND EXISTS (SELECT 1 FROM visible_events v WHERE v.id = w.id);
  -- ring step evidence from both subjects; a legacy row's duration is unknown (support legacyUnknown, end and duration null)
  CREATE VIEW ring_step_intervals AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms,
      CASE WHEN support = '${LEGACY_SUPPORT}' THEN NULL ELSE end_ms END AS end_ms,
      CASE WHEN support = '${LEGACY_SUPPORT}' THEN NULL ELSE json_extract(data, '$.duration_s') END AS duration_s,
      ${j('steps')}, ${j('distance_m')}, support, ${j('parent_total_steps')}, ${j('parent_record_start')}, ${RING_IDENTITY}, lineage, data
    FROM current_spans WHERE category = 'activity/buckets';
  CREATE VIEW phone_step_intervals AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms, end_ms,
      ${j('steps')}, support, ${j('timing')}, ${j('parent_steps')}, ${j('boot_id')}, ${j('m_start_ns')}, ${j('m_end_ns')}, ${j('utc_anchor_id')}, lineage, data
    FROM current_spans WHERE category = 'activity/phone_steps';
  -- one row per Health Connect record (installation, <recordType>:<id>): the latest revision (last_modified, then
  -- received_at, then ingest order) among the visible versions, unless a tombstone at or after that revision exists
  CREATE VIEW hc_records AS
    SELECT v.seq, v.id, s.installation_id, s.category, s.subject, s.observed_ms, v.received_ms, v.ingested_ms,
      s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms,
      json_extract(v.data, '$.record_type') AS record_type, json_extract(v.data, '$.origin_package') AS origin_package,
      json_extract(v.data, '$.origin_is_device_native') AS origin_is_device_native, json_extract(v.data, '$.device') AS device,
      json_extract(v.data, '$.recording_method') AS recording_method, json_extract(v.data, '$.client_record_id') AS client_record_id,
      json_extract(v.data, '$.last_modified') AS last_modified, json_extract(v.data, '$.zone_offsets') AS zone_offsets,
      json_extract(v.data, '$.payload') AS payload, v.data
    FROM event_spans s JOIN visible_events v ON v.id = s.id
    WHERE s.category = 'hc/record'
      AND NOT EXISTS (
        SELECT 1 FROM visible_events w JOIN event_spans ws ON ws.id = w.id
        WHERE w.subject = s.subject AND w.category = 'hc/record' AND w.installation_id = s.installation_id
          AND (COALESCE(ws.rev_ms, 0), w.received_ms, w.ingested_ms, w.seq) > (COALESCE(s.rev_ms, 0), v.received_ms, v.ingested_ms, v.seq)
      )
      AND NOT EXISTS (
        SELECT 1 FROM visible_events t
        WHERE t.subject = s.subject AND t.category = 'hc/deleted' AND t.installation_id = s.installation_id AND t.observed_ms >= COALESCE(s.rev_ms, 0)
      );
  CREATE VIEW sport_telemetry AS
    SELECT id, seq, installation_id, observed_ms, received_ms, ingested_ms, start_ms AS t_ms,
      ${j('steps_cum')}, ${j('kcal_cum_vendor')}, ${j('bpm')}, ${RING_IDENTITY}, lineage, data
    FROM current_spans WHERE category = 'activity/sport_telemetry';
  -- one row per GPS point of the current chunks (subject <session id>:<chunk n>)
  CREATE VIEW gps_points AS
    SELECT c.id AS chunk_id, c.installation_id, substr(c.subject, 1, instr(c.subject, ':') - 1) AS session_id,
      CAST(substr(c.subject, instr(c.subject, ':') + 1) AS INTEGER) AS chunk, CAST(p.key AS INTEGER) AS idx,
      json_extract(p.value, '$.t') AS t, CAST(round((julianday(json_extract(p.value, '$.t')) - 2440587.5) * 86400000.0) AS INTEGER) AS t_ms,
      json_extract(p.value, '$.lat') AS lat, json_extract(p.value, '$.lon') AS lon, json_extract(p.value, '$.alt') AS alt,
      json_extract(p.value, '$.acc') AS acc, json_extract(p.value, '$.speed') AS speed, json_extract(p.value, '$.accepted') AS accepted
    FROM current_spans c, json_each(c.data, '$.points') p WHERE c.category = 'activity/gps';
  CREATE VIEW acquisition AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms, end_ms, support AS state, lineage, data
    FROM current_spans WHERE category = 'phone/acquisition';
`;

/**
 * Version 4 (r063 SRV): the same views over the materialised `event_state` (`./lumenState.ts`): visibility and
 * currentness are looked up, never recomputed per read, and every filter the readers pass lands on an index. The column
 * lists are version 3's, in order. Category groups are ranges (`>= 'metrics/' AND < 'metrics0'`), which an index can
 * read, instead of `substr`.
 */
const EVENT_COLS = (st: string) =>
  `e.rowid AS seq, e.id, e.type, ${st}.category, ${st}.subject, e.time, e.time_ms, e.observed_at, ${st}.observed_ms, e.received_at, e.received_ms, e.last_received_ms, ${st}.installation_id, e.data, e.ingested_at, e.ingested_ms`;
const group = (g: string) => `(category >= '${g}/' AND category < '${g}0')`;
const VIEWS_V4 = `
  CREATE VIEW visible_events AS
    SELECT ${EVENT_COLS('st')} FROM event_state st JOIN events e ON e.rowid = st.seq WHERE st.hidden = 0;
  CREATE VIEW current_events AS
    SELECT ${EVENT_COLS('st')}, 1 AS version_rank FROM event_state st JOIN events e ON e.rowid = st.seq WHERE st.current = 1;
  CREATE VIEW current_spans AS
    SELECT e.rowid AS seq, e.id, e.type, s.installation_id, s.category, s.subject, e.time_ms, s.observed_ms, e.received_ms, e.last_received_ms, e.ingested_ms, e.data,
      s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms
    FROM event_spans s JOIN events e ON e.id = s.id JOIN event_state st ON st.seq = e.rowid
    WHERE st.current = 1;
  CREATE VIEW metric_series AS
    SELECT id, installation_id, category, subject AS kind, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.systolic') AS systolic, json_extract(data, '$.diastolic') AS diastolic,
      json_extract(data, '$.unit') AS unit, json_extract(data, '$.provenance') AS provenance, json_extract(data, '$.quality') AS quality,
      seq, received_ms, ${j('device_key')}, ${j('firmware')}
    FROM current_events WHERE ${group('metrics')} OR ${group('vendor')};
  CREATE VIEW daily_activity AS
    SELECT id, installation_id, observed_ms, ingested_ms,
      json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m,
      json_extract(data, '$.calories_kcal') AS calories_kcal, json_extract(data, '$.active_minutes') AS active_minutes,
      json_extract(data, '$.provenance') AS provenance,
      seq, subject, received_ms, ${j('device_key')}, ${j('firmware')}
    FROM current_events WHERE category = 'activity/daily';
  CREATE VIEW activity_buckets AS
    SELECT id, installation_id, observed_ms, ingested_ms, json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m
    FROM current_events WHERE category = 'activity/buckets' AND subject = '${LEGACY_BUCKET_SUBJECT}';
  CREATE VIEW sleep_timeline AS
    SELECT id, seq, installation_id, observed_ms, received_ms, ingested_ms,
      json_extract(data, '$.stages') AS stages, json_extract(data, '$.sample_interval_minutes') AS interval_minutes,
      json_extract(data, '$.complete_session') AS complete_session,
      ${j('native_epoch_s')}, ${j('stage_codes_raw')}, ${RING_IDENTITY}
    FROM current_events WHERE category = 'sleep/timeline';
  CREATE VIEW insights AS
    SELECT id, installation_id, subject AS key, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.unit') AS unit, json_extract(data, '$.confidence') AS confidence,
      json_extract(data, '$.algorithm_version') AS algorithm_version, json_extract(data, '$.note') AS note, json_extract(data, '$.inputs') AS inputs
    FROM current_events WHERE ${group('insights')};
  CREATE VIEW device_state AS
    SELECT * FROM (
      SELECT id, installation_id, category, type, observed_ms, ingested_ms, data,
        ROW_NUMBER() OVER (PARTITION BY installation_id, category ORDER BY observed_ms DESC, received_ms DESC, seq DESC) AS state_rank
      FROM visible_events WHERE ${group('state')}
    ) WHERE state_rank = 1;
  CREATE VIEW short_video_days AS
    SELECT * FROM (
      SELECT id, seq, installation_id, subject AS date, observed_ms, received_ms, ingested_ms,
        json_extract(data, '$.counts') AS counts, json_extract(data, '$.limit') AS daily_limit,
        json_extract(data, '$.limit_hits') AS limit_hits, json_extract(data, '$.cancels') AS cancels,
        ROW_NUMBER() OVER (PARTITION BY subject ORDER BY received_ms DESC, ingested_ms DESC, seq DESC) AS day_rank
      FROM visible_events WHERE category = 'habits/short_video'
    ) WHERE day_rank = 1;
  -- event_state.latest: the newest version of the session among every version, and visible
  CREATE VIEW workout_sessions AS
    SELECT e.id, e.rowid AS seq, st.installation_id, st.subject AS session_id, st.observed_ms, e.received_ms, e.ingested_ms, e.data,
      st.category, st.subject, s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms
    FROM event_state st JOIN events e ON e.rowid = st.seq LEFT JOIN event_spans s ON s.id = e.id
    WHERE st.category = 'activity/session' AND st.latest = 1;
  CREATE VIEW ring_step_intervals AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms,
      CASE WHEN support = '${LEGACY_SUPPORT}' THEN NULL ELSE end_ms END AS end_ms,
      CASE WHEN support = '${LEGACY_SUPPORT}' THEN NULL ELSE json_extract(data, '$.duration_s') END AS duration_s,
      ${j('steps')}, ${j('distance_m')}, support, ${j('parent_total_steps')}, ${j('parent_record_start')}, ${RING_IDENTITY}, lineage, data
    FROM current_spans WHERE category = 'activity/buckets';
  CREATE VIEW phone_step_intervals AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms, end_ms,
      ${j('steps')}, support, ${j('timing')}, ${j('parent_steps')}, ${j('boot_id')}, ${j('m_start_ns')}, ${j('m_end_ns')}, ${j('utc_anchor_id')}, lineage, data
    FROM current_spans WHERE category = 'activity/phone_steps';
  -- event_state.latest: the latest revision among the visible versions, no tombstone at or after it
  CREATE VIEW hc_records AS
    SELECT e.rowid AS seq, e.id, s.installation_id, s.category, s.subject, s.observed_ms, e.received_ms, e.ingested_ms,
      s.lineage, s.support, s.start_ms, s.end_ms, s.rev_ms,
      json_extract(e.data, '$.record_type') AS record_type, json_extract(e.data, '$.origin_package') AS origin_package,
      json_extract(e.data, '$.origin_is_device_native') AS origin_is_device_native, json_extract(e.data, '$.device') AS device,
      json_extract(e.data, '$.recording_method') AS recording_method, json_extract(e.data, '$.client_record_id') AS client_record_id,
      json_extract(e.data, '$.last_modified') AS last_modified, json_extract(e.data, '$.zone_offsets') AS zone_offsets,
      json_extract(e.data, '$.payload') AS payload, e.data
    FROM event_spans s JOIN events e ON e.id = s.id JOIN event_state st ON st.seq = e.rowid
    WHERE s.category = 'hc/record' AND st.latest = 1;
  -- the Health Connect records whose latest revision a tombstone retracted (gauge_hc's deleted list)
  CREATE VIEW hc_deleted_records AS
    SELECT e.rowid AS seq, e.id, s.installation_id, s.category, s.subject, s.observed_ms, s.start_ms, s.end_ms, s.rev_ms,
      json_extract(e.data, '$.record_type') AS record_type, json_extract(e.data, '$.origin_package') AS origin_package,
      (SELECT MIN(t.observed_ms) FROM event_state t WHERE t.scope = st.scope AND t.category = 'hc/deleted' AND t.subject = st.subject
        AND t.hidden = 0 AND t.observed_ms >= COALESCE(s.rev_ms, 0)) AS deleted_ms
    FROM event_state st JOIN events e ON e.rowid = st.seq JOIN event_spans s ON s.id = e.id
    WHERE st.category = 'hc/record' AND st.retracted = 1;
  CREATE VIEW sport_telemetry AS
    SELECT id, seq, installation_id, observed_ms, received_ms, ingested_ms, start_ms AS t_ms,
      ${j('steps_cum')}, ${j('kcal_cum_vendor')}, ${j('bpm')}, ${RING_IDENTITY}, lineage, data
    FROM current_spans WHERE category = 'activity/sport_telemetry';
  CREATE VIEW gps_points AS
    SELECT c.id AS chunk_id, c.installation_id, substr(c.subject, 1, instr(c.subject, ':') - 1) AS session_id,
      CAST(substr(c.subject, instr(c.subject, ':') + 1) AS INTEGER) AS chunk, CAST(p.key AS INTEGER) AS idx,
      json_extract(p.value, '$.t') AS t, CAST(round((julianday(json_extract(p.value, '$.t')) - 2440587.5) * 86400000.0) AS INTEGER) AS t_ms,
      json_extract(p.value, '$.lat') AS lat, json_extract(p.value, '$.lon') AS lon, json_extract(p.value, '$.alt') AS alt,
      json_extract(p.value, '$.acc') AS acc, json_extract(p.value, '$.speed') AS speed, json_extract(p.value, '$.accepted') AS accepted
    FROM current_spans c, json_each(c.data, '$.points') p WHERE c.category = 'activity/gps';
  CREATE VIEW acquisition AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms, end_ms, support AS state, lineage, data
    FROM current_spans WHERE category = 'phone/acquisition';
`;

/**
 * Version 5 (r067 AD-SERVER): the activity-recognition views, over the same materialised currentness (`current_spans`:
 * `event_state.current`). A transition's version group is (installation, category, activity, occurred_at); an
 * acquisition interval's is (installation, category, subject, from), so a re-sent or re-closed interval replaces the
 * earlier version under the newest-received rule, like `phone/acquisition`'s open checkpoint (`open: true`).
 */
const VIEWS_V5_EXTRA = `
  CREATE VIEW activity_transitions AS
    SELECT id, seq, installation_id, subject AS activity, observed_ms, received_ms, ingested_ms, start_ms AS occurred_ms, support AS transition,
      ${j('boot_id')}, ${j('elapsed_ns')}, ${j('registration_epoch')}, lineage, data
    FROM current_spans WHERE category = 'phone/activity_transition';
  CREATE VIEW ar_acquisition AS
    SELECT id, seq, installation_id, subject, observed_ms, received_ms, ingested_ms, start_ms, end_ms, support AS state,
      ${j('registration_epoch')}, ${j('open')}, lineage, data
    FROM current_spans WHERE category = 'phone/activity_recognition_acquisition';
`;

/** Auto-detection's tables (`./detect/episodes.ts`): the persisted episodes and the queue of ranges to (re)detect. */
export const DETECTION_TABLES_V5 = `
  CREATE TABLE IF NOT EXISTS detection_episodes (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    -- the store-wide order of every write (the route's cursor); unique, only grows
    change_seq INTEGER NOT NULL,
    state TEXT NOT NULL,
    family TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    label TEXT NOT NULL,
    -- the public episode as the route answers it (JSON)
    doc TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS detection_episodes_seq ON detection_episodes (change_seq);
  CREATE INDEX IF NOT EXISTS detection_episodes_start ON detection_episodes (start_ms);
  CREATE TABLE IF NOT EXISTS detection_queue (
    id INTEGER PRIMARY KEY,
    from_ms INTEGER NOT NULL,
    to_ms INTEGER NOT NULL,
    queued_ms INTEGER NOT NULL
  );
`;
/** How far back detection runs (and what the migration queues once): older evidence is never detected. */
export const DETECT_HORIZON_MS = 35 * 24 * 3_600_000;
/** What the migration (and an empty store's first open) queues: the last 30 days. */
export const DETECT_BACKLOG_MS = 30 * 24 * 3_600_000;

/**
 * Step 5: the detection tables, the activity-recognition views, the spans of recognition events an older server stored
 * without them (it did not know the categories), and the last 30 days queued for detection. Idempotent: re-run after a
 * rollback to version 4 (which keeps the tables) it only fills what is missing and queues the backlog again.
 */
function detection(db: Database.Database): void {
  db.exec(DETECTION_TABLES_V5);
  const write = spanWriter(db);
  const rows = db.prepare(`SELECT e.id, e.installation_id, e.category, e.subject, e.observed_ms, e.data FROM events e INDEXED BY events_category_observed
    WHERE e.category IN ('phone/activity_transition', 'phone/activity_recognition_acquisition') AND NOT EXISTS (SELECT 1 FROM event_spans s WHERE s.id = e.id)`).all() as SpanSource[];
  for (const r of rows) write(r);
  for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
  db.exec(VIEWS_V4 + VIEWS_V5_EXTRA);
  const last = (db.prepare('SELECT MAX(observed_ms) AS m FROM events').get() as { m: number | null }).m;
  const to = Math.max(Date.now(), last ?? 0);
  db.prepare('INSERT INTO detection_queue (from_ms, to_ms, queued_ms) VALUES (?, ?, ?)').run(to - DETECT_BACKLOG_MS, to, Date.now());
  // the route's cursor epoch: a restored or recreated table gets a new one, so a client's old cursor resyncs
  db.prepare("INSERT OR IGNORE INTO lumen_meta (key, value) VALUES ('detect_epoch', ?)").run(randomBytes(6).toString('hex'));
}

/**
 * Drops what the 2026-10-28 emergency hotfix put on the live file by hand (`hotfix_*` tables, triggers, views and
 * indexes): version 4 replaces it. Views are recreated after this by the step.
 */
export function dropHotfix(db: Database.Database): string[] {
  const rows = db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'hotfix\\_%' ESCAPE '\\' AND type IN ('trigger', 'view', 'index', 'table') ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END").all() as Array<{ type: string; name: string }>;
  for (const r of rows) db.exec(`DROP ${r.type.toUpperCase()} IF EXISTS "${r.name.replace(/"/g, '""')}"`);
  return rows.map((r) => `${r.type} ${r.name}`);
}

/** Step 4: the hotfix gone, `event_state` built in one set-based pass, the spans' longest lengths, the views. */
function materialise(db: Database.Database): void {
  dropHotfix(db);
  for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
  rebuildState(db);
  db.exec(`INSERT INTO lumen_meta (key, value) SELECT '${SPAN_MAX_PREFIX}' || category, MAX(end_ms - start_ms) FROM event_spans GROUP BY category
    ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value)`);
  db.exec(VIEWS_V4);
}

/**
 * Step 6 (r070): every version group is kept per source, not per installation (`./lumenState.ts` `scopeOf`): the state
 * is rebuilt with its `scope`, and an installation says which app it is (`app`: `gauge`, or `vitals` for the Gauge
 * engine built into the Vitals app) and whether it unpaired. Older servers refuse the file afterwards (restore a
 * backup to go back). Idempotent.
 */
function scopeAndApp(db: Database.Database): void {
  const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
  const st = cols('event_state');
  if (!st.has('scope')) db.exec("ALTER TABLE event_state ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
  if (!st.has('inst_current')) db.exec('ALTER TABLE event_state ADD COLUMN inst_current INTEGER NOT NULL DEFAULT 0');
  const inst = cols('installations');
  if (!inst.has('app')) db.exec('ALTER TABLE installations ADD COLUMN app TEXT');
  if (!inst.has('unpaired_at')) db.exec('ALTER TABLE installations ADD COLUMN unpaired_at TEXT');
  for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
  rebuildState(db);
  db.exec(VIEWS_V4 + VIEWS_V5_EXTRA);
}

export interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
}

const views = (sql: string) => (db: Database.Database) => {
  for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
  db.exec(sql);
};

/** Ordered; append only. A step that changes a view recreates them all. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'tables', up: (db) => db.exec(TABLES_V1) },
  { version: 2, name: 'event spans (back-filled)', up: (db) => { db.exec(SPANS_V2); backfillSpans(db); } },
  { version: 3, name: 'source-aware views', up: views(VIEWS_V3) },
  { version: 4, name: 'materialised visibility and currentness', up: materialise },
  { version: 5, name: 'detection episodes and activity recognition', up: detection },
  { version: 6, name: 'sources shared across installations, installation roles', up: scopeAndApp },
];
export const LUMEN_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
}

const userVersion = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;

/** Brings the file to `LUMEN_SCHEMA_VERSION`; throws (writing nothing) when it is already newer. */
export function migrateLumen(db: Database.Database, steps: readonly Migration[] = MIGRATIONS): MigrateResult {
  const from = userVersion(db);
  const latest = steps[steps.length - 1]?.version ?? 0;
  if (from > latest) throw new Error(`lumen.db schema version ${from} is newer than this server's (${latest}); upgrade the server.`);
  const applied: string[] = [];
  for (const step of steps) {
    db.transaction(() => {
      if (userVersion(db) >= step.version) return;
      step.up(db);
      db.pragma(`user_version = ${step.version}`);
      applied.push(step.name);
    }).immediate();
  }
  return { from, to: userVersion(db), applied };
}
