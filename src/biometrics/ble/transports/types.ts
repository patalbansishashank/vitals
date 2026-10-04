/**
 * One Bluetooth surface for three platforms (PLAN 04 decision 4, R21). Tier H types.
 *
 *   web        navigator.bluetooth in Chromium browsers (Chrome on Android, desktop Chrome and Edge); the browser's chooser
 *   capacitor  @capacitor-community/bluetooth-le inside the Android app; Vitals' own scan list
 *   electron   Chromium's Web Bluetooth inside the desktop app; the main process answers `select-bluetooth-device`
 *
 * Every transport hands back a `RingLink`: the `BleLink` a driver session talks through, plus a drop signal. Drivers
 * and sessions never know which transport they run on.
 */
import type { BleDriver, BleLink, BluetoothLEScanFilter, BluetoothServiceUUID } from '@/biometrics/core/ble/types';

export type TransportKind = 'web' | 'capacitor' | 'electron';

export interface RingLink extends BleLink {
  /** Fires once when the ring drops the link (or the platform closes it). */
  onDisconnect(cb: () => void): () => void;
  /** Platform id of the ring: a MAC on Android and Linux, an opaque id in browsers. Kept to reconnect later. */
  readonly deviceId?: string;
}

/** A ring seen while scanning. `name` is the ring's advertised name, shown as is in a scan list. */
export interface FoundDevice {
  id: string;
  name?: string;
  rssi?: number;
}

/** What to look for: a driver's `requestOptions` (filters are ORed, as in Web Bluetooth). */
export type DeviceQuery = Pick<BleDriver, 'requestOptions'> | { filters: BluetoothLEScanFilter[]; optionalServices: BluetoothServiceUUID[] };

export const queryOf = (q: DeviceQuery): { filters: BluetoothLEScanFilter[]; optionalServices: BluetoothServiceUUID[] } =>
  'requestOptions' in q ? q.requestOptions : q;

/**
 * A scan list the screen shows (Android app, desktop app). `update` gets the whole list each time it changes; `chosen`
 * resolves with the id the person tapped, or null when they close the list.
 */
export interface DeviceChooser {
  update(list: readonly FoundDevice[]): void;
  readonly chosen: Promise<string | null>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Without one: the browser's chooser (web), else the first matching ring found within `scanMs`. */
  chooser?: DeviceChooser;
  /** How long to look before giving up (default 20 s). */
  scanMs?: number;
}

export interface BleTransport {
  readonly kind: TransportKind;
  /** Bluetooth exists and is switched on (as far as the platform says). */
  isAvailable(): Promise<boolean>;
  /** Find a ring and connect to it. On the web this must be called inside the click. */
  requestDevice(query: DeviceQuery, opts?: RequestOptions): Promise<RingLink>;
  /** Connect to a ring found before, without asking again. Absent where the platform cannot (web today). */
  reconnect?(deviceId: string, query: DeviceQuery, opts?: { signal?: AbortSignal }): Promise<RingLink>;
}

/** Thrown when nothing was chosen or found; screens show it as "No ring found" rather than as a failure. */
export class NoDeviceError extends Error {
  constructor(readonly reason: 'cancelled' | 'not_found' | 'unavailable') {
    super(reason === 'cancelled' ? 'No ring chosen' : reason === 'not_found' ? 'No ring found nearby' : 'Bluetooth is not available');
    this.name = 'NoDeviceError';
  }
}
