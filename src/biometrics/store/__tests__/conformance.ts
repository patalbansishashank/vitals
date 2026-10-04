/**
 * `BioStore` conformance suite (E10 port, SUITE_SPEC §4.2): the behaviour every implementation must share. Run against
 * `InMemoryBioStore` (the oracle) and the document-backed `DocBioStore` from ./conformance.test.ts.
 *
 * The suite talks to the port only (plus an optional `settle()` the factory provides, e.g. a flush), so it never opens
 * a transaction itself.
 */
import { describe, expect, it } from 'vitest';
import type { BioStore } from '../types';
import type { ChunkKey, RawSample, ScoreResult } from '../../core/types';
import { daily, sleep } from '../../core/__tests__/factory';
import { decodeChunk } from '../../core/chunks';
import type { InMemoryBlobStore } from '../memory';

export interface ConformanceSubject {
  store: BioStore;
  blobs: InMemoryBlobStore;
  /** Make every write so far durable (a flush); reads must give the same answers before and after. */
  settle?: () => Promise<void>;
}

const T0 = Date.parse('2026-03-10T00:00:00Z');
const key: ChunkKey = { sourceKey: 's1', stream: 'hr', local_date: '2026-03-10' };
const mk = (from: number, n: number): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * 60_000, value: 60 + ((from + i) % 20), origin: 'history' as const }));
const o = { tz_offset_s: 0, createdAt: '2026-03-12T00:00:00.000Z' };
const score = (version: string, value: number, d = '2026-03-10'): ScoreResult => ({
  scoreId: 'sleep.tst', version, scope: { kind: 'night', localDate: d }, status: 'ok', value, confidence: 'high', contributors: [], inputsHash: 'h', sourceIds: [], computedAt: 'x', build: 'b',
});

export function bioStoreConformance(name: string, make: () => ConformanceSubject | Promise<ConformanceSubject>): void {
  describe(`BioStore conformance: ${name}`, () => {
    it('records: inserted / duplicate / stale, the newest version wins', async () => {
      const { store: s, settle } = await make();
      expect(await s.putRecord(daily('a', '2026-03-10', { steps: 1 }), 'x')).toBe('inserted');
      expect(await s.putRecord(daily('a', '2026-03-10', { steps: 1 }), 'x')).toBe('duplicate');
      expect(await s.putRecord(daily('a', '2026-03-10', { steps: 2 }, undefined, 2), 'x')).toBe('inserted');
      expect(await s.putRecord(daily('a', '2026-03-10', { steps: 0 }), 'x')).toBe('stale');
      for (const step of [null, settle]) {
        await step?.();
        const r = await s.records({ kind: 'daily', from: '2026-03-10', to: '2026-03-10' });
        expect(r).toHaveLength(1);
        expect((r[0]!.record as ReturnType<typeof daily>).steps).toBe(2);
        expect(r[0]!.sourceKey).toBe('x');
        expect(await s.records({ kind: 'sleep' })).toHaveLength(0);
        expect(await s.records({ from: '2026-03-11' })).toHaveLength(0);
      }
      // after settling, the same answers hold for new writes
      expect(await s.putRecord(daily('a', '2026-03-10', { steps: 2 }, undefined, 2), 'x')).toBe('duplicate');
    });

    it('records: ascending by local date, filtered by kind and source; reads are copies', async () => {
      const { store: s, settle } = await make();
      await s.putRecord(daily('b', '2026-03-12', { steps: 5 }), 'y');
      await s.putRecord(sleep('n', '2026-03-11', 25_000, true), 'x');
      await s.putRecord(daily('a', '2026-03-10', { steps: 1 }), 'x');
      await settle?.();
      expect((await s.records()).map((e) => e.record.record_id)).toEqual(['a', 'n', 'b']);
      expect((await s.records({ kind: ['daily'] })).map((e) => e.record.record_id)).toEqual(['a', 'b']);
      expect((await s.records({ sourceKey: 'y' })).map((e) => e.record.record_id)).toEqual(['b']);
      const [first] = await s.records({ kind: 'daily', sourceKey: 'x' });
      (first!.record as ReturnType<typeof daily>).steps = 999;
      expect(((await s.records({ kind: 'daily', sourceKey: 'x' }))[0]!.record as ReturnType<typeof daily>).steps).toBe(1);
    });

    it('samples: a merged re-sync supersedes, dedupes and is idempotent', async () => {
      const { store: s, settle } = await make();
      const a = await s.putSamples(key, mk(0, 10), o);
      expect(a).toMatchObject({ added: 10, duplicates: 0 });
      await settle?.();
      const again = await s.putSamples(key, mk(0, 10), o);
      expect(again).toMatchObject({ manifest: null, added: 0, duplicates: 10 });
      const b = await s.putSamples(key, mk(5, 10), o);
      expect(b).toMatchObject({ added: 5, duplicates: 5 });
      expect(b.manifest?.supersedes).toBe(a.manifest?.chunkId);
      expect(b.manifest?.n).toBe(15);
      for (const step of [null, settle]) {
        await step?.();
        expect(await s.manifests()).toHaveLength(1);
        // the merged chunk replaced the first one: at most that one is kept, marked, until the merged bytes are uploaded
        const all = (await s.manifests({ includeSuperseded: true })).map((m) => m.chunkId);
        expect(all).toContain(b.manifest!.chunkId);
        expect(all.filter((id) => id !== b.manifest!.chunkId).every((id) => id === a.manifest!.chunkId)).toBe(true);
        const got = await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' });
        expect(got).toHaveLength(15);
        expect(got.every((x, i) => i === 0 || got[i - 1]!.t <= x.t)).toBe(true);
        expect(got[0]!.sourceKey).toBe('s1');
        expect(await s.samples({ stream: 'hr', from: '2026-03-11', to: '2026-03-12' })).toHaveLength(0);
        expect(await s.manifests({ sourceKey: 'other' })).toHaveLength(0);
        expect(await s.manifests({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).toHaveLength(1);
      }
    });

    it('tombstones remove stored samples and block resurrection', async () => {
      const { store: s, settle } = await make();
      await s.putSamples(key, mk(0, 5), o);
      await s.tombstone('s1', 'hr', [{ origin: 'history', t: T0 }, { origin: 'history', t: T0 + 60_000 }]);
      await settle?.();
      expect((await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).length).toBe(3);
      const r = await s.putSamples(key, mk(0, 6), o);
      expect(r.added).toBe(1); // only sample 5; samples 0 and 1 stay deleted
      expect((await s.manifests())[0]!.n).toBe(4);
      await s.tombstone('s1', 'hr', mk(0, 6).map((x) => ({ origin: x.origin, t: x.t })));
      await settle?.();
      expect(await s.manifests()).toHaveLength(0);
      expect(await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).toHaveLength(0);
    });

    it('hour-split and whole-day chunks dedupe against each other', async () => {
      const { store: s, settle } = await make();
      await s.putSamples(key, mk(0, 5), o);
      await settle?.();
      const r = await s.putSamples({ ...key, hourStartUtc: '2026-03-10T00:00:00.000Z' }, mk(3, 5), o);
      expect(r).toMatchObject({ added: 3, duplicates: 2 });
      expect(await s.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).toHaveLength(8);
    });

    it('chunks are encoded blobs in the blob store', async () => {
      const { store: s, blobs } = await make();
      const m = (await s.putSamples(key, mk(0, 5), o)).manifest!;
      expect(decodeChunk(await blobs.get(m.chunkId)).samples).toHaveLength(5);
      expect(m.bytes).toBeGreaterThan(0);
      expect(m).toMatchObject({ sourceKey: 's1', stream: 'hr', local_date: '2026-03-10', n: 5, min: 60, max: 64 });
    });

    it('scores coexist across versions and replace within one; decisions append in order', async () => {
      const { store: s, settle } = await make();
      await s.putScore(score('1.0.0', 7));
      await s.putScore(score('1.1.0', 7.5));
      await s.putScore(score('1.1.0', 6, '2026-03-11'));
      await settle?.();
      await s.putScore(score('1.1.0', 7.6));
      for (const step of [null, settle]) {
        await step?.();
        expect((await s.scores({ scoreId: 'sleep.tst' })).map((x) => `${x.version}:${x.value}`)).toEqual(['1.0.0:7', '1.1.0:7.6', '1.1.0:6']);
        expect(await s.scores({ version: '1.0.0' })).toHaveLength(1);
        expect(await s.scores({ from: '2026-03-11' })).toHaveLength(1);
        expect(await s.scores({ to: '2026-03-10' })).toHaveLength(2);
      }
      await s.appendDecision({ at: '2026-03-10T08:00:00.000Z', decision: 'first' });
      await s.appendDecision({ at: '2026-03-10T09:00:00.000Z', decision: 'second' });
      await settle?.();
      expect((await s.decisions()).map((d) => d.decision)).toEqual(['first', 'second']);
    });

    it('sources: fixed device order (tier, key), stored priorities dropped, replace on put, null when unknown', async () => {
      const { store: s, settle } = await make();
      await s.putSource({ sourceKey: 'b', label: 'B', tier: 'C', priority: 2, policies: [], baselineEpochs: [] });
      await s.putSource({ sourceKey: 'a', label: 'A', tier: 'A', priority: 1, policies: [], baselineEpochs: [] });
      await settle?.();
      expect((await s.sources()).map((x) => x.sourceKey)).toEqual(['a', 'b']);
      expect(await s.getSource('zz')).toBeNull();
      const policy = { stream: 'hr' as const, imported: true, coach: 'daily' as const, engine: false, scores: true };
      await s.putSource({ sourceKey: 'b', label: 'B ring', tier: 'C', priority: 0, policies: [policy], baselineEpochs: ['2026-03-01'] });
      for (const step of [null, settle]) {
        await step?.();
        expect((await s.sources()).map((x) => x.sourceKey)).toEqual(['a', 'b']);
        expect(await s.getSource('b')).toEqual({ sourceKey: 'b', label: 'B ring', tier: 'C', policies: [policy], baselineEpochs: ['2026-03-01'] });
        expect(await s.corrections()).toEqual([]);
      }
    });
  });
}
