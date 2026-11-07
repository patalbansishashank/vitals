/**
 * Balance correction δ (kcal/d), docs/SUITE_SPEC.md §3.5 step 4, R11 §3.3, reviewed 2026-10-18 (D5-03, D5-04, C4).
 *
 * δ > 0 means more net stored-energy availability than the uncorrected replay predicts. It is ONE identifiable predictive
 * residual, an inferred ledger correction: it does not separate intake under-reporting from expenditure error (weight
 * alone cannot), it is not a physiological intervention, and its forward application is the versioned absorbed-macro
 * imputation of `runHooks` (an intake-side scenario). Logged foods are never changed.
 *
 * Estimator strategy (D5-04, `ESTIMATOR_STRATEGY`): every eligible decision refits its window from a FIXED prior
 * N(0, biasPriorSd²); an earlier posterior is never fed back as an independent prior over an overlapping window (overlap
 * is recomputation, not new evidence). No source label changes the weight of the residual (the old +50 kcal/d prior bump
 * for AI-estimated energy is retired: a wider prior raises the weight of the same residual, K = P/(P + R)).
 *
 * Measurements of the window (both with a free intercept and identical observation times and weights 1/R_i):
 *  - production (`fitReplayResidual`): the whole-window forward replay of the exact application law from the window-start
 *    state, past anchors fixed; one scalar residual is fitted by weighted, robust least squares on the numerical response
 *    of the 'scaleWake' operator (no universal energy density);
 *  - linear diagnostic (`linearBalanceMeasurement`): only for a linear constant-density system,
 *      δ_meas = ρ·slope(y − E) + slope(A),   A_i = Σ correction actually applied before observation i (kcal),
 *    where E is the replay that carried the actual correction history. With a constant application A_i = δ_applied·t_i and
 *    this reduces to the old `slope·ρ + δ_applied`; with a changed or skipped application it does not.
 * Controller (C4/D5-03): the request (posterior mean) is bounded to ±300 kcal/d and at most 100 kcal/d from the value in
 * force at the start of the weekly step period (a retry never earns another step). Bounds are provisional control policy,
 * not biological limits; saturation is reported. The SD is the conditional SD of the unconstrained estimate (independent
 * errors assumed, coverage unvalidated); it is not a credible interval around a bounded mean.
 * Updated only with ≥ 10 weigh-ins in the window and ≥ 4 calibration-eligible intake days in each of the last two weeks;
 * otherwise the value in force is kept. Pure.
 */
import { ASSIMILATION_DEFAULTS, ESTIMATOR_STRATEGY, type AssimilationParams } from './params';

export interface BiasWindowPoint {
  day: number;
  /** Observation under the measurement operator (e.g. scale − engine water − day-of-week offset), kg. */
  y: number;
  /** Model prediction under the same operator at that observation time (jump-free path), kg. */
  engineKg: number;
  /** Observation variance (context, events, outlier inflation, supplied water/transient terms), kg²; absent = sigmaKg². */
  varKg2?: number;
  /** A_i: correction actually applied before this observation instant, kcal (cumulative); absent = constant `deltaApplied`. */
  appliedCumKcal?: number;
}

export interface EnergyBiasInput {
  points: readonly BiasWindowPoint[];
  /** Effective energy density of the engine's mix over the window, kcal/kg (`mixDensity`; linear diagnostic only). */
  rhoKcalPerKg: number;
  /** Per-observation SD when a point carries no variance (σ_rel·W), kg. */
  sigmaKg: number;
  /** Correction in force over the window (used only when points carry no applied history), kcal/d. */
  deltaApplied: number;
  /** Controller state: `mean` = correction in force before this decision (kept when gated); `sd` is not a prior. */
  previous: { mean: number; sd: number };
  /** Correction in force at the start of the weekly step period (the step is measured from it); default `previous.mean`. */
  stepReferenceKcal?: number;
  /** Fixed prior; default N(0, biasPriorSdKcal²). */
  prior?: { mean: number; sd: number };
  /** A measurement already fitted elsewhere (the replay residual); when absent the linear diagnostic is used. */
  measurement?: BalanceMeasurement;
  /** Calibration-eligible intake days in the last 7 and the 7 before (gate). */
  intakeDaysWeek1: number;
  intakeDaysWeek2: number;
  /** Deprecated (D5-04): ignored. A source label is not a quantitative error model and never changes a weight. */
  aiEnergyShare?: number;
  params?: AssimilationParams;
}

/** One window measurement of δ (kcal/d) with its conditional SE. */
export interface BalanceMeasurement {
  value: number;
  se: number;
  n: number;
  method: 'linearAppliedHistory' | 'replayResidual';
  /** Free intercept of the fit (kg for the replay fit, kcal for the linear form). */
  intercept?: number;
  /** Points whose variance the robust pass inflated. */
  downweighted?: number;
}

export interface EnergyBiasEstimate {
  /** Correction to apply (controller output), kcal/d; the value in force when not updated. */
  mean: number;
  /** Conditional SD of the unconstrained fixed-prior estimate, kcal/d (not an interval around a bounded `mean`). */
  sd: number;
  updated: boolean;
  /** Why the estimate was not updated (gate), or which bound held the applied value. */
  reason?: 'fewWeighIns' | 'fewIntakeDays' | 'noNewEvidence' | 'clampedStep' | 'clampedValue';
  measurement?: BalanceMeasurement;
  /** Unbounded request (posterior mean of the fixed-prior refit), kcal/d. */
  requestedKcal?: number;
  posterior?: { mean: number; sd: number };
  /** At ±biasClampKcal with the request beyond it ("Correction at limit"). */
  saturated?: boolean;
  /** The weekly step bound held the value. */
  stepLimited?: boolean;
  strategy?: typeof ESTIMATOR_STRATEGY;
  uncertaintyKind?: 'conditionalResidual';
  coverage?: 'unvalidated';
}

/** Weighted least-squares slope of v on t with a free intercept: slope, intercept, Σw(t − t̄)², weighted means. */
export function weightedSlope(t: readonly number[], v: readonly number[], w: readonly number[]): { slope: number; intercept: number; sxx: number } {
  const n = t.length;
  let sw = 0;
  let mt = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    const wi = w[i]!;
    sw += wi;
    mt += wi * t[i]!;
    mv += wi * v[i]!;
  }
  if (!(sw > 0)) return { slope: 0, intercept: 0, sxx: 0 };
  mt /= sw;
  mv /= sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dt = t[i]! - mt;
    sxx += w[i]! * dt * dt;
    sxy += w[i]! * dt * (v[i]! - mv);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: mv - slope * mt, sxx };
}

const varOf = (p: BiasWindowPoint, sigmaKg: number): number => {
  const v = p.varKg2 !== undefined && Number.isFinite(p.varKg2) && p.varKg2 > 0 ? p.varKg2 : sigmaKg * sigmaKg;
  return Math.max(v, 1e-12);
};

/**
 * Linear diagnostic (D5-03): δ = ρ·slope_w(y − E) + slope_w(A) with A_i the correction actually applied before
 * observation i, identical times and weights 1/R_i, free intercept. SE = ρ/√Σw(t − t̄)² (independent errors assumed).
 * Valid only for a linear constant-density system; null when the window has no spread.
 */
export function linearBalanceMeasurement(points: readonly BiasWindowPoint[], rhoKcalPerKg: number, sigmaKg: number, deltaApplied: number): BalanceMeasurement | null {
  if (points.length < 2) return null;
  const t0 = Math.min(...points.map((p) => p.day));
  const t = points.map((p) => p.day);
  const w = points.map((p) => 1 / varOf(p, sigmaKg));
  // ρ·(y − E) + A in kcal: its slope is the residual under the linear law, intercept free
  const u = points.map((p) => rhoKcalPerKg * (p.y - p.engineKg) + (p.appliedCumKcal ?? deltaApplied * (p.day - t0)));
  const f = weightedSlope(t, u, w);
  if (!(f.sxx > 0)) return null;
  return { value: f.slope, se: Math.max(1e-6, rhoKcalPerKg / Math.sqrt(f.sxx)), n: points.length, method: 'linearAppliedHistory', intercept: f.intercept };
}

/**
 * Production fit (D5-03): weighted least squares of v_i = observed − predicted(δ0) on the numerical response s_i =
 * ∂predicted_i/∂δ (kg per kcal/d) with a free intercept, then one robust pass (points beyond `outlierSigma` standardised
 * residuals get R × outlierRMult, flagged rather than deleted). Returns the increment to add to δ0, or null when the
 * responses have no spread (nothing identifiable).
 */
export function fitReplayResidual(v: readonly number[], s: readonly number[], varKg2: readonly number[], prm: AssimilationParams = ASSIMILATION_DEFAULTS): BalanceMeasurement | null {
  const n = v.length;
  if (n < 2 || s.length !== n || varKg2.length !== n) return null;
  const vars = varKg2.map((x) => Math.max(Number.isFinite(x) && x > 0 ? x : 1e-12, 1e-12));
  const fit = () => weightedSlope(s, v, vars.map((x) => 1 / x));
  let f = fit();
  if (!(f.sxx > 0)) return null;
  let down = 0;
  for (let i = 0; i < n; i++) {
    const r = v[i]! - f.intercept - f.slope * s[i]!;
    if (Math.abs(r) > prm.outlierSigma * Math.sqrt(vars[i]!)) {
      vars[i]! *= prm.outlierRMult;
      down++;
    }
  }
  if (down > 0) {
    f = fit();
    if (!(f.sxx > 0)) return null;
  }
  return { value: f.slope, se: Math.max(1e-6, 1 / Math.sqrt(f.sxx)), n, method: 'replayResidual', intercept: f.intercept, downweighted: down };
}

/** Fixed-prior posterior of one Gaussian measurement (precision weighting). */
export function fixedPriorPosterior(m: Pick<BalanceMeasurement, 'value' | 'se'>, prior: { mean: number; sd: number }): { mean: number; sd: number } {
  const wp = 1 / Math.max(1e-9, prior.sd) ** 2;
  const wm = 1 / Math.max(1e-6, m.se) ** 2;
  return { mean: (prior.mean * wp + m.value * wm) / (wp + wm), sd: Math.sqrt(1 / (wp + wm)) };
}

/**
 * Controller bounds (C4/D5-03, provisional policy): the request is held within ±biasMaxStepKcal of the step reference
 * (the value in force at the start of the weekly period) and then within ±biasClampKcal.
 */
export function boundCorrection(requestedKcal: number, stepReferenceKcal: number, prm: AssimilationParams = ASSIMILATION_DEFAULTS): { appliedKcal: number; saturated: boolean; stepLimited: boolean; valueLimited: boolean } {
  const step = prm.biasMaxStepKcal;
  const cap = prm.biasClampKcal;
  const stepped = Math.min(stepReferenceKcal + step, Math.max(stepReferenceKcal - step, requestedKcal));
  const applied = Math.min(cap, Math.max(-cap, stepped));
  return { appliedKcal: applied, saturated: Math.abs(applied) >= cap && Math.abs(requestedKcal) > cap, stepLimited: stepped !== requestedKcal, valueLimited: applied !== stepped };
}

export function estimateEnergyBias(i: EnergyBiasInput): EnergyBiasEstimate {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const prev = i.previous;
  const keep = (reason: NonNullable<EnergyBiasEstimate['reason']>): EnergyBiasEstimate => ({ mean: prev.mean, sd: prev.sd, updated: false, reason, strategy: ESTIMATOR_STRATEGY, uncertaintyKind: 'conditionalResidual', coverage: 'unvalidated' });
  if (i.points.length < prm.biasMinWeighIns) return keep('fewWeighIns');
  if (i.intakeDaysWeek1 < prm.biasMinIntakeDays || i.intakeDaysWeek2 < prm.biasMinIntakeDays) return keep('fewIntakeDays');
  const m = i.measurement ?? linearBalanceMeasurement(i.points, i.rhoKcalPerKg, i.sigmaKg, i.deltaApplied);
  if (!m || !Number.isFinite(m.value) || !Number.isFinite(m.se)) return keep('fewWeighIns');
  const posterior = fixedPriorPosterior(m, i.prior ?? { mean: 0, sd: prm.biasPriorSdKcal });
  const b = boundCorrection(posterior.mean, i.stepReferenceKcal ?? prev.mean, prm);
  const reason: EnergyBiasEstimate['reason'] = b.valueLimited ? 'clampedValue' : b.stepLimited ? 'clampedStep' : undefined;
  return {
    mean: b.appliedKcal,
    sd: posterior.sd,
    updated: true,
    ...(reason ? { reason } : {}),
    measurement: m,
    requestedKcal: posterior.mean,
    posterior,
    saturated: b.saturated,
    stepLimited: b.stepLimited,
    strategy: ESTIMATOR_STRATEGY,
    uncertaintyKind: 'conditionalResidual',
    coverage: 'unvalidated',
  };
}

/**
 * Effective energy density of the engine's own fat/lean mix over a window, kcal/kg of tissue, at the effective
 * (intake-side) densities ρ + η (Hall convention). Only the linear diagnostic uses it: the production fit takes the
 * numerical response of the replay instead. When the window's net tissue change is too small to define a mix (< 0.2 kg,
 * e.g. recomposition) the Forbes partition at the current fat mass is used and labelled as a fallback, never a measured
 * density (`mixDensityInfo`).
 */
export function mixDensity(dFatKg: number, dLeanKg: number, fatMassKg: number, eff: { fat: number; lean: number } = { fat: 9441 + 179, lean: 1816 + 229 }): number {
  return mixDensityInfo(dFatKg, dLeanKg, fatMassKg, eff).rhoKcalPerKg;
}

export function mixDensityInfo(dFatKg: number, dLeanKg: number, fatMassKg: number, eff: { fat: number; lean: number } = { fat: 9441 + 179, lean: 1816 + 229 }): { rhoKcalPerKg: number; source: 'windowMix' | 'forbesFallback' } {
  const dT = dFatKg + dLeanKg;
  let rho: number;
  let source: 'windowMix' | 'forbesFallback';
  if (Math.abs(dT) >= 0.2 && Math.sign(dFatKg) !== -Math.sign(dLeanKg)) {
    rho = (eff.fat * dFatKg + eff.lean * dLeanKg) / dT;
    source = 'windowMix';
  } else {
    const leanShare = 10.4 / (10.4 + Math.max(1, fatMassKg));
    rho = (1 - leanShare) * eff.fat + leanShare * eff.lean;
    source = 'forbesFallback';
  }
  return { rhoKcalPerKg: Math.min(eff.fat, Math.max(3000, rho)), source };
}
