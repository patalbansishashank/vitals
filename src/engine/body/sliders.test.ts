// Slider helpers (dossier 14 M2/M3): anchors, forward/inverse maps, defaults, T2 table reproduction.
import { typicalIndicesAtBodyFat } from './anchors';
import { cunBae, dxaFrameOffset, rfm } from './equations';
import { estimateInitialState } from './estimateBody';
import {
  FAT_ANCHORS,
  FFMI_ANCHORS,
  adiposityAnchorTable,
  bellySliderToZ,
  bodyFatToSlider,
  defaultSliderPositions,
  ffmiToSlider,
  liveEstimate,
  muscularityAnchorTable,
  sliderTo,
  sliderToBodyFat,
  sliderToFfmi,
  slidersFromEstimate,
  toSlider,
  visualImpliedWeight,
  zToBellySlider,
} from './sliders';
import type { Sex } from './types';

function near(actual: number, printed: string): void {
  const dec = printed.includes('.') ? (printed.split('.')[1] ?? '').length : 0;
  expect(Math.abs(actual - Number(printed))).toBeLessThanOrEqual(10 ** -dec + 1e-9);
}

describe('anchors and piecewise-linear maps', () => {
  it('8 stops, equally spaced, as in T2/T3', () => {
    expect(FAT_ANCHORS.male).toEqual([6, 10, 15, 20, 25, 30, 35, 42]);
    expect(FAT_ANCHORS.female).toEqual([14, 18, 22, 27, 32, 38, 45, 52]);
    expect(FFMI_ANCHORS.male).toEqual([16.5, 18.0, 19.5, 21.0, 22.5, 24.0, 25.0, 27.0]);
    expect(FFMI_ANCHORS.female).toEqual([13.5, 14.5, 16.0, 17.3, 18.5, 19.5, 20.5, 22.0]);
    FAT_ANCHORS.male.forEach((v, k) => expect(sliderTo(FAT_ANCHORS.male, k / 7)).toBeCloseTo(v, 12));
  });

  it('forward/inverse consistency: toSlider(sliderTo(s)) = s and sliderTo(toSlider(v)) = v', () => {
    for (const sex of ['male', 'female'] as Sex[]) {
      for (let s = 0; s <= 1.0001; s += 0.01) {
        expect(bodyFatToSlider(sex, sliderToBodyFat(sex, s))).toBeCloseTo(Math.min(s, 1), 10);
        expect(ffmiToSlider(sex, sliderToFfmi(sex, s))).toBeCloseTo(Math.min(s, 1), 10);
      }
      const [lo, hi] = [FAT_ANCHORS[sex][0] ?? 0, FAT_ANCHORS[sex][7] ?? 0];
      for (let v = lo; v <= hi; v += 0.37) expect(sliderToBodyFat(sex, bodyFatToSlider(sex, v))).toBeCloseTo(v, 10);
    }
    expect(toSlider(FAT_ANCHORS.male, 2)).toBe(0);
    expect(toSlider(FAT_ANCHORS.male, 60)).toBe(1);
    expect(bellySliderToZ(zToBellySlider(-1.3))).toBeCloseTo(-1.3, 12);
    expect(zToBellySlider(5)).toBe(1);
  });

  it('slider maps are monotonic', () => {
    let prev = -Infinity;
    for (let s = 0; s <= 1.0001; s += 0.02) {
      const v = sliderToBodyFat('female', s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('T2 adiposity anchor table (dossier 14 M2; reference heights 1.77 / 1.63 m, age 30)', () => {
  // [BF, FMI, FFMI typ, BMI typ, wt, WC, RFM(WC), CUN-BAE(BMI), FFMI ath, BMI ath, WC ath]
  const T2: Record<Sex, string[][]> = {
    male: [
      ['6', '1.1', '17.3', '18.4', '58', '69', '12.4', '12.3', '20.7', '22.0', '72'],
      ['10', '2.0', '17.7', '19.6', '62', '73', '15.4', '14.5', '21.1', '23.5', '77'],
      ['15', '3.2', '18.2', '21.4', '67', '79', '18.9', '17.6', '21.7', '25.6', '83'],
      ['20', '4.7', '18.8', '23.5', '73', '85', '22.3', '21.1', '22.4', '28.0', '91'],
      ['25', '6.5', '19.5', '26.0', '81', '92', '25.5', '25.1', '23.3', '31.1', '98'],
      ['30', '8.7', '20.4', '29.1', '91', '100', '28.6', '29.8', '24.4', '34.8', '108'],
      ['35', '11.6', '21.5', '33.1', '104', '110', '31.7', '35.2', '25.7', '39.6', '118'],
      ['42', '17.2', '23.8', '41.0', '128', '126', '35.9', '43.9', '28.4', '49.0', '136'],
    ],
    female: [
      ['14', '2.4', '14.6', '16.9', '45', '62', '23.6', '22.5', '17.7', '20.5', '66'],
      ['18', '3.2', '14.7', '18.0', '48', '66', '26.4', '24.5', '17.9', '21.8', '70'],
      ['22', '4.2', '15.0', '19.2', '51', '69', '29.0', '26.7', '18.1', '23.3', '74'],
      ['27', '5.6', '15.3', '20.9', '56', '74', '32.2', '29.7', '18.5', '25.3', '80'],
      ['32', '7.3', '15.6', '23.0', '61', '80', '35.3', '33.2', '18.9', '27.9', '86'],
      ['38', '9.9', '16.1', '26.0', '69', '88', '38.9', '37.9', '19.6', '31.6', '95'],
      ['45', '13.9', '17.0', '30.9', '82', '99', '43.0', '44.5', '20.6', '37.5', '107'],
      ['52', '19.7', '18.2', '37.9', '101', '113', '47.1', '51.9', '22.1', '46.0', '123'],
    ],
  };
  it.each(['male', 'female'] as Sex[])('%s rows reproduce every printed column', (sex) => {
    const H = sex === 'male' ? 177 : 163;
    const h2 = (H / 100) ** 2;
    for (const row of T2[sex]) {
      const [bfS, fmiS, ffmiS, bmiS, wtS, wcS, rfmS, cunS, ffmiAthS, bmiAthS, wcAthS] = row as [string, string, string, string, string, string, string, string, string, string, string];
      const bf = Number(bfS);
      const t = typicalIndicesAtBodyFat(sex, bf);
      const ta = typicalIndicesAtBodyFat(sex, bf, true);
      near(t.fmi, fmiS);
      near(t.ffmi, ffmiS);
      near(t.fmi + t.ffmi, bmiS);
      near(h2 * (t.fmi + t.ffmi), wtS);
      const wc = estimateInitialState({ sex, ageYears: 30, heightCm: H, weightKg: h2 * (t.fmi + t.ffmi) }, { bodyFatPctOverride: bf }).circumferences.waistCm;
      near(wc, wcS);
      near(rfm(sex, H, wc), rfmS);
      near(cunBae(sex, 30, t.fmi + t.ffmi) + dxaFrameOffset(sex, 30), cunS);
      near(ta.ffmi, ffmiAthS);
      near(ta.fmi + ta.ffmi, bmiAthS);
      const wcAth = estimateInitialState({ sex, ageYears: 30, heightCm: H, weightKg: h2 * (ta.fmi + ta.ffmi) }, { bodyFatPctOverride: bf }).circumferences.waistCm;
      near(wcAth, wcAthS);
    }
  });

  it('CUN-BAE at the athletic BMIs over-estimates lean athletes: 18.7/21.1/24.5/28.2/32.5 (M 6-25 %), 29.1/31.3 (F 14/18 %)', () => {
    const m = [22.0, 23.5, 25.6, 28.0, 31.1].map((b) => cunBae('male', 30, b) + dxaFrameOffset('male', 30));
    ['18.7', '21.1', '24.5', '28.2', '32.5'].forEach((p, k) => near(m[k] ?? Number.NaN, p));
    const f = [20.5, 21.8].map((b) => cunBae('female', 30, b) + dxaFrameOffset('female', 30));
    ['29.1', '31.3'].forEach((p, k) => near(f[k] ?? Number.NaN, p));
  });

  it('UI tables carry descriptors, typical indices and percentiles', () => {
    const rows = adiposityAnchorTable('female', 30);
    expect(rows).toHaveLength(8);
    expect(rows[0]?.descriptor).toMatch(/contest/i);
    expect(rows[3]?.percentile).toBeCloseTo(8, -0.5);
    const mus = muscularityAnchorTable('male');
    expect(mus[6]?.ffmi).toBe(25);
    expect(Math.abs((mus[6]?.percentile ?? 0) - 95)).toBeLessThanOrEqual(1);
  });

  it('visual implied weight equals the T2 weight column for typical rows (+-1 kg)', () => {
    near(visualImpliedWeight('male', 177, bodyFatToSlider('male', 25)), '81');
    near(visualImpliedWeight('female', 163, bodyFatToSlider('female', 38), ffmiToSlider('female', 16.1)), '69');
  });
});

describe('defaults and forward/inverse helpers', () => {
  it('default positions sit at the population estimate (CUN-BAE + offset) and the untrained FFMI', () => {
    const b = { sex: 'male' as Sex, ageYears: 40, heightCm: 180, weightKg: 85 };
    const d = defaultSliderPositions(b);
    const bmi = 85 / 1.8 ** 2;
    const bf = cunBae('male', 40, bmi) + dxaFrameOffset('male', 40);
    expect(sliderToBodyFat('male', d.adiposity)).toBeCloseTo(bf, 10);
    expect(sliderToFfmi('male', d.muscularity)).toBeCloseTo(bmi * (1 - bf / 100), 10);
    expect(d.bellyVsHips).toBe(0);
    // untouched sliders passed as undefined give the BMI-only estimate; defaults displayed there agree with it
    expect(sliderToBodyFat('male', d.adiposity)).toBeCloseTo(liveEstimate(b).bodyFatPct, 10);
  });

  it('slidersFromEstimate returns positions that display the posterior', () => {
    const inputs = { sex: 'female' as Sex, ageYears: 35, heightCm: 168, weightKg: 64, waistCm: 76, sliders: { adiposity: 0.5, muscularity: 0.5, chest: 0.3 } };
    const e = liveEstimate(inputs);
    const s = slidersFromEstimate(e, inputs);
    expect(sliderToBodyFat('female', s.adiposity)).toBeCloseTo(e.bodyFatPct, 10);
    expect(sliderToFfmi('female', s.muscularity)).toBeCloseTo(e.ffmi, 10);
    expect(bellySliderToZ(s.bellyVsHips)).toBeCloseTo(e.bellyZ, 10);
    expect(s.chest).toBe(0.3);
  });

  it('forward/inverse: feeding the default positions back leaves BF unchanged (all observations agree) but shrinks the SD', () => {
    // ...which is why untouched sliders must be passed as undefined (otherwise the equation is counted twice).
    for (const b of [
      { sex: 'male' as Sex, ageYears: 40, heightCm: 180, weightKg: 85 },
      { sex: 'female' as Sex, ageYears: 55, heightCm: 160, weightKg: 70 },
    ]) {
      const plain = liveEstimate(b);
      const fed = liveEstimate({ ...b, sliders: defaultSliderPositions(b) });
      expect(fed.bodyFatPct).toBeCloseTo(plain.bodyFatPct, 9);
      expect(fed.bodyFatSdPct).toBeLessThan(plain.bodyFatSdPct);
    }
  });

  it('defaults are plausible across the size range', () => {
    for (const [sex, age, h, W] of [
      ['male', 18, 150, 45],
      ['male', 80, 205, 160],
      ['female', 18, 145, 38],
      ['female', 80, 190, 140],
    ] as [Sex, number, number, number][]) {
      const d = defaultSliderPositions({ sex, ageYears: age, heightCm: h, weightKg: W });
      for (const v of Object.values(d)) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('typicalIndicesAtBodyFat input clamp (review V1a-L1)', () => {
  it.each(['male', 'female'] as Sex[])('%s stays finite and positive up to 100 percent body fat', (sex) => {
    for (const bf of [60, 72, 75, 80, 95, 100]) {
      const t = typicalIndicesAtBodyFat(sex, bf);
      expect(t.fmi).toBeGreaterThan(0);
      expect(t.ffmi).toBeGreaterThan(0);
      expect(t.fmi).toEqual(typicalIndicesAtBodyFat(sex, 60).fmi);
    }
  });
});
