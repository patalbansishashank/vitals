/**
 * Real-engine suites of the planner benchmark.
 *
 * - R1 micro plan spaces: a golden request (a-e) or the autophagy-first request, restricted to the status-quo plan plus
 *   1-3 structures (the best block-default plans of the request) and 4-6 free genes on their friendly grids (coarsened
 *   until the space holds 5k-30k plans; every other gene stays at its block default). Searched nominally (no ensemble),
 *   so the exhaustive enumeration under the same comparator is the exact reference.
 * - R2 full requests: golden a-e, autophagy-first and 20 seeded fuzzed requests (10 training, 10 holdout), with the
 *   problem built exactly as the planner builds it (prior chance cushion from probe plans, goals from the baseline
 *   run, canonical warm starts, structural moves, validator with the Simulator-mode run, ablations, Gower schema,
 *   fasting family). Reference = the best plan any run ever returned (kept in `bench/reference`).
 *
 * Everything evaluates through `DomainEnv.evaluatorFor` (the worker pool running `src/workers/planner.pool.ts` in the
 * benchmark, an in-thread host in the smoke test), so both algorithms see the same evaluator.
 */
import type { PersonProfile } from '../../../types/profile';
import { ladderTolerance, type GoalSpec } from '../../optim/goals';
import { Rng } from '../../optim/rng';
import type { EvalOutput, EvalRequest, Evaluator, PlanStructure } from '../../optim/types';
import { violation } from '../../optim/types';
import type { PlannerProblem } from '../../optim/pipeline';
import { compileRequest, type PlanningContext } from '../../domain/context';
import { buildVariant, type HostInit, type VariantProblem } from '../../domain/evaluatorHost';
import { gridStep as gridStepOf, roundGenome as roundGenomeOf } from '../../domain/decode';
import { FEATURE_SCHEMA, featuresHaveFast } from '../../domain/features';
import { buildGoals, goalSeries, type BuiltGoals } from '../../domain/goalSpecs';
import { gMinMetric } from '../../domain/limits';
import { EnginePlanModel, calibrateCushion } from '../../domain/model';
import { MIN_TOLERANCE_SHARE, ablationsFor, goalSpreads, skeletonFasts, unlistableWarnings } from '../../domain/planner';
import { canonicalSeeds } from '../../domain/reach';
import { mutateStructure as mutate, structureGoalClasses, transferGenome as transfer, type SkeletonStructure } from '../../domain/skeleton';
import { validatePlan } from '../../domain/validate';
import type { PlannerRequest, RankedGoal } from '../../domain/types';
import { AUTOPHAGY_FIRST_T3, GOLDEN, type GoldenKey } from '../../domain/__tests__/golden.requests';
import type { LadderSpec } from '../algorithms';
import { desirability, goalScore, lexReference, nondominated, type GoalRef } from '../metrics';
import type { ProblemSpec, ReferenceSummary, Split } from '../types';

export interface DomainEnv {
  /** An evaluator whose hosts are initialised with `init` (pool: every port; local: an in-thread host). */
  evaluatorFor(init: HostInit): Promise<Evaluator>;
}

const TINY = 1e-12;

// ---------------------------------------------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------------------------------------------

export const GOLDEN_KEYS = ['a', 'b', 'c', 'd', 'e', 'af'] as const;
export type RequestKey = (typeof GOLDEN_KEYS)[number] | `fuzz${number}`;

const FUZZ_GOALS: RankedGoal[][] = [
  [{ metric: 'fatMass', direction: 'target', target: -6, targetKind: 'change' }, { metric: 'leanTissue', direction: 'maximise' }],
  [{ metric: 'fatMass', direction: 'minimise' }, { metric: 'hunger', direction: 'minimise' }],
  [{ metric: 'skeletalMuscle', direction: 'maximise' }, { metric: 'fatMass', direction: 'target', target: 0, targetKind: 'change' }],
  [{ metric: 'fatMass', direction: 'target', target: -4, targetKind: 'change' }, { metric: 'vo2max', direction: 'maximise' }],
  [{ metric: 'ldl', direction: 'minimise' }, { metric: 'fatMass', direction: 'minimise' }],
  [{ metric: 'fatMass', direction: 'minimise' }, { metric: 'strength', direction: 'maximise' }, { metric: 'hunger', direction: 'minimise' }],
  [{ metric: 'autophagyIdx', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }],
  [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }],
  [{ metric: 'fatMass', direction: 'target', target: -8, targetKind: 'change' }, { metric: 'skeletalMuscle', direction: 'maximise' }, { metric: 'autophagyIdx', direction: 'maximise' }],
  [{ metric: 'vo2max', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }],
];

/** Seeded realistic request (index 0-19; 0-9 training split, 10-19 holdout). */
export function fuzzRequest(i: number): PlannerRequest {
  const rng = new Rng(`bench/R2/fuzz/${i}`);
  const sex = rng.float() < 0.5 ? 'male' : 'female';
  const heightCm = Math.round(sex === 'male' ? 168 + rng.float() * 20 : 156 + rng.float() * 18);
  const bmi = 22 + rng.float() * 12;
  const profile: PersonProfile = {
    schemaVersion: 1,
    body: { sex, ageYears: 22 + rng.int(40), heightCm, weightKg: +(bmi * (heightCm / 100) ** 2).toFixed(1) },
    habits: { sessionsPerWeek: rng.int(5), trainingHistory: (['none', 'lt1y', '1to3y', 'gt3y'] as const)[rng.int(4)]! },
    startDate: '2026-10-05',
  };
  const goals = FUZZ_GOALS[rng.int(FUZZ_GOALS.length)]!.map((g) => ({ ...g }));
  const fasting = goals[0]!.metric === 'autophagyIdx' || rng.float() < 0.2;
  const req: PlannerRequest = {
    profile,
    goals,
    horizonDays: [56, 84, 112][rng.int(3)]!,
    constraints: {
      trainingDaysPerWeek: { min: 0, max: 2 + rng.int(4) },
      ...(rng.float() < 0.3 ? { eatingWindow: { earliestH: 9 + rng.int(3), latestH: 18 + rng.int(3) } } : {}),
    },
    seed: 500 + i,
  };
  if (fasting) req.safety = { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } } as PlannerRequest['safety'];
  return req;
}

export function requestOf(key: string): PlannerRequest {
  let req: PlannerRequest;
  if (key === 'af') req = AUTOPHAGY_FIRST_T3(3);
  else if (key.startsWith('fuzz')) req = fuzzRequest(Number(key.slice(4)));
  else req = GOLDEN[key as GoldenKey];
  // the benchmark sets tier and ensembles itself
  const { budget: _budget, ...rest } = req;
  return rest;
}

export function requestLabel(key: string): string {
  return key === 'af' ? 'autophagy first' : key.startsWith('fuzz') ? `fuzzed ${key.slice(4)}` : `golden ${key}`;
}

// ---------------------------------------------------------------------------------------------------------------
// goal scales
// ---------------------------------------------------------------------------------------------------------------

/**
 * Benchmark goal scales from the planner's goal specs: targets and keep goals fix the upper reference (keep: the
 * baseline sits `keep` units short of it, as in the optimiser); other goals use `anchors` (best feasible value known,
 * maximised units; NaN = not known yet).
 */
export function goalRefsOf(specs: readonly GoalSpec[], baseRaw: readonly number[], anchors: readonly number[], strictness: 'strict' | 'balanced' | 'flexible', units: readonly string[]): GoalRef[] {
  return specs.map((sp, k) => {
    const sign = sp.sense === 'min' ? -1 : 1;
    const sense: GoalRef['sense'] = sp.sense === 'min' ? 'min' : 'max';
    const delta = sp.tolerance ?? ladderTolerance(k, strictness);
    const unit = units[k] ?? '';
    if (sp.target !== undefined && sp.keep !== undefined && sp.keep > 0) {
      const u = sign * sp.target;
      return { id: sp.id, sense, b: u - sp.keep, u, delta, unit, active: true };
    }
    const b = sign * baseRaw[k]!;
    if (sp.target !== undefined) {
      const u = sign * sp.target;
      return { id: sp.id, sense, b, u, delta, unit, active: b < u && u - b > Math.max(TINY, Math.abs(b) * 1e-12) };
    }
    const a = anchors[k];
    const u = a !== undefined && Number.isFinite(a) ? Math.max(a, b) : b;
    return { id: sp.id, sense, b, u, delta, unit, active: u - b > Math.max(TINY, Math.abs(b) * 1e-9) };
  });
}

/** Goal 1's minimal meaningful change (metric units) as the planner passes it: the plan-ladder table, else NaN (the optimiser then uses 10 % of the achievable range). */
function gMinOf(ctx: PlanningContext): number {
  return gMinMetric(ctx, 0) ?? Number.NaN;
}

/**
 * True when the real model reports the difficulty D as its first descriptor (plan-ladder contract: `descriptors(schedule,
 * sim)` returns [D, b₁, b₃, b₄]; the v1 model's `descriptors(schedule)` returned b₁…b₄ and took no run).
 */
export function modelHasDifficulty(baseline: EvalOutput): boolean {
  return baseline.descriptors.length >= 4 && EnginePlanModel.prototype.descriptors.length >= 2;
}

function baselineStart(vp: VariantProblem): number[] {
  const st = vp.structures[0]!;
  const sched = vp.model.repair(st, vp.model.decode(st, new Float64Array(0))).schedule;
  const sim = vp.model.simulate(sched, -1);
  return vp.bindings.map((b) => {
    const y = goalSeries(sim, b, vp.ctx);
    return y ? y[0]! : NaN;
  });
}

function unitsOf(ctx: PlanningContext): string[] {
  return ctx.goals.map((g) => g.def.unit);
}

// ---------------------------------------------------------------------------------------------------------------
// R1 micro plan spaces
// ---------------------------------------------------------------------------------------------------------------

/** Free genes, most influential first (paths of `skeleton.ts`). */
const FREE_GENE_ORDER = ['seg0.energy', 'seg0.protein', 'rt.sessions', 'steps', 'cardio.sessions', 'seg1.energy', 'ev.count', 'ov.pct', 'window.lengthH', 'meals', 'seg0.weeks', 'seg0.onWeeks', 'seg0.carbG', 'rt.sets', 'cardio.minutes'];

export interface MicroGene {
  path: string;
  /** Index in the full genome. */
  index: number;
  /** Genome-unit values (full genome) of the levels, increasing. */
  values: number[];
}

export interface MicroStructure {
  id: string;
  /** Index of the full structure. */
  full: number;
  genes: MicroGene[];
  /** Full genome every other gene keeps (block defaults). */
  base: number[];
}

export interface MicroSpace {
  request: string;
  structures: MicroStructure[];
  plans: number;
}

function levelsOf(st: SkeletonStructure, gi: number, factor: number): number[] {
  const g = st.genes[gi]!;
  const span = g.max - g.min;
  if (!(span > 0)) return [0.5];
  const step0 = g.kind === 'int' ? 1 : (g.grid ?? span / 20);
  const step = step0 * factor;
  const out: number[] = [];
  for (let v = g.min; v <= g.max + 1e-9; v += step) out.push(Math.min(1, Math.max(0, (v - g.min) / span)));
  if (out.length === 1) out.push(1);
  return out;
}

/** Choose the micro space: best block-default structures, then genes and grid coarsening to land in [minPlans, maxPlans]. */
export async function chooseMicroSpace(key: string, vp: VariantProblem, ev: Evaluator, refsFor: (anchors: number[]) => GoalRef[], signs: readonly number[], opts: { minPlans: number; maxPlans: number; maxStructures: number }): Promise<MicroSpace> {
  const S = vp.structures;
  // candidates: every structure's block defaults and the canonical warm starts (fastest safe routes) the planner seeds
  const cands: Array<{ structure: number; x: Float64Array }> = S.map((st, i) => ({ structure: i, x: Float64Array.from(st.x0) }));
  for (const sd of canonicalSeeds(vp.ctx, S)) cands.push({ structure: sd.structure, x: Float64Array.from(sd.x) });
  const outs = await ev.evaluate(cands.map((c) => ({ ...c, draw: -1 })));
  // provisional scale: anchors = best feasible candidate value per goal
  const feas = outs.filter((o) => violation(o.margins) === 0);
  const goals = refsFor(signs.map((sg, k) => (feas.length ? Math.max(...feas.map((o) => sg * Number(o.goals[k]))) : NaN)));
  // lexicographic rank: feasible first, then goal 1 in steps of half its tolerance, then the goal score
  const scored = outs.map((o, i) => {
    const d = desirability(goals, o.goals);
    return { i, s: cands[i]!.structure, feasible: violation(o.margins) === 0, lvl: Math.floor(d[0]! / Math.max(0.01, goals[0]!.delta / 2)), G: goalScore(goals, d) };
  });
  const better = (a: (typeof scored)[number], b: (typeof scored)[number]) => Number(b.feasible) - Number(a.feasible) || b.lvl - a.lvl || b.G - a.G || a.i - b.i;
  const bestOf = new Map<number, (typeof scored)[number]>();
  for (const c of scored) {
    if (c.s === 0 || S[c.s]!.dim === 0) continue;
    const cur = bestOf.get(c.s);
    if (!cur || better(c, cur) < 0) bestOf.set(c.s, c);
  }
  const ranked = [...bestOf.values()].sort(better).map((c) => ({ i: c.s, base: cands[c.i]!.x }));
  const plan = (count: number, nGenes: number, factors: Map<string, number>) => {
    const micro: MicroStructure[] = ranked.slice(0, count).map((r) => {
      const st = S[r.i]!;
      const free = FREE_GENE_ORDER.filter((p) => st.geneIndex[p] !== undefined && st.genes[st.geneIndex[p]!]!.max > st.genes[st.geneIndex[p]!]!.min).slice(0, nGenes);
      return {
        id: st.id,
        full: S.indexOf(st),
        genes: free.map((p) => ({ path: p, index: st.geneIndex[p]!, values: levelsOf(st, st.geneIndex[p]!, factors.get(p) ?? 1) })),
        base: Array.from(r.base),
      };
    });
    const plans = 1 + micro.reduce((s, m) => s + m.genes.reduce((p, g) => p * g.values.length, 1), 0);
    return { micro, plans };
  };
  let best: { micro: MicroStructure[]; plans: number } | null = null;
  for (let count = Math.min(opts.maxStructures, ranked.length); count >= 1 && !best; count--) {
    for (let nGenes = 6; nGenes >= 4 && !best; nGenes--) {
      const factors = new Map<string, number>();
      let p = plan(count, nGenes, factors);
      // coarsen the gene with the most levels until the space fits
      for (let guard = 0; p.plans > opts.maxPlans && guard < 40; guard++) {
        let worst: string | null = null;
        let most = 2;
        for (const m of p.micro) for (const g of m.genes) if (g.values.length > most) {
          most = g.values.length;
          worst = g.path;
        }
        if (!worst) break;
        factors.set(worst, (factors.get(worst) ?? 1) * 2);
        p = plan(count, nGenes, factors);
      }
      if (p.plans <= opts.maxPlans && p.plans >= opts.minPlans) best = p;
    }
  }
  if (!best) {
    // smallest acceptable fallback: one structure, four genes, coarsened
    const factors = new Map<string, number>();
    let p = plan(1, 4, factors);
    for (let guard = 0; p.plans > opts.maxPlans && guard < 40; guard++) {
      const g = p.micro[0]!.genes.reduce((a, b) => (b.values.length > a.values.length ? b : a));
      factors.set(g.path, (factors.get(g.path) ?? 1) * 2);
      p = plan(1, 4, factors);
    }
    best = p;
  }
  return { request: key, structures: best.micro, plans: best.plans };
}

/** Full-genome request of a micro request (micro structure 0 = the status-quo plan). */
export function embedMicro(space: MicroSpace, s: number, z: ArrayLike<number>): { structure: number; x: Float64Array } {
  if (s === 0) return { structure: 0, x: new Float64Array(0) };
  const m = space.structures[s - 1]!;
  const x = Float64Array.from(m.base);
  m.genes.forEach((g, j) => {
    const L = g.values.length;
    const l = Math.min(L - 1, Math.max(0, Math.round(Number(z[j]) * (L - 1))));
    x[g.index] = g.values[l]!;
  });
  return { structure: m.full, x };
}

function microStructures(space: MicroSpace): PlanStructure[] {
  return [
    { id: 'baseline', dim: 0 },
    ...space.structures.map((m) => ({
      id: m.id,
      dim: m.genes.length,
      x0: m.genes.map((g) => {
        const v = m.base[g.index]!;
        let l = 0;
        g.values.forEach((u, k) => {
          if (Math.abs(u - v) < Math.abs(g.values[l]! - v)) l = k;
        });
        return g.values.length > 1 ? l / (g.values.length - 1) : 0.5;
      }),
      discrete: m.genes.map((g, j) => ({ index: j, levels: g.values.length })),
    })),
  ];
}

function microEvaluator(space: MicroSpace, ev: Evaluator): Evaluator {
  return {
    evaluate: (batch) => ev.evaluate(batch.map((r) => ({ ...embedMicro(space, r.structure, r.x), draw: r.draw }))),
  };
}

export interface DomainProblem {
  problem: PlannerProblem<PlanStructure> & { ladder?: LadderSpec };
  evaluator: Evaluator;
  /** Goal scales (R1: final; R2: provisional, anchors unknown). */
  goals: GoalRef[];
  reference: ReferenceSummary | null;
  signs: number[];
  hasD: boolean;
  ensembleSize: number;
  holdoutSize: number;
  strictness: 'strict' | 'balanced' | 'flexible';
  /** Independent validation of a returned plan (validator; R2 also the Simulator-mode run's warnings). */
  validate(structure: number, x: Float64Array): boolean;
  /** Returned plan uses a fast (features). */
  fasts(out: EvalOutput): boolean;
  /**
   * Ensemble draws of plans for the robustness checks (R2): `sel[p]` = the run's selection draws of plan p (only for
   * `selFor`), `fresh[p]` = a fresh 256-draw ensemble. Selection draws first, then one switch to the fresh ensemble.
   */
  draws?: (plans: ReadonlyArray<{ structure: number; x: Float64Array; sel: boolean }>) => Promise<{ sel: EvalOutput[][]; fresh: EvalOutput[][] }>;
  info: Record<string, unknown>;
}

const R1_INIT = (req: PlannerRequest): HostInit => ({ request: req, ensemble: { seed: String(req.seed ?? 'r1'), size: 0 } });

/** Goal specs, start values, provisional scales of a request (one local baseline run). */
function goalsOf(vp: VariantProblem, baseRaw: number[], strictness: 'strict' | 'balanced' | 'flexible', anchors: number[]): { built: BuiltGoals; refs: GoalRef[] } {
  const built = buildGoals(vp.ctx, baselineStart(vp));
  const refs = goalRefsOf(built.specs, baseRaw, anchors, strictness, unitsOf(vp.ctx));
  return { built, refs };
}

/** Exhaustive reference of an R1 micro space under the benchmark comparator (stage optima, floors, best goal score). */
/** Draws of the R1 ensemble truth. */
export const R1_TRUTH_DRAWS = 256;

export async function r1Reference(spec: ProblemSpec, env: DomainEnv, opts: { minPlans?: number; maxPlans?: number; maxStructures?: number; batch?: number; truthTop?: number } = {}): Promise<ReferenceSummary> {
  const key = spec.params['request'] as string;
  const req = requestOf(key);
  const init = R1_INIT(req);
  const vp = buildVariant(init, { kind: 'main' });
  const ev = await env.evaluatorFor(init);
  const strictness = req.strictness ?? 'balanced';
  const [base] = await ev.evaluate([{ structure: 0, x: new Float64Array(0), draw: -1 }]);
  const baseRaw = Array.from(base!.goals, Number);
  const prov = goalsOf(vp, baseRaw, strictness, baseRaw.map(() => NaN));
  const signs0 = prov.built.specs.map((sp) => (sp.sense === 'min' ? -1 : 1));
  const space = await chooseMicroSpace(key, vp, ev, (anchors) => goalRefsOf(prov.built.specs, baseRaw, anchors, strictness, unitsOf(vp.ctx)), signs0, {
    minPlans: opts.minPlans ?? (spec.params['minPlans'] as number | undefined) ?? 5000,
    maxPlans: opts.maxPlans ?? (spec.params['maxPlans'] as number | undefined) ?? 30000,
    maxStructures: opts.maxStructures ?? (spec.params['maxStructures'] as number | undefined) ?? 3,
  });
  // enumerate
  const all: Array<{ s: number; levels: number[]; raw: number[]; vS: number; D: number }> = [{ s: 0, levels: [], raw: baseRaw, vS: violation(base!.margins), D: Number(base!.descriptors[0] ?? NaN) }];
  const B = opts.batch ?? 1024;
  for (let s = 1; s <= space.structures.length; s++) {
    const m = space.structures[s - 1]!;
    const L = m.genes.map((g) => g.values.length);
    const total = L.reduce((a, b) => a * b, 1);
    for (let start = 0; start < total; start += B) {
      const reqs: EvalRequest[] = [];
      const lv: number[][] = [];
      for (let k = start; k < Math.min(total, start + B); k++) {
        let r = k;
        const levels = L.map((n) => {
          const l = r % n;
          r = Math.floor(r / n);
          return l;
        });
        lv.push(levels);
        reqs.push({ ...embedMicro(space, s, levels.map((l, j) => (L[j]! > 1 ? l / (L[j]! - 1) : 0.5))), draw: -1 });
      }
      const outs = await ev.evaluate(reqs);
      outs.forEach((o, j) => all.push({ s, levels: lv[j]!, raw: Array.from(o.goals, Number), vS: violation(o.margins), D: Number(o.descriptors[0] ?? NaN) }));
    }
  }
  // final scale: anchors = best feasible value per goal in the space
  const signs = prov.built.specs.map((sp) => (sp.sense === 'min' ? -1 : 1));
  const anchors = signs.map((sg, k) => Math.max(...all.filter((p) => p.vS === 0).map((p) => sg * p.raw[k]!)));
  const refs = goalRefsOf(prov.built.specs, baseRaw, anchors, strictness, unitsOf(vp.ctx));
  const cands = all.map((p) => ({ d: desirability(refs, p.raw), feasible: p.vS === 0 }));
  const { stage } = lexReference(refs, cands);
  // x* = best goal score within the floors that also passes the independent validator
  const floors = refs.map((g, k) => (g.active && Number.isFinite(stage[k]!) ? stage[k]! - g.delta : -Infinity));
  const order = cands
    .map((c, i) => ({ i, G: goalScore(refs, c.d), ok: c.feasible && c.d.every((v, k) => v >= floors[k]! - 1e-12) }))
    .filter((c) => c.ok)
    .sort((a, b) => b.G - a.G || a.i - b.i);
  let star = -1;
  for (const c of order.slice(0, 200)) {
    const p = all[c.i]!;
    const e = embedMicro(space, p.s, p.levels.map((l, j) => {
      const n = space.structures[p.s - 1]?.genes[j]?.values.length ?? 1;
      return n > 1 ? l / (n - 1) : 0.5;
    }));
    const st = vp.structures[e.structure]!;
    if (validatePlan(vp.ctx, vp.model.repair(st, vp.model.decode(st, e.x)).schedule).ok) {
      star = c.i;
      break;
    }
  }
  if (star < 0) star = order[0]?.i ?? 0;
  const dStar = cands[star]!.d;
  const hasD = modelHasDifficulty(base!);
  const front = hasD ? nondominated(all.filter((p) => p.vS === 0).map((p) => ({ g: Math.min(1, desirability(refs, p.raw)[0]!), D: p.D }))) : [];
  // ensemble truth: the 50 best plans within the floors on a 256-draw ensemble (does the nominal best keep its limits in
  // 90 % of draws, and how far is the best plan that does?)
  let truth: Record<string, unknown> | null = null;
  const topN = opts.truthTop ?? 50;
  if (topN > 0 && order.length) {
    const top = order.slice(0, topN);
    const ev256 = await env.evaluatorFor({ request: req, ensemble: { seed: 'bench/r1-truth', size: R1_TRUTH_DRAWS } });
    const reqs: EvalRequest[] = [];
    for (const c of top) {
      const p = all[c.i]!;
      const e = embedMicro(space, p.s, p.levels.map((l, j) => {
        const n = space.structures[p.s - 1]?.genes[j]?.values.length ?? 1;
        return n > 1 ? l / (n - 1) : 0.5;
      }));
      for (let m = 0; m < R1_TRUTH_DRAWS; m++) reqs.push({ ...e, draw: m });
    }
    const outs = await ev256.evaluate(reqs);
    const rows = top.map((c, t) => {
      const o = outs.slice(t * R1_TRUTH_DRAWS, (t + 1) * R1_TRUTH_DRAWS);
      const C = o[0]?.margins.length ?? 0;
      let minShare = 1;
      for (let k = 0; k < C; k++) minShare = Math.min(minShare, o.filter((q) => !(Number(q.margins[k]) < 0)).length / o.length);
      const meanD = refs.map((_, k) => o.reduce((acc, q) => acc + desirability(refs, q.goals)[k]!, 0) / o.length);
      return { i: c.i, minShare, meanD, G: goalScore(refs, meanD) };
    });
    const ok = rows.filter((r) => r.minShare >= 0.9);
    const bestRobust = ok.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.G > b.G ? r : b), null);
    const starRow = rows.find((r) => r.i === star) ?? null;
    truth = {
      draws: R1_TRUTH_DRAWS,
      evaluated: rows.length,
      chanceFeasible: ok.length,
      starShare: starRow?.minShare ?? null,
      starMeanD: starRow?.meanD ?? null,
      robustBest: bestRobust ? { rank: rows.indexOf(bestRobust), meanD: bestRobust.meanD, nominalD: cands[bestRobust.i]!.d } : null,
    };
  }
  return {
    goals: refs,
    dStar,
    gStar: goalScore(refs, dStar),
    exact: true,
    source: `exhaustive enumeration of ${all.length} plans`,
    ...(front.length ? { front: front.map((p) => [p.g, p.D] as [number, number]) } : {}),
    detail: {
      space,
      plans: all.length,
      feasible: cands.filter((c) => c.feasible).length,
      stage,
      star: { structure: all[star]!.s, levels: all[star]!.levels, raw: all[star]!.raw },
      hasD,
      ...(truth ? { truth } : {}),
    },
  };
}

/** R1 problem over a micro space (reference computed beforehand by `r1Reference`). */
export async function buildR1(spec: ProblemSpec, env: DomainEnv, reference: ReferenceSummary): Promise<DomainProblem> {
  const key = spec.params['request'] as string;
  const req = requestOf(key);
  const init = R1_INIT(req);
  const vp = buildVariant(init, { kind: 'main' });
  const strictness = req.strictness ?? 'balanced';
  const space = (reference.detail as { space: MicroSpace }).space;
  const hasD = (reference.detail as { hasD?: boolean }).hasD === true;
  const ev = microEvaluator(space, await env.evaluatorFor(init));
  const built = buildGoals(vp.ctx, baselineStart(vp));
  const structures = microStructures(space);
  const pathsOf = (s: number) => (s === 0 ? [] : space.structures[s - 1]!.genes.map((g) => g.path));
  const full = (s: number, z: Float64Array) => {
    const e = embedMicro(space, s, z);
    const st = vp.structures[e.structure]!;
    return { st, sched: vp.model.repair(st, vp.model.decode(st, e.x)).schedule };
  };
  const problem: DomainProblem['problem'] = {
    structures,
    goals: built.specs,
    baseline: { structure: 0, x: [] },
    mutateStructure: (s, rng) => (structures.length <= 2 ? null : 1 + ((s - 1 + 1 + rng.int(structures.length - 2)) % (structures.length - 1))),
    transferGenome: (f, t, z) => {
      const pf = pathsOf(f);
      const out = Float64Array.from(structures[t]!.x0 ?? []);
      pathsOf(t).forEach((p, j) => {
        const i = pf.indexOf(p);
        if (i >= 0) out[j] = z[i]!;
      });
      return out;
    },
    roundGenome: (s, z) =>
      Float64Array.from(z, (v, j) => {
        const n = space.structures[s - 1]?.genes[j]?.values.length ?? 1;
        return n > 1 ? Math.round(Math.min(1, Math.max(0, v)) * (n - 1)) / (n - 1) : v;
      }),
    gridStep: (s) => Float64Array.from(pathsOf(s), (_, j) => 1 / Math.max(1, (space.structures[s - 1]!.genes[j]!.values.length ?? 2) - 1)),
    validate: (s, z) => validatePlan(vp.ctx, full(s, z).sched),
    featureSchema: FEATURE_SCHEMA,
  };
  if (hasD) problem.ladder = { gMinMetric: gMinOf(vp.ctx) };
  problem.structureTags = (s: number) => structureGoalClasses(vp.ctx, vp.structures[s === 0 ? 0 : space.structures[s - 1]!.full]!.skeleton);
  return {
    problem,
    evaluator: ev,
    goals: reference.goals,
    reference,
    signs: built.specs.map((sp) => (sp.sense === 'min' ? -1 : 1)),
    hasD,
    ensembleSize: 0,
    holdoutSize: 0,
    strictness,
    validate: (s, z) => validatePlan(vp.ctx, full(s, z).sched).ok,
    fasts: (out) => featuresHaveFast(out.features),
    info: { request: key, plans: space.plans },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// R2 full requests
// ---------------------------------------------------------------------------------------------------------------

export const FRESH_DRAWS = 256;

/** The planner's problem for a request, built as the domain planner builds it (cushion, goals, hooks). */
export async function buildR2(spec: ProblemSpec, env: DomainEnv, seed: number, ens: { selection: number; holdout: number }): Promise<DomainProblem | { blocked: string }> {
  const key = spec.params['request'] as string;
  const req0 = requestOf(key);
  const request: PlannerRequest = { ...req0, seed: `${req0.seed ?? key}-b${seed}` };
  const seedStr = String(request.seed);
  const ctx = compileRequest(request);
  if (ctx.caps.blocked) return { blocked: ctx.caps.blocked };
  if (ctx.problems.length) return { blocked: ctx.problems.join(' ') };
  const M = ens.selection;
  const strictness = request.strictness ?? 'balanced';
  const init0: HostInit = { request, ensemble: { seed: seedStr, size: M, ...(ens.holdout > 0 ? { holdoutSize: ens.holdout } : {}) } };
  // prior chance cushion and goal resolution from probe plans (block defaults and the deficit / surplus corners)
  let cushion: number[] | undefined;
  let spread: number[] | null = null;
  const pv = buildVariant(init0, { kind: 'main' });
  if (M > 0) {
    const draws = Math.min(M, 12);
    const corner = (st: SkeletonStructure, deficit: boolean): Float64Array =>
      Float64Array.from(st.genes, (g, i) => {
        if (/\.energy$/.test(g.path)) return deficit ? 0 : 1;
        if (/^(cardio\.|rt\.|steps$)/.test(g.path)) return deficit ? 1 : 0;
        return st.x0[i]!;
      });
    const probes: EvalRequest[] = [];
    const probeCount: number[] = [];
    pv.structures.slice(1, 5).forEach((st, j) => {
      for (const x of [Float64Array.from(st.x0), corner(st, true), corner(st, false)]) {
        probeCount.push(probes.length);
        for (let m = 0; m < draws; m++) probes.push({ structure: j + 1, x, draw: m });
      }
    });
    const ev0 = await env.evaluatorFor(init0);
    const outs = await ev0.evaluate(probes);
    const margins: Float64Array[][] = [];
    const goalDraws: Float64Array[][] = [];
    for (const at of probeCount) {
      margins.push(outs.slice(at, at + draws).map((o) => Float64Array.from(o.margins)));
      goalDraws.push(outs.slice(at, at + draws).map((o) => Float64Array.from(o.goals)));
    }
    cushion = Array.from(calibrateCushion(margins));
    spread = goalSpreads(goalDraws, ctx.goals.length);
  }
  const init: HostInit = { ...init0, ...(cushion ? { cushion } : {}) };
  const main = buildVariant(init, { kind: 'main' });
  const ev = await env.evaluatorFor(init);
  const built = buildGoals(main.ctx, baselineStart(main));
  if (spread)
    built.specs.forEach((sp, i) => {
      const w = spread![i]!;
      if (Number.isFinite(w) && w > 0) sp.minTolerance = MIN_TOLERANCE_SHARE * w;
    });
  const full = new EnginePlanModel(main.ctx, { bindings: built.bindings, ensemble: init.ensemble, recordAll: true, fullMode: true });
  const [base] = await ev.evaluate([{ structure: 0, x: new Float64Array(0), draw: -1 }]);
  const baseRaw = Array.from(base!.goals, Number);
  const hasD = modelHasDifficulty(base!);
  const seeds = canonicalSeeds(main.ctx, main.structures);
  const cache = new Map<number, number[]>();
  const validateFull = (s: number, x: Float64Array) => {
    const st = main.structures[s]!;
    const sched = main.model.repair(st, main.model.decode(st, x)).schedule;
    const v = validatePlan(main.ctx, sched);
    if (!v.ok) return v;
    const bad = unlistableWarnings(main.ctx, sched, full.simulate(sched, -1));
    return bad.length ? { ok: false, reasons: bad.map((w) => `simulator ${w.severity} ${w.id}`) } : v;
  };
  const problem: DomainProblem['problem'] = {
    structures: main.structures,
    goals: built.specs,
    baseline: { structure: 0, x: [] },
    ...(seeds.length ? { seeds } : {}),
    mutateStructure: (s: number, rng: Rng) => mutate(main.structures, s, rng, cache),
    transferGenome: (f, t, x) => transfer(main.structures[f]!, main.structures[t]!, x),
    roundGenome: (s, x) => roundGenomeOf(main.ctx, main.structures[s]!, x),
    gridStep: (s) => gridStepOf(main.structures[s]!),
    validate: validateFull,
    ablations: (s, x) => ablationsFor(main.structures, s, x),
    featureSchema: FEATURE_SCHEMA,
    ...(main.ctx.fastingRelevant ? { group: (s: number, out: EvalOutput) => (skeletonFasts(main.structures[s]!.skeleton) && featuresHaveFast(out.features) ? 'fast' : null) } : {}),
  } as DomainProblem['problem'];
  if (hasD) problem.ladder = { gMinMetric: gMinOf(main.ctx) };
  problem.structureTags = (s: number) => structureGoalClasses(main.ctx, main.structures[s]!.skeleton);
  const freshInit: HostInit = { request, ensemble: { seed: `${seedStr}/bench-fresh`, size: FRESH_DRAWS }, ...(cushion ? { cushion } : {}) };
  return {
    problem,
    evaluator: ev,
    goals: goalRefsOf(built.specs, baseRaw, baseRaw.map(() => NaN), strictness, unitsOf(main.ctx)),
    reference: null,
    signs: built.specs.map((sp) => (sp.sense === 'min' ? -1 : 1)),
    hasD,
    ensembleSize: M,
    holdoutSize: ens.holdout,
    strictness,
    validate: (s, x) => validateFull(s, x).ok,
    fasts: (out) => featuresHaveFast(out.features),
    draws: async (plans) => {
      const sel: EvalOutput[][] = plans.map(() => []);
      const want = plans.flatMap((p, i) => (p.sel && M > 0 ? [i] : []));
      if (want.length) {
        const outs = await (await env.evaluatorFor(init)).evaluate(want.flatMap((i) => Array.from({ length: M }, (_, m) => ({ structure: plans[i]!.structure, x: plans[i]!.x, draw: m }))));
        want.forEach((i, j) => (sel[i] = outs.slice(j * M, (j + 1) * M)));
      }
      const outs = plans.length ? await (await env.evaluatorFor(freshInit)).evaluate(plans.flatMap((p) => Array.from({ length: FRESH_DRAWS }, (_, m) => ({ structure: p.structure, x: p.x, draw: m })))) : [];
      const fresh = plans.map((_, i) => outs.slice(i * FRESH_DRAWS, (i + 1) * FRESH_DRAWS));
      return { sel, fresh };
    },
    info: {
      request: key,
      specs: built.specs.map((sp) => ({ id: sp.id, sense: sp.sense, target: sp.target ?? null, keep: sp.keep ?? null, tolerance: sp.tolerance ?? null })),
      baseRaw,
      units: unitsOf(main.ctx),
      strictness,
      fastingServed: main.ctx.fastingRelevant && main.ctx.fastingServedGoal !== null,
      structures: main.structures.length,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// instance lists
// ---------------------------------------------------------------------------------------------------------------

export function domainSpecs(suite: 'R1' | 'R2', split: Split, opts: { fuzz?: boolean; golden?: boolean } = {}): ProblemSpec[] {
  const out: ProblemSpec[] = [];
  const add = (key: string, extra: Record<string, unknown> = {}) => out.push({ suite, id: `${suite}/${key}`, split, params: { request: key, ...extra }, real: true });
  if (suite === 'R1') {
    for (const k of GOLDEN_KEYS) add(k);
    return out;
  }
  if (opts.golden !== false) for (const k of GOLDEN_KEYS) add(k);
  if (opts.fuzz !== false) {
    const from = split === 'train' ? 0 : 10;
    for (let i = from; i < from + 10; i++) add(`fuzz${i}`);
  }
  return out;
}
