/**
 * Capacitor transport (the Android app): `@capacitor-community/bluetooth-le`'s `BleClient`, typed here by the part
 * Vitals uses so tests can hand in a fake. Vitals scans with no filter and matches the driver's filters itself, because
 * a ring may not advertise its service id (R21); the scan list shows each ring under its own advertised name.
 */
import type { BluetoothServiceUUID } from '@/biometrics/core/ble/types';
import { fullUuid, matchesFilters } from './match';
import { NoDeviceError, queryOf, type BleTransport, type DeviceQuery, type FoundDevice, type RequestOptions, type RingLink } from './types';

export interface CapScanResult {
  device: { deviceId: string; name?: string };
  localName?: string;
  rssi?: number;
  manufacturerData?: Record<string, DataView>;
  uuids?: string[];
}
export interface CapService {
  uuid: string;
  characteristics: Array<{ uuid: string; properties: { write?: boolean; writeWithoutResponse?: boolean; notify?: boolean; read?: boolean } }>;
}
/** The slice of `BleClient` (bluetooth-le 8) this transport calls. */
export interface CapBleClient {
  initialize(o?: { androidNeverForLocation?: boolean }): Promise<void>;
  isEnabled(): Promise<boolean>;
  requestLEScan(o: { services?: string[]; allowDuplicates?: boolean }, cb: (r: CapScanResult) => void): Promise<void>;
  stopLEScan(): Promise<void>;
  connect(deviceId: string, onDisconnect?: (deviceId: string) => void, o?: { timeout?: number }): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  getServices(deviceId: string): Promise<CapService[]>;
  getMtu?(deviceId: string): Promise<number>;
  startNotifications(deviceId: string, service: string, characteristic: string, cb: (v: DataView) => void): Promise<void>;
  stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void>;
  write(deviceId: string, service: string, characteristic: string, v: DataView): Promise<void>;
  writeWithoutResponse(deviceId: string, service: string, characteristic: string, v: DataView): Promise<void>;
  read(deviceId: string, service: string, characteristic: string): Promise<DataView>;
}

const bytesOf = (v: DataView): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
const viewOf = (b: Uint8Array): DataView => new DataView(b.slice().buffer);

export class CapacitorLink implements RingLink {
  private drops = new Set<() => void>();
  private closed = false;
  mtu?: number;

  constructor(
    private readonly ble: CapBleClient,
    readonly deviceId: string,
    readonly deviceName: string | undefined,
    private readonly services: CapService[],
  ) {}

  /** Called by the transport's connect callback. */
  dropped(): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.drops) l();
  }

  private props(s: BluetoothServiceUUID, c: BluetoothServiceUUID): CapService['characteristics'][number]['properties'] | undefined {
    const svc = this.services.find((x) => fullUuid(x.uuid) === fullUuid(s));
    return svc?.characteristics.find((x) => fullUuid(x.uuid) === fullUuid(c))?.properties;
  }

  async write(s: BluetoothServiceUUID, c: BluetoothServiceUUID, bytes: Uint8Array, opts?: { withResponse?: boolean }): Promise<void> {
    if (this.closed) throw new Error('GATT server disconnected');
    // same rule as the web link: with response when the characteristic supports it, else without
    const p = this.props(s, c);
    const withResponse = opts?.withResponse ?? p?.write ?? !p?.writeWithoutResponse;
    const f = withResponse ? this.ble.write : this.ble.writeWithoutResponse;
    await f.call(this.ble, this.deviceId, fullUuid(s), fullUuid(c), viewOf(bytes));
  }

  async subscribe(s: BluetoothServiceUUID, c: BluetoothServiceUUID, cb: (b: Uint8Array) => void): Promise<() => void> {
    const [sv, ch] = [fullUuid(s), fullUuid(c)];
    await this.ble.startNotifications(this.deviceId, sv, ch, (v) => cb(bytesOf(v)));
    return async () => {
      if (!this.closed) await this.ble.stopNotifications(this.deviceId, sv, ch).catch(() => {});
    };
  }

  async read(s: BluetoothServiceUUID, c: BluetoothServiceUUID): Promise<Uint8Array> {
    return bytesOf(await this.ble.read(this.deviceId, fullUuid(s), fullUuid(c)));
  }

  onDisconnect(cb: () => void): () => void {
    this.drops.add(cb);
    return () => this.drops.delete(cb);
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.ble.disconnect(this.deviceId).catch(() => {});
    for (const l of this.drops) l();
  }
}

const mfrMap = (m: Record<string, DataView> | undefined): Map<number, Uint8Array> =>
  new Map(Object.entries(m ?? {}).map(([k, v]) => [Number(k), bytesOf(v)]));

export function createCapacitorTransport(load: () => Promise<CapBleClient>): BleTransport {
  let ready: Promise<CapBleClient> | undefined;
  const client = (): Promise<CapBleClient> =>
    (ready ??= load().then(async (b) => {
      await b.initialize({ androidNeverForLocation: true });
      return b;
    })).catch((e) => {
      ready = undefined;
      throw e;
    });

  async function open(ble: CapBleClient, id: string, name: string | undefined): Promise<CapacitorLink> {
    let link: CapacitorLink | undefined;
    let early = false;
    await ble.connect(id, () => (link ? link.dropped() : (early = true)), { timeout: 15_000 });
    try {
      const services = await ble.getServices(id);
      link = new CapacitorLink(ble, id, name, services);
      if (early) link.dropped();
      link.mtu = ble.getMtu ? await ble.getMtu(id).catch(() => undefined) : undefined;
      return link;
    } catch (e) {
      await ble.disconnect(id).catch(() => {});
      throw e;
    }
  }

  /** Scans until `pick` returns a device (or the time runs out), then stops the scan. */
  async function scan(ble: CapBleClient, query: DeviceQuery, opts: RequestOptions, pick: (list: FoundDevice[]) => FoundDevice | undefined): Promise<FoundDevice> {
    const { filters } = queryOf(query);
    const found = new Map<string, FoundDevice>();
    let settle!: (d: FoundDevice | NoDeviceError['reason']) => void;
    const done = new Promise<FoundDevice | NoDeviceError['reason']>((r) => (settle = r));
    const timer = setTimeout(() => settle('not_found'), opts.scanMs ?? 20_000);
    const onAbort = (): void => settle('cancelled');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) settle('cancelled');
    void opts.chooser?.chosen.then(
      (id) => settle(id ? (found.get(id) ?? { id }) : 'cancelled'),
      () => settle('cancelled'),
    );
    try {
      await ble.requestLEScan({ allowDuplicates: false }, (r) => {
        const name = r.localName ?? r.device.name;
        if (!matchesFilters({ name, services: r.uuids, manufacturerData: mfrMap(r.manufacturerData) }, filters)) return;
        found.set(r.device.deviceId, { id: r.device.deviceId, ...(name ? { name } : {}), ...(r.rssi !== undefined ? { rssi: r.rssi } : {}) });
        const p = pick([...found.values()]);
        if (p) settle(p);
      });
      const d = await done;
      if (typeof d === 'string') throw new NoDeviceError(d);
      return d;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      await ble.stopLEScan().catch(() => {});
    }
  }

  return {
    kind: 'capacitor',
    async isAvailable() {
      try {
        return await (await client()).isEnabled();
      } catch {
        return false;
      }
    },
    async requestDevice(query, opts = {}) {
      const ble = await client().catch(() => {
        throw new NoDeviceError('unavailable');
      });
      const chooser = opts.chooser;
      const d = await scan(ble, query, opts, chooser ? (list) => (chooser.update(list), undefined) : (list) => list[0]);
      return open(ble, d.id, d.name);
    },
    async reconnect(deviceId, query, opts = {}) {
      const ble = await client();
      try {
        return await open(ble, deviceId, undefined);
      } catch {
        // Android connects to a known MAC directly; a ring that changed address or went to sleep is looked for first
        const d = await scan(ble, query, { ...opts, scanMs: 10_000 }, (list) => list.find((x) => x.id === deviceId));
        return open(ble, d.id, d.name);
      }
    },
  };
}
