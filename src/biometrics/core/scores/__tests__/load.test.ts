import { describe, expect, it } from 'vitest';
import { ewmaSeries, lambdaOf, loadDefs, srpeOf, trimpFromSeries, trimpMinute } from '../load';
import type { ScoreResult } from '../../types';
import { makeResult } from '../util';
import { daily, dateRange, makeInput, MALE_30, resolved, workout } from './fixtures';

const [trimp, srpe, ewma] = loadDefs as [typeof loadDefs[number], typeof loadDefs[number], typeof loadDefs[number]];

describe('TRIMP', () => {
  it('sex-specific coefficients', () => {
    expect(trimpMinute(0.5, 'male')).toBeCloseTo(0.5 * 0.64 * Math.exp(1.92 * 0.5), 9);
    expect(trimpMinute(0.5, 'female')).toBeCloseTo(0.5 * 0.86 * Math.exp(1.67 * 0.5), 9);
    expect(trimpMinute(-0.2, 'male')).toBe(0);
    expect(trimpMinute(1.4, 'male')).toBeCloseTo(trimpMinute(1, 'male'), 9);
  });
  it('minute integration is non-linear: intervals exceed the average-HR value', () => {
    const t0 = 0;
    const lo = Array.from({ length: 30 }, (_, i) => ({ t: i * 60_000 + 1, value: 100 }));
    const hi = Array.from({ length: 30 }, (_, i) => ({ t: (30 + i) * 60_000 + 1, value: 180 }));
    const o = { hrRest: 60, hrMax: 190, sex: 'male' as const };
    const r = trimpFromSeries([...lo, ...hi], t0, 60 * 60_000, o);
    const avg = 60 * trimpMinute((140 - 60) / 130, 'male');
    expect(r.minutes).toBe(60);
    expect(r.trimp).toBeGreaterThan(avg);
  });
  it('def: sums workouts from the HR series, flags nothing; withheld without profile', () => {
    const date = '2026-03-01';
    const w = workout(date, { active_duration_s: 1800 });
    const t0 = Date.parse(w.time.start!);
    const hr = Array.from({ length: 30 }, (_, i) => ({ t: t0 + i * 60_000 + 5, value: 150, tier: 'A' as const, sourceKey: 's' }));
    const inp = makeInput(date, { days: [resolved(date, { workouts: [w], daily: daily(date, { resting_hr_bpm: 55 }) })], series: { hr } }, { ...MALE_30, hrMaxObs: 190 });
    const r = trimp.compute(inp);
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(30 * trimpMinute((150 - 55) / 135, 'male'), 6);
    expect(r.detail!['nAvgHrFallback']).toBe(0);
    expect(trimp.compute(makeInput(date, { workouts: [w] })).status).toBe('withheld');
  });
  it('average-HR fallback is flagged and lowers confidence; no HR → withheld', () => {
    const date = '2026-03-01';
    const w = workout(date, { hr_avg_bpm: 150 });
    const p = { ...MALE_30, hrMaxObs: 190 };
    const r = trimp.compute(makeInput(date, { workouts: [w] }, p));
    expect(r.confidence).toBe('medium');
    expect(r.detail!['nAvgHrFallback']).toBe(1);
    expect(trimp.compute(makeInput(date, { workouts: [workout(date)] }, p)).status).toBe('withheld');
  });
  it('rest day is zero load', () => {
    expect(trimp.compute(makeInput('2026-03-01', {}, { ...MALE_30, hrMaxObs: 190 })).value).toBe(0);
  });
});

describe('sRPE', () => {
  it('RPE × minutes, summed per day; rated-only', () => {
    const date = '2026-03-01';
    const a = workout(date, { exercise_type: 'strength', active_duration_s: 3600, rpe_0_10: 7 });
    const b = workout(date, { exercise_type: 'run', active_duration_s: 1800 });
    expect(srpeOf(a)).toBe(420);
    const r = srpe.compute(makeInput(date, { workouts: [a, b] }));
    expect(r.value).toBe(420);
    expect(r.confidence).toBe('medium');
    expect(srpe.compute(makeInput(date, { workouts: [b] })).status).toBe('withheld');
  });
});

describe('EWMA', () => {
  it('lambda = 2/(N+1)', () => {
    expect(lambdaOf(7)).toBeCloseTo(0.25, 9);
    expect(lambdaOf(28)).toBeCloseTo(2 / 29, 9);
  });
  it('constant load converges to that load; spike decays', () => {
    const ds = dateRange('2026-03-30', 60).map((date) => ({ date, value: 100 }));
    expect(ewmaSeries(ds, '2026-03-30', 7)!.a).toBeCloseTo(100, 6);
    const extra = ewmaSeries(ds, '2026-04-20', 7)!.a; // 21 rest days
    expect(extra).toBeLessThan(5);
  });
  const mk = (id: string, date: string, v: number): ScoreResult => makeResult(id, '1.0.0', makeInput(date), { status: 'ok', value: v, scope: { kind: 'day', localDate: date } });
  it('def: needs ≥28 days; reports A7/A28, ACWR in detail only, no plan effect from ACWR', () => {
    const end = '2026-03-30';
    const prior = { 'load.trimp': dateRange(end, 40).map((d) => mk('load.trimp', d, 80)), 'load.srpe': [] };
    const r = ewma.compute(makeInput(end, { prior }));
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(80, 3);
    expect(r.detail!['acwrContextOnly']).toBeCloseTo(1, 3);
    expect(r.detail!['series']).toBe('trimp');
    const short = ewma.compute(makeInput(end, { prior: { 'load.trimp': dateRange(end, 10).map((d) => mk('load.trimp', d, 80)) } }));
    expect(short.status).toBe('insufficient_baseline');
    expect(ewma.compute(makeInput(end)).status).toBe('withheld');
    expect(ewma.planEffects.map((p) => p.target)).toEqual(['training_volume', 'trainer_briefing']);
    expect(ewma.planEffects[0]!.rule).toMatch(/PROPOSED/);
    expect(ewma.planEffects.some((p) => /ACWR/.test(p.rule) && !/no plan effect/.test(p.rule))).toBe(false);
  });
  it('keeps TRIMP and sRPE separate (never summed)', () => {
    const end = '2026-03-30';
    const prior = { 'load.trimp': dateRange(end, 40).map((d) => mk('load.trimp', d, 50)), 'load.srpe': dateRange(end, 40).map((d) => mk('load.srpe', d, 300)) };
    const r = ewma.compute(makeInput(end, { prior }));
    expect(r.detail!['trimpAcute7']).toBeCloseTo(50, 3);
    expect(r.detail!['srpeAcute7']).toBeCloseTo(300, 3);
    expect(r.value).toBeCloseTo(50, 3);
  });
});
