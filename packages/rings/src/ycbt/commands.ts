/**
 * YCBT (Yucheng protocol) wire primitives: GATT map, framing and CRC, the frame assembler, every command Lumen sends,
 * the history catalog, the SupportFunction bitmap, the three variants and the ring clock. Tier P (pure, no I/O).
 * Port of Lumen's `YCBTProtocol.kt`, `YCBTEncoder.kt`, the variant profiles of `YCBTCoordinator.kt` /
 * `YCBTCoordinators.kt` and `SubscriptionSetupGate.topologyFailure`.
 *
 * Frame: `[group][cmd][len u16 LE = whole frame][payload][crc16 LE]`, CRC16/CCITT-FALSE over every byte before it.
 * A "logical" command is `[group][cmd][payload]`; `frameLogical` adds the length and the CRC.
 */
import { normalizeUuid, uuid16, type Uuid } from '../types';

// ---------------------------------------------------------------- GATT (`YCBTUUIDs`)

export const YCBT_SERVICE: Uuid = normalizeUuid('be940000-7333-be46-b7ae-689e71722bd5');
/** Write + indicate: every write goes here; command replies come back on it. */
export const YCBT_COMMAND: Uuid = normalizeUuid('be940001-7333-be46-b7ae-689e71722bd5');
/** Indicate only: live pushes and history. Writing the notification CCCD value here means nothing ever arrives. */
export const YCBT_STREAM: Uuid = normalizeUuid('be940003-7333-be46-b7ae-689e71722bd5');
/** QRing services: an advertisement carrying one is a Colmi ring, never YCBT (`YCBTCoordinator.matches`). */
export const QRING_SERVICES: readonly Uuid[] = [normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'), normalizeUuid('de5bf728-d711-4e47-af26-65e3012a5dc7')];
/** LuckRing service; Lumen checks that family before TK5, so the loose `TK5` name rule never takes one. */
export const LUCKRING_SERVICE: Uuid = uuid16(0xf618);
/** Yucheng's company id (0x7810), on air `10 78`. */
export const YCBT_COMPANY_ID = 0x7810;

/** `SubscriptionSetupGate.topologyFailure`: both indication channels must exist, enable locally and carry a CCCD. */
export function topologyFailure(channels: ReadonlyArray<{ characteristic: Uuid; localEnabled?: boolean; hasCccd?: boolean }>): string | null {
  const missing = [YCBT_COMMAND, YCBT_STREAM].filter((u) => {
    const c = channels.find((x) => normalizeUuid(x.characteristic) === u);
    return !c || c.localEnabled === false || c.hasCccd === false;
  });
  if (missing.length === 0) return null;
  return `Required ring indication channel unavailable: ${missing.map((u) => u.split('-')[0]!.toUpperCase()).join(', ')}`;
}

// ---------------------------------------------------------------- groups and keys

export const GROUP = { SETTING: 0x01, GET: 0x02, APP_CONTROL: 0x03, DEV_CONTROL: 0x04, HEALTH: 0x05, REAL: 0x06 } as const;
export const GET = { DEVICE_INFO: 0x00, SUPPORT_FUNCTION: 0x01, DEVICE_NAME: 0x03, USER_CONFIG: 0x07, CHIP_SCHEME: 0x1b } as const;
export const APP = { FIND_DEVICE: 0x00, LIVE_STATUS_PUSH: 0x09, LIVE_MEASUREMENT: 0x2f } as const;
export const REAL = { STATUS: 0x00, HEART_RATE: 0x01, SPO2: 0x02, VITALS: 0x03, WEARING: 0x13, BATTERY: 0x15 } as const;
export const DEV = { FIND_PHONE: 0x00, SOS: 0x05, MEASUREMENT_RESULT: 0x0e, MEASUREMENT_STATUS: 0x13, SEDENTARY: 0x16, SOS_CALL: 0x17 } as const;
export const SETTING = { SET_TIME: 0x00, USER_INFO: 0x03, UNITS: 0x04, HEART_MONITOR: 0x0c, LANGUAGE: 0x12, BP_MONITOR: 0x1c, TEMP_MONITOR: 0x20, SPO2_MONITOR: 0x26, HRV_MONITOR: 0x45 } as const;
/** `YCBTHealth`: the terminal block key and its acknowledgement statuses. */
export const HEALTH = { TERMINAL: 0x80, ACK_ACCEPTED: 0x00, ACK_CRC_FAILURE: 0x04, HEADER_LEN: 10, TERMINAL_LEN: 6 } as const;
/** `YCBTMeasurementMode`, shared by `03 2f`, `04 13` and `04 0e`. */
export const MODE = { HEART_RATE: 0x00, BLOOD_PRESSURE: 0x01, SPO2: 0x02, TEMPERATURE: 0x04, BLOOD_SUGAR: 0x05, URIC_ACID: 0x06, BLOOD_FAT: 0x09, HRV: 0x0a, STRESS: 0x0c } as const;

/** `YCBTFrameError.detect`: a one-byte payload `fb..ff` is the ring refusing; `fb`/`fc` are permanent. */
export function refusal(payload: ArrayLike<number>): { code: number; permanent: boolean } | null {
  if (payload.length !== 1) return null;
  const c = payload[0]!;
  return c >= 0xfb && c <= 0xff ? { code: c, permanent: c === 0xfb || c === 0xfc } : null;
}

// ---------------------------------------------------------------- framing (`YCBTFrame`)

/** CRC16/CCITT-FALSE: poly 0x1021, init 0xffff, no reflection, no final xor. */
export function crc16(bytes: ArrayLike<number>, offset = 0, length = bytes.length - offset): number {
  let crc = 0xffff;
  for (let i = offset; i < offset + length; i++) {
    crc ^= (bytes[i]! & 0xff) << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** `YCBTFrame.frame`: insert the whole-frame length after the two header bytes and append the CRC (LE). */
export function frameLogical(logical: ArrayLike<number>): Uint8Array {
  if (logical.length < 2) return Uint8Array.from(logical);
  const total = logical.length + 4;
  const out = new Uint8Array(total);
  out[0] = logical[0]!;
  out[1] = logical[1]!;
  out[2] = total & 0xff;
  out[3] = (total >> 8) & 0xff;
  for (let i = 2; i < logical.length; i++) out[i + 2] = logical[i]!;
  const crc = crc16(out, 0, total - 2);
  out[total - 2] = crc & 0xff;
  out[total - 1] = crc >> 8;
  return out;
}

export interface YcbtFrame {
  type: number;
  cmd: number;
  payload: Uint8Array;
}

/** `YCBTFrame.validating`: null when shorter than 6 bytes, the declared length is wrong or the CRC does not match. */
export function validateFrame(bytes: Uint8Array): YcbtFrame | null {
  if (bytes.length < 6) return null;
  if ((bytes[2]! | (bytes[3]! << 8)) !== bytes.length) return null;
  const given = bytes[bytes.length - 2]! | (bytes[bytes.length - 1]! << 8);
  if (crc16(bytes, 0, bytes.length - 2) !== given) return null;
  return { type: bytes[0]!, cmd: bytes[1]!, payload: bytes.slice(4, bytes.length - 2) };
}

// ---------------------------------------------------------------- assembler (`YCBTFrameAssembler`)

/** Pending bytes per characteristic (plain arrays so the protocol state stays serialisable). */
export type AssemblerBuffers = Record<string, number[]>;

/**
 * Feeds one notification. While 4+ bytes are buffered: a first byte outside groups 01..06 or a declared length outside
 * 6..1024 drops one byte (resync after garbage); otherwise wait for the whole declared length. Zero or more frames out.
 */
export function assemble(buffers: AssemblerBuffers, data: Uint8Array, channel: string): { buffers: AssemblerBuffers; frames: Uint8Array[] } {
  let buf = [...(buffers[channel] ?? []), ...data];
  const frames: Uint8Array[] = [];
  while (buf.length >= 4) {
    const declared = buf[2]! | (buf[3]! << 8);
    if (buf[0]! < GROUP.SETTING || buf[0]! > GROUP.REAL || declared < 6 || declared > 1024) {
      buf = buf.slice(1);
      continue;
    }
    if (buf.length < declared) break;
    frames.push(Uint8Array.from(buf.slice(0, declared)));
    buf = buf.slice(declared);
  }
  return { buffers: { ...buffers, [channel]: buf }, frames };
}

// ---------------------------------------------------------------- ring clock (`YCBTBytes.date`)

/** Ring times are local wall-clock seconds since 2000-01-01 with no zone. */
export const EPOCH_OFFSET_S = 946_684_800;

/** The zone ring times are read in: an IANA zone when known (per-record DST, as the Kotlin), else a fixed offset. */
export interface ZoneContext {
  tz?: string;
  tzOffsetS: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** UTC offset (s, east positive) of `tz` at `epochMs`. */
export function zoneOffsetS(tz: string, epochMs: number): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(epochMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return Math.round((wall - Math.floor(epochMs / 1000) * 1000) / 1000);
}

/**
 * Local wall-clock seconds (as if UTC) → epoch ms, like Java's `LocalDateTime.atZone`: the offset in force at that
 * local time; in an autumn overlap the earlier instant; in a spring gap the time moves forward by the gap.
 */
export function localToEpochMs(localS: number, zone: ZoneContext): number {
  if (!zone.tz) return (localS - zone.tzOffsetS) * 1000;
  const before = zoneOffsetS(zone.tz, (localS - 86_400) * 1000);
  const after = zoneOffsetS(zone.tz, (localS + 86_400) * 1000);
  const valid = [localS - before, localS - after].filter((t) => zoneOffsetS(zone.tz!, t * 1000) === localS - t);
  return (valid.length ? Math.min(...valid) : localS - before) * 1000;
}

/** `YCBTBytes.date`: a ring time (u32) to epoch ms in the given zone. */
export const ringTimeToMs = (ringSeconds: number, zone: ZoneContext): number => localToEpochMs(ringSeconds + EPOCH_OFFSET_S, zone);

/** Wall-clock fields of `epochMs` in the zone (for `01 00` set time). */
export function wallClock(epochMs: number, zone: ZoneContext): Date {
  const off = zone.tz ? zoneOffsetS(zone.tz, epochMs) : zone.tzOffsetS;
  return new Date(epochMs + off * 1000);
}

// ---------------------------------------------------------------- encoders (`YCBTEncoder` / `YCBTSettingsEncoder`), logical bytes

export const MIN_INTERVAL_MIN = 30;
export const DEFAULT_INTERVAL_MIN = 60;

/** `clampInterval`: 0 or less means 60; otherwise 30..255. */
export const clampInterval = (minutes: number): number => (minutes <= 0 ? DEFAULT_INTERVAL_MIN : Math.min(255, Math.max(MIN_INTERVAL_MIN, Math.round(minutes))));

/** `01 00 YY YY MM DD hh mm ss wd`, local wall clock, weekday Mon=0 … Sun=6. */
export function setTime(epochMs: number, zone: ZoneContext): number[] {
  const d = wallClock(epochMs, zone);
  const y = d.getUTCFullYear();
  return [GROUP.SETTING, SETTING.SET_TIME, y & 0xff, (y >> 8) & 0xff, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), (d.getUTCDay() + 6) % 7];
}

export interface YcbtProfile {
  heightCm: number;
  weightKg: number;
  /** Sex byte is 1 only for male; everything else sends 0. */
  male: boolean;
  ageYears: number;
}

/** `01 03 h w s a`. */
export const userInfo = (p: YcbtProfile): number[] => [GROUP.SETTING, SETTING.USER_INFO, p.heightCm & 0xff, p.weightKg & 0xff, p.male ? 1 : 0, p.ageYears & 0xff];
/** `01 04 d w t f 00 00`: 0 metric / 1 imperial for distance, weight, temperature; 0 = 24 h. */
export const units = (metric: boolean, is24Hour = true): number[] => {
  const i = metric ? 0 : 1;
  return [GROUP.SETTING, SETTING.UNITS, i, i, i, is24Hour ? 0 : 1, 0, 0];
};
export const language = (code = 0): number[] => [GROUP.SETTING, SETTING.LANGUAGE, code & 0xff];
export const deviceInfoRequest = (): number[] => [GROUP.GET, GET.DEVICE_INFO, 0x47, 0x43];
export const supportFunctionRequest = (): number[] => [GROUP.GET, GET.SUPPORT_FUNCTION, 0x47, 0x46];
export const deviceNameRequest = (): number[] => [GROUP.GET, GET.DEVICE_NAME, 0x47, 0x50];
export const userConfigRequest = (): number[] => [GROUP.GET, GET.USER_CONFIG, 0x43, 0x46];
export const chipSchemeRequest = (): number[] => [GROUP.GET, GET.CHIP_SCHEME];
/** `03 09 01 00 02`: the ring pushes `06 00` (today's totals). Payload meaning UNVERIFIED. */
export const enableLiveStatus = (): number[] => [GROUP.APP_CONTROL, APP.LIVE_STATUS_PUSH, 0x01, 0x00, 0x02];
/** `03 2f e m`: start (1) or stop (0) a measurement of mode `m`. */
export const liveMeasurement = (enable: boolean, mode: number): number[] => [GROUP.APP_CONTROL, APP.LIVE_MEASUREMENT, enable ? 1 : 0, mode & 0xff];
/** `03 00 01 05 02`. Payload meaning UNVERIFIED. */
export const findDevice = (): number[] => [GROUP.APP_CONTROL, APP.FIND_DEVICE, 0x01, 0x05, 0x02];
/** `04 kk 00`: acknowledges a `04 kk` push. */
export const devControlAck = (key: number): number[] => [GROUP.DEV_CONTROL, key & 0xff, 0x00];
export const historyRequest = (queryKey: number): number[] => [GROUP.HEALTH, queryKey & 0xff];
/** `05 80 ss`: 00 accepted, 04 CRC or length failure. */
export const historyBlockAck = (status: number): number[] => [GROUP.HEALTH, HEALTH.TERMINAL, status & 0xff];

// ---------------------------------------------------------------- capabilities (`WearableCapability`, `YCBTSupportFunction`)

export type Capability =
  | 'STEPS' | 'SLEEP' | 'REM_SLEEP' | 'HEART_RATE' | 'BLOOD_PRESSURE' | 'SPO2' | 'SPO2_HISTORY' | 'HRV' | 'FIND_DEVICE' | 'TEMPERATURE'
  | 'BLOOD_SUGAR' | 'STRESS' | 'FATIGUE' | 'BATTERY' | 'MANUAL_HEART_RATE' | 'MANUAL_BLOOD_PRESSURE' | 'MANUAL_SPO2' | 'MANUAL_HRV'
  | 'REALTIME_HEART_RATE' | 'REALTIME_STEPS' | 'MEASUREMENT_INTERVAL';

/** `YCBTSupportFunction.bits`, in the Kotlin order: [byte, bit, minimum payload length, capability]. */
const BITS: ReadonlyArray<readonly [number, number, number, Capability]> = [
  [0, 7, 14, 'STEPS'], [0, 6, 14, 'SLEEP'], [0, 3, 14, 'HEART_RATE'], [0, 0, 14, 'BLOOD_PRESSURE'], [1, 3, 14, 'SPO2'], [1, 1, 14, 'HRV'],
  [8, 0, 14, 'TEMPERATURE'], [17, 3, 18, 'BLOOD_SUGAR'], [22, 6, 23, 'STRESS'], [22, 6, 23, 'FATIGUE'], [6, 4, 14, 'FIND_DEVICE'],
  [15, 1, 18, 'MANUAL_HEART_RATE'], [15, 2, 18, 'MANUAL_BLOOD_PRESSURE'], [15, 3, 18, 'MANUAL_SPO2'], [23, 0, 24, 'MANUAL_HRV'],
];

/** Capabilities a `02 01` payload claims (bit n of byte b = `(payload[b] >> n) & 1`, read only past the minimum length). */
export function supportFunctions(payload: ArrayLike<number>): Capability[] {
  const out: Capability[] = [];
  for (const [byte, bit, min, cap] of BITS) if (payload.length >= min && byte < payload.length && ((payload[byte]! >> bit) & 1) === 1 && !out.includes(cap)) out.push(cap);
  return out;
}

// ---------------------------------------------------------------- variants (the three Lumen device types)

export type YcbtVariant = 'r10m' | 'tk5' | 'smarthealth';

export interface VariantProfile {
  model: string;
  baseline: readonly Capability[];
  gated: readonly Capability[];
  /** `02 1b` at startup. The R10M drops the link (HCI 0x13) when asked. */
  queryChipScheme: boolean;
  /** `01 1c` blood pressure monitor (when the bitmap also claims BP). Never on the R10M; the Kotlin gives no reason. */
  bpMonitor: boolean;
}

const COMMON: readonly Capability[] = ['HEART_RATE', 'SPO2', 'STEPS', 'SLEEP', 'REM_SLEEP', 'BATTERY', 'MANUAL_HEART_RATE', 'MANUAL_SPO2', 'REALTIME_HEART_RATE', 'REALTIME_STEPS', 'MEASUREMENT_INTERVAL'];

/** `YCBTCoordinator`, `TK5Coordinator`, `ColmiSmartHealthCoordinator` capability sets and driver profiles. */
export const VARIANTS: Record<YcbtVariant, VariantProfile> = {
  r10m: {
    model: 'R10M', baseline: COMMON, queryChipScheme: false, bpMonitor: false,
    gated: ['TEMPERATURE', 'BLOOD_PRESSURE', 'MANUAL_BLOOD_PRESSURE', 'STRESS', 'FATIGUE', 'BLOOD_SUGAR', 'HRV', 'MANUAL_HRV', 'FIND_DEVICE'],
  },
  tk5: {
    model: 'TK5', baseline: [...COMMON, 'SPO2_HISTORY', 'HRV', 'MANUAL_HRV', 'FIND_DEVICE'], queryChipScheme: true, bpMonitor: true,
    gated: ['TEMPERATURE', 'BLOOD_PRESSURE', 'MANUAL_BLOOD_PRESSURE', 'STRESS', 'FATIGUE', 'BLOOD_SUGAR'],
  },
  smarthealth: {
    model: 'SmartHealth ring', baseline: [...COMMON, 'SPO2_HISTORY', 'FIND_DEVICE'], queryChipScheme: true, bpMonitor: true,
    gated: ['TEMPERATURE', 'BLOOD_PRESSURE', 'STRESS', 'BLOOD_SUGAR', 'MANUAL_BLOOD_PRESSURE', 'HRV', 'MANUAL_HRV'],
  },
};

/** `baseline ∪ (claimed ∩ gated)`: the bitmap can only add. */
export function effectiveCapabilities(variant: YcbtVariant, claimed: readonly Capability[]): Capability[] {
  const v = VARIANTS[variant];
  return [...v.baseline, ...v.gated.filter((c) => claimed.includes(c) && !v.baseline.includes(c))];
}

/** `MeasurementSettings` for the five monitors; Lumen's `ALL_ON_DEFAULT` ("every 5 minutes", sent as 30). */
export interface MonitorSettings {
  hrEnabled: boolean;
  hrIntervalMinutes: number;
  spo2Enabled: boolean;
  hrvEnabled: boolean;
  temperatureEnabled: boolean;
}
export const ALL_ON_DEFAULT: MonitorSettings = { hrEnabled: true, hrIntervalMinutes: 5, spo2Enabled: true, hrvEnabled: true, temperatureEnabled: true };

/** `YCBTEncoder.monitorCommands`: HR, BP, temperature, SpO2, HRV in that order, each only for a sensor the ring has. */
export function monitorCommands(s: MonitorSettings, caps: readonly Capability[], bpMonitor: boolean): number[][] {
  const iv = clampInterval(s.hrIntervalMinutes);
  const on = (b: boolean): number => (b ? 1 : 0);
  const out: number[][] = [];
  if (caps.includes('HEART_RATE')) out.push([GROUP.SETTING, SETTING.HEART_MONITOR, on(s.hrEnabled), iv]);
  if (bpMonitor && caps.includes('BLOOD_PRESSURE')) out.push([GROUP.SETTING, SETTING.BP_MONITOR, on(s.hrEnabled), iv]); // uses the HR enable
  if (caps.includes('TEMPERATURE')) out.push([GROUP.SETTING, SETTING.TEMP_MONITOR, on(s.temperatureEnabled), iv]);
  if (caps.includes('SPO2')) out.push([GROUP.SETTING, SETTING.SPO2_MONITOR, on(s.spo2Enabled), iv]);
  if (caps.includes('HRV')) out.push([GROUP.SETTING, SETTING.HRV_MONITOR, on(s.hrvEnabled), iv, 0, 0, 0]);
  return out;
}

// ---------------------------------------------------------------- history catalog (`YCBTHistoryType`)

export type HistoryTypeName = 'sport' | 'sleep' | 'heart' | 'blood' | 'all' | 'spo2' | 'temperature' | 'comprehensive' | 'body_data';

export interface HistoryType {
  name: HistoryTypeName;
  queryKey: number;
  /** The data frame's cmd (`ackKey` in the Kotlin). */
  dataKey: number;
  /** Record size; null = variable (sleep). */
  stride: number | null;
  label: string;
  /** Vitals streams the type feeds; the first is the one `params.stream` names. */
  streams: readonly string[];
}

/** `YCBTHistoryType.CATALOG`, in walk order. */
export const HISTORY_CATALOG: readonly HistoryType[] = [
  { name: 'sport', queryKey: 0x02, dataKey: 0x11, stride: 14, label: 'activity', streams: ['steps', 'distance'] },
  { name: 'sleep', queryKey: 0x04, dataKey: 0x13, stride: null, label: 'sleep', streams: ['sleep_stage'] },
  { name: 'heart', queryKey: 0x06, dataKey: 0x15, stride: 6, label: 'heart rate', streams: ['hr'] },
  { name: 'blood', queryKey: 0x08, dataKey: 0x17, stride: 8, label: 'blood pressure', streams: ['vendor:ycbt_bp', 'hr'] },
  { name: 'all', queryKey: 0x09, dataKey: 0x18, stride: 20, label: 'vitals', streams: ['spo2', 'resp_rate', 'hrv', 'skin_temp', 'vendor:ycbt_bp', 'vendor:ycbt_glucose'] },
  { name: 'spo2', queryKey: 0x1a, dataKey: 0x22, stride: 6, label: 'blood oxygen', streams: ['spo2'] },
  { name: 'temperature', queryKey: 0x1e, dataKey: 0x26, stride: 7, label: 'temperature', streams: ['skin_temp'] },
  { name: 'comprehensive', queryKey: 0x2f, dataKey: 0x30, stride: 44, label: 'metabolic', streams: ['vendor:ycbt_glucose'] },
  { name: 'body_data', queryKey: 0x33, dataKey: 0x34, stride: 28, label: 'body data', streams: ['hrv', 'vendor:ycbt_stress', 'vendor:ycbt_fatigue', 'vendor:ycbt_vo2max'] },
];

export const historyType = (name: string): HistoryType | undefined => HISTORY_CATALOG.find((h) => h.name === name);

/** `YCBTSyncEngine.supportedHistoryTypes`: which types the capabilities make readable. */
export function supportedHistory(caps: readonly Capability[], types: readonly HistoryType[] = HISTORY_CATALOG): HistoryType[] {
  const has = (c: Capability): boolean => caps.includes(c);
  return types.filter((t) => {
    switch (t.name) {
      case 'sport': return has('STEPS');
      case 'sleep': return has('SLEEP');
      case 'heart': return has('HEART_RATE');
      case 'blood': return has('BLOOD_PRESSURE');
      case 'all': return true;
      case 'spo2': return has('SPO2_HISTORY');
      case 'temperature': return has('TEMPERATURE');
      case 'comprehensive': return has('BLOOD_SUGAR');
      case 'body_data': return has('HRV') || has('STRESS') || has('FATIGUE');
    }
    return false;
  });
}
