/**
 * Colmi reply decoders. Tier P, stateless: day and paging bookkeeping lives in `./protocol.ts`.
 * Ported from the upstream Android Kotlin `ColmiDecoder.kt` (doc §6). The decoders return Kotlin-shaped events
 * (`kotlin` = the Kotlin `RingDecodedEvent` class) so the fixtures in `qa/fixtures/rings/colmi/decode.json` can be checked
 * one to one; `toRingEvents` maps them onto the library's `RingEvent` (doc §12).
 *
 * Times: live frames are stamped with `nowMs`; history sits on the LOCAL day grid (local midnight + slot × index) in the
 * zone the session stamped on the command (`tz`, else the fixed offset `tzOffsetS`); the Kotlin uses the system zone,
 * so a day before a daylight-saving change keeps its own offset (`LocalDate.minusDays(n).atStartOfDay(zone)`).
 */
import type { RingEvent, SleepStage } from '../types';
import { plausibleAggregate } from '../plausibility';
import {
  BIG, NOTIF_BATTERY, NOTIF_LIVE_ACTIVITY, OP, PREF_READ, RT_SPO2, civilDay, isValidFrame,
} from './commands';
import { zoneDayIndex, zoneMidnightMs, zoneWallToMs, type Zone } from '../zone';

export type HistoryKind = 'HEART_RATE' | 'HRV' | 'SPO2' | 'BLOOD_PRESSURE_SYSTOLIC' | 'BLOOD_PRESSURE_DIASTOLIC';

export type ColmiDecoded =
  | { kotlin: 'Battery'; percent: number }
  /** `source`: 'live' for 0x1e / 0x69, 'workout' for 0x78 sport telemetry. */
  | { kotlin: 'HeartRateSample'; bpm: number; t: number; source: 'live' | 'workout' }
  | { kotlin: 'HeartRateComplete'; t: number }
  | { kotlin: 'Spo2Result'; value: number; t: number }
  | { kotlin: 'Spo2Complete'; t: number }
  | { kotlin: 'SportTelemetry'; bpm: number; status: number; t: number }
  | { kotlin: 'ActivityUpdate'; steps: number; distanceMeters: number; calories: number; t: number }
  | { kotlin: 'CommandAck'; commandId: number }
  | { kotlin: 'Unknown'; commandId: number }
  | { kotlin: 'HistoryMeasurement'; kind_field: HistoryKind; value: number; t: number }
  | { kotlin: 'StressSample'; value: number; t: number }
  | { kotlin: 'ActivityBucket'; steps: number; distanceMeters: number; t: number }
  | { kotlin: 'TemperatureSample'; celsius: number; t: number }
  /** `codes`: the vendor stage code of every minute (the Kotlin expands one entry per minute). */
  | { kotlin: 'SleepTimeline'; t: number; codes: number[] };

const u16 = (b: ArrayLike<number>, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24be = (b: ArrayLike<number>, i: number): number => ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
const inRange = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;

// ---------------------------------------------------------------- normal channel (decodeNormal)

/** `ColmiDecoder.decodeNormal`: one 16-byte notification. A bad length or checksum is `Unknown`. */
export function decodeNormal(b: Uint8Array, nowMs: number): ColmiDecoded[] {
  if (!isValidFrame(b)) return [{ kotlin: 'Unknown', commandId: b[0] ?? 0 }];
  const v = b;
  switch (v[0]) {
    case OP.BATTERY:
      return [{ kotlin: 'Battery', percent: v[1]! }];
    case OP.MANUAL_HEART_RATE: {
      // [69][reading type][error][value]: type 3 is SpO2, anything else heart rate; error != 0 ends the run.
      const type = v[1]!;
      const err = v[2]!;
      const value = v[3]!;
      if (type === RT_SPO2) {
        if (err !== 0) return [{ kotlin: 'Spo2Complete', t: nowMs }];
        return inRange(value, 70, 100) ? [{ kotlin: 'Spo2Result', value, t: nowMs }] : []; // warm-up
      }
      if (err !== 0) return [{ kotlin: 'HeartRateComplete', t: nowMs }];
      return inRange(value, 30, 220) ? [{ kotlin: 'HeartRateSample', bpm: value, t: nowMs, source: 'live' }] : [];
    }
    case OP.REALTIME_HEART_RATE: {
      // provenance: Gadgetbridge (AGPL) 0x1E reply layout, via the Kotlin
      // UNVERIFIED on hardware: the Kotlin accepts both [1e][0][bpm] and the older [1e][bpm].
      const first = v[1]!;
      if (first === 0 && inRange(v[2]!, 30, 220)) return [{ kotlin: 'HeartRateSample', bpm: v[2]!, t: nowMs, source: 'live' }];
      if (inRange(first, 30, 220)) return [{ kotlin: 'HeartRateSample', bpm: first, t: nowMs, source: 'live' }];
      if (first !== 0) return [{ kotlin: 'HeartRateComplete', t: nowMs }];
      return []; // warm-up
    }
    case OP.REALTIME_HEART_RATE_ERROR:
      return [{ kotlin: 'HeartRateComplete', t: nowMs }];
    case OP.SPORT_NOTIFY:
      return decodeSportNotify(v, nowMs);
    case OP.NOTIFICATION:
      return decodeNotification(v, nowMs);
    case OP.BP_READ:
      return decodeBp(v);
    default:
      return [{ kotlin: 'CommandAck', commandId: v[0]! }];
  }
}

// provenance: decompiled vendor app (0x78 sport telemetry layout), via the Kotlin
/** `[78][dataType][status][durMin hi][durMin lo][bpm][steps×3][metres×3][cal×3]`; only bpm (and status, for the engine) are read. */
function decodeSportNotify(v: Uint8Array, nowMs: number): ColmiDecoded[] {
  const bpm = v[5]!;
  // The telemetry event comes first, even on a warm-up frame with bpm 0 (`decodeSportNotify`).
  const telemetry: ColmiDecoded = { kotlin: 'SportTelemetry', bpm, status: v[2]!, t: nowMs };
  return inRange(bpm, 30, 220) ? [telemetry, { kotlin: 'HeartRateSample', bpm, t: nowMs, source: 'workout' }] : [telemetry];
}

function decodeNotification(v: Uint8Array, nowMs: number): ColmiDecoded[] {
  if (v[1] === NOTIF_BATTERY) return [{ kotlin: 'Battery', percent: v[2]! }];
  if (v[1] === NOTIF_LIVE_ACTIVITY) {
    // Big-endian u24 steps, calories (cal → kcal by integer division), metres; a step count over 200 000 is dropped.
    const steps = u24be(v, 2);
    const calories = Math.floor(u24be(v, 5) / 1000);
    const distanceMeters = u24be(v, 8);
    if (!inRange(steps, 0, 200_000)) return [{ kotlin: 'CommandAck', commandId: v[0]! }];
    return [{ kotlin: 'ActivityUpdate', steps, distanceMeters, calories, t: nowMs }];
  }
  return [{ kotlin: 'CommandAck', commandId: v[0]! }];
}

/** Blood pressure is never requested; decoded defensively only (`decodeBpResponse`). */
function decodeBp(v: Uint8Array): ColmiDecoded[] {
  if (v[1] === 0xff && v[2] === 0xff && v[3] === 0xff && v[4] === 0xff) return [];
  const t = ((v[1]! | (v[2]! << 8) | (v[3]! << 16)) + v[4]! * 0x1000000) * 1000;
  const dia = v[5]!;
  const sys = v[6]!;
  if (sys === 0 && dia === 0) return [];
  return [
    { kotlin: 'HistoryMeasurement', kind_field: 'BLOOD_PRESSURE_SYSTOLIC', value: sys, t },
    { kotlin: 'HistoryMeasurement', kind_field: 'BLOOD_PRESSURE_DIASTOLIC', value: dia, t },
  ];
}

// ---------------------------------------------------------------- paged history (decodeHistory)

export interface HistoryContext {
  /** Local day number the frame belongs to (`syncDay`). */
  day: number;
  /** IANA zone (per-day daylight-saving offset); absent = the fixed `tzOffsetS`. */
  tz?: string;
  tzOffsetS: number;
  nowMs: number;
  /** Slot minutes from the day's packet 0; null = the per-stream default (HR 5, stress/HRV 30). */
  slotMinutes: number | null;
}

export const isHistoryOpcode = (op: number | undefined): boolean =>
  op === OP.SYNC_ACTIVITY || op === OP.SYNC_HEART_RATE || op === OP.SYNC_STRESS || op === OP.SYNC_HRV;

/** `ColmiDecoder.decodeHistory`: one history packet (0x15 HR, 0x37 stress, 0x39 HRV, 0x43 activity). */
export function decodeHistory(b: Uint8Array, ctx: HistoryContext): ColmiDecoded[] {
  if (!isValidFrame(b)) return [];
  switch (b[0]) {
    case OP.SYNC_HEART_RATE:
      return decodeDayLog(b, ctx, ctx.slotMinutes ?? 5, 6, 9, (value, t) => ({ kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value, t }));
    case OP.SYNC_STRESS:
      return decodeDayLog(b, ctx, ctx.slotMinutes ?? 30, 3, 12, (value, t) => ({ kotlin: 'StressSample', value, t }));
    case OP.SYNC_HRV:
      return decodeDayLog(b, ctx, ctx.slotMinutes ?? 30, 3, 12, (value, t) => ({ kotlin: 'HistoryMeasurement', kind_field: 'HRV', value, t }));
    case OP.SYNC_ACTIVITY:
      return decodeActivity(b, ctx);
    default:
      return [];
  }
}

/**
 * HR / stress / HRV day logs: packet 1 holds `firstCount` samples from byte `firstStart`, packet n ≥ 2 holds 13 from byte 2,
 * placed at local midnight + (offset + i) × slot; 0 = no sample; packet 0 and `ff` carry none.
 */
function decodeDayLog(v: Uint8Array, ctx: HistoryContext, slot: number, firstStart: number, firstCount: number, make: (value: number, t: number) => ColmiDecoded): ColmiDecoded[] {
  const packet = v[1]!;
  if (packet === 0xff || packet === 0) return [];
  const start = packet === 1 ? firstStart : 2;
  const before = packet > 1 ? (firstCount + (packet - 2) * 13) * slot : 0;
  const base = zoneMidnightMs(ctx.day, ctx);
  const out: ColmiDecoded[] = [];
  for (let i = start; i < v.length - 1; i++) {
    const value = v[i]!;
    if (value === 0) continue;
    out.push(make(value, base + (before + (i - start) * slot) * 60_000));
  }
  return out;
}

/** BCD byte read as decimal digits; NaN when a nibble is not 0..9 (the Kotlin throws there). */
function bcdValue(b: number): number {
  const hi = b >> 4;
  const lo = b & 0x0f;
  return hi > 9 || lo > 9 ? NaN : hi * 10 + lo;
}

/** 0x43 data packet: BCD local date, quarter-hour slot, steps and metres; kept only within now − 8 days .. now + 1 h. */
function decodeActivity(v: Uint8Array, ctx: HistoryContext): ColmiDecoded[] {
  const marker = v[1]!;
  if (marker === 0xff || marker === 0xf0) return [];
  const day = civilDay(2000 + bcdValue(v[1]!), bcdValue(v[2]!), bcdValue(v[3]!));
  // A non-BCD or impossible date: the Kotlin throws (non-BCD) or drops the packet (impossible date); here both drop it.
  if (!Number.isFinite(day)) return [];
  const slot = Math.min(95, Math.max(0, v[4]!));
  // Kotlin uses LocalDate.atTime(...).atZone(zone): the slot is wall time, including on a DST change.
  const t = zoneWallToMs(day * 86_400 + slot * 15 * 60, ctx);
  if (t < ctx.nowMs - 8 * 86_400_000 || t > ctx.nowMs + 3_600_000) return [];
  // Bytes 7..8 are calories; the Kotlin ignores them.
  return [{ kotlin: 'ActivityBucket', steps: u16(v, 9), distanceMeters: u16(v, 11), t }];
}

// ---------------------------------------------------------------- handshake replies

/** `decodeAutoHRPrefRead`: `[16][01][flag 01 on / 02 off][interval]`; null for anything else (write acks echo 02). */
export function decodeAutoHrPrefRead(b: Uint8Array): { enabled: boolean; intervalMinutes: number } | null {
  if (!isValidFrame(b) || b[0] !== OP.AUTO_HR_PREF || b[1] !== PREF_READ) return null;
  return { enabled: b[2] === 0x01, intervalMinutes: b[3]! };
}

/** `decodeTempPrefRead`: `[3a][03][01][enabled]`; null for write acks and other 0x3a frames. */
export function decodeTempPrefRead(b: Uint8Array): boolean | null {
  if (!isValidFrame(b) || b[0] !== OP.AUTO_TEMP_PREF || b[1] !== 0x03 || b[2] !== PREF_READ) return null;
  return b[3] === 0x01;
}

// provenance: decompiled vendor app (0x3C capability bits), via the Kotlin
/** `decodeDeviceSupport`: full-frame byte 2 bit 3 = wants an OS bond; byte 9 bit 7 = interval temperature path. */
export function decodeDeviceSupport(b: Uint8Array): { supportsBlePair: boolean; supportsIntervalTemp: boolean } | null {
  if (!isValidFrame(b) || b[0] !== OP.DEVICE_SUPPORT) return null;
  return { supportsBlePair: (b[2]! & 0x08) !== 0, supportsIntervalTemp: (b[9]! & 0x80) !== 0 };
}

// ---------------------------------------------------------------- big data (decodeBigData)

export interface BigDataContext {
  nowMs: number;
  tz?: string;
  tzOffsetS: number;
}

/** `ColmiDecoder.decodeBigData`: one reassembled big-data transfer (SpO2, sleep, nap, legacy temperature). */
export function decodeBigData(b: Uint8Array, ctx: BigDataContext): ColmiDecoded[] {
  if (b.length < 6 || b[0] !== OP.BIG_DATA_V2) return [{ kotlin: 'Unknown', commandId: b[0] ?? 0 }];
  const today = zoneDayIndex(ctx.nowMs, ctx);
  switch (b[1]) {
    case BIG.SPO2:
      return decodeSpo2(b, today, ctx);
    case BIG.SLEEP:
    case BIG.SLEEP_LUNCH: // nap records share the day layout (`parseDaySleepLunch`)
      return decodeSleep(b, today, ctx);
    case BIG.TEMPERATURE:
      return decodeTemperature(b, today, ctx);
    case BIG.BLOOD_SUGAR:
      return []; // never requested; ignored
    default:
      return [{ kotlin: 'Unknown', commandId: b[1]! }];
  }
}

/**
 * `length / 49` blocks of `[days ago][24 × (min, max)]`; (min + max) / 2 per hour when both are > 0. Every block is read.
 * Hour h is wall-clock h:00 of that day, so a 23- or 25-hour day keeps its hours.
 */
function decodeSpo2(v: Uint8Array, today: number, zone: Zone): ColmiDecoded[] {
  const blocks = Math.floor(u16(v, 2) / 49);
  const out: ColmiDecoded[] = [];
  for (let k = 0; k < blocks; k++) {
    const base = 6 + k * 49;
    if (base + 49 > v.length) break;
    const dayS = (today - v[base]!) * 86_400;
    for (let hour = 0; hour < 24; hour++) {
      const lo = v[base + 1 + hour * 2]!;
      const hi = v[base + 2 + hour * 2]!;
      if (lo > 0 && hi > 0) out.push({ kotlin: 'HistoryMeasurement', kind_field: 'SPO2', value: (lo + hi) / 2, t: zoneWallToMs(dayS + hour * 3_600, zone) });
    }
  }
  return out;
}

/** Day blocks `[days ago][span min][1440 / span bytes]`, °C = raw / 10 + 20; span outside 1..1440 → 30; 0 = none. */
function decodeTemperature(v: Uint8Array, today: number, zone: Zone): ColmiDecoded[] {
  const length = u16(v, 2);
  if (length < 2) return [];
  const out: ColmiDecoded[] = [];
  let i = 6;
  while (i - 6 < length && i + 1 < v.length) {
    const daysAgo = v[i++]!;
    const rawSpan = v[i++]!;
    const span = rawSpan >= 1 && rawSpan <= 1440 ? rawSpan : 30;
    const samples = Math.floor(1440 / span);
    const dayStart = zoneMidnightMs(today - daysAgo, zone);
    for (let s = 0; s < samples; s++) {
      if (i >= v.length || i - 6 >= length) break;
      const raw = v[i++]!;
      if (raw > 0) out.push({ kotlin: 'TemperatureSample', celsius: raw / 10 + 20, t: dayStart + s * span * 60_000 });
    }
  }
  return out;
}

/**
 * `[days in packet]`, then per day `[days ago][day bytes][start min u16][end min u16][(stage, minutes)…]`. Start after end
 * means the night began the evening before (start − 1440). Pairs with 0 minutes are skipped.
 */
function decodeSleep(v: Uint8Array, today: number, zone: Zone): ColmiDecoded[] {
  if (u16(v, 2) < 2 || v.length <= 7) return [];
  const days = v[6]!;
  let i = 7;
  const out: ColmiDecoded[] = [];
  for (let d = 0; d < days; d++) {
    if (i + 5 >= v.length) break;
    const daysAgo = v[i++]!;
    const dayBytes = v[i++]!;
    const start = u16(v, i);
    i += 2;
    const end = u16(v, i);
    i += 2;
    const offset = start > end ? start - 1440 : start;
    const t = zoneMidnightMs(today - daysAgo, zone) + offset * 60_000;
    const codes: number[] = [];
    for (let j = 4; j < dayBytes && i + 1 < v.length; j += 2) {
      const code = v[i]!;
      const minutes = v[i + 1]!;
      i += 2;
      for (let m = 0; m < minutes; m++) codes.push(code);
    }
    if (codes.length) out.push({ kotlin: 'SleepTimeline', t, codes });
  }
  return out;
}

/**
 * `decodeIntervalTemperature`: header `[6]` day index, `[7]` interval (0 → 30), `[8]` packet count, `[9]` packet index, then
 * u16 LE centi-°C samples on the local-day grid; `sampleOffset` = samples in the day's earlier packets (zeros count too).
 */
export function decodeIntervalTemperature(b: Uint8Array, sampleOffset: number, ctx: BigDataContext): ColmiDecoded[] {
  if (b.length < 10) return [];
  const interval = b[7]! > 0 ? b[7]! : 30;
  const dayStart = zoneMidnightMs(zoneDayIndex(ctx.nowMs, ctx) - b[6]!, ctx);
  const out: ColmiDecoded[] = [];
  let slot = sampleOffset;
  for (let i = 10; i + 1 < b.length; i += 2) {
    const raw = u16(b, i);
    if (raw > 0) out.push({ kotlin: 'TemperatureSample', celsius: raw / 100, t: dayStart + slot * interval * 60_000 });
    slot++;
  }
  return out;
}

// ---------------------------------------------------------------- RingEvent mapping (doc §12)

/** `ColmiDecoder.sleepStage`. */
export function sleepStage(code: number): SleepStage {
  switch (code) {
    case 0x02:
      return 'light';
    case 0x03:
      return 'deep';
    case 0x04:
      return 'rem';
    case 0x05:
      return 'awake';
    default:
      return 'unknown';
  }
}

/** `zone` places a live activity total on its local day (`dailyTotal.localDay` = epoch ms of that local midnight). */
export function toRingEvents(decoded: readonly ColmiDecoded[], firmware: string, zone: Zone & { nowMs?: number } = { tzOffsetS: 0 }): RingEvent[] {
  const out: RingEvent[] = [];
  const plausibleTime = (t: number): boolean => Number.isFinite(t) && (zone.nowMs === undefined || zone.nowMs <= 0 || t <= zone.nowMs);
  for (const d of decoded) {
    switch (d.kotlin) {
      case 'Battery':
        out.push({ type: 'status', key: 'battery', value: d.percent });
        break;
      case 'HeartRateSample':
        out.push({ type: 'sample', stream: 'hr', t: d.t, value: d.bpm, unit: 'bpm', origin: d.source === 'workout' ? 'workout_stream' : 'live' });
        break;
      case 'HeartRateComplete':
      case 'Spo2Complete':
        out.push({ type: 'status', key: 'error', value: 'no_reading' });
        break;
      case 'Spo2Result':
        out.push({ type: 'sample', stream: 'spo2', t: d.t, value: d.value, unit: 'pct', origin: 'spot' });
        break;
      case 'ActivityUpdate':
        out.push({ type: 'dailyTotal', localDay: zoneMidnightMs(zoneDayIndex(d.t, zone), zone), steps: d.steps, distanceM: d.distanceMeters, kcal: d.calories });
        break;
      case 'HistoryMeasurement':
        if (!plausibleTime(d.t)) break;
        if (d.kind_field === 'HEART_RATE' && inRange(d.value, 30, 220)) out.push({ type: 'sample', stream: 'hr', t: d.t, value: d.value, unit: 'bpm', origin: 'history' });
        else if (d.kind_field === 'HRV' && inRange(d.value, 1, 300)) out.push({ type: 'sample', stream: 'hrv', t: d.t, value: d.value, unit: 'ms', origin: 'history' }); // UNVERIFIED unit
        else if (d.kind_field === 'SPO2' && inRange(d.value, 70, 100)) out.push({ type: 'sample', stream: 'spo2', t: d.t, value: d.value, unit: 'pct', origin: 'history' });
        else if ((d.kind_field === 'BLOOD_PRESSURE_SYSTOLIC' && inRange(d.value, 60, 250)) || (d.kind_field === 'BLOOD_PRESSURE_DIASTOLIC' && inRange(d.value, 30, 150))) out.push({ type: 'vendor', key: d.kind_field === 'BLOOD_PRESSURE_SYSTOLIC' ? 'blood_pressure_systolic' : 'blood_pressure_diastolic', t: d.t, value: d.value, unit: 'mmHg', origin: 'history' });
        break;
      case 'StressSample':
        if (plausibleTime(d.t) && inRange(d.value, 1, 100)) out.push({ type: 'vendor', key: 'stress', t: d.t, value: d.value, unit: 'vendor_units', origin: 'history' }); // UNVERIFIED scale
        break;
      case 'ActivityBucket':
        // RingEventBridge rejects implausible quarter-hour buckets before persistence.
        if (plausibleTime(d.t) && inRange(d.steps, 0, 5_000) && inRange(d.distanceMeters, 0, 6_000)) out.push({ type: 'activityBucket', start: d.t, durS: 900, steps: d.steps, distanceM: d.distanceMeters });
        break;
      case 'TemperatureSample':
        if (plausibleTime(d.t) && inRange(d.celsius, 30, 45)) out.push({ type: 'sample', stream: 'skin_temp', t: d.t, value: d.celsius, unit: 'degC', origin: 'history' });
        break;
      case 'SleepTimeline':
        // `complete` stays false like the Kotlin: whether the ring has closed last night at sync time is open (doc §14).
        if (d.codes.length <= 1440 && plausibleTime(d.t + d.codes.length * 60_000)) out.push({ type: 'sleepEpochs', start: d.t, epochS: 60, stages: d.codes.map(sleepStage), rawCodes: [...d.codes], firmware, complete: false });
        break;
      case 'SportTelemetry':
      case 'CommandAck':
      case 'Unknown':
        break;
    }
  }
  return out.filter(plausibleAggregate);
}
