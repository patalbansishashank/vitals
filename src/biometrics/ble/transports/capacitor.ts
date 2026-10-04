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
    private readonly discoveredServices: CapService[],
  ) {}

  async services(): Promise<string[]> {
    return this.discoveredServices.map((service) => fullUuid(service.uuid));
  }

  /** Called by the transport's connect callback. */
  dropped(): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.drops) l();
  }

  private props(s: BluetoothServiceUUID, c: BluetoothServiceUUID): CapService['characteristics'][number]['properties'] | undefined {
    const svc = this.discoveredServices.find((x) => fullUuid(x.uuid) === fullUuid(s));
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

/**
 * The GATT status of a failed connect, when the plugin gave one. The Android plugin rejects a connect that the OS
 * dropped with "Connection failed with status 133 (GATT_ERROR)." (Device.kt onConnectionStateChange); this transport
 * copies that number onto the error as `gattStatus`.
 */
export function gattStatusOf(e: unknown): number | undefined {
  if (e && typeof e === 'object' && typeof (e as { gattStatus?: unknown }).gattStatus === 'number') return (e as { gattStatus: number }).gattStatus;
  const m = /\bstatus (\d+)\b/.exec(e instanceof Error ? e.message : typeof e === 'string' ? e : '');
  return m ? Number(m[1]) : undefined;
}

/** A connect error with the plugin's GATT status kept on it (C-RINGX-15). */
const withStatus = (e: unknown): unknown => {
  const status = gattStatusOf(e);
  if (status === undefined) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  return Object.assign(err, { gattStatus: status });
};

/** Time limits of `reconnect`; the worst case (connect, backoff, scan, connect) is about 25 s. */
export interface CapReconnectTiming {
  /** each direct connect */
  connectMs: number;
  /** pause after a failed connect (GATT 133 needs the stack to settle) */
  backoffMs: number;
  /** the scan for the same id; it stops as soon as the id is seen */
  scanMs: number;
}
const TIMING: CapReconnectTiming = { connectMs: 8_000, backoffMs: 800, scanMs: 8_000 };

const cancelled = (): NoDeviceError => new NoDeviceError('cancelled');

/** Waits `ms`, or rejects 'cancelled' as soon as the signal aborts. */
const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const onAbort = (): void => {
      clearTimeout(t);
      reject(cancelled());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** `p`, or 'cancelled' as soon as the signal aborts; `onLate` runs if `p` still resolves after the abort. */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined, onLate: (v: T) => void): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    void p.then(onLate, () => {});
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      void p.then(onLate, () => {});
      reject(cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => (signal.removeEventListener('abort', onAbort), resolve(v)),
      (e: unknown) => (signal.removeEventListener('abort', onAbort), reject(e)),
    );
  });
}

/** The plugin rejects with a message (and sometimes a code) when the person refused Nearby devices (Android 12+) or location (older). */
export function isPermissionRefusal(e: unknown): boolean {
  const o = (e ?? {}) as { message?: unknown; code?: unknown };
  const text = [typeof e === 'string' ? e : '', typeof o.message === 'string' ? o.message : '', typeof o.code === 'string' ? o.code : ''].join(' ');
  return /permission|denied|not granted|unauthori[sz]ed|not allowed/i.test(text);
}

export function createCapacitorTransport(load: () => Promise<CapBleClient>, timing: Partial<CapReconnectTiming> = {}): BleTransport {
  const t = { ...TIMING, ...timing };
  let ready: Promise<CapBleClient> | undefined;
  let denied = false;
  const client = (): Promise<CapBleClient> =>
    (ready ??= load().then(async (b) => {
      await b.initialize({ androidNeverForLocation: true });
      denied = false;
      return b;
    })).catch((e) => {
      ready = undefined;
      denied = isPermissionRefusal(e);
      throw e;
    });

  async function open(ble: CapBleClient, id: string, name: string | undefined, timeout = 15_000): Promise<CapacitorLink> {
    let link: CapacitorLink | undefined;
    let early = false;
    try {
      await ble.connect(id, () => (link ? link.dropped() : (early = true)), { timeout });
    } catch (e) {
      throw withStatus(e);
    }
    try {
      const services = await ble.getServices(id);
      link = new CapacitorLink(ble, id, name, services);
      if (early) link.dropped();
      // the MTU is only a hint for write sizes: a link without it still works, so a failure here keeps the link
      link.mtu = ble.getMtu ? await ble.getMtu(id).catch(() => undefined) : undefined;
    } catch (e) {
      await ble.disconnect(id).catch(() => {});
      throw e;
    }
    return link;
  }

  /** One direct connect that gives up on abort (and then closes the late link). */
  const attempt = (ble: CapBleClient, id: string, name: string | undefined, signal?: AbortSignal): Promise<CapacitorLink> => {
    if (signal?.aborted) return Promise.reject(cancelled());
    const p = open(ble, id, name, t.connectMs);
    if (signal) p.catch(() => {});
    return abortable(p, signal, (l) => void l.disconnect());
  };

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
      await ble
        .requestLEScan({ allowDuplicates: false }, (r) => {
          const name = r.localName ?? r.device.name;
          if (!matchesFilters({ name, services: r.uuids, manufacturerData: mfrMap(r.manufacturerData) }, filters)) return;
          found.set(r.device.deviceId, {
            id: r.device.deviceId, ...(name ? { name } : {}), ...(r.rssi !== undefined ? { rssi: r.rssi } : {}),
            serviceUuids: r.uuids ?? [],
            manufacturerData: Object.entries(r.manufacturerData ?? {}).map(([id, view]) => {
              const company = Number(id);
              return Uint8Array.of(company & 0xff, (company >> 8) & 0xff, ...bytesOf(view));
            }),
          });
          const p = pick([...found.values()]);
          if (p) settle(p);
        })
        .catch((e) => {
          if (!isPermissionRefusal(e)) throw e;
          denied = true;
          throw new NoDeviceError('permission');
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
    permissionDenied: () => denied,
    async isAvailable() {
      try {
        return await (await client()).isEnabled();
      } catch {
        return false;
      }
    },
    async requestDevice(query, opts = {}) {
      const ble = await client().catch(() => {
        throw new NoDeviceError(denied ? 'permission' : 'unavailable');
      });
      const chooser = opts.chooser;
      const d = await scan(ble, query, opts, chooser ? (list) => (chooser.update(list), undefined) : (list) => list[0]);
      return open(ble, d.id, d.name);
    },
    async reconnect(deviceId, query, opts = {}) {
      const ble = await client();
      const { signal } = opts;
      if (signal?.aborted) throw cancelled();
      // Android connects to a known address directly; when the OS still holds the link this attaches at once
      try {
        return await attempt(ble, deviceId, undefined, signal);
      } catch (e) {
        if (e instanceof NoDeviceError) throw e;
      }
      // GATT 133, a timeout or a drop during connect: let the stack settle, then look for the ring
      await pause(t.backoffMs, signal);
      let seen: FoundDevice | undefined;
      try {
        seen = await scan(ble, query, { ...opts, scanMs: t.scanMs }, (list) => list.find((x) => x.id === deviceId));
      } catch (e) {
        if (!(e instanceof NoDeviceError) || e.reason !== 'not_found') throw e;
        // not seen: a ring the OS still holds a link to does not advertise, so try the address once more anyway
      }
      // a failure here keeps its GATT status (`gattStatusOf`) so the service can pick its backoff
      return attempt(ble, seen?.id ?? deviceId, seen?.name, signal);
    },
  };
}
