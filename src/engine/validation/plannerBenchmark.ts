/**
 * Published summary of the planner benchmark (docs/planner-benchmark.json, copied to public/validation/ for the
 * Evidence › Validation page): its type and a dependency-free shape check. Written by the benchmark harness
 * (`src/engine/planner/bench/report.ts`), read by the validation page.
 */

export type PlannerBenchmarkVerdict = 'better' | 'worse' | 'no difference' | 'n/a';

/** One headline comparison: the previous planner (`v1`) against the new one (`v2`) on one suite and measure. */
export interface PlannerBenchmarkHeadlineRow {
  suite: string;
  /** Plain-language suite name. */
  suiteName: string;
  /** 'lex-success' | 'goal-1 regret' | 'time to 95 %' | 'ladder hypervolume'. */
  metric: string;
  unit: string;
  v1: number | null;
  v2: number | null;
  delta: number | null;
  /** Paired Wilcoxon p-value, Holm-corrected across suites. */
  p: number | null;
  /** Vargha-Delaney Â₁₂ (probability the new planner does better on a paired run). */
  a12: number | null;
  verdict: PlannerBenchmarkVerdict;
}

export interface PlannerBenchmarkGateSuite {
  suite: string;
  suiteName: string;
  pairs: number;
  nonInferior: boolean;
  superior: boolean;
  fasterAtEqualQuality: boolean;
  /** Mean change in lex-success (share of runs) and its one-sided 95 % lower bound. */
  lexSuccessDelta: number | null;
  lexSuccessLower: number | null;
  /** Mean change in goal-1 regret (share of goal 1's range; lower is better) and its one-sided 95 % upper bound. */
  regretDelta: number | null;
  regretUpper: number | null;
  p: number | null;
  a12: number | null;
  /** Median wall-time ratio new / previous. */
  wallRatio: number | null;
}

export interface PlannerBenchmarkSeries {
  suite: string;
  /** 'v1' | 'v2' (or 'v1b' in a sanity run). */
  algo: string;
  values: number[];
}

export interface PlannerBenchmarkPerfRow {
  request: string;
  tier: string;
  planner: 'v1' | 'v2';
  wallMs: number;
  euUsed: number;
  budgetEU: number;
  workers: number;
  plans: number;
  ideal: boolean;
  status: string;
}

export interface PlannerBenchmarkSummary {
  version: 1;
  /** ISO date-time of the run. */
  date: string;
  runId: string;
  engineVersion: string;
  registryHash: string;
  libraryVersion: string;
  machine: { cpus: number; model: string; memGB: number; node: string; loadAvg: number[]; evaluators: number; jobWorkers: number };
  selection: { suites: string[]; tier: string; split: string; seeds: Record<string, number>; algos: string[] };
  /** Display names of the two planners compared. */
  labels: { v1: string; v2: string };
  headline: PlannerBenchmarkHeadlineRow[];
  gate: { pass: boolean; text: string; suites: PlannerBenchmarkGateSuite[] } | null;
  /** Share of (run, target) pairs solved within each evaluation budget of `grid` (EU, log-spaced). */
  ecdf: { grid: number[]; series: PlannerBenchmarkSeries[] };
  /** Median best-so-far score relative to the reference (1 = reference) at each evaluation budget of `grid`. */
  convergence: { grid: number[]; series: Array<PlannerBenchmarkSeries & { p25: number[]; p75: number[] }> };
  perf: PlannerBenchmarkPerfRow[];
  claims: { shown: string[]; notShown: string[] };
  /** The planner's evidence-coverage report, when it exists. */
  coverage: { report: string } | null;
  /** Repository path of the full report. */
  report: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): boolean => x === null || isNum(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNumArr = (x: unknown): boolean => Array.isArray(x) && x.every(isNum);
const isStrArr = (x: unknown): boolean => Array.isArray(x) && x.every(isStr);
const VERDICTS: readonly string[] = ['better', 'worse', 'no difference', 'n/a'];

function isRow(r: unknown): boolean {
  return isObj(r) && isStr(r['suite']) && isStr(r['suiteName']) && isStr(r['metric']) && isStr(r['unit']) && ['v1', 'v2', 'delta', 'p', 'a12'].every((k) => isNumOrNull(r[k])) && VERDICTS.includes(r['verdict'] as string);
}

function isGateSuite(g: unknown): boolean {
  return (
    isObj(g) &&
    isStr(g['suite']) &&
    isStr(g['suiteName']) &&
    isNum(g['pairs']) &&
    ['nonInferior', 'superior', 'fasterAtEqualQuality'].every((k) => typeof g[k] === 'boolean') &&
    ['lexSuccessDelta', 'lexSuccessLower', 'regretDelta', 'regretUpper', 'p', 'a12', 'wallRatio'].every((k) => isNumOrNull(g[k]))
  );
}

function isSeriesBlock(x: unknown, extra: readonly string[]): boolean {
  if (!isObj(x) || !isNumArr(x['grid']) || !Array.isArray(x['series'])) return false;
  const n = (x['grid'] as number[]).length;
  return (x['series'] as unknown[]).every(
    (s) => isObj(s) && isStr(s['suite']) && isStr(s['algo']) && isNumArr(s['values']) && (s['values'] as number[]).length === n && extra.every((k) => isNumArr(s[k]) && (s[k] as number[]).length === n),
  );
}

function isPerf(p: unknown): boolean {
  return isObj(p) && isStr(p['request']) && isStr(p['tier']) && (p['planner'] === 'v1' || p['planner'] === 'v2') && ['wallMs', 'euUsed', 'budgetEU', 'workers', 'plans'].every((k) => isNum(p[k])) && typeof p['ideal'] === 'boolean' && isStr(p['status']);
}

/** Shape check of a published summary (no loader, no schema library). */
export function isPlannerBenchmarkSummary(x: unknown): x is PlannerBenchmarkSummary {
  if (!isObj(x) || x['version'] !== 1) return false;
  if (!['date', 'runId', 'engineVersion', 'registryHash', 'libraryVersion', 'report'].every((k) => isStr(x[k]))) return false;
  const m = x['machine'];
  if (!isObj(m) || !['cpus', 'memGB', 'evaluators', 'jobWorkers'].every((k) => isNum(m[k])) || !isStr(m['model']) || !isStr(m['node']) || !isNumArr(m['loadAvg'])) return false;
  const s = x['selection'];
  if (!isObj(s) || !isStrArr(s['suites']) || !isStr(s['tier']) || !isStr(s['split']) || !isStrArr(s['algos']) || !isObj(s['seeds']) || !Object.values(s['seeds']).every(isNum)) return false;
  const l = x['labels'];
  if (!isObj(l) || !isStr(l['v1']) || !isStr(l['v2'])) return false;
  if (!Array.isArray(x['headline']) || !x['headline'].every(isRow)) return false;
  const g = x['gate'];
  if (g !== null && !(isObj(g) && typeof g['pass'] === 'boolean' && isStr(g['text']) && Array.isArray(g['suites']) && g['suites'].every(isGateSuite))) return false;
  if (!isSeriesBlock(x['ecdf'], []) || !isSeriesBlock(x['convergence'], ['p25', 'p75'])) return false;
  if (!Array.isArray(x['perf']) || !x['perf'].every(isPerf)) return false;
  const c = x['claims'];
  if (!isObj(c) || !isStrArr(c['shown']) || !isStrArr(c['notShown'])) return false;
  const cov = x['coverage'];
  if (cov !== null && !(isObj(cov) && isStr(cov['report']))) return false;
  return true;
}
