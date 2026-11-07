/**
 * Held-out forecast scores for the assimilation tests (D5-08 calibration fixture). Point forecasts report bias and MAE;
 * a Gaussian predictive distribution also reports the mean negative log predictive density and the central-interval score
 * (Gneiting & Raftery 2007), both proper, lower is better. A score on one synthetic block is a report beside simple
 * baselines, never a coverage claim and never a causal attribution. Empty input gives null (no NaN, C6).
 */

export interface PointForecast {
  /** Observed value (a held-out reading the forecaster never consumed). */
  y: number;
  /** Forecast mean. */
  mu: number;
}

export interface GaussianForecast extends PointForecast {
  /** Predictive SD of the reading (state and observation variance), > 0. */
  sd: number;
}

export interface PointScores {
  n: number;
  /** Mean of forecast − observed. */
  bias: number;
  mae: number;
}

export interface GaussianScores extends PointScores {
  /** Mean negative log predictive density. */
  nlpd: number;
  /** Mean central (1 − alpha) interval score. */
  intervalScore: number;
  /** Share of readings inside the central interval (reported, not a calibration claim). */
  coverage: number;
  alpha: number;
}

/** Standard-normal quantile of 0.9: the central 80 % interval used by the band tests. */
const Z90 = 1.2815515655446004;
export const CENTRAL_ALPHA = 0.2;

export function pointScores(items: readonly PointForecast[]): PointScores | null {
  if (items.length === 0) return null;
  let bias = 0;
  let mae = 0;
  for (const f of items) {
    bias += f.mu - f.y;
    mae += Math.abs(f.mu - f.y);
  }
  return { n: items.length, bias: bias / items.length, mae: mae / items.length };
}

export function gaussianScores(items: readonly GaussianForecast[]): GaussianScores | null {
  const p = pointScores(items);
  if (!p || items.some((f) => !(f.sd > 0) || !Number.isFinite(f.sd))) return null;
  let nlpd = 0;
  let is = 0;
  let hit = 0;
  for (const f of items) {
    const z = (f.y - f.mu) / f.sd;
    nlpd += 0.5 * Math.log(2 * Math.PI * f.sd * f.sd) + 0.5 * z * z;
    const lo = f.mu - Z90 * f.sd;
    const hi = f.mu + Z90 * f.sd;
    is += hi - lo + (2 / CENTRAL_ALPHA) * Math.max(0, lo - f.y) + (2 / CENTRAL_ALPHA) * Math.max(0, f.y - hi);
    if (f.y >= lo && f.y <= hi) hit++;
  }
  const n = items.length;
  return { ...p, nlpd: nlpd / n, intervalScore: is / n, coverage: hit / n, alpha: CENTRAL_ALPHA };
}
