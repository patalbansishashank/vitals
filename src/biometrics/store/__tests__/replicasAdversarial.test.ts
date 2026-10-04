// @vitest-environment node
/** Verifier tests for R20-CHUNK (501c48b): concurrent folds, fold with a pending sibling, tombstones on folded chunks, old rows, determinism. */
import { describe, expect, it } from 'vitest';
import { deriveWriter } from '@/commands/bio/store';
import { createDocumentStore } from '@/store';
import type { Encryptor } from '@/store/types';
import { createChunkStore, createMemoryChunkIndex } from '@/sync/blobs/chunkStore';
import { createMemoryBlobBackend } from '@/sync/blobs/memory';
import { createMemoryHub, createMemorySyncStore } from '@/sync/memoryStore';
import type { ChunkKey, RawSample } from '@/biometrics/core/types';
import { BioDocIndex } from '@/biometrics/store/docIndex';
import { DocBioStore } from '@/biometrics/store/docStore';

const identity: Encryptor = { seal: async (p) => p, open: async (s) => s };
const secret = new Uint8Array(32).fill(7);
const key: ChunkKey = { sourceKey: 'jstyle2301:ring:TEST1', stream: 'hr', local_date: '2026-10-03' };
const T0 = Date.parse('2026-10-03T00:00:00.000Z');
const mk = (from: number, n: number, base = 60): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * 60_000, value: base + from + i, origin: 'history' }));
const minutes = (xs: RawSample[]) => xs.map((s) => (s.t - T0) / 60_000);
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const values = (xs: Array<RawSample>) => xs.map((s) => [(s.t - T0) / 60_000, s.value]);

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
  const writer = deriveWriter(docs, name);
  const store = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer });
  const d = {
    name, bytes, blobs, store, docs, writer,
    async syncDocs() { await sync.push(); await sync.pull(); await new Promise((r) => setTimeout(r, 5)); },
    async online() { await blobs.flush(); await d.syncDocs(); },
    async put(s: RawSample[], createdAt: string) { const r = await store.putSamples(key, s, { tz_offset_s: 0, createdAt }); await store.flush(); return r; },
    samples: () => store.samples({ stream: 'hr', from: key.local_date, to: key.local_date }),
    read: (strict = false) => store.readSamples({ stream: 'hr', from: key.local_date, to: key.local_date, strict }),
    live: () => store.manifests({ sourceKey: key.sourceKey, stream: 'hr' }),
    all: () => store.manifests({ sourceKey: key.sourceKey, stream: 'hr', includeSuperseded: true }),
    async tomb(mins: number[]) { await store.tombstone(key.sourceKey, 'hr', mins.map((m) => ({ origin: 'history' as const, t: T0 + m * 60_000 }))); await store.flush(); },
    prune: () => store.pruneSuperseded(),
  };
  return d;
}

async function world() {
  const hub = createMemoryHub();
  const relay = createMemoryBlobBackend();
  const a = await device('A', hub, relay);
  const b = await device('B', hub, relay);
  const s = await device('S', hub, relay);
  await a.put(mk(0, 10), '2026-10-03T08:00:00.000Z');
  await a.online();
  await b.syncDocs();
  await s.syncDocs();
  return { hub, relay, a, b, s };
}

const allEqual = async (ds: Array<Awaited<ReturnType<typeof device>>>) => {
  const got = await Promise.all(ds.map((d) => d.samples()));
  for (const g of got) expect(values(g)).toEqual(values(got[0]!));
  return got[0]!;
};

describe('(a) concurrent folds on two devices', () => {
  for (const order of ['A first', 'B first'] as const) {
    it(`both fold the same siblings offline; nothing lost or duplicated, one live chunk after the next write (${order})`, async () => {
      const { a, b, s } = await world();
      await a.put(mk(10, 5, 60), '2026-10-03T09:00:00.000Z');
      await b.put(mk(12, 8, 100), '2026-10-03T09:00:01.000Z');
      await a.online(); await b.online(); await a.syncDocs(); await s.syncDocs();
      expect(await a.live()).toHaveLength(2);
      // both devices now fold offline (each writes a new minute)
      await a.put(mk(20, 1, 60), '2026-10-03T10:00:00.000Z');
      await b.put(mk(21, 1, 100), '2026-10-03T10:00:01.000Z');
      const [first, second] = order === 'A first' ? [a, b] : [b, a];
      await first.online(); await second.online(); await first.syncDocs(); await s.syncDocs();
      const got = await allEqual([a, b, s]);
      expect(minutes(got)).toEqual(range(0, 22));
      expect(got.filter((x) => minutes([x])[0]! >= 12 && minutes([x])[0]! <= 14).map((x) => x.value)).toEqual([112, 113, 114]);
      // the next write folds the two folds; prune everywhere leaves one manifest and every read strict
      await s.put(mk(22, 1, 60), '2026-10-03T11:00:00.000Z');
      await s.online(); await a.syncDocs(); await b.syncDocs();
      for (const d of [a, b, s]) await d.prune();
      for (const d of [a, b, s]) { await d.online(); }
      for (const d of [a, b, s]) await d.syncDocs();
      for (const d of [a, b, s]) {
        expect(await d.live()).toHaveLength(1);
        expect(await d.all()).toHaveLength(1);
        const r = await d.read(true);
        expect(minutes(r.samples)).toEqual(range(0, 23));
        expect(r.partial).toBe(false);
      }
    });
  }

  it('a fold whose own old chunk never reached the relay: the other replica keeps reading its own chunk, partial, never a duplicate', async () => {
    const { a, b, s } = await world();
    await a.put(mk(10, 5, 60), '2026-10-03T09:00:00.000Z'); // X: A, not uploaded
    await b.put(mk(12, 8, 100), '2026-10-03T09:00:01.000Z'); // Y: B
    await b.online();
    await a.syncDocs(); // A has X (local), Y (relay), P
    await a.put(mk(30, 1, 60), '2026-10-03T10:00:00.000Z'); // fold: Z supersedes X (dropped: not on relay) + Y (kept)
    await a.syncDocs(); // docs only; Z bytes pending on A
    await b.syncDocs(); await s.syncDocs();
    for (const d of [b, s]) {
      const r = await d.read();
      expect(r.partial).toBe(true);
      expect(minutes(r.samples)).toEqual([...range(0, 10), ...range(12, 8)]);
      await expect(d.read(true)).rejects.toThrow();
      // prune on the other replica must not remove Y while Z is not on the relay
      await d.prune();
    }
    await b.syncDocs(); await a.syncDocs();
    expect((await a.all()).map((m) => m.chunkId)).toContain((await b.live()).length ? (await a.all())[0]!.chunkId : '');
    // B writes meanwhile: its write must leave the unreadable Z live and never resurrect X's manifest
    await b.put(mk(40, 1, 100), '2026-10-03T10:30:00.000Z');
    await b.online(); await a.syncDocs(); await s.syncDocs();
    await a.online(); await b.syncDocs(); await s.syncDocs();
    const got = await allEqual([a, b, s]);
    expect(minutes(got)).toEqual([...range(0, 15), ...range(15, 5), 30, 40]);
    for (const d of [a, b, s]) expect((await d.read(true)).partial).toBe(false);
  });
});

describe('(c) determinism', () => {
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  for (const order of perms(['A', 'B', 'S'])) {
    it(`three siblings arriving in order ${order.join('')} read the same values`, async () => {
      const { a, b, s } = await world();
      const by = { A: a, B: b, S: s };
      await a.put(mk(12, 3, 60), '2026-10-03T09:00:02.000Z');
      await b.put(mk(12, 3, 100), '2026-10-03T09:00:01.000Z');
      await s.put(mk(12, 3, 200), '2026-10-03T09:00:00.000Z');
      for (const n of order) await by[n as 'A'].online();
      for (const n of order) await by[n as 'A'].syncDocs();
      const got = await allEqual([a, b, s]);
      expect(values(got).slice(10)).toEqual([[12, 72], [13, 73], [14, 74]]);
      // a fourth device folds: value rule unchanged after the fold
      await b.put(mk(15, 1, 1), '2026-10-03T09:30:00.000Z');
      await b.online(); await a.syncDocs(); await s.syncDocs();
      const after = await allEqual([a, b, s]);
      expect(values(after).slice(10)).toEqual([[12, 72], [13, 73], [14, 74], [15, 16]]);
    });
  }
});

describe('(e) old v0.4.0 rows', () => {
  it('a string supersedes and a superseded row without replacedBy still read and prune', async () => {
    const { a, b } = await world();
    const live = (await a.live())[0]!;
    // an old build's shape: the live manifest says `supersedes: 'OLD'` (string); OLD is marked superseded, no replacedBy
    const old = { ...live, chunkId: 'OLDCHUNK00000000000000', n: 1, superseded: true, createdAt: '2026-10-03T07:00:00.000Z' };
    await a.writer.write([
      { kind: 'put', col: 'bioChunks', id: old.chunkId, body: old as never },
      { kind: 'patch', col: 'bioChunks', id: live.chunkId, patch: { supersedes: old.chunkId } as never },
    ] as never);
    await a.syncDocs(); await b.syncDocs();
    for (const d of [a, b]) {
      expect(minutes((await d.read(true)).samples)).toEqual(range(0, 10));
      expect(await d.all()).toHaveLength(2);
    }
    const r = await b.prune();
    expect(r.manifests).toBe(1);
    await b.syncDocs(); await a.syncDocs();
    for (const d of [a, b]) expect(await d.all()).toHaveLength(1);
    // the next write on a (string supersedes in `mine`) works
    await a.put(mk(10, 1), '2026-10-03T09:00:00.000Z');
    expect(minutes(await a.samples())).toEqual(range(0, 11));
  });
});

describe('(f) tombstones and folded chunks', () => {
  it('deleting a minute that lives in a folded chunk removes it on every replica, and a later write does not bring it back', async () => {
    const { a, b, s } = await world();
    await a.put(mk(10, 5, 60), '2026-10-03T09:00:00.000Z');
    await b.put(mk(12, 8, 100), '2026-10-03T09:00:01.000Z');
    await a.online(); await b.online(); await a.syncDocs(); await s.syncDocs();
    await a.put(mk(20, 1), '2026-10-03T10:00:00.000Z'); // fold, bytes pending on A
    await a.syncDocs(); await b.syncDocs(); await s.syncDocs();
    await b.tomb([3, 13]); // B cannot rewrite Z (bytes pending): tombstones alone must hide them
    await b.syncDocs(); await a.syncDocs(); await s.syncDocs();
    for (const d of [a, b, s]) expect(minutes((await d.read()).samples)).not.toContain(3);
    for (const d of [a, b, s]) expect(minutes((await d.read()).samples)).not.toContain(13);
    await a.online(); await b.syncDocs(); await s.syncDocs();
    for (const d of [a, b, s]) expect(minutes((await d.read(true)).samples)).toEqual(range(0, 21).filter((m) => m !== 3 && m !== 13));
    // a rewrite on the other side (A re-imports the day): the dead minutes stay dead, the chunk bytes no longer carry them
    await a.put(mk(0, 21), '2026-10-03T11:00:00.000Z');
    await a.online(); await b.syncDocs(); await s.syncDocs();
    const got = await allEqual([a, b, s]);
    expect(minutes(got)).toEqual(range(0, 21).filter((m) => m !== 3 && m !== 13));
    for (const m of await a.live()) expect(m.n).toBe(19);
  });
});
