/**
 * Desktop reconnect (L-DESKTOP hand-back, QA R5-02, J1-07): Disconnect then Connect, a drop then the service's retry,
 * and a reconnect at start, replayed against a scripted Chromium + BlueZ behind the app's own bridge (main + preload).
 *
 * The fake Chromium follows what the desktop app sees: one request per page (a new one ends the open one, whose
 * cancel reaches the page a moment later), `select-bluetooth-device` only when a request lists a device, a ring that
 * a request may never list again once BlueZ knows it, and `gatt.connect()` on a device the page was given, which BlueZ
 * completes whenever the ring is in reach (no list needed). Synthetic address only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachBluetooth, type ElectronBluetoothDevice, type IpcMainLike, type WebContentsLike } from '../../../../../apps/desktop/src/ble/main';
import { bluetoothBridge, type IpcRendererLike } from '../../../../../apps/desktop/src/ble/preload';
import { jstyle2301 } from '../../../../../packages/rings/src';
import { createElectronTransport, PICKED_CONNECT_MS, REOPEN_MS } from '../electron';
import { LINK_RELEASE_MS, OP_TIMEOUT_MS } from '../../webBluetooth';
import { chooserFactory } from '../rings';
import { NoDeviceError } from '../types';

const ADDRESS = '0A:00:00:00:00:01';
const query = { filters: [{ namePrefix: 'Ring' }], optionalServices: [0xfff0] };
type Listener = (event: unknown, ...args: unknown[]) => void;
type SelectListener = (event: { preventDefault(): void }, list: ElectronBluetoothDevice[], cb: (id: string) => void) => void;

const notFound = (): Error => Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });

/** What one `requestDevice` does: list the ring after `listAfterMs` (null: never), and how late its cancel arrives. */
interface RequestScript {
  listAfterMs: number | null;
  /** When the next request ends this one, its rejection reaches the page this much later (a separate pipe). */
  cancelLatencyMs?: number;
  /** The list was already in flight when the next request ended this one: it still reaches the page. */
  listSurvivesEnd?: boolean;
  /** Chromium answers this request with the ring without a list reaching the page (a stale answer took it). */
  resolveAfterMs?: number;
}

function world(script: (n: number) => RequestScript) {
  // ---- Electron: main's webContents and ipcMain, the preload's ipcRenderer; IPC to the page takes a moment
  const toPage = new Map<string, Set<Listener>>();
  const toMain = new Map<string, Set<Listener>>();
  const add = (m: Map<string, Set<Listener>>, ch: string, l: Listener) => (m.get(ch) ?? m.set(ch, new Set()).get(ch)!).add(l);
  let select: SelectListener | undefined;
  const wc: WebContentsLike = {
    id: 1,
    on: (_e, l) => (select = l),
    removeListener: () => (select = undefined),
    send: (ch, ...args) => void setTimeout(() => toPage.get(ch)?.forEach((l) => l({}, ...args)), 1),
    isDestroyed: () => false,
    executeJavaScript: async () => 0,
  };
  const ipcMain: IpcMainLike = { on: (ch, l) => add(toMain, ch, l as Listener), removeListener: (ch, l) => toMain.get(ch)?.delete(l as Listener) };
  const ipcRenderer: IpcRendererLike = {
    on: (ch, l) => add(toPage, ch, l),
    removeListener: (ch, l) => toPage.get(ch)?.delete(l),
    send: (ch, ...args) => toMain.get(ch)?.forEach((l) => l({ sender: { id: 1 } }, ...args)),
  };
  attachBluetooth(wc, ipcMain);

  // ---- the ring and BlueZ
  /** `failConnects`: so many connects fail after `connectMs` as BlueZ's do when the ring is not heard in time. */
  const ring = { inReach: true, connectMs: 800, failConnects: 0 };
  let granted = false;
  let waiting: (() => void) | undefined;
  const log: string[] = [];
  class Device extends EventTarget {
    readonly id = 'per-origin-id';
    readonly name = 'Ring 2301';
    private pending: Promise<unknown> | undefined;
    readonly gatt = {
      connected: false,
      // as Chromium: a pending connect cannot be cancelled, and it completes whenever the ring comes in reach
      connect: (): Promise<unknown> => {
        log.push('gatt.connect');
        if (!granted) return Promise.reject(Object.assign(new Error('no permission'), { name: 'SecurityError' }));
        if (this.gatt.connected) return Promise.resolve(this.gatt);
        this.pending ??= new Promise((resolve, reject) => {
          const go = (): void => {
            setTimeout(() => {
              this.pending = undefined;
              if (ring.failConnects > 0) {
                ring.failConnects--;
                log.push('connect failed');
                return reject(Object.assign(new Error('Connection attempt failed.'), { name: 'NetworkError' }));
              }
              this.gatt.connected = true;
              log.push('connected');
              resolve(this.gatt);
            }, ring.connectMs);
          };
          if (ring.inReach) go();
          else waiting = go;
        });
        return this.pending;
      },
      // as Chromium: does nothing until connected
      disconnect: (): void => {
        if (!this.gatt.connected) return;
        log.push('gatt.disconnect');
        this.gatt.connected = false;
      },
      getPrimaryService: async () => ({}),
    };
    /** The ring dropped the link (out of reach, or it timed out). */
    drop(): void {
      ring.inReach = false;
      this.gatt.connected = false;
      this.dispatchEvent(new Event('gattserverdisconnected'));
    }
  }
  const device = new Device();
  const back = (): void => {
    ring.inReach = true;
    const w = waiting;
    waiting = undefined;
    w?.();
  };

  // ---- Chromium: one request per page
  let n = 0;
  let open: { end(): void } | undefined;
  const requestDevice = vi.fn(
    () =>
      new Promise<Device>((resolve, reject) => {
        log.push('requestDevice');
        const prev = open;
        open = undefined;
        prev?.end();
        const s = script(n++);
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const me = {
          end() {
            if (done) return;
            done = true;
            if (!s.listSurvivesEnd) clearTimeout(timer);
            setTimeout(() => reject(notFound()), s.cancelLatencyMs ?? 0);
          },
        };
        open = me;
        const chosen = (id: string): void => {
          if (done) return;
          done = true;
          if (open === me) open = undefined;
          log.push(`chose:${id}`);
          if (!id) return reject(notFound());
          granted = true;
          resolve(device);
        };
        if (s.resolveAfterMs !== undefined) timer = setTimeout(() => chosen(ADDRESS), s.resolveAfterMs);
        else if (s.listAfterMs !== null) timer = setTimeout(() => select?.({ preventDefault: () => {} }, [{ deviceId: ADDRESS, deviceName: device.name }], chosen), s.listAfterMs);
      }),
  );
  vi.stubGlobal('navigator', { ...globalThis.navigator, bluetooth: { requestDevice, getAvailability: async () => true } });
  const transport = () => createElectronTransport(() => bluetoothBridge(ipcRenderer));
  return { transport, device, ring, back, requestDevice, log };
}

/** Runs `p` while the fake clock moves, and resolves with its result (or its error) and the time it took. */
async function timed<T>(p: Promise<T>, maxMs = 200_000): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = Date.now();
  let out: { value?: T; error?: unknown } | undefined;
  p.then((value) => (out = { value }), (error: unknown) => (out = { error }));
  while (!out && Date.now() - t0 < maxMs) await vi.advanceTimersByTimeAsync(100);
  return { ...(out ?? { error: new Error('still pending') }), ms: Date.now() - t0 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop reconnect', () => {
  it('reproduction: once BlueZ knows the ring a new request may never list it, so a reconnect by request alone fails', async () => {
    // a fresh page (no device kept) can only look for the ring with requests, and these never list it
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : null }));
    const first = await timed(w.transport().requestDevice(query, { scanMs: 20_000 }));
    expect(first.value?.deviceId).toBe(ADDRESS);
    await first.value!.disconnect();
    const again = await timed(w.transport().reconnect!(ADDRESS, query));
    expect(again.error).toEqual(new NoDeviceError('not_found'));
    expect(again.ms).toBeGreaterThanOrEqual(15_000);
  });

  it('Disconnect then Connect: reconnects through the kept device without a request, though no request lists the ring', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : null }));
    const t = w.transport();
    const link = (await timed(t.requestDevice(query, { scanMs: 20_000 }))).value!;
    await link.disconnect();
    w.requestDevice.mockClear();
    w.log.length = 0;
    const again = await timed(t.reconnect!(ADDRESS, query));
    expect(again.value?.deviceId).toBe(ADDRESS);
    // BlueZ still holds the link ~2 s after the page lets go: the connect waits for it (Lumen: disconnect, wait, close)
    expect(again.ms).toBeGreaterThanOrEqual(LINK_RELEASE_MS);
    expect(again.ms).toBeLessThan(LINK_RELEASE_MS + 2_000);
    expect(w.log).toEqual(['gatt.connect', 'connected']);
    expect(w.requestDevice).not.toHaveBeenCalled();
    // the new link reports the next drop
    const dropped = vi.fn();
    again.value!.onDisconnect(dropped);
    w.device.drop();
    expect(dropped).toHaveBeenCalledOnce();
  });

  it('a drop, then the ring is back after 8 s: the retry connects as soon as it is in reach (R5-02)', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : null }));
    const t = w.transport();
    const link = (await timed(t.requestDevice(query, { scanMs: 20_000 }))).value!;
    const dropped = vi.fn();
    link.onDisconnect(dropped);
    w.device.drop();
    expect(dropped).toHaveBeenCalledOnce();
    await link.disconnect(); // the service closes the dropped session
    setTimeout(w.back, 8_000);
    const again = await timed(t.reconnect!(ADDRESS, query));
    expect(again.value?.deviceId).toBe(ADDRESS);
    expect(again.ms).toBeLessThan(REOPEN_MS);
  });

  it('the kept device does not connect in time: a new request finds the ring and takes over the pending connect', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : 3_000 }));
    const t = w.transport();
    const link = (await timed(t.requestDevice(query, { scanMs: 20_000 }))).value!;
    w.device.drop();
    await link.disconnect();
    setTimeout(w.back, REOPEN_MS + 4_000); // after the request has chosen the ring
    w.log.length = 0;
    const again = await timed(t.reconnect!(ADDRESS, query));
    expect(again.value?.deviceId).toBe(ADDRESS);
    // the connect given up is not repeated: the request's device waits on the same pending connect
    expect(w.log).toEqual(['gatt.connect', 'requestDevice', `chose:${ADDRESS}`, 'connected']);
    expect(w.device.gatt.connected).toBe(true);
    expect(again.ms).toBeLessThan(REOPEN_MS + 15_000);
  });

  it('a stop while the kept device connects opens no request, and the connect that lands later is let go', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : 0 }));
    const t = w.transport();
    const link = (await timed(t.requestDevice(query, { scanMs: 20_000 }))).value!;
    w.device.drop();
    await link.disconnect();
    w.requestDevice.mockClear();
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 2_000);
    const again = await timed(t.reconnect!(ADDRESS, query, { signal: ctl.signal }));
    expect(again.error).toEqual(new NoDeviceError('cancelled'));
    expect(w.requestDevice).not.toHaveBeenCalled();
    // Chromium cannot cancel the pending connect: when the ring comes back BlueZ completes it, and nobody holds it
    w.back();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.log.slice(-2)).toEqual(['connected', 'gatt.disconnect']);
    expect(w.device.gatt.connected).toBe(false);
  });

  it('a timeout while the kept device connects, then a retry: the retry waits on the same connect and keeps the link', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : null }));
    const t = w.transport();
    const link = (await timed(t.requestDevice(query, { scanMs: 20_000 }))).value!;
    w.device.drop();
    await link.disconnect();
    // first try: the ring stays away past REOPEN_MS, then the request finds nothing
    const one = await timed(t.reconnect!(ADDRESS, query));
    expect(one.error).toEqual(new NoDeviceError('not_found'));
    w.log.length = 0;
    setTimeout(w.back, 3_000);
    const two = await timed(t.reconnect!(ADDRESS, query));
    expect(two.value?.deviceId).toBe(ADDRESS);
    expect(w.log).toEqual(['connected']);
    expect(w.device.gatt.connected).toBe(true);
  });

  it('a request given up before any list that Chromium still answers with the ring: that link is let go', async () => {
    const w = world(() => ({ listAfterMs: null, resolveAfterMs: 16_000 }));
    const one = await timed(w.transport().reconnect!(ADDRESS, query));
    expect(one.error).toEqual(new NoDeviceError('not_found'));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(w.log).toEqual(['requestDevice', `chose:${ADDRESS}`, 'gatt.connect', 'connected', 'gatt.disconnect']);
    expect(w.device.gatt.connected).toBe(false);
  });

  it('at start (J1-07): no device kept, the ring is listed only after 6 s, under a stored id in another case', async () => {
    const w = world(() => ({ listAfterMs: 6_000 }));
    const again = await timed(w.transport().reconnect!(ADDRESS.toLowerCase(), query));
    // answered with the bridge's own form of the address, and that form is the link's id
    expect(w.log).toContain(`chose:${ADDRESS}`);
    expect(again.value?.deviceId).toBe(ADDRESS);
    expect(again.ms).toBeLessThan(15_000);
  });

  it('a request given up before any list does not eat the next request\'s list when Chromium\'s cancel arrives late', async () => {
    // retry 1 hears nothing within 15 s; Chromium ends it when retry 2 opens, but that cancel reaches the page after
    // retry 2's list (separate pipes)
    const w = world((n) => (n === 0 ? { listAfterMs: null, cancelLatencyMs: 50 } : { listAfterMs: 0 }));
    const t = w.transport();
    const one = await timed(t.reconnect!(ADDRESS, query));
    expect(one.error).toEqual(new NoDeviceError('not_found'));
    const two = await timed(t.reconnect!(ADDRESS, query));
    expect(two.value?.deviceId).toBe(ADDRESS);
    expect(w.log.filter((x) => x.startsWith('chose:'))).toEqual([`chose:${ADDRESS}`]);
  });

  it('a write that never completes drops the link after OP_TIMEOUT_MS (Lumen recoverWedgedLink)', async () => {
    const w = world(() => ({ listAfterMs: 300 }));
    const link = (await timed(w.transport().requestDevice(query, { scanMs: 20_000 }))).value!;
    const dropped = vi.fn();
    link.onDisconnect(dropped);
    const ch = { properties: { write: true }, writeValueWithResponse: () => new Promise<void>(() => {}), writeValueWithoutResponse: () => new Promise<void>(() => {}) };
    (w.device.gatt as unknown as { getPrimaryService: unknown }).getPrimaryService = async () => ({ getCharacteristic: async () => ch });
    const r = await timed(link.write(0xfff0, 0xfff6, Uint8Array.of(1)));
    expect(r.error).toMatchObject({ name: 'NetworkError' });
    expect(r.ms).toBeGreaterThanOrEqual(OP_TIMEOUT_MS);
    expect(r.ms).toBeLessThan(OP_TIMEOUT_MS + 500);
    expect(dropped).toHaveBeenCalledOnce();
    expect(w.log.at(-1)).toBe('gatt.disconnect');
  });

  it('the service path (chooser factory): Disconnect then Connect again within the 5 s retry step', async () => {
    const w = world((n) => ({ listAfterMs: n === 0 ? 300 : null }));
    const factory = chooserFactory(w.transport(), 'electron');
    const signal = new AbortController().signal;
    const first = (await timed(factory.connect({ platformId: ADDRESS }, jstyle2301, signal))).value!;
    expect(first.peripheral.address).toBe(ADDRESS);
    await first.disconnect();
    const again = await timed(factory.connect({ platformId: ADDRESS }, jstyle2301, signal));
    expect(again.value?.peripheral.address).toBe(ADDRESS);
    expect(again.ms).toBeLessThan(5_000);
  });

  it('a ring listed just before the looking time ends: the connect after the pick is not cut off (DESKSCAN)', async () => {
    // the reconnect looks 15 s; the ring is heard at 14 s and BlueZ takes 9 s to connect a ring that advertises rarely
    const w = world(() => ({ listAfterMs: 14_000 }));
    w.ring.connectMs = 9_000;
    const t = w.transport();
    const r = await timed(t.reconnect!(ADDRESS, query));
    expect(r.value?.deviceId).toBe(ADDRESS);
    expect(r.ms).toBeGreaterThan(20_000);
    expect(w.log).toEqual(['requestDevice', `chose:${ADDRESS}`, 'gatt.connect', 'connected']);
    // no second request was opened over the connect (its scan made BlueZ abort the connect on the real PC)
    expect(w.requestDevice).toHaveBeenCalledOnce();
  });

  it('a tapped ring BlueZ does not reach in one 40 s try is tried again within the same tap (DESKSCAN)', async () => {
    const w = world(() => ({ listAfterMs: 2_000 }));
    w.ring.connectMs = 40_000;
    w.ring.failConnects = 1;
    const factory = chooserFactory(w.transport(), 'electron');
    const ctl = new AbortController();
    const scanned = factory.scan([jstyle2301], () => {}, ctl.signal);
    await vi.advanceTimersByTimeAsync(3_000);
    const r = await timed(factory.connect({ platformId: ADDRESS }, undefined, ctl.signal));
    expect(r.value?.peripheral.address).toBe(ADDRESS);
    expect(w.log).toEqual(['requestDevice', `chose:${ADDRESS}`, 'gatt.connect', 'connect failed', 'gatt.connect', 'connected']);
    expect(w.requestDevice).toHaveBeenCalledOnce();
    await timed(scanned);
  });

  it('a ring BlueZ never reaches: the tap fails once the connect time is up, and no retry runs on', async () => {
    const w = world(() => ({ listAfterMs: 2_000 }));
    w.ring.connectMs = 40_000;
    w.ring.failConnects = 99;
    const t = w.transport();
    const r = await timed(t.requestDevice(query, { scanMs: 20_000 }), 400_000);
    expect(r.error).toBeDefined();
    expect(r.ms).toBeLessThan(PICKED_CONNECT_MS + 45_000);
    const tries = w.log.filter((x) => x === 'gatt.connect').length;
    expect(tries).toBe(3);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(w.log.filter((x) => x === 'gatt.connect').length).toBe(tries);
  });

  it('a connect Chromium refuses at once is not tried again and again (no spinning)', async () => {
    const w = world(() => ({ listAfterMs: 2_000 }));
    w.ring.connectMs = 0;
    w.ring.failConnects = 99;
    const r = await timed(w.transport().requestDevice(query, { scanMs: 20_000 }));
    expect(r.error).toBeDefined();
    expect(w.log.filter((x) => x === 'gatt.connect')).toHaveLength(1);
  });

  it('the desktop list: a tap late in a request connects through it, however long the connect takes (up to its limit)', async () => {
    const w = world(() => ({ listAfterMs: 50_000 }));
    w.ring.connectMs = 20_000;
    const factory = chooserFactory(w.transport(), 'electron');
    const ctl = new AbortController();
    const listed: string[] = [];
    const scanned = factory.scan([jstyle2301], (ad) => listed.push(ad.platformId!), ctl.signal);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(listed).toEqual([ADDRESS]);
    const r = await timed(factory.connect({ platformId: ADDRESS }, undefined, ctl.signal));
    expect(r.value?.peripheral.address).toBe(ADDRESS);
    expect(r.ms).toBeGreaterThanOrEqual(20_000);
    expect(w.requestDevice).toHaveBeenCalledOnce();
    await timed(scanned);
    expect(PICKED_CONNECT_MS).toBeGreaterThan(r.ms);
  });

  it('a request answered on a stale list whose own list never comes ends at its time limit; later reconnects are not blocked', async () => {
    // retry 1 hears nothing within 15 s and is given up; its list was in flight when retry 2 opened, so retry 2 answers
    // that list and Chromium never resolves retry 2 (the answer went to a dead callback)
    const w = world((n) => (n === 0 ? { listAfterMs: 15_150, listSurvivesEnd: true } : { listAfterMs: null }));
    const t = w.transport();
    const one = await timed(t.reconnect!(ADDRESS, query));
    expect(one.error).toEqual(new NoDeviceError('not_found'));
    const two = await timed(t.reconnect!(ADDRESS, query), 120_000);
    const three = await timed(t.reconnect!(ADDRESS, query), 60_000);
    expect(two.error).toEqual(new NoDeviceError('not_found'));
    expect(two.ms).toBeLessThan(16_000);
    expect(three.error).toEqual(new NoDeviceError('not_found'));
    expect(three.ms).toBeLessThan(16_000);
  });
});
