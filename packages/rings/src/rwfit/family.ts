/**
 * The RWfit `RingFamily`. Tier P apart from the handshake, which only talks through the session runtime. Port of Lumen's
 * `RWfitCoordinator.kt` (scan match), `RWfitDriver.kt` (`servicesDiscovered`) and `RWfitSyncEngine.runStartup`.
 *
 * Scan match: the A00A service (16- or 128-bit, any case) or a manufacturer block opening `d6 05 02 00`, `d6 05 41 54` or
 * `d6 06 02 00` (on-air layout). Never the name: the rings are rebadged, the name carries no family signal.
 * Handshake: services → framing (`selectFraming`), then device info, time sync and battery, as `runStartup` writes them.
 * No authentication, bond or profile; nothing is ever asked of the person. Device info is not decoded, so the framing
 * stands in for the firmware (`'legacy'` | `'jl'`) and there is no serial (identity falls back to the address).
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import {
  ANDROID_RECONNECT, DEFAULT_PRIORITY, normalizeUuid,
  type Advertisement, type HandshakeInfo, type HandshakeOptions, type RingFamily, type SessionRuntime,
} from '../types';
import { FRAMING_MARKERS, MANUFACTURER_PREFIXES, RWFIT_NOTIFY, RWFIT_SERVICE, RWFIT_WRITE, chooseFraming } from './codec';
import { createRWfitProtocol, type RWfitState } from './protocol';

export const RWFIT_STREAMS: readonly BioStream[] = ['steps', 'sleep_stage', 'hr', 'spo2', 'skin_temp', 'hrv'];

/** `RWfitCoordinator.advertisesService`: 'a00a', '0000a00a' or the full UUID, any case. */
const isA00A = (u: string): boolean => {
  const s = u.trim().toLowerCase();
  return s === '0000a00a' || normalizeUuid(s) === RWFIT_SERVICE;
};

/** `RWfitCoordinator.matches`. */
export function matchRWfit(ad: Advertisement): boolean {
  if (ad.serviceUuids.some(isA00A)) return true;
  return ad.manufacturerData.some((m) => MANUFACTURER_PREFIXES.some((p) => p.every((b, i) => m[i] === b)));
}

export async function rwfitHandshake(rt: SessionRuntime, opts: HandshakeOptions = {}): Promise<HandshakeInfo> {
  // `servicesDiscovered`: any marker service means JL framing; none (or a transport that cannot list services) is legacy,
  // the Kotlin default. Web Bluetooth lists only the services named in `scan.optionalServices`, which carries all three.
  const services = (await rt.transport.services?.().catch(() => [])) ?? [];
  const framing = chooseFraming(services);
  await rt.run({ op: 'selectFraming', params: { framing } }, opts.signal);
  // `runStartup`: device info and time are written without waiting; battery waits for its reply so the info has it.
  await rt.run({ op: 'deviceInfo' }, opts.signal);
  await rt.run({ op: 'timeSync' }, opts.signal);
  await rt.run({ op: 'battery' }, opts.signal);
  const st = rt.state as RWfitState;
  return { firmware: st.framing, battery: st.battery ?? undefined, clockOffsetS: 0 };
}

export function createRWfitFamily(): RingFamily {
  return {
    id: 'rwfit',
    label: 'RWfit ring',
    maker: 'RWfit',
    models: ['RWfit legacy (0x7E)', 'RWfit JL (0xAB)'],
    scan: {
      requestFilters: [
        { services: [RWFIT_SERVICE] },
        { manufacturerData: [{ companyIdentifier: 0x05d6, dataPrefix: Uint8Array.of(0x02, 0x00) }] },
        { manufacturerData: [{ companyIdentifier: 0x05d6, dataPrefix: Uint8Array.of(0x41, 0x54) }] },
        { manufacturerData: [{ companyIdentifier: 0x06d6, dataPrefix: Uint8Array.of(0x02, 0x00) }] },
      ],
      // The marker services are never opened, but Web Bluetooth only reports services listed here.
      optionalServices: [RWFIT_SERVICE, ...FRAMING_MARKERS],
      match: matchRWfit,
    },
    gatt: {
      service: RWFIT_SERVICE,
      write: RWFIT_WRITE,
      notify: [{ characteristic: RWFIT_NOTIFY, mode: 'notify' }],
    },
    protocol: createRWfitProtocol(),
    streams: RWFIT_STREAMS,
    tier: 'C',
    reconnect: ANDROID_RECONNECT,
    priority: DEFAULT_PRIORITY,
    handshake: rwfitHandshake,
    // No liveHeartRate / spot: legacy has no on-demand command and the JL `06 09` reply layout is not ported.
    decoderTag: (firmware) => `rwfit/${firmware || 'unknown'}@1`,
    // The name carries no model (rebadged rings).
    modelFromAdvertisement: () => undefined,
  };
}

export const rwfit: RingFamily = createRWfitFamily();
