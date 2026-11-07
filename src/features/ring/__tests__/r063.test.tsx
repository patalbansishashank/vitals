/**
 * 0.6.3 RING: canonical activities and day zones (S25/A14), score contributors and Vitals history (S22/A17), training load,
 * energy monitor entries and the plan's active-energy goal (S21/S23/A18), caches scoped to the paired person (A30/S28),
 * cross-midnight workouts (S32/A32), the Day-score target 0 (S33/A36), half-open zone ranges (A37), quiet battery.
 */
import './clock';
import { act, renderHook, waitFor } from '@testing-library/react';
import { dayZones, freezeZoneBoundaries, hrProfile, type HrSegment } from '@/living/sensors';
import { HEART_COPY } from '@/features/settings/heart/copy';
import { setGaugeIdentityClientForTests, notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import type { GaugeProblem } from '@/net/gauge';
import { dayZoneBouts, datesOverlapping, ringActivities, wallIso } from '../activities';
import { plannedSessionsOf, pointsPaceOf } from '../day';
import { goalsFrom, validDayScoreTarget } from '../goals';
import { vitalsIndexHistory } from '../history';
import { ringScores } from '../indices';
import { loadBoutsOf, ringLoad } from '../load';
import { availableSources, offeredEntries } from '../monitor/catalogue';
import { entryValue, type MonitorCtx } from '../monitor/values';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, mainSession, shiftDate } from '../model';
import { ringPaths } from '../paths';
import { setGaugeApi } from '../api';
import { clearGaugeCache, useGauge } from '../useGauge';
import { parseTarget } from '../views/DayScoreCard';
import { batteryWord } from '../views/RingStatusCard';
import { unwrappedHours } from '../views/WorkoutView';
import { frozenBoundariesFor, zoneRange } from '../zones';
import { candidate, sessionEntry } from './activityFixtures';
import type { GaugeTimeline, RingApi } from '../types';

const today = calendarDate(Date.now());
const T0 = Date.parse(`${today}T07:00:00Z`);
const MIN = 60_000;
const b = freezeZoneBoundaries(hrProfile({ ageY: 40 }))!;

describe('canonical activities (S25/A14)', () => {
  const sessions = [
    sessionEntry({ id: 'e1', date: today, startH: 7, durationMin: 40, key: 'k1', grossKcal: 300, aboveRestKcal: 220 }),
    sessionEntry({ id: 'e-manual', date: today, startH: 18, durationMin: 20, grossKcal: 90 }),
    // a stale entry that still names a rejected candidate never counts
    sessionEntry({ id: 'e-rej', date: today, startH: 5, durationMin: 20, key: 'k-rej', grossKcal: 100 }),
  ];
  const candidates = [
    // edited: the person moved the end from 07:40 to 07:30
    candidate({ key: 'k1', status: 'edited', refs: ['gauge:w1', 'hc:s1'], date: today, start: T0, end: T0 + 40 * MIN, entryId: 'e1', decision: { start: T0, end: T0 + 30 * MIN }, pauses: [{ start: T0 + 10 * MIN, end: T0 + 12 * MIN }] }),
    candidate({ key: 'k-rej', status: 'rejected', refs: ['gauge:w-rej'], date: today, start: T0 - 120 * MIN, end: T0 - 100 * MIN }),
    candidate({ key: 'k-p', status: 'pending', refs: ['gauge:w2'], date: today, start: T0 + 20 * MIN, end: T0 + 50 * MIN, grossKcal: 150 }),
  ];
  const r = ringActivities({ sessions, candidates, from: today, to: today, tz: 'UTC' });

  it('lists approved activities with the decided (edited) window, the Gauge evidence and every source', () => {
    expect(r.approved.map((a) => a.id).sort()).toEqual(['e-manual', 'e1']);
    const a = r.approved.find((x) => x.id === 'e1')!;
    expect(a.window).toEqual({ start: T0, end: T0 + 30 * MIN });
    expect(a.pauses).toEqual([{ start: T0 + 10 * MIN, end: T0 + 12 * MIN }]);
    expect(a.gaugeIds).toEqual(['w1']);
    expect(a.sources).toEqual(['ring', 'healthConnect']);
    expect(a.grossKcal).toBe(300);
    expect(a.aboveRestKcal).toBe(220);
    expect(r.approved.find((x) => x.id === 'e-manual')!.sources).toEqual(['logged']);
  });

  it('keeps pending ones apart and never lists a rejected one', () => {
    expect(r.pending.map((a) => a.id)).toEqual(['k-p']);
    expect(r.pending[0]!.grossKcal).toBe(150);
    expect([...r.approved, ...r.pending].some((a) => a.gaugeIds.includes('w-rej'))).toBe(false);
  });

  it('day zones: approved only, overlap counted once, pending as a separate to-review figure', () => {
    // 07:00-07:30 approved at 150 bpm; the pending 07:20-07:50 overlaps 10 minutes
    const seg: HrSegment[] = Array.from({ length: 60 }, (_, k) => ({ start: T0 + k * MIN, end: T0 + (k + 1) * MIN, bpm: 150 }));
    // a second approved activity over the same 07:00-07:30 must not double the minutes
    const twin = { ...r.approved.find((x) => x.id === 'e1')!, id: 'z-twin', pauses: [] };
    const bouts = dayZoneBouts([...r.approved, twin, ...r.pending], () => seg, () => b);
    const dz = dayZones({ day: { start: Date.parse(`${today}T00:00:00Z`), end: Date.parse(`${today}T00:00:00Z`) + 86_400_000 }, bouts, provisionalOverlay: true });
    const total = dz.zonesMin.reduce((x, y) => x + y, 0);
    // 30 min window less the 2 min pause; the twin adds only the 2 minutes it moved during e1's pause (r063 FX2 sR07:
    // overlap is resolved against moving time only), never the 28 shared minutes
    expect(total).toBeCloseTo(30, 5);
    expect(dz.toReview!.zonesMin.reduce((x, y) => x + y, 0)).toBeCloseTo(20, 5);
  });

  // (r063 INT, ACT-B S10/A15 handoff) the day zones count a paused bout's moving intervals only, from the entry's `moving`
  it('day zones use the moving intervals of a paused bout, even after its candidate was compacted', () => {
    const iso = (t: number) => new Date(t).toISOString();
    // 07:00-07:40 with a pause 07:15-07:25: moving 07:00-07:15 and 07:25-07:40 (30 min)
    const paused = { ...sessionEntry({ id: 'e-p', date: today, startH: 7, durationMin: 30, key: 'k-p2', grossKcal: 200 }), moving: [{ start: iso(T0), end: iso(T0 + 15 * MIN) }, { start: iso(T0 + 25 * MIN), end: iso(T0 + 40 * MIN) }] };
    const tomb = candidate({ key: 'k-p2', status: 'approved', refs: ['gauge:w9'], date: today, start: T0, end: T0 + MIN, entryId: 'e-p', compact: true });
    const live = ringActivities({ sessions: [paused], candidates: [tomb], from: today, to: today, tz: 'UTC' });
    const a = live.approved[0]!;
    expect(a.window).toEqual({ start: T0, end: T0 + 40 * MIN });
    expect(a.pauses).toEqual([{ start: T0 + 15 * MIN, end: T0 + 25 * MIN }]);
    const seg: HrSegment[] = Array.from({ length: 60 }, (_, k) => ({ start: T0 + k * MIN, end: T0 + (k + 1) * MIN, bpm: 150 }));
    const dz = dayZones({ day: { start: Date.parse(`${today}T00:00:00Z`), end: Date.parse(`${today}T00:00:00Z`) + 86_400_000 }, bouts: dayZoneBouts(live.approved, () => seg, () => b), provisionalOverlay: true });
    expect(dz.zonesMin.reduce((x, y) => x + y, 0)).toBeCloseTo(30, 5);
    // the entry's moving intervals win over the (full) candidate's own pauses
    const full = candidate({ key: 'k-p2', status: 'approved', refs: ['gauge:w9'], date: today, start: T0, end: T0 + 40 * MIN, entryId: 'e-p', pauses: [{ start: T0 + 30 * MIN, end: T0 + 31 * MIN }] });
    expect(ringActivities({ sessions: [paused], candidates: [full], from: today, to: today, tz: 'UTC' }).approved[0]!.pauses).toEqual([{ start: T0 + 15 * MIN, end: T0 + 25 * MIN }]);
  });

  it('frozen boundaries resolve through a compact tombstone after compaction', () => {
    const tomb = candidate({ key: 'k1', status: 'approved', refs: ['gauge:w1'], date: today, start: T0, end: T0 + MIN, entryId: 'e1', compact: true });
    expect(frozenBoundariesFor('w1', [tomb as never], (id) => (id === 'e1' ? b : null))).toEqual(b);
  });
});

describe('cross-midnight workouts (S32/A32)', () => {
  it('fetches every calendar date the workout touches', () => {
    const s = Date.parse('2026-10-27T23:50:00Z');
    expect(datesOverlapping({ start: s, end: s + 20 * MIN }, 'UTC')).toEqual(['2026-10-27', '2026-10-28']);
    expect(datesOverlapping({ start: s - 60 * MIN, end: s }, 'UTC')).toEqual(['2026-10-27']);
  });
  it('plots unwrapped clock hours: 00:10 after 23:50 is 24.17, never 0.17', () => {
    const s = Date.parse('2026-10-27T23:50:00Z');
    expect(unwrappedHours('2026-10-27T23:50:00', s, '2026-10-28T00:10:00Z')).toBeCloseTo(24 + 10 / 60, 5);
    expect(wallIso(s, 'UTC')).toBe('2026-10-27T23:50:00');
  });
  it('a workout link carries the approved activity', () => {
    expect(ringPaths.workout('w 1', '2026-10-27', 'e1')).toBe('/ring/workouts/w%201?date=2026-10-27&activity=e1');
    expect(ringPaths.workout('w1')).toBe('/ring/workouts/w1');
  });
});

describe('Day-score target and zone ranges (S33/A36, A37)', () => {
  it('0 is a valid target in the editor and in the goal (one inclusive 0–100 rule)', () => {
    expect(parseTarget('0')).toBe(0);
    expect(parseTarget('101')).toBeNull();
    expect(goalsFrom({ dayScoreTarget: 0 }).dayScore).toBe(0);
    expect(goalsFrom({ dayScoreTarget: 100 }).dayScore).toBe(100);
    expect(goalsFrom({ dayScoreTarget: 140 }).dayScore).toBe(70);
    expect(validDayScoreTarget(-1)).toBe(false);
  });
  it('zone labels are half-open, the top zone ends at the maximum, as in Settings', () => {
    const e = b.edgesBpm;
    expect(zoneRange(b, 0)).toBe(`${Math.round(e[0])} to under ${Math.round(e[1])} bpm`);
    expect(zoneRange(b, 4)).toBe(`${Math.round(e[4])}–${Math.round(e[5])} bpm`);
    expect(HEART_COPY.bpmRange(108, 126)).toBe('108 to under 126 bpm');
  });
});

describe('plan active energy reaches the goals (S23/A18)', () => {
  it('the plan’s active energy wins over the setting', () => {
    expect(goalsFrom({ planActiveKcal: 640, activeEnergyGoalKcal: 450 }).activeKcal).toEqual({ value: 640, source: 'plan' });
    expect(goalsFrom({ planActiveKcal: null, activeEnergyGoalKcal: 450 }).activeKcal).toEqual({ value: 450, source: 'setting' });
  });
});

describe('score contributors (S22/A17)', () => {
  const api = makeGaugeFixture();
  it('Heart Points pace, planned sessions and the prior-day load join the indices; unknown stays unavailable', async () => {
    const sl = (await api.sleep(shiftDate(today, -1), today))!;
    const base = (await api.baselines!(today))!;
    const night = mainSession(sl.sessions, today);
    const none = ringScores({ night, baselines: base, steps: 6000, stepGoal: 10_000, sleepGoalMin: 480 });
    const parts = (s: typeof none) => Object.fromEntries(s.activity.contributors.map((c) => [c.id, c.score]));
    expect(parts(none)).toMatchObject({ points: null, sessions: null });
    const all = ringScores({ night, baselines: base, steps: 6000, stepGoal: 10_000, sleepGoalMin: 480, weekPointsPace: 150, plannedSessions: { planned: 2, done: 1 }, loadBalance: 80 });
    expect(parts(all)).toMatchObject({ points: 100, sessions: 50 });
    expect(all.recovery.contributors.find((c) => c.id === 'load')!.score).toBe(80);
    expect(none.recovery.contributors.find((c) => c.id === 'load')!.score).toBeNull();
  });
  it('planned sessions: done 1, partial its credit; no session → unavailable', () => {
    const rx = { sessions: [{ kind: 'cardio' as const, slotKey: 'a' }, { kind: 'resistance' as const, slotKey: 'b' }, { kind: 'cardio' as const, slotKey: 'c' }] };
    expect(plannedSessionsOf(rx, [{ itemId: 'cardioSession:a', status: 'done' }, { itemId: 'rtSession:b', status: 'partial', credit: 0.4 }, { itemId: 'cardioSession:c', status: 'skipped' }])).toEqual({ planned: 3, done: 1.4 });
    expect(plannedSessionsOf({ sessions: [] }, [])).toBeNull();
    expect(plannedSessionsOf(null, null)).toBeNull();
  });
  it('weekly points pace scales the week so far to 7 days', () => {
    expect(pointsPaceOf(null, today)).toBeNull();
    const monday = '2026-10-26';
    expect(pointsPaceOf(60, monday)).toBeCloseTo(420, 5);
    expect(pointsPaceOf(60, '2026-11-01')).toBeCloseTo(60, 5);
  });
  it('the Vitals history is worked out per day with its versions, legacy days are gaps', async () => {
    const from = shiftDate(today, -3);
    const dates = [from, shiftDate(from, 1), shiftDate(from, 2), today];
    const sl = (await api.sleep(from, today))!;
    const bases = await Promise.all(dates.map((d) => api.baselines!(d)));
    const h = vitalsIndexHistory({ dates, sleep: sl.sessions, baselines: bases, steps: new Map(dates.map((d) => [d, 8000])), stepGoal: 10_000, sleepGoalMin: 480 });
    expect(h.dates).toEqual(dates);
    expect(h.sleep.some((v) => Number.isFinite(v))).toBe(true);
    expect(h.versions.sleep.every((v) => v.startsWith('sleep-index/'))).toBe(true);
    const gap = vitalsIndexHistory({ dates, sleep: [], baselines: dates.map(() => null), steps: new Map(), stepGoal: 10_000, sleepGoalMin: 480 });
    expect(gap.day.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('training load (S21/A18)', () => {
  const tl = (date: string, bpm: number | null): GaugeTimeline =>
    ({ date, start: `${date}T00:00:00Z`, minutes: 1440, hr: { bpm: Array.from({ length: 1440 }, () => bpm), supportedS: Array.from({ length: 1440 }, () => (bpm === null ? null : 60)) }, steps: { selected: [], support: [] }, sleep: { stage: [] } }) as unknown as GaugeTimeline;
  const acts = ringActivities({
    sessions: [sessionEntry({ id: 'e1', date: today, startH: 7, durationMin: 30, key: 'k1' }), sessionEntry({ id: 'e2', date: shiftDate(today, -1), startH: 7, durationMin: 20, rpe: 6 })],
    candidates: [candidate({ key: 'k1', status: 'approved', refs: ['gauge:w1'], date: today, start: T0, end: T0 + 30 * MIN, entryId: 'e1' })],
    from: shiftDate(today, -29),
    to: today,
    tz: 'UTC',
  }).approved;
  const timelines = new Map([[today, tl(today, 150)]]);
  it('approved activities become load bouts with their supported HR and a CR10 rating', () => {
    const bouts = loadBoutsOf(acts, timelines, 'UTC');
    const run = bouts.find((x) => x.id === 'e1')!;
    expect(run.segments!.length).toBeGreaterThan(0);
    expect(bouts.find((x) => x.id === 'e2')).toMatchObject({ rpe: 6, rpeScale: 'cr10' });
  });
  it('TRIMP with a waking rest and a known sex; without the rest it says what it waits on', () => {
    const ok = ringLoad({ date: today, acts, timelines, tz: 'UTC', profile: { hrMax: 180, wakingHrRest: 55, sex: 'male' }, watched: new Set([today]) });
    expect(ok.load.byMethod.trimp!.dayLoad).toBeGreaterThan(0);
    expect(ok.load.byMethod.sessionRpe!.bouts).toBe(1);
    expect(ok.missing).toBeNull();
    const no = ringLoad({ date: today, acts: acts.filter((a) => a.id === 'e1'), timelines, tz: 'UTC', profile: { hrMax: 180, wakingHrRest: null, sex: 'male' }, watched: new Set([today]) });
    expect(no.load.status).toBe('unavailable');
    expect(no.missing).toBe('noWakingRest');
    expect(no.balance).toBeNull();
  });
});

describe('monitor: energy and training load entries (S21/S23/A18)', () => {
  const ctx = (o: Partial<MonitorCtx>): MonitorCtx => ({ daily: null, baselines: null, night: null, scores: null, steps: null, zones: null, prefs: { units: 'metric' } as MonitorCtx['prefs'], now: Date.now(), ...o });
  it('offers the energy and load entries only when supplied, never in quiet mode', () => {
    const ids = (s: ReturnType<typeof availableSources>, q = false) => offeredEntries(s, q).map((e) => e.id);
    expect(ids(availableSources({ timeline: true }))).not.toContain('activeEnergy');
    expect(ids(availableSources({ timeline: true, energy: true, load: true }))).toEqual(expect.arrayContaining(['activeEnergy', 'totalEnergy', 'trainingLoad']));
    expect(ids(availableSources({ timeline: true, energy: true, load: true }), true)).not.toContain('activeEnergy');
  });
  it('energy in the person’s unit, labelled gross or above rest', () => {
    const v = entryValue('activeEnergy', ctx({ energy: { totalKcal: 2400, activeKcal: 500, byBedtime: true }, energyUnit: 'kJ' }));
    expect(v.unit).toBe('kJ');
    expect(v.text).toBe('2,090');
    expect(v.chip!.word).toMatch(/Above your resting burn/);
    expect(entryValue('totalEnergy', ctx({ energy: { totalKcal: 2400, activeKcal: null, byBedtime: false } })).chip!.word).toMatch(/^Gross/);
    expect(entryValue('activeEnergy', ctx({})).text).toBeNull();
  });
  it('training load names its method and what it waits on', () => {
    const l = ringLoad({ date: today, acts: [], timelines: new Map(), tz: 'UTC', profile: { hrMax: 180, wakingHrRest: null, sex: null }, watched: new Set() });
    expect(entryValue('trainingLoad', ctx({ load: l })).chip!.word).toMatch(/resting heart rate/);
  });
  it('zone entries count approved activities and name what waits for review', () => {
    expect(entryValue('zone13', ctx({ zones: { z13S: 1200, z45S: 0, toReview: { z13S: 600, z45S: 0, count: 1 } } })).chip!.word).toBe('From counted activities · 10 min not counted yet');
  });
});

describe('quiet battery (0.6.3)', () => {
  it('words, never a percentage', () => {
    expect(batteryWord(15)).toBe('Low');
    expect(batteryWord(64)).toBe('Fine');
  });
});

describe('caches scoped to the paired person (A30/S28)', () => {
  let paired: { baseUrl: string; person: { id: string } } | null = null;
  const listeners = new Set<() => void>();
  const client = { pairing: () => paired as never, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) };
  const pair = (p: typeof paired) => {
    paired = p;
    listeners.forEach((l) => l());
  };
  let problem: GaugeProblem | null = null;
  let answer: unknown = { n: 1 };
  const api = (): RingApi => ({ ...makeGaugeFixture(), status: () => ({ lastOkAt: null, problem }), availability: async () => answer as never });
  beforeEach(() => {
    paired = { baseUrl: 'https://a.example', person: { id: 'p1' } };
    setGaugeIdentityClientForTests(client);
    setGaugeApi(api());
    clearGaugeCache();
    problem = null;
    answer = { n: 1 };
  });
  afterEach(() => {
    setGaugeIdentityClientForTests(null);
    setGaugeApi(null);
  });

  it('another person never reads this one’s answer; unpairing drops it', async () => {
    const { result } = renderHook(() => useGauge('availability', (a) => a.availability()));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ n: 1 });
    answer = { n: 2 };
    act(() => pair({ baseUrl: 'https://a.example', person: { id: 'p2' } }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    answer = null;
    act(() => pair(null));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('offline keeps the last answer and says so; refused drops it', async () => {
    const { result } = renderHook(() => useGauge('availability', (a) => a.availability()));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    answer = null;
    problem = 'offline';
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data).toEqual({ n: 1 });
    problem = 'unauthorized';
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.problem).toBe('unauthorized');
  });

  it('a successful import asks again', async () => {
    const { result } = renderHook(() => useGauge('availability', (a) => a.availability()));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    answer = { n: 3 };
    act(() => notifyGaugeDataChanged());
    await waitFor(() => expect(result.current.data).toEqual({ n: 3 }));
  });
});
