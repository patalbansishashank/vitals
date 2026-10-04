/**
 * J2-07: a reconnect by address on Android after a fresh start. The fake follows the plugin's Device.kt: a connect
 * rejects "Connection timeout." after its timeout or "Connection failed with status N (NAME)." when the OS drops it,
 * and a disconnect clears what the plugin holds for the id.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCapacitorTransport, gattStatusOf, type CapBleClient, type CapScanResult, type CapService } from '../capacitor';
import { NoDeviceError } from '../types';

const ID = 'AA:BB:CC:DD:EE:01';
const SVC = '0000fff0-0000-1000-8000-00805f9b34fb';
const query = { filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optionalServices: [0xfff0] };
const ringAd: CapScanResult = { device: { deviceId: ID }, localName: 'Ring 01', rssi: -60, manufacturerData: { '4660': new DataView(new Uint8Array([1]).buffer) } };
const timing = { connectMs: 60, backoffMs: 30, scanMs: 80 };

/** What one connect does: resolve, time out after the given timeout, or fail with a GATT status. */
type ConnectStep = 'ok' | 'timeout' | { status: number };

class ScriptedBle implements CapBleClient {
  connects: ConnectStep[] = [];
  /** the plugin still holds a stale handle: every connect times out until disconnect clears it */
  stale = false;
  advertises = true;
  mtuFails = false;
  afterConnect?: () => void;
  log: string[] = [];
  scanning = false;
  stopScanCalls = 0;
  private timer?: ReturnType<typeof setTimeout>;

  initialize = vi.fn(async () => {});
  async isEnabled(): Promise<boolean> {
    return true;
  }
  async requestLEScan(_o: unknown, cb: (r: CapScanResult) => void): Promise<void> {
    this.log.push('scan');
    this.scanning = true;
    if (this.advertises) this.timer = setTimeout(() => this.scanning && cb(ringAd), 5);
  }
  async stopLEScan(): Promise<void> {
    this.stopScanCalls++;
    this.scanning = false;
    clearTimeout(this.timer);
  }
  async connect(_id: string, _cb?: (id: string) => void, o?: { timeout?: number }): Promise<void> {
    this.log.push(`connect ${o?.timeout}`);
    const step = this.stale ? 'timeout' : (this.connects.shift() ?? 'ok');
    queueMicrotask(() => this.afterConnect?.());
    if (step === 'ok') return;
    if (step === 'timeout') return new Promise((_r, reject) => setTimeout(() => reject(new Error('Connection timeout.')), o?.timeout ?? 0));
    throw new Error(`Connection failed with status ${step.status} (GATT_ERROR).`);
  }
  async disconnect(_id: string): Promise<void> {
    this.log.push('disconnect');
    this.stale = false;
  }
  async getServices(): Promise<CapService[]> {
    return [{ uuid: SVC, characteristics: [] }];
  }
  async getMtu(): Promise<number> {
    if (this.mtuFails) throw new Error('Not connected to device.');
    return 247;
  }
  async startNotifications(): Promise<void> {}
  async stopNotifications(): Promise<void> {}
  async write(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async read(): Promise<DataView> {
    return new DataView(new ArrayBuffer(0));
  }
}

const setup = (configure: (b: ScriptedBle) => void) => {
  const ble = new ScriptedBle();
  configure(ble);
  return { ble, transport: createCapacitorTransport(async () => ble, timing) };
};

describe('capacitor transport: reconnect after a fresh start (J2-07)', () => {
  it('a connect that times out is followed by a backoff, a scan and a second connect', async () => {
    const { ble, transport } = setup((b) => (b.connects = ['timeout', 'ok']));
    const link = await transport.reconnect!(ID, query);
    expect(link.deviceId).toBe(ID);
    expect((link as { deviceName?: string }).deviceName).toBe('Ring 01');
    expect(ble.log).toEqual(['connect 60', 'scan', 'connect 60']);
    expect(ble.stopScanCalls).toBe(1);
  });

  it('GATT status 133 on the first connect: backoff, then success', async () => {
    const { ble, transport } = setup((b) => (b.connects = [{ status: 133 }, 'ok']));
    const link = await transport.reconnect!(ID, query);
    expect(link.deviceId).toBe(ID);
    expect(ble.log.filter((l) => l.startsWith('connect'))).toHaveLength(2);
  });

  it('a ring held by an OS link does not advertise: the scan misses it, the last direct connect still works', async () => {
    const { ble, transport } = setup((b) => {
      b.connects = [{ status: 133 }, 'ok'];
      b.advertises = false;
    });
    const link = await transport.reconnect!(ID, query);
    expect(link.deviceId).toBe(ID);
    expect(ble.log).toEqual(['connect 60', 'scan', 'connect 60']);
    expect(ble.scanning).toBe(false);
  });

  it('when every attempt fails it rejects with the last error, which keeps the GATT status', async () => {
    const { transport } = setup((b) => {
      b.connects = [{ status: 133 }, { status: 62 }];
      b.advertises = false;
    });
    const err = await transport.reconnect!(ID, query).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { gattStatus?: number }).gattStatus).toBe(62);
    expect(gattStatusOf(err)).toBe(62);
  });

  it('abort as the first connect fails (before or during the backoff) rejects cancelled and never starts a scan', async () => {
    const ac = new AbortController();
    const { ble, transport } = setup((b) => {
      b.connects = [{ status: 133 }];
      b.afterConnect = () => ac.abort();
    });
    const p = transport.reconnect!(ID, query, { signal: ac.signal });
    await expect(p).rejects.toMatchObject({ name: 'NoDeviceError', reason: 'cancelled' });
    await new Promise((r) => setTimeout(r, timing.backoffMs + 20));
    expect(ble.log).not.toContain('scan');
    expect(ble.scanning).toBe(false);
  });

  it('abort during a hanging connect rejects cancelled at once', async () => {
    const { transport } = setup((b) => (b.connects = ['timeout']));
    const ac = new AbortController();
    const p = transport.reconnect!(ID, query, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    const t0 = Date.now();
    await expect(p).rejects.toBeInstanceOf(NoDeviceError);
    expect(Date.now() - t0).toBeLessThan(timing.connectMs);
  });

  it('a failing getMtu keeps the link (the MTU is only a hint) and does not disconnect', async () => {
    const { ble, transport } = setup((b) => (b.mtuFails = true));
    const link = await transport.reconnect!(ID, query);
    expect(link.mtu).toBeUndefined();
    expect(ble.log).toEqual(['connect 60']);
  });

  it('does not release a link this transport still holds open', async () => {
    const { ble, transport } = setup(() => {});
    await transport.reconnect!(ID, query);
    ble.log = [];
    await transport.reconnect!(ID, query);
    expect(ble.log).toEqual(['connect 60']);
  });
});

describe('gattStatusOf', () => {
  it('reads the status from the property or from the plugin message', () => {
    expect(gattStatusOf(Object.assign(new Error('x'), { gattStatus: 8 }))).toBe(8);
    expect(gattStatusOf(new Error('Connection failed with status 133 (GATT_ERROR).'))).toBe(133);
    expect(gattStatusOf(new Error('Connection timeout.'))).toBeUndefined();
    expect(gattStatusOf(undefined)).toBeUndefined();
  });
});
