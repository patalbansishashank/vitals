/**
 * The runtime's reaction to a lost and a regained relay: "Sync now" and the network coming back ask the engine for a
 * fresh socket when it is not connected (Evolu's own back-off is up to 30 s), and an engine that gets back to Synced on
 * its own starts an `online` round (queued uploads go out at once, the scheduler back-off resets).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus, SyncStore } from '@/sync/types';

const RELAY = 'https://relay.example.ts.net';

async function boot() {
  vi.resetModules();
  const store = await import('@/store');
  const rt = await import('@/state/runtime');
  const { createSyncRuntime } = await import('@/state/sync/controller');
  const { createMemoryVault } = await import('@/state/sync/vault');
  const { createMemorySyncStore } = await import('@/sync/memoryStore');
  const device = 'DEVICEA000000000';
  const local = store.createMemoryBackend({ device });
  rt.setDocumentStore(store.createDocumentStore({ backend: local, device }));
  await rt.bootDocuments();
  const probe = { reconnects: 0, pulls: 0, forced: null as SyncStatus['state'] | null, emit: (_s: SyncStatus['state']) => {} };
  const sync = createSyncRuntime({
    vault: createMemoryVault(),
    createEngine: async () => {
      const base = createMemorySyncStore();
      const listeners = new Set<(s: SyncStatus) => void>();
      base.onStatus((s) => {
        for (const l of listeners) l(s);
      });
      const status = () => (probe.forced ? { ...base.status(), state: probe.forced } : base.status());
      probe.emit = (state) => {
        probe.forced = state;
        for (const l of listeners) l(status());
      };
      const e: SyncStore = Object.assign(Object.create(base) as SyncStore, {
        status,
        onStatus: (l: (s: SyncStatus) => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        pull: async () => {
          probe.pulls += 1;
          return base.pull();
        },
        reconnect: async () => {
          probe.reconnects += 1;
        },
      });
      return e;
    },
    localBackend: () => local,
  });
  return { sync, probe };
}

beforeEach(() => localStorage.clear());

describe('sync runtime: relay lost and regained', { timeout: 30_000 }, () => {
  it('"Sync now" asks an offline engine for a fresh socket, and leaves a connected one alone', async () => {
    const { sync, probe } = await boot();
    await sync.pair(RELAY);
    await sync.syncNow();
    expect(probe.reconnects).toBe(0);
    probe.emit('offline');
    await sync.syncNow();
    expect(probe.reconnects).toBe(1);
    probe.emit('error');
    await sync.syncNow();
    expect(probe.reconnects).toBe(2);
    probe.emit('syncing');
    await sync.syncNow();
    expect(probe.reconnects).toBe(2);
  });

  it('an engine that gets back to Synced on its own starts an online round', async () => {
    const { sync, probe } = await boot();
    await sync.pair(RELAY);
    await sync.syncNow();
    probe.emit('synced');
    await vi.waitFor(() => expect(probe.pulls).toBeGreaterThan(0));
    const before = probe.pulls;
    probe.emit('offline');
    expect(probe.pulls).toBe(before);
    probe.emit('synced');
    await vi.waitFor(() => expect(probe.pulls).toBeGreaterThan(before));
  });
});
