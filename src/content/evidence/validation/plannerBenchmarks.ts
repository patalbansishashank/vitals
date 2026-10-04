/**
 * Planner benchmarks: the results file the planner's benchmark harness writes (one run of every suite, every algorithm,
 * paired seeds) and the Evidence › Validation page renders. The harness lives with the planner; this module owns the
 * file's shape, a structural check for files read at build time, and a fixture for tests and design work.
 *
 * Shape (version 1):
 *  - `suites`: problem families with a known reference (an analytic optimum, an exhaustively enumerated small plan space,
 *    or the best plan ever found); per algorithm, lexicographic success, relative regret on the first goal, hypervolume of
 *    the returned plan ladder against the reference front, and a time-to-quality curve (the share of (problem, target)
 *    pairs reached by a number of plan evaluations).
 *  - `gate`: the non-inferiority check a planner change must pass before it ships (per suite: not worse than the
 *    baseline by more than the margins, at a one-sided α, and better somewhere).
 *  - `seeds`: the held-out seeds the gate ran on; constants are tuned on a separate training split, never on these.
 *
 * Every text field here is shown to users, so it follows the Evidence library rule: plain words, no research-note
 * numbers, ruling ids or file names (`__tests__/noInternalRefs.test.ts` scans the fixture and, when present, the file).
 */
export const PLANNER_BENCHMARKS_VERSION = 1;

/** Median and 10th–90th percentile over seeds. */
export interface BenchStat {
  median: number;
  p10: number;
  p90: number;
}

export interface BenchAlgorithm {
  id: string;
  /** Display name, e.g. "Evolution strategy with restarts". */
  label: string;
  role: 'baseline' | 'candidate';
}

/** One point of a time-to-quality curve: after `evaluations` plan evaluations, `solved` of the targets were reached. */
export interface TimeToQualityPoint {
  evaluations: number;
  /** Share 0–1 of (problem, target) pairs reached, median over seeds. */
  solved: number;
}

export interface SuiteResult {
  algorithmId: string;
  /** Runs = problems × seeds. */
  runs: number;
  /** Share 0–1 of runs whose every ranked goal is within half its tolerance of the reference. */
  lexSuccess: BenchStat;
  /** Relative regret on the first ranked goal, in % of the reference value (0 = found the best). */
  regretPct: BenchStat;
  /** Hypervolume of the returned ladder as a share 0–1 of the reference front's; absent for single-plan suites. */
  hypervolume?: BenchStat;
  /** Time-to-quality curve (targets 50, 80, 90, 95, 99 % of the reference), evaluations ascending. */
  timeToQuality: TimeToQualityPoint[];
  /** Area under the time-to-quality curve on a log scale of evaluations, 0–1 (one anytime score). */
  anytimeScore: number;
  wallMs: BenchStat;
}

export interface BenchSuite {
  id: string;
  label: string;
  /** One or two plain sentences: what the problems are and what the reference is. */
  description: string;
  reference: 'analytic' | 'exhaustive' | 'best-known';
  problems: number;
  results: SuiteResult[];
}

export interface GateSuiteResult {
  suiteId: string;
  /** Candidate − baseline lexicographic success, in percentage points, with its one-sided lower confidence bound. */
  lexSuccessDiff: { estimate: number; lower: number };
  /** Candidate − baseline first-goal regret, in percentage points, with its one-sided upper confidence bound. */
  regretDiff: { estimate: number; upper: number };
  nonInferior: boolean;
  /** Better than the baseline on this suite (adjusted p below α and a non-trivial effect size). */
  superior: boolean;
  /** Probability that a random candidate run beats a random baseline run (0.5 = no difference). */
  effectSize: number;
  /** p value after correction for testing many suites. */
  pAdjusted: number;
}

export interface NonInferiorityGate {
  candidateId: string;
  baselineId: string;
  /** One-sided significance level. */
  alpha: number;
  margins: { lexSuccessPoints: number; regretPoints: number };
  suites: GateSuiteResult[];
  /** Safety and reference-request tests passed with the candidate. */
  safetyTestsPassed: boolean;
  /** Same plans whatever the number of workers. */
  deterministic: boolean;
  passed: boolean;
}

export interface PlannerBenchmarks {
  version: typeof PLANNER_BENCHMARKS_VERSION;
  /** ISO 8601 date-time of the run. */
  generatedAt: string;
  engineVersion: string;
  plannerVersion: string;
  /** Plain description of the machine, e.g. "8-core desktop". */
  machine: string;
  seeds: { split: 'held-out'; values: number[] };
  algorithms: BenchAlgorithm[];
  suites: BenchSuite[];
  gate: NonInferiorityGate;
}

/* ------------------------------------------------------------------ structural check */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isStat = (x: unknown): boolean => isObj(x) && isNum(x.median) && isNum(x.p10) && isNum(x.p90);

/**
 * Problems with a results file, in plain words (empty = usable). The page shows nothing from a file with problems, so a
 * harness change that breaks the shape cannot put half a table on screen.
 */
export function plannerBenchmarksProblems(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ['not an object'];
  if (x.version !== PLANNER_BENCHMARKS_VERSION) out.push(`version ${String(x.version)} is not ${PLANNER_BENCHMARKS_VERSION}`);
  for (const k of ['generatedAt', 'engineVersion', 'plannerVersion', 'machine'] as const) if (!isStr(x[k])) out.push(`${k} missing`);
  if (!isObj(x.seeds) || !Array.isArray(x.seeds.values) || !x.seeds.values.every(isNum)) out.push('seeds missing');
  const algs = Array.isArray(x.algorithms) ? (x.algorithms as unknown[]) : [];
  if (algs.length === 0) out.push('no algorithms');
  const algIds = new Set(algs.filter(isObj).map((a) => a.id));
  algs.forEach((a, i) => {
    if (!isObj(a) || !isStr(a.id) || !isStr(a.label) || (a.role !== 'baseline' && a.role !== 'candidate')) out.push(`algorithm ${i} malformed`);
  });
  const suites = Array.isArray(x.suites) ? (x.suites as unknown[]) : [];
  if (suites.length === 0) out.push('no suites');
  const suiteIds = new Set<unknown>();
  suites.forEach((s, i) => {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.label) || !isStr(s.description) || !isNum(s.problems) || !Array.isArray(s.results)) {
      out.push(`suite ${i} malformed`);
      return;
    }
    suiteIds.add(s.id);
    (s.results as unknown[]).forEach((r, j) => {
      const where = `suite ${s.id} result ${j}`;
      if (!isObj(r)) return void out.push(`${where} malformed`);
      if (!algIds.has(r.algorithmId)) out.push(`${where}: unknown algorithm ${String(r.algorithmId)}`);
      if (!isNum(r.runs) || !isNum(r.anytimeScore)) out.push(`${where}: runs or anytime score missing`);
      for (const k of ['lexSuccess', 'regretPct', 'wallMs'] as const) if (!isStat(r[k])) out.push(`${where}: ${k} missing`);
      if (r.hypervolume !== undefined && !isStat(r.hypervolume)) out.push(`${where}: hypervolume malformed`);
      const ttq = Array.isArray(r.timeToQuality) ? (r.timeToQuality as unknown[]) : null;
      if (!ttq || !ttq.every((p) => isObj(p) && isNum(p.evaluations) && isNum(p.solved))) out.push(`${where}: time-to-quality curve malformed`);
    });
  });
  const g = x.gate;
  if (!isObj(g) || !algIds.has(g.candidateId) || !algIds.has(g.baselineId) || !isNum(g.alpha) || !isObj(g.margins) || !Array.isArray(g.suites) || typeof g.passed !== 'boolean') {
    out.push('gate malformed');
  } else {
    for (const gs of g.suites as unknown[]) if (!isObj(gs) || !suiteIds.has(gs.suiteId)) out.push('gate names a suite that is not in the file');
  }
  return out;
}

export function isPlannerBenchmarks(x: unknown): x is PlannerBenchmarks {
  return plannerBenchmarksProblems(x).length === 0;
}

/* ------------------------------------------------------------------ fixture */

const curve = (pts: Array<[number, number]>): TimeToQualityPoint[] => pts.map(([evaluations, solved]) => ({ evaluations, solved }));
const stat = (median: number, p10: number, p90: number): BenchStat => ({ median, p10, p90 });

/**
 * Illustrative numbers in the right shape, for tests and design work. NOT results: the page never shows the fixture as
 * if it were a run (it shows "not published yet" until the harness writes a file).
 */
export const PLANNER_BENCHMARKS_FIXTURE: PlannerBenchmarks = {
  version: 1,
  generatedAt: '2026-10-01T12:00:00Z',
  engineVersion: '2026.10.0',
  plannerVersion: '3.0.0-fixture',
  machine: '8-core desktop',
  seeds: { split: 'held-out', values: Array.from({ length: 31 }, (_, i) => 1001 + i) },
  algorithms: [
    { id: 'baseline', label: 'Evolution strategy with restarts (current)', role: 'baseline' },
    { id: 'portfolio', label: 'Staged portfolio with structure racing', role: 'candidate' },
  ],
  suites: [
    {
      id: 'planted-lexicographic',
      label: 'Planted ranked goals',
      description:
        'Synthetic problems with two to four ranked goals and a known best answer, including a plateau of equally good first-goal answers.',
      reference: 'analytic',
      problems: 24,
      results: [
        { algorithmId: 'baseline', runs: 744, lexSuccess: stat(0.81, 0.71, 0.9), regretPct: stat(0.9, 0.2, 3.1), timeToQuality: curve([[100, 0.2], [1000, 0.55], [10000, 0.84], [30000, 0.9]]), anytimeScore: 0.58, wallMs: stat(4100, 3600, 5200) },
        { algorithmId: 'portfolio', runs: 744, lexSuccess: stat(0.93, 0.87, 0.97), regretPct: stat(0.3, 0, 1.2), timeToQuality: curve([[100, 0.28], [1000, 0.7], [10000, 0.93], [30000, 0.97]]), anytimeScore: 0.69, wallMs: stat(3900, 3400, 4700) },
      ],
    },
    {
      id: 'small-plan-spaces',
      label: 'Small real plan spaces',
      description:
        'Reference requests narrowed to a few plan shapes and settings, small enough to simulate every possible plan, so the true best plan is known.',
      reference: 'exhaustive',
      problems: 5,
      results: [
        { algorithmId: 'baseline', runs: 155, lexSuccess: stat(0.87, 0.8, 0.94), regretPct: stat(0.4, 0, 1.6), hypervolume: stat(0.91, 0.86, 0.95), timeToQuality: curve([[100, 0.3], [1000, 0.66], [10000, 0.9], [30000, 0.94]]), anytimeScore: 0.63, wallMs: stat(21000, 18500, 24000) },
        { algorithmId: 'portfolio', runs: 155, lexSuccess: stat(0.94, 0.9, 0.98), regretPct: stat(0.1, 0, 0.7), hypervolume: stat(0.96, 0.93, 0.98), timeToQuality: curve([[100, 0.36], [1000, 0.78], [10000, 0.96], [30000, 0.98]]), anytimeScore: 0.72, wallMs: stat(19000, 16800, 22100) },
      ],
    },
    {
      id: 'full-requests',
      label: 'Full reference requests',
      description:
        'The five reference requests and twenty generated ones, run through the whole planner; the reference is the best plan any method has ever found for each.',
      reference: 'best-known',
      problems: 25,
      results: [
        { algorithmId: 'baseline', runs: 375, lexSuccess: stat(0.76, 0.64, 0.86), regretPct: stat(1.4, 0.3, 4.2), hypervolume: stat(0.88, 0.8, 0.93), timeToQuality: curve([[100, 0.12], [1000, 0.41], [10000, 0.77], [30000, 0.85]]), anytimeScore: 0.49, wallMs: stat(48000, 41000, 57000) },
        { algorithmId: 'portfolio', runs: 375, lexSuccess: stat(0.85, 0.77, 0.92), regretPct: stat(0.7, 0.1, 2.5), hypervolume: stat(0.93, 0.88, 0.96), timeToQuality: curve([[100, 0.15], [1000, 0.52], [10000, 0.86], [30000, 0.92]]), anytimeScore: 0.57, wallMs: stat(46000, 39500, 55000) },
      ],
    },
  ],
  gate: {
    candidateId: 'portfolio',
    baselineId: 'baseline',
    alpha: 0.05,
    margins: { lexSuccessPoints: 2, regretPoints: 1 },
    suites: [
      { suiteId: 'planted-lexicographic', lexSuccessDiff: { estimate: 12, lower: 8.1 }, regretDiff: { estimate: -0.6, upper: -0.2 }, nonInferior: true, superior: true, effectSize: 0.68, pAdjusted: 0.001 },
      { suiteId: 'small-plan-spaces', lexSuccessDiff: { estimate: 7, lower: 2.3 }, regretDiff: { estimate: -0.3, upper: 0.1 }, nonInferior: true, superior: true, effectSize: 0.61, pAdjusted: 0.012 },
      { suiteId: 'full-requests', lexSuccessDiff: { estimate: 9, lower: 3.9 }, regretDiff: { estimate: -0.7, upper: -0.1 }, nonInferior: true, superior: true, effectSize: 0.63, pAdjusted: 0.004 },
    ],
    safetyTestsPassed: true,
    deterministic: true,
    passed: true,
  },
};
