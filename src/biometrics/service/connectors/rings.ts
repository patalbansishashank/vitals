/**
 * The real connector: A5a sessions (`openRingSession`) over the platform's `TransportFactory` (`src/biometrics/ble/
 * transports/rings.ts`: the chooser factories for the browser and the desktop app, the scan factory for Android).
 * Tier H. Every family in `RING_FAMILIES` is reachable here; a driver without a family yet goes through
 * `./legacy.ts`.
 */
import type { BleLink } from '@/biometrics/core/ble/types';
import { gattStatusOf } from '@/biometrics/ble/transports/capacitor';
import { linkTransport, type ChooserAdvertisement } from '@/biometrics/ble/transports/rings';
import { NoDeviceError, type RingLink } from '@/biometrics/ble/transports/types';
import { RING_FAMILIES, matchFamily, rerouteAfterDiscovery } from '../../../../packages/rings/src/index';
import { openRingSession, type SessionOptions } from '../../../../packages/rings/src/session';
import { RingError, type Advertisement, type RingFamily, type RingSession, type SpotKind, type Transport, type TransportFactory } from '../../../../packages/rings/src/types';
import { familyIdentity, macOf } from '../identity';
import { RingLinkError, type RingAvailability, type RingConnector, type RingLinkSession, type RingScanHit } from '../ports';
import type { CheckMetric } from '../types';

export interface RingsConnectorOptions {
  factory: TransportFactory;
  families?: readonly RingFamily[];
  /** `openRingSession` unless a test swaps it. */
  open?: typeof openRingSession;
  session?: SessionOptions;
  /** What "not available" means on this platform (default: the browser has no Web Bluetooth); asked each time. */
  unavailable?: RingAvailability | (() => RingAvailability);
}

const STREAM_OF: Record<SpotKind, string> = { hr: 'hr', spo2: 'spo2', hrv: 'hrv', temperature: 'skin_temp', stress: 'vendor:stress' };
const CHECK_OF: Partial<Record<SpotKind, CheckMetric>> = { hr: 'hr', spo2: 'spo2', hrv: 'hrv', temperature: 'skin_temp' };

/** `checkNow` metrics a family offers, from its `spot` keys. */
export const checksOf = (family: Pick<RingFamily, 'spot'>): CheckMetric[] => (Object.keys(family.spot ?? {}) as SpotKind[]).map((k) => CHECK_OF[k]).filter((c): c is CheckMetric => c !== undefined);

/** The GATT status on an error or on one of its causes (a ring error may wrap the transport's error). */
function statusIn(e: unknown): number | undefined {
  for (let x = e, depth = 0; x && depth < 5; x = (x as { cause?: unknown }).cause, depth++) {
    const status = gattStatusOf(x);
    if (status !== undefined) return status;
  }
  return undefined;
}

/** A5a and transport errors in the service's terms, with the GATT status kept (C-RINGX-15). */
export function toLinkError(e: unknown): RingLinkError {
  if (e instanceof RingLinkError) return e;
  const le = mapError(e);
  const status = statusIn(e);
  if (status !== undefined) le.gattStatus = status;
  return le;
}

function mapError(e: unknown): RingLinkError {
  if (e instanceof NoDeviceError) return new RingLinkError(e.reason === 'cancelled' ? 'cancelled' : e.reason === 'unavailable' ? 'bluetooth_off' : e.reason === 'permission' ? 'permission_needed' : 'not_found', e.message, e);
  if (e instanceof RingError) {
    switch (e.code) {
      case 'auth_rejected':
      case 'credential_invalid':
        return new RingLinkError('refused', e.message, e);
      case 'unsupported_firmware':
      case 'bond_required':
      case 'disconnected':
        return new RingLinkError(e.code, e.message, e);
      case 'aborted':
        return new RingLinkError('cancelled', e.message, e);
      case 'unsupported':
        return new RingLinkError('unsupported', e.message, e);
      default:
        return new RingLinkError('not_found', e.message, e);
    }
  }
  return new RingLinkError('not_found', e instanceof Error ? e.message : String(e), e);
}

/** An A5a session as the service sees it. */
export function wrapSession(session: RingSession, transport: Transport): RingLinkSession {
  const fam = familyIdentity(session.family.id);
  const id = session.identity;
  // The advertised id is never an identity (a browser's per-origin id, or a name): only a serial or an address is.
  const ringId = id.basis !== 'advertised' ? id.ringId : macOf(id.ringId.slice(4)) ? `mac:${macOf(id.ringId.slice(4))}` : undefined;
  // the address where the platform has one (Android, BlueZ: stable); the browser's id otherwise
  const platformId = transport.peripheral.address ?? transport.peripheral.id;
  const out: RingLinkSession = {
    identity: { driverId: session.family.id, family: session.family.id, maker: fam.maker, model: id.model ?? fam.model, ...(ringId ? { ringId } : {}) },
    ...(platformId ? { platformId } : {}),
    async info() {
      const i = session.info();
      return { firmware: i.firmware, battery: i.battery, clockOffsetS: i.clockOffsetS };
    },
    battery: () => session.battery(),
    async *sync(cursor, onProgress, signal) {
      try {
        yield* session.sync(cursor, (p) => onProgress(p.fraction), signal);
      } catch (e) {
        // ring and transport errors in the service's terms, as for a connect; anything else stays as it is. The link
        // is open here, so a failed read is not "another app holds the ring"
        if (!(e instanceof RingError || e instanceof NoDeviceError)) throw e;
        const le = toLinkError(e);
        if (le.code !== 'not_found') throw le;
        const failed = new RingLinkError('failed', le.message, e);
        if (le.gattStatus !== undefined) failed.gattStatus = le.gattStatus;
        throw failed;
      }
    },
    onDisconnected(cb) {
      return session.on((ev) => {
        if (ev.type === 'disconnected') cb();
      });
    },
    close: () => session.close(),
  };
  if (session.family.liveHeartRate)
    out.liveHeartRate = async function* (signal) {
      for await (const ev of session.liveHeartRate(signal)) if (ev.type === 'sample' && ev.stream === 'hr') yield { bpm: ev.value, t: ev.t };
    };
  if (session.family.spot)
    out.spot = async (kind, signal) => {
      if (!session.family.spot?.[kind]) throw new RingLinkError('unsupported', 'This ring cannot take that reading on demand.');
      const ac = new AbortController();
      signal.addEventListener('abort', () => ac.abort(), { once: true });
      let got: { value: number; unit: string; t: number } | undefined;
      let offFinger = false;
      try {
        for await (const ev of session.spot(kind, ac.signal)) {
          if (ev.type === 'sample' && ev.stream === STREAM_OF[kind]) {
            got = { value: ev.value, unit: ev.unit, t: ev.t };
            ac.abort();
            break;
          }
          if (ev.type === 'status' && ev.key === 'error' && /finger|wear|worn/i.test(String(ev.value))) offFinger = true;
        }
      } catch (e) {
        if (!got) throw toLinkError(e);
      }
      if (!got) throw new RingLinkError(offFinger ? 'off_finger' : 'no_reading', offFinger ? 'Put the ring on your finger, then try again.' : 'The ring gave no reading. Keep it on your finger and try again.');
      return got;
    };
  return out;
}

export function createRingsConnector(o: RingsConnectorOptions): RingConnector {
  const families = o.families ?? RING_FAMILIES;
  const open = o.open ?? openRingSession;
  const unavailable = (): RingAvailability => (typeof o.unavailable === 'function' ? o.unavailable() : (o.unavailable ?? 'unsupported'));
  const byId = (id: string): RingFamily | undefined => families.find((f) => f.id === id);
  const seen = new Map<string, { ad: Advertisement; family?: RingFamily }>();
  let n = 0;

  async function openOn(family: RingFamily, transport: Transport, signal: AbortSignal): Promise<RingLinkSession> {
    try {
      return wrapSession(await open(family, transport, { ...o.session, signal }), transport);
    } catch (e) {
      throw toLinkError(e);
    }
  }

  async function discoveredFamily(scanned: RingFamily | undefined, transport: Transport): Promise<RingFamily | undefined> {
    const services = await transport.services?.();
    if (!services?.length) return scanned;
    const fromServices = matchFamily({ serviceUuids: services, manufacturerData: [] }, families);
    if (!scanned) return fromServices;
    const rerouted = rerouteAfterDiscovery(scanned, services, families);
    return rerouted === scanned ? fromServices ?? scanned : rerouted;
  }

  async function openDiscovered(scanned: RingFamily | undefined, transport: Transport, signal: AbortSignal): Promise<RingLinkSession> {
    let family: RingFamily | undefined;
    try {
      family = await discoveredFamily(scanned, transport);
    } catch (e) {
      await transport.disconnect().catch(() => {});
      throw toLinkError(e);
    }
    if (!family) {
      await transport.disconnect().catch(() => {});
      throw new RingLinkError('unsupported', 'This ring is not supported.');
    }
    return openOn(family, transport, signal);
  }

  return {
    async available() {
      try {
        return (await o.factory.available()) ? 'ready' : unavailable();
      } catch {
        return unavailable();
      }
    },
    async *scan(signal) {
      seen.clear();
      const queue: RingScanHit[] = [];
      let wake: (() => void) | null = null;
      let finished = false;
      let failure: unknown;
      const poke = (): void => {
        const w = wake;
        wake = null;
        w?.();
      };
      const onFound = (ad: Advertisement): void => {
        const family = matchFamily(ad, families);
        if (!family && !(ad as ChooserAdvertisement).needsDiscovery) return;
        const candidateId = ad.platformId ?? `ring:${++n}`;
        if (seen.has(candidateId)) return;
        seen.set(candidateId, { ad, family });
        queue.push({ candidateId, driverId: family?.id ?? 'unidentified', ...(ad.rssi !== undefined ? { rssi: ad.rssi } : {}), ...(ad.platformId ? { platformId: ad.platformId } : {}) });
        poke();
      };
      o.factory.scan(families, onFound, signal).then(
        () => ((finished = true), poke()),
        (e) => ((failure = e), (finished = true), poke()),
      );
      for (;;) {
        const hit = queue.shift();
        if (hit) {
          yield hit;
          continue;
        }
        if (finished) {
          if (failure) throw toLinkError(failure);
          return;
        }
        await new Promise<void>((r) => (wake = r));
      }
    },
    async connect(hit, signal) {
      const s = seen.get(hit.candidateId);
      const scanned = s?.family ?? byId(hit.driverId);
      let transport: Transport;
      try {
        transport = await o.factory.connect({ platformId: s?.ad.platformId ?? hit.candidateId }, scanned, signal);
      } catch (e) {
        throw toLinkError(e);
      }
      return openDiscovered(scanned, transport, signal);
    },
    async reconnect(platformId, driverId, signal) {
      const family = byId(driverId);
      if (!family) throw new RingLinkError('failed', 'No driver for this ring.');
      let transport: Transport;
      try {
        transport = await o.factory.connect({ platformId }, family, signal);
      } catch (e) {
        throw toLinkError(e);
      }
      return openDiscovered(family, transport, signal);
    },
    async adopt(link: BleLink, driverId, signal) {
      const family = byId(driverId);
      if (!family) throw new RingLinkError('failed', 'No driver for this ring.');
      const rl = link as RingLink;
      const transport = linkTransport(typeof rl.onDisconnect === 'function' ? rl : { ...link, onDisconnect: () => () => undefined }, { address: macOf(rl.deviceId) });
      return openOn(family, transport, signal);
    },
    driverInfo(driverId) {
      const f = byId(driverId);
      if (!f) return undefined;
      const fam = familyIdentity(driverId);
      return { label: fam.label, maker: fam.maker, model: fam.model, streams: f.streams, checks: checksOf(f) };
    },
  };
}
