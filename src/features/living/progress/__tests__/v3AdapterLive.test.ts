/**
 * Progress's V3 adapter over real documents (energy SPEC §V4.6, §V3.5): a plan in the document store, Gauge sessions
 * imported through `activity.fromGauge`, one approved through `activity.approve` and one left pending, meals and a day
 * report written as log entries, the fused minute timeline of the day, and the engine run over the realised schedule.
 * The approved walk earns Heart Points, a session stimulus and its energy; the pending ride earns nothing; a day with an
 * unresolved meal has no intake (null, never 0); days without a timeline have no Heart Points.
 */
import { act } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { simulate, type DayTemplate } from '@/engine';
import { addDays, DEFAULT_ITEM_WEIGHTS, localToInstant, type LogEntry, type PlanDoc, type PlanVersionDoc } from '@/living';
import type { GaugeTimeline } from '@/net/gauge';
import type { ReviewSheetModel } from '@/living/activityCandidates';
import { progressActualsAdapter, setLiveProgressDeps, setProgressActuals, settleProgressActuals, subscribeProgressActuals, type ProgressDayActual } from '../v3Adapter';
import { setTimelineSource } from '../data/timelines';
import { notifyGaugeDataChanged, setGaugeIdentityClientForTests } from '@/net/gaugeIdentity';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXY44';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const START = '2026-10-14';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const Y2 = addDays(TODAY, -2);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const HOURLY = ['rmr', 'tef', 'neat', 'stepsEnergy', 'exerciseEnergy', 'tdee'] as const;

const REST: DayTemplate = {
  id: 'R', label: 'rest day', energy: { kind: 'kcal', kcal: 2100 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  steps: 8000, sleep: { bedH: 23, wakeH: 7 },
};

const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

/** Yesterday's fused minutes: asleep to 06:30, then still and awake, a 45-min walk at 07:00 (110 steps/min, HR 130) and a 30-min ride at 18:00 (no steps, HR 150). */
function timeline(date: string): GaugeTimeline {
  const first = ms(date, 0);
  const n = 1440;
  const selected: Array<number | null> = new Array(n).fill(0);
  const support: Array<'minute' | null> = new Array(n).fill('minute');
  const bpm: Array<number | null> = new Array(n).fill(null);
  const supportedS: Array<number | null> = new Array(n).fill(null);
  const stage: GaugeTimeline['sleep']['stage'] = new Array(n).fill(null);
  const [wake, w0, w1, r0, r1] = [ms(date, 6.5), ms(Y, 7), ms(Y, 7.75), ms(Y, 18), ms(Y, 18.5)];
  for (let k = 0; k < n; k++) {
    const t = first + k * 60_000;
    // asleep until 06:30 with the ring reporting no steps (the night after the day before is not coverage of that day)
    if (t < wake) {
      selected[k] = null;
      support[k] = null;
      stage[k] = 'light';
    }
    if (t >= w0 && t < w1) {
      selected[k] = 110;
      bpm[k] = 130;
      supportedS[k] = 60;
    }
    if (t >= r0 && t < r1) {
      selected[k] = null;
      support[k] = null;
      bpm[k] = 150;
      supportedS[k] = 60;
    }
  }
  return {
    source: 'lumen_health', timeZone: TZ, installations: [], freshness: { lastUploadAt: null, lastReadingAt: null, minutesSinceLastUpload: null, minutesSinceLastReading: null },
    date, tz: TZ, start: new Date(first).toISOString(), minutes: n,
    steps: { selected, source: new Array(n).fill('ring'), ring: selected, phone: new Array(n).fill(null), support },
    hr: { bpm, supportedS }, sleep: { stage }, sessions: [], hcExercise: [], acquisition: { ring: [], phone: [] },
  } as unknown as GaugeTimeline;
}

const meal = (id: string, date: string, clockH: number, kcal: number | null): LogEntry =>
  ({
    id, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: { by: 'user', method: 'typed' }, kind: 'meal', clockH, components: [],
    totals: { energyKcal: { value: kcal ?? 0, sd: 0 }, proteinG: { value: 30, sd: 0 }, carbG: { value: 60, sd: 0 }, fatG: { value: 20, sd: 0 }, ...(kcal === null ? { unknown: ['energyKcal'] } : {}) },
  }) as unknown as LogEntry;

async function seed(): Promise<void> {
  freshState({ cleared: true });
  enterBasics();
  act(() => useProfileStore.getState().setAge(40));
  const store = getDocumentStore();
  await store.ready;
  const profile = { schemaVersion: 1 as const, body: { sex: 'male' as const, ageYears: 40, heightCm: 180, weightKg: 80 }, startDate: START };
  const plan: PlanDoc = {
    name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T06:00:00.000Z` }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, 28), request: { profile, goals: [], horizonDays: 28 }, baselineProfile: profile, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T06:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [REST], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T06:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    // yesterday: two resolved meals and the day reported complete; the day before: one meal of unknown energy
    for (const e of [meal('01JMEAX0000000000000000001', Y, 8, 650), meal('01JMEAX0000000000000000002', Y, 19, 1250), meal('01JMEAX0000000000000000003', Y2, 13, null)]) await tx.append('dailyLogs', { ...e, _id: e.id });
    await tx.put('dayStatus', { _id: `day:${Y}`, date: Y, intake: 'complete' });
  });
  await settleCommits();
  // Gauge recorded a walk and a ride yesterday; the person approves the walk only
  out(await dispatch('activity.fromGauge', { gaugeSessions: [
    { id: 'g-walk', revision: 'r1', start: ms(Y, 7), end: ms(Y, 7.75), type: 'walk', kcal: 210 },
    { id: 'g-ride', revision: 'r1', start: ms(Y, 18), end: ms(Y, 18.5), type: 'cycle', kcal: 300 },
  ], hcSessions: [] }, SYS));
  await settleCommits();
  const m = out<ReviewSheetModel>(await dispatch('activity.candidates', { from: Y, to: Y }));
  const walk = m.rows.find((r) => r.exerciseId === 'walk')!;
  walkId = walk.id;
  expect(m.rows).toHaveLength(2);
  out(await dispatch('activity.approve', { id: walk.id, revision: walk.revision }));
  await settleCommits();
}

const runs: number[] = [];
let walkId = '';


/** (0.6.3 S2) The person's own basics: the estimators never fall back to the typical ones (these are the values they showed). */
function enterBasics(): void {
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(169);
  p.setWeight(80);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => vi.useRealTimers());

beforeEach(async () => {
  runs.length = 0;
  setProgressActuals(null);
  setTimelineSource(async (date) => (date === Y ? timeline(date) : null));
  setLiveProgressDeps({
    runPast: async (profile, schedule, days) => {
      runs.push(days);
      const s = schedule as Parameters<typeof simulate>[1];
      return simulate(profile as Parameters<typeof simulate>[0], { ...s, horizonDays: days }, { record: 'full', series: [...HOURLY], burnInDays: 0 }).hourly as never;
    },
  });
  await seed();
});

afterEach(() => {
  setTimelineSource(null);
  setLiveProgressDeps(null);
});

async function read(from: string, to: string): Promise<readonly ProgressDayActual[] | null> {
  const a = progressActualsAdapter();
  a.progressActuals(from, to);
  for (let i = 0; i < 20; i++) {
    await settleProgressActuals();
    await new Promise((r) => setTimeout(r, 0));
    const v = a.progressActuals(from, to);
    if (v) return v;
  }
  return a.progressActuals(from, to);
}

describe('Progress V3 adapter (live read)', () => {
  it('reads the realised history: approved walk counts, pending ride does not, unresolved intake is null', async () => {
    const days = (await read(START, TODAY))!;
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 8 }, (_, i) => addDays(START, i)));
    const y = days.find((d) => d.date === Y)!;
    const y2 = days.find((d) => d.date === Y2)!;

    // Heart Points: the walk's 45 minutes at HR 130 (≥ 70 % of Fit's 205.8 − 0.685·40 = 178.4: 2 points a minute); the
    // ride's HR minutes earn nothing: no steps and no approved activity (a pending candidate is not an activity)
    expect(y.heartPoints).toBeCloseTo(90, 5);
    // no timeline that day: no coverage, never 0
    expect(y2.heartPoints).toBeNull();

    // stimuli: one done session (the approved walk); the ride wrote no entry
    expect(y.sessionStimuli).toHaveLength(1);
    expect(y.sessionStimuli[0]!.minutes).toBeGreaterThan(0);
    expect(y2.sessionStimuli).toEqual([]);

    // energy out: energyDay over the realised run's hours, with its scenario envelope; one engine run for the past days
    expect(runs).toEqual([7]);
    expect(y.energyOut!.kcal).toBeGreaterThan(1500);
    expect(y.energyOut!.envelope.lo).toBeLessThan(y.energyOut!.kcal);
    expect(y.energyOut!.envelope.hi).toBeGreaterThan(y.energyOut!.kcal);
    // today has no realised run yet
    expect(days.find((d) => d.date === TODAY)!.energyOut).toBeNull();

    // intake: resolved (two meals, reported complete) vs a meal of unknown energy (null) vs nothing logged (null)
    expect(y.intakeKcal).toBe(1900);
    expect(y2.intakeKcal).toBeNull();
    expect(days.find((d) => d.date === START)!.intakeKcal).toBeNull();
  });

  it('energy out is energyDay over the realised run: Σ of the day’s engine hours, the walk’s envelope added to RMR ±15 %', async () => {
    const days = (await read(START, Y))!;
    const y = days.find((d) => d.date === Y)!.energyOut!;
    const before = days.find((d) => d.date === Y2)!.energyOut!;
    // the run the adapter made (horizon 7 = the past plan days), recomputed here: Y is plan day 6
    const { readDocs } = await import('@/commands/living');
    const { projectLiving, projectionSchedule } = await import('@/living');
    const docs = await readDocs(TODAY);
    const p = projectLiving({ docs, today: TODAY, tz: TZ, now: new Date(ms(TODAY, 12)).toISOString(), skipAssimilation: true });
    const h = simulate(p.plan!.baselineProfile, { ...projectionSchedule(p, TODAY)!, horizonDays: 7 }, { record: 'full', series: [...HOURLY], burnInDays: 0 }).hourly as Record<string, ArrayLike<number>>;
    const sum = (k: string, d: number) => Array.from({ length: 24 }, (_, j) => h[k]![d * 24 + j]!).reduce((a, b) => a + b, 0);
    expect(y.kcal).toBeCloseTo(sum('tdee', 6), 3);
    expect(before.kcal).toBeCloseTo(sum('tdee', 5), 3);
    // a day without a bout: RMR ±15 %; the walk's gross envelope widens yesterday's
    expect((before.envelope.hi - before.envelope.lo) / 2).toBeCloseTo(0.15 * sum('rmr', 5), 3);
    expect((y.envelope.hi - y.envelope.lo) / 2).toBeGreaterThan(0.15 * sum('rmr', 6) + 1);
  });

  it('memoises: a second window and a re-read reuse the run and the per-day answers; a new document reloads', async () => {
    const a = (await read(START, TODAY))!;
    const b = (await read(Y2, Y))!;
    expect(runs).toEqual([7]);
    expect(b[1]).toBe(a.find((d) => d.date === Y));
    expect(progressActualsAdapter().progressActuals(START, TODAY)).toBe(a);

    let bumps = 0;
    const off = subscribeProgressActuals(() => bumps++);
    // a late rejection of the walk retracts its entry: the log change reloads; unchanged days keep their objects
    out(await dispatch('activity.reject', { id: walkId }));
    await settleCommits();
    off();
    expect(bumps).toBeGreaterThan(0);
    const c = (await read(START, TODAY))!;
    const y = c.find((d) => d.date === Y)!;
    expect(y.sessionStimuli).toEqual([]);
    // the walk's moving minutes still earn by HR (Fit counts supported locomotion, §V2.3), the ride's still do not
    expect(y.heartPoints).toBeCloseTo(90, 5);
    expect(c.find((d) => d.date === START)).toBe(a.find((d) => d.date === START));
  });

  it('an 8-week window with a timeline every day reads quickly, and again from the per-day memo', async () => {
    setTimelineSource(async (date) => timeline(date));
    const from = addDays(TODAY, -55);
    const t0 = performance.now();
    const a = (await read(from, TODAY))!;
    const first = performance.now() - t0;
    expect(a).toHaveLength(56);
    // days before the plan still have Heart Points and sessions; only the plan's days have a run and resolved intake
    expect(a[0]!.heartPoints).toBe(0);
    expect(a[0]!.energyOut).toBeNull();
    expect(first).toBeLessThan(3000);
    // a document change re-reads the window; unchanged days come from the memo
    const { invalidateProgressActuals } = await import('../v3Adapter');
    invalidateProgressActuals();
    const t1 = performance.now();
    const b = (await read(from, TODAY))!;
    expect(performance.now() - t1).toBeLessThan(first);
    expect(b[0]).toBe(a[0]);
  });

  // 0.6.3: Today is home in every mode, and its Heart Points read this adapter. Without a plan the days still have the
  // ring's minutes, so Heart Points are known (the ring's minutes alone; a day without a timeline is unknown, never 0); energy out and intake stay
  // unknown (no realised run, no plan day). Before 0.6.3 the whole answer was null.
  it('without a plan: the days, with no energy out or intake (no realised history), never a zero', async () => {
    freshState({ cleared: true });
  enterBasics();
    await getDocumentStore().ready;
    setTimelineSource(async (date) => (date === Y ? timeline(date) : null));
    const days = (await read(START, TODAY))!;
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 8 }, (_, i) => addDays(START, i)));
    // the walk's moving minutes earn points from the ring's minutes alone; a day without a timeline is unknown
    expect(days.find((d) => d.date === Y)!.heartPoints).toBeGreaterThan(0);
    expect(days.find((d) => d.date === Y2)!.heartPoints).toBeNull();
    for (const d of days) {
      expect(d.energyOut).toBeNull();
      expect(d.intakeKcal).toBeNull();
      expect(d.sessionStimuli).toEqual([]);
    }
  });
});

// 0.6.3 FX1 (aR11): the loaded windows were keyed by dates only and heard no Gauge notification, so a loaded day kept its
// Heart Points after unpairing (probe: 5 points before and after, no new source read).
describe('aR11: the loaded windows follow the Gauge identity and its data', () => {
  const client = (who: string | null) => {
    const ls = new Set<() => void>();
    let p = who;
    return {
      pairing: () => (p ? { baseUrl: 'https://home.example', person: { id: p } } : null) as never,
      subscribe: (l: () => void) => {
        ls.add(l);
        return () => void ls.delete(l);
      },
      set(next: string | null) {
        p = next;
        for (const l of [...ls]) l();
      },
    };
  };
  afterEach(() => setGaugeIdentityClientForTests(null));

  it('unpairing drops the loaded days: the ring minutes from before never count again', async () => {
    const c = client('p1');
    setGaugeIdentityClientForTests(c);
    expect((await read(Y, Y))![0]!.heartPoints).toBeCloseTo(90, 5);
    // unpaired: the server answers nothing any more
    setTimelineSource(async () => null);
    await act(async () => c.set(null));
    const after = (await read(Y, Y))!;
    // the reproduction: still 90 (the ring's minutes from before); now only the approved walk itself counts (45 min, 1 a
    // minute, no minutes read)
    expect(after[0]!.heartPoints).toBeCloseTo(45, 5);
  });

  it('new Gauge data re-reads the window (the documents unchanged, the engine run kept)', async () => {
    expect((await read(Y, Y))![0]!.heartPoints).toBeCloseTo(90, 5);
    const before = runs.length;
    setTimelineSource(async () => null);
    await act(async () => notifyGaugeDataChanged());
    expect((await read(Y, Y))![0]!.heartPoints).toBeCloseTo(45, 5);
    // only the Gauge side moved: the history base (and its engine run) is reused
    expect(runs.length).toBe(before);
  });
});
