/**
 * Energy-balance bias δ (kcal/d; intake under-report plus expenditure error), docs/SUITE_SPEC.md §3.5 step 4, R11 §3.3.
 *
 * Measurement: over the window, the observed tissue-mass rate minus the engine's rate (the engine path without the jumps
 * of earlier anchors), times the energy density of the engine's own fat/lean mix:
 *   δ_meas = slope(y_t − E_t)·ρ + δ_applied,   SE = σ_obs/√Sxx · ρ
 * (y = residualised weigh-ins, E = jump-free engine tissue path of the replay that already carried δ_applied). Combined by
 * precision with the prior N(δ_prev, 150²) (+50 when > 70 % of logged energy was AI-estimated); the change per check-in is
 * capped at 100 kcal/d and the value at ±300. Updated only with ≥ 10 weigh-ins in the 20-day window and ≥ 4 logged
 * intake days in each of the last two weeks; otherwise δ_prev is kept. Pure.
 */
import { ASSIMILATION_DEFAULTS, type AssimilationParams } from './params';

export interface BiasWindowPoint {
  day: number;
  /** Residualised observation (scale − engine water − day-of-week offset), kg. */
  y: number;
  /** Jump-free engine tissue mass at that morning, kg. */
  engineKg: number;
}

export interface EnergyBiasInput {
  points: readonly BiasWindowPoint[];
  /** Energy density of the engine's mix over the window, kcal/kg (`mixDensity`). */
  rhoKcalPerKg: number;
  /** Per-observation SD (σ_rel·W), kg. */
  sigmaKg: number;
  /** δ that the replay already carried over the window, kcal/d. */
  deltaApplied: number;
  /** Previous estimate (prior mean). */
  previous: { mean: number; sd: number };
  /** Logged intake days in the last 7 and the 7 before (gate). */
  intakeDaysWeek1: number;
  intakeDaysWeek2: number;
  /** Share of logged energy that was AI-estimated over the window (0..1). */
  aiEnergyShare?: number;
  params?: AssimilationParams;
}

export interface EnergyBiasEstimate {
  mean: number;
  sd: number;
  updated: boolean;
  /** Why the estimate was not updated (gate), or which limit bound it. */
  reason?: 'fewWeighIns' | 'fewIntakeDays' | 'clampedStep' | 'clampedValue';
  measurement?: { value: number; se: number; n: number };
}

/** OLS slope of v over t and Sxx. */
function olsSlope(t: readonly number[], v: readonly number[]): { slope: number; sxx: number } {
  const n = t.length;
  let mt = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    mt += t[i]!;
    mv += v[i]!;
  }
  mt /= n;
  mv /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (t[i]! - mt) ** 2;
    sxy += (t[i]! - mt) * (v[i]! - mv);
  }
  return { slope: sxx > 0 ? sxy / sxx : 0, sxx };
}

export function estimateEnergyBias(i: EnergyBiasInput): EnergyBiasEstimate {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const prev = i.previous;
  if (i.points.length < prm.biasMinWeighIns) return { mean: prev.mean, sd: prev.sd, updated: false, reason: 'fewWeighIns' };
  if (i.intakeDaysWeek1 < prm.biasMinIntakeDays || i.intakeDaysWeek2 < prm.biasMinIntakeDays) {
    return { mean: prev.mean, sd: prev.sd, updated: false, reason: 'fewIntakeDays' };
  }
  const t = i.points.map((p) => p.day);
  const v = i.points.map((p) => p.y - p.engineKg);
  const { slope, sxx } = olsSlope(t, v);
  if (!(sxx > 0)) return { mean: prev.mean, sd: prev.sd, updated: false, reason: 'fewWeighIns' };
  const value = slope * i.rhoKcalPerKg + i.deltaApplied;
  // floor: sigmaKg = 0 (trend weight 0) would make the measurement weight infinite and the mean NaN
  const se = Math.max(1e-6, (i.sigmaKg / Math.sqrt(sxx)) * i.rhoKcalPerKg);
  const priorSd = prm.biasPriorSdKcal + ((i.aiEnergyShare ?? 0) > prm.biasAiShare ? prm.biasAiSdBumpKcal : 0);
  const wp = 1 / priorSd ** 2;
  const wm = 1 / se ** 2;
  let mean = (prev.mean * wp + value * wm) / (wp + wm);
  const sd = Math.sqrt(1 / (wp + wm));
  let reason: EnergyBiasEstimate['reason'];
  if (Math.abs(mean - prev.mean) > prm.biasMaxStepKcal) {
    mean = prev.mean + Math.sign(mean - prev.mean) * prm.biasMaxStepKcal;
    reason = 'clampedStep';
  }
  if (Math.abs(mean) > prm.biasClampKcal) {
    mean = Math.sign(mean) * prm.biasClampKcal;
    reason = 'clampedValue';
  }
  return { mean, sd, updated: true, ...(reason ? { reason } : {}), measurement: { value, se, n: i.points.length } };
}

/**
 * Energy density of the engine's own fat/lean mix over a window, kcal/kg of tissue, at the effective (intake-side)
 * densities ρ + η (Hall convention: storing or mobilising 1 kg of fat balances ρF + ηF of intake). When the window's tissue
 * change is too small to define a mix (< 0.2 kg), Forbes' partition at the current fat mass is used.
 */
export function mixDensity(dFatKg: number, dLeanKg: number, fatMassKg: number, eff: { fat: number; lean: number } = { fat: 9441 + 179, lean: 1816 + 229 }): number {
  const dT = dFatKg + dLeanKg;
  let rho: number;
  if (Math.abs(dT) >= 0.2 && Math.sign(dFatKg) !== -Math.sign(dLeanKg)) {
    rho = (eff.fat * dFatKg + eff.lean * dLeanKg) / dT;
  } else {
    const leanShare = 10.4 / (10.4 + Math.max(1, fatMassKg));
    rho = (1 - leanShare) * eff.fat + leanShare * eff.lean;
  }
  return Math.min(eff.fat, Math.max(3000, rho));
}
