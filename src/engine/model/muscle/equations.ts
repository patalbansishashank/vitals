/**
 * Pure equations of the muscle module (dossier 09 §4.1-4.14, 03 §4.5/4.7/4.8/4.10/4.14, 15 §4.10/4.12).
 * No allocation; every function is a scalar map so it can be unit-tested against the dossiers' worked numbers.
 */
import type { MuscleConstants as K, Mps03Constants as M } from './constants';

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ------------------------------------------------------------------ 09 §4.1 effective-set scalar

/** k_RIR(L): 0.045 at ≥ 80 %1RM, 0.075 below 60 %1RM, else the drawn moderate-load slope. */
export function kRirFor(k: K, loadPct: number): number {
  if (loadPct >= k.loadHeavyPct) return k.kRirHeavy;
  if (loadPct < k.loadModeratePct) return k.kRirLight;
  return k.kRir;
}

/** f_RIR = clamp(1 − k_RIR(L)·RIR, 0, 1). */
export function fRir(k: K, rir: number, loadPct: number): number {
  return clamp(1 - kRirFor(k, loadPct) * (rir > 0 ? rir : 0), 0, 1);
}

/** f_load: 1 at ≥ 35 %1RM; linear 0.45 → 1 between 20 and 35 %; 0.35 below 20 % (UNVERIFIED). */
export function fLoad(k: K, loadPct: number): number {
  if (loadPct >= k.loadFullPct) return 1;
  if (loadPct >= k.loadVeryLightPct) {
    return k.fLoad20 + ((1 - k.fLoad20) * (loadPct - k.loadVeryLightPct)) / (k.loadFullPct - k.loadVeryLightPct);
  }
  return k.fLoadVeryLight;
}

/** f_rest: 0.88 for rest ≤ 60 s, 0.95 for 60-90 s, 1.0 for ≥ 90 s. */
export function fRest(k: K, restSec: number): number {
  if (restSec <= k.restShortSec) return k.fRest60;
  if (restSec < k.restFullSec) return k.fRest90;
  return 1;
}

// ------------------------------------------------------------------ 09 §4.2-4.3 volume and frequency

/** Pelland G(V) = exp(β(√(V+1) − 1)) − 1 (fraction of muscle size over ~10.4 wk). */
export function gVolume(k: K, v: number): number {
  return Math.exp(k.beta * (Math.sqrt((v > 0 ? v : 0) + 1) - 1)) - 1;
}

/** f_V(V) = G(min(V, V_cap))/G(12). */
export function fVolume(k: K, v: number): number {
  return gVolume(k, v < k.vCap ? v : k.vCap) / k.gRef;
}

/** f_F(F): 0, 0.90, 1.00, 1.05 for F = 0, 1, 2, ≥ 3 training days per region per week. */
export function fFreq(k: K, f: number): number {
  if (f < 0.5) return 0;
  if (f < 1.5) return k.fF1;
  if (f < 2.5) return k.fF2;
  return k.fF3;
}

/** Strength practice factor f_FS(F) = (exp(0.2395·F/(F+1)) − 1)/(exp(0.2395·2/3) − 1). */
export function fFreqStrength(k: K, f: number): number {
  const ff = f > 0 ? f : 0;
  return (Math.exp((k.kFS * ff) / (ff + 1)) - 1) / k.fsRef;
}

/** Strength volume response h_S(V) = (exp(0.14635·V/(V+1)) − 1)/(exp(0.14635·12/13) − 1). */
export function hStrength(k: K, v: number): number {
  const vv = v > 0 ? v : 0;
  return (Math.exp((k.hSCoef * vv) / (vv + 1)) - 1) / k.hSRef;
}

/** f_loadS: 1.0 (≥ 80 %1RM), 0.85 (60-80 %), 0.65 (< 60 %). */
export function fLoadStrength(k: K, loadPct: number): number {
  if (loadPct >= k.loadHeavyPct) return 1;
  if (loadPct >= k.loadModeratePct) return k.fLoadSMod;
  return k.fLoadSLight;
}

// ------------------------------------------------------------------ 09 §4.4 kernel

/** Kernel amplitude A(H)·a(s) = (1 + 0.6·H)·(1 − exp(−s/4)). */
export function kernelAmp(k: K, h: number, sets: number): number {
  return (k.kernelA0 + k.kernelAH * h) * (1 - Math.exp(-(sets > 0 ? sets : 0) / k.kernelSets));
}

/** Session-volume saturation a(s) = 1 − exp(−s/4) (also the 03 bout stimulus I_b). */
export function boutStimulus(k: K, sets: number): number {
  return 1 - Math.exp(-(sets > 0 ? sets : 0) / k.kernelSets);
}

/** τ(H) = 30 − 20·H hours. */
export function kernelTau(k: K, h: number): number {
  return k.kernelTau0 - k.kernelTauH * h;
}

/** Normalised kernel shape φ(Δ): Δ/3 for Δ < 3 h, exp(−(Δ − 3)/τ) after. */
export function kernelShape(k: K, dtH: number, tauH: number): number {
  if (dtH < 0) return 0;
  if (dtH < k.kernelRampH) return dtH / k.kernelRampH;
  return Math.exp(-(dtH - k.kernelRampH) / tauH);
}

// ------------------------------------------------------------------ 09 §4.6-4.7 potential, age

/** f_age = 1 up to 40 y, then max(0.6, 1 − 0.0086·(age − 40)). */
export function fAge(k: K, age: number): number {
  if (age <= k.ageHypStart) return 1;
  const v = 1 - k.ageHypSlope * (age - k.ageHypStart);
  return v > k.ageHypFloor ? v : k.ageHypFloor;
}

export interface Ts0Result {
  /** Whole-body TS₀. */
  ts0: number;
  /** Y_eff the years route used, y (entered/derived training years, else the habits bucket). */
  yearsEff?: number;
  /** Route from training years, 1 − exp(−0.47·Y_eff). */
  tsYears: number;
  /** Route from FFMI above the untrained reference (clamped 0..0.95). */
  tsFfmi: number;
  /** ΔFFMI_pot after the above-average-responder rescaling, kg/m². */
  dFfmiPot: number;
}

/**
 * 09 §4.6 initialisation: TS₀ = max(1 − e^{−0.47·Y_eff}, clamp((FFMI − FFMI_untr)/ΔFFMI_pot, 0, 0.95)); when
 * FFMI > FFMI_untr + ΔFFMI_pot the potential is raised to (FFMI − FFMI_untr)/0.95.
 */
export function initialTrainingStatus(k: K, dFfmiPot: number, yearsEff: number, ffmi: number, ffmiUntr: number): Ts0Result {
  const tsYears = 1 - Math.exp(-k.ts0YearRate * (yearsEff > 0 ? yearsEff : 0));
  const excess = ffmi - ffmiUntr;
  let pot = dFfmiPot;
  if (Number.isFinite(excess) && excess > pot) pot = excess / k.ts0Cap;
  const tsFfmi = Number.isFinite(excess) ? clamp(excess / pot, 0, k.ts0Cap) : 0;
  return { ts0: tsYears > tsFfmi ? tsYears : tsFfmi, yearsEff: yearsEff > 0 ? yearsEff : 0, tsYears, tsFfmi, dFfmiPot: pot };
}

// ------------------------------------------------------------------ 09 §4.8 energy/protein (f_P per kg body mass, R-RT revised), retention

/**
 * 09 §4.8 protein factor f_P(P) = f_P0 + (1 − f_P0)·clamp((P − 0.8)/(1.6 − 0.8), 0, 1), P = effective protein in g/kg body
 * mass/d (MODEL_SPEC R-RT revised: 7-day mean of 03 §4.10 quality-weighted intake). 0.8 → 0.44; 1.2 → 0.72; 1.4 → 0.86; ≥ 1.6 → 1.
 */
export function fProtein(k: K, pBw: number): number {
  return k.fP0 + (1 - k.fP0) * clamp((pBw - k.pLow) / (k.pPlateau - k.pLow), 0, 1);
}

/** 09 §4.8 protein rescue ρ(P) = ρ_max·clamp((P − 1.2)/(2.2 − 1.2), 0, 1), P in g/kg BW/d. */
export function rhoProtein(k: K, pBw: number): number {
  return k.rhoMax * clamp((pBw - k.rhoPLow) / (k.rhoPHigh - k.rhoPLow), 0, 1);
}

/**
 * 09 §4.8 f_EP(e, P, TS): deficit f_E = max(0, 1 + e/d0), f_EP = f_E + (1 − f_E)·ρ(P); surplus
 * f_EP = 1 + b_s·(1 − TS)·min(e, e_sat)/e_sat.
 */
export function fEnergyProtein(k: K, e: number, pBw: number, ts: number): number {
  if (e < 0) {
    const fE = 1 + e / k.d0;
    const fe = fE > 0 ? fE : 0;
    return fe + (1 - fe) * rhoProtein(k, pBw);
  }
  return 1 + (k.bS * (1 - ts) * (e < k.eSat ? e : k.eSat)) / k.eSat;
}

/** V_R(age): 6 effective sets/wk up to 50 y, linear to 10 at ≥ 70 y. */
export function vRetention(k: K, age: number): number {
  return k.vRYoung + (k.vROld - k.vRYoung) * clamp((age - k.vRAgeLo) / (k.vRAgeHi - k.vRAgeLo), 0, 1);
}

/** R_RT = R_max·clamp(V_wb/V_R(age), 0, 1). */
export function retentionFrac(k: K, vWb: number, age: number): number {
  return k.rMax * clamp(vWb / vRetention(k, age), 0, 1);
}

// ------------------------------------------------------------------ 09 §4.10 detraining

/** V_maint(age): 3 up to 50 y, linear to 9 at 70 y, linear to 10 at 75 y, 10 above. */
export function vMaintenance(k: K, age: number): number {
  if (age <= k.vMaintAgeLo) return k.vMaintYoung;
  if (age <= k.vMaintAgeMid) {
    return k.vMaintYoung + ((k.vMaint70 - k.vMaintYoung) * (age - k.vMaintAgeLo)) / (k.vMaintAgeMid - k.vMaintAgeLo);
  }
  if (age <= k.vMaintAgeHi) {
    return k.vMaint70 + ((k.vMaintOld - k.vMaint70) * (age - k.vMaintAgeMid)) / (k.vMaintAgeHi - k.vMaintAgeMid);
  }
  return k.vMaintOld;
}

/** λ(T) = clamp((T − 14)/14, 0, 1). */
export function detrainLambda(k: K, tLow: number): number {
  return clamp((tLow - k.detrainOnsetD) / k.detrainRampD, 0, 1);
}

/**
 * R-DETRAIN (MODEL_SPEC §1.9): trained gains of a habitual lifter at t = 0, kg (whole body) — the part of M_acc,0 the body
 * carries above its untrained, FFMI-derived set-point: `min(M_acc,0, h²·max(FFMI − FFMI_untr, ΔFFMI_train))`, where
 * ΔFFMI_train is dossier 14's training offset for the stated years (the body module's `trainingFfmiOffset`), so a stated
 * history counts even when the body estimate did not use it. Never negative.
 */
export function trainedGains0(mAcc0: number, heightM: number, ffmiExcess: number, dFfmiTrain: number): number {
  const ex = Number.isFinite(ffmiExcess) ? ffmiExcess : 0;
  const dt = Number.isFinite(dFfmiTrain) ? dFfmiTrain : 0;
  const g = heightM * heightM * (ex > dt ? ex : dt);
  return clamp(g, 0, mAcc0 > 0 ? mAcc0 : 0);
}

/**
 * R-DETRAIN retained floor of a region, kg: `mBase + φ·(M_acc,0 − mBase)` — the set-point plus the retained share φ of the
 * long-term trained gains. Detraining decays towards it (09 §4.10 exponential, τ_d), never below.
 */
export function detrainFloor(mAcc0: number, mBase: number, phi: number): number {
  const g = mAcc0 - mBase;
  return g > 0 ? mBase + clamp(phi, 0, 1) * g : mBase;
}

// ------------------------------------------------------------------ 09 §4.14 strength

/** N_max(TS) = 0.05 + 0.125·(1 − TS) (R-STR slope). */
export function nMax(k: K, ts: number): number {
  return k.nMaxBase + k.nMaxSlope * (1 - ts);
}

// ------------------------------------------------------------------ 15 §4.10 alcohol, 15 §4.12 creatine

/**
 * f_alc for a training day: 1 − min(0.25, 0.16·dose) with ≥ 0.3 g/kg protein within 2 h of the session, else
 * 1 − min(0.37, 0.25·dose); dose in g ethanol per kg body mass taken in the 8 h after the session.
 */
export function fAlcohol(k: K, doseGkg: number, proteinOk: boolean): number {
  if (!(doseGkg > 0)) return 1;
  if (proteinOk) {
    const red = k.alcProtSlope * doseGkg;
    return 1 - (red < k.alcProtCap ? red : k.alcProtCap);
  }
  const red = k.alcNoProtSlope * doseGkg;
  return 1 - (red < k.alcNoProtCap ? red : k.alcNoProtCap);
}

/** f_Cr = 1 + 0.05·creatine saturation (R-CREATINE). */
export function fCreatine(k: K, sat: number): number {
  return 1 + k.crAccretion * clamp(sat, 0, 1);
}

// ------------------------------------------------------------------ 03 §4.7/4.14/4.5 MPS display layer

/** 03 age ramp clamp((age − 30)/40, 0, 1). */
export function ageRamp(k: M, age: number): number {
  return clamp((age - k.arAgeLo) / k.arAgeSpan, 0, 1);
}

/** K_age = K·(1 + 0.67·ageRamp). */
export function kAgeMps(k: M, age: number): number {
  return k.kMps * (1 + k.kAgeMps * ageRamp(k, age));
}

/** Feeding stimulus S = x^n/(K_age^n + x^n) for n = 4 (x = quality-weighted AA appearance per kg FFM, g/kg/h). */
export function feedingStimulus(x: number, kAge: number): number {
  if (!(x > 0)) return 0;
  const x2 = x * x;
  const x4 = x2 * x2;
  const k2 = kAge * kAge;
  return x4 / (k2 * k2 + x4);
}

/**
 * Exact one-hour step of dR/dt = k_R·S^m·(1 − R) − R/τ_R with S held (m = 4): R ← R* + (R − R*)·e^{−(a+b)},
 * a = k_R·S⁴, b = 1/τ_R. Returns the end-of-hour value.
 */
export function refractoryStep(k: M, r: number, s: number): number {
  const s2 = s * s;
  const a = k.kR * s2 * s2;
  if (a < 1e-12) return r * k.rDecayF;
  const ab = a + k.invTauR;
  const rs = a / ab;
  return rs + (r - rs) * Math.exp(-ab);
}

/** 03 §4.4.2 leanness index L = clamp((0.30 − bf_maleEq)/0.20, 0, 1). */
export function leanness(k: M, bf: number, female: boolean): number {
  const bfm = female ? bf - k.leanFemaleOffset : bf;
  return clamp((k.leanBfHigh - bfm) / k.leanBfSpan, 0, 1);
}

/** 03 §4.4.2 protein adequacy x_P = clamp((q − 0.8)/max(q_sat − 0.8, 0.3), 0, 1), q_sat = 1.2 + min(d, 0.45)(2 + 3L). */
export function proteinAdequacy(k: M, q: number, deficit: number, lean: number): number {
  const d = deficit > 0 ? deficit : 0;
  const qSat = k.xpSatBase + (d < k.xpDeficitCap ? d : k.xpDeficitCap) * (k.xpSatDeficit + k.xpSatLean * lean);
  const span = qSat - k.xpKnee;
  return clamp((q - k.xpKnee) / (span > k.xpMinSpan ? span : k.xpMinSpan), 0, 1);
}

/** 03 §4.5 f_E,MPS = max(0.5, 1 − 0.9·d·(1 − 0.5·x_P)). */
export function fEnergyMps(k: M, deficit: number, xP: number): number {
  const d = deficit > 0 ? deficit : 0;
  const v = 1 - k.fEMpsSlope * d * (1 - k.fEMpsProt * xP);
  return v > k.fEMpsFloor ? v : k.fEMpsFloor;
}

/** 03 §4.14 obesity ramp 0 at BMI 25 → 1 at BMI 30. */
export function obesityRamp(k: M, bmi: number): number {
  return clamp((bmi - k.bmiArLo) / (k.bmiArHi - k.bmiArLo), 0, 1);
}

// ------------------------------------------------------------------ 03 §4.8 distribution efficiency (daily formula)

/**
 * E_dist = 1 − 0.06·(3 − n_eff) − 0.05·clamp((8 − W)/4, 0, 1), clamped to [0.83, 1] (MODEL_SPEC §1.9 range).
 * n_eff = meals whose quality-weighted protein ≥ max(0.28 g/kg FFM·(1 + 0.8·ageRamp)·FFM, 15 g), spaced ≥ 3 h from
 * the previous qualifying meal, capped at 3; W = first to last protein-containing meal + 1 h.
 * `mealClockH`, `mealProtQ` (g, Q_meal-weighted) and `mealProtG` are parallel arrays of `n` meals in clock order.
 */
export function distributionEfficiency(
  k: M,
  n: number,
  mealClockH: ArrayLike<number>,
  mealProtQ: ArrayLike<number>,
  mealProtG: ArrayLike<number>,
  ffmKg: number,
  age: number,
): number {
  const thr0 = k.eDistMealThresh * (1 + k.eDistAgeSlope * ageRamp(k, age)) * ffmKg;
  const thr = thr0 > k.eDistMinMealG ? thr0 : k.eDistMinMealG;
  let nEff = 0;
  let lastQ = -1e9;
  let first = 1e9;
  let last = -1e9;
  for (let i = 0; i < n; i++) {
    const t = mealClockH[i]!;
    if (mealProtG[i]! > 0) {
      if (t < first) first = t;
      if (t > last) last = t;
    }
    if (mealProtQ[i]! >= thr && t - lastQ >= k.eDistSpacingH) {
      nEff++;
      lastQ = t;
    }
  }
  if (nEff > k.eDistMealsRef) nEff = k.eDistMealsRef;
  const win = last >= first ? last - first + 1 : 0;
  const e =
    1 -
    k.eDistMealPenalty * (k.eDistMealsRef - nEff) -
    k.eDistWindowPenalty * clamp((k.eDistWindowRefH - win) / k.eDistWindowSpanH, 0, 1);
  return clamp(e, k.eDistFloor, 1);
}
