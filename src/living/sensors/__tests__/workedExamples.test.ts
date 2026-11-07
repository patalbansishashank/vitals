// @vitest-environment node
/**
 * Worked examples with realistic values (energy SPEC §V2 tests, §1.3 worked check). One person throughout: male, 35 y,
 * 80 kg, RMR 1800 kcal/d, no waking RHR entered (zones on %HRmax, D6), D2 on. Numbers are derived by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '@/engine/core/loop';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { MAN, PROGRAM_B } from '@/engine/core/__tests__/fixtures';
import type { DayTemplate, Schedule } from '@/engine/types/schedule';
import { boutCost } from '@/engine/core/exerciseCost';
import { activityEnergy } from '../activityEnergy';
import { energyDay, hoursFromRun, type EnergyMinute } from '../energyDay';
import { heartPoints, type PointsMinute } from '../heartPoints';
import { freezeZoneBoundaries, hrProfile } from '../hrProfile';
import { zoneTime, zoneTimeTotalS } from '../hrZones';
import { banisterTrimp } from '../trainingLoad';
import type { HrSegment } from '../types';

const T0 = Date.UTC(2026, 9, 20, 6, 0, 0);
const MIN = 60_000;
const PERSON = { massKg: 80, ageY: 35, sex: 'male' as const, rmrKcalPerDay: 1800 };
/** 10-s supported samples (Gauge workout cadence 10 s) at a constant bpm. */
const hr10s = (start: number, minutes: number, bpm: number): HrSegment[] => Array.from({ length: minutes * 6 }, (_, k) => ({ start: start + k * 10_000, end: start + (k + 1) * 10_000, bpm }));

describe('§1.3 worked check', () => {
  it('80 kg, 60 min, 5.0 MET, RMR 1800 → G 420, R 75, A 345, D 15, I 330', () => {
    const e = activityEnergy({ exerciseId: 'other_moderate', durationMin: 60, ...PERSON, intensity: { class: 'moderate' } });
    // other_moderate books 4.5 MET; the ledger check itself uses the shared resolver at 5.0 MET
    expect(e.booked.estimator).toBe('met');
    const c = boutCost({ grossKcal: (5 * 3.5 * 5 * 80 * 60) / 1000, durationMin: 60, rmrKcalPerDay: 1800, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
    expect([c.grossKcal, c.ownRestKcal, c.netAboveRestKcal, c.displacedLifestyleKcal, c.incrementalKcal]).toEqual([420, 75, 345, 15, 330]);
  });
});

describe('worked example 1: treadmill incline walk with HR (speed/grade books, Keytel is a comparison)', () => {
  // 30 min, belt 6.0 km/h (100 m/min), 5 % grade, HR 120 bpm throughout.
  // ACSM walk: VO2 = 3.5 + 0.1·100 + 1.8·100·0.05 = 22.5 mL/kg/min → G = 22.5·80·30·5/1000 = 270 kcal (±25 %: 202.5-337.5).
  // R = 1800·30/1440 = 37.5; A = 232.5; D = 0.2·37.5 = 7.5; I = 225.
  // Keytel (male): −55.0969 + 0.6309·120 + 0.1988·80 + 0.2017·35 = 43.5746 kJ/min = 10.4146 kcal/min → 312.4 kcal.
  const e = activityEnergy({
    exerciseId: 'treadmill_incline_walk',
    durationMin: 30,
    ...PERSON,
    speed: { kmh: 6, gradeFrac: 0.05, source: 'belt' },
    hr: { segments: hr10s(T0, 30, 120), window: { start: T0, end: T0 + 30 * MIN } },
  });
  it('books ACSM walking at 270 kcal with the ledger terms', () => {
    expect(e.booked.estimator).toBe('speedGrade');
    expect(e.booked.version).toBe('acsm-walk/1');
    expect(e.booked.grossKcal).toBeCloseTo(270, 6);
    expect(e.booked.envelope.lo).toBeCloseTo(202.5, 6);
    expect(e.booked.envelope.hi).toBeCloseTo(337.5, 6);
    expect(e.cost.ownRestKcal).toBeCloseTo(37.5, 6);
    expect(e.cost.netAboveRestKcal).toBeCloseTo(232.5, 6);
    expect(e.cost.displacedLifestyleKcal).toBeCloseTo(7.5, 6);
    expect(e.cost.incrementalKcal).toBeCloseTo(225, 6);
    expect(e.cost.source).toBe('estimated');
  });
  it('keeps Keytel as a comparison (never averaged) and carries the engine dose', () => {
    const k = e.comparisons.find((c) => c.estimator === 'keytel')!;
    expect(k.grossKcal).toBeCloseTo(312.44, 1);
    expect(k.bookable).toBe(true);
    expect(e.engineDose!.realisedGrossKcal).toBe(e.booked.grossKcal);
    expect(e.engineDose!.met).toBeCloseTo(270 / (1.05 * 80 * 0.5), 9);
    expect(e.hrSummary).toEqual({ avgBpm: 120, maxBpm: 120, supportedS: 1800, method: 'hr-support/1' });
  });
});

describe('worked example 2: zone-4 outdoor run', () => {
  // 40 min at GPS moving speed 10 km/h (166.7 m/min), grade unknown (level assumed: ±35 %), 5 min at 140 bpm then 35 min at 160.
  // ACSM run: VO2 = 3.5 + 0.2·166.667 = 36.833 → G = 36.833·80·40·5/1000 = 589.3 kcal.
  // Tanaka HRmax = 208 − 0.7·35 = 183.5; %max edges Z3 128.45, Z4 146.8, Z5 165.15 → 140 is Z3, 160 is Z4.
  // Fit: HRmax_fit = 205.8 − 0.685·35 = 181.825; 140 = 77 %, 160 = 88 % → 2 points/min → 80 points.
  const window = { start: T0, end: T0 + 40 * MIN };
  const segs = [...hr10s(T0, 5, 140), ...hr10s(T0 + 5 * MIN, 35, 160)];
  const prof = hrProfile({ ageY: 35 });
  const zb = freezeZoneBoundaries(prof)!;
  it('energy: ACSM run, level declared', () => {
    const e = activityEnergy({ exerciseId: 'jog_outdoor', durationMin: 40, ...PERSON, speed: { kmh: 10, source: 'gps' }, hr: { segments: segs, window } });
    expect(e.booked.estimator).toBe('speedGrade');
    expect(e.booked.version).toBe('acsm-run/1');
    expect(e.booked.grossKcal).toBeCloseTo(589.33, 1);
    expect(e.booked.domainFlags).toEqual(['gradeAssumedLevel', 'gpsMovingSpeed']);
    expect(e.booked.envelope.hi / e.booked.grossKcal).toBeCloseTo(1.35, 9);
  });
  it('zones: 5 min Z3 + 35 min Z4, reconciling to elapsed', () => {
    expect(prof.basis).toBe('pctMax');
    expect(zb.hrMax).toBeCloseTo(183.5, 9);
    const z = zoneTime({ window, segments: segs, boundaries: zb });
    expect(z.zonesS).toEqual([0, 0, 300, 2100, 0]);
    expect(z.unknownS).toBe(0);
    expect(zoneTimeTotalS(z)).toBe(z.elapsedS);
    expect(z.observedPeakBpm).toBe(160);
    expect(z.meanBpm).toBeCloseTo((5 * 140 + 35 * 160) / 40, 9);
  });
  it('Heart Points: 80 for 40 vigorous minutes', () => {
    const minutes: PointsMinute[] = Array.from({ length: 40 }, (_, k) => ({ start: T0 + k * MIN, asleep: false, activity: { met: 9.6, gait: 'run' }, cadence: 165, hr: { bpm: k < 5 ? 140 : 160, supportedS: 60 } }));
    const hp = heartPoints({ ageY: 35, minutes });
    expect(hp.hrMaxFit).toBeCloseTo(181.825, 9);
    expect(hp.points).toBeCloseTo(80, 9);
    expect(hp.byChannel).toEqual({ hr: 80, cadence: 0, met: 0 });
  });
  it('training load: Banister TRIMP once a waking RHR of 60 is entered', () => {
    // f(160) = 100/123.5 = 0.8097, 0.64·e^(1.92f)·f = 2.4530/min → 85.86; f(140) = 0.6478 → 1.4381/min → 7.19; Σ ≈ 93.05
    const t = banisterTrimp(segs, 183.5, 60, 'male');
    const ff = (b: number) => (b - 60) / 123.5;
    const per = (b: number) => ff(b) * 0.64 * Math.exp(1.92 * ff(b));
    expect(t).toBeCloseTo(5 * per(140) + 35 * per(160), 9);
    expect(t).toBeCloseTo(93.05, 1);
  });
});

describe('worked example 3: air-bike session (HR-based, flagged out of domain; display watts ignored)', () => {
  // 20 min, HR 150 bpm throughout, console 180 W.
  // Keytel (male): −55.0969 + 0.6309·150 + 0.1988·80 + 0.2017·35 = 62.5016 kJ/min = 14.938 kcal/min → 298.8 kcal, ±50 %.
  // MET comparison: analog 8.0 MET → 8.0·3.5·5·80·20/1000 = 224 kcal, ±50 %.
  const e = activityEnergy({
    exerciseId: 'air_bike',
    durationMin: 20,
    ...PERSON,
    power: { avgW: 180, verified: false },
    hr: { segments: hr10s(T0, 20, 150), window: { start: T0, end: T0 + 20 * MIN } },
    vendor: [{ source: 'gauge', kcal: 260, method: 'gauge-hr' }],
  });
  it('books Keytel out of domain at ±50 %', () => {
    expect(e.booked.estimator).toBe('keytel');
    expect(e.booked.method).toBe('hr');
    expect(e.booked.grossKcal).toBeCloseTo(298.76, 1);
    expect(e.booked.domainFlags).toContain('outOfDomain');
    expect(e.booked.envelope.lo).toBeCloseTo(e.booked.grossKcal * 0.5, 9);
    expect(e.booked.envelope.hi).toBeCloseTo(e.booked.grossKcal * 1.5, 9);
  });
  it('MET and vendor kcal are comparisons; console watts are never metabolic work', () => {
    const met = e.comparisons.find((c) => c.estimator === 'met')!;
    expect(met.grossKcal).toBeCloseTo(224, 6);
    expect(met.domainFlags).toContain('analogMet');
    expect(e.rejected).toContainEqual({ estimator: 'power', reason: 'displayWattsNotMetabolicWork' });
    expect(e.vendor).toEqual([{ source: 'gauge', kcal: 260, method: 'gauge-hr', label: 'comparison, never booked' }]);
    expect(e.cost.grossKcal).toBe(e.booked.grossKcal);
  });
});

describe('worked example 4: a rest day breakdown sums to the engine TDEE', () => {
  // The engine fixture person (MAN: male, 35 y, 178 cm, 82 kg), 6000-step rest day, day 2 of the run. At this commit:
  // total 2485 kcal = sleep 587 + resting 1383 + light 229 + active 150 + unknown 136 (states), or
  // RMR 1773 + active 482 (D15: neat 518 + signed steps −36) + TEF 232 + other −1 (components).
  const p = resolveProfile(MAN);
  const rest: DayTemplate = {
    id: 'R',
    label: 'rest day',
    energy: { kind: 'pctMaintenance', pct: 100 },
    macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'remainder' }, fat: { unit: 'gPerKgBw', value: 0.9 } },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    exercise: [],
    steps: 6000,
  };
  const sched: Schedule = { schemaVersion: 1, startDate: '2026-10-19', horizonDays: 3, programs: [rest, PROGRAM_B], days: [{ program: 0 }, { program: 0 }, { program: 0 }] };
  const r = simulate(p, sched, { record: 'full' });
  const dayStart = Date.UTC(2026, 9, 20, 0, 0, 0) - 330 * MIN; // local midnight in +05:30
  const hours = hoursFromRun(r.hourly as never, 24, 24, dayStart);
  // timeline: asleep 23:00-07:00 (with 10 unknown-label minutes at 03:00), steps 06:00 per waking minute pattern
  const minutes: EnergyMinute[] = Array.from({ length: 1440 }, (_, k) => {
    const h = Math.floor(k / 60);
    if (h >= 23 || h < 7) return { sleep: k >= 180 && k < 190 ? 'unknownLabel' : 'asleep', steps: 0, support: 'minute' };
    if (h >= 13 && h < 14) return { sleep: 'none', steps: null, support: null }; // ring off: unknown
    const walking = k % 30 < 3; // a short stroll every half hour
    return { sleep: 'none', steps: walking ? 110 : k % 7 === 0 ? 12 : 0, support: 'minute' };
  });
  const d = energyDay({ hours, minutes, bouts: [], ringKcal: 2410 });
  const tdee = hours.reduce((a, h) => a + h.tdee, 0);
  it('total = Σ engine tdee; components and states are two views of it; every hour conserves', () => {
    expect(d.total).toBeCloseTo(tdee, 6);
    const comp = Object.values(d.components).reduce((a, x) => a + x, 0);
    const states = Object.values(d.byState).reduce((a, x) => a + x.kcal, 0);
    expect(comp).toBeCloseTo(tdee, 6);
    expect(states).toBeCloseTo(tdee, 6);
    expect(d.maxHourMismatchPct).toBeLessThanOrEqual(0.1);
    expect(d.bins15.length).toBe(96);
    expect(d.bins15.reduce((a, b) => a + b.kcal, 0)).toBeCloseTo(tdee, 6);
  });
  it('no exercise on a rest day; sleep, resting, light, active and unknown minutes as labelled', () => {
    expect(d.byState.exercise.minutes).toBe(0);
    expect(d.byState.sleep.minutes).toBe(8 * 60 - 10);
    expect(d.byState.unknown.minutes).toBe(60 + 10);
    // 16 waking hours minus the unknown hour, 3 stroll minutes per half hour
    expect(d.byState.active.minutes).toBe(15 * 2 * 3);
    expect(d.byState.light.minutes).toBeGreaterThan(0);
    expect(d.byState.resting.minutes).toBeGreaterThan(0);
  });
  it('active (D15) = neat + exercise energy − recovery; rest = Σ rmr; the ring figure is a comparison', () => {
    const neat = hours.reduce((a, h) => a + h.neat, 0);
    const ex = hours.reduce((a, h) => a + h.exerciseEnergy, 0);
    expect(d.active).toBeCloseTo(neat + ex - d.recovery, 6);
    expect(d.rest).toBeCloseTo(hours.reduce((a, h) => a + h.rmr, 0), 6);
    expect(d.ringComparison).toEqual({ label: 'Ring energy estimate', kcal: 2410, booked: false });
    expect(d.total).not.toBe(2410);
  });
});

describe('worked example 5: Heart Points on a mixed day', () => {
  // 07:00 30-min brisk walk (not an approved activity): cadence 112, HR 118 supported → HR channel (cadence ≥ 60): 118/181.8 = 65 % → 1/min = 30.
  // 07:30 10-min run segment, cadence 150 with run gait, no HR → cadence channel 2/min = 20.
  // 10:00 2 h desk work, HR 96, cadence 0 → no points (still minutes are never HR-eligible).
  // 18:00 approved strength session 45 min, MET 3.5, no HR → MET channel 1/min = 45.
  // 19:00 approved air bike 20 min, HR 150 → 82.5 % → 2/min = 40.
  // 23:00-07:00 asleep with HR up to 115 (a bad dream) → no points.
  // Total 135 = 75 moderate + 2·30 vigorous minutes.
  const at = (h: number, m = 0) => T0 - 6 * 3_600_000 + (h * 60 + m) * MIN;
  const mins: PointsMinute[] = [];
  for (let k = 0; k < 30; k++) mins.push({ start: at(7, k), asleep: false, cadence: 112, gait: 'walk', hr: { bpm: 118, supportedS: 60 } });
  for (let k = 0; k < 10; k++) mins.push({ start: at(7, 30 + k), asleep: false, cadence: 150, gait: 'run', hr: null });
  for (let k = 0; k < 120; k++) mins.push({ start: at(10, k), asleep: false, cadence: 0, hr: { bpm: 96, supportedS: 60 } });
  for (let k = 0; k < 45; k++) mins.push({ start: at(18, k), asleep: false, activity: { met: 3.5 }, cadence: null, hr: null });
  for (let k = 0; k < 20; k++) mins.push({ start: at(19, k), asleep: false, activity: { met: 8.0 }, cadence: 0, hr: { bpm: 150, supportedS: 60 } });
  for (let k = 0; k < 480; k++) mins.push({ start: at(23, k), asleep: true, cadence: 0, hr: { bpm: k === 200 ? 115 : 58, supportedS: 60 } });
  const hp = heartPoints({ ageY: 35, minutes: mins, externalPoints: 120 });
  it('135 points from one channel per interval; sleep and still minutes earn none; Fit points never stack', () => {
    expect(hp.points).toBeCloseTo(135, 9);
    expect(hp.moderateMin).toBeCloseTo(75, 9);
    expect(hp.vigorousMin).toBeCloseTo(30, 9);
    expect(hp.byChannel).toEqual({ hr: 70, cadence: 20, met: 45 });
    expect(hp.external).toBe(120);
    expect(hp.label).toBe('Heart Points (Fit-compatible estimate)');
    // desk minutes (HR 96 while still) and every sleep minute earn nothing
    expect(hp.minutes.slice(40, 160).every((m) => m.points === 0 && m.channels.length === 0)).toBe(true);
    expect(hp.minutes.slice(225).every((m) => m.points === 0 && m.channels.length === 0)).toBe(true);
  });
});
