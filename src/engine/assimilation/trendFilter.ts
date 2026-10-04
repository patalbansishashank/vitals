/**
 * Trend weight (docs/SUITE_SPEC.md §3.5 step 2; R11 §3.2): a local-linear-trend Kalman filter on the scale weight with the
 * engine's own water terms removed, an RTS smoother for display and the day-of-week offset, and the EWMA display line.
 *
 * State x = [w, r] (tissue-mass trend, kg; rate, kg/d), daily step F = [[1, 1], [0, 1]], Q = diag(q_w², q_r²) with q scaled
 * linearly with body mass (defaults refer to 75 kg). Observation y = scale − engine labile water (glycogen and its water,
 * ECF/sodium water, gut contents …; the engine's `waterWeight` at the wake hour), R = (σ_rel·W)² × multipliers:
 *  - unusual point: |innovation| > 3.5·√S → R × 10 for that point, flagged, never deleted;
 *  - declared events: R × 4 for the event days (the caller passes `rMult`);
 *  - ≥ 14 days without a weigh-in: the trend SD is reset to 1 kg at the next weigh-in.
 * A gap is stepped one day at a time (process noise accumulates with elapsed time, SUITE_SPEC "a gap of n days multiplies Q
 * by n"; the daily steps add the rate noise's propagation on top, which is the same model integrated exactly).
 * Pure and deterministic; no clock.
 */
import { ASSIMILATION_DEFAULTS, type AssimilationParams } from './params';

/** One morning weigh-in (several on the same day are averaged by the caller). */
export interface WeighInObs {
  /** Plan-day index (integer, day 0 = plan start). */
  day: number;
  /** Measured scale weight, kg. */
  scaleKg: number;
  /** Engine labile water that morning (`waterWeight` series), kg; 0 when unknown. */
  waterKg?: number;
  /** Morning, fasted, after voiding, same scale (σ_rel 0.5 %); otherwise 0.65 %. Default true. */
  standardised?: boolean;
  /** Extra noise multiplier from declared events (×4 for the event days); default 1. */
  rMult?: number;
}

export interface TrendPrior {
  /** Plan day the prior refers to (the filter starts the day after). */
  day: number;
  w: number;
  wSd: number;
  r: number;
  rSd: number;
}

export interface TrendPoint {
  day: number;
  /** Filtered (or smoothed) tissue-mass trend and its SD, kg. */
  w: number;
  wSd: number;
  /** Rate, kg/d, and its SD. */
  r: number;
  rSd: number;
  observed: boolean;
  /** Residualised observation y (scale − water − day-of-week offset) and the innovation, when observed. */
  y?: number;
  innovation?: number;
  /** True when the point was treated as unusual (R × outlierRMult). */
  flagged?: boolean;
  /** True when this weigh-in followed a gap ≥ gapResetDays (trend SD reset). */
  reset?: boolean;
}

export interface TrendFilterOptions {
  params?: AssimilationParams;
  /** Start from a confirmed state (check-in) instead of the first weigh-in. */
  prior?: TrendPrior;
  /** Rate guess when starting from the first weigh-in (the engine's predicted rate), kg/d. Default 0. */
  rateGuess?: number;
  /** Last day to produce (predict-only after the last weigh-in). Default: last weigh-in day. */
  untilDay?: number;
  /** Day-of-week offsets (7 values, Monday first) and the weekday of plan day 0. */
  dow?: { offsets: readonly number[]; startWeekday: number };
}

export interface TrendResult {
  points: TrendPoint[];
  /** Internals for the smoother: predicted and filtered states/covariances per point (same order as `points`). */
  internals: { xp: Float64Array; pp: Float64Array; xf: Float64Array; pf: Float64Array };
  flaggedDays: number[];
}

const weekdayOf = (day: number, startWeekday: number): number => (((startWeekday + day) % 7) + 7) % 7;

/** Average same-day weigh-ins (the noise is not divided: σ_rel is day-to-day variability) and sort by day. */
export function mergeSameDay(obs: readonly WeighInObs[]): WeighInObs[] {
  const by = new Map<number, WeighInObs[]>();
  for (const o of obs) {
    if (!Number.isFinite(o.scaleKg) || !Number.isInteger(o.day)) continue;
    const a = by.get(o.day);
    if (a) a.push(o);
    else by.set(o.day, [o]);
  }
  const out: WeighInObs[] = [];
  for (const [day, a] of [...by.entries()].sort((x, y) => x[0] - y[0])) {
    const n = a.length;
    out.push({
      day,
      scaleKg: a.reduce((s, o) => s + o.scaleKg, 0) / n,
      waterKg: a.reduce((s, o) => s + (o.waterKg ?? 0), 0) / n,
      standardised: a.every((o) => o.standardised !== false),
      // same-morning repeats do not average out day-to-day water and gut noise (σ_rel is day-to-day variability)
      rMult: Math.max(...a.map((o) => o.rMult ?? 1)),
    });
  }
  return out;
}

/** Run the filter. `obs` may be unsorted; same-day entries are averaged. */
export function runTrendFilter(obsIn: readonly WeighInObs[], opts: TrendFilterOptions = {}): TrendResult {
  const prm = opts.params ?? ASSIMILATION_DEFAULTS;
  const obs = mergeSameDay(obsIn);
  const empty: TrendResult = { points: [], internals: { xp: new Float64Array(0), pp: new Float64Array(0), xf: new Float64Array(0), pf: new Float64Array(0) }, flaggedDays: [] };
  if (obs.length === 0 && !opts.prior) return empty;
  const dowOff = (day: number): number => (opts.dow ? (opts.dow.offsets[weekdayOf(day, opts.dow.startWeekday)] ?? 0) : 0);
  const yOf = (o: WeighInObs): number => o.scaleKg - (o.waterKg ?? 0) - dowOff(o.day);

  let w: number;
  let r: number;
  let P00: number;
  let P01: number;
  let P11: number;
  let firstDay: number;
  let lastObsDay: number;
  let idx = 0;
  if (opts.prior) {
    w = opts.prior.w;
    r = opts.prior.r;
    P00 = opts.prior.wSd ** 2;
    P01 = 0;
    P11 = opts.prior.rSd ** 2;
    firstDay = opts.prior.day + 1;
    lastObsDay = opts.prior.day;
    while (idx < obs.length && obs[idx]!.day <= opts.prior.day) idx++;
  } else {
    const o = obs[0]!;
    const y0 = yOf(o);
    const sr = o.standardised === false ? prm.sigmaRelUnstd : prm.sigmaRel;
    w = y0;
    r = opts.rateGuess ?? 0;
    P00 = (sr * y0) ** 2 * (o.rMult ?? 1);
    P01 = 0;
    P11 = prm.rateInitSdKgD ** 2;
    firstDay = o.day;
    lastObsDay = o.day;
    idx = 1;
  }
  const lastDay = Math.max(opts.untilDay ?? -Infinity, obs.length > 0 ? obs[obs.length - 1]!.day : firstDay, firstDay);
  const n = lastDay - firstDay + 1;
  const xp = new Float64Array(2 * n);
  const pp = new Float64Array(3 * n);
  const xf = new Float64Array(2 * n);
  const pf = new Float64Array(3 * n);
  const points: TrendPoint[] = [];
  const flaggedDays: number[] = [];

  for (let i = 0; i < n; i++) {
    const day = firstDay + i;
    const isFirstFromObs = !opts.prior && i === 0;
    if (!isFirstFromObs) {
      // predict one day: x = F x; P = F P Fᵀ + Q (q scaled with the current trend mass)
      const scale = Math.max(0.3, w / prm.refMassKg);
      const qw = (prm.qW * scale) ** 2;
      const qr = (prm.qR * scale) ** 2;
      w = w + r;
      const n00 = P00 + 2 * P01 + P11 + qw;
      const n01 = P01 + P11;
      const n11 = P11 + qr;
      P00 = n00;
      P01 = n01;
      P11 = n11;
    }
    xp[2 * i] = w;
    xp[2 * i + 1] = r;
    pp[3 * i] = P00;
    pp[3 * i + 1] = P01;
    pp[3 * i + 2] = P11;
    const pt: TrendPoint = { day, w, wSd: Math.sqrt(P00), r, rSd: Math.sqrt(P11), observed: false };
    if (isFirstFromObs) {
      pt.observed = true;
      pt.y = w;
      pt.innovation = 0;
    } else if (idx < obs.length && obs[idx]!.day === day) {
      const o = obs[idx++]!;
      if (day - lastObsDay >= prm.gapResetDays) {
        P00 = Math.max(P00, prm.gapResetSdKg ** 2);
        P01 = 0;
        pt.reset = true;
      }
      const y = yOf(o);
      const sr = o.standardised === false ? prm.sigmaRelUnstd : prm.sigmaRel;
      let R = (sr * w) ** 2 * (o.rMult ?? 1);
      const nu = y - w;
      let S = P00 + R;
      if (Math.abs(nu) > prm.outlierSigma * Math.sqrt(S)) {
        R *= prm.outlierRMult;
        S = P00 + R;
        pt.flagged = true;
        flaggedDays.push(day);
      }
      const k0 = P00 / S;
      const k1 = P01 / S;
      w = w + k0 * nu;
      r = r + k1 * nu;
      const n00 = (1 - k0) * P00;
      const n01 = (1 - k0) * P01;
      const n11 = P11 - k1 * P01;
      P00 = n00;
      P01 = n01;
      P11 = n11;
      lastObsDay = day;
      pt.observed = true;
      pt.y = y;
      pt.innovation = nu;
      pt.w = w;
      pt.wSd = Math.sqrt(P00);
      pt.r = r;
      pt.rSd = Math.sqrt(Math.max(0, P11));
    }
    xf[2 * i] = w;
    xf[2 * i + 1] = r;
    pf[3 * i] = P00;
    pf[3 * i + 1] = P01;
    pf[3 * i + 2] = P11;
    points.push(pt);
  }
  return { points, internals: { xp, pp, xf, pf }, flaggedDays };
}

/** Rauch–Tung–Striebel smoother over a filter run (display and the day-of-week estimate; never for the forecast state). */
export function smoothTrend(res: TrendResult): TrendPoint[] {
  const { xp, pp, xf, pf } = res.internals;
  const n = res.points.length;
  if (n === 0) return [];
  const out: TrendPoint[] = res.points.map((p) => ({ ...p }));
  let sw = xf[2 * (n - 1)]!;
  let sr = xf[2 * (n - 1) + 1]!;
  let s00 = pf[3 * (n - 1)]!;
  let s01 = pf[3 * (n - 1) + 1]!;
  let s11 = pf[3 * (n - 1) + 2]!;
  for (let i = n - 2; i >= 0; i--) {
    // C = Pf Fᵀ Pp(i+1)⁻¹
    const f00 = pf[3 * i]!;
    const f01 = pf[3 * i + 1]!;
    const f11 = pf[3 * i + 2]!;
    // Pf Fᵀ with F = [[1,1],[0,1]]: [[f00 + f01, f01], [f01 + f11, f11]]
    const a00 = f00 + f01;
    const a01 = f01;
    const a10 = f01 + f11;
    const a11 = f11;
    const q00 = pp[3 * (i + 1)]!;
    const q01 = pp[3 * (i + 1) + 1]!;
    const q11 = pp[3 * (i + 1) + 2]!;
    const det = q00 * q11 - q01 * q01;
    if (!(det > 0)) continue;
    const i00 = q11 / det;
    const i01 = -q01 / det;
    const i11 = q00 / det;
    const c00 = a00 * i00 + a01 * i01;
    const c01 = a00 * i01 + a01 * i11;
    const c10 = a10 * i00 + a11 * i01;
    const c11 = a10 * i01 + a11 * i11;
    const dw = sw - xp[2 * (i + 1)]!;
    const dr = sr - xp[2 * (i + 1) + 1]!;
    const nw = xf[2 * i]! + c00 * dw + c01 * dr;
    const nr = xf[2 * i + 1]! + c10 * dw + c11 * dr;
    // Ps = Pf + C (Ps(i+1) − Pp(i+1)) Cᵀ
    const d00 = s00 - q00;
    const d01 = s01 - q01;
    const d11 = s11 - q11;
    const m00 = c00 * d00 + c01 * d01;
    const m01 = c00 * d01 + c01 * d11;
    const m10 = c10 * d00 + c11 * d01;
    const m11 = c10 * d01 + c11 * d11;
    const n00 = f00 + m00 * c00 + m01 * c01;
    const n01 = f01 + m00 * c10 + m01 * c11;
    const n11 = f11 + m10 * c10 + m11 * c11;
    sw = nw;
    sr = nr;
    s00 = n00;
    s01 = n01;
    s11 = n11;
    const o = out[i]!;
    o.w = nw;
    o.r = nr;
    o.wSd = Math.sqrt(Math.max(0, n00));
    o.rSd = Math.sqrt(Math.max(0, n11));
  }
  return out;
}

/**
 * Day-of-week offsets (Monday first, sum zero) from smoothed residuals, each shrunk toward 0 with a pseudo-count
 * (`dowShrink`). Null before `dowMinDays` of data (R11 §3.1: "only after 6 weeks").
 */
export function estimateDowOffsets(obsIn: readonly WeighInObs[], startWeekday: number, params: AssimilationParams = ASSIMILATION_DEFAULTS): number[] | null {
  const obs = mergeSameDay(obsIn);
  if (obs.length < 2 || obs[obs.length - 1]!.day - obs[0]!.day + 1 < params.dowMinDays) return null;
  const sm = smoothTrend(runTrendFilter(obs, { params }));
  const byDay = new Map(sm.map((p) => [p.day, p] as const));
  const sum = new Array<number>(7).fill(0);
  const cnt = new Array<number>(7).fill(0);
  for (const o of obs) {
    const p = byDay.get(o.day);
    if (!p || p.flagged) continue;
    const j = weekdayOf(o.day, startWeekday);
    sum[j]! += o.scaleKg - (o.waterKg ?? 0) - p.w;
    cnt[j]! += 1;
  }
  const raw = sum.map((s, j) => s / (cnt[j]! + params.dowShrink));
  const mean = raw.reduce((a, b) => a + b, 0) / 7;
  return raw.map((b) => b - mean);
}

/**
 * Display line: EWMA (α = 0.1) over daily weights with gaps linearly interpolated (display only, R11 §3.2). Returns one
 * value per day from the first to the last weigh-in.
 */
export function ewmaDisplay(obsIn: readonly WeighInObs[], alpha: number = ASSIMILATION_DEFAULTS.ewmaAlpha): Array<{ day: number; kg: number }> {
  const obs = mergeSameDay(obsIn);
  if (obs.length === 0) return [];
  const out: Array<{ day: number; kg: number }> = [];
  let t = obs[0]!.scaleKg;
  out.push({ day: obs[0]!.day, kg: t });
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1]!;
    const b = obs[i]!;
    for (let d = a.day + 1; d <= b.day; d++) {
      const x = a.scaleKg + ((b.scaleKg - a.scaleKg) * (d - a.day)) / (b.day - a.day);
      t = t + alpha * (x - t);
      out.push({ day: d, kg: t });
    }
  }
  return out;
}

/** Weigh-ins in the window (day − n, day]. */
export function countWeighIns(days: readonly number[], day: number, n: number): number {
  const set = new Set(days);
  let c = 0;
  for (const d of set) if (d > day - n && d <= day) c++;
  return c;
}
