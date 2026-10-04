/**
 * Aggregation, paired comparison, acceptance gate and the published report of the planner benchmark: the summary JSON
 * (docs/planner-benchmark.json and the Evidence › Validation copy) and docs/PLANNER_BENCHMARK.md. The report text
 * names topics in plain words and states what is and is not shown.
 */
import { CURVE_GRID, type RunMetrics } from './evaluate';
import { TARGET_LEVELS, ecdfArea, euGrid, runtimeEcdf } from './metrics';
import { a12Magnitude, bootstrap, ert, gateVerdict, holm, mean, median, quantile, suiteGate, varghaDelaney, wilcoxonSignedRank, type GateVerdict, type PairedUnit, type SuiteGate } from './stats';
import type { PlannerBenchmarkSummary } from '../../validation/plannerBenchmark';
import type { PerfResult } from './perf';
import type { AlgoId, SuiteId } from './types';

export interface HeadlineRow {
  suite: string;
  metric: string;
  unit: string;
  v1: number | null;
  v2: number | null;
  delta: number | null;
  p: number | null;
  pHolm: number | null;
  A12: number | null;
  verdict: 'better' | 'worse' | 'no difference' | 'n/a';
}

export interface AlgoAggregate {
  runs: number;
  failed: number;
  lexSuccess: number;
  lexSuccessMedianProblem: number;
  firstFail: Record<string, number>;
  r1Median: number;
  r1CI: [number, number];
  attainmentMedian: number;
  attainmentCI: [number, number];
  ert: Record<string, number>;
  ert95CI: [number, number];
  hit95: number;
  eu95Median: number | null;
  wall95MedianMs: number | null;
  ecdfArea: number;
  hvRungsMedian: number | null;
  hvRungsRatioMedian: number | null;
  hvStairMedian: number | null;
  igdPlusMedian: number | null;
  ladderPass: number | null;
  monoViolMean: number | null;
  rungsMean: number;
  qdScoreMedian: number | null;
  qdCoverageMedian: number | null;
  archiveCoverageMedian: number | null;
  gap1Mean: number | null;
  safety90: number | null;
  minShare: number | null;
  pFeasibleMedian: number | null;
  fastingShare: number | null;
  safetyViolations: number;
  euMedian: number;
  wallMedianMs: number;
}

export interface ProblemRow {
  problem: string;
  pairs: number;
  ls: Record<string, number>;
  r1: Record<string, number>;
  r1Metric: Record<string, number>;
  unit: string;
  p: number;
  pHolm: number;
  A12: number;
}

export interface SuiteSummary {
  problems: number;
  algos: Record<string, AlgoAggregate>;
  table: ProblemRow[];
  gate: SuiteGate | null;
}

export interface BenchSummary {
  version: 1;
  date: string;
  runId: string;
  engineVersion: string;
  registryHash: string;
  libraryVersion: string;
  machine: { cpus: number; model: string; memGB: number; node: string; loadAvg: number[]; evaluators: number; jobWorkers: number };
  selection: { suites: SuiteId[]; tier: string; seeds: Record<string, number>; split: string; algos: AlgoId[]; v2Api: boolean };
  baseline: AlgoId;
  candidate: AlgoId;
  headline: HeadlineRow[];
  gate: (GateVerdict & { suites: Record<string, SuiteGate> }) | null;
  suites: Record<string, SuiteSummary>;
  ecdf: { grid: number[]; series: Array<{ suite: string; algo: string; values: number[] }> };
  convergence: { grid: number[]; series: Array<{ suite: string; algo: string; median: number[]; p25: number[]; p75: number[] }> };
  claims: { shown: string[]; notShown: string[] };
  durationS: number;
  notes: string[];
  /** Timed full planner runs (one at a time on a fixed number of evaluation threads). */
  perf: PerfResult[] | null;
}

const finite = (xs: Array<number | null | undefined>): number[] => xs.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
const medOrNull = (xs: Array<number | null | undefined>): number | null => {
  const f = finite(xs);
  return f.length ? median(f) : null;
};
const meanOrNull = (xs: Array<number | null | undefined>): number | null => {
  const f = finite(xs);
  return f.length ? mean(f) : null;
};

function aggregate(ms: readonly RunMetrics[], seed: string): AlgoAggregate {
  const ok = ms.filter((m) => m.ok);
  const byProblem = new Map<string, RunMetrics[]>();
  for (const m of ms) {
    let g = byProblem.get(m.problem);
    if (!g) byProblem.set(m.problem, (g = []));
    g.push(m);
  }
  const firstFail: Record<string, number> = {};
  for (const m of ms) firstFail[String(m.firstFail)] = (firstFail[String(m.firstFail)] ?? 0) + 1;
  const ertOf = (i: number) => ert(ms.map((m) => ({ hit: m.hits[i]?.eu ?? null, used: m.euUsed || m.budgetEU })));
  const ertMap: Record<string, number> = {};
  TARGET_LEVELS.forEach((L, i) => (ertMap[String(Math.round(L * 100))] = ertOf(i)));
  const i95 = TARGET_LEVELS.indexOf(0.95);
  const ertCI = bootstrap(ms, (s) => ert(s.map((m) => ({ hit: m.hits[i95]?.eu ?? null, used: m.euUsed || m.budgetEU }))), { seed: `${seed}/ert` });
  const r1CI = bootstrap(ms, (s) => median(s.map((m) => m.r1)), { seed: `${seed}/r1` });
  const atCI = bootstrap(ms, (s) => median(s.map((m) => m.attainment)), { seed: `${seed}/at` });
  const grid = euGrid(Math.max(...ms.map((m) => m.budgetEU || 3000)));
  const ecdf = runtimeEcdf(ms.map((m) => m.hits.map((h) => h?.eu ?? null)), grid);
  const fast = finite(ms.map((m) => m.fasting));
  return {
    runs: ms.length,
    failed: ms.length - ok.length,
    lexSuccess: mean(ms.map((m) => m.lexSuccess)),
    lexSuccessMedianProblem: median([...byProblem.values()].map((g) => mean(g.map((m) => m.lexSuccess)))),
    firstFail,
    r1Median: median(ms.map((m) => m.r1)),
    r1CI: [r1CI.lo, r1CI.hi],
    attainmentMedian: median(ms.map((m) => m.attainment)),
    attainmentCI: [atCI.lo, atCI.hi],
    ert: ertMap,
    ert95CI: [ertCI.lo, ertCI.hi],
    hit95: mean(ms.map((m) => (m.hits[i95] ? 1 : 0))),
    eu95Median: medOrNull(ms.map((m) => m.hits[i95]?.eu ?? null)),
    wall95MedianMs: medOrNull(ms.map((m) => m.hits[i95]?.ms ?? null)),
    ecdfArea: ecdfArea(ecdf, grid),
    hvRungsMedian: medOrNull(ms.map((m) => m.hvRungs)),
    hvRungsRatioMedian: medOrNull(ms.map((m) => m.hvRungsRatio)),
    hvStairMedian: medOrNull(ms.map((m) => m.hvStair)),
    igdPlusMedian: medOrNull(ms.map((m) => m.igdPlus)),
    ladderPass: meanOrNull(ms.map((m) => m.ladderPass)),
    monoViolMean: meanOrNull(ms.map((m) => m.monoViol)),
    rungsMean: mean(ms.map((m) => m.rungs)),
    qdScoreMedian: medOrNull(ms.map((m) => m.qdScore)),
    qdCoverageMedian: medOrNull(ms.map((m) => m.qdCoverage)),
    archiveCoverageMedian: medOrNull(ms.map((m) => m.archiveCoverage)),
    gap1Mean: meanOrNull(ms.map((m) => m.gap?.[0] ?? null)),
    safety90: meanOrNull(ms.map((m) => m.safety90)),
    minShare: finite(ms.map((m) => m.minShare)).length ? Math.min(...finite(ms.map((m) => m.minShare))) : null,
    pFeasibleMedian: medOrNull(ms.map((m) => m.pFeasible)),
    fastingShare: fast.length ? mean(fast) : null,
    safetyViolations: ms.reduce((s, m) => s + m.safetyViolations, 0),
    euMedian: median(ms.map((m) => m.euUsed)),
    wallMedianMs: median(ms.map((m) => m.wallMs)),
  };
}

function pairsOf(ms: readonly RunMetrics[], a: AlgoId, b: AlgoId): Array<[RunMetrics, RunMetrics]> {
  const key = (m: RunMetrics) => `${m.problem}|${m.split}|${m.seed}`;
  const A = new Map(ms.filter((m) => m.algo === a).map((m) => [key(m), m]));
  const out: Array<[RunMetrics, RunMetrics]> = [];
  for (const m of ms) if (m.algo === b && A.has(key(m))) out.push([A.get(key(m))!, m]);
  return out.sort((x, y) => key(x[0]).localeCompare(key(y[0])));
}

const PENALTY = (m: RunMetrics, i: number) => m.hits[i]?.eu ?? 2 * Math.max(m.euUsed, m.budgetEU, 1);

function verdictOf(pHolm: number | null, a12: number | null): HeadlineRow['verdict'] {
  if (pHolm === null || a12 === null || Number.isNaN(pHolm) || Number.isNaN(a12)) return 'n/a';
  if (pHolm < 0.05 && a12 >= 0.56) return 'better';
  if (pHolm < 0.05 && a12 <= 0.44) return 'worse';
  return 'no difference';
}

/** Summary of a benchmark run (aggregates, paired comparisons, gate). */
export function summarise(metrics: readonly RunMetrics[], ctx: Omit<BenchSummary, 'headline' | 'gate' | 'suites' | 'ecdf' | 'convergence' | 'claims'>): BenchSummary {
  const base = ctx.baseline;
  const cand = ctx.candidate;
  const suites: Record<string, SuiteSummary> = {};
  const headline: HeadlineRow[] = [];
  const gates: Record<string, SuiteGate> = {};
  const ecdfSeries: BenchSummary['ecdf']['series'] = [];
  const convSeries: BenchSummary['convergence']['series'] = [];
  const maxBudget = Math.max(3000, ...metrics.map((m) => m.budgetEU || 0));
  const grid = euGrid(maxBudget);
  const i95 = TARGET_LEVELS.indexOf(0.95);
  const suiteIds = [...new Set(metrics.map((m) => m.suite))];
  for (const s of suiteIds) {
    const ms = metrics.filter((m) => m.suite === s);
    const order = ctx.selection.algos as string[];
    const algos = [...new Set(ms.map((m) => m.algo))].sort((a, b) => (order.indexOf(a) + 99 * Number(!order.includes(a))) - (order.indexOf(b) + 99 * Number(!order.includes(b))));
    const agg: Record<string, AlgoAggregate> = {};
    for (const a of algos) {
      const am = ms.filter((m) => m.algo === a);
      agg[a] = aggregate(am, `bench/${s}/${a}`);
      ecdfSeries.push({ suite: s, algo: a, values: runtimeEcdf(am.map((m) => m.hits.map((h) => h?.eu ?? null)), grid).map((v) => +v.toFixed(4)) });
      const cols = CURVE_GRID.map((_, j) => am.map((m) => m.curve[j] ?? 0));
      convSeries.push({
        suite: s,
        algo: a,
        median: cols.map((c) => +median(c).toFixed(4)),
        p25: cols.map((c) => +quantile(c, 0.25).toFixed(4)),
        p75: cols.map((c) => +quantile(c, 0.75).toFixed(4)),
      });
    }
    const pairs = algos.includes(base) && algos.includes(cand) && base !== cand ? pairsOf(ms, base, cand) : [];
    // per problem: paired Wilcoxon on attainment, Holm across the suite's problems
    const problems = [...new Set(ms.map((m) => m.problem))].sort();
    const table: ProblemRow[] = problems.map((pr) => {
      const pp = pairs.filter(([a]) => a.problem === pr);
      const w = pp.length ? wilcoxonSignedRank(pp.map(([, b]) => b.attainment), pp.map(([a]) => a.attainment), 'two-sided', { tol: 1e-9 }) : null;
      const rate = (al: AlgoId) => mean(ms.filter((m) => m.problem === pr && m.algo === al).map((m) => m.lexSuccess));
      const med = (al: AlgoId, f: (m: RunMetrics) => number) => median(ms.filter((m) => m.problem === pr && m.algo === al).map(f));
      return {
        problem: pr,
        pairs: pp.length,
        ls: Object.fromEntries(algos.map((a) => [a, rate(a)])),
        r1: Object.fromEntries(algos.map((a) => [a, med(a, (m) => m.r1)])),
        r1Metric: Object.fromEntries(algos.map((a) => [a, med(a, (m) => m.r1Metric)])),
        unit: ms.find((m) => m.problem === pr)?.r1Unit ?? '',
        p: w?.p ?? NaN,
        pHolm: NaN,
        A12: pp.length ? varghaDelaney(pp.map(([, b]) => b.attainment), pp.map(([a]) => a.attainment), 1e-9) : NaN,
      };
    });
    const adj = holm(table.map((t) => t.p));
    table.forEach((t, i) => (t.pHolm = adj[i]!));
    let gate: SuiteGate | null = null;
    if (pairs.length) {
      const units: PairedUnit[] = pairs.map(([a, b]) => ({
        problem: a.problem,
        seed: a.seed,
        ls1: a.lexSuccess,
        ls2: b.lexSuccess,
        r1a: a.r1,
        r1b: b.r1,
        q1: a.attainment,
        q2: b.attainment,
        wall1: a.wallMs,
        wall2: b.wallMs,
      }));
      gate = suiteGate(units, `bench/gate/${s}`);
      gates[s] = gate;
      const A = agg[base]!;
      const B = agg[cand]!;
      const row = (metric: string, unit: string, v1: number | null, v2: number | null, x: number[], y: number[]): HeadlineRow => {
        // x = baseline values, y = candidate values, oriented so that higher is better
        const w = wilcoxonSignedRank(y, x, 'two-sided', { tol: 1e-9 });
        return { suite: s, metric, unit, v1, v2, delta: v1 !== null && v2 !== null ? v2 - v1 : null, p: w.p, pHolm: null, A12: varghaDelaney(y, x, 1e-9), verdict: 'n/a' };
      };
      headline.push(row('lex-success', '% of runs', 100 * A.lexSuccess, 100 * B.lexSuccess, pairs.map(([a]) => a.lexSuccess), pairs.map(([, b]) => b.lexSuccess)));
      headline.push(row('goal-1 regret', '% of goal 1 range (median)', 100 * A.r1Median, 100 * B.r1Median, pairs.map(([a]) => -a.r1), pairs.map(([, b]) => -b.r1)));
      headline.push(row('time to 95 %', 'EU (expected running time)', Number.isFinite(A.ert['95']!) ? A.ert['95']! : null, Number.isFinite(B.ert['95']!) ? B.ert['95']! : null, pairs.map(([a]) => -PENALTY(a, i95)), pairs.map(([, b]) => -PENALTY(b, i95))));
      const hvPairs = pairs.filter(([a, b]) => a.hvRungs !== null && b.hvRungs !== null);
      if (hvPairs.length) headline.push(row('ladder hypervolume', 'returned plans (median)', A.hvRungsMedian, B.hvRungsMedian, hvPairs.map(([a]) => a.hvRungs!), hvPairs.map(([, b]) => b.hvRungs!)));
    }
    suites[s] = { problems: problems.length, algos: agg, table, gate };
  }
  // Holm across suites, per metric
  for (const metric of [...new Set(headline.map((h) => h.metric))]) {
    const rows = headline.filter((h) => h.metric === metric);
    const adj = holm(rows.map((r) => (r.p === null ? NaN : r.p)));
    rows.forEach((r, i) => {
      r.pHolm = Number.isNaN(adj[i]!) ? null : adj[i]!;
      r.verdict = verdictOf(r.pHolm, r.A12);
    });
  }
  const gate = Object.keys(gates).length ? { ...gateVerdict(gates), suites: gates } : null;
  const summary: BenchSummary = {
    ...ctx,
    headline,
    gate,
    suites,
    ecdf: { grid, series: ecdfSeries },
    convergence: { grid: CURVE_GRID, series: convSeries },
    claims: { shown: [], notShown: [] },
  };
  summary.claims = claims(summary);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------------------------------------------

const SUITE_NAMES: Record<string, string> = {
  T1: 'Continuous test functions',
  T2: 'Planted priorities',
  T3: 'Needle among many plan shapes',
  T4: 'Effort-attainment frontier',
  T5: 'Uncertain physiology',
  R1: 'Small real plan spaces (exhaustive search)',
  R2: 'Full requests',
};

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(100 * v).toFixed(d)} %`);
const pval = (p: number | null) => (p === null || !Number.isFinite(p) ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(3));

function claims(s: BenchSummary): { shown: string[]; notShown: string[] } {
  const shown: string[] = [];
  const notShown: string[] = [];
  const cand = s.candidate;
  const r1 = s.suites['R1']?.algos[cand];
  if (r1) {
    const within = 100 * r1.lexSuccess;
    shown.push(
      `On small real plan spaces (each searched exhaustively, every plan simulated), the plan returned first was within half the priority tolerance of the best plan on every goal in ${within.toFixed(0)} % of runs; its median shortfall on goal 1 was ${fmt(100 * r1.r1Median, 2)} % of what goal 1 can gain in that space.`,
    );
  }
  for (const k of ['T2', 'T3', 'T4', 'T5']) {
    const a = s.suites[k]?.algos[cand];
    if (!a) continue;
    if (k === 'T2') shown.push(`On problems with planted priorities and a known best plan, the returned plan met every priority within half its tolerance in ${pct(a.lexSuccess)} of runs.`);
    if (k === 'T3') shown.push(`When the best plan hides in one plan shape among 50-400, the search found it (within tolerance) in ${pct(a.lexSuccess)} of runs.`);
    if (k === 'T4' && a.hvRungsRatioMedian !== null) shown.push(`On frontiers with a known shape, the returned plans covered a median ${pct(a.hvRungsRatioMedian)} of the area the ideal three-plan ladder covers.`);
    if (k === 'T5' && a.pFeasibleMedian !== null) shown.push(`Under uncertain physiology, returned plans kept their limits in a median ${pct(a.pFeasibleMedian, 1)} of 10,000 draws.`);
  }
  for (const k of Object.keys(s.suites)) {
    const a = s.suites[k]!.algos[cand];
    if (a && a.safetyViolations > 0) shown.push(`${SUITE_NAMES[k] ?? k}: ${a.safetyViolations} returned plan(s) broke a limit or failed the independent check.`);
  }
  if (Object.values(s.suites).every((x) => (x.algos[cand]?.safetyViolations ?? 0) === 0)) shown.push('No returned plan broke a safety limit or failed the independent plan check.');
  notShown.push('That plans are the best possible for full requests: there the reference is the best plan any run of the benchmark returned, not an exhaustive search.');
  notShown.push('That the model of the body is right: every result here is measured inside the model. How the model compares with published studies is in the validation report.');
  notShown.push('Wall times on other devices: they were measured on one machine shared with other work, so they are indicative only; evaluation counts are the stable cost measure.');
  if (!s.suites['R2']) notShown.push('Results on full requests: that suite was not part of this run.');
  return { shown, notShown };
}

export function markdown(s: BenchSummary): string {
  const L: string[] = [];
  const cand = s.candidate;
  const base = s.baseline;
  const name = (a: string) => algoLabel(a);
  L.push('# Planner benchmark');
  L.push('');
  L.push(`*Run ${s.runId} of ${s.date.slice(0, 10)}; engine ${s.engineVersion}, parameter set ${s.registryHash}, plan library ${s.libraryVersion}.*`);
  L.push('');
  L.push(
    'The planner searches for the plan that best serves your goals in priority order within your limits and the safety rules. This report measures how close its plans come to the best plan, how fast it gets there, and how well its easier and harder plans cover the trade-off between effort and result. Each problem is solved many times with different random seeds; the ' +
      `${name(base)} and the ${name(cand)} get the same problems, the same evaluations and the same random draws, so their results can be compared run by run.`,
  );
  L.push('');
  L.push('## What is shown and what is not');
  L.push('');
  for (const c of s.claims.shown) L.push(`- ${c}`);
  L.push('');
  L.push('Not shown by this benchmark:');
  L.push('');
  for (const c of s.claims.notShown) L.push(`- ${c}`);
  L.push('');
  L.push('## Headline results');
  L.push('');
  L.push(`Tier ${s.selection.tier}, ${s.selection.split} split. "Better" needs a paired test below 0.05 after correcting for the number of suites and an effect size Â₁₂ of at least 0.56.`);
  L.push('');
  L.push(`| Suite | Measure | ${name(base)} | ${name(cand)} | Difference | p (corrected) | Â₁₂ | Verdict |`);
  L.push('|---|---|---|---|---|---|---|---|');
  for (const h of s.headline) {
    const d = h.metric === 'time to 95 %' || h.metric === 'ladder hypervolume' ? (h.metric === 'ladder hypervolume' ? 3 : 0) : 1;
    L.push(`| ${SUITE_NAMES[h.suite] ?? h.suite} | ${h.metric} (${h.unit}) | ${fmt(h.v1, d)} | ${fmt(h.v2, d)} | ${fmt(h.delta, d)} | ${pval(h.pHolm)} | ${fmt(h.A12, 2)} (${h.A12 === null ? '–' : a12Magnitude(h.A12)}) | ${h.verdict} |`);
  }
  L.push('');
  if (s.gate) {
    L.push('## Acceptance gate');
    L.push('');
    L.push(
      'A new planner is accepted only if, on every suite, it is not worse by more than 2 points of lex-success and 1 % of goal 1 range in regret (one-sided, 95 % bootstrap bounds over paired runs), and it is better on at least one suite or equally good at least 20 % faster.',
    );
    L.push('');
    L.push(`**Verdict: the ${name(cand)} ${s.gate.text}.**`);
    L.push('');
    L.push('| Suite | Pairs | Lex-success change (lower bound) | Regret change (upper bound) | Not worse | p (corrected) | Â₁₂ | Wall-time ratio | Better |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const [k, g] of Object.entries(s.gate.suites))
      L.push(`| ${SUITE_NAMES[k] ?? k} | ${g.pairs} | ${fmt(100 * g.lexSuccessDelta, 1)} (${fmt(100 * g.lexSuccessLower, 1)}) | ${fmt(100 * g.regretDelta, 2)} (${fmt(100 * g.regretUpper, 2)}) | ${g.nonInferior ? 'yes' : 'no'} | ${pval(g.pHolm)} | ${fmt(g.a12, 2)} | ${fmt(g.wallRatio, 2)} | ${g.superior ? 'yes' : g.fasterAtEqualQuality ? 'faster' : 'no'} |`);
    L.push('');
  }
  L.push('## Suites');
  L.push('');
  L.push('- **Continuous test functions**: sphere, ellipsoid, Rosenbrock and Rastrigin with 10, 20 and 40 settings; the best value is known.');
  L.push('- **Planted priorities**: 2-4 ranked goals over several plan shapes with whole-number settings; goal 1 has many equally good plans, goal 2 picks among them and is limited by two safety limits that both bind at the best plan; decoy shapes are better for goal 2 but fall outside goal 1\'s tolerance. The best plan is known exactly.');
  L.push('- **Needle among many plan shapes**: 50-400 plan shapes; the best one has a narrow basin that random tries miss, while decoys look good at first and end worse. Two problems put the best shape beyond the 60 shapes the quickest tier screens, to measure what that cap costs.');
  L.push('- **Effort-attainment frontier**: attainment against difficulty with convex, concave and broken frontiers of known shape; measures the ladder of easier and harder plans.');
  L.push('- **Uncertain physiology**: the planted-priorities problems with uncertain parameters; one limit moves with the parameters, so the best plan must keep a margin (the limit has to hold in 90 % of draws). Returned plans are scored on 10,000 draws.');
  L.push('- **Small real plan spaces**: the five reference requests and the autophagy-first request on the real model, restricted to 1-3 plan shapes and 4-6 settings on their usual steps (5,000-30,000 plans each); every plan is simulated to find the exact best plan.');
  L.push('- **Full requests**: the same six requests and 20 generated requests (10 for tuning, 10 held out for the verdict), solved in full; the reference is the best plan any run returned.');
  L.push('');
  L.push('## Measures');
  L.push('');
  L.push('- **Lex-success**: the share of runs whose first plan is within half the priority tolerance of the best plan on goal 1 and then on every lower goal (tolerance 5 % of goal 1\'s range, 10 % for goal 2, 15 % below).');
  L.push('- **Goal-1 regret**: how much of goal 1\'s achievable range the first plan leaves on the table; per problem also in the goal\'s own unit (kg, cm, …).');
  L.push('- **Time to quality**: evaluations (one simulated plan each) until the best plan seen reaches 50, 80, 90, 95 and 99 % of the reference score; expected running time counts the unsuccessful runs too.');
  L.push('- **Ladder**: area covered by the returned plans in the plane of attainment against difficulty (1 = full result at no effort), the same for every plan the search saw, the distance to the best frontier known, whether the plans are distinct enough (difficulty gaps of at least 0.15 and different enough settings) and ordered (a harder plan never achieves less).');
  L.push('- **Robustness**: how much better a plan looked on the draws used to choose it than on independent draws, and whether every returned plan keeps every limit in at least 90 % of 256 fresh draws.');
  L.push('');
  for (const [k, sm] of Object.entries(s.suites)) {
    L.push(`### ${SUITE_NAMES[k] ?? k}`);
    L.push('');
    L.push(`${sm.problems} problem(s).`);
    L.push('');
    const algos = Object.keys(sm.algos);
    L.push(`| Measure | ${algos.map(name).join(' | ')} |`);
    L.push(`|---|${algos.map(() => '---').join('|')}|`);
    const r = (label: string, f: (a: AlgoAggregate) => string) => L.push(`| ${label} | ${algos.map((a) => f(sm.algos[a]!)).join(' | ')} |`);
    r('Runs (failed)', (a) => `${a.runs} (${a.failed})`);
    r('Lex-success', (a) => pct(a.lexSuccess));
    r('Lex-success, median over problems', (a) => pct(a.lexSuccessMedianProblem));
    r('Goal-1 regret, median [95 % interval]', (a) => `${fmt(100 * a.r1Median, 2)} % [${fmt(100 * a.r1CI[0], 2)}, ${fmt(100 * a.r1CI[1], 2)}]`);
    r('Score vs reference, median', (a) => pct(a.attainmentMedian, 1));
    r('Runs reaching 95 % of the reference', (a) => pct(a.hit95));
    r('Expected evaluations to 95 % [95 % interval]', (a) => `${fmt(a.ert['95'], 0)} [${fmt(a.ert95CI[0], 0)}, ${fmt(a.ert95CI[1], 0)}]`);
    r('Median evaluations / seconds to 95 %', (a) => `${fmt(a.eu95Median, 0)} / ${fmt(a.wall95MedianMs === null ? null : a.wall95MedianMs / 1000, 1)}`);
    r('Anytime score (area under the success curve)', (a) => fmt(a.ecdfArea, 3));
    if (algos.some((a) => sm.algos[a]!.hvRungsMedian !== null)) {
      r('Ladder area of returned plans', (a) => fmt(a.hvRungsMedian, 3));
      if (algos.some((a) => sm.algos[a]!.hvRungsRatioMedian !== null)) r('… as share of the ideal ladder', (a) => pct(a.hvRungsRatioMedian));
      r('Ladder area of every plan seen', (a) => fmt(a.hvStairMedian, 3));
      r('Distance to the best frontier known', (a) => fmt(a.igdPlusMedian, 3));
      r('Ladders distinct and ordered', (a) => pct(a.ladderPass));
      r('Order violations per run', (a) => fmt(a.monoViolMean, 2));
      r('Plans returned per run', (a) => fmt(a.rungsMean, 2));
    }
    if (algos.some((a) => sm.algos[a]!.qdCoverageMedian !== null)) {
      r('Quality-diversity score / coverage of what was seen', (a) => `${fmt(a.qdScoreMedian, 3)} / ${pct(a.qdCoverageMedian)}`);
    }
    if (algos.some((a) => sm.algos[a]!.archiveCoverageMedian !== null)) r('Own archive filled', (a) => pct(a.archiveCoverageMedian));
    if (algos.some((a) => sm.algos[a]!.gap1Mean !== null)) r('Goal 1: chosen-on vs independent draws (gap)', (a) => fmt(a.gap1Mean, 3));
    if (algos.some((a) => sm.algos[a]!.safety90 !== null)) r('Runs whose plans keep every limit in ≥ 90 % of draws', (a) => `${pct(a.safety90)} (lowest ${pct(a.minShare, 1)})`);
    if (algos.some((a) => sm.algos[a]!.pFeasibleMedian !== null)) r('Chance of keeping the limits (10,000 draws), median', (a) => pct(a.pFeasibleMedian, 1));
    if (algos.some((a) => sm.algos[a]!.fastingShare !== null)) r('Fasting-served requests: a plan fasts or a fasting plan was compared', (a) => pct(a.fastingShare));
    r('Safety violations', (a) => String(a.safetyViolations));
    r('Evaluations per run, median', (a) => fmt(a.euMedian, 0));
    r('Wall time per run, median (s)', (a) => fmt(a.wallMedianMs / 1000, 1));
    L.push('');
    if (sm.table.length && sm.table.some((t) => t.pairs > 0)) {
      L.push(`| Problem | Pairs | Lex-success (${algos.map(name).join(' / ')}) | Goal-1 regret, median (${algos.map(name).join(' / ')}) | p (corrected) | Â₁₂ |`);
      L.push('|---|---|---|---|---|---|');
      for (const t of sm.table)
        L.push(`| ${t.problem.replace(/^R[12]\//, '').replace(/^T\d\/(train|holdout)\//, '')} | ${t.pairs} | ${algos.map((a) => pct(t.ls[a])).join(' / ')} | ${algos.map((a) => `${fmt(t.r1Metric[a], 3)}`).join(' / ')} ${t.unit} | ${pval(t.pHolm)} | ${fmt(t.A12, 2)} |`);
      L.push('');
    }
  }
  if (s.perf?.length) {
    L.push('## Speed of a full planner run');
    L.push('');
    L.push(
      `Each row is one complete run as the app makes it, timed alone on ${s.perf[0]!.evaluators} evaluation threads. The full app run is the shipped planner (combined search) with the plan ladder, the Ideal plan with what each limit costs, and time to target; the previous planner row is its search alone on the same problem (its explanation and time-to-target steps no longer exist and are not timed). Tier X was given a ${fmt((s.perf.find((p) => p.tier === 'X')?.budgetEU ?? NaN) / 1000, 0)}k-evaluation budget here; in the app it is open-ended.`,
    );
    L.push('');
    L.push('| Request | Tier | Planner | Wall time (s) | Evaluations used / budget | Plans | Ideal, limit costs | Status |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const p of s.perf)
      L.push(`| ${p.request === 'af' ? 'autophagy first' : `reference request ${p.request}`} | ${p.tier} | ${p.path === 'v2' ? 'full app run' : name(p.path)} | ${fmt(p.wallMs / 1000, 1)} | ${p.euUsed.toLocaleString('en-GB')} / ${p.budgetEU.toLocaleString('en-GB')} | ${p.plans} | ${p.path === 'v2' ? `${p.ideal ? 'yes' : 'no'}, ${p.limitCosts}` : '–'} | ${p.ok ? p.status : `failed: ${p.error ?? ''}`} |`);
    L.push('');
  }
  L.push('## Method');
  L.push('');
  L.push(
    `Seeds are paired: a seed fixes the random draws of both planners (common random numbers). Per problem the planners are compared with the paired Wilcoxon signed-rank test (exact up to 60 pairs) on the score of the first plan relative to the reference, corrected for the number of problems (Holm); suites are compared the same way over all pairs and corrected for the number of suites. Effect sizes are Vargha-Delaney Â₁₂ (0.56 small, 0.64 medium, 0.71 large). Intervals are percentile bootstrap intervals with 10,000 resamples. Constants are tuned only on the tuning split; the verdict comes from the held-out split. Both planners get the same tier budget; on problems with a plan ladder (the frontier suite and the real-engine suites) the new planner keeps its share for the Ideal plan (13 % on tier S) out of the search, as it does in the app, so it searches with fewer evaluations there.`,
  );
  L.push('');
  const m = s.machine;
  L.push(`Machine: ${m.model}, ${m.cpus} cores, ${m.memGB} GB, Node ${m.node}; ${m.evaluators} evaluation threads running the app's own worker code, ${m.jobWorkers} runs at a time; load average at the start ${m.loadAvg.map((v) => v.toFixed(1)).join(' / ')}. Duration ${(s.durationS / 60).toFixed(1)} min.`);
  L.push('');
  if (s.notes.length) {
    L.push('Notes:');
    L.push('');
    for (const n of s.notes) L.push(`- ${n}`);
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// published summary (Evidence › Validation)
// ---------------------------------------------------------------------------------------------------------------

const nn = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
/** Plain names of the algorithms (and of the perf paths: 'v2' there is the app's full run with its default algorithm). */
export const ALGO_LABELS: Readonly<Record<string, string>> = {
  v1: 'previous planner',
  v2: 'new planner',
  v1b: 'previous planner (second copy)',
  hybrid: 'combined planner (previous search for the hardest plan, new ladder)',
};
function algoLabel(a: string): string {
  return ALGO_LABELS[a] ?? a;
}

/** The published projection of a summary (type and shape check in `src/engine/validation/plannerBenchmark.ts`). */
export function publish(s: BenchSummary, opts: { coverage: string | null; report: string }): PlannerBenchmarkSummary {
  return {
    version: 1,
    date: s.date,
    runId: s.runId,
    engineVersion: s.engineVersion,
    registryHash: s.registryHash,
    libraryVersion: s.libraryVersion,
    machine: { ...s.machine, loadAvg: s.machine.loadAvg.map((v) => +v.toFixed(2)) },
    selection: { suites: [...s.selection.suites], tier: s.selection.tier, split: s.selection.split, seeds: { ...s.selection.seeds }, algos: [...s.selection.algos] },
    labels: { v1: algoLabel(s.baseline), v2: algoLabel(s.candidate) },
    headline: s.headline.map((h) => ({ suite: h.suite, suiteName: SUITE_NAMES[h.suite] ?? h.suite, metric: h.metric, unit: h.unit, v1: nn(h.v1), v2: nn(h.v2), delta: nn(h.delta), p: nn(h.pHolm ?? h.p), a12: nn(h.A12), verdict: h.verdict })),
    gate: s.gate
      ? {
          pass: s.gate.pass,
          text: s.gate.text,
          suites: Object.entries(s.gate.suites).map(([k, g]) => ({
            suite: k,
            suiteName: SUITE_NAMES[k] ?? k,
            pairs: g.pairs,
            nonInferior: g.nonInferior,
            superior: g.superior,
            fasterAtEqualQuality: g.fasterAtEqualQuality,
            lexSuccessDelta: nn(g.lexSuccessDelta),
            lexSuccessLower: nn(g.lexSuccessLower),
            regretDelta: nn(g.regretDelta),
            regretUpper: nn(g.regretUpper),
            p: nn(g.pHolm),
            a12: nn(g.a12),
            wallRatio: nn(g.wallRatio),
          })),
        }
      : null,
    ecdf: { grid: [...s.ecdf.grid], series: s.ecdf.series.map((e) => ({ suite: e.suite, algo: e.algo, values: e.values.map((v) => nn(v) ?? 0) })) },
    convergence: { grid: [...s.convergence.grid], series: s.convergence.series.map((c) => ({ suite: c.suite, algo: c.algo, values: c.median.map((v) => nn(v) ?? 0), p25: c.p25.map((v) => nn(v) ?? 0), p75: c.p75.map((v) => nn(v) ?? 0) })) },
    perf: (s.perf ?? []).filter((p) => p.ok).map((p) => ({ request: p.request, tier: p.tier, planner: p.path, wallMs: p.wallMs, euUsed: p.euUsed, budgetEU: p.budgetEU, workers: p.evaluators, plans: p.plans, ideal: p.ideal, status: p.status })),
    claims: { shown: [...s.claims.shown], notShown: [...s.claims.notShown] },
    coverage: opts.coverage ? { report: opts.coverage } : null,
    report: opts.report,
  };
}
