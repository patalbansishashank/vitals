/**
 * (r087) What an import asks of the server and of the screens. The server answers every read on one thread and the
 * phone's reads were timing out behind each other, so a run:
 *  - reads at most four recent days however long a feed has been failing (older days are the hourly chunk's, first);
 *  - has at most two requests out at once, all at background priority, cancelled when the run is given up;
 *  - does not ask an unanswering server for older days or for queued timelines;
 *  - is given up when nothing has answered for its deadline, so a command that never settles does not end importing
 *    for the session, while a slow run that still gets answers finishes and saves;
 *  - tells the screens only when it wrote something, never sooner than the pulse's gap after they were last told;
 *  - and its timer rests while the app is hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localToInstant } from '@/living/dates';
import { gaugeApi, type GaugeApi, type GaugeCallOptions, type GaugeProblem, type GaugeV2Api } from '@/net/gauge';
import { notifyGaugeDataChanged, onGaugeDataChanged } from '@/net/gaugeIdentity';
import type * as Pulse from '../gaugePulse';
import { PULSE_REFRESH_GAP_MS } from '../gaugePulse';
import {
  GAUGE_IMPORT_DEADLINE_MS, GAUGE_IMPORT_INTERVAL_MS, GAUGE_IMPORT_KEY, GAUGE_IMPORT_NOTIFY_GAP_MS, GAUGE_IMPORT_NOTIFY_MARGIN_MS, GAUGE_IMPORT_PARALLEL_READS, GAUGE_RECENT_MAX_DAYS,
  readGaugeImportState, resetGaugeImportNotifyForTests, revisedWorkoutDates, runGaugeImport, startGaugeImport, type ActivityImportInput, type GaugeImportDeps,
} from '../gaugeImport';

// the scheduler under test starts the pulse too: its loop is not part of these tests
vi.mock('../gaugePulse', async (importOriginal) => ({ ...(await importOriginal<typeof Pulse>()), startGaugePulse: () => () => undefined }));

const TZ = 'UTC';
const TODAY = '2026-10-20';
const NOW = Date.parse('2026-10-20T06:34:00Z');

function memoryStorage(init?: unknown) {
  const m = new Map<string, string>();
  if (init) m.set(GAUGE_IMPORT_KEY, JSON.stringify(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

const timelineOf = (date: string) => ({ date, start: localToInstant(date, 0, TZ), minutes: 2, steps: { selected: [1, 2] }, hr: { bpm: [null, null], supportedS: [null, null] }, sleep: { stage: [null, null] } });

interface Fake {
  /** No read answers (a server too slow or out of reach). */
  down?: boolean;
  problem?: GaugeProblem | null;
  timeline?: (date: string) => unknown;
  /** Each request stays out this long (ms), so the fan-out can be seen. */
  holdMs?: number;
  /** Other answers for some requests, by name. */
  answers?: Record<string, (...args: never[]) => unknown>;
}

/** A client that records what was asked, with which call options, and how many requests were out at once. */
function fakeApi(o: Fake = {}, withOptions = true) {
  const asked: Array<{ name: string; args: unknown[]; options: (GaugeCallOptions & { priority?: string }) | null }> = [];
  let out = 0;
  let peak = 0;
  const answers: Record<string, (...args: never[]) => unknown> = {
    activity: () => ({ days: [] }),
    sleep: () => ({ sessions: [] }),
    steps: () => ({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }),
    changes: () => ({ cursor: 'c1.1.0', resync: false, changes: [], truncated: false }),
    hc: () => ({ records: [], deleted: [], truncated: false }),
    workouts: () => ({ sessions: [] }),
    detections: () => ({ detector: 'detect/2', withdrawn: [], episodes: [] }),
    baselines: () => ({}),
    timeline: (date: string) => (o.timeline ? o.timeline(date) : timelineOf(date)),
    fusionContext: () => ({ revision: 'r1', changed: false }),
    ...o.answers,
  };
  const make = (options: (GaugeCallOptions & { priority?: string }) | null): Record<string, unknown> => {
    const client: Record<string, unknown> = { status: () => ({ lastOkAt: null, problem: o.problem ?? (o.down ? 'offline' : null) }) };
    for (const [name, answer] of Object.entries(answers)) {
      client[name] = async (...args: unknown[]) => {
        asked.push({ name, args, options });
        out++;
        peak = Math.max(peak, out);
        if (o.holdMs !== undefined) await new Promise((resolve) => setTimeout(resolve, o.holdMs));
        out--;
        return o.down ? null : (answer as (...a: unknown[]) => unknown)(...args);
      };
    }
    if (withOptions) client.withOptions = (given: GaugeCallOptions) => make(given);
    return client;
  };
  const names = (name: string) => asked.filter((a) => a.name === name).map((a) => a.args);
  return { api: make(null) as unknown as GaugeApi & Partial<GaugeV2Api>, asked, names, peak: () => peak };
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
const okActivities = async (_input: ActivityImportInput) => ({ created: [], updated: [] });
const ALL = { ring: TODAY, sleep: TODAY, steps: TODAY, activities: TODAY };
/** A filled device that imported half an hour ago; its hourly chunk is not due unless `reconcile` says so. */
const backfilled = (over: Record<string, unknown> = {}) => ({ lastImportAt: '2026-10-20T06:00:00.000Z', lastDate: TODAY, backfilled: true, feeds: ALL, reconcile: { next: null, at: '2026-10-20T06:00:00.000Z' }, ...over });

afterEach(() => {
  vi.useRealTimers();
  resetGaugeImportNotifyForTests();
});

describe('the recent window stays short', () => {
  it('a device away for ten days reads four days, then the days it missed as the first chunk', async () => {
    const away = '2026-10-10';
    const storage = memoryStorage(backfilled({ lastImportAt: '2026-10-10T06:00:00.000Z', lastDate: away, feeds: { ring: away, sleep: away, steps: away, activities: away }, reconcile: { next: '2026-09-28', at: '2026-10-10T06:00:00.000Z' } }));
    const f = fakeApi();
    const r = await runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities }));
    expect(GAUGE_RECENT_MAX_DAYS).toBe(4);
    // recent first, then the owed days (two before the last import day, as the uncapped window began)
    expect(f.names('activity').map((a) => a.slice(0, 2))).toEqual([['2026-10-17', TODAY], ['2026-10-08', '2026-10-14']]);
    expect(r).toMatchObject({ ran: true, from: '2026-10-17', to: TODAY, reconciled: { from: '2026-10-08', to: '2026-10-14', ok: true } });
    const st = readGaugeImportState(storage);
    expect(st.feeds).toEqual(ALL);
    expect(st.reconcile?.next).toBe('2026-10-15');
    // the rest of what it missed is the next chunk, an hour on
    const later = fakeApi();
    await runGaugeImport(deps({ api: later.api, storage, activityImporter: okActivities, now: () => NOW + 61 * 60_000 }));
    expect(later.names('activity').map((a) => a.slice(0, 2))).toEqual([['2026-10-18', TODAY], ['2026-10-15', '2026-10-17']]);
  });

  it('a feed that kept failing never makes later runs read more than four days', async () => {
    const storage = memoryStorage(backfilled({ lastDate: '2026-10-05', feeds: { ...ALL, activities: '2026-10-05' } }));
    const f = fakeApi();
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities }));
    expect(f.names('activity').map((a) => a.slice(0, 2))).toEqual([['2026-10-17', TODAY]]);
    expect(f.names('hc').map((a) => a.slice(1, 3))).toEqual([['2026-10-17', TODAY]]);
  });

  it('a feed that goes on failing in the recent days takes the rotation to its owed days once, not every hour', async () => {
    // the sleep read fails whenever it reaches today; the older chunks answer
    const stuck = '2026-10-15';
    const storage = memoryStorage(backfilled({ lastDate: stuck, feeds: { ...ALL, sleep: stuck }, reconcile: { next: null, at: null } }));
    const sleep = (_from: string, to: string) => (to > TODAY ? null : { sessions: [] });
    const chunks: string[] = [];
    for (let hour = 0; hour < 6; hour++) {
      const r = await runGaugeImport(deps({ api: fakeApi({ answers: { sleep } }).api, storage, now: () => NOW + hour * 61 * 60_000 }));
      expect(r).toMatchObject({ ran: true, from: '2026-10-17', reconciled: { ok: true } });
      if (r.ran && r.reconciled) chunks.push(`${r.reconciled.from}..${r.reconciled.to}`);
      expect(readGaugeImportState(storage).feeds?.sleep).toBe(stuck);
    }
    // the owed days first, then the rest of the 30 days as ever (they were never reached while it jumped back each hour)
    expect(chunks).toEqual(['2026-10-13..2026-10-16', '2026-09-21..2026-09-27', '2026-09-28..2026-10-04', '2026-10-05..2026-10-11', '2026-10-12..2026-10-16', '2026-09-21..2026-09-27']);
  });

  it('a server that answers nothing of the recent days is not asked for the older chunk', async () => {
    const storage = memoryStorage(backfilled({ reconcile: { next: null, at: null } }));
    const f = fakeApi({ down: true });
    expect(await runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities }))).toEqual({ ran: false, reason: 'offline' });
    expect(f.names('activity')).toHaveLength(1);
    expect(f.names('sleep')).toHaveLength(1);
    // nothing was saved: the chunk is still due on the next run
    expect(readGaugeImportState(storage).reconcile).toEqual({ next: null, at: null });
  });

  it('queued timelines wait while the server answers none of the run\'s own, and are read once it does', async () => {
    const old = addDays(TODAY, -12);
    const storage = memoryStorage(backfilled({ evidence: { v: 1, dates: [{ date: old, at: '2026-10-19T00:00:00.000Z' }] } }));
    const slow = fakeApi({ timeline: () => null });
    await runGaugeImport(deps({ api: slow.api, storage, activityImporter: okActivities }));
    expect(slow.names('timeline').map((a) => a[0])).toEqual(['2026-10-18', '2026-10-19', TODAY]);
    expect(readGaugeImportState(storage).evidence?.dates.map((x) => x.date)).toEqual([old, '2026-10-18', '2026-10-19', TODAY]);
    const well = fakeApi();
    await runGaugeImport(deps({ api: well.api, storage, activityImporter: okActivities }));
    expect(well.names('timeline').map((a) => a[0])).toContain(old);
    expect(readGaugeImportState(storage).evidence).toBeUndefined();
  });

  it('a record without a revision time counts as new once, not on every run', () => {
    const since = Date.parse('2026-10-20T04:00:00Z');
    const session = (start: string, end: string) => ({ id: start, start, end, type: 'walk' });
    const workouts = { sessions: [session('2026-10-12T07:00:00Z', '2026-10-12T08:00:00Z')] } as never;
    const hc = { records: [{ id: 'a', start: '2026-10-14T07:00:00Z', end: '2026-10-14T08:00:00Z', lastModified: null }, { id: 'b', start: '2026-10-20T04:30:00Z', end: '2026-10-20T05:00:00Z', lastModified: null }] } as never;
    // before any import everything is new
    expect(revisedWorkoutDates(workouts, hc, null, TZ, '2026-09-21', TODAY)).toEqual(['2026-10-20', '2026-10-14', '2026-10-12']);
    // after one, only what ended since then (the old ones used to come back each run)
    expect(revisedWorkoutDates(workouts, hc, since, TZ, '2026-09-21', TODAY)).toEqual(['2026-10-20']);
  });
});

describe('requests', () => {
  it('at most two are out at once, each at background priority and cancellable', async () => {
    const storage = memoryStorage(backfilled({ reconcile: { next: null, at: null } }));
    const f = fakeApi({ holdMs: 1 });
    const context = async () => ({ activities: [], preference: {}, headline: 'atLeast' as const });
    const r = await runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities, hcWeight: () => true, stepsContext: context }));
    expect(r).toMatchObject({ ran: true, reconciled: { ok: true } });
    expect(GAUGE_IMPORT_PARALLEL_READS).toBe(2);
    expect(f.peak()).toBe(2);
    // the recent days and the chunk: the change feed, the context, three summaries, two Health Connect types, the rest
    expect(new Set(f.asked.map((a) => a.name))).toEqual(new Set(['changes', 'fusionContext', 'activity', 'sleep', 'steps', 'hc', 'detections', 'workouts', 'baselines', 'timeline']));
    expect(f.asked.length).toBeGreaterThan(15);
    for (const a of f.asked) {
      expect(a.options?.priority).toBe('background');
      expect(a.options?.signal).toBeInstanceOf(AbortSignal);
      // what each call passes itself still goes with it
      expect(a.args.at(-1)).toMatchObject({ tz: TZ });
    }
  });

  it('a client without call options is asked as it is, still two at a time', async () => {
    const storage = memoryStorage(backfilled({ reconcile: { next: null, at: null } }));
    const f = fakeApi({ holdMs: 1 }, false);
    expect(await runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities }))).toMatchObject({ ran: true });
    expect(f.peak()).toBe(2);
    expect(f.asked.every((a) => a.options === null)).toBe(true);
  });

  it('why a run got no answer is read from its own requests, not from what a screen asked meanwhile', async () => {
    // the client's own status says a screen's read just succeeded; this run's reads were refused
    const calm = { lastOkAt: null, problem: null };
    const refused = { lastOkAt: null, problem: 'not_paired' as const };
    const view = { activity: async () => null, sleep: async () => null, status: () => refused };
    const api = { ...view, status: () => calm, withOptions: () => view } as unknown as GaugeApi;
    expect(await runGaugeImport(deps({ api }))).toEqual({ ran: false, reason: 'not_paired' });
  });
});

describe('the deadline', () => {
  it('a command that never settles ends its run, not every later import; settling late, it writes nothing more', async () => {
    vi.useFakeTimers({ now: NOW });
    const storage = memoryStorage(backfilled());
    let release!: (v: { created: unknown[]; skipped: unknown[] }) => void;
    const stuck = vi.fn(() => new Promise<{ created: unknown[]; skipped: unknown[] }>((resolve) => { release = resolve; }));
    const never = vi.fn(okActivities);
    const first = runGaugeImport(deps({ api: fakeApi().api, storage, importer: stuck, activityImporter: never }));
    // (no clock moves here: the run's reads are answered without a timer)
    await vi.advanceTimersByTimeAsync(0);
    expect(stuck).toHaveBeenCalledTimes(1);
    // an import asked for meanwhile joins it, as before
    const joined = runGaugeImport(deps({ api: fakeApi().api, storage, importer: stuck, activityImporter: never }));
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_DEADLINE_MS - 1);
    let settled = false;
    void first.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ ran: false, reason: 'failed' });
    expect(await joined).toEqual({ ran: false, reason: 'failed' });
    // the next import is a new run
    const after = NOW + GAUGE_IMPORT_DEADLINE_MS + 1000;
    const next = fakeApi();
    expect(await runGaugeImport(deps({ api: next.api, storage, activityImporter: okActivities, now: () => after }))).toMatchObject({ ran: true });
    expect(next.names('activity')).toHaveLength(1);
    const saved = storage.map.get(GAUGE_IMPORT_KEY);
    expect(readGaugeImportState(storage).lastImportAt).toBe(new Date(after).toISOString());
    // the stuck command answers at last: its run goes no further
    release({ created: [1], skipped: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(never).not.toHaveBeenCalled();
    expect(stuck).toHaveBeenCalledTimes(1);
    expect(storage.map.get(GAUGE_IMPORT_KEY)).toBe(saved);
  });

  it('a slow run that keeps getting answers is left to finish, and saves what it read', async () => {
    vi.useFakeTimers({ now: NOW });
    const queued = Array.from({ length: 7 }, (_, k) => ({ date: addDays(TODAY, -(10 + k)), at: '2026-10-19T00:00:00.000Z' }));
    const storage = memoryStorage(backfilled({ reconcile: { next: null, at: null }, evidence: { v: 1, dates: queued } }));
    // every read takes 12 s: the recent days, the hourly chunk and the queued timelines are more than four minutes of them
    const f = fakeApi({ holdMs: 12_000 });
    const context = async () => ({ activities: [], preference: {}, headline: 'atLeast' as const });
    let out: unknown;
    void runGaugeImport(deps({ api: f.api, storage, activityImporter: okActivities, hcWeight: () => true, stepsContext: context })).then((o) => { out = o; });
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_DEADLINE_MS + 1000);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_DEADLINE_MS);
    expect(out).toMatchObject({ ran: true, reconciled: { ok: true } });
    const st = readGaugeImportState(storage);
    expect(st.evidence).toBeUndefined();
    expect(st.reconcile?.next).toBe('2026-09-28');
    // so the next run is a light one: no chunk within the hour, nothing queued
    const next = fakeApi();
    await runGaugeImport(deps({ api: next.api, storage, activityImporter: okActivities, now: () => NOW + 10 * 60_000 }));
    expect(next.names('activity')).toHaveLength(1);
    expect(next.names('timeline')).toHaveLength(3);
  });

  it('the deadline counts from the last answer: a run that then stalls is given up that long after it', async () => {
    vi.useFakeTimers({ now: NOW });
    const storage = memoryStorage(backfilled());
    const slow = 200_000;
    const importer = async () => {
      await new Promise((resolve) => setTimeout(resolve, slow));
      return { created: [], skipped: [] };
    };
    const stuck = vi.fn(() => new Promise<null>(() => undefined));
    let out: unknown;
    void runGaugeImport(deps({ api: fakeApi().api, storage, importer, activityImporter: stuck })).then((o) => { out = o; });
    await vi.advanceTimersByTimeAsync(slow + GAUGE_IMPORT_DEADLINE_MS - 1);
    expect(stuck).toHaveBeenCalledTimes(1);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(out).toEqual({ ran: false, reason: 'failed' });
  });

  it('a run given up cancels its requests and starts no more of them', async () => {
    vi.useFakeTimers({ now: NOW });
    const storage = memoryStorage(backfilled());
    const signals: AbortSignal[] = [];
    const asked: string[] = [];
    // every request hangs until its signal aborts, as the client's do
    const hang = (name: string, o: GaugeCallOptions) => () => new Promise((_, reject) => {
      asked.push(name);
      signals.push(o.signal!);
      o.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const api = {
      status: () => ({ lastOkAt: null, problem: null }),
      withOptions: (o: GaugeCallOptions) => ({ activity: hang('activity', o), sleep: hang('sleep', o), steps: hang('steps', o), status: () => ({ lastOkAt: null, problem: 'offline' }) }),
      activity: async () => null, sleep: async () => null, steps: async () => null,
    } as unknown as GaugeApi;
    const importer = vi.fn(async () => ({ created: [], skipped: [] }));
    const run = runGaugeImport(deps({ api, storage, importer }));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['activity', 'sleep']);
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_DEADLINE_MS);
    expect(await run).toEqual({ ran: false, reason: 'failed' });
    expect(signals.every((s) => s.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // the third summary was waiting its turn: never sent
    expect(asked).toEqual(['activity', 'sleep']);
    expect(importer).not.toHaveBeenCalled();
  });
});

describe('telling the screens', () => {
  let told: number[];
  /** What each notification said of when the data changed (ms after the start; null: now). */
  let changed: Array<number | null>;
  let off: () => void;
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    told = [];
    changed = [];
    off = onGaugeDataChanged((changedAt?: number) => {
      told.push(Date.now() - NOW);
      changed.push(changedAt === undefined ? null : changedAt - NOW);
    });
  });
  afterEach(() => off());
  const wrote = async () => ({ created: [1], skipped: [] });

  it('an import that found nothing new says nothing; one that wrote says so at once', async () => {
    const storage = memoryStorage(backfilled());
    expect(await runGaugeImport(deps({ api: fakeApi().api, storage, activityImporter: okActivities }))).toMatchObject({ ran: true, created: 0 });
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_GAP_MS * 2);
    expect(told).toEqual([]);
    await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }));
    expect(told).toHaveLength(1);
  });

  it('a new or updated activity counts as written too', async () => {
    const storage = memoryStorage(backfilled());
    await runGaugeImport(deps({ api: fakeApi().api, storage, activityImporter: async () => ({ created: [], updated: [1] }) }));
    expect(told).toHaveLength(1);
  });

  it('a Health Connect weight, a withdrawn activity or an automatic decision alone counts as written', async () => {
    const quiet = async () => ({ created: [], skipped: [] });
    const cases: Array<Partial<GaugeImportDeps>> = [
      // `log.fromGauge` lists the weights it wrote apart from the steps and nights
      { importer: async () => ({ created: [], skipped: [], weights: { created: ['w1'] } }) },
      { importer: quiet, activityImporter: async () => ({ created: [], updated: [], superseded: ['a1'] }) },
      { importer: quiet, activityImporter: async () => ({ created: [], updated: [], superseded: [], compacted: 1 }) },
      { importer: quiet, activityImporter: async () => ({ created: [], updated: [], decided: 1 }) },
    ];
    for (const [k, over] of cases.entries()) {
      resetGaugeImportNotifyForTests();
      await runGaugeImport(deps({ api: fakeApi().api, storage: memoryStorage(backfilled()), ...over }));
      expect(told).toHaveLength(k + 1);
    }
    // an activity import that changed nothing is still nothing
    resetGaugeImportNotifyForTests();
    await runGaugeImport(deps({ api: fakeApi().api, storage: memoryStorage(backfilled()), importer: quiet, activityImporter: async () => ({ created: [], updated: [], superseded: [], compacted: 0, decided: 0 }) }));
    expect(told).toHaveLength(cases.length);
  });

  it('a screen whose listener throws does not fail the import that told it, now or after the gap', async () => {
    const offBroken = onGaugeDataChanged(() => { throw new Error('a screen broke'); });
    try {
      const storage = memoryStorage(backfilled());
      expect(await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }))).toMatchObject({ ran: true, created: 1 });
      expect(told).toEqual([0]);
      // the next word waits its gap and is said from a timer: nothing is thrown there either
      await vi.advanceTimersByTimeAsync(1000);
      expect(await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }))).toMatchObject({ ran: true });
      await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_GAP_MS * 2);
      expect(told).toEqual([0, GAUGE_IMPORT_NOTIFY_GAP_MS + GAUGE_IMPORT_NOTIFY_MARGIN_MS]);
    } finally {
      offBroken();
    }
  });

  it('after a pulse told them, the import it started waits the pulse\'s gap, and several imports are one word', async () => {
    expect(GAUGE_IMPORT_NOTIFY_GAP_MS).toBe(PULSE_REFRESH_GAP_MS);
    const storage = memoryStorage(backfilled());
    // the pulse: the screens are told first, then the import runs
    notifyGaugeDataChanged();
    expect(told).toEqual([0]);
    await vi.advanceTimersByTimeAsync(10_000);
    await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }));
    await vi.advanceTimersByTimeAsync(5_000);
    await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }));
    expect(told).toEqual([0]);
    // not at the very end of the gap, where the pulse's own next refresh can be due (it then stands for both)
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_GAP_MS - 15_000);
    expect(told).toEqual([0]);
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_MARGIN_MS);
    expect(told).toEqual([0, GAUGE_IMPORT_NOTIFY_GAP_MS + GAUGE_IMPORT_NOTIFY_MARGIN_MS]);
    // said late, with when the second import finished: a question a screen asked after that is fresh already
    expect(changed).toEqual([null, 15_000]);
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_GAP_MS * 2);
    expect(told).toHaveLength(2);
  });

  it('when someone else tells them while an import\'s word waits, it is not said again', async () => {
    const storage = memoryStorage(backfilled());
    notifyGaugeDataChanged();
    await runGaugeImport(deps({ api: fakeApi().api, storage, importer: wrote }));
    await vi.advanceTimersByTimeAsync(12_000);
    // a finished measurement, the next pulse
    notifyGaugeDataChanged();
    await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_NOTIFY_GAP_MS * 3);
    expect(told).toEqual([0, 12_000]);
  });
});

describe('the timer', () => {
  it('rests while the app is hidden; coming back to the front imports', async () => {
    vi.useFakeTimers({ now: NOW });
    let visibility: DocumentVisibilityState = 'visible';
    const state = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    // every run reads the change feed first, and ends with the sleep read here (no server is paired)
    const begun = vi.spyOn(gaugeApi, 'changes').mockResolvedValue(null);
    const ended = vi.spyOn(gaugeApi, 'sleep').mockResolvedValue(null);
    const stop = startGaugeImport();
    try {
      await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1), { timeout: 5000 });
      await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_INTERVAL_MS);
      await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(2), { timeout: 5000 });
      visibility = 'hidden';
      await vi.advanceTimersByTimeAsync(GAUGE_IMPORT_INTERVAL_MS * 3);
      await vi.advanceTimersByTimeAsync(1000);
      expect(begun).toHaveBeenCalledTimes(2);
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(3), { timeout: 5000 });
    } finally {
      stop();
      state.mockRestore();
      begun.mockRestore();
      ended.mockRestore();
    }
  });
});
