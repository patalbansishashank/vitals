/**
 * Concrete BLE drivers: pure protocol (src/biometrics/core/ble/*) + handshake over the generic session runner. Tier H.
 */
import type { BleDriver, BleLink, BleSession } from '@/biometrics/core/ble/types';
import { J2301_COMPANY_ID, J2301_UUIDS, validateCredential } from '@/biometrics/core/ble/jstyle2301/commands';
import { builtInPasscode } from '@/biometrics/core/ble/jstyle2301/passcode';
import { firmwareProfile } from '@/biometrics/core/ble/jstyle2301/firmware';
import { createJStyle2301Protocol, type J2301State } from '@/biometrics/core/ble/jstyle2301/protocol';
import { COLMI_UUIDS, createColmiProtocol, type ColmiState } from '@/biometrics/core/ble/colmi/protocol';
import { BleSessionError, openSession, type HandshakeInfo, type SessionOptions, type SessionRuntime } from './session';

/** `credential` overrides a driver's built-in passcode (tests only; no screen offers it). */
export type DriverOpenOptions = { credential?: string; signal?: AbortSignal } & Omit<SessionOptions, 'handshake' | 'signal'>;
/** A `BleDriver` whose `open` also accepts session options (clock, timers). */
export type VitalsBleDriver = Omit<BleDriver, 'open'> & { open(link: BleLink, opts?: DriverOpenOptions): Promise<BleSession> };

/**
 * J-Style 2301 handshake (`JStyle2301SyncEngine.requestHistory` + `handleFirmware` + `handleAuthentication`): battery and
 * firmware first; V0789 then needs its passcode (0x3C) before any history; unknown firmware never reads history.
 * The passcode is built in (`passcode.ts`), so connecting asks the person for nothing; it is used for one frame and never logged. The ring clock is never set or read (R10 §4.2), so
 * `clockOffsetS` is 0 here; history timestamps ahead of the phone clock are reported per stream as `status:clock_offset_s`.
 */
export async function jstyle2301Handshake(rt: SessionRuntime, credential: string = builtInPasscode(), signal?: AbortSignal): Promise<HandshakeInfo> {
  await rt.run({ op: 'battery' }, signal);
  await rt.run({ op: 'firmware' }, signal);
  const st = rt.state as J2301State;
  const profile = firmwareProfile(st.firmware);
  const base = { firmware: st.firmware ?? '', battery: st.battery ?? undefined, clockOffsetS: 0 };
  if (profile.id === 'UNKNOWN') return { ...base, historyBlocked: `unsupported_firmware:${st.firmware ?? 'none'}` };
  if (!profile.requiresAuthentication) return base;
  if (!validateCredential(credential)) throw new BleSessionError('ring passcode is invalid', 'credential_invalid');
  await rt.run({ op: 'authenticate', params: { credential } }, signal);
  if ((rt.state as J2301State).auth !== 'accepted') throw new BleSessionError(`${profile.id} ring refused the passcode`, 'auth_rejected');
  return base;
}

export const jstyle2301Driver: VitalsBleDriver = {
  id: 'jstyle2301',
  family: 'J-Style 2301',
  label: 'J-Style 2301',
  streams: ['steps', 'hr', 'hrv', 'sleep_stage', 'spo2', 'skin_temp'],
  // The FFF0 service or the 0x1234 manufacturer marker (R10 §4.4). Never the advertised name: it carries a retail brand.
  requestOptions: {
    filters: [{ services: [J2301_UUIDS.service] }, { manufacturerData: [{ companyIdentifier: J2301_COMPANY_ID }] }],
    optionalServices: [J2301_UUIDS.service],
  },
  gatt: { service: J2301_UUIDS.service, write: J2301_UUIDS.write, notify: J2301_UUIDS.notify },
  protocol: createJStyle2301Protocol(),
  open(link, opts: DriverOpenOptions = {}) {
    const { credential, signal, ...rest } = opts;
    return openSession(jstyle2301Driver, link, { ...rest, signal, handshake: (rt) => jstyle2301Handshake(rt, credential, signal) });
  },
};

/**
 * Colmi handshake [tahnok client.py + README "set the clock"]: set the ring clock to UTC, read battery and the HR-log
 * setting, and read the firmware string from the standard Device Information service when the link can read.
 * Setting the clock is the only write that changes ring state; the HR-log setting is reported, never changed here.
 */
export async function colmiHandshake(rt: SessionRuntime, signal?: AbortSignal): Promise<HandshakeInfo> {
  await rt.run({ op: 'setTime' }, signal);
  await rt.run({ op: 'battery' }, signal);
  await rt.run({ op: 'hrLogSettings' }, signal);
  let firmware = '';
  if (rt.link.read) {
    try {
      firmware = new TextDecoder().decode(await rt.link.read(COLMI_UUIDS.deviceInfo, COLMI_UUIDS.firmwareRevision)).replace(/\0+$/, '');
    } catch {
      firmware = '';
    }
  }
  const st = rt.state as ColmiState;
  return { firmware, battery: st.battery ?? undefined, clockOffsetS: 0 };
}

export const colmiDriver: VitalsBleDriver = {
  id: 'colmi-r02',
  family: 'Colmi R02 (QRing)',
  label: 'Colmi R02 / R06 / R10 ring',
  streams: ['hr', 'steps'],
  // Names like 'R02_341C' [tahnok README]; models listed as compatible there: R02, R06, R10.
  requestOptions: {
    filters: [{ namePrefix: 'R02_' }, { namePrefix: 'R06_' }, { namePrefix: 'R10_' }, { services: [COLMI_UUIDS.service] }],
    optionalServices: [COLMI_UUIDS.service, COLMI_UUIDS.deviceInfo],
  },
  gatt: { service: COLMI_UUIDS.service, write: COLMI_UUIDS.write, notify: COLMI_UUIDS.notify },
  protocol: createColmiProtocol(),
  open(link, opts: DriverOpenOptions = {}) {
    const { credential: _c, signal, ...rest } = opts;
    return openSession(colmiDriver, link, { ...rest, signal, handshake: (rt) => colmiHandshake(rt, signal) });
  },
};
