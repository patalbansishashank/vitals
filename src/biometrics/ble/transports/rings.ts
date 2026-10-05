/**
 * The three platforms as `@vitals/rings` transports (A5a): a `Transport` over any `RingLink`, and a `TransportFactory`
 * per platform for scanning and (re)connecting. The links underneath are the same ones the app's current Bluetooth path
 * uses, so both paths share one adapter per platform.
 */
import type { Advertisement, RingFamily, Transport, TransportEvent, TransportFactory, Uuid } from '../../../../packages/rings/src/types';
import { normalizeUuid } from '../../../../packages/rings/src/types';
import type { CapBleClient, CapScanResult } from './capacitor';
import { NoDeviceError, type BleTransport, type DeviceQuery, type FoundDevice, type RingLink } from './types';

/**
 * A chooser entry may need connected GATT discovery before its family is known. `nameOnly`: the platform showed nothing
 * but the name (Electron's list, a browser's pick without services), not the ring's whole advertisement.
 */
export type ChooserAdvertisement = Advertisement & { needsDiscovery?: true; nameOnly?: true };

/** A Bluetooth address (Android, Linux, Windows ids); a browser's opaque `device.id` is never one. */
const addressOf = (id: string | undefined): string | undefined => (id && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(id) ? id : undefined);

/** Wraps a connected `RingLink` as an A5a `Transport`; the link's id is the peripheral's address when it is one. */
export function linkTransport(link: RingLink, extra: { address?: string; services?: () => Promise<Uuid[]> } = {}): Transport {
  const listeners = new Set<(ev: TransportEvent) => void>();
  const emit = (ev: TransportEvent): void => {
    for (const l of [...listeners]) l(ev);
  };
  let gone = false;
  const offDrop = link.onDisconnect(() => {
    if (gone) return;
    gone = true;
    emit({ type: 'disconnected' });
  });
  return {
    get peripheral() {
      const address = extra.address ?? addressOf(link.deviceId);
      return { ...(link.deviceId ? { id: link.deviceId } : {}), ...(link.deviceName ? { name: link.deviceName } : {}), ...(address ? { address } : {}) };
    },
    get mtu() {
      return link.mtu;
    },
    write: (s, c, bytes, mode) => link.write(s, c, bytes, { withResponse: mode === 'withResponse' }),
    async read(s, c) {
      if (!link.read) throw new Error('this link cannot read characteristics');
      return link.read(s, c);
    },
    async subscribe(s, c) {
      const [service, characteristic] = [normalizeUuid(s), normalizeUuid(c)];
      const off = await link.subscribe(s, c, (bytes) => emit({ type: 'notification', service, characteristic, bytes: bytes.slice() }));
      return async () => off();
    },
    ...(extra.services || link.services ? { services: extra.services ?? (() => link.services!().then((s) => s.map(normalizeUuid))) } : {}),
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async disconnect() {
      offDrop();
      await link.disconnect();
      if (!gone) {
        gone = true;
        emit({ type: 'disconnected', reason: 'closed' });
      }
    },
  };
}

/** One Web Bluetooth query covering every family asked for (filters are ORed). */
export function familiesQuery(families: readonly RingFamily[]): DeviceQuery {
  return {
    filters: families.flatMap((f) => f.scan.requestFilters),
    optionalServices: [...new Set(families.flatMap((f) => [...f.scan.optionalServices, f.gatt.service]))],
  };
}

/** Android strips the company id from manufacturer data; A5a wants on-air blocks (little-endian id first). */
export function onAirBlocks(m: Record<string, DataView> | undefined): Uint8Array[] {
  return Object.entries(m ?? {}).map(([k, v]) => {
    const id = Number(k);
    const body = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return Uint8Array.of(id & 0xff, (id >> 8) & 0xff, ...body);
  });
}

export function capacitorAdvertisement(r: CapScanResult): Advertisement {
  const name = r.localName ?? r.device.name;
  return {
    ...(name ? { name } : {}),
    serviceUuids: (r.uuids ?? []).map(normalizeUuid),
    manufacturerData: onAirBlocks(r.manufacturerData),
    platformId: r.device.deviceId,
    ...(r.rssi !== undefined ? { rssi: r.rssi } : {}),
  };
}

/** Capacitor: a real scan (every advertisement, matched by the service with `family.scan.match`), then a direct connect. */
export function capacitorFactory(client: () => Promise<CapBleClient>, transport: BleTransport): TransportFactory {
  return {
    platform: 'capacitor',
    available: () => transport.isAvailable(),
    async scan(_families, onFound, signal) {
      const ble = await client();
      await ble.requestLEScan({ allowDuplicates: false }, (r) => onFound(capacitorAdvertisement(r)));
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));
      await ble.stopLEScan().catch(() => {});
    },
    async connect(target, family, signal) {
      if (!family) throw new Error('A family is required to reconnect this ring');
      const link = await transport.reconnect!(target.platformId, familiesQuery([family]), { signal });
      const ble = await client();
      return linkTransport(link, {
        address: target.platformId,
        services: async () => (await ble.getServices(target.platformId)).map((s) => normalizeUuid(s.uuid)),
      });
    },
  };
}

/** How long the desktop app's ring list keeps looking, unless the person stops it or taps a ring first. */
export const DESKTOP_SCAN_MS = 180_000;
/**
 * How long one desktop request looks. Chromium stops looking 60 s into a request and Electron never starts it again, so
 * the desktop list opens one request after another until `DESKTOP_SCAN_MS` (a ring may be heard only a few times a minute).
 */
export const CHOOSER_WINDOW_MS = 60_000;

export interface ChooserTiming {
  windowMs: number;
  totalMs: number;
}

/** The desktop looks one request after another for 3 minutes; the Android app's own scan has no such limit: one request. */
const timingFor = (transport: BleTransport): ChooserTiming =>
  transport.kind === 'electron' ? { windowMs: CHOOSER_WINDOW_MS, totalMs: DESKTOP_SCAN_MS } : { windowMs: CHOOSER_WINDOW_MS, totalMs: CHOOSER_WINDOW_MS };

/**
 * Chooser platforms (browser, desktop app): `scan` opens one request for all the families; each ring the platform lists
 * is reported with its own advertisement hints. On the web the browser's window lists them and `scan` ends with the
 * one the person picked; `connect` then hands over that already-open link. On the desktop the bridge lists them and
 * `connect` answers the open request (or opens a new one that picks the ring); the list keeps looking, one request
 * after another, until a ring is tapped, the scan is stopped or `timing.totalMs` has passed.
 */
export function chooserFactory(
  transport: BleTransport,
  platform: 'web-bluetooth' | 'electron',
  timing: ChooserTiming = timingFor(transport),
): TransportFactory {
  const picked = new Map<string, RingLink>();
  let scannedFamilies: readonly RingFamily[] = [];
  let pending: { list: FoundDevice[]; pick: (id: string | null) => void; link: Promise<RingLink> } | undefined;
  /** The desktop scan running now: a tap ends its run of requests. */
  let looking: { stopped: boolean } | undefined;
  /**
   * The rings the latest desktop scan listed: the first connect to one that is no longer in an open request (a tap on its
   * row) waits a whole request for it; later connects (reconnects) wait as long as they always have.
   */
  let listedIds = new Set<string>();
  const wrap = (link: RingLink): Transport => linkTransport(link);

  return {
    platform,
    available: () => transport.isAvailable(),
    async scan(families, onFound, signal) {
      scannedFamilies = families;
      const query = familiesQuery(families);
      // the Android app's scan sees the whole advertisement; Electron and a browser show only the name
      const report = (d: FoundDevice): void => {
        const serviceUuids = d.serviceUuids ?? [];
        const manufacturerData = d.manufacturerData ?? [];
        const nameOnly = transport.kind !== 'capacitor' && !serviceUuids.length && !manufacturerData.length;
        onFound({ ...(d.name ? { name: d.name } : {}), serviceUuids, manufacturerData, platformId: d.id, needsDiscovery: true, ...(nameOnly ? { nameOnly: true } : {}) } as ChooserAdvertisement);
      };
      if (platform === 'web-bluetooth') {
        const link = await transport.requestDevice(query, { signal });
        // a ring picked earlier but never connected is let go
        for (const old of picked.values()) void old.disconnect().catch(() => {});
        picked.clear();
        const id = link.deviceId ?? 'web:picked';
        picked.set(id, link);
        const serviceUuids = await link.services?.().catch(() => []) ?? [];
        report({ id, ...(link.deviceName ? { name: link.deviceName } : {}), serviceUuids });
        return;
      }
      const seen = new Set<string>();
      listedIds = seen;
      const run = { stopped: false };
      looking = run;
      const until = Date.now() + timing.totalMs;
      const aborted = new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));
      for (let first = true; ; first = false) {
        const windowMs = Math.min(timing.windowMs, until - Date.now());
        // after the first request: not when stopped, or with too little time left for Chromium to start looking
        if (!first && (signal.aborted || run.stopped || windowMs < Math.min(timing.windowMs, 10_000))) break;
        let pick!: (id: string | null) => void;
        const chosen = new Promise<string | null>((r) => (pick = r));
        const p = { list: [] as FoundDevice[], pick, link: undefined as unknown as Promise<RingLink> };
        const opened = Date.now();
        p.link = transport.requestDevice(query, {
          signal,
          scanMs: windowMs,
          chooser: {
            update(list) {
              p.list = [...list];
              for (const d of list) {
                if (seen.has(d.id)) continue;
                seen.add(d.id);
                report(d);
              }
            },
            chosen,
          },
        });
        pending = p;
        p.link.catch(() => {});
        const ended = await Promise.race([aborted.then(() => 'aborted' as const), p.link.then(() => 'picked' as const, (e: unknown) => e)]);
        // ended by abort or by itself: either way nothing can be chosen from this list any more
        if (pending === p) {
          pending = undefined;
          pick(null);
        }
        // only a request that looked for its whole time is followed by another; a failure (Bluetooth off) ends the scan
        const ranOut = ended instanceof NoDeviceError && (ended.reason === 'cancelled' || ended.reason === 'not_found') && Date.now() - opened >= windowMs - 1_000;
        if (!ranOut) break;
      }
      if (looking === run) looking = undefined;
    },
    async connect(target, family, signal) {
      const ready = picked.get(target.platformId);
      if (ready) {
        picked.delete(target.platformId);
        return wrap(ready);
      }
      // a tap ends the desktop list's run of requests
      if (looking) looking.stopped = true;
      if (pending && pending.list.some((d) => d.id === target.platformId)) {
        const p = pending;
        pending = undefined;
        p.pick(target.platformId);
        try {
          return wrap(await p.link);
        } catch (e) {
          // the request ran out just as the ring was tapped: look for that ring below
          if (!(e instanceof NoDeviceError) || e.reason === 'unavailable' || e.reason === 'permission' || signal?.aborted) throw e;
        }
      } else if (pending) {
        // one request at a time: close the open list before asking for the remembered ring
        const p = pending;
        pending = undefined;
        p.pick(null);
        await p.link.catch(() => {});
      }
      if (!transport.reconnect) throw new Error('choose the ring again: this browser cannot reconnect by itself');
      const candidates = family ? [family] : scannedFamilies;
      if (!candidates.length) throw new Error('No family filters available to find this ring');
      // a ring the list showed, heard by an earlier request: give it a whole request's time to be heard again (once)
      const opts = listedIds.delete(target.platformId) ? { signal, scanMs: timing.windowMs } : { signal };
      return wrap(await transport.reconnect(target.platformId, familiesQuery(candidates), opts));
    },
  };
}
