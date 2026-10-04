/**
 * composition — pure partition functions (docs/MODEL_SPEC.md §1.8 step 2; rulings R-PART, R-RT, R-FAST, R-OVERSHOOT).
 *
 * Every function here is allocation-free and takes the prepared constants object `K` (built once in `prepare`), so the
 * same code runs in the hot path and in the unit tests. Units: kg, g/d, kcal/d, fractions 0..1.
 */
import type { ModelParams } from '../../types/params';
import { param } from '../../core/paramsRegistry';
import { clamp } from '../../core/math';

/** Prepared constants (read once from ModelParams in `prepare`; §0.4). Field comments give the unit. */
export interface CompositionConstants {
  /** Fat energy density ρF and deposition cost ηF, kcal/kg. */
  rhoF: number;
  etaF: number;
  /** Lean-tissue energy density ρL and deposition cost ηL, kcal/kg (Hall convention). */
  rhoL: number;
  etaL: number;
  /** ρF + ηF and ρL + ηL, kcal/kg (effective densities for either sign, §0.2). */
  effF: number;
  effL: number;
  /** Bound water per g protein h_P, g/g; protein fraction of lean tissue f_prot = 1/(1 + h_P). */
  hP: number;
  fProt: number;
  lt0GlycogenWater: number;
  // 03 §4.4.2
  forbesC: number;
  p0Shift: number;
  leanBfMale: number;
  leanBfSpan: number;
  leanBfFemaleOffset: number;
  qSatBase: number;
  qSatDeficitSlope: number;
  qSatLeanSlope: number;
  qSatDeficitCap: number;
  qKnee: number;
  xpMinSpan: number;
  mMin: number;
  mMinDeficitRelief: number;
  mMinDeficitPivot: number;
  mMinDeficitSpan: number;
  dCrit: number;
  dCritLeanSlope: number;
  effDWidth: number;
  mDSlope: number;
  mDRef: number;
  mDMin: number;
  mDMax: number;
  mAct: number;
  mAgeSlope: number;
  mAgePivot: number;
  mAgeMax: number;
  pCatMax: number;
  // 11 §4.7
  rAT: number;
  rS: number;
  mPp0: number;
  mPScale: number;
  mPNorm: number;
  mPMin: number;
  mPMax: number;
  phiFCap: number;
  mFaPufa: number;
  mFaSfa: number;
  mFaRefPufaShare: number;
  mFaRefSfaShare: number;
  mFaRichShare: number;
  sRtSets: number;
  // 11 §4.12
  osA: number;
  osB: number;
  osC: number;
  osRampLo: number;
  osRampHi: number;
  osFfmDefMin: number;
  osExpiryD: number;
  osOldAge: number;
  osOldAgeMult: number;
  // 03 §4.13
  poxMin: number;
  poxMinLeanSlope: number;
  pox0: number;
  tauN: number;
  poxBhbRef: number;
  poxChoSparing: number;
  poxChoRefG: number;
  poxChoDays: number;
  poxDietProt: number;
  vliEnergyFrac: number;
  vliProteinQ: number;
  vliProteinMinG: number;
  fmFloorFracBw0: number;
  fmFloorRampKg: number;
  // 03 §4.14, SM, EB7
  ageLeanGD: number;
  ageLeanPivot: number;
  ageLeanSpan: number;
  ageLeanCap: number;
  ageLeanRtOffset: number;
  smLossShare: number;
  smRtShare: number;
  /** EB7 window, d (trailing boxcar mean). */
  eb7WindowD: number;
  /** Half-width of the deficit↔surplus p_E blend in EB7, kcal/d (review m20). */
  partBlendKcalD: number;
  /** exp(−1 d/τ_EB7): daily decay factor of the EB7 EMA (precomputed). */
}

/** Build the constants object from the registry (prepare-time only). */
export function readConstants(p: ModelParams): CompositionConstants {
  const g = (n: string): number => param(p, `composition.${n}`);
  const hP = g('hP');
  const k: CompositionConstants = {
    rhoF: g('rhoF'),
    etaF: g('etaF'),
    rhoL: g('rhoL'),
    etaL: g('etaL'),
    effF: g('rhoF') + g('etaF'),
    effL: g('rhoL') + g('etaL'),
    hP,
    fProt: 1 / (1 + hP),
    lt0GlycogenWater: g('lt0GlycogenWater'),
    forbesC: g('forbesC'),
    p0Shift: g('p0Shift'),
    leanBfMale: g('leanBfMale'),
    leanBfSpan: g('leanBfSpan'),
    leanBfFemaleOffset: g('leanBfFemaleOffset'),
    qSatBase: g('qSatBase'),
    qSatDeficitSlope: g('qSatDeficitSlope'),
    qSatLeanSlope: g('qSatLeanSlope'),
    qSatDeficitCap: g('qSatDeficitCap'),
    qKnee: g('qKnee'),
    xpMinSpan: g('xpMinSpan'),
    mMin: g('mMin'),
    mMinDeficitRelief: g('mMinDeficitRelief'),
    mMinDeficitPivot: g('mMinDeficitPivot'),
    mMinDeficitSpan: g('mMinDeficitSpan'),
    dCrit: g('dCrit'),
    dCritLeanSlope: g('dCritLeanSlope'),
    effDWidth: g('effDWidth'),
    mDSlope: g('mDSlope'),
    mDRef: g('mDRef'),
    mDMin: g('mDMin'),
    mDMax: g('mDMax'),
    mAct: g('mAct'),
    mAgeSlope: g('mAgeSlope'),
    mAgePivot: g('mAgePivot'),
    mAgeMax: g('mAgeMax'),
    pCatMax: g('pCatMax'),
    rAT: g('rAT'),
    rS: g('rS'),
    mPp0: g('mPp0'),
    mPScale: g('mPScale'),
    mPNorm: g('mPNorm'),
    mPMin: g('mPMin'),
    mPMax: g('mPMax'),
    phiFCap: g('phiFCap'),
    mFaPufa: g('mFaPufa'),
    mFaSfa: g('mFaSfa'),
    mFaRefPufaShare: g('mFaRefPufaShare'),
    mFaRefSfaShare: g('mFaRefSfaShare'),
    mFaRichShare: g('mFaRichShare'),
    sRtSets: g('sRtSets'),
    osA: g('osA'),
    osB: g('osB'),
    osC: g('osC'),
    osRampLo: g('osRampLo'),
    osRampHi: g('osRampHi'),
    osFfmDefMin: g('osFfmDefMin'),
    osExpiryD: g('osExpiryD'),
    osOldAge: g('osOldAge'),
    osOldAgeMult: g('osOldAgeMult'),
    poxMin: g('poxMin'),
    poxMinLeanSlope: g('poxMinLeanSlope'),
    pox0: g('pox0'),
    tauN: g('tauN'),
    poxBhbRef: g('poxBhbRef'),
    poxChoSparing: g('poxChoSparing'),
    poxChoRefG: g('poxChoRefG'),
    poxChoDays: g('poxChoDays'),
    poxDietProt: g('poxDietProt'),
    vliEnergyFrac: g('vliEnergyFrac'),
    vliProteinQ: g('vliProteinQ'),
    vliProteinMinG: g('vliProteinMinG'),
    fmFloorFracBw0: g('fmFloorFracBw0'),
    fmFloorRampKg: g('fmFloorRampKg'),
    ageLeanGD: g('ageLeanGD'),
    ageLeanPivot: g('ageLeanPivot'),
    ageLeanSpan: g('ageLeanSpan'),
    ageLeanCap: g('ageLeanCap'),
    ageLeanRtOffset: g('ageLeanRtOffset'),
    smLossShare: g('smLossShare'),
    smRtShare: g('smRtShare'),
    eb7WindowD: Math.max(1, Math.round(g('eb7WindowD'))),
    partBlendKcalD: g('partBlendKcalD'),
  };
  return k;
}

// ================================================================== 03 §4.4.2 — deficit partition (RT-stripped)

/**
 * Leanness index L of 03 §4.4.2: 1 at ≤ 10 % BF (men) / ≤ 20 % (women), 0 at ≥ 30 % / ≥ 40 %.
 * @param bf body fat fraction 0..1
 */
export function leannessIndex(k: CompositionConstants, bf: number, female: boolean): number {
  const bfMaleEq = female ? bf - k.leanBfFemaleOffset : bf;
  return clamp((k.leanBfMale - bfMaleEq) / k.leanBfSpan, 0, 1);
}

/**
 * Catabolic lean fraction of weight loss `pCat` (mass fraction) — 03 §4.4.2 `leanFractionOfLoss` with the RT terms
 * stripped (R-RT: M_RT = 1, no RT part of M_min, no anabolic credit — the muscle module owns every RT effect).
 * `rtMMinOffset` / `rtMult` exist only so the unit test can reproduce the dossier's own RT rows; the engine passes 0 / 1.
 *
 * @param q    effective protein, g/kg FFM/d (quality-weighted, repletion protein excluded)
 * @param d    deficit fraction (TEE − EI)/TEE, 0..1
 * @param bf   body fat fraction 0..1
 * @param fmKg fat mass, kg
 * @param age  years
 * @param activity aerobic-activity index 0..1 (activity module's `aerobicIdx`)
 */
export function pCatDeficit(
  k: CompositionConstants,
  q: number,
  d: number,
  bf: number,
  fmKg: number,
  female: boolean,
  age: number,
  activity: number,
  rtMMinOffset = 0,
  rtMult = 1,
): number {
  const L = leannessIndex(k, bf, female);
  const fm = fmKg > 0 ? fmKg : 0;
  const p0 = k.forbesC / (k.forbesC + fm) + k.p0Shift;
  const qSat = k.qSatBase + Math.min(d, k.qSatDeficitCap) * (k.qSatDeficitSlope + k.qSatLeanSlope * L);
  const xP = clamp((q - k.qKnee) / Math.max(qSat - k.qKnee, k.xpMinSpan), 0, 1);
  const mMin =
    (k.mMin - rtMMinOffset) * (1 - k.mMinDeficitRelief * clamp((d - k.mMinDeficitPivot) / k.mMinDeficitSpan, 0, 1));
  const dCrit = k.dCrit + k.dCritLeanSlope * (1 - L);
  const effD = clamp(1 - (d - dCrit) / k.effDWidth, 0, 1);
  const mP = 1 - (1 - mMin) * effD * xP;
  const mD = clamp(1 + k.mDSlope * (d - k.mDRef), k.mDMin, k.mDMax);
  const mAct = 1 - k.mAct * clamp(activity, 0, 1);
  const mAge = clamp(1 + k.mAgeSlope * Math.max(0, age - k.mAgePivot), 1, k.mAgeMax);
  return clamp(p0 * mP * mD * rtMult * mAct * mAge, 0, k.pCatMax);
}

/**
 * Energy share of a mass fraction: p_E = f·(ρL + ηL)/[f·(ρL + ηL) + (1 − f)·(ρF + ηF)] (MODEL_SPEC §1.8 2c).
 * @param leanMassFrac lean mass fraction of the tissue change, 0..1
 */
export function energyShareOfMassFraction(k: CompositionConstants, leanMassFrac: number): number {
  const f = clamp(leanMassFrac, 0, 1);
  const eL = f * k.effL;
  const den = eL + (1 - f) * k.effF;
  return den > 0 ? eL / den : 0;
}

/**
 * Deficit-regime energy share (MODEL_SPEC §1.8 2c): `pCat′ = pCat·(1 − rtRetentionFrac)`, converted to an energy share,
 * plus 16's sleep shift on the P-ratio (review M1), clamped to [0, pCatMax].
 */
export function deficitEnergyShare(k: CompositionConstants, pCat: number, rtRetentionFrac: number, sleepShift: number): number {
  const pCatR = pCat * (1 - clamp(rtRetentionFrac, 0, 1));
  return clamp(energyShareOfMassFraction(k, pCatR) + sleepShift, 0, k.pCatMax);
}

// ================================================================== 11 §4.7 — surplus partition

/** 11 §4.7 protein modifier m_P(p), p = protein g/kg BW/d. */
export function mProtein(k: CompositionConstants, pGPerKgBw: number): number {
  return clamp((1 - Math.exp(-(pGPerKgBw - k.mPp0) / k.mPScale)) / k.mPNorm, k.mPMin, k.mPMax);
}

/** 11 §4.7 Forbes shape φ_F(FM) = min(1, [C/(C + FM)]/0.45). */
export function phiForbes(k: CompositionConstants, fmKg: number): number {
  const fm = fmKg > 0 ? fmKg : 0;
  return Math.min(1, k.forbesC / (k.forbesC + fm) / k.phiFCap);
}

/**
 * 11 §4.7 fat-type modifier m_FA: 1.0 for the habitual mix; linear toward the PUFA-rich (1.5) / SFA-rich (0.7) values as
 * the PUFA / SFA share of fat rises from the habitual share to `mFaRichShare` (own interpolation of the dossier's
 * categories; see params). Both effects are applied multiplicatively.
 * @param pufaShare, sfaShare shares of total fat, 0..1 (NaN → habitual)
 */
export function mFatType(k: CompositionConstants, pufaShare: number, sfaShare: number): number {
  let m = 1;
  if (pufaShare === pufaShare && pufaShare > k.mFaRefPufaShare) {
    const x = clamp((pufaShare - k.mFaRefPufaShare) / (k.mFaRichShare - k.mFaRefPufaShare), 0, 1);
    m *= 1 + (k.mFaPufa - 1) * x;
  }
  if (sfaShare === sfaShare && sfaShare > k.mFaRefSfaShare) {
    const x = clamp((sfaShare - k.mFaRefSfaShare) / (k.mFaRichShare - k.mFaRefSfaShare), 0, 1);
    m *= 1 + (k.mFaSfa - 1) * x;
  }
  return m;
}

/**
 * 11 §4.7 sedentary surplus lean ratio r_L (kg LT per kg FM deposited):
 * `r_L = rAT + rS·m_P(p)·φ_F(FM)·(1 − s_RT)·m_FA`. 11's h(EB)/L_RT are not used (09 f_EP owns RT energy modulation).
 */
export function surplusLeanRatio(k: CompositionConstants, pGPerKgBw: number, fmKg: number, sRt: number, mFa: number): number {
  const r = k.rAT + k.rS * mProtein(k, pGPerKgBw) * phiForbes(k, fmKg) * (1 - clamp(sRt, 0, 1)) * mFa;
  return r > 0 ? r : 0;
}

/** Energy share of a surplus with lean ratio r_L: p_E = r_L·(ρL + ηL)/[(ρF + ηF) + r_L·(ρL + ηL)]. */
export function surplusEnergyShare(k: CompositionConstants, rL: number): number {
  const eL = rL * k.effL;
  return eL / (k.effF + eL);
}

// ================================================================== 11 §4.12 — post-diet overshoot (Jacquet 2020)

/** Jacquet steady-state mass fraction of loss as FFM: Pm_SS = (100 − %FAT0)/100 · e^{−c·%FAT0}. */
export function jacquetPmSS(k: CompositionConstants, pctFat0: number): number {
  return ((100 - pctFat0) / 100) * Math.exp(-k.osC * pctFat0);
}

/** γ_eff = 1 + a·e^{−b·%FAT_pre}·r, r = threshold ramp weight 0..1. */
export function overshootGamma(k: CompositionConstants, pctFatPre: number, r: number): number {
  return 1 + k.osA * Math.exp(-k.osB * pctFatPre) * r;
}

/** Threshold ramp r = clamp((D_F − 0.10)/0.20, 0, 1) of the fractional fat depletion D_F. */
export function overshootRamp(k: CompositionConstants, depletionFrac: number): number {
  return clamp((depletionFrac - k.osRampLo) / (k.osRampHi - k.osRampLo), 0, 1);
}

/** Fat overshoot (kg) once FFM is fully restored after losing and regaining ΔW (Jacquet, r = 1): (γ − 1)·ΔW. */
export function jacquetOvershootKg(k: CompositionConstants, pctFat0: number, dW: number): number {
  return (overshootGamma(k, pctFat0, 1) - 1) * dW;
}

/**
 * Regain lean ratio blended with the refeeding partition (11 §4.12 engine rule):
 * `P_RF = Pm_SS/γ_eff (×0.5 at age ≥ 60)`, `r_L,RF = P_RF/(1 − P_RF)`, `r_L = (1 − r)·r_L,gen + r·r_L,RF`.
 */
export function overshootLeanRatio(
  k: CompositionConstants,
  rLGeneric: number,
  pmSS: number,
  pctFatPre: number,
  depletionFrac: number,
  age: number,
): number {
  const r = overshootRamp(k, depletionFrac);
  if (r <= 0) return rLGeneric;
  let pRF = clamp(pmSS, 0, 0.95) / overshootGamma(k, pctFatPre, r);
  if (age >= k.osOldAge) pRF *= k.osOldAgeMult;
  const rLRF = pRF / (1 - pRF);
  return (1 - r) * rLGeneric + r * rLRF;
}

// ================================================================== 03 §4.13 — very-low-intake (non-fasting) branch

/**
 * Protein oxidation Pox (g/kg FFM/d) of 03 §4.13 given the decaying factor `decay` = exp(−t_f/τ_N,eff) (1 at onset).
 * @param L leanness index 0..1; @param choG carbohydrate g/d; @param tDays days since the branch started
 */
export function poxRate(k: CompositionConstants, decay: number, L: number, choG: number, tDays: number): number {
  const pMin = k.poxMin * (1 + k.poxMinLeanSlope * L);
  let pox = pMin + (k.pox0 - pMin) * decay;
  if (tDays < k.poxChoDays) pox *= 1 - k.poxChoSparing * clamp(choG / k.poxChoRefG, 0, 1);
  return pox;
}

/** Daily decay factor of the Pox transient with the ketone modifier τ_N,eff = τ_N·2/(1 + clamp(BHB/2 mM, 0, 1)). */
export function poxDecayFactor(k: CompositionConstants, bhb: number): number {
  const tau = (k.tauN * 2) / (1 + clamp(bhb / k.poxBhbRef, 0, 1));
  return Math.exp(-1 / tau);
}

/**
 * Lean-tissue change of the Pox branch, kg LT/d (Hall LT convention, R-FPROT): `−(Pox·FFM − 0.3·P_eff)/(1000·f_prot)`.
 */
export function poxLeanRateKgD(k: CompositionConstants, pox: number, ffmKg: number, pEffG: number): number {
  return -(pox * ffmKg - k.poxDietProt * pEffG) / (1000 * k.fProt);
}

// ================================================================== review M9 — smooth fat floor

/** Weight 0..1 of the fat share of a negative S′: clamp((FM − FM_min)/ramp, 0, 1) (the rest comes from lean tissue). */
export function fatFloorWeight(k: CompositionConstants, fmKg: number, fmMinKg: number): number {
  return clamp((fmKg - fmMinKg) / k.fmFloorRampKg, 0, 1);
}

// ================================================================== 03 §4.14 — age drift


/** ΔL_age, g LT/d (≤ 0): `−0.4 × clamp((age − 45)/20, 0, 1.5) × (1 − 0.8·RT)`. */
export function ageLeanDriftGD(k: CompositionConstants, age: number, rt: number): number {
  return -k.ageLeanGD * clamp((age - k.ageLeanPivot) / k.ageLeanSpan, 0, k.ageLeanCap) * (1 - k.ageLeanRtOffset * clamp(rt, 0, 1));
}
