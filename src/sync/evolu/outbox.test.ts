// @vitest-environment node
/**
 * The outbox through the real engine and the Companion's relay: "N changes waiting" is read from a device-local table,
 * so it survives a reload; and `reconnect()` gives a fresh socket that reaches Synced (the app calls it on `online`
 * and "Sync now" instead of waiting out Evolu's back-off).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeEvoluPlatform } from '../../../packages/companion/src/evoluNode';
import { startCompanion } from '../../../packages/companion/src/server';
import { newOwnerSecret } from '../pairing';
import { KV_COLLECTION, type SyncStore } from '../types';
import { createEvoluSyncStore } from './adapter';

let dir = '';
let relayUrl = '';
let stopRelay: () => Promise<void> = async () => {};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-outbox-'));
  const companion = await startCompanion({ port: 0, dataDir: join(dir, 'companion'), allowedOrigins: [], log: () => {} });
  relayUrl = `http://127.0.0.1:${companion.port}`;
  stopRelay = () => companion.close();
});
afterAll(async () => {
  await stopRelay();
  rmSync(dir, { recursive: true, force: true });
});

const store = () => createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'ob' }), appName: 'vitalsOutbox' });

async function until(pred: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('outbox', () => {
  it('"N changes waiting" survives a reload and clears once the relay has the changes', async () => {
    const secret = newOwnerSecret();
    const open = (s: SyncStore, relay: string | null) => s.open({ secret, relayUrl: relay, deviceId: 'DEVICEOB', memoryOnly: false });

    const first = store();
    await open(first, null);
    await first.put(KV_COLLECTION, 'one', { n: 1 });
    await first.put(KV_COLLECTION, 'two', { n: 2 });
    await first.put(KV_COLLECTION, 'two', { n: 3 });
    expect(first.status().pendingChanges).toBe(2); // documents, not writes
    await first.close();

    const second = store();
    await open(second, null);
    expect(second.status().pendingChanges).toBe(2);
    await second.setRelay(relayUrl);
    await until(() => second.status().state === 'synced', 20_000, 'synced');
    await until(() => second.status().pendingChanges === 0, 5_000, 'count cleared');
    await second.close();

    const third = store();
    await open(third, null);
    expect(third.status().pendingChanges).toBe(0);
    await third.close();
  }, 60_000);

  it('reconnect() opens a fresh socket that reaches Synced again, and does nothing without a relay', async () => {
    const s = store();
    await s.open({ secret: newOwnerSecret(), relayUrl: null, deviceId: 'DEVICERC', memoryOnly: true });
    await expect(s.reconnect?.()).resolves.toBeUndefined();
    expect(s.status().state).toBe('off');
    await s.setRelay(relayUrl);
    await until(() => s.status().state === 'synced', 20_000, 'synced');
    await s.reconnect?.();
    expect(s.status().state).toBe('connecting');
    await until(() => s.status().state === 'synced', 20_000, 'synced after reconnect');
    await s.close();
  }, 60_000);
});
