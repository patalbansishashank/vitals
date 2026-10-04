// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestBatches } from '../../ingest/pipeline';
import { InMemoryBioStore } from '../../store/memory';
import { LUMEN_SOURCE, dailyRecordId, seriesRecordId, sleepRecordId, sleepVersion } from '../../core/recordIds';
import type { BioBatch, BioRecord, DailyRecord, SeriesRecord, SleepRecord, WorkoutRecord } from '../../core/types';
import { lumenArchiveImporter, readLumenArchiveBattery, sniffLumenArchive } from '../lumenArchive';
import { lumenCloudEventsImporter } from '../lumenCloudEvents';

const FIXTURE = readFileSync(fileURLToPath(new URL('../__fixtures__/lumen-archive.json', import.meta.url)), 'utf8');
const ctx = () => ({ tz: 'Europe/Berlin', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} });

async function batches(text = FIXTURE): Promise<BioBatch[]> {
  const out: BioBatch[] = [];
  for await (const b of lumenArchiveImporter.run(new Blob([text]), ctx())) out.push(b);
  return out;
}
const recordsOf = async (text = FIXTURE): Promise<BioRecord[]> => (await batches(text)).flatMap((b) => b.records);

describe('lumen archive importer: format version', () => {
  const withVersion = (raw: string) => FIXTURE.replace(/"formatVersion"\s*:\s*[^,]+,/, `"formatVersion": ${raw},`);
  it('reads format 1', async () => {
    expect((await recordsOf(withVersion('1'))).length).toBeGreaterThan(0);
  });
  it.each(['2', '99', '0', '-1', '1.5', '"1"', 'null', 'true', '[]', '1e999'])('refuses formatVersion %s', async (v) => {
    await expect(batches(withVersion(v))).rejects.toThrow(/format|not a Lumen Health data export|not valid JSON/);
  });
  it('refuses a missing formatVersion', async () => {
    const o = JSON.parse(FIXTURE) as Record<string, unknown>;
    delete o.formatVersion;
    await expect(batches(JSON.stringify(o))).rejects.toThrow(/not a Lumen Health data export/);
    await expect(readLumenArchiveBattery(new Blob([JSON.stringify(o)]))).rejects.toThrow();
  });
});

describe('lumen archive importer', () => {
  it('reads each kind it is meant to read (golden counts)', async () => {
    const recs = await recordsOf();
    const count = (k: string) => recs.filter((r) => r.kind === k).length;
    expect({ series: count('series'), sleep: count('sleep'), daily: count('daily'), workout: count('workout'), spot: count('spot') }).toEqual({
      // hr history 27th/28th/29th, hr spot 29th, hr live 28th, spo2 28th/29th, skin_temp 28th/29th, hrv, resp_rate,
      // 4 vendor streams on the 29th, steps 28th/29th, distance 28th/29th
      series: 19,
      sleep: 2,
      // activity × 3, Lumen's sleep score of the main night (both nights wake on the 28th) × 1, vo2max × 1
      daily: 5,
      workout: 2,
      spot: 0,
    });
  });

  it('maps measurements, drops deleted rows and demo data', async () => {
    const recs = await recordsOf();
    const series = recs.filter((r): r is SeriesRecord => r.kind === 'series');
    const s = (metric: string, date: string, mode?: string) => series.find((x) => x.metric === metric && x.time.local_date === date && (!mode || x.sampling.mode === mode));
    expect(s('hr', '2026-09-29', 'periodic')!.values).toEqual([61, 64]);
    expect(s('hr', '2026-09-29', 'spot')!.values).toEqual([75]);
    expect(s('hr', '2026-09-28', 'continuous')!.values).toEqual([88]);
    const allHr = series.filter((x) => x.metric === 'hr').flatMap((x) => x.values);
    expect(allHr).not.toContain(199); // deleted in Lumen
    expect(allHr).not.toContain(70); // demo row
    expect(s('skin_temp', '2026-09-29')!).toMatchObject({ unit: 'degC', values: [34.2] });
    expect(s('hrv', '2026-09-29')!.quality.flags).toContain('hrv_vendor_defined');
    expect(s('resp_rate', '2026-09-28')!).toMatchObject({ unit: 'brpm', values: [14, 15] });
    expect(s('vendor:bp_sys_estimate', '2026-09-29')!.quality.validation).toBe('vendor_proprietary');
    expect(s('steps', '2026-09-29')!).toMatchObject({ aggregation: 'sum', values: [20, 30] });
    expect(s('hr', '2026-09-29')!.provenance).toMatchObject({ channel: 'file:lumen_archive', source_app: 'Lumen', decoder: 'lumen-archive/1' });
  });

  it('builds sleep with every stage, unknown kept and gaps left empty', async () => {
    const sleeps = (await recordsOf()).filter((r): r is SleepRecord => r.kind === 'sleep');
    const a = sleeps.find((x) => x.time.start === '2026-09-27T21:30:00.000Z')!;
    expect(a.time.local_date).toBe('2026-09-28');
    expect(a.is_main).toBe(true);
    expect(a.unknown_s).toBe(25 * 60);
    expect(a.deep_s).toBe(80 * 60);
    expect(a.rem_s).toBe(80 * 60);
    // the 20-minute gap between 03:45 and 04:05 local is not covered by any stage
    const covered = (a.stages ?? []).reduce((n, st) => n + (Date.parse(st.end) - Date.parse(st.start)), 0);
    expect(covered).toBe(430 * 60_000);
    expect(a.version).toBe(sleepVersion(true, Date.parse('2026-09-28T06:00:00Z') / 1000));
    expect(sleeps.some((x) => x.time.start?.startsWith('2026-09-25'))).toBe(false); // demo night
  });

  it('daily: steps, distance, active minutes; calories stay unmapped', async () => {
    const daily = (await recordsOf()).filter((r): r is DailyRecord => r.kind === 'daily');
    const act = daily.find((d) => d.time.local_date === '2026-09-28' && d.steps !== undefined)!;
    expect(act).toMatchObject({ steps: 10400, distance_m: 7900, active_min: { light: 0, moderate: 52, vigorous: 0 } });
    expect(act.active_kcal).toBeUndefined();
    expect(act.quality.vendor_state).toBe('kcal_unspecified=450;kcal_estimated_active=300');
    expect(daily.find((d) => d.vendor?.sleep === 78)!.time.local_date).toBe('2026-09-28');
    expect(daily.find((d) => d.vo2max)!.vo2max).toEqual({ ml_kg_min: 42, method: 'vendor_estimate' });
  });

  it('workouts: finished sessions only, pause taken out', async () => {
    const w = (await recordsOf()).filter((r): r is WorkoutRecord => r.kind === 'workout');
    const run = w.find((x) => x.native_type === 'run')!;
    expect(run).toMatchObject({ exercise_type: 'running', active_duration_s: 42 * 60 - 120, distance_m: 6100, hr_avg_bpm: 148, hr_max_bpm: 171 });
    expect(w.find((x) => x.native_type === 'walk')!.distance_m).toBeUndefined();
    expect(w.some((x) => x.native_type === 'gym')).toBe(false); // still recording
  });

  it('never reads coach, raw packet, log or meal tables', async () => {
    const text = JSON.stringify(await recordsOf());
    expect(text).not.toMatch(/PRIVATE-/);
  });

  it('gives the same ids on a second import and stores nothing twice', async () => {
    const ids = (r: BioRecord[]) => r.map((x) => `${x.kind}:${x.record_id}@${x.version}`).sort();
    expect(ids(await recordsOf())).toEqual(ids(await recordsOf()));
    const store = new InMemoryBioStore();
    const first = await ingestBatches(await batches(), store, { now: '2026-10-01T00:00:00.000Z' });
    const second = await ingestBatches(await batches(), store, { now: '2026-10-01T00:00:00.000Z' });
    expect(first.records).toBe(9);
    expect(first.samples).toBeGreaterThan(40);
    expect(second.records).toBe(0);
    expect(second.samples).toBe(0);
  });

  it('uses the shared id rule, so the CloudEvents history of the same data maps to the same records', async () => {
    const arch = await recordsOf();
    const ce = [
      { type: 'health.sleep.timeline.updated', observed: '2026-09-28T21:00:00Z', data: { sample_interval_minutes: 1, complete_session: true, stages: ['awake', 'awake', 'light', 'light', 'deep', 'rem', 'rem', 'unknown', 'light', 'awake', 'light'] } },
      { type: 'health.activity.updated', observed: '2026-09-29T18:00:00Z', data: { steps: 9000, distance_m: 6800, calories_kcal: 380, active_minutes: 45 } },
      { type: 'health.metric.observed', observed: '2026-09-29T05:00:00Z', data: { metric: 'hr', value: 61, unit: 'bpm', provenance: 'device_history' } },
    ].map((e, i) => JSON.stringify({ specversion: '1.0', id: `pl-${i}`, type: e.type, source: 'urn:x', subject: 's', time: e.observed, data: { schema_version: 1, observed_at: e.observed, received_at: '2026-09-29T18:00:05Z', ...e.data } }));
    const ceRecs: BioRecord[] = [];
    for await (const b of lumenCloudEventsImporter.run(new Blob([ce.join('\n')]), ctx())) ceRecs.push(...b.records);
    // the content each importer derives ids from agrees, and the archive's ids are the shared rule applied to it
    const ceSleep = ceRecs.find((r): r is SleepRecord => r.kind === 'sleep')!;
    const arSleep = arch.find((r): r is SleepRecord => r.kind === 'sleep' && r.time.start === ceSleep.time.start)!;
    expect(arSleep.record_id).toBe(ceSleep.record_id);
    expect(arSleep.record_id).toBe(sleepRecordId({ source: LUMEN_SOURCE, start: ceSleep.time.start! }));
    expect(arSleep.stages).toEqual(ceSleep.stages);
    const ceDay = ceRecs.find((r): r is DailyRecord => r.kind === 'daily' && r.steps !== undefined)!;
    const arDay = arch.find((r): r is DailyRecord => r.kind === 'daily' && r.time.local_date === ceDay.time.local_date && r.steps !== undefined)!;
    expect(arDay.record_id).toBe(dailyRecordId({ source: LUMEN_SOURCE, metric: 'activity', localDate: ceDay.time.local_date }));
    expect(arDay.steps).toBe(ceDay.steps);
    const ceHr = ceRecs.find((r): r is SeriesRecord => r.kind === 'series' && r.metric === 'hr')!;
    const arHr = arch.find((r): r is SeriesRecord => r.kind === 'series' && r.metric === 'hr' && r.time.local_date === ceHr.time.local_date && r.sampling.mode === 'periodic')!;
    expect(arHr.record_id).toBe(seriesRecordId({ source: LUMEN_SOURCE, stream: 'hr', origin: 'history', localDate: ceHr.time.local_date }));

    // the CloudEvents importer uses the same rule, so its output after the archive is stored once
    const store = new InMemoryBioStore();
    await ingestBatches(await batches(), store, { now: '2026-10-01T00:00:00.000Z' });
    const ids = async () => new Set((await store.records()).map((e) => e.record.record_id)).size;
    const before = await ids();
    const out = await ingestBatches([{ schema: 'vitals.biometrics/1', producer: { name: 't', version: '1' }, exported_at: '2026-10-01T00:00:00.000Z', tz: 'Europe/Berlin', records: ceRecs.filter((r) => r.kind !== 'series') } as BioBatch], store, { now: '2026-10-01T00:00:00.000Z' });
    // no new record: each one is a duplicate or a newer version of an archive record (the dump's sleep was received later)
    expect(await ids()).toBe(before);
    expect(out.records + out.duplicates).toBe(2);
  });

  it('reads the latest battery reading', async () => {
    expect(await readLumenArchiveBattery(new Blob([FIXTURE]))).toEqual({ percent: 64, at: '2026-09-29T10:35:00.000Z' });
  });

  it('recognises the file and refuses other JSON', async () => {
    expect(sniffLumenArchive(new TextEncoder().encode(FIXTURE.slice(0, 8192)))).toBe(true);
    expect(sniffLumenArchive(new TextEncoder().encode('{"specversion":"1.0","type":"health.x"}'))).toBe(false);
    await expect(recordsOf('{"hello":1}')).rejects.toThrow(/not a Lumen Health data export/);
    await expect(recordsOf('{"formatVersion":2,"measurements":[]}')).rejects.toThrow(/format 2/);
  });
});
