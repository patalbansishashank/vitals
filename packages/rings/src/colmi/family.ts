/**
 * The Colmi `RingFamily` (R02, R03, R05, R06, R07, R08, R09, R10, R11, R12, H59: one protocol, one driver). Tier P apart
 * from the handshake, which only talks through the session runtime. Port of the upstream Android Kotlin
 * `ColmiDriver` / `ColmiSyncEngine.sendConnectionConfiguration` / `RingBLEClient` (GATT order, bond allowlist) and the
 * name patterns of `wearables/WearableModel.kt`; research notes in `packages/rings/docs/colmi.md`.
 *
 * Handshake (doc §7): firmware from Device Information, then phone name, set time (the device's LOCAL wall clock, as the
 * Kotlin does), user preferences (the profile or the encoder defaults), device support (capability bits; a bond request
 * for the models the Kotlin bonds), battery, the six pref reads, then the measurement settings: the saved ones when the
 * caller has them, else SpO2/stress/HRV forced on and all-day HR switched on at the ring's own interval if it was off.
 * The clock is never read back, so `clockOffsetS` is 0.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingCommand, type RingFamily, type SessionRuntime,
} from '../types';
import { COLMI_MODELS, COLMI_UUIDS, OP, modelForName } from './commands';
import { createColmiProtocol, type ColmiState } from './protocol';

export const COLMI_STREAMS: readonly BioStream[] = ['steps', 'hr', 'vendor:stress', 'spo2', 'sleep_stage', 'hrv', 'skin_temp'];

/** What the Kotlin calls `MeasurementSettings`: the person's saved all-day measurement switches. */
export interface ColmiMeasurementSettings {
  hrEnabled: boolean;
  hrIntervalMinutes: number;
  spo2Enabled: boolean;
  stressEnabled: boolean;
  hrvEnabled: boolean;
  temperatureEnabled: boolean;
}

export interface ColmiOptions {
  /** Saved settings are written on every connect; without them the ring's own HR interval and temperature switch win. */
  settings?: ColmiMeasurementSettings;
  /** Language byte of the set-time command: 'zh' turns display models to Chinese (the Kotlin follows the locale). */
  language?: 'en' | 'zh';
}

/** `ColmiCoordinator.matches`: a Colmi model name, or the V1 or V2 service in the advertisement. */
export function matchColmi(ad: Advertisement): boolean {
  if (modelForName(ad.name)) return true;
  return ad.serviceUuids.some((u) => {
    const n = normalizeUuid(u);
    return n === COLMI_UUIDS.serviceV1 || n === COLMI_UUIDS.serviceV2;
  });
}

/** `enqueueMeasurementCommands`: HR, SpO2, stress, HRV, temperature, in that order. */
export function measurementCommands(s: ColmiMeasurementSettings): RingCommand[] {
  return [
    { op: 'autoHeartRate', params: { enabled: s.hrEnabled, intervalMinutes: s.hrIntervalMinutes } },
    { op: 'writePref', params: { pref: OP.AUTO_SPO2_PREF, enabled: s.spo2Enabled } },
    { op: 'writePref', params: { pref: OP.AUTO_STRESS_PREF, enabled: s.stressEnabled } },
    { op: 'writePref', params: { pref: OP.AUTO_HRV_PREF, enabled: s.hrvEnabled } },
    { op: 'writeTempPref', params: { enabled: s.temperatureEnabled } },
  ];
}

/**
 * The settings the Kotlin seeds from the ring when none were saved (`finishSeedingIfComplete`): HR forced on at the
 * ring's interval (5 when outside 5..60), SpO2/stress/HRV on, temperature as the ring said. Null until both replies came.
 */
export function seededSettings(st: ColmiState): ColmiMeasurementSettings | null {
  if (!st.hrPref || st.tempPref === null) return null;
  const i = st.hrPref.intervalMinutes;
  return { hrEnabled: true, hrIntervalMinutes: i >= 5 && i <= 60 ? i : 5, spo2Enabled: true, stressEnabled: true, hrvEnabled: true, temperatureEnabled: st.tempPref };
}

const decodeText = (b: Uint8Array | undefined): string => (b && b.length ? new TextDecoder().decode(b).replace(/\0+$/, '').trim() : '');

export function createColmiHandshake(opts: ColmiOptions = {}): RingFamily['handshake'] {
  return async function colmiHandshake(rt: SessionRuntime, h: HandshakeOptions = {}): Promise<HandshakeInfo> {
    const sig = h.signal;
    // Firmware revision (2a26), else software revision (2a28): the Kotlin reads both, from any service.
    const firmware = decodeText(await rt.read(COLMI_UUIDS.deviceInfo, COLMI_UUIDS.firmwareRevision)) || decodeText(await rt.read(COLMI_UUIDS.deviceInfo, COLMI_UUIDS.softwareRevision));
    const m = modelForName(rt.transport.peripheral.name);
    await rt.run({ op: 'identify', params: { firmware, model: m?.model ?? '', bond: m?.bond ?? false } }, sig);

    // `sendConnectionConfiguration`, in its order. The Kotlin queues all of it at once and never waits for a reply; here
    // the four reads whose replies are decoded wait up to REPLY_MS each, the rest are written back to back.
    await rt.run({ op: 'phoneName' }, sig);
    await rt.run({ op: 'setTime', params: { language: opts.language ?? 'en' } }, sig);
    const p = h.profile;
    await rt.run(p ? { op: 'userPreferences', params: { metric: p.metric, sex: p.sex, ageYears: p.ageYears, heightCm: p.heightCm, weightKg: p.weightKg } } : { op: 'userPreferences' }, sig);
    await rt.run({ op: 'deviceSupport' }, sig);
    await rt.run({ op: 'battery' }, sig);
    await rt.run({ op: 'readPref', params: { pref: OP.AUTO_HR_PREF } }, sig);
    await rt.run({ op: 'readPref', params: { pref: OP.AUTO_STRESS_PREF } }, sig);
    await rt.run({ op: 'readPref', params: { pref: OP.AUTO_SPO2_PREF } }, sig);
    await rt.run({ op: 'readPref', params: { pref: OP.AUTO_HRV_PREF } }, sig);
    await rt.run({ op: 'readTempPref' }, sig);
    await rt.run({ op: 'readGoals' }, sig);
    if (opts.settings) {
      for (const c of measurementCommands(opts.settings)) await rt.run(c, sig);
    } else {
      // Nothing saved: never overwrite the ring's own HR/temperature settings, but the history needs SpO2, stress and HRV.
      for (const pref of [OP.AUTO_SPO2_PREF, OP.AUTO_STRESS_PREF, OP.AUTO_HRV_PREF]) await rt.run({ op: 'writePref', params: { pref, enabled: true } }, sig);
      // All-day HR must be on or the HR log is empty. The Kotlin queues this write when the 16 01 reply comes in, behind
      // everything already queued; it lands last here as well.
      const hr = (rt.state as ColmiState).hrPref;
      if (hr && !hr.enabled) {
        const interval = hr.intervalMinutes >= 5 && hr.intervalMinutes <= 60 ? hr.intervalMinutes : 5;
        await rt.run({ op: 'autoHeartRate', params: { enabled: true, intervalMinutes: interval } }, sig);
      }
    }
    const st = rt.state as ColmiState;
    return { firmware, battery: st.battery ?? undefined, model: st.model ?? undefined, clockOffsetS: 0 };
  };
}

export function createColmiFamily(opts: ColmiOptions = {}): RingFamily {
  return {
    id: 'colmi',
    label: 'Colmi ring',
    maker: 'Colmi',
    models: [...new Set(COLMI_MODELS.map((m) => m.model))],
    scan: {
      requestFilters: [
        ...COLMI_MODELS.map((m) => ({ namePrefix: m.prefix })),
        { services: [COLMI_UUIDS.serviceV1] },
        { services: [COLMI_UUIDS.serviceV2] },
      ],
      optionalServices: [COLMI_UUIDS.serviceV1, COLMI_UUIDS.serviceV2, COLMI_UUIDS.deviceInfo],
      match: matchColmi,
    },
    gatt: {
      service: COLMI_UUIDS.serviceV1,
      write: COLMI_UUIDS.write,
      // Both channels are subscribed before anything else (`RingBLEClient`); big-data replies come on the V2 one.
      notify: [
        { characteristic: COLMI_UUIDS.notify, mode: 'notify' },
        { characteristic: COLMI_UUIDS.bigData, mode: 'notify', service: COLMI_UUIDS.serviceV2 },
      ],
      command: COLMI_UUIDS.command,
      commandService: COLMI_UUIDS.serviceV2,
      deviceInfo: { service: COLMI_UUIDS.deviceInfo, firmware: COLMI_UUIDS.firmwareRevision },
    },
    protocol: createColmiProtocol(),
    streams: COLMI_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    // `ConnectionPriorityPolicy.kt` gives Colmi the default rule.
    priority: DEFAULT_PRIORITY,
    handshake: createColmiHandshake(opts),
    // `startHeartRate` / `stopHeartRate`: 1e 01 / 1e 02, or 69 01 / 6a 01 <bpm> 00 once the ring refused 0x1E.
    liveHeartRate: { start: { op: 'liveHrStart' }, stop: { op: 'liveHrStop' } },
    // `measureHeartRateSpot` / `startSpO2`, and their stops (6a carries the last bpm for heart rate).
    spot: { hr: { op: 'manualHeartRate', params: { enable: true } }, spo2: { op: 'manualSpo2', params: { enable: true } } },
    spotStop: { hr: { op: 'manualHeartRateStop' }, spo2: { op: 'manualSpo2Stop' } },
    decoderTag: (fw) => `colmi/${fw || 'unknown'}@1`,
    modelFromAdvertisement: (ad) => modelForName(ad.name)?.model,
  };
}

export const colmi: RingFamily = createColmiFamily();
