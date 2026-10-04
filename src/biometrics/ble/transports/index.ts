/**
 * Picks the Bluetooth transport for where Vitals runs: the Android app → Capacitor; the desktop app → Electron;
 * otherwise Web Bluetooth when the browser has it; else none (the Ring page then says this browser can't reach a ring).
 */
import { isWebBluetoothAvailable } from '../webBluetooth';
import { createCapacitorTransport, type CapBleClient } from './capacitor';
import { desktopBridge, electronTransport } from './electron';
import type { BleTransport } from './types';
import { webTransport } from './web';

export * from './types';
export { webTransport } from './web';
export { electronTransport, createElectronTransport } from './electron';
export { createCapacitorTransport, type CapBleClient } from './capacitor';
export { matchesFilters, fullUuid } from './match';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

const isCapacitorNative = (): boolean => (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.() === true;

/** The plugin is loaded only inside the Android app, so the website never downloads it. */
export const capacitorTransport: BleTransport = createCapacitorTransport(
  async () => (await import('@capacitor-community/bluetooth-le')).BleClient as unknown as CapBleClient,
);

export function pickTransport(): BleTransport | undefined {
  if (isCapacitorNative()) return capacitorTransport;
  if (desktopBridge()) return electronTransport;
  if (isWebBluetoothAvailable()) return webTransport;
  return undefined;
}
