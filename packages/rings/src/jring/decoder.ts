/**
 * Jring notification decoder. Tier P. Two layers:
 *   1. `decodeJringPacket`: line-for-line port of Lumen's `ring/RingDecoder.kt` (with the `JringClock.date` rule), giving
 *      Kotlin-shaped events so `qa/fixtures/rings/jring/decode.json` can pin it.
 *   2. `jringRingEvents`: the `RingEventBridge.kt` gates and the mapping onto `RingEvent` (docs/jring.md, "Mapping to RingEvent").
 *
 * Times are epoch milliseconds. Ring-stamped times are local wall-clock seconds; the decoder subtracts the offset latched at
 * the last time sync (`clockOffsetS`; null = no clock, Kotlin `RingDecoder(clock = null)`) from every one of them. Deliberate
 * departure from Kotlin, which leaves 0x10 activity buckets and 0x14 live heart rate raw: its own `JringClock` header says
 * every ring timestamp has the offset taken off, and the protocol's "caught up" rule reads 0x10 as local (docs/jring.md,
 * port note 1).
 */
import type { RingEvent, SleepStage } from '../types';
import { CMD, PACKET_SIZE, jringCapabilities } from './commands';

/** `MeasurementKind` values this family produces. */
export type JringMeasurement = 'HEART_RATE' | 'BLOOD_PRESSURE_SYSTOLIC' | 'BLOOD_PRESSURE_DIASTOLIC' | 'FATIGUE' | 'BLOOD_SUGAR';

/** `RingDecodedEvent` cases the Jring decoder emits. `tMs` is the event time; "now" times use the `nowMs` handed in. */
export type JringDecoded =
  | { kind: 'TimeSyncAck'; tMs: number }
  | { kind: 'CommandAck'; commandId: number }
  | { kind: 'ActivityUpdate'; tMs: number; rawS: number; steps: number; distanceMeters: number; calories: number }
  | { kind: 'Battery'; percent: number; charging: boolean }
  | { kind: 'Status'; address: string; firmware: string }
  | { kind: 'ActivityBucket'; tMs: number; steps: number; distanceMeters: number }
  | { kind: 'SleepTimeline'; tMs: number; codes: number[]; stages: SleepStage[]; historyHorizonDays: number }
  | { kind: 'HeartRateSample'; tMs: number; bpm: number; sleepStatus: number; isError: boolean; source: 'live' | 'combined' }
  | { kind: 'HistoryMeasurement'; measurement: JringMeasurement; value: number; tMs: number; historyHorizonDays: number; source: 'history' | 'combined' }
  | { kind: 'HistorySyncProgress'; stage: string }
  | { kind: 'HistorySyncFinished' }
  | { kind: 'BandFunction'; payload: Uint8Array; caps: ReturnType<typeof jringCapabilities> }
  | { kind: 'Spo2Result'; value: number; tMs: number }
  | { kind: 'Spo2Progress'; tMs: number }
  | { kind: 'StressSample'; value: number; tMs: number }
  | { kind: 'HeartRateComplete'; tMs: number }
  | { kind: 'Spo2Complete'; tMs: number }
  | { kind: 'BindNotify'; action: number; state: number }
  | { kind: 'FirmwareVersion'; version: number | null }
  | { kind: 'Unknown'; commandId: number; raw: Uint8Array };

/** `HistoryMeasurement.historyHorizonDays` default: the plausibility window of history values and sleep. */
export const HISTORY_HORIZON_DAYS = 8;

const u16le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32le = (b: Uint8Array, o: number): number => (b.length < o + 4 ? 0 : ((b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0));
const hex2 = (x: number): string => x.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (x: number): string => x.toString(16).toUpperCase().padStart(4, '0');

/** `JringClock.date`: ring epoch (local wall-clock s) minus the latched offset, in ms. No clock subtracts 0. */
export function ringDateMs(rawS: number, clockOffsetS: number | null): number {
  return (rawS - (clockOffsetS ?? 0)) * 1000;
}

/** `SleepStage.fromByte`: 0 awake, 1..0x4f light, 0x50 and above deep. Never REM. */
export function sleepStageFromByte(b: number): SleepStage {
  if (b === 0) return 'awake';
  return b >= 0x50 ? 'deep' : 'light';
}

/** Kotlin `Math.round` on the average: half up. */
const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

function decodeHeartRateHistory(b: Uint8Array, off: number | null): JringDecoded[] {
  const sub = b[1]!;
  if (sub === 0xf0) return [{ kind: 'HistorySyncProgress', stage: 'hr_header' }];
  if (sub === 0xaa) return [{ kind: 'HistorySyncProgress', stage: 'hr_index' }];
  if (sub === 0xff) return [{ kind: 'HistorySyncFinished' }];
  const base = ringDateMs(u32le(b, 2), off);
  if (sub === 0xa0) {
    // `decodeHrDataBlock`: 12 samples at 8..19 -> two averages of six; a zero average is skipped; the second at base + 60 s
    // (UNVERIFIED: if the samples are one a minute the readings would be 6 min apart; Kotlin trusts the vendor example).
    const out: JringDecoded[] = [];
    const avg1 = roundHalfUp(Array.from(b.subarray(8, 14)).reduce((s, x) => s + x, 0) / 6);
    const avg2 = roundHalfUp(Array.from(b.subarray(14, 20)).reduce((s, x) => s + x, 0) / 6);
    if (avg1 > 0) out.push({ kind: 'HistoryMeasurement', measurement: 'HEART_RATE', value: avg1, tMs: base, historyHorizonDays: HISTORY_HORIZON_DAYS, source: 'history' });
    if (avg2 > 0) out.push({ kind: 'HistoryMeasurement', measurement: 'HEART_RATE', value: avg2, tMs: base + 60_000, historyHorizonDays: HISTORY_HORIZON_DAYS, source: 'history' });
    return out;
  }
  // Legacy fallback: the first non-zero byte from byte 8 on is one reading, else an ack.
  const v = Array.from(b.subarray(8)).find((x) => x !== 0);
  return v === undefined
    ? [{ kind: 'CommandAck', commandId: CMD.HISTORY_MEASUREMENT_STREAM }]
    : [{ kind: 'HistoryMeasurement', measurement: 'HEART_RATE', value: v, tMs: base, historyHorizonDays: HISTORY_HORIZON_DAYS, source: 'history' }];
}

/** `decodeCombinedSensor` (0x24): 1 HR, 2 systolic, 3 diastolic, 4 SpO2, 5 fatigue, 6 stress, 7 blood sugar mmol/L x 10. Byte 8 (HRV) unread. */
function decodeCombined(b: Uint8Array, nowMs: number): JringDecoded[] {
  const [, hr = 0, sys = 0, dia = 0, spo2 = 0, fatigue = 0, stress = 0, sugar = 0] = b;
  const m = (measurement: JringMeasurement, value: number): JringDecoded => ({ kind: 'HistoryMeasurement', measurement, value, tMs: nowMs, historyHorizonDays: HISTORY_HORIZON_DAYS, source: 'combined' });
  const out: JringDecoded[] = [];
  if (hr > 0) out.push({ kind: 'HeartRateSample', tMs: nowMs, bpm: hr, sleepStatus: 0, isError: false, source: 'combined' });
  // Kotlin QUIRK: systolic is emitted when either value is non-zero; the bridge gate drops the 0.
  if (sys > 0 || dia > 0) out.push(m('BLOOD_PRESSURE_SYSTOLIC', sys));
  if (dia > 0) out.push(m('BLOOD_PRESSURE_DIASTOLIC', dia));
  if (spo2 >= 80 && spo2 <= 100) out.push({ kind: 'Spo2Result', value: spo2, tMs: nowMs });
  if (fatigue > 0) out.push(m('FATIGUE', fatigue));
  if (stress > 0) out.push({ kind: 'StressSample', value: stress, tMs: nowMs });
  if (sugar > 0) out.push(m('BLOOD_SUGAR', (sugar / 10) * 18.016));
  return out;
}

/**
 * `RingDecoder.decode`: one notification -> Kotlin events. A packet that is not exactly 20 bytes is `Unknown` (first byte
 * as id), whatever its id, longer ones included.
 */
export function decodeJringPacket(bytes: Uint8Array, clockOffsetS: number | null, nowMs: number): JringDecoded[] {
  const b = bytes;
  if (b.length !== PACKET_SIZE) return [{ kind: 'Unknown', commandId: b[0] ?? 0, raw: b.slice() }];
  const off = clockOffsetS;
  switch (b[0]) {
    case CMD.TIME_SYNC:
      return [{ kind: 'TimeSyncAck', tMs: ringDateMs(u32le(b, 1), off) }];
    case CMD.USER_INFO:
      return [{ kind: 'CommandAck', commandId: CMD.USER_INFO }];
    case CMD.CURRENT_ACTIVITY: {
      const rawS = u32le(b, 1);
      return [{ kind: 'ActivityUpdate', tMs: ringDateMs(rawS, off), rawS, steps: u32le(b, 5), distanceMeters: u32le(b, 9), calories: u32le(b, 13) }];
    }
    case CMD.PERCENT_STATUS:
      return [{ kind: 'Battery', percent: b[1]!, charging: b[2] === 1 }];
    case CMD.STATUS: {
      // CID(9..10) + DID(11..12) + "V" + version(1..2), as the vendor app's onGetDeviceInfo; address 3..8 (byte order UNVERIFIED).
      const address = Array.from(b.subarray(3, 9), hex2).join(':');
      return [{ kind: 'Status', address, firmware: `${hex4(u16le(b, 9))}${hex4(u16le(b, 11))}V${u16le(b, 1)}` }];
    }
    case CMD.HISTORY_SUMMARY: {
      // Kotlin uses `Instant.ofEpochSecond(raw)` here; the port applies `ringDate` as for 0x11 (port note 1). No distance.
      const base = ringDateMs(u32le(b, 1), off);
      return Array.from(b.subarray(5, 20), (steps, i): JringDecoded => ({ kind: 'ActivityBucket', tMs: base + i * 60_000, steps, distanceMeters: 0 }));
    }
    case CMD.SLEEP_TIMELINE: {
      const codes = Array.from(b.subarray(5, 20));
      return [{ kind: 'SleepTimeline', tMs: ringDateMs(u32le(b, 1), off), codes, stages: codes.map(sleepStageFromByte), historyHorizonDays: HISTORY_HORIZON_DAYS }];
    }
    case CMD.HEART_RATE_SAMPLE_OR_START: {
      // Ring time zero = the ring could not read: bpm 0, phone time, error. A real time goes through `ringDate` (Kotlin: raw).
      const rawS = u32le(b, 1);
      if (rawS === 0) return [{ kind: 'HeartRateSample', tMs: nowMs, bpm: 0, sleepStatus: 0, isError: true, source: 'live' }];
      return [{ kind: 'HeartRateSample', tMs: ringDateMs(rawS, off), bpm: b[5]!, sleepStatus: b[6]!, isError: false, source: 'live' }];
    }
    case CMD.HISTORY_MEASUREMENT_STREAM:
      return decodeHeartRateHistory(b, off);
    case CMD.DEVICE_CAPABILITIES:
      return [{ kind: 'BandFunction', payload: b.slice(1), caps: jringCapabilities(b.subarray(1)) }];
    case CMD.COMBINED_RESULT:
      return decodeCombined(b, nowMs);
    case CMD.SENSOR_COMPLETE:
      return [{ kind: 'HeartRateComplete', tMs: nowMs }];
    case CMD.BLOOD_DATA_NOTIFY:
      return [{ kind: 'Spo2Complete', tMs: nowMs }];
    case CMD.SPO2_RESULT: {
      const v = b[1]!;
      return [v >= 80 && v <= 100 ? { kind: 'Spo2Result', value: v, tMs: nowMs } : { kind: 'Spo2Progress', tMs: nowMs }];
    }
    case CMD.BIND:
      return [{ kind: 'BindNotify', action: b[1]!, state: b[2]! }];
    case CMD.FIRMWARE_NUMBER:
      return [{ kind: 'FirmwareVersion', version: u16le(b, 4) }];
    default:
      return [{ kind: 'Unknown', commandId: b[0]!, raw: b.slice() }];
  }
}

// ---------------------------------------------------------------- RingEventBridge gates and the RingEvent mapping

/** `RingEventBridge` ranges. */
export const GATES = {
  hr: [30, 220], spo2: [70, 100], stress: [1, 100], systolic: [60, 250], diastolic: [30, 150], glucose: [20, 600], bucketSteps: [0, 5000], bucketDistance: [0, 6000], battery: [0, 100],
} as const;
const within = (v: number, [lo, hi]: readonly [number, number]): boolean => Number.isFinite(v) && v >= lo && v <= hi;
/** Kotlin compares `value.toInt()` for the integer kinds. */
const withinInt = (v: number, r: readonly [number, number]): boolean => within(Math.trunc(v), r);

/** `isWithinHistoryWindow`: [now - horizon days, now + 1 h]. Skipped while the phone time is unknown (nowMs 0). */
function inHistoryWindow(tMs: number, nowMs: number, horizonDays = HISTORY_HORIZON_DAYS): boolean {
  if (nowMs <= 0) return true;
  const days = Math.min(3650, Math.max(1, horizonDays));
  return tMs >= nowMs - days * 86_400_000 && tMs <= nowMs + 3_600_000;
}

export interface MapContext {
  nowMs: number;
  clockOffsetS: number | null;
  /** Firmware string for `sleepEpochs.firmware`. */
  firmware: string;
}

const VENDOR: Record<Exclude<JringMeasurement, 'HEART_RATE'>, { key: string; unit: string; gate: readonly [number, number]; int: boolean }> = {
  BLOOD_PRESSURE_SYSTOLIC: { key: 'bp_sys', unit: 'mmHg', gate: GATES.systolic, int: true },
  BLOOD_PRESSURE_DIASTOLIC: { key: 'bp_dia', unit: 'mmHg', gate: GATES.diastolic, int: true },
  FATIGUE: { key: 'fatigue', unit: '', gate: GATES.stress, int: true },
  // A profile-derived vendor estimate, not a measurement; kept as a vendor value with no clinical claim.
  BLOOD_SUGAR: { key: 'glucose', unit: 'mg/dL', gate: GATES.glucose, int: false },
};

/** One Kotlin event -> `RingEvent`s after the bridge gates. Bind, band function and unknown packets map to nothing here. */
export function toJringRingEvents(d: JringDecoded, ctx: MapContext): RingEvent[] {
  switch (d.kind) {
    case 'TimeSyncAck':
      return [{ type: 'status', key: 'ack', value: 'time_sync' }];
    case 'CommandAck':
      return [{ type: 'status', key: 'ack', value: `cmd_0x${d.commandId.toString(16).padStart(2, '0')}` }];
    case 'ActivityUpdate': {
      // Cumulative totals for the ring-local day. `localDay` is the instant of that day's local midnight (what
      // `records.ts` expects): the raw ring time is local wall-clock, so its day start minus the offset. Calories unit UNVERIFIED.
      const off = ctx.clockOffsetS ?? 0;
      const localS = d.rawS > 0 ? d.rawS : Math.floor(ctx.nowMs / 1000) + off;
      return [{ type: 'dailyTotal', localDay: (Math.floor(localS / 86_400) * 86_400 - off) * 1000, steps: d.steps, distanceM: d.distanceMeters, kcal: d.calories }];
    }
    case 'Battery':
      if (!within(d.percent, GATES.battery)) return [];
      return [{ type: 'status', key: 'battery', value: d.percent }, { type: 'status', key: 'charging', value: d.charging ? 1 : 0 }];
    case 'Status': {
      const out: RingEvent[] = [{ type: 'status', key: 'firmware', value: d.firmware }];
      // An all-zero address is "none" (docs/jring.md); otherwise it is the ring's identity on every platform.
      if (d.address !== '00:00:00:00:00:00') out.push({ type: 'status', key: 'serial', value: d.address });
      return out;
    }
    case 'ActivityBucket':
      if (!within(d.steps, GATES.bucketSteps) || !within(d.distanceMeters, GATES.bucketDistance)) return [];
      return [{ type: 'activityBucket', start: d.tMs, durS: 60, steps: d.steps }];
    case 'SleepTimeline':
      if (!inHistoryWindow(d.tMs, ctx.nowMs, d.historyHorizonDays) || d.stages.length === 0) return [];
      // `completeSession` is never set by this family; the raw codes are kept so a corrected map can rescore.
      return [{ type: 'sleepEpochs', start: d.tMs, epochS: 60, stages: d.stages, rawCodes: d.codes, firmware: ctx.firmware, complete: false }];
    case 'HeartRateSample':
      if (d.isError || !within(d.bpm, GATES.hr)) return [];
      return [{ type: 'sample', stream: 'hr', t: d.tMs, value: d.bpm, unit: 'bpm', origin: d.source === 'combined' ? 'spot' : 'live' }];
    case 'HistoryMeasurement': {
      if (!inHistoryWindow(d.tMs, ctx.nowMs, d.historyHorizonDays)) return [];
      const origin = d.source === 'combined' ? 'spot' : 'history';
      if (d.measurement === 'HEART_RATE') return withinInt(d.value, GATES.hr) ? [{ type: 'sample', stream: 'hr', t: d.tMs, value: d.value, unit: 'bpm', origin }] : [];
      const v = VENDOR[d.measurement];
      if (!(v.int ? withinInt(d.value, v.gate) : within(d.value, v.gate))) return [];
      return [{ type: 'vendor', key: v.key, t: d.tMs, value: d.value, unit: v.unit, origin }];
    }
    case 'Spo2Result':
      return [{ type: 'sample', stream: 'spo2', t: d.tMs, value: d.value, unit: 'pct', origin: 'spot' }];
    case 'StressSample':
      return within(d.value, GATES.stress) ? [{ type: 'vendor', key: 'stress', t: d.tMs, value: d.value, unit: '', origin: 'spot' }] : [];
    case 'HistorySyncProgress':
      return [{ type: 'progress', stage: d.stage, done: false }];
    case 'HistorySyncFinished':
      // Kotlin's "sync finished": 0x16 is always the last read of a plan, so `done` here closes the whole sync.
      return [{ type: 'progress', stage: 'hr_history', done: true }];
    case 'BandFunction':
      return [{ type: 'status', key: 'capabilities', value: Array.from(d.payload, (x) => x.toString(16).padStart(2, '0')).join(' ') }];
    case 'HeartRateComplete':
    case 'Spo2Complete':
    case 'Spo2Progress':
    case 'BindNotify':
    case 'FirmwareVersion':
    case 'Unknown':
      // Completions are mapped by the protocol (it knows whether a reading came in); F6 is diagnostic (one kind decodes to a
      // bogus 2704); bind is answered through `send`; unknown packets never become records.
      return [];
  }
}

