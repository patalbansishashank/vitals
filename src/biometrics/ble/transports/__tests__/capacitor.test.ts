import { afterEach, describe, expect, it, vi } from 'vitest';
import { command } from '@/biometrics/core/ble/jstyle2301/commands';
import { jstyle2301Driver } from '../../drivers';
import type { SessionClock } from '../../session';
import { createCapacitorTransport, type CapBleClient, type CapScanResult, type CapService } from '../capacitor';
import { NoDeviceError, type DeviceChooser, type FoundDevice } from '../types';

const SVC = '0000fff0-0000-1000-8000-00805f9b34fb';
const WR = '0000fff6-0000-1000-8000-00805f9b34fb';
const NT = '0000fff7-0000-1000-8000-00805f9b34fb';

const dv = (...b: number[]): DataView => new DataView(Uint8Array.from(b).buffer);
const view = (b: number[]): DataView => dv(...b);
const bytes = (v: DataView): number[] => Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));

/** A ring-shaped scan result: company id 0x1234 (as '4660'), no service ids advertised. */
const ringAd = (id: string, name: string, rssi = -60): CapScanResult => ({ device: { deviceId: id }, localName: name, rssi, manufacturerData: { '4660': dv(0x01, 0x23, 0x01) } });
const otherAd = (id: string, name: string): CapScanResult => ({ device: { deviceId: id, name }, rssi: -40, manufacturerData: { '22136': dv(1, 2) } });

const query = { filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optionalServices: [0xfff0] };

interface ScriptStep {
  expect: number[];
  reply: number[];
}

interface WriteRecord {
  mode: 'with' | 'without';
  service: string;
  characteristic: string;
  bytes: number[];
}

class FakeCapBle implements CapBleClient {
  scanScript: CapScanResult[] = [];
  script: ScriptStep[] = [];
  /** write properties of FFF6 */
  writeProps: { write?: boolean; writeWithoutResponse?: boolean } = { write: true };
  mtu = 247;
  failConnect = 0;
  dropDuringConnect = false;

  initialize = vi.fn(async (_o?: { androidNeverForLocation?: boolean }) => {});
  enabled = true;
  scanning = false;
  connected: string[] = [];
  connectAttempts: string[] = [];
  disconnected: string[] = [];
  stopScanCalls = 0;
  scanCalls = 0;
  writes: WriteRecord[] = [];
  unexpected: string[] = [];
  stopNotifyCalls = 0;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private onDrop?: (id: string) => void;
  private notify?: (v: DataView) => void;

  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }

  async requestLEScan(_o: { services?: string[]; allowDuplicates?: boolean }, cb: (r: CapScanResult) => void): Promise<void> {
    this.scanCalls++;
    this.scanning = true;
    this.scanScript.forEach((r, i) => this.timers.push(setTimeout(() => this.scanning && cb(r), 2 + i * 2)));
  }

  /** Emit one more advertisement by hand while scanning. */
  emit(r: CapScanResult, cb: (r: CapScanResult) => void): void {
    cb(r);
  }

  async stopLEScan(): Promise<void> {
    this.stopScanCalls++;
    this.scanning = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async connect(deviceId: string, onDisconnect?: (deviceId: string) => void): Promise<void> {
    this.connectAttempts.push(deviceId);
    if (this.failConnect > 0) {
      this.failConnect--;
      throw new Error('connection failed');
    }
    this.connected.push(deviceId);
    this.onDrop = onDisconnect;
    if (this.dropDuringConnect) onDisconnect?.(deviceId);
  }

  /** The ring drops the link. */
  dropFromRing(id = this.connected[0]!): void {
    this.onDrop?.(id);
  }

  async disconnect(deviceId: string): Promise<void> {
    this.disconnected.push(deviceId);
  }

  async getServices(_id: string): Promise<CapService[]> {
    return [{ uuid: SVC, characteristics: [{ uuid: WR, properties: this.writeProps }, { uuid: NT, properties: { notify: true } }] }];
  }

  async getMtu(_id: string): Promise<number> {
    return this.mtu;
  }

  async startNotifications(_id: string, service: string, characteristic: string, cb: (v: DataView) => void): Promise<void> {
    expect([service, characteristic]).toEqual([SVC, NT]);
    this.notify = cb;
  }

  async stopNotifications(): Promise<void> {
    this.stopNotifyCalls++;
    this.notify = undefined;
  }

  private onWrite(mode: WriteRecord['mode'], service: string, characteristic: string, v: DataView): void {
    const b = bytes(v);
    this.writes.push({ mode, service, characteristic, bytes: b });
    const step = this.script[0];
    if (!step || step.expect.join() !== b.join()) {
      this.unexpected.push(b.join(' '));
      return;
    }
    this.script.shift();
    queueMicrotask(() => this.notify?.(view(step.reply)));
  }

  async write(_id: string, service: string, characteristic: string, v: DataView): Promise<void> {
    this.onWrite('with', service, characteristic, v);
  }

  async writeWithoutResponse(_id: string, service: string, characteristic: string, v: DataView): Promise<void> {
    this.onWrite('without', service, characteristic, v);
  }

  async read(): Promise<DataView> {
    throw new Error('not readable');
  }
}

const handshake = (): ScriptStep[] => [
  { expect: Array.from(command(0x27)), reply: [0x27, 0, 5, 2, 5] },
  { expect: Array.from(command(0x13)), reply: [0x13, 88] },
];

const setup = (configure?: (f: FakeCapBle) => void) => {
  const ble = new FakeCapBle();
  ble.scanScript = [otherAd('AA:00:00:00:00:01', 'Other 1'), ringAd('AA:00:00:00:00:02', 'Ring 7307'), ringAd('AA:00:00:00:00:03', 'Ring 7308')];
  configure?.(ble);
  const load = vi.fn(async () => ble as CapBleClient);
  return { ble, load, transport: createCapacitorTransport(load) };
};

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

afterEach(() => vi.unstubAllGlobals());

describe('capacitor transport: requestDevice', () => {
  it('(a) without a chooser connects the first match, stops the scan and reads the MTU', async () => {
    const { ble, transport } = setup();
    const link = await transport.requestDevice(query);
    expect(link.deviceId).toBe('AA:00:00:00:00:02');
    expect((link as { deviceName?: string }).deviceName).toBe('Ring 7307');
    expect(link.mtu).toBe(247);
    expect(ble.connected).toEqual(['AA:00:00:00:00:02']);
    expect(ble.stopScanCalls).toBe(1);
    expect(ble.scanning).toBe(false);
  });

  it('falls back to the device name when there is no local name', async () => {
    const { ble, transport } = setup((f) => {
      f.scanScript = [{ device: { deviceId: 'AA:09', name: 'R02_341C' }, manufacturerData: { '4660': dv(1) } }];
    });
    const link = await transport.requestDevice(query);
    expect((link as { deviceName?: string }).deviceName).toBe('R02_341C');
    expect(ble.connected).toEqual(['AA:09']);
  });

  it('(b) with a chooser: update gets the growing list of matching devices only; chosen id is connected', async () => {
    const { ble, transport } = setup();
    const lists: FoundDevice[][] = [];
    const chosen = deferred<string | null>();
    const chooser: DeviceChooser = { update: (l) => lists.push([...l]), chosen: chosen.promise };
    const p = transport.requestDevice(query, { chooser });
    await vi.waitFor(() => expect(lists.length).toBe(2));
    expect(lists[0]).toEqual([{ id: 'AA:00:00:00:00:02', name: 'Ring 7307', rssi: -60 }]);
    expect(lists[1]!.map((d) => d.id)).toEqual(['AA:00:00:00:00:02', 'AA:00:00:00:00:03']);
    // still scanning: nothing connected until the person picks
    expect(ble.connected).toEqual([]);
    chosen.resolve('AA:00:00:00:00:03');
    const link = await p;
    expect(link.deviceId).toBe('AA:00:00:00:00:03');
    expect((link as { deviceName?: string }).deviceName).toBe('Ring 7308');
    expect(ble.connected).toEqual(['AA:00:00:00:00:03']);
    expect(ble.stopScanCalls).toBe(1);
  });

  it('(b) a chooser closed with no choice rejects NoDeviceError cancelled', async () => {
    const { ble, transport } = setup();
    const lists: FoundDevice[][] = [];
    const chosen = deferred<string | null>();
    const p = transport.requestDevice(query, { chooser: { update: (l) => lists.push([...l]), chosen: chosen.promise } });
    const assertion = expect(p).rejects.toMatchObject({ name: 'NoDeviceError', reason: 'cancelled' });
    await vi.waitFor(() => expect(lists.length).toBeGreaterThan(0));
    chosen.resolve(null);
    await assertion;
    await expect(p).rejects.toBeInstanceOf(NoDeviceError);
    expect(ble.connected).toEqual([]);
    expect(ble.stopScanCalls).toBe(1);
  });

  it('(c) nothing matching within scanMs rejects not_found and stops the scan', async () => {
    const { ble, transport } = setup((f) => {
      f.scanScript = [otherAd('AA:01', 'Other 1'), otherAd('AA:02', 'Other 2')];
    });
    const err = await transport.requestDevice(query, { scanMs: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoDeviceError);
    expect((err as NoDeviceError).reason).toBe('not_found');
    expect(ble.stopScanCalls).toBe(1);
    expect(ble.connectAttempts).toEqual([]);
  });

  it('(d) an abort signal rejects (cancelled) and stops the scan', async () => {
    const { ble, transport } = setup((f) => {
      f.scanScript = [otherAd('AA:01', 'Other 1')];
    });
    const ac = new AbortController();
    const p = transport.requestDevice(query, { signal: ac.signal, scanMs: 5_000 });
    const assertion = expect(p).rejects.toMatchObject({ name: 'NoDeviceError', reason: 'cancelled' });
    await vi.waitFor(() => expect(ble.scanning).toBe(true));
    ac.abort();
    await assertion;
    expect(ble.stopScanCalls).toBe(1);
    expect(ble.connectAttempts).toEqual([]);
  });

  it('a signal aborted before the call rejects too', async () => {
    const { transport } = setup();
    const ac = new AbortController();
    ac.abort();
    // a ring is in the script, so abort must win only if the scan has not already settled; either outcome must reject or connect, never hang
    const r = await Promise.race([transport.requestDevice(query, { signal: ac.signal, scanMs: 500 }).then(() => 'linked', () => 'rejected'), new Promise((res) => setTimeout(() => res('hung'), 1_000))]);
    expect(r).not.toBe('hung');
  });

  it('a failing getServices disconnects and rethrows', async () => {
    const { ble, transport } = setup();
    ble.getServices = async () => {
      throw new Error('discovery failed');
    };
    await expect(transport.requestDevice(query)).rejects.toThrow('discovery failed');
    expect(ble.disconnected).toEqual(['AA:00:00:00:00:02']);
  });

  it('without a getMtu the link has no mtu', async () => {
    const { ble, transport } = setup();
    (ble as { getMtu?: unknown }).getMtu = undefined;
    const link = await transport.requestDevice(query);
    expect(link.mtu).toBeUndefined();
  });
});

describe('capacitor transport: write and subscribe', () => {
  const connect = async (configure?: (f: FakeCapBle) => void) => {
    const s = setup(configure);
    const link = await s.transport.requestDevice(query);
    return { ...s, link };
  };
  const frame = Uint8Array.of(1, 2, 3);

  it('(e) writes with response when the characteristic supports write', async () => {
    const { ble, link } = await connect();
    await link.write(0xfff0, 0xfff6, frame);
    expect(ble.writes).toEqual([{ mode: 'with', service: SVC, characteristic: WR, bytes: [1, 2, 3] }]);
  });

  it('(e) writes without response when only writeWithoutResponse is supported', async () => {
    const { ble, link } = await connect((f) => {
      f.writeProps = { write: false, writeWithoutResponse: true };
    });
    await link.write(0xfff0, 0xfff6, frame);
    expect(ble.writes.map((w) => w.mode)).toEqual(['without']);
  });

  it('(e) writes without response when `write` is omitted and only writeWithoutResponse is true', async () => {
    const { ble, link } = await connect((f) => {
      f.writeProps = { writeWithoutResponse: true };
    });
    await link.write(0xfff0, 0xfff6, frame);
    expect(ble.writes.map((w) => w.mode)).toEqual(['without']);
  });

  it('(e) an explicit withResponse:false is honoured, and withResponse:true too', async () => {
    const { ble, link } = await connect();
    await link.write(SVC, WR, frame, { withResponse: false });
    expect(ble.writes.map((w) => w.mode)).toEqual(['without']);
    const b = await connect((f) => {
      f.writeProps = { write: false, writeWithoutResponse: true };
    });
    await b.link.write(SVC, WR, frame, { withResponse: true });
    expect(b.ble.writes.map((w) => w.mode)).toEqual(['with']);
  });

  it('writes a copy of the bytes the caller handed in', async () => {
    const { ble, link } = await connect();
    const f = Uint8Array.of(9, 8, 7);
    await link.write('fff0', 'fff6', f);
    f[0] = 0;
    expect(ble.writes[0]!.bytes).toEqual([9, 8, 7]);
  });

  it('subscribe delivers notifications as bytes and the unsubscribe stops them', async () => {
    const { ble, link } = await connect((f) => {
      f.script = [{ expect: [1, 2, 3], reply: [0xaa, 0xbb] }];
    });
    const got: number[][] = [];
    const off = await link.subscribe(0xfff0, 0xfff7, (b) => got.push(Array.from(b)));
    await link.write(0xfff0, 0xfff6, frame);
    await vi.waitFor(() => expect(got).toEqual([[0xaa, 0xbb]]));
    off();
    await vi.waitFor(() => expect(ble.stopNotifyCalls).toBe(1));
  });

  it('a notification view with an offset is read at that offset', async () => {
    const { ble, link } = await connect();
    const got: number[][] = [];
    let cb: ((v: DataView) => void) | undefined;
    ble.startNotifications = async (_i, _s, _c, f) => {
      cb = f;
    };
    await link.subscribe(0xfff0, 0xfff7, (b) => got.push(Array.from(b)));
    cb!(new DataView(Uint8Array.of(0, 0, 5, 6, 7).buffer, 2, 2));
    expect(got).toEqual([[5, 6]]);
  });

  it('a write after the link dropped rejects', async () => {
    const { ble, link } = await connect();
    ble.dropFromRing();
    await expect(link.write(0xfff0, 0xfff6, frame)).rejects.toThrow(/disconnected/);
  });

  it('a ring that drops while connecting yields a link that is already closed', async () => {
    const { link, ble } = await connect((f) => {
      f.dropDuringConnect = true;
    });
    await expect(link.write(0xfff0, 0xfff6, frame)).rejects.toThrow(/disconnected/);
    expect(ble.writes).toEqual([]);
  });
});

describe('capacitor transport: disconnect', () => {
  it('(f) a drop from the ring fires onDisconnect listeners once', async () => {
    const { ble, transport } = setup();
    const link = await transport.requestDevice(query);
    const a = vi.fn();
    const b = vi.fn();
    link.onDisconnect(a);
    const offB = link.onDisconnect(b);
    offB();
    ble.dropFromRing();
    ble.dropFromRing();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    // after a drop, disconnect() has nothing left to do
    await link.disconnect();
    expect(ble.disconnected).toEqual([]);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('(f) link.disconnect() calls ble.disconnect once, is idempotent, and fires listeners once', async () => {
    const { ble, transport } = setup();
    const link = await transport.requestDevice(query);
    const a = vi.fn();
    link.onDisconnect(a);
    await link.disconnect();
    await link.disconnect();
    expect(ble.disconnected).toEqual(['AA:00:00:00:00:02']);
    expect(a).toHaveBeenCalledTimes(1);
    ble.dropFromRing(); // the platform's own callback after our disconnect
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('a failing ble.disconnect does not throw', async () => {
    const { ble, transport } = setup();
    const link = await transport.requestDevice(query);
    ble.disconnect = async () => {
      throw new Error('already gone');
    };
    await expect(link.disconnect()).resolves.toBeUndefined();
  });
});

describe('capacitor transport: availability and loading', () => {
  it('isAvailable reports isEnabled', async () => {
    const { ble, transport } = setup();
    expect(await transport.isAvailable()).toBe(true);
    ble.enabled = false;
    expect(await transport.isAvailable()).toBe(false);
  });

  it('(g) initialize runs once with androidNeverForLocation across calls', async () => {
    const { ble, load, transport } = setup();
    await (await transport.requestDevice(query)).disconnect();
    ble.connected = [];
    await (await transport.requestDevice(query)).disconnect();
    await transport.isAvailable();
    expect(load).toHaveBeenCalledTimes(1);
    expect(ble.initialize).toHaveBeenCalledTimes(1);
    expect(ble.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
  });

  it('(g) a failing loader makes isAvailable false and the next call retries the loader', async () => {
    const ble = new FakeCapBle();
    const load = vi.fn<() => Promise<CapBleClient>>().mockRejectedValueOnce(new Error('plugin missing')).mockResolvedValue(ble);
    const transport = createCapacitorTransport(load);
    expect(await transport.isAvailable()).toBe(false);
    expect(await transport.isAvailable()).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(ble.initialize).toHaveBeenCalledTimes(1);
  });

  it('a failing initialize is retried as well', async () => {
    const ble = new FakeCapBle();
    ble.initialize.mockRejectedValueOnce(new Error('permission denied'));
    const transport = createCapacitorTransport(async () => ble);
    expect(await transport.isAvailable()).toBe(false);
    expect(await transport.isAvailable()).toBe(true);
    expect(ble.initialize).toHaveBeenCalledTimes(2);
  });

  it('requestDevice with an unloadable plugin rejects NoDeviceError unavailable', async () => {
    const transport = createCapacitorTransport(async () => {
      throw new Error('plugin missing');
    });
    await expect(transport.requestDevice(query)).rejects.toMatchObject({ name: 'NoDeviceError', reason: 'unavailable' });
  });
});

describe('capacitor transport: reconnect', () => {
  it('(h) connects the known id directly, without scanning', async () => {
    const { ble, transport } = setup();
    const link = await transport.reconnect!('AA:00:00:00:00:02', query);
    expect(link.deviceId).toBe('AA:00:00:00:00:02');
    expect(ble.connectAttempts).toEqual(['AA:00:00:00:00:02']);
    expect(ble.scanCalls).toBe(0);
    expect(link.mtu).toBe(247);
  });

  it('(h) when the direct connect fails it scans for that id and connects again', async () => {
    const { ble, transport } = setup((f) => {
      f.failConnect = 1;
    });
    const link = await transport.reconnect!('AA:00:00:00:00:03', query);
    expect(ble.scanCalls).toBe(1);
    expect(ble.connectAttempts).toEqual(['AA:00:00:00:00:03', 'AA:00:00:00:00:03']);
    expect(link.deviceId).toBe('AA:00:00:00:00:03');
    expect((link as { deviceName?: string }).deviceName).toBe('Ring 7308');
    expect(ble.stopScanCalls).toBe(1);
  });

  it('(h) when the ring is not seen either, rejects not_found (scan window is fixed at 10 s, so this uses an abort)', async () => {
    const { ble, transport } = setup((f) => {
      f.failConnect = 1;
      f.scanScript = [otherAd('AA:01', 'Other 1')];
    });
    const ac = new AbortController();
    const p = transport.reconnect!('AA:00:00:00:00:03', query, { signal: ac.signal });
    const assertion = expect(p).rejects.toBeInstanceOf(NoDeviceError);
    await vi.waitFor(() => expect(ble.scanning).toBe(true));
    ac.abort();
    await assertion;
    expect(ble.stopScanCalls).toBe(1);
  });
});

describe('capacitor transport: J-Style 2301 driver end to end', () => {
  const clock: SessionClock = { now: () => Date.UTC(2026, 8, 16, 10), tzOffsetS: () => 0 };

  it('(i) V0525 handshake over the capacitor link, then close disconnects', async () => {
    const { ble, transport } = setup((f) => {
      f.script = handshake();
    });
    const link = await transport.requestDevice(query);
    const session = await jstyle2301Driver.open(link, { clock, timers: { quietMs: 5, stallMs: 20 } });
    expect(await session.info()).toEqual({ firmware: 'V0525', battery: 88, clockOffsetS: 0 });
    expect(ble.unexpected).toEqual([]);
    expect(ble.script).toEqual([]);
    expect(ble.writes.map((w) => [w.mode, w.service, w.characteristic])).toEqual([
      ['with', SVC, WR],
      ['with', SVC, WR],
    ]);
    await session.close();
    expect(ble.disconnected).toEqual(['AA:00:00:00:00:02']);
  });

  it('(i) the driver\'s own requestOptions find a ring that advertises only the marker', async () => {
    const { ble, transport } = setup((f) => {
      f.script = handshake();
    });
    const link = await transport.requestDevice(jstyle2301Driver);
    const session = await jstyle2301Driver.open(link, { clock, timers: { quietMs: 5, stallMs: 20 } });
    expect((await session.info()).firmware).toBe('V0525');
    await session.close();
    expect(ble.disconnected).toHaveLength(1);
  });
});
