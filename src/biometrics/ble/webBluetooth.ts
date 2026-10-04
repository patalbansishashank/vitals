/**
 * Web Bluetooth transport: the ONLY module allowed to touch `navigator.bluetooth`. Tier H.
 * Chromium only (no Safari/iOS/Firefox); `requestDevice` must run inside a user gesture and shows the chooser every
 * session (`getDevices()` is still behind a flag). Foreground only: no background or periodic sync; the link ends with
 * the page. One GATT client per ring: the vendor app must be closed first.
 * Chrome exposes no ATT MTU, so `mtu` stays undefined (Chrome Android negotiation UNVERIFIED, R10 §4.4).
 */
import type { BleDriver, BleLink, BluetoothServiceUUID } from '@/biometrics/core/ble/types';
import type { RingLink } from './transports/types';

// Minimal Web Bluetooth surface (the DOM lib does not ship these types).
interface GattCharacteristic extends EventTarget {
  readonly value?: DataView;
  readonly properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; read: boolean };
  writeValueWithResponse(v: BufferSource): Promise<void>;
  writeValueWithoutResponse(v: BufferSource): Promise<void>;
  startNotifications(): Promise<GattCharacteristic>;
  stopNotifications(): Promise<GattCharacteristic>;
  readValue(): Promise<DataView>;
}
interface GattService {
  readonly uuid?: string;
  getCharacteristic(c: BluetoothServiceUUID): Promise<GattCharacteristic>;
}
interface GattServer {
  readonly connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(s: BluetoothServiceUUID): Promise<GattService>;
  getPrimaryServices?(): Promise<GattService[]>;
}
interface BtDevice extends EventTarget {
  readonly id?: string;
  readonly name?: string;
  readonly gatt?: GattServer;
}
interface BtApi {
  getAvailability?(): Promise<boolean>;
  requestDevice(o: { filters: unknown[]; optionalServices: BluetoothServiceUUID[] }): Promise<BtDevice>;
}

function bluetooth(): BtApi | undefined {
  return typeof navigator !== 'undefined' ? (navigator as Navigator & { bluetooth?: BtApi }).bluetooth : undefined;
}

/** Feature detection only (adapter may still be off). */
export function isWebBluetoothAvailable(): boolean {
  return bluetooth() !== undefined;
}

/** Web Bluetooth exists and the browser says an adapter is there (false also when it is switched off). */
export async function webBluetoothAvailability(): Promise<boolean> {
  const bt = bluetooth();
  if (!bt) return false;
  return bt.getAvailability ? bt.getAvailability().catch(() => false) : true;
}

/** Copies a notification DataView (Chrome reuses the buffer). */
const copy = (v: DataView): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);

/**
 * Links in use per device. The page has one GATT connection per device, shared by every link to it, so it is closed
 * only when the last link lets go (a late link must not close the one a newer link uses). Every link must be closed by
 * its owner, and only one may subscribe at a time: Chromium shares characteristic objects per device, so an old
 * link's unsubscribe would stop a new link's notifications (the service closes a session before it reconnects).
 */
const live = new WeakMap<object, Set<WebBluetoothLink>>();
const inUse = (device: object): boolean => (live.get(device)?.size ?? 0) > 0;

/**
 * A `gatt.connect()` still pending per device. Chromium cannot cancel one (`disconnect()` does nothing until it is
 * connected), so a connect given up is let go when it lands, unless a link uses the device by then.
 */
const connecting = new WeakMap<object, { server: Promise<GattServer>; lost: boolean }>();

export class WebBluetoothLink implements BleLink, RingLink {
  private serviceCache = new Map<string, Promise<GattService>>();
  private chars = new Map<string, Promise<GattCharacteristic>>();
  private dropListeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly mtu = undefined;

  constructor(
    private readonly device: BtDevice,
    private server: GattServer,
  ) {
    device.addEventListener('gattserverdisconnected', this.onDrop);
    const set = live.get(device) ?? new Set();
    live.set(device, set.add(this));
  }

  get deviceName(): string | undefined {
    return this.device.name;
  }

  /** Set by a transport that knows a better id than Chromium's opaque one (the desktop app gets the Bluetooth address). */
  platformId?: string;

  get deviceId(): string | undefined {
    return this.platformId ?? this.device.id;
  }

  async services(): Promise<string[]> {
    return (await this.server.getPrimaryServices?.() ?? []).flatMap((service) => service.uuid ? [service.uuid] : []);
  }

  private dropped = false;

  private onDrop = (): void => {
    live.get(this.device)?.delete(this);
    this.serviceCache.clear();
    this.chars.clear();
    if (this.dropped) return;
    this.dropped = true;
    for (const l of this.dropListeners) l();
  };

  private char(s: BluetoothServiceUUID, c: BluetoothServiceUUID): Promise<GattCharacteristic> {
    const key = `${s}/${c}`;
    let p = this.chars.get(key);
    if (!p) {
      let sp = this.serviceCache.get(String(s));
      if (!sp) this.serviceCache.set(String(s), (sp = this.server.getPrimaryService(s)));
      p = sp.then((svc) => svc.getCharacteristic(c));
      this.chars.set(key, p);
      p.catch(() => this.chars.delete(key));
    }
    return p;
  }

  /** GATT allows one operation at a time: serialize every write/read/subscribe. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const job = this.queue.then(() => {
      if (!this.server.connected) throw new Error('GATT server disconnected');
      return f();
    });
    this.queue = job.catch(() => {});
    return job;
  }

  write(s: BluetoothServiceUUID, c: BluetoothServiceUUID, bytes: Uint8Array, opts?: { withResponse?: boolean }): Promise<void> {
    return this.serial(async () => {
      const ch = await this.char(s, c);
      // RingBLEClient.kt:1184 rule: with response when the characteristic supports it, else without.
      const withResponse = opts?.withResponse ?? ch.properties.write;
      const buf = bytes.slice();
      await (withResponse ? ch.writeValueWithResponse(buf) : ch.writeValueWithoutResponse(buf));
    });
  }

  subscribe(s: BluetoothServiceUUID, c: BluetoothServiceUUID, cb: (b: Uint8Array) => void): Promise<() => void> {
    return this.serial(async () => {
      const ch = await this.char(s, c);
      const handler = (ev: Event): void => {
        const v = (ev.target as GattCharacteristic).value;
        if (v) cb(copy(v));
      };
      ch.addEventListener('characteristicvaluechanged', handler);
      await ch.startNotifications();
      return () => {
        ch.removeEventListener('characteristicvaluechanged', handler);
        if (this.server.connected) void ch.stopNotifications().catch(() => {});
      };
    });
  }

  read(s: BluetoothServiceUUID, c: BluetoothServiceUUID): Promise<Uint8Array> {
    return this.serial(async () => copy(await (await this.char(s, c)).readValue()));
  }

  onDisconnect(cb: () => void): () => void {
    this.dropListeners.add(cb);
    return () => this.dropListeners.delete(cb);
  }

  async disconnect(): Promise<void> {
    this.device.removeEventListener('gattserverdisconnected', this.onDrop);
    live.get(this.device)?.delete(this);
    if (this.server.connected && !inUse(this.device)) this.server.disconnect();
    this.onDrop();
  }

  /**
   * A new link to the same ring without a chooser or a click: `gatt.connect()` on the device this page was given. The
   * page keeps its permission for the device while it runs, and the platform connects even when a scan would not list
   * the ring. Gives up after `ms` or on abort; a connect still pending from an earlier try is waited on, not repeated.
   */
  async reopen(ms: number, signal?: AbortSignal): Promise<WebBluetoothLink> {
    const pending = connectOnce(this.device);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const server = await Promise.race([
        pending.server,
        new Promise<never>((_, reject) => {
          const fail = (why: string): void => {
            pending.lost = true;
            reject(Object.assign(new Error(why), { name: why === 'aborted' ? 'AbortError' : 'TimeoutError' }));
          };
          timer = setTimeout(() => fail('GATT connect timed out'), ms);
          onAbort = () => fail('aborted');
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      return new WebBluetoothLink(this.device, server);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** The device's pending `gatt.connect()`, or a new one; whoever waits on it now wants the connection. */
function connectOnce(device: BtDevice): { server: Promise<GattServer>; lost: boolean } {
  let p = connecting.get(device);
  if (!p) {
    if (!device.gatt) throw new Error('device has no GATT server');
    const attempt = { server: device.gatt.connect(), lost: false };
    connecting.set(device, attempt);
    attempt.server.then(
      (server) => {
        connecting.delete(device);
        if (attempt.lost && !inUse(device)) server.disconnect();
      },
      () => connecting.delete(device),
    );
    p = attempt;
  }
  p.lost = false;
  return p;
}

/** Shows the chooser filtered by the driver and connects. Call from a user gesture. */
export async function requestDevice(driver: Pick<BleDriver, 'requestOptions'>): Promise<WebBluetoothLink> {
  const bt = bluetooth();
  if (!bt) throw new Error('Web Bluetooth is not available in this browser');
  if (bt.getAvailability && !(await bt.getAvailability())) throw new Error('Bluetooth adapter unavailable');
  const device = await bt.requestDevice({ filters: driver.requestOptions.filters, optionalServices: driver.requestOptions.optionalServices });
  const server = await connectOnce(device).server;
  return new WebBluetoothLink(device, server);
}
