/**
 * Goal compatibility from already-evaluated samples (dossier 18 §4.13) — zero extra simulations.
 *
 *   A_i  = max_h d̃_i(h)
 *   κ_ij = 1 − max{ d̃_j(h) : d̃_i(h) ≥ A_i − ε } / A_j,  ε = 0.05, clipped to [0,1]
 *   ρ_ij = Spearman(d̃_i, d̃_j) over the top 25 % of feasible samples by U
 *   class: synergy (κ < 0.10 ∧ ρ ≥ 0.30) | compatible (κ < 0.10) | trade-off (κ < 0.50) | conflict
 * plus the payoff table (goal vector at each single-goal anchor, Miettinen [25]), priority costs,
 * user-facing messages and a knee-point helper for ε-constraint trade-off curves (Branke et al. [28]).
 */
import { spearman } from './stats';

export type PairClass = 'synergy' | 'compatible' | 'tradeOff' | 'conflict' | 'undetermined';

export interface ConflictOptions {
  epsilon?: number;
  topShare?: number;
  synergyRho?: number;
  compatibleKappa?: number;
  conflictKappa?: number;
}

export const CONFLICT_DEFAULTS: Required<ConflictOptions> = {
  epsilon: 0.05,
  topShare: 0.25,
  synergyRho: 0.3,
  compatibleKappa: 0.1,
  conflictKappa: 0.5,
};

export interface ConflictMatrix {
  K: number;
  samples: number;
  /** A_i: best d̃_i among the samples. */
  best: Float64Array;
  /** κ_ij row-major (K×K), NaN on the diagonal or when undefined (A_j ≤ 0). */
  kappa: Float64Array;
  /** ρ_ij row-major (symmetric), NaN when undefined. */
  rho: Float64Array;
  /** Class of each ordered pair (i, j), row-major. */
  cls: PairClass[];
  /** payoff[i·K + j] = d̃_j at the sample maximising d̃_i (ties → higher U). */
  payoff: Float64Array;
  epsilon: number;
}

/**
 * @param d  desirabilities d̃ of the safety-feasible samples, row-major (n × K)
 * @param utility final utility U per sample (selects the top share for ρ)
 */
export function conflictMatrix(
  d: ArrayLike<number>,
  K: number,
  utility: ArrayLike<number>,
  options: ConflictOptions = {},
): ConflictMatrix {
  const o = { ...CONFLICT_DEFAULTS, ...options };
  const n = Math.floor(d.length / K);
  const best = new Float64Array(K).fill(-Infinity);
  const argBest = new Int32Array(K).fill(-1);
  for (let h = 0; h < n; h++) {
    for (let i = 0; i < K; i++) {
      const v = d[h * K + i]!;
      const cur = argBest[i]!;
      if (v > best[i]! || (v === best[i]! && cur >= 0 && utility[h]! > utility[cur]!)) {
        best[i] = v;
        argBest[i] = h;
      }
    }
  }
  const kappa = new Float64Array(K * K).fill(NaN);
  const payoff = new Float64Array(K * K).fill(NaN);
  for (let i = 0; i < K; i++) {
    const hb = argBest[i]!;
    if (hb >= 0) for (let j = 0; j < K; j++) payoff[i * K + j] = d[hb * K + j]!;
    const maxJ = new Float64Array(K).fill(-Infinity);
    for (let h = 0; h < n; h++) {
      if (d[h * K + i]! < best[i]! - o.epsilon) continue;
      for (let j = 0; j < K; j++) maxJ[j] = Math.max(maxJ[j]!, d[h * K + j]!);
    }
    for (let j = 0; j < K; j++) {
      if (j === i || !(best[j]! > 0) || n === 0) continue;
      kappa[i * K + j] = Math.min(1, Math.max(0, 1 - maxJ[j]! / best[j]!));
    }
  }
  // Spearman over the top share of samples by U
  const order = Array.from({ length: n }, (_, h) => h).sort((a, b) => utility[b]! - utility[a]! || a - b);
  const top = order.slice(0, Math.max(3, Math.ceil(o.topShare * n)));
  const cols: Float64Array[] = [];
  for (let i = 0; i < K; i++) cols.push(Float64Array.from(top, (h) => d[h * K + i]!));
  const rho = new Float64Array(K * K).fill(NaN);
  for (let i = 0; i < K; i++)
    for (let j = i + 1; j < K; j++) {
      const r = top.length >= 3 ? spearman(cols[i]!, cols[j]!) : NaN;
      rho[i * K + j] = r;
      rho[j * K + i] = r;
    }
  const cls: PairClass[] = [];
  for (let i = 0; i < K; i++)
    for (let j = 0; j < K; j++) {
      const k = kappa[i * K + j]!;
      const r = rho[i * K + j]!;
      if (i === j || Number.isNaN(k)) cls.push('undetermined');
      else if (k < o.compatibleKappa) cls.push(r >= o.synergyRho ? 'synergy' : 'compatible');
      else if (k < o.conflictKappa) cls.push('tradeOff');
      else cls.push('conflict');
    }
  return { K, samples: n, best, kappa, rho, cls, payoff, epsilon: o.epsilon };
}

/** Priority cost PC_j = 1 − P_j(x_A) (§4.13), with P as a fraction. */
export function priorityCosts(percentOfPossibleAtA: ArrayLike<number>): Float64Array {
  return Float64Array.from(percentOfPossibleAtA as ArrayLike<number>, (p) => 1 - p);
}

export interface GoalRelationMessage {
  kind: 'conflict' | 'tradeOff' | 'synergy';
  /** Higher-priority goal index (0-based). */
  higher: number;
  /** Lower-priority goal index (0-based). */
  lower: number;
  kappa: number;
  /** 1 − κ: the largest share of the lower goal's potential compatible with the higher goal near its best. */
  retainedShare: number;
  /** P_lower at option A (fraction), if supplied. */
  obtainedShare: number | null;
  epsilon: number;
}

/**
 * One message per pair i < j (i has priority): conflict / trade-off from κ_ij (the lower goal's loss when
 * the higher goal is held near its best), synergy when both directions are synergistic.
 */
export function relationMessages(m: ConflictMatrix, obtainedAtA?: ArrayLike<number>): GoalRelationMessage[] {
  const out: GoalRelationMessage[] = [];
  const { K } = m;
  for (let i = 0; i < K; i++)
    for (let j = i + 1; j < K; j++) {
      const c = m.cls[i * K + j]!;
      const k = m.kappa[i * K + j]!;
      const obtained = obtainedAtA ? obtainedAtA[j]! : null;
      if (c === 'conflict' || c === 'tradeOff')
        out.push({
          kind: c,
          higher: i,
          lower: j,
          kappa: k,
          retainedShare: 1 - k,
          obtainedShare: obtained,
          epsilon: m.epsilon,
        });
      else if (c === 'synergy' && m.cls[j * K + i] === 'synergy')
        out.push({
          kind: 'synergy',
          higher: i,
          lower: j,
          kappa: k,
          retainedShare: 1 - k,
          obtainedShare: obtained,
          epsilon: m.epsilon,
        });
    }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Deterministic English template (§4.13 / §4.17); labels are the goals' display names in priority order. */
export function formatRelationMessage(msg: GoalRelationMessage, labels: readonly string[]): string {
  const hi = `goal ${msg.higher + 1} (${labels[msg.higher] ?? '?'})`;
  const lo = `Goal ${msg.lower + 1} (${labels[msg.lower] ?? '?'})`;
  if (msg.kind === 'synergy')
    return `Goals ${msg.higher + 1} and ${msg.lower + 1} work together here: plans that are better for ${labels[msg.higher] ?? '?'} are also better for ${labels[msg.lower] ?? '?'}.`;
  const verb = msg.kind === 'conflict' ? 'conflicts with' : 'trades off against';
  let s = `${lo} ${verb} ${hi}: keeping goal ${msg.higher + 1} within ${pct(msg.epsilon)} of its best leaves at most ${pct(msg.retainedShare)} of goal ${msg.lower + 1}'s potential.`;
  if (msg.obtainedShare !== null && Number.isFinite(msg.obtainedShare))
    s += ` At your priority order you get ${pct(msg.obtainedShare)}.`;
  return s;
}

/** "If you ranked goal i first it would reach 100 % and goal j would reach X %" (payoff table, §4.13). */
export function formatPayoff(m: ConflictMatrix, i: number, j: number, labels: readonly string[]): string {
  const v = m.payoff[i * m.K + j]!;
  return `If you ranked goal ${i + 1} (${labels[i] ?? '?'}) first it would reach ${pct(Math.min(1, m.payoff[i * m.K + i]!))} and goal ${j + 1} (${labels[j] ?? '?'}) would reach ${pct(Math.max(0, v))}.`;
}

/** Knee of a 2-D trade-off curve: the point farthest from the line through the extremes (by x). */
export function kneePoint(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 3) return points.length ? 0 : -1;
  let lo = 0;
  let hi = 0;
  points.forEach((p, i) => {
    if (p.x < points[lo]!.x) lo = i;
    if (p.x > points[hi]!.x) hi = i;
  });
  const a = points[lo]!;
  const b = points[hi]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let best = lo;
  let bestD = -1;
  points.forEach((p, i) => {
    const dist = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
    if (dist > bestD) {
      bestD = dist;
      best = i;
    }
  });
  return best;
}
