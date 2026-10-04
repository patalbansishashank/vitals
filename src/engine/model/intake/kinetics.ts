/**
 * Allocation-free closed forms used by the intake module (docs/MODEL_SPEC.md §0.1, §1.3). Exported for unit tests.
 */

/**
 * One exact step of Michaelis–Menten emptying dE/dt = −V·E/(K + E) over `dt` hours, solved in log space.
 * The implicit solution E₁ + K·ln E₁ = E₀ + K·ln E₀ − V·dt is solved for u = ln E₁ (g(u) = e^u + K·u − c is convex and
 * strictly increasing, g' ≥ K) by Halley iterations started from a midpoint estimate
 * u_g = ln E₀ − V·dt/(K + E_m), E_m = max(E₀ − ½·V·dt·E₀/(E₀ + K), ¼·E₀). One or two iterations (one exp each) reach
 * |Δu| < 1e-3, after which the cubic convergence leaves an error < 1e-10; E₁ is then e^u from the last exp and a
 * third-order series in the last correction (no extra exp). Relative error vs the Lambert-W solution < 1e-10.
 *
 * @param e0 amount at the start of the step (g or kcal), ≥ 0
 * @param u0 ln(e0) (callers keep it in state so no log is needed per step)
 * @param vmax maximal rate V (unit/h)
 * @param km half-saturation constant K (same unit as e0)
 * @param dt step length, h
 * @param out out[0] ← E₁, out[1] ← ln E₁ (−Infinity when emptied)
 */
export function mmStep(e0: number, u0: number, vmax: number, km: number, dt: number, out: Float64Array): void {
  if (!(e0 > 1e-12)) {
    out[0] = 0;
    out[1] = -Infinity;
    return;
  }
  if (!(dt > 0)) {
    out[0] = e0;
    out[1] = u0;
    return;
  }
  const vdt = vmax * dt;
  const c = e0 + km * u0 - vdt;
  let em = e0 - (0.5 * vdt * e0) / (e0 + km);
  if (em < 0.25 * e0) em = 0.25 * e0;
  let u = u0 - vdt / (em + km);
  for (let i = 0; i < 12; i++) {
    const eu = Math.exp(u);
    const g = eu + km * u - c;
    const gp = eu + km;
    const du = (2 * g * gp) / (2 * gp * gp - g * eu);
    u -= du;
    if ((du < 0 ? -du : du) < 1e-3 || i === 11) {
      if (u < -60) {
        out[0] = 0;
        out[1] = -Infinity;
        return;
      }
      // E = e^{u_prev − du} = eu·e^{−du}, third-order series (|du| < 1e-3 → error < 1e-13 relative)
      out[0] = eu * (1 - du * (1 - du * (0.5 - du / 6)));
      out[1] = u;
      return;
    }
  }
}

/**
 * Michaelis–Menten step over 1 h in the first-order tail (E₀ ≤ 0.05·K), without transcendental calls:
 * the exact relation E₁ = E₀·f·exp((E₀ − E₁)/K), f = exp(−V/K), is solved by two fixed-point iterations (contraction
 * ≤ E/K ≤ 0.05) with a 3rd-order series for the small exponent. Relative error < 2e-5 (tested against Lambert W).
 *
 * @param lnF = −V/K; @param f = exp(−V/K) (both precomputed); out as in `mmStep`.
 */
export function mmTailStep(e0: number, u0: number, lnF: number, f: number, km: number, out: Float64Array): void {
  if (!(e0 > 1e-12)) {
    out[0] = 0;
    out[1] = -Infinity;
    return;
  }
  const a = e0 * f;
  let x = (e0 - a) / km;
  let y = a * (1 + x * (1 + x * (0.5 + x / 6)));
  x = (e0 - y) / km;
  y = a * (1 + x * (1 + x * (0.5 + x / 6)));
  out[0] = y;
  out[1] = u0 + lnF + (e0 - y) / km;
}

/** 07 §4.4.3 continuous fasting-glucose reference, mmol/L: floor + amp/(1 + exp((τ − t50)/s)). */
export function fastingGlucoseRef(tauH: number, floor: number, amp: number, t50H: number, scaleH: number): number {
  return floor + amp / (1 + Math.exp((tauH - t50H) / scaleH));
}

/**
 * 04 §4.16 per-meal peak glucose rise A_m (before M_tol and mClock), mmol/L, capped.
 * A_m = A_50·[L_eff·(K_L + 50)]/[50·(K_L + L_eff)]·M_PF·M_fib·S_mus^(−0.5).
 */
export function glucoseAmplitude(
  lEffG: number,
  proteinG: number,
  fatG: number,
  viscousFibreG: number,
  sMusPow: number,
  a50: number,
  kL: number,
  protCoef: number,
  protCap: number,
  fatCoef: number,
  fatCap: number,
  fibCoef: number,
  fibCap: number,
  cap: number,
): number {
  if (!(lEffG > 0)) return 0;
  const load = (a50 * lEffG * (kL + 50)) / (50 * (kL + lEffG));
  const mPF = 1 - protCoef * (proteinG < protCap ? proteinG : protCap) - fatCoef * (fatG < fatCap ? fatG : fatCap);
  const mFib = 1 - fibCoef * (viscousFibreG < fibCap ? viscousFibreG : fibCap);
  let a = load * (mPF > 0 ? mPF : 0) * (mFib > 0 ? mFib : 0) * sMusPow;
  if (a > cap) a = cap;
  return a;
}

/** 04 §4.17 per-meal insulin excursion amplitude B_m (before M_ins), µU/mL. */
export function insulinAmplitude(loadIG: number, proteinG: number, sMusPow: number, bMax: number, kI: number, bP: number): number {
  const l = loadIG > 0 ? loadIG : 0;
  const pr = proteinG > 0 ? proteinG : 0;
  return ((bMax * l) / (l + kI) + bP * pr) * sMusPow;
}

/** 07 §4.7.1 circadian multiplier of the glucose excursion for a meal at `clockH`, reference clock `refH`. */
export function mClock(clockH: number, refH: number, slopePerH: number, spanH: number): number {
  let d = (clockH - refH) % 24;
  if (d < 0) d += 24;
  return 1 + slopePerH * (d < spanH ? d : spanH);
}

/** 15 §4.2 fibre ME correction dME_fibre, kcal/d, clamped to [−capNeg·E, +capPos·E]. */
export function fibreMeCorrection(fEffG: number, energyKcal: number, kNet: number, fRefPer1000: number, capNeg: number, capPos: number): number {
  if (!(energyKcal > 0)) return 0;
  const d = -kNet * (fEffG - (fRefPer1000 * energyKcal) / 1000);
  const lo = -capNeg * energyKcal;
  const hi = capPos * energyKcal;
  return d < lo ? lo : d > hi ? hi : d;
}

/** 15 §4.12 creatine target and time constants; returns the new saturation x after `dtD` days (exact exponential). */
export function creatineStep(
  x: number,
  doseG: number,
  xMaxEff: number,
  doseSatG: number,
  tauUpNum: number,
  tauUpMin: number,
  tauUpMax: number,
  tauDown: number,
  dtD: number,
): number {
  const target = doseG > 0 ? xMaxEff * (doseG < doseSatG ? doseG / doseSatG : 1) : 0;
  let tau: number;
  if (target > x) {
    const t = doseG > 0 ? tauUpNum / doseG : tauUpMax;
    tau = t < tauUpMin ? tauUpMin : t > tauUpMax ? tauUpMax : t;
  } else tau = tauDown;
  return target + (x - target) * Math.exp(-dtD / tau);
}
