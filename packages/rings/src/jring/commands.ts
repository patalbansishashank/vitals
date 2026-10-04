/**
 * Jring ("56ff", generic SMART_RING rings) wire constants and command encoders. Tier P.
 * Ported from Lumen's `ring/RingProtocol.kt` (`RingUUIDs`, `RingCommandID`, `JringBandCapabilities`) and
 * `ring/RingEncoder.kt`. Every packet is exactly 20 bytes: byte 0 the command id, bytes 1..19 the payload, zero padded.
 * No length byte, no checksum. Multi-byte integers are little-endian. Spec: `packages/rings/docs/jring.md`.
 */
import { normalizeUuid, uuid16, type RingCommand } from '../types';

/** `RingPacket.PACKET_SIZE`: both directions. */
export const PACKET_SIZE = 20;

/** `RingUUIDs`: the family service, write 33f3, notify 33f4; battery 2a19 in the standard 180f service. */
export const JRING_SERVICE = normalizeUuid('000056ff-0000-1000-8000-00805f9b34fb');
export const JRING_WRITE = normalizeUuid('000033f3-0000-1000-8000-00805f9b34fb');
export const JRING_NOTIFY = normalizeUuid('000033f4-0000-1000-8000-00805f9b34fb');
export const BATTERY_SERVICE = uuid16(0x180f);
export const BATTERY_LEVEL = uuid16(0x2a19);
/** Standard Device Information; the handshake reads the firmware string 2a26 only when 0x0C gave none. */
export const DEVICE_INFO = uuid16(0x180a);
export const FIRMWARE_REVISION = uuid16(0x2a26);

/** Services a "SMART_RING" may turn out to expose instead (`DriverReroute`): Colmi UART v1/v2 and CRP's fdda. */
export const COLMI_SERVICE_V1 = normalizeUuid('6e40fff0-b5a3-f393-e0a9-e50e24dcca9e');
export const COLMI_SERVICE_V2 = normalizeUuid('de5bf728-d711-4e47-af26-65e3012a5dc7');
export const CRP_SERVICE = uuid16(0xfdda);

/** `JringCoordinator`: the generic factory name and the manufacturer-data needle (hex of the on-air block). */
export const JRING_NAME = 'SMART_RING';
export const JRING_MANUFACTURER_NEEDLE = '41422ec75b6a';

/** `RingCommandID` codes this port writes or reads (0x33 and 0x4B are used by the encoder but missing from the enum). */
export const CMD = {
  TIME_SYNC: 0x01,
  USER_INFO: 0x02,
  CURRENT_ACTIVITY: 0x03,
  FIND_RING: 0x04,
  PERCENT_STATUS: 0x0b,
  STATUS: 0x0c,
  HISTORY_SUMMARY: 0x10,
  SLEEP_TIMELINE: 0x11,
  HEART_RATE_SAMPLE_OR_START: 0x14,
  HEART_RATE_STOP: 0x15,
  HISTORY_MEASUREMENT_STREAM: 0x16,
  AUTO_HR_MODE: 0x19,
  STEP_GOAL: 0x1a,
  DEVICE_CAPABILITIES: 0x20,
  LOCALE: 0x21,
  COMBINED_MEASUREMENT: 0x23,
  COMBINED_RESULT: 0x24,
  SENSOR_COMPLETE: 0x27,
  BLOOD_DATA_NOTIFY: 0x28,
  BP_ADJUST: 0x33,
  KEEPALIVE_PING: 0x3a,
  SPO2_RESULT: 0x3f,
  APP_IDENTIFIER: 0x48,
  BIND: 0x4b,
  FIRMWARE_NUMBER: 0xf6,
} as const;

/** 0x4B actions (`RingEncoder.makeBindCommand`, vendor `setBindedInfo`). */
export const BIND = { INIT: 0, APP_START: 1, ACK: 2, ACK_CANCEL: 3, SUCCESS: 4, UNBOND: 5, UNBOND_ACK: 6 } as const;

/** `JringSyncEngine.sendKeepalive`, scheduled every 15 s by `RingBLEClient` while connected. The ring never answers it. */
export const JRING_KEEPALIVE_MS = 15_000;
/** Days asked for on the first history pass of a connection (`JRING_BACKFILL_DAYS`); later passes ask for one. */
export const JRING_BACKFILL_DAYS = 3;
/** `makeHistoryQueryCommand`: `days.coerceIn(0, 27)`. */
export const MAX_HISTORY_DAYS = 27;
/** `makeAutomaticHeartRateCommand(enabled = true, cadenceMinutes = 30)` as `runStartup` and `stopHeartRate` send it. */
export const AUTO_HR_CADENCE_MIN = 30;
/** `RingEncoder.makeDefaultUserInfoCommand`: age 25, male, 184 cm, 90 kg (`02 99 b8 5a`), sent on every connect. */
export const DEFAULT_PROFILE = { ageYears: 25, isMale: true, heightCm: 184, weightKg: 90 } as const;

/** A zero-padded 20-byte packet with `id` at byte 0. */
function packet(id: number, body: ArrayLike<number> = []): Uint8Array {
  const out = new Uint8Array(PACKET_SIZE);
  out[0] = id;
  for (let i = 0; i < body.length && i < PACKET_SIZE - 1; i++) out[i + 1] = (body[i] ?? 0) & 0xff;
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));
const u32le = (v: number): number[] => {
  const x = v >>> 0;
  return [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
};
/** `String.toByteArray(Charsets.US_ASCII)`: anything outside ASCII becomes '?'. */
const ascii = (s: string): number[] => Array.from(s, (c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x3f));

/**
 * `makeTimeSyncCommand`: bytes 1..4 = u32le(UTC epoch s + UTC offset s) (the ring clock runs on local wall-clock seconds),
 * byte 5 = offset in whole hours, integer division toward zero (+05:30 sends 5), as a signed byte.
 */
export function timeSyncCommand(nowMs: number, tzOffsetS: number): Uint8Array {
  return packet(CMD.TIME_SYNC, [...u32le(Math.floor(nowMs / 1000) + tzOffsetS), Math.trunc(tzOffsetS / 3600)]);
}

/** `makeUserInfoCommand`: age (0..127) | 0x80 when male, height cm (0..255), weight kg (0..255), 0 = metric (always). */
export function userInfoCommand(p: { ageYears: number; isMale: boolean; heightCm: number; weightKg: number }): Uint8Array {
  return packet(CMD.USER_INFO, [clamp(p.ageYears, 0, 127) | (p.isMale ? 0x80 : 0), clamp(p.heightCm, 0, 255), clamp(p.weightKg, 0, 255), 0]);
}

/** `makeHistoryQueryCommand`: byte 1 = days, clamped 0..27. The ring answers with 0x10 (activity) and 0x11 (sleep). */
export const historyQueryCommand = (days: number): Uint8Array => packet(CMD.HISTORY_SUMMARY, [clamp(days, 0, MAX_HISTORY_DAYS)]);

/** `makeAutomaticHeartRateCommand`: window 00:00..23:59, enable flag, cadence (min 1), constant 0x01 the vendor SDK hardcodes. */
export const autoHeartRateCommand = (enabled: boolean, cadenceMinutes = AUTO_HR_CADENCE_MIN): Uint8Array =>
  packet(CMD.AUTO_HR_MODE, [0x00, 0x00, 0x17, 0x3b, enabled ? 1 : 0, Math.max(1, Math.round(cadenceMinutes)), 0x01]);

/** `makeGoalCommand`: u32le steps, never negative. */
export const goalCommand = (steps: number): Uint8Array => packet(CMD.STEP_GOAL, u32le(Math.max(0, Math.round(steps))));

/** `makeLocaleCommand`: up to 19 ASCII bytes. Lumen always sends 'en-US'. */
export const localeCommand = (locale = 'en-US'): Uint8Array => packet(CMD.LOCALE, ascii(locale).slice(0, 19));

/** `makeAppIdCommand`: up to 18 ASCII bytes at 1..18 (byte 19 stays zero). */
export const appIdCommand = (appId: string): Uint8Array => packet(CMD.APP_IDENTIFIER, ascii(appId).slice(0, 18));

/** `makeBindCommand(action, state = 0, type = 1)`. */
export const bindCommand = (action: number, state = 0, type = 1): Uint8Array => packet(CMD.BIND, [action, state, type]);

/** `makeBPAdjustCommand`: systolic and diastolic as u16le (a cuff reference). */
export const bpAdjustCommand = (systolic: number, diastolic: number): Uint8Array =>
  packet(CMD.BP_ADJUST, [systolic & 0xff, (systolic >> 8) & 0xff, diastolic & 0xff, (diastolic >> 8) & 0xff]);

/** Literal frames from `RingEncoder` (status, history stream, heart rate, SpO2 mode 2 / stop, find, capabilities, keepalive). */
export const statusCommand = (): Uint8Array => packet(CMD.STATUS);
export const historyMeasurementQueryCommand = (): Uint8Array => packet(CMD.HISTORY_MEASUREMENT_STREAM);
/** `14 b4`: byte 1 (180) is a vendor constant whose meaning the Kotlin does not know (UNVERIFIED). */
export const heartRateStartCommand = (): Uint8Array => packet(CMD.HEART_RATE_SAMPLE_OR_START, [0xb4]);
export const heartRateStopCommand = (): Uint8Array => packet(CMD.HEART_RATE_STOP);
/** 0x23 is a mode selector: 2 = SpO2, which also returns the full combined 0x24 reply; 0 = stop. Mode 1 (blood pressure) is never sent. */
export const spo2StartCommand = (): Uint8Array => packet(CMD.COMBINED_MEASUREMENT, [0x02]);
export const spo2StopCommand = (): Uint8Array => packet(CMD.COMBINED_MEASUREMENT, [0x00]);
export const findRingCommand = (): Uint8Array => packet(CMD.FIND_RING, [0x0a]);
export const bandFunctionCommand = (): Uint8Array => packet(CMD.DEVICE_CAPABILITIES);
export const keepaliveCommand = (): Uint8Array => packet(CMD.KEEPALIVE_PING);

/**
 * `JringBandCapabilities`: the 19 payload bytes of the 0x20 reply as a bit array; bit n is byte n / 8, mask 1 << (n % 8).
 * The bit indices come from the vendor app; the bit order inside a byte is an assumption (UNVERIFIED).
 */
export function jringCapabilities(payload: Uint8Array): { hasTemperature: boolean; separateBloodOxygenMode: boolean; hasOxygenOfflineHistory: boolean; hasPressureHistory: boolean } {
  const bit = (n: number): boolean => ((payload[Math.floor(n / 8)] ?? 0) & (1 << n % 8)) !== 0;
  return { hasTemperature: bit(10), separateBloodOxygenMode: bit(65), hasOxygenOfflineHistory: bit(81), hasPressureHistory: bit(83) };
}

/** The keepalive as a library command, for the service to schedule every `JRING_KEEPALIVE_MS` (the protocol runs no timers). */
export const jringKeepalive: RingCommand = { op: 'keepalive' };
/** Forget: 0x4B UNBOND; the protocol waits up to 1.5 s for UNBOND_ACK or ACK_CANCEL (`RingBLEClient.forgetAndWait`). */
export const jringForget: RingCommand = { op: 'bind', params: { action: BIND.UNBOND } };
/** Re-push the clock (`JringSyncEngine.resyncTime`): re-latches the offset. Call on a timezone or wall-clock change. */
export const jringResyncTime: RingCommand = { op: 'timeSync' };
