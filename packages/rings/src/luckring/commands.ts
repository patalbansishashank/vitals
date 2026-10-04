/**
 * LuckRing (TK18 and relatives, company id 0xFF64, vendor protocol "K6") wire constants, packet framing and command
 * encoders. Tier P. Ported from Lumen's `LuckRingProtocol.kt` (UUIDs, `LuckRingPacketizer`, `LuckRingMixInfoTLV`,
 * data types) and `LuckRingEncoder.kt` (struct layouts, connect bundle, toggles); research in `docs/luckring.md`.
 *
 * Every write and every notification is one fixed 20-byte packet. Head: `[0]=0 [1]=devType [2]=continuations [3]=seq
 * [4]=cmdType [5]=dataType [6..7]=CRC 0000 [8..9]=payload length LE [10..19]=payload[0..9]`; continuation: `[0]=page
 * (1-based) [1..19]=next 19 payload bytes`. No checksum, no crypto, no credential.
 */
import { uuid16 } from '../types';

export const LUCKRING_SERVICE = uuid16(0xf618);
export const LUCKRING_NOTIFY = uuid16(0xb001);
/** Write without response only (`LuckRingUUIDs.WRITE`). */
export const LUCKRING_WRITE = uuid16(0xb002);
/** Standard Heart Rate service: present on the ring, deliberately not subscribed (the proprietary type 7 stream is used). */
export const LUCKRING_HEART_RATE_SERVICE = uuid16(0x180d);
/** Manufacturer company id; on air the block starts `64 ff`. */
export const LUCKRING_COMPANY_ID = 0xff64;
/** Head `devType` for outbound frames (`LuckRingUUIDs.DEVICE_TYPE`, the 618 family). */
export const DEVICE_TYPE = 1;

export const PACKET_SIZE = 20;
const HEAD_PAYLOAD = 10;
const CONTINUATION_PAYLOAD = 19;

/** `LuckRingCmdType`. */
export const CMD = { SEND: 1, SEND_NO_ACK: 2, REQUEST: 3, ACK: 4 } as const;
export type CmdName = keyof typeof CMD;
export const cmdName = (v: number): CmdName => (v === 2 ? 'SEND_NO_ACK' : v === 3 ? 'REQUEST' : v === 4 ? 'ACK' : 'SEND');

/** `LuckRingDataType` (only the types the Kotlin drives or decodes). */
export const DT = {
  DEV_INFO: 2,
  BATTERY: 3,
  REAL_SPORT: 4,
  HISTORY_SPORT: 5,
  SLEEP: 6,
  REAL_HEART: 7,
  HISTORY_HEART: 8,
  DEV_SYNC: 9,
  MIX_SPORT: 10,
  FIND_DEVICE: 11,
  EXERCISE_HEART: 17,
  REAL_BP: 18,
  REAL_O2: 20,
  FUNCTION_CONTROL: 22,
  REAL_HR: 24,
  HISTORY_O2: 40,
  HISTORY_BP: 41,
  HISTORY_HRV: 42,
  REAL_HRV: 45,
  REAL_TEMP: 46,
  HISTORY_TEMP: 47,
  STRESS: 52,
  STRESS_HISTORY: 53,
  USER_INFO: 102,
  LANGUAGE: 103,
  TIME: 104,
  DATA_SWITCH: 109,
  MIX_INFO: 110,
  GOALS: 111,
  RESET: 118,
  PAIR_FINISH: 120,
  CALL_ALARM: 124,
  HEART_AUTO_SWITCH: 128,
  UNBIND: 159,
} as const;

/** A logical frame: one command or one reassembled data frame (`LuckRingFrame`). */
export interface LogicalFrame {
  cmdType: number;
  dataType: number;
  payload: number[];
  seq: number;
  devType: number;
}

// ---------------------------------------------------------------- little-endian helpers (`LuckRingBytes`)

export const u16 = (b: ArrayLike<number>, i: number): number => (b.length < i + 2 ? 0 : (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8));
export const u24 = (b: ArrayLike<number>, i: number): number => (b.length < i + 3 ? 0 : (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16));
export const u32 = (b: ArrayLike<number>, i: number): number =>
  b.length < i + 4 ? 0 : ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16)) + (b[i + 3] ?? 0) * 0x1000000;
export const le16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
/** Low 32 bits, so a negative value wraps like Kotlin's `value and 0xFFFFFFFF`. */
export const le32 = (v: number): number[] => {
  const x = Number(BigInt.asUintN(32, BigInt(Math.trunc(v))));
  return [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
};
const byte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

// ---------------------------------------------------------------- framing (`LuckRingPacketizer`)

/** `continuationPages`: the head carries 10 payload bytes, each continuation 19. */
export function continuationPages(len: number): number {
  if (len <= HEAD_PAYLOAD) return 0;
  const rest = len - HEAD_PAYLOAD;
  return Math.floor(rest / CONTINUATION_PAYLOAD) + (rest % CONTINUATION_PAYLOAD > 0 ? 1 : 0);
}

/** `LuckRingPacketizer.packets`: head + continuations, each zero padded to 20 bytes; CRC bytes stay 0. */
export function packets(f: LogicalFrame): Uint8Array[] {
  const p = f.payload;
  const pages = continuationPages(p.length);
  const head = new Uint8Array(PACKET_SIZE);
  head[1] = f.devType & 0xff;
  head[2] = Math.min(pages, 255);
  head[3] = f.seq & 0xff;
  head[4] = f.cmdType & 0xff;
  head[5] = f.dataType & 0xff;
  head[8] = p.length & 0xff;
  head[9] = (p.length >>> 8) & 0xff;
  for (let i = 0; i < Math.min(HEAD_PAYLOAD, p.length); i++) head[HEAD_PAYLOAD + i] = p[i]! & 0xff;
  const out = [head];
  for (let page = 1; page <= pages; page++) {
    const c = new Uint8Array(PACKET_SIZE);
    c[0] = Math.min(page, 255);
    const start = HEAD_PAYLOAD + (page - 1) * CONTINUATION_PAYLOAD;
    for (let i = 0; i < CONTINUATION_PAYLOAD && start + i < p.length; i++) c[1 + i] = p[start + i]! & 0xff;
    out.push(c);
  }
  return out;
}

/** `LuckRingPacketizer.ack`: echoes the ring's seq and devType; `[4]=4`, length 1, status `[10]=1` (accepted). */
export function ackPacket(dataType: number, seq: number, devType: number): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p[1] = devType & 0xff;
  p[3] = seq & 0xff;
  p[4] = CMD.ACK;
  p[5] = dataType & 0xff;
  p[8] = 1;
  p[10] = 1;
  return p;
}

// ---------------------------------------------------------------- MixInfo TLV (`LuckRingMixInfoTLV`)

export interface MixProperty {
  type: number;
  data: number[];
}

/** `[totalLen u16][itemCount u8]` then `[propLen u16 = dataLen + 3][propType][data]`; totalLen = Σ propLen + 1. */
export function mixInfoEncode(props: MixProperty[]): number[] {
  const body: number[] = [];
  for (const p of props) body.push(...le16(p.data.length + 3), p.type & 0xff, ...p.data);
  return [...le16(body.length + 1), props.length & 0xff, ...body];
}

/** Walks `itemCount` properties from offset 3; `totalLen` is ignored like the Kotlin. */
export function mixInfoDecode(b: number[]): MixProperty[] {
  if (b.length < 3) return [];
  const out: MixProperty[] = [];
  let i = 3;
  for (let n = 0; n < (b[2] ?? 0); n++) {
    if (i + 3 > b.length) break;
    const propLen = u16(b, i);
    const dataLen = propLen - 3;
    if (dataLen < 0 || i + 3 + dataLen > b.length) break;
    out.push({ type: b[i + 2]!, data: b.slice(i + 3, i + 3 + dataLen) });
    i += propLen;
  }
  return out;
}

// ---------------------------------------------------------------- struct layouts (`LuckRingEncoder` companion)

export interface LuckRingProfile {
  sex: 'male' | 'female' | 'other';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  userId?: number;
}

/** The engine default when the app has no profile yet: gender other, age 0 (sent as 20), height 0, weight 0. */
export const DEFAULT_PROFILE: LuckRingProfile = { sex: 'other', ageYears: 0, heightCm: 0, weightKg: 0, userId: 0 };
export const DEFAULT_GOAL_STEPS = 10_000;

/**
 * `userInfoBytes`: `[userId u32][sex][age][height cm][weight kg][00]`. Sex is inverted on the wire: male 0, anything else 1.
 * Age below 1 becomes the vendor default 20. Kotlin takes UByte fields; we round and clamp to 0..255.
 */
export function userInfoBytes(p: LuckRingProfile): number[] {
  const age = byte(p.ageYears);
  return [...le32(p.userId ?? 0), p.sex === 'male' ? 0 : 1, age < 1 ? 20 : age, byte(p.heightCm), byte(p.weightKg), 0];
}

/** `timeBytes`: `[UTC seconds u32][UTC offset seconds u32, negative wraps][format 00]`. True UTC, not wall time. */
export const timeBytes = (nowMs: number, tzOffsetS: number): number[] => [...le32(Math.floor(nowMs / 1000)), ...le32(tzOffsetS), 0];

/** `goalBytes`: `[steps u32][distance u32 0][calories u32 0][sleep u16 0][duration u16 0]`. */
export const goalBytes = (steps: number): number[] => [...le32(Math.max(0, Math.trunc(steps))), ...new Array<number>(12).fill(0)];

/** `autoMonitoring` (128): `[autoHR][hr24h 0][interval min 0..255][autoSpO2][00 00 00 00]`. */
export const autoMonitoringBytes = (hrEnabled: boolean, intervalMin: number, spo2Enabled: boolean): number[] => [
  hrEnabled ? 1 : 0, 0, Math.min(255, Math.max(0, Math.trunc(intervalMin))), spo2Enabled ? 1 : 0, 0, 0, 0, 0,
];

/**
 * `startupBundle` (110): the vendor connect bundle, property order 102 user → 104 time → 124 call alarm `01 ff ff 00 00`
 * → 103 language → 109 data switch `01` → 111 goals → 120 pair `00 00` (the pairing animation is never asked for).
 */
export function startupBundleBytes(profile: LuckRingProfile, goalSteps: number, nowMs: number, tzOffsetS: number, languageCode = 0): number[] {
  return mixInfoEncode([
    { type: DT.USER_INFO, data: userInfoBytes(profile) },
    { type: DT.TIME, data: timeBytes(nowMs, tzOffsetS) },
    { type: DT.CALL_ALARM, data: [1, 0xff, 0xff, 0, 0] },
    { type: DT.LANGUAGE, data: [languageCode & 0xff] },
    { type: DT.DATA_SWITCH, data: [1] },
    { type: DT.GOALS, data: goalBytes(goalSteps) },
    { type: DT.PAIR_FINISH, data: [0, 0] },
  ]);
}
