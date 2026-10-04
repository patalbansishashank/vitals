/**
 * Fakes of the three platform Bluetooth APIs, each backed by one `FakePeripheral` that plays the ring: Web Bluetooth
 * (`navigator.bluetooth`), the Capacitor BLE plugin (`CapBleClient`) and the desktop bridge (Chromium's Web Bluetooth
 * plus `{ onDevices, choose, activate? }`). `peripheral.test.ts` runs the real adapters and `openRingSession` over them.
 *
 * The fakes behave like the real platforms where an adapter could get it wrong: a notification buffer is rewritten
 * right after it is delivered, a service the page never asked for is refused, the Capacitor plugin reports a drop after
 * an app-made disconnect too, and Chromium refuses a request without a click. They never print a frame: bytes only
 * travel to the peripheral, which keeps them (the 0x3C write included) in `writes`.
 */
import { jstyle2301 } from '../../../../../packages/rings/src/jstyle2301/family';
import { J2301_COMPANY_ID } from '../../../../../packages/rings/src/jstyle2301/commands';
import { fakeFromSession, type FakePeripheral, type FakePeripheralOptions, type FixtureSession } from '../../../../../packages/rings/src/testing';
import type { Uuid } from '../../../../../packages/rings/src/types';
import type { BluetoothLEScanFilter, BluetoothServiceUUID } from '@/biometrics/core/ble/types';
import type { CapBleClient, CapScanResult, CapService } from '../capacitor';
import type { DesktopBluetoothBridge } from '../electron';
import { fullUuid, matchesFilters } from '../match';
import type { FoundDevice } from '../types';

// ---------------------------------------------------------------- the ring

/** One write as the ring saw it: where it went and with which mode. The bytes are in `fake.writes`. */
export interface WriteSeen {
  service: Uuid;
  characteristic: Uuid;
  mode: 'withResponse' | 'withoutResponse';
}

export interface Ring {
  fake: FakePeripheral;
  seen: WriteSeen[];
}

/** A fake ring scripted from one fixture session; `seen` records every write's channel and mode. */
export function ringFrom(session: FixtureSession, opts: FakePeripheralOptions = {}): Ring {
  const fake = fakeFromSession(session, opts);
  const seen: WriteSeen[] = [];
  const write = fake.write.bind(fake);
  fake.write = async (service, characteristic, bytes, mode) => {
    seen.push({ service, characteristic, mode });
    return write(service, characteristic, bytes, mode);
  };
  return { fake, seen };
}

/** What a platform was asked to do; the same shape for all three, so one test can check any of them. */
export interface PlatformStats {
  disconnects: number;
  writesWithResponse: number;
  writesWithoutResponse: number;
  /** Web Bluetooth's old `writeValue`, which gives the adapter no say over the mode. */
  writesLegacy: number;
  notifyStarts: number;
  notifyStops: number;
}

export const newStats = (): PlatformStats => ({ disconnects: 0, writesWithResponse: 0, writesWithoutResponse: 0, writesLegacy: 0, notifyStarts: 0, notifyStops: 0 });

/** The part of the ring's advertisement after the LE company id: the marker the J-Style family looks for. */
export const RING_MARKER = Uint8Array.of(0x44, 0x23, 0x01);

const copyOf = (b: Uint8Array): Uint8Array => b.slice();
const bytesOf = (v: ArrayBufferView | ArrayBuffer): Uint8Array =>
  ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice() : new Uint8Array(v).slice();
const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

// ---------------------------------------------------------------- Web Bluetooth (browser and desktop app)

interface WebRequest {
  filters: BluetoothLEScanFilter[];
  optionalServices: BluetoothServiceUUID[];
}

class FakeWebChar extends EventTarget {
  value?: DataView;
  readonly properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; read: boolean };
  private stop?: () => Promise<void>;

  constructor(
    private readonly dev: FakeWebDevice,
    readonly service: string,
    readonly uuid: string,
  ) {
    super();
    const isWrite = uuid === jstyle2301.gatt.write;
    const isNotify = jstyle2301.gatt.notify.some((n) => n.characteristic === uuid);
    this.properties = { write: isWrite, writeWithoutResponse: isWrite, notify: isNotify, read: !isWrite && !isNotify };
  }

  private check(): void {
    if (!this.dev.connected) throw named('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.');
  }
  private async put(v: BufferSource, mode: 'withResponse' | 'withoutResponse'): Promise<void> {
    this.check();
    await this.dev.ring.fake.write(this.service, this.uuid, bytesOf(v), mode);
  }

  writeValueWithResponse = async (v: BufferSource): Promise<void> => {
    this.dev.stats.writesWithResponse++;
    await this.put(v, 'withResponse');
  };
  writeValueWithoutResponse = async (v: BufferSource): Promise<void> => {
    this.dev.stats.writesWithoutResponse++;
    await this.put(v, 'withoutResponse');
  };
  writeValue = async (v: BufferSource): Promise<void> => {
    this.dev.stats.writesLegacy++;
    await this.put(v, 'withResponse');
  };
  startNotifications = async (): Promise<this> => {
    this.check();
    this.stop = await this.dev.ring.fake.subscribe(this.service, this.uuid, 'notify');
    this.dev.live.set(`${this.service}/${this.uuid}`, this);
    this.dev.stats.notifyStarts++;
    return this;
  };
  stopNotifications = async (): Promise<this> => {
    this.dev.stats.notifyStops++;
    this.dev.live.delete(`${this.service}/${this.uuid}`);
    await this.stop?.();
    this.stop = undefined;
    return this;
  };
  readValue = async (): Promise<DataView> => {
    this.check();
    const b = copyOf(await this.dev.ring.fake.read(this.service, this.uuid));
    return new DataView(b.buffer as ArrayBuffer);
  };

  /** The ring notified: set `value` and fire the event, then rewrite the buffer, as Chrome does for the next one. */
  deliver(bytes: Uint8Array): void {
    const buf = copyOf(bytes);
    this.value = new DataView(buf.buffer as ArrayBuffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
    buf.fill(0);
  }
}

class FakeGatt {
  private readonly chars = new Map<string, FakeWebChar>();

  constructor(private readonly dev: FakeWebDevice) {}

  get connected(): boolean {
    return this.dev.connected;
  }
  async connect(): Promise<this> {
    this.dev.connected = true;
    return this;
  }
  disconnect(): void {
    if (!this.dev.connected) return;
    this.dev.connected = false;
    this.dev.stats.disconnects++;
    void this.dev.ring.fake.disconnect();
    this.dev.dispatchEvent(new Event('gattserverdisconnected'));
  }
  async getPrimaryService(s: BluetoothServiceUUID): Promise<{ getCharacteristic(c: BluetoothServiceUUID): Promise<FakeWebChar> }> {
    if (!this.dev.connected) throw named('NetworkError', 'GATT Server is disconnected. Cannot retrieve services.');
    const service = fullUuid(s);
    if (!this.dev.allowed.has(service)) throw named('SecurityError', "Origin is not allowed to access the service. Tip: add the service UUID to 'optionalServices' in requestDevice() options.");
    return {
      getCharacteristic: async (c) => {
        const key = `${service}/${fullUuid(c)}`;
        const known = this.chars.get(key);
        if (known) return known;
        const made = new FakeWebChar(this.dev, service, fullUuid(c));
        this.chars.set(key, made);
        return made;
      },
    };
  }
}

export class FakeWebDevice extends EventTarget {
  readonly stats = newStats();
  connected = false;
  /** Services the page may open: those named in the request's filters and `optionalServices`. */
  readonly allowed = new Set<string>();
  readonly live = new Map<string, FakeWebChar>();
  readonly gatt = new FakeGatt(this);

  constructor(
    readonly ring: Ring,
    readonly id: string,
    readonly name: string,
  ) {
    super();
    ring.fake.on((ev) => {
      if (ev.type === 'notification') this.live.get(`${ev.service}/${ev.characteristic}`)?.deliver(ev.bytes);
      else if (ev.type === 'disconnected') this.ringDropped();
    });
  }

  private ringDropped(): void {
    if (!this.connected) return;
    this.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

/**
 * Chromium inside the desktop app has no chooser window: the main process lists the devices through the bridge and the
 * page answers with `choose`. Without a click in hand (`activate`) Chromium refuses the request, as it does for real.
 */
export class FakeDesktopBridge implements DesktopBluetoothBridge {
  private readonly listeners = new Set<(list: FoundDevice[]) => void>();
  private answer?: (id: string | null) => void;
  private clicked = false;
  /** Everything that happened, in order: 'activate', 'request', 'choose'. */
  readonly log: string[] = [];
  /** The ids passed to `choose`. */
  readonly chose: Array<string | null> = [];
  activate?: () => Promise<void>;

  constructor(readonly withActivate: boolean) {
    if (withActivate) {
      this.activate = async () => {
        this.log.push('activate');
        this.clicked = true;
      };
    }
  }

  onDevices(cb: (list: FoundDevice[]) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  choose(id: string | null): void {
    this.log.push('choose');
    this.chose.push(id);
    const a = this.answer;
    this.answer = undefined;
    a?.(id);
  }

  /** Chromium's `select-bluetooth-device`: needs a click when the bridge gives one, lists the devices twice (it repeats a list) and waits for `choose`. */
  select(list: FoundDevice[]): Promise<string | null> {
    this.log.push('request');
    if (this.withActivate && !this.clicked) throw named('SecurityError', 'Must be handling a user gesture to show a permission request.');
    this.clicked = false;
    return new Promise((resolve) => {
      this.answer = resolve;
      const emit = (): void => this.listeners.forEach((l) => l(list.map((d) => ({ ...d }))));
      setTimeout(emit, 0);
      setTimeout(emit, 2);
    });
  }
}

export interface FakeWeb {
  /** For `vi.stubGlobal('navigator', { bluetooth })`. */
  bluetooth: { getAvailability(): Promise<boolean>; requestDevice(o: WebRequest): Promise<FakeWebDevice> };
  device: FakeWebDevice;
  /** Every request the page made, as the browser received it. */
  requests: WebRequest[];
}

/**
 * `navigator.bluetooth` with one ring in range. Like Chrome it offers only a device the request's filters accept: the
 * ring advertises its LE company id 0x1234 and the marker, not the FFF0 service. With a `desktop` bridge the choice is
 * made through it (the desktop app); without one the person taps the ring in the browser's chooser.
 */
export function fakeWebBluetooth(ring: Ring, o: { id?: string; name?: string; desktop?: FakeDesktopBridge; address?: string } = {}): FakeWeb {
  const device = new FakeWebDevice(ring, o.id ?? 'opaque-web-id', o.name ?? 'J-Style ring');
  const requests: WebRequest[] = [];
  const advertisement = { name: device.name, services: [] as string[], manufacturerData: new Map([[J2301_COMPANY_ID, RING_MARKER]]) };
  return {
    device,
    requests,
    bluetooth: {
      getAvailability: async () => true,
      async requestDevice(req) {
        requests.push({ filters: req.filters, optionalServices: req.optionalServices });
        const offered = matchesFilters(advertisement, req.filters);
        if (o.desktop) {
          const id = await o.desktop.select(offered ? [{ id: o.address ?? device.id, name: device.name }] : []);
          if (!id) throw named('NotFoundError', 'User cancelled the requestDevice() chooser.');
        } else if (!offered) {
          throw named('NotFoundError', 'User cancelled the requestDevice() chooser.');
        }
        for (const f of req.filters) for (const s of f.services ?? []) device.allowed.add(fullUuid(s));
        for (const s of req.optionalServices) device.allowed.add(fullUuid(s));
        return device;
      },
    },
  };
}

// ---------------------------------------------------------------- Capacitor BLE plugin (Android app)

const dataView = (b: Uint8Array): DataView => new DataView(copyOf(b).buffer as ArrayBuffer);

/**
 * `BleClient` with one ring in range, reported as Android does: the manufacturer data is keyed by the company id as a
 * decimal string and holds the bytes after the id. A stranger is advertised first.
 */
export class FakeCapClient implements CapBleClient {
  readonly stats = newStats();
  readonly scanResults: CapScanResult[];
  scans = 0;
  stoppedScans = 0;
  readonly connects: string[] = [];
  private scanning = false;
  private connected = false;
  private onDrop?: (id: string) => void;
  private readonly subs = new Map<string, (v: DataView) => void>();
  private readonly stops = new Map<string, () => Promise<void>>();

  constructor(
    readonly ring: Ring,
    readonly o: { deviceId: string; localName?: string; mtu?: number },
  ) {
    this.scanResults = [
      { device: { deviceId: 'E2:80:00:00:00:99', name: 'Other thing' }, rssi: -80, manufacturerData: { '22136': dataView(Uint8Array.of(1, 2)) }, uuids: [] },
      { device: { deviceId: o.deviceId }, localName: o.localName ?? 'J-Style ring', rssi: -55, manufacturerData: { [String(J2301_COMPANY_ID)]: dataView(RING_MARKER) }, uuids: [] },
    ];
    ring.fake.on((ev) => {
      if (ev.type === 'notification') {
        const cb = this.subs.get(`${ev.service}/${ev.characteristic}`);
        if (!cb) return;
        const buf = copyOf(ev.bytes);
        cb(new DataView(buf.buffer as ArrayBuffer));
        buf.fill(0);
      } else if (ev.type === 'disconnected') {
        this.connected = false;
        this.onDrop?.(this.o.deviceId);
      }
    });
  }

  initialize = async (_o?: { androidNeverForLocation?: boolean }): Promise<void> => {};
  isEnabled = async (): Promise<boolean> => true;

  async requestLEScan(_o: { services?: string[]; allowDuplicates?: boolean }, cb: (r: CapScanResult) => void): Promise<void> {
    this.scans++;
    this.scanning = true;
    this.scanResults.forEach((r, i) => setTimeout(() => this.scanning && cb(r), i));
  }
  async stopLEScan(): Promise<void> {
    this.stoppedScans++;
    this.scanning = false;
  }

  async connect(deviceId: string, onDisconnect?: (id: string) => void): Promise<void> {
    if (deviceId !== this.o.deviceId) throw new Error('device not found');
    this.connects.push(deviceId);
    this.connected = true;
    this.onDrop = onDisconnect;
  }
  /** The plugin reports `onDisconnect` for an app-made disconnect too; with no link it just resolves (Device.kt). */
  async disconnect(deviceId: string): Promise<void> {
    if (!this.connected) return;
    this.stats.disconnects++;
    this.connected = false;
    void this.ring.fake.disconnect();
    queueMicrotask(() => this.onDrop?.(deviceId));
  }

  async getServices(_id: string): Promise<CapService[]> {
    const g = jstyle2301.gatt;
    return [
      { uuid: g.service, characteristics: [{ uuid: g.write, properties: { write: true, writeWithoutResponse: true } }, ...g.notify.map((n) => ({ uuid: n.characteristic, properties: { notify: true } }))] },
      ...(g.deviceInfo?.serial ? [{ uuid: g.deviceInfo.service, characteristics: [{ uuid: g.deviceInfo.serial, properties: { read: true } }] }] : []),
    ];
  }
  getMtu = async (_id: string): Promise<number> => this.o.mtu ?? 247;

  private check(): void {
    if (!this.connected) throw new Error('not connected');
  }
  async startNotifications(_id: string, service: string, characteristic: string, cb: (v: DataView) => void): Promise<void> {
    this.check();
    const key = `${service}/${characteristic}`;
    this.stops.set(key, await this.ring.fake.subscribe(service, characteristic, 'notify'));
    this.subs.set(key, cb);
    this.stats.notifyStarts++;
  }
  async stopNotifications(_id: string, service: string, characteristic: string): Promise<void> {
    const key = `${service}/${characteristic}`;
    this.stats.notifyStops++;
    this.subs.delete(key);
    await this.stops.get(key)?.();
    this.stops.delete(key);
  }
  async write(_id: string, service: string, characteristic: string, v: DataView): Promise<void> {
    this.check();
    this.stats.writesWithResponse++;
    await this.ring.fake.write(service, characteristic, bytesOf(v), 'withResponse');
  }
  async writeWithoutResponse(_id: string, service: string, characteristic: string, v: DataView): Promise<void> {
    this.check();
    this.stats.writesWithoutResponse++;
    await this.ring.fake.write(service, characteristic, bytesOf(v), 'withoutResponse');
  }
  async read(_id: string, service: string, characteristic: string): Promise<DataView> {
    this.check();
    return dataView(await this.ring.fake.read(service, characteristic));
  }
}
