// @vitest-environment node
/** Indices, the Day score, sleep-night joins and training load (energy SPEC §V2.7-V2.8, Addendum A.1.2). */
import { describe, expect, it } from 'vitest';
import type { GaugeBaselines, GaugeSleepMetrics } from '@/net/gauge';
import { PEAK_SCORE, activityIndex, dayFacts, dayIndex, logisticScore, recoveryIndex, sleepIndex } from '../indices';
import { circDiffMin, localClockMin, sleepGoalMin, sleepNight, vsGoal, vsUsual, type NightBaselines, type NightMetrics } from '../sleepNight';
import { banisterTrimp, boutLoad, priorDayTrimpBalance, trainingLoad, type LoadBout } from '../trainingLoad';

// the pure modules restate the S2 shapes they read; the network types must stay assignable to them
type Assignable<T, U extends T> = U;
type _M = Assignable<NightMetrics, GaugeSleepMetrics>;
type _B = Assignable<NightBaselines, GaugeBaselines>;
const _typesCompile: [_M | null, _B | null] = [null, null];

const BASE: NightBaselines = {
  usualMidpoint: { minutes: 180, Rbar: 0.8, n: 20 },
  sleepLowHr: { median: 54, s: 3, n: 14, spanDays: 14 },
  hrvBaseline: { median: Math.log(45), s: 0.15, medianMs: 45, n: 20, spanDays: 27 },
  tempBaseline: { median: 34.1, n: 20, spanDays: 27, deltaT: 0.2 },
  learning: { nights: 20, needed: 7, learning: false },
};
const NIGHT: NightMetrics = {
  tstLowerMin: 430,
  tstUpperMin: 430,
  onset: '2026-10-19T23:20:00+05:30',
  finalWake: '2026-10-20T06:50:00+05:30',
  midpoint: '2026-10-20T03:05:00+05:30',
  nightlyLowHrP10: 56,
  hrvNightlyMs: 40,
  skinTempNightC: 34.3,
  windowContinuityPct: 92,
};

describe('sleepNight (sleep-night/1)', () => {
  it('goal: the plan target clamped 420-720, else 480', () => {
    expect(sleepGoalMin(null)).toBe(480);
    expect(sleepGoalMin({ sleepMin: 390 })).toBe(420);
    expect(sleepGoalMin({ sleepMin: 450 })).toBe(450);
  });
  it('vsGoal on a complete night and on an incomplete one (bounds)', () => {
    expect(vsGoal({ tstLowerMin: 430, tstUpperMin: 430 })).toMatchObject({ word: 'short', shortMin: 50, atLeast: false, text: '50 min short' });
    expect(vsGoal({ tstLowerMin: 515, tstUpperMin: 515 })).toMatchObject({ word: 'met', overMin: 35, text: 'Goal met, 35 min over' });
    expect(vsGoal({ tstLowerMin: 490, tstUpperMin: 490 }).text).toBe('Goal met');
    expect(vsGoal({ tstLowerMin: 400, tstUpperMin: 440 })).toMatchObject({ word: 'short', shortMin: 40, atLeast: true, text: 'At least 40 min short' });
    expect(vsGoal({ tstLowerMin: 450, tstUpperMin: 500 })).toMatchObject({ word: 'unclear', text: 'Goal unclear' });
  });
  it('latency and efficiency need lights-out time (D11); with it they are real', () => {
    const none = sleepNight({ metrics: NIGHT, baselines: BASE });
    expect(none.latencyMin).toBeNull();
    expect(none.latency.reason).toBe('needs lights-out time');
    const e = sleepNight({ metrics: NIGHT, baselines: BASE, entry: { lightsOutAt: '2026-10-19T23:05:00+05:30', outOfBedAt: '2026-10-20T07:05:00+05:30' } });
    expect(e.latencyMin).toBe(15);
    expect(e.efficiencyPct).toBeCloseTo((100 * 430) / 480, 9);
  });
  it('vsPlan: signed, circular across midnight', () => {
    const r = sleepNight({ metrics: NIGHT, baselines: BASE, plan: { bedH: 23, wakeH: 6.5 } });
    expect(r.vsPlan).toEqual({ onsetMin: 20, wakeMin: 20, text: { onset: '20 min later than planned', wake: '20 min later than planned' } });
    expect(circDiffMin(10, 1430)).toBe(20);
    expect(localClockMin('2026-10-20T03:05:00+05:30')).toBe(185);
    expect(localClockMin('2026-10-19T21:35:00Z', 330)).toBe(185);
  });
  it('vsUsual: words from the baselines; absent while learning', () => {
    const u = vsUsual(NIGHT, BASE);
    expect(u.lowHrBpm).toBe(2);
    expect(u.lowHrWord).toBe('Near usual');
    expect(u.hrvMs).toBeCloseTo(-5, 9);
    expect(u.hrvCaution).toBe(true); // −5 < −max(3, 4.5)
    expect(u.midpointMin).toBe(5);
    expect(u.tempC).toBe(0.2);
    expect(u.tempCaution).toBe(false);
    const learning = vsUsual(NIGHT, { ...BASE, learning: { nights: 3, needed: 7, learning: true } });
    expect(learning.learning).toBe(true);
    expect(learning.learningText).toBe('Calibrating · night 3 of 7');
    expect(learning.lowHrBpm).toBeNull();
    expect(learning.hrvMs).toBeNull();
  });
});

describe('indices', () => {
  it('sleep-index/5: weights 0.50/0.25/0.25; duration index when only D; never NaN', () => {
    const s = sleepIndex({ tstLowerMin: 432, windowContinuityPct: 85, midpointMin: 240, usualMidpointMin: 180 });
    // D = 90, C = 100, T = 50 → 0.5·90 + 0.25·100 + 0.25·50 = 82.5
    expect(s.value).toBeCloseTo(82.5, 9);
    expect(s.name).toBe('sleep index');
    const d = sleepIndex({ tstLowerMin: 432, windowContinuityPct: null, midpointMin: null, usualMidpointMin: null });
    expect(d.name).toBe('duration index');
    expect(d.value).toBeCloseTo(90, 9);
    expect(d.contributors[0]!.applied).toBe(1);
    const none = sleepIndex({ tstLowerMin: null, windowContinuityPct: 90, midpointMin: 100, usualMidpointMin: 100 });
    expect(none.value).toBeNull();
    expect(none.status).toBe('unavailable');
  });

  it('recovery-index/6: ln-HRV and inverted low-HR z, renormalised; ≥ 2 parts; temperature is context only', () => {
    const r = recoveryIndex({ hrvNightlyMs: 45, nightlyLowHrP10: 54, baselines: BASE, sleepIndex: 80, loadBalance: 100, tempDeltaC: 0.9 });
    // z = 0 for both → 50, 50; (0.25·50 + 0.15·50 + 0.30·80 + 0.10·100)/0.80 = 67.5
    expect(r.value).toBeCloseTo(67.5, 9);
    expect(r.contributors.find((c) => c.id === 'temperature')!.applied).toBe(0);
    const two = recoveryIndex({ hrvNightlyMs: null, nightlyLowHrP10: null, baselines: BASE, sleepIndex: 80, loadBalance: 100 });
    expect(two.value).toBeCloseTo((0.3 * 80 + 0.1 * 100) / 0.4, 9);
    const one = recoveryIndex({ hrvNightlyMs: null, nightlyLowHrP10: null, baselines: null, sleepIndex: 80, loadBalance: null });
    expect(one.value).toBeNull();
    expect(one.status).toBe('unavailable');
    // high HRV saturates at z = 1; z is clipped at ±3
    const hi = recoveryIndex({ hrvNightlyMs: 200, nightlyLowHrP10: 30, baselines: BASE, sleepIndex: null, loadBalance: null });
    expect(hi.contributors[0]!.score).toBeCloseTo(logisticScore(1), 9);
    expect(hi.contributors[1]!.raw).toBe(-3);
  });

  it('activity-index/4: renormalised over available parts', () => {
    const a = activityIndex({ steps: 8000, stepTarget: 10000, weekPointsPace: 150, plannedSessionsDone: 1, plannedSessions: 2 });
    expect(a.value).toBeCloseTo(100 * (0.4 * 0.8 + 0.35 * 1 + 0.25 * 0.5), 9);
    const noPlan = activityIndex({ steps: 8000, stepTarget: 10000, weekPointsPace: 75, plannedSessionsDone: 0, plannedSessions: 0 });
    expect(noPlan.value).toBeCloseTo((100 * (0.4 * 0.8 + 0.35 * 0.5)) / 0.75, 9);
  });

  it('Day score: 3, 2 and 1 inputs (never NaN); effective sleep share ≈ 46 % with all four recovery parts', () => {
    const rec = recoveryIndex({ hrvNightlyMs: 45, nightlyLowHrP10: 54, baselines: BASE, sleepIndex: 80, loadBalance: 100 });
    const sl = sleepIndex({ tstLowerMin: 432, windowContinuityPct: 85, midpointMin: 240, usualMidpointMin: 180 });
    const ac = activityIndex({ steps: 8000, stepTarget: 10000, weekPointsPace: 150, plannedSessionsDone: 1, plannedSessions: 2 });
    const three = dayIndex({ recovery: rec, sleep: sl, activity: ac });
    expect(three.value).toBeCloseTo((rec.value! + sl.value! + ac.value!) / 3, 9);
    expect(three.basedOn).toBe(3);
    expect(three.effectiveSleepShare).toBeCloseTo(1 / 3 + (1 / 3) * (0.3 / 0.8), 9);
    expect(three.effectiveSleepShare).toBeCloseTo(0.458, 3);
    const two = dayIndex({ recovery: null, sleep: sl, activity: ac });
    expect(two.value).toBeCloseTo((sl.value! + ac.value!) / 2, 9);
    expect(two.effectiveSleepShare).toBeCloseTo(0.5, 9);
    const one = dayIndex({ recovery: null, sleep: sl, activity: null });
    expect(one.value).toBeNull();
    expect(one.reason).toBe('needs 2 of 3');
    expect(Number.isNaN(one.value)).toBe(false);
    const facts = dayFacts({ date: '2026-10-20', day: three, recovery: rec, sleep: sl, activity: ac, yesterday: 60 });
    expect(facts.day.target).toBe(70);
    expect(facts.day.changeSinceYesterday).toBeCloseTo(three.value! - 60, 9);
    expect(PEAK_SCORE.status).toBe('unsupported');
  });
});

describe('training load (train-load/1)', () => {
  const MIN = 60_000;
  const t = Date.UTC(2026, 9, 20, 1, 30);
  const segs = Array.from({ length: 30 }, (_, k) => ({ start: t + k * MIN, end: t + (k + 1) * MIN, bpm: 150 }));
  const male = { hrMax: 185, wakingHrRest: 60, sex: 'male' as const };

  it('TRIMP and session-RPE worked values', () => {
    // f = 90/125 = 0.72; 0.64·e^(1.92·0.72) = 2.5501; ×0.72 = 1.8361/min × 30 = 55.08
    expect(banisterTrimp(segs, 185, 60, 'male')).toBeCloseTo(30 * 0.72 * 0.64 * Math.exp(1.92 * 0.72), 9);
    expect(banisterTrimp(segs, 185, 60, 'male')).toBeCloseTo(55.08, 2);
    // female: 0.86·e^(1.67·0.72) = 2.8621; ×0.72×30 = 61.82
    expect(banisterTrimp(segs, 185, 60, 'female')).toBeCloseTo(30 * 0.72 * 0.86 * Math.exp(1.67 * 0.72), 9);
    expect(boutLoad({ id: 'r', date: '2026-10-20', durationMin: 50, rpe: 7, rpeScale: 'cr10' }, male)).toMatchObject({ method: 'sessionRpe', au: 350 });
  });

  it('TRIMP needs a waking rest and a known sex; never estimated', () => {
    const b: LoadBout = { id: 'x', date: '2026-10-20', durationMin: 30, segments: segs };
    expect(boutLoad(b, { ...male, wakingHrRest: null })).toMatchObject({ status: 'unavailable', reason: 'noWakingRest' });
    expect(boutLoad(b, { ...male, sex: null })).toMatchObject({ status: 'unavailable', reason: 'sexUnknown' });
    // an unscaled RPE does not become session-RPE
    expect(boutLoad({ ...b, rpe: 7, rpeScale: 'rirRpe' }, male).method).toBe('trimp');
  });

  it('mixed methods are named and never summed; ratio words; learning under 21 days', () => {
    const bouts: LoadBout[] = [];
    for (let d = 0; d < 28; d += 2) bouts.push({ id: `t${d}`, date: new Date(Date.UTC(2026, 9, 20 - d)).toISOString().slice(0, 10), durationMin: 30, segments: segs });
    bouts.push({ id: 'rt', date: '2026-10-19', durationMin: 45, rpe: 6, rpeScale: 'cr10' });
    const L = trainingLoad({ date: '2026-10-20', bouts, profile: male });
    expect(L.mixed).toBe(true);
    expect(L.method).toBe('trimp');
    expect(L.byMethod.sessionRpe!.acute).toBe(270);
    const per = banisterTrimp(segs, 185, 60, 'male');
    expect(L.byMethod.trimp!.acute).toBeCloseTo(4 * per, 9);
    expect(L.byMethod.trimp!.chronic).toBeCloseTo((14 * per) / 4, 9);
    expect(L.byMethod.trimp!.ratio).toBeCloseTo(4 / 3.5, 9);
    expect(L.byMethod.trimp!.word).toBe('In range');
    expect(L.learning).toBe(false);
    expect(trainingLoad({ date: '2026-10-20', bouts: bouts.slice(0, 3), profile: male }).learning).toBe(true);
    expect(trainingLoad({ date: '2026-10-20', bouts: [], profile: male }).status).toBe('unavailable');
  });

  it('prior-day balance (recovery part): only an unusually high yesterday lowers it', () => {
    const day = (d: number) => new Date(Date.UTC(2026, 9, 20 - d)).toISOString().slice(0, 10);
    const bouts: LoadBout[] = [];
    for (let d = 2; d <= 20; d++) bouts.push({ id: `b${d}`, date: day(d), durationMin: 30, segments: segs });
    const usual = priorDayTrimpBalance({ date: day(0), bouts: [...bouts, { id: 'y', date: day(1), durationMin: 30, segments: segs }], profile: male })!;
    expect(usual.score).toBeCloseTo(100, 9);
    const big = priorDayTrimpBalance({ date: day(0), bouts: [...bouts, { id: 'y', date: day(1), durationMin: 120, segments: Array.from({ length: 120 }, (_, k) => ({ start: t + k * MIN, end: t + (k + 1) * MIN, bpm: 170 })) }], profile: male })!;
    expect(big.score).toBeLessThan(20);
    expect(priorDayTrimpBalance({ date: day(0), bouts, profile: { ...male, wakingHrRest: null } })).toBeNull();
  });
});

void _typesCompile;
