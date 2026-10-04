/**
 * Connector over the older web drivers (`src/biometrics/ble/drivers.ts` + `session.ts`) for a family that has no A5a
 * driver yet (Colmi today). Reached only through the staged-link path (`bio.deviceConnect` / `bio.deviceSync`) and
 * `reconnect` where the transport has it; it never scans. Retire it when every family lives in `packages/rings`.
 */
import type { BleDriver, BleLink, BleSession, RingDecodedEvent } from '@/biometrics/core/ble/types';
import type { BleTransport, RingLink } from '@/biometrics/ble/transports/types';
import type { SessionClock } from '@/biometrics/ble/session';
import type { RingEvent, SleepStage } from '../../../../packages/rings/src/types';
import { familyIdentity, macOf } from '../identity';
import { RingLinkError, type RingConnector, type RingLinkSession } from '../ports';
import { toLinkError } from './rings';

export interface LegacyConnectorOptions {
  transport?: BleTransport;
  /** The driver registry, loaded lazily (it carries every protocol). */
  drivers: () => Promise<{ getDriver(id: string): BleDriver | undefined }>;
  session?: { clock?: SessionClock; timers?: { quietMs?: number; stallMs?: number } };
}

/** The old event shape is a subset of A5a's. */
export const widen = (e: RingDecodedEvent): RingEvent => (e.type === 'sleepEpochs' ? { ...e, stages: e.stages as SleepStage[] } : (e as RingEvent));

export function wrapLegacySession(session: BleSession, driver: BleDriver, link: BleLink): RingLinkSession {
  const fam = familyIdentity(driver.id, driver);
  const rl = link as Partial<RingLink>;
  const mac = macOf(rl.deviceId);
  return {
    identity: { driverId: driver.id, family: fam.family, maker: fam.maker, model: fam.model, ...(mac ? { ringId: `mac:${mac}` } : {}) },
    ...(rl.deviceId ? { platformId: rl.deviceId } : {}),
    info: () => session.info(),
    battery: () => session.battery(),
    async *sync(cursor, onProgress, signal) {
      for await (const e of session.sync(cursor, onProgress, signal)) yield widen(e);
    },
    onDisconnected: (cb) => (typeof rl.onDisconnect === 'function' ? rl.onDisconnect(cb) : () => undefined),
    close: () => session.close(),
  };
}

export function createLegacyConnector(o: LegacyConnectorOptions): RingConnector {
  let loaded: { getDriver(id: string): BleDriver | undefined } | undefined;
  const registry = async () => (loaded ??= await o.drivers());

  async function openOn(link: BleLink, driverId: string, signal: AbortSignal): Promise<RingLinkSession> {
    const driver = (await registry()).getDriver(driverId);
    if (!driver) throw new RingLinkError('failed', 'No driver for this ring.');
    try {
      const open = driver.open as (l: BleLink, opts: { signal?: AbortSignal; clock?: SessionClock; timers?: { quietMs?: number; stallMs?: number } }) => Promise<BleSession>;
      return wrapLegacySession(await open(link, { signal, ...o.session }), driver, link);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth_rejected' || code === 'credential_invalid') throw new RingLinkError('refused', undefined, e);
      if (code === 'disconnected' || code === 'aborted') throw new RingLinkError(code === 'aborted' ? 'cancelled' : 'disconnected', undefined, e);
      throw toLinkError(e);
    }
  }

  return {
    async available() {
      if (!o.transport) return 'unsupported';
      return (await o.transport.isAvailable().catch(() => false)) ? 'ready' : 'bluetooth_off';
    },
    async *scan() {
      /* old drivers are reached through the staged link only */
    },
    connect: () => Promise.reject(new RingLinkError('unsupported', 'Choose this ring from the Devices page.')),
    ...(o.transport?.reconnect
      ? {
          async reconnect(platformId, driverId, signal) {
            const driver = (await registry()).getDriver(driverId);
            if (!driver) throw new RingLinkError('failed', 'No driver for this ring.');
            let link: RingLink;
            try {
              link = await o.transport!.reconnect!(platformId, driver, { signal });
            } catch (e) {
              throw toLinkError(e);
            }
            return openOn(link, driverId, signal);
          },
        }
      : {}),
    adopt: (link, driverId, signal) => openOn(link, driverId, signal),
    driverInfo(driverId) {
      const d = loaded?.getDriver(driverId);
      const fam = familyIdentity(driverId, d);
      return { label: fam.label, maker: fam.maker, model: fam.model, streams: d?.streams ?? [] };
    },
  };
}
