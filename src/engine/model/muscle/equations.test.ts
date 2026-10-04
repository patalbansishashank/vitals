// @vitest-environment node
/**
 * Unit tests of each muscle equation against the worked numbers printed in the dossiers
 * (09 §4.1-4.14, 03 §4.2/4.5/4.8, 15 §4.10/4.12).
 */
import { describe, expect, it } from 'vitest';
import { buildModelParams } from '../../core/paramsRegistry';
import type { AnyEngineModule } from '../../types/module';
import { muscleModule } from './index';
import { readMuscleConstants } from './constants';
import {
  distributionEfficiency,
  detrainLambda,
  fAge,
  fAlcohol,
  fCreatine,
  fEnergyMps,
  fEnergyProtein,
  fFreq,
  fFreqStrength,
  fLoad,
  fLoadStrength,
  fProtein,
  fRest,
  fRir,
  fVolume,
  gVolume,
  hStrength,
  initialTrainingStatus,
  kAgeMps,
  kernelAmp,
  kernelShape,
  kernelTau,
  nMax,
  proteinAdequacy,
  refractoryStep,
  retentionFrac,
  vMaintenance,
  vRetention,
  feedingStimulus,
} from './equations';

const K = readMuscleConstants(buildModelParams([muscleModule] as unknown as readonly AnyEngineModule[]), true);

describe('09 §4.1 effective-set scalar', () => {
  it('f_RIR: slope 0.059 per RIR at 60-80 %1RM reproduces Robinson 2024 relative marginal means', () => {
    // 0 RIR 8.77 %, 2: 7.73, 5: 6.19, 10: 3.67 (relative 1, 0.881, 0.706, 0.418)
    expect(fRir(K, 0, 70)).toBe(1);
    expect(fRir(K, 2, 70)).toBeCloseTo(7.73 / 8.77, 2);
    expect(fRir(K, 5, 70)).toBeCloseTo(6.19 / 8.77, 2);
    expect(fRir(K, 10, 70)).toBeCloseTo(0.41, 2);
    expect(fRir(K, 30, 70)).toBe(0); // clamp
  });
  it('f_RIR: 0.045 at ≥ 80 %1RM, 0.075 below 60 %1RM', () => {
    expect(fRir(K, 2, 85)).toBeCloseTo(1 - 0.09, 10);
    expect(fRir(K, 2, 50)).toBeCloseTo(1 - 0.15, 10);
  });
  it('f_load: 1 at ≥ 35 %1RM, 0.45 at 20 %, linear between, 0.35 below 20 % (Lasevicius 2018)', () => {
    expect(fLoad(K, 80)).toBe(1);
    expect(fLoad(K, 35)).toBe(1);
    expect(fLoad(K, 20)).toBeCloseTo(0.45, 10);
    expect(fLoad(K, 27.5)).toBeCloseTo(0.725, 10);
    expect(fLoad(K, 10)).toBe(0.35);
    // Lasevicius VL: 8.9 % vs ≈ 20 % at 40-80 %1RM → ≈ 0.45
    expect(8.9 / 20.1).toBeCloseTo(fLoad(K, 20), 1);
  });
  it('f_rest: 0.88 ≤ 60 s, 0.95 for 60-90 s, 1.0 ≥ 90 s', () => {
    expect(fRest(K, 45)).toBe(0.88);
    expect(fRest(K, 60)).toBe(0.88);
    expect(fRest(K, 75)).toBe(0.95);
    expect(fRest(K, 90)).toBe(1);
    expect(fRest(K, 180)).toBe(1);
  });
});

describe('09 §4.2-4.3 volume and frequency', () => {
  it('Pelland G(V) reproduces the published table (max abs error 0.005 %-points, we allow 0.01)', () => {
    const table: [number, number][] = [[1, 0.74], [4, 2.21], [10, 4.18], [20, 6.54], [30, 8.41], [40, 10.03], [45, 10.77]];
    for (const [v, pct] of table) expect(Math.abs(100 * gVolume(K, v) - pct)).toBeLessThan(0.01);
  });
  it('f_V table of 09 §4.2 (±0.01) and cap at 40 sets', () => {
    const table: [number, number][] = [
      [0, 0], [1, 0.16], [2, 0.28], [4, 0.47], [6, 0.63], [8, 0.76], [10, 0.89], [12, 1.0], [15, 1.16], [20, 1.39],
      [25, 1.59], [30, 1.78], [35, 1.96], [40, 2.13],
    ];
    for (const [v, fv] of table) expect(Math.abs(fVolume(K, v) - fv)).toBeLessThanOrEqual(0.006);
    expect(fVolume(K, 60)).toBe(fVolume(K, 40));
  });
  it('f_F: 0 / 0.90 / 1.00 / 1.05', () => {
    expect(fFreq(K, 0)).toBe(0);
    expect(fFreq(K, 1)).toBe(0.9);
    expect(fFreq(K, 2)).toBe(1);
    expect(fFreq(K, 3)).toBe(1.05);
    expect(fFreq(K, 7)).toBe(1.05);
  });
  it('strength dose-response 100·(exp(0.14635·V/(V+1)) − 1) (09 §4.2 table)', () => {
    const table: [number, number][] = [[1, 7.6], [2, 10.3], [4, 12.4], [6, 13.4], [10, 14.2], [20, 15.0], [30, 15.2]];
    for (const [v, pct] of table) expect(Math.abs(100 * (Math.exp((0.14635 * v) / (v + 1)) - 1) - pct)).toBeLessThan(0.06);
    expect(hStrength(K, 12)).toBeCloseTo(1, 12);
    expect(hStrength(K, 0)).toBe(0);
  });
  it('f_FS: 0.73 / 1.00 / 1.14 / 1.22 / 1.32 at F = 1, 2, 3, 4, 6', () => {
    const table: [number, number][] = [[1, 0.73], [2, 1.0], [3, 1.14], [4, 1.22], [6, 1.32]];
    for (const [f, v] of table) expect(fFreqStrength(K, f)).toBeCloseTo(v, 2);
  });
  it('f_loadS: 1.0 / 0.85 / 0.65', () => {
    expect(fLoadStrength(K, 85)).toBe(1);
    expect(fLoadStrength(K, 70)).toBe(0.85);
    expect(fLoadStrength(K, 50)).toBe(0.65);
  });
});

describe('09 §4.4 post-exercise MPS kernel', () => {
  it('amplitude A(H)·a(s): ~+100 % untrained, ~+160 % habituated at saturating volume', () => {
    expect(kernelAmp(K, 0, 100)).toBeCloseTo(1.0, 6);
    expect(kernelAmp(K, 1, 100)).toBeCloseTo(1.6, 6);
    expect(kernelAmp(K, 0, 4)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(kernelTau(K, 0)).toBe(30);
    expect(kernelTau(K, 1)).toBe(10);
  });
  it('shape checks of 09 §4.4: untrained 24 h → 0.50, 48 h → 0.23 of peak; habituated 28 h → 0.08', () => {
    expect(kernelShape(K, 24, 30)).toBeCloseTo(0.5, 2);
    expect(kernelShape(K, 48, 30)).toBeCloseTo(0.22, 2);
    expect(kernelShape(K, 28, 10)).toBeCloseTo(0.08, 2);
    expect(kernelShape(K, 1.5, 30)).toBeCloseTo(0.5, 12);
  });
  it('integrated area per unit a(s): untrained 31.5 h, habituated 18.4 h (±1 %)', () => {
    const area = (h: number): number => {
      let a = 0;
      for (let t = 0.005; t < 600; t += 0.01) a += (K.kernelA0 + K.kernelAH * h) * kernelShape(K, t, kernelTau(K, h)) * 0.01;
      return a;
    };
    expect(area(0) / 31.5).toBeCloseTo(1, 2);
    expect(area(1) / 18.4).toBeCloseTo(1, 2);
  });
});

describe('09 §4.6-4.7 training status and age', () => {
  it('TS₀ from years: 0.37 / 0.61 / 0.85 / 0.99 at 1 / 2 / 4 / 10 y', () => {
    const t = (y: number): number => initialTrainingStatus(K, 6, y, 20, 20).ts0;
    expect(t(1)).toBeCloseTo(0.37, 2);
    expect(t(2)).toBeCloseTo(0.61, 2);
    expect(t(4)).toBeCloseTo(0.85, 2);
    expect(t(10)).toBeCloseTo(0.99, 2);
  });
  it('TS₀ from FFMI and the above-average-responder rescaling', () => {
    const a = initialTrainingStatus(K, 6, 0, 22, 19);
    expect(a.tsFfmi).toBeCloseTo(0.5, 12);
    expect(a.ts0).toBeCloseTo(0.5, 12);
    const b = initialTrainingStatus(K, 6, 0, 26, 19); // 7 > 6 → ΔFFMI_pot = 7/0.95
    expect(b.dFfmiPot).toBeCloseTo(7 / 0.95, 12);
    expect(b.ts0).toBeCloseTo(0.95, 12);
    expect(initialTrainingStatus(K, 6, 0, 17, 19).ts0).toBe(0);
  });
  it('f_age: 1 up to 40 y, 0.74 at 70 y, floor 0.6', () => {
    expect(fAge(K, 30)).toBe(1);
    expect(fAge(K, 40)).toBe(1);
    expect(fAge(K, 70)).toBeCloseTo(0.742, 3);
    expect(fAge(K, 100)).toBe(0.6);
  });
  it('G_pot = ΔFFMI_pot·h²: 19.0 kg (M 1.78 m), 11.7 kg (F 1.65 m) as in the 09 §4.6 table', () => {
    expect(K.dFfmiPotM * 1.78 * 1.78).toBeCloseTo(19.0, 1);
    expect(K.dFfmiPotF * 1.65 * 1.65).toBeCloseTo(11.7, 1);
  });
});

describe('09 §4.8 energy/protein multipliers and retention; f_P per kg body mass (R-RT revised)', () => {
  it('09 f_P: 0.8 → 0.44, 1.2 → 0.72, 1.4 → 0.86, ≥ 1.6 → 1.00 (g/kg body mass/d)', () => {
    const table: [number, number][] = [[0.5, 0.44], [0.8, 0.44], [1.0, 0.58], [1.1, 0.65], [1.2, 0.72], [1.4, 0.86], [1.6, 1], [2.4, 1]];
    for (const [p, fv] of table) expect(fProtein(K, p)).toBeCloseTo(fv, 2);
  });
  it('Morton 2018 supplementation 1.3 → 1.8 g/kg: f_P ratio ≈ 1.27 (09 calibration of #2)', () => {
    expect(fProtein(K, 1.8) / fProtein(K, 1.3)).toBeCloseTo(1.27, 1);
  });
  it('f_EP: deficit f_E = max(0, 1 + e/0.30) with protein rescue; surplus bonus 0.15·(1 − TS)', () => {
    // ρ_max 0.5 (R-PROT2 fallback applied; 09's 0.8 gave ρ(1.3) = 0.08, ρ(≥ 2.2) = 0.8)
    expect(fEnergyProtein(K, -0.2, 1.3, 0)).toBeCloseTo(1 / 3 + (2 / 3) * 0.05, 10);
    expect(fEnergyProtein(K, -0.4, 2.4, 0)).toBeCloseTo(0.5, 10);
    expect(fEnergyProtein(K, -0.4, 1.2, 0)).toBe(0);
    expect(fEnergyProtein(K, 0, 1.4, 0)).toBe(1);
    expect(fEnergyProtein(K, 0.1, 1.4, 0)).toBeCloseTo(1.15, 12);
    expect(fEnergyProtein(K, 0.3, 1.4, 0)).toBeCloseTo(1.15, 12);
    expect(fEnergyProtein(K, 0.1, 1.4, 0.5)).toBeCloseTo(1.075, 12);
  });
  it('R_RT = 0.75·clamp(V_wb/V_R(age)); V_R 6 → 10 sets/wk between 50 and 70 y', () => {
    expect(vRetention(K, 30)).toBe(6);
    expect(vRetention(K, 60)).toBeCloseTo(8, 12);
    expect(vRetention(K, 80)).toBe(10);
    expect(retentionFrac(K, 12, 30)).toBe(0.75);
    expect(retentionFrac(K, 3, 30)).toBeCloseTo(0.375, 12);
    expect(retentionFrac(K, 0, 30)).toBe(0);
  });
});

describe('09 §4.10 detraining', () => {
  it('V_maint 3 → 9 (50 → 70 y), 10 above 75 y', () => {
    expect(vMaintenance(K, 30)).toBe(3);
    expect(vMaintenance(K, 60)).toBeCloseTo(6, 12);
    expect(vMaintenance(K, 70)).toBeCloseTo(9, 12);
    expect(vMaintenance(K, 75)).toBeCloseTo(10, 12);
    expect(vMaintenance(K, 85)).toBe(10);
  });
  it('λ(T) = clamp((T − 14)/14, 0, 1)', () => {
    expect(detrainLambda(K, 10)).toBe(0);
    expect(detrainLambda(K, 14)).toBe(0);
    expect(detrainLambda(K, 21)).toBeCloseTo(0.5, 12);
    expect(detrainLambda(K, 40)).toBe(1);
  });
});

describe('09 §4.14 strength (R-STR)', () => {
  it('N_max = 0.05 + 0.125·(1 − TS): novice 0.175, advanced ≈ 0.08', () => {
    expect(nMax(K, 0)).toBeCloseTo(0.175, 12);
    expect(nMax(K, 0.75)).toBeCloseTo(0.08125, 12);
  });
  it('closed-form novice check: 12 wk, V 12, heavy loads, F 2, muscle +5 % → +23 % ± 4 (19-27 %)', () => {
    const n = nMax(K, 0) * hStrength(K, 12) * fLoadStrength(K, 85) * fFreqStrength(K, 2) * (1 - Math.exp(-84 / 21));
    const gain = 100 * ((1 + n) * 1.05 - 1);
    expect(gain).toBeGreaterThanOrEqual(19);
    expect(gain).toBeLessThanOrEqual(27);
    expect(Math.abs(gain - 23)).toBeLessThanOrEqual(4);
  });
});

describe('15 §4.10 alcohol and §4.12 creatine', () => {
  it('Parr 2014: 1.5 g/kg → −24 % with protein, −37 % without', () => {
    expect(fAlcohol(K, 1.5, true)).toBeCloseTo(0.76, 10);
    expect(fAlcohol(K, 1.5, false)).toBeCloseTo(0.63, 10);
    expect(fAlcohol(K, 3, true)).toBeCloseTo(0.75, 10); // reduction capped at 0.25
    expect(fAlcohol(K, 3, false)).toBeCloseTo(0.63, 10); // capped at 0.37
    expect(fAlcohol(K, 0, false)).toBe(1);
  });
  it('f_Cr = 1 + 0.05·saturation', () => {
    expect(fCreatine(K, 1)).toBeCloseTo(1.05, 12);
    expect(fCreatine(K, 0)).toBe(1);
    expect(fCreatine(K, 2)).toBeCloseTo(1.05, 12);
  });
});

describe('03 §4.8 distribution efficiency (daily formula)', () => {
  const ffm = 64;
  const ed = (t: number[], p: number[], age = 30): number =>
    distributionEfficiency(K.p03, t.length, Float64Array.from(t), Float64Array.from(p), Float64Array.from(p), ffm, age);
  it('3 even adequate meals 5-6 h apart → 1.0', () => {
    expect(ed([8, 13, 19], [40, 40, 40])).toBe(1);
  });
  it('OMAD → 0.83 (floor of the stated range)', () => {
    expect(ed([18], [120])).toBeCloseTo(0.83, 12);
  });
  it('2 meals 6 h apart → 1 − 0.06 − 0.05·0.25', () => {
    expect(ed([12, 18], [60, 60])).toBeCloseTo(1 - 0.06 - 0.0125, 12);
  });
  it('sub-threshold meals do not count; threshold rises with age', () => {
    expect(ed([8, 13, 19], [15, 15, 15])).toBeCloseTo(0.83, 12);
    // 0.28·64 = 17.9 g young; ×1.8 = 32.3 g at ≥ 70 y
    expect(ed([8, 13, 19], [25, 25, 25], 30)).toBe(1);
    expect(ed([8, 13, 19], [25, 25, 25], 75)).toBeCloseTo(0.83, 12);
  });
});

describe('03 §4.5/4.7 MPS display layer', () => {
  it('f_E,MPS anchors: Hector 2018 1.2 g/kg −26 %, 2.4 g/kg −18 %; Pasiakos −10 %', () => {
    expect(fEnergyMps(K.p03, 0.4, 0.56)).toBeCloseTo(0.74, 2);
    expect(fEnergyMps(K.p03, 0.4, 1)).toBeCloseTo(0.82, 2);
    expect(fEnergyMps(K.p03, 0.2, 0.85)).toBeCloseTo(0.9, 2);
    expect(fEnergyMps(K.p03, 2, 0)).toBe(0.5);
    expect(fEnergyMps(K.p03, -0.2, 0)).toBe(1);
  });
  it('x_P = clamp((q − 0.8)/max(q_sat − 0.8, 0.3)), q_sat = 1.2 + min(d, 0.45)(2 + 3L)', () => {
    expect(proteinAdequacy(K.p03, 0.8, 0.25, 0)).toBe(0);
    expect(proteinAdequacy(K.p03, 1.7, 0.25, 0)).toBeCloseTo(1, 12); // q_sat 1.7
    expect(proteinAdequacy(K.p03, 1.25, 0.25, 0)).toBeCloseTo(0.5, 12);
    expect(proteinAdequacy(K.p03, 1.0, 0, 0)).toBeCloseTo(0.5, 12);
  });
  it('K_age 0.07 → 0.117 g/kg FFM/h between 30 and 70 y; S(K) = 0.5', () => {
    expect(kAgeMps(K.p03, 25)).toBeCloseTo(0.07, 12);
    expect(kAgeMps(K.p03, 80)).toBeCloseTo(0.07 * 1.67, 12);
    expect(feedingStimulus(0.07, 0.07)).toBeCloseTo(0.5, 12);
    expect(feedingStimulus(0, 0.07)).toBe(0);
  });
  it('refractory closed form matches a 5-min Euler reference within 2 % over a fed day (O-10)', () => {
    // hourly stimulus profile of three protein meals (S held for each hour, as in the engine)
    const sProfile = [0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.95, 0.8, 0.4, 0.2, 0.7, 0.95, 0.9, 0.5, 0.2, 0.1, 0.8, 0.95, 0.7, 0.3, 0.1];
    let rExact = 0;
    let rEuler = 0;
    let maxErr = 0;
    for (let h = 0; h < 24; h++) {
      const s = sProfile[h]!;
      rExact = refractoryStep(K.p03, rExact, s);
      for (let i = 0; i < 12; i++) {
        const dt = 1 / 12;
        rEuler += dt * (K.p03.kR * s ** 4 * (1 - rEuler) - rEuler / 4.5);
      }
      maxErr = Math.max(maxErr, Math.abs(rExact - rEuler));
    }
    expect(maxErr).toBeLessThan(0.02);
    expect(rExact).toBeGreaterThanOrEqual(0);
    expect(rExact).toBeLessThanOrEqual(1);
  });
});
