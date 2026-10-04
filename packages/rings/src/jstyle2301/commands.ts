/**
 * J-Style 2301 ring wire constants and command framing. Tier P.
 * Ported line-for-line from the owner's `ring/JStyle2301Protocol.kt` (Android LumenHealth fork; R10 §4.1–§4.2), which was
 * built from the vendor app's bundled `com.jstyle.blesdk2301` SDK and the owner's own captures.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';

/** GATT topology (R10 §4.1): one service, write FFF6, notify FFF7. 16-bit aliases are accepted by Web Bluetooth. */
export const J2301_UUIDS = {
  service: '0000fff0-0000-1000-8000-00805f9b34fb',
  write: '0000fff6-0000-1000-8000-00805f9b34fb',
  notify: '0000fff7-0000-1000-8000-00805f9b34fb',
} as const;

/**
 * Advertising (R10 §4.1): company id 0x1234 with a payload ending `23 01`. The advertised name carries a retail brand,
 * so Vitals never matches on the name; scans use the FFF0 service and this marker.
 */
export const J2301_COMPANY_ID = 0x1234;

export const OP = {
  INFO_BATTERY: 0x13,
  INFO_CHIP: 0x21,
  INFO_FIRMWARE: 0x27,
  INFO_NAME: 0x3e,
  AUTHENTICATE: 0x3c,
  REALTIME_STEP: 0x09,
  MEASUREMENT_WITH_TYPE: 0x28,
  MEASUREMENT_TYPE_HEART_RATE: 0x02,
  SPORT_TELEMETRY: 0x18,
  SPORT_MODE: 0x19,
  SPORT_RUN: 0,
  SPORT_WALK: 9,
} as const;

export interface HistoryStreamDef {
  key: string;
  label: string;
  opcode: number;
  /** Fixed record size in bytes; null = 26 or 27 (activity total). */
  recordSize: number | null;
  /** Vitals stream this opcode feeds; also the cursor key. */
  stream: BioStream;
}

/** `JStyle2301HistoryStream` (R10 §4.3). */
export const HISTORY_STREAMS = {
  ACTIVITY_TOTAL: { key: 'ACTIVITY_TOTAL', label: 'activity', opcode: 0x51, recordSize: null, stream: 'steps' },
  ACTIVITY_DETAIL: { key: 'ACTIVITY_DETAIL', label: 'activity detail', opcode: 0x52, recordSize: 25, stream: 'steps' },
  SLEEP: { key: 'SLEEP', label: 'sleep', opcode: 0x53, recordSize: 34, stream: 'sleep_stage' },
  WORKOUT_HEART_RATE: { key: 'WORKOUT_HEART_RATE', label: 'workout heart rate', opcode: 0x54, recordSize: 24, stream: 'hr' },
  HEART_RATE: { key: 'HEART_RATE', label: 'heart rate', opcode: 0x55, recordSize: 10, stream: 'hr' },
  HRV: { key: 'HRV', label: 'HRV and stress', opcode: 0x56, recordSize: 15, stream: 'hrv' },
  TEMPERATURE: { key: 'TEMPERATURE', label: 'temperature', opcode: 0x62, recordSize: 11, stream: 'skin_temp' },
  SPO2: { key: 'SPO2', label: 'blood oxygen', opcode: 0x66, recordSize: 10, stream: 'spo2' },
} as const satisfies Record<string, HistoryStreamDef>;

/** `JStyle2301HistorySync.catalog` order: activity → detail → HR → workout HR → HRV → sleep → SpO2 → temperature. */
export const HISTORY_CATALOG: readonly HistoryStreamDef[] = [
  HISTORY_STREAMS.ACTIVITY_TOTAL,
  HISTORY_STREAMS.ACTIVITY_DETAIL,
  HISTORY_STREAMS.HEART_RATE,
  HISTORY_STREAMS.WORKOUT_HEART_RATE,
  HISTORY_STREAMS.HRV,
  HISTORY_STREAMS.SLEEP,
  HISTORY_STREAMS.SPO2,
  HISTORY_STREAMS.TEMPERATURE,
];

export function historyStreamForOpcode(opcode: number): HistoryStreamDef | undefined {
  return HISTORY_CATALOG.find((s) => s.opcode === opcode);
}

/** checksum = Σ bytes[0..14] & 0xFF, written to byte 15. */
export function checksum(packet: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 15 && i < packet.length; i++) sum += packet[i] ?? 0;
  return sum & 0xff;
}

function assertByte(v: number, what: string): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RangeError(`${what} must fit in one byte`);
}

/** `JStyle2301Protocol.command(opcode, mode)`; mode is only 0 (first page) or 2 (continuation). */
export function command(opcode: number, mode?: number): Uint8Array {
  assertByte(opcode, 'opcode');
  if (mode !== undefined && mode !== 0 && mode !== 2) throw new RangeError('history mode must be 0 or 2');
  const p = new Uint8Array(16);
  p[0] = opcode;
  if (mode !== undefined) p[1] = mode;
  p[15] = checksum(p);
  return p;
}

/** `JStyle2301Protocol.packet(opcode, vararg payload)`: payload bytes are truncated to 8 bits like Kotlin's `toByte()`. */
export function packet(opcode: number, ...payload: number[]): Uint8Array {
  assertByte(opcode, 'opcode');
  if (payload.length > 14) throw new RangeError('payload must be at most 14 bytes');
  const p = new Uint8Array(16);
  p[0] = opcode;
  payload.forEach((v, i) => (p[i + 1] = v & 0xff));
  p[15] = checksum(p);
  return p;
}

export const infoRequest = (opcode: number): Uint8Array => command(opcode);

export const historyRequest = (s: HistoryStreamDef, continuation = false): Uint8Array => command(s.opcode, continuation ? 2 : 0);

/** Vendor `BleSDK.RealTimeStep(true, false)`, sent 500 ms before the measurement command. */
export const prepareRealtimeMeasurement = (enable = true): Uint8Array => packet(OP.REALTIME_STEP, enable ? 0x01 : 0x00, 0x00);

/** Vendor `BleSDK.SetDeviceMeasurementWithType(AutoHeartRate, seconds, start)`; seconds as LE16. */
export function heartRateMeasurement(start: boolean, seconds = 30): Uint8Array {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 0xffff) throw new RangeError('measurement duration must fit two bytes');
  return packet(OP.MEASUREMENT_WITH_TYPE, OP.MEASUREMENT_TYPE_HEART_RATE, start ? 1 : 0, seconds & 0xff, (seconds >>> 8) & 0xff);
}

/** Vendor `BleSDK.EnterActivityMode(2, mode, state)`: state 1 start, 2 pause, 3 resume, 4 stop; mode 0 run, 9 walk. */
export function sportMode(mode: number, state: number): Uint8Array {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0xff || !Number.isInteger(state) || state < 1 || state > 4) throw new RangeError('bad sport mode/state');
  return packet(OP.SPORT_MODE, state, mode, 0, 2);
}

/**
 * V0789 credential rule exactly as `authenticationRequest` enforces it: 1–14 characters, printable ASCII (0x20–0x7E).
 * R10 §4.1 / SUITE_SPEC §4.6 describe the real key as 14 characters; the Kotlin accepts shorter ones, and so do we.
 */
export function validateCredential(v: string): boolean {
  if (v.length < 1 || v.length > 14) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** Non-mutating, connection-scoped authentication (opcode 0x3C) required by firmware V0789. Never log the result. */
export function authenticationRequest(credential: string): Uint8Array {
  if (!validateCredential(credential)) throw new RangeError('ring credential must contain 1 to 14 printable ASCII characters');
  const p = new Uint8Array(16);
  p[0] = OP.AUTHENTICATE;
  for (let i = 0; i < credential.length; i++) p[i + 1] = credential.charCodeAt(i);
  p[15] = checksum(p);
  return p;
}

/** Safe diagnostic copy of an outbound frame: an auth frame keeps its opcode and loses the credential. */
export function redactOutbound(frame: Uint8Array): Uint8Array {
  return frame[0] === OP.AUTHENTICATE ? command(OP.AUTHENTICATE) : frame.slice();
}

/** Terminal marker: `[opcode, …, 0xFF]` (standalone `opcode FF` or appended to the last records). */
export function isTerminal(p: Uint8Array, s: HistoryStreamDef): boolean {
  return p.length > 0 && p[0] === s.opcode && p[p.length - 1] === 0xff;
}
