/**
 * Test events in the exact envelope Lumen Health's `BroadcastEventMapper.kt` builds (plus the added `category`, its
 * MQTT topic suffix), with the same deterministic id rule: `pl-` + the first 40 hex of SHA-256 over
 * `type|subject|observed_at|data-without-received_at`.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { checkEvent } from './lumenStore.ts';

/** Lumen's own installation id: its MQTT id, 32 lowercase hex (a UUID without dashes). */
export const INSTALL = '6f1d2c3b4a594e8f9d0123456789abcd';
/** A dashed UUID is accepted too. */
export const OTHER_INSTALL = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

export interface LumenTestEvent {
  specversion: '1.0';
  id: string;
  type: string;
  source: string;
  subject: string;
  time: string;
  datacontenttype: 'application/json';
  category: string;
  data: Record<string, unknown> & { schema_version: 1; observed_at: string; received_at: string };
}

export function lumenEvent(category: string, subject: string, type: string, observedAt: string, values: Record<string, unknown>, o: { receivedAt?: string; install?: string } = {}): LumenTestEvent {
  const identity = { schema_version: 1, observed_at: observedAt, ...values };
  const id = `pl-${createHash('sha256').update(`${type}|${subject}|${observedAt}|${JSON.stringify(identity)}`).digest('hex').slice(0, 40)}`;
  return {
    specversion: '1.0', id, type, source: `urn:pulseloop:installation:${o.install ?? INSTALL}`, subject, time: observedAt, datacontenttype: 'application/json', category,
    data: { schema_version: 1, observed_at: observedAt, received_at: o.receivedAt ?? observedAt, ...values },
  };
}

type O = { receivedAt?: string; install?: string };
export const hr = (at: string, bpm: number, o: O = {}) =>
  lumenEvent('metrics/hr', 'hr', 'health.metric.observed', at, { metric: 'hr', value: bpm, unit: 'bpm', provenance: 'device_history', quality: 'unverified', replayed: true }, o);
export const metric = (kind: string, unit: string, at: string, value: number, o: O = {}) =>
  lumenEvent(`metrics/${kind}`, kind, 'health.metric.observed', at, { metric: kind, value, unit, provenance: 'device_live', quality: 'unverified' }, o);
export const bloodPressure = (at: string, systolic: number, diastolic: number, o: O = {}) =>
  lumenEvent('metrics/blood_pressure', 'blood_pressure', 'health.metric.observed', at, { systolic, diastolic, unit: 'mmHg', provenance: 'device_estimate', replayed: false }, o);
export const activityDaily = (at: string, steps: number, o: O = {}) =>
  lumenEvent('activity/daily', 'daily_activity', 'health.activity.updated', at, {
    steps, distance_m: steps * 0.7, calories_kcal: steps * 0.04, calories_provenance: 'device_estimate', calories_energy_basis: 'unspecified_by_device', active_minutes: Math.round(steps / 100), provenance: 'device_reported',
  }, o);
export const activityBucket = (at: string, steps: number, o: O = {}) =>
  lumenEvent('activity/buckets', 'activity_bucket', 'health.activity.bucket.observed', at, { steps, distance_m: steps * 0.7, provenance: 'device_history', replayed: true }, o);
export const sleepPacket = (at: string, stages: string[], o: O & { complete?: boolean } = {}) =>
  lumenEvent('sleep/timeline', 'sleep_timeline', 'health.sleep.timeline.updated', at, { sample_interval_minutes: 1, complete_session: o.complete ?? false, stages, provenance: 'device_classified', replayed: true }, o);
export const insight = (key: string, at: string, value: number, unit = 'score', o: O = {}) =>
  lumenEvent(`insights/${key}`, key, 'health.insight.updated', at, { insight: key, value, unit, confidence: 'medium', algorithm_version: `lumen-${key}-v1`, inputs: { duration_min: 420 }, note: null, provenance: 'locally_derived' }, o);
export const battery = (at: string, percent: number, o: O = {}) => lumenEvent('state/battery', 'battery', 'health.device.battery.updated', at, { percent }, o);
export const wear = (at: string, worn: boolean, o: O = {}) => lumenEvent('state/wear', 'wear_state', 'health.device.wear_state.updated', at, { worn }, o);
export const deletion = (at: string, target: Record<string, unknown>, o: O = {}) =>
  lumenEvent('deletion', 'deletion', 'com.pulseloop.deletion.v1', at, { target }, o);
/** Gauge's short-video day: one event per local date, a newer one supersedes it (its id changes with its values). */
export const shortVideo = (date: string, at: string, counts: Record<string, number>, v: { limit?: number; limitHits?: number; cancels?: number } = {}, o: O = {}) =>
  lumenEvent('habits/short_video', date, 'com.pulseloop.habits.short_video.v1', at, { date, counts, limit: v.limit ?? 20, limit_hits: v.limitHits ?? 0, cancels: v.cancels ?? 0 }, o);
/** A workout Gauge recorded (`activity/session`): subject = the session id; a later version supersedes it. */
export const workout = (session: string, at: string, values: Record<string, unknown> = {}, o: O = {}) =>
  lumenEvent('activity/session', session, 'com.pulseloop.activity.session.v1', at, {
    start: '2026-10-20T00:30:00Z', end: '2026-10-20T01:15:00Z', type: 'run', source: 'gauge_gps', durationS: 2580, distanceM: 6120.4, kcal: 412.6,
    avgHr: 148.2, maxHr: 171, zones: { rest: 0, fat_burn: 300, cardio: 1500, peak: 720, max: 60 }, steps: 6900, route: { polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', points: 3 },
    ...values,
  }, o);

// --- §2.1 evidence (energy SPEC; GA ring, GB phone and Health Connect), until GA/GB's HubE2eFixtureTest carries it

/** The ring identity fields every ring-derived event gains (§2.1). */
export const RING_ID = { device_key: '0123456789abcdef', device_model: 'JStyle 2301', firmware: '2301.1.0.7', decoder_version: 'gauge-2301/2', local_offset_min: 330 };
/** The ring's minute detail (subject `ring_steps`); a 600 s `tenMinuteFallback` or a 900 s `quarterHour` by `durationS`. */
export const ringSteps = (start: string, steps: number, v: { durationS?: 60 | 600 | 900; parentTotal?: number; parentStart?: string } = {}, o: O = {}) => {
  const durationS = v.durationS ?? 60;
  const support = { 60: 'minute', 600: 'tenMinuteFallback', 900: 'quarterHour' }[durationS];
  return lumenEvent('activity/buckets', 'ring_steps', 'health.activity.bucket.observed', start, {
    start, duration_s: durationS, steps, distance_m: steps * 0.7, support, parent_total_steps: v.parentTotal ?? steps, parent_record_start: v.parentStart ?? start, ...RING_ID, provenance: 'device_history',
  }, o);
};
export const BOOT_ID = '3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c';
const BOOT_AT = Date.parse('2026-10-01T00:00:00Z');
/** Phone steps over `[start, end)` (`minute` from detector timing by default; a longer span is a `counterSpan`). */
export const phoneSteps = (start: string, end: string, steps: number, v: { support?: 'minute' | 'counterSpan'; timing?: 'detector' | 'counter'; parentSteps?: number } = {}, o: O = {}) => {
  const support = v.support ?? (Date.parse(end) - Date.parse(start) <= 60_000 ? 'minute' : 'counterSpan');
  const ns = (iso: string) => String(BigInt(Date.parse(iso) - BOOT_AT) * 1_000_000n);
  return lumenEvent('activity/phone_steps', `phone_steps:${BOOT_ID}:${ns(start)}`, 'com.pulseloop.activity.phone_steps.v1', end, {
    start, end, steps, support, timing: v.timing ?? (support === 'minute' ? 'detector' : 'counter'), ...(v.parentSteps !== undefined ? { parent_steps: v.parentSteps } : {}),
    boot_id: BOOT_ID, m_start_ns: ns(start), m_end_ns: ns(end), utc_anchor_id: 'anchor-1',
  }, o);
};
export const phoneAcquisition = (from: string, to: string, state: 'listening' | 'stopped' | 'noSensor' | 'noPermission', o: O = {}) =>
  lumenEvent('phone/acquisition', 'phone_acquisition', 'com.pulseloop.phone.acquisition.v1', to, { from, to, state }, o);
/** A Health Connect record (subject `<recordType>:<id>`); observed at its `last_modified`. */
export const hcRecord = (recordType: string, hcId: string, start: string, end: string, payload: Record<string, unknown>, v: {
  origin?: string; native?: boolean; device?: Record<string, unknown> | null; lastModified?: string; clientRecordId?: string;
} = {}, o: O = {}) => {
  const lastModified = v.lastModified ?? end;
  return lumenEvent('hc/record', `${recordType}:${hcId}`, 'com.pulseloop.hc.record.v1', lastModified, {
    record_type: recordType, origin_package: v.origin ?? 'android', origin_is_device_native: v.native ?? true, device: v.device === undefined ? { type: 2, manufacturer: 'Google', model: 'Pixel 8' } : v.device,
    recording_method: 2, ...(v.clientRecordId !== undefined ? { client_record_id: v.clientRecordId } : {}), last_modified: lastModified, start, end, zone_offsets: { start: 19800, end: 19800 }, payload,
  }, o);
};
export const hcDeleted = (recordType: string, hcId: string, at: string, o: O = {}) =>
  lumenEvent('hc/deleted', `${recordType}:${hcId}`, 'com.pulseloop.hc.deleted.v1', at, { record_type: recordType }, o);
export const gpsChunk = (session: string, n: number, points: Array<{ t: string; lat: number; lon: number; acc?: number; accepted?: boolean }>, o: O = {}) =>
  lumenEvent('activity/gps', `${session}:${n}`, 'com.pulseloop.activity.gps.v1', points[points.length - 1]!.t, { points: points.map((p) => ({ acc: 5, accepted: true, ...p })) }, o);
export const sportTelemetry = (t: string, stepsCum: number, kcalCum: number, bpm: number, o: O = {}) =>
  lumenEvent('activity/sport_telemetry', 'sport_telemetry', 'com.pulseloop.activity.sport_telemetry.v1', t, { t, steps_cum: stepsCum, kcal_cum_vendor: kcalCum, bpm, ...RING_ID }, o);

// --- today's lumen.db (schema version 0), to test the migration on a file as the live server left it

/** The schema the server created on open before energy SPEC §S1 (`CREATE … IF NOT EXISTS`, no `user_version`). Frozen. */
export const LEGACY_SCHEMA_V0 = `
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

  CREATE VIEW IF NOT EXISTS visible_events AS
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
  CREATE VIEW IF NOT EXISTS current_events AS
    SELECT * FROM (
      SELECT v.*, ROW_NUMBER() OVER (
        PARTITION BY v.category, v.subject, v.observed_ms
        ORDER BY v.received_ms DESC, v.ingested_ms DESC, v.seq DESC
      ) AS version_rank
      FROM visible_events v
    ) WHERE version_rank = 1;
  CREATE VIEW IF NOT EXISTS metric_series AS
    SELECT id, installation_id, category, subject AS kind, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.systolic') AS systolic, json_extract(data, '$.diastolic') AS diastolic,
      json_extract(data, '$.unit') AS unit, json_extract(data, '$.provenance') AS provenance, json_extract(data, '$.quality') AS quality
    FROM current_events WHERE substr(category, 1, 8) = 'metrics/' OR substr(category, 1, 7) = 'vendor/';
  CREATE VIEW IF NOT EXISTS daily_activity AS
    SELECT id, installation_id, observed_ms, ingested_ms,
      json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m,
      json_extract(data, '$.calories_kcal') AS calories_kcal, json_extract(data, '$.active_minutes') AS active_minutes,
      json_extract(data, '$.provenance') AS provenance
    FROM current_events WHERE category = 'activity/daily';
  CREATE VIEW IF NOT EXISTS activity_buckets AS
    SELECT id, installation_id, observed_ms, ingested_ms, json_extract(data, '$.steps') AS steps, json_extract(data, '$.distance_m') AS distance_m
    FROM current_events WHERE category = 'activity/buckets';
  CREATE VIEW IF NOT EXISTS sleep_timeline AS
    SELECT id, seq, installation_id, observed_ms, received_ms, ingested_ms,
      json_extract(data, '$.stages') AS stages, json_extract(data, '$.sample_interval_minutes') AS interval_minutes,
      json_extract(data, '$.complete_session') AS complete_session
    FROM current_events WHERE category = 'sleep/timeline';
  CREATE VIEW IF NOT EXISTS insights AS
    SELECT id, installation_id, subject AS key, observed_ms, ingested_ms,
      json_extract(data, '$.value') AS value, json_extract(data, '$.unit') AS unit, json_extract(data, '$.confidence') AS confidence,
      json_extract(data, '$.algorithm_version') AS algorithm_version, json_extract(data, '$.note') AS note, json_extract(data, '$.inputs') AS inputs
    FROM current_events WHERE substr(category, 1, 9) = 'insights/';
  CREATE VIEW IF NOT EXISTS device_state AS
    SELECT * FROM (
      SELECT id, installation_id, category, type, observed_ms, ingested_ms, data,
        ROW_NUMBER() OVER (PARTITION BY installation_id, category ORDER BY observed_ms DESC, received_ms DESC, seq DESC) AS state_rank
      FROM visible_events WHERE substr(category, 1, 6) = 'state/'
    ) WHERE state_rank = 1;
  -- one row per local date (the subject): the newest version, whatever its observed_at (the counts grow through the day)
  CREATE VIEW IF NOT EXISTS short_video_days AS
    SELECT * FROM (
      SELECT id, seq, installation_id, subject AS date, observed_ms, received_ms, ingested_ms,
        json_extract(data, '$.counts') AS counts, json_extract(data, '$.limit') AS daily_limit,
        json_extract(data, '$.limit_hits') AS limit_hits, json_extract(data, '$.cancels') AS cancels,
        ROW_NUMBER() OVER (PARTITION BY subject ORDER BY received_ms DESC, ingested_ms DESC, seq DESC) AS day_rank
      FROM visible_events WHERE category = 'habits/short_video'
    ) WHERE day_rank = 1;
  -- one row per recorded workout (the subject is its session id): the newest version, whatever its observed_at; ranked
  -- over every version, so a deleted newest version hides the session rather than bringing an older one back
  CREATE VIEW IF NOT EXISTS workout_sessions AS
    SELECT w.id, w.seq, w.installation_id, w.subject AS session_id, w.observed_ms, w.received_ms, w.ingested_ms, w.data
    FROM (
      SELECT e.rowid AS seq, e.*, ROW_NUMBER() OVER (PARTITION BY e.subject ORDER BY e.received_ms DESC, e.ingested_ms DESC, e.rowid DESC) AS session_rank
      FROM events e WHERE e.category = 'activity/session'
    ) w
    WHERE w.session_rank = 1 AND EXISTS (SELECT 1 FROM visible_events v WHERE v.id = w.id);
`;

/** Writes events into a version-0 file exactly as the pre-§S1 ingest did (no spans, no migration). */
export function writeLegacyDb(file: string, batches: ReadonlyArray<{ installationId: string; events: readonly unknown[]; nowMs: number }>): void {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(LEGACY_SCHEMA_V0);
  const insert = db.prepare(`INSERT OR IGNORE INTO events (id, type, category, subject, time, time_ms, observed_at, observed_ms, received_at, received_ms, last_received_ms, installation_id, data, ingested_at, ingested_ms)
    VALUES (@id, @type, @category, @subject, @time, @time_ms, @observed_at, @observed_ms, @received_at, @received_ms, @received_ms, @installation_id, @data, @ingested_at, @ingested_ms)`);
  const redelivered = db.prepare('UPDATE events SET last_received_ms = ? WHERE id = ? AND installation_id = ? AND last_received_ms < ?');
  const deletion = db.prepare(`INSERT OR IGNORE INTO deletions (id, installation_id, category, kind, from_ms, to_ms, at_ms, observed_at, received_at, data, ingested_at)
    VALUES (@id, @installation_id, @category, @kind, @from_ms, @to_ms, @at_ms, @observed_at, @received_at, @data, @ingested_at)`);
  db.transaction(() => {
    for (const b of batches) {
      const at = new Date(b.nowMs).toISOString();
      db.prepare('INSERT INTO installations (id, last_ingest_at) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET last_ingest_at = excluded.last_ingest_at').run(b.installationId, at);
      for (const e of b.events) {
        const c = checkEvent(e, b.installationId);
        if (!c.ok) continue;
        if (insert.run({ ...c.row, installation_id: b.installationId, ingested_at: at, ingested_ms: b.nowMs }).changes === 0) {
          redelivered.run(c.row.received_ms, c.row.id, b.installationId, c.row.received_ms);
          continue;
        }
        if (c.deletion) deletion.run({ id: c.row.id, installation_id: b.installationId, ...c.deletion, observed_at: c.row.observed_at, received_at: c.row.received_at, data: c.row.data, ingested_at: at });
      }
    }
  })();
  db.close();
}
