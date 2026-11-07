/**
 * 0.6.3 FX1 (final review), the client import:
 *  - sR02/aR04: the feed's `resync: true` used to be ignored and its cursor saved. Now the imported refs are paged through
 *    `/v1/gauge/changes-state` (bounded pages a run), what is deleted is withdrawn (unknown never is), and the cursor is
 *    saved only once every ref was checked and the deletions landed.
 *  - sR14/aR04: the seven-day timeline cap dropped the eighth older workout day for good (probe: 8 days, first pass 7,
 *    the next only the 3 recent ones). Now the rest waits in a bounded, versioned queue; failed timeline reads are queued
 *    too; the feed's revised workouts get their days' timelines; a failed workouts read is not a success.
 *  - sR03/aR05: a day the server answered in full with no steps reaches `log.fromGauge` as `answered`; today's live
 *    snapshot is cleared on that answer, never on a failed read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, localToInstant } from '@/living/dates';
import type { GaugeApi, GaugeChanges, GaugeSubjectRef, GaugeSubjectState, GaugeV2Api } from '@/net/gauge';
import { liveTodaySteps, setLiveTodaySteps } from '../liveSteps';
import { GAUGE_EVIDENCE_QUEUE_MAX, GAUGE_IMPORT_KEY, GAUGE_RESYNC_PAGES_PER_RUN, nextEvidenceQueue, readGaugeImportState, runGaugeImport, type ActivityImportInput, type GaugeImportDeps } from '../gaugeImport';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-20';
const NOW = Date.parse('2026-10-20T06:34:00Z');

function memoryStorage(init?: unknown) {
  const m = new Map<string, string>();
  if (init) m.set(GAUGE_IMPORT_KEY, JSON.stringify(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

interface Fake {
  feed?: () => GaugeChanges | null;
  states?: (refs: readonly GaugeSubjectRef[]) => GaugeSubjectState[] | null;
  workouts?: () => unknown;
  timeline?: (date: string) => unknown;
  stepsDays?: Array<{ date: string; located: number; headline: number; coverage?: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number } }> | null;
  problem?: string | null;
}
function fakeApi(o: Fake = {}) {
  const log: string[] = [];
  const timelines: string[] = [];
  const stateCalls: string[][] = [];
  const api = {
    activity: async () => ({ days: [] }),
    sleep: async () => ({ sessions: [] }),
    steps: async () => (o.stepsDays === null ? null : { fusionVersion: 'steps-fuse/1', intervals: [], days: o.stepsDays ?? [] }),
    changes: async (since: string | null) => {
      log.push(`changes ${since}`);
      return o.feed ? o.feed() : { cursor: 'c1.1.0', resync: false, changes: [], truncated: false };
    },
    changesState: async (refs: readonly GaugeSubjectRef[]) => {
      stateCalls.push(refs.map((r) => `${r.kind}:${r.id}`));
      return o.states ? o.states(refs) : refs.map((r) => ({ ...r, ref: r.kind === 'workout' ? `gauge:${r.id}` : `hc:${r.id}`, state: 'present' as const, at: null }));
    },
    hc: async (type: string) => ({ type, from: '', to: '', records: [], deleted: [], truncated: false }),
    workouts: async () => (o.workouts ? o.workouts() : { sessions: [] }),
    timeline: async (date: string) => {
      timelines.push(date);
      return o.timeline ? o.timeline(date) : null;
    },
    status: () => ({ lastOkAt: null, problem: o.problem ?? null }),
  } as unknown as GaugeApi & Partial<GaugeV2Api>;
  return { api, log, timelines, stateCalls };
}
const deps = (over: Partial<GaugeImportDeps>): Partial<GaugeImportDeps> => ({
  enabled: () => true,
  today: () => TODAY,
  tz: () => TZ,
  now: () => NOW,
  importer: async () => ({ created: [], skipped: [] }),
  storage: memoryStorage(),
  ...over,
});
const okImporter = (inputs: ActivityImportInput[] = []) => async (i: ActivityImportInput) => {
  inputs.push(i);
  return { created: [], updated: [] };
};
const backfilled = (over: Record<string, unknown> = {}) => ({ lastImportAt: '2026-10-20T06:00:00.000Z', lastDate: TODAY, backfilled: true, feeds: { ring: TODAY, sleep: TODAY, steps: TODAY, activities: TODAY }, reconcile: { next: null, at: '2026-10-20T06:00:00.000Z' }, ...over });

afterEach(() => setLiveTodaySteps(null));

describe('sR02/aR04: resync reconciles the imported refs before the cursor is saved', () => {
  it('the probe: resync with a newer cursor; the deleted refs are withdrawn, unknown and present kept, then the cursor saved', async () => {
    const storage = memoryStorage(backfilled({ changesCursor: 'c1.5.0' }));
    const f = fakeApi({
      feed: () => ({ cursor: 'c1.9.0', resync: true, changes: [], truncated: false }),
      states: (refs) => refs.map((r) => ({ ...r, ref: r.kind === 'workout' ? `gauge:${r.id}` : `hc:${r.id}`, state: r.id === 'w-1' || r.id === 'wt-1' ? 'deleted' : r.id === 'h-1' ? 'unknown' : 'present', at: null })),
    });
    const inputs: ActivityImportInput[] = [];
    const retracted: string[][] = [];
    await runGaugeImport(deps({
      api: f.api, storage, activityImporter: okImporter(inputs),
      importedRefs: async () => ({ activities: ['gauge:w-1', 'hc:h-1', 'gauge:w-2'], weights: ['wt-1'] }),
      retractWeights: async (ids) => {
        retracted.push(ids);
        return ids.length;
      },
    }));
    expect(f.stateCalls).toEqual([['hcExercise:h-1', 'hcWeight:wt-1', 'workout:w-1', 'workout:w-2']]);
    // the reproduction: no deletedRefs were sent, yet the new cursor was saved
    expect(inputs[0]!.deletedRefs).toEqual(['gauge:w-1']);
    expect(retracted).toEqual([['wt-1']]);
    const st = readGaugeImportState(storage);
    expect(st.changesCursor).toBe('c1.9.0');
    expect(st.resync).toBeUndefined();
    expect(st.retractions!.map((r) => r.ref).sort()).toEqual(['gauge:w-1', 'hc:wt-1']);
  });

  it('pages: a bounded number of refs a run, the feed waits, the cursor is saved once every ref was checked', async () => {
    const storage = memoryStorage(backfilled({ changesCursor: 'c1.5.0' }));
    const n = GAUGE_RESYNC_PAGES_PER_RUN * 100 + 50;
    const refs = Array.from({ length: n }, (_, k) => `gauge:w${String(k).padStart(5, '0')}`);
    const f = fakeApi({ feed: () => ({ cursor: 'c1.9.0', resync: true, changes: [], truncated: false }) });
    const d = deps({ api: f.api, storage, activityImporter: okImporter(), importedRefs: async () => ({ activities: refs, weights: [] }) });
    await runGaugeImport(d);
    expect(f.stateCalls).toHaveLength(GAUGE_RESYNC_PAGES_PER_RUN);
    expect(f.stateCalls.every((c) => c.length <= 100)).toBe(true);
    let st = readGaugeImportState(storage);
    expect(st.changesCursor).toBe('c1.5.0');
    expect(st.resync).toMatchObject({ v: 1, target: 'c1.9.0', after: `workout:w${String(GAUGE_RESYNC_PAGES_PER_RUN * 100 - 1).padStart(5, '0')}` });
    await runGaugeImport(d);
    // the feed is not read while the resync runs; the rest (50) is checked; then the cursor is saved
    expect(f.log).toEqual(['changes c1.5.0']);
    expect(f.stateCalls.at(-1)).toHaveLength(50);
    st = readGaugeImportState(storage);
    expect(st.changesCursor).toBe('c1.9.0');
    expect(st.resync).toBeUndefined();
    await runGaugeImport(d);
    expect(f.log).toEqual(['changes c1.5.0', 'changes c1.9.0']);
  });

  it('a failed state read, or deletions that did not land, keep the resync where it was (never an acknowledged cursor)', async () => {
    const storage = memoryStorage(backfilled({ changesCursor: 'c1.5.0' }));
    const failing = fakeApi({ feed: () => ({ cursor: 'c1.9.0', resync: true, changes: [], truncated: false }), states: () => null, problem: 'offline' });
    await runGaugeImport(deps({ api: failing.api, storage, activityImporter: okImporter(), importedRefs: async () => ({ activities: ['gauge:w-1'], weights: [] }) }));
    expect(readGaugeImportState(storage)).toMatchObject({ changesCursor: 'c1.5.0', resync: { target: 'c1.9.0', after: null } });
    const gone = fakeApi({ states: (refs) => refs.map((r) => ({ ...r, ref: `gauge:${r.id}`, state: 'deleted' as const, at: null })) });
    await runGaugeImport(deps({ api: gone.api, storage, activityImporter: async () => null, importedRefs: async () => ({ activities: ['gauge:w-1'], weights: [] }) }));
    expect(readGaugeImportState(storage)).toMatchObject({ changesCursor: 'c1.5.0', resync: { target: 'c1.9.0', after: null } });
    await runGaugeImport(deps({ api: gone.api, storage, activityImporter: okImporter(), importedRefs: async () => ({ activities: ['gauge:w-1'], weights: [] }) }));
    expect(readGaugeImportState(storage).changesCursor).toBe('c1.9.0');
  });

  it('an older server without the route: the feed is followed as before', async () => {
    const storage = memoryStorage(backfilled({ changesCursor: 'c1.5.0' }));
    const f = fakeApi({ feed: () => ({ cursor: 'c1.9.0', resync: true, changes: [], truncated: false }) });
    delete (f.api as { changesState?: unknown }).changesState;
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter(), importedRefs: async () => ({ activities: ['gauge:w-1'], weights: [] }) }));
    expect(readGaugeImportState(storage)).toMatchObject({ changesCursor: 'c1.9.0' });
    expect(readGaugeImportState(storage).resync).toBeUndefined();
  });

  it('an old state reads safely; a resync or queue of another version is ignored', () => {
    const st = readGaugeImportState(memoryStorage({ lastImportAt: 'x', lastDate: TODAY, backfilled: true, changesCursor: 'c1.1.1', resync: { v: 2, target: 'c1.9.0' }, evidence: { v: 9, dates: [{ date: TODAY, at: 'x' }] } }));
    expect(st).toEqual({ lastImportAt: 'x', lastDate: TODAY, backfilled: true, changesCursor: 'c1.1.1' });
  });
});

/** A workout on `date` at 07:00 local, revised now. */
const workoutOn = (date: string, id: string) => ({ id, type: 'run', start: localToInstant(date, 7, TZ), end: localToInstant(date, 7.5, TZ), updatedAt: '2026-10-20T06:30:00Z' });

describe('sR14/aR04: the per-run timeline cap defers work, never drops it', () => {
  it('the probe: eight older workout days; the eighth is read on the next run', async () => {
    const storage = memoryStorage();
    const older = Array.from({ length: 8 }, (_, k) => addDays(TODAY, -(5 + k)));
    const f = fakeApi({ workouts: () => ({ sessions: older.map((d, k) => workoutOn(d, `w${k}`)) }) });
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter() }));
    const first = new Set(f.timelines);
    expect(older.filter((d) => first.has(d))).toHaveLength(7);
    const eighth = older.find((d) => !first.has(d))!;
    expect(readGaugeImportState(storage).evidence?.dates.map((x) => x.date)).toContain(eighth);
    f.timelines.length = 0;
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter() }));
    // the reproduction: only the three recent days were asked
    expect(f.timelines).toContain(eighth);
  });

  it('a failed timeline read is queued and asked again; a read that answered leaves the queue', async () => {
    const storage = memoryStorage(backfilled());
    let fail = true;
    const day = addDays(TODAY, -1);
    const tl = (date: string) => (fail && date === day ? null : { date, start: localToInstant(date, 0, TZ), minutes: 2, steps: { selected: [1, 2] }, hr: { bpm: [null, null], supportedS: [null, null] }, sleep: { stage: [null, null] } });
    const f = fakeApi({ timeline: tl });
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter() }));
    expect(readGaugeImportState(storage).evidence?.dates.map((x) => x.date)).toEqual([day]);
    fail = false;
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter() }));
    expect(readGaugeImportState(storage).evidence).toBeUndefined();
  });

  it('a workout the feed reports revised gets its day read, whatever its age', async () => {
    const storage = memoryStorage(backfilled({ changesCursor: 'c1.5.0' }));
    const day = addDays(TODAY, -20);
    const f = fakeApi({ feed: () => ({ cursor: 'c1.6.0', resync: false, truncated: false, changes: [{ kind: 'workout', id: 'w-old', ref: 'gauge:w-old', change: 'revised', start: localToInstant(day, 7, TZ), end: localToInstant(day, 7.5, TZ), at: null }] }) });
    const inputs: ActivityImportInput[] = [];
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter(inputs) }));
    expect(f.timelines).toContain(day);
  });

  it('a failed workouts read is not a success: the activities feed keeps its day', async () => {
    const storage = memoryStorage(backfilled({ feeds: { ring: '2026-10-18', sleep: '2026-10-18', steps: '2026-10-18', activities: '2026-10-18' }, lastDate: '2026-10-18' }));
    const f = fakeApi({ workouts: () => Promise.reject(new Error('down')) });
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okImporter() }));
    const st = readGaugeImportState(storage);
    expect(st.feeds?.activities).toBe('2026-10-18');
    expect(st.lastDate).toBe('2026-10-18');
  });

  it('the queue is bounded, inside the window, each date once with when it was first owed', () => {
    const owed = Array.from({ length: 100 }, (_, k) => addDays(TODAY, -k));
    const q = nextEvidenceQueue([{ date: TODAY, at: 'first' }], [...owed, TODAY, '2026-01-01'], new Set([addDays(TODAY, -1)]), addDays(TODAY, -29), TODAY, 'now');
    expect(q.length).toBeLessThanOrEqual(GAUGE_EVIDENCE_QUEUE_MAX);
    expect(q.every((x) => x.date >= addDays(TODAY, -29) && x.date <= TODAY)).toBe(true);
    expect(q.map((x) => x.date)).not.toContain(addDays(TODAY, -1));
    expect(q.at(-1)).toEqual({ date: TODAY, at: 'first' });
  });
});

describe('sR03/aR05: a confirmed empty day reaches log.fromGauge; the live snapshot clears only then', () => {
  const cal = (date: string) => ({ date, located: 0, headline: 0 });
  it('the server answered today with no steps: answered lists it and the snapshot is cleared', async () => {
    setLiveTodaySteps({ day: { date: TODAY, steps: 4200 }, at: '2026-10-20T05:00:00Z' });
    const seen: Array<{ answered?: { steps?: string[] } }> = [];
    const days = Array.from({ length: 33 }, (_, k) => cal(addDays(TODAY, -31 + k)));
    const f = fakeApi({ stepsDays: days });
    await runGaugeImport(deps({ api: f.api, importer: async (i) => {
      seen.push(i);
      return { created: [], skipped: [] };
    } }));
    expect(seen[0]!.answered?.steps).toContain(TODAY);
    expect(liveTodaySteps()).toBeNull();
  });

  it('a failed steps read answers nothing and keeps the snapshot', async () => {
    setLiveTodaySteps({ day: { date: TODAY, steps: 4200 }, at: '2026-10-20T05:00:00Z' });
    const seen: Array<{ answered?: { steps?: string[] } }> = [];
    const f = fakeApi({ stepsDays: null });
    await runGaugeImport(deps({ api: f.api, importer: async (i) => {
      seen.push(i);
      return { created: [], skipped: [] };
    } }));
    expect(seen[0]!.answered?.steps).toBeUndefined();
    expect(liveTodaySteps()).toMatchObject({ day: { steps: 4200 } });
  });

  it('a day the server did not answer together with its small hours is not listed', async () => {
    const seen: Array<{ answered?: { steps?: string[] } }> = [];
    const f = fakeApi({ stepsDays: [cal(addDays(TODAY, -1))] });
    await runGaugeImport(deps({ api: f.api, importer: async (i) => {
      seen.push(i);
      return { created: [], skipped: [] };
    } }));
    expect(seen[0]!.answered?.steps ?? []).toEqual([]);
  });
});
