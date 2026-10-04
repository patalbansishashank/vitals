/**
 * Web Bluetooth driver registry (SUITE_SPEC §4.6). Tier H. One driver per `@vitals/rings` family in its order (J-Style
 * 2301 first, R10 §6), then Colmi on the old runner until a Colmi family lands (it keeps the stored id `colmi-r02`).
 */
import { RING_FAMILIES } from '@vitals/rings';
import type { BleDriver } from '@/biometrics/core/ble/types';
import { colmiDriver, familyDriver, jstyle2301Driver } from './drivers';

export const BLE_DRIVERS: readonly BleDriver[] = [
  ...RING_FAMILIES.map((f) => (f.id === 'jstyle2301' ? jstyle2301Driver : familyDriver(f))),
  ...(RING_FAMILIES.some((f) => f.id === 'colmi') ? [] : [colmiDriver]),
];

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
    const byName = BLE_DRIVERS.find((d) => d.requestOptions.filters.some((f) => (f.namePrefix && n.startsWith(f.namePrefix)) || (f.name && n === f.name)));
    if (byName) return byName;
  }
  const uuids = new Set(services.map((s) => s.toLowerCase()));
  if (!uuids.size) return undefined;
  return BLE_DRIVERS.find((d) => d.requestOptions.filters.some((f) => f.services?.some((s) => uuids.has(String(s).toLowerCase()))));
}
