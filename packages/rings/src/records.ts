/**
 * `RingEvent[]` → biometrics records with content-derived ids (plan 04 item 1, "the same ring read by several devices").
 * Tier P. Reuses the shared mapper (`src/biometrics/core/events.ts`) and then gives every record the id rule of
 * `src/biometrics/core/recordIds.ts` with the ring's own source key, so two devices reading the same night, hour or day
 * produce one record each: series by (source, stream, origin, local day), sleep by session start, daily by day, workouts
 * by start. Samples inside a series merge by (origin, t) in the store.
 */
import type { RingDecodedEvent } from '../../../src/biometrics/core/ble/types';
import { mapEventsToBatch, type EventMapContext } from '../../../src/biometrics/core/events';
import { localDateAt } from '../../../src/biometrics/core/importKit';
import { dailyRecordId, seriesRecordId, sleepRecordId, sleepVersion, workoutRecordId } from '../../../src/biometrics/core/recordIds';
import type { BioBatch, BioProvenance, BioRecord } from '../../../src/biometrics/core/types';
import type { RingEvent, RingFamily, RingIdentity } from './types';
import { ringSourceKey } from './types';

export interface RingRecordContext {
  identity: RingIdentity;
  family: RingFamily;
  firmware: string;
  /** IANA zone of the device doing the read (informational) and its fixed offset for local dates. */
  tz: string;
  tzOffsetS: number;
  /** Epoch seconds when the read happened: versions sleep records so a later re-sync supersedes an earlier one. */
  receivedS: number;
  ingestedAt: string;
  producer: { name: string; version: string };
  clockOffsetS?: number;
}

/**
 * Drops events the shared mapper does not know (`progress`, `dailyTotal`) and widens the rest. `dailyTotal` events are
 * kept apart by the caller (`dailyTotals`) because a day total must not be summed again against the activity buckets.
 */
export function toDecodedEvents(events: readonly RingEvent[]): RingDecodedEvent[] {
  const out: RingDecodedEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'sample':
        out.push({ type: 'sample', stream: e.stream, t: e.t, value: e.value, unit: e.unit, origin: e.origin === 'workout_stream' ? 'live' : e.origin });
        break;
      case 'vendor':
        out.push({ type: 'vendor', key: e.key, t: e.t, value: e.value, unit: e.unit });
        break;
      case 'sleepEpochs':
        if (e.epochS === 60) out.push({ type: 'sleepEpochs', start: e.start, epochS: 60, stages: [...e.stages], rawCodes: [...e.rawCodes], firmware: e.firmware, complete: e.complete });
        else {
          // Spread coarser epochs to minutes so one sleep record shape serves every family.
          const n = Math.max(1, Math.round(e.epochS / 60));
          out.push({ type: 'sleepEpochs', start: e.start, epochS: 60, stages: e.stages.flatMap((s) => Array<string>(n).fill(s)), rawCodes: e.rawCodes.flatMap((c) => Array<number>(n).fill(c)), firmware: e.firmware, complete: e.complete });
        }
        break;
      case 'activityBucket':
        out.push({ type: 'activityBucket', start: e.start, durS: e.durS, steps: e.steps, ...(e.distanceM !== undefined ? { distanceM: e.distanceM } : {}) });
        break;
      case 'workout':
        out.push({ type: 'workout', start: e.start, end: e.end, kind: e.kind });
        break;
      case 'status':
        if (e.key === 'battery' || e.key === 'firmware' || e.key === 'clock_offset_s' || e.key === 'cursor' || e.key === 'ack' || e.key === 'error')
          out.push({ type: 'status', key: e.key, value: e.value, ...(e.stream ? { stream: e.stream } : {}) });
        break;
      case 'dailyTotal':
      case 'progress':
        break;
    }
  }
  return out;
}

/** The provenance device block every record of this ring carries. */
export function ringDevice(ctx: RingRecordContext): NonNullable<BioProvenance['device']> {
  return { type: 'ring', manufacturer: ctx.family.maker ?? ctx.family.label, model: ctx.identity.model ?? ctx.family.models[0] ?? ctx.family.id, firmware: ctx.firmware, tier: ctx.family.tier };
}

/** Records for one sync, ids derived from content and the ring's source key; `status`/`progress` events are skipped. */
export function ringRecords(events: readonly RingEvent[], ctx: RingRecordContext): BioBatch {
  const source = ringSourceKey(ctx.identity);
  const mapCtx: EventMapContext = {
    tz: ctx.tz,
    tzOffsetS: ctx.tzOffsetS,
    channel: source,
    device: ringDevice(ctx),
    decoder: ctx.family.decoderTag(ctx.firmware),
    firmware: ctx.firmware,
    producer: ctx.producer,
    ingestedAt: ctx.ingestedAt,
    exportedAt: ctx.ingestedAt,
    clockOffsetS: ctx.clockOffsetS,
  };
  const batch = mapEventsToBatch(toDecodedEvents(events), mapCtx);
  const seen = new Map<string, BioRecord>();
  for (const r of batch.records) {
    const id = contentId(r, source);
    const prev = seen.get(id);
    seen.set(id, prev && prev.version > r.version ? prev : { ...r, record_id: id, ...(r.kind === 'sleep' ? { version: sleepVersion(r.quality.confidence !== 'low', ctx.receivedS) } : {}) });
  }
  // Day totals the ring reports itself (J-Style 0x51, Colmi 0x43 and the like) complete the daily record of that day.
  for (const e of events) {
    if (e.type !== 'dailyTotal') continue;
    const localDate = localDateAt(e.localDay, ctx.tzOffsetS);
    const id = dailyRecordId({ source, metric: 'activity', localDate });
    const base = seen.get(id);
    const rec: BioRecord =
      base && base.kind === 'daily'
        ? { ...base }
        : {
            kind: 'daily', record_id: id, version: 1,
            time: { tz_offset_s: ctx.tzOffsetS, local_date: localDate },
            provenance: { channel: source, device: mapCtx.device, recording_method: 'automatic', modality: 'sensed', ingested_at: ctx.ingestedAt, decoder: mapCtx.decoder },
            quality: { validation: 'measured', confidence: null, flags: [] },
          };
    if (rec.kind !== 'daily') continue;
    if (e.steps !== undefined) rec.steps = e.steps;
    if (e.distanceM !== undefined) rec.distance_m = e.distanceM;
    if (e.kcal !== undefined) rec.active_kcal = e.kcal;
    if (e.activeS !== undefined) rec.active_min = { light: 0, moderate: Math.floor(e.activeS / 60), vigorous: 0 };
    seen.set(id, rec);
  }
  return { ...batch, records: [...seen.values()] };
}

/** One id rule for every platform (`recordIds.ts`): what the record is and when, never which device read it. */
export function contentId(r: BioRecord, source: string): string {
  switch (r.kind) {
    case 'series': {
      const origin = r.sampling.mode === 'spot' ? 'spot' : r.sampling.mode === 'continuous' ? 'live' : 'history';
      return seriesRecordId({ source, stream: r.metric, origin, localDate: r.time.local_date });
    }
    case 'sleep':
      return sleepRecordId({ source, start: r.time.start ?? r.time.local_date });
    case 'daily':
      return dailyRecordId({ source, metric: 'activity', localDate: r.time.local_date });
    case 'workout':
      return workoutRecordId({ source, start: r.time.start ?? r.time.local_date });
    default:
      return r.record_id;
  }
}
