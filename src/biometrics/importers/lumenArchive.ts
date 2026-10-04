/**
 * Lumen Health "Export All Data" importer (the `PulseArchive` JSON, format v1), channel 'file:lumen_archive'. R16 §4 path B:
 * the one-time history import before Live Data Broadcast is switched on. Field names follow the owner's Android source
 * `data/DataArchive.kt` (DTOs) and `data/entity/*.kt` (Room entities).
 *
 * Reads only:
 * - `measurements` minus `measurementDeletions` (by measurement id, else by kind + timestamp): HEART_RATE -> hr, SPO2 -> spo2,
 *   TEMPERATURE -> skin_temp, HRV -> 'hrv' flagged 'hrv_vendor_defined', RESPIRATORY_RATE -> resp_rate; STRESS, FATIGUE,
 *   blood-pressure and blood-sugar estimates -> `vendor:<key>` series; VO2MAX -> daily vo2max {method:'vendor_estimate'}.
 *   `sourceRaw` history/vendor_history -> origin 'history', live -> 'live', spot -> 'spot'; 'demo' and 'mock' rows are
 *   Lumen's sample data and are skipped.
 * - `activityDaily` -> one daily record per local date (steps, distance, `active_min.moderate` = the ring's exercise
 *   minutes, as scores/android/adapter.ts expects for the 2301; calories have no stated basis and stay in vendor_state).
 * - `activityBuckets` -> steps/distance 'sum' series.
 * - `sleepSessions` + `sleepStageBlocks` -> one sleep record per session (stages from the blocks; time no block covers is
 *   left out, never filled); the session's Lumen score -> daily.vendor.sleep.
 * - `activitySessions` (finished workouts only) -> workout records with avg/max HR and distance.
 * - the latest `batterySamples` row -> `readLumenArchiveBattery` (device state, not a record).
 * Everything else (coach conversations and messages, raw BLE packets, wearable logs, meals, GPS points, profiles) is never
 * read into a record.
 *
 * Record ids come from core/recordIds.ts (§14.5), the same rule as the live MQTT ingest, so history and stream overlap once.
 */
import { buildSleepRecord, isoAt, localDateAt, provenanceOf, qualityOf } from '../core/importKit';
import type { StageSeg } from '../core/importKit';
import { LUMEN_SOURCE, dailyRecordId, seriesRecordId, sleepRecordId, sleepVersion, workoutRecordId } from '../core/recordIds';
import type {
  BioBatch, BioProvenance, BioRecord, BioStream, BiometricsImporter, DailyRecord, ImportContext, QualityFlag, SeriesRecord,
  SleepRecord, SleepStageName, WorkoutRecord,
} from '../core/types';
import { BIO_SCHEMA } from '../core/types';
import { chunkRecords } from './recordKit';
import { readText, tzOffsetSeconds } from './util';

export const LUMEN_ARCHIVE_PRODUCER = { name: 'vitals-importer-lumen-archive', version: '1' } as const;
const CHANNEL = 'file:lumen_archive' as const;
const SOURCE_APP = 'Lumen';
const DECODER = 'lumen-archive/1';
const DEVICE = { type: 'ring', model: 'J-Style 2301', tier: 'C' } as const;
const BATCH_SIZE = 500;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const rows = (a: Obj, k: string): Obj[] => (Array.isArray(a[k]) ? (a[k] as unknown[]).filter(isObj) : []);

type Origin = 'history' | 'live' | 'spot';
const ORIGIN: Record<string, Origin> = { history: 'history', vendor_history: 'history', ring_history: 'history', live: 'live', spot: 'spot' };
const SKIP_SOURCES = new Set(['demo', 'mock']);
const MODE: Record<Origin, SeriesRecord['sampling']['mode']> = { history: 'periodic', live: 'continuous', spot: 'spot' };

/** MeasurementKind names (ring/RingDecodedEvent.kt) -> Vitals stream and canonical unit. */
const KIND: Record<string, { stream: BioStream; unit: string; vendor?: true }> = {
  HEART_RATE: { stream: 'hr', unit: 'bpm' },
  SPO2: { stream: 'spo2', unit: '%' },
  TEMPERATURE: { stream: 'skin_temp', unit: 'degC' },
  HRV: { stream: 'hrv', unit: 'ms' },
  RESPIRATORY_RATE: { stream: 'resp_rate', unit: 'brpm' },
  STRESS: { stream: 'vendor:stress', unit: '', vendor: true },
  FATIGUE: { stream: 'vendor:fatigue', unit: '', vendor: true },
  BLOOD_PRESSURE_SYSTOLIC: { stream: 'vendor:bp_sys_estimate', unit: 'mmHg', vendor: true },
  BLOOD_PRESSURE_DIASTOLIC: { stream: 'vendor:bp_dia_estimate', unit: 'mmHg', vendor: true },
  BLOOD_SUGAR: { stream: 'vendor:glucose_estimate', unit: 'mg/dL', vendor: true },
};

const STAGE: Record<string, SleepStageName> = { LIGHT: 'light', DEEP: 'deep', REM: 'rem', AWAKE: 'awake', UNKNOWN: 'unknown' };

/** ActivityMeta.ORDER (ui/components/ActivityMeta.kt) -> Vitals exercise types. */
const EXERCISE: Record<string, string> = {
  walk: 'walking', run: 'running', cycle: 'biking', gym: 'strength_training', squash: 'squash', sport: 'other', yoga: 'yoga',
  dance: 'dancing', hike: 'hiking', other: 'other',
};

const prov = (ctx: ImportContext, extra: Partial<BioProvenance> = {}): BioProvenance =>
  provenanceOf(CHANNEL, ctx.now, { source_app: SOURCE_APP, device: DEVICE, decoder: DECODER, ...extra });

async function parseArchive(input: Blob): Promise<Obj> {
  let a: unknown;
  try {
    a = JSON.parse(await readText(input));
  } catch {
    throw new Error('This file is not valid JSON: not a Lumen Health data export');
  }
  if (!isObj(a) || typeof a.formatVersion !== 'number' || !('measurements' in a || 'sleepSessions' in a || 'activityDaily' in a))
    throw new Error('This JSON file is not a Lumen Health data export (Export All Data)');
  // only format 1 is understood: a higher, lower (0, negative), fractional or non-finite number is not guessed at
  if (a.formatVersion !== 1) throw new Error(`This Lumen Health export uses format ${String(a.formatVersion)}; Vitals reads format 1`);
  return a;
}

/** The latest battery reading in the archive, for the Devices card (not stored as a record). */
export async function readLumenArchiveBattery(input: Blob): Promise<{ percent: number; at: string } | null> {
  return latestBattery(await parseArchive(input));
}

function latestBattery(a: Obj): { percent: number; at: string } | null {
  let best: { percent: number; t: number } | null = null;
  for (const b of rows(a, 'batterySamples')) {
    const p = num(b.percent), t = num(b.timestamp);
    if (!Number.isFinite(p) || !Number.isFinite(t) || p < 0 || p > 100) continue;
    if (!best || t > best.t) best = { percent: p, t };
  }
  return best ? { percent: best.percent, at: isoAt(best.t) } : null;
}

async function* runArchive(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  const a = await parseArchive(input);
  ctx.onProgress(0.2);
  const off = (t: number): number => tzOffsetSeconds(t, ctx.tz);
  const records: BioRecord[] = [];

  // ---- series: measurements minus deletions, plus activity buckets
  const deletedIds = new Set<string>();
  const deletedAt = new Set<string>();
  for (const d of rows(a, 'measurementDeletions')) {
    const id = str(d.measurementId);
    if (id) deletedIds.add(id);
    if (str(d.kindRaw) && Number.isFinite(num(d.timestamp))) deletedAt.add(`${d.kindRaw}|${num(d.timestamp)}`);
  }
  interface Group { stream: BioStream; unit: string; origin: Origin; agg: 'sample' | 'sum'; date: string; offS: number; pts: Array<[number, number]>; vendor: boolean }
  const groups = new Map<string, Group>();
  const add = (stream: BioStream, unit: string, origin: Origin, agg: 'sample' | 'sum', t: number, v: number, vendor = false): void => {
    const o = off(t);
    const date = localDateAt(t, o);
    const k = `${stream}|${origin}|${date}|${agg}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { stream, unit, origin, agg, date, offS: o, pts: [], vendor }));
    g.pts.push([t, v]);
  };
  const vo2 = new Map<string, { t: number; v: number; o: number }>();
  for (const m of rows(a, 'measurements')) {
    const kind = str(m.kindRaw) ?? '';
    const t = num(m.timestamp), v = num(m.value);
    const src = str(m.sourceRaw) ?? 'history';
    if (!Number.isFinite(t) || !Number.isFinite(v) || SKIP_SOURCES.has(src)) continue;
    if ((str(m.id) && deletedIds.has(str(m.id)!)) || deletedAt.has(`${kind}|${t}`)) continue;
    const origin = ORIGIN[src] ?? 'history';
    if (kind === 'VO2MAX') {
      const date = localDateAt(t, off(t));
      const cur = vo2.get(date);
      if (!cur || t > cur.t) vo2.set(date, { t, v, o: off(t) });
      continue;
    }
    const k = KIND[kind];
    if (k) add(k.stream, k.unit, k.vendor ? 'history' : origin, 'sample', t, v, k.vendor === true);
  }
  for (const b of rows(a, 'activityBuckets')) {
    const t = num(b.startEpoch), steps = num(b.steps), dist = num(b.distanceMeters);
    if (!Number.isFinite(t) || SKIP_SOURCES.has(str(b.source) ?? '')) continue;
    if (Number.isFinite(steps)) add('steps', 'count', 'history', 'sum', t, steps);
    if (Number.isFinite(dist)) add('distance', 'm', 'history', 'sum', t, dist);
  }
  const ordered = [...groups.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.stream < y.stream ? -1 : x.stream > y.stream ? 1 : x.origin < y.origin ? -1 : 1));
  for (const g of ordered) {
    g.pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    // one value per instant: a re-synced bucket or a replayed sample is the same reading
    const pts = g.pts.filter((p, i) => i === 0 || p[0] !== g.pts[i - 1]![0]);
    const t0 = pts[0]![0];
    const hrv = g.stream === 'hrv';
    records.push({
      kind: 'series',
      record_id: seriesRecordId({ source: LUMEN_SOURCE, stream: g.stream, origin: g.origin, localDate: g.date }),
      version: pts.length,
      time: { start: isoAt(t0), end: isoAt(pts[pts.length - 1]![0]), tz_offset_s: g.offS, local_date: g.date },
      provenance: prov(ctx, { recording_method: g.origin === 'spot' ? 'active' : 'automatic' }),
      quality: qualityOf(g.vendor || hrv ? 'vendor_proprietary' : 'measured', hrv ? ['hrv_vendor_defined'] : []),
      metric: g.stream,
      unit: g.unit,
      aggregation: g.agg,
      sampling: { mode: MODE[g.origin], device_tier: DEVICE.tier },
      t_offset_s: pts.map((p) => Math.round((p[0] - t0) / 1000)),
      values: pts.map((p) => p[1]),
    } satisfies SeriesRecord);
  }
  ctx.onProgress(0.5);

  // ---- sleep sessions with their stage blocks
  const blocks = new Map<string, StageSeg[]>();
  for (const b of rows(a, 'sleepStageBlocks')) {
    const sid = str(b.sessionId), s = num(b.startAt), dur = num(b.durationMinutes);
    if (!sid || !Number.isFinite(s) || !Number.isFinite(dur) || dur <= 0) continue;
    const list = blocks.get(sid) ?? [];
    list.push({ s, e: s + dur * 60_000, stage: STAGE[str(b.stageRaw)?.toUpperCase() ?? ''] ?? 'unknown' });
    blocks.set(sid, list);
  }
  const sleeps = new Map<string, { rec: SleepRecord; updated: number }>();
  const scoreOf = new Map<string, number | null>();
  for (const s of rows(a, 'sleepSessions')) {
    const id = str(s.id), start = num(s.startAt), end = num(s.endAt);
    if (!id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || SKIP_SOURCES.has(str(s.sourceRaw) ?? '')) continue;
    const updated = num(s.updatedAt) || num(s.createdAt) || end;
    const segs = (blocks.get(id) ?? []).filter((x) => x.e > start && x.s < end).sort((x, y) => x.s - y.s);
    const o = off(end);
    const flags: QualityFlag[] = segs.length ? [] : ['partial_day'];
    // a session without blocks still has its time in bed; its stages are unknown, not guessed
    const useSegs: StageSeg[] = segs.length ? segs : [{ s: start, e: end, stage: 'unknown' }];
    const rec = buildSleepRecord({
      segs: useSegs, offsetS: o, sourceKey: LUMEN_SOURCE,
      provenance: prov(ctx, { native_id: id }),
      quality: qualityOf('vendor_proprietary', flags),
      isMain: false,
    });
    if (!rec) continue;
    rec.record_id = sleepRecordId({ source: LUMEN_SOURCE, start: rec.time.start! });
    rec.version = sleepVersion(true, updated / 1000);
    const cur = sleeps.get(rec.record_id);
    if (!cur || updated > cur.updated) sleeps.set(rec.record_id, { rec, updated });
    const score = num(s.score);
    if (!cur || updated > cur.updated) scoreOf.set(rec.record_id, Number.isFinite(score) ? score : null);
  }
  const sleepRecs = [...sleeps.values()].map((x) => x.rec).sort((x, y) => (x.time.start! < y.time.start! ? -1 : 1));
  const best = new Map<string, SleepRecord>();
  for (const r of sleepRecs) {
    const b = best.get(r.time.local_date);
    if (!b || r.asleep_s > b.asleep_s) best.set(r.time.local_date, r);
  }
  // Lumen's own score of the main night of each wake date -> the vendor's opinion
  const sleepScores = new Map<string, { v: number; updated: number; o: number }>();
  for (const b of best.values()) {
    if (b.asleep_s <= 0) continue;
    b.is_main = true;
    const v = scoreOf.get(b.record_id);
    if (v != null) sleepScores.set(b.time.local_date, { v, updated: sleeps.get(b.record_id)!.updated, o: b.time.tz_offset_s });
  }
  records.push(...sleepRecs);
  ctx.onProgress(0.7);

  // ---- daily records
  const daily = (metric: string, date: string, o: number, updatedMs: number, fill: (r: DailyRecord) => void, extra: Partial<BioProvenance> = {}): void => {
    const r: DailyRecord = {
      kind: 'daily',
      record_id: dailyRecordId({ source: LUMEN_SOURCE, metric, localDate: date }),
      version: Math.max(1, Math.round(updatedMs / 1000)),
      time: { tz_offset_s: o, local_date: date },
      provenance: prov(ctx, extra),
      quality: qualityOf('vendor_proprietary', []),
    };
    fill(r);
    r.quality.flags = [...new Set(r.quality.flags)].sort();
    records.push(r);
  };
  const days = new Map<string, { row: Obj; updated: number; o: number }>();
  for (const d of rows(a, 'activityDaily')) {
    const t = num(d.date);
    if (!Number.isFinite(t) || SKIP_SOURCES.has(str(d.source) ?? '')) continue;
    // `date` is the local start of the day; noon of that day gives its date in any zone the phone was in
    const o = off(t + 12 * 3600_000);
    const date = localDateAt(t + 12 * 3600_000, o);
    const updated = num(d.updatedAt) || num(d.syncedAt) || t;
    const cur = days.get(date);
    if (!cur || updated > cur.updated) days.set(date, { row: d, updated, o });
  }
  for (const [date, { row, updated, o }] of [...days].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    daily('activity', date, o, updated, (r) => {
      const steps = num(row.steps), dist = num(row.distanceMeters), am = num(row.activeMinutes), kcal = num(row.calories), est = num(row.estimatedActiveCalories);
      if (Number.isFinite(steps)) r.steps = Math.round(steps);
      if (Number.isFinite(dist)) r.distance_m = dist;
      if (Number.isFinite(am) && am >= 0) r.active_min = { light: 0, moderate: Math.round(am), vigorous: 0 };
      const bits = [Number.isFinite(kcal) ? `kcal_unspecified=${kcal}` : '', Number.isFinite(est) ? `kcal_estimated_active=${est}` : ''].filter(Boolean);
      if (bits.length) r.quality.vendor_state = bits.join(';');
    });
  }
  for (const [date, s] of [...sleepScores].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    daily('insight:sleep_score', date, s.o, s.updated, (r) => {
      r.vendor = { sleep: Math.round(s.v * 10) / 10 };
      r.quality.validation = 'estimated';
    }, { modality: 'derived' });
  }
  for (const [date, x] of [...vo2].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    daily('vo2max', date, x.o, x.t, (r) => {
      r.vo2max = { ml_kg_min: x.v, method: 'vendor_estimate' };
      r.quality.flags.push('estimated_vo2');
      r.quality.validation = 'estimated';
    });
  }

  // ---- workouts (finished sessions only)
  for (const w of rows(a, 'activitySessions')) {
    const start = num(w.startedAt), end = num(w.endedAt);
    const status = (str(w.statusRaw) ?? '').toLowerCase();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || status === 'recording' || status === 'paused' || status === 'discarded') continue;
    const pause = Math.max(0, num(w.totalPauseSeconds) || 0);
    const type = str(w.type) ?? 'other';
    const o = off(start);
    const avg = num(w.avgHeartRate), max = num(w.maxHeartRate), dist = num(w.distanceMeters);
    const rec: WorkoutRecord = {
      kind: 'workout',
      record_id: workoutRecordId({ source: LUMEN_SOURCE, start: isoAt(start) }),
      version: Math.max(1, Math.round((num(w.updatedAt) || end) / 1000)),
      time: { start: isoAt(start), end: isoAt(end), tz_offset_s: o, local_date: localDateAt(start, o) },
      provenance: prov(ctx, { recording_method: 'active', ...(str(w.id) ? { native_id: str(w.id)! } : {}) }),
      quality: qualityOf('measured', []),
      exercise_type: EXERCISE[type] ?? 'other',
      native_type: type,
      active_duration_s: Math.max(0, Math.round((end - start) / 1000 - pause)),
      ...(Number.isFinite(dist) && dist > 0 ? { distance_m: dist } : {}),
      ...(Number.isFinite(avg) && avg > 0 ? { hr_avg_bpm: Math.round(avg) } : {}),
      ...(Number.isFinite(max) && max > 0 ? { hr_max_bpm: Math.round(max) } : {}),
    };
    records.push(rec);
  }

  if (records.length === 0) throw new Error('This Lumen Health export holds no readings, sleep or workouts');
  for (const recs of chunkRecords(records, BATCH_SIZE)) yield { schema: BIO_SCHEMA, producer: LUMEN_ARCHIVE_PRODUCER, exported_at: ctx.now, tz: ctx.tz, records: recs };
  ctx.onProgress(1);
}

/** True for the head of a PulseArchive JSON (pretty-printed; `formatVersion`, `exportedAt`, `appVersion` come first). */
export function sniffLumenArchive(head: Uint8Array): boolean {
  const t = new TextDecoder().decode(head.subarray(0, 8192));
  return /^\s*\{/.test(t) && /"formatVersion"\s*:/.test(t) && /"appVersion"\s*:/.test(t) && /"exportedAt"\s*:/.test(t);
}

export const lumenArchiveImporter: BiometricsImporter = {
  id: 'lumen_archive',
  label: 'Lumen Health data export (JSON)',
  accepts: { mime: ['application/json', 'text/plain'], extensions: ['.json'], sniff: sniffLumenArchive },
  run: runArchive,
};
