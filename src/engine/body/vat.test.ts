// D1-02: VAT allometry transition (loss prior k = 1.3; gain = labelled symmetric hypothesis), bounds and step-split invariance.
import { describe, expect, it } from 'vitest';
import { estimateInitialState } from './estimateBody';
import { allocateRegional, regionalTotals, VAT_ALLOMETRY, vatTransition } from './regional';

describe('vatTransition (D1-02)', () => {
  it('loss follows VAT·(FM_next/FM)^1.3 and is invariant to how the change is split into steps', () => {
    const once = vatTransition(3, 30, 20);
    expect(once).toBeCloseTo(3 * Math.pow(20 / 30, 1.3), 12);
    let v = 3;
    let fm = 30;
    for (let i = 1; i <= 10; i++) {
      const next = 30 - i;
      v = vatTransition(v, fm, next);
      fm = next;
    }
    expect(v).toBeCloseTo(once, 12);
  });

  it('gain uses the separately labelled hypothesis exponent (not loss evidence)', () => {
    expect(VAT_ALLOMETRY.gainWarrant).toBe('assumedSymmetricHypothesis');
    expect(vatTransition(2, 20, 25)).toBeCloseTo(2 * Math.pow(25 / 20, VAT_ALLOMETRY.kGain), 12);
    expect(vatTransition(2, 20, 25, 1.3, 1.0)).toBeCloseTo(2.5, 12);
  });

  it('stays within [0, FM_next]; a zero-FM boundary is the model limit VAT = 0 (no division by zero)', () => {
    expect(vatTransition(5, 5, 6)).toBeLessThanOrEqual(6);
    expect(vatTransition(5, 5.2, 5.2)).toBe(5);
    expect(vatTransition(6, 5, 5)).toBe(5);
    expect(vatTransition(2, 0, 3)).toBe(0);
    expect(vatTransition(2, 10, 0)).toBe(0);
    expect(vatTransition(0, 10, 12)).toBe(0);
    for (const x of [vatTransition(2, -1, 3), vatTransition(2, 10, -1), vatTransition(Number.NaN, 10, 9)]) expect(Number.isFinite(x)).toBe(true);
  });

  it('allocation with the explicit VAT closes total fat: other depots carry FM − VAT', () => {
    const e = estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 95, waistCm: 102 });
    const fm0 = regionalTotals(e).fatKg;
    const fm1 = fm0 - 6;
    const vat = vatTransition(e.fat.vatKg, fm0, fm1);
    const c = allocateRegional({ fat: e.fat, muscle: e.muscle }, { fatMassKg: fm1, skeletalMuscleKg: e.skeletalMuscleKg, vatKg: vat });
    expect(c.fat.vatKg).toBe(vat);
    expect(regionalTotals(c).fatKg).toBeCloseTo(fm1, 10);
  });
});
