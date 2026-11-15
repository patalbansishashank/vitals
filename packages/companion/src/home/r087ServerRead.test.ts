// @vitest-environment node
/**
 * r087, the store side of the fast reads (review S2, S3, S6, S7, S8, S9, S11): one Health Connect record type by its
 * subject, what a committed write tells its listeners, the kept coverage reports, the WAL limit, a metric's declared
 * cadence with the reading, rows a call reads once, the zone from current readings only, and a large deletion that is
 * a small share of the store.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fuseRange, Inputs, intervalsAll, metricSamples, ReadBudgetError, ringDetailCompleteDates, rowsCharged, samplesAll, stepEvidence, withDerivedMemo, withReadBudget, type DerivedMemo } from './gaugeDerive.ts';
import { activityDaily, deletion, hcDeleted, hcRecord, hr, INSTALL, lumenEvent, metric, phoneSteps, RING_ID, ringSteps, sleepPacket, workout } from './lumenFixtures.ts';
import { BULK_ROWS, HC_STATE_SQL, rebuildState } from './lumenState.ts';
import { coverageWindow, HC_RECORD_TYPES, openLumenStore, WAL_LIMIT_BYTES, type LumenStore, type StoreChange } from './lumenStore.ts';
import { lumenToolSet, newestOffset } from './lumenTools.ts';
import { kindOf, mergeWindows, readWindow, windowsMeet, withReadDeps, type ReadDeps } from './readScope.ts';
import { fuseSteps, type StepRecord } from './stepFusion.ts';
import Database from 'better-sqlite3';

const TMP = process.env.TMPDIR ?? '/tmp';
const T = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const MIN = 60_000;
const DAY = 86_400_000;
let dir: string;
let store: LumenStore;
const open = () => {
  dir = mkdtempSync(join(TMP, 'r087-'));
  store = openLumenStore(join(dir, 'lumen.db'));
  return store;
};
afterEach(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const coverage = (observed: string, fromDay: string, toDay: string, v: Record<string, unknown> = {}) =>
  lumenEvent('state/sync', 'coverage.activity_detail', 'health.sync.coverage', observed, { stream: 'activity_detail', from: observed, to: observed, fromDay, toDay, complete: true, reason: 'overlap', ...v });
/** What the next write tells the store's listeners. */
const changesOf = (s: LumenStore, f: () => void): StoreChange[] => {
  const seen: StoreChange[] = [];
  const off = s.onChange((c) => seen.push(c));
  f();
  off();
  return seen;
};
const touches = (c: StoreChange[], kind: string, at: number) => c.some((x) => x.everything || x.ranges.some(([lo, hi, k]) => k === kind && lo <= at && at <= hi));

describe('S3: one Health Connect record type', () => {
  it('reads the same records as a filter on the stored record type, for every type, window and page', () => {
    const s = open();
    const samples = (t0: number, key: string) => ({ samples: Array.from({ length: 5 }, (_, i) => ({ t: iso(t0 + i * 5000), [key]: 60 + i })) });
    const events = [];
    for (let d = 0; d < 6; d++) {
      const day = T('2026-10-15T00:00:00Z') + d * DAY;
      for (let m = 0; m < 12; m++) events.push(hcRecord('Steps', `s${d}-${m}`, iso(day + m * 2 * 3_600_000), iso(day + m * 2 * 3_600_000 + MIN), { count: 10 + m }));
      events.push(
        hcRecord('HeartRate', `h${d}`, iso(day + 3_600_000), iso(day + 3_660_000), samples(day + 3_600_000, 'bpm')), hcRecord('Speed', `v${d}`, iso(day + 7_200_000), iso(day + 7_260_000), samples(day + 7_200_000, 'mps')),
        hcRecord('TotalCaloriesBurned', `c${d}`, iso(day), iso(day + DAY - 1000), { kcal: 2000 }), hcRecord('Weight', `w${d}`, iso(day + 5 * 3_600_000), iso(day + 5 * 3_600_000), { kg: 70 }),
        hcRecord('SleepSession', `n${d}`, iso(day - 3 * 3_600_000), iso(day + 4 * 3_600_000), { stages: [] }), hcRecord('Distance', `d${d}`, iso(day + 9 * 3_600_000), iso(day + 10 * 3_600_000), { m: 900 }),
      );
    }
    // a revision, a tombstone and a record that spans three days
    events.push(hcRecord('Steps', 's2-3', '2026-10-17T06:00:00Z', '2026-10-17T06:01:00Z', { count: 99 }, { lastModified: '2026-10-18T00:00:00Z' }), hcDeleted('Weight', 'w4', '2026-10-21T00:00:00Z'),
      hcRecord('ExerciseSession', 'long', '2026-10-16T10:00:00Z', '2026-10-18T22:00:00Z', { exercise_type: 79, title: null, segments: [], laps: [], route_state: 'none' }));
    expect(s.ingest(INSTALL, events).rejected).toEqual([]);
    const windows: Array<[number, number]> = [[T('2026-10-15T00:00:00Z'), T('2026-10-21T00:00:00Z')], [T('2026-10-17T00:00:00Z'), T('2026-10-18T00:00:00Z')], [T('2026-10-17T12:00:00Z'), T('2026-10-17T12:30:00Z')], [T('2026-10-19T03:59:00Z'), T('2026-10-19T04:00:00Z')]];
    for (const [from, to] of windows) {
      const all = intervalsAll(s, 'hc/record', from, to);
      for (const type of HC_RECORD_TYPES) {
        const want = all.filter((r) => r.data.record_type === type);
        expect(intervalsAll(s, 'hc/record', from, to, { recordType: type }), `${type} ${iso(from)}`).toEqual(want);
        // in pages of two
        const paged = [];
        for (let cursor: string | null = null; ;) {
          const p = s.readIntervals('hc/record', from, to, { recordType: type, cursor, limit: 2 });
          paged.push(...p.rows);
          if (!p.next) break;
          cursor = p.next;
        }
        expect(paged, `${type} paged`).toEqual(want);
      }
    }
    // the three-day session is found from a window inside it (its own type's longest span, not a ring minute's)
    expect(intervalsAll(s, 'hc/record', T('2026-10-18T12:00:00Z'), T('2026-10-18T12:05:00Z'), { recordType: 'ExerciseSession' }).map((r) => r.subject)).toEqual(['ExerciseSession:long']);
  });

  it('a type the store holds no record of costs no read, until one arrives', () => {
    const s = open();
    s.ingest(INSTALL, [hcRecord('Steps', 'a', '2026-10-20T01:00:00Z', '2026-10-20T01:01:00Z', { count: 5 })]);
    expect(s.readIntervals('hc/record', T('2026-10-20T00:00:00Z'), T('2026-10-21T00:00:00Z'), { recordType: 'Power' })).toEqual({ rows: [], next: null });
    const reads = s.sqlReads();
    expect(s.readIntervals('hc/record', T('2026-10-20T00:00:00Z'), T('2026-10-21T00:00:00Z'), { recordType: 'Power' }).rows).toEqual([]);
    expect(s.readIntervals('hc/record', T('2026-10-20T00:00:00Z'), T('2026-10-21T00:00:00Z'), { recordType: 'Speed' }).rows).toEqual([]);
    expect(s.sqlReads()).toBe(reads);
    s.ingest(INSTALL, [hcRecord('Power', 'p', '2026-10-20T02:00:00Z', '2026-10-20T02:30:00Z', { samples: [{ t: '2026-10-20T02:00:00Z', w: 120 }] })]);
    expect(s.readIntervals('hc/record', T('2026-10-20T02:10:00Z'), T('2026-10-20T02:20:00Z'), { recordType: 'Power' }).rows.map((r) => r.subject)).toEqual(['Power:p']);
  });
});

describe('what a write tells its listeners', () => {
  it('an upload names the instants and supports of what it stored, by kind; nothing for a batch that stored nothing new', () => {
    const s = open();
    // (the installation's first upload changes everything: see below)
    s.ingest(INSTALL, [hr('2026-10-01T00:00:00Z', 60)]);
    const c = changesOf(s, () => s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60), ringSteps('2026-10-20T02:00:00Z', 20), sleepPacket('2026-10-19T18:00:00Z', Array.from({ length: 120 }, () => 'light'))]));
    expect(c).toHaveLength(1);
    expect(c[0]!.everything).toBe(false);
    expect(touches(c, 'metric', T('2026-10-20T01:00:00Z'))).toBe(true);
    expect(touches(c, 'activity/buckets', T('2026-10-20T02:00:30Z'))).toBe(true);
    // a packet's support: its two hours of minutes
    expect(touches(c, 'sleep/timeline', T('2026-10-19T19:59:00Z'))).toBe(true);
    // nothing of another kind, nothing on another day
    expect(touches(c, 'activity/buckets', T('2026-10-20T01:00:00Z'))).toBe(false);
    expect(touches(c, 'metric', T('2026-10-19T01:00:00Z'))).toBe(false);
    // the same events again: duplicates, nothing changed
    expect(changesOf(s, () => s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]))).toEqual([]);
  });

  it('a new installation, a pairing and an unpairing can change any answer', () => {
    const s = open();
    expect(changesOf(s, () => s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]))[0]!.everything).toBe(true);
    expect(changesOf(s, () => s.ingest(INSTALL, [hr('2026-10-20T01:01:00Z', 60)]))[0]!.everything).toBe(false);
    expect(changesOf(s, () => s.noteInstallation(INSTALL, { pairedAt: '2026-10-20T00:00:00Z' }))[0]!.everything).toBe(true);
    expect(changesOf(s, () => s.retireInstallation(INSTALL, '2026-10-21T00:00:00Z'))[0]!.everything).toBe(true);
  });

  it('a revision that moves a record names where it was; a tombstone names its record; a workout its older versions', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-01T00:00:00Z', 60), hcRecord('Steps', 'a', '2026-10-10T01:00:00Z', '2026-10-10T01:10:00Z', { count: 5 }), workout('w-1', '2026-10-10T05:00:00Z', { start: '2026-10-10T04:00:00Z', end: '2026-10-10T04:30:00Z', durationS: 1700 })]);
    const moved = changesOf(s, () => s.ingest(INSTALL, [hcRecord('Steps', 'a', '2026-10-14T01:00:00Z', '2026-10-14T01:10:00Z', { count: 5 }, { lastModified: '2026-10-15T00:00:00Z' })]));
    expect(touches(moved, 'hc/record', T('2026-10-10T01:05:00Z'))).toBe(true);
    expect(touches(moved, 'hc/record', T('2026-10-14T01:05:00Z'))).toBe(true);
    const gone = changesOf(s, () => s.ingest(INSTALL, [hcDeleted('Steps', 'a', '2026-10-16T00:00:00Z')]));
    expect(touches(gone, 'hc/record', T('2026-10-14T01:05:00Z'))).toBe(true);
    const again = changesOf(s, () => s.ingest(INSTALL, [workout('w-1', '2026-10-12T05:00:00Z', { start: '2026-10-12T04:00:00Z', end: '2026-10-12T04:30:00Z', durationS: 1700 }, { receivedAt: '2026-10-12T06:00:00Z' })]));
    expect(touches(again, 'activity/session', T('2026-10-10T04:10:00Z'))).toBe(true);
    expect(touches(again, 'activity/session', T('2026-10-12T04:10:00Z'))).toBe(true);
  });

  it('a deletion of readings is bounded by its range; one of anything with a support, or of everything, is not', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60), hr('2026-10-18T01:00:00Z', 60), sleepPacket('2026-10-19T18:00:00Z', ['light'])]);
    const point = changesOf(s, () => s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'metrics', from: '2026-10-20T00:00:00Z', to: '2026-10-20T02:00:00Z' })]));
    expect(point[0]!.everything).toBe(false);
    expect(touches(point, 'metric', T('2026-10-20T01:00:00Z'))).toBe(true);
    expect(touches(point, 'metric', T('2026-10-18T01:00:00Z'))).toBe(false);
    expect(changesOf(s, () => s.ingest(INSTALL, [deletion('2026-10-21T00:01:00Z', { category: 'sleep/timeline', from: '2026-10-19T00:00:00Z', to: '2026-10-20T00:00:00Z' })]))[0]!.everything).toBe(true);
    expect(changesOf(s, () => s.ingest(INSTALL, [deletion('2026-10-21T00:02:00Z', { category: '*' })]))[0]!.everything).toBe(true);
  });

  it('dedupe and its undo change everything, a dry run nothing; detection writes are told apart', () => {
    const s = open();
    const night = Array.from({ length: 30 }, () => 'light');
    // a raw packet and the copy the clock correction sent later, 383.118 s earlier
    s.ingest(INSTALL, [sleepPacket('2026-10-19T18:06:24Z', night, { receivedAt: '2026-10-19T20:00:00Z' }), sleepPacket('2026-10-19T18:00:00.882Z', night, { receivedAt: '2026-10-20T03:00:00Z' })]);
    expect(changesOf(s, () => s.dedupe({ dryRun: true, offsetMs: 383_118 }))).toEqual([]);
    let written = 0;
    const real = changesOf(s, () => (written = s.dedupe({ offsetMs: 383_118 }).written));
    expect(written).toBeGreaterThan(0);
    expect(real).toEqual([expect.objectContaining({ everything: true })]);
    let undone = 0;
    expect(changesOf(s, () => (undone = s.undoDedupe()))).toEqual([expect.objectContaining({ everything: true })]);
    expect(undone).toBe(written);
    expect(changesOf(s, () => s.detections.noteRun({ processedMs: 1, suppressed: {} }))).toEqual([{ ranges: [], everything: false, detections: true }]);
    // an upload that queues ranges for detection says so in its one change
    expect(changesOf(s, () => s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]))).toMatchObject([{ detections: true }]);
    expect(withReadDeps(() => s.detections.diagnostics()).deps).toMatchObject({ detections: true, all: false });
  });

  it('another connection that writes the file is noticed once, and the listeners hear everything', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]);
    expect(s.foreignWrites()).toBe(false);
    const other = openLumenStore(s.file);
    other.ingest(INSTALL, [hr('2026-10-20T01:05:00Z', 61)]);
    other.close();
    const heard = changesOf(s, () => expect(s.foreignWrites()).toBe(true));
    expect(heard).toEqual([{ ranges: [], everything: true, detections: false }]);
    expect(s.foreignWrites()).toBe(false);
    expect(s.installations()[0]!.lastIngestAt).not.toBeNull();
  });
});

describe('windows', () => {
  it('meet only within one kind, and every metric is one kind', () => {
    expect(kindOf('metrics/hr')).toBe('metric');
    expect(kindOf('vendor/step_goal')).toBe('metric');
    expect(kindOf('metrics')).toBe('metric');
    expect(kindOf('insights/sleep_score')).toBe('insights');
    expect(kindOf('hc/deleted')).toBe('hc/record');
    expect(kindOf('activity/buckets')).toBe('activity/buckets');
    const a = mergeWindows([[10, 20, 'metric'], [15, 30, 'metric'], [0, 5, 'sleep/timeline'], [30, 31, 'metric']]);
    expect(a).toEqual([[10, 31, 'metric'], [0, 5, 'sleep/timeline']]);
    expect(windowsMeet(a, mergeWindows([[31, 40, 'metric']]))).toBe(true);
    expect(windowsMeet(a, mergeWindows([[32, 40, 'metric'], [6, 9, 'sleep/timeline']]))).toBe(false);
    expect(windowsMeet(a, mergeWindows([[12, 13, 'sleep/timeline'], [3, 3, 'sleep/timeline']]))).toBe(true);
    expect(windowsMeet(a, mergeWindows([[12, 13, 'activity/buckets']]))).toBe(false);
  });

  it('raw SQL outside a window makes the answer depend on every write; inside one, on that window', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]);
    expect(withReadDeps(() => s.all('SELECT 1')).deps).toMatchObject({ all: true });
    const inside = withReadDeps(() => readWindow(5, 9, 'metric', () => s.get('SELECT 1')));
    expect(inside.deps).toEqual({ ranges: [[5, 9, 'metric']], all: false, detections: false });
    // the store's own helpers name theirs
    expect(withReadDeps(() => s.readMetricSamples('hr', 100, 200)).deps.ranges).toEqual([[100, 200, 'metric']]);
    expect(withReadDeps(() => s.readIntervals('hc/record', 100, 200, { recordType: 'Steps' })).deps.ranges).toEqual([[100, 200, 'hc/record']]);
    // a scope inside another: both see the read
    const outer = withReadDeps(() => withReadDeps(() => s.readMetricSamples('hr', 1, 2)).deps);
    expect(outer.deps.ranges).toEqual(outer.value.ranges);
  });
});

describe('S6: the coverage reports', () => {
  it('are read once, then only what was uploaded since; a deletion or a re-delivery reads them again', () => {
    const s = open();
    s.ingest(INSTALL, [coverage('2026-10-19T03:00:00Z', '2026-10-18', '2026-10-19'), coverage('2026-10-20T03:00:00Z', '2026-10-19', '2026-10-20'), hr('2026-10-20T01:00:00Z', 60)]);
    expect(s.syncCoverage().map((r) => r.data?.toDay)).toEqual(['2026-10-19', '2026-10-20']);
    const reads = s.sqlReads();
    expect(s.syncCoverage()).toHaveLength(2);
    expect(s.sqlReads()).toBe(reads);
    s.ingest(INSTALL, [coverage('2026-10-21T03:00:00Z', '2026-10-20', '2026-10-21'), hr('2026-10-21T01:00:00Z', 60)]);
    expect(s.syncCoverage().map((r) => r.data?.toDay)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    // Gauge deletes its reports of the 20th: gone; delivered again later: back
    const gone = coverage('2026-10-20T03:00:00Z', '2026-10-19', '2026-10-20');
    s.ingest(INSTALL, [deletion('2026-10-22T00:00:00Z', { category: 'state/sync', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' })]);
    expect(s.syncCoverage().map((r) => r.data?.toDay)).toEqual(['2026-10-19', '2026-10-21']);
    s.ingest(INSTALL, [{ ...gone, data: { ...gone.data, received_at: '2026-10-23T00:00:00Z' } }]);
    expect(s.syncCoverage().map((r) => r.data?.toDay).sort()).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });

  it('a later report about later days is no input of an earlier day, and tells nothing about it', () => {
    const s = open();
    s.ingest(INSTALL, [ringSteps('2026-10-16T04:00:00Z', 30), coverage('2026-10-17T03:00:00Z', '2026-10-16', '2026-10-16')]);
    const day = () => {
      const inputs = new Inputs();
      const f = fuseRange(s, 'Asia/Kolkata', '2026-10-16', '2026-10-16', inputs);
      return { hash: inputs.hash([]), complete: [...f.complete], day: f.days[0] };
    };
    const before = day();
    expect(before.complete).toEqual(['2026-10-16']);
    const later = changesOf(s, () => s.ingest(INSTALL, [coverage('2026-10-20T03:00:00Z', '2026-10-19', '2026-10-20')]));
    expect(day()).toEqual(before);
    const w = coverageWindow('2026-10-16', '2026-10-16')!;
    expect(windowsMeet(mergeWindows([[w[0], w[1], 'state/sync']]), mergeWindows(later[0]!.ranges))).toBe(false);
    // a later report that does reach back to it is one
    const back = changesOf(s, () => s.ingest(INSTALL, [coverage('2026-10-21T03:00:00Z', '2026-10-14', '2026-10-21')]));
    expect(windowsMeet(mergeWindows([[w[0], w[1], 'state/sync']]), mergeWindows(back[0]!.ranges))).toBe(true);
    expect(day().hash).not.toBe(before.hash);
    // without a last date every report that can cover the first one counts, as before
    expect([...ringDetailCompleteDates(s, new Inputs(), { fromDate: '2026-10-16', fromMs: T('2026-10-15T18:30:00Z') })]).toContain('2026-10-20');
  });
});

describe('S7: rows a call reads once', () => {
  it('a second read inside one call takes the rows it holds and reads only what is new, with the same rows as a direct read', () => {
    const s = open();
    const t0 = T('2026-10-20T00:00:00Z');
    s.ingest(INSTALL, [
      ...Array.from({ length: 240 }, (_, i) => hr(iso(t0 + i * MIN), 60 + (i % 7))), ...Array.from({ length: 240 }, (_, i) => ringSteps(iso(t0 + i * MIN), i % 9)),
      phoneSteps(iso(t0 + 50 * MIN), iso(t0 + 130 * MIN), 400, { support: 'counterSpan' }),
    ]);
    const direct = { hr: samplesAll(s, 'hr', t0 + 30 * MIN, t0 + 90 * MIN), ring: intervalsAll(s, 'activity/buckets', t0 + 60 * MIN, t0 + 200 * MIN), phone: intervalsAll(s, 'activity/phone_steps', t0 + 100 * MIN, t0 + 101 * MIN) };
    withReadBudget(() => {
      samplesAll(s, 'hr', t0, t0 + 120 * MIN);
      const reads = s.sqlReads();
      const rows = rowsCharged();
      // inside what the call holds: no read, no rows charged again
      expect(samplesAll(s, 'hr', t0 + 30 * MIN, t0 + 90 * MIN)).toEqual(direct.hr);
      expect(s.sqlReads()).toBe(reads);
      expect(rowsCharged()).toBe(rows);
      // past its end: only the new end is read
      expect(samplesAll(s, 'hr', t0 + 60 * MIN, t0 + 180 * MIN)).toEqual(samplesAll(s, 'hr', t0 + 60 * MIN, t0 + 180 * MIN));
      expect(rowsCharged()).toBe(rows + 60);
      intervalsAll(s, 'activity/buckets', t0 + 100 * MIN, t0 + 150 * MIN);
      expect(intervalsAll(s, 'activity/buckets', t0 + 60 * MIN, t0 + 200 * MIN)).toEqual(direct.ring);
      // a span across the window's edge is found from either side
      intervalsAll(s, 'activity/phone_steps', t0, t0 + 60 * MIN);
      expect(intervalsAll(s, 'activity/phone_steps', t0 + 100 * MIN, t0 + 101 * MIN)).toEqual(direct.phone);
    });
  });

  it('a metric\'s declared cadence comes with the reading, counted in the budget as before', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    s.ingest(INSTALL, [
      lumenEvent('metrics/hr', 'hr', 'health.metric.observed', at, { metric: 'hr', value: 61, unit: 'bpm', provenance: 'device_history', cadence_s: 300, ...RING_ID }),
      hr('2026-10-20T01:05:00Z', 62), metric('hrv', 'ms', at, 40),
    ]);
    expect(s.readMetricSamples('hr', T(at), T(at) + DAY).rows.map((r) => r.cadenceS)).toEqual([300, null]);
    const before = rowsCharged();
    const out = metricSamples(s, 'hr', T(at), T(at) + DAY, new Inputs());
    expect(out.map((x) => x.cadenceS)).toEqual([300, null]);
    // two readings and one declared cadence
    expect(rowsCharged() - before).toBe(3);
  });

  it('the baselines read four weeks of heart rate once', async () => {
    const s = open();
    const events = [];
    for (let d = 0; d < 9; d++) {
      const night = T('2026-10-11T17:30:00Z') + d * DAY;
      events.push(sleepPacket(iso(night), Array.from({ length: 300 }, (_, i) => (i % 4 === 0 ? 'deep' : 'light')), { complete: true }));
      for (let m = 0; m < 1440; m += 10) events.push(hr(iso(night + m * MIN), 55 + (m % 30)));
    }
    for (let i = 0; i < events.length; i += 500) s.ingest(INSTALL, events.slice(i, i + 500));
    // the store, counting the heart-rate readings it hands out
    let read = 0;
    const counting: LumenStore = { ...s, readMetricSamples: (kind, a, b, o) => {
      const p = s.readMetricSamples(kind, a, b, o);
      if (kind === 'hr') read += p.rows.length;
      return p;
    } };
    const total = s.get<{ n: number }>("SELECT COUNT(*) AS n FROM metric_series WHERE kind = 'hr'")!.n;
    const a = await lumenToolSet(() => counting, 'Asia/Kolkata', () => T('2026-10-20T12:00:00Z')).call('gauge_baselines', { date: '2026-10-20' });
    expect(a.ok).toBe(true);
    expect((a.data as { sampledIdleHr: { n: number } }).sampledIdleHr.n).toBeGreaterThan(0);
    // each reading once: the nights' heart rate and the idle heart rate are parts of one read
    expect(read).toBeGreaterThan(total / 2);
    expect(read).toBeLessThanOrEqual(total);
  });
});

describe('S9: the WAL', () => {
  it('is cut back to the limit after a checkpoint', () => {
    const s = open();
    expect(s.get<{ journal_size_limit: number }>('PRAGMA journal_size_limit')!.journal_size_limit).toBe(WAL_LIMIT_BYTES);
    expect(s.get<{ journal_mode: string }>('PRAGMA journal_mode')!.journal_mode).toBe('wal');
  });
});

describe('S11: the zone of a read without one', () => {
  it('comes from current readings only: a deleted reading no longer chooses it', () => {
    const s = open();
    const lo = T('2026-10-20T00:00:00Z');
    s.ingest(INSTALL, [ringSteps('2026-10-20T02:00:00Z', 20), lumenEvent('activity/buckets', 'ring_steps', 'health.activity.bucket.observed', '2026-10-20T03:00:00Z', {
      start: '2026-10-20T03:00:00Z', duration_s: 60, steps: 5, distance_m: 3, support: 'minute', ...RING_ID, local_offset_min: -240,
    })]);
    expect(newestOffset(s, lo, lo + DAY)).toEqual({ atMs: T('2026-10-20T03:00:00Z'), offsetMin: -240 });
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'activity/buckets', from: '2026-10-20T03:00:00Z', to: '2026-10-20T03:00:00Z' })]);
    expect(newestOffset(s, lo, lo + DAY)).toEqual({ atMs: T('2026-10-20T02:00:00Z'), offsetMin: 330 });
    // the newest reading without an offset: the scan behind it finds the one that has it
    s.ingest(INSTALL, [activityDaily('2026-10-20T05:00:00Z', 100), lumenEvent('activity/daily', 'daily_activity', 'health.activity.daily.observed', '2026-10-20T04:00:00Z', { steps: 90, local_offset_min: 60 })]);
    expect(newestOffset(s, lo, lo + DAY)).toEqual({ atMs: T('2026-10-20T04:00:00Z'), offsetMin: 60 });
    expect(newestOffset(s, lo - 5 * DAY, lo - 4 * DAY)).toBeNull();
  });
});

describe('the row budget on step evidence kept by day', () => {
  it('refuses an over-long read after the same rows and statements as a read without the memory, and counts a read that fits the same', () => {
    const s = open();
    const t0 = T('2026-10-01T00:00:00Z');
    const n = 25_000;
    const events = Array.from({ length: n }, (_, i) => ringSteps(iso(t0 + i * MIN), 1 + (i % 7)));
    for (let i = 0; i < n; i += 1000) s.ingest(INSTALL, events.slice(i, i + 1000));
    const memory = () => {
      const kept = new Map<string, { value: unknown; deps: ReadDeps }>();
      const memo: DerivedMemo = { get: (_s, key) => kept.get(key), set: (_s, key, entry) => void kept.set(key, entry) };
      return { kept, memo };
    };
    const run = (memo: DerivedMemo | null, budget: number, from = t0 + 90 * MIN, to = t0 + n * MIN) => {
      const sql = s.sqlReads();
      const rows = rowsCharged();
      let out: number | 'refused';
      try {
        out = withDerivedMemo(memo, () => withReadBudget(() => stepEvidence(s, from, to, new Inputs()).ringBuckets.length, budget));
      } catch (e) {
        if (!(e instanceof ReadBudgetError)) throw e;
        out = 'refused';
      }
      return { out, sql: s.sqlReads() - sql, rows: rowsCharged() - rows };
    };
    const plain = run(null, 12_000);
    const m = memory();
    const kept = run(m.memo, 12_000);
    expect([plain.out, kept.out]).toEqual(['refused', 'refused']);
    // (whole days are read, so the page the budget runs out on can hold a few rows from before the range, not counted)
    expect(kept.sql).toBeLessThanOrEqual(plain.sql);
    expect(kept.rows).toBeGreaterThan(12_000);
    expect(kept.rows).toBeLessThanOrEqual(plain.rows);
    // nothing of the refused read was handed to the memory
    expect(m.kept.size).toBe(0);
    // a read that fits is charged row for row what the plain read is, whole days read or days already held
    const fits = [t0 + 90 * MIN, t0 + 4 * DAY + 30 * MIN] as const;
    const direct = run(null, 12_000, ...fits);
    expect(typeof direct.out).toBe('number');
    expect(run(m.memo, 12_000, ...fits)).toMatchObject({ out: direct.out, rows: direct.rows });
    expect(run(m.memo, 12_000, ...fits)).toMatchObject({ out: direct.out, rows: direct.rows, sql: 0 });
  }, 60_000);
});

describe('S8: a large deletion that is a small share of the store', () => {
  it('is applied row by row, with the state a rebuild gives', () => {
    const s = open();
    const t0 = T('2026-10-01T00:00:00Z');
    const n = BULK_ROWS * 9;
    const events = Array.from({ length: n }, (_, i) => hr(iso(t0 + i * MIN), 60 + (i % 9)));
    for (let i = 0; i < n; i += 500) s.ingest(INSTALL, events.slice(i, i + 500));
    // just over the bulk limit, about an eighth of nothing: 2,100 of 18,000 rows
    const change = changesOf(s, () => s.ingest(INSTALL, [deletion(iso(t0 + n * MIN), { category: 'metrics/hr', from: iso(t0), to: iso(t0 + (BULK_ROWS + 100) * MIN - 1) })]));
    expect(change[0]!.everything).toBe(false);
    const snapshot = () => s.all('SELECT seq, hidden, inst_current, current, latest, retracted FROM event_state ORDER BY seq');
    const kept = snapshot();
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_state WHERE hidden = 1')!.n).toBe(BULK_ROWS + 100);
    const db = new Database(s.file);
    db.transaction(() => rebuildState(db)).immediate();
    db.close();
    expect(snapshot()).toEqual(kept);
  });

  it('holds for Health Connect records too, and each record finds its revisions by the index of its scope', () => {
    const s = open();
    const t0 = T('2026-10-01T00:00:00Z');
    const n = BULK_ROWS * 9;
    // every sixth record has a second revision, every ninth a tombstone: the per-record rule has work to do
    const events = Array.from({ length: n }, (_, i) => {
      const start = iso(t0 + i * MIN);
      const end = iso(t0 + (i + 1) * MIN);
      if (i % 6 === 1) return hcRecord('Steps', `r${i - 1}`, iso(t0 + (i - 1) * MIN), start, { count: 9 }, { lastModified: end });
      if (i % 9 === 2) return hcDeleted('Steps', `r${i - 2}`, end);
      return hcRecord('Steps', `r${i}`, start, end, { count: 5 });
    });
    for (let i = 0; i < n; i += 500) s.ingest(INSTALL, events.slice(i, i + 500));
    const change = changesOf(s, () => s.ingest(INSTALL, [deletion(iso(t0 + (n + 2) * MIN), { category: 'hc', from: iso(t0), to: iso(t0 + (BULK_ROWS + 100) * MIN) })]));
    expect(change).toHaveLength(1);
    const hidden = s.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_state WHERE hidden = 1')!.n;
    expect(hidden).toBeGreaterThan(BULK_ROWS);
    expect(hidden * 8).toBeLessThan(n);
    const snapshot = () => s.all('SELECT seq, hidden, inst_current, current, latest, retracted FROM event_state ORDER BY seq');
    const kept = snapshot();
    // a plan through the category index instead walks every record once per record
    const db = new Database(s.file);
    for (const [name, sql] of Object.entries(HC_STATE_SQL)) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ s: 'Steps:r0', rev: 0, w: 1, gone: 0 }) as Array<{ detail: string }>).map((r) => r.detail).join('\n');
      expect(plan, name).toMatch(/event_state_scope \(scope=\? AND category=\? AND subject=\?/);
    }
    db.transaction(() => rebuildState(db)).immediate();
    db.close();
    expect(snapshot()).toEqual(kept);
  }, 60_000);
});

describe('S2: tracks without one insert per record', () => {
  it('keeps each source and support class in order of preference, whatever order the classes interleave in', () => {
    const t0 = T('2026-10-20T00:00:00Z');
    const rec = (id: string, source: string, sourceRank: number, startMin: number, lenMin: number, steps: number, support: StepRecord['support'] = 'minute'): StepRecord =>
      ({ id, lineage: 'phone', source, sourceRank, startMs: t0 + startMin * MIN, endMs: t0 + (startMin + lenMin) * MIN, steps, support });
    const records = [
      // the counter's minutes (first choice), then a coarse span of the same source, then another source's minutes
      rec('a1', 'phone:counter', 0, 0, 1, 10), rec('a2', 'phone:counter', 0, 5, 1, 11), rec('a3', 'phone:counter', 0, 9, 1, 12),
      rec('b1', 'phone:counter', 0, 2, 2, 30, 'counterSpan'), rec('b2', 'phone:counter', 0, 5, 3, 40, 'counterSpan'),
      rec('c1', 'hc:fit', 1, 1, 1, 7), rec('c2', 'hc:fit', 1, 5, 1, 8), rec('c3', 'hc:fit', 1, 7, 1, 9), rec('c4', 'hc:fit', 1, 20, 1, 9),
    ];
    const f = fuseSteps(records, { zeroWindows: [{ lineage: 'phone', source: 'phone:counter', startMs: t0, endMs: t0 + 12 * MIN }, { lineage: 'phone', source: 'phone:counter', startMs: t0 + 8 * MIN, endMs: t0 + 15 * MIN }] });
    const track = f.tracks.get('phone')!;
    // by start, disjoint
    expect(track.map((r) => r.startMs)).toEqual([...track.map((r) => r.startMs)].sort((x, y) => x - y));
    for (let i = 1; i < track.length; i++) expect(track[i]!.startMs).toBeGreaterThanOrEqual(track[i - 1]!.endMs);
    // what the classes kept, in order: the counter's minutes, its span that overlaps none of them, the other source's free minutes
    expect(track.filter((r) => !r.synthetic).map((r) => r.id)).toEqual(['a1', 'c1', 'b1', 'a2', 'c3', 'a3', 'c4']);
    expect(f.copies.map((r) => r.id).sort()).toEqual(['b2', 'c2']);
    // each observed-zero minute once, though two windows cover minutes 8 to 11
    const zeros = track.filter((r) => r.synthetic).map((r) => (r.startMs - t0) / MIN);
    expect(zeros).toEqual([4, 6, 8, 10, 11, 12, 13, 14]);
  });

  it('a month of observed zeros fuses in well under a second', () => {
    const t0 = T('2026-10-01T00:00:00Z');
    const records: StepRecord[] = [];
    for (let m = 0; m < 30 * 1440; m += 3) records.push({ id: `r${m}`, lineage: 'ring', source: 'ring:x', startMs: t0 + m * MIN, endMs: t0 + (m + 1) * MIN, steps: m % 7, support: 'minute' });
    const zeroWindows = Array.from({ length: 30 }, (_, d) => ({ lineage: 'phone' as const, source: 'phone:counter', startMs: t0 + d * DAY + 6 * 3_600_000, endMs: t0 + d * DAY + 22 * 3_600_000 }));
    const started = performance.now();
    const f = fuseSteps(records, { zeroWindows });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(f.tracks.get('phone')!.length).toBe(30 * 16 * 60);
  });

  it('step evidence reads the same rows whether or not the call holds them', () => {
    const s = open();
    const t0 = T('2026-10-20T00:00:00Z');
    s.ingest(INSTALL, [...Array.from({ length: 120 }, (_, i) => ringSteps(iso(t0 + i * MIN), i % 9)), ...Array.from({ length: 60 }, (_, i) => phoneSteps(iso(t0 + i * MIN), iso(t0 + (i + 1) * MIN), 5 + i))]);
    const plain = stepEvidence(s, t0 + 10 * MIN, t0 + 100 * MIN, new Inputs());
    const held = withReadBudget(() => {
      stepEvidence(s, t0 + 20 * MIN, t0 + 40 * MIN, new Inputs());
      return stepEvidence(s, t0 + 10 * MIN, t0 + 100 * MIN, new Inputs());
    });
    expect(held).toEqual(plain);
  });
});
