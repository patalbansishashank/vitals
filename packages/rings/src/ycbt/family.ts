/**
 * The YCBT `RingFamily`: the R10M, TK5 and SmartHealth-app rings, which speak one protocol (Lumen builds the same
 * `YCBTDriver` for all three device types). Tier P apart from the handshake, which only talks through the session runtime.
 * Port of Lumen's `YCBTCoordinator.kt` / `YCBTCoordinators.kt` (recognition, variant profiles), `YCBTDriver.kt`
 * (GATT map, `immediatePostSubscriptionCommands`) and `YCBTSyncEngine.runStartup` (the configuration batch).
 *
 * Variants differ only around the protocol: the capability baseline, whether `02 1b` is sent and whether the blood
 * pressure monitor `01 1c` is used. The variant comes from the advertised name; when Web Bluetooth hides it (no name,
 * no manufacturer data) the R10M rules apply, the safe ones: they never send `02 1b`, which drops an R10M's link.
 *
 * Handshake: both indications are already on (the session subscribes every `gatt.notify` channel and fails the open if
 * either is refused: Lumen's subscription gate). Then `02 03` and set time, then the startup batch: `02 00` and `02 01`
 * (each waited for: firmware, battery and the capability bitmap), `02 1b` (TK5 and SmartHealth), `02 07`, language,
 * units, the monitors for every sensor the ring has, user info when a profile is known, `03 09`.
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingFamily, type SessionRuntime,
} from '../types';
import { LUCKRING_SERVICE, MODE, QRING_SERVICES, VARIANTS, YCBT_COMMAND, YCBT_COMPANY_ID, YCBT_SERVICE, YCBT_STREAM, type YcbtVariant } from './commands';
import { createYcbtProtocol, type YcbtOptions, type YcbtState } from './protocol';

export const YCBT_STREAMS: readonly BioStream[] = ['hr', 'spo2', 'hrv', 'skin_temp', 'resp_rate', 'steps', 'distance', 'active_kcal', 'sleep_stage'];

/** `YCBTCoordinator.isSmartHealthName` (trimmed, upper case). */
export const R10M_NAME = /^R10M(?:[ _-][0-9A-Z]+)?$/;
/** `WearableModel.SMARTHEALTH_NAME_PATTERN`: model, one space, four hex digits (`R99 54DC`). */
export const SMARTHEALTH_NAME = /^[A-Za-z0-9-]+( [A-Za-z0-9-]+)* [0-9A-Fa-f]{4}$/;
const TK5_MANUFACTURER = [0x10, 0x78, 0x65, 0x01];
const YCBT_MANUFACTURER = [YCBT_COMPANY_ID & 0xff, YCBT_COMPANY_ID >> 8];

const startsWith = (b: Uint8Array, p: readonly number[]): boolean => b.length >= p.length && p.every((v, i) => b[i] === v);
const hasService = (ad: Advertisement, u: string): boolean => ad.serviceUuids.some((s) => normalizeUuid(s) === u);

/**
 * Which YCBT ring an advertisement is, or undefined. Lumen's registry order: a QRing service is never YCBT; the R10M
 * by name or the `be940000` service; the TK5 by a `TK5` name or the `10 78 65 01` block (a LuckRing, checked first in
 * Lumen, is never taken); SmartHealth by its name pattern or any `10 78` block. Every
 * manufacturer block is tried.
 */
export function ycbtVariantOf(ad: Advertisement): YcbtVariant | undefined {
  if (QRING_SERVICES.some((u) => hasService(ad, u))) return undefined;
  // Lumen checks the LuckRing family first (F618 service, company 0xFF64): such a ring is never claimed here.
  if (hasService(ad, LUCKRING_SERVICE) || ad.manufacturerData.some((b) => startsWith(b, [0x64, 0xff]))) return undefined;
  const name = ad.name?.trim();
  const upper = name?.toUpperCase();
  if ((upper && R10M_NAME.test(upper)) || hasService(ad, YCBT_SERVICE)) return 'r10m';
  if (upper?.startsWith('TK5') || ad.manufacturerData.some((b) => startsWith(b, TK5_MANUFACTURER))) return 'tk5';
  // The R10M name card claims names like `R10M 1A2B` before the SmartHealth pattern can (handled above).
  if (name && SMARTHEALTH_NAME.test(name)) return 'smarthealth';
  if (ad.manufacturerData.some((b) => startsWith(b, YCBT_MANUFACTURER))) return 'smarthealth';
  return undefined;
}

export const matchYcbt = (ad: Advertisement): boolean => ycbtVariantOf(ad) !== undefined;

/** The variant from the name alone (what the handshake can see through the transport); R10M rules when unknown. */
export function variantFromName(name: string | undefined): YcbtVariant {
  return ycbtVariantOf({ name, serviceUuids: [], manufacturerData: [] }) ?? 'r10m';
}

export async function ycbtHandshake(rt: SessionRuntime, opts: HandshakeOptions = {}): Promise<HandshakeInfo> {
  const variant = variantFromName(rt.transport.peripheral.name);
  const v = VARIANTS[variant];
  const run = (op: string, params?: Record<string, number | string | boolean>): Promise<unknown> => rt.run({ op, params }, opts.signal);
  // `immediatePostSubscriptionCommands`: device name, then the clock (the variant resets the protocol's connection state).
  await run('getDeviceName', { variant });
  await run('setTime');
  // Waited for, unlike Lumen's queue: the capabilities decide the monitors below and the sync plan.
  await run('deviceInfo');
  await run('supportFunction');
  if (v.queryChipScheme) await run('chipScheme');
  await run('userConfig');
  await run('language', { code: 0 });
  await run('units', { metric: opts.profile?.metric ?? true, is24Hour: true });
  await run('monitors');
  // Lumen always sends a profile (175 cm, 70 kg, 25 y when unknown); here only a real one is sent.
  const p = opts.profile;
  if (p) await run('setUserInfo', { heightCm: Math.round(p.heightCm), weightKg: Math.round(p.weightKg), sex: p.sex, ageYears: Math.round(p.ageYears) });
  await run('enableLiveStatus');
  const st = rt.state as YcbtState;
  return { firmware: st.firmware ?? '', battery: st.battery ?? undefined, model: v.model, clockOffsetS: 0 };
}

export function createYcbtFamily(opts: YcbtOptions = {}): RingFamily {
  return {
    id: 'ycbt',
    label: 'YCBT ring (R10M, TK5, SmartHealth)',
    models: ['R10M', 'TK5', 'SmartHealth ring'],
    scan: {
      requestFilters: [{ services: [YCBT_SERVICE] }, { namePrefix: 'R10M' }, { namePrefix: 'TK5' }, { manufacturerData: [{ companyIdentifier: YCBT_COMPANY_ID }] }],
      optionalServices: [YCBT_SERVICE],
      match: matchYcbt,
    },
    gatt: {
      service: YCBT_SERVICE,
      write: YCBT_COMMAND,
      // Lumen's `notifyUUIDs` order; both are required indications (writing the notify CCCD value means silence).
      notify: [{ characteristic: YCBT_COMMAND, mode: 'indicate' }, { characteristic: YCBT_STREAM, mode: 'indicate' }],
    },
    protocol: createYcbtProtocol(opts),
    streams: YCBT_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    // The R10M gets no priority request and no MTU request at all (cheap BE94 controllers dropped the link after them);
    // the variant is not known to the family, so the whole family takes the R10M's "default".
    priority: { ...DEFAULT_PRIORITY, active: 'default', idle: 'default', idleLong: 'default' },
    handshake: ycbtHandshake,
    // No separate stream command: live HR is the HR measurement left running (a `04 0e` does not end it).
    liveHeartRate: {
      start: { op: 'liveMeasurement', params: { enable: true, mode: MODE.HEART_RATE, live: true } },
      stop: { op: 'liveMeasurement', params: { enable: false, mode: MODE.HEART_RATE } },
    },
    spot: {
      hr: { op: 'liveMeasurement', params: { enable: true, mode: MODE.HEART_RATE } },
      spo2: { op: 'liveMeasurement', params: { enable: true, mode: MODE.SPO2 } },
      hrv: { op: 'liveMeasurement', params: { enable: true, mode: MODE.HRV } },
    },
    spotStop: {
      hr: { op: 'liveMeasurement', params: { enable: false, mode: MODE.HEART_RATE } },
      spo2: { op: 'liveMeasurement', params: { enable: false, mode: MODE.SPO2 } },
      hrv: { op: 'liveMeasurement', params: { enable: false, mode: MODE.HRV } },
    },
    decoderTag: (firmware) => `ycbt/${firmware || 'unknown'}@1`,
    modelFromAdvertisement: (ad) => {
      const variant = ycbtVariantOf(ad);
      return variant ? VARIANTS[variant].model : undefined;
    },
  };
}

export const ycbt: RingFamily = createYcbtFamily();

/** Spot ceilings when `04 0e` never comes (`YCBTSyncEngine`): HR 45 s, SpO2 75 s; BP and HRV 40 s. */
export const YCBT_SPOT_CEILING_MS = { hr: 45_000, spo2: 75_000, hrv: 40_000 } as const;
