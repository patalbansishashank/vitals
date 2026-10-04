/**
 * Main-process half of the desktop app's Bluetooth (R21: Chromium's Web Bluetooth inside Electron, on BlueZ for
 * Linux). L-DESKTOP calls `enableWebBluetooth(app)` before `app.whenReady()` and `attachBluetooth(win.webContents,
 * ipcMain)` for the main window. Typed by the slices of Electron it uses, so it needs no Electron types and tests can
 * pass fakes.
 *
 * Chromium has no chooser window inside Electron: `select-bluetooth-device` fires (again each time the list grows) and
 * the app must answer through the latest callback. The list goes to the page, whose scan list or auto-pick answers.
 */
import { BLE_CHANNELS, type BridgeDevice } from './contract';

/** Chromium switches Web Bluetooth needs on Linux (R21a). Windows and macOS have it on already; the switch is harmless there. */
export const BLUETOOTH_SWITCHES: readonly string[] = ['enable-experimental-web-platform-features'];

export interface AppLike {
  commandLine: { appendSwitch(name: string, value?: string): void };
}

export interface ElectronBluetoothDevice {
  deviceId: string;
  deviceName?: string;
}
type SelectListener = (event: { preventDefault(): void }, list: ElectronBluetoothDevice[], callback: (deviceId: string) => void) => void;

export interface WebContentsLike {
  readonly id: number;
  on(event: 'select-bluetooth-device', listener: SelectListener): unknown;
  removeListener(event: 'select-bluetooth-device', listener: SelectListener): unknown;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
  /** With `userGesture` the page counts as clicked for a few seconds (R21a: reconnect without a click). */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getURL?(): string;
}

export interface AttachOptions {
  /**
   * Which page may be given a click's worth of activation (the app's own origin). Without it any page the window shows
   * gets it; L-DESKTOP should pass it and also keep the window from navigating away.
   */
  allowActivation?: (url: string) => boolean;
}

type ChooseListener = (event: { sender: { id: number } }, arg: unknown) => void;
export interface IpcMainLike {
  on(channel: string, listener: ChooseListener): unknown;
  removeListener(channel: string, listener: ChooseListener): unknown;
}

/** Call once, before the app is ready. */
export function enableWebBluetooth(app: AppLike): void {
  for (const s of BLUETOOTH_SWITCHES) app.commandLine.appendSwitch(s);
}

/** Wires one window. Returns a function that unwires it (and cancels an open request). */
export function attachBluetooth(wc: WebContentsLike, ipc: IpcMainLike, opts: AttachOptions = {}): () => void {
  let answer: ((deviceId: string) => void) | null = null;

  const onSelect: SelectListener = (event, list, callback) => {
    event.preventDefault();
    answer = callback;
    const devices: BridgeDevice[] = list.map((d) => ({ id: d.deviceId, ...(d.deviceName ? { name: d.deviceName } : {}) }));
    if (!wc.isDestroyed()) wc.send(BLE_CHANNELS.devices, devices);
  };

  const onChoose: ChooseListener = (event, id) => {
    if (event.sender.id !== wc.id || !answer) return;
    const a = answer;
    answer = null;
    // an empty id cancels the request; the page sees a NotFoundError
    a(typeof id === 'string' ? id : '');
  };

  const onActivate: ChooseListener = (event, token) => {
    if (event.sender.id !== wc.id || wc.isDestroyed()) return;
    const reply = (): void => {
      if (!wc.isDestroyed()) wc.send(BLE_CHANNELS.activated, token);
    };
    // another page: answer at once without activation (its request then fails as it would in a browser)
    if (opts.allowActivation && !opts.allowActivation(wc.getURL?.() ?? '')) return reply();
    Promise.resolve()
      .then(() => wc.executeJavaScript('0', true))
      .then(reply, reply);
  };

  wc.on('select-bluetooth-device', onSelect);
  ipc.on(BLE_CHANNELS.choose, onChoose);
  ipc.on(BLE_CHANNELS.activate, onActivate);
  return () => {
    wc.removeListener('select-bluetooth-device', onSelect);
    ipc.removeListener(BLE_CHANNELS.choose, onChoose);
    ipc.removeListener(BLE_CHANNELS.activate, onActivate);
    const a = answer;
    answer = null;
    a?.('');
  };
}
