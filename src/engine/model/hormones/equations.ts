/**
 * Pure, allocation-free equations of the hormones module (MODEL_SPEC §1.11; 12 §4.0-4.7, 08 §4.12, 19 §4.9).
 * Every function is a function of numbers only, so the unit tests can check each equation against the dossier's worked
 * numbers without building an engine.
 */
import { clamp } from '../../core/math';

/** Saturating deficit term φ(u) = 1 − exp(−max(0, −u)/scale) (12 §4.0; φ_L scale 0.20, φ_E scale 0.30). */
export function deficitPhi(u: number, scale: number): number {
  return u < 0 ? 1 - Math.exp(u / scale) : 0;
}

/** Carbohydrate shortfall DC = max(0, 1 − carb/knee) (12 §4.0; knees 150 leptin, 130 cortisol, 50 T3 per R-T3). */
export function carbShortfall(carbG: number, kneeG: number): number {
  const x = 1 - carbG / kneeG;
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/** Ketosis intensity K = BHB²/(BHB² + half²) (12 §4.0). */
export function ketosisK(bhbMmolL: number, halfMmolL: number): number {
  const b2 = bhbMmolL > 0 ? bhbMmolL * bhbMmolL : 0;
  return b2 / (b2 + halfMmolL * halfMmolL);
}

/** Leptin sufficiency S_L(L) = L^n/(L^n + L50^n) (12 §4.0), n = 3 by default. */
export function leptinSufficiency(lNgMl: number, l50NgMl: number, n: number): number {
  if (lNgMl <= 0) return 0;
  const ln = n === 3 ? lNgMl * lNgMl * lNgMl : Math.pow(lNgMl, n);
  const kn = n === 3 ? l50NgMl * l50NgMl * l50NgMl : Math.pow(l50NgMl, n);
  return ln / (ln + kn);
}

/**
 * Acute energy-status leptin target A* (12 §4.1(c)):
 * u ≤ 0: 1 − a_max·φ_L(u); u > 0: min(cap, 1 + k_ov·u·(f_carb + wP·f_prot + wF·f_fat)).
 */
export function leptinAcuteTarget(
  u: number,
  phiL: number,
  aMax: number,
  kOv: number,
  fCarb: number,
  fProt: number,
  fFat: number,
  protW: number,
  fatW: number,
  cap: number,
): number {
  if (u <= 0) return 1 - aMax * phiL;
  const a = 1 + kOv * u * (fCarb + protW * fProt + fatW * fFat);
  return a < cap ? a : cap;
}

/**
 * Fast T3 component target T3f* (12 §4.3 with ruling R-T3's carbohydrate knee):
 * u ≤ 0: 1 − cE·φ_E(u) − cC·DC_T3; u > 0: 1 + cS·min(1, u/scale) − cC·DC_T3.
 * The carbohydrate term is kept in the surplus branch so T3 is continuous at u = 0 (12 lists the surplus branch without
 * it; see the module report — a eucaloric low-carbohydrate day would otherwise flip between −22 % and 0 with the sign of
 * a tiny u).
 */
export function t3fTarget(
  u: number,
  phiE: number,
  dcT3: number,
  cE: number,
  cC: number,
  cS: number,
  surplusScale: number,
): number {
  if (u <= 0) return 1 - cE * phiE - cC * dcT3;
  const s = u / surplusScale;
  return 1 + cS * (s < 1 ? s : 1) - cC * dcT3;
}

/** Reverse-T3 target (12 §4.3): 1 + amp·max(0, (|u| − thr)/width) + cC·DC (u ≤ 0), else 1 + cC·DC. */
export function rt3Target(u: number, dc: number, amp: number, thr: number, width: number, cC: number): number {
  let sev = 0;
  if (u < 0) {
    const x = (-u - thr) / width;
    sev = x > 0 ? amp * x : 0;
  }
  return 1 + sev + cC * dc;
}

/**
 * Cortisol energy-restriction increment ΔER* (12 §4.4), applied for u < −thrDeficit:
 * [amp·max(0,(|u| − thr)/width)² + lin·min(1, |u|/linScale)]·exp(−nDef/tauN).
 */
export function cortisolEnergyTerm(
  u: number,
  nDef: number,
  thrDeficit: number,
  amp: number,
  thr: number,
  width: number,
  lin: number,
  linScale: number,
  tauN: number,
): number {
  if (!(u < -thrDeficit)) return 0;
  const au = -u;
  const x = (au - thr) / width;
  const sq = x > 0 ? x * x : 0;
  const l = au / linScale;
  return (amp * sq + lin * (l < 1 ? l : 1)) * Math.exp(-nDef / tauN);
}

/**
 * Free testosterone by the Vermeulen equilibrium (12 §4.5; Vermeulen 1999): TT and SHBG in mol/L; returns FT in mol/L.
 * a = N·K_SHBG, b = N + K_SHBG·(SHBG − TT), FT = (−b + √(b² + 4·a·TT))/(2a), N = 1 + K_alb·[Alb].
 */
export function vermeulenFreeT(ttMolL: number, shbgMolL: number, albMolL: number, kAlb: number, kShbg: number): number {
  if (ttMolL <= 0) return 0;
  const n = 1 + kAlb * albMolL;
  const a = n * kShbg;
  const b = n + kShbg * (shbgMolL - ttMolL);
  // numerically stable root of a·FT² + b·FT − TT = 0 (positive branch)
  const disc = Math.sqrt(b * b + 4 * a * ttMolL);
  return b >= 0 ? (2 * ttMolL) / (b + disc) : (disc - b) / (2 * a);
}

/** 19 §4.9 P_LPD = clip(1/(1 + exp(−slope·(MEN − mid))), lo, hi); MEN = mean % deficit over the last 3 cycles. */
export function pLpd(menPct: number, midPct: number, slope: number, lo: number, hi: number): number {
  return clamp(1 / (1 + Math.exp(-slope * (menPct - midPct))), lo, hi);
}

/** 08 §4.12 protein factor TP(P) = clamp(1 − slope·(ref − P), lo, hi), P in g/kg/d. */
export function igfTp(pGPerKg: number, slope: number, refGPerKg: number, lo: number, hi: number): number {
  return clamp(1 - slope * (refGPerKg - pGPerKg), lo, hi);
}

/** 08 §4.12 fasting target T_E = 1 − (1 − A∞)·s, s = 1/(1 + exp(−(hFast − lag)/lw)). */
export function igfFastingTarget(hFastH: number, lagH: number, lwH: number, aInf: number): number {
  const s = 1 / (1 + Math.exp(-(hFastH - lagH) / lwH));
  return 1 - (1 - aInf) * s;
}

/**
 * Energy-status driver u = EI/T̄ − 1 (12 §4.0 with the MODEL_SPEC §1.11 expenditure window): intake of the day against the
 * 7-day trailing mean of `tdeeEstKcalD`, clamped to [−1, 1]. Pushes today's values into the rings. Allocation-free.
 */
export function energyStatusU(teeRing: Float64Array, eiRing: Float64Array, idx: number, teeKcal: number, eiKcal: number): number {
  teeRing[idx] = teeKcal;
  eiRing[idx] = eiKcal;
  let sum = 0;
  for (let i = 0; i < teeRing.length; i++) sum += teeRing[i]!;
  const tBar = sum / teeRing.length;
  const u = (eiKcal - tBar) / tBar;
  return u < -1 ? -1 : u > 1 ? 1 : u;
}

/**
 * End of burn-in for the expenditure ring: energy calibrates NEAT0 at this point so that the habitual week's mean TEE
 * equals the habitual intake (§3.4), so the ring (filled before the calibration) is shifted to the burn-in week's mean
 * intake — the habitual week is in balance by definition (u ≈ 0 from day 0, no step at the calibration).
 */
export function balanceTeeRing(teeRing: Float64Array, eiRing: Float64Array): void {
  let sT = 0;
  let sE = 0;
  const n = teeRing.length;
  for (let i = 0; i < n; i++) {
    sT += teeRing[i]!;
    sE += eiRing[i]!;
  }
  const shift = (sE - sT) / n;
  for (let i = 0; i < n; i++) teeRing[i] = teeRing[i]! + shift;
}
