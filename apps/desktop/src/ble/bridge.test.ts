/**
 * The desktop Bluetooth bridge end to end with fakes: page transport → preload → IPC → main → Chromium's
 * `select-bluetooth-device` → back. Chromium itself is a fake `navigator.bluetooth` that raises the select event.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachBluetooth, enableWebBluetooth, BLUETOOTH_SWITCHES, type ElectronBluetoothDevice, type IpcMainLike, type WebContentsLike } from './main';
import { bluetoothBridge, type IpcRendererLike } from './preload';
import { BLE_CHANNELS } from './contract';
import { createElectronTransport } from '@/biometrics/ble/transports/electron';
import { NoDeviceError, type DeviceChooser, type FoundDevice } from '@/biometrics/ble/transports/types';

type Listener = (event: unknown, ...args: unknown[]) => void;
type SelectListener = (event: { preventDefault(): void }, list: ElectronBluetoothDevice[], cb: (id: string) => void) => void;

/** One window: main-side webContents and ipcMain, page-side ipcRenderer, wired through in-memory channels. */
function fakeElectron() {
  const toPage = new Map<string, Set<Listener>>();
  const toMain = new Map<string, Set<Listener>>();
  const add = (m: Map<string, Set<Listener>>, ch: string, l: Listener) => (m.get(ch) ?? m.set(ch, new Set()).get(ch)!).add(l);
  let select: SelectListener | undefined;
  /** What the main process ran in the page (code, userGesture), in order with Chromium's requests (see stubChromium). */
  const ran: string[] = [];
  const wc: WebContentsLike = {
    id: 7,
    on: (_e, l) => (select = l),
    removeListener: () => (select = undefined),
    send: (ch, ...args) => toPage.get(ch)?.forEach((l) => l({}, ...args)),
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (code: string, gesture?: boolean) => {
      ran.push(`js:${code}:${gesture === true}`);
      return 0;
    }),
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
  /** Chromium raising `select-bluetooth-device` with a growing list; resolves with the chosen id ('' = cancel). */
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
  const sendFrom = (senderId: number, ch: string, ...args: unknown[]) => toMain.get(ch)?.forEach((l) => l({ sender: { id: senderId } }, ...args));
  return { wc, ipcMain, ipcRenderer, chromiumSelect, sendFrom, ran, selectAttached: () => select !== undefined };
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

function stubChromium(e: ReturnType<typeof fakeElectron>, lists: ElectronBluetoothDevice[][]) {
  const requestDevice = vi.fn(async () => {
    e.ran.push('requestDevice');
    const id = await e.chromiumSelect(lists);
    if (!id) throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' });
    const d = lists.flat().find((x) => x.deviceId === id)!;
    return new FakeDevice(d.deviceId, d.deviceName ?? '');
  });
  vi.stubGlobal('navigator', { ...globalThis.navigator, bluetooth: { requestDevice, getAvailability: async () => true } });
  return requestDevice;
}

/**
 * Chromium with one request per page: a new request cancels the open one. Each call raises its lists after `delay` ms
 * (none when `lists` is empty: discovery found nothing). `answers` records what the app answered ('' = cancel).
 */
function stubChromiumOneAtATime(e: ReturnType<typeof fakeElectron>, calls: { delay?: number; lists: ElectronBluetoothDevice[][] }[]) {
  const answers: string[] = [];
  let cancelOpen: (() => void) | undefined;
  let n = 0;
  const requestDevice = vi.fn(() => {
    cancelOpen?.();
    const c = calls[n++]!;
    return new Promise<FakeDevice>((resolve, reject) => {
      const cancel = (): void => reject(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }));
      cancelOpen = cancel;
      if (!c.lists.length) return;
      setTimeout(() => {
        void e.chromiumSelect(c.lists).then((id) => {
          answers.push(id);
          if (cancelOpen === cancel) cancelOpen = undefined;
          if (!id) return cancel();
          const d = c.lists.flat().find((x) => x.deviceId === id)!;
          resolve(new FakeDevice(d.deviceId, d.deviceName ?? ''));
        });
      }, c.delay ?? 0);
    });
  });
  vi.stubGlobal('navigator', { ...globalThis.navigator, bluetooth: { requestDevice, getAvailability: async () => true } });
  return { requestDevice, answers };
}

const query = { filters: [{ manufacturerData: [{ companyIdentifier: 0x1234 }] }], optionalServices: [0xfff0] };
const A = { deviceId: 'AA', deviceName: 'Ring A' };
const B = { deviceId: 'BB', deviceName: 'Ring B' };

afterEach(() => vi.unstubAllGlobals());

describe('desktop Bluetooth bridge', () => {
  it('appends the Web Bluetooth switches before ready', () => {
    const appendSwitch = vi.fn();
    enableWebBluetooth({ commandLine: { appendSwitch } });
    expect(appendSwitch.mock.calls.map((c) => c[0])).toEqual([...BLUETOOTH_SWITCHES]);
  });

  it('auto-picks the first ring when no chooser is given', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    stubChromium(e, [[], [A], [A, B]]);
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    expect(await t.isAvailable()).toBe(true);
    const link = await t.requestDevice(query, { scanMs: 1000 });
    expect(link.deviceId).toBe('AA');
    expect(link.deviceName).toBe('Ring A');
  });

  it('a chooser sees each list and its pick is connected', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    stubChromium(e, [[A], [A, B]]);
    const seen: FoundDevice[][] = [];
    let pick!: (id: string | null) => void;
    const chooser: DeviceChooser = {
      update: (l) => {
        seen.push([...l]);
        if (l.length === 2) pick('BB');
      },
      chosen: new Promise((r) => (pick = r)),
    };
    const link = await createElectronTransport(() => bluetoothBridge(e.ipcRenderer)).requestDevice(query, { chooser, scanMs: 1000 });
    expect(link.deviceId).toBe('BB');
    expect(seen).toEqual([[{ id: 'AA', name: 'Ring A' }], [{ id: 'AA', name: 'Ring A' }, { id: 'BB', name: 'Ring B' }]]);
  });

  it('closing the chooser cancels; nothing found times out as not_found', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    stubChromium(e, [[A]]);
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    let close!: (id: string | null) => void;
    const chooser: DeviceChooser = { update: () => close(null), chosen: new Promise((r) => (close = r)) };
    await expect(t.requestDevice(query, { chooser, scanMs: 1000 })).rejects.toEqual(new NoDeviceError('cancelled'));
    stubChromium(e, [[]]);
    const err = await t.requestDevice(query, { scanMs: 30 }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(NoDeviceError);
    expect((err as NoDeviceError).reason).toBe('not_found');
  });

  it('Chromium never lists: timeout rejects and the next request runs', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const chromium = stubChromiumOneAtATime(e, [{ lists: [] }, { delay: 5, lists: [[A]] }]);
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    // the ring is out of range: Electron raises no select event, so nothing can cancel Chromium's search yet
    const first = t.requestDevice(query, { scanMs: 20 }).catch((x: unknown) => x);
    const second = t.requestDevice(query, { scanMs: 1000 });
    expect(await first).toEqual(new NoDeviceError('not_found'));
    expect((await second).deviceId).toBe('AA');
    expect(chromium.requestDevice).toHaveBeenCalledTimes(2);
  });

  it('a stop before Chromium lists anything rejects at once; the late first list is cancelled and the next request runs', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const chromium = stubChromiumOneAtATime(e, [{ delay: 30, lists: [[B]] }, { delay: 0, lists: [[A]] }]);
    const ctl = new AbortController();
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    const p = t.requestDevice(query, { signal: ctl.signal, scanMs: 1000 });
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    await expect(p).rejects.toEqual(new NoDeviceError('cancelled'));
    expect(chromium.answers).toEqual([]);
    await new Promise((r) => setTimeout(r, 40));
    // the late list was answered with a cancel and nothing else
    expect(chromium.answers).toEqual(['']);
    expect((await t.requestDevice(query, { scanMs: 1000 })).deviceId).toBe('AA');
    expect(chromium.answers).toEqual(['', 'AA']);
  });

  it('requests run one at a time, and an aborted signal never opens one', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const rd = stubChromium(e, [[A, B]]);
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    const [l1, l2] = await Promise.all([t.reconnect!('AA', query), t.reconnect!('BB', query)]);
    expect([l1.deviceId, l2.deviceId]).toEqual(['AA', 'BB']);
    const ctl = new AbortController();
    ctl.abort();
    await expect(t.requestDevice(query, { signal: ctl.signal })).rejects.toEqual(new NoDeviceError('cancelled'));
    expect(rd).toHaveBeenCalledTimes(2);
  });

  it('a switched-off adapter is "unavailable" and opens no request', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const requestDevice = vi.fn();
    vi.stubGlobal('navigator', { ...globalThis.navigator, bluetooth: { requestDevice, getAvailability: async () => false } });
    await expect(createElectronTransport(() => bluetoothBridge(e.ipcRenderer)).requestDevice(query)).rejects.toEqual(new NoDeviceError('unavailable'));
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it('reconnect answers only the wanted ring', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    stubChromium(e, [[A], [A, B]]);
    const link = await createElectronTransport(() => bluetoothBridge(e.ipcRenderer)).reconnect!('BB', query);
    expect(link.deviceId).toBe('BB');
  });

  it('ignores answers from other windows and cancels an open request when detached', async () => {
    const e = fakeElectron();
    const detach = attachBluetooth(e.wc, e.ipcMain);
    const answered = e.chromiumSelect([[A]]);
    e.sendFrom(99, BLE_CHANNELS.choose, 'AA'); // another window: ignored
    detach();
    expect(await answered).toBe('');
    expect(e.selectAttached()).toBe(false);
  });

  it('the preload drops malformed device entries', () => {
    const e = fakeElectron();
    const got: FoundDevice[][] = [];
    bluetoothBridge(e.ipcRenderer).onDevices((l) => got.push(l));
    e.wc.send(BLE_CHANNELS.devices, [{ id: 'AA', name: 'Ring A' }, { name: 'no id' }, null, { id: 'BB' }]);
    expect(got).toEqual([[{ id: 'AA', name: 'Ring A' }, { id: 'BB' }]]);
  });
  it('every request first asks the main process for a click\'s worth of activation (reconnect at start has no click)', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    stubChromium(e, [[A, B]]);
    const t = createElectronTransport(() => bluetoothBridge(e.ipcRenderer));
    await t.reconnect!('BB', query);
    await t.requestDevice(query, { scanMs: 1000 });
    expect(e.ran).toEqual(['js:0:true', 'requestDevice', 'js:0:true', 'requestDevice']);
  });

  it('activation is answered only for its own window, with the token it was asked with, and not after detach', async () => {
    const e = fakeElectron();
    const detach = attachBluetooth(e.wc, e.ipcMain);
    const replies: unknown[] = [];
    e.ipcRenderer.on(BLE_CHANNELS.activated, (_ev, t) => replies.push(t));
    e.sendFrom(99, BLE_CHANNELS.activate, 'other');
    e.sendFrom(7, BLE_CHANNELS.activate, 'mine');
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toEqual(['mine']);
    expect(e.wc.executeJavaScript).toHaveBeenCalledTimes(1);
    detach();
    e.sendFrom(7, BLE_CHANNELS.activate, 'late');
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toEqual(['mine']);
  });

  it('the main process answers activation even when running the script fails', async () => {
    const e = fakeElectron();
    vi.mocked(e.wc.executeJavaScript).mockRejectedValueOnce(new Error('navigating'));
    attachBluetooth(e.wc, e.ipcMain);
    const replies: unknown[] = [];
    e.ipcRenderer.on(BLE_CHANNELS.activated, (_ev, t) => replies.push(t));
    e.sendFrom(7, BLE_CHANNELS.activate, 'x');
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toEqual(['x']);
  });

  it('the preload\'s activate resolves on its own token only, and gives up after two seconds without an answer', async () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const listeners = new Set<(e: unknown, ...a: unknown[]) => void>();
      const ipc: IpcRendererLike = {
        on: (_ch, l) => listeners.add(l),
        removeListener: (_ch, l) => listeners.delete(l),
        send: (_ch, token) => sent.push(token),
      };
      const bridge = bluetoothBridge(ipc);
      let done = false;
      void bridge.activate().then(() => (done = true));
      listeners.forEach((l) => l({}, 'someone-else'));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      listeners.forEach((l) => l({}, sent[0]));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect(listeners.size).toBe(0);
      let late = false;
      void bridge.activate().then(() => (late = true));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(late).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(late).toBe(true);
      expect(listeners.size).toBe(0);
      expect(sent[0]).not.toBe(sent[1]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('with allowActivation, only the app\'s own page is activated; another page gets an answer without activation', async () => {
    const e = fakeElectron();
    let url = 'https://evil.example/';
    e.wc.getURL = () => url;
    attachBluetooth(e.wc, e.ipcMain, { allowActivation: (u) => u.startsWith('app://vitals/') });
    const replies: unknown[] = [];
    e.ipcRenderer.on(BLE_CHANNELS.activated, (_ev, t) => replies.push(t));
    e.sendFrom(7, BLE_CHANNELS.activate, 'a');
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toEqual(['a']);
    expect(e.wc.executeJavaScript).not.toHaveBeenCalled();
    url = 'app://vitals/index.html';
    e.sendFrom(7, BLE_CHANNELS.activate, 'b');
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toEqual(['a', 'b']);
    expect(e.wc.executeJavaScript).toHaveBeenCalledWith('0', true);
  });

  it('a stop while waiting for activation opens no request', async () => {
    const e = fakeElectron();
    attachBluetooth(e.wc, e.ipcMain);
    const rd = stubChromium(e, [[A]]);
    const ctl = new AbortController();
    const bridge = bluetoothBridge(e.ipcRenderer);
    const slow = { ...bridge, activate: () => new Promise<void>((r) => setTimeout(r, 20)) };
    const p = createElectronTransport(() => slow).requestDevice(query, { signal: ctl.signal, scanMs: 1000 });
    ctl.abort();
    await expect(p).rejects.toEqual(new NoDeviceError('cancelled'));
    expect(rd).not.toHaveBeenCalled();
  });
});
