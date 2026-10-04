/**
 * Toy objective functions and toy "engines" used to prove the optimisation core (dossier 18 §7.2).
 * Pure, deterministic, no physiology. Exported so the integrating agent can reuse them in its own
 * regression tests (e.g. to compare against the real decoder's price of structure).
 */
import type { GoalSpec } from './goals';
import type { PlannerProblem } from './pipeline';
import { Rng, latinHypercube } from './rng';
import type { PlanModel, PlanStructure } from './types';
import { HOLDOUT_DRAW_OFFSET, isHoldoutDraw } from './types';

/** Shifted sphere Σ (x − c)². */
export function sphere(c: ArrayLike<number>) {
  return (x: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += (x[i]! - c[i]!) ** 2;
    return s;
  };
}

/** Axis-parallel ellipsoid Σ cond^{i/(n−1)} (x − c)². */
export function ellipsoid(c: ArrayLike<number>, cond = 1e3) {
  return (x: Float64Array): number => {
    const n = x.length;
    let s = 0;
    for (let i = 0; i < n; i++) s += cond ** (n > 1 ? i / (n - 1) : 0) * (x[i]! - c[i]!) ** 2;
    return s;
  };
}

/** Rosenbrock on z = scale·x + offset (optimum at z = 1). */
export function rosenbrock(scale = 4, offset = -1) {
  return (x: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < x.length - 1; i++) {
      const zi = scale * x[i]! + offset;
      const zj = scale * x[i + 1]! + offset;
      s += 100 * (zj - zi * zi) ** 2 + (1 - zi) ** 2;
    }
    return s;
  };
}

/** Shifted Rastrigin 10n + Σ (z² − 10 cos 2πz), z = x − c. Global optimum 0 at x = c. */
export function rastrigin(c: ArrayLike<number>) {
  return (x: Float64Array): number => {
    let s = 10 * x.length;
    for (let i = 0; i < x.length; i++) {
      const z = x[i]! - c[i]!;
      s += z * z - 10 * Math.cos(2 * Math.PI * z);
    }
    return s;
  };
}

/** Deterministic, irregular shift vector inside [lo, hi]. */
export function shiftVector(n: number, lo: number, hi: number): Float64Array {
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = lo + (hi - lo) * ((((i + 1) * 0.618033988749895) % 1) * 0.8 + 0.1);
  return c;
}

/** Rotated ellipsoid Σ cond^{i/(n−1)} (R(x − c))_i² with a fixed random orthogonal R (Gram-Schmidt of normals). */
export function rotatedEllipsoid(c: ArrayLike<number>, normals: () => number, cond = 1e3) {
  const n = c.length;
  const R = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) R[i] = normals();
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < i; k++) {
      let d = 0;
      for (let j = 0; j < n; j++) d += R[i * n + j]! * R[k * n + j]!;
      for (let j = 0; j < n; j++) R[i * n + j] = R[i * n + j]! - d * R[k * n + j]!;
    }
    let norm = 0;
    for (let j = 0; j < n; j++) norm += R[i * n + j]! ** 2;
    norm = Math.sqrt(norm);
    for (let j = 0; j < n; j++) R[i * n + j] = R[i * n + j]! / norm;
  }
  return (x: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < n; j++) z += R[i * n + j]! * (x[j]! - c[j]!);
      s += cond ** (n > 1 ? i / (n - 1) : 0) * z * z;
    }
    return s;
  };
}

// ---------------------------------------------------------------------------------------------
// Toy planning problems (structures + PlanModel) for pipeline tests (§7.2-7.3, §7.6)
// ---------------------------------------------------------------------------------------------

export interface ToyStructure extends PlanStructure {
  /** Discrete attributes of the toy skeleton (e.g. block, duration, pattern). */
  readonly tags: readonly number[];
}

export interface ToyOutput {
  goals: number[];
  margins?: number[];
  descriptors: number[];
  reg?: number;
  features?: number[];
}

export interface ToySchedule {
  structure: ToyStructure;
  index: number;
  x: Float64Array;
}

export interface ToyPlanner {
  problem: PlannerProblem<ToyStructure>;
  model: PlanModel<ToyStructure, ToySchedule, ToyOutput>;
  /** Direct evaluation (nominal draw −1). */
  evaluate(structure: number, x: ArrayLike<number>, draw?: number): ToyOutput;
}

/** Wrap a pure function (structure, genome, draw) → outputs as a problem + evaluation model. */
export function functionToy(
  structures: readonly ToyStructure[],
  goals: readonly GoalSpec[],
  baseline: { structure: number; x: ArrayLike<number> },
  fn: (s: ToyStructure, index: number, x: Float64Array, draw: number) => ToyOutput,
  extra: Partial<PlannerProblem<ToyStructure>> = {},
): ToyPlanner {
  const index = new Map(structures.map((s, i) => [s, i]));
  const model: PlanModel<ToyStructure, ToySchedule, ToyOutput> = {
    decode: (s, x) => ({ structure: s, index: index.get(s)!, x: Float64Array.from(x) }),
    repair: (_s, schedule) => ({ schedule, log: [] }),
    simulate: (sch, draw) => fn(sch.structure, sch.index, sch.x, draw),
    goals: (sim) => sim.goals,
    constraints: (sim) => sim.margins ?? [],
    descriptors: (_sch, sim) => sim.descriptors,
    regulariser: (_sch, sim) => sim.reg ?? 0,
    features: (_sch, sim) => sim.features ?? sim.descriptors,
  };
  return {
    problem: { structures, goals, baseline, ...extra },
    model,
    evaluate: (i, x, draw = -1) => fn(structures[i]!, i, Float64Array.from(x), draw),
  };
}

/** §7.2.3 two-goal analytic front d₂ = 1 − d₁⁴: f₁ = x₀, f₂ = (1 − x₀⁴)·x₁, baseline (0, 0). */
export function twoGoalFrontToy(): ToyPlanner {
  return functionToy(
    [{ id: 'front', dim: 2, tags: [] }],
    [
      { id: 'g1', sense: 'max' },
      { id: 'g2', sense: 'max' },
    ],
    { structure: 0, x: [0, 0] },
    (_s, _i, x) => ({ goals: [x[0]!, (1 - x[0]! ** 4) * x[1]!], descriptors: [x[0]!, x[1]!] }),
  );
}

/**
 * §7.6.2 conflict toy over x ∈ [0,1]³: g1 = x₀ and g2 = 1 − x₀ conflict; g3 = x₁ and g4 = x₂ are
 * independent of everything; g5 = x₁ is synergistic with g3.
 */
export function conflictToy(): ToyPlanner {
  return functionToy(
    [{ id: 'c', dim: 3, tags: [] }],
    ['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => ({ id, sense: 'max' as const })),
    { structure: 0, x: [0.5, 0, 0] },
    (_s, _i, x) => ({ goals: [x[0]!, 1 - x[0]!, x[1]!, x[2]!, x[1]!], descriptors: [x[0]!, x[1]!, x[2]!] }),
  );
}

/**
 * §7.2.6 micro-library: 3 blocks × 2 durations × 2 weekly patterns (12 structures) × 2 continuous
 * parameters (u, v). Goals: 1. max "lean retention", 2. max "fat loss"; one safety margin.
 */
export function microLibraryToy(): ToyPlanner {
  const structures: ToyStructure[] = [];
  for (let b = 0; b < 3; b++)
    for (let d = 0; d < 2; d++)
      for (let p = 0; p < 2; p++) structures.push({ id: `b${b}d${d}p${p}`, dim: 2, tags: [b, d, p] });
  const e = [0.8, 1.0, 1.2];
  const c = [1.0, 0.8, 0.6];
  return functionToy(
    structures,
    [
      { id: 'lean', sense: 'max' },
      { id: 'fatLoss', sense: 'max' },
    ],
    { structure: 0, x: [0, 0] },
    (s, _i, x) => {
      const [b, d, p] = s.tags as [number, number, number];
      const u = x[0]!;
      const v = x[1]!;
      return {
        goals: [5 * (v * c[b]! + 0.1 * p - 0.3 * u * d), 10 * (e[b]! * u + 0.15 * d + 0.05 * p * v)],
        margins: [(1.3 - 0.1 * d - u - 0.5 * v) / 1.3],
        reg: 0.005 * (d + p),
        descriptors: [b / 2, u, v],
      };
    },
  );
}

/**
 * Three regime archetypes (steady / cycled / fasting) with an uncertain responsiveness parameter k
 * (ensemble draws = fixed LHS quantiles; `drawCount` should equal the ensemble size M) that also moves a weekly-loss safety bound — exercises
 * diversity, the chance constraint and robust re-ranking. Goals: 1. fat loss, 2. lean, 3. autophagy.
 */
export function regimesToy(opts: { drawCount?: number; holdoutCount?: number; lossCap?: number; spread?: number } = {}): ToyPlanner {
  const q = latinHypercube(opts.drawCount ?? 16, 1, new Rng('regimes/ensemble'));
  // holdout draws (HOLDOUT_DRAW_OFFSET + m) come from their own LHS (PLANNER_V2_SPEC §4.7)
  const qh = latinHypercube(opts.holdoutCount ?? 32, 1, new Rng('regimes/holdout'));
  const cap = opts.lossCap ?? 0.45;
  const spread = opts.spread ?? 0.2;
  const fatF = [1.0, 1.03, 1.0];
  const leanB = [0, 0.1, -0.1];
  const auto = [0.05, 0.3, 1.0];
  const cyc = [0.1, 0.6, 0.9];
  const fast = [0, 0.2, 0.8];
  const reg = [0, 0.02, 0.04];
  return functionToy(
    ['steady', 'cycled', 'fasting'].map((id) => ({ id, dim: 3, tags: [] })),
    [
      { id: 'fatLoss', sense: 'max' },
      { id: 'lean', sense: 'max' },
      { id: 'autophagy', sense: 'max' },
    ],
    { structure: 0, x: [0, 0.5, 0.5] },
    (_s, i, x, draw) => {
      const u = draw < 0 ? 0.5 : isHoldoutDraw(draw) ? qh[(draw - HOLDOUT_DRAW_OFFSET) % qh.length]! : q[draw % q.length]!;
      const k = 1 + spread * (2 * u - 1);
      const D = 0.1 + 0.4 * x[0]!;
      return {
        goals: [
          10 * D * k * fatF[i]! - 1.5 * D * D,
          2 * x[1]! - 3 * D * D + leanB[i]!,
          auto[i]! * (0.5 + 0.5 * D),
        ],
        margins: [(cap - D * k) / cap],
        reg: reg[i]!,
        descriptors: [cyc[i]! * (0.5 + 0.5 * x[0]!), x[2]!, fast[i]!],
      };
    },
  );
}

/**
 * §7.2.2 linear energy-balance toy: weekly intake I_w ∈ [floor, M] (decoder bound), fat loss
 * Σ 7(M − I_w)/ρ, state-space cap on each week's loss. Analytic optimum: every week at the cap.
 * Skeletons (§4.4): 0 = steady (1 gene), 1 = two phases split at mid-horizon (2 genes),
 * 2 = unstructured weekly control vector (one gene per week; the "price of structure" oracle, §7.2.7).
 * An optional target (kg) turns the goal into a target goal (for the horizon metamorphic test).
 */
export function linearEnergyBalanceToy(
  weeks = 12,
  opts: { M?: number; floor?: number; rho?: number; capKgPerWeek?: number; targetKg?: number } = {},
): ToyPlanner & { optimum: number } {
  const M = opts.M ?? 2500;
  const floor = opts.floor ?? 1500;
  const rho = opts.rho ?? 7700;
  const cap = opts.capKgPerWeek ?? 0.7;
  const loss = (x: number) => (7 * (M - (floor + x * (M - floor)))) / rho;
  const perWeekMax = Math.min(cap, loss(0));
  const half = Math.floor(weeks / 2);
  return {
    ...functionToy(
      [
        { id: 'steady', dim: 1, tags: [0] },
        { id: 'twoPhase', dim: 2, tags: [1] },
        { id: 'weeklyCvp', dim: weeks, tags: [2] },
      ],
      [{ id: 'fatLossKg', sense: 'max', ...(opts.targetKg !== undefined ? { target: opts.targetKg } : {}) }],
      { structure: 0, x: [1] },
      (s, _i, x) => {
        let total = 0;
        const margins: number[] = [];
        for (let w = 0; w < weeks; w++) {
          const g = s.tags[0] === 0 ? x[0]! : s.tags[0] === 1 ? x[w < half ? 0 : 1]! : x[w]!;
          const l = loss(g);
          total += l;
          margins.push((cap - l) / cap);
        }
        return { goals: [total], margins, reg: 0.005 * s.tags[0]!, descriptors: [x[0]!, s.tags[0]! / 2] };
      },
    ),
    optimum: weeks * perWeekMax,
  };
}

/**
 * §7.2.4 structure discovery: 16 weeks; a slowly building, break-reversible adaptation state A
 * reduces the effective deficit (MATADOR-like). Structure 0 = steady deficit (gene: level);
 * structure 1 = cycle of diet/maintenance blocks (genes: level, block length 1-4 weeks, integer).
 * With the mechanism the cycle wins; without it the steady structure wins.
 */
export function adaptationToy(mechanism: boolean): ToyPlanner {
  const weeks = 16;
  const simulate = (levels: number[]) => {
    let A = 0;
    let fat = 0;
    for (let w = 0; w < weeks; w++) {
      const d = levels[w]!;
      fat += d * (1 - A);
      if (mechanism) A = d > 0 ? A + 0.35 * d * (0.8 - A) : A * 0.3;
    }
    return fat;
  };
  return functionToy(
    [
      { id: 'steady', dim: 1, tags: [0] },
      { id: 'cycle', dim: 2, tags: [1], discrete: [{ index: 1, levels: 4 }] },
    ],
    [{ id: 'fatLoss', sense: 'max' }],
    { structure: 0, x: [0] },
    (s, _i, x) => {
      const level = x[0]!;
      const levels: number[] = [];
      if (s.tags[0] === 0) for (let w = 0; w < weeks; w++) levels.push(level);
      else {
        const block = 1 + Math.round(x[1]! * 3);
        for (let w = 0; w < weeks; w++) levels.push(Math.floor(w / block) % 2 === 0 ? level : 0);
      }
      return { goals: [simulate(levels)], descriptors: [s.tags[0]!, level] };
    },
  );
}

/**
 * Plan-ladder toy (PLANNER_V2_SPEC §1.2-1.3) with a planted attainment-difficulty front. Genome x = (effort e, style s,
 * keep k): difficulty D = e (descriptor 0, plus the style descriptors s, k), goal 1 = F(e) = 1 − (1 − e)² (concave: a
 * knee between Easy and Hard), goal 2 = s − 0.2·e (mildly conflicting with effort), one safety margin e ≤ 0.95. Every
 * structure shares the front (they differ by a small efficiency factor), so the archive staircase is F itself.
 * `degenerate`: D is constant (0.5) — no ladder can be distinct (collapse with reasons).
 */
export function ladderToy(opts: { degenerate?: boolean; structures?: number } = {}): ToyPlanner {
  const n = opts.structures ?? 3;
  const eff = [1, 0.97, 0.94, 0.91, 0.88, 0.85];
  const structures: ToyStructure[] = Array.from({ length: n }, (_, i) => ({ id: `lad${i}`, dim: 3, tags: [i], x0: [0.5, 0.5, 0.5] }));
  return functionToy(
    structures,
    [
      { id: 'attain', sense: 'max' },
      { id: 'lean', sense: 'max' },
    ],
    { structure: 0, x: [0, 0.5, 0.5] },
    (s, i, x) => {
      const e = x[0]!;
      const c = eff[i % eff.length]!;
      const D = opts.degenerate ? 0.5 : e;
      return {
        goals: [c * (1 - (1 - e) ** 2), x[1]! - 0.2 * e],
        margins: [(0.95 - e) / 0.95],
        reg: 0.01 * e + 0.002 * s.tags[0]!,
        descriptors: [D, x[1]!, x[2]!],
        features: [e],
      };
    },
    { ladder: { gMinMetric: 0.05 }, featureSchema: [{ kind: 'numeric' }] },
  );
}

/**
 * Race toy ("needle in a structure", PLANNER_V2_SPEC §4.5): `count` structures over x ∈ [0,1]³. Structure `needle` has a
 * peak of height 1 (width 0.25) at c = (0.78, 0.22, 0.7), far from its default genome (0.5, 0.5, 0.5); every other
 * structure is a broad hill of height 0.6-0.75 centred on the default. Its default probe scores ≈ 0.15 (last), so only a
 * race that keeps searching structures beyond their first probe finds it.
 */
const NEEDLE_WIDTH = 0.25;

export function needleToy(count = 24, needle = 17): ToyPlanner {
  const structures: ToyStructure[] = Array.from({ length: count }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, dim: 3, tags: [i] }));
  const c = [0.78, 0.22, 0.7];
  return functionToy(
    structures,
    [{ id: 'g', sense: 'max' }],
    { structure: 0, x: [0, 0, 0] },
    (_s, i, x) => {
      let d2 = 0;
      for (let j = 0; j < 3; j++) d2 += (x[j]! - (i === needle ? c[j]! : 0.5)) ** 2;
      const g = i === needle ? Math.exp(-d2 / (2 * NEEDLE_WIDTH ** 2)) : (0.6 + (0.15 * ((i * 7) % 11)) / 10) * Math.exp(-d2 / 2);
      return { goals: [g], descriptors: [x[0]!, x[1]!, x[2]!] };
    },
  );
}
