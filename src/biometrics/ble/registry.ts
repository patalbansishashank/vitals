/** Web Bluetooth driver registry (SUITE_SPEC §4.6). Tier H. Order = R10 §6: J-Style 2301 first, then Colmi. */
import type { BleDriver } from '@/biometrics/core/ble/types';
import { colmiDriver, jstyle2301Driver } from './drivers';

export const BLE_DRIVERS: readonly BleDriver[] = [jstyle2301Driver, colmiDriver];

export function getDriver(id: string): BleDriver | undefined {
  return BLE_DRIVERS.find((d) => d.id === id);
}

/**
 * Best driver for an advertised name, else for the advertised service UUIDs, or undefined.
 * The sync path does not need this: the screen requests a device for one driver and passes that driver's id on.
 * A J-Style 2301 is never matched by name (its name carries a retail brand); it matches on its FFF0 service.
 */
export function driverFor(deviceName: string | undefined, services: readonly string[] = []): BleDriver | undefined {
  const n = (deviceName ?? '').trim();
  if (n) {
    for (const d of BLE_DRIVERS) {
      if (d.requestOptions.filters.some((f) => (f.namePrefix && n.startsWith(f.namePrefix)) || (f.name && n === f.name))) return d;
    }
  }
  const uuids = new Set(services.map((s) => s.toLowerCase()));
  if (!uuids.size) return undefined;
  return BLE_DRIVERS.find((d) => d.requestOptions.filters.some((f) => f.services?.some((s) => uuids.has(String(s).toLowerCase()))));
}
