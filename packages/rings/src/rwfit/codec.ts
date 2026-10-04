/**
 * RWfit wire codecs. Tier P. One GATT service (A00A) carries two framings that do not understand each other:
 *   - legacy `0x7E`: 8-byte header, XOR checksum over the payload, per-frame serials, an ACK for every frame;
 *   - JL `0xAB`: 6-byte header, CRC-16/ARC over the body, a `{cmd, key, keyFlag}` triple at the start of every body.
 * Port of Lumen's `RWfitProtocol.kt` (constants, checksums), `RWfitLegacyCodec.kt`, `RWfitJLCodec.kt` and the frame
 * builders of `RWfitEncoder.kt`. The Kotlin codecs are mutable classes; here their state (serial counter, multi-packet
 * buckets, JL reassembly) is a plain object the caller threads through, and every function returns the new state.
 */
import { normalizeUuid, uuid16, type Uuid } from '../types';

// ---------------------------------------------------------------- GATT and scan constants (RWfitProtocol.kt)

/** Data service, both framings. */
export const RWFIT_SERVICE = uuid16(0xa00a);
/** Commands and app ACKs, both framings. */
export const RWFIT_WRITE = uuid16(0xb002);
/** Replies and ring pushes. */
export const RWFIT_NOTIFY = uuid16(0xb003);
/** Framing markers: never opened, only seen after discovery. Any one present means JL framing. */
export const JL_SERVICE = uuid16(0xae00);
export const PIXART_OTA_SERVICE = uuid16(0xff00);
export const TELINK_OTA_SERVICE = '00010203-0405-0607-0809-0a0b0c0d1912';
/** `FRAMING_DISCRIMINATOR_UUIDS`, same order as the Kotlin list. */
export const FRAMING_MARKERS: readonly Uuid[] = [JL_SERVICE, TELINK_OTA_SERVICE, PIXART_OTA_SERVICE];

/** `MANUFACTURER_HEX_PREFIXES`: on-air layout, little-endian company id first (0x05d6, 0x05d6, 0x06d6). */
export const MANUFACTURER_PREFIXES: readonly (readonly number[])[] = [
  [0xd6, 0x05, 0x02, 0x00],
  [0xd6, 0x05, 0x41, 0x54],
  [0xd6, 0x06, 0x02, 0x00],
];

export type Framing = 'legacy' | 'jl';

/** `RWfitDriver.servicesDiscovered`: any marker service present (case-insensitive) → JL; none → legacy. */
export function chooseFraming(services: readonly string[]): Framing {
  const present = new Set(services.map((s) => normalizeUuid(s)));
  return FRAMING_MARKERS.some((m) => present.has(m)) ? 'jl' : 'legacy';
}

// ---------------------------------------------------------------- command ids

/** Legacy command ids (`RWfitProtocol.Legacy`). Only some are sent; the rest are listed for the decoder. */
export const LEGACY = {
  DEVICE_INFO: 0x00,
  BATTERY: 0x01,
  BATTERY_ALT: 0x60,
  BIND_STATUS: 0x02,
  FEATURES: 0x03,
  BIND: 0x20,
  SET_TIME: 0x21,
  UNITS: 0x24,
  PROFILE: 0x2e,
  UNBIND: 0x44,
  SYNC_MANIFEST: 0xa0,
  STEPS_HISTORY: 0xa1,
  SLEEP_HISTORY: 0xa2,
  HEART_RATE_HISTORY: 0xa3,
  BLOOD_PRESSURE_HISTORY: 0xa4,
  SPO2_HISTORY: 0xa5,
  TEMPERATURE_HISTORY: 0xa6,
  BREATHE_HISTORY: 0xa7,
  DEVICE_ACK: 0xfe,
  APP_ACK: 0xff,
} as const;

export type Triple = readonly [number, number, number];

/** JL triples (`RWfitProtocol.JieLi`). keyFlag: 0x00 set, 0x10 get or sync, 0x20 bind, 0x30 delete variant. */
export const JL = {
  SET_TIME: [0x02, 0x01, 0x00],
  BATTERY: [0x02, 0x03, 0x10],
  DEVICE_INFO: [0x02, 0x04, 0x10],
  REALTIME_MEASURE: [0x06, 0x09, 0x00],
} as const satisfies Record<string, Triple>;

/** JL `05`-group data types (`RWfitProtocol.JLDataType`): history `05 <type> 10` and the realtime-measure type byte. */
export const JL_TYPE = {
  STEPS: 0x02,
  HEART_RATE: 0x03,
  BLOOD_PRESSURE: 0x04,
  SLEEP: 0x05,
  TEMPERATURE: 0x08,
  SPO2: 0x09,
  HRV: 0x0a,
  STRESS: 0x0d,
  BLOOD_SUGAR: 0x10,
} as const;

export const jlHistoryTriple = (type: number): Triple => [0x05, type, 0x10];

export type HistoryType = 'steps' | 'sleep' | 'heart_rate' | 'blood_pressure' | 'spo2' | 'temperature' | 'breathe' | 'hrv' | 'stress' | 'blood_sugar';

export interface HistoryDef {
  type: HistoryType;
  /** Legacy request id, or null when legacy has no request (HRV, stress and blood sugar are JL only). */
  legacy: number | null;
  /** JL data type, or null when JL has none (breathing). */
  jl: number | null;
  /** Kotlin `HistoryType.label`, used as the progress stage. */
  label: string;
}

/** `RWfitProtocol.HistoryType`, in Kotlin enum order: the legacy cascade order and the JL burst order. */
export const HISTORY: readonly HistoryDef[] = [
  { type: 'steps', legacy: LEGACY.STEPS_HISTORY, jl: JL_TYPE.STEPS, label: 'activity' },
  { type: 'sleep', legacy: LEGACY.SLEEP_HISTORY, jl: JL_TYPE.SLEEP, label: 'sleep' },
  { type: 'heart_rate', legacy: LEGACY.HEART_RATE_HISTORY, jl: JL_TYPE.HEART_RATE, label: 'heart rate' },
  { type: 'blood_pressure', legacy: LEGACY.BLOOD_PRESSURE_HISTORY, jl: JL_TYPE.BLOOD_PRESSURE, label: 'blood pressure' },
  { type: 'spo2', legacy: LEGACY.SPO2_HISTORY, jl: JL_TYPE.SPO2, label: 'blood oxygen' },
  { type: 'temperature', legacy: LEGACY.TEMPERATURE_HISTORY, jl: JL_TYPE.TEMPERATURE, label: 'temperature' },
  { type: 'breathe', legacy: LEGACY.BREATHE_HISTORY, jl: null, label: 'breathing' },
  { type: 'hrv', legacy: null, jl: JL_TYPE.HRV, label: 'HRV' },
  { type: 'stress', legacy: null, jl: JL_TYPE.STRESS, label: 'stress' },
  { type: 'blood_sugar', legacy: null, jl: JL_TYPE.BLOOD_SUGAR, label: 'blood sugar' },
];

export const historyDef = (type: string): HistoryDef | undefined => HISTORY.find((h) => h.type === type);
export const historyByLegacy = (cmd: number): HistoryDef | undefined => HISTORY.find((h) => h.legacy === cmd);
export const historyByJl = (type: number): HistoryDef | undefined => HISTORY.find((h) => h.jl === type);

// ---------------------------------------------------------------- checksums (RWfitProtocol.kt)

/** XOR fold over the bytes (legacy payload checksum). The encoder writes 0x00 for an empty payload. */
export function xorChecksum(data: Uint8Array): number {
  let cs = 0;
  for (const b of data) cs ^= b;
  return cs;
}

/** CRC-16/ARC: init 0x0000, reflected poly 0xA001, no final XOR ("123456789" → 0xBB3D). */
export function crc16Arc(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

const u16be = (d: Uint8Array, o: number): number => ((d[o] ?? 0) << 8) | (d[o + 1] ?? 0);

// ---------------------------------------------------------------- legacy 0x7E (RWfitLegacyCodec.kt)

const LEGACY_MAGIC = 0x7e;
const LEGACY_VERSION = 0x01;
const LEGACY_HEADER = 8;
const LEGACY_MULTI_HEADER = 12;
export const MAX_SERIAL = 65_535;
const MAX_PAYLOAD = 0xff;

/** `nextSerial`: 1…65535, then wraps to 1. */
export const nextSerial = (serial: number): number => (serial >= MAX_SERIAL ? 1 : serial + 1);

/** `RWfitLegacyCodec.encode`: one single-packet frame stamped with `serial`. Outbound multi-packet is not ported (Kotlin neither). */
export function legacyFrame(cmd: number, payload: Uint8Array, serial: number): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new RangeError(`rwfit: legacy payload ${payload.length} exceeds one frame`);
  const f = new Uint8Array(LEGACY_HEADER + payload.length);
  f[0] = LEGACY_MAGIC;
  f[1] = LEGACY_VERSION;
  f[2] = cmd & 0xff;
  f[3] = 0; // single packet: no flags
  f[4] = payload.length;
  f[5] = (serial >> 8) & 0xff;
  f[6] = serial & 0xff;
  f[7] = payload.length === 0 ? 0 : xorChecksum(payload);
  f.set(payload, LEGACY_HEADER);
  return f;
}

/** `RWfitLegacyCodec.ack`: cmd 0xFF, payload `[serHi, serLo, cmd, status]` with the inbound serial; own header serial. */
export function legacyAck(cmd: number, inboundSerial: number, status: number, serial: number): Uint8Array {
  return legacyFrame(LEGACY.APP_ACK, Uint8Array.of((inboundSerial >> 8) & 0xff, inboundSerial & 0xff, cmd & 0xff, status & 0xff), serial);
}

export type LegacyInbound =
  | { kind: 'frame'; cmd: number; payload: Uint8Array }
  | { kind: 'deviceAck'; cmd: number; serial: number; status: number }
  | { kind: 'ackNeeded'; cmd: number; serial: number }
  | { kind: 'checksumFailed'; cmd: number; serial: number };

/** Multi-packet chunks waiting per command id (decimal key): `[index, bytes]` in arrival order. Serialisable. */
export type LegacyParts = Record<string, Array<[number, number[]]>>;

/**
 * `RWfitLegacyCodec.decode`: one notification is one whole frame. Emits the ACK request ahead of the frame (the vendor
 * ACKs before it parses). A device ACK (0xFE) is never itself ACKed. Non-0x7E or short notifications decode to nothing.
 */
export function decodeLegacy(data: Uint8Array, parts: LegacyParts): { items: LegacyInbound[]; parts: LegacyParts } {
  if (data.length < LEGACY_HEADER || data[0] !== LEGACY_MAGIC) return { items: [], parts };
  const cmd = data[2]!;
  const multi = ((data[3]! >> 3) & 1) === 1;
  const dataLen = data[4]!;
  const serial = u16be(data, 5);
  const checksum = data[7]!;
  // `decode`: the single-packet path when the flag is clear or the frame cannot hold the 12-byte header (size > 9).
  const bodyOffset = multi && data.length > LEGACY_MULTI_HEADER - 3 ? LEGACY_MULTI_HEADER : LEGACY_HEADER;
  if (data.length < bodyOffset + dataLen) return { items: [], parts };
  const chunk = data.slice(bodyOffset, bodyOffset + dataLen);
  if (dataLen > 0 && checksum !== xorChecksum(chunk)) return { items: [{ kind: 'checksumFailed', cmd, serial }], parts };
  if (cmd === LEGACY.DEVICE_ACK) {
    if (chunk.length < 4) return { items: [], parts };
    return { items: [{ kind: 'deviceAck', cmd: chunk[2]!, serial: u16be(chunk, 0), status: chunk[3]! }], parts };
  }
  const items: LegacyInbound[] = [{ kind: 'ackNeeded', cmd, serial }];
  if (bodyOffset === LEGACY_HEADER) return { items: [...items, { kind: 'frame', cmd, payload: chunk }], parts };
  // Multi-packet: collect per command id; emit when the last (1-based) index lands and the bucket holds `total` chunks.
  // A duplicate chunk keeps the frame from ever completing (Kotlin quirk, kept).
  const total = u16be(data, 8);
  const index = u16be(data, 10);
  const key = String(cmd);
  const bucket: Array<[number, number[]]> = [...(parts[key] ?? []), [index, Array.from(chunk)]];
  if (index === total && bucket.length === total) {
    const joined = Uint8Array.from([...bucket].sort((a, b) => a[0] - b[0]).flatMap((p) => p[1]));
    const rest = { ...parts };
    delete rest[key];
    return { items: [...items, { kind: 'frame', cmd, payload: joined }], parts: rest };
  }
  return { items, parts: { ...parts, [key]: bucket } };
}

// ---------------------------------------------------------------- JL 0xAB (RWfitJLCodec.kt)

const JL_MAGIC = 0xab;
export const JL_FLAG_NORMAL = 0x01;
export const JL_FLAG_ACK = 0x11;
const JL_HEADER = 6;

/** `RWfitJLCodec.encode`: length and CRC cover the triple plus the payload; CRC big-endian. */
export function jlFrame(triple: Triple, payload: Uint8Array = new Uint8Array(0), isAck = false): Uint8Array {
  const body = Uint8Array.from([...triple, ...payload]);
  const crc = crc16Arc(body);
  return Uint8Array.from([JL_MAGIC, isAck ? JL_FLAG_ACK : JL_FLAG_NORMAL, (body.length >> 8) & 0xff, body.length & 0xff, (crc >> 8) & 0xff, crc & 0xff, ...body]);
}

/** `RWfitJLCodec.ack`: flag 0x11, body = the inbound triple; for `06 09 xx` one trailing 0x00. */
export function jlAck(triple: Triple): Uint8Array {
  const realtime = triple[0] === JL.REALTIME_MEASURE[0] && triple[1] === JL.REALTIME_MEASURE[1];
  return jlFrame(triple, realtime ? Uint8Array.of(0) : new Uint8Array(0), true);
}

export type JlInbound = { kind: 'frame'; flag: number; triple: Triple; payload: Uint8Array; isAck: boolean } | { kind: 'checksumFailed'; triple: Triple };

/** A half-built JL body (header packet seen, continuations pending). Serialisable. */
export interface JlPending {
  flag: number;
  triple: [number, number, number];
  crc: number;
  expected: number;
  body: number[];
}

function jlFinish(flag: number, triple: Triple, crc: number, body: Uint8Array): JlInbound[] {
  if (crc16Arc(body) !== crc) return [{ kind: 'checksumFailed', triple }];
  return [{ kind: 'frame', flag, triple, payload: body.slice(3), isAck: flag === JL_FLAG_ACK }];
}

/**
 * `RWfitJLCodec.decode`. While a body is pending, every packet that does not start with 0xAB is raw body bytes (bytes past
 * the length are dropped). Kotlin quirks kept: a continuation whose first byte is 0xAB is read as a new header, and a
 * complete 0xAB frame that arrives mid-reassembly is decoded while the half-built body stays pending.
 */
export function decodeJl(data: Uint8Array, pending: JlPending | null): { items: JlInbound[]; pending: JlPending | null } {
  if (pending && (data.length === 0 || data[0] !== JL_MAGIC)) {
    const take = Math.min(pending.expected - pending.body.length, data.length);
    const body = [...pending.body, ...Array.from(data.subarray(0, take))];
    if (body.length < pending.expected) return { items: [], pending: { ...pending, body } };
    return { items: jlFinish(pending.flag, pending.triple, pending.crc, Uint8Array.from(body)), pending: null };
  }
  if (data.length < JL_HEADER || data[0] !== JL_MAGIC) return { items: [], pending };
  const flag = data[1]!;
  const bodyLen = u16be(data, 2);
  const crc = u16be(data, 4);
  if (data.length < JL_HEADER + 3) return { items: [], pending };
  const triple: [number, number, number] = [data[6]!, data[7]!, data[8]!];
  const available = data.length - JL_HEADER;
  if (bodyLen > available) {
    // Header packet of a multi-packet body: keep what arrived and wait for continuations.
    return { items: [], pending: { flag, triple, crc, expected: bodyLen, body: Array.from(data.subarray(JL_HEADER)) } };
  }
  return { items: jlFinish(flag, triple, crc, data.slice(JL_HEADER, JL_HEADER + bodyLen)), pending };
}

// ---------------------------------------------------------------- clock fields (RWfitEncoder.timeSync)

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Local wall clock from epoch ms and the device offset: the UTC fields of `nowMs + tzOffsetS`. */
export function wallClock(nowMs: number, tzOffsetS: number): WallClock {
  const d = new Date(nowMs + tzOffsetS * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

/** Legacy `0x21` payload: full year as BE u16 (`p.java u(Date)`). */
export function legacyTimePayload(c: WallClock): Uint8Array {
  return Uint8Array.of((c.year >> 8) & 0xff, c.year & 0xff, c.month, c.day, c.hour, c.minute, c.second);
}

/** JL `02 01 00` payload: year − 2000 in one byte (`p.java v(Date)`). */
export function jlTimePayload(c: WallClock): Uint8Array {
  return Uint8Array.of((c.year - 2000) & 0xff, c.month, c.day, c.hour, c.minute, c.second);
}
