/**
 * Colmi wire constants, framing and command encoders. Tier P.
 * Ported from the upstream Android Kotlin (`ColmiProtocol.kt`, `ColmiEncoder.kt`, `wearables/WearableModel.kt`); research
 * notes in `packages/rings/docs/colmi.md`, golden vectors in `qa/fixtures/rings/colmi/encode.json`.
 *
 * Two kinds of frame (doc §3):
 *   - normal: 16 bytes = opcode + up to 14 bytes of sub-data, zero padded, byte 15 = sum of bytes 0..14 & 0xff; written to
 *     the V1 write characteristic.
 *   - big data: `[bc][action][len u16 LE][crc16 u16 LE][payload]`, not padded; written to the V2 command characteristic.
 *
 * Clock (doc §4): the ring is set to the device's LOCAL wall clock, as the Kotlin does (`ColmiEncoder.setDateTime` uses
 * the system zone). Every day index here is a local calendar day computed from `nowMs` + `tzOffsetS`.
 */
import { normalizeUuid, uuid16 } from '../types';

export const COLMI_UUIDS = {
  serviceV1: normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'),
  write: normalizeUuid('6e400002-b5a3-f393-e0a9-e50e24dcca9e'),
  notify: normalizeUuid('6e400003-b5a3-f393-e0a9-e50e24dcca9e'),
  /** The "big data" service: requests on `command`, replies on `bigData` (`ColmiUUIDs.SERVICE_V2` / `COMMAND` / `NOTIFY_V2`). */
  serviceV2: normalizeUuid('de5bf728-d711-4e47-af26-65e3012a5dc7'),
  command: normalizeUuid('de5bf72a-d711-4e47-af26-65e3012a5dc7'),
  bigData: normalizeUuid('de5bf729-d711-4e47-af26-65e3012a5dc7'),
  deviceInfo: uuid16(0x180a),
  firmwareRevision: uuid16(0x2a26),
  softwareRevision: uuid16(0x2a28),
} as const;

/** `ColmiCommandID`. */
export const OP = {
  SET_DATE_TIME: 0x01,
  BATTERY: 0x03,
  PHONE_NAME: 0x04,
  POWER_OFF: 0x08,
  PREFERENCES: 0x0a,
  BP_READ: 0x14,
  SYNC_HEART_RATE: 0x15,
  AUTO_HR_PREF: 0x16,
  REALTIME_HEART_RATE: 0x1e,
  REALTIME_HEART_RATE_ERROR: 0x9e,
  GOALS: 0x21,
  AUTO_SPO2_PREF: 0x2c,
  AUTO_STRESS_PREF: 0x36,
  SYNC_STRESS: 0x37,
  AUTO_HRV_PREF: 0x38,
  SYNC_HRV: 0x39,
  AUTO_TEMP_PREF: 0x3a,
  DEVICE_SUPPORT: 0x3c,
  SYNC_ACTIVITY: 0x43,
  FIND_DEVICE: 0x50,
  MANUAL_HEART_RATE: 0x69,
  REALTIME_STOP: 0x6a,
  NOTIFICATION: 0x73,
  PHONE_SPORT: 0x77,
  SPORT_NOTIFY: 0x78,
  BIG_DATA_V2: 0xbc,
  FACTORY_RESET: 0xff,
} as const;

export const PREF_READ = 0x01;
export const PREF_WRITE = 0x02;
/** 0x69 / 0x6a reading types. */
export const RT_HEART_RATE = 0x01;
export const RT_SPO2 = 0x03;
/** 0x73 notification subtypes the Kotlin decodes. */
export const NOTIF_BATTERY = 0x0c;
export const NOTIF_LIVE_ACTIVITY = 0x12;

/** Big-data actions. */
export const BIG = {
  TEMPERATURE: 0x25,
  SLEEP: 0x27,
  SPO2: 0x2a,
  SLEEP_LUNCH: 0x3e,
  BLOOD_SUGAR: 0x47,
  INTERVAL_TEMPERATURE: 0x77,
} as const;

/** `PhoneSportReq` statuses and the 0x78 status the ring sends when it ended the session itself. */
export const SPORT = { START: 0x01, PAUSE: 0x02, RESUME: 0x03, STOP: 0x04, ENDED_BY_RING: 0x03 } as const;

/** `ColmiEncoder.sportType`: anything without a vendor counterpart is "other" (0x0a). */
export function sportType(activityType: string): number {
  switch (activityType) {
    case 'walk':
      return 0x04;
    case 'run':
      return 0x07;
    case 'cycle':
      return 0x09;
    case 'hike':
      return 0x08;
    case 'yoga':
      return 0x16;
    default:
      return 0x0a;
  }
}

// ---------------------------------------------------------------- models and scan names (WearableModel.kt)

export interface ColmiModel {
  model: string;
  pattern: RegExp;
  /** Web Bluetooth `namePrefix` that covers the pattern. */
  prefix: string;
  /** The Kotlin OS-bonds only these models when the 0x3C reply asks for it (`WearableModel.requiresOsBond`). */
  bond: boolean;
}

/** Every Colmi-protocol name pattern from the Kotlin model catalogue. Colmi names always use an underscore before the hex. */
export const COLMI_MODELS: readonly ColmiModel[] = [
  { model: 'R02', pattern: /^R02_/, prefix: 'R02_', bond: false },
  { model: 'R03', pattern: /^R03_/, prefix: 'R03_', bond: false },
  { model: 'R05', pattern: /^R05_[0-9A-F]{4}$/, prefix: 'R05_', bond: false },
  { model: 'R06', pattern: /^R06_/, prefix: 'R06_', bond: false },
  { model: 'R07', pattern: /^COLMI R07_/, prefix: 'COLMI R07_', bond: false },
  { model: 'R08', pattern: /^R08_/, prefix: 'R08_', bond: false },
  { model: 'R09', pattern: /^R09_/, prefix: 'R09_', bond: true },
  { model: 'R10', pattern: /^COLMI R10_/, prefix: 'COLMI R10_', bond: false },
  { model: 'R10', pattern: /^R10_[0-9A-F]{4}$/, prefix: 'R10_', bond: false },
  { model: 'R11', pattern: /^R11C_[0-9A-F]{4}$/, prefix: 'R11C_', bond: true },
  { model: 'R11', pattern: /^R11_[0-9A-F]{4}$/, prefix: 'R11_', bond: true },
  { model: 'R12', pattern: /^COLMI R12_/, prefix: 'COLMI R12_', bond: false },
  { model: 'H59', pattern: /^H59_/, prefix: 'H59_', bond: false },
];

export function modelForName(name: string | undefined): ColmiModel | undefined {
  if (!name) return undefined;
  return COLMI_MODELS.find((m) => m.pattern.test(name));
}

// ---------------------------------------------------------------- framing (ColmiPacket)

/** `ColmiPacket.frame`: up to 15 content bytes, zero padded, checksum in byte 15. */
export function frame16(content: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(16);
  const n = Math.min(content.length, 15);
  for (let i = 0; i < n; i++) out[i] = content[i]! & 0xff;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += out[i]!;
  out[15] = sum & 0xff;
  return out;
}

/** `ColmiPacket.validating`: exactly 16 bytes with a matching checksum. */
export function isValidFrame(b: Uint8Array): boolean {
  if (b.length !== 16) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += b[i]!;
  return (sum & 0xff) === b[15];
}

/** CRC16/MODBUS (init 0xffff, poly 0xa001), as the Kotlin puts in a big-data request header. */
export function crc16Modbus(payload: ArrayLike<number>): number {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload[i]! & 0xff;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

// provenance: decompiled vendor app (big-data request header and CRC), via the Kotlin
export function bigDataRequest(action: number, payload: number[]): Uint8Array {
  const crc = crc16Modbus(payload);
  return Uint8Array.from([OP.BIG_DATA_V2, action, payload.length & 0xff, (payload.length >> 8) & 0xff, crc & 0xff, (crc >> 8) & 0xff, ...payload]);
}

// ---------------------------------------------------------------- local calendar (fixed offset)

const DAY_S = 86_400;

/** Local calendar day number (days since 1970-01-01 in local time) for `nowMs` at a fixed offset. */
export function localDayIndex(nowMs: number, tzOffsetS: number): number {
  return Math.floor((Math.floor(nowMs / 1000) + tzOffsetS) / DAY_S);
}

/** Epoch ms of local midnight of local day `day`. */
export function localMidnightMs(day: number, tzOffsetS: number): number {
  return (day * DAY_S - tzOffsetS) * 1000;
}

/** Days since 1970-01-01 of a civil date (proleptic Gregorian); NaN for a date that does not exist. */
export function civilDay(y: number, m: number, d: number): number {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
  return t / 86_400_000;
}

/** 'YYYY-MM-DD' of local day `day`. */
export function isoDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- encoders (ColmiEncoder; content only, unframed)

const clampByte = (v: number): number => Math.min(255, Math.max(0, Math.trunc(v)));
const bcd = (v: number): number => (Math.floor((v % 100) / 10) << 4) | v % 10;

export const enc = {
  phoneName: (): number[] => [OP.PHONE_NAME, 0x02, 0x0a, 0x50, 0x4c],

  /** BCD local wall clock + language byte (0 Chinese, 1 English; the Kotlin picks it from the system locale). */
  setDateTime(nowMs: number, tzOffsetS: number, language = 'en'): number[] {
    const d = new Date(nowMs + tzOffsetS * 1000);
    return [
      OP.SET_DATE_TIME, bcd(d.getUTCFullYear() % 2000), bcd(d.getUTCMonth() + 1), bcd(d.getUTCDate()),
      bcd(d.getUTCHours()), bcd(d.getUTCMinutes()), bcd(d.getUTCSeconds()), language === 'zh' ? 0x00 : 0x01,
    ];
  },

  /** `userPreferences`: unit, sex (0 female, 1 male, 2 other), age, cm, kg, then the 120/90 BP reference the vendor app sends. */
  userPreferences(p: { metric?: boolean; sex?: string; ageYears?: number; heightCm?: number; weightKg?: number } = {}): number[] {
    const sex = p.sex === 'female' ? 0x00 : p.sex === 'male' ? 0x01 : 0x02;
    return [
      OP.PREFERENCES, PREF_WRITE, 0x00, p.metric === false ? 0x01 : 0x00, sex,
      clampByte(p.ageYears ?? 25), clampByte(p.heightCm ?? 175), clampByte(p.weightKg ?? 70), 0x78, 0x5a, 0x00,
    ];
  },

  battery: (): number[] => [OP.BATTERY],
  readPref: (pref: number): number[] => [pref, PREF_READ],
  writePref: (pref: number, enabled: boolean): number[] => [pref, PREF_WRITE, enabled ? 0x01 : 0x00],

  // provenance: decompiled vendor app (7-field 0x16 write), via the Kotlin
  /** All-day HR: flag 01 on / 02 off, interval floor-to-5 then clamped 5..60, four zeroed alarm bytes newer firmware needs. */
  autoHeartRate(enabled: boolean, intervalMinutes = 5): number[] {
    const interval = Math.min(60, Math.max(5, Math.trunc(intervalMinutes / 5) * 5));
    return [OP.AUTO_HR_PREF, PREF_WRITE, enabled ? 0x01 : 0x02, interval, 0x00, 0x00, 0x00, 0x00];
  },

  // provenance: decompiled vendor app (0x3C device support), via the Kotlin
  deviceSupport: (): number[] => [OP.DEVICE_SUPPORT],
  readTempPref: (): number[] => [OP.AUTO_TEMP_PREF, 0x03, PREF_READ],
  // provenance: decompiled vendor app (6-field temperature-pref write), via the Kotlin
  writeTempPref: (enabled: boolean): number[] => [OP.AUTO_TEMP_PREF, 0x03, PREF_WRITE, enabled ? 0x01 : 0x00, 30, 5, 10, 0x00, 0xb9],
  readGoals: (): number[] => [OP.GOALS, PREF_READ],

  manualHeartRate: (): number[] => [OP.MANUAL_HEART_RATE, RT_HEART_RATE],
  // provenance: decompiled vendor app (0x6A stop carrying the last bpm), via the Kotlin
  manualHeartRateStop: (lastBpm: number): number[] => [OP.REALTIME_STOP, RT_HEART_RATE, clampByte(lastBpm), 0x00],
  // provenance: decompiled vendor app (0x69 03 25 SpO2 start), via the Kotlin
  manualSpo2: (): number[] => [OP.MANUAL_HEART_RATE, RT_SPO2, 0x25],
  manualSpo2Stop: (): number[] => [OP.REALTIME_STOP, RT_SPO2, 0x00, 0x00],

  // provenance: Gadgetbridge (AGPL) 0x1E real-time request, via the Kotlin
  realtimeHeartRate: (enable: boolean): number[] => [OP.REALTIME_HEART_RATE, enable ? 0x01 : 0x02],
  // provenance: Gadgetbridge (AGPL) 0x1E real-time request, via the Kotlin
  realtimeHeartRateContinue: (): number[] => [OP.REALTIME_HEART_RATE, 0x03],

  // provenance: decompiled vendor app (0x77 phone sport session), via the Kotlin
  phoneSport: (status: number, type: number): number[] => [OP.PHONE_SPORT, status & 0xff, type & 0xff],

  findDevice: (): number[] => [OP.FIND_DEVICE, 0x55, 0xaa],
  powerOff: (): number[] => [OP.POWER_OFF, 0x01],
  factoryReset: (): number[] => [OP.FACTORY_RESET, 0x66, 0x66],

  /** Activity log for a local day; the four trailing constants are not understood (doc §5). */
  syncActivity: (daysAgo: number): number[] => [OP.SYNC_ACTIVITY, clampByte(daysAgo), 0x0f, 0x00, 0x5f, 0x01],
  /** HR log: u32 LE epoch seconds of the local date at 00:00 UTC (`requestHeartRate`). */
  syncHeartRate(fromUnix: number): number[] {
    const t = fromUnix >>> 0;
    return [OP.SYNC_HEART_RATE, t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff];
  },
  syncStress: (daysAgo: number): number[] => [OP.SYNC_STRESS, clampByte(daysAgo)],
  /** HRV log: days ago written as a u32 LE. */
  syncHrv: (daysAgo: number): number[] => [OP.SYNC_HRV, clampByte(daysAgo), 0x00, 0x00, 0x00],

  bigDataSpo2: (): Uint8Array => bigDataRequest(BIG.SPO2, [0xff]),
  /** New sleep protocol: payload `ff 01` (all history, protocol version 1); the one-byte `ff` is ignored by rings. */
  bigDataSleep: (): Uint8Array => bigDataRequest(BIG.SLEEP, [0xff, 0x01]),
  bigDataTemperature: (days: number): Uint8Array => bigDataRequest(BIG.TEMPERATURE, [Math.min(255, Math.max(1, Math.trunc(days)))]),
  // provenance: decompiled vendor app (interval temperature, action 0x77), via the Kotlin
  bigDataIntervalTemperature: (daysAgo: number, packetIndex: number): Uint8Array => bigDataRequest(BIG.INTERVAL_TEMPERATURE, [clampByte(daysAgo), clampByte(packetIndex)]),
};

/** `ColmiSyncEngine.requestHeartRate`: the ring indexes its HR days on "local wall clock read as UTC". */
export function hrDayRequestUnix(nowMs: number, tzOffsetS: number, daysAgo: number): number {
  return (localDayIndex(nowMs, tzOffsetS) - daysAgo) * DAY_S;
}
