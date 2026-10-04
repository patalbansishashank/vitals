/**
 * Unit tests of the composition partition equations against the dossiers' own worked numbers
 * (03 §4.4.2 model table and grids, 03 §4.13 cross-check, 03 §4.14, 11 §4.7 m_P fit, 11 §4.12 Jacquet examples).
 */
import { describe, expect, it } from 'vitest';
import { buildModelParams } from '../../core/paramsRegistry';
import { validateParamDefs } from '../../core/paramsRegistry';
import type { AnyEngineModule } from '../../types/module';
import { compositionModule } from './index';
import {
  ageLeanDriftGD,
  deficitEnergyShare,
  energyShareOfMassFraction,
  jacquetOvershootKg,
  leannessIndex,
  mFatType,
  mProtein,
  overshootLeanRatio,
  pCatDeficit,
  phiForbes,
  poxDecayFactor,
  poxLeanRateKgD,
  poxRate,
  readConstants,
  surplusEnergyShare,
  surplusLeanRatio,
} from './partition';

const modules = [compositionModule] as unknown as readonly AnyEngineModule[];
const K = readConstants(buildModelParams(modules));

/**
 * 03 §4.4.2 in its original argument form (protein g/kg BM, deficit %, BF %); RT enters only through the dossier's own
 * RT terms (M_min − 0.25·RT, M_RT = 1 − 0.30·RT), used here solely to reproduce the dossier's RT-including rows.
 */
function lfl03(pBM: number, defPct: number, bfPct: number, sex: 'M' | 'F', age: number, BW: number, rt = 0, activity = 0): number {
  const bf = bfPct / 100;
  const FM = BW * bf;
  const q = (pBM * BW) / (BW - FM);
  return pCatDeficit(K, q, defPct / 100, bf, FM, sex === 'F', age, activity, 0.25 * rt, 1 - 0.3 * rt);
}

/** Table arms are given by q (g/kg FFM/d); convert back to g/kg BM. */
const pbm = (q: number, BW: number, bfPct: number) => (q * BW * (1 - bfPct / 100)) / BW;

describe('registry', () => {
  it('all composition ParamDefs are valid (prefix, range, source, §)', () => {
    expect(validateParamDefs(modules)).toEqual([]);
  });
});

describe('03 §4.4.2 leanFractionOfLoss — dossier model table (pCat ±0.02)', () => {
  // Inputs the dossier states in the row labels / footnote; the rest back-solved from its q column (documented).
  const rows: [string, number, number, number, number, 'M' | 'F', number, number, number][] = [
    // name, BW, BF %, deficit %, q (g/kg FFM), sex, age, RT, expected pCat
    ['Pasiakos RDA', 78, 20, 40, 1.0, 'M', 22, 0, 0.415],
    ['Pasiakos 2× RDA', 78, 20, 40, 2.0, 'M', 22, 0, 0.296],
    ['Pasiakos 3× RDA', 78, 20, 40, 3.0, 'M', 22, 0, 0.224],
    // Mettler athletes kept their usual RT: the dossier's column is reproduced with its own RT = 0.8 terms
    ['Mettler CP (dossier RT 0.8)', 80, 15, 40, 1.18, 'M', 25, 0.8, 0.341],
    ['Mettler HP (dossier RT 0.8)', 80, 15, 40, 2.71, 'M', 25, 0.8, 0.155],
    // obese woman 30 % deficit: q 1.12 / 2.16 at 0.65 / 1.25 g/kg ⇒ BF 42 %; 102 kg, 51 y back-solved
    ['Obese woman NP', 102, 42, 30, 1.12, 'F', 51, 0, 0.193],
    ['Obese woman HP', 102, 42, 30, 2.16, 'F', 51, 0, 0.128],
    // obese man −1000 kcal/d: 96 kg, 38 % BF, TEE 2 800 kcal/d (d = 0.357) back-solved
    ['Obese man sedentary', 96, 38, 100000 / 2800, 1.23, 'M', 40, 0, 0.195],
    // VLED 500 kcal/d: 100 kg, 40 % BF, TEE 2 100 kcal/d back-solved
    ['VLED 1.5 g/kg IBW', 100, 40, (100 * 1600) / 2100, 1.96, 'F', 40, 0, 0.103],
    ['VLED 0.8 g/kg IBW', 100, 40, (100 * 1600) / 2100, 1.05, 'F', 40, 0, 0.238],
    // total fasts: FM 13 kg non-obese (dossier 0.673), FM 52 kg obese (0.248)
    ['Total fast non-obese', 70, (100 * 13) / 70, 100, 0, 'M', 30, 0, 0.673],
    ['Total fast obese', 120, (100 * 52) / 120, 100, 0, 'M', 30, 0, 0.248],
  ];
  for (const [name, BW, bf, def, q, sex, age, rt, want] of rows) {
    it(`${name}: pCat ${want}`, () => {
      expect(Math.abs(lfl03(pbm(q, BW, bf), def, bf, sex, age, BW, rt) - want)).toBeLessThanOrEqual(0.02);
    });
  }

  it('illustrative grid (80 kg man, 20 % BF, 30 y, RT 0): lean fraction of loss', () => {
    const grid: [number, number, number][] = [
      [0.8, 10, 0.32], [0.8, 25, 0.37], [0.8, 40, 0.41],
      [1.2, 10, 0.22], [1.2, 25, 0.31], [1.2, 40, 0.35],
      [1.6, 10, 0.21], [1.6, 25, 0.25], [1.6, 40, 0.29],
      [2.2, 25, 0.24], [2.2, 40, 0.22], [2.8, 40, 0.22],
    ];
    for (const [p, d, want] of grid) expect(Math.abs(lfl03(p, d, 20, 'M', 30, 80) - want)).toBeLessThanOrEqual(0.011);
  });

  it('obese woman grid (100 kg, 45 % BF, 50 y, RT 0): 0.18/0.21/0.23 and 0.12/0.11/0.08', () => {
    const lo = [25, 50, 75].map((d) => lfl03(0.6, d, 45, 'F', 50, 100));
    const hi = [25, 50, 75].map((d) => lfl03(1.2, d, 45, 'F', 50, 100));
    [0.18, 0.21, 0.23].forEach((w, i) => expect(Math.abs(lo[i]! - w)).toBeLessThanOrEqual(0.011));
    [0.12, 0.11, 0.08].forEach((w, i) => expect(Math.abs(hi[i]! - w)).toBeLessThanOrEqual(0.011));
  });

  it('engine form is RT-stripped: no RT argument changes the result (R-RT)', () => {
    const a = pCatDeficit(K, 1.5, 0.25, 0.2, 16, false, 30, 0);
    expect(a).toBeCloseTo(lfl03(pbm(1.5, 80, 20), 25, 20, 'M', 30, 80, 0), 12);
  });

  it('monotone: more protein ↓, more fat ↓, more aerobic activity ↓, larger deficit ↑ (below the protein-efficacy knee)', () => {
    const base = pCatDeficit(K, 1.2, 0.25, 0.25, 20, false, 35, 0);
    expect(pCatDeficit(K, 2.0, 0.25, 0.25, 20, false, 35, 0)).toBeLessThan(base);
    expect(pCatDeficit(K, 1.2, 0.25, 0.35, 35, false, 35, 0)).toBeLessThan(base);
    expect(pCatDeficit(K, 1.2, 0.25, 0.25, 20, false, 35, 1)).toBeLessThan(base);
    expect(pCatDeficit(K, 1.2, 0.4, 0.25, 20, false, 35, 0)).toBeGreaterThan(base);
    // Chaston aerobic vs sedentary ratio 0.13/0.27 ≈ 0.48; M_act = 0.70 at activity 1
    expect(pCatDeficit(K, 1.2, 0.25, 0.25, 20, false, 35, 1) / base).toBeCloseTo(0.7, 10);
  });

  it('bounded 0..0.9 and finite for extreme inputs', () => {
    for (const q of [0, 0.5, 5, 50]) for (const d of [0, 0.5, 1]) for (const fm of [0, 1, 100]) {
      const v = pCatDeficit(K, q, d, fm / (fm + 50), fm, true, 90, 1);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.9);
    }
  });

  it('leanness index L: 1 at ≤ 10 % (M) / ≤ 20 % (F), 0 at ≥ 30 % / ≥ 40 %', () => {
    expect(leannessIndex(K, 0.1, false)).toBeCloseTo(1, 12);
    expect(leannessIndex(K, 0.3, false)).toBeCloseTo(0, 12);
    expect(leannessIndex(K, 0.2, true)).toBeCloseTo(1, 12);
    expect(leannessIndex(K, 0.4, true)).toBeCloseTo(0, 12);
    expect(leannessIndex(K, 0.2, false)).toBeCloseTo(0.5, 12);
  });
});

describe('energy shares (MODEL_SPEC §1.8 2c/2d)', () => {
  it('mass fraction → energy share with effective densities (ρ + η)', () => {
    const f = 0.25;
    const want = (f * (1816 + 229)) / (f * (1816 + 229) + (1 - f) * (9441 + 179));
    expect(energyShareOfMassFraction(K, f)).toBeCloseTo(want, 12);
    expect(energyShareOfMassFraction(K, 0)).toBe(0);
    expect(energyShareOfMassFraction(K, 1)).toBe(1);
  });

  it('deficit share: × (1 − R_RT), then + sleep shift on the P-ratio (review M1), clamped', () => {
    const base = deficitEnergyShare(K, 0.3, 0, 0);
    expect(deficitEnergyShare(K, 0.3, 0.75, 0)).toBeCloseTo(energyShareOfMassFraction(K, 0.075), 12);
    // 16 §4.0.1: shift raises a P ≈ 0.09 baseline to ≈ 0.18
    expect(deficitEnergyShare(K, 0.3, 0, 0.09)).toBeCloseTo(base + 0.09, 12);
    expect(deficitEnergyShare(K, 0.9, 0, 1)).toBe(0.9);
  });

  it('surplus share p_E = r_L(ρL+ηL)/[(ρF+ηF) + r_L(ρL+ηL)]', () => {
    const rL = 0.45;
    expect(surplusEnergyShare(K, rL)).toBeCloseTo((rL * 2045) / (9620 + rL * 2045), 12);
  });
});

describe('11 §4.7 surplus partition', () => {
  it('m_P reproduces the Bray 2012 fit shape: −0.233 / 0.999 / 1.05 (clamped) at p = 0.68 / 1.79 / 3.0 g/kg', () => {
    expect(mProtein(K, 0.68)).toBeCloseTo((1 - Math.exp(0.07 / 0.35)) / 0.95, 10);
    expect(mProtein(K, 0.68)).toBeCloseTo(-0.2331, 3);
    expect(mProtein(K, 1.79)).toBeCloseTo(0.9987, 3);
    expect(mProtein(K, 3.0)).toBe(1.05);
    expect(mProtein(K, 0)).toBe(-0.3);
    // ΔLBM ≈ 3.2·(1 − e^{−(p−0.75)/0.35}) = 3.2·0.95·m_P → −0.71 / +3.04 / +3.19 kg (fit rows)
    expect(3.2 * 0.95 * mProtein(K, 0.68)).toBeCloseTo(-0.71, 1);
    expect(3.2 * 0.95 * mProtein(K, 1.79)).toBeCloseTo(3.04, 1);
  });

  it('φ_F: capped at 1 for lean people, Forbes shape above', () => {
    expect(phiForbes(K, 6.9)).toBe(1);
    expect(phiForbes(K, 30)).toBeCloseTo(10.4 / 40.4 / 0.45, 12);
  });

  it('r_L: adipose matrix alone survives full RT (s_RT = 1), and rises with protein', () => {
    expect(surplusLeanRatio(K, 1.5, 15, 1, 1)).toBeCloseTo(0.2, 12);
    expect(surplusLeanRatio(K, 1.5, 15, 0, 1)).toBeGreaterThan(surplusLeanRatio(K, 0.9, 15, 0, 1));
    // p < 0.75: m_P < 0 shrinks lean accretion to little more than the matrix (r_L ≥ 0.2 − 0.45·0.3 ≈ 0.07)
    expect(surplusLeanRatio(K, 0.3, 5, 0, 1)).toBeCloseTo(0.2 - 0.45 * 0.3, 12);
  });

  it('m_FA: 1.0 for the habitual mix, → 1.5 PUFA-rich, → 0.7 SFA-rich', () => {
    expect(mFatType(K, 0.23, 0.32)).toBe(1);
    expect(mFatType(K, Number.NaN, Number.NaN)).toBe(1);
    expect(mFatType(K, 0.6, 0.1)).toBeCloseTo(1.5, 12);
    expect(mFatType(K, 0.05, 0.6)).toBeCloseTo(0.7, 12);
  });
});

describe('11 §4.12 post-diet overshoot (Jacquet 2020)', () => {
  it('examples: 70 kg, 5 kg lost and regained → overshoot ≈ 1.5 / 0.5 / 0.17 kg at 10 / 20 / 30 % fat', () => {
    expect(jacquetOvershootKg(K, 10, 5)).toBeCloseTo(1.5, 1);
    expect(jacquetOvershootKg(K, 20, 5)).toBeCloseTo(0.5, 1);
    expect(jacquetOvershootKg(K, 30, 5)).toBeCloseTo(0.17, 2);
  });

  it('threshold ramp: no change below 10 % fat depletion, full refeeding partition above 30 %', () => {
    expect(overshootLeanRatio(K, 0.4, 0.5, 10, 0.05, 30)).toBe(0.4);
    const pRF = 0.5 / (1 + 0.92 * Math.exp(-1.1));
    expect(overshootLeanRatio(K, 0.4, 0.5, 10, 0.35, 30)).toBeCloseTo(pRF / (1 - pRF), 12);
    // continuity at the lower threshold
    expect(overshootLeanRatio(K, 0.4, 0.5, 10, 0.1 + 1e-9, 30)).toBeCloseTo(0.4, 6);
    // age ≥ 60: P_RF × 0.5
    const pOld = pRF * 0.5;
    expect(overshootLeanRatio(K, 0.4, 0.5, 10, 0.35, 65)).toBeCloseTo(pOld / (1 - pOld), 12);
  });
});

describe('03 §4.13 very-low-intake branch', () => {
  it('cross-check: 70-kg non-obese man, FFM 57 kg, L = 0.6 → day-1 N ≈ 8.2 g (±1), day-10 ≈ 6.2 g N/d', () => {
    const nDay1 = (poxRate(K, 1, 0.6, 0, 0) * 57) / 6.25;
    expect(Math.abs(nDay1 - 8.2)).toBeLessThanOrEqual(1);
    const decay10 = Math.pow(poxDecayFactor(K, 0), 10); // no ketone modifier → exp(−10/(2·3)); τ_N,eff = 2τ_N at BHB 0
    const decay10Ket = Math.exp(-10 / 3); // BHB ≥ 2 mM → τ_N,eff = τ_N
    expect(poxDecayFactor(K, 2)).toBeCloseTo(Math.exp(-1 / 3), 12);
    const nDay10 = (poxRate(K, decay10Ket, 0.6, 0, 10) * 57) / 6.25;
    expect(nDay10).toBeCloseTo(6.2, 1);
    expect((poxRate(K, decay10, 0.6, 0, 10) * 57) / 6.25).toBeGreaterThan(nDay10);
  });

  it('lean tissue in the Hall convention: ΔLT = −(Pox·FFM − 0.3·P_eff)/(1000·f_prot)', () => {
    const pox = poxRate(K, 1, 0.6, 0, 0);
    expect(poxLeanRateKgD(K, pox, 57, 0)).toBeCloseTo(-(pox * 57) / (1000 / 2.6), 10);
    // dietary protein offsets 30 %
    expect(poxLeanRateKgD(K, pox, 57, 40)).toBeCloseTo(-(pox * 57 - 12) * 2.6 / 1000, 10);
  });

  it('carbohydrate sparing only during the first 7 days', () => {
    expect(poxRate(K, 1, 0.6, 100, 2)).toBeCloseTo(0.7 * poxRate(K, 1, 0.6, 0, 2), 12);
    expect(poxRate(K, 1, 0.6, 100, 8)).toBeCloseTo(poxRate(K, 1, 0.6, 0, 8), 12);
  });
});

describe('03 §4.14 age drift', () => {
  it('−0.4 g/d × clamp((age − 45)/20, 0, 1.5) × (1 − 0.8·RT)', () => {
    expect(ageLeanDriftGD(K, 30, 0)).toBeCloseTo(0, 12);
    expect(ageLeanDriftGD(K, 65, 0)).toBeCloseTo(-0.4, 12);
    expect(ageLeanDriftGD(K, 90, 0)).toBeCloseTo(-0.6, 12);
    expect(ageLeanDriftGD(K, 65, 1)).toBeCloseTo(-0.08, 12);
  });
});
