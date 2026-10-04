import { describe, expect, it } from 'vitest';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { deriveWriter } from '@/commands/bio/store';
import { createChunkStore, createMemoryChunkIndex } from '@/sync/blobs/chunkStore';
import { createMemoryBlobBackend } from '@/sync/blobs/memory';
import { encodeChunk } from '../../core/chunks';
import type { ChunkKey, RawSample } from '../../core/types';
import { BioDocIndex } from '../docIndex';
import { DocBioStore } from '../docStore';

const key: ChunkKey = { sourceKey: 's1', stream: 'hr', local_date: '2026-03-10' };
const o = { tz_offset_s: 0, createdAt: '2026-03-10T00:00:00.000Z' };
const mk = (from: number, n: number): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: 1_773_100_800 + (from + i) * 60, v: 60 + i, origin: 'ring' }) as unknown as RawSample);
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

function subject() {
  const docs = createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' });
  const bytes = createMemoryBlobBackend();
  const index = createMemoryChunkIndex();
  let clock = NOW;
  const blobs = createChunkStore({ bytes, index, now: () => new Date(clock) });
  const store = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: deriveWriter(docs, 'prune') });
  return { docs, bytes, blobs, store, setClock: (t: number) => void (clock = t) };
}

describe('replaced sample chunks', () => {
  it('a merge removes the chunk it replaces and its bytes', async () => {
    const { store, bytes } = subject();
    const a = await store.putSamples(key, mk(0, 10), o);
    await store.flush();
    const b = await store.putSamples(key, mk(5, 10), o);
    await store.flush();
    expect((await store.manifests({ includeSuperseded: true })).map((m) => m.chunkId)).toEqual([b.manifest!.chunkId]);
    expect(await bytes.list()).toEqual([b.manifest!.chunkId]);
    expect(await bytes.get(a.manifest!.chunkId)).toBeNull();
    expect(await store.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).toHaveLength(15);
  });

  it('pruneSuperseded removes manifests an older build kept, their bytes, and old files no manifest names', async () => {
    const { docs, bytes, blobs, store, setClock } = subject();
    // an older build: the first chunk stays, marked superseded
    const old = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: deriveWriter(docs, 'old') });
    const a = await old.putSamples(key, mk(0, 10), o);
    await old.flush();
    await deriveWriter(docs, 'old').write([{ kind: 'patch', col: 'bioChunks', id: a.manifest!.chunkId, patch: { superseded: true } }]);
    const b = await store.putSamples({ ...key, local_date: '2026-03-11' }, mk(0, 3), o);
    await store.flush();
    // a file no manifest names (its chunk was replaced on another device), stored two hours ago, and a fresh one
    setClock(NOW - 2 * 3600_000);
    const stale = await blobs.put(encodeChunk(mk(50, 2), 0, 'hr'), { purpose: 'bio', aadId: 'orphan-old' });
    setClock(NOW);
    const fresh = await blobs.put(encodeChunk(mk(60, 2), 0, 'hr'), { purpose: 'bio', aadId: 'orphan-new' });

    expect(await store.pruneSuperseded({ now: NOW })).toEqual({ manifests: 1, blobs: 1 });
    expect((await store.manifests({ includeSuperseded: true })).map((m) => m.chunkId)).toEqual([b.manifest!.chunkId]);
    expect((await bytes.list()).sort()).toEqual([b.manifest!.chunkId, fresh.chunkId].sort());
    expect(await bytes.get(stale.chunkId)).toBeNull();
    expect(await store.pruneSuperseded({ now: NOW })).toEqual({ manifests: 0, blobs: 0 });
  });

  it('a command transaction keeps the replaced bytes until it is durable (pruneSuperseded drops them later)', async () => {
    const { docs, bytes, blobs } = subject();
    const seed = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: deriveWriter(docs, 'seed') });
    const a = await seed.putSamples(key, mk(0, 10), o);
    await seed.flush();
    const ops: unknown[] = [];
    const tx = new DocBioStore({ index: new BioDocIndex(docs), blobs, writer: { durable: false, write: async (x) => void ops.push(...x) } });
    await tx.putSamples(key, mk(5, 10), o);
    await tx.flush();
    expect(await bytes.get(a.manifest!.chunkId)).not.toBeNull();
  });
});
