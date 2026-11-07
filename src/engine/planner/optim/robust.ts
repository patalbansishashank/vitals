/**
 * Robust re-ranking of finalists over a fixed parameter ensemble (dossier 18 §4.15).
 *
 * Common random numbers: every finalist is evaluated on the *same* M draws (Latin hypercube in quantile
 * space, drawn once per request seed — see `latinHypercube` in rng.ts). Per goal: mean, P10/P50/P90,
 * share of draws meeting the target; ranking by ensemble-mean desirability (default) or CVaR_0.2 ("cautious").
 *
 * Chance acceptance (C5/D4-03): the exact joint model-scenario screen — member m passes when EVERY required margin is
 * ≥ 0 in that member, and the finalist passes with at least ⌈0.9·M⌉ joint passes; zero members or a missing required
 * margin is Unchecked. Per-column interpolated P10 margins are kept only as a diagnostic band and as the normalized
 * re-polish target (margins are already divided by declared positive same-unit scales); disjoint per-constraint
 * failures can never pass. LHS members are not independent Bernoulli trials: the pass share is a declared design
 * screen of the model's parameter-scenario distribution, not a probability of human safety.
 */
import { SAFETY_ALPHA, endpointAvailability, jointSafetyScreen, type EndpointAvailability, type JointScreenResult } from '@/lib/bodyContracts';
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
  /** Margin indices the joint screen requires (default: every margin). */
  requiredMargins?: readonly number[];
  /** Screen alpha (default `SAFETY_ALPHA` = 0.1: the existing declared design screen). */
  alpha?: number;
}

export interface Band {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface GoalRobustness extends Band {
  /** All required members must be available; incomplete bands and target shares are withheld. */
  availability: EndpointAvailability;
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
  /** Per-constraint margin band (≥ 0 satisfied); diagnostic only (acceptance is `joint`). */
  margins: Band[];
  /** Exact joint screen over the required margins (C5/D4-03). */
  joint: JointScreenResult;
  /** The joint screen passed (≥ ⌈0.9·M⌉ members with every required margin ≥ 0; never true with M = 0 or a missing margin). */
  chanceFeasible: boolean;
  /** Σ max(0, −P10 margin) over normalized margins: a re-polish target and tie-break, never the acceptance rule. */
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

/** Endpoint coverage retains every attempted member. No survivor-only renormalisation is allowed. */
export function goalAvailability(outputs: readonly EvalOutput[], goals: GoalSystem, k: number): EndpointAvailability {
  const baselineMissing = goals.status(k) === 'unavailable';
  const memberAvailable = outputs.map((o) => !baselineMissing && Number.isFinite(o.goals[k]!) &&
    !Array.from(o.missingGoals ?? []).includes(k));
  return endpointAvailability(memberAvailable, baselineMissing ? ['baselineUnavailable'] :
    outputs.length === 0 ? ['noMembers'] : memberAvailable.some((v) => !v) ? ['requiredGoalOutputUnavailable'] : []);
}

const UNAVAILABLE_BAND: Band = { mean: NaN, p10: NaN, p50: NaN, p90: NaN };

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
    goals.objective(o.goals, f, o.missingGoals);
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
    const availability = goalAvailability(outputs, goals, k);
    const complete = availability.status === 'complete';
    const b = complete ? band(col, lo, hi) : { ...UNAVAILABLE_BAND };
    const { theta } = goals.scale(k);
    let met = 0;
    if (theta !== null) for (let m = 0; m < M; m++) if (col[m]! >= theta) met++;
    const mb = complete ? band(
      Float64Array.from(col, (v) => goals.toMetric(k, v)),
      lo,
      hi,
    ) : { ...UNAVAILABLE_BAND };
    const dMean = M ? mean(dcol) : 0;
    const dCvar = M ? cvarLower(dcol, opts.cvarAlpha ?? 0.2) : 0;
    robustD[k] = mode === 'cvar' ? dCvar : dMean;
    goalStats.push({ ...b, availability, metric: mb, dMean, dCvar, pTargetMet: !complete || theta === null ? NaN : met / M });
  }
  const C = outputs[0]?.margins.length ?? 0;
  const joint = jointScreenOf(outputs, opts.requiredMargins ?? Array.from({ length: C }, (_, c) => c), opts.alpha);
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
    joint,
    chanceFeasible: joint.status === 'pass',
    chanceViolation,
    tightening,
    robustD,
    robustUtility: goals.utilityD(robustD, reg),
    dPerDraw,
  };
}

/**
 * Joint model-scenario screen of ensemble outputs (C5/D4-03): member m → { margin index: value | null }, a margin listed
 * in `EvalOutput.missing` (or non-finite) is null (missing ⇒ Unchecked, never a pass).
 */
export function jointScreenOf(outputs: readonly EvalOutput[], required: readonly number[], alpha: number = SAFETY_ALPHA, opts: { knownViolation?: boolean } = {}): JointScreenResult {
  const members = outputs.map((o) => {
    const miss = new Set(o.missing ? Array.from(o.missing) : []);
    const rec: Record<string, number | null> = {};
    for (const c of required) {
      const v = o.margins[c];
      rec[String(c)] = miss.has(c) || v === undefined || !Number.isFinite(v) ? null : v;
    }
    return rec;
  });
  return jointSafetyScreen(members, required.map(String), { alpha, ...(opts.knownViolation ? { knownViolation: true } : {}) });
}

/**
 * Joint-screen shortfall for ranking: 0 = passed; else the members still needed (≥ 1); an Unchecked screen (no members,
 * missing margin) ranks below every checked one.
 */
export function jointShortfall(r: FinalistRobustness | null | undefined): number {
  if (!r) return 0;
  const j = r.joint;
  if (j.status === 'pass') return 0;
  if (j.status === 'unchecked') return j.M + 1;
  return Math.max(1, (j.required ?? j.M) - j.passes);
}

/** Robust comparator: (joint-screen shortfall, normalized P10 shortfall, floor violation on robust d̃, −robust U). */
export function robustKey(r: FinalistRobustness, goals: GoalSystem, relaxed = false): Key {
  return [jointShortfall(r), r.chanceViolation, goals.floorViolationD(r.robustD, goals.K, relaxed), -r.robustUtility];
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
