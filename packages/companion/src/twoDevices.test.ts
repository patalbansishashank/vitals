// @vitest-environment node
/**
 * The key spike proof (R7 §7.3 (4)): two simulated devices, each a full Evolu store with its own SQLite database,
 * paired with the same owner secret, converge through the `vitals-companion` server (relay at /sync, blobs at /blobs).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBlobStore, createMemoryBlobBackend, createRemoteBlobBackend } from '../../../src/sync/blobs/index.ts';
import { createEvoluSyncStore } from '../../../src/sync/evolu/adapter.ts';
import { newOwnerSecret } from '../../../src/sync/pairing.ts';
import { BLOB_MANIFEST_COLLECTION, KV_COLLECTION, type BlobManifest, type DocChange, type NetPort, type SyncStore } from '../../../src/sync/types.ts';
import { createNodeEvoluPlatform } from './evoluNode.ts';
import { startCompanion } from './server.ts';

let dir = '';
let relayUrl = '';
let stopRelay: () => Promise<void> = async () => {};
const net: NetPort = { fetch: (input, init) => globalThis.fetch(input, init), assertAllowed: () => {} };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-2dev-'));
  const companion = await startCompanion({ port: 0, dataDir: join(dir, 'companion'), allowedOrigins: [], log: () => {} });
  relayUrl = `http://127.0.0.1:${companion.port}`;
  stopRelay = () => companion.close();
});
afterAll(async () => {
  await stopRelay();
  rmSync(dir, { recursive: true, force: true });
});

function waitFor<T>(store: SyncStore, pred: (c: DocChange) => T | undefined, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for a remote change'));
    }, ms);
    const off = store.subscribe((c) => {
      const v = pred(c);
      if (v !== undefined) {
        clearTimeout(t);
        off();
        resolve(v);
      }
    });
  });
}

describe('two devices through the relay', () => {
  it('converges documents, deletes and concurrent edits', async () => {
    const secret = newOwnerSecret();
    const a = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'A' }), appName: 'vitalsA' });
    const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'B' }), appName: 'vitalsB' });
    await a.open({ secret, relayUrl, deviceId: 'DEVICEA', memoryOnly: true });
    await b.open({ secret, relayUrl, deviceId: 'DEVICEB', memoryOnly: true });

    const t0 = performance.now();
    const arrived = waitFor(b, (c) => (c.origin === 'remote' && c.id === 'vitals.settings' ? c.doc : undefined));
    await a.put(KV_COLLECTION, 'vitals.settings', { state: { units: 'imperial' }, version: 3 }, { schema: 3 });
    const doc = await arrived;
    const ms = performance.now() - t0;
    expect(doc?.value).toEqual({ state: { units: 'imperial' }, version: 3 });
    expect(doc?._device).toBe('DEVICEA');
    expect(ms).toBeLessThan(5000);

    // B edits, A receives.
    const back = waitFor(a, (c) => (c.origin === 'remote' && c.id === 'vitals.settings' ? c.doc : undefined));
    await b.put(KV_COLLECTION, 'vitals.settings', { state: { units: 'metric' }, version: 3 }, { schema: 3 });
    expect((await back)?.value).toEqual({ state: { units: 'metric' }, version: 3 });

    // Delete propagates as a soft delete.
    const gone = waitFor(b, (c) => (c.origin === 'remote' && c.id === 'vitals.settings' && c.doc?._deleted ? true : undefined));
    await a.delete(KV_COLLECTION, 'vitals.settings');
    expect(await gone).toBe(true);
    expect(await b.get(KV_COLLECTION, 'vitals.settings')).toMatchObject({ _deleted: true });

    // Concurrent writes to the same document: both sides end with the same winner.
    await Promise.all([a.put(KV_COLLECTION, 'vitals.body', { v: 'A' }), b.put(KV_COLLECTION, 'vitals.body', { v: 'B' })]);
    for (let i = 0; i < 50; i++) {
      const [x, y] = await Promise.all([a.get(KV_COLLECTION, 'vitals.body'), b.get(KV_COLLECTION, 'vitals.body')]);
      if (JSON.stringify(x?.value) === JSON.stringify(y?.value)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const [x, y] = await Promise.all([a.get(KV_COLLECTION, 'vitals.body'), b.get(KV_COLLECTION, 'vitals.body')]);
    expect(x?.value).toEqual(y?.value);

    // A large document (R7 §7.3 (6): ≥ 200 KB scenario JSON) fits one row.
    const big = { list: Array.from({ length: 2500 }, (_, i) => ({ id: `s${i}`, name: `Scenario ${i}`, kcal: 1800 + i, notes: 'x'.repeat(60) })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(200_000);
    const bigArrived = waitFor(b, (c) => (c.origin === 'remote' && c.id === 'vitals.scenarios' ? c.doc : undefined));
    await a.put(KV_COLLECTION, 'vitals.scenarios', big);
    expect(((await bigArrived)?.value as typeof big).list).toHaveLength(2500);

    expect(a.status().state).toMatch(/synced|syncing/);
    await a.close();
    await b.close();
  }, 30_000);

  it('a third device paired later receives everything (cold pair)', async () => {
    const secret = newOwnerSecret();
    const a = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'C1' }), appName: 'vitalsC1' });
    await a.open({ secret, relayUrl, deviceId: 'DEVICEC1', memoryOnly: true });
    for (let i = 0; i < 20; i++) await a.put(KV_COLLECTION, `vitals.k${i}`, { i });
    await a.push();
    const c = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'C2' }), appName: 'vitalsC2' });
    await c.open({ secret, relayUrl, deviceId: 'DEVICEC2', memoryOnly: true });
    for (let i = 0; i < 100 && (await c.list(KV_COLLECTION)).length < 20; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await c.list(KV_COLLECTION)).toHaveLength(20);
    // A different secret sees nothing.
    const stranger = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'C3' }), appName: 'vitalsC3' });
    await stranger.open({ secret: newOwnerSecret(), relayUrl, deviceId: 'DEVICEC3', memoryOnly: true });
    await stranger.pull();
    expect(await stranger.list(KV_COLLECTION)).toHaveLength(0);
    await Promise.all([a.close(), c.close(), stranger.close()]);
  }, 30_000);

  it('raw samples: A stores an encrypted chunk, the manifest syncs, B fetches and decrypts it from /blobs', async () => {
    const secret = newOwnerSecret();
    const a = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'D1' }), appName: 'vitalsD1' });
    const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'D2' }), appName: 'vitalsD2' });
    await a.open({ secret, relayUrl, deviceId: 'DEVICED1', memoryOnly: true });
    await b.open({ secret, relayUrl, deviceId: 'DEVICED2', memoryOnly: true });
    // Both devices derive the same Vitals keys from the secret.
    expect(a.keys!.ownerIdHash).toBe(b.keys!.ownerIdHash);
    const remoteFor = (s: SyncStore) => createRemoteBlobBackend({ baseUrl: relayUrl, keys: s.keys!, net });
    const blobsA = createBlobStore({ keys: a.keys!, manifests: a, local: createMemoryBlobBackend(), remote: remoteFor(a) });
    const blobsB = createBlobStore({ keys: b.keys!, manifests: b, local: createMemoryBlobBackend(), remote: remoteFor(b) });

    const hour = Date.UTC(2026, 8, 30, 6);
    const t = Array.from({ length: 60 }, (_, i) => hour + i * 60_000);
    const v = t.map((_, i) => 55 + (i % 7));
    const manifestArrived = waitFor(b, (c) => (c.origin === 'remote' && c.col === BLOB_MANIFEST_COLLECTION ? (c.doc?.value as BlobManifest) : undefined));
    const manifest = await blobsA.put({ source: 'ring', metric: 'hr', hourStartUtc: new Date(hour).toISOString() }, { t, v });
    expect(await blobsA.flush()).toBe(1);
    const seen = await manifestArrived;
    expect(seen.chunkId).toBe(manifest.chunkId);
    expect(await blobsB.hasLocal(manifest.chunkId)).toBe(false);
    const got = await blobsB.get(manifest.chunkId);
    expect(Array.from(got.v)).toEqual(v);
    expect(Array.from(got.t)).toEqual(t);
    // A stranger with another secret cannot read the owner's blobs.
    const stranger = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'D3' }), appName: 'vitalsD3' });
    await stranger.open({ secret: newOwnerSecret(), relayUrl: null, deviceId: 'DEVICED3', memoryOnly: true });
    const sneaky = createRemoteBlobBackend({ baseUrl: relayUrl, keys: { ...stranger.keys!, ownerIdHash: a.keys!.ownerIdHash }, net });
    await expect(sneaky.get(manifest.chunkId)).rejects.toMatchObject({ code: 'blob_auth' });
    await Promise.all([a.close(), b.close(), stranger.close()]);
  }, 30_000);
});
