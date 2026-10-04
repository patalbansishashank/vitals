/**
 * One benchmark job = one (problem, seed) run by every algorithm in turn on the same problem and evaluator (paired,
 * common random numbers), or the exhaustive reference of an R1 micro space. Runs in a worker thread (benchmark) or
 * in-process (smoke test); evaluation goes through a `JobEnv` (worker pool or an in-thread host).
 */
import type { EvalOutput, Evaluator } from '../optim/types';
import { violation } from '../optim/types';
import { EvaluatorHost, type HostInit } from '../domain/evaluatorHost';
import { liveEnsembles, runAlgorithm, type AlgoOutcome } from './algorithms';
import { desirability, visitedQd, type GoalRef, type TracePoint } from './metrics';
import { buildR1, buildR2, r1Reference, type DomainEnv, type DomainProblem } from './suites/domain';
import { buildToy, toyEvaluator, type ToyProblem } from './suites/toys';
import { TracingEvaluator } from './trace';
import type { AlgoId, JobResult, PlanRecord, ReferenceJob, RunJob, RunRecord } from './types';

export interface JobEnv extends DomainEnv {
  now(): number;
}

/** In-thread environment: one `EvaluatorHost` per distinct init (smoke test, unit tests). */
export function localEnv(now: () => number): JobEnv {
  const hosts = new Map<string, EvaluatorHost>();
  return {
    now,
    evaluatorFor: async (init: HostInit): Promise<Evaluator> => {
      const k = JSON.stringify(init);
      let h = hosts.get(k);
      if (!h) {
        if (hosts.size > 4) hosts.clear();
        hosts.set(k, (h = new EvaluatorHost(init)));
      }
      const host = h;
      return { evaluate: (batch) => host.evaluate({ kind: 'main' }, batch) };
    },
  };
}

function marginShare(outs: readonly EvalOutput[]): { minShare: number; ok90: boolean; draws: number } {
  const C = outs[0]?.margins.length ?? 0;
  let minShare = 1;
  for (let c = 0; c < C; c++) {
    let ok = 0;
    for (const o of outs) {
      const m = Number(o.margins[c]);
      if (!(m < 0)) ok++;
    }
    minShare = Math.min(minShare, ok / outs.length);
  }
  return { minShare, ok90: minShare >= 0.9 - 1e-12, draws: outs.length };
}

function baseRecord(job: RunJob, algo: AlgoId, out: AlgoOutcome, tracer: TracingEvaluator, goals: GoalRef[], reference: RunRecord['reference']): RunRecord {
  return {
    suite: job.spec.suite,
    problem: job.spec.id,
    split: job.spec.split,
    algo,
    seed: job.seed,
    tier: job.tier,
    ok: out.ok,
    ...(out.error ? { error: out.error } : {}),
    euUsed: out.euUsed || tracer.eu,
    budgetEU: out.budgetEU,
    wallMs: Math.round(tracer.elapsed()),
    complete: out.complete,
    plans: [],
    trace: tracer.trace.slice(),
    qd: null,
    archive: out.archive,
    ladder: out.ladder,
    holdoutGapAlgo: out.holdoutGap,
    safetyViolations: 0,
    goals,
    reference,
  };
}

/** Algorithm order alternates with the seed so neither always runs first (warm caches, JIT). */
function ordered(algos: readonly AlgoId[], seed: number): AlgoId[] {
  return seed % 2 === 1 ? [...algos].reverse() : [...algos];
}

async function runToy(job: RunJob, env: JobEnv): Promise<RunRecord[]> {
  const tp: ToyProblem = buildToy(job.spec);
  const ens = liveEnsembles(job.tier);
  const M = tp.ensemble ? ens.selection : 0;
  const H = tp.ensemble ? ens.holdout : 0;
  const fn = tp.fnFor(job.seed, M, H);
  const signs = tp.goals.map((g) => (g.sense === 'min' ? -1 : 1));
  const records: RunRecord[] = [];
  for (const algo of ordered(job.algos, job.seed)) {
    const visited: TracePoint[] = [];
    const tracer = new TracingEvaluator(toyEvaluator(fn), {
      signs,
      hasD: tp.hasD,
      now: env.now,
      ...(tp.hasD ? { onFeasible: (raw: ArrayLike<number>, desc: ArrayLike<number>) => visited.push({ eu: 0, ms: 0, raw: Array.from(raw, Number), D: Number(desc[0]), b1: Number(desc[1]) }) } : {}),
    });
    const out = await runAlgorithm(algo, tp.problem, tracer, { seed: `bench/${job.spec.id}/${job.seed}`, tier: job.tier, ensembleSize: M, holdoutSize: H, now: env.now, ...(job.totalEU ? { totalEU: job.totalEU } : {}) });
    const rec = baseRecord(job, algo, out, tracer, tp.goals, tp.reference);
    rec.plans = out.plans.map((p, i): PlanRecord => {
      const vS = violation(p.output.margins);
      const pr: PlanRecord = {
        role: p.role,
        structure: p.structure,
        structureId: p.structureId,
        x: Array.from(p.x),
        raw: Array.from(p.output.goals, Number),
        vS,
        D: tp.hasD ? Number(p.output.descriptors[0]) : NaN,
        features: Array.from(p.output.features ?? p.output.descriptors, Number),
        valid: vS === 0,
      };
      if (tp.exact) {
        const ex = tp.exact(p.structure, p.x);
        pr.exact = ex;
        pr.safety = { minShare: ex.pFeasible, ok90: ex.pFeasible >= 0.9 - 1e-12, draws: 10_000 };
        if (i === 0 && M > 0) {
          // selection − independent gap of the Hard plan: selection draws vs the exact expectation
          const sel = Array.from({ length: M }, (_, m) => desirability(tp.goals, fn(p.structure, p.x, m).goals));
          const exactD = desirability(tp.goals, ex.meanRaw);
          pr.gap = tp.goals.map((_, k) => sel.reduce((s, d) => s + d[k]!, 0) / M - exactD[k]!);
        }
      }
      return pr;
    });
    rec.safetyViolations = rec.plans.filter((p) => !p.valid).length;
    if (tp.hasD) rec.qd = visitedQd(tp.goals, visited, tp.reference.gStar);
    records.push(rec);
  }
  return records;
}

async function runDomain(job: RunJob, env: JobEnv): Promise<RunRecord[]> {
  const ens = liveEnsembles(job.tier);
  let dp: DomainProblem;
  if (job.spec.suite === 'R1') {
    if (!job.reference) throw new Error(`R1 job ${job.spec.id} without its reference`);
    dp = await buildR1(job.spec, env, job.reference);
  } else {
    const b = await buildR2(job.spec, env, job.seed, ens);
    if ('blocked' in b) {
      return job.algos.map((algo) => ({
        suite: job.spec.suite,
        problem: job.spec.id,
        split: job.spec.split,
        algo,
        seed: job.seed,
        tier: job.tier,
        ok: false,
        error: `blocked: ${b.blocked}`,
        euUsed: 0,
        budgetEU: 0,
        wallMs: 0,
        complete: false,
        plans: [],
        trace: [],
        qd: null,
        archive: null,
        ladder: null,
        holdoutGapAlgo: null,
        safetyViolations: 0,
        goals: [],
        reference: null,
        info: { blocked: true },
      }));
    }
    dp = b;
  }
  const records: RunRecord[] = [];
  for (const algo of ordered(job.algos, job.seed)) {
    const tracer = new TracingEvaluator(dp.evaluator, { signs: dp.signs, hasD: dp.hasD, now: env.now });
    const out = await runAlgorithm(algo, dp.problem, tracer, {
      seed: `bench/${job.spec.id}/${job.seed}`,
      tier: job.tier,
      ensembleSize: dp.ensembleSize,
      holdoutSize: dp.holdoutSize,
      strictness: dp.strictness,
      now: env.now,
      ...(job.totalEU ? { totalEU: job.totalEU } : {}),
    });
    const rec = baseRecord(job, algo, out, tracer, dp.goals, dp.reference);
    rec.plans = out.plans.map((p): PlanRecord => {
      const vS = violation(p.output.margins);
      return {
        role: p.role,
        structure: p.structure,
        structureId: p.structureId,
        x: Array.from(p.x),
        raw: Array.from(p.output.goals, Number),
        vS,
        D: dp.hasD ? Number(p.output.descriptors[0]) : NaN,
        features: Array.from(p.output.features ?? p.output.descriptors, Number),
        valid: vS === 0 && dp.validate(p.structure, p.x),
        fasts: dp.fasts(p.output),
      };
    });
    rec.safetyViolations = rec.plans.filter((p) => !p.valid).length;
    rec.fastEvaluated = out.groupFast;
    rec.info = dp.info;
    records.push(rec);
  }
  // robustness (R2): every returned plan on a fresh 256-draw ensemble; the Hard plan also on the selection draws
  if (dp.draws) {
    const list: Array<{ rec: RunRecord; p: number; structure: number; x: Float64Array; sel: boolean }> = [];
    for (const rec of records) rec.plans.forEach((pl, p) => list.push({ rec, p, structure: pl.structure, x: Float64Array.from(pl.x), sel: p === 0 }));
    if (list.length) {
      const { sel, fresh } = await dp.draws(list);
      list.forEach((it, i) => {
        const pl = it.rec.plans[it.p]!;
        pl.safety = marginShare(fresh[i]!);
        if (it.sel) {
          pl.drawsSel = sel[i]!.map((o) => Array.from(o.goals, Number));
          pl.drawsFresh = fresh[i]!.map((o) => Array.from(o.goals, Number));
        }
      });
    }
  }
  return records;
}

export async function runJob(job: RunJob | ReferenceJob, env: JobEnv): Promise<JobResult> {
  if (job.kind === 'r1ref') return { kind: 'r1ref', id: job.id, reference: await r1Reference(job.spec, env) };
  const records = job.spec.real ? await runDomain(job, env) : await runToy(job, env);
  return { kind: 'run', id: job.id, records };
}
