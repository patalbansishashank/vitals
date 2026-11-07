/**
 * r063 CORE, client side:
 * - S1 / S5: the REAL server timeline (the companion's `gauge_timeline` over a Lumen store) through the client adapter
 *   into both consumers: Progress's minute lookup → Heart Points (5 minutes at 110 steps/min earn 5 points) and Today's
 *   energy minutes; a no-store answer never crashes Today.
 * - S6: the import posts the person's fusion context, then reads `/steps` with it (what the Ring reads).
 * - S13: the change feed's deletions reach `activity.fromGauge` as `deletedRefs`, weights are retracted, each is kept in
 *   the audit trail, and the cursor moves only once they landed.
 * - S15: command batches within their limits; the watermark waits for every page.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adaptGaugeData, type GaugeApi, type GaugeChanges, type GaugeHc, type GaugeTimeline, type GaugeV2Api } from '@/net/gauge';
import { minuteIndex } from '@/features/living/progress/data/timelines';
import { dayHeartPoints } from '@/features/living/progress/data/actuals';
import { minutesFor } from '@/features/living/activity/data';
import type { EnergyHour } from '@/living/sensors/energyDay';
import { importActivities, readGaugeImportState, runGaugeImport, SESSIONS_BATCH, type ActivityImportInput, type GaugeImportDeps } from '../gaugeImport';
import { openLumenStore } from '../../../packages/companion/src/home/lumenStore.ts';
import { lumenToolSet } from '../../../packages/companion/src/home/lumenTools.ts';
import { INSTALL, ringSteps } from '../../../packages/companion/src/home/lumenFixtures.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

/** The companion's `gauge_timeline` answer for 2026-10-20 (Kolkata), as the client receives it (through its adapter). */
async function serverTimeline(events: unknown[] | null): Promise<GaugeTimeline> {
  let open: () => ReturnType<typeof openLumenStore> | null = () => null;
  if (events) {
    const dir = mkdtempSync(join(TMP, 'r063-client-'));
    const store = openLumenStore(join(dir, 'lumen.db'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
    expect(store.ingest(INSTALL, events, Date.parse('2026-10-21T00:00:00Z')).rejected).toEqual([]);
    open = () => store;
  }
  const env = await lumenToolSet(open, 'Asia/Kolkata', () => Date.parse('2026-10-21T00:00:00Z')).call('gauge_timeline', { date: '2026-10-20' });
  expect(env.ok).toBe(true);
  // the same JSON over HTTP, then the client's one adapter
  return adaptGaugeData('/v1/gauge/timeline', JSON.parse(JSON.stringify(env.data)) as Record<string, unknown>) as unknown as GaugeTimeline;
}

const walk = () => Array.from({ length: 5 }, (_, k) => ringSteps(new Date(Date.parse('2026-10-20T04:00:00Z') + k * 60_000).toISOString(), 110));
const T0 = Date.parse('2026-10-20T04:00:00Z');

describe('S1: the real server timeline through both consumers', () => {
  it('5 minutes at 110 steps/min earn 5 Heart Points (Progress), and are minute-supported steps (Today)', async () => {
    const t = await serverTimeline(walk());
    const minuteAt = minuteIndex([t], 'Asia/Kolkata');
    expect(minuteAt(T0 + 30_000)).toMatchObject({ steps: 110, support: 'minute' });
    expect(dayHeartPoints({ start: T0 - 3_600_000, end: T0 + 3_600_000, minuteAt, bouts: [], ageY: 40 })).toBe(5);
    const hours: EnergyHour[] = [{ start: T0 } as EnergyHour];
    const m = minutesFor(hours, t);
    expect(m.slice(0, 6)).toEqual([...Array.from({ length: 5 }, () => ({ sleep: 'none', steps: 110, support: 'minute' })), { sleep: 'none', steps: null, support: null }]);
  });

  it('the audit repro: without steps.support the same minutes earned 0 (every count looked coarse)', async () => {
    const t = await serverTimeline(walk());
    const stripped = { ...t, steps: { ...t.steps, support: undefined } } as unknown as GaugeTimeline;
    expect(dayHeartPoints({ start: T0 - 3_600_000, end: T0 + 3_600_000, minuteAt: minuteIndex([stripped], 'Asia/Kolkata'), bouts: [], ageY: 40 })).toBe(0);
    // an older server's answer without it is completed by the adapter: still 5
    const raw = JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>;
    const adapted = adaptGaugeData('/v1/gauge/timeline', raw) as unknown as GaugeTimeline;
    expect(dayHeartPoints({ start: T0 - 3_600_000, end: T0 + 3_600_000, minuteAt: minuteIndex([adapted], 'Asia/Kolkata'), bouts: [], ageY: 40 })).toBe(5);
  });
});

describe('S5: a no-store timeline never crashes Today', () => {
  it('the server\'s no-store answer, and an older server\'s partial one, both read as unknown minutes', async () => {
    const t = await serverTimeline(null);
    expect(t.minutes).toBe(1440);
    const hours: EnergyHour[] = [{ start: T0 } as EnergyHour];
    expect(minutesFor(hours, t).every((m) => m.steps === null && m.sleep === 'none' && m.support === null)).toBe(true);
    const old = adaptGaugeData('/v1/gauge/timeline', { date: '2026-10-20', tz: 'Asia/Kolkata', minutes: 1440 }) as unknown as GaugeTimeline;
    expect(() => minutesFor(hours, old)).not.toThrow();
    expect(minuteIndex([old], 'Asia/Kolkata')(Date.parse('2026-10-19T18:31:00Z'))).toEqual({ sleep: 'none', steps: null, support: null, hr: null });
  });
});

// --- the import

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

interface FakeOpts {
  feed?: GaugeChanges | null;
  hc?: (type: string) => Partial<GaugeHc> | null;
}
function fakeApi(o: FakeOpts = {}) {
  const log: string[] = [];
  const posted: unknown[] = [];
  const api = {
    activity: async () => ({ days: [] }),
    sleep: async () => ({ sessions: [] }),
    steps: async () => {
      log.push('GET steps');
      return { fusionVersion: 'steps-fuse/1', intervals: [], days: [] };
    },
    stepsFuse: async () => {
      log.push('POST steps/fuse');
      return { fusionVersion: 'steps-fuse/1', intervals: [], days: [] };
    },
    fusionContext: async (body: unknown) => {
      log.push('POST fusion-context');
      posted.push(body);
      return { revision: 'fc:1', changed: true };
    },
    changes: async (since: string | null) => {
      log.push(`changes ${since}`);
      return o.feed === undefined ? { cursor: 'c1.1.0', resync: true, changes: [], truncated: false } : o.feed;
    },
    hc: async (type: string) => (o.hc ? o.hc(type) : { type, from: '', to: '', records: [], deleted: [], truncated: false }),
    workouts: async () => ({ sessions: [] }),
    status: () => ({ lastOkAt: null, problem: null }),
  } as unknown as GaugeApi & Partial<GaugeV2Api>;
  return { api, log, posted };
}
const deps = (over: Partial<GaugeImportDeps>): Partial<GaugeImportDeps> => ({
  enabled: () => true,
  today: () => '2026-10-20',
  tz: () => 'Asia/Kolkata',
  now: () => Date.parse('2026-10-20T06:34:00Z'),
  importer: async () => ({ created: [], skipped: [] }),
  storage: memoryStorage(),
  stepsContext: () => ({ activities: [{ start: '2026-10-20T04:00:00.000Z', end: '2026-10-20T04:20:00.000Z', kind: 'nonLocomotor' }], preference: { stepsPreference: ['ring', 'phone', 'hc-other'], soleSustainedGait: true }, headline: 'atLeast' }),
  ...over,
});
const deletedWorkout = { kind: 'workout' as const, id: 'w-1', ref: 'gauge:w-1', change: 'deleted' as const, start: null, end: null, at: '2026-10-20T10:00:00+05:30' };
const deletedHc = { kind: 'hcExercise' as const, id: 'h-1', ref: 'hc:h-1', change: 'deleted' as const, start: null, end: null, at: null };
const deletedWeight = { kind: 'hcWeight' as const, id: 'wt-1', ref: 'hc:wt-1', change: 'deleted' as const, start: null, end: null, at: null };

describe('S6: the import posts the fusion context, then reads the steps the Ring reads', () => {
  it('fusion-context first (35 days to tomorrow, in the person\'s zone), then GET /steps', async () => {
    const f = fakeApi();
    await runGaugeImport(deps({ api: f.api }));
    expect(f.log.indexOf('POST fusion-context')).toBeLessThan(f.log.indexOf('GET steps'));
    expect(f.log).not.toContain('POST steps/fuse');
    expect(f.posted[0]).toMatchObject({ window: { start: '2026-09-16T00:00', end: '2026-10-22T00:00' }, tz: 'Asia/Kolkata', activities: [expect.objectContaining({ kind: 'nonLocomotor' })] });
  });

  it('a server without the route: the explicit POST /steps/fuse as before', async () => {
    const f = fakeApi();
    (f.api as { fusionContext?: unknown }).fusionContext = async () => null;
    await runGaugeImport(deps({ api: f.api }));
    expect(f.log).toContain('POST steps/fuse');
    expect(f.log).not.toContain('GET steps');
  });
});

describe('S13: the change feed retracts what was deleted upstream, with an audit trail', () => {
  it('deletedRefs to activity.fromGauge (Gauge workouts too), weights retracted, the trail and the cursor saved', async () => {
    const storage = memoryStorage();
    const f = fakeApi({ feed: { cursor: 'c1.9.2', resync: false, truncated: false, changes: [deletedWorkout, deletedHc, deletedWeight, { ...deletedHc, id: 'h-2', ref: 'hc:h-2', change: 'revised' }] } });
    const inputs: ActivityImportInput[] = [];
    const retracted: string[][] = [];
    const out = await runGaugeImport(deps({
      api: f.api, storage,
      activityImporter: async (i) => {
        inputs.push(i);
        return { created: [], updated: ['x'] };
      },
      retractWeights: async (ids) => {
        retracted.push(ids);
        return ids.length;
      },
    }));
    expect(out).toMatchObject({ ran: true, activities: { created: 0, updated: 1 } });
    expect(inputs[0]!.deletedRefs).toEqual(['gauge:w-1', 'hc:h-1']);
    expect(retracted).toEqual([['wt-1']]);
    const st = readGaugeImportState(storage);
    expect(st.changesCursor).toBe('c1.9.2');
    expect(st.retractions!.map((r) => [r.ref, r.kind, r.deletedAt])).toEqual([['hc:wt-1', 'hcWeight', null], ['gauge:w-1', 'workout', '2026-10-20T10:00:00+05:30'], ['hc:h-1', 'hcExercise', null]]);
    // the next run asks from the saved cursor
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: async () => ({ created: [], updated: [] }), retractWeights: async () => 0 }));
    expect(f.log.filter((x) => x.startsWith('changes'))).toEqual(['changes null', 'changes c1.9.2']);
  });

  it('a failed activity import keeps the cursor (the deletions are asked again), and the watermark', async () => {
    const storage = memoryStorage();
    const f = fakeApi({ feed: { cursor: 'c1.9.2', resync: false, truncated: false, changes: [deletedWorkout] } });
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: async () => null }));
    const st = readGaugeImportState(storage);
    expect(st.changesCursor).toBeUndefined();
    expect(st.lastDate).toBeNull();
    expect(st.retractions).toBeUndefined();
  });
});

describe('S15: bounded batches and the watermark', () => {
  it('more than 500 Health Connect sessions go in batches of at most 500, the minutes and deletions with them', async () => {
    const hcSessions = Array.from({ length: 1201 }, (_, k) => ({ id: `h${k}`, revision: 'r', start: k, end: k + 1, exerciseType: 79, originPackage: 'com.strava' }));
    const sizes: Array<[number, number, number]> = [];
    const r = await importActivities(async (i) => {
      sizes.push([i.hcSessions.length, i.minutes.length, i.deletedRefs?.length ?? 0]);
      return { created: [i.hcSessions.length], updated: [] };
    }, { gaugeSessions: [], hcSessions, minutes: [{ first: 0, steps: [1] }], deletedRefs: ['hc:x'] });
    expect(SESSIONS_BATCH).toBe(500);
    expect(sizes).toEqual([[500, 1, 1], [500, 1, 0], [201, 1, 0]]);
    expect(r).toEqual({ created: 3, updated: 0 });
    // one failed batch fails the whole import
    expect(await importActivities(async (i) => (i.hcSessions.length === 500 ? null : { created: [], updated: [] }), { gaugeSessions: [], hcSessions, minutes: [] })).toBeNull();
  });

  it('a Health Connect read cut short (a page did not arrive) leaves the watermark where it was', async () => {
    const storage = memoryStorage();
    const f = fakeApi({ hc: (type) => ({ type, from: '', to: '', records: [], truncated: true }) });
    await runGaugeImport(deps({ api: f.api, storage, activityImporter: async () => ({ created: [], updated: [] }) }));
    expect(readGaugeImportState(storage)).toMatchObject({ lastDate: null, backfilled: false });
    const g = fakeApi();
    await runGaugeImport(deps({ api: g.api, storage, activityImporter: async () => ({ created: [], updated: [] }) }));
    expect(readGaugeImportState(storage)).toMatchObject({ lastDate: '2026-10-20', backfilled: true });
  });
});
