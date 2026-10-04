// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ringRecords, toDecodedEvents, type RingRecordContext } from '../records';
import { jstyle2301 } from '../jstyle2301/family';
import { ringIdentity, ringSourceKey, type RingEvent } from '../types';
import { InMemoryBioStore } from '../../../../src/biometrics/store/memory';
import { ingestBatches } from '../../../../src/biometrics/ingest/pipeline';

const t = Date.UTC(2026, 8, 16, 1);
const ctx: RingRecordContext = {
  identity: ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETIC007' }),
  family: jstyle2301, firmware: 'V0525', tz: 'UTC', tzOffsetS: 0,
  receivedS: Date.UTC(2026, 10, 2) / 1000, ingestedAt: '2026-11-02T00:00:00.000Z',
  producer: { name: 'audit', version: '1' },
};
const hr = (at: number, value: number): RingEvent => ({ type: 'sample', stream: 'hr', t: at, value, unit: 'bpm', origin: 'history' });
const night = (start: number, complete = true): Extract<RingEvent, { type: 'sleepEpochs' }> => ({
  type: 'sleepEpochs', start, epochS: 60, stages: ['light', 'deep'], rawCodes: [2, 1], firmware: 'V0525', complete,
});

describe('C-RINGX record mapping', () => {
  it('counts a retransmitted activity bucket once and retains its energy', () => {
    const bucket: RingEvent = { type: 'activityBucket', start: t, durS: 60, steps: 25, distanceM: 18, kcal: 1.5 };
    const records = ringRecords([bucket, bucket], ctx).records;
    expect(records.find((r) => r.kind === 'daily')).toMatchObject({ steps: 25, distance_m: 18, active_kcal: 1.5 });
    expect(records.find((r) => r.kind === 'series' && r.metric === 'active_kcal')).toMatchObject({ values: [1.5], aggregation: 'sum' });
  });

  it('keeps the latest value once per stream, origin and timestamp', () => {
    const records = ringRecords([hr(t, 60), hr(t, 65), hr(t + 60_000, 70)], ctx).records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ values: [65, 70], t_offset_s: [0, 60] });
  });

  it.each([false, true])('updates a daily total across two reads in either arrival order (reverse=%s)', async (reverse) => {
    const early = ringRecords([{ type: 'dailyTotal', localDay: t, steps: 100, distanceM: 60 }], ctx);
    const late = ringRecords([{ type: 'dailyTotal', localDay: t, steps: 200, distanceM: 120 }], { ...ctx, receivedS: ctx.receivedS + 60 });
    expect(early.records[0]!.record_id).toBe(late.records[0]!.record_id);
    expect(late.records[0]!.version).toBeGreaterThan(early.records[0]!.version);
    const store = new InMemoryBioStore();
    const result = await ingestBatches(reverse ? [late, early] : [early, late], store, { now: ctx.ingestedAt });
    expect(result.rejected).toBe(0);
    expect((await store.records()).map((r) => r.record)).toMatchObject([{ steps: 200, distance_m: 120 }]);
  });

  it('joins adjacent sleep pages into one nonoverlapping night', () => {
    const sleeps = ringRecords([night(t + 120_000), night(t), night(t)], ctx).records.filter((r) => r.kind === 'sleep');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toMatchObject({ asleep_s: 240, time: { start: new Date(t).toISOString(), end: new Date(t + 240_000).toISOString() } });
    for (let i = 1; i < sleeps[0]!.stages!.length; i++) {
      expect(Date.parse(sleeps[0]!.stages![i]!.start)).toBeGreaterThanOrEqual(Date.parse(sleeps[0]!.stages![i - 1]!.end));
    }
  });

  it('preserves subminute sleep epoch durations', () => {
    const event = { ...night(t), epochS: 30 };
    expect(toDecodedEvents([event])[0]).toMatchObject({ epochS: 30 });
    expect(ringRecords([event], ctx).records[0]).toMatchObject({ asleep_s: 60 });
  });

  it('keeps complete coverage over overlapping provisional sleep and accepts a later complete revision', () => {
    const complete: ReturnType<typeof night> = { ...night(t), stages: ['deep', 'deep'], rawCodes: [1, 1] };
    const overlap: ReturnType<typeof night> = { ...night(t + 60_000, false), stages: ['awake'], rawCodes: [5] };
    const older = ringRecords([complete, overlap], ctx).records.find((r) => r.kind === 'sleep')!;
    expect(older.quality.flags).not.toContain('provisional_stages');
    expect(older).toMatchObject({ asleep_s: 120 });
    const revised = ringRecords([complete, { ...overlap, complete: true }], ctx).records.find((r) => r.kind === 'sleep')!;
    expect(revised).toMatchObject({ asleep_s: 60, awake_s: 60 });
    expect(revised.record_id).toBe(older.record_id);
  });

  it('preserves sample origins through mapping and ingestion', async () => {
    const events = ['history', 'live', 'spot', 'workout_stream'].map((origin, i) => ({ ...hr(t, 60 + i), origin } as RingEvent));
    const batch = ringRecords(events, ctx);
    expect(new Set(batch.records.map((r) => r.record_id)).size).toBe(4);
    const store = new InMemoryBioStore();
    await ingestBatches([batch, batch], store, { now: ctx.ingestedAt });
    const samples = await store.samples({ sourceKey: ringSourceKey(ctx.identity), stream: 'hr', from: '2026-09-16', to: '2026-09-16' });
    expect(samples.map((s) => s.origin).sort()).toEqual(['history', 'live', 'spot', 'workout_stream']);
  });

  it('retains workout distance, energy and heart rate', () => {
    const event: RingEvent = { type: 'workout', start: t, end: t + 600_000, kind: 'walk', distanceM: 500, kcal: 20, hrAvg: 90, hrMax: 110 };
    expect(ringRecords([event], ctx).records[0]).toMatchObject({ distance_m: 500, active_kcal: 20, hr_avg_bpm: 90, hr_max_bpm: 110 });
  });

  it('uses the historical zone offset instead of the offset at read time', async () => {
    const event = hr(Date.UTC(2026, 6, 1, 22, 30), 64); // 00:30 on July 2 in Berlin
    const batch = ringRecords([event], { ...ctx, tz: 'Europe/Berlin', tzOffsetS: 3600 });
    expect(batch.records[0]!.time).toMatchObject({ local_date: '2026-07-02', tz_offset_s: 7200 });
    const store = new InMemoryBioStore();
    await ingestBatches([batch], store, { now: ctx.ingestedAt });
    expect((await store.manifests()).map((m) => m.local_date)).toEqual(['2026-07-02']);
  });

  it('keeps both offsets of a DST transition day through ingestion', async () => {
    const batch = ringRecords([hr(Date.UTC(2026, 9, 24, 22, 30), 61), hr(Date.UTC(2026, 9, 25, 22, 30), 62)], { ...ctx, tz: 'Europe/Berlin', tzOffsetS: 3600 });
    const store = new InMemoryBioStore();
    const result = await ingestBatches([batch], store, { now: ctx.ingestedAt });
    expect(result.samples).toBe(2);
    expect((await store.manifests()).map((m) => [m.local_date, m.n])).toEqual([['2026-10-25', 2]]);
  });

  it.each([false, true])('keeps a complete night over a later provisional read (reverse=%s)', async (reverse) => {
    const complete = ringRecords([night(t)], ctx);
    const provisional = ringRecords([night(t, false)], { ...ctx, receivedS: ctx.receivedS + 60 });
    const store = new InMemoryBioStore();
    await ingestBatches(reverse ? [complete, provisional] : [provisional, complete], store, { now: ctx.ingestedAt });
    const records = await store.records({ kind: 'sleep' });
    expect(records).toHaveLength(1);
    expect(records[0]!.record.quality.flags).not.toContain('provisional_stages');
    expect(records[0]!.sourceKey).toBe(ringSourceKey(ctx.identity));
  });

  for (const reverse of [false, true]) it(`C-RINGX-17: replaces a contained provisional tail with the complete night (reverse=${reverse})`, async () => {
    const tail = ringRecords([night(t + 120_000, false)], ctx);
    const full = ringRecords([night(t), night(t + 120_000)], { ...ctx, receivedS: ctx.receivedS + 60 });
    const store = new InMemoryBioStore();
    await ingestBatches(reverse ? [full, tail] : [tail, full], store, { now: ctx.ingestedAt });
    // Reconciliation must also work when offline readers first see different start times of the same session.
    expect(await store.records({ kind: 'sleep' })).toHaveLength(1);
  });
});
