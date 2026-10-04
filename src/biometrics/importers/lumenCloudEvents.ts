/**
 * Lumen Android CloudEvents importer (tier H). One CloudEvents-1.0 envelope per line in a file (channel
 * 'file:lumen_cloudevents', `bio.import`) or one per MQTT message (channel 'mqtt:lumen', the server's broker). Both paths
 * call `mapLumenEvents`, and SUITE_SPEC §14.5 "Identical-batch rule" binds them: the same events give the same stored
 * records, provenance equal except `channel` and `ingested_at`. Field names follow the owner's Android source
 * `broadcasting/BroadcastEventMapper.kt` and docs/jstyle-2301-mqtt.md; R16 §2.3 lists the types. Envelope: {specversion,
 * id, type, source: 'urn:pulseloop:installation:<id>', subject, time, data{schema_version, observed_at, received_at, ...}}.
 * The envelope `id` is a delivery key only; it is never recomputed and never part of a record id (R16 §3.2).
 *
 * Record ids (§14.5) use the fixed namespace ID_SOURCE, never the channel:
 * - series: UUIDv5(ID_SOURCE, stream|origin, local_date); the store keeps samples per chunk and merges them by
 *   (origin, t), so one HR sample per message and a whole file give the same chunk.
 * - sleep: UUIDv5(ID_SOURCE, 'sleep', session start). version = (complete ? SLEEP_COMPLETE : 0) + received_s·100, so a
 *   complete night beats every provisional one whatever the arrival order, a later re-sync beats an earlier one, and
 *   the last two digits stay free for `is_main` re-writes (+1 each, `recomputeMainSleep`).
 * - daily: UUIDv5(ID_SOURCE, metric, local_date), version = received_s (the latest snapshot wins).
 *
 * Mapping: health.metric.observed hr/spo2/temp->skin_temp/hrv ('hrv_vendor_defined')/resp_rate -> series; stress,
 * fatigue, bp, glucose -> `vendor:<key>` series; vo2max -> daily vo2max {method:'vendor_estimate'}.
 * health.vendor_metric.observed -> `vendor:<key>` with the key normalised like the topic segment (R16 G8).
 * health.activity.bucket.observed -> steps/distance 'sum' series (the per-day bucket total is dropped: the daily comes
 * from health.activity.updated). health.activity.updated -> daily steps, distance, active_min.moderate (elapsed exercise
 * minutes, R16 G4); kcal has an unspecified basis and stays in quality.vendor_state. health.sleep.timeline.updated ->
 * sleep ('provisional_stages' when !complete_session). health.insight.updated sleep_score/recovery_score/vo2max_estimate
 * -> daily vendor/vo2max, modality 'derived'. health.device.identified / firmware / connection update the per-installation
 * stamps (G5, G6), which apply from that event on; battery and connection come back as `status` (G3), never as records.
 */
import { LUMEN_SOURCE, SLEEP_COMPLETE, dailyRecordId, seriesRecordId, sleepRecordId, sleepVersion } from '../core/recordIds';
import { isoAt, localDateAt, provenanceOf, qualityOf } from '../core/importKit';
import { mapEventsToBatch } from '../core/events';
import type { EventMapContext } from '../core/events';
import type { RingDecodedEvent } from '../core/ble/types';
import { sourceKeyOf } from '../core/source';
import type { BioBatch, BioProvenance, BioRecord, BiometricsImporter, DailyRecord, ImportContext, SeriesRecord, SleepRecord } from '../core/types';
import { BIO_SCHEMA } from '../core/types';
import { chunkRecords } from './recordKit';
import { readLines, tzOffsetSeconds } from './util';

export const LUMEN_CE_PRODUCER = { name: 'vitals-importer-lumen-cloudevents', version: '1' } as const;
const BATCH_SIZE = 500;
const EVENT_BUFFER = 20000;
const CHANNEL = 'file:lumen_cloudevents' as const;
/** Record-id namespace for every Lumen record whatever the channel. It equals the first channel's name so daily ids of
 * file imports made before the broker existed stay the same. */
const ID_SOURCE = LUMEN_SOURCE;
const SOURCE_APP = 'Lumen';
const DEFAULT_DEVICE = { type: 'ring', model: 'J-Style 2301', tier: 'C' } as const;
export { SLEEP_COMPLETE };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOf = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const strOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const fin = (v: unknown): boolean => Number.isFinite(numOf(v));

const ORIGIN: Record<string, 'history' | 'spot' | 'live'> = { device_history: 'history', vendor_history: 'history', device_live: 'live', device_spot: 'spot' };
const MODE_ORIGIN: Record<string, string> = { periodic: 'history', spot: 'spot', continuous: 'live' };
const STREAM: Record<string, { stream: 'hr' | 'spo2' | 'skin_temp' | 'hrv' | 'resp_rate'; unit: string }> = {
  hr: { stream: 'hr', unit: 'bpm' }, spo2: { stream: 'spo2', unit: '%' }, temp: { stream: 'skin_temp', unit: 'degC' },
  hrv: { stream: 'hrv', unit: 'ms' }, resp_rate: { stream: 'resp_rate', unit: 'brpm' },
};
const VENDOR_KEY: Record<string, string> = { stress: 'stress', fatigue: 'fatigue', bp_sys: 'bp_sys_estimate', bp_dia: 'bp_dia_estimate', glucose: 'glucose_estimate' };
/** The topic-segment rule of BroadcastEventMapper.kt (R16 G8). */
const vendorKey = (k: string): string => k.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');

function splitAlgorithm(v: string): { name: string; version: string } {
  const m = /^(.*?)-(v\d+(?:\.\d+)*)$/.exec(v);
  return m ? { name: m[1]!, version: m[2]! } : { name: v, version: v };
}

// ---------------------------------------------------------------- envelope check

export type LumenEventCheck = { ok: true; type: string; installationId?: string } | { ok: false; reason: 'not_cloudevent' | 'unknown_type' | 'invalid_payload' };

const obsOf = (ce: Obj, d: Obj): number => Date.parse(strOf(d.observed_at) ?? strOf(ce.time) ?? '');

/** Data validation per handled type; types Lumen sends that carry nothing Vitals stores are known but map to nothing. */
const VALID: Record<string, (d: Obj, obs: number) => boolean> = {
  'health.metric.observed': (d, obs) => Number.isFinite(obs) && (fin(d.systolic) || fin(d.diastolic) || ((strOf(d.metric) ?? '') !== '' && fin(d.value))),
  'health.vendor_metric.observed': (d, obs) => Number.isFinite(obs) && (strOf(d.metric) ?? '') !== '' && fin(d.value),
  'health.activity.bucket.observed': (d, obs) => Number.isFinite(obs) && fin(d.steps),
  'health.activity.updated': (_d, obs) => Number.isFinite(obs),
  'health.sleep.timeline.updated': (d, obs) => Number.isFinite(obs) && Array.isArray(d.stages) && d.stages.length > 0 && d.stages.every((s) => typeof s === 'string'),
  'health.insight.updated': (d, obs) => Number.isFinite(obs) && (strOf(d.insight) ?? '') !== '' && fin(d.value),
  'health.device.battery.updated': (d) => fin(d.percent),
  'health.device.firmware.updated': (d) => (strOf(d.version) ?? '') !== '',
  'health.device.identified': (d) => (strOf(d.device_type) ?? strOf(d.model_id) ?? '') !== '',
  'health.device.connection.updated': (d) => (strOf(d.state) ?? '') !== '',
};
const KNOWN_IGNORED = new Set(['health.device.forgotten', 'health.device.wear_state.updated', 'health.sync.progress', 'health.measurement.completed', 'health.measurement.rejected']);

/** Classifies one envelope. unknown_type: not a Lumen health.* type Vitals knows; invalid_payload: a known type whose
 * data fails validation. */
export function checkLumenEvent(ce: unknown): LumenEventCheck {
  if (!isObj(ce) || ce.specversion !== '1.0' || typeof ce.id !== 'string' || ce.id === '' || typeof ce.type !== 'string' || ce.type === '') return { ok: false, reason: 'not_cloudevent' };
  const valid = VALID[ce.type];
  if (!valid && !KNOWN_IGNORED.has(ce.type)) return { ok: false, reason: 'unknown_type' };
  if (!isObj(ce.data) || (valid && !valid(ce.data, obsOf(ce, ce.data)))) return { ok: false, reason: 'invalid_payload' };
  const m = /^urn:pulseloop:installation:(.+)$/.exec(strOf(ce.source) ?? '');
  return { ok: true, type: ce.type, ...(m ? { installationId: m[1]! } : {}) };
}

// ---------------------------------------------------------------- mapping

export interface LumenInstallation { deviceType?: string; modelId?: string; firmware?: string; updatedAt?: string }
export interface LumenMapContext {
  /** the person's IANA zone (from their profile, never the host's) */
  tz: string;
  /** ISO instant, becomes `ingested_at` / `exported_at` */
  now: string;
  channel: 'file:lumen_cloudevents' | 'mqtt:lumen';
  /** last device stamps per installation id, carried across calls by the caller */
  installations?: Record<string, LumenInstallation>;
}
export interface LumenStatus { kind: 'battery' | 'connection'; at: string; installationId?: string; value: unknown }
export interface LumenMapResult {
  batch: BioBatch;
  installations: Record<string, LumenInstallation>;
  status: LumenStatus[];
  /** events per stream name (policy stream names: hr, steps, sleep_sessions, daily_summary, vendor:<key>, ...) */
  streams: Record<string, number>;
}

function deviceOf(s: LumenInstallation | undefined): NonNullable<BioProvenance['device']> {
  const model = s?.modelId ?? s?.deviceType;
  return { ...DEFAULT_DEVICE, ...(model ? { model } : {}), ...(s?.firmware ? { firmware: s.firmware } : {}) };
}

/** Keeps the record with the higher version per record_id; on a tie the first one, like the store ('duplicate'). */
function keep<T extends BioRecord>(m: Map<string, T>, r: T): void {
  const cur = m.get(r.record_id);
  if (!cur || r.version > cur.version) m.set(r.record_id, r);
}

/** Maps CloudEvent envelopes (already parsed; envelopes failing `checkLumenEvent` are skipped) to one batch. Pure apart from
 * Intl for the zone offset. Device stamps apply from their event on, so a file and the same events one per call agree. */
export function mapLumenEvents(events: unknown[], ctx: LumenMapContext): LumenMapResult {
  const inst: Record<string, LumenInstallation> = {};
  for (const [k, v] of Object.entries(ctx.installations ?? {})) inst[k] = { ...v };
  const status: LumenStatus[] = [];
  const streams: Record<string, number> = {};
  const count = (s: string): void => { streams[s] = (streams[s] ?? 0) + 1; };
  const groups = new Map<string, { ctx: EventMapContext; evs: RingDecodedEvent[] }>();
  const sleeps = new Map<string, SleepRecord>();
  const dailies = new Map<string, DailyRecord>();

  for (const raw of events) {
    const chk = checkLumenEvent(raw);
    if (!chk.ok) continue;
    const ce = raw as Obj;
    const d = ce.data as Obj;
    const iid = chk.installationId ?? '';
    const spec = strOf(ce.specversion)!;
    const id = strOf(ce.id)!;
    const obs = obsOf(ce, d);
    const recvS = Math.round((Date.parse(strOf(d.received_at) ?? '') || obs) / 1000);
    const at = Number.isFinite(obs) ? isoAt(obs) : ctx.now;
    const device = deviceOf(inst[iid]);
    const off = Number.isFinite(obs) ? tzOffsetSeconds(obs, ctx.tz) : 0;
    const mapCtx = (): EventMapContext => ({
      tz: ctx.tz, tzOffsetS: off, channel: ctx.channel, device, decoder: `lumen-cloudevents/${spec}`, ...(device.firmware ? { firmware: device.firmware } : {}),
      producer: LUMEN_CE_PRODUCER, ingestedAt: ctx.now, exportedAt: ctx.now,
    });
    const emit = (ev: RingDecodedEvent, stream: string): void => {
      const k = `${off}|${spec}|${device.model ?? ''}|${device.firmware ?? ''}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ctx: mapCtx(), evs: [] }));
      g.evs.push(ev);
      count(stream);
    };
    const daily = (metric: string, fill: (r: DailyRecord) => void): void => {
      const date = localDateAt(obs, off);
      const rec: DailyRecord = {
        kind: 'daily',
        record_id: dailyRecordId({ source: ID_SOURCE, metric, localDate: date }),
        version: Math.max(1, recvS),
        time: { tz_offset_s: off, local_date: date },
        provenance: provenanceOf(ctx.channel, ctx.now, { source_app: SOURCE_APP, device, native_id: id, decoder: `lumen-cloudevents/${spec}` }),
        quality: qualityOf('vendor_proprietary'),
      };
      fill(rec);
      rec.quality.flags = [...new Set(rec.quality.flags)].sort();
      keep(dailies, rec);
      count('daily_summary');
    };
    const stamp = (p: LumenInstallation): void => {
      const cur = inst[iid] ?? {};
      if (cur.updatedAt && Number.isFinite(obs) && at < cur.updatedAt) return; // an older retained copy arriving late
      const next: LumenInstallation = { ...cur };
      for (const [k, v] of Object.entries(p) as Array<[keyof LumenInstallation, string | undefined]>) if (v) next[k] = v;
      next.updatedAt = at;
      inst[iid] = next;
    };

    switch (chk.type) {
      case 'health.metric.observed': {
        const metric = strOf(d.metric) ?? strOf(ce.subject) ?? '';
        if (metric === 'blood_pressure' || (d.systolic !== undefined && d.diastolic !== undefined)) {
          const s = numOf(d.systolic), dia = numOf(d.diastolic);
          if (Number.isFinite(s)) emit({ type: 'vendor', key: 'bp_sys_estimate', t: obs, value: s, unit: 'mmHg' }, 'vendor:bp_sys_estimate');
          if (Number.isFinite(dia)) emit({ type: 'vendor', key: 'bp_dia_estimate', t: obs, value: dia, unit: 'mmHg' }, 'vendor:bp_dia_estimate');
          break;
        }
        const v = numOf(d.value);
        if (!Number.isFinite(v)) break;
        const s = STREAM[metric];
        const origin = ORIGIN[strOf(d.provenance) ?? ''] ?? 'history';
        if (s) emit({ type: 'sample', stream: s.stream, t: obs, value: v, unit: s.unit, origin }, s.stream);
        else if (metric === 'vo2max') daily('vo2max', (r) => { r.vo2max = { ml_kg_min: v, method: 'vendor_estimate' }; r.quality.flags.push('estimated_vo2'); r.quality.validation = 'estimated'; });
        else {
          const key = VENDOR_KEY[metric] ?? vendorKey(metric);
          emit({ type: 'vendor', key, t: obs, value: v, unit: strOf(d.unit) ?? '' }, `vendor:${key}`);
        }
        break;
      }
      case 'health.vendor_metric.observed': {
        const key = vendorKey(strOf(d.metric)!);
        emit({ type: 'vendor', key, t: obs, value: numOf(d.value), unit: strOf(d.unit) ?? '' }, `vendor:${key}`);
        break;
      }
      case 'health.activity.bucket.observed': {
        const dist = numOf(d.distance_m);
        emit({ type: 'activityBucket', start: obs, durS: 60, steps: numOf(d.steps), ...(Number.isFinite(dist) ? { distanceM: dist } : {}) }, 'steps');
        break;
      }
      case 'health.sleep.timeline.updated': {
        const complete = d.complete_session === true;
        const ev: RingDecodedEvent = { type: 'sleepEpochs', start: obs, epochS: 60, stages: (d.stages as string[]).map(String), rawCodes: [], firmware: device.firmware ?? '', complete };
        const rec = mapEventsToBatch([ev], mapCtx()).records.find((r): r is SleepRecord => r.kind === 'sleep');
        if (!rec) break;
        rec.record_id = sleepRecordId({ source: ID_SOURCE, start: isoAt(obs) });
        rec.version = sleepVersion(complete, recvS);
        rec.is_main = false;
        rec.provenance = { ...rec.provenance, native_id: id, source_app: SOURCE_APP };
        keep(sleeps, rec);
        count('sleep_sessions');
        break;
      }
      case 'health.activity.updated':
        daily('activity', (r) => {
          const steps = numOf(d.steps), dist = numOf(d.distance_m), kcal = numOf(d.calories_kcal), am = numOf(d.active_minutes);
          if (Number.isFinite(steps)) r.steps = Math.round(steps);
          if (Number.isFinite(dist)) r.distance_m = dist;
          // elapsed exercise minutes (R16 G4); the adapter reads them from `moderate`
          if (Number.isFinite(am)) r.active_min = { light: 0, moderate: Math.round(am), vigorous: 0 };
          if (Number.isFinite(kcal)) r.quality.vendor_state = `kcal_unspecified=${kcal}`;
        });
        break;
      case 'health.insight.updated': {
        const key = strOf(d.insight)!;
        const v = numOf(d.value);
        const algo = strOf(d.algorithm_version);
        if (!algo || (key !== 'sleep_score' && key !== 'recovery_score' && key !== 'vo2max_estimate')) break;
        const conf = strOf(d.confidence);
        daily(`insight:${key}`, (r) => {
          r.provenance = { ...r.provenance, modality: 'derived', algorithm: splitAlgorithm(algo) };
          r.quality.validation = 'estimated';
          r.quality.confidence = conf === 'low' || conf === 'medium' || conf === 'high' ? conf : null;
          if (key === 'sleep_score') r.vendor = { sleep: Math.round(v * 10) / 10 };
          else if (key === 'recovery_score') r.vendor = { recovery: Math.round(v * 10) / 10 };
          else {
            r.vo2max = { ml_kg_min: Math.round(v * 10) / 10, method: 'derived' };
            r.quality.flags.push('estimated_vo2');
          }
        });
        break;
      }
      case 'health.device.firmware.updated':
        stamp({ firmware: strOf(d.version) });
        break;
      case 'health.device.identified':
        stamp({ deviceType: strOf(d.device_type), modelId: strOf(d.model_id) });
        break;
      case 'health.device.connection.updated':
        stamp({ deviceType: strOf(d.device_type), firmware: strOf(d.firmware) });
        status.push({ kind: 'connection', at, ...(chk.installationId ? { installationId: chk.installationId } : {}), value: { state: strOf(d.state), ...(strOf(d.device_type) ? { deviceType: strOf(d.device_type) } : {}), ...(strOf(d.firmware) ? { firmware: strOf(d.firmware) } : {}) } });
        break;
      case 'health.device.battery.updated':
        status.push({ kind: 'battery', at, ...(chk.installationId ? { installationId: chk.installationId } : {}), value: numOf(d.percent) });
        break;
    }
  }

  const records: BioRecord[] = [];
  for (const g of groups.values()) {
    // daily sums come from health.activity.updated; bucket sums here would be a second, conflicting daily record
    for (const r of mapEventsToBatch(g.evs, g.ctx).records) {
      if (r.kind !== 'series') continue;
      r.record_id = seriesId(r);
      records.push(r);
    }
  }
  records.push(...recomputeMainSleep([], [...sleeps.values()]).sort((a, b) => (a.time.start! < b.time.start! ? -1 : 1)));
  records.push(...[...dailies.values()].sort((a, b) => a.time.local_date.localeCompare(b.time.local_date) || a.record_id.localeCompare(b.record_id)));
  return { batch: { schema: BIO_SCHEMA, producer: LUMEN_CE_PRODUCER, exported_at: ctx.now, tz: ctx.tz, records }, installations: inst, status, streams };
}

const seriesId = (r: SeriesRecord): string => seriesRecordId({ source: ID_SOURCE, stream: r.metric, origin: MODE_ORIGIN[r.sampling.mode] ?? r.sampling.mode, localDate: r.time.local_date });

// ---------------------------------------------------------------- main sleep

/**
 * `is_main` per (source key, wake date) across batches: the longest `asleep_s` wins (ties: earlier start, then record_id);
 * a night with no sleep is never main. `stored` = latest stored versions near the incoming wake dates; an incoming record
 * replaces the stored one with the same id only with a higher version (as the store does). Returns the incoming records
 * that will be stored, with `is_main` set, plus every stored record whose `is_main` flips, re-written at version + 1.
 */
export function recomputeMainSleep(stored: readonly SleepRecord[], incoming: readonly SleepRecord[]): SleepRecord[] {
  const cur = new Map<string, { rec: SleepRecord; stored: boolean }>();
  for (const s of stored) cur.set(s.record_id, { rec: s, stored: true });
  for (const r of incoming) {
    const c = cur.get(r.record_id);
    if (!c || r.version > c.rec.version) cur.set(r.record_id, { rec: r, stored: false });
  }
  const best = new Map<string, SleepRecord>();
  const groupOf = (r: SleepRecord): string => `${sourceKeyOf(r.provenance)}\u0000${r.time.local_date}`;
  for (const { rec } of cur.values()) {
    const k = groupOf(rec);
    const b = best.get(k);
    if (!b || rec.asleep_s > b.asleep_s || (rec.asleep_s === b.asleep_s && ((rec.time.start ?? '') < (b.time.start ?? '') || ((rec.time.start ?? '') === (b.time.start ?? '') && rec.record_id < b.record_id)))) best.set(k, rec);
  }
  const out: SleepRecord[] = [];
  for (const { rec, stored: was } of cur.values()) {
    const main = best.get(groupOf(rec)) === rec && rec.asleep_s > 0;
    if (!was) out.push({ ...rec, is_main: main });
    else if (rec.is_main !== main) out.push({ ...rec, is_main: main, version: rec.version + 1 });
  }
  return out;
}

// ---------------------------------------------------------------- file importer

async function* runCe(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  let installations: Record<string, LumenInstallation> = {};
  const sleeps = new Map<string, SleepRecord>();
  const dailies = new Map<string, DailyRecord>();
  let buf: unknown[] = [];
  let valid = 0;
  let consumed = 0;
  const total = Math.max(1, input.size);
  const mk = (records: BioRecord[]): BioBatch => ({ schema: BIO_SCHEMA, producer: LUMEN_CE_PRODUCER, exported_at: ctx.now, tz: ctx.tz, records });
  const flush = (): BioRecord[] => {
    const r = mapLumenEvents(buf, { tz: ctx.tz, now: ctx.now, channel: CHANNEL, installations });
    buf = [];
    installations = r.installations;
    // nights and days collect over the whole file; series go out as they come (the store merges their samples)
    const series: BioRecord[] = [];
    for (const rec of r.batch.records) {
      if (rec.kind === 'sleep') keep(sleeps, rec);
      else if (rec.kind === 'daily') keep(dailies, rec);
      else series.push(rec);
    }
    return series;
  };

  for await (const line of readLines(input, ctx.signal)) {
    consumed += line.length + 1;
    let ce: unknown;
    try {
      ce = JSON.parse(line);
    } catch {
      continue;
    }
    if (!checkLumenEvent(ce).ok) continue;
    valid++;
    buf.push(ce);
    ctx.onProgress(Math.min(0.99, consumed / total));
    if (buf.length >= EVENT_BUFFER) for (const recs of chunkRecords(flush(), BATCH_SIZE)) yield mk(recs);
  }
  if (valid === 0) throw new Error('no CloudEvents health.* events found: not a Lumen CloudEvents JSONL dump');
  const out = flush();
  out.push(...recomputeMainSleep([], [...sleeps.values()]).sort((a, b) => (a.time.start! < b.time.start! ? -1 : 1)));
  out.push(...[...dailies.values()].sort((a, b) => a.time.local_date.localeCompare(b.time.local_date) || a.record_id.localeCompare(b.record_id)));
  for (const recs of chunkRecords(out, BATCH_SIZE)) yield mk(recs);
  ctx.onProgress(1);
}

function sniffCe(head: Uint8Array): boolean {
  const t = new TextDecoder().decode(head.subarray(0, 8192));
  return /"specversion"\s*:/.test(t) && /"type"\s*:\s*"health\./.test(t);
}

export const lumenCloudEventsImporter: BiometricsImporter = {
  id: 'lumen_cloudevents',
  label: 'Lumen Android CloudEvents (JSONL)',
  accepts: { mime: ['application/x-ndjson', 'application/jsonl', 'application/json', 'text/plain'], extensions: ['.jsonl', '.ndjson', '.json'], sniff: sniffCe },
  run: runCe,
};
