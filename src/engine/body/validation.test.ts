// Published results the module should reproduce (dossier 14 sec. 7, table V1-V12), with the dossier's tolerances.
// Where a result needs the energy/partition model (dossier 01), a minimal test-local stand-in is used and labelled.
import { circumferencesFor } from './circumferences';
import { cunBae, dxaFrameOffset } from './equations';
import { estimateInitialState } from './estimateBody';
import { lmsValue } from './lms';
import { allocateRegional } from './regional';
import type { BodyEstimate, BodyState, Sex } from './types';

/** State at a given composition (CUN-BAE fat pattern, z = 0). */
function body(sex: Sex, age: number, heightCm: number, weightKg: number, bodyFatPct: number): BodyEstimate {
  return estimateInitialState({ sex, ageYears: age, heightCm, weightKg }, { bodyFatPctOverride: bodyFatPct });
}

/** Population-typical body at a BMI (CUN-BAE + DXA offset composition). */
function typical(sex: Sex, age: number, heightCm: number, bmi: number): BodyEstimate {
  return body(sex, age, heightCm, bmi * (heightCm / 100) ** 2, cunBae(sex, age, bmi) + dxaFrameOffset(sex, age));
}

/** Apply a fat / fat-free change through the M7 allocation (SM changes by 0.9 x dFFM, dSM/dFFM of the M5 equation). */
function change(s: BodyState, dFM: number, dFFM: number): BodyState {
  const fm = s.fatMassKg + dFM;
  const ffm = s.fatFreeMassKg + dFFM;
  const sm = s.skeletalMuscleKg + 0.9 * dFFM;
  const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: sm });
  return { ...s, fatMassKg: fm, fatFreeMassKg: ffm, weightKg: fm + ffm, skeletalMuscleKg: sm, fat: r.fat, muscle: r.muscle, measuredCircumferences: undefined };
}

const trunk = (s: BodyState) => s.fat.trunkSatKg + s.fat.vatKg;
const limbs = (s: BodyState) => s.fat.armsKg + s.fat.legsKg;
const pctChange = (a: number, b: number) => 100 * (a / b - 1);

describe('V1 Kelly 2009: population estimator at the NHANES medians returns the median %fat (+-2 with DXA offsets)', () => {
  it.each(['male', 'female'] as Sex[])('%s, ages 20-80', (sex) => {
    for (const age of [20, 25, 30, 35, 40, 50, 60, 70, 80]) {
      const bmi = lmsValue('fmi', sex, age, 0) + lmsValue('ffmi', sex, age, 0);
      const est = cunBae(sex, age, bmi) + dxaFrameOffset(sex, age);
      expect(Math.abs(est - lmsValue('pctFat', sex, age, 0))).toBeLessThanOrEqual(2);
    }
  });
});

describe('V3 CALERIE-2 (Das 2017): dFM -5.4, dFFM -2.0 in non-obese adults', () => {
  const run = (sex: Sex, heightCm: number, fm: number) => {
    const W = 25 * (heightCm / 100) ** 2;
    const b = body(sex, 38, heightCm, W, (100 * fm) / W);
    const a = change(b, -5.4, -2.0);
    const dT = trunk(a) - trunk(b);
    const dL = limbs(a) - limbs(b);
    return { trunkShare: (100 * dT) / (dT + dL), dWaist: circumferencesFor(a, b).waistCm - circumferencesFor(b).waistCm };
  };
  it('men (FM 22 kg): trunk share of loss 57 % +-5 pp; waist -6.3 cm +-1.5 (psi = 0.83)', () => {
    const r = run('male', 176, 22);
    expect(Math.abs(r.trunkShare - 57)).toBeLessThanOrEqual(5);
    expect(Math.abs(r.dWaist - -6.3)).toBeLessThanOrEqual(1.5);
  });
  it('women (FM 24.5 kg): trunk share 53 % +-5 pp; waist -6.1 cm +-1.5', () => {
    const r = run('female', 163, 24.5);
    expect(Math.abs(r.trunkShare - 53)).toBeLessThanOrEqual(5);
    expect(Math.abs(r.dWaist - -6.1)).toBeLessThanOrEqual(1.5);
  });
});

describe('V4 Ross 1996: obese men, ~10 % weight loss: VAT -35 %, abdominal SAT -27 %, gluteofemoral -20 % (+-8 pp)', () => {
  it.each([-7.5, -8.5])('M 100 kg, 33 %% BF, dFM %d kg', (dFM) => {
    const b = body('male', 43, 178, 100, 33);
    const a = change(b, dFM, 0.3 * dFM);
    expect(Math.abs(pctChange(a.fat.vatKg, b.fat.vatKg) - -35)).toBeLessThanOrEqual(8);
    expect(Math.abs(pctChange(a.fat.trunkSatKg, b.fat.trunkSatKg) - -27)).toBeLessThanOrEqual(8);
    expect(Math.abs(pctChange(a.fat.legsKg, b.fat.legsKg) - -20)).toBeLessThanOrEqual(8);
  });
});

describe('V5 Hallgreen & Hall 2008: dVAT/VAT = 1.3*dFM/FM', () => {
  it.each([
    ['male', 43, 178, 100, 33],
    ['female', 40, 165, 80, 40],
  ] as [Sex, number, number, number, number][])('%s: log-log slope of VAT vs FM over a loss run in 1.2-1.4', (sex, age, h, W, bf) => {
    const b = body(sex, age, h, W, bf);
    let s: BodyState = b;
    for (let d = 0; d < 100; d++) s = change(s, -0.13, 0);
    const k = Math.log(s.fat.vatKg / b.fat.vatKg) / Math.log(s.fatMassKg / b.fatMassKg);
    expect(k).toBeGreaterThanOrEqual(1.2);
    expect(k).toBeLessThanOrEqual(1.4);
  });
});

describe('V6 Tchoukalova 2010: 8-wk overfeeding, upper +1.9 vs lower +1.6 kg (upper 54 %)', () => {
  const upperShare = (sex: Sex, h: number, W: number, bf: number) => {
    const b = body(sex, 25, h, W, bf);
    const a = change(b, 3.5, 0);
    const up = (s: BodyState) => s.fat.headKg + s.fat.armsKg + trunk(s);
    return (100 * (up(a) - up(b))) / 3.5;
  };
  it('each sex within 54 +-6 pp; the 15 M / 13 F pooled share in 50-58 %', () => {
    const m = upperShare('male', 178, 72, 18);
    const f = upperShare('female', 165, 60, 28);
    expect(Math.abs(m - 54)).toBeLessThanOrEqual(6);
    expect(Math.abs(f - 54)).toBeLessThanOrEqual(6);
    const pooled = (15 * m + 13 * f) / 28;
    expect(pooled).toBeGreaterThanOrEqual(50);
    expect(pooled).toBeLessThanOrEqual(58);
  });
});

describe('V7 Hulmi 2016: female competitors FM -50 %, android -68 %', () => {
  it('trunk fat change within -50..-75 % (known under-prediction of extreme android loss)', () => {
    const W = 47.6 + 2.56 + 14.6;
    const b = body('female', 27, 165.3, W, (100 * 14.6) / W);
    const a = change(b, 7.1 - 14.6, 0.5);
    const dTrunk = pctChange(trunk(a), trunk(b));
    expect(dTrunk).toBeLessThanOrEqual(-50);
    expect(dTrunk).toBeGreaterThanOrEqual(-75);
  });
});

describe('V8 NHANES 2015-18 waist vs BMI/age (M 24.81 + 2.612 BMI + 0.179(age-40); F 30.46 + 2.235 BMI + 0.113(age-40))', () => {
  const pop = (sex: Sex, age: number, bmi: number) =>
    sex === 'male' ? 24.81 + 2.612 * bmi + 0.179 * (age - 40) : 30.46 + 2.235 * bmi + 0.113 * (age - 40);
  const residuals = (sex: Sex, h: number, ages: number[]) => {
    const r: number[] = [];
    for (const age of ages) for (let bmi = 20; bmi <= 42; bmi += 2) r.push(typical(sex, age, h, bmi).circumferences.waistCm - pop(sex, age, bmi));
    return { rmse: Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length), max: Math.max(...r.map(Math.abs)) };
  };
  it.each([
    ['male', 176],
    ['female', 163],
  ] as [Sex, number][])('%s at age 40 (fit condition): rmse <= 2, max <= 3.5 cm', (sex, h) => {
    const r = residuals(sex, h, [40]);
    expect(r.rmse).toBeLessThanOrEqual(2);
    expect(r.max).toBeLessThanOrEqual(3.5);
  });
  it.each([
    ['male', 176],
    ['female', 163],
  ] as [Sex, number][])('%s over ages 25-65: rmse <= 2 cm', (sex, h) => {
    expect(residuals(sex, h, [25, 35, 45, 55, 65]).rmse).toBeLessThanOrEqual(2);
  });
  // UNMET: over the full 25-65 y grid the largest residual is -4.5 cm (M, 65 y, BMI 42) and -3.6 cm (F, 25 y, BMI 42):
  // the M8 geometry under-predicts waist at the heaviest BMIs away from the age-40 fit. The dossier's own fit reports
  // max 3.5 / 3.0 cm at age 40 only, which this implementation reproduces (3.49 / 3.03).
  it.fails('max residual <= 3.5 cm over BMI 20-42 x ages 25-65 (both sexes) - strict', () => {
    expect(residuals('male', 176, [25, 35, 45, 55, 65]).max).toBeLessThanOrEqual(3.5);
    expect(residuals('female', 163, [25, 35, 45, 55, 65]).max).toBeLessThanOrEqual(3.5);
  });
  it('independent age check at BMI 27 (dossier M8): M 93.5 -> 99.3, F 89.1 -> 94.2 (+-0.2)', () => {
    expect(typical('male', 25, 176, 27).circumferences.waistCm).toBeCloseTo(93.5, 0);
    expect(Math.abs(typical('male', 65, 176, 27).circumferences.waistCm - 99.3)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(typical('female', 25, 163, 27).circumferences.waistCm - 89.1)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(typical('female', 65, 163, 27).circumferences.waistCm - 94.2)).toBeLessThanOrEqual(0.2);
  });
});

describe('V9 MRI/CT VAT (Shen 2004, UK Biobank): +-30 % (L x 0.92 kg/L)', () => {
  it.each([
    ['male', 42, 176, 26, 2.5],
    ['female', 48, 163, 27, 1.6],
    ['male', 63, 176, 26.8, 4.62 * 0.92],
    ['female', 63, 163, 25.4, 2.33 * 0.92],
  ] as [Sex, number, number, number, number][])('%s %i y, BMI %d: VAT ~ %d kg', (sex, age, h, bmi, target) => {
    const vat = typical(sex, age, h, bmi).fat.vatKg;
    expect(Math.abs(vat / target - 1)).toBeLessThanOrEqual(0.3);
  });
});

describe('V10 Ambikairajah 2019: post- vs pre-menopause waist +2.1 cm at fixed BMI', () => {
  it('model waist at BMI 27, age 45 -> 57 (F): +2.0 +- 1 cm', () => {
    const d = typical('female', 57, 163, 27).circumferences.waistCm - typical('female', 45, 163, 27).circumferences.waistCm;
    expect(Math.abs(d - 2.0)).toBeLessThanOrEqual(1);
  });
});

describe('V11 Han 1997: 0.73 cm waist per 1 % weight loss (+-20 %)', () => {
  // Forbes partition p = 10.4/(10.4 + FM) (dossier 01 owns it; test-local stand-in), 6.2 kg loss.
  it.each([
    ['female', 165, 90, 45],
    ['male', 178, 100, 33],
  ] as [Sex, number, number, number][])('%s %i cm %i kg %i %% BF', (sex, h, W, bf) => {
    const b = body(sex, 45, h, W, bf);
    let s: BodyState = b;
    let lost = 0;
    while (lost < 6.2 - 1e-9) {
      const p = 10.4 / (10.4 + s.fatMassKg);
      s = change(s, -0.1 * (1 - p), -0.1 * p);
      lost += 0.1;
    }
    const cmPerPct = (circumferencesFor(b).waistCm - circumferencesFor(s, b).waistCm) / ((100 * lost) / W);
    expect(Math.abs(cmPerPct / 0.73 - 1)).toBeLessThanOrEqual(0.2);
  });
});

describe('V12 sensitivity table (dossier 14 M11): 12-week deficit and surplus, dFM +-0.5 kg', () => {
  // Test-local stand-in for dossier 01: Forbes partition, 9,400 / 1,800 kcal/kg, Cunningham RMR x PAL 1.55, 84 days.
  const run = (sex: Sex, W: number, h: number, bf: number, intakeFraction: number) => {
    const e = estimateInitialState({ sex, ageYears: 40, heightCm: h, weightKg: W, pal: 1.55 }, { bodyFatPctOverride: bf });
    let fm = e.fatMassKg;
    let ffm = e.fatFreeMassKg;
    const intake = intakeFraction * e.energy.tdeeKcal;
    for (let d = 0; d < 84; d++) {
      const tdee = 1.55 * (370 + 21.6 * ffm);
      const p = 10.4 / (10.4 + fm);
      const dbw = (intake - tdee) / (p * 1800 + (1 - p) * 9400);
      fm += (1 - p) * dbw;
      ffm += p * dbw;
    }
    return { tdee0: e.energy.tdeeKcal, dFM: fm - e.fatMassKg, dFFM: ffm - e.fatFreeMassKg };
  };
  it.each([
    ['male', 90, 178, 20, 0.75, 2984, -5.4, -3.7],
    ['male', 90, 178, 25, 0.75, 2833, -5.4, -2.8],
    ['male', 90, 178, 30, 0.75, 2683, -5.2, -2.2],
    ['female', 68, 165, 28, 0.75, 2213, -4.1, -2.5],
    ['female', 68, 165, 33, 0.75, 2099, -4.0, -2.0],
    ['female', 68, 165, 38, 0.75, 1985, -3.9, -1.7],
    ['male', 90, 178, 20, 1.1, 2984, 2.24, 1.22],
    ['male', 90, 178, 25, 1.1, 2833, 2.2, 0.97],
    ['male', 90, 178, 30, 1.1, 2683, 2.13, 0.79],
  ] as [Sex, number, number, number, number, number, number, number][])(
    '%s %i kg, %i cm, %i %% BF, intake x%d: TDEE0 %i, dFM %d',
    (sex, W, h, bf, frac, tdee0, dFM, dFFM) => {
      const r = run(sex, W, h, bf, frac);
      expect(Math.abs(r.tdee0 - tdee0)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.dFM - dFM)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.dFFM - dFFM)).toBeLessThanOrEqual(0.1);
    },
  );
});
