// @vitest-environment node
/**
 * One ring = one source (SUITE_SPEC §15.2) at the id level: the same night, day and minute read over Bluetooth
 * (`ringRecords`) and relayed by Lumen Health (`mapLumenEvents` filed under the ring key through the fold) is one stored
 * record and one stored sample, in either arrival order, and the most complete version is the one readers see. Without
 * a ring (no fold) Lumen keeps its own ids.
 */
import { describe, expect, it } from 'vitest';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { ringRecords, type RingRecordContext } from '../../../../packages/rings/src/records';
import { ringIdentity, ringSourceKey, type RingEvent } from '../../../../packages/rings/src/types';
import { dailyRecordId, LUMEN_SOURCE, sleepRecordId } from '../../core/recordIds';
import { lumenFold, LUMEN_SOURCE_KEY } from '../../core/source';
import type { BioProvenance, DailyRecord, SleepRecord } from '../../core/types';
import { mapLumenEvents } from '../../importers/lumenCloudEvents';
import { ingestLumenBatches } from '../../importers/lumenIngest';
import { InMemoryBioStore } from '../../store/memory';
import { ingestBatches } from '../pipeline';

const TZ = 'Europe/Berlin';
const RING = ringSourceKey(ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETIC007' }));
const FOLD = lumenFold({ lumen: RING })!;
const START = '2026-09-13T22:40:00Z';
const DAY = '2026-09-14';
const STAGES = ['awake', 'awake', 'light', 'light', 'deep', 'deep', 'rem', 'light', 'awake'] as const;

const ringCtx = (receivedAt: string): RingRecordContext => ({
  identity: ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETIC007' }),
  family: jstyle2301, firmware: 'V0525', tz: TZ, tzOffsetS: 7200,
  receivedS: Date.parse(receivedAt) / 1000, ingestedAt: new Date(receivedAt).toISOString(),
  producer: { name: 'test', version: '1' },
});
const ringNight = (complete: boolean): RingEvent => ({ type: 'sleepEpochs', start: Date.parse(START), epochS: 60, stages: [...STAGES], rawCodes: [], firmware: 'V0525', complete });
const ringDay = (steps: number, kcal?: number): RingEvent => ({ type: 'dailyTotal', localDay: Date.parse(`${DAY}T10:00:00Z`), steps, distanceM: steps * 0.7, ...(kcal !== undefined ? { kcal } : {}) });
const ringHr = (t: string, value: number, origin: 'history' | 'live' = 'history'): RingEvent => ({ type: 'sample', stream: 'hr', t: Date.parse(t), value, unit: 'bpm', origin });

const ce = (type: string, observed: string, received: string, data: Record<string, unknown>): Record<string, unknown> => ({
  specversion: '1.0', id: `pl-${type}-${observed}-${received}`, type, source: 'urn:pulseloop:installation:abc', subject: 'x', time: observed, datacontenttype: 'application/json',
  data: { schema_version: 1, observed_at: observed, received_at: received, ...data },
});
const lumenNight = (complete: boolean, received: string) => ce('health.sleep.timeline.updated', START, received, { sample_interval_minutes: 1, complete_session: complete, stages: [...STAGES] });
const lumenDay = (fields: { steps?: number; activeMin?: number }, received: string) =>
  ce('health.activity.updated', `${DAY}T10:00:00Z`, received, { ...(fields.steps !== undefined ? { steps: fields.steps, distance_m: fields.steps * 0.7 } : {}), ...(fields.activeMin !== undefined ? { active_minutes: fields.activeMin } : {}) });
const lumenHr = (t: string, value: number, provenance: 'device_history' | 'device_live' = 'device_history') => ce('health.metric.observed', t, t, { metric: 'hr', value, unit: 'bpm', provenance });

async function ring(store: InMemoryBioStore, events: RingEvent[], receivedAt: string) {
  return ingestBatches([ringRecords(events, ringCtx(receivedAt))], store, { now: receivedAt });
}
async function lumen(store: InMemoryBioStore, events: unknown[], now: string, fold: typeof FOLD | null = FOLD) {
  const r = mapLumenEvents(events, { tz: TZ, now, channel: 'mqtt:lumen' });
  return ingestLumenBatches([r.batch], store, { now, ...(fold ? { fold } : {}) });
}
const nights = async (store: InMemoryBioStore) => (await store.records({ kind: 'sleep' })).map((e) => ({ sourceKey: e.sourceKey, record: e.record as SleepRecord }));
const days = async (store: InMemoryBioStore) => (await store.records({ kind: 'daily' })).map((e) => ({ sourceKey: e.sourceKey, record: e.record as DailyRecord }));

const NIGHT_ID = sleepRecordId({ source: RING, start: '2026-09-13T22:40:00.000Z' });
const DAY_ID = dailyRecordId({ source: RING, metric: 'activity', localDate: DAY });

describe('ring read and Lumen message of the same night and day under one ring source', () => {
  it.each([['ring first', false], ['Lumen first', true]])('%s: one night, one day; the complete night wins, the ring’s total wins the fields both have, Lumen fills the rest', async (_name, lumenFirst) => {
    const store = new InMemoryBioStore();
    // the ring read the night while it was still provisional, at 10:00; Lumen relays the complete night at 12:35
    const ringRead = () => ring(store, [ringNight(false), ringDay(3000)], `${DAY}T10:00:00Z`);
    const lumenRead = () => lumen(store, [lumenNight(true, `${DAY}T12:35:00Z`), lumenDay({ steps: 6400, activeMin: 30 }, `${DAY}T12:35:00Z`)], `${DAY}T12:36:00Z`);
    if (lumenFirst) { await lumenRead(); await ringRead(); } else { await ringRead(); await lumenRead(); }

    const n = await nights(store);
    expect(n.map((e) => [e.sourceKey, e.record.record_id])).toEqual([[RING, NIGHT_ID]]);
    expect(n[0]!.record.quality.flags).not.toContain('provisional_stages');
    const d = await days(store);
    expect(d.map((e) => [e.sourceKey, e.record.record_id])).toEqual([[RING, DAY_ID]]);
    expect(d[0]!.record).toMatchObject({ steps: 3000, active_min: { light: 0, moderate: 30, vigorous: 0 } });
  });

  it.each([['ring first', false], ['Lumen first', true]])('%s: a ring day total read after Lumen supersedes it', async (_name, lumenFirst) => {
    const store = new InMemoryBioStore();
    const ringRead = () => ring(store, [ringNight(true), ringDay(7000)], `${DAY}T18:00:00Z`);
    const lumenRead = () => lumen(store, [lumenNight(true, `${DAY}T12:35:00Z`), lumenDay({ steps: 6400 }, `${DAY}T12:35:00Z`)], `${DAY}T12:36:00Z`);
    if (lumenFirst) { await lumenRead(); await ringRead(); } else { await ringRead(); await lumenRead(); }
    const d = await days(store);
    expect(d.map((e) => [e.record.record_id, e.record.steps])).toEqual([[DAY_ID, 7000]]);
    expect((await nights(store)).map((e) => e.record.record_id)).toEqual([NIGHT_ID]);
  });

  it.each([['ring first', false], ['Lumen first', true]])('%s: the fields of a day total read by both paths are all kept (steps and energy from the ring, active minutes from Lumen)', async (_name, lumenFirst) => {
    const store = new InMemoryBioStore();
    const ringRead = () => ring(store, [ringDay(8000, 410)], `${DAY}T18:00:00Z`);
    const lumenRead = () => lumen(store, [lumenDay({ activeMin: 30 }, `${DAY}T12:35:00Z`)], `${DAY}T12:36:00Z`);
    if (lumenFirst) { await lumenRead(); await ringRead(); } else { await ringRead(); await lumenRead(); }
    const d = await days(store);
    expect(d.map((e) => e.record.record_id)).toEqual([DAY_ID]);
    expect(d[0]!.record).toMatchObject({ steps: 8000, active_kcal: 410, active_min: { light: 0, moderate: 30, vigorous: 0 } });
  });

  it('under a ring total that lacks a field, every later Lumen snapshot of that field is kept and the newest is read; a re-import is a duplicate', async () => {
    const store = new InMemoryBioStore();
    await ring(store, [ringDay(8000)], `${DAY}T10:00:00Z`);
    await lumen(store, [lumenDay({ steps: 4000, activeMin: 5 }, `${DAY}T09:00:00Z`)], `${DAY}T09:01:00Z`);
    const late = [lumenDay({ steps: 7900, activeMin: 70 }, `${DAY}T22:00:00Z`)];
    expect(await lumen(store, late, `${DAY}T22:01:00Z`)).toMatchObject({ records: 1 });
    expect((await days(store)).map((e) => e.record)).toMatchObject([{ record_id: DAY_ID, steps: 8000, active_min: { light: 0, moderate: 70, vigorous: 0 } }]);
    expect(await lumen(store, late, `${DAY}T22:02:00Z`)).toMatchObject({ records: 0, duplicates: 1 });
  });

  it('without a ring, a stored daily (versioned by its received time, as v0.5.0 stored it) is not undone by a re-imported older snapshot', async () => {
    const store = new InMemoryBioStore();
    const id = dailyRecordId({ source: LUMEN_SOURCE, metric: 'activity', localDate: DAY });
    const p: BioProvenance = { channel: 'mqtt:lumen', recording_method: 'automatic', modality: 'sensed', ingested_at: `${DAY}T23:01:00.000Z`, source_app: 'Lumen', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' } };
    await store.putRecord({ kind: 'daily', record_id: id, version: Math.round(Date.parse(`${DAY}T23:00:00Z`) / 1000), time: { tz_offset_s: 7200, local_date: DAY }, provenance: p, quality: { validation: 'vendor_proprietary', confidence: null, flags: [] }, steps: 12000 }, LUMEN_SOURCE_KEY);
    await lumen(store, [lumenDay({ steps: 3000 }, `${DAY}T10:05:00Z`)], `${DAY}T23:30:00Z`, null);
    expect((await days(store)).map((e) => [e.record.record_id, e.record.steps])).toEqual([[id, 12000]]);
  });

  it('the same minute from both paths is one sample per origin', async () => {
    const store = new InMemoryBioStore();
    const t = `${DAY}T05:00:00Z`;
    await ring(store, [ringHr(t, 61), ringHr(t, 95, 'live')], `${DAY}T10:00:00Z`);
    await lumen(store, [lumenHr(t, 61), lumenHr(t, 95, 'device_live')], `${DAY}T12:36:00Z`);
    const got = await store.samples({ stream: 'hr', from: DAY, to: DAY });
    expect(got.map((s) => [s.sourceKey, s.t, s.value, s.origin]).sort()).toEqual([[RING, Date.parse(t), 61, 'history'], [RING, Date.parse(t), 95, 'live']]);
    expect((await store.manifests()).filter((m) => m.stream === 'hr').map((m) => m.sourceKey)).toEqual([RING]);
  });

  it('without a ring, Lumen keeps its own ids', async () => {
    const store = new InMemoryBioStore();
    await lumen(store, [lumenNight(true, `${DAY}T12:35:00Z`), lumenDay({ steps: 6400 }, `${DAY}T12:35:00Z`)], `${DAY}T12:36:00Z`, null);
    expect((await nights(store)).map((e) => e.record.record_id)).toEqual([sleepRecordId({ source: LUMEN_SOURCE, start: '2026-09-13T22:40:00.000Z' })]);
    expect((await days(store)).map((e) => e.record.record_id)).toEqual([dailyRecordId({ source: LUMEN_SOURCE, metric: 'activity', localDate: DAY })]);
  });
});
