/**
 * J-Style 2301 notification decoder. Tier P. Port of the owner's `ring/JStyle2301Decoder.kt` (R10 §4.3): same record
 * cutters, BCD timestamps (`YY MM DD hh mm ss` at bytes 3–8, ring-local wall time), field offsets and plausibility gates.
 * Kotlin event kinds are mapped onto the Vitals `RingDecodedEvent` union:
 *   HistoryMeasurement HR/SpO2/temp/HRV → `sample` (origin 'history'); STRESS → `vendor` 'stress';
 *   VendorMetric → `vendor` (same keys); ActivityBucket → `activityBucket`; ActivityUpdate (0x51 day total) → `vendor`
 *   'daily_*' values (not buckets, so day sums are not double counted against 0x52); SleepTimeline → `sleepEpochs`;
 *   Battery/FirmwareRevision/AuthenticationResult/CommandAck/Unknown → `status`; measurement replies → `sample` spot/live.
 */
import type { RingDecodedEvent } from '../types';
import { HISTORY_STREAMS, OP, historyStreamForOpcode, type HistoryStreamDef } from './commands';
import { firmwareProfile, type FirmwareProfile } from './firmware';

export interface DecodeContext {
  /** Last firmware revision seen ('V0525'…); null until the 0x27 reply. */
  firmware: string | null;
  /** UTC offset (s, east positive) used to read ring-local wall time; the phone's offset at sync (R10 §4.4). */
  tzOffsetS: number;
  /** Epoch ms used to stamp live/spot readings (they carry no timestamp). */
  nowMs: number;
}

export interface DecodeResult {
  events: RingDecodedEvent[];
  /** Set when this packet was a firmware reply. */
  firmware?: string;
  /** Set when this packet was an authentication reply. */
  authAccepted?: boolean;
  battery?: number;
}

const u16le = (d: Uint8Array, o: number): number => (o + 2 > d.length ? 0 : (d[o] ?? 0) | ((d[o + 1] ?? 0) << 8));
const u32le = (d: Uint8Array, o: number): number =>
  o + 4 > d.length ? 0 : ((d[o] ?? 0) | ((d[o + 1] ?? 0) << 8) | ((d[o + 2] ?? 0) << 16)) + (d[o + 3] ?? 0) * 0x1000000;
const INT_MAX = 0x7fffffff;
const hex2 = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

export function bcd(byte: number): number | null {
  const hi = byte >>> 4;
  const lo = byte & 0x0f;
  return hi <= 9 && lo <= 9 ? hi * 10 + lo : null;
}

/** Validates like `java.time.LocalDateTime.of` and converts ring-local wall time to epoch ms. */
function wallToEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number, tzOffsetS: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(ms);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms - tzOffsetS * 1000;
}

/** BCD `YY MM DD hh mm ss` at `offset` (default 3). */
export function timestamp(rec: Uint8Array, tzOffsetS: number, offset = 3): number | null {
  if (rec.length < offset + 6) return null;
  const f: number[] = [];
  for (let i = offset; i < offset + 6; i++) {
    const v = bcd(rec[i] ?? 0);
    if (v === null) return null;
    f.push(v);
  }
  return wallToEpoch(2000 + f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!, tzOffsetS);
}

/** BCD `YY MM DD` at `offset`, local start of day. */
export function date(rec: Uint8Array, offset: number, tzOffsetS: number): number | null {
  if (rec.length < offset + 3) return null;
  const y = bcd(rec[offset] ?? 0);
  const m = bcd(rec[offset + 1] ?? 0);
  const d = bcd(rec[offset + 2] ?? 0);
  if (y === null || m === null || d === null) return null;
  return wallToEpoch(2000 + y, m, d, 0, 0, 0, tzOffsetS);
}

/** Firmware reply bytes 1–4 as unpadded upper-case hex digits: `27 00 07 08 09` → 'V0789'. */
export function firmwareString(p: Uint8Array): string | null {
  if (p.length < 5) return null;
  return `V${Array.from(p.subarray(1, 5), (b) => b.toString(16).toUpperCase()).join('')}`;
}

export function withoutTerminal(p: Uint8Array, s: HistoryStreamDef): Uint8Array {
  if (p.length >= 2 && p[p.length - 2] === s.opcode && p[p.length - 1] === 0xff) return p.subarray(0, p.length - 2);
  const size = s.recordSize;
  if (size !== null && p[p.length - 1] === 0xff && p.length % size === 1) return p.subarray(0, p.length - 1);
  return p;
}

export function fixedRecords(body: Uint8Array, opcode: number, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let off = 0; off + size <= body.length; off += size) {
    const r = body.subarray(off, off + size);
    if (r[0] === opcode) out.push(r);
  }
  return out;
}

function activityRecordSize(n: number): 26 | 27 {
  if (n === 2) return 27;
  if (n % 26 === 0) return 26;
  if (n % 27 === 0) return 27;
  if (n >= 2 && (n - 2) % 26 === 0) return 26;
  return 27;
}

const sample = (stream: 'hr' | 'spo2' | 'skin_temp' | 'hrv', t: number, value: number, origin: 'history' | 'spot' | 'live' = 'history'): RingDecodedEvent => ({
  type: 'sample', stream, t, value, unit: stream === 'hr' ? 'bpm' : stream === 'spo2' ? 'pct' : stream === 'skin_temp' ? 'degC' : 'ms', origin,
});
const vendor = (key: string, value: number, unit: string, t: number): RingDecodedEvent => ({ type: 'vendor', key, t, value, unit });

/** Sleep packet capacity: a full packet can no longer change, so it is `complete` (PROPOSED heuristic; partial = still filling). */
const SLEEP_130_MINUTES = 120;
const SLEEP_34_SLOTS = 24;

export function decodePacket(p: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (p.length === 0) return { events: [] };
  const profile = firmwareProfile(ctx.firmware);
  const op = p[0]!;
  switch (op) {
    case OP.INFO_BATTERY: {
      const pct = p[1];
      return pct === undefined ? { events: [] } : { events: [{ type: 'status', key: 'battery', value: pct }], battery: pct };
    }
    case OP.INFO_FIRMWARE: {
      const fw = firmwareString(p);
      return fw === null ? { events: [] } : { events: [{ type: 'status', key: 'firmware', value: fw }], firmware: fw };
    }
    case OP.AUTHENTICATE: {
      const ok = p[1] === 1;
      return { events: [{ type: 'status', key: 'ack', value: ok ? 'auth:accepted' : 'auth:rejected' }], authAccepted: ok };
    }
    case OP.MEASUREMENT_WITH_TYPE: {
      // Every 0x28 reply is health-classified; only type 2 carries HR at byte 2. Zero = start/stop ack (dropped downstream in Kotlin).
      if (p[1] !== OP.MEASUREMENT_TYPE_HEART_RATE) return { events: [] };
      const bpm = p[2] ?? 0;
      return { events: bpm > 0 ? [sample('hr', ctx.nowMs, bpm, 'spot')] : [{ type: 'status', key: 'ack', value: hex2(op) }] };
    }
    case OP.REALTIME_STEP: {
      const bpm = p[21];
      return { events: bpm !== undefined && bpm >= 30 && bpm <= 220 ? [sample('hr', ctx.nowMs, bpm, 'live')] : [] };
    }
    case OP.SPORT_TELEMETRY: {
      if (p.length < 14) return { events: [] };
      const bpm = p[1]!;
      return { events: bpm >= 30 && bpm <= 220 ? [sample('hr', ctx.nowMs, bpm, 'live')] : [] };
    }
    case OP.SPORT_MODE:
    case OP.INFO_CHIP:
    case OP.INFO_NAME:
      return { events: [{ type: 'status', key: 'ack', value: hex2(op) }] };
  }
  const s = historyStreamForOpcode(op);
  if (!s) return { events: [{ type: 'status', key: 'ack', value: `unknown:${hex2(op)}` }] };
  return { events: decodeHistory(withoutTerminal(p, s), s, profile, ctx.tzOffsetS, ctx.firmware ?? '') };
}

function decodeHistory(body: Uint8Array, s: HistoryStreamDef, fw: FirmwareProfile, tz: number, firmware: string): RingDecodedEvent[] {
  switch (s.opcode) {
    case HISTORY_STREAMS.ACTIVITY_TOTAL.opcode:
      return activityTotal(body, fw, tz);
    case HISTORY_STREAMS.ACTIVITY_DETAIL.opcode:
      return activityDetail(body, tz);
    case HISTORY_STREAMS.SLEEP.opcode:
      return sleep(body, fw, tz, firmware);
    case HISTORY_STREAMS.WORKOUT_HEART_RATE.opcode:
      return fixedRecords(body, s.opcode, 24).flatMap((r) => {
        const at = timestamp(r, tz);
        if (at === null) return [];
        const out: RingDecodedEvent[] = [];
        for (let i = 0; i < 15; i++) {
          const bpm = r[9 + i]!;
          if (bpm !== 0) out.push(sample('hr', at + i * 10_000, bpm));
        }
        return out;
      });
    case HISTORY_STREAMS.HEART_RATE.opcode:
      return scalar(body, s, tz, (r, at) => sample('hr', at, r[9]!));
    case HISTORY_STREAMS.HRV.opcode:
      return hrv(body, fw, tz);
    case HISTORY_STREAMS.TEMPERATURE.opcode:
      return scalar(body, s, tz, (r, at) => sample('skin_temp', at, Math.round(u16le(r, 9)) / 10));
    case HISTORY_STREAMS.SPO2.opcode:
      return scalar(body, s, tz, (r, at) => sample('spo2', at, r[9]!));
  }
  return [];
}

function scalar(body: Uint8Array, s: HistoryStreamDef, tz: number, f: (r: Uint8Array, at: number) => RingDecodedEvent): RingDecodedEvent[] {
  return fixedRecords(body, s.opcode, s.recordSize!).flatMap((r) => {
    const at = timestamp(r, tz);
    return at === null ? [] : [f(r, at)];
  });
}

function activityTotal(body: Uint8Array, fw: FirmwareProfile, tz: number): RingDecodedEvent[] {
  const size = activityRecordSize(body.length);
  return fixedRecords(body, 0x51, size).flatMap((r) => {
    const at = date(r, 2, tz);
    if (at === null) return [];
    const steps = Math.min(u32le(r, 5), INT_MAX);
    const exerciseRaw = u32le(r, 9);
    const distanceM = Math.min(u32le(r, 13) * 10, INT_MAX); // vendor field is 10 m units
    const kcal = Math.round(u32le(r, 17) / 100);
    const goal = size === 26 ? r[21]! : u16le(r, 21);
    const opaqueActive = u32le(r, size - 4);
    const active = fw.activeMinutes(exerciseRaw);
    const out: RingDecodedEvent[] = [
      vendor('daily_steps', steps, 'count', at),
      vendor('daily_distance', distanceM, 'm', at),
      vendor('daily_kcal', kcal, 'kcal', at),
    ];
    if (active !== null) out.push(vendor('active_minutes', active, 'min', at));
    out.push(vendor('exercise_duration_raw', exerciseRaw, 's', at), vendor('active_time_raw', opaqueActive, 'vendor_units', at));
    if (goal > 0) out.push(vendor('step_goal', goal, 'steps', at));
    return out;
  });
}

function activityDetail(body: Uint8Array, tz: number): RingDecodedEvent[] {
  return fixedRecords(body, 0x52, 25).flatMap((r) => {
    const at = timestamp(r, tz);
    if (at === null) return [];
    const totalSteps = u16le(r, 9);
    const totalKcal = u16le(r, 11) / 100;
    const totalDistanceM = u16le(r, 13) * 10;
    const minute = Array.from(r.subarray(15, 25));
    const minuteTotal = minute.reduce((a, b) => a + b, 0);
    const out: RingDecodedEvent[] = [];
    // Exact 10-minute record value; vendor-namespaced until the ring vs app daily kcal gap is explained (Kotlin comment).
    if (totalKcal > 0) out.push(vendor('activity_detail_calories', totalKcal, 'kcal', at));
    if (minuteTotal <= 0) {
      if (totalSteps > 0) out.push({ type: 'activityBucket', start: at, durS: 600, steps: totalSteps, distanceM: totalDistanceM });
      return out;
    }
    const populated = minute.flatMap((v, i) => (v > 0 ? [i] : []));
    const last = populated[populated.length - 1];
    let assigned = 0;
    minute.forEach((steps, i) => {
      if (steps <= 0) return;
      let d: number;
      if (i === last) d = totalDistanceM - assigned;
      else {
        d = Math.round((totalDistanceM * steps) / minuteTotal);
        assigned += d;
      }
      out.push({ type: 'activityBucket', start: at + i * 60_000, durS: 60, steps, distanceM: Math.max(0, d) });
    });
    return out;
  });
}

function sleep(body: Uint8Array, fw: FirmwareProfile, tz: number, firmware: string): RingDecodedEvent[] {
  if (body.length === 130) {
    const at = timestamp(body, tz);
    if (at === null) return [];
    const count = Math.min(body[9]!, body.length - 10);
    const raw = Array.from(body.subarray(10, 10 + count));
    if (raw.length === 0) return [];
    return [{ type: 'sleepEpochs', start: at, epochS: 60, stages: raw.map(fw.sleepStage), rawCodes: raw, firmware, complete: count === SLEEP_130_MINUTES }];
  }
  return fixedRecords(body, 0x53, 34).flatMap((r): RingDecodedEvent[] => {
    const at = timestamp(r, tz);
    if (at === null) return [];
    const count = Math.min(r[9]!, SLEEP_34_SLOTS);
    // One byte per 5 minutes (implemented in Kotlin, not separately validated: R10 Unverified), expanded to 1-min epochs.
    const raw = Array.from(r.subarray(10, 10 + count)).flatMap((b) => [b, b, b, b, b]);
    if (raw.length === 0) return [];
    return [{ type: 'sleepEpochs', start: at, epochS: 60, stages: raw.map(fw.sleepStage), rawCodes: raw, firmware, complete: count === SLEEP_34_SLOTS }];
  });
}

function hrv(body: Uint8Array, fw: FirmwareProfile, tz: number): RingDecodedEvent[] {
  return fixedRecords(body, 0x56, 15).flatMap((r) => {
    const at = timestamp(r, tz);
    if (at === null) return [];
    const [rawHrv, age, hr, stress, sys, dia] = [r[9]!, r[10]!, r[11]!, r[12]!, r[13]!, r[14]!];
    const out: RingDecodedEvent[] = [];
    if (rawHrv > 0) {
      out.push(vendor('hrv_raw', rawHrv, 'vendor_units', at));
      const ms = fw.hrvMillis(rawHrv);
      if (ms !== null) out.push(sample('hrv', at, ms));
    }
    if (age > 0) out.push(vendor('vascular_age', age, 'years', at));
    if (hr > 0) out.push(sample('hr', at, hr));
    if (stress > 0) out.push(vendor('stress', stress, 'vendor_units', at));
    // Opaque firmware estimates, not cuff readings: vendor-namespaced only.
    if (sys >= 60 && sys <= 250 && dia >= 30 && dia <= 150) {
      out.push(vendor('blood_pressure_systolic_estimate', sys, 'mmHg', at), vendor('blood_pressure_diastolic_estimate', dia, 'mmHg', at));
    }
    return out;
  });
}
