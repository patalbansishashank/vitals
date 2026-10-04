import { afterEach, describe, expect, it, vi } from 'vitest';
import { command } from '@/biometrics/core/ble/jstyle2301/commands';
import { jstyle2301Driver } from '../../drivers';
import type { SessionClock } from '../../session';
import { fullUuid } from '../match';
import { NoDeviceError } from '../types';
import { webTransport } from '../web';

const WR = fullUuid(0xfff6);
const NT = fullUuid(0xfff7);
const SVC = fullUuid(0xfff0);

const query = { filters: [{ namePrefix: 'Ring' }], optionalServices: [0xfff0] };

class FakeChar extends EventTarget {
  value?: DataView;
  constructor(readonly properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; read: boolean }) {
    super();
  }
  writes: Array<{ mode: 'with' | 'without'; bytes: number[] }> = [];
  onWrite?: (bytes: number[]) => void;
  writeValueWithResponse = vi.fn(async (v: BufferSource) => this.record('with', v));
  writeValueWithoutResponse = vi.fn(async (v: BufferSource) => this.record('without', v));
  startNotifications = vi.fn(async () => this);
  stopNotifications = vi.fn(async () => this);
  readValue = vi.fn(async () => new DataView(Uint8Array.of(1).buffer));

  private record(mode: 'with' | 'without', v: BufferSource): void {
    const b = Array.from(new Uint8Array(v as ArrayBuffer));
    this.writes.push({ mode, bytes: b });
    this.onWrite?.(b);
  }
  /** The ring notifies: sets `value` and dispatches the event, as Chrome does. */
  notify(b: number[]): void {
    this.value = new DataView(Uint8Array.from(b).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeDevice extends EventTarget {
  connected = false;
  readonly writeChar: FakeChar;
  readonly notifyChar: FakeChar;
  readonly gatt: { connected: boolean; connect: () => Promise<unknown>; disconnect: () => void; getPrimaryService: ReturnType<typeof vi.fn> };
  /** Frame → reply script, as in the capacitor test. */
  script: Array<{ expect: number[]; reply: number[] }> = [];
  unexpected: string[] = [];

  constructor(
    readonly id: string | undefined,
    readonly name: string | undefined,
    writeProps: { write: boolean; writeWithoutResponse: boolean } = { write: true, writeWithoutResponse: false },
  ) {
    super();
    this.writeChar = new FakeChar({ ...writeProps, notify: false, read: false });
    this.notifyChar = new FakeChar({ write: false, writeWithoutResponse: false, notify: true, read: false });
    this.writeChar.onWrite = (b) => {
      const step = this.script[0];
      if (!step || step.expect.join() !== b.join()) {
        this.unexpected.push(b.join(' '));
        return;
      }
      this.script.shift();
      queueMicrotask(() => this.notifyChar.notify(step.reply));
    };
    const chars = new Map([[WR, this.writeChar], [NT, this.notifyChar]]);
    const service = {
      getCharacteristic: vi.fn(async (c: number | string) => {
        const ch = chars.get(fullUuid(c));
        if (!ch) throw new Error('no such characteristic');
        return ch;
      }),
    };
    const isConnected = (): boolean => this.connected;
    const setConnected = (v: boolean): void => {
      this.connected = v;
    };
    const emit = (n: string): void => void this.dispatchEvent(new Event(n));
    this.gatt = {
      get connected() {
        return isConnected();
      },
      connect: vi.fn(async () => {
        setConnected(true);
        return this.gatt;
      }),
      disconnect: vi.fn(() => {
        setConnected(false);
        emit('gattserverdisconnected');
      }),
      getPrimaryService: vi.fn(async (s: number | string) => {
        if (fullUuid(s) !== SVC) throw new Error('no such service');
        return service;
      }),
    } as FakeDevice['gatt'];
  }

  /** The ring goes away. */
  drop(): void {
    this.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

const stubBluetooth = (bt: object | undefined): void => {
  vi.stubGlobal('navigator', bt === undefined ? {} : { bluetooth: bt });
};
const stubDevice = (device: FakeDevice, extra: object = {}) => {
  const requestDevice = vi.fn(async (_o: unknown) => device);
  stubBluetooth({ requestDevice, ...extra });
  return requestDevice;
};

afterEach(() => vi.unstubAllGlobals());

describe('web transport: availability', () => {
  it('is not available without navigator.bluetooth', async () => {
    stubBluetooth(undefined);
    expect(await webTransport.isAvailable()).toBe(false);
  });

  it('is not available in the plain jsdom navigator either', async () => {
    expect(await webTransport.isAvailable()).toBe(false);
  });

  it('is available when bluetooth exists but has no getAvailability', async () => {
    stubBluetooth({ requestDevice: vi.fn() });
    expect(await webTransport.isAvailable()).toBe(true);
  });

  it('uses getAvailability when present', async () => {
    const getAvailability = vi.fn(async () => false);
    stubBluetooth({ requestDevice: vi.fn(), getAvailability });
    expect(await webTransport.isAvailable()).toBe(false);
    getAvailability.mockResolvedValue(true);
    expect(await webTransport.isAvailable()).toBe(true);
    expect(getAvailability).toHaveBeenCalledTimes(2);
  });

  it('a rejecting getAvailability counts as unavailable', async () => {
    stubBluetooth({ requestDevice: vi.fn(), getAvailability: vi.fn(async () => Promise.reject(new Error('boom'))) });
    expect(await webTransport.isAvailable()).toBe(false);
  });

  it('has kind web and no reconnect', () => {
    expect(webTransport.kind).toBe('web');
    expect(webTransport.reconnect).toBeUndefined();
  });
});

describe('web transport: requestDevice', () => {
  it('passes the query filters and optionalServices to the browser, from a plain query', async () => {
    const dev = new FakeDevice('dev-1', 'Ring 7307');
    const requestDevice = stubDevice(dev);
    await webTransport.requestDevice(query);
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledWith({ filters: query.filters, optionalServices: query.optionalServices });
  });

  it('passes a driver\'s requestOptions through', async () => {
    const requestDevice = stubDevice(new FakeDevice('dev-1', 'Ring 7307'));
    await webTransport.requestDevice(jstyle2301Driver);
    expect(requestDevice).toHaveBeenCalledWith({ filters: jstyle2301Driver.requestOptions.filters, optionalServices: jstyle2301Driver.requestOptions.optionalServices });
  });

  it('ignores a chooser option (the browser has its own)', async () => {
    const dev = new FakeDevice('dev-1', 'Ring 7307');
    stubDevice(dev);
    const update = vi.fn();
    await webTransport.requestDevice(query, { chooser: { update, chosen: new Promise(() => {}) } });
    expect(update).not.toHaveBeenCalled();
  });

  it('connects GATT and returns a link with deviceId and deviceName', async () => {
    const dev = new FakeDevice('opaque-id-1', 'Ring 7307');
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    expect(dev.gatt.connect).toHaveBeenCalledTimes(1);
    expect(link.deviceId).toBe('opaque-id-1');
    expect((link as { deviceName?: string }).deviceName).toBe('Ring 7307');
    expect(link.mtu).toBeUndefined();
  });

  it('maps NotFoundError (chooser closed) to NoDeviceError cancelled', async () => {
    stubBluetooth({ requestDevice: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' }))) });
    const err = await webTransport.requestDevice(query).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoDeviceError);
    expect((err as NoDeviceError).reason).toBe('cancelled');
  });

  it('rethrows other errors untouched', async () => {
    const boom = Object.assign(new Error('gesture needed'), { name: 'SecurityError' });
    stubBluetooth({ requestDevice: vi.fn(async () => Promise.reject(boom)) });
    await expect(webTransport.requestDevice(query)).rejects.toBe(boom);
  });

  it('rejects NoDeviceError unavailable without navigator.bluetooth', async () => {
    stubBluetooth(undefined);
    await expect(webTransport.requestDevice(query)).rejects.toMatchObject({ name: 'NoDeviceError', reason: 'unavailable' });
  });

  it('does not ask the browser when getAvailability says the adapter is off', async () => {
    const requestDevice = vi.fn();
    stubBluetooth({ requestDevice, getAvailability: async () => false });
    await expect(webTransport.requestDevice(query)).rejects.toEqual(new NoDeviceError('unavailable'));
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it('rejects a device without GATT', async () => {
    stubBluetooth({ requestDevice: vi.fn(async () => ({ id: 'x', name: 'Ring 1', addEventListener() {}, removeEventListener() {} })) });
    await expect(webTransport.requestDevice(query)).rejects.toThrow(/GATT/);
  });
});

describe('web transport: link behaviour', () => {
  const frame = Uint8Array.of(1, 2, 3);

  it('reports the chosen peripheral\'s discovered GATT service UUIDs', async () => {
    const dev = new FakeDevice('d', 'Unlabelled ring');
    Object.assign(dev.gatt, { getPrimaryServices: vi.fn(async () => [{ uuid: SVC }]) });
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    expect(await link.services?.()).toEqual([SVC]);
  });

  it('writes with response when the characteristic supports write', async () => {
    const dev = new FakeDevice('d', 'Ring 1');
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    await link.write(0xfff0, 0xfff6, frame);
    expect(dev.writeChar.writes).toEqual([{ mode: 'with', bytes: [1, 2, 3] }]);
  });

  it('writes without response when only writeWithoutResponse is supported, and honours an explicit choice', async () => {
    const dev = new FakeDevice('d', 'Ring 1', { write: false, writeWithoutResponse: true });
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    await link.write(SVC, WR, frame);
    await link.write(SVC, WR, frame, { withResponse: true });
    expect(dev.writeChar.writes.map((w) => w.mode)).toEqual(['without', 'with']);
  });

  it('subscribe delivers a copy of each notification', async () => {
    const dev = new FakeDevice('d', 'Ring 1');
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    const got: number[][] = [];
    const off = await link.subscribe(0xfff0, 0xfff7, (b) => got.push(Array.from(b)));
    expect(dev.notifyChar.startNotifications).toHaveBeenCalledTimes(1);
    dev.notifyChar.notify([7, 8, 9]);
    expect(got).toEqual([[7, 8, 9]]);
    off();
    dev.notifyChar.notify([1]);
    expect(got).toHaveLength(1);
    expect(dev.notifyChar.stopNotifications).toHaveBeenCalledTimes(1);
  });

  it("'gattserverdisconnected' fires onDisconnect listeners, and a removed listener stays silent", async () => {
    const dev = new FakeDevice('d', 'Ring 1');
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    const a = vi.fn();
    const b = vi.fn();
    link.onDisconnect(a);
    link.onDisconnect(b)();
    dev.drop();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    await expect(link.write(0xfff0, 0xfff6, frame)).rejects.toThrow(/disconnected/);
  });

  it('disconnect() disconnects the GATT server and fires listeners once', async () => {
    const dev = new FakeDevice('d', 'Ring 1');
    stubDevice(dev);
    const link = await webTransport.requestDevice(query);
    const a = vi.fn();
    link.onDisconnect(a);
    await link.disconnect();
    expect(dev.gatt.disconnect).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    await link.disconnect();
    expect(dev.gatt.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('web transport: J-Style 2301 driver end to end', () => {
  const clock: SessionClock = { now: () => Date.UTC(2026, 8, 16, 10), tzOffsetS: () => 0 };

  it('V0525 handshake over the Web Bluetooth link, then close disconnects', async () => {
    const dev = new FakeDevice('opaque-id-1', 'Ring 7307');
    dev.script = [
      { expect: Array.from(command(0x27)), reply: [0x27, 0, 5, 2, 5] },
      { expect: Array.from(command(0x13)), reply: [0x13, 88] },
    ];
    stubDevice(dev);
    const link = await webTransport.requestDevice(jstyle2301Driver);
    const session = await jstyle2301Driver.open(link, { clock, timers: { quietMs: 5, stallMs: 20 } });
    expect(await session.info()).toEqual({ firmware: 'V0525', battery: 88, clockOffsetS: 0 });
    expect(dev.unexpected).toEqual([]);
    expect(dev.script).toEqual([]);
    await session.close();
    expect(dev.gatt.disconnect).toHaveBeenCalledTimes(1);
  });
});
