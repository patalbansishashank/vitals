// Regression tests for the engine review (docs/review/V1-engine.md, V1a-M1, V1a-L3, V1a-L4).
import { compositionTarget } from '../checkIn';
import { estimateEnergyBias } from '../energyBias';
import { ASSIMILATION_DEFAULTS } from '../params';
import { newOffsetScratch, offsetDayIntake } from '../runHooks';
import type { DayInput } from '../../types';

describe('offsetDayIntake keeps carbohydrate during exercise unscaled', () => {
  it('day carbG stays the sum of the meals plus the exercise carbohydrate', () => {
    const meal = { proteinG: 30, carbG: 100, glucoseEqG: 100, fructoseG: 0, galactoseG: 0, fatG: 20, satFatG: 0, mctG: 0, fibreG: 0, viscousFibreG: 0, kcal: 900 };
    const day = {
      zeroIntake: false, nMeals: 1, meals: [meal], proteinG: 30, carbG: 150, glucoseEqG: 150, exerciseCarbG: 50, fructoseG: 0, galactoseG: 0,
      sugarsG: 0, fibreG: 0, viscousFibreG: 0, fatG: 20, satFatG: 0, mufaG: 0, pufaG: 0, mctG: 0, energyKcal: 1100,
    } as unknown as DayInput;
    const o = offsetDayIntake(day, 300, newOffsetScratch());
    expect(o.carbG).toBeCloseTo(o.meals[0]!.carbG + 50, 9);
    expect(o.glucoseEqG).toBeCloseTo(o.meals[0]!.glucoseEqG + 50, 9);
    expect(day.carbG).toBe(150); // input untouched
  });
});

describe('assimilation NaN guards', () => {
  it('a non-finite BIA reading is ignored', () => {
    const replay = { startDay: 0, fatKg: [], result: { daily: {} } } as never;
    const c = compositionTarget(20, 0.25, 70, { bodyFatBia: [{ day: 19, pct: Number.NaN }] }, replay, ASSIMILATION_DEFAULTS);
    expect(c === null || Number.isFinite(c.fatFrac)).toBe(true);
  });
  it('sigmaKg 0 gives a finite energy-bias estimate', () => {
    const r = estimateEnergyBias({
      points: Array.from({ length: 12 }, (_, i) => ({ day: i, y: 80 + i * 0.01, engineKg: 80 })),
      rhoKcalPerKg: 7000, sigmaKg: 0, deltaApplied: 0, previous: { mean: 0, sd: 150 }, intakeDaysWeek1: 7, intakeDaysWeek2: 7,
    } as never);
    expect(Number.isFinite(r.mean)).toBe(true);
  });
});
