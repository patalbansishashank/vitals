/**
 * Allocation-free numerical helpers shared by all modules (docs/MODEL_SPEC.md §0.3).
 * Every helper is a pure function of numbers; none allocates.
 */

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Hour index (0-23) whose end-of-hour state is the day's morning weigh-in (MODEL_SPEC §3.4, §6 'wake' aggregation): the
 * state at clock time ⌈sleepWakeH⌉ — at waking for a whole-hour wake time, else the next full hour — before any waking-hour
 * input (food, sodium, steps) of the day. Wake at 00:00 reads the end of hour 0.
 */
export const wakeRecordHour = (sleepWakeH: number): number => {
  const h = Math.ceil(sleepWakeH) - 1;
  return h < 0 ? 0 : h > 23 ? 23 : h;
};

/** exp(−dt/τ) with τ in the same unit as dt; τ ≤ 0 means "instant" (factor 0). Precompute in prepare(). */
export const decayFactor = (dtH: number, tauH: number): number => (tauH > 0 ? Math.exp(-dtH / tauH) : 0);

/** Exact first-order relaxation toward `target` given a precomputed decay factor f = exp(−dt/τ). */
export const relax = (x: number, target: number, f: number): number => target + (x - target) * f;

/** Asymmetric relaxation: `fUp` when target > x, else `fDown` (hormone/adaptation states, 12 §4.0). */
export const relax2 = (x: number, target: number, fUp: number, fDown: number): number =>
  target + (x - target) * (target > x ? fUp : fDown);

/**
 * Principal branch of the Lambert W function for w ≥ 0 inputs x ≥ 0 (Halley iterations; |err| < 1e-12).
 * Used for the exact solution of Michaelis–Menten emptying.
 */
export function lambertW0(x: number): number {
  if (x <= 0) return 0;
  let w = x < 1 ? x * (1 - x + 1.5 * x * x) : Math.log(x) - Math.log(Math.log(x) + 1);
  if (w < 0) w = 0;
  for (let i = 0; i < 20; i++) {
    const ew = Math.exp(w);
    const f = w * ew - x;
    const wp1 = w + 1;
    const dw = f / (ew * wp1 - ((w + 2) * f) / (2 * wp1));
    w -= dw;
    if (Math.abs(dw) < 1e-12 * (1 + Math.abs(w))) break;
  }
  return w;
}

/**
 * Exact amount left after `dt` of Michaelis–Menten emptying dE/dt = −V·E/(K + E), E(0) = e0 ≥ 0.
 * Solution: E = K·W((e0/K)·exp((e0 − V·dt)/K)). Used for gastric emptying (07 §4.1) and protein digestion (03 §4.7A)
 * so no sub-stepping is needed (orchestrator ruling). Returns 0 for e0 ≤ 0.
 */
export function mmRemaining(e0: number, vmax: number, km: number, dt: number): number {
  if (e0 <= 0) return 0;
  const arg = (e0 - vmax * dt) / km;
  // exp overflow guard: when arg is large the solution is ≈ e0 − V·dt (zero-order regime)
  if (arg > 600) return Math.max(0, e0 - vmax * dt);
  return km * lambertW0((e0 / km) * Math.exp(arg));
}

/**
 * Hour-average of the gamma(2) kernel g(τ) = (τ/θ²)·exp(−τ/θ) (area 1) between τa and τb (hours since the meal).
 * Closed form of the integral divided by (τb − τa); used for 04 §4.10 Ra and 05 §4.17 kernels.
 */
export function gamma2HourMean(tauA: number, tauB: number, theta: number): number {
  const a = tauA < 0 ? 0 : tauA;
  const b = tauB < 0 ? 0 : tauB;
  if (b <= a || theta <= 0) return 0;
  // ∫ (t/θ²) e^{−t/θ} dt = −(1 + t/θ) e^{−t/θ}  (no closures: hot path)
  const fb = -(1 + b / theta) * Math.exp(-b / theta);
  const fa = -(1 + a / theta) * Math.exp(-a / theta);
  return (fb - fa) / (tauB - tauA);
}

/** Fraction of the gamma(2) kernel mass delivered between τa and τb (cumulative difference). */
export function gamma2Mass(tauA: number, tauB: number, theta: number): number {
  return gamma2Cdf(tauB, theta) - gamma2Cdf(tauA, theta);
}

/** CDF of the gamma(2) kernel. */
export function gamma2Cdf(t: number, theta: number): number {
  return t <= 0 ? 0 : 1 - (1 + t / theta) * Math.exp(-t / theta);
}

/** Shape x·e^{1−x} used by 04 §4.16/§4.17 glucose and insulin excursions (peak 1 at x = 1). */
export const gammaPeakShape = (x: number): number => (x <= 0 ? 0 : x * Math.exp(1 - x));

/** Hill function x^n/(k^n + x^n) for x ≥ 0. */
export const hill = (x: number, k: number, n: number): number => {
  if (x <= 0) return 0;
  const xn = Math.pow(x, n);
  return xn / (Math.pow(k, n) + xn);
};

/** Inverse CDF of the triangular distribution (a ≤ c ≤ b) at u ∈ [0, 1). */
export function triangularInv(u: number, a: number, c: number, b: number): number {
  if (b <= a) return c;
  const fc = (c - a) / (b - a);
  return u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** Deterministic seeded PRNG (mulberry32), returns [0, 1). Only for parameter draws — never inside the step loop. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string, hex. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
