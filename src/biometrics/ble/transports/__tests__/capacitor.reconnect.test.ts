/**
 * J2-07: a reconnect by address on Android after a fresh start. The fake follows the plugin's Device.kt: a connect
 * rejects "Connection timeout." after its timeout or "Connection failed with status N (NAME)." when the OS drops it,
 * and a disconnect clears what the plugin holds for the id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_TIMING, SCAN_MODE_LOW_LATENCY, createCapacitorTransport, gattStatusOf, type CapBleClient, type CapScanResult, type CapService } from '../capacitor';
import { NoDeviceError } from '../types';

const ID = 'AA:BB:CC:DD:EE:01';
const SVC = '0000fff0-0000-1000-8000-00805f9b34fb';
const NOTIFY = '0000fff7-0000-1000-8000-00805f9b34fb';
const BATTERY = '0000180f-0000-1000-8000-00805f9b34fb';
const query = { filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optionalServices: [0xfff0] };
const ringAd: CapScanResult = { device: { deviceId: ID }, localName: 'Ring 01', rssi: -60, manufacturerData: { '4660': new DataView(new Uint8Array([1]).buffer) } };
const timing = { connectMs: 60, backoffMs: 30, scanMs: 80, disconnectMs: 20, refreshMs: 20 };
/** The ring service's bound on one whole open (`CONNECT_ATTEMPT_MS` in ringService.ts). */
const SERVICE_BOUND_MS = 45_000;

/** Resolves after `ms` (at once for 0; never for Infinity). */
const later = (ms: number): Promise<void> => (ms === 0 ? Promise.resolve() : new Promise((resolve) => Number.isFinite(ms) && setTimeout(resolve, ms)));

/** Settles `p` on fake time: everything the transport waits for is a timer. */
async function onFakeTime<T>(p: Promise<T>, ms = SERVICE_BOUND_MS): Promise<T> {
  const out = p.then(
    (v) => ({ v }),
    (e: unknown) => ({ e }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  const r = await out;
  if ('e' in r) throw r.e;
  return r.v;
}

/**
 * What one connect does: resolve, time out after the given timeout, fail with a GATT status (at once or after a while),
 * fail with the GATT still up (a plugin message without a status), or come up only after `lateMs`.
 */
type ConnectStep = 'ok' | 'timeout' | { status: number; afterMs?: number } | { message: string } | { lateMs: number };

class ScriptedBle implements CapBleClient {
  connects: ConnectStep[] = [];
  /** the plugin still holds a stale handle: every connect times out until disconnect clears it */
  stale = false;
  advertises = true;
  /** when the ring is heard after a scan starts */
  adAfterMs = 5;
  mtuFails = false;
  disconnectStep: 'ok' | 'fail' | 'hang' = 'ok';
  services: CapService[] = [{ uuid: SVC, characteristics: [] }];
  /** set by a test: the plugin's cache refresh */
  discoverServices?: (id: string) => Promise<void>;
  afterConnect?: () => void;
  log: string[] = [];
  scanOpts: unknown[] = [];
  scanning = false;
  stopScanCalls = 0;
  notify?: (v: DataView) => void;
  private timer?: ReturnType<typeof setTimeout>;

  initialize = vi.fn(async () => {});
  async isEnabled(): Promise<boolean> {
    return true;
  }
  async requestLEScan(o: unknown, cb: (r: CapScanResult) => void): Promise<void> {
    this.log.push('scan');
    this.scanOpts.push(o);
    this.scanning = true;
    if (this.advertises) this.timer = setTimeout(() => this.scanning && cb(ringAd), this.adAfterMs);
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
    if ('lateMs' in step) return new Promise((resolve) => setTimeout(resolve, step.lateMs));
    if ('message' in step) throw new Error(step.message);
    const failed = new Error(`Connection failed with status ${step.status} (GATT_ERROR).`);
    if (step.afterMs) return new Promise((_r, reject) => setTimeout(() => reject(failed), step.afterMs));
    throw failed;
  }
  async disconnect(_id: string): Promise<void> {
    this.log.push('disconnect');
    this.stale = false;
    if (this.disconnectStep === 'fail') throw new Error('Disconnection timeout.');
    if (this.disconnectStep === 'hang') return new Promise(() => {});
  }
  /** per call, how long the plugin takes to list the services / give the MTU (Infinity: never answers) */
  servicesDelays: number[] = [];
  mtuDelays: number[] = [];
  async getServices(): Promise<CapService[]> {
    await later(this.servicesDelays.shift() ?? 0);
    return this.services;
  }
  async getMtu(): Promise<number> {
    await later(this.mtuDelays.shift() ?? 0);
    if (this.mtuFails) throw new Error('Not connected to device.');
    return 247;
  }
  async startNotifications(_id: string, _s: string, _c: string, cb: (v: DataView) => void): Promise<void> {
    this.notify = cb;
  }
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

describe('capacitor transport: reconnect windows for a ring that advertises every 20–40 s', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Runs a reconnect on the default timing; resolves with its result and how long it took. */
  const run = async (configure: (b: ScriptedBle) => void) => {
    const ble = new ScriptedBle();
    configure(ble);
    const transport = createCapacitorTransport(async () => ble);
    const t0 = Date.now();
    let ms = -1;
    const out = transport.reconnect!(ID, query).then(
      (link) => ((ms = Date.now() - t0), link),
      (e: unknown) => ((ms = Date.now() - t0), e),
    );
    await vi.advanceTimersByTimeAsync(SERVICE_BOUND_MS);
    return { ble, result: await out, ms };
  };

  it('the defaults: 8 s direct connect, scan, 8 s connect within 35 s; refresh, services and MTU still end before 45 s', () => {
    expect(RECONNECT_TIMING).toMatchObject({ connectMs: 8_000, scanMs: 28_000, totalMs: 35_000, refreshMs: 5_000, gattMs: 2_000 });
    const { totalMs, refreshMs, gattMs } = RECONNECT_TIMING;
    expect(totalMs + refreshMs + 2 * gattMs).toBeLessThan(SERVICE_BOUND_MS);
  });

  it('a ring heard 15 s into the low-latency scan: the scan stops there and the address is connected', async () => {
    const { ble, result, ms } = await run((b) => {
      b.connects = ['timeout', 'ok'];
      b.adAfterMs = 15_000;
    });
    expect((result as { deviceId?: string }).deviceId).toBe(ID);
    expect(ble.log).toEqual(['connect 8000', 'scan', 'connect 8000']);
    expect(ble.scanOpts).toEqual([{ allowDuplicates: false, scanMode: SCAN_MODE_LOW_LATENCY }]);
    expect(SCAN_MODE_LOW_LATENCY).toBe(2);
    expect(ble.stopScanCalls).toBe(1);
    expect(ms).toBe(23_000);
  });

  it('a ring never heard: 8 s connect, 19 s scan, 8 s connect, and it all ends at 35 s', async () => {
    const { ble, result, ms } = await run((b) => {
      b.connects = ['timeout', 'timeout'];
      b.advertises = false;
    });
    expect(result).toBeInstanceOf(Error);
    expect(ble.log).toEqual(['connect 8000', 'scan', 'connect 8000']);
    expect(ms).toBe(35_000);
  });

  it('a direct connect that fails early leaves the scan the rest of the budget (a ring heard 25 s in)', async () => {
    const { result, ms } = await run((b) => {
      b.connects = [{ status: 133, afterMs: 500 }, 'ok'];
      b.adAfterMs = 25_000;
    });
    expect((result as { deviceId?: string }).deviceId).toBe(ID);
    expect(ms).toBe(25_500);
  });

  it('a ring heard at the end of the scan is handed over with time left for the handshake inside 45 s', async () => {
    const { ble, result, ms } = await run((b) => {
      b.connects = [{ status: 133, afterMs: 8_000 }, { lateMs: 7_900 }];
      b.adAfterMs = 18_999; // the scan is 19 s after an 8 s direct connect
      b.discoverServices = () => new Promise<void>(() => {}); // a refresh that hangs its whole 5 s
    });
    expect((result as { deviceId?: string }).deviceId).toBe(ID);
    expect(ble.log).toEqual(['connect 8000', 'scan', 'connect 8000']);
    // 8 s + 19 s + 7.9 s + 5 s refresh: 5 s and more left of the service's 45 s
    expect(ms).toBe(39_899);
    expect(SERVICE_BOUND_MS - ms).toBeGreaterThan(5_000);
  });

  it('a final timeout keeps the GATT status of the direct connect before it', async () => {
    const { result, ms } = await run((b) => {
      b.connects = [{ status: 133, afterMs: 7_000 }, 'timeout'];
      b.advertises = false;
    });
    expect((result as Error).message).toMatch(/Connection timeout/);
    expect((result as { gattStatus?: number }).gattStatus).toBe(133);
    expect(gattStatusOf(result)).toBe(133);
    // 7 s, a 20 s scan, an 8 s connect
    expect(ms).toBe(35_000);
  });

  it('the last failing step’s own status wins over the earlier one', async () => {
    const { result } = await run((b) => {
      b.connects = [{ status: 133 }, { status: 8 }];
      b.advertises = false;
    });
    expect((result as { gattStatus?: number }).gattStatus).toBe(8);
  });

  it('time spent closing a half-open link comes out of the scan and the last connect, never past 35 s', async () => {
    const ble = new ScriptedBle();
    const transport = createCapacitorTransport(async () => ble);
    // a link whose disconnect failed: the plugin may still hold it
    ble.disconnectStep = 'fail';
    await (await transport.reconnect!(ID, query)).disconnect();
    ble.log = [];
    ble.disconnectStep = 'hang';
    ble.connects = ['timeout', 'timeout'];
    ble.advertises = false;
    const t0 = Date.now();
    let ms = -1;
    const out = transport.reconnect!(ID, query).catch((e: unknown) => ((ms = Date.now() - t0), e));
    await vi.advanceTimersByTimeAsync(SERVICE_BOUND_MS);
    expect(await out).toBeInstanceOf(Error);
    // 2 s disconnect, 8 s connect, 17 s scan, 2 s disconnect, 6 s connect
    expect(ble.log).toEqual(['disconnect', 'connect 8000', 'scan', 'disconnect', 'connect 6000']);
    expect(ms).toBe(35_000);
  });

  it('an abort while the stack settles after a quick sighting rejects cancelled and connects no more', async () => {
    const ble = new ScriptedBle();
    ble.connects = [{ status: 133 }];
    const transport = createCapacitorTransport(async () => ble);
    const ac = new AbortController();
    const out = transport.reconnect!(ID, query, { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(ble.log).toEqual(['connect 8000', 'scan']);
    ac.abort();
    await vi.advanceTimersByTimeAsync(RECONNECT_TIMING.backoffMs);
    expect(await out).toMatchObject({ name: 'NoDeviceError', reason: 'cancelled' });
    expect(ble.log).toEqual(['connect 8000', 'scan']);
  });
});

describe('capacitor transport: GATT cache refresh and half-open links', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** How long the last timed reconnect took. */
  let ms = -1;
  const setup = (configure: (b: ScriptedBle) => void = () => {}) => {
    const ble = new ScriptedBle();
    configure(ble);
    return { ble, transport: createCapacitorTransport(async () => ble) };
  };
  const refreshes = (b: ScriptedBle) => async () => {
    b.log.push('refresh');
    b.services = [{ uuid: SVC, characteristics: [] }];
  };

  it('after GATT 133 the next connect refreshes the cache once, before it reads the services', async () => {
    const { ble, transport } = setup((b) => {
      b.connects = [{ status: 133 }, 'ok'];
      b.services = [{ uuid: BATTERY, characteristics: [] }]; // the stale cache
      b.discoverServices = refreshes(b);
    });
    const link = await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000', 'scan', 'connect 8000', 'refresh']);
    expect(await link.services!()).toEqual([SVC]);
    // the ring answers on this link, so closing it leaves nothing to refresh
    await link.subscribe(SVC, NOTIFY, () => {});
    ble.notify!(new DataView(new Uint8Array([0x27]).buffer));
    await link.disconnect();
    ble.log = [];
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000']);
  });

  it.each([22, 62])('GATT %i refreshes too', async (status) => {
    const { ble, transport } = setup((b) => {
      b.connects = [{ status }, 'ok'];
      b.discoverServices = refreshes(b);
    });
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toContain('refresh');
  });

  it('a plain timeout does not refresh', async () => {
    const { ble, transport } = setup((b) => {
      b.connects = ['timeout', 'ok'];
      b.discoverServices = refreshes(b);
    });
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000', 'scan', 'connect 8000']);
  });

  it.each(['fails', 'hangs'] as const)('a refresh that %s never fails the connect', async (how) => {
    const { transport } = setup((b) => {
      b.connects = [{ status: 133 }, 'ok'];
      b.discoverServices = how === 'fails' ? async () => Promise.reject(new Error('Service discovery failed.')) : () => new Promise<void>(() => {});
    });
    const link = await onFakeTime(transport.reconnect!(ID, query));
    expect(link.deviceId).toBe(ID);
    expect(await link.services!()).toEqual([SVC]);
  });

  it('a link that ended before the ring answered (a failed handshake) refreshes the cache on the next connect', async () => {
    const { ble, transport } = setup((b) => (b.discoverServices = refreshes(b)));
    const first = await onFakeTime(transport.reconnect!(ID, query));
    await first.subscribe(SVC, NOTIFY, () => {});
    await first.disconnect(); // no firmware answer: the session closes the link
    ble.log = [];
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000', 'refresh']);
  });

  it('a connect the plugin rejected with the GATT still up is disconnected at once, then refreshed on the next connect', async () => {
    const { ble, transport } = setup((b) => {
      b.connects = [{ message: 'Service discovery failed.' }, 'ok'];
      b.discoverServices = refreshes(b);
    });
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000', 'disconnect', 'scan', 'connect 8000', 'refresh']);
  });

  it('a failed disconnect leaves the address half-open: the next connect disconnects first, held at most disconnectMs', async () => {
    const { ble, transport } = setup((b) => (b.disconnectStep = 'fail'));
    const first = await onFakeTime(transport.reconnect!(ID, query));
    await first.disconnect();
    ble.disconnectStep = 'hang';
    ble.log = [];
    const t0 = Date.now();
    const second = await onFakeTime(transport.reconnect!(ID, query).then((l) => ((ms = Date.now() - t0), l)));
    expect(second.deviceId).toBe(ID);
    expect(ble.log).toEqual(['disconnect', 'connect 8000']);
    expect(ms).toBe(RECONNECT_TIMING.disconnectMs);
    // the new link is the plugin's now: a later connect does not tear it down first
    ble.log = [];
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000']);
  });

  it('reading the services is bounded: a plugin that never lists them fails the connect after 2 s and lets the link go', async () => {
    const { ble, transport } = setup((b) => {
      b.servicesDelays = [Infinity, Infinity];
    });
    const err = await onFakeTime(transport.reconnect!(ID, query)).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/services timed out/);
    expect(ble.log).toEqual(['connect 8000', 'disconnect', 'scan', 'connect 8000', 'disconnect']);
  });

  it('reading the MTU is bounded: a link whose MTU never comes is handed over after 2 s without one', async () => {
    const { ble, transport } = setup((b) => (b.mtuDelays = [Infinity]));
    const t0 = Date.now();
    const link = await onFakeTime(transport.reconnect!(ID, query).then((l) => ((ms = Date.now() - t0), l)));
    expect(link.mtu).toBeUndefined();
    expect(ms).toBe(RECONNECT_TIMING.gattMs);
    expect(ble.log).toEqual(['connect 8000']);
  });

  it('a connect given up on abort that comes up late is closed before the next connect, never on top of it', async () => {
    const { ble, transport } = setup((b) => (b.connects = [{ lateMs: 40 }, 'ok']));
    const ac = new AbortController();
    const first = transport.reconnect!(ID, query, { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    ac.abort();
    expect(await first).toMatchObject({ name: 'NoDeviceError', reason: 'cancelled' });
    const second = await onFakeTime(transport.reconnect!(ID, query));
    expect(second.deviceId).toBe(ID);
    expect(ble.log).toEqual(['connect 8000', 'disconnect', 'connect 8000']);
  });

  it('a late link that outlives the wait for it never closes the newer link on that address', async () => {
    const { ble, transport } = setup((b) => {
      // the abandoned connect comes up at 7.9 s and its services and MTU take 1.9 s each: 11.7 s, past the 10 s wait
      b.connects = [{ lateMs: 7_900 }, 'ok'];
      b.servicesDelays = [1_900];
      b.mtuDelays = [1_900];
    });
    const ac = new AbortController();
    const first = transport.reconnect!(ID, query, { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    ac.abort();
    expect(await first).toMatchObject({ reason: 'cancelled' });
    const second = await onFakeTime(transport.reconnect!(ID, query));
    expect(second.deviceId).toBe(ID);
    // the late link closed without a plugin disconnect: the newer link holds the address
    expect(ble.log).toEqual(['connect 8000', 'connect 8000']);
    await expect(second.write(SVC, NOTIFY, Uint8Array.of(1))).resolves.toBeUndefined();
    ble.log = [];
    await onFakeTime(transport.reconnect!(ID, query));
    expect(ble.log).toEqual(['connect 8000']);
  });

  it('a connect given up while it still waited to dial never dials once a newer one has started', async () => {
    const { ble, transport } = setup((b) => (b.disconnectStep = 'fail'));
    await (await onFakeTime(transport.reconnect!(ID, query))).disconnect(); // half-open now
    ble.disconnectStep = 'hang';
    ble.log = [];
    const ac = new AbortController();
    const first = transport.reconnect!(ID, query, { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100); // still disconnecting the half-open link
    ac.abort();
    expect(await first).toMatchObject({ reason: 'cancelled' });
    const second = await onFakeTime(transport.reconnect!(ID, query));
    expect(second.deviceId).toBe(ID);
    // its disconnect, then the newer open's own, then only the newer connect
    expect(ble.log).toEqual(['disconnect', 'disconnect', 'connect 8000']);
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
