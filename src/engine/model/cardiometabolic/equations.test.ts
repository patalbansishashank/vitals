// @vitest-environment node
/**
 * Unit tests of every equation against the worked numbers printed in the dossiers (06 §4.2-4.13, 04 §4.13b/4.18-4.19,
 * 13 §4.8). Each `it` names its source.
 */
import { generatorValue } from './constants';
import {
  bpAlcoholTarget, bpExerciseTarget, bpOmega3Target, bpPotassiumTarget, bpSaunaTarget, bpSodiumTarget, carbToleranceTarget, cholesterolDeltaTc,
  estimatedAverageGlucose, fAdiposity, fEnergyBalance3d, fFitness, fLiverFat, fSfaTarget, fStepsTarget, fSugarTarget, fractionalDnlPct, homaIr,
  ketosisState, ldlCompositionTarget, lemAmplitude, lemEnergyModifier, nutsLdl, portfolioLdlTarget, tgAlcoholMgDl, tgExchangeLn, tgOmega3Fraction,
  tgSugarMmol, urateDashEffect, urateKetoneTarget, viscousFibreLdl, wholeBodySensitivity,
} from './equations';
import { Diet } from './diet';
import { cholesky, CORR, correlatedZ, normInv, N_Z } from './baselines';
import { makeRig, WOMAN_PROFILE } from './testkit';
import { param } from '../../core/paramsRegistry';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** A person with LDL0 = 115 mg/dL, TG0 = 106 mg/dL (the dossier's reference levels). */
const ref = () => makeRig({ labs: { ldlMmolL: 115 / 38.67, tgMmolL: 106 / 88.57, sbpMmHg: 122 } });
const dietFrom = (k: ReturnType<typeof ref>['k'], over: Partial<Diet>): Diet => {
  const d = new Diet();
  d.copyFrom(k.hab);
  Object.assign(d, over);
  return d;
};

describe('Mensink exchange terms (06 §4.2.1 Table 4.2-A; validation V1)', () => {
  it('10 %E SFA replaced by cis-PUFA: LDL −0.55 mmol/L (−21 mg/dL) within ±25 %', () => {
    const { k } = makeRig({ labs: { ldlMmolL: 112 / 38.67 } });
    const d = dietFrom(k, { sfaEffPct: k.hab.sfaEffPct - 10, pufaPct: k.hab.pufaPct + 10 });
    const dMmol = ldlCompositionTarget(d, k, 0) / 38.67;
    near(dMmol, -0.55, 0.55 * 0.25);
  });
  it('10 %E carbohydrate replaced by SFA: LDL +0.36, HDL +0.11 (mmol/L) — copied coefficients', () => {
    const { k } = makeRig({ labs: { ldlMmolL: 112 / 38.67 } });
    const d = dietFrom(k, { sfaEffPct: k.hab.sfaEffPct + 10 });
    near(ldlCompositionTarget(d, k, 0) / 38.67, 0.36, 0.36 * 0.25);
    const ln = tgExchangeLn(d, k);
    // TG −0.12 mmol/L at the data-set mean 1.2 mmol/L ⇒ −10 % (ln)
    near(Math.exp(ln) - 1, -0.1, 0.03);
  });
  it('baseline dependence: LDL0 = 152 mg/dL scales SFA/PUFA coefficients by 1 + 0.35·(152 − 112)/40 = 1.35', () => {
    const { k } = makeRig({ labs: { ldlMmolL: 152 / 38.67 } });
    near(k.ldlScale, 1.35, 1e-9);
    const lo = makeRig({ labs: { ldlMmolL: 60 / 38.67 } }).k;
    near(lo.ldlScale, 0.7, 1e-9); // clip at 0.7
    const hi = makeRig({ labs: { ldlMmolL: 250 / 38.67 } }).k;
    near(hi.ldlScale, 1.4, 1e-9); // clip at 1.4
  });
  it('protein-for-carbohydrate (OmniHeart): +10 %E protein lowers LDL by 0.085 mmol/L and TG by ≈16 %', () => {
    const { k } = ref();
    const d = dietFrom(k, { protPct: k.hab.protPct + 10 });
    near(ldlCompositionTarget(d, k, 0) / 38.67, -0.085, 1e-6);
    near(tgExchangeLn(d, k), -0.17, 1e-9);
  });
  it('TG exchange terms do not act beyond the regression validity range (53 %E fat)', () => {
    const { k } = ref();
    const inside = dietFrom(k, { sfaEffPct: k.hab.sfaEffPct + 10, fatPct: k.hab.fatPct + 10 });
    const beyond = dietFrom(k, { sfaEffPct: k.hab.sfaEffPct + 30, fatPct: 75 });
    const scale = (53 - k.hab.fatPct) / (75 - k.hab.fatPct);
    near(tgExchangeLn(beyond, k), scale * 30 * param(makeRig().ctx.params, 'cardiometabolic.tg.sfa'), 1e-9);
    expect(tgExchangeLn(inside, k)).toBeLessThan(0);
  });
});

describe('dietary cholesterol (06 §4.2.5; validation V2)', () => {
  it('+200 mg/d at 2000 kcal from the NHANES habitual 365 mg/d: dTC ≈ +0.12-0.13 mmol/L, dLDL ≈ +0.10 mmol/L (±30 %)', () => {
    const { k } = makeRig();
    // the rig's habitual day is ~2 500 kcal; express the intake at the habitual energy so the density change is +200 mg/d
    const e = k.hab.energyKcal;
    const dTc = cholesterolDeltaTc(k.chol0Mg + 200, e, k);
    near(dTc / 38.67, 0.12, 0.12 * 0.3);
    const d = dietFrom(k, {});
    near(ldlCompositionTarget(d, k, dTc) / 38.67, 0.1, 0.1 * 0.3);
  });
  it('worked check: 300 → 500 mg/d at 2000 kcal gives dTC = +5.3 mg/dL (0.14 mmol/L)', () => {
    const { k } = makeRig();
    const k2 = { ...k, cholZ0: (300 * 1000) / 2000 };
    near(cholesterolDeltaTc(500, 2000, k2), 5.3, 0.15);
  });
  it('effect saturates above 900 mg/d and is zero without intake data', () => {
    const { k } = makeRig();
    expect(cholesterolDeltaTc(1500, 2500, k)).toBe(cholesterolDeltaTc(900, 2500, k));
    expect(cholesterolDeltaTc(Number.NaN, 2500, k)).toBe(0);
  });
});

describe('LEM term (06 §4.3)', () => {
  const { k } = makeRig();
  it('amplitude 45 mg/dL at BMI 22, zero at BMI 32.2, linear −4.5 per BMI unit', () => {
    near(lemAmplitude(22, k), 45, 1e-9);
    near(lemAmplitude(27, k), 45 - 22.5, 1e-9);
    near(lemAmplitude(32.2, k), 0, 1e-9);
    expect(lemAmplitude(40, k)).toBe(0);
  });
  it('s_keto on the 24-h mean BHB: 0 at ≤ 0.2 mM, 1 at ≥ 0.5 mM (06 §4.3 spot bounds 0.5/1.5 on the daily mean)', () => {
    expect(ketosisState(0.15, k)).toBe(0);
    near(ketosisState(0.35, k), 0.5, 1e-12);
    expect(ketosisState(0.6, k)).toBe(1);
  });
  it('E_mod = clip(1 − 2u, 0, 1.5): deficits raise, surpluses lower', () => {
    near(lemEnergyModifier(0, k), 1, 1e-12);
    near(lemEnergyModifier(-0.25, k), 1.5, 1e-12);
    near(lemEnergyModifier(-0.6, k), 1.5, 1e-12);
    near(lemEnergyModifier(0.25, k), 0.5, 1e-12);
    near(lemEnergyModifier(0.6, k), 0, 1e-12);
  });
});

describe('portfolio components (06 §4.4)', () => {
  const { k } = ref();
  it('viscous fibre: d = 3 → −0.245, 6.5 → −0.325, 10.2 → −0.36 mmol/L at LDL0 = 115 mg/dL', () => {
    near(viscousFibreLdl(3, k) / 38.67, -0.245, 0.005);
    near(viscousFibreLdl(6.5, k) / 38.67, -0.325, 0.005);
    near(viscousFibreLdl(10.2, k) / 38.67, -0.36, 0.005);
    expect(viscousFibreLdl(0, k)).toBe(0);
  });
  it('nuts: −4.8 mg/dL per serving up to 2, −5.5 per serving for 2-3, capped at 3 servings', () => {
    near(nutsLdl(1, k), -4.8, 1e-9);
    near(nutsLdl(2, k), -9.6, 1e-9);
    near(nutsLdl(3, k), -15.1, 1e-9);
    near(nutsLdl(5, k), -15.1, 1e-9);
  });
  it('combination is sub-additive: 1 − Π(1 − f_i) with f_i = |d_i|/LDL0', () => {
    const d = dietFrom(k, { viscousG: k.hab.viscousG + 10, nutServings: 2 });
    const vf = -viscousFibreLdl(k.hab.viscousG + 10, k) + viscousFibreLdl(k.hab.viscousG, k);
    const nt = -nutsLdl(2, k);
    const sum = vf + nt;
    const total = -portfolioLdlTarget(d, k);
    expect(total).toBeLessThan(sum);
    expect(total).toBeGreaterThan(Math.max(vf, nt));
    near(total, k.ldl0 * (1 - (1 - vf / k.ldl0) * (1 - nt / k.ldl0)), 1e-9);
  });
});

describe('triglycerides (06 §4.5)', () => {
  it('omega-3 dose-response: 3.4 g/d at TG0 237 → −27.9 % (Skulas-Ray −27 % ± 8); 0.85 g/d ≈ no effect; capped at −40 %', () => {
    const { k } = makeRig({ labs: { tgMmolL: 237 / 88.57 } });
    near(tgOmega3Fraction(3.4, k), -0.279, 0.005);
    expect(Math.abs(tgOmega3Fraction(0.85, k))).toBeLessThan(0.04);
    near(tgOmega3Fraction(20, k), -0.4, 1e-12);
    const k200 = makeRig({ labs: { tgMmolL: 200 / 88.57 } }).k;
    near(tgOmega3Fraction(3.4, k200), -0.261, 0.002); // dossier: d = 3.4 → −26 % at TG0 200
    near(tgOmega3Fraction(2, k200), -0.135, 0.002);
    near(tgOmega3Fraction(4, k200), -0.315, 0.002);
  });
  it('alcohol: +0.19 mg/dL per g up to 60 g/d (30 g/d → +5.7 mg/dL)', () => {
    const { k } = makeRig();
    near(tgAlcoholMgDl(30, k), 5.7, 1e-9);
    near(tgAlcoholMgDl(100, k), 0.19 * 60, 1e-9);
  });
  it('sugar: hypercaloric fructose +28 %E → +0.26 mmol/L; balanced free sugars 0.006 per %E above 10', () => {
    const { k } = makeRig();
    const hyper = dietFrom(k, { fructosePct: k.hab.fructosePct + 28 });
    near(tgSugarMmol(hyper, k, 1), 0.26, 1e-9);
    const bal = dietFrom(k, { sugarPct: k.hab.sugarPct + 10 });
    near(tgSugarMmol(bal, k, 0), 0.06, 1e-9);
    expect(tgSugarMmol(hyper, k, 0)).toBeCloseTo(0, 9);
  });
});

describe('blood pressure (06 §4.8)', () => {
  it('β_Na,SBP = 1.0 + 1.8·sigmoid((SBP0 − 135)/8): 1.3 at 122, 2.4 at 145', () => {
    near(makeRig({ labs: { sbpMmHg: 122 } }).k.betaNa, 1.0 + 1.8 / (1 + Math.exp(13 / 8)), 1e-9);
    near(makeRig({ labs: { sbpMmHg: 122 } }).k.betaNa, 1.3, 0.1);
    near(makeRig({ labs: { sbpMmHg: 145 } }).k.betaNa, 2.4, 0.1);
  });
  it('sodium: −1 g/d lowers SBP by β_Na (no effect below the 2 g/d floor for SBP0 < 130); DASH shrinks the slope by 0.55', () => {
    const { k } = makeRig({ labs: { sbpMmHg: 145 } });
    near(bpSodiumTarget(dietFrom(k, { sodiumG: k.hab.sodiumG - 1 }), k), -k.betaNa, 1e-9);
    near(bpSodiumTarget(dietFrom(k, { sodiumG: k.hab.sodiumG - 1, dash: 1 }), k), -k.betaNa * 0.45, 1e-9);
    const norm = makeRig({ labs: { sbpMmHg: 118 } }).k;
    near(bpSodiumTarget(dietFrom(norm, { sodiumG: 1.2 }), norm), norm.betaNa * (2.0 - norm.hab.sodiumG), 1e-9);
  });
  it('potassium: −0.08 mmHg per mmol/d (cap 40), scaled by hyper_factor; zero beyond +80 mmol/d', () => {
    const hyp = makeRig({ labs: { sbpMmHg: 150 } }).k;
    near(bpPotassiumTarget(dietFrom(hyp, { potassiumMmol: hyp.hab.potassiumMmol + 30 }), hyp), -0.08 * 30, 1e-9);
    near(bpPotassiumTarget(dietFrom(hyp, { potassiumMmol: hyp.hab.potassiumMmol + 60 }), hyp), -0.08 * 40, 1e-9);
    expect(bpPotassiumTarget(dietFrom(hyp, { potassiumMmol: hyp.hab.potassiumMmol + 90 }), hyp)).toBe(0);
    const norm = makeRig({ labs: { sbpMmHg: 115 } }).k;
    near(bpPotassiumTarget(dietFrom(norm, { potassiumMmol: norm.hab.potassiumMmol + 30 }), norm), -0.08 * 30 * 0.4, 1e-9);
  });
  it('weight −1.05 mmHg per kg, alcohol +0.15 per g above 24 g/d, omega-3 −2.6 mmHg at 2 g/d, sauna −4 mmHg at 3 sessions/wk', () => {
    const { k } = makeRig();
    near(k.bpWeight, 1.05, 1e-12);
    near(bpAlcoholTarget(60, k), 0.15 * 36, 1e-9);
    near(bpAlcoholTarget(20, k), 0, 1e-9);
    near(bpOmega3Target(k.hab.omega3G + 3, k), -2.6 * (2 - k.hab.omega3G) / 2, 1e-9);
    near(bpSaunaTarget(3, k), -4, 1e-12);
    near(bpSaunaTarget(6, k), -4, 1e-12);
    near(bpSaunaTarget(0, k), 0, 1e-12);
  });
  it('exercise: endurance 150 min/wk lowers SBP by 0.75 + 7.5·sigmoid (normotensive ≈ −0.75 … hypertensive ≈ −8.3)', () => {
    const norm = makeRig({ labs: { sbpMmHg: 105 } }).k;
    const hyp = makeRig({ labs: { sbpMmHg: 160 } }).k;
    near(bpExerciseTarget(150, 0, 0, 0, norm), -(0.75 + 7.5 / (1 + Math.exp(30 / 8))), 0.02);
    expect(bpExerciseTarget(150, 0, 0, 0, hyp)).toBeLessThan(-7.5);
    expect(bpExerciseTarget(300, 0, 0, 0, hyp)).toBe(bpExerciseTarget(150, 0, 0, 0, hyp)); // saturates at 150 min/wk
  });
  it('exercise term is relative to the habitual weekly doses latched at the end of burn-in (0 at the habitual dose)', () => {
    const k = makeRig({ labs: { sbpMmHg: 140 } }).k;
    near(bpExerciseTarget(120, 10, 120, 10, k), 0, 1e-12);
    expect(bpExerciseTarget(150, 10, 60, 10, k)).toBeLessThan(0);
    expect(bpExerciseTarget(0, 0, 120, 10, k)).toBeGreaterThan(0); // stopping a habitual routine raises SBP
  });
});

describe('uric acid (06 §4.13)', () => {
  it('ketone term +0.6 mg/dL per mM BHB, capped at +4', () => {
    const { k } = makeRig();
    near(urateKetoneTarget(1, k), 0.6, 1e-12);
    near(urateKetoneTarget(5, k), 3, 1e-12);
    near(urateKetoneTarget(9, k), 4, 1e-12);
  });
  it('DASH effect scales with baseline urate: 0.08 at UA0 < 5 … 0.73 at ≥ 8 mg/dL', () => {
    const lo = makeRig({ labs: { urateMgDl: 4.5 } }).k;
    const mid = makeRig({ labs: { urateMgDl: 6.5 } }).k;
    const hi = makeRig({ labs: { urateMgDl: 9 } }).k;
    near(urateDashEffect(1, lo), 0.25 * 0.3, 1e-9);
    near(urateDashEffect(1, mid), 0.25 * 0.6, 1e-9);
    near(urateDashEffect(1, hi), 0.25 * 1.6, 1e-9);
    expect(urateDashEffect(1, hi)).toBeGreaterThan(0.35);
  });
});

describe('insulin-sensitivity factors (04 §4.18) and T_C (04 §4.19)', () => {
  const { k } = makeRig();
  it('F_LF: liver fat 12 % → 0.58; 3 % → 1', () => {
    near(fLiverFat(12, k), 0.581, 0.001);
    near(fLiverFat(3, k), 1, 1e-12);
    near(fLiverFat(1, k), 1, 1e-12);
  });
  it('F_adip: −2.6 %FM points ⇒ +23 % (dossier: observed +25 %); floor 0.40', () => {
    const a = fAdiposity(k.fmRefPct + 10, k);
    const b = fAdiposity(k.fmRefPct + 7.4, k);
    near(b / a, 1.231, 0.002);
    near(fAdiposity(k.fmRefPct + 50, k), 0.4, 1e-12);
  });
  it('F_steps: 1 344 steps/d ⇒ −17 % (Krogh-Madsen); ≥ 8 000 steps ⇒ 1', () => {
    near(fStepsTarget(1344, k), 0.83, 0.003);
    near(fStepsTarget(9000, k), 1, 1e-12);
  });
  it('F_fit clamp(1 + 0.01·(VO2max − 40), 0.85, 1.25); F_SFA, F_sugar targets', () => {
    near(fFitness(50, k), 1.1, 1e-12);
    near(fFitness(10, k), 0.85, 1e-12);
    near(fFitness(90, k), 1.25, 1e-12);
    near(fSfaTarget(20, 30, k), 1 - 0.12, 1e-12);
    // 04 §4.18 [101]: only while total fat < 37 %E (a 75 %E-fat ketogenic diet is not penalised for its SFA %E)
    near(fSfaTarget(25, 75, k), 1, 1e-12);
    near(fSfaTarget(20, 36.9, k), 1 - 0.12, 1e-12);
    near(fSugarTarget(25, k), 1 - 0.085, 1e-12);
  });
  it('F_EBh: −1000 kcal/d ⇒ ×1.25 hepatic; +1000 ⇒ ×0.90', () => {
    near(fEnergyBalance3d(-1000, k), 1.25, 1e-12);
    near(fEnergyBalance3d(-2500, k), 1.25, 1e-12);
    near(fEnergyBalance3d(1000, k), 0.9, 1e-12);
    near(fEnergyBalance3d(0, k), 1, 1e-12);
  });
  it('S_I = S_hep^0.4 · S_mus^0.6', () => {
    near(wholeBodySensitivity(0.8, 0.5, k), Math.pow(0.8, 0.4) * Math.pow(0.5, 0.6), 1e-12);
  });
  it('T_C* = clamp((CI_3d − 50)/100, 0, 1)', () => {
    expect(carbToleranceTarget(20, k)).toBe(0);
    near(carbToleranceTarget(100, k), 0.5, 1e-12);
    expect(carbToleranceTarget(300, k)).toBe(1);
  });
});

describe('fractional DNL biomarker (04 §4.13b anchors) and glycaemic helpers', () => {
  const { k } = makeRig();
  it('30 %E carbohydrate → ≈ 2 %, 75 %E → ≈ 13 % (Schwarz 2003) at a 25 % sugar share', () => {
    near(fractionalDnlPct(30, 0, 0.25, 1, k), 2, 0.1);
    near(fractionalDnlPct(75, 0, 0.25, 1, k), 13, 0.5);
  });
  it('hyperinsulinaemia and surplus raise it; capped at 50 %', () => {
    expect(fractionalDnlPct(45, 0, 0.25, 0.5, k)).toBeGreaterThan(fractionalDnlPct(45, 0, 0.25, 1, k));
    expect(fractionalDnlPct(45, 50, 0.25, 1, k)).toBeGreaterThan(fractionalDnlPct(45, 0, 0.25, 1, k));
    expect(fractionalDnlPct(90, 100, 1, 0.1, k)).toBe(50);
  });
  it('eAG = 28.7·A1c − 46.7 (ADAG); HOMA-IR = glucose·insulin/22.5 (reference 5.0·7/22.5 = 1.56)', () => {
    near(estimatedAverageGlucose(5.4, k), 108.28, 0.01);
    near(homaIr(5, 7), 1.556, 0.001);
  });
});

describe('baseline generators and correlated draws (06 §2.3, §4.17)', () => {
  const get = (id: string) => param(makeRig().ctx.params, `cardiometabolic.${id}`);
  it('reading example: 40-year-old woman, BMI 24 → LDL ≈ 108 mg/dL', () => {
    near(generatorValue(get, 'ldl', 1, 40, 24, 0), 108.1, 0.1);
  });
  it('NHANES table B1 cross-check: men 30-39 (BMI 27): SBP ≈ 120, HDL ≈ 47', () => {
    near(generatorValue(get, 'sbp', 0, 35, 27, 0), 121.3, 1.5);
    near(generatorValue(get, 'hdl', 0, 35, 27, 0), 50.2, 3.5);
  });
  it('the correlation matrix is symmetric positive definite (Cholesky succeeds) and reproduces C', () => {
    const l = cholesky(CORR, N_Z);
    for (let i = 0; i < N_Z; i++)
      for (let j = 0; j < N_Z; j++) {
        let s = 0;
        for (let m = 0; m < N_Z; m++) s += l[i * N_Z + m]! * l[j * N_Z + m]!;
        near(s, CORR[i * N_Z + j]!, 1e-12);
      }
  });
  it('Φ⁻¹ is accurate: Φ⁻¹(0.5) = 0, Φ⁻¹(0.975) = 1.959964, Φ⁻¹(0.1) = −1.281552; nominal draws give z = 0', () => {
    expect(normInv(0.5)).toBe(0);
    near(normInv(0.975), 1.959964, 1e-6);
    near(normInv(0.1), -1.281552, 1e-6);
    near(normInv(0.001), -3.090232, 1e-5);
    const z = correlatedZ(new Float64Array(N_Z).fill(0.5), cholesky(CORR, N_Z));
    for (let i = 0; i < N_Z; i++) expect(Math.abs(z[i]!)).toBe(0);
    expect(Number.isFinite(normInv(0))).toBe(true);
    expect(Number.isFinite(normInv(1))).toBe(true);
  });
  it('empirical correlation of the transformed draws matches the matrix (TG–HDL −0.43, TG–LDL +0.38, FPG–A1c +0.75)', () => {
    const l = cholesky(CORR, N_Z);
    let s = 1;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s + 0.5) / 4294967296;
    };
    const n = 6000;
    const acc = { tgHdl: 0, tgLdl: 0, fpgA1c: 0, tg2: 0, hdl2: 0, ldl2: 0, fpg2: 0, a1c2: 0 };
    for (let i = 0; i < n; i++) {
      const u = new Float64Array(N_Z);
      for (let j = 0; j < N_Z; j++) u[j] = rnd();
      const z = correlatedZ(u, l);
      acc.tgHdl += z[2]! * z[1]!;
      acc.tgLdl += z[2]! * z[0]!;
      acc.fpgA1c += z[4]! * z[6]!;
      acc.tg2 += z[2]! * z[2]!;
      acc.hdl2 += z[1]! * z[1]!;
      acc.ldl2 += z[0]! * z[0]!;
      acc.fpg2 += z[4]! * z[4]!;
      acc.a1c2 += z[6]! * z[6]!;
    }
    near(acc.tgHdl / Math.sqrt(acc.tg2 * acc.hdl2), -0.43, 0.04);
    near(acc.tgLdl / Math.sqrt(acc.tg2 * acc.ldl2), 0.38, 0.04);
    near(acc.fpgA1c / Math.sqrt(acc.fpg2 * acc.a1c2), 0.75, 0.04);
  });
  it('lab overrides replace the generator; ApoB0 = 11.09 + 0.587·nonHDL', () => {
    const k = makeRig({ labs: { ldlMmolL: 4, hdlMmolL: 1.2, tgMmolL: 1.5, sbpMmHg: 131, hba1cPct: 5.9, crpMgL: 2.2 } }).k;
    near(k.ldl0, 4 * 38.67, 1e-9);
    near(k.hdl0, 1.2 * 38.67, 1e-9);
    near(k.tg0, 1.5 * 88.57, 1e-9);
    near(k.sbp0, 131, 1e-12);
    near(k.a1c0, 5.9, 1e-12);
    near(k.crp0, 2.2, 1e-12);
    near(k.apoB0, 11.09 + 0.587 * (k.ldl0 + k.tg0 / 5), 1e-9);
    const w = makeRig({ profile: WOMAN_PROFILE }).k;
    expect(w.hdl0).toBeGreaterThan(makeRig().k.hdl0); // women's HDL is higher (Table B3)
  });
});
