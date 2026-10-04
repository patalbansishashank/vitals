// @vitest-environment node
/**
 * Unit tests of the appetite equations against worked numbers from 12 §4.9-4.10, 10 §4.3, 15 §4.6, 21 §4G.
 */
import {
  dropoutHazard,
  energyDensitySatiety,
  exerciseAppetite,
  fibreSatiety,
  hungerPressureIndex,
  leannessAmplifier,
  leverHazardMultiplier,
  proteinSatiety,
  satDef,
  weightLossDrive,
} from './equations';

describe('appetite drive terms (12 §4.9.1)', () => {
  it('weight-loss feedback: slope 95 kcal/d per kg for small losses, saturating at 95·W_c', () => {
    const wc = 0.08 * 90;
    expect(weightLossDrive(0.01, wc, 95, 47.5, 500) / 0.01).toBeCloseTo(95, 0);
    expect(weightLossDrive(1, wc, 95, 47.5, 500)).toBeCloseTo(95 * wc * (1 - Math.exp(-1 / wc)), 10);
    expect(weightLossDrive(1000, wc, 95, 47.5, 500)).toBeCloseTo(95 * wc, 6);
  });
  it('weight gain suppresses appetite at half the slope, capped at 500 kcal/d', () => {
    expect(weightLossDrive(-2, 7.2, 95, 47.5, 500)).toBeCloseTo(-95, 10);
    expect(weightLossDrive(-20, 7.2, 95, 47.5, 500)).toBe(-500);
  });
  it('leanness amplification is 1 at baseline and grows as leptin sufficiency falls', () => {
    expect(leannessAmplifier(0.97, 0.97, 1.5)).toBe(1);
    expect(leannessAmplifier(0.1, 0.97, 1.5)).toBeCloseTo((1 + 1.5 * 0.9) / (1 + 1.5 * 0.03), 12);
  });
  it('10 §4.3 appetite compensation: +50 / +83 / +94 kcal/d at 105 / 263 / 429 kcal/d (10 T7)', () => {
    expect(exerciseAppetite(105, 100, 150)).toBeCloseTo(50, 0);
    expect(exerciseAppetite(263, 100, 150)).toBeCloseTo(83, 0);
    expect(exerciseAppetite(429, 100, 150)).toBeCloseTo(94, 0);
    expect(exerciseAppetite(0, 100, 150)).toBe(0);
  });
});

describe('satiety-effective intake (12 §4.9.2)', () => {
  it('protein: 15 → 30 %E (×2) gives 0.25·ln 2 of EI_hab; 15 → 10 % gives +10 % intake (Weigle 2005; Gosby 2011)', () => {
    expect(proteinSatiety(200, 100, 2400, 0.25, 2.5, 0.3)).toBeCloseTo(0.25 * 2400 * Math.LN2, 10);
    expect(proteinSatiety((2 / 3) * 100, 100, 2400, 0.25, 2.5, 0.3) / 2400).toBeCloseTo(-0.101, 3);
    // cap at ln 2.5 and floor at 0.3·P_ref
    expect(proteinSatiety(1000, 100, 2400, 0.25, 2.5, 0.3)).toBeCloseTo(0.25 * 2400 * Math.log(2.5), 10);
    expect(proteinSatiety(0, 100, 2400, 0.25, 2.5, 0.3)).toBeCloseTo(0.25 * 2400 * Math.log(0.3), 10);
  });
  it('fibre: +14 g of mixed fibre = 5 % of EI_hab; clamp ±8 %; extra viscous share adds (v − 1)', () => {
    expect(fibreSatiety(30, 16, 0.15, 0.15, 2600, 0.05, 14, 0.08, 1.5)).toBeCloseTo(0.05 * 2600, 10);
    expect(fibreSatiety(80, 16, 0.15, 0.15, 2600, 0.05, 14, 0.08, 1.5)).toBeCloseTo(0.08 * 2600, 10);
    // 10 g psyllium on top of 25 g habitual: 10 g + 0.5·(13.75 − 0.15·35) g
    const visc = (25 * 0.15 + 10) / 35;
    expect(fibreSatiety(35, 25, visc, 0.15, 2600, 0.05, 14, 0.08, 1.5)).toBeCloseTo((0.05 * 2600 * (10 + 0.5 * (13.75 - 5.25))) / 14, 8);
  });
  it('energy density: ±ln 2 clamp, 0 when unknown', () => {
    expect(energyDensitySatiety(Number.NaN, 1.34, 2400, 0.5)).toBe(0);
    expect(energyDensitySatiety(1.34 * 0.75, 1.34, 2400, 0.5)).toBeCloseTo(-0.5 * 2400 * Math.log(0.75), 10);
    expect(energyDensitySatiety(10, 1, 2400, 0.5)).toBeCloseTo(-0.5 * 2400 * Math.LN2, 10);
  });
});

describe('unmet appetite, HPI and adherence (12 §4.9.3, §4.10a)', () => {
  it('SatDef: linear in surplus, saturating at 1 400 kcal-eq in deficit', () => {
    expect(satDef(-300, 1400, 1000)).toBe(-300);
    expect(satDef(650, 1400, 1000)).toBeCloseTo(1400 * (1 - Math.exp(-0.65)), 10);
    expect(satDef(1e6, 1400, 1000)).toBeCloseTo(1400, 6);
  });
  it('HPI scale anchors: E_k 0 → 6; 400 → 21; 800 → 50; 1 200 → 79; 1 600 → 94', () => {
    const anchors: ReadonlyArray<[number, number]> = [
      [0, 6],
      [400, 21],
      [800, 50],
      [1200, 79],
      [1600, 94],
    ];
    for (const [e, h] of anchors) expect(Math.abs(hungerPressureIndex(e, 800, 300) - h)).toBeLessThan(0.6);
  });
  it('dropout hazard: HPI 40 / 60 / 80 / 95 held for a year → +4.5 / 17 / 34 / 48 pp (12 §4.10a)', () => {
    const anchors: ReadonlyArray<[number, number]> = [
      [40, 4.5],
      [60, 17],
      [80, 34],
      [95, 48],
    ];
    for (const [hpi, pp] of anchors) {
      const drop = 100 * (1 - Math.exp(-365 * dropoutHazard(hpi, 0.0005, 20, 40)));
      expect(Math.abs(drop - pp)).toBeLessThan(1);
    }
    expect(dropoutHazard(20, 0.0005, 20, 40)).toBe(0);
  });
  it('21 §4G levers: multiplicative hazard shift 1 − ΣΔp, capped at 0.15', () => {
    expect(leverHazardMultiplier(0, 0, 0, 0, 0.1, 0.05, 0.03, 0.03, 0.15)).toBe(1);
    expect(leverHazardMultiplier(1, 0, 0, 0, 0.1, 0.05, 0.03, 0.03, 0.15)).toBeCloseTo(0.9, 12);
    expect(leverHazardMultiplier(1, 1, 1, 1, 0.1, 0.05, 0.03, 0.03, 0.15)).toBeCloseTo(0.85, 12);
  });
});
