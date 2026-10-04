/**
 * Robust re-ranking of finalists over a fixed parameter ensemble (dossier 18 §4.15).
 *
 * Common random numbers: every finalist is evaluated on the *same* M draws (Latin hypercube in quantile
 * space, drawn once per request seed — see `latinHypercube` in rng.ts). Per goal: mean, P10/P50/P90,
 * P(target met); chance constraints: every state-space margin must hold at P90 (i.e. its P10 margin
 * ≥ 0); ranking by ensemble-mean desirability (default) or CVaR_0.2 ("cautious"). The headline
 * projection is the ensemble P50 with the P10-P90 band (optimizer's curse, [38]).
 */
import type { Key } from './cmaes';
import { argsortKeys } from './cmaes';
import type { GoalSystem } from './goals';
import { cvarLower, mean, quantileSorted, sortedCopy } from './stats';
import type { EvalOutput, MaybePromise } from './types';

export type RobustMode = 'mean' | 'cvar';

export interface RobustOptions {
  mode?: RobustMode;
  cvarAlpha?: number;
  /** Lower / upper quantiles of the reported band (default 0.1 / 0.9). */
  lowerQ?: number;
  upperQ?: number;
}

export interface Band {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface GoalRobustness extends Band {
  /** Band of the objective in metric units (p10 ≤ p90 in metric order). */
  metric: Band;
  /** Ensemble-mean and CVaR desirability. */
  dMean: number;
  dCvar: number;
  /** Share of draws meeting the target (NaN without target). */
  pTargetMet: number;
}

export interface FinalistRobustness {
  draws: number;
  goals: GoalRobustness[];
  /** Per-constraint margin band (≥ 0 satisfied). */
  margins: Band[];
  /** All margins hold at P90 (lower-quantile margin ≥ 0). */
  chanceFeasible: boolean;
  /** Σ max(0, −P10 margin). */
  chanceViolation: number;
  /** Suggested internal tightening per constraint: P50 − P10 margin gap (≥ 0), §4.15 policy 2. */
  tightening: Float64Array;
  /** Desirability used for ranking (mean or CVaR per mode). */
  robustD: Float64Array;
  robustUtility: number;
  /** d̃ per draw, row-major (M × K), for decision-stability comparisons. */
  dPerDraw: Float64Array;
}

function band(values: ArrayLike<number>, lo: number, hi: number): Band {
  const s = sortedCopy(values);
  return {
    mean: mean(s),
    p10: quantileSorted(s, lo),
    p50: quantileSorted(s, 0.5),
    p90: quantileSorted(s, hi),
  };
}

/**
 * Evaluate every finalist on draws 0..M−1 in one batch (finalist-major order) through the caller's
 * `evaluateWithDraw`, which must return outputs in request order.
 */
export async function evaluateEnsemble<C>(
  finalists: readonly C[],
  draws: number,
  evaluateWithDraw: (
    batch: ReadonlyArray<{ candidate: C; draw: number }>,
  ) => MaybePromise<readonly EvalOutput[]>,
): Promise<EvalOutput[][]> {
  const batch: { candidate: C; draw: number }[] = [];
  for (const c of finalists) for (let m = 0; m < draws; m++) batch.push({ candidate: c, draw: m });
  const outs = await evaluateWithDraw(batch);
  if (outs.length !== batch.length)
    throw new Error(`evaluateEnsemble: expected ${batch.length} outputs, got ${outs.length}`);
  return finalists.map((_, i) => outs.slice(i * draws, (i + 1) * draws));
}

/** Robust statistics of one finalist from its M ensemble outputs (scales from the nominal run). */
export function robustSummary(
  outputs: readonly EvalOutput[],
  goals: GoalSystem,
  opts: RobustOptions = {},
): FinalistRobustness {
  const M = outputs.length;
  const K = goals.K;
  const lo = opts.lowerQ ?? 0.1;
  const hi = opts.upperQ ?? 0.9;
  const mode = opts.mode ?? 'mean';
  const fs = new Float64Array(M * K);
  const dPerDraw = new Float64Array(M * K);
  const f = new Float64Array(K);
  let regSum = 0;
  outputs.forEach((o, m) => {
    goals.objective(o.goals, f);
    fs.set(f, m * K);
    dPerDraw.set(goals.desirability(f), m * K);
    regSum += o.regulariser;
  });
  const goalStats: GoalRobustness[] = [];
  const robustD = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const col = new Float64Array(M);
    const dcol = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      col[m] = fs[m * K + k]!;
      dcol[m] = Math.min(1, dPerDraw[m * K + k]!);
    }
    const b = band(col, lo, hi);
    const { theta } = goals.scale(k);
    let met = 0;
    if (theta !== null) for (let m = 0; m < M; m++) if (col[m]! >= theta) met++;
    const mb = band(
      Float64Array.from(col, (v) => goals.toMetric(k, v)),
      lo,
      hi,
    );
    const dMean = mean(dcol);
    const dCvar = cvarLower(dcol, opts.cvarAlpha ?? 0.2);
    robustD[k] = mode === 'cvar' ? dCvar : dMean;
    goalStats.push({ ...b, metric: mb, dMean, dCvar, pTargetMet: theta === null ? NaN : met / M });
  }
  const C = outputs[0]?.margins.length ?? 0;
  const margins: Band[] = [];
  const tightening = new Float64Array(C);
  let chanceViolation = 0;
  for (let c = 0; c < C; c++) {
    const col = Float64Array.from(outputs, (o) => o.margins[c]!);
    const b = band(col, lo, hi);
    margins.push(b);
    chanceViolation += Math.max(0, -b.p10);
    tightening[c] = Math.max(0, b.p50 - b.p10);
  }
  const reg = M ? regSum / M : 0;
  return {
    draws: M,
    goals: goalStats,
    margins,
    chanceFeasible: chanceViolation === 0,
    chanceViolation,
    tightening,
    robustD,
    robustUtility: goals.utilityD(robustD, reg),
    dPerDraw,
  };
}

/** Robust comparator: (chance violation, floor violation on robust d̃, −robust U). */
export function robustKey(r: FinalistRobustness, goals: GoalSystem, relaxed = false): Key {
  return [r.chanceViolation, goals.floorViolationD(r.robustD, goals.K, relaxed), -r.robustUtility];
}

/** Indices of `summaries` ordered best-first under `robustKey`. */
export function robustRerank(
  summaries: readonly FinalistRobustness[],
  goals: GoalSystem,
  relaxed = false,
): number[] {
  return argsortKeys(summaries.map((s) => robustKey(s, goals, relaxed)));
}

/** Share of ensemble members in which `a` beats `b` on goal `k` (ties count ½), §4.15 decision sensitivity. */
export function decisionStability(a: FinalistRobustness, b: FinalistRobustness, k = 0): number {
  const M = Math.min(a.draws, b.draws);
  if (M === 0) return NaN;
  const K = a.robustD.length;
  let wins = 0;
  for (let m = 0; m < M; m++) {
    const da = a.dPerDraw[m * K + k]!;
    const db = b.dPerDraw[m * K + k]!;
    wins += da > db ? 1 : da === db ? 0.5 : 0;
  }
  return wins / M;
}

/** Below this share the options are "practically tied on your top priority" (§4.15). */
export const PRACTICALLY_TIED = 0.7;
