// @vitest-environment node
// R20-ID-01, -03, -06: one Lumen source key for every path; a re-read ring night is a newer version, not a duplicate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapEventsToBatch, type EventMapContext } from '../../core/events';
import { SLEEP_COMPLETE } from '../../core/recordIds';
import { LUMEN_SOURCE_KEY, sourceKeyOf } from '../../core/source';
import type { SleepRecord } from '../../core/types';
import { ingestBatches } from '../../ingest/pipeline';
import { InMemoryBioStore } from '../../store/memory';
import { lumenArchiveImporter } from '../lumenArchive';
import { mapLumenEvents, recomputeMainSleep } from '../lumenCloudEvents';
import { ingestLumenBatches } from '../lumenIngest';

const TZ = 'Europe/Berlin';
const SRC = 'urn:pulseloop:installation:i1';
const identified = { specversion: '1.0', id: 'pl-id-1', type: 'health.device.identified', source: SRC, subject: 'device', time: '2026-09-14T12:00:00Z',
  data: { schema_version: 1, observed_at: '2026-09-14T12:00:00Z', device_type: 'Other Name 2301', model_id: 'Other Name 2301' } };
const hr = { specversion: '1.0', id: 'pl-hr-1', type: 'health.metric.observed', source: SRC, subject: 'hr', time: '2026-09-14T12:30:00Z',
  data: { schema_version: 1, observed_at: '2026-09-14T12:30:00Z', received_at: '2026-09-14T12:35:00Z', metric: 'hr', value: 72, unit: 'bpm', provenance: 'device_history' } };
const sleep = { specversion: '1.0', id: 'pl-sl-1', type: 'health.sleep.timeline.updated', source: SRC, subject: 'sleep_timeline', time: '2026-09-13T22:40:00Z',
  data: { schema_version: 1, observed_at: '2026-09-13T22:40:00Z', received_at: '2026-09-14T12:35:00Z', sample_interval_minutes: 1, complete_session: true, stages: Array(120).fill('light') } };

describe('Lumen source key (R20-ID-01)', () => {
  it('MQTT (before and after the identified event), the CloudEvents file and the archive give one key', async () => {
    const file = mapLumenEvents([hr, sleep], { tz: TZ, now: '2026-10-01T00:00:00Z', channel: 'file:lumen_cloudevents' });
    const before = mapLumenEvents([hr], { tz: TZ, now: '2026-10-02T00:00:00Z', channel: 'mqtt:lumen' });
    const after = mapLumenEvents([identified, hr, sleep], { tz: TZ, now: '2026-10-02T00:00:00Z', channel: 'mqtt:lumen' });
    expect(after.installations.i1).toMatchObject({ modelId: 'Other Name 2301' });
    const fixture = readFileSync(fileURLToPath(new URL('../__fixtures__/lumen-archive.json', import.meta.url)), 'utf8');
    const archive = [];
    for await (const b of lumenArchiveImporter.run(new Blob([fixture]), { tz: TZ, now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} })) archive.push(...b.records);
    const keys = new Set([...file.batch.records, ...before.batch.records, ...after.batch.records, ...archive].map((r) => sourceKeyOf(r.provenance)));
    expect([...keys]).toEqual([LUMEN_SOURCE_KEY]);
    expect(LUMEN_SOURCE_KEY).toBe('file:lumen_cloudevents|:j-style_2301');
    // the model Lumen reports never reaches provenance (and so never a label)
    for (const r of [...after.batch.records, ...archive]) expect(r.provenance.device?.model).toBe('J-Style 2301');
  });

  it('one ring through the file and then MQTT: one copy of a sample, one night, one source', async () => {
    const store = new InMemoryBioStore();
    const a = mapLumenEvents([hr, sleep], { tz: TZ, now: '2026-10-01T00:00:00Z', channel: 'file:lumen_cloudevents' });
    await ingestLumenBatches([a.batch], store, { now: '2026-10-01T00:00:00Z' });
    const b = mapLumenEvents([identified, hr, sleep], { tz: TZ, now: '2026-10-02T00:00:00Z', channel: 'mqtt:lumen' });
    const rep = await ingestLumenBatches([b.batch], store, { now: '2026-10-02T00:00:00Z' });
    expect(rep.samples).toBe(0);
    expect(await store.samples({ stream: 'hr', from: '2026-09-01', to: '2026-09-30' })).toHaveLength(1);
    expect(await store.records({ kind: 'sleep' })).toHaveLength(1);
    expect((await store.sources()).map((s) => [s.sourceKey, s.label])).toEqual([[LUMEN_SOURCE_KEY, 'J-Style 2301']]);
  });

  it('is_main groups nights stored under an older provenance model with new ones (R20-ID-06)', () => {
    const night = (start: string, asleep: number, model: string): SleepRecord => ({
      kind: 'sleep', record_id: `r-${start}`, version: 1, is_main: false, asleep_s: asleep,
      time: { start, end: start, tz_offset_s: 0, local_date: '2026-09-14' },
      provenance: { channel: 'mqtt:lumen', device: { type: 'ring', model, tier: 'C' }, recording_method: 'automatic', modality: 'sensed', ingested_at: start },
      quality: { validation: 'vendor_proprietary', confidence: null, flags: [] },
    } as unknown as SleepRecord);
    const out = recomputeMainSleep([{ ...night('2026-09-13T22:00:00.000Z', 3600, 'Other Name 2301'), is_main: true }], [night('2026-09-14T01:00:00.000Z', 7200, 'J-Style 2301')]);
    expect(out.map((r) => [r.record_id, r.is_main])).toEqual([['r-2026-09-13T22:00:00.000Z', false], ['r-2026-09-14T01:00:00.000Z', true]]);
  });
});

describe('ring sleep versions (R20-ID-03)', () => {
  const ctx = (ingestedAt: string): EventMapContext => ({
    tz: TZ, tzOffsetS: 7200, channel: 'ble:jstyle2301', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' }, decoder: 'jstyle2301/V0789@1',
    producer: { name: 't', version: '1' }, ingestedAt, exportedAt: ingestedAt,
  });
  const t0 = Date.parse('2026-09-13T22:40:00Z');
  const night = (stages: string[], complete: boolean, at: string) =>
    mapEventsToBatch([{ type: 'sleepEpochs', start: t0, epochS: 60, stages, rawCodes: [], firmware: 'V0789', complete }], ctx(at));
  const light = Array<string>(120).fill('light');
  const reclassified = [...Array<string>(60).fill('light'), ...Array<string>(60).fill('deep')];
  const sleeps = async (s: InMemoryBioStore) => (await s.records({ kind: 'sleep' })).map((e) => e.record as SleepRecord);

  it('a complete night the ring re-classifies on a later read is stored as a newer version that wins', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([night(light, true, '2026-10-01T00:00:00Z')], store, { now: '2026-10-01T00:00:00Z' });
    const rep = await ingestBatches([night(reclassified, true, '2026-10-02T00:00:00Z')], store, { now: '2026-10-02T00:00:00Z' });
    expect(rep).toMatchObject({ records: 1, duplicates: 0 });
    const sl = await sleeps(store);
    expect(sl).toHaveLength(1);
    expect(sl[0]!.deep_s).toBe(3600);
    expect(sl[0]!.version).toBeGreaterThan(SLEEP_COMPLETE);
  });

  it('a provisional read after a complete one never replaces it', async () => {
    const store = new InMemoryBioStore();
    await ingestBatches([night(reclassified, true, '2026-10-01T00:00:00Z')], store, { now: '2026-10-01T00:00:00Z' });
    const rep = await ingestBatches([night(light, false, '2026-10-02T00:00:00Z')], store, { now: '2026-10-02T00:00:00Z' });
    expect(rep.records).toBe(0);
    const sl = await sleeps(store);
    expect(sl).toHaveLength(1);
    expect(sl[0]!.deep_s).toBe(3600);
    expect(sl[0]!.quality.flags).not.toContain('provisional_stages');
  });
});
