/**
 * The three platforms as `@vitals/rings` transports (A5a): a `Transport` over any `RingLink`, and a `TransportFactory`
 * per platform for scanning and (re)connecting. The links underneath are the same ones the app's current Bluetooth path
 * uses, so both paths share one adapter per platform.
 */
import type { Advertisement, FamilyId, RingFamily, Transport, TransportEvent, TransportFactory, Uuid } from '../../../../packages/rings/src/types';
import { normalizeUuid } from '../../../../packages/rings/src/types';
import type { CapBleClient, CapScanResult } from './capacitor';
import type { BleTransport, DeviceQuery, FoundDevice, RingLink } from './types';

/** A ring seen through a platform chooser: the chooser did the matching, so the families it was asked for ride along. */
export type ChooserAdvertisement = Advertisement & { matchedFamilies?: FamilyId[] };

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
    ...(extra.services ? { services: extra.services } : {}),
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
      const link = await transport.reconnect!(target.platformId, familiesQuery([family]), { signal });
      const ble = await client();
      return linkTransport(link, {
        address: target.platformId,
        services: async () => (await ble.getServices(target.platformId)).map((s) => normalizeUuid(s.uuid)),
      });
    },
  };
}

/**
 * Chooser platforms (browser, desktop app): `scan` opens one request for all the families; each ring the platform lists
 * is reported with the families it was asked for. On the web the browser's window lists them and `scan` ends with the
 * one the person picked; `connect` then hands over that already-open link. On the desktop the bridge lists them and
 * `connect` answers the open request (or opens a new one that picks the remembered ring).
 */
export function chooserFactory(transport: BleTransport, platform: 'web-bluetooth' | 'electron'): TransportFactory {
  const picked = new Map<string, RingLink>();
  let pending: { list: FoundDevice[]; pick: (id: string | null) => void; link: Promise<RingLink> } | undefined;
  const ids = (fs: readonly RingFamily[]): FamilyId[] => fs.map((f) => f.id);
  const wrap = (link: RingLink): Transport => linkTransport(link);

  return {
    platform,
    available: () => transport.isAvailable(),
    async scan(families, onFound, signal) {
      const query = familiesQuery(families);
      const report = (d: FoundDevice): void => onFound({ ...(d.name ? { name: d.name } : {}), serviceUuids: [], manufacturerData: [], platformId: d.id, matchedFamilies: ids(families) } as ChooserAdvertisement);
      if (platform === 'web-bluetooth') {
        const link = await transport.requestDevice(query, { signal });
        // a ring picked earlier but never connected is let go
        for (const old of picked.values()) void old.disconnect().catch(() => {});
        picked.clear();
        const id = link.deviceId ?? 'web:picked';
        picked.set(id, link);
        report({ id, ...(link.deviceName ? { name: link.deviceName } : {}) });
        return;
      }
      let pick!: (id: string | null) => void;
      const chosen = new Promise<string | null>((r) => (pick = r));
      const seen = new Set<string>();
      const p = { list: [] as FoundDevice[], pick, link: undefined as unknown as Promise<RingLink> };
      p.link = transport.requestDevice(query, {
        signal,
        scanMs: 60_000,
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
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
        void p.link.then(() => resolve(), () => resolve());
      });
      // ended by abort or by itself: either way nothing can be chosen from this list any more
      if (pending === p) {
        pending = undefined;
        pick(null);
      }
    },
    async connect(target, family, signal) {
      const ready = picked.get(target.platformId);
      if (ready) {
        picked.delete(target.platformId);
        return wrap(ready);
      }
      if (pending && pending.list.some((d) => d.id === target.platformId)) {
        const p = pending;
        pending = undefined;
        p.pick(target.platformId);
        return wrap(await p.link);
      }
      if (pending) {
        // one request at a time: close the open list before asking for the remembered ring
        const p = pending;
        pending = undefined;
        p.pick(null);
        await p.link.catch(() => {});
      }
      if (!transport.reconnect) throw new Error('choose the ring again: this browser cannot reconnect by itself');
      return wrap(await transport.reconnect(target.platformId, familiesQuery([family]), { signal }));
    },
  };
}
