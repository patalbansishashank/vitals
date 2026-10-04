/**
 * The J-Style 2301 `RingFamily` (firmware V0525 and V0789). Tier P apart from the handshake, which only talks through the
 * session runtime. Port of Lumen's `JStyle2301Coordinator` / `JStyle2301Driver` / `JStyle2301SyncEngine` handshake.
 *
 * Scan match (decision 10): the FFF0 service or the 0x1234 manufacturer block ending `23 01`; never the retail name.
 * Handshake (`requestHistory` + `handleFirmware` + `handleAuthentication`): battery, firmware, then on V0789 the 0x3C
 * authentication with the built-in passcode (`passcode.ts`); an unknown firmware never reads history. The ring clock is
 * never set or read (R10 §4.2): `clockOffsetS` is 0 and history timestamps ahead of the device clock are reported per
 * stream as `status:clock_offset_s`.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, RingError, normalizeUuid, uuid16,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingFamily, type SessionRuntime,
} from '../types';
import { J2301_COMPANY_ID, J2301_UUIDS, OP, validateCredential } from './commands';
import { firmwareProfile } from './firmware';
import { builtInPasscode } from './passcode';
import { createJ2301Protocol, type J2301State } from './protocol';
import type { J2301Options } from './legacyProtocol';

export const J2301_SERVICE = normalizeUuid(J2301_UUIDS.service);
export const J2301_WRITE = normalizeUuid(J2301_UUIDS.write);
export const J2301_NOTIFY = normalizeUuid(J2301_UUIDS.notify);
/** Standard Device Information service: the serial number gives the ring its identity when the ring exposes it. */
const DEVICE_INFO = uuid16(0x180a);
const SERIAL_NUMBER = uuid16(0x2a25);

export const J2301_STREAMS: readonly BioStream[] = ['steps', 'hr', 'hrv', 'sleep_stage', 'spo2', 'skin_temp'];

/** `JStyle2301Coordinator.matches` without the brand-bearing name rule: LE company id 0x1234, block ending `23 01`. */
export function isJ2301Marker(block: Uint8Array): boolean {
  return block.length >= 4 && block[0] === (J2301_COMPANY_ID & 0xff) && block[1] === J2301_COMPANY_ID >> 8 && block[block.length - 2] === 0x23 && block[block.length - 1] === 0x01;
}

export function matchJ2301(ad: Advertisement): boolean {
  if (ad.serviceUuids.some((u) => normalizeUuid(u) === J2301_SERVICE)) return true;
  return ad.manufacturerData.some(isJ2301Marker);
}

export async function j2301Handshake(rt: SessionRuntime, opts: HandshakeOptions = {}): Promise<HandshakeInfo> {
  // Firmware first: a V0789 ring answers nothing, not even 0x13, before the 0x3C authentication (real-ring runs 2026-10-04),
  // so battery is read after the handshake on firmware that needs one.
  await rt.run({ op: 'firmware' }, opts.signal);
  const firmware = (rt.state as J2301State).firmware;
  const profile = firmwareProfile(firmware);
  if (profile.requiresAuthentication) {
    const credential = opts.credential ?? builtInPasscode();
    if (!validateCredential(credential)) throw new RingError('handshake value is invalid', 'credential_invalid');
    await rt.run({ op: 'authenticate', params: { credential } }, opts.signal);
    const auth = (rt.state as J2301State).auth;
    if (auth !== 'accepted') throw new RingError(auth === 'rejected' ? `${profile.id} ring refused the handshake` : `${profile.id} ring did not answer the handshake`, 'auth_rejected');
  }
  await rt.run({ op: 'battery' }, opts.signal);
  const st = rt.state as J2301State;
  const serialBytes = await rt.read(DEVICE_INFO, SERIAL_NUMBER);
  const serial = serialBytes && serialBytes.length > 0 ? new TextDecoder().decode(serialBytes).replace(/\0+$/, '').trim() || undefined : undefined;
  const base: HandshakeInfo = { firmware: st.firmware ?? '', battery: st.battery ?? undefined, serial, model: '2301', clockOffsetS: 0 };
  if (profile.id === 'UNKNOWN') return { ...base, historyBlocked: `unsupported_firmware:${st.firmware ?? 'none'}` };
  return base;
}

export function createJ2301Family(opts: J2301Options = {}): RingFamily {
  return {
    id: 'jstyle2301',
    label: 'J-Style 2301 ring',
    maker: 'J-Style',
    models: ['2301', '2301A', '2301B'],
    scan: {
      requestFilters: [{ services: [J2301_SERVICE] }, { manufacturerData: [{ companyIdentifier: J2301_COMPANY_ID }] }],
      optionalServices: [J2301_SERVICE, DEVICE_INFO],
      match: matchJ2301,
    },
    gatt: {
      service: J2301_SERVICE,
      write: J2301_WRITE,
      notify: [{ characteristic: J2301_NOTIFY, mode: 'notify' }],
      deviceInfo: { service: DEVICE_INFO, serial: SERIAL_NUMBER },
    },
    protocol: createJ2301Protocol(opts),
    streams: J2301_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    priority: DEFAULT_PRIORITY,
    handshake: j2301Handshake,
    // Vendor `RealTimeStep(true)` opens the 0x09 stream whose byte 21 carries live HR; `false` closes it.
    liveHeartRate: { start: { op: 'realtimeSteps', params: { enable: true } }, stop: { op: 'realtimeSteps', params: { enable: false } } },
    // Lumen's manual heart rate: `RealTimeStep(true)`, 500 ms, then `SetDeviceMeasurementWithType(HR, 30 s, start)`; the 0x28
    // replies carry the reading; stop reverses both (R10 §4.2, the manual heart rate note).
    spot: { hr: [{ op: 'realtimeSteps', params: { enable: true } }, { op: 'hrMeasure', params: { start: true, seconds: 30 } }] },
    spotStop: { hr: [{ op: 'hrMeasure', params: { start: false, seconds: 30 } }, { op: 'realtimeSteps', params: { enable: false } }] },
    spotGapMs: 500,
    decoderTag: (firmware) => `jstyle2301/${firmwareProfile(firmware).id}@1`,
  };
}

export const jstyle2301: RingFamily = createJ2301Family();

/** Opcodes a diagnostic may show in full; the 0x3C frame is always redacted (see `redactOutbound`). */
export const J2301_SAFE_OPCODES: readonly number[] = Object.values(OP).filter((v) => v !== OP.AUTHENTICATE);
