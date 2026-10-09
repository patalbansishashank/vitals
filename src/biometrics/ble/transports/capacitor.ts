/**
 * Capacitor transport (the Android app): `@capacitor-community/bluetooth-le`'s `BleClient`, typed here by the part
 * Vitals uses so tests can hand in a fake. Vitals scans with no filter and matches the driver's filters itself, because
 * a ring may not advertise its service id (R21); the scan list shows each ring under its own advertised name. The
 * plugin's scan cannot filter by address, and a native filter by service would hide a J-Style 2301 that advertises
 * only its manufacturer marker, so a reconnect's scan is unfiltered too and picks the ring by its address here.
 */
import type { ScanMode } from '@capacitor-community/bluetooth-le';
import type { BluetoothServiceUUID } from '@/biometrics/core/ble/types';
import { fullUuid, matchesFilters } from './match';
import { NoDeviceError, queryOf, type BleTransport, type DeviceQuery, type FoundDevice, type RequestOptions, type RingLink } from './types';

/**
 * The plugin's `ScanMode.SCAN_MODE_LOW_LATENCY` (Android's highest scan duty cycle; the app is in the foreground while it
 * scans). Lumen paired at this mode; an idle J-Style 2301 advertises only every 20–40 s, so a balanced scan can miss it.
 */
export const SCAN_MODE_LOW_LATENCY: ScanMode.SCAN_MODE_LOW_LATENCY = 2;
/**
 * GATT statuses after which Lumen retried in 5 s and refreshed the GATT cache: 133 GATT_ERROR, 22 the phone's stack
 * ended the link, 62 the link was never established. The next connect to that address refreshes the cache once.
 */
export const TRANSIENT_GATT: ReadonlySet<number> = new Set([133, 22, 62]);

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
  requestLEScan(o: { services?: string[]; allowDuplicates?: boolean; scanMode?: number }, cb: (r: CapScanResult) => void): Promise<void>;
  stopLEScan(): Promise<void>;
  connect(deviceId: string, onDisconnect?: (deviceId: string) => void, o?: { timeout?: number }): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  getServices(deviceId: string): Promise<CapService[]>;
  /** Android: refreshes the GATT cache (`BluetoothGatt.refresh`), then discovers again; needs a connected device. */
  discoverServices?(deviceId: string): Promise<void>;
  getMtu?(deviceId: string): Promise<number>;
  startNotifications(deviceId: string, service: string, characteristic: string, cb: (v: DataView) => void): Promise<void>;
  stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void>;
  write(deviceId: string, service: string, characteristic: string, v: DataView): Promise<void>;
  writeWithoutResponse(deviceId: string, service: string, characteristic: string, v: DataView): Promise<void>;
  read(deviceId: string, service: string, characteristic: string): Promise<DataView>;
}

const bytesOf = (v: DataView): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
const viewOf = (b: Uint8Array): DataView => new DataView(b.slice().buffer);

/** What the transport learns from a link's end. */
export interface CapLinkHooks {
  /** The link ended (the ring dropped it, or it was closed here); `heard`: a notification came in on it. */
  ended?(heard: boolean): void;
  /** The plugin's disconnect failed: it may still hold the link. */
  closeFailed?(): void;
  /** False once a newer connect to this address owns the plugin's GATT: closing this link must not close that one. */
  mayClose?(): boolean;
}

export class CapacitorLink implements RingLink {
  private drops = new Set<() => void>();
  private closed = false;
  /** A notification came in: the ring answered on this link. */
  private heard = false;
  mtu?: number;

  constructor(
    private readonly ble: CapBleClient,
    readonly deviceId: string,
    readonly deviceName: string | undefined,
    private readonly discoveredServices: CapService[],
    private readonly hooks: CapLinkHooks = {},
  ) {}

  async services(): Promise<string[]> {
    return this.discoveredServices.map((service) => fullUuid(service.uuid));
  }

  /** Called by the transport's connect callback. */
  dropped(): void {
    if (this.closed) return;
    this.closed = true;
    this.hooks.ended?.(this.heard);
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
    await this.ble.startNotifications(this.deviceId, sv, ch, (v) => {
      this.heard = true;
      cb(bytesOf(v));
    });
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
    if (this.hooks.mayClose?.() !== false) await this.ble.disconnect(this.deviceId).catch(() => this.hooks.closeFailed?.());
    this.hooks.ended?.(this.heard);
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

/**
 * A connect error with a GATT status kept on it (C-RINGX-15): its own, else `fallback` (the status of an earlier step
 * of the same reconnect, so a final timeout does not lose the 133 that came before it).
 */
const withStatus = (e: unknown, fallback?: number): unknown => {
  const status = gattStatusOf(e) ?? fallback;
  if (status === undefined) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  return Object.assign(err, { gattStatus: status });
};

/** The plugin's own connect timeout (Device.kt `setConnectionTimeout`): it has disconnected and closed the GATT itself. */
const isPluginTimeout = (e: unknown): boolean => /connection timeout/i.test(e instanceof Error ? e.message : String(e));

/**
 * Time limits of `reconnect`: a direct connect, then a scan that stops at the first sighting, then a connect, all within
 * `totalMs`; then, on the link, the cache refresh when one is due and the services and MTU. The ring service bounds the
 * whole open, handshake included, at 45 s (`CONNECT_ATTEMPT_MS`): `totalMs` leaves room inside it for those steps and the
 * handshake, so a ring heard late is handed over in time and a failure reaches the service with its GATT status.
 */
export interface CapReconnectTiming {
  /** each connect (the plugin's own connect timeout) */
  connectMs: number;
  /** least time between a failed connect and the next one (GATT 133 needs the stack to settle) */
  backoffMs: number;
  /** the scan for the ring's address at most; it stops at the first sighting, and is cut so the last connect gets `connectMs` */
  scanMs: number;
  /** the connects and the scan */
  totalMs: number;
  /** a disconnect of a link the plugin may still hold, before a fresh connect */
  disconnectMs: number;
  /** the GATT cache refresh after a transient failure (the plugin's own limit is 5 s) */
  refreshMs: number;
  /** reading the services, and the MTU, of a connected link (each) */
  gattMs: number;
}
/**
 * 8 s direct connect + a scan of 19 s (up to 28 s when the direct connect fails early) + 8 s connect = 35 s; then at most
 * 5 s refresh + 2 s services + 2 s MTU, which leaves the handshake time inside the service's 45 s. An idle J-Style 2301
 * advertises every 20–40 s, and a direct connect hears it too; Lumen scanned 30 s at low latency.
 */
export const RECONNECT_TIMING: Readonly<CapReconnectTiming> = { connectMs: 8_000, backoffMs: 800, scanMs: 28_000, totalMs: 35_000, disconnectMs: 2_000, refreshMs: 5_000, gattMs: 2_000 };

const cancelled = (): NoDeviceError => new NoDeviceError('cancelled');

/** `p`'s value, or `fallback` once `ms` have passed (the plugin call itself is left to finish). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]).finally(() => clearTimeout(timer));
}

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

/** `p`, or 'cancelled' as soon as the signal aborts; `onAbandon` then takes care of `p`. */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined, onAbandon: () => void): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    onAbandon();
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      onAbandon();
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

/** What the transport knows about one address between connects. */
interface AddressState {
  /** Refresh the GATT cache once after the next connect: the last one failed with 133/22/62, or a link ended unheard. */
  refresh?: boolean;
  /** The plugin may still hold a half-open link: a connect it rejected with the GATT up, or a disconnect that failed. */
  halfOpen?: boolean;
  /** A connect given up on abort, settling (and its late link closing) in the plugin. */
  closing?: Promise<void>;
  /** Opens started on this address: each open takes the next number. */
  opens: number;
  /** The number of the latest open that called the plugin's connect. */
  dialed: number;
  /** The number of the latest open whose connect succeeded: its link owns the plugin's GATT for this address. */
  owner: number;
}

/**
 * Whether the open numbered `n` may still disconnect its address: no newer open has dialed it since (the plugin holds one
 * GATT per address, so that disconnect would close the newer link). A link left behind while a newer connect is still
 * under way, or after it failed, is marked half-open for the open after it.
 */
function mayClose(st: AddressState, n: number): boolean {
  if (st.dialed <= n) return true;
  if (st.owner < st.dialed) st.halfOpen = true;
  return false;
}

export function createCapacitorTransport(load: () => Promise<CapBleClient>, timing: Partial<CapReconnectTiming> = {}): BleTransport {
  const t = { ...RECONNECT_TIMING, ...timing };
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

  const addresses = new Map<string, AddressState>();
  const stateOf = (id: string): AddressState => {
    let st = addresses.get(id);
    if (!st) addresses.set(id, (st = { opens: 0, dialed: 0, owner: 0 }));
    return st;
  };

  /** Disconnects a link the plugin may still hold, within `disconnectMs`; one that fails or hangs stays marked half-open. */
  async function release(ble: CapBleClient, id: string, st: AddressState): Promise<void> {
    st.halfOpen = !(await within(ble.disconnect(id).then(() => true, () => false), t.disconnectMs, false));
  }

  /**
   * Lumen closed the old GATT before every `connectGatt`. From this side: a connect given up earlier settles (its late
   * link closed) and a link that may be half-open is disconnected first, so a failed link is never attached to again
   * (the plugin answers "Already connected." to a connect while it still holds one).
   */
  async function settle(ble: CapBleClient, id: string, st: AddressState): Promise<void> {
    if (st.closing) await within(st.closing, t.connectMs + t.disconnectMs, undefined);
    if (st.halfOpen) await release(ble, id, st);
  }

  /**
   * Lumen's `gatt.refresh()` after a failure: the plugin's `discoverServices` refreshes the GATT cache, then discovers
   * again (a stale cache left rings connected but silent). A refresh that fails or hangs is let go: the link stays.
   */
  async function refreshCache(ble: CapBleClient, id: string): Promise<void> {
    if (!ble.discoverServices) return;
    await within(ble.discoverServices(id).catch(() => undefined), t.refreshMs, undefined);
  }

  /** One connect. With a `deadline` the plugin's timeout is cut to the time left (time spent settling counts). */
  async function open(ble: CapBleClient, id: string, name: string | undefined, timeoutMs = 15_000, deadline?: number): Promise<CapacitorLink> {
    const st = stateOf(id);
    const n = ++st.opens;
    await settle(ble, id, st);
    // a newer open to this address started while this one waited: that one goes ahead and this one never dials (the
    // plugin keeps one disconnect listener per address, and this connect would take it over)
    if (st.opens !== n) throw cancelled();
    const timeout = deadline === undefined ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
    if (timeout <= 0) throw new Error('Connection timeout.');
    let link: CapacitorLink | undefined;
    let early = false;
    st.dialed = n;
    try {
      await ble.connect(id, () => (link ? link.dropped() : (early = true)), { timeout });
    } catch (e) {
      const status = gattStatusOf(e);
      if (status !== undefined && TRANSIENT_GATT.has(status)) st.refresh = true;
      // a GATT status (the OS dropped the link) or the plugin's own timeout has closed the GATT already; any other
      // rejection ("Service discovery failed.", "Starting requestMtu failed.") may leave it connected, its cache suspect
      if (status === undefined && !isPluginTimeout(e)) {
        st.refresh = true;
        if (mayClose(st, n)) await release(ble, id, st);
      }
      throw withStatus(e);
    }
    // the plugin holds this link now: nothing half-open is left behind it
    st.owner = n;
    st.halfOpen = false;
    try {
      if (st.refresh) {
        st.refresh = false;
        await refreshCache(ble, id);
      }
      const services = await within(ble.getServices(id), t.gattMs, undefined);
      if (!services) throw new Error('Reading the services timed out.');
      link = new CapacitorLink(ble, id, name, services, {
        // a link that ended before the ring answered on it (a failed subscribe or handshake): refresh next time
        ended: (heard) => {
          if (!heard && st.owner === n) st.refresh = true;
        },
        closeFailed: () => {
          st.halfOpen = true;
        },
        mayClose: () => mayClose(st, n),
      });
      if (early) link.dropped();
      // the MTU is only a hint for write sizes: a link without it still works, so a failure here keeps the link
      link.mtu = ble.getMtu ? await within(ble.getMtu(id).catch(() => undefined), t.gattMs, undefined) : undefined;
    } catch (e) {
      st.refresh = true;
      if (mayClose(st, n)) await release(ble, id, st);
      throw e;
    }
    return link;
  }

  /**
   * One connect that gives up on abort. The connect given up on still settles in the plugin: the next connect to that
   * address waits a while for it and for the close of a late link; past that wait the open numbers (`mayClose`) keep a
   * late close off the next link.
   */
  const attempt = (ble: CapBleClient, id: string, name: string | undefined, deadline: number, signal?: AbortSignal): Promise<CapacitorLink> => {
    if (signal?.aborted) return Promise.reject(cancelled());
    const p = open(ble, id, name, t.connectMs, deadline);
    if (!signal) return p;
    p.catch(() => {});
    return abortable(p, signal, () => {
      const st = stateOf(id);
      const closing: Promise<void> = p
        .then((late) => late.disconnect(), () => undefined)
        .finally(() => {
          if (st.closing === closing) st.closing = undefined;
        });
      st.closing = closing;
    });
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
        .requestLEScan({ allowDuplicates: false, scanMode: SCAN_MODE_LOW_LATENCY }, (r) => {
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
      const deadline = Date.now() + t.totalMs;
      // Android connects to a known address directly; when the OS still holds the link this attaches at once
      let status: number | undefined;
      let failedAt: number;
      try {
        return await attempt(ble, deviceId, undefined, deadline, signal);
      } catch (e) {
        if (e instanceof NoDeviceError) throw e;
        status = gattStatusOf(e);
        failedAt = Date.now();
      }
      // GATT 133, a timeout or a drop during connect: look for the ring until it is first heard, leaving the last connect
      // its whole time (an idle J-Style 2301 advertises only every 20–40 s)
      if (signal?.aborted) throw cancelled();
      let seen: FoundDevice | undefined;
      const scanMs = Math.min(t.scanMs, deadline - Date.now() - t.connectMs);
      if (scanMs > 0) {
        try {
          seen = await scan(ble, query, { signal, scanMs }, (list) => list.find((x) => x.id === deviceId));
        } catch (e) {
          if (!(e instanceof NoDeviceError) || e.reason !== 'not_found') throw e;
          // not seen: a ring the OS still holds a link to does not advertise, so try the address once more anyway
        }
      }
      // the stack settles after a failed connect before the next one
      const gap = failedAt + t.backoffMs - Date.now();
      if (gap > 0) await pause(gap, signal);
      try {
        return await attempt(ble, seen?.id ?? deviceId, seen?.name, deadline, signal);
      } catch (e) {
        // the GATT status of the last step that gave one, so the service picks its backoff from it
        throw e instanceof NoDeviceError ? e : withStatus(e, status);
      }
    },
  };
}
