/**
 * The LuckRing `RingFamily` (TK18 and relatives, company id 0xFF64, vendor protocol "K6"). Tier P apart from the
 * handshake, which only talks through the session runtime. Port of Lumen's `LuckRingCoordinator.kt` (scan match),
 * `LuckRingDriver.kt` (GATT map) and `LuckRingSyncEngine.runStartup` (connect order); research in `docs/luckring.md`.
 *
 * No bond, no passcode, no clock read. Handshake = the Kotlin cold pass: connect bundle (110), auto-monitoring (128),
 * then device info (2), battery (3) and settings sync (9) requests written back to back; the handshake then waits for
 * those three replies (Android never waits; we need firmware and battery for `HandshakeInfo`). A silent ring does not
 * fail the connect.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingFamily, type SessionRuntime,
} from '../types';
import { DEFAULT_GOAL_STEPS, DT, LUCKRING_COMPANY_ID, LUCKRING_NOTIFY, LUCKRING_SERVICE, LUCKRING_WRITE } from './commands';
import { createLuckRingProtocol, type LuckRingState } from './protocol';

export const LUCKRING_STREAMS: readonly BioStream[] = ['steps', 'sleep_stage', 'hr', 'spo2', 'vendor:bp', 'hrv', 'skin_temp', 'vendor:stress'];

/** `WearableModel` pattern: the only catalog name of this family. */
const TK18_NAME = /^TK18([ _-].*)?$/;

/** `LuckRingCoordinator.matches`: the F618 service, any manufacturer block starting `64 ff`, or the TK18 name. */
export function matchLuckRing(ad: Advertisement): boolean {
  if (ad.serviceUuids.some((u) => normalizeUuid(u) === LUCKRING_SERVICE)) return true;
  // On-air layout: company id little endian first. Every block is tried, not only the first (`AdvertisementMatcher`).
  if (ad.manufacturerData.some((b) => b.length >= 2 && b[0] === (LUCKRING_COMPANY_ID & 0xff) && b[1] === LUCKRING_COMPANY_ID >> 8)) return true;
  return modelForName(ad.name) !== undefined;
}

export const modelForName = (name: string | undefined): string | undefined => (name && TK18_NAME.test(name) ? 'TK18' : undefined);

export async function luckRingHandshake(rt: SessionRuntime, opts: HandshakeOptions = {}): Promise<HandshakeInfo> {
  const sig = opts.signal;
  const p = opts.profile;
  // The bundle carries the profile when the caller has one, else the engine default (sex other, age 20, 0 cm, 0 kg).
  const profile: Record<string, string | number> = p ? { sex: p.sex, ageYears: p.ageYears, heightCm: p.heightCm, weightKg: p.weightKg } : {};
  await rt.run({ op: 'startupBundle', params: { ...profile, goalSteps: DEFAULT_GOAL_STEPS, languageCode: 0 } }, sig);
  // Auto-monitoring on every cold connect: HR every 30 min and SpO2 on, or the ring logs no history between syncs.
  await rt.run({ op: 'autoMonitoring', params: { hrEnabled: true, hrIntervalMinutes: 30, spo2Enabled: true } }, sig);
  await rt.run({ op: 'request', params: { dataType: DT.DEV_INFO, wait: false } }, sig);
  await rt.run({ op: 'request', params: { dataType: DT.BATTERY, wait: false } }, sig);
  await rt.run({ op: 'request', params: { dataType: DT.DEV_SYNC, waitFor: `${DT.DEV_INFO},${DT.BATTERY},${DT.DEV_SYNC}` } }, sig);
  const st = rt.state as LuckRingState;
  return { firmware: st.firmware, battery: st.battery ?? undefined, model: modelForName(rt.transport.peripheral.name), clockOffsetS: 0 };
}

export const luckring: RingFamily = {
  id: 'luckring',
  label: 'LuckRing ring',
  models: ['TK18'],
  scan: {
    requestFilters: [{ services: [LUCKRING_SERVICE] }, { manufacturerData: [{ companyIdentifier: LUCKRING_COMPANY_ID }] }, { namePrefix: 'TK18' }],
    optionalServices: [LUCKRING_SERVICE],
    match: matchLuckRing,
  },
  gatt: {
    service: LUCKRING_SERVICE,
    write: LUCKRING_WRITE,
    // B001 carries every reply; the standard Heart Rate service (180d) is deliberately not subscribed.
    notify: [{ characteristic: LUCKRING_NOTIFY, mode: 'notify' }],
    // B002 offers write without response only. Battery is in-band (data type 3); no Device Information read.
    writeMode: 'withoutResponse',
  },
  protocol: createLuckRingProtocol(),
  streams: LUCKRING_STREAMS,
  tier: 'C',
  reconnect: ANDROID_RECONNECT,
  // `ConnectionPriorityPolicy.kt` has no LuckRing case: the default rule.
  priority: DEFAULT_PRIORITY,
  handshake: luckRingHandshake,
  // Real HR toggle (24). A spot HR is the first usable sample of the same stream (no manual-HR command).
  liveHeartRate: { start: { op: 'realHeartRate', params: { on: true } }, stop: { op: 'realHeartRate', params: { on: false } } },
  spot: { hr: { op: 'realHeartRate', params: { on: true } }, spo2: { op: 'realSpO2', params: { on: true } } },
  spotStop: { hr: { op: 'realHeartRate', params: { on: false } }, spo2: { op: 'realSpO2', params: { on: false } } },
  decoderTag: (fw) => `luckring/${fw || 'unknown'}@1`,
  modelFromAdvertisement: (ad) => modelForName(ad.name),
};
