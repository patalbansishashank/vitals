/**
 * LuckRing packet reassembly and frame decoder. Tier P. Ported from Lumen's `LuckRingFrameAssembler`
 * (`LuckRingProtocol.kt`) and `LuckRingDecoder.kt`; research in `docs/luckring.md` §3, §8 and §12.
 *
 * The assembler keeps one partial frame in plain data (the protocol state carries it). The decoder maps each Kotlin
 * `RingDecodedEvent` onto a `RingEvent`: history types → `sample` origin 'history', live types → origin 'live', blood
 * pressure and stress → `vendor` ('bp_sys', 'bp_dia', 'stress'), `CommandAck` → `status:ack`. Record timestamps are true
 * UTC seconds on the ring (no offset to remove) and leave here as epoch ms.
 */
import type { RingEvent, SampleOrigin, SleepStage } from '../types';
import { CMD, DT, PACKET_SIZE, u16, u24, u32, type LogicalFrame } from './commands';

/** Activity bucket length. UNVERIFIED: the Kotlin ignores the record's duration field and gives no length; 60 s is our default. */
export const ACTIVITY_BUCKET_S = 60;

// ---------------------------------------------------------------- reassembly (`LuckRingFrameAssembler`)

export interface PartialFrame {
  cmdType: number;
  dataType: number;
  seq: number;
  devType: number;
  totalPages: number;
  declaredLength: number;
  payload: number[];
  receivedPages: number;
}

/** Feeds one notification; returns the new partial and the frame it completed (or null while assembling). */
export function assemble(partial: PartialFrame | null, data: Uint8Array): { partial: PartialFrame | null; frame: LogicalFrame | null } {
  if (data.length < PACKET_SIZE) return { partial, frame: null }; // short notifications are ignored
  const b = Array.from(data.subarray(0, PACKET_SIZE));
  if (b[0] !== 0) {
    // Continuation: needs an open head and the next page number, else the partial frame is dropped.
    if (!partial) return { partial: null, frame: null };
    if (b[0] !== partial.receivedPages + 1) return { partial: null, frame: null };
    const next: PartialFrame = { ...partial, payload: [...partial.payload, ...b.slice(1, 20)], receivedPages: b[0]! };
    if (next.receivedPages < next.totalPages) return { partial: next, frame: null };
    // Cut to the declared length: the last continuation is zero padded (temperature derives its stride from the size).
    return { partial: null, frame: { cmdType: next.cmdType, dataType: next.dataType, payload: next.payload.slice(0, next.declaredLength), seq: next.seq, devType: next.devType } };
  }
  const devType = b[1]!;
  const seq = b[3]!;
  const raw = b[4]! & 0x0f;
  const cmdType = raw === CMD.SEND_NO_ACK || raw === CMD.REQUEST || raw === CMD.ACK ? raw : CMD.SEND; // `fromRaw` default SEND
  const dataType = b[5]!;
  // A device ACK is a whole single-packet frame; its status byte is [10]. A new head always drops an open partial.
  if (cmdType === CMD.ACK) return { partial: null, frame: { cmdType, dataType, payload: [b[10]!], seq, devType } };
  const declaredLength = u16(b, 8);
  const totalPages = b[2]!;
  const firstChunk = b.slice(10, Math.min(20, 10 + Math.max(0, declaredLength)));
  if (totalPages === 0) return { partial: null, frame: { cmdType, dataType, payload: firstChunk.slice(0, declaredLength), seq, devType } };
  return { partial: { cmdType, dataType, seq, devType, totalPages, declaredLength, payload: firstChunk, receivedPages: 0 }, frame: null };
}

// ---------------------------------------------------------------- decoding (`LuckRingDecoder.decode`)

export interface DecodeContext {
  /** Firmware seen in the device-info reply, for the sleep events' provenance. */
  firmware: string;
  /** Phone clock at receipt; LuckRing record timestamps are already UTC. */
  nowMs?: number;
}

const ack = (value: number | string): RingEvent => ({ type: 'status', key: 'ack', value });
const ms = (rec: number[]): number => u32(rec, 0) * 1000;
type MetricStream = 'hr' | 'spo2' | 'hrv' | 'skin_temp';
const UNIT: Record<MetricStream, string> = { hr: 'bpm', spo2: 'pct', hrv: 'ms', skin_temp: 'degC' };
const sample = (stream: MetricStream, t: number, value: number, origin: SampleOrigin): RingEvent => ({ type: 'sample', stream, t, value, unit: UNIT[stream], origin });

/** The same value windows as the Kotlin RingEventBridge, applied before records reach the shared store. */
function plausible(e: RingEvent, nowMs: number | undefined): boolean {
  if (nowMs === undefined) return true;
  if (e.type === 'status' && e.key === 'battery') return typeof e.value === 'number' && e.value <= 100;
  if (e.type === 'activityBucket' && (e.steps > 5000 || (e.distanceM ?? 0) > 6000)) return false;
  if (e.type === 'sample') {
    const ranges: Record<MetricStream, [number, number]> = { hr: [30, 220], spo2: [70, 100], hrv: [1, 300], skin_temp: [30, 45] };
    const range = ranges[e.stream as MetricStream];
    if (range && (!Number.isFinite(e.value) || e.value < range[0] || e.value > range[1])) return false;
  }
  if (e.type === 'vendor') {
    const ranges: Record<string, [number, number]> = { bp_sys: [60, 250], bp_dia: [30, 150], stress: [1, 100] };
    const range = ranges[e.key];
    if (range && (!Number.isFinite(e.value) || e.value < range[0] || e.value > range[1])) return false;
  }
  const t = e.type === 'sample' || e.type === 'vendor' ? e.t : e.type === 'activityBucket' ? e.start : e.type === 'sleepEpochs' ? e.start + e.stages.length * e.epochS * 1000 : null;
  if (t !== null && (!Number.isFinite(t) || t <= 0 || t > nowMs)) return false;
  if ((e.type === 'sleepEpochs' || (e.type === 'sample' && e.origin === 'history') || (e.type === 'vendor' && e.origin === 'history')) && t !== null && t < nowMs - 8 * 86_400_000) return false;
  return true;
}

/** `records`: `[total u16][items u8]` then `items` records; stride null = body / items (temperature). Partial records drop. */
export function records(p: number[], stride: number | null): number[][] {
  if (p.length < 3) return [];
  const items = p[2]!;
  if (items <= 0) return [];
  const body = p.slice(3);
  const step = stride ?? Math.floor(body.length / items);
  if (step <= 0) return [];
  const out: number[][] = [];
  for (let n = 0, o = 0; n < items && o + step <= body.length; n++, o += step) out.push(body.slice(o, o + step));
  return out;
}

export function decodeFrame(f: LogicalFrame, ctx: DecodeContext): RingEvent[] {
  if (f.cmdType === CMD.ACK) return [ack(f.dataType)]; // a device ACK is a verdict on our command
  const p = f.payload;
  const decoded = (() : RingEvent[] => { switch (f.dataType) {
    case DT.DEV_INFO:
      // `decodeDeviceInfo`: bytes 1..5 joined by dots; byte 0 is the item count.
      return p.length < 6 ? [ack(DT.DEV_INFO)] : [{ type: 'status', key: 'firmware', value: p.slice(1, 6).join('.') }];
    case DT.BATTERY:
      // The charging byte is read by nobody in the Kotlin; no `charging` status.
      return p.length === 0 ? [ack(DT.BATTERY)] : [{ type: 'status', key: 'battery', value: p[0]! }];
    case DT.REAL_SPORT:
    case DT.HISTORY_SPORT: {
      // `decodeSport`: 20 B `[start u32][steps u32][distance u24+pad][calories u24+pad][duration u24+pad]`; calories and
      // duration are ignored like the Kotlin. Distance taken as meters (UNVERIFIED unit).
      const recs = records(p, 20);
      if (recs.length === 0) return [ack(f.dataType)];
      return recs.map((r) => ({ type: 'activityBucket', start: ms(r), durS: ACTIVITY_BUCKET_S, steps: u32(r, 4), distanceM: u24(r, 8) }));
    }
    case DT.SLEEP:
      return decodeSleep(p, ctx.firmware);
    case DT.REAL_HEART:
    case DT.EXERCISE_HEART: {
      // `decodeLiveHeart`: an empty envelope means the measurement ended (Kotlin `HeartRateComplete`).
      const recs = records(p, 5);
      if (recs.length === 0) return [ack('hr_complete')];
      const origin: SampleOrigin = f.dataType === DT.EXERCISE_HEART ? 'workout_stream' : 'live';
      return recs.map((r) => sample('hr', ms(r), r[4]!, origin));
    }
    case DT.HISTORY_HEART:
      return history(p, 'hr');
    case DT.REAL_O2: {
      const recs = records(p, 5);
      if (recs.length === 0) return [ack('spo2_complete')];
      return recs.map((r) => sample('spo2', ms(r), r[4]!, 'live'));
    }
    case DT.HISTORY_O2:
      return history(p, 'spo2');
    case DT.REAL_BP: {
      const out = bloodPressure(p, 'live');
      return out.length ? out : [ack(DT.REAL_BP)];
    }
    case DT.HISTORY_BP:
      return bloodPressure(p, 'history');
    case DT.REAL_HRV:
      return live(p, (t, v) => sample('hrv', t, v, 'live'));
    case DT.HISTORY_HRV:
      return history(p, 'hrv');
    case DT.REAL_TEMP:
      return temperature(p, false);
    case DT.HISTORY_TEMP:
      return temperature(p, true);
    case DT.STRESS:
      return live(p, (t, v) => ({ type: 'vendor', key: 'stress', t, value: v, unit: 'score', origin: 'live' }));
    case DT.STRESS_HISTORY:
      return records(p, 5).map((r) => ({ type: 'vendor', key: 'stress', t: ms(r), value: r[4]!, unit: 'score', origin: 'history' }));
    case DT.PAIR_FINISH:
    case DT.FIND_DEVICE:
    case DT.DEV_SYNC:
    case DT.FUNCTION_CONTROL:
    case DT.UNBIND:
      // Echo frames with nothing to store; the settings sync (9) TLV and the capability bitmap (22) are not decoded.
      return [ack(f.dataType)];
  }
  // Kotlin `Unknown(dataType, raw)`; these frames cannot carry a secret.
  return [{ type: 'status', key: 'error', value: `unknown_data_type:${f.dataType}` }];
  })();
  return decoded.filter((e) => plausible(e, ctx.nowMs));
}

/** `decodeHistory`: 5 B `[time][value u8]`; an empty envelope yields nothing. */
function history(p: number[], stream: MetricStream): RingEvent[] {
  return records(p, 5).map((r) => sample(stream, ms(r), r[4]!, 'history'));
}

/** `decodeLive` (HRV, stress): an empty envelope is `CommandAck(0)` in the Kotlin. */
function live(p: number[], make: (t: number, v: number) => RingEvent): RingEvent[] {
  const recs = records(p, 5);
  return recs.length === 0 ? [ack(0)] : recs.map((r) => make(ms(r), r[4]!));
}

/** `decodeBP`: 6 B `[time][sys][dia]`, systolic row first; live and stored decode the same. */
function bloodPressure(p: number[], origin: SampleOrigin): RingEvent[] {
  return records(p, 6).flatMap((r): RingEvent[] => [
    { type: 'vendor', key: 'bp_sys', t: ms(r), value: r[4]!, unit: 'mmHg', origin },
    { type: 'vendor', key: 'bp_dia', t: ms(r), value: r[5]!, unit: 'mmHg', origin },
  ]);
}

/**
 * `decodeTemperature`: stride = body / items; a record of 6 B or more reads `u16 / 10`, a 5 B record `u8 / 10`.
 * UNVERIFIED: the 5 B variant gives at most 25.5 °C, so the plausibility gate drops it; it may use another scale.
 */
function temperature(p: number[], isHistory: boolean): RingEvent[] {
  const recs = records(p, null);
  if (recs.length === 0) return isHistory ? [] : [ack(DT.REAL_TEMP)];
  return recs.map((r) => {
    const raw = r.length >= 6 ? u16(r, 4) : r.length > 4 ? r[4]! : 0;
    return sample('skin_temp', ms(r), raw / 10, isHistory ? 'history' : 'live');
  });
}

// ---------------------------------------------------------------- sleep (`decodeSleep`, `sleepSessions`)

interface SleepEntry {
  type: number;
  time: number;
}

/**
 * `[total u16][pageCount u8]`, then pages of `[validCount]` + 15 × `[type u8][time u32]`. Types: 1 start, 2 deep, 3 light,
 * 4 wake (ends a session), 5 movement. Each entry lasts until the next; floor(delta / 60) minutes of the earlier entry's
 * stage (2 deep, 1/3/5 light). `complete` = the session ended on a wake entry (our rule; the Kotlin has no such flag).
 */
export function decodeSleep(p: number[], firmware: string): RingEvent[] {
  if (p.length < 3) return [ack(DT.SLEEP)];
  const entries: SleepEntry[] = [];
  let o = 3;
  for (let page = 0; page < p[2]!; page++) {
    if (o >= p.length) break;
    const valid = p[o]!;
    o += 1;
    for (let slot = 0; slot < 15; slot++) {
      if (o + 5 > p.length) break;
      if (slot < valid) entries.push({ type: p[o]!, time: u32(p, o + 1) });
      o += 5;
    }
  }
  const out: RingEvent[] = [];
  let start: number | null = null;
  let stages: SleepStage[] = [];
  let codes: number[] = [];
  let lastEndS = 0;
  const flush = (complete: boolean): void => {
    if (start !== null && stages.length > 0) {
      const endS = start + stages.length * 60;
      if (start >= lastEndS) {
        out.push({ type: 'sleepEpochs', start: start * 1000, epochS: 60, stages, rawCodes: codes, firmware, complete });
        lastEndS = endS;
      }
    }
    start = null;
    stages = [];
    codes = [];
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.type === 1) flush(false); // an explicit start closes any open session
    if (start === null) start = e.time; // implicit start
    if (e.type === 4) {
      flush(true); // wake ends the session (so 'awake' is never produced)
      continue;
    }
    const next = entries[i + 1];
    if (!next) continue; // the last entry has no duration
    // A corrupt or reordered timestamp must not expand into an unbounded stage array.
    const minutes = Math.trunc((next.time - e.time) / 60);
    if (minutes < 0 || minutes > 24 * 60 || stages.length + minutes > 24 * 60) {
      flush(false);
      continue;
    }
    const stage: SleepStage = e.type === 2 ? 'deep' : 'light';
    for (let m = 0; m < minutes; m++) {
      stages.push(stage);
      codes.push(e.type);
    }
  }
  flush(false);
  return out;
}
