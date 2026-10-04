/**
 * Pure equations of the wellbeing module (dossier 19 §4.1-4.5, 13 §4.10). Each function takes its constants as
 * arguments, allocates nothing and is unit-tested against worked numbers from the dossier. Units in the doc comments.
 */
import { clamp, clamp01 } from '../../core/math';
import { RING_CAP } from './constants';

/** Local alias: keeps the ring loops free of module-namespace lookups (hot path). */
const CAP = RING_CAP;

// ---------------------------------------------------------------- rings (allocation-free daily windows)

/** Mean of the newest `n` entries; `head` = index of the newest entry. */
export function ringMean(ring: Float64Array, head: number, n: number): number {
  let sum = 0;
  let i = head;
  for (let j = 0; j < n; j++) {
    sum += ring[i]!;
    i = i === 0 ? CAP - 1 : i - 1;
  }
  return sum / n;
}

/** OLS slope (per index step, oldest → newest) of the newest `n` entries; `sxx` = n(n²−1)/12. */
export function ringSlope(ring: Float64Array, head: number, n: number, sxx: number): number {
  const mean = ringMean(ring, head, n);
  const mid = (n - 1) / 2;
  let sxy = 0;
  let i = head;
  for (let j = 0; j < n; j++) {
    sxy += (n - 1 - j - mid) * (ring[i]! - mean);
    i = i === 0 ? CAP - 1 : i - 1;
  }
  return sxy / sxx;
}

/** Push a sample: returns the new head index. */
export function ringPush(ring: Float64Array, head: number, v: number): number {
  const h = head + 1 >= CAP ? 0 : head + 1;
  ring[h] = v;
  return h;
}

// ---------------------------------------------------------------- 19 §4.1 energy availability

/** EA = (EI − EEE)/FFM, kcal per kg FFM per day, clipped to [floor, ceil] (19 §4.1, §5 row 20). */
export function energyAvailability(eiKcal: number, eeeKcal: number, ffmKg: number, floor: number, ceil: number): number {
  const ffm = ffmKg > 1 ? ffmKg : 1;
  return clamp((eiKcal - eeeKcal) / ffm, floor, ceil);
}

/** f_EEE: share of the availability decrement below `eaRef` created by exercise (0..1). All in kcal/kg FFM/d. */
export function exerciseShare(eeeKcalKgFfm: number, ea: number, eaRef: number): number {
  const dec = eaRef - ea;
  if (dec <= 1e-9 || eeeKcalKgFfm <= 0) return 0;
  return clamp01(eeeKcalKgFfm / dec);
}

/** Wellbeing EA tier from EA_c (19 §4.1): 0 (≥ t0), 1 (t1..t0), 2 (t2..t1), 3 (< t2). */
export function eaTier(eaC: number, t0: number, t1: number, t2: number): number {
  return eaC >= t0 ? 0 : eaC >= t1 ? 1 : eaC >= t2 ? 2 : 3;
}

// ---------------------------------------------------------------- 19 §4.2 bone

/** srcF = 1 − (1 − srcAtFull)·f_EEE (19 §4.2(a): exercise-created LEA halves the formation response). */
export function srcFactor(fEEE: number, srcAtFull: number): number {
  return 1 - (1 - srcAtFull) * fEEE;
}

/** P1NP_tgt = 1 − drop·clip((ref − EA_s)/width, 0, cap)·sexF·srcF (19 §4.2(a)). */
export function p1npTarget(eaS: number, drop: number, ref: number, width: number, cap: number, sexF: number, srcF: number): number {
  return 1 - drop * clamp((ref - eaS) / width, 0, cap) * sexF * srcF;
}

/** CTX_tgt = 1 + rise·clip((ref − EA_s)/width, 0, cap)·sexF (19 §4.2(a)). */
export function ctxTarget(eaS: number, rise: number, ref: number, width: number, cap: number, sexF: number): number {
  return 1 + rise * clamp((ref - eaS) / width, 0, cap) * sexF;
}

/** mAge (19 §4.2(b)): high for ≥ step age or postmenopause, midpoint for perimenopause, 1 otherwise. */
export function ageMultiplier(ageYears: number, menopause: number, stepYears: number, high: number): number {
  if (ageYears >= stepYears || menopause >= 2) return high;
  if (menopause === 1) return 0.5 * (1 + high);
  return 1;
}

/** BMD target, % vs baseline: −k·mAge·mRT·mCa·mSrc·WL_pct (19 §4.2(b)). */
export function bmdTarget(k: number, mAge: number, mRt: number, mCa: number, mSrc: number, wlPct: number): number {
  return -k * mAge * mRt * mCa * mSrc * wlPct;
}

// ---------------------------------------------------------------- 19 §4.3 strength

/** g_lean: 1 up to `full` % BF, linear to `min` at `zero` % BF (19 §4.3). */
export function leanGate(bfPct: number, full: number, zero: number, min: number): number {
  if (bfPct <= full) return 1;
  if (bfPct >= zero) return min;
  return 1 - ((1 - min) * (bfPct - full)) / (zero - full);
}

/** pen = a·clip((ref − EA_c)/width, 0, cap)·g_lean (19 §4.3); M_EA target = 1 − pen. */
export function strengthPenalty(a: number, eaC: number, ref: number, width: number, cap: number, gLean: number): number {
  return a * clamp((ref - eaC) / width, 0, cap) * gLean;
}

// ---------------------------------------------------------------- 19 §4.4 endurance

/** TTE_75(G) = intercept + slope·G, minutes, G in g per 100 g wet muscle (Bergström 1967). */
export function tte75(gPer100g: number, intercept: number, slope: number): number {
  return intercept + slope * gPer100g;
}

/** gI = clip((I_rel − lo)/(hi − lo), 0, 1): 0 at ≤ 60 % VO2max, 1 at ≥ 70 % (19 §4.4). */
export function intensityGate(iRel: number, lo: number, hi: number): number {
  return hi > lo ? clamp01((iRel - lo) / (hi - lo)) : iRel >= hi ? 1 : 0;
}

/** econ_factor = 1/(1 + dO2cost·A_econ) with A_econ = A_fat·gI (19 §4.4). */
export function econFactor(aEcon: number, do2Cost: number): number {
  return 1 / (1 + do2Cost * aEcon);
}

/** Relative VO2max / running-speed factor for a change of inert mass at constant absolute VO2: (M0/(M0+ΔM))^exp. */
export function massFactor(mass0Kg: number, dInertKg: number, exponent: number): number {
  const m = mass0Kg + dInertKg;
  const ratio = mass0Kg / (m > 1 ? m : 1);
  return exponent === 1 ? ratio : Math.pow(ratio, exponent);
}

// ---------------------------------------------------------------- 13 §4.10 keto-induction

/** Φ_ind(Δt) = Φ_max·(Δt/τ_p)·exp(1 − Δt/τ_p) (peak Φ_max at Δt = τ_p), Δt in days since the trigger. */
export function phiInd(dtDays: number, phiMax: number, tauP: number): number {
  if (dtDays <= 0 || phiMax <= 0) return 0;
  const x = dtDays / tauP;
  return phiMax * x * Math.exp(1 - x);
}

/** Φ_max = clamp((C_prev − C_new)/C_prev, 0, 1)·(1 − mitigation·[Na ≥ threshold]) (13 §4.10). */
export function phiMaxFor(cPrevG: number, cNewG: number, naMg: number, naThrMg: number, mitigation: number): number {
  if (cPrevG <= 0) return 0;
  const drop = clamp01((cPrevG - cNewG) / cPrevG);
  return naMg >= naThrMg ? drop * (1 - mitigation) : drop;
}

/**
 * Days after the carbohydrate drop at which Φ has fallen to `frac` of its peak on the declining limb
 * (bisection of x·e^{1−x} = frac for x ≥ 1; returns Δt = x·τ_p). Diagnostic used by the validation tests.
 */
export function inductionDaysToFraction(frac: number, tauP: number): number {
  if (frac >= 1) return tauP;
  let lo = 1;
  let hi = 60;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const v = mid * Math.exp(1 - mid);
    if (v > frac) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi) * tauP;
}
