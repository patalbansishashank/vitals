// Golden function values from dossier 14 sec. 7 ("must match to the printed decimals").
import { cunBae, deurenberg1991, dxaFrameOffset, gallagher2000, jacksonPollock3, navyInches, navyMetric, rfm, ETHNICITY_ADJUSTMENTS } from './equations';
import { SIGMA_EQ, SIGMA_RFM } from './estimateBody';

/** |actual - printed| <= one unit of the printed last digit. */
function near(actual: number, printed: string): void {
  const dec = printed.includes('.') ? (printed.split('.')[1] ?? '').length : 0;
  expect(Math.abs(actual - Number(printed))).toBeLessThanOrEqual(10 ** -dec + 1e-9);
}

describe('population estimators (dossier 14 M1, golden values sec. 7)', () => {
  it('CUN-BAE', () => {
    near(cunBae('male', 30, 25), '22.09');
    near(cunBae('female', 30, 25), '34.18');
    near(cunBae('male', 60, 30), '32.29');
    near(cunBae('female', 60, 30), '43.91');
  });

  it('RFM', () => {
    near(rfm('male', 175, 90), '25.11');
    near(rfm('female', 165, 80), '34.75');
  });

  it('Deurenberg 1991', () => {
    near(deurenberg1991('male', 30, 25), '20.70');
    near(deurenberg1991('female', 30, 25), '31.50');
  });

  it('US Navy, inch and metric forms', () => {
    near(navyInches('male', 178, 90, 38), '20.27');
    near(navyMetric('male', 178, 90, 38), '20.15');
    near(navyInches('female', 165, 75, 33, 100), '29.74');
    near(navyMetric('female', 165, 75, 33, 100), '29.43');
  });

  it('Gallagher 2000 (as printed in Woolcott 2018) at BMI 18.5-25, age 30', () => {
    near(gallagher2000('male', 30, 18.5), '8.2');
    near(gallagher2000('male', 30, 25), '19.6');
    near(gallagher2000('female', 30, 18.5), '21.0');
    near(gallagher2000('female', 30, 25), '33.0');
  });

  it('Jackson-Pollock 3-site is in a plausible range (validation-only helper)', () => {
    const bf = jacksonPollock3('male', 30, 45);
    expect(bf).toBeGreaterThan(8);
    expect(bf).toBeLessThan(20);
  });
});

describe('DXA-frame offset (dossier 14 M1)', () => {
  it('matches the table and interpolates linearly, clamped outside 20-60 y', () => {
    near(dxaFrameOffset('male', 20), '2.8');
    near(dxaFrameOffset('male', 35), '0.90');
    near(dxaFrameOffset('female', 45), '0.95');
    expect(dxaFrameOffset('male', 18)).toBe(2.8);
    expect(dxaFrameOffset('female', 85)).toBe(0.4);
    expect(dxaFrameOffset('male', 70)).toBe(0);
  });
});

describe('V2: Woolcott 2018 NHANES residual SDs', () => {
  it('assumed fusion sigmas stay >= the NHANES-derived SDs (RFM 3.1-3.6, CUN-BAE 4.2-4.4)', () => {
    expect(SIGMA_RFM).toBeGreaterThanOrEqual(3.6);
    expect(SIGMA_EQ).toBeGreaterThanOrEqual(4.4);
  });
  it('ethnic offsets follow the M1 bias table', () => {
    expect(ETHNICITY_ADJUSTMENTS.eastAsian.bfOffsetPct.male).toBe(3.5);
    expect(ETHNICITY_ADJUSTMENTS.southeastAsian.bfOffsetPct.female).toBe(4.0);
    expect(ETHNICITY_ADJUSTMENTS.southAsian.bfOffsetPct.male).toBe(5.0);
    expect(ETHNICITY_ADJUSTMENTS.black.bfOffsetPct.male).toBe(-2.0);
    expect(ETHNICITY_ADJUSTMENTS.black.sigmaMultiplier).toBe(1.2);
  });
});
