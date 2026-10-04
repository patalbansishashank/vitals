/* A stand-in for the `window.Capacitor` bridge and the `VitalsShell` plugin, for the android* tests. */
import { vi } from 'vitest';
import type { SharedFileEntry } from '../androidShell';

type Listener = (data: unknown) => void;

export function installFakeCapacitor(opts: { platform?: string; pending?: SharedFileEntry[]; contents?: Record<string, Blob> } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  let pending = [...(opts.pending ?? [])];
  const contents = { ...(opts.contents ?? {}) };
  const removes: Array<ReturnType<typeof vi.fn>> = [];
  const plugin = {
    keepAlive: vi.fn(async (_o: unknown) => ({})),
    notify: vi.fn(async (_o: unknown) => ({})),
    clearNotice: vi.fn(async (_o: unknown) => ({})),
    setPrefs: vi.fn(async (_o: unknown) => ({})),
    getState: vi.fn(async () => ({ bluetoothOn: true, notificationsAllowed: false, keepAliveOn: false, launchReason: 'share' as const })),
    requestNotificationPermission: vi.fn(async () => ({ granted: true })),
    takeSharedFiles: vi.fn(async () => {
      const files = pending;
      pending = [];
      return { files };
    }),
    batteryOptimisation: vi.fn(async () => ({ restricted: true })),
    openBatterySettings: vi.fn(async () => ({})),
    saveFile: vi.fn(async (_o: { name: string; mime: string; dataBase64: string }) => ({})),
    addListener: vi.fn(async (event: string, cb: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(cb);
      listeners.set(event, set);
      const remove = vi.fn(async () => void set.delete(cb));
      removes.push(remove);
      return { remove };
    }),
  };
  const cap = {
    isNativePlatform: () => (opts.platform ?? 'android') !== 'web',
    getPlatform: () => opts.platform ?? 'android',
    registerPlugin: vi.fn((_name: string) => plugin),
    convertFileSrc: (path: string) => `${location.origin}/_capacitor_file_${path}`,
  };
  (globalThis as { Capacitor?: unknown }).Capacitor = cap;
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(`${location.origin}/_capacitor_file_`, '');
    const blob = contents[path];
    return blob ? { ok: true, blob: async () => blob } : { ok: false, blob: async () => new Blob([]) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    cap,
    plugin,
    removes,
    fetchMock,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    emit: (event: string, data: unknown = {}) => listeners.get(event)?.forEach((l) => l(data)),
    share(entry: SharedFileEntry, blob: Blob) {
      pending.push(entry);
      contents[entry.path] = blob;
    },
  };
}

export function removeFakeCapacitor(): void {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
