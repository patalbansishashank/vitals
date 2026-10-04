/**
 * The Evidence › Validation page's planner-benchmarks file (`PlannerBenchmarks`, owned by src/content/evidence) from a
 * held-out benchmark run: per suite and algorithm the lex-success share over seeds, goal-1 regret, ladder hypervolume,
 * time-to-quality curve and wall time, plus the acceptance gate. Written next to the harness's own summary
 * (docs/planner-benchmark.json) so the page shows real results; every text field is plain words.
 */
import type { BenchStat, BenchSuite, GateSuiteResult, PlannerBenchmarks, SuiteResult } from '@/content/evidence/validation/plannerBenchmarks';
import type { RunMetrics } from './evaluate';
import { ALGO_LABELS, type BenchSummary } from './report';
import { GATE, quantile } from './stats';

const SUITES: Record<string, { label: string; description: string; reference: BenchSuite['reference'] }> = {
  T1: { label: 'Continuous test functions', description: 'Smooth and rugged test functions with a known best point, at 10 to 40 settings.', reference: 'analytic' },
  T2: { label: 'Planted ranked goals', description: 'Synthetic problems with two to four ranked goals and a known best answer, including a plateau of equally good first-goal answers.', reference: 'analytic' },
  T3: { label: 'Needle among many plan shapes', description: 'The best plan hides in one plan shape among 50 to 400, and decoy shapes look good at first.', reference: 'analytic' },
  T4: { label: 'Effort and result frontier', description: 'Two-objective problems (result and effort) with convex, concave and broken frontiers of known shape.', reference: 'analytic' },
  T5: { label: 'Uncertain physiology', description: 'Planted ranked goals whose outcome shifts with uncertain parameters; the reference is computed on 10,000 draws.', reference: 'analytic' },
  R1: { label: 'Small real plan spaces', description: 'Reference requests restricted to a few plan shapes and settings, small enough to simulate every plan; the reference is the exhaustive best.', reference: 'exhaustive' },
  R2: { label: 'Full requests', description: 'The reference requests and generated requests in full; the reference is the best plan any run has found.', reference: 'best-known' },
};

const stat = (xs: readonly number[]): BenchStat => {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return { median: 0, p10: 0, p90: 0 };
  return { median: quantile(s, 0.5), p10: quantile(s, 0.1), p90: quantile(s, 0.9) };
};

function suiteResult(ms: readonly RunMetrics[], algo: string, curve: { grid: number[]; values: number[] } | undefined, anytime: number): SuiteResult {
  const own = ms.filter((m) => m.algo === algo && m.ok);
  const bySeed = new Map<number, number[]>();
  for (const m of own) bySeed.set(m.seed, [...(bySeed.get(m.seed) ?? []), m.lexSuccess]);
  const hv = own.map((m) => m.hvRungsRatio ?? m.hvRungs).filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    algorithmId: algo,
    runs: own.length,
    lexSuccess: stat([...bySeed.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length)),
    regretPct: stat(own.map((m) => 100 * Math.max(0, m.r1))),
    ...(hv.length ? { hypervolume: stat(hv) } : {}),
    timeToQuality: curve ? curve.grid.map((evaluations, i) => ({ evaluations, solved: curve.values[i] ?? 0 })) : [],
    anytimeScore: Number.isFinite(anytime) ? anytime : 0,
    wallMs: stat(own.map((m) => m.wallMs)),
  };
}

/** The page file, or null when the run is not a held-out run with a baseline / candidate pair and a gate. */
export function toValidationFile(s: BenchSummary, metrics: readonly RunMetrics[], opts: { plannerVersion: string; deterministic: boolean; safetyTestsPassed: boolean }): PlannerBenchmarks | null {
  if (s.selection.split !== 'holdout' || !s.gate) return null;
  const algos = [s.baseline, s.candidate];
  const suites: BenchSuite[] = Object.entries(s.suites)
    .filter(([id]) => SUITES[id])
    .map(([id, sm]) => ({
      id,
      ...SUITES[id]!,
      problems: sm.problems,
      results: algos.map((a) => {
        const series = s.ecdf.series.find((x) => x.suite === id && x.algo === a);
        return suiteResult(
          metrics.filter((m) => m.suite === id),
          a,
          series ? { grid: s.ecdf.grid, values: series.values } : undefined,
          sm.algos[a]?.ecdfArea ?? 0,
        );
      }),
    }));
  const gateSuites: GateSuiteResult[] = Object.entries(s.gate.suites)
    .filter(([id]) => SUITES[id])
    .map(([suiteId, g]) => ({
      suiteId,
      lexSuccessDiff: { estimate: 100 * g.lexSuccessDelta, lower: 100 * g.lexSuccessLower },
      regretDiff: { estimate: 100 * g.regretDelta, upper: 100 * g.regretUpper },
      nonInferior: g.nonInferior,
      superior: g.superior,
      effectSize: g.a12,
      pAdjusted: g.pHolm,
    }));
  const seeds = [...new Set(metrics.map((m) => m.seed))].sort((a, b) => a - b);
  return {
    version: 1,
    generatedAt: s.date,
    engineVersion: s.engineVersion,
    plannerVersion: opts.plannerVersion,
    machine: `${s.machine.cpus}-thread desktop shared with other work`,
    seeds: { split: 'held-out', values: seeds },
    algorithms: algos.map((a, i) => ({ id: a, label: ALGO_LABELS[a] ?? a, role: i === 0 ? 'baseline' : 'candidate' })),
    suites,
    gate: {
      candidateId: s.candidate,
      baselineId: s.baseline,
      alpha: GATE.alpha,
      margins: { lexSuccessPoints: 100 * GATE.lexSuccessMargin, regretPoints: 100 * GATE.regretMargin },
      suites: gateSuites,
      safetyTestsPassed: opts.safetyTestsPassed,
      deterministic: opts.deterministic,
      passed: s.gate.pass,
    },
  };
}
