import { describe, expect, it } from 'vitest';
import { batch, daily, hrSeries, NOW, prov, sleep } from '../../core/__tests__/factory';
import { sourceKeyOf, suggestedPolicies } from '../../core/source';
import type { ScoreResult, StreamPolicy } from '../../core/types';
import { InMemoryBioStore } from '../../store/memory';
import { exportCanonicalJsonl, ingestBatches } from '../pipeline';
import { buildScoreInput } from '../scoreInput';
import { canonicalImporter } from '../../importers/canonical';

const ring = prov();
const rk = sourceKeyOf(ring);
const watch = prov({ device: { type: 'watch', manufacturer: 'Wrist', model: 'W2', tier: 'A' } });
const hr = (n: number, start = '2026-03-10T23:00:00.000Z', p = ring) => hrSeries('h1', start, Array.from({ length: n }, (_, i) => 60 + (i % 10)), 60, p);

describe('ingestBatches', () => {
  it('stores records and series chunks; series are not stored as records', async () => {
    const store = new InMemoryBioStore();
    const rep = await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 100 }), sleep('s1', '2026-03-10', 25000, true), hr(120)])], store, { now: NOW });
    expect(rep).toMatchObject({ batches: 1, records: 2, samples: 120, chunks: 2, duplicates: 0, sources: [rk], rejected: 0 });
    // 23:00Z..00:59Z on 3/10 and 3/11 (tz 0): two local days
    expect(rep.datesTouched).toEqual(['2026-03-10', '2026-03-11']);
    expect(rep.days).toEqual({ from: '2026-03-10', to: '2026-03-11' });
    expect((await store.records({ kind: 'series' })).length).toBe(0);
    expect((await store.manifests()).map((m) => m.local_date)).toEqual(['2026-03-10', '2026-03-11']);
    const src = (await store.getSource(rk))!;
    expect(src).toMatchObject({ tier: 'B', baselineEpochs: ['2026-03-10'] });
    expect(src.policies.find((p) => p.stream === 'hr')).toMatchObject({ imported: true, scores: true, coach: 'hidden' });
  });

  it('is idempotent: re-import is a no-op with duplicates counted', async () => {
    const store = new InMemoryBioStore();
    const b = batch([daily('d1', '2026-03-10', { steps: 100 }), hr(30)]);
    await ingestBatches([b], store, { now: NOW });
    const mans = await store.manifests();
    const rep = await ingestBatches([b], store, { now: NOW });
    expect(rep).toMatchObject({ records: 0, samples: 0, chunks: 0, duplicates: 31, datesTouched: [], days: null });
    expect(await store.manifests()).toEqual(mans);
  });

  it('overlapping series merge into a superseding chunk; accepts async iterables', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([batch([hr(30, '2026-03-10T10:00:00.000Z')])], store, { now: NOW });
    async function* gen() {
      yield batch([hr(30, '2026-03-10T10:15:00.000Z')]);
    }
    const rep = await ingestBatches(gen(), store, { now: NOW });
    expect(rep).toMatchObject({ samples: 15, duplicates: 15, chunks: 1 });
    const m = await store.manifests();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ n: 45 });
    expect(m[0]!.supersedes).toBeDefined();
  });

  it('upserts higher record versions, counts stale as duplicates', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 1 })])], store, { now: NOW });
    const up = await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 2 }, ring, 2)])], store, { now: NOW });
    expect(up.records).toBe(1);
    const stale = await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 0 })])], store, { now: NOW });
    expect(stale.duplicates).toBe(1);
  });

  it('validates: rejects bad records, drops out-of-range samples, warns', async () => {
    const store = new InMemoryBioStore();
    const bad = hrSeries('h2', '2026-03-10T10:00:00.000Z', [60, 999, 62]);
    const rep = await ingestBatches([batch([bad, { kind: 'daily' } as never, daily('d1', '2026-03-10', { resting_hr_bpm: 5 })]), { schema: 'nope' } as never], store, { now: NOW });
    expect(rep.samples).toBe(2);
    expect(rep.rejected).toBe(2);
    expect(rep.batches).toBe(1);
    expect(rep.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('respects StreamPolicy.imported', async () => {
    const store = new InMemoryBioStore();
    const policies: StreamPolicy[] = suggestedPolicies(['hr']);
    const rep = await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 1 }), hr(5)])], store, { now: NOW, policies });
    expect(rep).toMatchObject({ records: 0, samples: 5, skipped: 1 });
    expect(rep.warnings.some((w) => w.includes('daily_summary'))).toBe(true);
    const none = await ingestBatches([batch([hr(5, '2026-03-12T10:00:00.000Z')])], new InMemoryBioStore(), { now: NOW, policies: { other: policies } });
    expect(none.samples).toBe(0);
  });

  it('new sources are listed in the fixed device order (tier, then key), not by a priority', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 1 })])], store, { now: NOW });
    await ingestBatches([batch([daily('d2', '2026-03-10', { steps: 2 }, watch)])], store, { now: NOW });
    const list = await store.sources();
    expect(list.map((s) => s.sourceKey).sort()).toEqual([rk, sourceKeyOf(watch)].sort());
    expect(list.map((s) => s.tier)).toEqual([...list.map((s) => s.tier)].sort());
  });

  it('splits large high-rate streams by UTC hour', async () => {
    const store = new InMemoryBioStore();
    const big = hrSeries('big', '2026-03-10T00:00:00.000Z', Array.from({ length: 172_800 }, (_, i) => 60 + (i % 13)), 0.5);
    const rep = await ingestBatches([batch([big])], store, { now: NOW });
    expect(rep.samples).toBe(172_800);
    // 172800 samples x (2 B value + 1 B origin) = 518 KB > 256 KB -> hourly chunks
    expect(rep.chunks).toBe(24);
    expect((await store.manifests())[0]!.hourStartUtc).toBe('2026-03-10T00:00:00.000Z');
    expect((await store.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' })).length).toBe(172_800);
    // 172 800 samples through validate, chunking and 24 hourly merges: ~3 s alone, longer under a loaded full run
  }, 30_000);
});

describe('exportCanonicalJsonl', () => {
  it('round-trips records and raw series through the importer and pipeline', async () => {
    const a = new InMemoryBioStore();
    await ingestBatches([batch([daily('d1', '2026-03-10', { steps: 100 }), sleep('s1', '2026-03-10', 25000, true), hr(40, '2026-03-10T10:00:00.000Z')])], a, { now: NOW });
    const jsonl = await exportCanonicalJsonl(a, { from: '2026-03-10', to: '2026-03-10' });
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toMatchObject({ kind: 'series', metric: 'hr', unit: 'bpm', t_offset_s: expect.any(Array) });
    const b = new InMemoryBioStore();
    const batches: Awaited<ReturnType<typeof collect>> = await collect(jsonl);
    const rep = await ingestBatches(batches, b, { now: NOW });
    expect(rep).toMatchObject({ records: 2, samples: 40 });
    const sa = await a.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' });
    const sb = await b.samples({ stream: 'hr', from: '2026-03-10', to: '2026-03-10' });
    expect(sb.map((x) => [x.t, x.value])).toEqual(sa.map((x) => [x.t, x.value]));
    expect(sb[0]!.sourceKey).toBe(rk);
    expect(await exportCanonicalJsonl(a, { from: '2026-04-01', to: '2026-04-02' })).toBe('');
  });
});

async function collect(text: string) {
  const out = [];
  for await (const b of canonicalImporter.run(new Blob([text]), { tz: 'UTC', now: NOW, signal: new AbortController().signal, onProgress: () => undefined })) out.push(b);
  return out;
}

describe('buildScoreInput', () => {
  it('assembles days, series with tier/source, workouts and latest-version priors; honours policy scores flag', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([batch([
      daily('d0', '2026-03-09', { steps: 1 }), daily('d1', '2026-03-10', { steps: 2 }), daily('d2', '2026-03-11', { steps: 3 }), hr(10, '2026-03-10T10:00:00.000Z'),
    ])], store, { now: NOW });
    const pr = (version: string, d: string, value: number): ScoreResult => ({
      scoreId: 'sleep.index', version, scope: { kind: 'night', localDate: d }, status: 'ok', value, confidence: 'high', contributors: [], inputsHash: 'h', sourceIds: [], computedAt: NOW, build: 'b',
    });
    await store.putScore(pr('1.0.0', '2026-03-09', 70));
    await store.putScore(pr('1.1.0', '2026-03-09', 72));
    await store.putScore(pr('1.0.0', '2026-03-10', 60));
    const inp = await buildScoreInput(store, { localDate: '2026-03-10', tz: 'UTC', computedAt: NOW, build: 'b', streams: ['hr'], priorScoreIds: ['sleep.index'], profile: { ageY: 40 } });
    expect(inp.days.map((d) => d.localDate)).toEqual(['2026-03-09', '2026-03-10']);
    expect(inp.series.hr).toHaveLength(10);
    expect(inp.series.hr![0]).toMatchObject({ tier: 'B', sourceKey: rk });
    expect(inp.prior['sleep.index']!.map((r) => `${r.scope.localDate}:${r.version}`)).toEqual(['2026-03-09:1.1.0', '2026-03-10:1.0.0']);
    expect(inp.profile.ageY).toBe(40);
    const src = (await store.getSource(rk))!;
    await store.putSource({ ...src, policies: src.policies.map((p) => (p.stream === 'hr' ? { ...p, scores: false } : p)) });
    const off = await buildScoreInput(store, { localDate: '2026-03-10', tz: 'UTC', computedAt: NOW, build: 'b', streams: ['hr'] });
    expect(off.series.hr).toBeUndefined();
  });
});
