/**
 * RWfit payload decoders → `RingEvent`s. Tier P. Port of Lumen's `RWfitDecoder.kt` (legacy `0x7E` replies, vendor
 * `x5/b.java`) and `RWfitJLHistory.kt` (JL `05`-group history bodies), plus the reply dispatch of `RWfitDriver.kt`.
 * Framing and reassembly live in `./codec.ts`; these functions see one deframed payload.
 *
 * Clock (both framings count local wall-clock seconds as if they were UTC; see the doc's "Clock"):
 *   - legacy: epoch-1970 local seconds. Kotlin subtracts `rawOffset + (zone ever uses DST ? 1 h : 0)`. A fixed
 *     `tzOffsetS` cannot tell "ever uses DST", so this port subtracts `tzOffsetS` (the offset now). Equal to the Kotlin in
 *     zones without DST and during DST; one hour later than the Kotlin (and the vendor app) in a DST zone's winter.
 *   - JL: epoch-2000 local seconds; Kotlin subtracts `getOffset(now)`, which is exactly the stamped `tzOffsetS`.
 */
import type { RingEvent, SleepStage } from '../types';
import { HISTORY, JL, LEGACY, historyByJl, type HistoryDef, type HistoryType, type Triple } from './codec';

export interface DecodeContext {
  /** Device UTC offset (s, east positive) when the command was written. */
  tzOffsetS: number;
  /** Stands in for the firmware on `sleepEpochs` (the device-info reply is not decoded): the framing name. */
  firmware: string;
}

/** Seconds from 1970 to 2000-01-01T00:00:00Z: the JL record epoch (`RWfitJLHistory.JIELI_EPOCH_SECONDS`). */
export const JL_EPOCH_S = 946_684_800;
/** mg/dL per mmol/L of glucose (`RWfitJLHistory.MGDL_PER_MMOL`). */
export const MGDL_PER_MMOL = 18.016;

const u16 = (p: Uint8Array, i: number): number => (p[i]! << 8) | p[i + 1]!;
const u24 = (p: Uint8Array, i: number): number => (p[i]! << 16) | (p[i + 1]! << 8) | p[i + 2]!;
const u32 = (p: Uint8Array, i: number): number => p[i]! * 0x1000000 + ((p[i + 1]! << 16) | (p[i + 2]! << 8) | p[i + 3]!);

/** Legacy ring time → epoch ms (`RWfitDecoder.instantAt`, DST quirk limited as described in the header). */
export const legacyTimeMs = (raw: number, tzOffsetS: number): number => (raw - tzOffsetS) * 1000;
/** JL ring time → epoch ms (`RWfitJLHistory.instantAt`). */
export const jlTimeMs = (raw: number, tzOffsetS: number): number => (raw + JL_EPOCH_S - tzOffsetS) * 1000;

const hr = (t: number, v: number): RingEvent => ({ type: 'sample', stream: 'hr', t, value: v, unit: 'bpm', origin: 'history' });
const spo2 = (t: number, v: number): RingEvent => ({ type: 'sample', stream: 'spo2', t, value: v, unit: 'pct', origin: 'history' });
const temp = (t: number, v: number): RingEvent => ({ type: 'sample', stream: 'skin_temp', t, value: v, unit: 'degC', origin: 'history' });
const hrv = (t: number, v: number): RingEvent => ({ type: 'sample', stream: 'hrv', t, value: v, unit: 'ms', origin: 'history' });
const vendor = (key: string, t: number, value: number, unit: string): RingEvent => ({ type: 'vendor', key, t, value, unit, origin: 'history' });
const bp = (t: number, sys: number, dia: number): RingEvent[] => [
  vendor('blood_pressure_systolic_estimate', t, sys, 'mmHg'),
  vendor('blood_pressure_diastolic_estimate', t, dia, 'mmHg'),
];

// ---------------------------------------------------------------- legacy 0x7E payloads (RWfitDecoder.kt)

/** `decodeBattery`: `[lowPowerFlag, powerStatus, percent]`; percent is byte 2, powerStatus 1 = charging. */
export function decodeLegacyBattery(p: Uint8Array): { percent: number; charging: boolean } | null {
  if (p.length < 3) return null;
  return { percent: Math.min(100, p[2]!), charging: p[1] === 1 };
}

export interface SyncManifest {
  totalDataCount: number;
  hasSteps: boolean;
  hasSleep: boolean;
  hasHeartRate: boolean;
  hasBloodPressure: boolean;
  hasSpo2: boolean;
  hasTemperature: boolean;
  hasBreathe: boolean;
  hasEcg: boolean;
  hasSport: boolean;
}

/** `decodeSyncManifest` (`x5/b.java v0()`, cmd 0xA0); null under 4 bytes. */
export function decodeSyncManifest(p: Uint8Array): SyncManifest | null {
  if (p.length < 4) return null;
  const bit = (b: number, n: number): boolean => ((b >> n) & 1) === 1;
  const a = p[2]!;
  return {
    totalDataCount: u16(p, 0),
    hasSteps: bit(a, 0), hasSleep: bit(a, 1), hasHeartRate: bit(a, 2), hasBloodPressure: bit(a, 3),
    hasSpo2: bit(a, 4), hasTemperature: bit(a, 5), hasBreathe: bit(a, 6), hasEcg: bit(a, 7), hasSport: bit(p[3]!, 0),
  };
}

/** `SyncManifest.pendingStreams`: the claimed streams in the vendor's cascade order (ECG and sport never requested). */
export function pendingStreams(m: SyncManifest): HistoryType[] {
  const claimed: Partial<Record<HistoryType, boolean>> = {
    steps: m.hasSteps, sleep: m.hasSleep, heart_rate: m.hasHeartRate, blood_pressure: m.hasBloodPressure,
    spo2: m.hasSpo2, temperature: m.hasTemperature, breathe: m.hasBreathe,
  };
  return HISTORY.filter((h) => h.legacy !== null && claimed[h.type]).map((h) => h.type);
}

/** `decodeDayRecords`: `[dayTs u32][n u16]` + n fixed items, repeated; a record running past the end stops the decode. */
function dayRecords(p: Uint8Array, itemSize: number, item: (at: number) => RingEvent[]): RingEvent[] {
  const out: RingEvent[] = [];
  let i = 0;
  while (i + 6 <= p.length) {
    const n = u16(p, i + 4);
    i += 6;
    const end = i + n * itemSize;
    if (end > p.length) break;
    for (let k = 0; k < n; k++) out.push(...item(i + k * itemSize));
    i = end;
  }
  return out;
}

/** `decodeHeartRateHistory` (0xA3): bpm kept when 25..250. */
export const decodeLegacyHeartRate = (p: Uint8Array, tz: number): RingEvent[] =>
  dayRecords(p, 5, (at) => (p[at + 4]! >= 25 && p[at + 4]! <= 250 ? [hr(legacyTimeMs(u32(p, at), tz), p[at + 4]!)] : []));

/** `decodeSpo2History` (0xA5): % kept when 50..100. */
export const decodeLegacySpo2 = (p: Uint8Array, tz: number): RingEvent[] =>
  dayRecords(p, 5, (at) => (p[at + 4]! >= 50 && p[at + 4]! <= 100 ? [spo2(legacyTimeMs(u32(p, at), tz), p[at + 4]!)] : []));

/** `decodeBloodPressureHistory` (0xA4): 6-byte items, kept when sys 60..250 and dia 30..200. */
export const decodeLegacyBloodPressure = (p: Uint8Array, tz: number): RingEvent[] =>
  dayRecords(p, 6, (at) => {
    const sys = p[at + 4]!;
    const dia = p[at + 5]!;
    return sys >= 60 && sys <= 250 && dia >= 30 && dia <= 200 ? bp(legacyTimeMs(u32(p, at), tz), sys, dia) : [];
  });

/** `decodeTemperatureHistory` (0xA6): °C = (raw + 200) / 10, kept when 30..45. */
export const decodeLegacyTemperature = (p: Uint8Array, tz: number): RingEvent[] =>
  dayRecords(p, 5, (at) => {
    const c = (p[at + 4]! + 200) / 10;
    return c >= 30 && c <= 45 ? [temp(legacyTimeMs(u32(p, at), tz), c)] : [];
  });

/**
 * `decodeStepHistory` (0xA1): 15-byte day records, day totals only (the 8-byte items are skipped: their bucket width is
 * unknown). `localDay` is the instant of the ring's local day start: the Kotlin `_timestamp` (`instantAt(dayTs)`).
 * UNVERIFIED: kcal and metres are the Kotlin's reading of the totals; no capture proves the units.
 */
export function decodeLegacySteps(p: Uint8Array, tz: number): RingEvent[] {
  const out: RingEvent[] = [];
  let i = 0;
  while (i + 15 <= p.length) {
    const day = legacyTimeMs(u32(p, i), tz);
    const steps = u24(p, i + 4);
    const kcal = u24(p, i + 7);
    const distanceM = u24(p, i + 10);
    const n = u16(p, i + 13);
    i += 15;
    const end = i + n * 8;
    if (end > p.length) break; // truncated record: stop rather than read past it
    i = end;
    out.push({ type: 'dailyTotal', localDay: day, steps, distanceM, kcal });
  }
  return out;
}

/** Legacy sleep item stage (`s1.java:1636-1645`): 0 awake, 1 light, 2 deep, 3 REM. */
const legacyStage = (code: number): SleepStage => (['awake', 'light', 'deep', 'rem'] as const)[code] ?? 'unknown';

/**
 * `decodeSleepHistory` (0xA2): 16-byte day records `[dayTs][totalMin u16][asleepTs][awakeTs][n u16]` + n × `[minutes][stage]`,
 * expanded per minute from `asleepTs`. A record with no non-awake minute is not a session.
 */
export function decodeLegacySleep(p: Uint8Array, ctx: DecodeContext): RingEvent[] {
  const out: RingEvent[] = [];
  let i = 0;
  while (i + 16 <= p.length) {
    const start = legacyTimeMs(u32(p, i + 6), ctx.tzOffsetS);
    const n = u16(p, i + 14);
    i += 16;
    const end = i + n * 2;
    if (end > p.length) break;
    const stages: SleepStage[] = [];
    const rawCodes: number[] = [];
    for (let k = 0; k < n; k++) {
      const minutes = p[i + k * 2]!;
      const code = p[i + k * 2 + 1]!;
      for (let m = 0; m < minutes; m++) {
        stages.push(legacyStage(code));
        rawCodes.push(code);
      }
    }
    i = end;
    if (stages.some((s) => s !== 'awake')) out.push({ type: 'sleepEpochs', start, epochS: 60, stages, rawCodes, firmware: ctx.firmware, complete: true });
  }
  return out;
}

export interface LegacyDecoded {
  events: RingEvent[];
  /** The history stream whose reply this was (advances the cascade). */
  history?: HistoryDef;
  /** Decoded manifest (0xA0); null when the reply was too short. */
  manifest?: SyncManifest | null;
  battery?: { percent: number; charging: boolean };
  deviceInfo?: boolean;
}

/** `RWfitDriver.decodeLegacyFrame`: one reassembled legacy frame. */
export function decodeLegacyPayload(cmd: number, p: Uint8Array, ctx: DecodeContext): LegacyDecoded {
  const tz = ctx.tzOffsetS;
  const hist = (type: HistoryType, events: RingEvent[]): LegacyDecoded => ({ events, history: HISTORY.find((h) => h.type === type)! });
  switch (cmd) {
    case LEGACY.DEVICE_INFO:
      return { events: [], deviceInfo: true }; // not decoded: only marks the handshake done
    case LEGACY.BATTERY:
    case LEGACY.BATTERY_ALT: {
      const b = decodeLegacyBattery(p);
      if (!b) return { events: [] };
      return { events: [{ type: 'status', key: 'battery', value: b.percent }, { type: 'status', key: 'charging', value: b.charging ? 1 : 0 }], battery: b };
    }
    case LEGACY.SYNC_MANIFEST:
      return { events: [], manifest: decodeSyncManifest(p) };
    case LEGACY.STEPS_HISTORY:
      return hist('steps', decodeLegacySteps(p, tz));
    case LEGACY.SLEEP_HISTORY:
      return hist('sleep', decodeLegacySleep(p, ctx));
    case LEGACY.HEART_RATE_HISTORY:
      return hist('heart_rate', decodeLegacyHeartRate(p, tz));
    case LEGACY.BLOOD_PRESSURE_HISTORY:
      return hist('blood_pressure', decodeLegacyBloodPressure(p, tz));
    case LEGACY.SPO2_HISTORY:
      return hist('spo2', decodeLegacySpo2(p, tz));
    case LEGACY.TEMPERATURE_HISTORY:
      return hist('temperature', decodeLegacyTemperature(p, tz));
    case LEGACY.BREATHE_HISTORY:
      return hist('breathe', []); // not decoded; the reply still advances the cascade
    default:
      return { events: [] }; // features 0x03, bind status 0x02 and the rest: not decoded
  }
}

// ---------------------------------------------------------------- JL 05-group history bodies (RWfitJLHistory.kt)

/** `series6`: 6-byte records `[ts2000 u32][a][b]`; a torn tail is dropped. */
function series6(p: Uint8Array, tz: number, item: (t: number, at: number) => RingEvent[]): RingEvent[] {
  const out: RingEvent[] = [];
  for (let i = 0; i + 6 <= p.length; i += 6) out.push(...item(jlTimeMs(u32(p, i), tz), i));
  return out;
}

/** Fallback bucket width when no neighbouring record gives one (UNVERIFIED: the ring never states its interval). */
export const JL_STEP_BUCKET_S = 60;

/**
 * `decodeSteps` (`a0()`): 16-byte records `[ts u32][pad][steps u24][kcal×10 u32][distance dm u32]`, per-interval deltas.
 * Zero-step records are dropped. `durS` is the gap to the next record (else from the previous one, else 60 s); the
 * Kotlin has no width. kcal = raw / 10 (the Kotlin reads it and drops it).
 */
export function decodeJlSteps(p: Uint8Array, tz: number): RingEvent[] {
  const times: number[] = [];
  for (let i = 0; i + 16 <= p.length; i += 16) times.push(jlTimeMs(u32(p, i), tz));
  const width = (k: number): number => {
    const ok = (d: number | undefined): d is number => d !== undefined && d > 0 && d <= 86_400;
    const next = k + 1 < times.length ? (times[k + 1]! - times[k]!) / 1000 : undefined;
    if (ok(next)) return next;
    const prev = k > 0 ? (times[k]! - times[k - 1]!) / 1000 : undefined;
    return ok(prev) ? prev : JL_STEP_BUCKET_S;
  };
  const out: RingEvent[] = [];
  times.forEach((start, k) => {
    const i = k * 16;
    const steps = u24(p, i + 5);
    if (steps > 0) out.push({ type: 'activityBucket', start, durS: width(k), steps, distanceM: Math.floor(u32(p, i + 12) / 10), kcal: u32(p, i + 8) / 10 });
  });
  return out;
}

const SLEEP_SESSION_START = 0x11;
const SLEEP_SESSION_END = 0x22;

/** JL sleep model byte (`s1.java:1139-1157`): 1 deep, 2 light, 0 or 3 awake, 4 REM, the 0x11 marker light. Not the legacy map. */
export function jlSleepStage(model: number): SleepStage {
  switch (model) {
    case 1:
      return 'deep';
    case 2:
    case SLEEP_SESSION_START:
      return 'light';
    case 0:
    case 3:
      return 'awake';
    case 4:
      return 'rem';
    default:
      return 'unknown';
  }
}

/**
 * `decodeSleep` (`Z()`): 7-byte stage-change records `[ts u32][model][2 unused]`. A segment runs to the next record, in
 * whole minutes (0 or ≥ 1440 skipped; the last record adds nothing). A session opens at 0x11 and is emitted at 0x22 when
 * it holds at least one minute, stamped at the 0x11 record. An unclosed session emits nothing.
 */
export function decodeJlSleep(p: Uint8Array, ctx: DecodeContext): RingEvent[] {
  const recs: Array<{ t: number; model: number }> = [];
  for (let i = 0; i + 7 <= p.length; i += 7) recs.push({ t: jlTimeMs(u32(p, i), ctx.tzOffsetS), model: p[i + 4]! });
  const out: RingEvent[] = [];
  let start: number | null = null;
  let stages: SleepStage[] = [];
  let rawCodes: number[] = [];
  recs.forEach((rec, idx) => {
    if (rec.model === SLEEP_SESSION_START) {
      start = rec.t;
      stages = [];
      rawCodes = [];
    }
    if (start === null) return;
    if (rec.model === SLEEP_SESSION_END) {
      if (stages.length > 0) out.push({ type: 'sleepEpochs', start, epochS: 60, stages, rawCodes, firmware: ctx.firmware, complete: true });
      start = null;
      stages = [];
      rawCodes = [];
      return;
    }
    const next = recs[idx + 1];
    if (!next) return;
    // `Duration.between(...).seconds / 60`: truncates toward zero.
    const minutes = Math.trunc((next.t - rec.t) / 60_000);
    if (minutes >= 1 && minutes <= 24 * 60 - 1) {
      for (let m = 0; m < minutes; m++) {
        stages.push(jlSleepStage(rec.model));
        rawCodes.push(rec.model);
      }
    }
  });
  return out;
}

/**
 * `RWfitJLHistory.decode`: one `05 <key> xx` body (after the triple). Undefined for keys the Kotlin does not decode
 * (sport 0x0E, 0x14, 0x17 and the rest): the frame is still ACKed, nothing is emitted.
 */
export function decodeJlHistory(key: number, p: Uint8Array, ctx: DecodeContext): RingEvent[] | undefined {
  const tz = ctx.tzOffsetS;
  switch (historyByJl(key)?.type) {
    case 'steps':
      return decodeJlSteps(p, tz);
    case 'heart_rate':
      return series6(p, tz, (t, i) => (p[i + 4]! > 0 ? [hr(t, p[i + 4]!)] : []));
    case 'blood_pressure':
      return series6(p, tz, (t, i) => (p[i + 4]! > 0 && p[i + 5]! > 0 ? bp(t, p[i + 4]!, p[i + 5]!) : []));
    case 'sleep':
      return decodeJlSleep(p, ctx);
    case 'temperature':
      // raw u16 / 10, no legacy +200 offset
      return series6(p, tz, (t, i) => (u16(p, i + 4) > 0 ? [temp(t, u16(p, i + 4) / 10)] : []));
    case 'spo2':
      return series6(p, tz, (t, i) => (p[i + 4]! > 0 ? [spo2(t, p[i + 4]!)] : []));
    case 'hrv':
      return series6(p, tz, (t, i) => (p[i + 4]! > 0 ? [hrv(t, p[i + 4]!)] : []));
    case 'stress':
      return series6(p, tz, (t, i) => (p[i + 4]! > 0 ? [vendor('stress', t, p[i + 4]!, 'vendor_units')] : []));
    case 'blood_sugar':
      // raw / 10 is mmol/L; the Kotlin converts to mg/dL (its app unit), kept here.
      return series6(p, tz, (t, i) => (u16(p, i + 4) > 0 ? [vendor('blood_glucose_estimate', t, (u16(p, i + 4) / 10) * MGDL_PER_MMOL, 'mg/dL')] : []));
    default:
      return undefined;
  }
}

export interface JlDecoded {
  events: RingEvent[];
  history?: HistoryDef;
  battery?: number;
  deviceInfo?: boolean;
}

const is = (t: Triple, ref: Triple): boolean => t[0] === ref[0] && t[1] === ref[1];

/** `RWfitDriver.decodeJieLiFrame`: battery `02 03`, device info `02 04`, history `05 xx`; `06 09` and the rest decode to nothing. */
export function decodeJlPayload(triple: Triple, p: Uint8Array, ctx: DecodeContext): JlDecoded {
  if (is(triple, JL.BATTERY)) {
    if (p.length === 0) return { events: [] };
    const percent = Math.min(100, p[0]!);
    return { events: [{ type: 'status', key: 'battery', value: percent }], battery: percent };
  }
  if (is(triple, JL.DEVICE_INFO)) return { events: [], deviceInfo: true };
  if (triple[0] === 0x05) {
    const events = decodeJlHistory(triple[1], p, ctx);
    return events === undefined ? { events: [] } : { events, history: historyByJl(triple[1]) };
  }
  return { events: [] }; // realtime 06 09 replies: layout not ported (the Kotlin logs and drops them)
}
