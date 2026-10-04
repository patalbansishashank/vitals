/**
 * The desktop app's Bluetooth bridge between the main process and the page (owned by L-XPORT; L-DESKTOP wires it).
 * The page's Electron transport (`src/biometrics/ble/transports/electron.ts`) declares the same shape structurally.
 *
 * Flow: the page calls `navigator.bluetooth.requestDevice(...)`; Chromium asks the main process to choose
 * (`select-bluetooth-device`); the main process sends every list to the page on `DEVICES`; the page's scan list (or
 * its auto-pick) answers on `CHOOSE` with a device id, or null to cancel.
 *
 * Chromium refuses `requestDevice` without a recent click. Reconnecting a remembered ring at start has none, so the page
 * first asks on `ACTIVATE` (with a token); the main process gives the page a click's worth of activation by running an
 * empty script with `userGesture` and answers on `ACTIVATED` with the same token.
 */
export const BLE_CHANNELS = {
  devices: 'vitals:ble:devices',
  choose: 'vitals:ble:choose',
  activate: 'vitals:ble:activate',
  activated: 'vitals:ble:activated',
} as const;

export interface BridgeDevice {
  id: string;
  name?: string;
}

/** What the preload exposes as `window.vitalsDesktop.bluetooth`. */
export interface DesktopBluetoothBridge {
  /** The page gets each new device list while a request is open. */
  onDevices(cb: (list: BridgeDevice[]) => void): () => void;
  /** Answer the open request: a device id, or null to cancel. */
  choose(id: string | null): void;
  /** Lets the page open a request without a click (reconnecting a remembered ring). Resolves within ~2 s either way. */
  activate(): Promise<void>;
}
