// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BioRecord, SleepRecord } from '../../core/types';
import { InMemoryBioStore } from '../../store/memory';
import { checkLumenEvent, lumenCloudEventsImporter, mapLumenEvents, SLEEP_COMPLETE } from '../lumenCloudEvents';
import type { LumenInstallation, LumenStatus } from '../lumenCloudEvents';
import { ingestLumenBatches } from '../lumenIngest';

const TZ = 'Europe/Berlin';
const fixture = (p: string): string => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const lines = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '');

async function fileIngest(store: InMemoryBioStore, text: string, now: string) {
  const batches = lumenCloudEventsImporter.run(new Blob([text]), { tz: TZ, now, signal: new AbortController().signal, onProgress: () => {} });
  return ingestLumenBatches(batches, store, { now });
}

/** One mapLumenEvents + ingest per message, carrying the installation stamps forward like the server. */
async function mqttIngest(store: InMemoryBioStore, events: unknown[], now: string, installations: Record<string, LumenInstallation> = {}) {
  let records = 0, samples = 0;
  const status: LumenStatus[] = [];
  for (const ev of events) {
    const r = mapLumenEvents([ev], { tz: TZ, now, channel: 'mqtt:lumen', installations });
    installations = r.installations;
    status.push(...r.status);
    const rep = await ingestLumenBatches([r.batch], store, { now });
    records += rep.records;
    samples += rep.samples;
  }
  return { records, samples, installations, status };
}

const strip = (r: BioRecord): unknown => {
  const { channel: _c, ingested_at: _i, ...prov } = r.provenance;
  return { ...r, provenance: prov };
};

async function snapshot(store: InMemoryBioStore) {
  const records = (await store.records()).map((e) => ({ sourceKey: e.sourceKey, record: strip(e.record) }));
  const streams = [...new Set((await store.manifests()).map((m) => m.stream))].sort();
  const samples: Record<string, unknown> = {};
  for (const stream of streams) samples[stream] = await store.samples({ stream, from: '2000-01-01', to: '2100-01-01' });
  return { records, samples };
}

const sleepsOf = async (store: InMemoryBioStore): Promise<SleepRecord[]> => (await store.records({ kind: 'sleep' })).map((e) => e.record as SleepRecord);

describe('lumen identical batch (SUITE_SPEC §14.5)', () => {
  it('file and broker give the same stored records; the broker after the file adds nothing', async () => {
    const file = fixture('qa/fixtures/lumen/cloudevents.synthetic.jsonl');
    const stream = lines(fixture('qa/fixtures/lumen/mqtt-stream.synthetic.jsonl')).map((l) => JSON.parse((JSON.parse(l) as { payload: string }).payload) as unknown);
    expect(stream).toHaveLength(lines(file).length);

    const a = new InMemoryBioStore();
    const rep = await fileIngest(a, file, '2026-10-01T00:00:00.000Z');
    expect(rep.records).toBeGreaterThan(0);
    expect(rep.samples).toBeGreaterThan(0);
    const b = new InMemoryBioStore();
    const live = await mqttIngest(b, stream, '2026-10-02T09:00:00.000Z');
    const sa = await snapshot(a);
    expect(await snapshot(b)).toEqual(sa);
    expect(Object.keys(sa.samples)).toEqual(expect.arrayContaining(['hr', 'spo2', 'skin_temp', 'hrv', 'steps', 'distance', 'vendor:vascular_age', 'vendor:bp_sys_estimate']));

    // the night sent twice (provisional, then complete) is one record, the complete one, and main
    const nights = await sleepsOf(b);
    expect(nights).toHaveLength(1);
    expect(nights[0]!.quality.flags).not.toContain('provisional_stages');
    expect(nights[0]!.is_main).toBe(true);
    expect(nights[0]!.version).toBeGreaterThan(SLEEP_COMPLETE);
    const daily = (await b.records({ kind: 'daily' })).map((e) => e.record).find((r) => r.kind === 'daily' && r.steps !== undefined);
    expect(daily).toMatchObject({ steps: 6400, provenance: { channel: 'mqtt:lumen' } });

    expect(live.installations.install123).toMatchObject({ firmware: 'V0789' });
    expect(live.status).toEqual([{ kind: 'battery', at: '2026-09-14T12:35:00.000Z', installationId: 'install123', value: 64 }]);

    const again = await mqttIngest(a, stream, '2026-10-03T09:00:00.000Z');
    expect(again).toMatchObject({ records: 0, samples: 0 });
    expect(await snapshot(a)).toEqual(sa);
    // and the other way round
    expect((await fileIngest(b, file, '2026-10-03T10:00:00.000Z'))).toMatchObject({ records: 0, samples: 0 });
  });

  it('the headless spike ring stream gives the same records one line at a time', async () => {
    const text = fixture('packages/companion/spike/headless/fixtures/ring.jsonl');
    const events = lines(text).map((l) => JSON.parse(l) as unknown);
    const a = new InMemoryBioStore();
    await fileIngest(a, text, '2026-10-01T00:00:00.000Z');
    const b = new InMemoryBioStore();
    await mqttIngest(b, events, '2026-10-02T00:00:00.000Z');
    const sa = await snapshot(a);
    expect(await snapshot(b)).toEqual(sa);
    expect((sa.samples.hr as unknown[]).length).toBe(120);
    expect(await mqttIngest(a, events, '2026-10-03T00:00:00.000Z')).toMatchObject({ records: 0, samples: 0 });
  });
});

const ce = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  specversion: '1.0', id: `pl-${type}-${String(data.observed_at ?? '')}-${String(data.received_at ?? '')}`, type, source: 'urn:pulseloop:installation:abc', subject: 'x', time: data.observed_at, datacontenttype: 'application/json',
  data: { schema_version: 1, ...data }, ...extra,
});
const night = (start: string, minutes: number, complete: boolean, received: string, stage = 'light'): Record<string, unknown> =>
  ce('health.sleep.timeline.updated', { observed_at: start, received_at: received, sample_interval_minutes: 1, complete_session: complete, stages: Array.from({ length: minutes }, () => stage) });

describe('checkLumenEvent', () => {
  it('classifies envelopes', () => {
    expect(checkLumenEvent(ce('health.metric.observed', { observed_at: '2026-09-14T12:30:00Z', metric: 'hr', value: 70 }))).toEqual({ ok: true, type: 'health.metric.observed', installationId: 'abc' });
    expect(checkLumenEvent(ce('health.device.wear_state.updated', { observed_at: '2026-09-14T12:30:00Z', worn: true }))).toMatchObject({ ok: true });
    expect(checkLumenEvent(ce('health.metric.observed', { observed_at: '2026-09-14T12:30:00Z', metric: 'hr', value: 70 }, { source: 'elsewhere' }))).toEqual({ ok: true, type: 'health.metric.observed' });
    for (const bad of [null, 'x', [], { type: 'health.metric.observed', id: 'a', data: {} }, ce('health.metric.observed', {}, { specversion: '0.3' }), ce('health.metric.observed', {}, { id: '' })]) {
      expect(checkLumenEvent(bad)).toEqual({ ok: false, reason: 'not_cloudevent' });
    }
    expect(checkLumenEvent(ce('com.example.thing', {}))).toEqual({ ok: false, reason: 'unknown_type' });
    expect(checkLumenEvent(ce('health.novel.thing', {}))).toEqual({ ok: false, reason: 'unknown_type' });
    for (const bad of [
      ce('health.metric.observed', { observed_at: '2026-09-14T12:30:00Z', metric: 'hr' }),
      ce('health.metric.observed', { observed_at: 'yesterday', metric: 'hr', value: 70 }),
      ce('health.sleep.timeline.updated', { observed_at: '2026-09-14T12:30:00Z', stages: 'light' }),
      ce('health.device.battery.updated', { observed_at: '2026-09-14T12:30:00Z' }),
      { ...ce('health.metric.observed', {}), data: 'nope' },
    ]) expect(checkLumenEvent(bad)).toEqual({ ok: false, reason: 'invalid_payload' });
  });

  it('stamps device and firmware per installation and normalises vendor keys', () => {
    const now = '2026-10-01T00:00:00.000Z';
    const first = mapLumenEvents([ce('health.device.identified', { observed_at: '2026-09-14T10:00:00Z', device_type: 'ring', model_id: 'R99' }), ce('health.device.firmware.updated', { observed_at: '2026-09-14T10:00:00Z', version: 'V1' })], { tz: TZ, now, channel: 'mqtt:lumen' });
    expect(first.installations.abc).toMatchObject({ deviceType: 'ring', modelId: 'R99', firmware: 'V1' });
    const r = mapLumenEvents([ce('health.vendor_metric.observed', { observed_at: '2026-09-14T12:30:00Z', metric: 'Vascular Age', value: 39, unit: 'years' })], { tz: TZ, now, channel: 'mqtt:lumen', installations: first.installations });
    expect(r.batch.records[0]).toMatchObject({ metric: 'vendor:vascular_age', provenance: { device: { model: 'J-Style 2301', firmware: 'V1', tier: 'C' } } }); // the reported model stays out (R20-ID-01)
    expect(r.streams).toEqual({ 'vendor:vascular_age': 1 });
  });
});

describe('sleep versions and is_main across batches', () => {
  const now = '2026-10-01T00:00:00.000Z';
  const nap = night('2026-09-14T04:00:00Z', 30, true, '2026-09-14T05:00:00Z');
  const main = night('2026-09-13T22:00:00Z', 300, true, '2026-09-14T06:00:00Z');

  it('a longer night arriving later takes is_main from the nap stored earlier', async () => {
    const s = new InMemoryBioStore();
    await mqttIngest(s, [nap], now);
    expect((await sleepsOf(s)).map((r) => r.is_main)).toEqual([true]);
    await mqttIngest(s, [main], now);
    const all = await sleepsOf(s);
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.is_main).map((r) => r.asleep_s)).toEqual([300 * 60]);
    expect(all.every((r) => r.time.local_date === '2026-09-14')).toBe(true);
    // the same events as one file agree on which night is main
    const f = new InMemoryBioStore();
    await fileIngest(f, [nap, main].map((e) => JSON.stringify(e)).join('\n'), now);
    expect((await sleepsOf(f)).map((r) => [r.record_id, r.is_main])).toEqual(all.map((r) => [r.record_id, r.is_main]));
  });

  it('a complete night beats a provisional one in either order', async () => {
    const prov = night('2026-09-13T22:00:00Z', 200, false, '2026-09-14T07:00:00Z', 'deep');
    for (const order of [[main, prov], [prov, main]]) {
      const s = new InMemoryBioStore();
      await mqttIngest(s, order, now);
      const all = await sleepsOf(s);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ asleep_s: 300 * 60, is_main: true });
      expect(all[0]!.quality.flags).not.toContain('provisional_stages');
    }
  });
});
