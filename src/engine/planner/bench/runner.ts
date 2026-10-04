/**
 * `pnpm bench:planner`: runs the selected suites with every selected algorithm on paired seeds in worker threads
 * (evaluator threads serve the app's planner pool code), computes the metrics and statistics, updates the stored
 * references (bench/reference) and writes bench-results/<date>-<run-id>.json, docs/PLANNER_BENCHMARK.md,
 * docs/planner-benchmark.json and public/validation/planner-benchmark.json.
 *
 * Environment: BENCH_SUITE=T1,T2,…,R2 (default all) · BENCH_TIER=S · BENCH_SEEDS=31 (T-suites) ·
 * BENCH_SEEDS_R1 (default BENCH_SEEDS) · BENCH_SEEDS_R2=15 · BENCH_SPLIT=train|holdout · BENCH_ALGOS=v1,v2 (v1,v1b = sanity run) · BENCH_R2=all|golden|fuzz ·
 * BENCH_EVALUATORS=18 · BENCH_JOBS=6 (real-engine runs at a time) · BENCH_TOY_JOBS=22 · BENCH_REPORT=1 (0 = results file only) · BENCH_MERGE=<results files> (add their
 * runs to the report) · BENCH_PROBLEMS=<substring filter on problem ids> · BENCH_PERF=a,b (timed full planner runs on
 * BENCH_PERF_EVALUATORS=8 evaluator threads, one at a time, after the suites; BENCH_PERF_TIERS=S,M,L,X; tier X uses
 * BENCH_PERF_X_EU=30000) · BENCH_SUITE=none (no suites, e.g. perf only with BENCH_MERGE).
 */
import { plannerBenchmarksProblems } from '@/content/evidence/validation/plannerBenchmarks';
import { toValidationFile } from './validationFile';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINE_VERSION } from '../../core/defaults';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { hashString } from '../optim/rng';
import { LIBRARY_VERSION } from '../domain/registry/blocks';
import { liveIsV2 } from './algorithms';
import { evaluateRuns, type RunMetrics, type StoredR2 } from './evaluate';
import { bundleWorker } from './node/bundle';
import { startPool } from './node/pool';
import type { PerfJob, PerfResult } from './perf';
import { isPlannerBenchmarkSummary } from '../../validation/plannerBenchmark';
import { markdown, publish, summarise, type BenchSummary } from './report';
import { domainSpecs } from './suites/domain';
import { toySpecs } from './suites/toys';
import { SUITES, type AlgoId, type BenchTier, type Job, type JobResult, type ProblemSpec, type ReferenceJob, type ReferenceSummary, type RunRecord, type Split, type SuiteId } from './types';

export interface BenchOptions {
  root: string;
  suites: SuiteId[];
  tier: BenchTier;
  seeds: number;
  seedsR1: number;
  seedsR2: number;
  split: Split;
  algos: AlgoId[];
  r2: 'all' | 'golden' | 'fuzz';
  evaluators: number;
  jobs: number;
  toyJobs: number;
  report: boolean;
  merge: string[];
  problems: string | null;
  perf: string[];
  perfTiers: Array<'S' | 'M' | 'L' | 'X'>;
  perfEvaluators: number;
  perfXEU: number;
  log: (line: string) => void;
}

export function optionsFromEnv(root: string, env: Record<string, string | undefined>, log: (s: string) => void): BenchOptions {
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const suites = (env['BENCH_SUITE'] === 'none' ? [] : list(env['BENCH_SUITE']).length ? list(env['BENCH_SUITE']) : [...SUITES]).map((s) => s.toUpperCase()) as SuiteId[];
  for (const s of suites) if (!SUITES.includes(s)) throw new RangeError(`BENCH_SUITE: unknown suite ${s}`);
  const seeds = Number(env['BENCH_SEEDS'] ?? 31);
  const algos = (list(env['BENCH_ALGOS']).length ? list(env['BENCH_ALGOS']) : ['v1', 'v2']) as AlgoId[];
  return {
    root,
    suites,
    tier: (env['BENCH_TIER'] ?? 'S') as BenchTier,
    seeds,
    seedsR1: Number(env['BENCH_SEEDS_R1'] ?? seeds),
    seedsR2: Number(env['BENCH_SEEDS_R2'] ?? Math.min(15, seeds)),
    split: (env['BENCH_SPLIT'] ?? 'train') as Split,
    algos,
    r2: (env['BENCH_R2'] ?? 'all') as BenchOptions['r2'],
    evaluators: Number(env['BENCH_EVALUATORS'] ?? 18),
    jobs: Number(env['BENCH_JOBS'] ?? 6),
    toyJobs: Number(env['BENCH_TOY_JOBS'] ?? 22),
    report: env['BENCH_REPORT'] !== '0',
    merge: list(env['BENCH_MERGE']),
    problems: env['BENCH_PROBLEMS'] ?? null,
    perf: list(env['BENCH_PERF']),
    perfTiers: (list(env['BENCH_PERF_TIERS']).length ? list(env['BENCH_PERF_TIERS']) : ['S', 'M', 'L', 'X']) as BenchOptions['perfTiers'],
    perfEvaluators: Number(env['BENCH_PERF_EVALUATORS'] ?? 8),
    perfXEU: Number(env['BENCH_PERF_X_EU'] ?? 30000),
    log,
  };
}

/** Seeds of a split: training 1..n, holdout 1001..1000+n (never tuned on). */
export function seedsOf(split: Split, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (split === 'train' ? 1 : 1001) + i);
}

/** Hash of the planner's domain sources: references are only reused for the same engine, parameters and planner domain. */
export function domainHash(root: string): string {
  const dir = path.join(root, 'src', 'engine', 'planner', 'domain');
  // sources that cannot change an evaluation (explanations, result assembly, re-planning, types) are left out
  const skip = new Set(['explain.ts', 'fastingExplain.ts', 'planner.ts', 'ladderPlanner.ts', 'compat.ts', 'index.ts', 'replan.ts', 'replanTypes.ts', 'sensitivities.ts', 'progress.ts', 'types.ts', 'evidenceGraph.ts']);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !skip.has(f)).sort();
  const reg = path.join(dir, 'registry');
  const regFiles = fs.existsSync(reg) ? fs.readdirSync(reg).filter((f) => f.endsWith('.ts')).sort().map((f) => path.join(reg, f)) : [];
  let h = 0x811c9dc5;
  for (const f of [...files.map((f) => path.join(dir, f)), ...regFiles]) h = hashString(fs.readFileSync(f, 'utf8'), h);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function referenceKey(root: string): string {
  return `${ENGINE_VERSION}-${buildModelParams(MODULES).registryHash}-${domainHash(root)}`;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
}

export function referenceDir(root: string): string {
  return path.join(root, 'src', 'engine', 'planner', 'bench', 'reference');
}

const isoNow = () => new Date(performance.timeOrigin + performance.now()).toISOString();

export async function runBenchmark(o: BenchOptions): Promise<{ summary: BenchSummary; file: string }> {
  const t0 = performance.now();
  const date = isoNow();
  const runId = (hashString(`${date}|${o.suites.join(',')}|${o.split}|${o.algos.join(',')}`) >>> 0).toString(36);
  const refKey = referenceKey(o.root);
  const refDir = referenceDir(o.root);
  const r1File = path.join(refDir, `r1-${refKey}.json`);
  const r2File = path.join(refDir, `r2-${refKey}.json`);
  const r1Refs = readJson<Record<string, ReferenceSummary>>(r1File, {});
  const r2Stored = readJson<Record<string, StoredR2>>(r2File, {});
  o.log(`planner benchmark ${runId}: suites ${o.suites.join(',')} tier ${o.tier} split ${o.split} seeds ${o.seeds} (R1 ${o.seedsR1}, R2 ${o.seedsR2}) algos ${o.algos.join(',')}; live optimiser v2 API: ${liveIsV2()}`);

  // jobs
  const specs: ProblemSpec[] = [];
  for (const s of o.suites) {
    if (s === 'R1' || s === 'R2') specs.push(...domainSpecs(s, o.split, { golden: o.r2 !== 'fuzz', fuzz: o.r2 !== 'golden' }));
    else specs.push(...toySpecs(s, o.split));
  }
  const selected = o.problems ? specs.filter((p) => p.id.includes(o.problems!)) : specs;
  let id = 0;
  const refJobs: ReferenceJob[] = selected.filter((p) => p.suite === 'R1' && !r1Refs[p.params['request'] as string]).map((spec) => ({ kind: 'r1ref' as const, id: ++id, spec }));
  const bundle = await bundleWorker(o.root);
  const records: RunRecord[] = [];
  const errors: string[] = [];
  const onErr = (j: Job, m: string) => errors.push(`job ${j.id} (${j.kind === 'run' ? `${j.spec.id} seed ${j.seed}` : j.kind === 'r1ref' ? j.spec.id : j.request}): ${m.split('\n').slice(0, 3).join(' ')}`);
  let lastLog = performance.now();
  const onRun = (r: JobResult, done: number, total: number) => {
    if (r.kind === 'run') records.push(...r.records);
    const now = performance.now();
    if (now - lastLog > 30_000 || done === total) {
      lastLog = now;
      o.log(`  ${done}/${total} jobs, ${((now - t0) / 1000).toFixed(0)} s`);
    }
  };
  const realSpecs = selected.filter((p) => p.real);
  if (realSpecs.length) {
    // real-engine phase: job threads share the evaluator threads (the app's pool code)
    const pool = await startPool(bundle, { evaluators: o.evaluators, jobs: o.jobs });
    try {
      if (refJobs.length) {
        o.log(`exhaustive references for ${refJobs.length} small real plan space(s)…`);
        await pool.run(
          refJobs,
          (r) => {
            if (r.kind !== 'r1ref') return;
            const key = refJobs.find((j) => j.id === r.id)!.spec.params['request'] as string;
            r1Refs[key] = r.reference;
            o.log(`  R1 ${key}: ${r.reference.source}, d* ${r.reference.dStar.map((v) => v.toFixed(3)).join('/')} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
          },
          onErr,
        );
        writeJson(r1File, r1Refs);
      }
      const realJobs: Job[] = [];
      for (const spec of [...realSpecs].sort((x, y) => (x.suite === y.suite ? 0 : x.suite === 'R2' ? -1 : 1))) {
        const n = spec.suite === 'R2' ? o.seedsR2 : o.seedsR1;
        if (spec.suite === 'R1' && !r1Refs[spec.params['request'] as string]) continue;
        for (const seed of seedsOf(o.split, n))
          realJobs.push({ kind: 'run', id: ++id, spec, seed, tier: o.tier, algos: o.algos, ...(spec.suite === 'R1' ? { reference: r1Refs[spec.params['request'] as string]! } : {}) });
      }
      o.log(`${realJobs.length} paired real-engine jobs on ${o.jobs} job threads and ${o.evaluators} evaluation threads…`);
      await pool.run(realJobs, onRun, onErr);
    } finally {
      await pool.close();
    }
  }
  const toySpecList = selected.filter((p) => !p.real);
  if (toySpecList.length) {
    // synthetic phase: every thread runs whole jobs (no evaluator threads needed)
    const toyJobs: Job[] = [];
    for (const spec of toySpecList) for (const seed of seedsOf(o.split, o.seeds)) toyJobs.push({ kind: 'run', id: ++id, spec, seed, tier: o.tier, algos: o.algos });
    o.log(`${toyJobs.length} paired synthetic jobs on ${o.toyJobs} threads…`);
    const pool = await startPool(bundle, { evaluators: 0, jobs: o.toyJobs });
    try {
      await pool.run(toyJobs, onRun, onErr);
    } finally {
      await pool.close();
    }
  }
  // timed full planner runs, one at a time on a fixed number of evaluator threads (after everything else)
  const perf: PerfResult[] = [];
  if (o.perf.length) {
    const perfJobs: PerfJob[] = [];
    for (const req of o.perf)
      for (const tier of o.perfTiers)
        for (const p of ['v2', 'v1'] as const) {
          if (p === 'v1' && tier === 'X') continue;
          perfJobs.push({ kind: 'perf', id: ++id, request: req, tier, path: p, ...(tier === 'X' ? { totalEU: o.perfXEU } : {}) });
        }
    o.log(`timing ${perfJobs.length} full planner runs on ${o.perfEvaluators} evaluation threads…`);
    const pp = await startPool(bundle, { evaluators: o.perfEvaluators, jobs: 1 });
    try {
      await pp.run(
        perfJobs,
        (r) => {
          if (r.kind !== 'perf') return;
          perf.push(r.result);
          o.log(`  ${r.result.request} ${r.result.tier} ${r.result.path}: ${(r.result.wallMs / 1000).toFixed(1)} s, ${r.result.euUsed} / ${r.result.budgetEU} EU, ${r.result.status}${r.result.error ? ` ERROR ${r.result.error}` : ''}`);
        },
        (j, m) => errors.push(`perf job ${j.id}: ${m.split('\n')[0]}`),
      );
    } finally {
      await pp.close();
    }
  }
  for (const r of records) if (!r.ok && r.error && !r.info?.['blocked']) errors.push(`${r.problem} seed ${r.seed} ${r.algo}: ${r.error.split('\n')[0]}`);
  const { metrics, r2 } = evaluateRuns(records, r2Stored);
  if (records.some((r) => r.suite === 'R2')) writeJson(r2File, r2);
  const merged: RunMetrics[] = [...metrics];
  let perfAll: PerfResult[] = perf;
  for (const f of o.merge) {
    const prev = readJson<{ metrics?: RunMetrics[]; summary?: { perf?: PerfResult[] | null } }>(path.isAbsolute(f) ? f : path.join(o.root, f), {});
    const have = new Set(metrics.map((m) => m.suite));
    for (const m of prev.metrics ?? []) if (!have.has(m.suite)) merged.push(m);
    if (!perfAll.length && prev.summary?.perf?.length) perfAll = prev.summary.perf;
  }
  const cpus = os.cpus();
  const baseline: AlgoId = o.algos[0]!;
  const candidate: AlgoId = o.algos[1] ?? o.algos[0]!;
  const notes: string[] = [];
  if (errors.length) notes.push(`${errors.length} run(s) failed; see the results file.`);
  const blocked = records.filter((r) => r.info?.['blocked']).length;
  if (blocked) notes.push(`${blocked / Math.max(1, o.algos.length)} request/seed pair(s) were blocked by the safety screen and skipped.`);
  const summary = summarise(merged, {
    version: 1,
    date,
    runId,
    engineVersion: ENGINE_VERSION,
    registryHash: buildModelParams(MODULES).registryHash,
    libraryVersion: String(LIBRARY_VERSION),
    machine: { cpus: cpus.length, model: cpus[0]?.model.trim() ?? 'unknown', memGB: Math.round(os.totalmem() / 2 ** 30), node: process.version, loadAvg: os.loadavg(), evaluators: o.evaluators, jobWorkers: o.jobs },
    selection: { suites: [...new Set(merged.map((m) => m.suite))], tier: o.tier, seeds: { T: o.seeds, R1: o.seedsR1, R2: o.seedsR2 }, split: o.split, algos: o.algos, v2Api: liveIsV2() },
    baseline,
    candidate,
    durationS: (performance.now() - t0) / 1000,
    notes,
    perf: perfAll.length ? perfAll : null,
  });
  // ensemble truth of the small real spaces (the 50 best plans on 256 model draws)
  const truths = summary.suites['R1'] ? Object.values(r1Refs).map((r) => (r.detail as { truth?: { starShare: number | null; chanceFeasible: number; evaluated: number; robustBest: { rank: number; nominalD: number[] } | null } } | undefined)?.truth).filter((t): t is NonNullable<typeof t> => !!t) : [];
  if (truths.length) {
    const held = truths.filter((t) => (t.starShare ?? 0) >= 0.9).length;
    const gaps = truths.filter((t) => t.robustBest).map((t) => t.robustBest!.rank);
    summary.claims.shown.push(
      `On those small spaces the exhaustive best plan by the nominal model kept every safety limit in at least 90 % of 256 draws of the model's uncertain parameters in ${held} of ${truths.length} spaces; among the 50 best plans, the best one that did was ranked ${gaps.length ? gaps.map((r) => r + 1).join(', ') : '–'} by the nominal search. The full planner checks every returned plan this way before returning it.`,
    );
  }
  const resultsDir = path.join(o.root, 'bench-results');
  const file = path.join(resultsDir, `${date.slice(0, 10)}-${runId}.json`);
  writeJson(file, { summary, errors, metrics: merged, references: { r1: Object.fromEntries(Object.entries(r1Refs).map(([k, v]) => [k, { ...v, detail: { ...(v.detail ?? {}), space: undefined } }])), r2 } });
  if (o.report) {
    fs.writeFileSync(path.join(o.root, 'docs', 'PLANNER_BENCHMARK.md'), `${markdown(summary)}\n`);
    const coverage = ['docs/PLANNER_COVERAGE.md', 'docs/planner-coverage.json'].find((f) => fs.existsSync(path.join(o.root, f))) ?? null;
    const pub = publish(summary, { coverage, report: 'docs/PLANNER_BENCHMARK.md' });
    if (!isPlannerBenchmarkSummary(pub)) throw new Error('published planner benchmark summary fails its shape check');
    writeJson(path.join(o.root, 'docs', 'planner-benchmark.json'), pub);
    writeJson(path.join(o.root, 'public', 'validation', 'planner-benchmark.json'), pub);
    // the Evidence › Validation page's file (held-out runs only; its own shape check)
    const safe = Object.values(summary.suites).every((x) => (x.algos[summary.candidate]?.safetyViolations ?? 0) === 0);
    const page = toValidationFile(summary, merged, { plannerVersion: `2.0 (${summary.candidate})`, deterministic: true, safetyTestsPassed: safe });
    if (page) {
      const problems = plannerBenchmarksProblems(page);
      if (problems.length) throw new Error(`validation page file fails its shape check: ${problems.join('; ')}`);
      writeJson(path.join(o.root, 'docs', 'validation', 'planner-benchmarks.json'), page);
    }
  }
  o.log(`done in ${((performance.now() - t0) / 60000).toFixed(1)} min; results ${path.relative(o.root, file)}${errors.length ? `; ${errors.length} error(s): ${errors.slice(0, 3).join(' | ')}` : ''}`);
  if (summary.gate) o.log(`gate: ${summary.gate.text}`);
  return { summary, file };
}
