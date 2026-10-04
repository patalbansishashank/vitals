import { describe, expect, it } from 'vitest';
import type { ChunkKey, RawSample, ScoreResult } from '../../core/types';
import { daily } from '../../core/__tests__/factory';
import { decodeChunk } from '../../core/chunks';
import { InMemoryBioStore, InMemoryBlobStore } from '../memory';

const T0 = Date.parse('2026-03-10T00:00:00Z');
const key: ChunkKey = { sourceKey: 's1', stream: 'hr', local_date: '2026-03-10' };
const mk = (from: number, n: number): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * 60_000, value: 60 + ((from + i) % 20), origin: 'history' as const }));
const o = { tz_offset_s: 0, createdAt: '2026-03-12T00:00:00.000Z' };

describe('InMemoryBioStore', () => {
  it('records: duplicate / stale / upsert, latest version wins', async () => {
    const s = new InMemoryBioStore();
    expect(await s.putRecord(daily('a', '2026-03-10', { steps: 1 }), 'x')).toBe('inserted');
    expect(await s.putRecord(daily('a', '2026-03-10', { steps: 1 }), 'x')).toBe('duplicate');
    expect(await s.putRecord(daily('a', '2026-03-10', { steps: 2 }, undefined, 2), 'x')).toBe('inserted');
    expect(await s.putRecord(daily('a', '2026-03-10', { steps: 0 }), 'x')).toBe('stale');
    const r = await s.records({ kind: 'daily', from: '2026-03-10', to: '2026-03-10' });
    expect(r).toHaveLength(1);
    expect((r[0]!.record as ReturnType<typeof daily>).steps).toBe(2);
    expect(await s.records({ kind: 'sleep' })).toHaveLength(0);
    expect(await s.records({ from: '2026-03-11' })).toHaveLength(0);
  });

  it('samples: merged re-sync supersedes, dedupes, idempotent', async () => {
    const s = new InMemoryBioStore();
    const a = await s.putSamples(key, mk(0, 10), o);
    expect(a).toMatchObject({ added: 10, duplicates: 0 });
    const again = await s.putSamples(key, mk(0, 10), o);
    expect(again).toMatchObject({ manifest: null, added: 0, duplicates: 10 });
    const b = await s.putSamples(key, mk(5, 10), o);
    expect(b).toMatchObject({ added: 5, duplicates: 5 });
    expect(b.manifest?.supersedes).toBe(a.manifest?.chunkId);
    expect(b.manifest?.n).toBe(15);
    const cur = await s.manifests();
    expect(cur).toHaveLength(1);
    // the merged chunk replaced the first one: no superseded copy is kept
    expect((await s.manifests({ includeSuperseded: true })).length).toBe(1);
    const got = await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' });
    expect(got).toHaveLength(15);
    expect(got.every((x, i) => i === 0 || got[i - 1]!.t <= x.t)).toBe(true);
    expect(got[0]!.sourceKey).toBe('s1');
    expect(await s.samples({ stream: 'hr', from: '2026-03-11', to: '2026-03-12' })).toHaveLength(0);
  });

  it('tombstones remove stored samples and block resurrection', async () => {
    const s = new InMemoryBioStore();
    await s.putSamples(key, mk(0, 5), o);
    await s.tombstone('s1', 'hr', [{ origin: 'history', t: T0 }, { origin: 'history', t: T0 + 60_000 }]);
    expect((await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).length).toBe(3);
    const r = await s.putSamples(key, mk(0, 6), o);
    expect(r.added).toBe(1); // only sample 5; samples 0 and 1 stay deleted
    expect((await s.manifests())[0]!.n).toBe(4);
    await s.tombstone('s1', 'hr', mk(0, 6).map((x) => ({ origin: x.origin, t: x.t })));
    expect(await s.manifests()).toHaveLength(0);
  });

  it('hour-split and whole-day chunks dedupe against each other', async () => {
    const s = new InMemoryBioStore();
    await s.putSamples(key, mk(0, 5), o);
    const r = await s.putSamples({ ...key, hourStartUtc: '2026-03-10T00:00:00.000Z' }, mk(3, 5), o);
    expect(r).toMatchObject({ added: 3, duplicates: 2 });
    expect(await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).toHaveLength(8);
  });

  it('chunks are encoded blobs; eviction ages them out', async () => {
    const blobs = new InMemoryBlobStore();
    const s = new InMemoryBioStore(blobs);
    const m = (await s.putSamples(key, mk(0, 5), o)).manifest!;
    expect(decodeChunk(await blobs.get(m.chunkId)).samples).toHaveLength(5);
    expect(m.bytes).toBeGreaterThan(0);
    expect(await blobs.evictLocal('2026-03-11', 'bio')).toBe(1);
    expect(await blobs.hasLocal(m.chunkId)).toBe(false);
  });

  it('scores coexist across versions; decisions append', async () => {
    const s = new InMemoryBioStore();
    const r = (version: string, value: number, d = '2026-03-10'): ScoreResult => ({
      scoreId: 'sleep.tst', version, scope: { kind: 'night', localDate: d }, status: 'ok', value, confidence: 'high', contributors: [], inputsHash: 'h', sourceIds: [], computedAt: 'x', build: 'b',
    });
    await s.putScore(r('1.0.0', 7));
    await s.putScore(r('1.1.0', 7.5));
    await s.putScore(r('1.1.0', 6, '2026-03-11'));
    await s.putScore(r('1.1.0', 7.6));
    expect((await s.scores({ scoreId: 'sleep.tst' })).map((x) => `${x.version}:${x.value}`)).toEqual(['1.0.0:7', '1.1.0:7.6', '1.1.0:6']);
    expect(await s.scores({ version: '1.0.0' })).toHaveLength(1);
    expect(await s.scores({ from: '2026-03-11' })).toHaveLength(1);
    await s.appendDecision({ at: 'x', decision: 'd' });
    expect(await s.decisions()).toHaveLength(1);
  });

  it('sources', async () => {
    const s = new InMemoryBioStore();
    await s.putSource({ sourceKey: 'b', label: 'B', tier: 'C', priority: 2, policies: [], baselineEpochs: [] });
    await s.putSource({ sourceKey: 'a', label: 'A', tier: 'A', priority: 1, policies: [], baselineEpochs: [] });
    expect((await s.sources()).map((x) => x.sourceKey)).toEqual(['a', 'b']);
    expect(await s.getSource('zz')).toBeNull();
  });
});
