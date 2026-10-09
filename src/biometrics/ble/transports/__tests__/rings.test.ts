import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachBluetooth, type ElectronBluetoothDevice, type IpcMainLike, type WebContentsLike } from '../../../../../apps/desktop/src/ble/main';
import { bluetoothBridge, type IpcRendererLike } from '../../../../../apps/desktop/src/ble/preload';
import type { Advertisement, RingFamily, Transport, TransportEvent } from '../../../../../packages/rings/src/types';
import { uuid16 } from '../../../../../packages/rings/src/types';
import { SCAN_MODE_LOW_LATENCY, createCapacitorTransport, type CapBleClient, type CapScanResult, type CapService } from '../capacitor';
import { createElectronTransport } from '../electron';
import { CHOOSER_WINDOW_MS, DESKTOP_SCAN_MS, capacitorAdvertisement, capacitorFactory, chooserFactory, familiesQuery, linkTransport, onAirBlocks, type ChooserAdvertisement } from '../rings';
import type { BleTransport, DeviceChooser, FoundDevice, RequestOptions, RingLink } from '../types';
import { NoDeviceError, queryOf } from '../types';

const SVC = uuid16(0xfff0);
const WR = uuid16(0xfff6);
const NT = uuid16(0xfff7);

const dv = (...b: number[]): DataView => new DataView(Uint8Array.from(b).buffer);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A small `RingLink`: records writes, lets a test push notifications and drop the link. */
class FakeLink implements RingLink {
  deviceId?: string;
  deviceName?: string;
  mtu?: number;
  readable = true;
  writes: Array<{ s: unknown; c: unknown; bytes: number[]; opts?: { withResponse?: boolean } }> = [];
  subs = new Map<string, (b: Uint8Array) => void>();
  unsubscribed: string[] = [];
  drops = new Set<() => void>();
  disconnects = 0;
  /** true: `disconnect()` itself raises the drop callbacks (as the Capacitor and Web links do). */
  dropOnDisconnect = false;

  constructor(init: { id?: string; name?: string; mtu?: number } = {}) {
    this.deviceId = init.id;
    this.deviceName = init.name;
    this.mtu = init.mtu;
    // `read` exists only when readable (the `RingLink` contract makes it optional)
    Object.defineProperty(this, 'read', {
      get: () => (this.readable ? async () => Uint8Array.of(9, 8, 7) : undefined),
    });
  }

  declare read?: (s: unknown, c: unknown) => Promise<Uint8Array>;

  async write(s: string | number, c: string | number, bytes: Uint8Array, opts?: { withResponse?: boolean }): Promise<void> {
    this.writes.push({ s, c, bytes: Array.from(bytes), ...(opts ? { opts } : {}) });
  }
  async subscribe(s: string | number, c: string | number, cb: (b: Uint8Array) => void): Promise<() => void> {
    const key = `${String(s)}/${String(c)}`;
    this.subs.set(key, cb);
    return () => {
      this.unsubscribed.push(key);
      this.subs.delete(key);
    };
  }
  onDisconnect(cb: () => void): () => void {
    this.drops.add(cb);
    return () => this.drops.delete(cb);
  }
  async disconnect(): Promise<void> {
    this.disconnects++;
    if (this.dropOnDisconnect) this.drop();
  }
  /** The ring drops the link. */
  drop(): void {
    for (const l of [...this.drops]) l();
  }
}

const events = (t: Transport): TransportEvent[] => {
  const got: TransportEvent[] = [];
  t.on((e) => got.push(e));
  return got;
};

describe('linkTransport', () => {
  it('reports the peripheral from the link and the extra address, leaving out what is unknown', () => {
    expect(linkTransport(new FakeLink({ id: 'AA', name: 'Ring A' }), { address: 'AA:BB' }).peripheral).toEqual({ id: 'AA', name: 'Ring A', address: 'AA:BB' });
    expect(linkTransport(new FakeLink({ id: 'AA' })).peripheral).toEqual({ id: 'AA' });
    expect(linkTransport(new FakeLink()).peripheral).toEqual({});
  });

  it('passes the mtu through, live', () => {
    const link = new FakeLink({ mtu: 23 });
    const t = linkTransport(link);
    expect(t.mtu).toBe(23);
    link.mtu = 247;
    expect(t.mtu).toBe(247);
    expect(linkTransport(new FakeLink()).mtu).toBeUndefined();
  });

  it('maps the write mode onto withResponse and passes the bytes and ids as given', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    await t.write(SVC, WR, Uint8Array.of(1, 2), 'withoutResponse');
    await t.write(SVC, WR, Uint8Array.of(3), 'withResponse');
    expect(link.writes).toEqual([
      { s: SVC, c: WR, bytes: [1, 2], opts: { withResponse: false } },
      { s: SVC, c: WR, bytes: [3], opts: { withResponse: true } },
    ]);
  });

  it('reads through the link, and throws when the link cannot read', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    expect(Array.from(await t.read(SVC, NT))).toEqual([9, 8, 7]);
    link.readable = false;
    await expect(t.read(SVC, NT)).rejects.toThrow(/cannot read/);
  });

  it('emits notifications with expanded lower-case ids, whatever spelling subscribe was given', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    const got = events(t);
    await t.subscribe(0xfff0 as unknown as string, 0xfff7 as unknown as string, 'notify');
    link.subs.get(`${0xfff0}/${0xfff7}`)!(Uint8Array.of(1));
    await t.subscribe('FFF0', 'FFF7', 'notify');
    link.subs.get('FFF0/FFF7')!(Uint8Array.of(2));
    await t.subscribe('0000FFF0-0000-1000-8000-00805F9B34FB', '0000FFF7-0000-1000-8000-00805F9B34FB', 'indicate');
    link.subs.get('0000FFF0-0000-1000-8000-00805F9B34FB/0000FFF7-0000-1000-8000-00805F9B34FB')!(Uint8Array.of(3));
    expect(got).toEqual([
      { type: 'notification', service: SVC, characteristic: NT, bytes: Uint8Array.of(1) },
      { type: 'notification', service: SVC, characteristic: NT, bytes: Uint8Array.of(2) },
      { type: 'notification', service: SVC, characteristic: NT, bytes: Uint8Array.of(3) },
    ]);
  });

  it('hands every listener its own copy of the notification bytes', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    const got = events(t);
    await t.subscribe(SVC, NT, 'notify');
    const raw = Uint8Array.of(5, 6, 7);
    link.subs.get(`${SVC}/${NT}`)!(raw);
    raw.fill(0); // the platform reuses its buffer
    const ev = got[0] as Extract<TransportEvent, { type: 'notification' }>;
    expect(Array.from(ev.bytes)).toEqual([5, 6, 7]);
    expect(ev.bytes.buffer).not.toBe(raw.buffer);
  });

  it('unsubscribes, and removed listeners hear nothing more', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    const got: TransportEvent[] = [];
    const off = t.on((e) => got.push(e));
    const unsub = await t.subscribe(SVC, NT, 'notify');
    const cb = link.subs.get(`${SVC}/${NT}`)!;
    cb(Uint8Array.of(1));
    off();
    cb(Uint8Array.of(2));
    expect(got).toHaveLength(1);
    await unsub();
    expect(link.unsubscribed).toEqual([`${SVC}/${NT}`]);
    expect(link.subs.size).toBe(0);
  });

  it('a link drop is exactly one disconnected event, however often the link repeats it', () => {
    const link = new FakeLink();
    const got = events(linkTransport(link));
    link.drop();
    link.drop();
    expect(got).toEqual([{ type: 'disconnected' }]);
  });

  it('disconnect() emits one disconnected with reason closed, and the link dropping later adds nothing', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    const got = events(t);
    await t.disconnect();
    expect(link.disconnects).toBe(1);
    link.drop();
    expect(link.drops.size).toBe(0);
    expect(got).toEqual([{ type: 'disconnected', reason: 'closed' }]);
  });

  it('disconnect() after a drop adds no second event', async () => {
    const link = new FakeLink();
    const t = linkTransport(link);
    const got = events(t);
    link.drop();
    await t.disconnect();
    expect(got).toEqual([{ type: 'disconnected' }]);
  });

  it('disconnect() on a link that raises its own drop callbacks still yields exactly one event', async () => {
    const link = new FakeLink();
    link.dropOnDisconnect = true;
    const t = linkTransport(link);
    const got = events(t);
    await t.disconnect();
    expect(got).toEqual([{ type: 'disconnected', reason: 'closed' }]);
  });

  it('services is present only when given', async () => {
    expect(linkTransport(new FakeLink()).services).toBeUndefined();
    expect('services' in linkTransport(new FakeLink(), { address: 'AA' })).toBe(false);
    const t = linkTransport(new FakeLink(), { services: async () => [SVC] });
    expect(await t.services!()).toEqual([SVC]);
  });
});

const fam = (id: string, o: { filters: unknown[]; optional: string[]; service: string }): RingFamily =>
  ({ id, scan: { requestFilters: o.filters, optionalServices: o.optional }, gatt: { service: o.service } }) as unknown as RingFamily;

const famA = fam('jstyle2301', { filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optional: [SVC, uuid16(0x180f)], service: SVC });
const famB = fam('colmi', { filters: [{ namePrefix: 'R02_' }, { services: [uuid16(0xfe59)] }], optional: [uuid16(0x180f), uuid16(0xfe59)], service: uuid16(0x6e40) });

describe('familiesQuery', () => {
  it('unions the filters in family order', () => {
    expect(queryOf(familiesQuery([famA, famB])).filters).toEqual([
      { manufacturerData: [{ companyIdentifier: 0x1234 }] },
      { namePrefix: 'R02_' },
      { services: [uuid16(0xfe59)] },
    ]);
  });

  it('dedupes the optional services and adds each family gatt service', () => {
    expect(queryOf(familiesQuery([famA, famB])).optionalServices).toEqual([SVC, uuid16(0x180f), uuid16(0xfe59), uuid16(0x6e40)]);
  });

  it('one family: its optional services plus its gatt service once', () => {
    const f = fam('crp', { filters: [], optional: [uuid16(0xfff0)], service: uuid16(0xfff0) });
    expect(familiesQuery([f])).toEqual({ filters: [], optionalServices: [uuid16(0xfff0)] });
  });

  it('no families: nothing to ask for', () => {
    expect(familiesQuery([])).toEqual({ filters: [], optionalServices: [] });
  });
});

describe('onAirBlocks', () => {
  it('re-attaches the company id, little endian, in front of the vendor bytes', () => {
    expect(onAirBlocks({ '4660': dv(0x23, 0x01) })).toEqual([Uint8Array.of(0x34, 0x12, 0x23, 0x01)]);
  });

  it('reads a DataView that is a window on a larger buffer', () => {
    const big = Uint8Array.of(0xff, 0xff, 0x23, 0x01, 0xee);
    expect(onAirBlocks({ '4660': new DataView(big.buffer, 2, 2) })).toEqual([Uint8Array.of(0x34, 0x12, 0x23, 0x01)]);
  });

  it('handles several blocks, an empty body and no data at all', () => {
    expect(onAirBlocks({ '1': dv(), '22136': dv(1, 2) })).toEqual([Uint8Array.of(1, 0), Uint8Array.of(0x78, 0x56, 1, 2)]);
    expect(onAirBlocks(undefined)).toEqual([]);
    expect(onAirBlocks({})).toEqual([]);
  });
});

describe('capacitorAdvertisement', () => {
  it('takes the local name first, normalises uuids and carries the platform id and rssi', () => {
    const ad = capacitorAdvertisement({
      device: { deviceId: 'AA:BB', name: 'Device Name' },
      localName: 'Ring A',
      rssi: -61,
      uuids: ['FFF0', '0000FFF7-0000-1000-8000-00805F9B34FB'],
      manufacturerData: { '4660': dv(0x23, 0x01) },
    });
    expect(ad).toEqual({
      name: 'Ring A',
      serviceUuids: [SVC, NT],
      manufacturerData: [Uint8Array.of(0x34, 0x12, 0x23, 0x01)],
      platformId: 'AA:BB',
      rssi: -61,
    });
  });

  it('falls back to the device name; leaves name and rssi out when unknown', () => {
    expect(capacitorAdvertisement({ device: { deviceId: 'AA', name: 'Ring B' } })).toEqual({ name: 'Ring B', serviceUuids: [], manufacturerData: [], platformId: 'AA' });
    const bare = capacitorAdvertisement({ device: { deviceId: 'AA' } });
    expect(bare).toEqual({ serviceUuids: [], manufacturerData: [], platformId: 'AA' });
    expect('name' in bare).toBe(false);
    expect('rssi' in bare).toBe(false);
  });

  it('keeps an rssi of 0', () => {
    expect(capacitorAdvertisement({ device: { deviceId: 'AA' }, rssi: 0 }).rssi).toBe(0);
  });
});

/** The slice of the Capacitor plugin the factory touches. */
class FakeCapBle implements CapBleClient {
  scanCb?: (r: CapScanResult) => void;
  scanning = false;
  scanCalls = 0;
  stopCalls = 0;
  connectAttempts: string[] = [];
  disconnected: string[] = [];
  serviceCalls: string[] = [];
  initialize = vi.fn(async () => {});
  services: CapService[] = [
    { uuid: 'FFF0', characteristics: [{ uuid: 'FFF6', properties: { write: true } }] },
    { uuid: SVC.toUpperCase(), characteristics: [] },
    { uuid: '180F', characteristics: [] },
  ];
  async isEnabled(): Promise<boolean> {
    return true;
  }
  scanOpts: unknown[] = [];
  async requestLEScan(o: unknown, cb: (r: CapScanResult) => void): Promise<void> {
    this.scanCalls++;
    this.scanOpts.push(o);
    this.scanning = true;
    this.scanCb = cb;
  }
  async stopLEScan(): Promise<void> {
    this.stopCalls++;
    this.scanning = false;
  }
  async connect(id: string): Promise<void> {
    this.connectAttempts.push(id);
  }
  async disconnect(id: string): Promise<void> {
    this.disconnected.push(id);
  }
  async getServices(id: string): Promise<CapService[]> {
    this.serviceCalls.push(id);
    return this.services;
  }
  async getMtu(): Promise<number> {
    return 185;
  }
  async startNotifications(): Promise<void> {}
  async stopNotifications(): Promise<void> {}
  async write(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async read(): Promise<DataView> {
    return dv(1);
  }
}

describe('capacitorFactory', () => {
  const setup = () => {
    const ble = new FakeCapBle();
    const load = vi.fn(async () => ble);
    const transport = createCapacitorTransport(async () => ble);
    return { ble, load, transport, factory: capacitorFactory(load, transport) };
  };

  it('is the capacitor platform and asks the transport whether Bluetooth is available', async () => {
    const { factory } = setup();
    expect(factory.platform).toBe('capacitor');
    expect(await factory.available()).toBe(true);
  });

  it('scan streams every advertisement until the signal aborts, then stops the scan', async () => {
    const { ble, factory } = setup();
    const ctl = new AbortController();
    const found: Advertisement[] = [];
    let ended = false;
    const done = factory.scan([famA], (ad) => found.push(ad), ctl.signal).then(() => (ended = true));
    await sleep(5);
    expect(ble.scanning).toBe(true);
    ble.scanCb!({ device: { deviceId: 'AA' }, localName: 'Ring A', manufacturerData: { '4660': dv(0x23, 0x01) } });
    ble.scanCb!({ device: { deviceId: 'BB', name: 'Other' }, rssi: -80 }); // not a ring: still streamed, matching is the service's job
    ble.scanCb!({ device: { deviceId: 'AA' }, localName: 'Ring A' });
    await sleep(5);
    expect(ended).toBe(false);
    expect(ble.stopCalls).toBe(0);
    ctl.abort();
    await done;
    expect(ble.scanning).toBe(false);
    expect(ble.stopCalls).toBe(1);
    expect(found.map((a) => a.platformId)).toEqual(['AA', 'BB', 'AA']);
    expect(found[0]).toMatchObject({ name: 'Ring A', manufacturerData: [Uint8Array.of(0x34, 0x12, 0x23, 0x01)] });
  });

  it('scan with a signal that is already aborted starts, then stops straight away', async () => {
    const { ble, factory } = setup();
    await factory.scan([famA], () => {}, AbortSignal.abort());
    expect(ble.scanCalls).toBe(1);
    expect(ble.stopCalls).toBe(1);
  });

  it('the pairing scan asks Android for low latency (an idle J-Style 2301 advertises every 20–40 s)', async () => {
    const { ble, factory } = setup();
    await factory.scan([famA], () => {}, AbortSignal.abort());
    expect(ble.scanOpts).toEqual([{ allowDuplicates: false, scanMode: SCAN_MODE_LOW_LATENCY }]);
  });

  it('connect connects that id directly and lists the connected device services, expanded', async () => {
    const { ble, factory } = setup();
    const t = await factory.connect({ platformId: 'AA:BB:CC:DD:EE:01' }, famA);
    expect(ble.connectAttempts).toEqual(['AA:BB:CC:DD:EE:01']);
    expect(ble.scanCalls).toBe(0);
    expect(t.peripheral.address).toBe('AA:BB:CC:DD:EE:01');
    expect(t.peripheral.id).toBe('AA:BB:CC:DD:EE:01');
    expect(t.mtu).toBe(185);
    expect(await t.services!()).toEqual([SVC, SVC, uuid16(0x180f)]);
    expect(ble.serviceCalls).toContain('AA:BB:CC:DD:EE:01');
  });

  it('the connected transport reports one disconnected when the transport closes it', async () => {
    const { ble, factory } = setup();
    const t = await factory.connect({ platformId: 'AA' }, famA);
    const got = events(t);
    await t.disconnect();
    expect(ble.disconnected).toEqual(['AA']);
    expect(got).toHaveLength(1);
    expect(got[0]?.type).toBe('disconnected');
  });
});

describe('chooserFactory, web', () => {
  const web = (link: FakeLink | Error) => {
    const requestDevice = vi.fn(async (_q: unknown, _o?: RequestOptions) => {
      if (link instanceof Error) throw link;
      return link;
    });
    const reconnect = vi.fn(async () => new FakeLink({ id: 'again' }));
    const transport: BleTransport = { kind: 'web', isAvailable: async () => true, requestDevice, reconnect };
    return { requestDevice, reconnect, transport };
  };

  it('is the web-bluetooth platform and asks the transport whether Bluetooth is available', async () => {
    const f = chooserFactory({ kind: 'web', isAvailable: async () => false, requestDevice: async () => new FakeLink() }, 'web-bluetooth');
    expect(f.platform).toBe('web-bluetooth');
    expect(await f.available()).toBe(false);
  });

  it('scan reports the chosen device without assigning a requested family, then resolves', async () => {
    const link = new FakeLink({ id: 'opaque-1', name: 'Ring A' });
    const { requestDevice, transport } = web(link);
    const f = chooserFactory(transport, 'web-bluetooth');
    const found: ChooserAdvertisement[] = [];
    await f.scan([famA, famB], (ad) => found.push(ad), new AbortController().signal);
    expect(found).toEqual([{ name: 'Ring A', serviceUuids: [], manufacturerData: [], platformId: 'opaque-1', needsDiscovery: true, nameOnly: true }]);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(queryOf(requestDevice.mock.calls[0]![0] as never).filters).toHaveLength(3);
    expect(requestDevice.mock.calls[0]![1]!.chooser).toBeUndefined();
  });

  it('scan leaves the name out when the link has none', async () => {
    const { transport } = web(new FakeLink({ id: 'opaque-1' }));
    const found: ChooserAdvertisement[] = [];
    await chooserFactory(transport, 'web-bluetooth').scan([famA], (ad) => found.push(ad), new AbortController().signal);
    expect('name' in found[0]!).toBe(false);
  });

  it('connect hands over the already-open link without a new request, once', async () => {
    const link = new FakeLink({ id: 'opaque-1', name: 'Ring A' });
    const { requestDevice, reconnect, transport } = web(link);
    const f = chooserFactory(transport, 'web-bluetooth');
    await f.scan([famA], () => {}, new AbortController().signal);
    const t = await f.connect({ platformId: 'opaque-1' }, famA);
    expect(t.peripheral).toEqual({ id: 'opaque-1', name: 'Ring A' });
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(reconnect).not.toHaveBeenCalled();
    // the link is not shared twice: a second connect for the same id falls back to reconnect
    const again = await f.connect({ platformId: 'opaque-1' }, famA);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(again.peripheral.id).toBe('again');
  });

  it('connect for an unknown id reconnects with that family query and the signal', async () => {
    const { reconnect, transport } = web(new FakeLink());
    const f = chooserFactory(transport, 'web-bluetooth');
    const ctl = new AbortController();
    await f.connect({ platformId: 'remembered' }, famB, ctl.signal);
    expect(reconnect).toHaveBeenCalledWith('remembered', familiesQuery([famB]), { signal: ctl.signal });
  });

  it('connect without reconnect support says to choose the ring again', async () => {
    const transport: BleTransport = { kind: 'web', isAvailable: async () => true, requestDevice: async () => new FakeLink() };
    await expect(chooserFactory(transport, 'web-bluetooth').connect({ platformId: 'x' }, famA)).rejects.toThrow(/choose the ring again/);
  });

  it('a cancelled chooser rejects scan with the transport error', async () => {
    const { transport } = web(new NoDeviceError('cancelled'));
    await expect(chooserFactory(transport, 'web-bluetooth').scan([famA], () => {}, new AbortController().signal)).rejects.toBeInstanceOf(NoDeviceError);
  });

  it('a link without an id is still connectable, under a made-up id the scan reported', async () => {
    const { transport } = web(new FakeLink({ name: 'Ring A' }));
    const f = chooserFactory(transport, 'web-bluetooth');
    const found: Advertisement[] = [];
    await f.scan([famA], (ad) => found.push(ad), new AbortController().signal);
    const t = await f.connect({ platformId: found[0]!.platformId! }, famA);
    expect(t.peripheral.name).toBe('Ring A');
  });
});

describe('chooserFactory, electron (with a fake transport)', () => {
  const ringA: FoundDevice = { id: 'E2:80:00:00:00:01', name: 'Ring A' };
  const ringB: FoundDevice = { id: 'E2:80:00:00:00:02', name: 'Ring B' };

  /** requestDevice lists growing device sets over a few ticks, then waits for the chooser's answer. */
  const electron = (lists: FoundDevice[][]) => {
    const state = { chosenWith: undefined as string | null | undefined, opened: 0, lastOpts: undefined as RequestOptions | undefined, rejected: false };
    const links = new Map<string, FakeLink>();
    const requestDevice = vi.fn(async (_q: unknown, opts: RequestOptions = {}): Promise<RingLink> => {
      state.opened++;
      state.lastOpts = opts;
      for (const l of lists) {
        opts.chooser?.update(l);
        await sleep(3);
      }
      const id = await opts.chooser!.chosen;
      state.chosenWith = id;
      if (id === null) {
        state.rejected = true;
        throw new NoDeviceError('cancelled');
      }
      const link = new FakeLink({ id });
      links.set(id, link);
      return link;
    });
    const reconnect = vi.fn(async (id: string) => new FakeLink({ id: `re:${id}` }));
    const transport: BleTransport = { kind: 'electron', isAvailable: async () => true, requestDevice, reconnect };
    return { state, links, requestDevice, reconnect, transport };
  };

  it('is the electron platform', async () => {
    const f = chooserFactory(electron([]).transport, 'electron');
    expect(f.platform).toBe('electron');
    expect(await f.available()).toBe(true);
  });

  it('scan reports each new device once, with the families asked for, while the request stays open', async () => {
    const { transport, state, requestDevice } = electron([[ringA], [ringA, ringB], [ringA, ringB]]);
    const f = chooserFactory(transport, 'electron');
    const ctl = new AbortController();
    const found: ChooserAdvertisement[] = [];
    let ended = false;
    const done = f.scan([famA, famB], (ad) => found.push(ad), ctl.signal).then(() => (ended = true));
    await sleep(30);
    expect(found).toEqual([
      { name: 'Ring A', serviceUuids: [], manufacturerData: [], platformId: ringA.id, needsDiscovery: true, nameOnly: true },
      { name: 'Ring B', serviceUuids: [], manufacturerData: [], platformId: ringB.id, needsDiscovery: true, nameOnly: true },
    ]);
    expect(ended).toBe(false);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(state.lastOpts?.scanMs).toBe(60_000);
    expect(state.lastOpts?.signal).toBe(ctl.signal);
    ctl.abort();
    await done;
  });

  it('connect while the scan is open answers the chooser and returns the link', async () => {
    const { transport, state, reconnect } = electron([[ringA], [ringA, ringB]]);
    const f = chooserFactory(transport, 'electron');
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(15);
    const t = await f.connect({ platformId: ringB.id }, famA);
    expect(state.chosenWith).toBe(ringB.id);
    expect(t.peripheral.id).toBe(ringB.id);
    expect(reconnect).not.toHaveBeenCalled();
    await scanned; // the open request finished with the pick, so the scan ends by itself
    expect(state.opened).toBe(1);
    expect(state.rejected).toBe(false);
  });

  it('a scan aborted without connecting closes the chooser with null', async () => {
    const { transport, state } = electron([[ringA]]);
    const f = chooserFactory(transport, 'electron');
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(10);
    expect(state.chosenWith).toBeUndefined();
    ctl.abort();
    await scanned;
    await sleep(5);
    expect(state.chosenWith).toBeNull();
    expect(state.rejected).toBe(true);
  });

  it('a scan whose signal is already aborted closes the chooser straight away', async () => {
    const { transport, state } = electron([]);
    await chooserFactory(transport, 'electron').scan([famA], () => {}, AbortSignal.abort());
    await sleep(5);
    expect(state.chosenWith).toBeNull();
  });

  it('after an aborted scan the pending request is gone: connect falls back to reconnect', async () => {
    const { transport, reconnect } = electron([[ringA]]);
    const f = chooserFactory(transport, 'electron');
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(10);
    ctl.abort();
    await scanned;
    const t = await f.connect({ platformId: ringA.id }, famA);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(t.peripheral.id).toBe(`re:${ringA.id}`);
  });

  it('connect for an id that is not in the pending list closes the open request, then reconnects', async () => {
    const { transport, state, reconnect } = electron([[ringA]]);
    const f = chooserFactory(transport, 'electron');
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(10);
    const t = await f.connect({ platformId: 'E2:80:00:00:00:99' }, famB, ctl.signal);
    expect(reconnect).toHaveBeenCalledWith('E2:80:00:00:00:99', familiesQuery([famB]), { signal: ctl.signal });
    expect(t.peripheral.id).toBe('re:E2:80:00:00:00:99');
    expect(state.chosenWith).toBeNull();
    await scanned;
  });

  it('a request that fails ends the scan quietly and no unhandled rejection escapes', async () => {
    const transport: BleTransport = {
      kind: 'electron',
      isAvailable: async () => true,
      requestDevice: async () => {
        throw new NoDeviceError('unavailable');
      },
    };
    await expect(chooserFactory(transport, 'electron').scan([famA], () => {}, new AbortController().signal)).resolves.toBeUndefined();
  });

  it('a chooser built by scan forwards the selected device only once', async () => {
    let chooser: DeviceChooser | undefined;
    const transport: BleTransport = {
      kind: 'electron',
      isAvailable: async () => true,
      requestDevice: async (_q, opts) => {
        chooser = opts?.chooser;
        return new Promise<RingLink>(() => {});
      },
    };
    const ctl = new AbortController();
    const found: ChooserAdvertisement[] = [];
    const scanned = chooserFactory(transport, 'electron').scan([famB], (ad) => found.push(ad), ctl.signal);
    chooser!.update([ringA]);
    chooser!.update([ringA]);
    expect(found.map((a) => a.needsDiscovery)).toEqual([true]);
    ctl.abort();
    await scanned;
  });

  /** Chromium looks for 60 s per request: each request here lists `lists[n]` (the n-th request) and ends after `scanMs`. */
  const windows = (lists: FoundDevice[][]) => {
    const state = { opened: 0, scanMs: [] as number[], chosenWith: [] as (string | null)[] };
    const requestDevice = vi.fn(async (_q: unknown, opts: RequestOptions = {}): Promise<RingLink> => {
      const n = state.opened++;
      state.scanMs.push(opts.scanMs ?? 0);
      opts.chooser?.update(lists[n] ?? []);
      const id = await Promise.race([opts.chooser!.chosen, sleep(opts.scanMs ?? 0).then(() => null)]);
      state.chosenWith.push(id);
      if (id === null) throw new NoDeviceError(opts.signal?.aborted ? 'cancelled' : 'not_found');
      return new FakeLink({ id });
    });
    const reconnect = vi.fn(async (id: string, _q: unknown, _o?: { signal?: AbortSignal; scanMs?: number }) => new FakeLink({ id: `re:${id}` }));
    return { state, requestDevice, reconnect, transport: { kind: 'electron', isAvailable: async () => true, requestDevice, reconnect } satisfies BleTransport };
  };

  it('the desktop list keeps looking, one request after another, until the time is up; rows add up', async () => {
    const { state, transport } = windows([[], [ringA], [ringA, ringB]]);
    const f = chooserFactory(transport, 'electron', { windowMs: 40, totalMs: 130 });
    const found: string[] = [];
    let ended = false;
    const done = f.scan([famA], (ad) => found.push(ad.platformId!), new AbortController().signal).then(() => (ended = true));
    await sleep(60);
    expect(found).toEqual([ringA.id]);
    expect(ended).toBe(false);
    await done;
    expect(found).toEqual([ringA.id, ringB.id]);
    expect(state.opened).toBe(3);
    expect(state.scanMs[0]).toBe(40);
  });

  it('the desktop looks 60 s per request for 3 minutes; over the Android app transport one request ends the scan', async () => {
    expect([CHOOSER_WINDOW_MS, DESKTOP_SCAN_MS]).toEqual([60_000, 180_000]);
    vi.useFakeTimers();
    try {
      const desk = windows([]);
      let deskEnded = false;
      void chooserFactory(desk.transport, 'electron').scan([famA], () => {}, new AbortController().signal).then(() => (deskEnded = true));
      const phone = windows([]);
      let phoneEnded = false;
      void chooserFactory({ ...phone.transport, kind: 'capacitor' }, 'electron').scan([famA], () => {}, new AbortController().signal).then(() => (phoneEnded = true));
      await vi.advanceTimersByTimeAsync(60_000);
      expect([phoneEnded, phone.state.opened]).toEqual([true, 1]);
      expect([deskEnded, desk.state.opened]).toEqual([false, 2]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect([deskEnded, desk.state.opened]).toEqual([true, 3]);
      expect(desk.state.scanMs).toEqual([60_000, 60_000, 60_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Stop looking ends the run of requests at once', async () => {
    const { state, transport } = windows([[ringA], [ringA]]);
    const ctl = new AbortController();
    const scanned = chooserFactory(transport, 'electron', { windowMs: 40, totalMs: 400 }).scan([famA], () => {}, ctl.signal);
    await sleep(10);
    ctl.abort();
    await scanned;
    await sleep(60);
    expect(state.opened).toBe(1);
  });

  it('a request that fails early (Bluetooth off) is not followed by another', async () => {
    const requestDevice = vi.fn(async () => {
      throw new NoDeviceError('unavailable');
    });
    const transport: BleTransport = { kind: 'electron', isAvailable: async () => true, requestDevice };
    await chooserFactory(transport, 'electron', { windowMs: 40, totalMs: 400 }).scan([famA], () => {}, new AbortController().signal);
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });

  it('a tap on a ring the open request lists answers that request and ends the run', async () => {
    const { state, transport, reconnect } = windows([[], [ringA]]);
    const f = chooserFactory(transport, 'electron', { windowMs: 40, totalMs: 400 });
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(55);
    const t = await f.connect({ platformId: ringA.id }, undefined, ctl.signal);
    expect(t.peripheral.id).toBe(ringA.id);
    await scanned;
    expect(state.opened).toBe(2);
    expect(state.chosenWith.at(-1)).toBe(ringA.id);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('a tap on a ring an earlier request listed waits a whole request for it to be heard again', async () => {
    const { state, transport, reconnect } = windows([[ringA], []]);
    const f = chooserFactory(transport, 'electron', { windowMs: 40, totalMs: 400 });
    const ctl = new AbortController();
    const scanned = f.scan([famA], () => {}, ctl.signal);
    await sleep(55);
    const t = await f.connect({ platformId: ringA.id }, undefined, ctl.signal);
    expect(t.peripheral.id).toBe(`re:${ringA.id}`);
    expect(reconnect).toHaveBeenCalledWith(ringA.id, familiesQuery([famA]), { signal: ctl.signal, scanMs: 40 });
    await scanned;
    await sleep(60);
    expect(state.opened).toBe(2);
    // later reconnects of that ring wait as long as they always did
    await f.connect({ platformId: ringA.id }, famA);
    expect(reconnect).toHaveBeenLastCalledWith(ringA.id, familiesQuery([famA]), { signal: undefined });
  });

  it('a tap that lands just as the open request runs out looks for that ring with a new request', async () => {
    let chooser: DeviceChooser | undefined;
    let fail!: (e: Error) => void;
    const requestDevice = vi.fn(async (_q: unknown, opts: RequestOptions = {}) => {
      chooser = opts.chooser;
      chooser?.update([ringA]);
      return new Promise<RingLink>((_, reject) => (fail = reject));
    });
    const reconnect = vi.fn(async (id: string) => new FakeLink({ id: `re:${id}` }));
    const f = chooserFactory({ kind: 'electron', isAvailable: async () => true, requestDevice, reconnect }, 'electron', { windowMs: 1_000, totalMs: 1_000 });
    const scanned = f.scan([famA], () => {}, new AbortController().signal);
    await sleep(5);
    const tapped = f.connect({ platformId: ringA.id }, undefined);
    // the request had already been answered "nothing chosen" by its timer
    fail(new NoDeviceError('cancelled'));
    expect((await tapped).peripheral.id).toBe(`re:${ringA.id}`);
    expect(reconnect).toHaveBeenCalledWith(ringA.id, familiesQuery([famA]), { signal: undefined, scanMs: 1_000 });
    await scanned;
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });
});

describe('chooserFactory over the real desktop transport and bridge', () => {
  type Listener = (event: unknown, ...args: unknown[]) => void;
  type SelectListener = (event: { preventDefault(): void }, list: ElectronBluetoothDevice[], cb: (id: string) => void) => void;

  /** One window: main-side webContents and ipcMain, page-side ipcRenderer, wired through in-memory channels. */
  function fakeElectron() {
    const toPage = new Map<string, Set<Listener>>();
    const toMain = new Map<string, Set<Listener>>();
    const add = (m: Map<string, Set<Listener>>, ch: string, l: Listener) => (m.get(ch) ?? m.set(ch, new Set()).get(ch)!).add(l);
    let select: SelectListener | undefined;
    const wc: WebContentsLike = {
      id: 7,
      on: (_e, l) => (select = l),
      removeListener: () => (select = undefined),
      send: (ch, ...args) => toPage.get(ch)?.forEach((l) => l({}, ...args)),
      isDestroyed: () => false,
      executeJavaScript: async () => 0,
    };
    const ipcMain: IpcMainLike = {
      on: (ch, l) => add(toMain, ch, l as Listener),
      removeListener: (ch, l) => toMain.get(ch)?.delete(l as Listener),
    };
    const ipcRenderer: IpcRendererLike = {
      on: (ch, l) => add(toPage, ch, l),
      removeListener: (ch, l) => toPage.get(ch)?.delete(l),
      send: (ch, ...args) => toMain.get(ch)?.forEach((l) => l({ sender: { id: 7 } }, ...args)),
    };
    const chromiumSelect = (lists: ElectronBluetoothDevice[][]): Promise<string> =>
      new Promise((resolve) => {
        let i = 0;
        const next = (): void => {
          if (i >= lists.length) return;
          select?.({ preventDefault: () => {} }, lists[i++]!, resolve);
          setTimeout(next, 5);
        };
        next();
      });
    return { wc, ipcMain, ipcRenderer, chromiumSelect };
  }

  class FakeDevice extends EventTarget {
    constructor(
      readonly id: string,
      readonly name: string,
    ) {
      super();
    }
    readonly gatt = { connected: true, connect: async () => this.gatt, disconnect: () => {}, getPrimaryService: async () => ({}) };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('scan reports the address-like id from the select list; connect returns a transport carrying that id, not the page one', async () => {
    const MAC = 'E2:80:00:00:00:01';
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const lists: ElectronBluetoothDevice[][] = [[{ deviceId: MAC, deviceName: 'Ring A' }], [{ deviceId: MAC, deviceName: 'Ring A' }, { deviceId: 'E2:80:00:00:00:02', deviceName: 'Ring B' }]];
    const requestDevice = vi.fn(async () => {
      const id = await e.chromiumSelect(lists);
      if (!id) throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });
      return new FakeDevice('opaque-page-id', lists.flat().find((x) => x.deviceId === id)?.deviceName ?? '');
    });
    vi.stubGlobal('navigator', { ...globalThis.navigator, bluetooth: { requestDevice, getAvailability: async () => true } });

    const f = chooserFactory(createElectronTransport(() => bluetoothBridge(e.ipcRenderer)), 'electron');
    expect(await f.available()).toBe(true);
    const ctl = new AbortController();
    const found: ChooserAdvertisement[] = [];
    const scanned = f.scan([famA], (ad) => found.push(ad), ctl.signal);
    await sleep(40);
    expect(found.map((a) => [a.platformId, a.name, a.needsDiscovery])).toEqual([
      [MAC, 'Ring A', true],
      ['E2:80:00:00:00:02', 'Ring B', true],
    ]);

    const t = await f.connect({ platformId: MAC }, famA);
    expect(t.peripheral.id).toBe(MAC);
    expect(t.peripheral.id).not.toBe('opaque-page-id');
    expect(t.peripheral.name).toBe('Ring A');
    await scanned;
    expect(requestDevice).toHaveBeenCalledTimes(1);
    await t.disconnect();
  });
});
