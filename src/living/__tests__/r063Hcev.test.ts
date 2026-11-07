/**
 * r063 package HCEV (audit gpt-6.1-sol #16, gpt-6-astra F19): Health Connect speed and power per minute reach the
 * estimators. Accepted (measured) speed books walking/running energy by speed; power counts only when verified (the
 * server marks Health Connect power unverified, so it is shown, never booked); without either the estimate is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { estimateFor, hcMotionMinutes, windowMotion, type EstimateRequest, type WindowMinutes } from '../activityCandidates';
import { evidenceWords } from '@/features/living/activity/model';

const FIRST = Date.parse('2026-10-20T12:00:00Z');
const N = 60;
const START = FIRST + 10 * 60_000;
const END = START + 30 * 60_000;
const PERSON = { massKg: 70, ageY: 35, sex: 'male' as const, rmrKcalPerDay: 1600 };
const fill = <T,>(v: T) => Array.from({ length: N }, () => v);
/** Steps and supported HR across the hour: Keytel is eligible without any motion evidence. */
const base = (): WindowMinutes => ({ first: FIRST, steps: fill<number | null>(160), hr: { bpm: fill<number | null>(150), supportedS: fill<number | null>(60) } });
const req = (exerciseId: string, minutes: WindowMinutes | null, extra: Partial<EstimateRequest> = {}): EstimateRequest => ({ exerciseId, window: { start: START, end: END }, person: PERSON, minutes, keytelEnabled: true, ...extra });

describe('the probe: before HCEV the estimators never saw Health Connect speed or power', () => {
  it('a treadmill run with HR books Keytel; its Health Connect speed had no way in', () => {
    const e = estimateFor(req('treadmill_run', base()))!;
    expect(e.booked.estimator).toBe('keytel');
    expect(e).not.toHaveProperty('evidence');
  });
});

describe('Health Connect speed books walking and running energy by speed', () => {
  it('a treadmill run with accepted Health Connect speed is estimated by speed (ACSM run), ahead of Keytel', () => {
    const m: WindowMinutes = { ...base(), speedMps: fill<number | null>(2.5), speedAccepted: fill(true) };
    const e = estimateFor(req('treadmill_run', m))!;
    expect(e.booked.estimator).toBe('speedGrade');
    expect(e.booked.domainFlags).toEqual(expect.arrayContaining(['hcSpeed', 'gradeAssumedLevel']));
    // ACSM run: S = 150 m/min, VO2 = 3.5 + 0.2·150 = 33.5 mL/kg/min → 33.5·70·30·5/1000 = 351.75 kcal
    expect(e.booked.grossKcal).toBeCloseTo((33.5 * 70 * 30 * 5) / 1000, 6);
    expect(e.comparisons.map((c) => c.estimator)).toContain('keytel');
    expect(e.evidence).toEqual({ speed: { source: 'healthConnect', kmh: 9, gradePct: null, coverage: 1, used: true } });
    expect(evidenceWords(e.evidence)).toEqual({ method: 'from Health Connect speed (9.0 km/h)', notes: [] });
  });

  it('a grade the minutes carry is used (no level assumption)', () => {
    const m: WindowMinutes = { ...base(), speedMps: fill<number | null>(1.5), speedAccepted: fill(true), gradePct: fill<number | null>(5) };
    const e = estimateFor(req('treadmill_incline_walk', m))!;
    expect(e.booked.estimator).toBe('speedGrade');
    expect(e.booked.domainFlags).not.toContain('gradeAssumedLevel');
    // ACSM walk: S = 90 m/min, VO2 = 3.5 + 9 + 1.8·90·0.05 = 20.6 → 20.6·70·30·5/1000
    expect(e.booked.grossKcal).toBeCloseTo((20.6 * 70 * 30 * 5) / 1000, 6);
    expect(e.evidence?.speed).toMatchObject({ gradePct: 5, used: true });
  });

  it('speed is weighted by moving seconds: pauses are left out of the mean and the coverage', () => {
    const speeds = fill<number | null>(2.5);
    for (let k = 20; k < 30; k++) speeds[k] = 0;
    const m: WindowMinutes = { ...base(), speedMps: speeds, speedAccepted: fill(true) };
    const pause = { start: FIRST + 20 * 60_000, end: FIRST + 30 * 60_000 };
    expect(windowMotion(m, { start: START, end: END }, [pause]).speed).toMatchObject({ kmh: 9, coverage: 1 });
    expect(windowMotion(m, { start: START, end: END }).speed!.kmh).toBeCloseTo(6, 6);
  });

  it('typed-in (manual entry) speed is not accepted; too few measured minutes, a stated speed or a cycling type keep it out', () => {
    const manual = hcMotionMinutes({ hc: { speedMps: fill(2.5), speedSource: fill('hc:com.app') }, evidence: { speed: [{ source: 'hc:com.app', recordingMethod: 'manualEntry' }] } }, N);
    expect(manual.speedAccepted!.every((x) => x === false)).toBe(true);
    const keytel = estimateFor(req('treadmill_run', base()))!;
    const m1 = estimateFor(req('treadmill_run', { ...base(), ...manual }))!;
    expect(m1.booked).toEqual(keytel.booked);
    expect(m1.evidence?.speed).toMatchObject({ used: false, reason: 'speedNotAccepted', kmh: null });

    const sparse = fill<number | null>(null);
    for (let k = 10; k < 20; k++) sparse[k] = 2.5;
    const m2 = estimateFor(req('treadmill_run', { ...base(), speedMps: sparse, speedAccepted: sparse.map((v) => v !== null) }))!;
    expect(m2.booked.estimator).toBe('keytel');
    expect(m2.evidence?.speed).toMatchObject({ used: false, reason: 'speedCoverageLow' });

    const hc = { ...base(), speedMps: fill<number | null>(2.5), speedAccepted: fill(true) };
    const stated = estimateFor(req('treadmill_run', hc, { intensity: { speedKmh: 12 } }))!;
    expect(stated.booked.estimator).toBe('speedGrade');
    expect(stated.booked.domainFlags).not.toContain('hcSpeed');
    expect(stated.evidence?.speed).toMatchObject({ used: false, reason: 'statedSpeedFirst' });

    // SPEC V2.4(3): outdoor cycling from GPS or Health Connect speed is never eligible
    const bike = estimateFor(req('cycle_outdoor', { ...base(), speedMps: fill<number | null>(6), speedAccepted: fill(true) }))!;
    expect(bike.booked.estimator).toBe('keytel');
    expect(bike.evidence?.speed).toMatchObject({ used: false, reason: 'speedNotEligibleForType' });
    expect(evidenceWords(bike.evidence).notes).toEqual(['Health Connect speed (21.6 km/h) not used: speed is used for walking and running only']);
  });
});

describe('power counts only when verified', () => {
  it('unverified Health Connect power never changes the energy: it is shown as evidence only', () => {
    const plain = estimateFor(req('stationary_bike', base()))!;
    const powered = estimateFor(req('stationary_bike', { ...base(), powerW: fill<number | null>(150), powerVerified: fill(false) }))!;
    const { evidence, ...rest } = powered;
    expect(rest).toEqual(plain);
    expect(evidence).toEqual({ power: { source: 'healthConnect', avgW: 150, verified: false, coverage: 1, used: false, reason: 'powerNotVerified' } });
    expect(evidenceWords(evidence)).toEqual({ method: null, notes: ['Health Connect power (150 W) shown only: it is not verified, so it never changes the energy'] });
    // the server's evidence marks Health Connect power unverified: the import never turns it into verified power
    const day = hcMotionMinutes({ hc: { speedMps: null, speedSource: null, powerW: fill(150), powerSource: fill('hc:com.bike') }, evidence: { power: [{ source: 'hc:com.bike', verified: false }] } }, N);
    expect(day.powerVerified!.some(Boolean)).toBe(false);
    expect(day).not.toHaveProperty('speedMps');
  });

  it('verified power on a leg cycle ergometer books ACSM leg ergometry', () => {
    const e = estimateFor(req('stationary_bike', { ...base(), powerW: fill<number | null>(100), powerVerified: fill(true) }))!;
    expect(e.booked.estimator).toBe('power');
    expect(e.booked.grossKcal).toBeCloseTo(((7 + (1.8 * 6.1183 * 100) / 70) * 70 * 30 * 5) / 1000, 6);
    expect(e.evidence?.power).toMatchObject({ verified: true, used: true });
  });
});

describe('without speed or power the estimate is what it was', () => {
  it('no motion fields, or motion fields with nothing in the window, give the same estimate and no evidence', () => {
    for (const id of ['treadmill_run', 'walk', 'stationary_bike', 'cycle_outdoor']) {
      const before = estimateFor(req(id, base()))!;
      const empty = estimateFor(req(id, { ...base(), speedMps: fill<number | null>(null), speedAccepted: fill(false), powerW: fill<number | null>(null), powerVerified: fill(false) }))!;
      expect(empty).toEqual(before);
      expect(before).not.toHaveProperty('evidence');
    }
    expect(hcMotionMinutes({ hc: null }, N)).toEqual({});
    expect(hcMotionMinutes(null, N)).toEqual({});
  });
});

describe('r063 FX4 (cross-verification M21): motion is averaged over source minutes, by the seconds that overlap', () => {
  const at = (s: number) => FIRST + s * 1000;
  const only = <T,>(v: T, ks: readonly number[], otherwise: T) => Array.from({ length: N }, (_, k) => (ks.includes(k) ? v : otherwise));

  it('the probe: a 00:30–01:30 activity with speed only in the first source minute has half coverage, not all of it', () => {
    const m: WindowMinutes = { ...base(), speedMps: only<number | null>(2.5, [0], null), speedAccepted: only(true, [0], false) };
    const w = { start: at(30), end: at(90) };
    expect(windowMotion(m, w).speed).toMatchObject({ kmh: 9, coverage: 0.5 });
    const e = estimateFor(req('treadmill_run', m, { window: w }))!;
    expect(e.booked.estimator).not.toBe('speedGrade');
    expect(e.evidence?.speed).toMatchObject({ used: false, reason: 'speedCoverageLow', coverage: 0.5 });
  });

  it('mixed speeds, grades and power are weighted by each source minute’s overlap with the moving time', () => {
    const speeds = only<number | null>(null, [], null);
    speeds[0] = 2;
    speeds[1] = 4;
    speeds[2] = 1;
    const grades = only<number | null>(null, [], null);
    grades[0] = 0;
    grades[1] = 6;
    grades[2] = 3;
    const power = only<number | null>(null, [], null);
    power[0] = 100;
    power[1] = 200;
    const m: WindowMinutes = { ...base(), speedMps: speeds, speedAccepted: speeds.map((v) => v !== null), gradePct: grades, powerW: power, powerVerified: power.map((v) => v !== null) };
    // 00:15–02:15: 45 s of minute 0, 60 s of minute 1, 15 s of minute 2
    const w = { start: at(15), end: at(135) };
    const r = windowMotion(m, w);
    expect(r.speed!.kmh).toBeCloseTo(((45 * 2 + 60 * 4 + 15 * 1) / 120) * 3.6, 9);
    expect(r.speed!.gradeFrac).toBeCloseTo((45 * 0 + 60 * 6 + 15 * 3) / 120 / 100, 9);
    expect(r.speed!.coverage).toBeCloseTo(1, 9);
    expect(r.power!.avgW).toBeCloseTo((45 * 100 + 60 * 200) / 105, 9);
    expect(r.power!.coverage).toBeCloseTo(105 / 120, 9);
    // a pause 01:00–01:15 leaves 45 s of minute 0, 45 s of minute 1 and 15 s of minute 2 moving
    const p = windowMotion(m, w, [{ start: at(60), end: at(75) }]);
    expect(p.speed!.kmh).toBeCloseTo(((45 * 2 + 45 * 4 + 15 * 1) / 105) * 3.6, 9);
    expect(p.speed!.coverage).toBeCloseTo(1, 9);
    expect(p.power!.avgW).toBeCloseTo((45 * 100 + 45 * 200) / 90, 9);
    expect(p.power!.coverage).toBeCloseTo(90 / 105, 9);
  });

  it('a window aligned to the source minutes is what it was', () => {
    const m: WindowMinutes = { ...base(), speedMps: fill<number | null>(2.5), speedAccepted: fill(true) };
    expect(windowMotion(m, { start: START, end: END }).speed).toEqual({ kmh: 9, gradeFrac: null, coverage: 1, anyValue: true, source: 'healthConnect' });
  });
});
