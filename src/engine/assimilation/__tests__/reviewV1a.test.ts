// Regression tests for the engine review (docs/review/V1-engine.md, V1a-M1, V1a-L3, V1a-L4) and the D5-03 ledger law.
import { compositionTarget } from '../checkIn';
import { estimateEnergyBias } from '../energyBias';
import { ASSIMILATION_DEFAULTS } from '../params';
import { anchorVatKg, newOffsetScratch, offsetAppliedOn, offsetDayIntake } from '../runHooks';
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
  it('a non-finite BIA reading is ignored (skipped with its reason, no split)', () => {
    const replay = { startDay: 0, fatKg: new Float64Array(30).fill(20), tissueWakeKg: new Float64Array(30).fill(70), waterWakeKg: new Float64Array(30).fill(2), result: { daily: {} } } as never;
    const c = compositionTarget({ day: 20, targetTissueKg: 70, engineFatKg: 17.5, fatShareOfResidual: 0.8, readings: { bodyFatBia: [{ day: 19, pct: Number.NaN }] }, replay, trendAt: () => null, params: ASSIMILATION_DEFAULTS });
    expect(c.status).not.toBe('updated');
    expect(c.fatFrac).toBeUndefined();
    expect(c.skipped).toEqual([{ day: 19, reason: 'nonFinite' }]);
  });
  it('sigmaKg 0 gives a finite energy-bias estimate', () => {
    const r = estimateEnergyBias({
      points: Array.from({ length: 12 }, (_, i) => ({ day: i, y: 80 + i * 0.01, engineKg: 80 })),
      rhoKcalPerKg: 7000, sigmaKg: 0, deltaApplied: 0, previous: { mean: 0, sd: 150 }, intakeDaysWeek1: 7, intakeDaysWeek2: 7,
    } as never);
    expect(Number.isFinite(r.mean)).toBe(true);
  });
});

describe('offsetAppliedOn states what the correction law actually applied (D5-03)', () => {
  const meal = { proteinG: 30, carbG: 100, glucoseEqG: 100, fructoseG: 0, galactoseG: 0, fatG: 20, satFatG: 0, mctG: 0, fibreG: 0, viscousFibreG: 0, kcal: 900 };
  const day = {
    zeroIntake: false, nMeals: 1, meals: [meal], proteinG: 30, carbG: 100, glucoseEqG: 100, exerciseCarbG: 0, fructoseG: 0, galactoseG: 0,
    sugarsG: 0, fibreG: 0, viscousFibreG: 0, fatG: 20, satFatG: 0, mufaG: 0, pufaG: 0, mctG: 0, energyKcal: 900,
  } as unknown as DayInput;

  it('matches the scaled day exactly, skips zero-energy days with a reason and clips at zero intake', () => {
    for (const k of [-300, 150, -2000]) {
      const o = offsetDayIntake(day, k, newOffsetScratch());
      expect(offsetAppliedOn(day, k).appliedKcal).toBeCloseTo(o.energyKcal - day.energyKcal, 9);
    }
    expect(offsetAppliedOn(day, -2000).appliedKcal).toBeCloseTo(-900, 9);
    expect(offsetAppliedOn({ ...day, zeroIntake: true } as DayInput, -300)).toEqual({ appliedKcal: 0, skippedReason: 'zeroEnergyDay' });
    expect(offsetAppliedOn({ ...day, nMeals: 0 } as DayInput, -300)).toEqual({ appliedKcal: 0, skippedReason: 'zeroEnergyDay' });
    expect(offsetAppliedOn(day, 0)).toEqual({ appliedKcal: 0 });
    // the input day (the logged intake) is never mutated
    offsetDayIntake(day, -300, newOffsetScratch());
    expect(day.meals[0]!.proteinG).toBe(30);
    expect(day.proteinG).toBe(30);
  });

  it('VAT of an anchor uses the common allometry and is bounded by fat mass', () => {
    expect(anchorVatKg(2, 20, 10)).toBeCloseTo(2 * 0.5 ** 1.3, 12);
    expect(anchorVatKg(2, 20, 0)).toBe(0);
    expect(anchorVatKg(2, 0, 10)).toBe(0);
    expect(anchorVatKg(9, 10, 8, 1.3, 1.3)).toBeLessThanOrEqual(8);
    expect(anchorVatKg(9.8, 10, 12, 1.3, 1.3)).toBe(12);
  });
});
