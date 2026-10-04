/**
 * Synthetic suites T1-T5 with known optima (benchmark harness, planner v2 specification "Suites"):
 *
 * - T1 continuous: shifted sphere, ellipsoid (condition 10⁴), Rosenbrock and Rastrigin (z = 10.24 (x − c), so the box
 *   spans ten basins per axis) at n = 10 / 20 / 40; one goal (minimise f), optimum f = 0 at x = c.
 * - T2 planted lexicographic: K = 2-4 goals over a mixed space of 4 or 8 structures × 8 genes (two integer genes with
 *   five levels). Goal 1 is a shifted ellipsoid in four genes with a plateau of optima (four free genes anywhere in
 *   [0.2, 0.8]); only one structure reaches it, the others are decoys whose best goal 1 lies 7-20 % of the range below
 *   (outside the goal-1 floor) but who score better on goal 2. Goal 2 is defined on the plateau (two genes) and is
 *   limited by two linear constraints that are both active at the optimum; goals 3 and 4 pin the last two plateau genes.
 *   The lexicographic optimum is analytic.
 * - T3 needle in structure: 50-400 structures; the optimum sits in one structure whose basin is narrow and far from
 *   the default genome (random probes score poorly), while decoys have wide basins with good probes and worse optima.
 * - T4 ladder frontier: attainment g vs difficulty D = gene 0 with a convex (g = √D), concave (g = D²) and disconnected
 *   (ZDT3-shaped, normalised) front; the other genes only lose attainment away from their optimum. Analytic front and
 *   ladder (Hard, Medium, Easy by the plan-ladder rules).
 * - T5 noisy: T2 with parameter draws: constraint 1 shifts by θ₁ ~ U(−0.05, 0.05) and goal 2's curvature scales by
 *   1 + 0.3 θ₂, θ₂ ~ U(−1, 1). The 90 % chance rule moves the optimum to the tightened vertex (analytic); returned plans
 *   are scored on 10⁴ draws (exact expectation, CVaR, chance of holding the constraints).
 *
 * Draw −1 is the nominal parameter set; draws 0..M−1 are the selection ensemble (Latin hypercube from the run seed)
 * and HOLDOUT_DRAW_OFFSET + m the holdout ensemble; every other draw index maps to a hashed uniform. The same seed gives
 * both algorithms the same draws (common random numbers).
 */
import { Rng, hashInts, hashString, latinHypercube } from '../../optim/rng';
import type { EvalOutput, EvalRequest, Evaluator, PlanStructure } from '../../optim/types';
import type { GoalSpec } from '../../optim/goals';
import type { PlannerProblem } from '../../optim/pipeline';
import { HOLDOUT_DRAW_OFFSET, type LadderSpec } from '../algorithms';
import { desirability, goalScore, nondominated, unitGower, type GoalRef } from '../metrics';
import type { ProblemSpec, ReferenceSummary, Split } from '../types';

export interface ToyOut {
  goals: number[];
  margins: number[];
  descriptors: number[];
  features?: number[];
}

export type ToyFn = (s: number, z: Float64Array, draw: number) => ToyOut;

export interface ToyProblem {
  problem: PlannerProblem<PlanStructure> & { ladder?: LadderSpec };
  goals: GoalRef[];
  reference: ReferenceSummary;
  fn: ToyFn;
  /** Draw-aware function for a run seed (noisy suite), else `fn`. */
  fnFor(seed: number, M: number, H: number): ToyFn;
  hasD: boolean;
  ensemble: boolean;
  /** Exact assessment of a returned plan (noisy suite). */
  exact?: (s: number, x: Float64Array) => { meanRaw: number[]; cvarD: number[]; pFeasible: number };
  gower(a: readonly number[], b: readonly number[]): number;
}

export function toyEvaluator(fn: ToyFn): Evaluator {
  return {
    evaluate: (batch: readonly EvalRequest[]) =>
      batch.map((r): EvalOutput => {
        const o = fn(r.structure, r.x, r.draw);
        return {
          goals: Float64Array.from(o.goals),
          margins: Float64Array.from(o.margins),
          regulariser: 0,
          descriptors: Float64Array.from(o.descriptors),
          ...(o.features ? { features: Float64Array.from(o.features) } : {}),
        };
      }),
  };
}

const ROC_DELTA = [0.05, 0.1, 0.15, 0.15];

function refOf(goals: GoalRef[], dStar: number[], source: string, extra: Partial<ReferenceSummary> = {}): ReferenceSummary {
  return { goals, dStar, gStar: goalScore(goals, dStar), exact: true, source, ...extra };
}

// ---------------------------------------------------------------------------------------------------------------
// T1 continuous
// ---------------------------------------------------------------------------------------------------------------

export const T1_FUNCTIONS = ['sphere', 'ellipsoid', 'rosenbrock', 'rastrigin'] as const;
export type T1Fn = (typeof T1_FUNCTIONS)[number];

function t1f(name: T1Fn, c: Float64Array): (x: Float64Array) => number {
  const n = c.length;
  switch (name) {
    case 'sphere':
      return (x) => {
        let s = 0;
        for (let i = 0; i < n; i++) s += (x[i]! - c[i]!) ** 2;
        return s;
      };
    case 'ellipsoid':
      return (x) => {
        let s = 0;
        for (let i = 0; i < n; i++) s += 1e4 ** (n > 1 ? i / (n - 1) : 0) * (x[i]! - c[i]!) ** 2;
        return s;
      };
    case 'rosenbrock':
      return (x) => {
        let s = 0;
        for (let i = 0; i < n - 1; i++) {
          const zi = 4 * (x[i]! - c[i]!) + 1;
          const zj = 4 * (x[i + 1]! - c[i + 1]!) + 1;
          s += 100 * (zj - zi * zi) ** 2 + (1 - zi) ** 2;
        }
        return s;
      };
    case 'rastrigin':
      return (x) => {
        let s = 10 * n;
        for (let i = 0; i < n; i++) {
          const z = 10.24 * (x[i]! - c[i]!);
          s += z * z - 10 * Math.cos(2 * Math.PI * z);
        }
        return s;
      };
  }
}

export function buildT1(spec: ProblemSpec): ToyProblem {
  const name = spec.params['fn'] as T1Fn;
  const n = spec.params['n'] as number;
  const rng = new Rng(`bench/T1/${spec.split}/${name}/${n}`);
  const c = Float64Array.from({ length: n }, () => rng.uniform(0.25, 0.75));
  const f = t1f(name, c);
  const xb = new Float64Array(n).fill(0.02);
  const fb = f(xb);
  const fn: ToyFn = (_s, z) => ({ goals: [f(z)], margins: [], descriptors: [z[0]!, z[1] ?? 0.5] });
  const goals: GoalRef[] = [{ id: 'f', sense: 'min', b: -fb, u: 0, delta: ROC_DELTA[0]!, unit: 'f', active: true }];
  return {
    problem: { structures: [{ id: name, dim: n }], goals: [{ id: 'f', sense: 'min' }], baseline: { structure: 0, x: xb } },
    goals,
    reference: refOf(goals, [1], 'analytic optimum f = 0', { detail: { x: Array.from(c) } }),
    fn,
    fnFor: () => fn,
    hasD: false,
    ensemble: false,
    gower: unitGower,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// T2 planted lexicographic (and T5 noisy)
// ---------------------------------------------------------------------------------------------------------------

const T2_N = 8;
const T2_AW = [1, 10, 100, 1000];
const T2_BETA1 = 0.775;
const T2_BETA2 = 0.725;
const T2_T = [0.7, 0.6];
const T5_S1 = 0.05;
const T5_S2 = 0.3;

/** Vertex of z0 + ½ z1 = β1, ½ z0 + z1 = β2. */
function vertex(b1: number, b2: number): [number, number] {
  const z1 = (b2 - 0.5 * b1) / 0.75;
  return [b1 - 0.5 * z1, z1];
}

interface T2Data {
  K: number;
  nS: number;
  sStar: number;
  cW: Float64Array[];
  off: number[];
  bonus: number[];
  t: [number, number];
}

function t2Data(K: number, nS: number, label: string): T2Data {
  const rng = new Rng(label);
  const sStar = 1 + rng.int(nS - 1);
  const cW: Float64Array[] = [];
  for (let s = 0; s < nS; s++) {
    cW.push(Float64Array.from([rng.uniform(0.25, 0.75), rng.uniform(0.25, 0.75), [0.25, 0.5, 0.75][rng.int(3)]!, [0.25, 0.5, 0.75][rng.int(3)]!]));
  }
  const t: [number, number] = [rng.uniform(0.3, 0.7), rng.uniform(0.3, 0.7)];
  // core penalty of the baseline (structure 0 at z = 0.1)
  const zb = new Float64Array(T2_N).fill(0.1);
  const coreB = t2Core(cW[0]!, zb);
  const off = new Array<number>(nS).fill(0);
  off[0] = 0.15 * coreB;
  const absB1 = 1.15 * coreB;
  const bonus = new Array<number>(nS).fill(0);
  for (let s = 1; s < nS; s++) {
    if (s === sStar) continue;
    off[s] = absB1 * (0.07 + 0.13 * rng.float());
    bonus[s] = 0.05 + 0.25 * rng.float();
  }
  return { K, nS, sStar, cW, off, bonus, t };
}

function t2Core(cW: Float64Array, z: Float64Array): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    let v = z[4 + i]!;
    if (i >= 2) v = Math.round(v * 4) / 4; // integer genes, five levels
    s += T2_AW[i]! * (v - cW[i]!) ** 2;
  }
  for (let j = 0; j < 4; j++) s += 10 * Math.max(0, 0.2 - z[j]!, z[j]! - 0.8) ** 2;
  return s;
}

function t2Eval(d: T2Data, s: number, z: Float64Array, th1: number, th2: number): ToyOut {
  const g1 = -d.off[s]! - t2Core(d.cW[s]!, z);
  const g2 = d.bonus[s]! - (1 + T5_S2 * th2) * ((z[0]! - T2_T[0]!) ** 2 + (z[1]! - T2_T[1]!) ** 2);
  const goals = [g1, g2];
  if (d.K >= 3) goals.push(-((z[2]! - d.t[0]) ** 2));
  if (d.K >= 4) goals.push(-((z[3]! - d.t[1]) ** 2));
  return {
    goals,
    margins: [(T2_BETA1 - z[0]! - 0.5 * z[1]! - th1) / 0.5, (T2_BETA2 - 0.5 * z[0]! - z[1]!) / 0.5],
    descriptors: [z[2]!, z[3]!, s / Math.max(1, d.nS - 1)],
    features: [z[0]!, z[1]!, z[2]!, z[3]!, s / Math.max(1, d.nS - 1)],
  };
}

/** Uniform u ∈ [0, 1) per draw: selection LHS, holdout LHS, else hashed (same for every algorithm given the seed). */
function drawUniforms(seed: number, M: number, H: number, label: string): (draw: number) => [number, number] {
  const sel = M > 0 ? latinHypercube(M, 2, new Rng(`${label}/${seed}`).fork('selection')) : new Float64Array(0);
  const hold = H > 0 ? latinHypercube(H, 2, new Rng(`${label}/${seed}`).fork('holdout')) : new Float64Array(0);
  return (draw) => {
    if (draw >= 0 && draw < M) return [sel[2 * draw]!, sel[2 * draw + 1]!];
    const m = draw - HOLDOUT_DRAW_OFFSET;
    if (m >= 0 && m < H) return [hold[2 * m]!, hold[2 * m + 1]!];
    const h1 = hashInts([seed, draw, 1], hashString(label)) >>> 0;
    const h2 = hashInts([seed, draw, 2], hashString(label)) >>> 0;
    return [h1 / 4294967296, h2 / 4294967296];
  };
}

export function buildT2(spec: ProblemSpec, noisy = false): ToyProblem {
  const K = spec.params['K'] as number;
  const nS = spec.params['nS'] as number;
  const d = t2Data(K, nS, `bench/${spec.id}`);
  const zb = new Float64Array(T2_N).fill(0.1);
  const base = t2Eval(d, 0, zb, 0, 0);
  const maxBonus = Math.max(...d.bonus);
  const [v0, v1] = noisy ? vertex(T2_BETA1 - 0.8 * T5_S1, T2_BETA2) : vertex(T2_BETA1, T2_BETA2);
  const xStar = new Float64Array(T2_N);
  xStar.set([v0, v1, d.t[0], d.t[1]]);
  xStar.set(d.cW[d.sStar]!, 4);
  const goals: GoalRef[] = [
    { id: 'g1', sense: 'max', b: base.goals[0]!, u: 0, delta: ROC_DELTA[0]!, unit: 'units', active: true },
    { id: 'g2', sense: 'max', b: base.goals[1]!, u: maxBonus - ((vertex(T2_BETA1, T2_BETA2)[0] - T2_T[0]!) ** 2 + (vertex(T2_BETA1, T2_BETA2)[1] - T2_T[1]!) ** 2), delta: ROC_DELTA[1]!, unit: 'units', active: true },
  ];
  if (K >= 3) goals.push({ id: 'g3', sense: 'max', b: base.goals[2]!, u: 0, delta: ROC_DELTA[2]!, unit: 'units', active: true });
  if (K >= 4) goals.push({ id: 'g4', sense: 'max', b: base.goals[3]!, u: 0, delta: ROC_DELTA[3]!, unit: 'units', active: true });
  const star = t2Eval(d, d.sStar, xStar, 0, 0);
  const dStar = desirability(goals, star.goals);
  const specs: GoalSpec[] = goals.map((g, k) => (k === 0 ? { id: g.id, sense: 'max', target: 0 } : { id: g.id, sense: 'max' }));
  const structures: PlanStructure[] = Array.from({ length: nS }, (_, s) => ({ id: `s${s}`, dim: T2_N, discrete: [{ index: 6, levels: 5 }, { index: 7, levels: 5 }] }));
  const fn: ToyFn = (s, z) => t2Eval(d, s, z, 0, 0);
  const fnFor = (seed: number, M: number, H: number): ToyFn => {
    if (!noisy) return fn;
    const U = drawUniforms(seed, M, H, `bench/${spec.id}`);
    return (s, z, draw) => {
      if (draw < 0) return t2Eval(d, s, z, 0, 0);
      const [u1, u2] = U(draw);
      return t2Eval(d, s, z, T5_S1 * (2 * u1 - 1), 2 * u2 - 1);
    };
  };
  const exact = noisy
    ? (s: number, x: Float64Array) => {
        const G = 100;
        const sums = new Array<number>(K).fill(0);
        const ds: number[][] = goals.map(() => []);
        let feas = 0;
        for (let i = 0; i < G; i++)
          for (let j = 0; j < G; j++) {
            const o = t2Eval(d, s, x, T5_S1 * (2 * ((i + 0.5) / G) - 1), 2 * ((j + 0.5) / G) - 1);
            o.goals.forEach((v, k) => (sums[k] = sums[k]! + v));
            desirability(goals, o.goals).forEach((v, k) => ds[k]!.push(v));
            if (o.margins.every((m) => m >= 0)) feas++;
          }
        const cvarD = ds.map((v) => {
          v.sort((a, b) => a - b);
          const m = Math.max(1, Math.floor(0.2 * v.length));
          let s2 = 0;
          for (let i = 0; i < m; i++) s2 += v[i]!;
          return s2 / m;
        });
        return { meanRaw: sums.map((v) => v / (G * G)), cvarD, pFeasible: feas / (G * G) };
      }
    : undefined;
  return {
    problem: { structures, goals: specs, baseline: { structure: 0, x: zb } },
    goals,
    reference: refOf(goals, dStar, noisy ? 'analytic optimum under the 90 % chance rule' : 'analytic lexicographic optimum', {
      detail: { sStar: d.sStar, x: Array.from(xStar) },
    }),
    fn,
    fnFor,
    hasD: false,
    ensemble: noisy,
    ...(exact ? { exact } : {}),
    gower: unitGower,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// T3 needle in structure
// ---------------------------------------------------------------------------------------------------------------

const T3_N = 6;

export function buildT3(spec: ProblemSpec): ToyProblem {
  const nS = spec.params['nS'] as number;
  const beyondCap = spec.params['beyondCap'] === true;
  const rng = new Rng(`bench/${spec.id}`);
  const lo = beyondCap ? Math.min(60, nS - 1) : 1;
  const hi = beyondCap ? nS : Math.min(nS, 60);
  const sStar = lo + rng.int(Math.max(1, hi - lo));
  const O: number[] = [];
  const W: number[] = [];
  const c: Float64Array[] = [];
  for (let s = 0; s < nS; s++) {
    if (s === sStar) {
      O.push(1);
      W.push(8);
      c.push(Float64Array.from({ length: T3_N }, () => (rng.float() < 0.5 ? rng.uniform(0.1, 0.25) : rng.uniform(0.75, 0.9))));
    } else {
      O.push(s === 0 ? -0.5 : rng.uniform(0.55, 0.9));
      W.push(1);
      c.push(Float64Array.from({ length: T3_N }, () => rng.uniform(0.2, 0.8)));
    }
  }
  const fn: ToyFn = (s, z) => {
    let q = 0;
    for (let i = 0; i < T3_N; i++) q += (z[i]! - c[s]![i]!) ** 2;
    return { goals: [O[s]! - W[s]! * q], margins: [], descriptors: [z[0]!, z[1]!], features: [z[0]!, z[1]!, z[2]!, s / (nS - 1)] };
  };
  const goals: GoalRef[] = [{ id: 'f', sense: 'max', b: -0.5, u: 1, delta: ROC_DELTA[0]!, unit: 'units', active: true }];
  return {
    problem: {
      structures: Array.from({ length: nS }, (_, s) => ({ id: `s${String(s).padStart(3, '0')}`, dim: T3_N })),
      goals: [{ id: 'f', sense: 'max' }],
      baseline: { structure: 0, x: c[0]! },
    },
    goals,
    reference: refOf(goals, [1], 'planted optimum', { detail: { sStar, x: Array.from(c[sStar]!) } }),
    fn,
    fnFor: () => fn,
    hasD: false,
    ensemble: false,
    gower: unitGower,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// T4 ladder frontier
// ---------------------------------------------------------------------------------------------------------------

export const T4_SHAPES = ['convex', 'concave', 'disconnected'] as const;
export type T4Shape = (typeof T4_SHAPES)[number];
const ZDT3_MAX = (() => {
  let m = 0;
  for (let i = 0; i <= 100000; i++) {
    const D = i / 100000;
    m = Math.max(m, Math.sqrt(D) + D * Math.sin(10 * Math.PI * D));
  }
  return m;
})();

export function t4Front(shape: T4Shape, D: number): number {
  if (shape === 'convex') return Math.sqrt(D);
  if (shape === 'concave') return D * D;
  return Math.max(0, Math.sqrt(D) + D * Math.sin(10 * Math.PI * D)) / ZDT3_MAX;
}

/** Plan-ladder rung selection on a dense front (Hard, Medium by the knee or the 80 % rule, Easy; distinctness rules). */
export function ladderOnFront(front: ReadonlyArray<{ g: number; D: number }>, gMin: number): Array<[number, number]> {
  const pts = front.slice().sort((a, b) => a.D - b.D);
  let H = pts[0]!;
  for (const p of pts) if (p.g > H.g + 1e-12) H = p;
  const easyAt = (share: number) => pts.find((p) => p.g >= Math.max(share * H.g, gMin) - 1e-12) ?? H;
  const E = H.g < gMin ? H : easyAt(0.5);
  let M: { g: number; D: number } | null = null;
  if (H.D - E.D > 1e-9 && H.g - E.g > 1e-9) {
    let best = -Infinity;
    for (const p of pts) {
      if (!(p.D > E.D && p.D < H.D)) continue;
      const v = ((p.g - E.g) / (H.g - E.g) - (p.D - E.D) / (H.D - E.D)) / Math.SQRT2;
      if (v > best) {
        best = v;
        M = p;
      }
    }
    if (best < 0.05) M = easyAt(0.8);
  }
  const out: Array<[number, number]> = [[H.g, H.D]];
  if (H.D - E.D < 0.15) return out;
  if (M && H.D - M.D >= 0.15 && M.D - E.D >= 0.15) out.push([M.g, M.D]);
  out.push([E.g, E.D]);
  return out;
}

export function buildT4(spec: ProblemSpec): ToyProblem {
  const shape = spec.params['shape'] as T4Shape;
  const n = spec.params['n'] as number;
  const rng = new Rng(`bench/${spec.id}`);
  const c = Float64Array.from({ length: n - 1 }, () => rng.uniform(0.25, 0.75));
  const fn: ToyFn = (_s, z) => {
    const D = z[0]!;
    let q = 0;
    for (let i = 1; i < n; i++) q += (z[i]! - c[i - 1]!) ** 2;
    const g = t4Front(shape, D) - (4 * q) / (n - 1);
    return { goals: [g], margins: [], descriptors: [D, z[1]!], features: [D, z[1]!, z[2] ?? 0.5] };
  };
  const dense: Array<{ g: number; D: number }> = [];
  for (let i = 0; i <= 2000; i++) dense.push({ D: i / 2000, g: t4Front(shape, i / 2000) });
  const front = nondominated(dense);
  const goals: GoalRef[] = [{ id: 'attainment', sense: 'max', b: 0, u: 1, delta: ROC_DELTA[0]!, unit: 'units', active: true }];
  const xb = new Float64Array(n);
  xb.set(c, 1);
  const gMin = 0.1;
  return {
    problem: { structures: [{ id: shape, dim: n }], goals: [{ id: 'attainment', sense: 'max' }], baseline: { structure: 0, x: xb }, ladder: { gMinMetric: gMin } },
    goals,
    reference: refOf(goals, [1], 'analytic front', {
      front: front.map((p) => [p.g, p.D] as [number, number]),
      rungs: ladderOnFront(front, gMin),
    }),
    fn,
    fnFor: () => fn,
    hasD: true,
    ensemble: false,
    gower: unitGower,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// instance lists
// ---------------------------------------------------------------------------------------------------------------

export function toySpecs(suite: 'T1' | 'T2' | 'T3' | 'T4' | 'T5', split: Split): ProblemSpec[] {
  const out: ProblemSpec[] = [];
  const add = (id: string, params: Record<string, unknown>) => out.push({ suite, id: `${suite}/${split}/${id}`, split, params, real: false });
  if (suite === 'T1') for (const fn of T1_FUNCTIONS) for (const n of [10, 20, 40]) add(`${fn}-${n}`, { fn, n });
  if (suite === 'T2') for (const K of [2, 3, 4]) for (const nS of [4, 8]) add(`k${K}-s${nS}`, { K, nS });
  if (suite === 'T3') {
    for (const nS of [50, 100, 200, 400]) add(`s${nS}`, { nS });
    for (const nS of [200, 400]) add(`s${nS}-beyond-cap`, { nS, beyondCap: true });
  }
  if (suite === 'T4') for (const shape of T4_SHAPES) for (const n of [5, 10]) add(`${shape}-${n}`, { shape, n });
  if (suite === 'T5') for (const K of [2, 3]) for (const nS of [4, 8]) add(`k${K}-s${nS}`, { K, nS });
  return out;
}

export function buildToy(spec: ProblemSpec): ToyProblem {
  switch (spec.suite) {
    case 'T1':
      return buildT1(spec);
    case 'T2':
      return buildT2(spec, false);
    case 'T3':
      return buildT3(spec);
    case 'T4':
      return buildT4(spec);
    case 'T5':
      return buildT2(spec, true);
    default:
      throw new RangeError(`buildToy: ${spec.suite} is not a synthetic suite`);
  }
}
