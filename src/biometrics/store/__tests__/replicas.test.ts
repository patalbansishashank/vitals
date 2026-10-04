// @vitest-environment node
/**
 * One ring read by several devices (R20-CHUNK-01..03): replicas linked through a memory hub (documents) and one memory
 * backend standing for the relay's /blobs (bytes), each with the real DocBioStore, BioDocIndex and chunk store. S only
 * pulls: it stands for the server's person replica.
 */
import { describe, expect, it } from 'vitest';
import { deriveWriter } from '@/commands/bio/store';
import { createDocumentStore } from '@/store';
import type { Encryptor } from '@/store/types';
import { createChunkStore, createMemoryChunkIndex } from '@/sync/blobs/chunkStore';
import { createMemoryBlobBackend } from '@/sync/blobs/memory';
import { createMemoryHub, createMemorySyncStore } from '@/sync/memoryStore';
import type { ChunkKey, RawSample } from '../../core/types';
import { BioDocIndex } from '../docIndex';
import { DocBioStore } from '../docStore';

const identity: Encryptor = { seal: async (p) => p, open: async (s) => s };
const secret = new Uint8Array(32).fill(7);
const key: ChunkKey = { sourceKey: 'jstyle2301:ring:TEST1', stream: 'hr', local_date: '2026-10-03' };
const T0 = Date.parse('2026-10-03T00:00:00.000Z');
const DAY = 24 * 3600_000;
const mk = (from: number, n: number, base = 60): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * 60_000, value: base + from + i, origin: 'history' }));
const minutes = (xs: RawSample[]) => xs.map((s) => (s.t - T0) / 60_000);
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

async function device(name: string, hub: ReturnType<typeof createMemoryHub>, relay: ReturnType<typeof createMemoryBlobBackend>) {
  const deviceId = `DEVICE${name}`.padEnd(16, '0');
  const sync = createMemorySyncStore();
  await sync.open({ secret, relayUrl: 'memory://relay', deviceId: deviceId as never, memoryOnly: true });
  sync.link(hub);
  const docs = createDocumentStore({ backend: sync, device: deviceId as never });
  await docs.ready;
  const bytes = createMemoryBlobBackend();
  const blobs = createChunkStore({ bytes, index: createMemoryChunkIndex() });
  await blobs.attachRemote({ seal: identity, backend: relay });
  const store = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: deriveWriter(docs, name) });
  const d = {
    name,
    bytes,
    blobs,
    store,
    /** One document round (out and in); chunk bytes are not uploaded. */
    async syncDocs() {
      await sync.push();
      await sync.pull();
      await new Promise((r) => setTimeout(r, 5));
    },
    async online() {
      await blobs.flush();
      await d.syncDocs();
    },
    async put(s: RawSample[], createdAt: string) {
      const r = await store.putSamples(key, s, { tz_offset_s: 0, createdAt });
      await store.flush();
      return r;
    },
    samples: () => store.samples({ stream: 'hr', from: key.local_date, to: key.local_date }),
    read: (strict = false) => store.readSamples({ stream: 'hr', from: key.local_date, to: key.local_date, strict }),
    live: () => store.manifests({ sourceKey: key.sourceKey, stream: 'hr' }),
    all: () => store.manifests({ sourceKey: key.sourceKey, stream: 'hr', includeSuperseded: true }),
  };
  return d;
}

/** A, B and S share chunk P (minutes 0..9), uploaded and synced. */
async function world() {
  const hub = createMemoryHub();
  const relay = createMemoryBlobBackend();
  const a = await device('A', hub, relay);
  const b = await device('B', hub, relay);
  const s = await device('S', hub, relay);
  const p = await a.put(mk(0, 10), '2026-10-03T08:00:00.000Z');
  await a.online();
  await b.syncDocs();
  await s.syncDocs();
  expect(minutes(await b.samples())).toEqual(range(0, 10));
  return { relay, a, b, s, p: p.manifest! };
}

describe('two devices write the same day offline', () => {
  for (const order of ['A first', 'B first'] as const) {
    it(`every replica reads every sample once, with the same value per (origin, t) (${order})`, async () => {
      const { a, b, s } = await world();
      // A reads minutes 10..14, B reads 12..19 with other values on 12..14 and a later write time
      await a.put(mk(10, 5, 60), '2026-10-03T09:00:00.000Z');
      await b.put(mk(12, 8, 100), '2026-10-03T09:00:01.000Z');
      const [first, second] = order === 'A first' ? [a, b] : [b, a];
      await first.online();
      await second.online();
      await first.syncDocs();
      await s.syncDocs();
      const seen = await Promise.all([a, b, s].map((d) => d.samples()));
      for (const got of seen) expect(minutes(got)).toEqual(range(0, 20));
      // the newest write (B's, 09:00:01) wins on the overlap on every replica
      for (const got of seen) expect(got.filter((x) => minutes([x])[0]! >= 12 && minutes([x])[0]! <= 14).map((x) => x.value)).toEqual([112, 113, 114]);
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
    });
  }

  it('the next write folds the siblings into one chunk that supersedes both', async () => {
    const { a, b, s } = await world();
    const x = await a.put(mk(5, 10, 60), '2026-10-03T09:00:00.000Z');
    const y = await b.put(mk(8, 12, 100), '2026-10-03T09:00:01.000Z');
    await a.online();
    await b.online();
    await a.syncDocs();
    expect(await a.live()).toHaveLength(2);
    const before = await a.samples();
    const z = await a.put(mk(20, 2), '2026-10-03T10:00:00.000Z');
    expect([z.manifest!.supersedes].flat().sort()).toEqual([x.manifest!.chunkId, y.manifest!.chunkId].sort());
    await a.online();
    await b.syncDocs();
    await s.syncDocs();
    for (const d of [a, b, s]) {
      expect((await d.live()).map((m) => m.chunkId), d.name).toEqual([z.manifest!.chunkId]);
      const got = await d.samples();
      expect(minutes(got), d.name).toEqual(range(0, 22));
      // the values the siblings showed before the fold are kept
      expect(got.slice(0, 20), d.name).toEqual(before);
    }
  });
});

describe('a replacement whose bytes are not on the relay yet', () => {
  it('the other replica reads the chunk it replaced and reports partial instead of throwing', async () => {
    const { a, b, p } = await world();
    const x = await a.put(mk(5, 10), '2026-10-03T09:00:00.000Z');
    expect(x.manifest!.supersedes).toBe(p.chunkId);
    // A's documents go out, A stops before its chunk upload
    await a.syncDocs();
    await b.syncDocs();
    expect((await b.live()).map((m) => m.chunkId)).toEqual([x.manifest!.chunkId]);
    const r = await b.read();
    expect(r.partial).toBe(true);
    expect(minutes(r.samples)).toEqual(range(0, 10));
    expect(minutes(await b.samples())).toEqual(range(0, 10));
    await expect(b.read(true)).rejects.toThrow(/not stored on this device/);
    // a write on B meanwhile leaves A's chunk live (B cannot read it, so it never replaces it)
    await b.put(mk(30, 1), '2026-10-03T09:30:00.000Z');
    expect((await b.live()).map((m) => m.chunkId)).toContain(x.manifest!.chunkId);
    // A uploads: B reads everything
    await a.blobs.flush();
    const after = await b.read();
    expect(after.partial).toBe(false);
    expect(minutes(after.samples)).toEqual([...range(0, 15), 30]);
  });

  it('a device that never had the old chunk fetches it from the relay', async () => {
    const hub = createMemoryHub();
    const relay = createMemoryBlobBackend();
    const a = await device('A', hub, relay);
    await a.put(mk(0, 10), '2026-10-03T08:00:00.000Z');
    await a.online();
    await a.put(mk(5, 10), '2026-10-03T09:00:00.000Z');
    await a.syncDocs();
    const c = await device('C', hub, relay);
    await c.syncDocs();
    const r = await c.read();
    expect(r).toMatchObject({ partial: true });
    expect(minutes(r.samples)).toEqual(range(0, 10));
  });
});

describe('a new batch at the same (origin, t)', () => {
  it('replaces the stored value (the ring revised a minute) and counts as a duplicate', async () => {
    const { a, b } = await world();
    const revised = mk(3, 2, 200);
    const r = await a.put(revised, '2026-10-03T09:00:00.000Z');
    expect(r).toMatchObject({ added: 0, duplicates: 2 });
    expect(r.manifest).not.toBeNull();
    await a.online();
    await b.syncDocs();
    for (const d of [a, b]) expect((await d.samples()).filter((x) => x.t === revised[0]!.t || x.t === revised[1]!.t).map((x) => x.value)).toEqual([203, 204]);
    // the same batch again changes nothing
    expect((await a.put(revised, '2026-10-03T09:10:00.000Z')).manifest).toBeNull();
  });
});

describe('pruning replaced chunks', () => {
  it('waits for the replacement bytes on the relay, on the writer and on other replicas', async () => {
    const { a, b, p } = await world();
    const x = await a.put(mk(5, 10), '2026-10-03T09:00:00.000Z');
    await a.syncDocs();
    await b.syncDocs();
    expect((await b.all()).map((m) => m.chunkId).sort()).toEqual([p.chunkId, x.manifest!.chunkId].sort());
    expect(await a.store.pruneSuperseded()).toEqual({ manifests: 0, blobs: 0 });
    expect(await b.store.pruneSuperseded()).toEqual({ manifests: 0, blobs: 0 });
    expect(await b.bytes.has(p.chunkId)).toBe(true);
    await a.blobs.flush();
    expect((await b.store.pruneSuperseded()).manifests).toBe(1);
    // B's own copy of the replaced chunk's bytes goes with its manifest
    expect(await b.bytes.has(p.chunkId)).toBe(false);
    await b.syncDocs();
    await a.syncDocs();
    expect((await a.all()).map((m) => m.chunkId)).toEqual([x.manifest!.chunkId]);
    expect(minutes(await b.samples())).toEqual(range(0, 15));
  });

  it('removes a replaced manifest after 7 days even when the replacement never reached the relay', async () => {
    const { a, b } = await world();
    await a.put(mk(5, 10), '2026-10-03T09:00:00.000Z');
    await a.syncDocs();
    await b.syncDocs();
    expect((await b.store.pruneSuperseded({ now: Date.now() + 6 * DAY })).manifests).toBe(0);
    expect((await b.store.pruneSuperseded({ now: Date.now() + 8 * DAY })).manifests).toBe(1);
  });

  it('a stream of writes keeps at most one marked copy per day', async () => {
    const { a, p } = await world();
    // X replaces P (on the relay: marked); Y replaces X before X is uploaded (X goes at once, P now points at Y)
    const x = await a.put(mk(10, 1), '2026-10-03T09:00:00.000Z');
    const y = await a.put(mk(11, 1), '2026-10-03T09:01:00.000Z');
    expect([y.manifest!.supersedes].flat()).toEqual([x.manifest!.chunkId, p.chunkId]);
    expect((await a.all()).map((m) => m.chunkId).sort()).toEqual([p.chunkId, y.manifest!.chunkId].sort());
    expect(a.blobs.pending()).toBe(1);
    // after the upload, the next write marks Y and drops P (its replacement Y is on the relay)
    await a.blobs.flush();
    const z = await a.put(mk(12, 1), '2026-10-03T09:02:00.000Z');
    expect((await a.all()).map((m) => m.chunkId).sort()).toEqual([y.manifest!.chunkId, z.manifest!.chunkId].sort());
    expect(minutes(await a.samples())).toEqual(range(0, 13));
  });
});
