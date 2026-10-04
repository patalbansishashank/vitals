/**
 * Pure equations of the cardiometabolic module (dossier 06 §4.2-4.13, 04 §4.13b/4.18-4.19, 13 §4.8, 10 §4.7/4.10,
 * 21 levers). Every function takes explicit numbers or the constants object `K`; none allocates or touches state, so
 * the unit tests can check each one against the dossier's worked numbers and the module composes them once per day.
 * Steady-state targets are DELTAS from the user's habitual (baseline) state unless a function says otherwise.
 */
import { clamp, clamp01 } from '../../core/math';
import type { CardiometabolicK } from './constants';
import type { Diet } from './diet';

// ----------------------------------------------------------------------------------------------------------------
// 04 §4.18 insulin-sensitivity factors (absolute, reference = 1)
// ----------------------------------------------------------------------------------------------------------------

/** F_LF = 1/(1 + a·max(0, LF% − 3)); LF 12 % ⇒ 0.58 (04 §4.18). */
export const fLiverFat = (lfPct: number, k: CardiometabolicK): number => 1 / (1 + k.lfA * Math.max(0, lfPct - k.lfRef));

/** F_EBh from the 3-day mean energy balance, kcal/d (deficit improves, surplus worsens hepatic sensitivity). */
export function fEnergyBalance3d(eb3KcalD: number, k: CardiometabolicK): number {
  return eb3KcalD < 0 ? 1 + k.ebDefA * Math.min(1, -eb3KcalD / k.ebScale) : 1 - k.ebSurA * Math.min(1, eb3KcalD / k.ebScale);
}

/** F_adip = max(0.40, exp(−0.08·max(0, FM% − FM%_ref))). */
export const fAdiposity = (fmPct: number, k: CardiometabolicK): number =>
  Math.max(k.adipFloor, Math.exp(-k.adipK * Math.max(0, fmPct - k.fmRefPct)));

/** F_steps target (before its own 7-day lag): 1 − 0.17·clamp((8000 − steps)/6700, 0, 1). */
export const fStepsTarget = (steps: number, k: CardiometabolicK): number => 1 - k.stepsA * clamp((k.stepsRef - steps) / k.stepsSpan, 0, 1);

/** F_fit = clamp(1 + 0.01·(VO2max − 40), 0.85, 1.25). */
export const fFitness = (vo2max: number, k: CardiometabolicK): number => clamp(1 + k.fitSlope * (vo2max - k.fitRef), k.fitMin, k.fitMax);

/** F_exAcute = 1 + a·E_is (04 §4.18, absolute: recent sessions raise S_mus; E_is 0..1 from the session history). */
export const fExerciseAcute = (eIs: number, k: CardiometabolicK): number => 1 + k.exA * eIs;

/** F_SFA target (before its 21-day lag) = 1 − 0.012·max(0, SFA%E − 10), only while total fat < 37 %E (04 §4.18 [101]). */
export const fSfaTarget = (sfaPct: number, fatPct: number, k: CardiometabolicK): number =>
  fatPct < k.sfaFatMax ? 1 - k.sfaA * Math.max(0, sfaPct - k.sfaRef) : 1;

/** F_sugar target (before its 7-day lag) = 1 − 0.0034·sugar%E. */
export const fSugarTarget = (sugarPct: number, k: CardiometabolicK): number => 1 - k.sugarA * sugarPct;

/** Whole-body relative insulin sensitivity S_I = S_hep^0.4 · S_mus^0.6 (04 §4.18). */
export const wholeBodySensitivity = (sHep: number, sMus: number, k: CardiometabolicK): number =>
  Math.pow(sHep, k.expHep) * Math.pow(sMus, 1 - k.expHep);

/** T_C* = clamp((CI_3d − 50)/100, 0, 1) (04 §4.19). */
export const carbToleranceTarget = (ci3dG: number, k: CardiometabolicK): number => clamp01((ci3dG - k.ciLow) / k.ciSpan);

/** 04 §4.13(b) hepatic fractional DNL (fasting), % of VLDL-FA; a biomarker, does not change fat mass. */
export function fractionalDnlPct(carbPctE: number, ebPct: number, sugarShareOfCarb: number, sHep: number, k: CardiometabolicK): number {
  const mSugar = k.fdnlSugarA + k.fdnlSugarB * sugarShareOfCarb;
  const mIr = 1 + k.fdnlIrGain * Math.max(0, 1 - sHep);
  const v = k.fdnlBase * Math.exp((k.fdnlSlope * (carbPctE - 45)) / 10) * (1 + (k.fdnlEbGain * Math.max(0, ebPct)) / k.fdnlEbScale) * mSugar * mIr;
  return Math.min(k.fdnlCap, v);
}

// ----------------------------------------------------------------------------------------------------------------
// Lipids (06 §4.2-4.7), all in mg/dL deltas (TG: ln)
// ----------------------------------------------------------------------------------------------------------------

/** Keys square-root law: dTC (mg/dL) = 1.5·(√z2 − √z1), z in mg per 1000 kcal; effect capped at 900 mg/d (06 §4.2.5). */
export function cholesterolDeltaTc(cholMg: number, energyKcal: number, k: CardiometabolicK): number {
  if (!(cholMg >= 0) || energyKcal <= 0) return 0;
  const z2 = (Math.min(cholMg, k.cholCapMg) * 1000) / energyKcal;
  return k.cholKeys * (Math.sqrt(z2) - Math.sqrt(k.cholZ0));
}

/** Composition target of LDL-C, mg/dL: Mensink exchange terms vs the habitual diet + dietary cholesterol. */
export function ldlCompositionTarget(d: Diet, k: CardiometabolicK, dTc: number): number {
  const h = k.hab;
  const dSfa = d.sfaEffPct - h.sfaEffPct;
  const dMufa = d.mufaPct - h.mufaPct;
  const dPufa = d.pufaPct - h.pufaPct;
  const dProt = d.protPct - h.protPct;
  return (
    k.mgdlPerMmolChol * (k.ldlScale * (k.ldlSfa * dSfa + k.ldlPufa * dPufa) + k.ldlMufa * dMufa + k.ldlProt * dProt) +
    k.cholLdlPerTc * k.cholResp * dTc
  );
}

/** Composition target of HDL-C, mg/dL (fat classes, protein, cholesterol, EPA+DHA); alcohol is added separately. */
export function hdlCompositionTarget(d: Diet, k: CardiometabolicK, dTc: number): number {
  const h = k.hab;
  const dSfa = d.sfaEffPct - h.sfaEffPct;
  const dMufa = d.mufaPct - h.mufaPct;
  const dPufa = d.pufaPct - h.pufaPct;
  const dProt = d.protPct - h.protPct;
  return (
    k.mgdlPerMmolChol * (k.hdlSfa * dSfa + k.hdlMufa * dMufa + k.hdlPufa * dPufa + k.hdlProt * dProt) +
    k.cholHdlPerTc * k.cholResp * dTc +
    k.hdlN3PerG * (d.omega3G - k.hab.omega3G)
  );
}

/**
 * ln-TG target of the fatty-acid / protein exchange (06 §4.5 components 1-2); carbohydrate is the reference. The fat-class
 * deltas are scaled so that total fat never acts beyond the regression's range of validity (53 %E).
 */
export function tgExchangeLn(d: Diet, k: CardiometabolicK): number {
  const h = k.hab;
  let valid = 1;
  if (d.fatPct > k.tgExchangeFatMax) {
    const over = d.fatPct - h.fatPct;
    valid = over > 0 ? clamp01((k.tgExchangeFatMax - h.fatPct) / over) : 1;
  }
  return (
    valid * (k.tgSfa * (d.sfaEffPct - h.sfaEffPct) + k.tgMufa * (d.mufaPct - h.mufaPct) + k.tgPufa * (d.pufaPct - h.pufaPct)) +
    k.tgProt * (d.protPct - h.protPct)
  );
}

/**
 * Sugar term of TG in mmol/L (06 §4.5 component 3): hypercaloric fructose excess vs energy-balanced free sugars,
 * blended by the surplus indicator `wS` ∈ [0, 1] (smooth form of 1[energy surplus]).
 */
export function tgSugarMmol(d: Diet, k: CardiometabolicK, wS: number): number {
  const h = k.hab;
  const excess = Math.max(0, d.fructosePct - h.fructosePct);
  const hyper = k.tgSugarHyper * Math.min(1, excess / k.tgSugarExcessRef);
  const bal = k.tgSugarBalanced * (Math.max(0, d.sugarPct - k.tgSugarFreeRef) - Math.max(0, h.sugarPct - k.tgSugarFreeRef));
  return wS * hyper + (1 - wS) * bal;
}

/** Alcohol effect on TG in mg/dL (0.19 mg/dL per g up to 60 g/d), relative to the baseline intake. */
export const tgAlcoholMgDl = (alcG: number, k: CardiometabolicK): number =>
  k.tgAlcPerG * (Math.min(alcG, k.tgAlcCap) - Math.min(k.alc0G, k.tgAlcCap));

/** Omega-3 effect on TG as a fraction: −0.09·max(0, d − 0.5)·(TG0/200)^0.4, capped at −40 % (06 §4.5 component 5). */
export const tgOmega3Fraction = (n3G: number, k: CardiometabolicK): number =>
  -Math.min(k.tgN3Cap, k.tgN3PerG * Math.max(0, n3G - k.tgN3Threshold) * k.tgN3Scale);

/** ln(1 + x) guarded against x ≤ −1. */
export const lnOnePlus = (x: number): number => Math.log(x > -0.95 ? 1 + x : 0.05);

/** LEM term magnitude at a BMI: max(0, A_LEM − b·(BMI − 22)), mg/dL (06 §4.3). */
export const lemAmplitude = (bmi: number, k: CardiometabolicK): number => Math.max(0, k.lemA - k.lemB * (bmi - k.lemBmiRef));

/** Ketosis state s_keto ∈ [0, 1] from mean BHB: 0 at ≤ 0.5 mM, 1 at ≥ 1.5 mM (06 §4.3). */
export const ketosisState = (bhbMmolL: number, k: CardiometabolicK): number => clamp01((bhbMmolL - k.lemKetoLo) / (k.lemKetoHi - k.lemKetoLo));

/** E_mod = clip(1 − 2·(EI/EE − 1), 0, 1.5), u = EI/EE − 1 (deficits raise, surpluses lower the LEM rise; grade D). */
export const lemEnergyModifier = (u: number, k: CardiometabolicK): number => clamp(1 - k.lemEmodSlope * u, 0, k.lemEmodMax);

/** Viscous-fibre LDL effect in mg/dL (negative), saturating: −Emax·d/(d + D50), scaled by (LDL0/115) (06 §4.4). */
export const viscousFibreLdl = (gPerDay: number, k: CardiometabolicK): number =>
  gPerDay <= 0 ? 0 : -k.vfEmaxMg * (gPerDay / (gPerDay + k.vfD50)) * (k.ldl0 / k.vfLdlRef);

/** Nut LDL effect in mg/dL (negative): −4.8 per serving (≤ 2), −5.5 per serving for 2-3 servings, capped at 3. */
export function nutsLdl(servings: number, k: CardiometabolicK): number {
  const n = Math.min(Math.max(0, servings), k.nutCap);
  const mg = n <= 2 ? k.nutPerServing * n : k.nutPerServing * 2 + k.nutPerServingHigh * (n - 2);
  return -mg * (k.ldl0 / k.vfLdlRef);
}

/**
 * Portfolio LDL delta vs the habitual intake, mg/dL: components are combined sub-additively,
 * total = 1 − Π(1 − f_i), f_i = |effect_i|/LDL0 (06 §4.4 "combination").
 */
export function portfolioLdlTarget(d: Diet, k: CardiometabolicK): number {
  // effects relative to the habitual intake (habitual viscous fibre and nuts are already in the baseline LDL)
  const fVf = clamp01(-(viscousFibreLdl(d.viscousG, k) - k.vfLdlHab) / k.ldl0);
  const fNut = clamp01(-(nutsLdl(d.nutServings, k) - k.nutLdlHab) / k.ldl0);
  const total = 1 - (1 - fVf) * (1 - fNut);
  return -total * k.ldl0;
}

// ----------------------------------------------------------------------------------------------------------------
// Blood pressure (06 §4.8; 21 levers), mmHg deltas
// ----------------------------------------------------------------------------------------------------------------

/** Sodium term: m_Na·β_Na·(Na_eff − Na_base)·(1 − 0.55·DASH), with the < 2 g/d floor for normotensives. */
export function bpSodiumTarget(d: Diet, k: CardiometabolicK): number {
  const naEff = k.naFloorActive === 1 ? Math.max(d.sodiumG, k.naFloorG) : d.sodiumG;
  const naBase = k.naFloorActive === 1 ? Math.max(k.hab.sodiumG, k.naFloorG) : k.hab.sodiumG;
  return k.mNa * k.betaNa * (naEff - naBase) * (1 - k.dashNaShrink * d.dash);
}

/** Potassium term: −0.08·min(dK, 40)·hyper_factor·(Na_base ≥ 3 g/d ? 1 : 0.4); zero beyond +80 mmol/d net (U-shape). */
export function bpPotassiumTarget(d: Diet, k: CardiometabolicK): number {
  const dK = d.potassiumMmol - k.hab.potassiumMmol;
  if (dK >= k.kZero) return 0;
  const naFactor = k.hab.sodiumG >= k.kNaThresholdG ? 1 : k.kLowNaFactor;
  return -k.kPerMmol * Math.min(dK, k.kCap) * k.kHyper * naFactor;
}

/**
 * Exercise term (endurance + dynamic resistance) relative to the habitual dose, mmHg. Doses: aerobic min/wk at ≥ 40 %
 * VO2max and resistance sets per region per week, today's 7-day sums and the habitual week's (latched at the end of burn-in).
 */
export function bpExerciseTarget(aerMinWk: number, rtSetsPerRegionWk: number, aerRefMinWk: number, rtRefPerRegionWk: number, k: CardiometabolicK): number {
  const aer = Math.min(1, aerMinWk / k.exRefMin) - Math.min(1, aerRefMinWk / k.exRefMin);
  const rt = Math.min(1, rtSetsPerRegionWk / k.exRtRefSets) - Math.min(1, rtRefPerRegionWk / k.exRtRefSets);
  return -(k.exEndurance * aer + k.exRt * rt);
}

/** Alcohol term: +0.15 mmHg per g/d for the part above 24 g/d, relative to the baseline intake. */
export const bpAlcoholTarget = (alcG: number, k: CardiometabolicK): number =>
  k.bpAlcohol * (Math.max(0, alcG - k.bpAlcoholThr) - Math.max(0, k.alc0G - k.bpAlcoholThr));

/** Omega-3 lever (21 X3): −2.6·min(D, 2)/2 mmHg relative to the habitual intake. */
export const bpOmega3Target = (n3G: number, k: CardiometabolicK): number =>
  -(k.bpOmega3 / 2) * (Math.min(n3G, 2) - Math.min(k.hab.omega3G, 2));

/** Sauna lever (21 X7): −4·min(1, sessions/3) mmHg. */
export const bpSaunaTarget = (sessionsPerWeek: number, k: CardiometabolicK): number =>
  -k.bpSauna * Math.min(1, Math.max(0, sessionsPerWeek) / k.bpSaunaRef);

// ----------------------------------------------------------------------------------------------------------------
// Uric acid (06 §4.13), mg/dL deltas
// ----------------------------------------------------------------------------------------------------------------

/** Ketone term: +0.6 mg/dL per mM BHB, capped (06 §4.13). */
export const urateKetoneTarget = (bhbMmolL: number, k: CardiometabolicK): number => Math.min(k.uaCap, k.uaPerBhb * Math.max(0, bhbMmolL));

/** DASH effect scales with baseline urate: 0.25·DASH·clip((UA0 − 5)/2.5, 0.3, 2.5). */
export const urateDashEffect = (dash: number, k: CardiometabolicK): number =>
  k.uaDash * dash * clamp((k.ua0 - k.uaDashBase) / k.uaDashSpan, 0.3, 2.5);

// ----------------------------------------------------------------------------------------------------------------
// Glycaemia (06 §4.11) and derived quantities
// ----------------------------------------------------------------------------------------------------------------

/** eAG (mg/dL) = 28.7·A1c − 46.7 (ADAG). */
export const estimatedAverageGlucose = (a1cPct: number, k: CardiometabolicK): number => k.eagSlope * a1cPct - k.eagIntercept;

/** HOMA-IR = glucose[mmol/L]·insulin[µU/mL]/22.5 (Matthews 1985; 04 §4.18). */
export const homaIr = (glcMmolL: number, insUuMl: number): number => (glcMmolL * insUuMl) / 22.5;
