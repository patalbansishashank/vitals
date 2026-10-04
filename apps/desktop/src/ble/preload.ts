/**
 * Preload half of the Bluetooth bridge. L-DESKTOP's preload exposes it:
 *
 *   contextBridge.exposeInMainWorld('vitalsDesktop', { bluetooth: bluetoothBridge(ipcRenderer), ... });
 *
 * Typed by the slice of `ipcRenderer` it uses, so it needs no Electron types and tests can pass a fake.
 */
import { BLE_CHANNELS, type BridgeDevice, type DesktopBluetoothBridge } from './contract';

export interface IpcRendererLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  send(channel: string, ...args: unknown[]): void;
}

const ACTIVATE_WAIT_MS = 2_000;
let seq = 0;

export function bluetoothBridge(ipc: IpcRendererLike): DesktopBluetoothBridge {
  return {
    onDevices(cb) {
      const listener = (_e: unknown, list: unknown): void => {
        if (Array.isArray(list)) cb(list.filter((d): d is BridgeDevice => typeof (d as BridgeDevice)?.id === 'string').map((d) => ({ id: d.id, ...(d.name ? { name: String(d.name) } : {}) })));
      };
      ipc.on(BLE_CHANNELS.devices, listener);
      return () => void ipc.removeListener(BLE_CHANNELS.devices, listener);
    },
    choose(id) {
      ipc.send(BLE_CHANNELS.choose, typeof id === 'string' ? id : null);
    },
    activate() {
      const token = `${Date.now()}-${++seq}`;
      return new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          ipc.removeListener(BLE_CHANNELS.activated, listener);
          resolve();
        };
        const listener = (_e: unknown, t: unknown): void => {
          if (t === token) done();
        };
        // an old main process that does not answer must not hold the request up
        const timer = setTimeout(done, ACTIVATE_WAIT_MS);
        ipc.on(BLE_CHANNELS.activated, listener);
        ipc.send(BLE_CHANNELS.activate, token);
      });
    },
  };
}
