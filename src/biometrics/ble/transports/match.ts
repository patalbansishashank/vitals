/**
 * Web Bluetooth's scan filters applied to an advertisement by hand, for transports that scan without the browser's
 * chooser (Capacitor, a main-process scan). Tier P.
 */
import type { BluetoothLEScanFilter, BluetoothServiceUUID } from '@/biometrics/core/ble/types';

/** 16- or 32-bit short ids and full UUIDs, as one lower-case 128-bit string. */
export function fullUuid(u: BluetoothServiceUUID): string {
  if (typeof u === 'number') return `${u.toString(16).padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
  const s = u.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

export interface Advertisement {
  name?: string;
  services?: readonly string[];
  /** Company id → payload after the id. */
  manufacturerData?: ReadonlyMap<number, Uint8Array> | Readonly<Record<number, Uint8Array>>;
}

const mfr = (a: Advertisement, id: number): Uint8Array | undefined => {
  const m = a.manufacturerData;
  if (!m) return undefined;
  return m instanceof Map ? m.get(id) : (m as Readonly<Record<number, Uint8Array>>)[id];
};

function prefixMatches(data: Uint8Array, prefix?: Uint8Array, mask?: Uint8Array): boolean {
  if (!prefix) return true;
  if (data.length < prefix.length) return false;
  return prefix.every((p, i) => (data[i]! & (mask?.[i] ?? 0xff)) === (p & (mask?.[i] ?? 0xff)));
}

/** One filter matches when all of its parts match; the list matches when any filter does. An empty list matches all. */
export function matchesFilters(a: Advertisement, filters: readonly BluetoothLEScanFilter[]): boolean {
  if (filters.length === 0) return true;
  const services = new Set((a.services ?? []).map(fullUuid));
  return filters.some((f) => {
    if (f.name !== undefined && a.name !== f.name) return false;
    if (f.namePrefix !== undefined && !(a.name ?? '').startsWith(f.namePrefix)) return false;
    if (f.services && !f.services.every((s) => services.has(fullUuid(s)))) return false;
    if (f.manufacturerData && !f.manufacturerData.every((m) => {
      const d = mfr(a, m.companyIdentifier);
      return d !== undefined && prefixMatches(d, m.dataPrefix, m.mask);
    })) return false;
    return f.name !== undefined || f.namePrefix !== undefined || !!f.services?.length || !!f.manufacturerData?.length;
  });
}
