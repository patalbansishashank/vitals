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

/**
 * Characteristics some link on this device has started notifications on, kept across drops. Chromium keeps a page's
 * notification subscription per characteristic, and after a drop BlueZ turns it back on by itself when the ring
 * reconnects. `startNotifications()` on the new connection's characteristic then succeeds at once while every
 * notification still goes to the old characteristic object: the new session never hears the ring (on the owner's ring a
 * reconnect sent the firmware request, got no answer it could see, and so never sent the 0x3C passcode step).
 */
const notified = new WeakMap<object, Set<string>>();

/**
 * After the page lets go of a ring, BlueZ keeps the link about 2 s more (its disconnect timer; seen on the owner's PC:
 * "Connection terminated by local host" 2.3 s after `disconnect()`). A connect inside that window lands on the closing
 * link (Chromium says connected, then notifications fail) and the attempt is lost. Lumen waits between `disconnect()`
 * and `close()` for the same reason (`RingBLEClient.GATT_CLOSE_DELAY_MS`, 500 ms on Android); here the next connect to
 * the device waits until the link is gone.
 */
export const LINK_RELEASE_MS = 2_500;
const releasedAt = new WeakMap<object, number>();

/**
 * A GATT write that has not completed by then means a wedged link: Lumen's `OP_TIMEOUT_MS`, after which a command write
 * tears the link down and reconnects (`recoverWedgedLink`). Here the link is dropped, so the session ends and the
 * service connects again.
 */
export const OP_TIMEOUT_MS = 4_000;

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
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          withResponse ? ch.writeValueWithResponse(buf) : ch.writeValueWithoutResponse(buf),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(Object.assign(new Error('GATT write timed out'), { name: 'NetworkError' }));
              this.wedged();
            }, OP_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** A write never completed: drop the link (Lumen `recoverWedgedLink`), so its owner reconnects from scratch. */
  private wedged(): void {
    if (this.dropped) return;
    live.get(this.device)?.delete(this);
    if (this.server.connected && !inUse(this.device)) {
      releasedAt.set(this.device, Date.now());
      this.server.disconnect();
    }
    this.onDrop();
  }

  subscribe(s: BluetoothServiceUUID, c: BluetoothServiceUUID, cb: (b: Uint8Array) => void): Promise<() => void> {
    return this.serial(async () => {
      const ch = await this.char(s, c);
      const handler = (ev: Event): void => {
        const v = (ev.target as GattCharacteristic).value;
        if (v) cb(copy(v));
      };
      ch.addEventListener('characteristicvaluechanged', handler);
      const key = `${String(s)}/${String(c)}`.toLowerCase();
      const started = notified.get(this.device) ?? new Set<string>();
      // an earlier link's subscription (see `notified`): end it, so this characteristic object gets its own
      if (started.has(key)) await ch.stopNotifications().catch(() => {});
      await ch.startNotifications();
      notified.set(this.device, started.add(key));
      return () => {
        ch.removeEventListener('characteristicvaluechanged', handler);
        // a link that dropped has nothing left to stop; stopping now would end a newer link's subscription
        if (this.server.connected && !this.dropped) void ch.stopNotifications().catch(() => {});
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
    if (this.server.connected && !inUse(this.device)) {
      releasedAt.set(this.device, Date.now());
      this.server.disconnect();
    }
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
    const gatt = device.gatt;
    if (!gatt) throw new Error('device has no GATT server');
    // the page let go of this ring a moment ago: wait until BlueZ has really closed the link (`LINK_RELEASE_MS`)
    const wait = (releasedAt.get(device) ?? -Infinity) + LINK_RELEASE_MS - Date.now();
    const attempt = { server: wait > 0 ? new Promise<void>((r) => setTimeout(r, wait)).then(() => gatt.connect()) : gatt.connect(), lost: false };
    connecting.set(device, attempt);
    attempt.server.then(
      (server) => {
        connecting.delete(device);
        if (attempt.lost && !inUse(device)) {
          // a connect given up is let go like any other link: the next connect waits until BlueZ has closed it
          releasedAt.set(device, Date.now());
          server.disconnect();
        }
      },
      () => connecting.delete(device),
    );
    p = attempt;
  }
  p.lost = false;
  return p;
}

/** Between two connect tries on the same device. */
const CONNECT_RETRY_GAP_MS = 1_000;
/** A connect that failed sooner than this did not wait for the ring at all (Chromium said no at once): no retry. */
const CONNECT_TRIED_MS = 5_000;

/**
 * Shows the chooser filtered by the driver and connects. Call from a user gesture. `onGranted` runs when the browser
 * hands over the chosen device, before the connect. With `connectForMs`, a connect that fails with a NetworkError is
 * tried again until that much time has passed: BlueZ gives an LE connect 40 s ("le-connection-abort-by-local"), and a
 * ring that has been idle a long time may advertise only a few times a minute.
 */
export async function requestDevice(driver: Pick<BleDriver, 'requestOptions'>, o: { onGranted?: () => void; connectForMs?: number } = {}): Promise<WebBluetoothLink> {
  const bt = bluetooth();
  if (!bt) throw new Error('Web Bluetooth is not available in this browser');
  if (bt.getAvailability && !(await bt.getAvailability())) throw new Error('Bluetooth adapter unavailable');
  const device = await bt.requestDevice({ filters: driver.requestOptions.filters, optionalServices: driver.requestOptions.optionalServices });
  o.onGranted?.();
  const until = Date.now() + (o.connectForMs ?? 0);
  for (;;) {
    const tried = Date.now();
    try {
      return new WebBluetoothLink(device, await connectOnce(device).server);
    } catch (e) {
      // only a try that waited for the ring and ran out (BlueZ's 40 s) is worth another; an instant "no" would spin
      const waited = Date.now() - tried >= CONNECT_TRIED_MS;
      if ((e as { name?: unknown } | null)?.name !== 'NetworkError' || !waited || Date.now() + CONNECT_RETRY_GAP_MS >= until) throw e;
      await new Promise((r) => setTimeout(r, CONNECT_RETRY_GAP_MS));
    }
  }
}
