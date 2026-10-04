import { describe, expect, it } from 'vitest';
import {
  acsmVo2, cooperVo2, hrReserveSegment, jacksonPrior, PRIOR_SD, PROCESS_VAR_PER_DAY, tanakaHrMax, uthVo2, vo2maxDefs, vo2Posterior, weightedMedian, workoutMeasurement,
} from '../vo2max';
import { addDays } from '../util';
import { daily, dateRange, makeInput, MALE_30, resolved, workout } from './fixtures';

const def = vo2maxDefs[0]!;

describe('estimators', () => {
  it('Jackson prior matches the dossier check (man 30 y, BMI 25, PA-R 3 → 42.8)', () => {
    const massKg = 25 * 1.75 ** 2;
    expect(jacksonPrior({ ageY: 30, sex: 'male', massKg, heightCm: 175, paRating: 3 })).toBeCloseTo(42.8, 1);
    expect(jacksonPrior({ ageY: 30, sex: 'female', massKg: 23 * 1.65 ** 2, heightCm: 165, paRating: 3 })).toBeCloseTo(33.4, 1);
  });
  it('Uth, Cooper, Tanaka, ACSM', () => {
    expect(uthVo2(190, 60)).toBeCloseTo(48.45, 2);
    expect(cooperVo2(2400)).toBeCloseTo((2400 - 504.9) / 44.73, 6);
    expect(tanakaHrMax(30)).toBeCloseTo(187, 6);
    expect(acsmVo2('run', 160)).toBeCloseTo(0.2 * 160 + 3.5, 6);
    expect(acsmVo2('walk', 80, 0.05)).toBeCloseTo(0.1 * 80 + 1.8 * 80 * 0.05 + 3.5, 6);
  });
  it('HR-reserve segment: VO2max = 3.5 + (VO2 − 3.5)/f, SD from HRmax propagation', () => {
    const s = hrReserveSegment({ mode: 'run', speedMPerMin: 160, hr: 150, hrRest: 60, hrMax: 190, hrMaxSd: 10, durationS: 600 })!;
    const f = 90 / 130;
    expect(s.f).toBeCloseTo(f, 9);
    expect(s.vo2max).toBeCloseTo(3.5 + 32 / f, 6);
    // ≈ 7-8 % at f ≈ 0.7 with σ_HRmax = 10 (R9 §2.6: Firstbeat 7–9 % at 15 bpm)
    expect(s.sd / s.vo2max).toBeGreaterThan(0.06);
    expect(s.sd / s.vo2max).toBeLessThan(0.1);
  });
  it('segments outside rules are rejected', () => {
    const base = { mode: 'run' as const, speedMPerMin: 160, hr: 150, hrRest: 60, hrMax: 190, hrMaxSd: 10, durationS: 600 };
    expect(hrReserveSegment({ ...base, durationS: 120 })).toBeNull();
    expect(hrReserveSegment({ ...base, hr: 100 })).toBeNull(); // f < 0.5
    expect(hrReserveSegment({ ...base, hr: 185 })).toBeNull(); // f > 0.9
    expect(hrReserveSegment({ ...base, speedMPerMin: 60 })).toBeNull();
  });
  it('weighted median', () => {
    expect(weightedMedian([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 10, w: 5 }])).toBe(10);
    expect(weightedMedian([])).toBeNaN();
  });
});

describe('vo2Posterior', () => {
  const prior = { meanMlKgMin: 40, sdMlKgMin: PRIOR_SD, localDate: '2026-01-01' };
  it('prior only: mean 40 and SD grows but never above the prior SD', () => {
    const p = vo2Posterior({ prior, measurements: [], asOf: '2027-01-01' })!;
    expect(p.mean).toBeCloseTo(40, 6);
    expect(p.sd).toBeCloseTo(PRIOR_SD, 6);
    expect(p.nUpdates).toBe(0);
    expect(PROCESS_VAR_PER_DAY).toBeGreaterThan(0);
  });
  it('a lab test dominates the prior', () => {
    const p = vo2Posterior({ prior, measurements: [{ localDate: '2026-01-02', method: 'lab', valueMlKgMin: 52, sdMlKgMin: 1.56, isTest: true }], asOf: '2026-01-02' })!;
    expect(p.mean).toBeGreaterThan(51);
    expect(p.sd).toBeLessThan(1.6);
    expect(p.methodsUsed).toEqual(['prior', 'lab']);
  });
  it('process noise inflates SD between days', () => {
    const m = [{ localDate: '2026-01-02', method: 'lab' as const, valueMlKgMin: 52, sdMlKgMin: 1.5, isTest: true }];
    const a = vo2Posterior({ prior, measurements: m, asOf: '2026-01-02' })!;
    const b = vo2Posterior({ prior, measurements: m, asOf: '2026-03-02' })!;
    expect(b.sd).toBeGreaterThan(a.sd);
    expect(b.mean).toBeCloseTo(a.mean, 9);
  });
  it('one outlying run is gated; many consistent runs move the state', () => {
    const run = (d: string, v: number) => ({ localDate: d, method: 'hr_reserve' as const, valueMlKgMin: v, sdMlKgMin: 4 });
    const g = vo2Posterior({ prior, measurements: [run('2026-01-03', 80)], asOf: '2026-01-03' })!;
    expect(g.nRejected).toBe(1);
    expect(g.mean).toBeCloseTo(40, 6);
    const ms = Array.from({ length: 10 }, (_, i) => run(`2026-01-${String(3 + i).padStart(2, '0')}`, 46));
    const p = vo2Posterior({ prior, measurements: ms, asOf: '2026-01-12' })!;
    expect(p.mean).toBeGreaterThan(44);
    expect(p.sd).toBeLessThan(PRIOR_SD);
  });
  it('without a prior it starts from the first measurement; with nothing it is null', () => {
    expect(vo2Posterior({ prior: null, measurements: [], asOf: '2026-01-01' })).toBeNull();
    const p = vo2Posterior({ prior: null, measurements: [{ localDate: '2026-01-01', method: 'lab', valueMlKgMin: 50, sdMlKgMin: 2, isTest: true }], asOf: '2026-01-01' })!;
    expect(p.mean).toBeCloseTo(50, 6);
  });
  it('tracks L/min: the same absolute capacity shows a higher ml/kg after weight loss', () => {
    const p = vo2Posterior({ prior: null, measurements: [{ localDate: '2026-01-01', method: 'lab', valueMlKgMin: 40, sdMlKgMin: 2, massKg: 100, isTest: true }], asOf: '2026-01-01', massAsOfKg: 80 })!;
    expect(p.meanLMin).toBeCloseTo(4, 6);
    expect(p.mean).toBeCloseTo(50, 6);
  });
});

describe('fitness.vo2max def', () => {
  it('prior-only result: low confidence, band, detail', () => {
    const r = def.compute(makeInput('2026-02-01', { days: [resolved('2026-02-01')] }, MALE_30));
    expect(r.status).toBe('ok');
    expect(r.confidence).toBe('low');
    expect(r.band?.level).toBe(0.8);
    expect(r.detail).toMatchObject({ nUpdates: 0, methodsUsed: 'prior' });
    expect(r.detail!['posteriorSd']).toBeCloseTo(PRIOR_SD, 3);
  });
  it('withheld when no prior profile and no measurement', () => {
    expect(def.compute(makeInput('2026-02-01', { days: [resolved('2026-02-01')] })).status).toBe('withheld');
  });
  it('lab test enters; vendor estimate is display-only and never moves the value', () => {
    const base = [resolved('2026-01-01'), resolved('2026-01-10', { daily: daily('2026-01-10', { vo2max: { ml_kg_min: 70, method: 'vendor_estimate' } }) })];
    const withVendor = def.compute(makeInput('2026-01-10', { days: base }, MALE_30));
    const without = def.compute(makeInput('2026-01-10', { days: [resolved('2026-01-01'), resolved('2026-01-10')] }, MALE_30));
    expect(withVendor.value).toBeCloseTo(without.value!, 9);
    expect(withVendor.detail!['vendorEstimateMlKgMin']).toBe(70);
    const lab = def.compute(makeInput('2026-01-10', { days: [resolved('2026-01-01'), resolved('2026-01-10', { daily: daily('2026-01-10', { vo2max: { ml_kg_min: 55, method: 'lab' } }) })] }, MALE_30));
    expect(lab.value).toBeGreaterThan(53);
    expect(lab.detail!['methodsUsed']).toContain('lab');
  });
  it('Uth ratio updates once ≥14 RHR nights exist on the anchor day', () => {
    const grid = addDays('2020-01-06', 28 * 80); // on the 28-day grid anchored at 2020-01-06
    const days = dateRange(grid, 30).map((d) => resolved(d, { daily: daily(d, { resting_hr_bpm: 50 }) }));
    const inp = makeInput(grid, { days }, { ...MALE_30, hrMaxObs: 195 });
    const r = def.compute(inp);
    expect(String(r.detail!['methodsUsed'])).toContain('uth_ratio');
  });
  it('an HR-speed run (series HR) feeds the filter; deterministic', () => {
    const date = '2026-02-10';
    const w = workout(date, { exercise_type: 'run', active_duration_s: 1800, distance_m: 5000 });
    const t0 = Date.parse(w.time.start!);
    const hr = Array.from({ length: 60 }, (_, i) => ({ t: t0 + i * 30_000, value: 150, tier: 'A' as const, sourceKey: 's' }));
    const days = dateRange(date, 20).map((d) => resolved(d, { daily: daily(d, { resting_hr_bpm: 55 }), ...(d === date ? { workouts: [w] } : {}) }));
    const inp = makeInput(date, { days, series: { hr }, workouts: [w] }, { ...MALE_30, hrMaxObs: 195 });
    const a = def.compute(inp);
    expect(a.detail!['methodsUsed']).toContain('hr_reserve');
    expect(def.compute(inp)).toEqual(a);
  });
  it('workoutMeasurement rejects sparse HR without a fallback average and ring-only tier C', () => {
    const w = workout('2026-02-10', { exercise_type: 'run', active_duration_s: 1800, distance_m: 5000 });
    const ctx = { hrRest: 55, hrMax: 190, hrMaxSd: 10 };
    expect(workoutMeasurement(w, [], ctx)).toBeNull();
    const t0 = Date.parse(w.time.start!);
    const sparse = Array.from({ length: 6 }, (_, i) => ({ t: t0 + 200_000 + i * 300_000, value: 150, tier: 'C' }));
    expect(workoutMeasurement(w, sparse, ctx)).toBeNull();
    const fb = workoutMeasurement({ ...w, hr_avg_bpm: 150 }, [], ctx);
    expect(fb?.method).toBe('hr_reserve');
  });
  it('def metadata', () => {
    expect(def.formula.fn).toBe('fitness.vo2max@1.0.0');
    expect(def.label).toBe('estimate');
    expect(def.params.every((p) => p.sourceRef.length > 0)).toBe(true);
  });
});
