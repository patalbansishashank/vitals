// @vitest-environment node
/** Real SQLite quarantine lifecycle: a clock moves backward after a durable write. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNodeEvoluPlatform } from '../../../packages/companion/src/evoluNode';
import { startCompanion } from '../../../packages/companion/src/server';
import { newOwnerSecret } from '../pairing';
import type { SyncStore } from '../types';
import { createEvoluSyncStore } from './adapter';

describe('clock drift through the real adapter', () => {
  it('keeps local quarantine pending across relay acknowledgement and reload, then recovers or erases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitals-drift-'));
    const realNow = Date.now.bind(Date);
    let offset = 600000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    const secret = newOwnerSecret();
    const lifecycle: { active: SyncStore | null; stopRelay: (() => Promise<void>) | null } = {
      active: null,
      stopRelay: null,
    };
    const open = async (relayUrl: string | null) => {
      const store = createEvoluSyncStore({
        platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'drift-proof' }),
        appName: 'vitalsDriftProof',
      });
      lifecycle.active = store;
      await store.open({ secret, relayUrl, deviceId: 'DEVICEDRIFTPROOF', memoryOnly: false });
      return store;
    };
    const until = async (predicate: () => boolean) => {
      const start = realNow();
      while (!predicate()) {
        if (realNow() - start > 15000) throw new Error('Clock drift adapter condition timed out');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    try {
      let store = await open(null);
      await store.put('kv', 'baseline', { text: 'C-SYNCX fast clock baseline' });
      await store.close();
      lifecycle.active = null;
      offset = 0;
      store = await open(null);
      await store.put('kv', 'waiting', { text: 'C-SYNCX waiting write' });
      await until(() => store.status().lastError?.code === 'clock_drift');
      expect(store.status().state).toBe('error');
      expect(store.status().pendingChanges).toBeGreaterThan(0);

      const relay = await startCompanion({
        port: 0,
        dataDir: join(dir, 'relay'),
        allowedOrigins: [],
        log: () => {},
      });
      lifecycle.stopRelay = () => relay.close();
      const relayUrl = `http://127.0.0.1:${relay.port}`;
      const relayStates: string[] = [];
      const stopStates = store.onStatus((status) => relayStates.push(status.state));
      await store.setRelay(relayUrl);
      await store.push();
      // The overlay retains the transport's successful-round time, proving an acknowledgement actually happened.
      await until(() => store.status().lastSyncedAt !== null);
      expect(store.status().lastError?.code).toBe('clock_drift');
      expect(store.status().pendingChanges).toBeGreaterThan(0);
      expect(relayStates).not.toContain('synced');
      stopStates();
      await store.close();
      lifecycle.active = null;
      store = await open(null);
      expect(store.status().lastError?.code).toBe('clock_drift');
      expect(store.status().pendingChanges).toBeGreaterThan(0);
      // The optimistic local body was durable quarantine, not an applied application row.
      expect(await store.get('kv', 'waiting')).toBeNull();
      await store.close();
      lifecycle.active = null;

      offset = 600000;
      store = await open(null);
      expect((await store.get<{ text: string }>('kv', 'waiting'))?.value.text).toBe('C-SYNCX waiting write');
      expect(store.status().lastError?.code).not.toBe('clock_drift');
      // With quarantine released, this count can only come from persisted device-local outbox markers.
      expect(store.status().pendingChanges).toBeGreaterThan(0);
      await store.setRelay(relayUrl);
      await until(() => store.status().state === 'synced' && store.status().pendingChanges === 0);
      await store.close();
      lifecycle.active = null;

      offset = 0;
      store = await open(null);
      await store.put('kv', 'erase-waiting', { text: 'C-SYNCX erase probe' });
      await until(() => store.status().lastError?.code === 'clock_drift');
      await store.eraseLocal();
      expect(store.status().state).toBe('off');
      expect(store.status().lastError).toBeUndefined();
      expect(store.status().pendingChanges).toBe(0);
      lifecycle.active = null;
    } finally {
      try {
        await lifecycle.active?.close();
      } finally {
        try {
          await lifecycle.stopRelay?.();
        } finally {
          clock.mockRestore();
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }, 60000);
});
