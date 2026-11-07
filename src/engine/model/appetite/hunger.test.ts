// @vitest-environment node
/**
 * D2-06 (contracts C4/C6): the HPI is an uncalibrated burden index anchored only by the person's own fixed-time 0–10
 * ratings (time-ordered held-out evaluation on the rating scale); ketosis has no default 90 % cancellation of the other
 * drives (the legacy magnitude is a named scenario); the adherence output is a deprecated latent index with no probability
 * semantics; missing ratings are missing.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '../../types/profile';
import { GOAL_CAPABILITY, isProductionGoalEligible } from '../../types/metrics';
import { buildModelParams } from '../../core/paramsRegistry';
import { DayDriver, makeProfile, TEST_MODULES } from '../hormones/testHarness';
import { APPETITE_OUTPUT_CONTRACT, APPETITE_PARAMS } from './index';
import { calibrateHungerRatings, hungerBurdenStatus, hungerForecast, type HungerRating } from './ratingCalibration';

const MAN90: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 } };

/** Ketotic VLED (BHB 0.6 mM) with a sleep debt; `ketoAtten` override = the named legacy scenario. */
function vled(days: number, ketoAtten?: number): DayDriver {
  const profile = makeProfile(MAN90, { weightKg: 90, fm0Kg: 30, ffm0Kg: 60, tdee0Kcal: 2600, habitualProteinG: 100, habitualFibreG: 16 });
  let paramValues: Float64Array | undefined;
  if (ketoAtten !== undefined) {
    const base = buildModelParams(TEST_MODULES);
    paramValues = new Float64Array(base.values);
    paramValues[base.index.get('appetite.ketoAtten')!] = ketoAtten;
  }
  const dr = new DayDriver(profile, paramValues ? { paramValues } : {});
  let w = 90;
  for (let d = 1; d <= days; d++) {
    const tee = 2600 - 22 * (90 - w);
    const bus = dr.bus;
    bus.tdeeEstKcalD = tee;
    bus.tissueMassKg = w;
    bus.fatMassKg = 30 - 0.75 * (90 - w);
    bus.ffmActKg = w - bus.fatMassKg;
    bus.bhbMmolL = 0.6;
    bus.sleepDebtFastH = 1.5;
    bus.ketoInduction = 0;
    dr.setIntake({ proteinG: 60, carbG: 40, fatG: 20, fibreG: 16, energyKcal: 700, nMeals: 3 });
    dr.runDay();
    w -= (tee - 700) / 7700;
  }
  return dr;
}

describe('ketosis relief: no default universal offset (no 90 % cancellation of sleep/weight-loss/fatigue drives)', () => {
  it('the default ketosis attenuation is 0: the unmet appetite after ketosis equals the smoothed drive sum', () => {
    expect(APPETITE_PARAMS.find((p) => p.id === 'appetite.ketoAtten')!.value).toBe(0);
    const dr = vled(28);
    expect(dr.as.kAd).toBeGreaterThan(0.8); // the ketosis state is still tracked
    expect(dr.as.effortK).toBeCloseTo(dr.as.effortS, 9);
    expect(dr.as.dSleep).toBeGreaterThan(0);
    expect(dr.as.dWl).toBeGreaterThan(0);
  });
  it('the legacy 0.9 magnitude stays available only as a named scenario override', () => {
    expect(APPETITE_OUTPUT_CONTRACT.ketosisRelief.legacyScenario.value).toBe(0.9);
    const legacy = vled(28, 0.9);
    const now = vled(28);
    expect(legacy.as.effortK).toBeLessThan(0.5 * now.as.effortK);
    expect(legacy.as.hpi).toBeLessThan(now.as.hpi);
  });
});

describe('adherence output is not a probability', () => {
  it('deprecated latent index: no probability semantics, no dropout definition, never a goal', () => {
    expect(APPETITE_OUTPUT_CONTRACT.adherence.probability).toBe(false);
    expect(APPETITE_OUTPUT_CONTRACT.adherence.dropoutDefinition).toBeNull();
    expect(GOAL_CAPABILITY.adherence.availability).toBe('unavailable');
    expect(isProductionGoalEligible('adherence')).toBe(false);
    for (const id of ['appetite.hazardCoef', 'appetite.hazardHpiThresh', 'appetite.hazardHpiScale']) {
      const p = APPETITE_PARAMS.find((x) => x.id === id)!;
      expect(p.distribution!.basis).toMatch(/not a probability/);
      expect(p.distribution!.uncertaintyKind).toBe('heuristic');
    }
  });
});

/** Deterministic ratings: hunger = 1 + 0.06·HPI ± 0.3 (alternating), at 09:00 on days 0..n−1. */
function ratings(hpi: Float64Array, n: number, opts: { clockH?: number; offsetDays?: Set<number>; offset?: number } = {}): HungerRating[] {
  const out: HungerRating[] = [];
  for (let d = 0; d < n; d++) {
    const noise = d % 2 === 0 ? 0.3 : -0.3;
    const off = opts.offsetDays?.has(d) ? (opts.offset ?? 0) : 0;
    out.push({ day: d, clockH: opts.clockH ?? 9, hunger: Math.min(10, Math.max(0, 1 + 0.06 * hpi[d]! + noise + off)), ...(opts.offsetDays?.has(d) ? { context: 'ketosis' } : { context: 'usual' }) });
  }
  return out;
}
const HPI = Float64Array.from({ length: 40 }, (_, d) => 10 + 70 * Math.abs(Math.sin(d / 3)));

describe('personal 0–10 hunger calibration (time-ordered held-out days)', () => {
  it('fixed-time ratings anchor the HPI: held-out error on the rating scale beats the person\'s own mean', () => {
    const c = calibrateHungerRatings(ratings(HPI, 30), HPI);
    expect(c.status).toBe('calibrated');
    expect(c.clockH).toBe(9);
    expect(c.b!).toBeCloseTo(0.06, 2);
    expect(c.a!).toBeCloseTo(1, 0);
    expect(c.nHeldOut).toBe(30 - 3);
    expect(c.heldOutMae!).toBeLessThan(c.baselineMae!);
    expect(c.heldOutMae!).toBeLessThan(0.6);
  });
  it('ratings at other clock hours and untimed ratings are never mixed in; fullness and craving stay separate', () => {
    const rs: HungerRating[] = [
      ...ratings(HPI, 20),
      { day: 3, clockH: 21, hunger: 9 },
      { day: 4, clockH: 21, hunger: 9 },
      { day: 5, hunger: 9 },
      { day: 6, clockH: 9, fullness: 8, craving: 2 },
      { day: 7, clockH: 9, hunger: 14 },
    ];
    const c = calibrateHungerRatings(rs, HPI, { fixedClockH: 9 });
    expect(c.n).toBe(20);
    expect(c.excluded).toEqual({ otherTime: 2, untimed: 1, invalid: 1 });
    expect(c.fullnessN).toBe(1);
    expect(c.cravingN).toBe(1);
  });
  it('missing ratings are missing (not zero hunger): adding unrated days changes nothing', () => {
    const base = calibrateHungerRatings(ratings(HPI, 20), HPI);
    const withMissing = calibrateHungerRatings([...ratings(HPI, 20), ...Array.from({ length: 15 }, (_, i) => ({ day: 20 + i, clockH: 9 }))], HPI);
    expect(withMissing.n).toBe(base.n);
    expect(withMissing.a).toBe(base.a);
    expect(withMissing.b).toBe(base.b);
  });
  it('too few ratings stay insufficient; ratings unrelated to the burden index are not informative', () => {
    expect(calibrateHungerRatings(ratings(HPI, 3), HPI).status).toBe('insufficient');
    expect(calibrateHungerRatings([], HPI).status).toBe('insufficient');
    const flat: HungerRating[] = Array.from({ length: 30 }, (_, d) => ({ day: d, clockH: 9, hunger: d % 2 === 0 ? 4 : 6 }));
    expect(calibrateHungerRatings(flat, HPI).status).toBe('notInformative');
  });
  it('a context offset is kept only when the person\'s repeated routine contrast improves held-out error', () => {
    const ket = new Set(Array.from({ length: 30 }, (_, d) => d).filter((d) => d % 3 === 0));
    const withContrast = calibrateHungerRatings(ratings(HPI, 30, { offsetDays: ket, offset: -2 }), HPI, { offsetContext: 'ketosis' });
    expect(withContrast.offset?.context).toBe('ketosis');
    expect(withContrast.offset!.value).toBeCloseTo(-2, 0);
    const noContrast = calibrateHungerRatings(ratings(HPI, 30, { offsetDays: ket, offset: 0 }), HPI, { offsetContext: 'ketosis' });
    expect(noContrast.offset).toBeUndefined();
  });
  it('forecasts: a 0–10 range only when calibrated; otherwise the uncalibrated burden status, with no invented range', () => {
    const cal = calibrateHungerRatings(ratings(HPI, 30), HPI);
    const f = hungerForecast(50, cal);
    expect(f.status).toBe('estimated');
    expect(f.unit).toBe('0–10');
    expect(f.range![0]).toBeLessThan(f.value!);
    expect(f.range![1]).toBeGreaterThan(f.value!);
    expect(f.uncertaintyKind).toBe('conditionalResidual');
    expect(f.coverageStatus).toBe('unvalidated');
    const none = hungerForecast(50, calibrateHungerRatings([], HPI));
    expect(none.status).toBe('exploratory');
    expect(none.range).toBeUndefined();
    expect(hungerBurdenStatus(10)).toBe('low');
    expect(hungerBurdenStatus(50)).toBe('moderate');
    expect(hungerBurdenStatus(90)).toBe('high');
    expect(hungerBurdenStatus(Number.NaN)).toBe('unknown');
  });
  it('users without ratings keep useful route comparisons: the burden index still separates a deficit from maintenance', () => {
    const profile = makeProfile(MAN90, { weightKg: 90, fm0Kg: 30, ffm0Kg: 60, tdee0Kcal: 2600, habitualProteinG: 100, habitualFibreG: 16 });
    const run = (ei: number): number => {
      const dr = new DayDriver(profile);
      for (let d = 0; d < 14; d++) {
        dr.bus.tdeeEstKcalD = 2600;
        dr.setIntake({ proteinG: 100, carbG: (0.5 * (ei - 432)) / 4, fatG: (0.5 * (ei - 432)) / 9, fibreG: 16, energyKcal: ei, nMeals: 3 });
        dr.runDay();
      }
      return dr.as.hpi;
    };
    expect(run(1950)).toBeGreaterThan(run(2600) + 10);
  });
});
