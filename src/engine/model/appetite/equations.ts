/**
 * Pure, allocation-free equations of the appetite module (MODEL_SPEC §1.12; 12 §4.9-4.10; 10 §4.3; 15 §4.6; 21 §4G).
 * All quantities are kcal-equivalents per day unless stated.
 */

/**
 * Weight-loss appetite feedback D_WL (12 §4.9.1): ΔW = W_ref − W (kg).
 * ΔW > 0: slope·W_c·(1 − e^{−ΔW/W_c}); ΔW ≤ 0 (gain): −min(cap, gainSlope·(W − W_ref)).
 */
export function weightLossDrive(dW: number, wc: number, slope: number, gainSlope: number, gainCap: number): number {
  if (dW > 0) return slope * wc * (1 - Math.exp(-dW / wc));
  const g = -gainSlope * dW;
  return -(g < gainCap ? g : gainCap);
}

/** Leanness amplification Λ_lean = [1 + c·(1 − S_L(L_FM))]/[1 + c·(1 − S_L(L0))] (12 §4.9.1). */
export function leannessAmplifier(suffFm: number, suff0: number, c: number): number {
  return (1 + c * (1 - suffFm)) / (1 + c * (1 - suff0));
}

/** 10 §4.3 appetite compensation A_max·(1 − e^{−S/K}) (the spec's D_ex subtracts its baseline value). */
export function exerciseAppetite(sExKcalD: number, aMax: number, k: number): number {
  return sExKcalD > 0 ? aMax * (1 - Math.exp(-sExKcalD / k)) : 0;
}

/** Saturating satiety deficit SatDef(x) = x (x ≤ 0), max·(1 − e^{−x/scale}) (x > 0) (12 §4.9.3). */
export function satDef(x: number, max: number, scale: number): number {
  return x <= 0 ? x : max * (1 - Math.exp(-x / scale));
}

/** Protein satiety credit H_P = coef·EI_hab·min(ln cap, ln(max(P, floor·P_ref)/P_ref)) (12 §4.9.2). */
export function proteinSatiety(pG: number, pRefG: number, eiHab: number, coef: number, capRatio: number, floorRatio: number): number {
  if (!(pRefG > 0)) return 0;
  const pEff = pG > floorRatio * pRefG ? pG : floorRatio * pRefG;
  const r = Math.log(pEff / pRefG);
  const cap = Math.log(capRatio);
  return coef * eiHab * (r < cap ? r : cap);
}

/**
 * Fibre satiety credit H_fib (12 §4.9.2) with 15's viscous share: the gut-lagged exposure F_eff is compared with the
 * habitual fibre (v = 1, mixed whole food), and the viscous share above the habitual share adds (v_visc − 1) of its
 * grams: clamp(coef·EI_hab·[(F − F_ref) + (v_visc − 1)·(s − s_ref)·F]/per, ±cap·EI_hab).
 */
export function fibreSatiety(
  fEffG: number,
  fRefG: number,
  viscShare: number,
  viscShareRef: number,
  eiHab: number,
  coef: number,
  perG: number,
  cap: number,
  vViscous: number,
): number {
  const f = fEffG > 0 ? fEffG : 0;
  const h = (coef * eiHab * (f - fRefG + (vViscous - 1) * (viscShare - viscShareRef) * f)) / perG;
  const lim = cap * eiHab;
  return h < -lim ? -lim : h > lim ? lim : h;
}

/** Energy-density satiety term H_ED = −ε·EI_hab·clamp(ln(ED/ED_ref), −ln 2, ln 2) (12 §4.9.2); 0 when ED is unknown. */
export function energyDensitySatiety(edKcalG: number, edRefKcalG: number, eiHab: number, eps: number): number {
  if (!(edKcalG > 0) || !(edRefKcalG > 0)) return 0;
  const l = Math.log(edKcalG / edRefKcalG);
  const ln2 = Math.LN2;
  return -eps * eiHab * (l < -ln2 ? -ln2 : l > ln2 ? ln2 : l);
}

/** HPI = 100/(1 + e^{−(E_k − mid)/scale}) (12 §4.9.3). */
export function hungerPressureIndex(eK: number, mid: number, scale: number): number {
  return 100 / (1 + Math.exp(-(eK - mid) / scale));
}

/** Daily dropout hazard h = coef·((HPI − thr)/scale)² for HPI > thr (12 §4.10a). */
export function dropoutHazard(hpi: number, coef: number, thr: number, scale: number): number {
  if (!(hpi > thr)) return 0;
  const x = (hpi - thr) / scale;
  return coef * x * x;
}

/**
 * 21 §4G G10 behavioural levers → multiplicative shift on the dropout hazard (MODEL_SPEC §1.12 step 4):
 * hazard × (1 − min(cap, ΣΔp)). Flags are 0/1.
 */
export function leverHazardMultiplier(
  selfMonitor: number,
  mealReplacement: number,
  preMealWater: number,
  flexibleRestraint: number,
  dpSelfMonitor: number,
  dpMealReplacement: number,
  dpPreMealWater: number,
  dpFlexibleRestraint: number,
  cap: number,
): number {
  const sum =
    selfMonitor * dpSelfMonitor + mealReplacement * dpMealReplacement + preMealWater * dpPreMealWater + flexibleRestraint * dpFlexibleRestraint;
  return 1 - (sum < cap ? sum : cap);
}

/**
 * Energy-status driver u = EI/T̄ − 1 (same rule as hormones, MODEL_SPEC §1.11/§1.12 expenditure window): intake of the day against the
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
