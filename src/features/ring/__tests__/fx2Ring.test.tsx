/**
 * r063 FX2 (final review): Ring zones choose exact vs minute-mean HR per source and minute (sR06/aR06); paused bouts keep
 * their moving intervals through compaction and overlap resolution (sR07/aR08); a "time unknown" log has no clock window
 * (sR16); the score history derives each date's contributors as the headline does (sR17/aR15).
 */
import './clock';
import { dayZones, freezeZoneBoundaries, hrProfile, type HrSegment } from '@/living/sensors';
import type { GaugeHrIntervals } from '@/net/gauge';
import { reviewSheetModel } from '@/living/activityCandidates';
import { reviewRowTimeText, TIME_NOT_GIVEN } from '@/features/living/activity/model';
import { dayZoneBouts, ringActivities } from '../activities';
import { vitalsIndexHistory } from '../history';
import { ringScores } from '../indices';
import { loadBoutsOf } from '../load';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, mainSession, shiftDate } from '../model';
import { activitySegments, exactSegments, workoutZones } from '../zones';
import { candidate, sessionEntry } from './activityFixtures';
import type { GaugeTimeline, GaugeWorkout } from '../types';

const today = calendarDate(Date.now());
const DAY0 = Date.parse(`${today}T00:00:00Z`);
const T0 = Date.parse(`${today}T10:00:00Z`);
const MIN = 60_000;
const b = freezeZoneBoundaries(hrProfile({ ageY: 40 }))!;
const iso = (t: number) => new Date(t).toISOString();

/** A one-day UTC timeline with supported HR `bpm` (60 s a minute) in [from, to) minutes of the day, from `source`. */
function timeline(from: number, to: number, bpm: number, source?: string): GaugeTimeline {
  const n = 1440;
  const on = (k: number) => k >= from && k < to;
  return {
    date: today,
    start: iso(DAY0),
    minutes: n,
    hr: { bpm: Array.from({ length: n }, (_, k) => (on(k) ? bpm : null)), supportedS: Array.from({ length: n }, (_, k) => (on(k) ? 60 : null)), ...(source ? { source: Array.from({ length: n }, (_, k) => (on(k) ? source : null)) } : {}) },
    steps: { selected: [], support: [] },
    sleep: { stage: [] },
  } as unknown as GaugeTimeline;
}
const emptyExact = (from: number, to: number): GaugeHrIntervals => ({ from: iso(from), to: iso(to), intervals: [], count: 0, supportedS: 0, truncated: false }) as unknown as GaugeHrIntervals;

describe('sR06/aR06: an empty Gauge answer never erases supported HR', () => {
  const w = { start: T0, end: T0 + MIN };
  it('a Health Connect minute keeps its minute mean in a workout\'s zones', () => {
    const t = timeline(600, 601, 150, 'hc:com.example');
    const workout = { id: 'w', start: iso(w.start), end: iso(w.end) } as GaugeWorkout;
    const before = workoutZones(workout, [t], b, null)!;
    expect(before.time.coveragePct).toBeCloseTo(100, 6);
    const after = workoutZones(workout, [t], b, exactSegments(emptyExact(w.start, w.end), w))!;
    expect(after.time.coveragePct).toBeCloseTo(100, 6);
    expect(after.time.unknownS).toBe(0);
  });

  it('a Gauge minute the exact answer missed keeps its minute mean too (older server without a source)', () => {
    const t = timeline(600, 601, 150);
    const segs = activitySegments([t], exactSegments(emptyExact(w.start, w.end), w), w);
    expect(segs.reduce((s, g) => s + (g.end - g.start), 0)).toBe(60_000);
  });

  it('the day zones of an HC-only workout count its 600 supported seconds', () => {
    const t = timeline(600, 610, 150, 'hc:com.example');
    const acts = ringActivities({ sessions: [sessionEntry({ id: 'e1', date: today, startH: 10, durationMin: 10 })], candidates: [], from: today, to: today, tz: 'UTC' });
    const exact = emptyExact(DAY0, DAY0 + 86_400_000);
    const bouts = dayZoneBouts(acts.approved, (a) => activitySegments([t], exactSegments(exact, a.window), a.window), () => b);
    const dz = dayZones({ day: { start: DAY0, end: DAY0 + 86_400_000 }, bouts });
    expect(dz.unknownMin).toBe(0);
    expect(dz.zonesMin.reduce((x, y) => x + y, 0) + dz.below50Min).toBeCloseTo(10, 6);
  });

  it('Gauge minutes with exact readings use them (30 s at 110 and 30 s at 170 stay apart)', () => {
    const t = timeline(600, 601, 140);
    const exact = { ...emptyExact(w.start, w.end), intervals: [{ t: T0 + 15_000, bpm: 110, start: T0, end: T0 + 30_000, nextT: null }, { t: T0 + 45_000, bpm: 170, start: T0 + 30_000, end: T0 + MIN, nextT: null }] } as unknown as GaugeHrIntervals;
    const z = workoutZones({ id: 'w', start: iso(w.start), end: iso(w.end) } as GaugeWorkout, [t], b, exactSegments(exact, w))!;
    expect(z.source).toBe('samples');
    expect(z.time.rawMaxBpm).toBe(170);
  });

  it('load bouts read the same resolved minute HR (Health Connect minutes included)', () => {
    const t = timeline(600, 610, 150, 'hc:com.example');
    const acts = ringActivities({ sessions: [sessionEntry({ id: 'e1', date: today, startH: 10, durationMin: 10 })], candidates: [], from: today, to: today, tz: 'UTC' });
    const bouts = loadBoutsOf(acts.approved, new Map([[today, t]]), 'UTC');
    expect(bouts[0]!.segments!.reduce((s, g) => s + (g.end - g.start), 0)).toBe(10 * MIN);
  });
});

describe('sR07/aR08: moving intervals in Ring', () => {
  // 10:00-11:00, moving 10:00-10:10 and 10:50-11:00 (a 40-minute pause); another approved activity 10:15-10:45
  const paused = { ...sessionEntry({ id: 'e-p', date: today, startH: 10, durationMin: 20, key: 'k-p' }), moving: [{ start: iso(T0), end: iso(T0 + 10 * MIN) }, { start: iso(T0 + 50 * MIN), end: iso(T0 + 60 * MIN) }] };
  const other = sessionEntry({ id: 'e-o', date: today, startH: 10.25, durationMin: 30 });
  const seg: HrSegment[] = Array.from({ length: 60 }, (_, k) => ({ start: T0 + k * MIN, end: T0 + (k + 1) * MIN, bpm: 150 }));

  it('an activity during another one\'s pause keeps its zone time (overlap is resolved against moving time only)', () => {
    const acts = ringActivities({ sessions: [paused, other], candidates: [], from: today, to: today, tz: 'UTC' });
    const dz = dayZones({ day: { start: DAY0, end: DAY0 + 86_400_000 }, bouts: dayZoneBouts(acts.approved, () => seg, () => b) });
    // 20 moving minutes of the paused bout + 30 of the other
    expect(dz.zonesMin.reduce((x, y) => x + y, 0)).toBeCloseTo(50, 6);
  });

  it('after compaction the entry\'s moving intervals still place the bout', () => {
    const tomb = candidate({ key: 'k-p', status: 'approved', refs: ['gauge:w1'], date: today, start: T0, end: T0 + MIN, entryId: 'e-p', compact: true });
    const a = ringActivities({ sessions: [paused], candidates: [tomb], from: today, to: today, tz: 'UTC' }).approved[0]!;
    expect(a.window).toEqual({ start: T0, end: T0 + 60 * MIN });
    expect(a.pauses).toEqual([{ start: T0 + 10 * MIN, end: T0 + 50 * MIN }]);
  });

  it('a compacted unpaused bout is placed by its occurrence interval, not its clock hours', () => {
    const e = { ...sessionEntry({ id: 'e-x', date: today, startH: 10, durationMin: 30, key: 'k-x' }), occurrence: { precision: 'interval', interval: { start: iso(T0 + 5 * MIN), end: iso(T0 + 35 * MIN) } } };
    const tomb = candidate({ key: 'k-x', status: 'approved', refs: ['gauge:w2'], date: today, start: T0, end: T0 + MIN, entryId: 'e-x', compact: true });
    expect(ringActivities({ sessions: [e as never], candidates: [tomb], from: today, to: today, tz: 'UTC' }).approved[0]!.window).toEqual({ start: T0 + 5 * MIN, end: T0 + 35 * MIN });
  });
});

describe('sR16: a "time unknown" log has no clock window', () => {
  it('window null (excluded from HR and zones), even with a placeholder candidate window', () => {
    // the manual command keeps a placeholder 18:00-18:30 candidate window; the entry has no clock time
    const e = { ...sessionEntry({ id: 'e-u', date: today, durationMin: 30, key: 'manual:u', manual: true }), occurrence: { precision: 'date', date: today } };
    const c = candidate({ key: 'manual:u', status: 'approved', refs: [], date: today, start: Date.parse(`${today}T18:00:00Z`), end: Date.parse(`${today}T18:30:00Z`), entryId: 'e-u', decision: { start: Date.parse(`${today}T18:00:00Z`), end: Date.parse(`${today}T18:30:00Z`) } });
    const a = ringActivities({ sessions: [e as never], candidates: [c], from: today, to: today, tz: 'UTC' }).approved[0]!;
    expect(a.window).toBeNull();
    expect(a.durationMin).toBe(30);
    expect(dayZoneBouts([a], () => [], () => b)).toEqual([]);
  });

  it('the review row says "time not given" instead of the placeholder 18:00-18:30', () => {
    const c = { ...candidate({ key: 'manual:u', status: 'approved', refs: [], date: today, start: Date.parse(`${today}T18:00:00Z`), end: Date.parse(`${today}T18:30:00Z`), entryId: 'e-u' }), timeUnknown: true, decidedAt: iso(T0) };
    const m = reviewSheetModel([c as never], { from: today, to: today });
    const row = m.decided.find((r) => r.id === 'manual:u')!;
    expect(row.timeUnknown).toBe(true);
    expect(reviewRowTimeText(row, false)).toBe(TIME_NOT_GIVEN);
    expect(reviewRowTimeText(row, true)).toBe(TIME_NOT_GIVEN);
  });
});

describe('sR17/aR15: the score history derives each date\'s contributors like the headline', () => {
  const api = makeGaugeFixture();
  it('the history point of a date equals the headline with the same contributors', async () => {
    const from = shiftDate(today, -1);
    const dates = [from, today];
    const sl = (await api.sleep(from, today))!;
    const bases = await Promise.all(dates.map((d) => api.baselines!(d)));
    const contributors = (d: string) => (d === today ? { weekPointsPace: 150, plannedSessions: { planned: 2, done: 1 }, loadBalance: 80 } : { weekPointsPace: 30, plannedSessions: null, loadBalance: null });
    const h = vitalsIndexHistory({ dates, sleep: sl.sessions, baselines: bases, steps: new Map(dates.map((d) => [d, 6000])), stepGoal: 10_000, sleepGoalMin: 480, contributors });
    const night = mainSession(sl.sessions, today);
    const headline = ringScores({ night, baselines: bases[1] ?? null, steps: 6000, stepGoal: 10_000, sleepGoalMin: 480, ...contributors(today) });
    expect(h.activity.at(-1)).toBeCloseTo(headline.activity.value!, 9);
    expect(h.recovery.at(-1)).toBeCloseTo(headline.recovery.value!, 9);
    expect(h.day.at(-1)).toBeCloseTo(headline.day.value!, 9);
    expect(h.reduced).toBe(false);
    // without contributors the history says it is the reduced calculation
    expect(vitalsIndexHistory({ dates, sleep: sl.sessions, baselines: bases, steps: new Map(), stepGoal: 10_000, sleepGoalMin: 480 }).reduced).toBe(true);
  });
});
