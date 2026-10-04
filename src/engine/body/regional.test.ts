// Regional allocation rule (dossier 14 M7): conservation, invariance, options. Study targets V3-V7 live in validation.test.ts.
import { estimateInitialState } from './estimateBody';
import { K_GAIN, K_LOSS, allocateRegional, regionalTotals } from './regional';
import type { RegionalComposition } from './types';

const start = (): RegionalComposition => {
  const e = estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 95, waistCm: 102 });
  return { fat: e.fat, muscle: e.muscle };
};

describe('allocateRegional (dossier 14 M7)', () => {
  it('conserves mass exactly for loss, gain and mixed sequences', () => {
    let c = start();
    const targets = [
      [25, 34],
      [18, 33],
      [30, 36],
      [5, 30],
      [0.5, 29],
      [12, 31],
    ];
    for (const [fm, sm] of targets) {
      c = allocateRegional(c, { fatMassKg: fm ?? 0, skeletalMuscleKg: sm ?? 0 });
      const t = regionalTotals(c);
      expect(t.fatKg).toBeCloseTo(fm ?? 0, 10);
      expect(t.muscleKg).toBeCloseTo(sm ?? 0, 10);
      for (const v of Object.values(c.fat)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(c.muscle)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not mutate its input', () => {
    const c = start();
    const copy = structuredClone(c);
    allocateRegional(c, { fatMassKg: 10, skeletalMuscleKg: 30 });
    expect(c).toEqual(copy);
  });

  it('is step-size invariant (one call vs 80 daily calls)', () => {
    const c0 = start();
    const fm0 = regionalTotals(c0).fatKg;
    const sm0 = regionalTotals(c0).muscleKg;
    const once = allocateRegional(c0, { fatMassKg: fm0 - 8, skeletalMuscleKg: sm0 - 1 });
    let daily = c0;
    for (let d = 1; d <= 80; d++) daily = allocateRegional(daily, { fatMassKg: fm0 - (8 * d) / 80, skeletalMuscleKg: sm0 - d / 80 });
    for (const k of Object.keys(once.fat) as (keyof typeof once.fat)[]) expect(once.fat[k]).toBeCloseTo(daily.fat[k], 3);
  });

  it('VAT loses the largest and limbs the smallest relative share on loss; legs gain most on gain', () => {
    const c0 = start();
    const fm0 = regionalTotals(c0).fatKg;
    const sm = regionalTotals(c0).muscleKg;
    const loss = allocateRegional(c0, { fatMassKg: fm0 - 3, skeletalMuscleKg: sm });
    const rel = (k: keyof RegionalComposition['fat'], c: RegionalComposition) => c.fat[k] / c0.fat[k] - 1;
    expect(rel('vatKg', loss)).toBeLessThan(rel('trunkSatKg', loss));
    expect(rel('trunkSatKg', loss)).toBeLessThan(rel('headKg', loss));
    expect(rel('headKg', loss)).toBeLessThan(rel('legsKg', loss));
    const gain = allocateRegional(c0, { fatMassKg: fm0 + 3, skeletalMuscleKg: sm });
    expect(rel('legsKg', gain)).toBeGreaterThan(rel('trunkSatKg', gain));
    expect(K_LOSS.vatKg).toBe(1.3);
    expect(K_GAIN.legsKg).toBe(1.15);
  });

  it('an externally supplied VAT is honoured and the rest is allocated to the other depots', () => {
    const c0 = start();
    const fm0 = regionalTotals(c0).fatKg;
    const c = allocateRegional(c0, { fatMassKg: fm0 - 2, skeletalMuscleKg: regionalTotals(c0).muscleKg, vatKg: 2.0 });
    expect(c.fat.vatKg).toBe(2.0);
    expect(regionalTotals(c).fatKg).toBeCloseTo(fm0 - 2, 10);
  });

  it('lambda (spot bias, capped at 0.10) makes a trained region lose slightly more', () => {
    const c0 = start();
    const t = { fatMassKg: regionalTotals(c0).fatKg - 4, skeletalMuscleKg: regionalTotals(c0).muscleKg };
    const none = allocateRegional(c0, t);
    const spot = allocateRegional(c0, t, { lambda: 0.5, trainedShare: { armsKg: 1 } });
    const capped = allocateRegional(c0, t, { lambda: 0.1, trainedShare: { armsKg: 1 } });
    expect(spot.fat.armsKg).toBeLessThan(none.fat.armsKg);
    expect(spot.fat.armsKg).toBeCloseTo(capped.fat.armsKg, 12);
    // "a few percentage points at most": < 1.5 pp extra relative arm loss
    expect(none.fat.armsKg / c0.fat.armsKg - spot.fat.armsKg / c0.fat.armsKg).toBeLessThan(0.015);
  });

  it('muscle change is shared by current mass x optional weights', () => {
    const c0 = start();
    const sm0 = regionalTotals(c0).muscleKg;
    const p = allocateRegional(c0, { fatMassKg: regionalTotals(c0).fatKg, skeletalMuscleKg: sm0 + 2 });
    expect(p.muscle.armsKg / p.muscle.legsKg).toBeCloseTo(c0.muscle.armsKg / c0.muscle.legsKg, 10);
    const w = allocateRegional(c0, { fatMassKg: regionalTotals(c0).fatKg, skeletalMuscleKg: sm0 + 2 }, { muscleWeights: { armsKg: 3, legsKg: 1, trunkKg: 1 } });
    expect(w.muscle.armsKg - c0.muscle.armsKg).toBeGreaterThan(p.muscle.armsKg - c0.muscle.armsKg);
    expect(regionalTotals(w).muscleKg).toBeCloseTo(sm0 + 2, 10);
  });

  it('regains from zero fat without NaN', () => {
    const c0 = start();
    const empty = allocateRegional(c0, { fatMassKg: 0, skeletalMuscleKg: 30 });
    expect(regionalTotals(empty).fatKg).toBe(0);
    const back = allocateRegional(empty, { fatMassKg: 3, skeletalMuscleKg: 30 });
    expect(regionalTotals(back).fatKg).toBeCloseTo(3, 10);
    for (const v of Object.values(back.fat)) expect(Number.isFinite(v)).toBe(true);
  });
});
