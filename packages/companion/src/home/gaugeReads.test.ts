// @vitest-environment node
/**
 * The kept Gauge reads (r087, `./gaugeReads.ts`): an answer from memory is the uncached answer byte for byte, whatever
 * was written in between (an upload, a deletion, a re-delivery, a Health Connect revision or tombstone, a detection run,
 * a change of the fusion context, a new installation, dedupe and its undo, another process); a write drops only what it
 * touches; reads that run take turns with the event loop; the same read asked twice at once runs once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDetectionJob } from './detect/job.ts';
import { createFusionContextStore } from './fusionContext.ts';
import { createGaugeReads, gaugeEtag, type GaugeReads } from './gaugeReads.ts';
import { FIXTURE_DATE, FIXTURE_NOW, FIXTURE_TZ, fixtureDay, ist } from './gaugeV2Fixture.ts';
import { activityDaily, battery, deletion, hcDeleted, hcRecord, hr, insight, INSTALL, lumenEvent, metric, OTHER_INSTALL, phoneSteps, ringSteps, shortVideo, socialTime, sleepPacket, workout } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const P = 'person-1';
const D = FIXTURE_DATE;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

function setup(o: { maxBytes?: number; maxEntries?: number } = {}) {
  const dir = mkdtempSync(join(TMP, 'gauge-reads-'));
  const file = join(dir, 'lumen.db');
  const store = openLumenStore(file);
  const clock = { now: FIXTURE_NOW };
  const context = createFusionContextStore(() => join(dir, 'fusion-context.json'));
  const reads = createGaugeReads({ store: () => store, opened: () => store, fusion: (id) => context.get(id), now: () => clock.now, ...o });
  // the same tools with nothing kept: what every answer must equal
  const plain = lumenToolSet(() => store, FIXTURE_TZ, () => clock.now, () => context.get(P));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close(), () => reads.close());
  const events = [
    ...fixtureDay(), battery('2026-10-20T12:00:00Z', 64), insight('sleep_score', '2026-10-19T18:30:00Z', 82), shortVideo(D, '2026-10-20T16:00:00Z', { instagram: 5 }),
    socialTime(D, '2026-10-20T16:00:00Z', { instagram: 1200, youtube: 600 }),
    workout('w-1', '2026-10-20T01:15:00Z'), hcRecord('Weight', 'kg-1', '2026-10-19T02:00:00Z', '2026-10-19T02:00:00Z', { kg: 71.2 }, { origin: 'com.scale' }),
    hcRecord('ExerciseSession', 'ex-1', '2026-10-18T11:00:00Z', '2026-10-18T11:40:00Z', { exercise_type: 79, title: null, segments: [], laps: [], route_state: 'none' }, { origin: 'com.other' }),
  ];
  for (let i = 0; i < events.length; i += 500) expect(store.ingest(INSTALL, events.slice(i, i + 500), FIXTURE_NOW).rejected).toEqual([]);
  return { dir, file, store, reads, plain, clock, context };
}

/** Every tool, with dates that are today, yesterday and well before, with and without a zone of their own. */
const READS: Array<[string, Record<string, unknown>]> = [
  ['gauge_data_availability', {}],
  ['gauge_metric_series', { kind: 'hr', from: D, to: D }],
  ['gauge_metric_series', { kind: 'hr', from: '2026-10-14', to: D, bucket: 'day' }],
  ['gauge_metric_series', { kind: 'glucose', from: D, to: D }],
  ['gauge_daily_summary', { date: D }],
  ['gauge_daily_summary', { date: '2026-10-18' }],
  ['gauge_sleep', { from: '2026-10-12', to: D }],
  ['gauge_activity', { from: '2026-10-14', to: D }],
  ['gauge_activity', { from: D, to: D, tz: 'UTC' }],
  ['gauge_scores', { from: '2026-10-19', to: D }],
  ['gauge_device_state', {}],
  ['gauge_short_video', { from: D, to: D }],
  ['gauge_social_time', { from: D, to: D }],
  ['gauge_workouts', { from: '2026-10-18', to: D }],
  ['gauge_steps', { from: '2026-10-14', to: D }],
  ['gauge_steps', { from: D, to: D, activities: [{ start: iso(ist('07:00')), end: iso(ist('07:30')), kind: 'locomotor', carry: 'pocket' }] }],
  ['gauge_timeline', { date: D }],
  ['gauge_timeline', { date: '2026-10-19' }],
  ['gauge_timeline', { date: '2026-10-16' }],
  ['gauge_timeline', { date: '2026-10-16', tz: 'America/New_York' }],
  ['gauge_hr_intervals', { from: `${D}T05:00`, to: `${D}T20:00` }],
  ['gauge_baselines', { date: D }],
  ['gauge_baselines', { date: '2026-10-17' }],
  ['gauge_hc', { type: 'Steps', from: D, to: D }],
  ['gauge_hc', { type: 'Weight', from: '2026-10-18', to: D }],
  ['gauge_hc', { type: 'ExerciseSession', from: '2026-10-17', to: D }],
  ['gauge_changes', {}],
  ['gauge_changes_state', { refs: 'workout:w-1,hcWeight:kg-1' }],
  ['gauge_detections', {}],
  ['gauge_detections', { from: D, to: D }],
  ['gauge_timeline', { date: 'not a date' }],
];

type T = ReturnType<typeof setup>;
/**
 * Every read through the kept reads equals the plain tool's answer and carries its ETag, twice over: derived (or taken
 * from memory when nothing touched it), then from memory, where the ETag is also known without a store read.
 */
async function same(t: T, stage: string): Promise<{ kept: number; fromMemory: number }> {
  let fromMemory = 0;
  let kept = 0;
  for (const round of [1, 2]) {
    for (const [tool, args] of READS) {
      const a = await t.reads.read(P, FIXTURE_TZ, tool, args);
      const want = await t.plain.call(tool, args);
      const label = `${stage}: ${tool} ${JSON.stringify(args)} (round ${round})`;
      expect(JSON.stringify(a.envelope), label).toBe(JSON.stringify(want));
      expect(a.etag, label).toBe(want.ok ? gaugeEtag(want) : null);
      if (round === 1 && a.cache === 'hit') fromMemory++;
      if (round === 2 && want.ok) {
        expect(a.cache, label).toBe('hit');
        const before = t.store.sqlReads();
        expect(t.reads.etag(P, FIXTURE_TZ, tool, args)?.etag, label).toBe(a.etag);
        expect(t.store.sqlReads(), label).toBe(before);
        kept++;
      }
    }
  }
  return { kept, fromMemory };
}

describe('a kept answer is the uncached answer', () => {
  it('across uploads, the clock, deletions, re-deliveries, Health Connect revisions and tombstones, detection, the fusion context, installations, dedupe and another process', { timeout: 120_000 }, async () => {
    const t = setup();
    const { store, clock } = t;
    const first = await same(t, 'first');
    expect(first.kept).toBe(READS.length - 1);
    expect(first.fromMemory).toBe(0);

    // the clock alone: only the minutesSince… counters move, and nothing is derived again
    clock.now += 7 * 60_000;
    const misses = t.reads.stats().misses;
    await same(t, 'seven minutes later');
    // the one rejected read is never kept: it is derived each time
    expect(t.reads.stats().misses).toBe(misses + 2);

    // an upload for this evening: readings of today, and Gauge's own status report
    clock.now += 60_000;
    const evening = ist('21:10');
    expect(store.ingest(INSTALL, [
      ...Array.from({ length: 10 }, (_, i) => ringSteps(iso(evening + i * 60_000), 40 + i)), ...Array.from({ length: 10 }, (_, i) => phoneSteps(iso(evening + i * 60_000), iso(evening + (i + 1) * 60_000), 44 + i)),
      hr(iso(evening + 90_000), 88), activityDaily(iso(evening + 600_000), 9400), battery(iso(evening), 51), metric('stress', 'index', iso(evening + 30_000), 44),
    ], clock.now).rejected).toEqual([]);
    const afterUpload = await same(t, 'after an upload for today');
    // days the upload cannot reach were answered from memory
    expect(afterUpload.fromMemory).toBeGreaterThan(3);

    // a past day changes: a corrected reading, a new night packet, a late Health Connect record
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [
      hr('2026-10-16T07:05:00Z', 131, { receivedAt: iso(clock.now) }), sleepPacket('2026-10-15T19:40:00Z', Array.from({ length: 45 }, () => 'deep'), { complete: true }),
      hcRecord('Steps', 'late-1', '2026-10-16T09:00:00Z', '2026-10-16T09:20:00Z', { count: 900 }, { origin: 'com.other', native: false, device: null }),
      hcRecord('Distance', 'late-2', '2026-10-16T09:00:00Z', '2026-10-16T09:20:00Z', { m: 700 }, { origin: 'com.other', native: false, device: null }),
    ], clock.now).rejected).toEqual([]);
    await same(t, 'after a past day changed');

    // an exact deletion of one reading, then the same reading delivered again later (it shows again)
    const deleted = hr(iso(evening + 90_000), 88);
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [deletion(iso(clock.now), { category: 'metrics/hr', kind: 'hr', from: iso(evening + 90_000), to: iso(evening + 90_000) })], clock.now).rejected).toEqual([]);
    await same(t, 'after a point deletion');
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [{ ...deleted, data: { ...deleted.data, received_at: iso(clock.now) } }], clock.now)).toMatchObject({ duplicates: 1 });
    await same(t, 'after the re-delivery');

    // a wide deletion (a night's packets), which no window bounds
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [deletion(iso(clock.now), { category: 'sleep/timeline', from: '2026-10-13T12:00:00Z', to: '2026-10-14T12:00:00Z' })], clock.now).rejected).toEqual([]);
    await same(t, 'after a night was deleted');

    // Health Connect: a revision that moves a record to another day, then its tombstone, then a tombstone of a weight
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [hcRecord('ExerciseSession', 'ex-1', '2026-10-17T11:00:00Z', '2026-10-17T11:40:00Z', { exercise_type: 79, title: null, segments: [], laps: [], route_state: 'none' }, { origin: 'com.other', lastModified: iso(clock.now) })], clock.now).rejected).toEqual([]);
    await same(t, 'after a Health Connect record moved');
    clock.now += 60_000;
    expect(store.ingest(INSTALL, [hcDeleted('ExerciseSession', 'ex-1', iso(clock.now)), hcDeleted('Weight', 'kg-1', iso(clock.now))], clock.now).rejected).toEqual([]);
    await same(t, 'after Health Connect tombstones');

    // detection writes its episodes off the request path
    const job = createDetectionJob({ open: () => store, tzOf: () => FIXTURE_TZ, now: () => clock.now });
    cleanup.push(() => job.close());
    const before = await t.reads.read(P, FIXTURE_TZ, 'gauge_detections', {});
    expect(before.cache).toBe('hit');
    const run = await job.run(P);
    expect(run.writes).toBeGreaterThan(0);
    expect((await t.reads.read(P, FIXTURE_TZ, 'gauge_detections', {})).cache).toBe('miss');
    await same(t, 'after a detection run');

    // the person's fusion context: an approved activity today
    clock.now += 60_000;
    expect(t.context.put(P, { windowStartMs: ist('00:00'), windowEndMs: ist('23:59'), activities: [{ startMs: ist('07:00'), endMs: ist('07:30'), kind: 'locomotorPocket' }], corrections: [] }, clock.now).changed).toBe(true);
    const afterContext = await same(t, 'after the fusion context changed');
    expect(afterContext.fromMemory).toBeGreaterThan(3);

    // the Vitals app's own engine pairs: the standalone installation is superseded
    clock.now += 60_000;
    store.noteInstallation(OTHER_INSTALL, { pairedAt: iso(clock.now), app: 'vitals', deviceName: 'Phone' });
    await same(t, 'after another installation paired');
    expect(store.ingest(OTHER_INSTALL, [lumenEvent('metrics/hr', 'hr', 'health.metric.observed', iso(evening + 150_000), { metric: 'hr', value: 91, unit: 'bpm' }, { install: OTHER_INSTALL })], clock.now).rejected).toEqual([]);
    await same(t, 'after the other installation uploaded');

    // dedupe (dry, then for real with a forced offset) and its undo
    store.dedupe({ dryRun: true, categories: ['sleep/timeline', 'metrics'], offsetMs: 0, nowMs: clock.now });
    await same(t, 'after a dry dedupe');
    store.dedupe({ categories: ['sleep/timeline', 'metrics'], offsetMs: 600_000, nowMs: clock.now });
    await same(t, 'after dedupe');
    store.undoDedupe();
    await same(t, 'after the undo');

    // another process writes the same file (the admin CLI)
    const other = openLumenStore(t.file);
    clock.now += 60_000;
    expect(other.ingest(INSTALL, [hr('2026-10-16T08:00:00Z', 77), ringSteps('2026-10-16T08:00:00Z', 30)], clock.now).rejected).toEqual([]);
    other.close();
    await same(t, 'after another process wrote');
  });
});

describe('what a write drops', () => {
  it('today\'s upload leaves a past day\'s timeline, the nights and the baselines standing; the day it touches is derived again', async () => {
    const t = setup();
    // as the app asks: with its zone (a read without one first resolves it from the readings around its range)
    const read = (tool: string, args: Record<string, unknown>) => t.reads.read(P, FIXTURE_TZ, tool, { ...args, tz: FIXTURE_TZ });
    const past = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
    for (const date of past) await read('gauge_timeline', { date });
    await read('gauge_timeline', { date: D });
    await read('gauge_sleep', { from: '2026-10-12', to: D });
    await read('gauge_baselines', { date: D });
    await read('gauge_activity', { from: '2026-10-14', to: D });

    const evening = ist('21:10');
    t.clock.now += 5 * 60_000;
    expect(t.store.ingest(INSTALL, [ringSteps(iso(evening), 60), phoneSteps(iso(evening), iso(evening + 60_000), 62), hr(iso(evening + 30_000), 90), battery(iso(evening), 50)], t.clock.now).rejected).toEqual([]);

    const sql = t.store.sqlReads();
    for (const date of past) expect((await read('gauge_timeline', { date })).cache, date).toBe('hit');
    // steps and a heart-rate reading this evening are no input of the nights or of the baselines
    expect((await read('gauge_sleep', { from: '2026-10-12', to: D })).cache).toBe('hit');
    expect((await read('gauge_baselines', { date: D })).cache).toBe('hit');
    expect(t.store.sqlReads()).toBe(sql);
    expect((await read('gauge_timeline', { date: D })).cache).toBe('miss');
    expect((await read('gauge_activity', { from: '2026-10-14', to: D })).cache).toBe('miss');
  });

  it('a social_time upload for one date drops only that date\'s kept answer; a repeat is a hit with no SQL, and short_video still reads correctly', async () => {
    const t = setup();
    const read = (tool: string, args: Record<string, unknown>) => t.reads.read(P, FIXTURE_TZ, tool, { ...args, tz: FIXTURE_TZ });
    const other = '2026-10-15';
    // the day the fixture holds (D) and an empty earlier day are each kept
    const a = await read('gauge_social_time', { from: D, to: D });
    expect(a.cache).toBe('miss');
    expect(a.envelope.data).toMatchObject({ days: [{ date: D, totalSeconds: 1800, perApp: { instagram: 1200, youtube: 600 } }], source: 'usage_access' });
    await read('gauge_social_time', { from: other, to: other });

    // a repeat is answered from memory, with no store read, and its kept ETag matches without one either
    const sql0 = t.store.sqlReads();
    expect((await read('gauge_social_time', { from: D, to: D })).cache).toBe('hit');
    expect((await read('gauge_social_time', { from: other, to: other })).cache).toBe('hit');
    expect(t.reads.etag(P, FIXTURE_TZ, 'gauge_social_time', { from: D, to: D, tz: FIXTURE_TZ })?.etag).toBe(a.etag);
    expect(t.store.sqlReads()).toBe(sql0);

    // an upload for yet another date drops neither D's nor other's kept answer
    t.clock.now += 60_000;
    expect(t.store.ingest(INSTALL, [socialTime('2026-10-10', iso(ist('12:00') - 5 * 86_400_000), { instagram: 300 })], t.clock.now).rejected).toEqual([]);
    const sql1 = t.store.sqlReads();
    expect((await read('gauge_social_time', { from: D, to: D })).cache).toBe('hit');
    expect((await read('gauge_social_time', { from: other, to: other })).cache).toBe('hit');
    expect(t.store.sqlReads()).toBe(sql1);

    // an upload for D itself drops D's answer only (other still stands) and the new total is re-derived, byte-identical
    t.clock.now += 60_000;
    expect(t.store.ingest(INSTALL, [socialTime(D, iso(ist('23:30')), { instagram: 1500, youtube: 600, reddit: 120 })], t.clock.now).rejected).toEqual([]);
    expect((await read('gauge_social_time', { from: other, to: other })).cache).toBe('hit');
    const redone = await read('gauge_social_time', { from: D, to: D });
    expect(redone.cache).toBe('miss');
    expect(redone.envelope.data).toMatchObject({ days: [{ date: D, totalSeconds: 2220, perApp: { instagram: 1500, youtube: 600, reddit: 120 } }] });
    expect(JSON.stringify(redone.envelope)).toBe(JSON.stringify(await t.plain.call('gauge_social_time', { from: D, to: D, tz: FIXTURE_TZ })));

    // short_video is a separate category and reads its own day unchanged by any of the social_time writes
    expect((await read('gauge_short_video', { from: D, to: D })).envelope.data).toMatchObject({ days: [{ date: D, counts: { instagram: 5 }, total: 5 }] });
  });

  it('a change of the fusion context drops the answers that used that part of it, not the days before', async () => {
    const t = setup();
    const read = (tool: string, args: Record<string, unknown>) => t.reads.read(P, FIXTURE_TZ, tool, args);
    await read('gauge_timeline', { date: '2026-10-15' });
    await read('gauge_timeline', { date: D });
    await read('gauge_sleep', { from: '2026-10-12', to: D });
    t.context.put(P, { windowStartMs: ist('00:00'), windowEndMs: ist('23:59'), activities: [{ startMs: ist('07:00'), endMs: ist('07:30'), kind: 'locomotorPocket' }], corrections: [] }, t.clock.now);
    expect((await read('gauge_timeline', { date: '2026-10-15' })).cache).toBe('hit');
    expect((await read('gauge_sleep', { from: '2026-10-12', to: D })).cache).toBe('hit');
    expect((await read('gauge_timeline', { date: D })).cache).toBe('miss');
    // the same content again is no change
    t.context.put(P, { windowStartMs: ist('00:00'), windowEndMs: ist('23:59'), activities: [{ startMs: ist('07:00'), endMs: ist('07:30'), kind: 'locomotorPocket' }], corrections: [] }, t.clock.now);
    expect((await read('gauge_timeline', { date: D })).cache).toBe('hit');
  });

  it('a read without a zone keeps the zone it resolved to until readings near its range change', async () => {
    const t = setup();
    // the person's zone is UTC, the ring's readings of that day say +05:30
    const a = await t.reads.read(P, 'UTC', 'gauge_timeline', { date: D });
    expect((a.envelope.data as { tz: string }).tz).toBe('+05:30');
    const sql = t.store.sqlReads();
    expect((await t.reads.read(P, 'UTC', 'gauge_timeline', { date: D })).cache).toBe('hit');
    expect(t.reads.etag(P, 'UTC', 'gauge_timeline', { date: D })?.etag).toBe(a.etag);
    expect(t.store.sqlReads()).toBe(sql);
    // a reading that evening can change the choice: the zone is resolved again, and the answer with it
    t.store.ingest(INSTALL, [ringSteps(iso(ist('21:10')), 12)], t.clock.now);
    expect(t.reads.etag(P, 'UTC', 'gauge_timeline', { date: D })).toBeNull();
    const b = await t.reads.read(P, 'UTC', 'gauge_timeline', { date: D });
    expect(JSON.stringify(b.envelope)).toBe(JSON.stringify(await lumenToolSet(() => t.store, 'UTC', () => t.clock.now).call('gauge_timeline', { date: D })));
  });
});

describe('the queue', () => {
  const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];

  it('the event loop gets a turn between reads: a timer set with a burst fires before the burst is done', async () => {
    const t = setup();
    const order: string[] = [];
    const burst = dates.map((date) => t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date }).then((a) => {
      expect(a.cache).toBe('miss');
      order.push(date);
    }));
    setTimeout(() => order.push('timer'), 0);
    setImmediate(() => order.push('immediate'));
    await Promise.all(burst);
    expect(order.slice(-dates.length + 1)).not.toContain('immediate');
    expect(order.indexOf('timer')).toBeLessThan(dates.length);
    // in the order asked
    expect(order.filter((x) => x !== 'timer' && x !== 'immediate')).toEqual(dates);
  });

  it('the same read asked several times at once is derived once', async () => {
    const t = setup();
    const args = { date: '2026-10-16' };
    const [a, b, c] = await Promise.all([t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', args), t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { ...args }), t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', args)]);
    expect([a!.cache, b!.cache, c!.cache]).toEqual(['miss', 'joined', 'joined']);
    expect(JSON.stringify(b!.envelope)).toBe(JSON.stringify(a!.envelope));
    expect(t.reads.stats()).toMatchObject({ misses: 1, joined: 2 });
  });

  it('a read nobody waits for any more is not derived', async () => {
    const t = setup();
    const sql = t.store.sqlReads();
    const a = await t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: '2026-10-16' }, { alive: () => false });
    expect(a.envelope.ok).toBe(false);
    expect(t.store.sqlReads()).toBe(sql);
    expect(t.reads.stats()).toMatchObject({ skipped: 1, misses: 0 });
    // one caller still waiting is enough
    const [b] = await Promise.all([t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: '2026-10-17' }, { alive: () => false }), t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: '2026-10-17' })]);
    expect(b!.envelope.ok).toBe(true);
  });

  it('is bounded by bytes and by entries, the least recently used first', async () => {
    const small = setup({ maxEntries: 4 });
    for (const date of dates) await small.reads.read(P, FIXTURE_TZ, 'gauge_sleep', { from: date, to: date });
    expect(small.reads.stats().entries).toBeLessThanOrEqual(4);
    expect(small.reads.stats().evicted).toBeGreaterThan(0);
    expect((await small.reads.read(P, FIXTURE_TZ, 'gauge_sleep', { from: dates.at(-1)!, to: dates.at(-1)! })).cache).toBe('hit');
    expect((await small.reads.read(P, FIXTURE_TZ, 'gauge_sleep', { from: dates[0]!, to: dates[0]! })).cache).toBe('miss');

    const tight = setup({ maxBytes: 600_000 });
    for (const date of dates) await tight.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date });
    expect(tight.reads.stats().bytes).toBeLessThanOrEqual(600_000);
    // an answer over half the room is not kept at all
    const tiny = setup({ maxBytes: 20_000 });
    await tiny.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D });
    expect((await tiny.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D })).cache).toBe('miss');
  });

  it('a person without a store is answered at once, and a closed queue answers "try again"', async () => {
    const dir = mkdtempSync(join(TMP, 'gauge-reads-none-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const reads: GaugeReads = createGaugeReads({ store: () => null, opened: () => null, fusion: () => null, now: () => FIXTURE_NOW });
    const a = await reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D });
    expect(JSON.stringify(a.envelope)).toBe(JSON.stringify(await lumenToolSet(() => null, FIXTURE_TZ, () => FIXTURE_NOW).call('gauge_timeline', { date: D })));
    expect(reads.etag(P, FIXTURE_TZ, 'gauge_timeline', { date: D })).toBeNull();
    reads.close();
    expect((await reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D })).envelope).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('forgets a store that is being closed', async () => {
    const t = setup();
    await t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D });
    expect(t.reads.stats().entries).toBeGreaterThan(0);
    t.reads.release(t.store);
    expect(t.reads.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});

describe('the MCP tool set', () => {
  it('answers through the same kept reads', async () => {
    const t = setup();
    const tools = t.reads.toolsFor(P, FIXTURE_TZ);
    expect(tools.tools().length).toBeGreaterThan(10);
    const a = await tools.call('gauge_timeline', { date: D });
    expect(JSON.stringify(a)).toBe(JSON.stringify(await t.plain.call('gauge_timeline', { date: D })));
    expect((await t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: D })).cache).toBe('hit');
  });
});
