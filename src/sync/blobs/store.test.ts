import { randomBytes } from '../crypto';
import { createMemorySyncStore } from '../memoryStore';
import { BLOB_MANIFEST_COLLECTION, type BlobBackend, type BlobKey, type SyncStore } from '../types';
import { createMemoryBlobBackend } from './memory';
import { createBlobStore } from './store';

const HOUR = '2026-10-01T14:00:00.000Z';
const H = Date.parse(HOUR);
const key: BlobKey = { source: 'garmin', metric: 'hr', hourStartUtc: HOUR };
const samples = { t: Array.from({ length: 60 }, (_, i) => H + i * 60_000), v: Array.from({ length: 60 }, (_, i) => 60 + (i % 9)) };

async function openStore(secret: Uint8Array = randomBytes(32)): Promise<SyncStore> {
  const s = createMemorySyncStore();
  await s.open({ secret, relayUrl: null, deviceId: 'dev1' });
  return s;
}

async function setup(remote: BlobBackend | null = createMemoryBlobBackend(), secret?: Uint8Array) {
  const manifests = await openStore(secret);
  const local = createMemoryBlobBackend();
  const store = createBlobStore({ keys: manifests.keys!, manifests, local, remote, now: () => new Date('2026-10-01T15:00:00Z') });
  return { manifests, local, remote, store };
}

describe('blob store', () => {
  it('round-trips through local storage and writes the manifest', async () => {
    const { store, manifests, local } = await setup();
    const m = await store.put(key, samples);
    expect(m.chunkId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(m).toMatchObject({ ...key, n: 60, min: 60, max: 68, schemaVersion: 1, createdAt: '2026-10-01T15:00:00.000Z' });
    expect(m.bytes).toBe(local.map.get(m.chunkId)!.length);
    expect((await manifests.get(BLOB_MANIFEST_COLLECTION, m.chunkId))?.value).toEqual(m);
    const out = await store.get(m.chunkId);
    expect([...out.t]).toEqual(samples.t);
    expect([...out.v]).toEqual(samples.v);
    expect(await store.hasLocal(m.chunkId)).toBe(true);
  });

  it('gives identical samples the same id and different owners different ids', async () => {
    const secret = randomBytes(32);
    const a = await setup(null, secret);
    const b = await setup(null, secret);
    const c = await setup(null);
    const id = (await a.store.put(key, samples)).chunkId;
    expect((await a.store.put(key, samples)).chunkId).toBe(id);
    expect((await b.store.put(key, samples)).chunkId).toBe(id);
    expect((await c.store.put(key, samples)).chunkId).not.toBe(id);
    expect((await a.store.put({ ...key, metric: 'hrv' }, samples)).chunkId).not.toBe(id);
  });

  it('validates the key and the hour range', async () => {
    const { store } = await setup();
    await expect(store.put({ ...key, hourStartUtc: '2026-10-01T14:30:00.000Z' }, samples)).rejects.toThrow(/exact UTC hour/);
    await expect(store.put({ ...key, hourStartUtc: '2026-10-01T14:00:00Z' }, samples)).rejects.toThrow(/exact UTC hour/);
    await expect(store.put({ ...key, source: '' }, samples)).rejects.toThrow(/source/);
    await expect(store.put(key, { t: [H - 1], v: [1] })).rejects.toThrow(/outside/);
    await expect(store.put(key, { t: [H + 3_600_000], v: [1] })).rejects.toThrow(/outside/);
  });

  it('refuses chunks over 256 KB compressed', async () => {
    const { store } = await setup();
    const n = 3_600_000 / 40;
    const t = Array.from({ length: n }, (_, i) => H + i * 40 + (i % 3));
    let x = 12345;
    const v = t.map(() => (x = (x * 1103515245 + 12345) % 2 ** 31) - 2 ** 30);
    await expect(store.put(key, { t, v })).rejects.toThrow(/split/);
  });

  it('rejects tampered bytes and a chunk served under another id', async () => {
    const { store, local } = await setup();
    const a = await store.put(key, samples);
    const b = await store.put({ ...key, metric: 'hrv' }, samples);
    const sealedA = local.map.get(a.chunkId)!;
    const tampered = sealedA.slice();
    tampered[tampered.length - 20]! ^= 1;
    local.map.set(a.chunkId, tampered);
    await expect(store.get(a.chunkId)).rejects.toThrow(/failed authentication/);
    local.map.set(a.chunkId, local.map.get(b.chunkId)!);
    await expect(store.get(a.chunkId)).rejects.toThrow(/failed authentication/);
    local.map.set(a.chunkId, sealedA);
    expect((await store.get(a.chunkId)).v.length).toBe(60);
  });

  it('flushes with concurrency, keeps failures queued, and fetches from the remote', async () => {
    const remote = createMemoryBlobBackend();
    let fail = true;
    let active = 0;
    let peak = 0;
    const flaky: BlobBackend = {
      ...remote,
      async put(id, sealed) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (fail) throw new Error('offline');
        return remote.put(id, sealed);
      },
    };
    const { store, local } = await setup(flaky);
    const ids: string[] = [];
    for (let h = 0; h < 12; h++) {
      const hour = new Date(H + h * 3_600_000).toISOString();
      ids.push((await store.put({ ...key, hourStartUtc: hour }, { t: [H + h * 3_600_000], v: [h] })).chunkId);
    }
    expect(store.pending()).toBe(12);
    expect(await store.flush()).toBe(0);
    expect(store.pending()).toBe(12);
    expect(peak).toBe(8);
    fail = false;
    await remote.put(ids[0]!, local.map.get(ids[0]!)!);
    expect(await store.flush()).toBe(12);
    expect(store.pending()).toBe(0);
    expect(remote.map.size).toBe(12);

    local.map.clear();
    expect([...(await store.get(ids[3]!)).v]).toEqual([3]);
    expect(local.map.has(ids[3]!)).toBe(true);
    expect((await store.getSealed(ids[4]!)).length).toBeGreaterThan(0);
    await expect(store.get('B'.repeat(22))).rejects.toThrow(/not stored/);
  });

  it('evicts only old chunks the endpoint holds', async () => {
    const remote = createMemoryBlobBackend();
    const { store, local } = await setup(remote);
    const old = await store.put(key, samples);
    const recentHour = '2026-10-01T16:00:00.000Z';
    const recent = await store.put({ ...key, hourStartUtc: recentHour }, { t: [Date.parse(recentHour)], v: [1] });
    expect(await store.evictLocal('2026-10-01T15:00:00.000Z')).toBe(0);
    await store.flush();
    await remote.delete(old.chunkId);
    expect(await store.evictLocal('2026-10-01T15:00:00.000Z')).toBe(0);
    await remote.put(old.chunkId, local.map.get(old.chunkId)!);
    expect(await store.evictLocal('2026-10-01T15:00:00.000Z')).toBe(1);
    expect(local.map.has(old.chunkId)).toBe(false);
    expect(local.map.has(recent.chunkId)).toBe(true);
    expect((await store.get(old.chunkId)).v.length).toBe(60);
  });

  it('does not queue uploads without a remote', async () => {
    const { store } = await setup(null);
    await store.put(key, samples);
    expect(store.pending()).toBe(0);
    expect(await store.flush()).toBe(0);
    expect(await store.evictLocal('2030-01-01T00:00:00.000Z')).toBe(0);
  });
});
