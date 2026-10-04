/**
 * CRP (`fdda`-profile) ring family: UUIDs, opcodes, framing and every command encoder Lumen sends. Tier P.
 * Port of Lumen's `CRPProtocol.kt` (`CRPUUIDs`, `CRPCommands`, `CRPProtocol`) and the user-info mapping in
 * `CRPSyncEngine.userInfoFrame`. Byte-exact against `qa/fixtures/rings/crp/encode.json`.
 *
 * Frame: `FD DA L1 L0 GG CC payload…`; total length (header included) = `((L1 & 1) << 8) | L0`. No checksum, no sequence.
 * We always write `0x10` and `len & 0xff` (`CRPProtocol.frame`); every command we send is 6–11 bytes.
 */
import { fromHex, normalizeUuid, uuid16, type RingCommand, type Uuid } from '../types';

// ---------------------------------------------------------------- GATT (`CRPUUIDs`)

export const CRP_SERVICE: Uuid = uuid16(0xfdda);
/** Current-steps push, raw little-endian triples, no header. */
export const CRP_STEPS_NOTIFY: Uuid = uuid16(0xfdd1);
/** Write target for every command. */
export const CRP_WRITE: Uuid = uuid16(0xfdd2);
/** Framed command replies (`FD DA …`), reassembled across notifications. */
export const CRP_CMD_NOTIFY: Uuid = uuid16(0xfdd3);
/** Recording / OTA channel: subscribed like Lumen does, never decoded. */
export const CRP_RECORDING_NOTIFY: Uuid = uuid16(0xfdd6);
export const BATTERY_SERVICE: Uuid = uuid16(0x180f);
export const BATTERY_LEVEL: Uuid = uuid16(0x2a19);
export const DEVICE_INFO_SERVICE: Uuid = uuid16(0x180a);
export const FIRMWARE_REVISION: Uuid = uuid16(0x2a26);
export const SOFTWARE_REVISION: Uuid = uuid16(0x2a28);
/** Colmi UART services (`ColmiUUIDs.SERVICE_V1/V2`): a ring showing one of these is never CRP (`onServicesDiscovered`). */
export const COLMI_SERVICES: readonly Uuid[] = [normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e'), normalizeUuid('de5bf728-d711-4e47-af26-65e3012a5dc7')];

// ---------------------------------------------------------------- opcodes (`CRPCommands`)

export const GROUP = { DEVICE: 1, HISTORY: 2, POWER: 3, GOMORE: 7, ACTION: 9 } as const;

export const CMD = {
  // group 1
  SET_USER_INFO: 0,
  SET_TIME: 1,
  TIMING_HR: 6,
  TIMING_HRV: 7,
  TIMING_SPO2: 8,
  MEASURE_HR: 9,
  MEASURE_HRV: 10,
  MEASURE_SPO2: 11,
  TIMING_TEMP: 13,
  MEASURE_STRESS: 14,
  MEASURE_TEMP: 32,
  TIMING_STRESS: 39,
  // group 2
  QUERY_TIMING_HR_STATE: 6,
  QUERY_TIMING_HRV_STATE: 7,
  QUERY_TIMING_SPO2_STATE: 8,
  HISTORY_SLEEP: 14,
  HISTORY_HR: 15,
  HISTORY_HRV: 16,
  HISTORY_SPO2: 17,
  QUERY_TIMING_TEMP_STATE: 21,
  /** Temperature history; not 48, which is the vendor's sleep-state query and never answered (`CMD_QUERY_HISTORY_TEMP`). */
  HISTORY_TEMP: 22,
  QUERY_SUPPORT_SPO2_TYPE: 37,
  QUERY_TIMING_STRESS_STATE: 45,
  HISTORY_STRESS: 47,
  // group 3
  FACTORY_RESET: 0,
  QUERY_FIRMWARE: 3,
  WEAR_STATE: 7,
  // group 9
  FIND_DEVICE: 2,
} as const;

export const HEADER_SIZE = 6;
/** `CRPHistoryDay` caps at 14 days ago; a larger day index is a corrupt reply (`CRPDecoder.MAX_HISTORY_DAY`). */
export const MAX_HISTORY_DAY = 14;

/** The five all-day "timing" vitals: history opcode, sample width, terminal frame index (`CRPSyncEngine.terminalFrameIndex`). */
export interface TimingVital {
  op: 'history_hr' | 'history_spo2' | 'history_hrv' | 'history_stress' | 'history_temp';
  cmd: number;
  stream: 'hr' | 'spo2' | 'hrv' | 'vendor:stress' | 'skin_temp';
  twoByte: boolean;
  terminalFrame: number;
}

/** In Lumen's pull order (`CRPSyncEngine.queryAllHistory`): HR, SpO2, HRV, stress, temperature. */
export const TIMING_VITALS: readonly TimingVital[] = [
  { op: 'history_hr', cmd: CMD.HISTORY_HR, stream: 'hr', twoByte: false, terminalFrame: 1 },
  { op: 'history_spo2', cmd: CMD.HISTORY_SPO2, stream: 'spo2', twoByte: false, terminalFrame: 1 },
  { op: 'history_hrv', cmd: CMD.HISTORY_HRV, stream: 'hrv', twoByte: true, terminalFrame: 3 },
  { op: 'history_stress', cmd: CMD.HISTORY_STRESS, stream: 'vendor:stress', twoByte: false, terminalFrame: 1 },
  { op: 'history_temp', cmd: CMD.HISTORY_TEMP, stream: 'skin_temp', twoByte: true, terminalFrame: 3 },
];

export const timingByCmd = (cmd: number): TimingVital | undefined => TIMING_VITALS.find((v) => v.cmd === cmd);
export const timingByOp = (op: string): TimingVital | undefined => TIMING_VITALS.find((v) => v.op === op);

/** Monitor state read-backs (`sendConnectionQueries`), in Lumen's order. */
export const TIMING_STATE_QUERY: Record<string, number> = {
  hr: CMD.QUERY_TIMING_HR_STATE,
  hrv: CMD.QUERY_TIMING_HRV_STATE,
  spo2: CMD.QUERY_TIMING_SPO2_STATE,
  stress: CMD.QUERY_TIMING_STRESS_STATE,
  temp: CMD.QUERY_TIMING_TEMP_STATE,
};

// ---------------------------------------------------------------- framing (`CRPProtocol.frame`, `isFrameStart`, `frameLength`)

export function crpFrame(group: number, cmd: number, payload: ArrayLike<number> = []): Uint8Array {
  const total = payload.length + HEADER_SIZE;
  const out = new Uint8Array(total);
  out.set([0xfd, 0xda, 0x10, total & 0xff, group & 0xff, cmd & 0xff]);
  out.set(Array.from(payload, (b) => b & 0xff), HEADER_SIZE);
  return out;
}

export const isFrameStart = (b: Uint8Array): boolean => b.length >= 2 && b[0] === 0xfd && b[1] === 0xda;

/** The length's 9th bit rides bit 0 of byte 2 (vendor `H(byte[2], byte[3])`); 0 when too short. */
export const frameLength = (b: Uint8Array): number => (b.length < 4 ? 0 : ((b[2]! & 0x01) << 8) | b[3]!);

// ---------------------------------------------------------------- encoders

/**
 * `CRPProtocol.setTime`: the local wall clock encoded as if the phone were at UTC+8, then a fixed zone byte 8 (vendor
 * `b1/e.b`). The ring then shows local time in any zone.
 */
export function setTime(nowMs: number, tzOffsetS: number): Uint8Array {
  const epoch = Math.floor(nowMs / 1000) + tzOffsetS - 8 * 3600;
  return crpFrame(GROUP.DEVICE, CMD.SET_TIME, [epoch & 0xff, (epoch >>> 8) & 0xff, (epoch >>> 16) & 0xff, (epoch >>> 24) & 0xff, 8]);
}

/** `CRPProtocol.setUserInfo` (vendor `b1/k.a`): [heightCm, weightKg, ageYears, gender, strideCm]. */
export function setUserInfo(p: { heightCm: number; weightKg: number; ageYears: number; gender: number; strideCm: number }): Uint8Array {
  return crpFrame(GROUP.DEVICE, CMD.SET_USER_INFO, [p.heightCm, p.weightKg, p.ageYears, p.gender, p.strideCm]);
}

/**
 * `UserProfileValues.from` + `CRPSyncEngine.userInfoFrame`: whole numbers clamped to a byte, gender 0 female / 1 male /
 * 2 other (Lumen's Colmi convention; UNVERIFIED for CRP), stride = floor(height × 0.43) (Lumen's own estimate).
 */
export function userInfoParams(p: { sex: 'female' | 'male' | 'other'; ageYears: number; heightCm: number; weightKg: number }): {
  heightCm: number; weightKg: number; ageYears: number; gender: number; strideCm: number;
} {
  const byte = (v: number): number => Math.min(255, Math.max(0, Math.trunc(v)));
  const heightCm = byte(p.heightCm);
  return {
    heightCm,
    weightKg: byte(p.weightKg),
    ageYears: byte(p.ageYears),
    gender: p.sex === 'female' ? 0 : p.sex === 'male' ? 1 : 2,
    strideCm: byte(heightCm * 0.43),
  };
}

const num = (cmd: RingCommand, k: string, d = 0): number => (typeof cmd.params?.[k] === 'number' ? (cmd.params[k] as number) : d);
const bool = (cmd: RingCommand, k: string, d: boolean): boolean => (typeof cmd.params?.[k] === 'boolean' ? (cmd.params[k] as boolean) : d);
const flag = (cmd: RingCommand): number => (bool(cmd, 'enable', true) ? 1 : 0);

const MEASURE: Record<string, number> = {
  measure_hr: CMD.MEASURE_HR,
  measure_hrv: CMD.MEASURE_HRV,
  measure_spo2: CMD.MEASURE_SPO2,
  measure_stress: CMD.MEASURE_STRESS,
  measure_temp: CMD.MEASURE_TEMP,
};
const TIMING_INTERVAL: Record<string, number> = {
  timing_hr: CMD.TIMING_HR,
  timing_hrv: CMD.TIMING_HRV,
  timing_spo2: CMD.TIMING_SPO2,
  timing_stress: CMD.TIMING_STRESS,
};

/** Local date (`YYYY-MM-DD`) of an instant at a fixed UTC offset. */
export const localDate = (ms: number, tzOffsetS: number): string => new Date(ms + tzOffsetS * 1000).toISOString().slice(0, 10);
/** Epoch ms of the local midnight that starts the day holding `ms`. */
export const localMidnightMs = (ms: number, tzOffsetS: number): number => (Math.floor((ms / 1000 + tzOffsetS) / 86_400) * 86_400 - tzOffsetS) * 1000;
const dayNumber = (date: string): number => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
/** Whole days from `date` back to the local day holding `nowMs` (0 = today). */
export const daysAgo = (date: string, nowMs: number, tzOffsetS: number): number => dayNumber(localDate(nowMs, tzOffsetS)) - dayNumber(date);
export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The ring's day index for a history command: `day` when given, else `date` (a local date) counted back from the
 * command's stamped clock, so a plan made before midnight still asks for the right day after it.
 */
export function historyDay(cmd: RingCommand): number {
  if (typeof cmd.params?.day === 'number') return cmd.params.day;
  if (typeof cmd.params?.daysAgo === 'number') return cmd.params.daysAgo;
  const date = cmd.params?.date;
  if (typeof date !== 'string' || !date) return 0;
  return Math.max(0, daysAgo(date, num(cmd, 'nowMs'), num(cmd, 'tzOffsetS')));
}

/** Every command Lumen's CRP engine writes. Unknown ops throw; `battery` has no CRP command (read 0x2a19 instead). */
export function frameCrp(cmd: RingCommand): Uint8Array[] {
  const m = MEASURE[cmd.op];
  if (m !== undefined) return [crpFrame(GROUP.DEVICE, m, [flag(cmd)])];
  const ti = TIMING_INTERVAL[cmd.op];
  if (ti !== undefined) return [crpFrame(GROUP.DEVICE, ti, [num(cmd, 'intervalMin')])]; // 0 = off (`disableTiming*`)
  const tv = timingByOp(cmd.op);
  if (tv) {
    const day = historyDay(cmd);
    if (day > MAX_HISTORY_DAY) return [];
    return [crpFrame(GROUP.HISTORY, tv.cmd, [day, num(cmd, 'frameIndex')])];
  }
  switch (cmd.op) {
    case 'frame': {
      const p = cmd.params?.payload;
      return [crpFrame(num(cmd, 'group'), num(cmd, 'cmd'), typeof p === 'string' ? fromHex(p) : [])];
    }
    case 'set_time':
      return [setTime(num(cmd, 'nowMs'), num(cmd, 'tzOffsetS'))];
    case 'set_user_info':
      return [setUserInfo({ heightCm: num(cmd, 'heightCm'), weightKg: num(cmd, 'weightKg'), ageYears: num(cmd, 'ageYears'), gender: num(cmd, 'gender'), strideCm: num(cmd, 'strideCm') })];
    case 'timing_temp':
      return [crpFrame(GROUP.DEVICE, CMD.TIMING_TEMP, [flag(cmd)])]; // on/off only, no interval
    case 'history_sleep': {
      const day = historyDay(cmd);
      return day > MAX_HISTORY_DAY ? [] : [crpFrame(GROUP.HISTORY, CMD.HISTORY_SLEEP, [day])];
    }
    case 'query_spo2_support':
      return [crpFrame(GROUP.HISTORY, CMD.QUERY_SUPPORT_SPO2_TYPE)];
    case 'query_timing_state': {
      const c = TIMING_STATE_QUERY[String(cmd.params?.kind ?? '')];
      if (c === undefined) throw new RangeError(`crp: unknown timing state ${String(cmd.params?.kind)}`);
      return [crpFrame(GROUP.HISTORY, c)];
    }
    case 'query_firmware':
      return [crpFrame(GROUP.POWER, CMD.QUERY_FIRMWARE)];
    case 'factory_reset':
      return [crpFrame(GROUP.POWER, CMD.FACTORY_RESET)];
    case 'find_device':
      return [crpFrame(GROUP.ACTION, CMD.FIND_DEVICE, [flag(cmd)])];
    case 'battery':
      return []; // no battery opcode is sent by Lumen (3/6 is known, never used); the handshake reads 0x2a19
  }
  throw new RangeError(`crp: unknown command ${cmd.op}`);
}
