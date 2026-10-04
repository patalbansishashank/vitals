/**
 * YCBT decoders. Tier P. Port of Lumen's `YCBTDecoder.kt` (replies and pushes) and `YCBTHealthRecords.kt` (history
 * buffers), plus the mapping of Lumen's `RingDecodedEvent`s onto `RingEvent`s (docs/ycbt.md, "Mapping to RingEvent").
 *
 * The decoders return `YcbtDecoded`: Lumen's event classes by name (`kotlin`) with Lumen's field names, so the golden
 * vectors compare directly. Times are epoch ms; live frames are stamped with the phone time (`nowMs`).
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import type { RingEvent, SleepStage } from '../types';
import {
  APP, DEV, GET, GROUP, MODE, REAL, SETTING, ringTimeToMs, supportFunctions, zoneOffsetS,
  type Capability, type HistoryTypeName, type YcbtFrame, type ZoneContext,
} from './commands';

export type MeasurementKind = 'HEART_RATE' | 'SPO2' | 'HRV' | 'TEMPERATURE' | 'RESPIRATORY_RATE' | 'BLOOD_SUGAR' | 'STRESS' | 'FATIGUE' | 'VO2MAX';
export type KotlinStage = 'DEEP' | 'LIGHT' | 'REM' | 'AWAKE' | 'UNKNOWN';

export type YcbtDecoded =
  | { kotlin: 'CommandAck'; commandId: number }
  | { kotlin: 'TimeSyncAck' }
  | { kotlin: 'HeartRateSample'; bpm: number; _timestamp: number }
  | { kotlin: 'Spo2Result'; value: number; _timestamp: number }
  | { kotlin: 'HrvSample'; value: number; _timestamp: number }
  | { kotlin: 'TemperatureSample'; celsius: number; _timestamp: number }
  | { kotlin: 'BloodPressureSample'; systolic: number; diastolic: number; _timestamp: number; isHistory: boolean }
  | { kotlin: 'BloodSugarSample'; mgdl: number; _timestamp: number }
  | { kotlin: 'ActivityUpdate'; steps: number; distanceMeters: number; calories: number; _timestamp: number }
  | { kotlin: 'Battery'; percent: number }
  | { kotlin: 'Status'; firmware: string | null }
  | { kotlin: 'SupportFunctions'; capabilities: Capability[] }
  | { kotlin: 'ChipScheme'; value: number }
  | { kotlin: 'WearingStatus'; worn: boolean; _timestamp: number }
  | { kotlin: 'MeasurementComplete'; mode: number; success: boolean }
  | { kotlin: 'MeasurementRejected'; mode: number }
  | { kotlin: 'HistoryMeasurement'; kind_field: MeasurementKind; value: number; _timestamp: number }
  | { kotlin: 'ActivityBucket'; steps: number; distanceMeters: number; _timestamp: number; endTimestamp: number }
  | { kotlin: 'SleepTimeline'; _timestamp: number; stages: KotlinStage[]; codes: number[]; completeSession: true }
  | { kotlin: 'HistorySyncProgress'; stage: string; type: HistoryTypeName }
  | { kotlin: 'HistorySyncFinished' }
  | { kotlin: 'Unknown'; commandId: number };

export interface DecodeContext extends ZoneContext {
  nowMs: number;
}

const u16 = (b: ArrayLike<number>, i: number): number => (b.length < i + 2 ? 0 : b[i]! | (b[i + 1]! << 8));
/** `YCBTBytes.u24`: 0 on a short buffer. */
export const u24 = (b: ArrayLike<number>, i: number): number => (b.length < i + 3 ? 0 : b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16));
const u32 = (b: ArrayLike<number>, i: number): number => (b.length < i + 4 ? 0 : (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0);

/** `RingEventBridge.spo2Range`. */
const spo2Ok = (v: number): boolean => v >= 70 && v <= 100;
/** `YCBTHealthRecords.composite`: digits joined with a point (36 and 5 → 36.5; 36 and 25 → 36.25). */
export const composite = (integer: number, fraction: number): number => Number(`${integer}.${fraction}`);
/** `YCBTHealthRecords.score`: digits joined (5 and 3 → 53). UNVERIFIED in the Kotlin. */
export const score = (integer: number, fraction: number): number => Number(`${integer}${fraction}`);
/** UNVERIFIED in the Kotlin: payloads look like tenths of mmol/L. */
export const MGDL_PER_MMOL = 18.016;
export const bloodSugarMgdl = (tenths: number): number => (tenths / 10) * MGDL_PER_MMOL;

// ---------------------------------------------------------------- replies and pushes (`YCBTDecoder.decode`)

/** One validated non-Health frame. `startedMode` is the start the `03 2f` reply pairs with (the FIFO in the protocol). */
export function decodeFrame(f: YcbtFrame, ctx: DecodeContext, startedMode: number | null = null): YcbtDecoded[] {
  const ack = (id = f.cmd): YcbtDecoded[] => [{ kotlin: 'CommandAck', commandId: id }];
  const p = f.payload;
  const now = ctx.nowMs;
  switch (f.type) {
    case GROUP.REAL:
      switch (f.cmd) {
        case REAL.STATUS:
          return p.length < 6 ? ack() : [{ kotlin: 'ActivityUpdate', steps: u16(p, 0), distanceMeters: u16(p, 2), calories: u16(p, 4), _timestamp: now }];
        case REAL.HEART_RATE:
          return p.length < 1 ? ack() : [{ kotlin: 'HeartRateSample', bpm: p[0]!, _timestamp: now }];
        case REAL.SPO2:
          return p.length >= 1 && spo2Ok(p[0]!) ? [{ kotlin: 'Spo2Result', value: p[0]!, _timestamp: now }] : ack();
        case REAL.VITALS:
          return liveVitals(p, f.cmd, now);
        case REAL.BATTERY:
          return p.length < 2 ? ack() : [{ kotlin: 'Battery', percent: p[1]! }];
        case REAL.WEARING:
          return p.length < 5 ? ack() : [{ kotlin: 'WearingStatus', worn: p[4] !== 0, _timestamp: ringTimeToMs(u32(p, 0), ctx) }];
      }
      return ack();
    case GROUP.DEV_CONTROL:
      if (f.cmd === DEV.MEASUREMENT_STATUS) {
        const e = measurementStatus(p, ctx);
        return e.length ? e : ack();
      }
      // `04 0e [mode][status]`: 1 success, 2 failed, anything else cancelled; carries no value.
      if (f.cmd === DEV.MEASUREMENT_RESULT) return p.length < 2 ? ack() : [{ kotlin: 'MeasurementComplete', mode: p[0]!, success: p[1] === 1 }];
      return ack();
    case GROUP.GET:
      if (f.cmd === GET.DEVICE_INFO) {
        // `[2]` minor, `[3]` major (`"%d.%02d"`), `[5]` battery. No serial, no model.
        const fw = p.length > 3 ? `${p[3]}.${String(p[2]).padStart(2, '0')}` : null;
        const out: YcbtDecoded[] = [{ kotlin: 'Status', firmware: fw }];
        if (p.length >= 6) out.push({ kotlin: 'Battery', percent: p[5]! });
        return out;
      }
      if (f.cmd === GET.SUPPORT_FUNCTION) return [{ kotlin: 'SupportFunctions', capabilities: supportFunctions(p) }];
      // `YCBTChipScheme.value`: 240 or more reads as 0. Diagnostic only.
      if (f.cmd === GET.CHIP_SCHEME) return [{ kotlin: 'ChipScheme', value: p.length === 0 || p[0]! >= 240 ? 0 : p[0]! }];
      return ack();
    case GROUP.APP_CONTROL:
      if (f.cmd !== APP.LIVE_MEASUREMENT) return ack();
      // `decodeMeasurementStartReply`: a non-zero status paired with a start is a refusal; anything else an ack.
      if (p.length !== 1 || p[0] === 0 || startedMode === null) return ack();
      return [{ kotlin: 'MeasurementRejected', mode: startedMode }];
    case GROUP.SETTING:
      return f.cmd === SETTING.SET_TIME ? [{ kotlin: 'TimeSyncAck' }] : ack();
  }
  return ack();
}

function liveVitals(p: Uint8Array, cmd: number, now: number): YcbtDecoded[] {
  const out: YcbtDecoded[] = [];
  if (p.length >= 2 && p[0]! > 0 && p[1]! > 0) out.push({ kotlin: 'BloodPressureSample', systolic: p[0]!, diastolic: p[1]!, _timestamp: now, isHistory: false });
  if (p.length >= 3 && p[2]! > 0) out.push({ kotlin: 'HeartRateSample', bpm: p[2]!, _timestamp: now });
  if (p.length >= 4 && p[3]! > 0) out.push({ kotlin: 'HrvSample', value: p[3]!, _timestamp: now });
  if (p.length >= 5 && spo2Ok(p[4]!)) out.push({ kotlin: 'Spo2Result', value: p[4]!, _timestamp: now });
  if (p.length >= 7 && p[5]! > 0) out.push({ kotlin: 'TemperatureSample', celsius: composite(p[5]!, p[6]!), _timestamp: now });
  return out.length ? out : [{ kotlin: 'CommandAck', commandId: cmd }];
}

/** `04 13 [mode][?][value][fraction]`. Byte 1 is unread. HRV has no captured layout and stays undecoded. */
function measurementStatus(p: Uint8Array, ctx: DecodeContext): YcbtDecoded[] {
  if (p.length < 3) return [];
  const value = p[2]!;
  const fraction = p.length >= 4 ? p[3]! : 0;
  const t = ctx.nowMs;
  switch (p[0]) {
    case MODE.HEART_RATE:
      return value > 0 ? [{ kotlin: 'HeartRateSample', bpm: value, _timestamp: t }] : [];
    case MODE.BLOOD_PRESSURE:
      return value > 0 && fraction > 0 ? [{ kotlin: 'BloodPressureSample', systolic: value, diastolic: fraction, _timestamp: t, isHistory: false }] : [];
    case MODE.SPO2:
      return spo2Ok(value) ? [{ kotlin: 'Spo2Result', value, _timestamp: t }] : [];
    case MODE.TEMPERATURE:
      return value > 0 ? [{ kotlin: 'TemperatureSample', celsius: composite(value, fraction), _timestamp: t }] : [];
    case MODE.BLOOD_SUGAR: {
      const tenths = value * 10 + fraction;
      return tenths > 0 ? [{ kotlin: 'BloodSugarSample', mgdl: bloodSugarMgdl(tenths), _timestamp: t }] : [];
    }
  }
  return [];
}

// ---------------------------------------------------------------- history records (`YCBTHealthRecords`)

const TEMPERATURE_FILLER = 15;
const MAX_SLEEP_MIN = 24 * 60;

function records(buf: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size)); // a partial trailing record is dropped
  return out;
}

const hm = (kind: MeasurementKind, value: number, t: number): YcbtDecoded => ({ kotlin: 'HistoryMeasurement', kind_field: kind, value, _timestamp: t });
const bp = (sys: number, dia: number, t: number): YcbtDecoded[] => (sys > 0 && dia > 0 ? [{ kotlin: 'BloodPressureSample', systolic: sys, diastolic: dia, _timestamp: t, isHistory: true }] : []);
const temp = (int: number, frac: number, t: number): YcbtDecoded[] => (int <= 0 || frac === TEMPERATURE_FILLER ? [] : [hm('TEMPERATURE', composite(int, frac), t)]);

/** `YCBTHealthRecords.decode`: one reassembled buffer of a history type. */
export function decodeHistory(buf: Uint8Array, type: HistoryTypeName, zone: ZoneContext): YcbtDecoded[] {
  const at = (r: Uint8Array): number => ringTimeToMs(u32(r, 0), zone);
  const out: YcbtDecoded[] = [];
  switch (type) {
    case 'sport':
      // `[0..3]` start, `[4..7]` end (Lumen leaves it unread; kept for durS), `[8..9]` steps, `[10..11]` metres.
      for (const r of records(buf, 14)) {
        const steps = u16(r, 8);
        const distance = u16(r, 10);
        if (steps > 0 || distance > 0) out.push({ kotlin: 'ActivityBucket', steps, distanceMeters: distance, _timestamp: at(r), endTimestamp: ringTimeToMs(u32(r, 4), zone) });
      }
      return out;
    case 'heart':
      for (const r of records(buf, 6)) if (r[5]! > 0) out.push(hm('HEART_RATE', r[5]!, at(r)));
      return out;
    case 'blood':
      for (const r of records(buf, 8)) {
        out.push(...bp(r[5]!, r[6]!, at(r)));
        if (r[7]! > 0) out.push(hm('HEART_RATE', r[7]!, at(r)));
      }
      return out;
    case 'all':
      // `[4..6]` is a step-like field Lumen ignores on purpose (it lags and made today's steps jump).
      for (const r of records(buf, 20)) {
        const t = at(r);
        out.push(...bp(r[7]!, r[8]!, t));
        if (r[9]! > 0) out.push(hm('SPO2', r[9]!, t));
        if (r[10]! > 0) out.push(hm('RESPIRATORY_RATE', r[10]!, t));
        if (r[11]! > 0) out.push(hm('HRV', r[11]!, t));
        out.push(...temp(r[13]!, r[14]!, t));
        if (r[17]! > 0) out.push(hm('BLOOD_SUGAR', bloodSugarMgdl(r[17]!), t));
      }
      return out;
    case 'spo2':
      for (const r of records(buf, 6)) if (r[5]! > 0) out.push(hm('SPO2', r[5]!, at(r)));
      return out;
    case 'temperature':
      for (const r of records(buf, 7)) out.push(...temp(r[5]!, r[6]!, at(r)));
      return out;
    case 'comprehensive':
      for (const r of records(buf, 44)) {
        const tenths = r[5]! * 10 + r[6]!;
        if (tenths > 0) out.push(hm('BLOOD_SUGAR', bloodSugarMgdl(tenths), at(r)));
      }
      return out;
    case 'body_data':
      for (const r of records(buf, 28)) {
        const t = at(r);
        if (r[6]! > 0) out.push(hm('HRV', composite(r[6]!, r[7]!), t));
        if (r[8]! > 0) out.push(hm('STRESS', score(r[8]!, r[9]!), t));
        if (r[10]! > 0) out.push(hm('FATIGUE', score(r[10]!, r[11]!), t));
        if (r[16]! > 0) out.push(hm('VO2MAX', r[16]!, t));
      }
      return out;
    case 'sleep':
      return sleep(buf, zone);
  }
  return out;
}

const STAGE_BY_NIBBLE: Record<number, KotlinStage> = { 1: 'DEEP', 2: 'LIGHT', 3: 'REM', 4: 'AWAKE', 5: 'UNKNOWN' };
const isHeader = (b: Uint8Array, i: number): boolean => i + 1 < b.length && b[i] === 0xaf && b[i + 1] === 0xfa;
const usableBounds = (s: number, e: number): boolean => s > 0 && e > s && (e - s) / 60 <= MAX_SLEEP_MIN;
/** Kotlin's `round` (half up, as `Math.round` on doubles). */
const roundK = (x: number): number => Math.round(x);

/**
 * `YCBTHealthRecords.sleep`: `af fa` sessions (20-byte header: length, u32 start, u32 end) of 8-byte segments
 * (tag, u32 start, u24 seconds). With usable header bounds the timeline spans exactly start..end, filled with awake and
 * each segment placed at its own start; otherwise segments are concatenated (capped at one day).
 */
function sleep(buf: Uint8Array, zone: ZoneContext): YcbtDecoded[] {
  const out: YcbtDecoded[] = [];
  let cursor = 0;
  while (cursor + 20 <= buf.length) {
    if (!isHeader(buf, cursor)) {
      let next = -1;
      for (let i = cursor + 1; i + 1 < buf.length; i++) if (isHeader(buf, i)) { next = i; break; }
      if (next < 0) break;
      cursor = next;
      continue;
    }
    const recordLength = u16(buf, cursor + 2);
    const hs = u32(buf, cursor + 4);
    const he = u32(buf, cursor + 8);
    const segStart = cursor + 20;
    const count = Math.min(Math.floor(Math.max(0, recordLength - 20) / 8), Math.floor((buf.length - segStart) / 8));
    const segs: Array<{ stage: KotlinStage; code: number; start: number; secs: number }> = [];
    const seen = new Set<number>();
    for (let k = 0; k < count; k++) {
      const o = segStart + k * 8;
      const stage = STAGE_BY_NIBBLE[buf[o]! & 0x0f];
      if (!stage) continue;
      const start = u32(buf, o + 1);
      const secs = u24(buf, o + 5);
      if (secs <= 0) continue; // a zero-length segment must not shadow a real one sharing its start
      if (seen.has(start)) continue;
      seen.add(start);
      segs.push({ stage, code: buf[o]!, start, secs });
    }
    const placed = placeStages(segs, hs, he);
    if (segs.length && placed.stages.length) {
      const start = usableBounds(hs, he) ? hs : segs[0]!.start;
      out.push({ kotlin: 'SleepTimeline', _timestamp: ringTimeToMs(start, zone), stages: placed.stages, codes: placed.codes, completeSession: true });
    }
    cursor = segStart + count * 8;
  }
  return out;
}

function placeStages(segs: Array<{ stage: KotlinStage; code: number; start: number; secs: number }>, hs: number, he: number): { stages: KotlinStage[]; codes: number[] } {
  const stages: KotlinStage[] = [];
  const codes: number[] = [];
  if (!segs.length) return { stages, codes };
  if (!usableBounds(hs, he)) {
    for (const s of segs) {
      const remaining = MAX_SLEEP_MIN - stages.length;
      if (remaining <= 0) break;
      const minutes = Math.min(remaining, Math.max(1, roundK(s.secs / 60)));
      for (let i = 0; i < minutes; i++) {
        stages.push(s.stage);
        codes.push(s.code);
      }
    }
    return { stages, codes };
  }
  const total = Math.min(MAX_SLEEP_MIN, Math.max(1, roundK((he - hs) / 60)));
  // A minute no segment claims is wake (raw code 0).
  for (let i = 0; i < total; i++) {
    stages.push('AWAKE');
    codes.push(0);
  }
  for (const s of segs) {
    const from = roundK((s.start - hs) / 60);
    const until = roundK((s.start + s.secs - hs) / 60);
    for (let m = Math.max(0, from); m < Math.min(total, until); m++) {
      stages[m] = s.stage;
      codes[m] = s.code;
    }
  }
  return { stages, codes };
}

// ---------------------------------------------------------------- RingEvent mapping

const STAGE: Record<KotlinStage, SleepStage> = { DEEP: 'deep', LIGHT: 'light', REM: 'rem', AWAKE: 'awake', UNKNOWN: 'unknown' };
const HISTORY_SAMPLE: Partial<Record<MeasurementKind, readonly [BioStream, string]>> = {
  HEART_RATE: ['hr', 'bpm'], SPO2: ['spo2', '%'], HRV: ['hrv', 'ms'], TEMPERATURE: ['skin_temp', '°C'], RESPIRATORY_RATE: ['resp_rate', 'brpm'],
};
const HISTORY_VENDOR: Partial<Record<MeasurementKind, readonly [string, string]>> = {
  BLOOD_SUGAR: ['ycbt_glucose', 'mg/dL'], STRESS: ['ycbt_stress', 'score'], FATIGUE: ['ycbt_fatigue', 'score'], VO2MAX: ['ycbt_vo2max', 'ml/kg/min'],
};

/** Epoch ms of the local midnight that starts `t`'s day (the `dailyTotal.localDay` convention of records.ts). */
export function localDay(t: number, zone: ZoneContext): number {
  const off = (zone.tz ? zoneOffsetS(zone.tz, t) : zone.tzOffsetS) * 1000;
  return Math.floor((t + off) / 86_400_000) * 86_400_000 - off;
}

/**
 * Lumen's events as `RingEvent`s. `origin` is `history` for records, `live` for `06 xx`, `spot` for `04 13` (the
 * session re-labels samples during a spot). Acknowledgements become `status:ack`; refusals and failed measurements
 * `status:error`; the chip scheme is diagnostic only and maps to nothing.
 */
export function toRingEvents(d: YcbtDecoded, zone: ZoneContext, firmware: string, origin: 'live' | 'spot' = 'live'): RingEvent[] {
  switch (d.kotlin) {
    case 'CommandAck':
      return [{ type: 'status', key: 'ack', value: d.commandId }];
    case 'TimeSyncAck':
      return [{ type: 'status', key: 'ack', value: 'time' }];
    case 'HeartRateSample':
      return [{ type: 'sample', stream: 'hr', t: d._timestamp, value: d.bpm, unit: 'bpm', origin }];
    case 'Spo2Result':
      return [{ type: 'sample', stream: 'spo2', t: d._timestamp, value: d.value, unit: '%', origin }];
    case 'HrvSample':
      return [{ type: 'sample', stream: 'hrv', t: d._timestamp, value: d.value, unit: 'ms', origin }];
    case 'TemperatureSample':
      return [{ type: 'sample', stream: 'skin_temp', t: d._timestamp, value: d.celsius, unit: '°C', origin }];
    case 'BloodPressureSample': {
      const o = d.isHistory ? 'history' : origin;
      return [
        { type: 'vendor', key: 'ycbt_bp_systolic', t: d._timestamp, value: d.systolic, unit: 'mmHg', origin: o },
        { type: 'vendor', key: 'ycbt_bp_diastolic', t: d._timestamp, value: d.diastolic, unit: 'mmHg', origin: o },
      ];
    }
    case 'BloodSugarSample':
      return [{ type: 'vendor', key: 'ycbt_glucose', t: d._timestamp, value: d.mgdl, unit: 'mg/dL', origin }];
    case 'ActivityUpdate':
      // Today's running totals, stamped with the phone time.
      return [{ type: 'dailyTotal', localDay: localDay(d._timestamp, zone), steps: d.steps, distanceM: d.distanceMeters, kcal: d.calories }];
    case 'Battery':
      return [{ type: 'status', key: 'battery', value: d.percent }];
    case 'Status':
      return d.firmware === null ? [] : [{ type: 'status', key: 'firmware', value: d.firmware }];
    case 'SupportFunctions':
      return [{ type: 'status', key: 'capabilities', value: d.capabilities.join(',') }];
    case 'ChipScheme':
      return [];
    case 'WearingStatus':
      return [{ type: 'vendor', key: 'ycbt_worn', t: d._timestamp, value: d.worn ? 1 : 0, unit: 'bool', origin: 'live' }];
    case 'MeasurementComplete':
      return [d.success ? { type: 'status', key: 'ack', value: `measurement_complete:${d.mode}` } : { type: 'status', key: 'error', value: `measurement_failed:${d.mode}` }];
    case 'MeasurementRejected':
      return [{ type: 'status', key: 'error', value: `measurement_rejected:${d.mode}` }];
    case 'HistoryMeasurement': {
      const s = HISTORY_SAMPLE[d.kind_field];
      if (s) return [{ type: 'sample', stream: s[0], t: d._timestamp, value: d.value, unit: s[1], origin: 'history' }];
      const v = HISTORY_VENDOR[d.kind_field]!;
      return [{ type: 'vendor', key: v[0], t: d._timestamp, value: d.value, unit: v[1], origin: 'history' }];
    }
    case 'ActivityBucket': {
      const durS = Math.max(0, Math.round((d.endTimestamp - d._timestamp) / 1000));
      return [{ type: 'activityBucket', start: d._timestamp, durS, steps: d.steps, distanceM: d.distanceMeters }];
    }
    case 'SleepTimeline':
      return [{ type: 'sleepEpochs', start: d._timestamp, epochS: 60, stages: d.stages.map((s) => STAGE[s]), rawCodes: d.codes, firmware, complete: true }];
    case 'HistorySyncProgress':
      return [{ type: 'progress', stage: d.type, done: false }];
    case 'HistorySyncFinished':
      return [{ type: 'progress', stage: 'history', done: true }];
    case 'Unknown':
      return [{ type: 'status', key: 'error', value: 'bad_frame' }];
  }
}
