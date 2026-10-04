import { describe, expect, it } from 'vitest';
import { InMemoryBioStore } from '../../store/memory';
import { ingestBatches } from '../../ingest/pipeline';
import { batch, daily, NOW } from '../../core/__tests__/factory';
import type { BioBatch, DailyRecord, SeriesRecord, SleepRecord, SpotRecord } from '../../core/types';
import { canonicalImporter, splitCsvLine } from '../canonical';
import csvText from '../__fixtures__/canonical.csv?raw';

const ctx = (tz = 'UTC') => ({ tz, now: NOW, signal: new AbortController().signal, onProgress: () => undefined });
async function collect(blob: Blob, tz?: string): Promise<BioBatch[]> {
  const out: BioBatch[] = [];
  for await (const b of canonicalImporter.run(blob, ctx(tz))) out.push(b);
  return out;
}

describe('canonical importer', () => {
  it('JSON: a single batch and an array of batches pass through', async () => {
    const b = batch([daily('a', '2026-03-10', { steps: 5 })]);
    expect(await collect(new Blob([JSON.stringify(b)]))).toEqual([b]);
    expect(await collect(new Blob([JSON.stringify([b, b])]))).toEqual([b, b]);
    expect(await collect(new Blob([JSON.stringify(b, null, 2)]))).toEqual([b]); // pretty printed
  });
  it('JSONL: records and batches, batched, malformed line throws', async () => {
    const r1 = daily('a', '2026-03-10', { steps: 5 });
    const r2 = daily('b', '2026-03-11', { steps: 6 });
    const b = batch([r1]);
    const out = await collect(new Blob([`${JSON.stringify(r1)}\r\n${JSON.stringify(r2)}\n${JSON.stringify(b)}\n`]));
    expect(out).toHaveLength(2);
    expect(out[0]!.records.map((r) => r.record_id)).toEqual(['a', 'b']);
    expect(out[0]!.tz).toBe('UTC');
    expect(out[1]).toEqual(b);
    await expect(collect(new Blob([`${JSON.stringify(r1)}\n{oops\n`]))).rejects.toThrow(/line 2/);
  });
  it('CSV golden fixture', async () => {
    const text = csvText;
    const out = await collect(new Blob([text]));
    expect(out).toHaveLength(1);
    const recs = out[0]!.records;
    const d = recs.find((r) => r.kind === 'daily') as DailyRecord;
    expect(d).toMatchObject({ steps: 8421, distance_m: 6200, time: { local_date: '2026-03-10' }, hrv: { metric: 'rmssd', value_ms: 52, window: 'night' } });
    expect(d.spo2_avg_pct).toBeCloseTo(96);
    expect(d.provenance).toMatchObject({ channel: 'file:canonical', source_app: 'ring' });
    const sp = recs.find((r) => r.kind === 'spot') as SpotRecord;
    expect(sp).toMatchObject({ metric: 'weight_kg', value: 81.4, context: 'fasting', time: { at: '2026-03-10T06:30:00.000Z', local_date: '2026-03-10' } });
    expect(sp.provenance.modality).toBe('self_reported');
    const s = recs.find((r) => r.kind === 'series') as SeriesRecord;
    expect(s.values).toEqual([62, 64, 63]);
    expect(s.t_offset_s).toEqual([0, 60, 150]);
    expect(s.context).toBe('rest');
    const sl = recs.find((r) => r.kind === 'sleep') as SleepRecord;
    expect(sl).toMatchObject({ is_main: true, asleep_s: 26400, time: { local_date: '2026-03-10' } });
    // deterministic ids -> re-import is a no-op
    expect(JSON.stringify(await collect(new Blob([text])))).toBe(JSON.stringify(out));
  });
  it('CSV: tz derivation from start, quoting and errors', async () => {
    const csv = 'kind,metric,start,value,source\nspot,weight_kg,2026-03-10T23:00:00Z,80,"My, Scale"\n';
    const [b] = await collect(new Blob([csv]), 'Asia/Kolkata');
    const r = b!.records[0] as SpotRecord;
    expect(r.time.tz_offset_s).toBe(19800);
    expect(r.time.local_date).toBe('2026-03-11');
    expect(r.provenance.source_app).toBe('My, Scale');
    expect(splitCsvLine('a,"b ""c""",d')).toEqual(['a', 'b "c"', 'd']);
    await expect(collect(new Blob(['kind,metric,value\nbogus,x,1\n']))).rejects.toThrow(/line 2/);
    await expect(collect(new Blob(['kind,metric,local_date,value,unit\ndaily,distance_m,2026-03-10,1,parsec\n']))).rejects.toThrow(/unit/);
  });
  it('sniffs', () => {
    const t = (s: string) => canonicalImporter.accepts.sniff(new TextEncoder().encode(s));
    expect(t('{"schema":"vitals.biometrics/1"')).toBe(true);
    expect(t('kind,metric,start\n')).toBe(true);
    expect(t('{"kind":"daily"')).toBe(true);
    expect(t('<?xml version')).toBe(false);
  });
  it('end to end: CSV -> pipeline', async () => {
    const text = csvText;
    const store = new InMemoryBioStore();
    const rep = await ingestBatches(await collect(new Blob([text])), store, { now: NOW });
    expect(rep).toMatchObject({ records: 3, samples: 3, chunks: 1, duplicates: 0, rejected: 0 });
    expect(rep.sources.sort()).toEqual(['file:canonical|app:ring', 'file:canonical|app:scale']);
    expect(rep.days).toEqual({ from: '2026-03-10', to: '2026-03-10' });
  });
});
