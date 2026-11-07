/**
 * Trend weight (docs/SUITE_SPEC.md §3.5 step 2; R11 §3.2): a local-linear-trend Kalman filter on the scale weight with the
 * engine's own water terms removed, an RTS smoother for display and the day-of-week offset, and the EWMA display line.
 *
 * State x = [w, r] (water-adjusted mass trend, kg; rate, kg/d), daily step F = [[1, 1], [0, 1]], Q = diag(q_w², q_r²) with
 * q_w, q_r the discrete daily state- and rate-increment SDs, scaled linearly with body mass (defaults refer to 75 kg).
 * Observation y = scale − engine labile water (glycogen and its water, ECF/sodium water, gut contents …; the engine's
 * `waterWeight` at the wake hour) under the 'waterAdjustedWake' operator. Its variance (C4/D5-04) is
 *   R_y = R_scale + Var(model water) − 2·Cov(scale, model water) + transient² ,  R_scale = (σ_rel·W)² × multipliers
 *  - σ_rel is the standardised value only for a known standardised protocol; unknown context uses the unstandardised one;
 *  - Var/Cov of the model water term enter only when the caller supplies them (no invented water covariance); without
 *    them the water term is treated as exact and every SD is conditional on it (`meta.waterUncertainty`);
 *  - a transient model discrepancy (e.g. a menstrual-cycle transient of unknown amplitude, D1-06) adds its variance; an
 *    unknown amplitude is never a zero variance and never a fat/lean correction;
 *  - unusual point: |innovation| > 3.5·√S → R × 10 for that point, flagged, never deleted;
 *  - declared events: R × 4 for the event days (the caller passes `rMult`);
 *  - ≥ 14 days without a weigh-in: the trend SD is reset to 1 kg at the next weigh-in;
 *  - a change of weighing device with a supplied systematic SD widens the level by both devices' bias variances; a
 *    shared device bias never averages down with repeats (D6-06): it is reported as a level floor (`meta.systematicSdKg`).
 * Own time (C1/A1-018): a reading with an exact instant is placed on the plan day of that instant (declared zone) and the
 * caller removes the model water OF THAT HOUR, an interval reading the mean water over its hours (its spread enters as
 * water SD); a date-only or untimed reading keeps the day's wake water as the declared daily convention and is counted as
 * `dateOnly` (or `unknown`) timing (`meta.timing`), never as an exact morning instant.
 * A gap is stepped one day at a time (process noise accumulates with elapsed time). Every SD is a conditional model SD
 * (`uncertaintyKind 'conditionalResidual'`, coverage unvalidated), never a calibrated prediction interval.
 * Pure and deterministic; no clock.
 */
import { CONTRACT_VERSIONS, type OccurrenceTime } from '@/lib/bodyContracts';
import type { MeasurementContext } from '@/lib/measurementOperators';
import { ASSIMILATION_DEFAULTS, type AssimilationParams } from './params';
import type { ObservationTiming } from './replay';

/** One morning weigh-in (several on the same day are averaged by the filter). */
export interface WeighInObs {
  /** Plan-day index (integer, day 0 = plan start). */
  day: number;
  /** Measured scale weight, kg. */
  scaleKg: number;
  /** Engine labile water that morning (`waterWeight` series), kg; 0 when unknown. */
  waterKg?: number;
  /**
   * Legacy flag: true = standardised protocol, false = not. Prefer `context`. With neither, the context is unknown and the
   * unstandardised noise is used (C4: unknown is never morning-standardised precision).
   */
  standardised?: boolean;
  /** (C4/D5-04) protocol context of this reading. */
  context?: MeasurementContext;
  /** Extra noise multiplier from declared events (×4 for the event days); default 1. */
  rMult?: number;
  /** (C1/C4) observation (revision) id; decisions record the ids they consumed. */
  observationId?: string;
  /** (D5-04) SD of the model water term at that morning, kg; absent = not modelled (SDs conditional on the water term). */
  waterSdKg?: number;
  /** (D5-04) Cov(scale error, model-water error), kg²; only with `waterSdKg`; absent = 0 (an explicit assumption). */
  waterCovKg2?: number;
  /** (D1-06) transient model-discrepancy SD at that morning (e.g. an unmodelled cycle transient), kg. */
  transientSdKg?: number;
  /** (D6-06/C4) weighing device identity (shared bias group) and its systematic bias SD, kg (does not average down). */
  device?: string;
  systematicSdKg?: number;
  /** (A1-018) when on `day` it was taken (absent = untimed legacy reading, read under the daily wake convention). */
  timing?: ObservationTiming;
  /** (C1/A1-018) the occurrence as recorded (zone, date meaning), carried for provenance; never the entry time. */
  occurrence?: OccurrenceTime;
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
  /** Filtered (or smoothed) water-adjusted mass trend and its conditional SD, kg. */
  w: number;
  wSd: number;
  /** Rate, kg/d, and its SD. */
  r: number;
  rSd: number;
  observed: boolean;
  /** Residualised observation y (scale − water − day-of-week offset) and the innovation, when observed. */
  y?: number;
  innovation?: number;
  /** Observation variance used for this point (all components and multipliers, outlier inflation included), kg². */
  rKg2?: number;
  /** True when the point was treated as unusual (R × outlierRMult). */
  flagged?: boolean;
  /** True when this weigh-in followed a gap ≥ gapResetDays (trend SD reset). */
  reset?: boolean;
  /** True when this weigh-in came from a different device than the previous one (level widened, D6-06). */
  deviceChange?: boolean;
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

/** What the filter's numbers mean (C6): separate from the numbers themselves. */
export interface TrendMeta {
  estimator: 'localLinearTrendKalman';
  /** Estimator contract version (C7). */
  version: number;
  operator: 'waterAdjustedWake';
  uncertaintyKind: 'conditionalResidual';
  coverage: 'unvalidated';
  /** 'notModelled' = the model water term is treated as exact; 'supplied' = its Var/Cov were propagated for every reading. */
  waterUncertainty: 'notModelled' | 'partial' | 'supplied';
  /** 'supplied' when any reading carried a transient model-discrepancy SD (D1-06). */
  transient: 'none' | 'supplied';
  /** Readings by protocol context (after same-day merging). */
  contexts: Record<MeasurementContext, number>;
  /** (A1-018) Readings by timing precision, before same-day merging (an untimed dated reading counts as `dateOnly`). */
  timing: Record<ObservationTiming['precision'], number>;
  /** Readings treated as unusual, gap resets, device changes. */
  flagged: number;
  resets: number;
  deviceChanges: number;
  /** Supplied water covariances that made R_y negative (dropped to Cov = 0 for that reading). */
  covarianceRejected: number;
  /** Non-averaging device-bias SD of the current device, kg (absolute level only; changes are unaffected), or null. */
  systematicSdKg: number | null;
}

export interface TrendResult {
  points: TrendPoint[];
  /** Internals for the smoother: predicted and filtered states/covariances per point (same order as `points`). */
  internals: { xp: Float64Array; pp: Float64Array; xf: Float64Array; pf: Float64Array };
  flaggedDays: number[];
  meta: TrendMeta;
}

const weekdayOf = (day: number, startWeekday: number): number => (((startWeekday + day) % 7) + 7) % 7;

/** Protocol context of a reading: explicit `context`, else the legacy flag, else unknown (C4). */
export function weighInContext(o: Pick<WeighInObs, 'context' | 'standardised'>): MeasurementContext {
  if (o.context) return o.context;
  if (o.standardised === true) return 'standardized';
  if (o.standardised === false) return 'unstandardized';
  return 'unknown';
}

/** Relative observation SD of one reading: the standardised value only for a known standardised protocol. */
export function relativeObservationSd(ctx: MeasurementContext, prm: AssimilationParams = ASSIMILATION_DEFAULTS): number {
  return ctx === 'standardized' ? prm.sigmaRel : prm.sigmaRelUnstd;
}

/**
 * Upper bound of the SD of a bounded transient of unknown phase and shape with peak-to-trough range `rangeKg`
 * (Popoviciu: Var ≤ range²/4). A declared range assumption (e.g. the legacy 0.2 kg cycle shape, or a study contrast
 * scenario) becomes observation variance this way without inventing a distribution; null for a non-finite range.
 */
export function boundedTransientSdKg(rangeKg: number): number | null {
  if (!Number.isFinite(rangeKg) || rangeKg < 0) return null;
  return rangeKg / 2;
}

/**
 * Observation variance of one reading at trend mass `w` (kg²): scale noise × multipliers, plus the supplied model-water
 * variance minus twice the scale/water covariance, plus the transient variance. A supplied covariance that would make the
 * variance negative is rejected (Cov = 0 for that reading) rather than clamped into a precise-looking number.
 */
export function observationVarianceKg2(o: WeighInObs, w: number, prm: AssimilationParams = ASSIMILATION_DEFAULTS): { rKg2: number; covarianceRejected: boolean } {
  const sd = relativeObservationSd(weighInContext(o), prm) * Math.abs(w);
  let r = sd * sd * (o.rMult ?? 1);
  let rejected = false;
  if (o.waterSdKg !== undefined && Number.isFinite(o.waterSdKg) && o.waterSdKg > 0) {
    const vW = o.waterSdKg * o.waterSdKg;
    const cov = o.waterCovKg2 !== undefined && Number.isFinite(o.waterCovKg2) ? o.waterCovKg2 : 0;
    const v = r + vW - 2 * cov;
    if (v > 0) r = v;
    else {
      r += vW;
      rejected = true;
    }
  }
  if (o.transientSdKg !== undefined && Number.isFinite(o.transientSdKg) && o.transientSdKg > 0) r += o.transientSdKg * o.transientSdKg;
  return { rKg2: Math.max(r, 1e-12), covarianceRejected: rejected };
}

/**
 * Average same-day weigh-ins and sort by day. The noise is not divided (σ_rel is day-to-day variability, and a shared
 * device bias never averages down): the merged reading keeps the largest multiplier and supplied SDs, the weakest context.
 */
export function mergeSameDay(obs: readonly WeighInObs[]): WeighInObs[] {
  const by = new Map<number, WeighInObs[]>();
  for (const o of obs) {
    if (!Number.isFinite(o.scaleKg) || !Number.isInteger(o.day)) continue;
    const a = by.get(o.day);
    if (a) a.push(o);
    else by.set(o.day, [o]);
  }
  const out: WeighInObs[] = [];
  const maxOf = (a: readonly WeighInObs[], f: (o: WeighInObs) => number | undefined): number | undefined => {
    let m: number | undefined;
    for (const o of a) {
      const v = f(o);
      if (v !== undefined && Number.isFinite(v)) m = m === undefined ? v : Math.max(m, v);
    }
    return m;
  };
  for (const [day, a] of [...by.entries()].sort((x, y) => x[0] - y[0])) {
    const n = a.length;
    const ctxs = a.map(weighInContext);
    const context: MeasurementContext = ctxs.includes('unstandardized') ? 'unstandardized' : ctxs.every((c) => c === 'standardized') ? 'standardized' : 'unknown';
    const devices = new Set(a.map((o) => o.device));
    const waterSd = maxOf(a, (o) => o.waterSdKg);
    const waterCov = waterSd !== undefined ? maxOf(a, (o) => o.waterCovKg2) : undefined;
    const transient = maxOf(a, (o) => o.transientSdKg);
    const sys = maxOf(a, (o) => o.systematicSdKg);
    const device = devices.size === 1 ? a[0]!.device : undefined;
    out.push({
      day,
      scaleKg: a.reduce((s, o) => s + o.scaleKg, 0) / n,
      waterKg: a.reduce((s, o) => s + (o.waterKg ?? 0), 0) / n,
      context,
      standardised: context === 'standardized',
      // same-morning repeats do not average out day-to-day water and gut noise (σ_rel is day-to-day variability)
      rMult: Math.max(...a.map((o) => o.rMult ?? 1)),
      ...(n === 1 && a[0]!.observationId !== undefined ? { observationId: a[0]!.observationId } : {}),
      ...(waterSd !== undefined ? { waterSdKg: waterSd } : {}),
      ...(waterCov !== undefined ? { waterCovKg2: waterCov } : {}),
      ...(transient !== undefined ? { transientSdKg: transient } : {}),
      ...(device !== undefined ? { device } : {}),
      ...(sys !== undefined ? { systematicSdKg: sys } : {}),
    });
  }
  return out;
}

function emptyMeta(): TrendMeta {
  return {
    estimator: 'localLinearTrendKalman',
    version: CONTRACT_VERSIONS.estimator,
    operator: 'waterAdjustedWake',
    uncertaintyKind: 'conditionalResidual',
    coverage: 'unvalidated',
    waterUncertainty: 'notModelled',
    transient: 'none',
    contexts: { standardized: 0, unstandardized: 0, unknown: 0 },
    timing: { instant: 0, interval: 0, dateOnly: 0, unknown: 0 },
    flagged: 0,
    resets: 0,
    deviceChanges: 0,
    covarianceRejected: 0,
    systematicSdKg: null,
  };
}

/** Run the filter. `obs` may be unsorted; same-day entries are averaged. */
export function runTrendFilter(obsIn: readonly WeighInObs[], opts: TrendFilterOptions = {}): TrendResult {
  const prm = opts.params ?? ASSIMILATION_DEFAULTS;
  const obs = mergeSameDay(obsIn);
  const meta = emptyMeta();
  const empty: TrendResult = { points: [], internals: { xp: new Float64Array(0), pp: new Float64Array(0), xf: new Float64Array(0), pf: new Float64Array(0) }, flaggedDays: [], meta };
  if (obs.length === 0 && !opts.prior) return empty;
  const dowOff = (day: number): number => (opts.dow ? (opts.dow.offsets[weekdayOf(day, opts.dow.startWeekday)] ?? 0) : 0);
  const yOf = (o: WeighInObs): number => o.scaleKg - (o.waterKg ?? 0) - dowOff(o.day);
  const used = opts.prior ? obs.filter((o) => o.day > opts.prior!.day) : obs;
  const withWater = used.filter((o) => o.waterSdKg !== undefined && Number.isFinite(o.waterSdKg) && o.waterSdKg > 0).length;
  meta.waterUncertainty = withWater === 0 ? 'notModelled' : withWater === used.length ? 'supplied' : 'partial';
  if (used.some((o) => o.transientSdKg !== undefined && o.transientSdKg > 0)) meta.transient = 'supplied';
  for (const o of used) meta.contexts[weighInContext(o)] += 1;
  for (const o of obsIn) if (Number.isFinite(o.scaleKg) && Number.isInteger(o.day) && (!opts.prior || o.day > opts.prior.day)) meta.timing[o.timing?.precision ?? 'dateOnly'] += 1;

  let w: number;
  let r: number;
  let P00: number;
  let P01: number;
  let P11: number;
  let firstDay: number;
  let lastObsDay: number;
  let lastDevice: { id: string; sysSd: number } | null = null;
  let idx = 0;
  const firstPointR: { r: number } = { r: Number.NaN };
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
    const v = observationVarianceKg2(o, y0, prm);
    if (v.covarianceRejected) meta.covarianceRejected++;
    w = y0;
    r = opts.rateGuess ?? 0;
    P00 = v.rKg2;
    P01 = 0;
    P11 = prm.rateInitSdKgD ** 2;
    firstDay = o.day;
    lastObsDay = o.day;
    firstPointR.r = v.rKg2;
    if (o.device !== undefined) lastDevice = { id: o.device, sysSd: o.systematicSdKg ?? 0 };
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
      pt.rKg2 = firstPointR.r;
    } else if (idx < obs.length && obs[idx]!.day === day) {
      const o = obs[idx++]!;
      if (day - lastObsDay >= prm.gapResetDays) {
        P00 = Math.max(P00, prm.gapResetSdKg ** 2);
        P01 = 0;
        pt.reset = true;
        meta.resets++;
      }
      if (o.device !== undefined) {
        const sys = o.systematicSdKg !== undefined && Number.isFinite(o.systematicSdKg) ? o.systematicSdKg : 0;
        if (lastDevice && lastDevice.id !== o.device && (lastDevice.sysSd > 0 || sys > 0)) {
          // the level moves by the difference of two device biases: Var = σ_a² + σ_b² (never averaged away)
          P00 += lastDevice.sysSd ** 2 + sys ** 2;
          pt.deviceChange = true;
          meta.deviceChanges++;
        }
        lastDevice = { id: o.device, sysSd: sys };
      }
      const y = yOf(o);
      const v = observationVarianceKg2(o, w, prm);
      if (v.covarianceRejected) meta.covarianceRejected++;
      let R = v.rKg2;
      const nu = y - w;
      let S = P00 + R;
      if (Math.abs(nu) > prm.outlierSigma * Math.sqrt(S)) {
        R *= prm.outlierRMult;
        S = P00 + R;
        pt.flagged = true;
        flaggedDays.push(day);
        meta.flagged++;
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
      pt.rKg2 = R;
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
  meta.systematicSdKg = lastDevice && lastDevice.sysSd > 0 ? lastDevice.sysSd : null;
  return { points, internals: { xp, pp, xf, pf }, flaggedDays, meta };
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
