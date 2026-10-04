import { cmToIn, inToCm, kgToLb, lbToKg } from '@/lib/units';
import {
  KJ_PER_KCAL,
  MGDL_PER_MMOL,
  displayMeasure,
  energyIn,
  energyToKcal,
  labFromDisplay,
  labToDisplay,
  lengthScale,
  roundTo,
  sameDisplayed,
  waistRange,
} from '../units';

describe('display units (stored SI, shown metric or imperial)', () => {
  it('rounds to a step without binary noise', () => {
    expect(roundTo(70.26, 0.5)).toBe(70.5);
    expect(roundTo(70.24, 0.5)).toBe(70);
    expect(roundTo(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundTo(187.17, 0.1)).toBe(187.2);
    expect(roundTo(2 * 1.005, 0.01)).toBe(2.01);
  });

  it('shows mass at 0.1 kg / 0.1 lb and never drifts on a round trip', () => {
    for (const kg of [35, 50.05, 84.9, 99.99, 136.078, 250]) {
      const lb = displayMeasure('mass', 'imperial', kg);
      expect(lb).toBeCloseTo(kgToLb(kg), 1);
      // re-entering the shown number is recognised as "no change"
      expect(sameDisplayed('mass', 'imperial', kg, lbToKg(lb))).toBe(true);
      // one display step is a change
      expect(sameDisplayed('mass', 'imperial', kg, lbToKg(lb + 0.2))).toBe(false);
    }
    expect(displayMeasure('mass', 'imperial', 84.9)).toBe(187.2);
    expect(displayMeasure('mass', 'metric', 84.94999)).toBe(84.9);
  });

  it('shows height in whole cm or whole inches (feet + inches), across the range edges', () => {
    expect(displayMeasure('height', 'metric', 177.5)).toBe(178);
    expect(displayMeasure('height', 'imperial', 182.88)).toBe(72); // 6 ft 0 in exactly
    expect(displayMeasure('height', 'imperial', 140)).toBe(55); // 4 ft 7 in (spec lower bound)
    expect(displayMeasure('height', 'imperial', 210)).toBe(83); // 6 ft 11 in (spec upper bound)
    expect(sameDisplayed('height', 'imperial', 178, inToCm(70))).toBe(true); // 178 cm shows as 5 ft 10 in
    expect(sameDisplayed('height', 'metric', 178.4, 178)).toBe(true);
    expect(sameDisplayed('height', 'metric', null, 178)).toBe(false);
  });

  it('waist scale: cm, or inches at 0.5 in; 55–160 cm ≈ 22–63 in', () => {
    const imp = lengthScale('imperial');
    expect(imp.unit).toBe('in');
    expect(imp.toDisplay(92.3)).toBe(36.5); // 36.34 in → 36.5
    expect(imp.toMetric(36.5)).toBeCloseTo(92.71, 2);
    expect(lengthScale('metric').toDisplay(92.3)).toBe(92.3);
    const [lo, hi] = waistRange('imperial');
    expect(cmToIn(55)).toBeGreaterThan(lo - 0.5);
    expect(cmToIn(160)).toBeLessThan(hi + 0.5);
  });

  it('energy in kcal or kJ', () => {
    expect(energyIn(2540, 'kcal')).toBe(2540);
    expect(energyIn(1000, 'kJ')).toBeCloseTo(4184, 6);
    expect(energyToKcal(energyIn(2537.4, 'kJ'), 'kJ')).toBeCloseTo(2537.4, 9);
    expect(KJ_PER_KCAL).toBe(4.184);
  });

  it('lab values convert both ways (mmol/L ↔ mg/dL, g/L ↔ mg/dL)', () => {
    expect(labToDisplay('glucose', 5.5, 'mgdl', 'kcal')).toBeCloseTo(99.1, 1);
    expect(labToDisplay('cholesterol', 3.0, 'mgdl', 'kcal')).toBeCloseTo(116.0, 1);
    expect(labToDisplay('triglyceride', 1.7, 'mgdl', 'kcal')).toBeCloseTo(150.6, 1);
    expect(labToDisplay('apoB', 0.9, 'mgdl', 'kcal')).toBeCloseTo(90, 9);
    expect(labToDisplay('none', 7.2, 'mgdl', 'kcal')).toBe(7.2); // HbA1c % never converts
    expect(labToDisplay('glucose', 5.5, 'mmol', 'kcal')).toBe(5.5);
    for (const conv of ['glucose', 'cholesterol', 'triglyceride', 'apoB'] as const) {
      expect(labFromDisplay(conv, labToDisplay(conv, 2.345, 'mgdl', 'kcal'), 'mgdl', 'kcal')).toBeCloseTo(2.345, 12);
    }
    expect(labFromDisplay('energy', labToDisplay('energy', 1800, 'mmol', 'kJ'), 'mmol', 'kJ')).toBeCloseTo(1800, 9);
    expect(MGDL_PER_MMOL.glucose).toBeCloseTo(18.016, 3);
  });
});
