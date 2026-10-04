/**
 * Device-local boolean settings for the agent surfaces. Keys start with `vitals-` but not `vitals.`, so they are never
 * exported, imported or synced (persistence.ts only handles `vitals.*` keys): turning on an agent surface is a decision
 * for this browser on this computer only. Other tabs follow through the `storage` event.
 */
import { useSyncExternalStore } from 'react';

export interface DeviceFlag {
  readonly key: string;
  get(): boolean;
  set(value: boolean): void;
  subscribe(listener: () => void): () => void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createDeviceFlag(key: string, fallback = false): DeviceFlag {
  if (key.startsWith('vitals.')) throw new Error(`device-local key must not start with "vitals.": ${key}`);
  const listeners = new Set<() => void>();
  let memory: boolean | null = null;

  /** Storage is the source of truth; `memory` only covers a session where storage is missing or failing. */
  const get = (): boolean => {
    if (memory === null) {
      try {
        const s = storage();
        if (s) {
          const raw = s.getItem(key);
          return raw === 'true' ? true : raw === 'false' ? false : fallback;
        }
      } catch {
        // unreadable storage: use the default
      }
    }
    return memory ?? fallback;
  };
  const emit = () => listeners.forEach((l) => l());
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) emit();
  };

  const flag: DeviceFlag = {
    key,
    get,
    set(value) {
      try {
        const s = storage();
        if (!s) throw new Error('no storage');
        s.setItem(key, String(value));
        memory = null;
      } catch {
        // private mode / quota: the in-memory value applies for this session
        memory = value;
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
  return flag;
}

/** React binding: `[value, setValue]`. */
export function useDeviceFlag(flag: DeviceFlag): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(flag.subscribe, flag.get, flag.get);
  return [value, flag.set];
}
