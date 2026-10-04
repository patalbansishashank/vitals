/**
 * Web Bluetooth transport: the ONLY module allowed to touch `navigator.bluetooth`. Tier H.
 * Chromium only (no Safari/iOS/Firefox); `requestDevice` must run inside a user gesture and shows the chooser every
 * session (`getDevices()` is still behind a flag). Foreground only: no background or periodic sync; the link ends with
 * the page. One GATT client per ring: the vendor app must be closed first.
 * Chrome exposes no ATT MTU, so `mtu` stays undefined (Chrome Android negotiation UNVERIFIED, R10 §4.4).
 */
import type { BleDriver, BleLink, BluetoothServiceUUID } from '@/biometrics/core/ble/types';

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
  getCharacteristic(c: BluetoothServiceUUID): Promise<GattCharacteristic>;
}
interface GattServer {
  readonly connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(s: BluetoothServiceUUID): Promise<GattService>;
}
interface BtDevice extends EventTarget {
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

/** Copies a notification DataView (Chrome reuses the buffer). */
const copy = (v: DataView): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);

export class WebBluetoothLink implements BleLink {
  private services = new Map<string, Promise<GattService>>();
  private chars = new Map<string, Promise<GattCharacteristic>>();
  private dropListeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly mtu = undefined;

  constructor(
    private readonly device: BtDevice,
    private server: GattServer,
  ) {
    device.addEventListener('gattserverdisconnected', this.onDrop);
  }

  get deviceName(): string | undefined {
    return this.device.name;
  }

  private onDrop = (): void => {
    this.services.clear();
    this.chars.clear();
    for (const l of this.dropListeners) l();
  };

  private char(s: BluetoothServiceUUID, c: BluetoothServiceUUID): Promise<GattCharacteristic> {
    const key = `${s}/${c}`;
    let p = this.chars.get(key);
    if (!p) {
      let sp = this.services.get(String(s));
      if (!sp) this.services.set(String(s), (sp = this.server.getPrimaryService(s)));
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
    if (this.server.connected) this.server.disconnect();
    this.onDrop();
  }
}

/** Shows the chooser filtered by the driver and connects. Call from a user gesture. */
export async function requestDevice(driver: BleDriver): Promise<WebBluetoothLink> {
  const bt = bluetooth();
  if (!bt) throw new Error('Web Bluetooth is not available in this browser');
  if (bt.getAvailability && !(await bt.getAvailability())) throw new Error('Bluetooth adapter unavailable');
  const device = await bt.requestDevice({ filters: driver.requestOptions.filters, optionalServices: driver.requestOptions.optionalServices });
  if (!device.gatt) throw new Error('device has no GATT server');
  const server = await device.gatt.connect();
  return new WebBluetoothLink(device, server);
}
