/**
 * Q1B-B-02: the QA 14-day canonical fixture, imported through the same path as Settings › Devices (canonical
 * importer → ingestBatches). The file's sleep records are internally inconsistent: each night spans 35 min
 * (start–end, in_bed_s and its one 25-min stage) while asleep_s claims 6.3–7.9 h, and each night-HR series has
 * 7 samples at 5 min. So the app's "25 min" sleep and "7 samples" are what the file actually holds; the import
 * report now says so, and a consistent night reads its asleep_s.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryBioStore } from '../../store/memory';
import { ingestBatches } from '../pipeline';
import { canonicalImporter } from '../../importers/canonical';
import { NOW } from '../../core/__tests__/factory';
import { nightSleep } from '../../core/scores/sleep';
import type { BioBatch, SleepRecord } from '../../core/types';
import fixture from '../../../../qa/fixtures/q1b-b/bio14-short-nights.json?raw';

const ctx = { tz: 'UTC', now: NOW, signal: new AbortController().signal, onProgress: () => undefined };

async function importFixture(text: string) {
  const batches: BioBatch[] = [];
  for await (const b of canonicalImporter.run(new Blob([text]), ctx)) batches.push(b);
  const store = new InMemoryBioStore();
  const rep = await ingestBatches(batches, store, { now: NOW });
  return { store, rep };
}

describe('Q1b canonical 14-day fixture', () => {
  it('42 file records = 14 sleep + 14 daily records and 14 HR series stored as 98 samples', async () => {
    const { rep } = await importFixture(fixture);
    expect(rep).toMatchObject({ records: 28, samples: 98, rejected: 0, duplicates: 0, days: { from: '2026-09-16', to: '2026-09-30' } });
  });

  it('reports nights whose asleep time is longer than the night itself, and reads the night from its window and stages', async () => {
    const { store, rep } = await importFixture(fixture);
    expect(rep.warnings.filter((w) => /asleep_s=\d+ is longer than the night's start–end \(2100 s\)/.test(w))).toHaveLength(14);
    const sleeps = (await store.records({ kind: 'sleep' })).map((x) => x.record as SleepRecord);
    expect(sleeps).toHaveLength(14);
    for (const s of sleeps) expect(nightSleep(s)).toMatchObject({ tstMin: 25, sptMin: 35, fromStages: true });
  });

  it('a consistent night (window covering the sleep, no stages) reads its asleep_s', async () => {
    const doc = JSON.parse(fixture) as { records: Array<Record<string, unknown>> };
    for (const r of doc.records) {
      if (r['kind'] !== 'sleep') continue;
      const t = r['time'] as { start: string; end: string };
      t.end = new Date(Date.parse(t.start) + ((r['asleep_s'] as number) + 1200) * 1000).toISOString();
      r['in_bed_s'] = (r['asleep_s'] as number) + 1200;
      delete r['stages'];
    }
    const { store, rep } = await importFixture(JSON.stringify(doc));
    expect(rep.warnings.some((w) => w.includes('asleep_s'))).toBe(false);
    const nights = (await store.records({ kind: 'sleep' })).map((x) => nightSleep(x.record as SleepRecord)!.tstMin / 60);
    expect(Math.min(...nights)).toBeGreaterThanOrEqual(6.3);
    expect(Math.max(...nights)).toBeLessThanOrEqual(7.9);
  });
});
