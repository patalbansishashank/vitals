/**
 * The Jring `RingFamily` (the "56ff" rings that advertise the generic name SMART_RING). Tier P apart from the handshake,
 * which only talks through the session runtime. Port of Lumen's `JringCoordinator`, `JringDriver`, the connect order of
 * `RingBLEClient` / `RingSyncCoordinator` and `JringSyncEngine.runStartup` (`ring/JringDriver.kt`).
 *
 * Scan match (`JringCoordinator.matches`): the exact name SMART_RING unless the advertisement also lists a Colmi UART
 * service, or the 56ff service, or a manufacturer block whose hex contains `41422ec75b6a`. SMART_RING alone does not prove
 * the family: after connecting the registry may reroute to Colmi or CRP from the discovered services (`DriverReroute`),
 * so `optionalServices` lists theirs too (Web Bluetooth hides services it was not told about).
 *
 * Handshake: battery 2a19 and firmware 2a26 reads, 0x48 app id, then `runStartup` without its history tail: 0x0C status
 * (waited for, bounded; Kotlin fires and forgets), 0x01 time sync, 0x21 locale, 0x02 default profile, 0x19 auto heart rate,
 * 0x20 capabilities; then 0x02 with the person's profile when there is one. The history tail (0x10, 0x16) is `planSync`.
 * The 15 s keepalive is the session's timer: `keepalive` below, `jringKeepalive` every `JRING_KEEPALIVE_MS` (no timers in the protocol).
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type PriorityPolicy, type RingFamily, type SessionRuntime,
} from '../types';
import {
  AUTO_HR_CADENCE_MIN, BATTERY_LEVEL, BATTERY_SERVICE, COLMI_SERVICE_V1, COLMI_SERVICE_V2, CRP_SERVICE, DEVICE_INFO, FIRMWARE_REVISION,
  JRING_KEEPALIVE_MS, JRING_MANUFACTURER_NEEDLE, JRING_NAME, JRING_NOTIFY, JRING_SERVICE, JRING_WRITE, jringKeepalive,
} from './commands';
import { createJringProtocol, type JringState } from './protocol';

/**
 * App id written in 0x48 on every connect. The ring binds to the id of the app talking to it and may stay mute when
 * another app claimed it. Lumen generates `PL` + 14 hex characters once per install (`ApiKeyStore.ringAppId`); Vitals uses
 * one fixed id so every Vitals platform (phone, PC, server) is the same "app" to the ring.
 */
export const JRING_DEFAULT_APP_ID = 'VT00000000000001';

export const JRING_STREAMS: readonly BioStream[] = ['steps', 'hr', 'sleep_stage', 'spo2'];

/** `ConnectionPriorityPolicy`: Jring never drops below balanced (the 15 s keepalive must get through). */
export const JRING_PRIORITY: PriorityPolicy = { active: 'high', idle: 'balanced', idleLowPowerMs: 300_000, idleLong: 'balanced' };

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** `JringCoordinator.matches`. */
export function matchJring(ad: Advertisement): boolean {
  const services = ad.serviceUuids.map((u) => normalizeUuid(u));
  const colmi = services.includes(COLMI_SERVICE_V1) || services.includes(COLMI_SERVICE_V2);
  if (ad.name === JRING_NAME && !colmi) return true;
  if (services.includes(JRING_SERVICE)) return true;
  return ad.manufacturerData.some((m) => hex(m).includes(JRING_MANUFACTURER_NEEDLE));
}

const ascii = (b: Uint8Array | undefined): string | undefined => {
  if (!b || b.length === 0) return undefined;
  return new TextDecoder().decode(b).replace(/\0+$/, '').trim() || undefined;
};

export interface JringOptions {
  /** 0x48 app id; default `JRING_DEFAULT_APP_ID`; null = never sent (Lumen without a stored id). Cut at 18 ASCII bytes. */
  appId?: string | null;
}

export async function jringHandshake(rt: SessionRuntime, opts: HandshakeOptions = {}, appId: string | null = JRING_DEFAULT_APP_ID): Promise<HandshakeInfo> {
  const signal = opts.signal;
  // `RingBLEClient`: battery and firmware reads are queued right after the notify subscription.
  const batteryBytes = await rt.read(BATTERY_SERVICE, BATTERY_LEVEL);
  const fwString = ascii(await rt.read(DEVICE_INFO, FIRMWARE_REVISION));
  // `RingSyncCoordinator`: the app id goes first on every connect, then `runStartup`.
  if (appId) await rt.run({ op: 'appId', params: { appId } }, signal);
  await rt.run({ op: 'status' }, signal);
  await rt.run({ op: 'timeSync' }, signal);
  await rt.run({ op: 'locale', params: { locale: 'en-US' } }, signal);
  await rt.run({ op: 'userInfo' }, signal); // the default profile, as Kotlin sends on every connect
  await rt.run({ op: 'autoHeartRate', params: { enabled: true, cadenceMinutes: AUTO_HR_CADENCE_MIN } }, signal);
  await rt.run({ op: 'bandFunction' }, signal);
  const p = opts.profile;
  if (p) {
    // Kotlin pushes the real profile after `runStartup` when age, height and weight are known.
    await rt.run({ op: 'userInfo', params: { ageYears: p.ageYears, isMale: p.sex === 'male', heightCm: p.heightCm, weightKg: p.weightKg } }, signal);
  }
  const st = rt.state as JringState;
  const read = batteryBytes && batteryBytes.length > 0 && batteryBytes[0]! <= 100 ? batteryBytes[0] : undefined;
  return {
    firmware: st.firmware ?? fwString ?? '',
    battery: read ?? st.battery ?? undefined,
    serial: st.address ?? undefined,
    model: JRING_NAME,
    // The phone sets the ring clock (0x01); it is never read back, so no offset is measured.
    clockOffsetS: 0,
  };
}

export function createJringFamily(opts: JringOptions = {}): RingFamily {
  const appId = opts.appId === undefined ? JRING_DEFAULT_APP_ID : opts.appId;
  return {
    id: 'jring',
    label: 'Jring smart ring (SMART_RING)',
    models: [JRING_NAME],
    scan: {
      requestFilters: [{ name: JRING_NAME }, { services: [JRING_SERVICE] }],
      optionalServices: [JRING_SERVICE, BATTERY_SERVICE, DEVICE_INFO, CRP_SERVICE, COLMI_SERVICE_V1, COLMI_SERVICE_V2],
      match: matchJring,
    },
    gatt: {
      service: JRING_SERVICE,
      write: JRING_WRITE,
      notify: [{ characteristic: JRING_NOTIFY, mode: 'notify' }],
      battery: { service: BATTERY_SERVICE, characteristic: BATTERY_LEVEL },
      deviceInfo: { service: DEVICE_INFO, firmware: FIRMWARE_REVISION },
    },
    protocol: createJringProtocol(),
    streams: JRING_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    priority: JRING_PRIORITY,
    handshake: (rt, hopts) => jringHandshake(rt, hopts, appId),
    // `startHeartRate` / `stopHeartRate`: 0x15 also stops the background logging, so the stop re-arms 0x19.
    liveHeartRate: { start: { op: 'heartRateStart' }, stop: { op: 'liveStop' } },
    // `measureHeartRateSpot` rides the live stream. SpO2 and the combined run are the same 0x23 mode 2 frame; one 0x24
    // reply carries SpO2 and stress (and blood pressure, fatigue, a glucose estimate), so 'stress' is the combined run.
    spot: { hr: { op: 'heartRateStart' }, spo2: { op: 'spo2Start' }, stress: { op: 'combinedStart' } },
    spotStop: { hr: { op: 'liveStop' }, spo2: { op: 'spo2Stop' }, stress: { op: 'combinedStop' } },
    // `RingBLEClient`: 0x3A every 15 s while connected, during a sync too; the ring never answers it.
    keepalive: { command: jringKeepalive, intervalMs: JRING_KEEPALIVE_MS },
    decoderTag: (firmware) => `jring/${firmware || 'unknown'}@1`,
    modelFromAdvertisement: (ad) => (ad.name === JRING_NAME ? JRING_NAME : undefined),
  };
}

export const jring: RingFamily = createJringFamily();
