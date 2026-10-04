/**
 * The CRP `RingFamily` (the `fdda`-profile rings: the R11 sold with CRP firmware, the R100). Tier P apart from the
 * handshake, which only talks through the session runtime. Port of Lumen's `CRPCoordinator`, `CRPDriver`,
 * `CRPSyncEngine.runStartup` (without its history tail, which is `planSync`) and the CRP block of
 * `RingBLEClient.onServicesDiscovered`.
 *
 * Recognition (`CRPCoordinator.matches`): an R100 name (`R100` or `R100_<hex>`) or the `fdda` service in the
 * advertisement. The CRP R11 advertises the generic name SMART_RING with no service, so the scan hands it to the Jring
 * family; after connecting, `crpAfterDiscovery(services)` says whether the registry must switch to this family.
 *
 * Handshake: set_time, user info when a profile is known, then (once per connection, in this order, because the
 * read-backs must see the monitors before they are switched on) the firmware query, the SpO2-support query and the five
 * monitor state queries, then the five monitor commands, then the battery read. No bond, no credential, no clock read.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingCommand, type RingFamily, type SessionRuntime, type Uuid,
} from '../types';
import {
  BATTERY_LEVEL, BATTERY_SERVICE, COLMI_SERVICES, CRP_CMD_NOTIFY, CRP_RECORDING_NOTIFY, CRP_SERVICE, CRP_STEPS_NOTIFY, CRP_WRITE,
  DEVICE_INFO_SERVICE, FIRMWARE_REVISION, SOFTWARE_REVISION, userInfoParams,
} from './commands';
import { createCrpProtocol, type CrpState } from './protocol';

export const CRP_STREAMS: readonly BioStream[] = ['steps', 'hr', 'spo2', 'hrv', 'skin_temp', 'sleep_stage', 'vendor:stress'];

/** `WearableModel.R100` name pattern; `R100 1A2B` with a space belongs to another family. */
export const R100_NAME = /^R100(_[0-9A-Fa-f]+)?$/;

/** `MeasurementSettings` as the CRP monitors use it: one interval (the HR one) shared by the four interval monitors. */
export interface CrpMonitorSettings {
  hrEnabled: boolean;
  hrIntervalMinutes: number;
  hrvEnabled: boolean;
  stressEnabled: boolean;
  spo2Enabled: boolean;
  temperatureEnabled: boolean;
}

/** `MeasurementSettings.ALL_ON_DEFAULT`: a fresh ring has every monitor off and records nothing until this runs. */
export const CRP_ALL_ON_DEFAULT: CrpMonitorSettings = {
  hrEnabled: true, hrIntervalMinutes: 5, hrvEnabled: true, stressEnabled: true, spo2Enabled: true, temperatureEnabled: true,
};

/** `applyTimingSettings`: HR, HRV, stress, SpO2, temperature; a disabled monitor gets interval 0 (temperature `[0]`). */
export function crpMonitorCommands(s: CrpMonitorSettings = CRP_ALL_ON_DEFAULT): RingCommand[] {
  const iv = (on: boolean): number => (on ? s.hrIntervalMinutes : 0);
  return [
    { op: 'timing_hr', params: { intervalMin: iv(s.hrEnabled) } },
    { op: 'timing_hrv', params: { intervalMin: iv(s.hrvEnabled) } },
    { op: 'timing_stress', params: { intervalMin: iv(s.stressEnabled) } },
    { op: 'timing_spo2', params: { intervalMin: iv(s.spo2Enabled) } },
    { op: 'timing_temp', params: { enable: s.temperatureEnabled } },
  ];
}

/** `sendConnectionQueries` state read-backs, in Lumen's order. */
const STATE_QUERIES = ['hr', 'hrv', 'spo2', 'stress', 'temp'] as const;

const has = (services: readonly Uuid[], u: Uuid): boolean => services.some((s) => normalizeUuid(s) === u);

/** `CRPCoordinator.matches`. SMART_RING alone is not claimed here (Jring takes it; see `crpAfterDiscovery`). */
export function matchCrp(ad: Advertisement): boolean {
  if (ad.name !== undefined && R100_NAME.test(ad.name)) return true;
  return has(ad.serviceUuids, CRP_SERVICE);
}

/**
 * The CRP rescue of `RingBLEClient.onServicesDiscovered`: the `fdda` service with no Colmi UART service is CRP. Lumen
 * applies it when the Jring or Colmi family is installed, before any subscription or write. A ring showing `fdda` and the
 * Jring `56ff` service also ends up CRP (no such ring is known; kept as the Kotlin).
 */
export function crpAfterDiscovery(services: readonly Uuid[]): boolean {
  return has(services, CRP_SERVICE) && !COLMI_SERVICES.some((c) => has(services, c));
}

const ascii = (b: Uint8Array | undefined): string | undefined => {
  if (!b || b.length === 0) return undefined;
  return new TextDecoder().decode(b).replace(/\0+$/, '').trim() || undefined;
};

export interface CrpOptions {
  /** The person's saved all-day monitor settings; default every monitor on at 5 min (Lumen's fallback). */
  monitors?: CrpMonitorSettings;
}

export async function crpHandshake(rt: SessionRuntime, opts: HandshakeOptions = {}, monitors: CrpMonitorSettings = CRP_ALL_ON_DEFAULT): Promise<HandshakeInfo> {
  const signal = opts.signal;
  await rt.run({ op: 'set_time' }, signal);
  if (opts.profile) await rt.run({ op: 'set_user_info', params: userInfoParams(opts.profile) }, signal);
  await rt.run({ op: 'query_firmware' }, signal);
  await rt.run({ op: 'query_spo2_support' }, signal);
  for (const kind of STATE_QUERIES) await rt.run({ op: 'query_timing_state', params: { kind } }, signal);
  for (const c of crpMonitorCommands(monitors)) await rt.run(c, signal);
  // Battery and the Device Information strings are plain GATT reads (`RingBLEClient`); 2a26/2a28 only back up 3/3.
  const batteryBytes = await rt.read(BATTERY_SERVICE, BATTERY_LEVEL);
  const st = rt.state as CrpState;
  const firmware = st.firmware ?? ascii(await rt.read(DEVICE_INFO_SERVICE, FIRMWARE_REVISION)) ?? ascii(await rt.read(DEVICE_INFO_SERVICE, SOFTWARE_REVISION)) ?? '';
  const battery = batteryBytes && batteryBytes.length > 0 && batteryBytes[0]! <= 100 ? batteryBytes[0] : undefined;
  const name = rt.transport.peripheral.name;
  // The reroute's model: the advertised name's CRP model, else the R11 (CRP) (`WearableModel.resolve`).
  const model = name !== undefined && R100_NAME.test(name) ? 'R100' : 'R11';
  // The phone sets the ring clock; it is never read back. No serial query exists: identity falls back to the address.
  return { firmware, battery, model, clockOffsetS: 0 };
}

export function createCrpFamily(opts: CrpOptions = {}): RingFamily {
  const monitors = opts.monitors ?? CRP_ALL_ON_DEFAULT;
  return {
    id: 'crp',
    label: 'CRP smart ring (R11, R100)',
    models: ['R11', 'R100'],
    scan: {
      requestFilters: [{ services: [CRP_SERVICE] }, { namePrefix: 'R100' }],
      optionalServices: [CRP_SERVICE, BATTERY_SERVICE, DEVICE_INFO_SERVICE],
      match: matchCrp,
    },
    gatt: {
      service: CRP_SERVICE,
      write: CRP_WRITE,
      // fdd3 first: every reply rides it and the handshake must not start before it is live (`requiredSubscriptions`).
      // 2a37 is left out: Lumen subscribes to it but all heart rate comes back on fdd3.
      notify: [
        { characteristic: CRP_CMD_NOTIFY, mode: 'notify' },
        { characteristic: CRP_STEPS_NOTIFY, mode: 'notify' },
        { characteristic: CRP_RECORDING_NOTIFY, mode: 'notify' },
      ],
      battery: { service: BATTERY_SERVICE, characteristic: BATTERY_LEVEL },
      deviceInfo: { service: DEVICE_INFO_SERVICE, firmware: FIRMWARE_REVISION },
    },
    protocol: createCrpProtocol(),
    streams: CRP_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    // `ConnectionPriorityPolicy`: CRP falls in the general branch.
    priority: DEFAULT_PRIORITY,
    handshake: (rt, hopts) => crpHandshake(rt, hopts, monitors),
    // `startHeartRate` / `stopHeartRate`: the same 1/9 command serves spot and live (UNVERIFIED cadence after one start).
    liveHeartRate: { start: { op: 'measure_hr', params: { enable: true } }, stop: { op: 'measure_hr', params: { enable: false } } },
    spot: { hr: { op: 'measure_hr', params: { enable: true } }, spo2: { op: 'measure_spo2', params: { enable: true } } },
    spotStop: { hr: { op: 'measure_hr', params: { enable: false } }, spo2: { op: 'measure_spo2', params: { enable: false } } },
    decoderTag: (firmware) => `crp/${firmware || 'unknown'}@1`,
    modelFromAdvertisement: (ad) => (ad.name !== undefined && R100_NAME.test(ad.name) ? 'R100' : undefined),
  };
}

export const crp: RingFamily = createCrpFamily();

/** `resyncTime`: the clock push a service may send again (Lumen re-sends it on every poll pass). */
export const crpResyncTime: RingCommand = { op: 'set_time' };
