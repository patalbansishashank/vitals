/**
 * From raw run records to per-run metrics: the R2 references (best plan any run returned, best values seen; merged
 * with the stored reference), then lexicographic regret, lex-success, attainment, time to quality, ladder and QD
 * metrics, robustness and safety per run. Pure; the runner does the file IO.
 */
import { featureRanges, gowerDistance } from '../optim/archive';
import { FEATURE_SCHEMA } from '../domain/features';
import {
  TARGET_LEVELS,
  attainmentCurve,
  desirability,
  goalScore,
  hypervolume,
  igdPlus,
  ladderCheck,
  lexOutcome,
  lexReference,
  nondominated,
  timeToTargets,
  unitGower,
  type GoalRef,
  type Hit,
  type LadderPoint,
} from './metrics';
import { goalRefsOf } from './suites/domain';
import type { AlgoId, ReferenceSummary, RunRecord, SuiteId } from './types';

/** Stored best-ever reference of one R2 request (bench/reference). */
export interface StoredR2 {
  anchors: number[];
  best: { raw: number[]; structureId: string; x: number[]; source: string } | null;
  front: Array<[number, number]>;
}

export interface RunMetrics {
  suite: SuiteId;
  problem: string;
  split: string;
  algo: AlgoId;
  seed: number;
  ok: boolean;
  error?: string;
  /** Lex-success 0/1 and the first failing goal (0 = none). */
  lexSuccess: number;
  firstFail: number;
  regret: number[];
  r1: number;
  r1Metric: number;
  r1Unit: string;
  /** G(Hard) / G(x*) (1 = as good as the reference). */
  attainment: number;
  hits: Array<Hit | null>;
  euUsed: number;
  budgetEU: number;
  wallMs: number;
  rungs: number;
  hvRungs: number | null;
  hvRungsRatio: number | null;
  hvStair: number | null;
  igdPlus: number | null;
  ladderPass: number | null;
  monoViol: number | null;
  qdScore: number | null;
  qdCoverage: number | null;
  archiveCoverage: number | null;
  /** Selection − independent gap of the Hard plan, per goal (desirability units). */
  gap: number[] | null;
  gapAlgo: number[] | null;
  /** Every returned plan holds every margin in ≥ 90 % of draws (fresh ensemble / exact). */
  safety90: number | null;
  minShare: number | null;
  /** Noisy suite: exact chance of holding the constraints, CVaR₀.₂ of goal 2's desirability. */
  pFeasible: number | null;
  /** Fasting-served request: a returned plan fasts or the run evaluated a plan with a fast (rival available). */
  fasting: number | null;
  safetyViolations: number;
  curve: number[];
}

export const CURVE_GRID = [10, 20, 50, 100, 200, 300, 500, 700, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 8000, 12000, 20000, 40000];

function requestKey(problem: string): string {
  return problem.split('/').pop()!;
}

/**
 * R2 references per request from every run (and the stored ones): best-known values per goal fix the scales of goals
 * without targets; the reference plan is the ε-lexicographic best of every valid plan any run returned.
 */
export function r2References(records: readonly RunRecord[], stored: Record<string, StoredR2>): { refs: Map<string, ReferenceSummary>; updated: Record<string, StoredR2> } {
  const byReq = new Map<string, RunRecord[]>();
  for (const r of records) {
    if (r.suite !== 'R2' || !r.info || r.info['blocked']) continue;
    const k = requestKey(r.problem);
    let g = byReq.get(k);
    if (!g) byReq.set(k, (g = []));
    g.push(r);
  }
  const refs = new Map<string, ReferenceSummary>();
  const updated: Record<string, StoredR2> = { ...stored };
  for (const [k, recs] of byReq) {
    const info = recs[0]!.info!;
    const specs = info['specs'] as Array<{ id: string; sense: 'max' | 'min'; target: number | null; keep: number | null; tolerance: number | null }>;
    const goalSpecs = specs.map((s) => ({ id: s.id, sense: s.sense, ...(s.target !== null ? { target: s.target } : {}), ...(s.keep !== null ? { keep: s.keep } : {}), ...(s.tolerance !== null ? { tolerance: s.tolerance } : {}) }));
    const baseRaw = info['baseRaw'] as number[];
    const units = info['units'] as string[];
    const strictness = info['strictness'] as 'strict' | 'balanced' | 'flexible';
    const signs = specs.map((s) => (s.sense === 'min' ? -1 : 1));
    const prev = stored[k];
    const anchors = signs.map((sg, j) => {
      let a = prev?.anchors[j] ?? -Infinity;
      for (const r of recs) {
        for (const t of r.trace) a = Math.max(a, sg * t.raw[j]!);
        for (const p of r.plans) if (p.valid) a = Math.max(a, sg * p.raw[j]!);
      }
      return a;
    });
    const goals = goalRefsOf(goalSpecs, baseRaw, anchors, strictness, units);
    const cands: Array<{ raw: number[]; structureId: string; x: number[]; source: string }> = [];
    if (prev?.best) cands.push(prev.best);
    for (const r of recs) for (const p of r.plans) if (p.valid) cands.push({ raw: p.raw, structureId: p.structureId, x: p.x, source: `${r.algo} seed ${r.seed} ${r.tier}` });
    const { index } = lexReference(
      goals,
      cands.map((c) => ({ d: desirability(goals, c.raw), feasible: true })),
    );
    const best = index >= 0 ? cands[index]! : null;
    const dStar = best ? desirability(goals, best.raw) : goals.map(() => 0);
    const pts: LadderPoint[] = (prev?.front ?? []).map(([g, D]) => ({ g, D }));
    for (const r of recs) for (const t of r.trace) if (Number.isFinite(t.D)) pts.push({ g: Math.min(1, desirability(goals, t.raw)[0]!), D: t.D });
    let front = nondominated(pts);
    if (front.length > 200) front = front.filter((_, i) => i % Math.ceil(front.length / 200) === 0);
    refs.set(k, {
      goals,
      dStar,
      gStar: goalScore(goals, dStar),
      exact: false,
      source: best ? `best plan returned by any run (${best.source})` : 'no valid plan returned',
      ...(front.length ? { front: front.map((p) => [p.g, p.D] as [number, number]) } : {}),
    });
    updated[k] = { anchors, best, front: front.map((p) => [p.g, p.D] as [number, number]) };
  }
  return { refs, updated };
}

/** Gower of real-engine features with ranges over a set of plans (the plan-distance the planner uses). */
function domainGower(all: readonly number[][]): (a: readonly number[], b: readonly number[]) => number {
  if (!all.length) return unitGower;
  const dims = Math.min(FEATURE_SCHEMA.length, all[0]!.length);
  const ranges = featureRanges(all, dims);
  return (a, b) => gowerDistance(a, b, FEATURE_SCHEMA.slice(0, dims), ranges);
}

export function runMetrics(r: RunRecord, ref: ReferenceSummary | null, gower: (a: readonly number[], b: readonly number[]) => number): RunMetrics {
  const goals: GoalRef[] = ref?.goals ?? r.goals;
  const K = goals.length;
  const hard = r.plans[0] ?? null;
  const dStar = ref?.dStar ?? goals.map(() => 1);
  const gStar = ref?.gStar ?? goalScore(goals, dStar);
  const dHat = hard ? desirability(goals, hard.raw) : null;
  const lex = lexOutcome(goals, dStar, dHat);
  let lexSuccess = lex.success && !!hard && hard.valid ? 1 : 0;
  // noisy suite: a returned plan must also hold its constraints in ≥ 85 % of draws (90 % rule, finite ensemble)
  const pFeasible = hard?.exact ? hard.exact.pFeasible : null;
  if (pFeasible !== null && pFeasible < 0.85) lexSuccess = 0;
  const attainment = hard && gStar > 0 ? goalScore(goals, dHat!) / gStar : 0;
  const hits = timeToTargets(goals, r.trace, gStar);
  const ladderPts = r.plans.filter((p) => Number.isFinite(p.D)).map((p) => ({ g: Math.min(1, desirability(goals, p.raw)[0]!), D: p.D, features: p.features }));
  const hasD = ladderPts.length > 0;
  const stairPts = r.trace.filter((t) => Number.isFinite(t.D)).map((t) => ({ g: Math.min(1, desirability(goals, t.raw)[0]!), D: t.D }));
  const front = ref?.front?.map(([g, D]) => ({ g, D })) ?? [];
  const hvRungs = hasD ? hypervolume(ladderPts) : null;
  const hvRef = ref?.rungs ? hypervolume(ref.rungs.map(([g, D]) => ({ g, D }))) : null;
  const lc = hasD ? ladderCheck(ladderPts, gower) : null;
  const gap = (() => {
    if (!hard) return null;
    if (hard.gap) return hard.gap;
    if (hard.drawsSel?.length && hard.drawsFresh?.length) {
      const m = (rows: number[][]) => {
        const acc = new Array<number>(K).fill(0);
        for (const row of rows) desirability(goals, row).forEach((v, k) => (acc[k] = acc[k]! + v));
        return acc.map((v) => v / rows.length);
      };
      const a = m(hard.drawsSel);
      const b = m(hard.drawsFresh);
      return a.map((v, k) => v - b[k]!);
    }
    return null;
  })();
  const shares = r.plans.map((p) => p.safety).filter((s): s is NonNullable<typeof s> => !!s);
  const fastingServed = r.info?.['fastingServed'] === true;
  return {
    suite: r.suite,
    problem: r.problem,
    split: r.split,
    algo: r.algo,
    seed: r.seed,
    ok: r.ok,
    ...(r.error ? { error: r.error } : {}),
    lexSuccess,
    firstFail: hard ? lex.firstFail : 1,
    regret: lex.regret,
    r1: lex.regret[0]!,
    r1Metric: lex.r1Metric,
    r1Unit: goals[0]?.unit ?? '',
    attainment,
    hits,
    euUsed: r.euUsed,
    budgetEU: r.budgetEU,
    wallMs: r.wallMs,
    rungs: r.plans.length,
    hvRungs,
    hvRungsRatio: hvRungs !== null && hvRef ? hvRungs / hvRef : null,
    hvStair: stairPts.length ? hypervolume(stairPts) : null,
    igdPlus: hasD && front.length ? igdPlus(stairPts, front) : null,
    ladderPass: lc ? Number(lc.pass) : null,
    monoViol: lc ? lc.monotonicityViolations : null,
    qdScore: r.qd?.score ?? null,
    qdCoverage: r.qd?.coverage ?? null,
    archiveCoverage: r.archive && r.archive.cells > 0 ? r.archive.filled / r.archive.cells : null,
    gap,
    gapAlgo: r.holdoutGapAlgo,
    safety90: shares.length ? Number(shares.every((s) => s.ok90)) : null,
    minShare: shares.length ? Math.min(...shares.map((s) => s.minShare)) : null,
    pFeasible,
    fasting: r.suite === 'R2' && fastingServed ? Number(r.plans.some((p) => p.fasts) || r.fastEvaluated === true) : null,
    safetyViolations: r.safetyViolations,
    curve: attainmentCurve(goals, r.trace, gStar, CURVE_GRID),
  };
}

/** Per-run metrics of every record; R2 references are rebuilt from all runs plus the stored ones. */
export function evaluateRuns(records: readonly RunRecord[], storedR2: Record<string, StoredR2>): { metrics: RunMetrics[]; r2: Record<string, StoredR2>; refs: Map<string, ReferenceSummary> } {
  const { refs, updated } = r2References(records, storedR2);
  // real-engine Gower ranges per problem over every returned plan (both algorithms, all seeds)
  const featsBy = new Map<string, number[][]>();
  for (const r of records) {
    if (!r.suite.startsWith('R')) continue;
    let f = featsBy.get(r.problem);
    if (!f) featsBy.set(r.problem, (f = []));
    for (const p of r.plans) f.push(p.features);
  }
  const gowers = new Map<string, (a: readonly number[], b: readonly number[]) => number>();
  for (const [k, f] of featsBy) gowers.set(k, domainGower(f));
  const metrics = records
    .filter((r) => !r.info?.['blocked'])
    .map((r) => runMetrics(r, r.suite === 'R2' ? (refs.get(requestKey(r.problem)) ?? null) : r.reference, gowers.get(r.problem) ?? unitGower));
  return { metrics, r2: updated, refs };
}

export { TARGET_LEVELS };
