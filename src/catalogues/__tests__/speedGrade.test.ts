/**
 * SPEC V1.7 speed/grade estimators: true ACSM walking, running and leg-ergometer forms with their domains, the Compendium
 * treadmill-desk rows at ≤ 2 mph, and the unit traps (5 % grade = 0.05; 100 W is not 100 kcal/min).
 */
import { describe, expect, it } from 'vitest';
import { ACSM_DOMAIN, EQUATION_VERSION, acsmCycleVo2, acsmRunVo2, acsmWalkVo2, grossKcalFromVo2, speedGradeEstimate } from '@/catalogues';

const kmh = (mPerMin: number): number => (mPerMin * 60) / 1000;

describe('ACSM forms (acsm-walk/1, acsm-run/1, acsm-cycle/1)', () => {
  it('treadmill check: 80 kg, 100 m/min, 5 % grade, 30 min → 270 kcal gross (RESEARCH III.B)', () => {
    expect(acsmWalkVo2(100, 0.05)).toBeCloseTo(22.5, 12);
    expect(grossKcalFromVo2(22.5, 80, 30)).toBeCloseTo(270, 9);
    const e = speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: kmh(100), gradeFrac: 0.05, treadmill: true })!;
    expect(e.grossKcal).toBeCloseTo(270, 6);
    expect(e).toMatchObject({ method: 'acsm', version: 'acsm-walk/1', uncertaintyKind: 'scenario', domainFlags: [] });
    expect(e.envelope.lo).toBeCloseTo(270 * 0.75, 6);
    expect(e.envelope.hi).toBeCloseTo(270 * 1.25, 6);
  });

  it('5 % grade means 0.05: a percent passed as a fraction is rejected, never extrapolated', () => {
    expect(acsmWalkVo2(100, 0.05)).toBeLessThan(25);
    expect(acsmWalkVo2(100, 5)).toBeGreaterThan(900); // what the trap would produce
    expect(speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: 6, gradeFrac: 5 })).toBeNull();
    expect(ACSM_DOMAIN.maxGradeFrac).toBe(0.4);
  });

  it('100 W is not 100 kcal/min (leg ergometer, 80 kg ≈ 8.3 kcal/min gross)', () => {
    const vo2 = acsmCycleVo2(100, 80);
    expect(vo2).toBeCloseTo(7 + (1.8 * 611.83) / 80, 9);
    const perMin = grossKcalFromVo2(vo2, 80, 1);
    expect(perMin).toBeCloseTo(8.31, 2);
    expect(perMin).toBeLessThan(10);
    const e = speedGradeEstimate({ gait: 'legCycleErgometer', massKg: 80, durationMin: 60, powerW: 100 })!;
    expect(e.grossKcal).toBeCloseTo(perMin * 60, 6);
    expect(e.version).toBe('acsm-cycle/1');
  });

  it('running: 0.2·S + 0.9·S·G; above 134 m/min, or from 80 m/min when jogging', () => {
    expect(acsmRunVo2(160, 0.02)).toBeCloseTo(3.5 + 32 + 2.88, 12);
    expect(speedGradeEstimate({ gait: 'run', massKg: 70, durationMin: 30, speedKmh: kmh(160), gradeFrac: 0 })!.version).toBe('acsm-run/1');
    expect(speedGradeEstimate({ gait: 'run', massKg: 70, durationMin: 30, speedKmh: kmh(100), gradeFrac: 0 })).toBeNull();
    expect(speedGradeEstimate({ gait: 'run', massKg: 70, durationMin: 30, speedKmh: kmh(100), gradeFrac: 0, jogging: true })).not.toBeNull();
  });
});

describe('domains: outside → the next estimator (null)', () => {
  it('walking 50-100 m/min only; no downhill; leg ergometer 50-200 W only', () => {
    expect(speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: kmh(120), gradeFrac: 0 })).toBeNull();
    expect(speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: kmh(40), gradeFrac: 0 })).toBeNull(); // overground slow
    expect(speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: kmh(80), gradeFrac: -0.05 })).toBeNull();
    expect(speedGradeEstimate({ gait: 'legCycleErgometer', massKg: 80, durationMin: 30, powerW: 30 })).toBeNull();
    expect(speedGradeEstimate({ gait: 'legCycleErgometer', massKg: 80, durationMin: 30, powerW: 250 })).toBeNull();
    expect(speedGradeEstimate({ gait: 'legCycleErgometer', massKg: 80, durationMin: 30 })).toBeNull();
  });

  it('missing grade is unknown: computed level as a declared assumption with a wider envelope', () => {
    const e = speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 30, speedKmh: kmh(90) })!;
    expect(e.domainFlags).toEqual(['gradeAssumedLevel']);
    expect(e.envelope.hi / e.grossKcal).toBeCloseTo(1.35, 9);
    expect(e.grossKcal).toBeCloseTo(grossKcalFromVo2(acsmWalkVo2(90, 0), 80, 30), 9);
  });

  it('treadmill desk at ≤ 2 mph uses Compendium 11003 (≤ 1 mph, 2.0) / 11004 (1-2 mph, 2.8), not ACSM', () => {
    const slow = speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 60, speedKmh: 1.4, treadmill: true })!;
    expect(slow).toMatchObject({ method: 'compendiumMet', version: 'compendium-desk-walk/1', compendiumCode: '11003' });
    expect(slow.grossKcal).toBeCloseTo(2.0 * 1.05 * 80, 6);
    const desk = speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 60, speedKmh: 2.8, gradeFrac: 0, treadmill: true })!;
    expect(desk.compendiumCode).toBe('11004');
    expect(desk.grossKcal).toBeCloseTo(2.8 * 1.05 * 80, 6);
    // the same slow speed overground has no estimator here
    expect(speedGradeEstimate({ gait: 'walk', massKg: 80, durationMin: 60, speedKmh: 2.8 })).toBeNull();
  });

  it('the catalogue acsmWalk route is labelled a hybrid, the cycling fit a leg-ergometer fit', () => {
    expect(EQUATION_VERSION.acsmWalk).toBe('walk-hybrid/1');
    expect(EQUATION_VERSION.cyclePower).toBe('cycle-power-fit/1');
  });
});
