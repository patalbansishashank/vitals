// @vitest-environment node
/**
 * Smoke subset of the planner benchmark in `pnpm test` (≤ 60 s): the sphere, one planted-priorities problem, one
 * needle problem, one frontier problem and one small real plan space (searched exhaustively), 3 seeds each, run with
 * the live optimiser in-process. Asserts that the metrics pipeline produces sane numbers and that the live optimiser
 * is not worse than the stored baseline summary by more than the acceptance gate's non-inferiority margins.
 *
 * UPDATE_BENCH_BASELINE=1 rewrites `reference/smoke-baseline.json` from the live optimiser (after a planner release);
 * UPDATE_BENCH_BASELINE=v1 from the frozen v1 optimiser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leak } from '../../../content/evidence/__tests__/leakScan';
import { evaluateRuns, type RunMetrics } from './evaluate';
import { localEnv, runJob } from './jobs';
import { markdown, summarise } from './report';
import { referenceDir, referenceKey } from './runner';
import { r1Reference } from './suites/domain';
import { toySpecs } from './suites/toys';
import { GATE } from './stats';
import type { AlgoId, ProblemSpec, ReferenceSummary, RunRecord } from './types';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SEEDS = [1, 2, 3];
const R1_EU = 300;
const BASELINE_FILE = path.join(referenceDir(ROOT), 'smoke-baseline.json');

interface SmokeBaseline {
  algo: AlgoId;
  refKey: string;
  problems: Record<string, { lexSuccess: number; r1: number }>;
}

function smokeSpecs(): ProblemSpec[] {
  const pick = (s: 'T1' | 'T2' | 'T3' | 'T4', id: string) => toySpecs(s, 'train').find((p) => p.id.endsWith(id))!;
  return [
    pick('T1', 'sphere-10'),
    pick('T2', 'k2-s4'),
    pick('T3', 's50'),
    pick('T4', 'convex-5'),
    { suite: 'R1', id: 'R1/smoke-c', split: 'train', params: { request: 'c', minPlans: 400, maxPlans: 1500, maxStructures: 1 }, real: true },
  ];
}

async function smokeRun(algo: AlgoId, r1Ref: ReferenceSummary): Promise<RunRecord[]> {
  const env = localEnv(() => performance.now());
  const out: RunRecord[] = [];
  let id = 0;
  for (const spec of smokeSpecs())
    for (const seed of SEEDS) {
      const res = await runJob(
        { kind: 'run', id: ++id, spec, seed, tier: 'S', algos: [algo], ...(spec.suite === 'R1' ? { reference: r1Ref, totalEU: R1_EU } : {}) },
        env,
      );
      if (res.kind === 'run') out.push(...res.records);
    }
  return out;
}

function perProblem(ms: readonly RunMetrics[]): SmokeBaseline['problems'] {
  const out: SmokeBaseline['problems'] = {};
  for (const p of [...new Set(ms.map((m) => m.problem))]) {
    const g = ms.filter((m) => m.problem === p);
    out[p] = { lexSuccess: g.reduce((s, m) => s + m.lexSuccess, 0) / g.length, r1: g.reduce((s, m) => s + m.r1, 0) / g.length };
  }
  return out;
}

describe('planner benchmark smoke', () => {
  it('metrics pipeline on five problems × 3 seeds; live optimiser within the non-inferiority margins of the stored baseline', async () => {
    const refKey = referenceKey(ROOT);
    const cacheFile = path.join(ROOT, 'node_modules', '.cache', 'planner-bench', `smoke-r1-${refKey}.json`);
    let r1Ref: ReferenceSummary;
    try {
      r1Ref = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ReferenceSummary;
    } catch {
      r1Ref = await r1Reference(smokeSpecs()[4]!, localEnv(() => performance.now()), { batch: 256, truthTop: 0 });
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(r1Ref));
    }
    expect(r1Ref.exact).toBe(true);
    expect((r1Ref.detail as { plans: number }).plans).toBeGreaterThanOrEqual(400);

    const records = await smokeRun('v2', r1Ref);
    const { metrics } = evaluateRuns(records, {});
    expect(metrics.length).toBe(5 * SEEDS.length);
    for (const m of metrics) {
      expect(m.ok, `${m.problem} seed ${m.seed}: ${m.error ?? ''}`).toBe(true);
      expect(m.safetyViolations).toBe(0);
      expect(m.hits.length).toBe(5);
      expect(Number.isFinite(m.r1) && Number.isFinite(m.attainment)).toBe(true);
      expect(m.euUsed).toBeGreaterThan(0);
      expect(m.curve.every((v) => v >= 0 && v <= 1.5)).toBe(true);
    }
    // the frontier problem carries ladder metrics, the toys a known reference
    const t4 = metrics.filter((m) => m.suite === 'T4');
    expect(t4.every((m) => m.hvRungs !== null && m.hvStair !== null && m.igdPlus !== null && m.qdCoverage !== null)).toBe(true);
    // the sphere is solved by every run
    expect(metrics.filter((m) => m.suite === 'T1').every((m) => m.lexSuccess === 1)).toBe(true);
    // the report renders and follows the copy rule
    const summary = summarise(metrics, {
      version: 1,
      date: '2026-10-01T00:00:00.000Z',
      runId: 'smoke',
      engineVersion: 'test',
      registryHash: 'test',
      libraryVersion: '1',
      machine: { cpus: 1, model: 'test', memGB: 1, node: process.version, loadAvg: [0, 0, 0], evaluators: 0, jobWorkers: 0 },
      selection: { suites: ['T1', 'T2', 'T3', 'T4', 'R1'], tier: 'S', seeds: { T: 3 }, split: 'train', algos: ['v2'], v2Api: false },
      baseline: 'v2',
      candidate: 'v2',
      durationS: 0,
      notes: [],
      perf: null,
    });
    const md = markdown(summary);
    expect(leak(md)).toBeNull();
    expect(md).toContain('Planner benchmark');

    // non-inferiority against the stored baseline summary (pooled over the smoke problems)
    const mine = perProblem(metrics);
    const upd = process.env['UPDATE_BENCH_BASELINE'];
    if (upd) {
      const algo: AlgoId = upd === 'v1' ? 'v1' : 'v2';
      const problems = algo === 'v2' ? mine : perProblem(evaluateRuns(await smokeRun('v1', r1Ref), {}).metrics);
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ algo, refKey, problems } satisfies SmokeBaseline, null, 1)}\n`);
      return;
    }
    let base: SmokeBaseline;
    try {
      base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as SmokeBaseline;
    } catch {
      // no stored summary: compare with the frozen v1 optimiser directly
      base = { algo: 'v1', refKey, problems: perProblem(evaluateRuns(await smokeRun('v1', r1Ref), {}).metrics) };
    }
    // the small real space's reference depends on the planner domain; compare it only for the same domain
    const keys = Object.keys(mine).filter((k) => base.problems[k] && (!k.startsWith('R1') || base.refKey === refKey));
    expect(keys.length).toBeGreaterThanOrEqual(4);
    const pooled = (src: SmokeBaseline['problems'], f: 'lexSuccess' | 'r1') => keys.reduce((s, k) => s + src[k]![f], 0) / keys.length;
    expect(pooled(mine, 'lexSuccess')).toBeGreaterThanOrEqual(pooled(base.problems, 'lexSuccess') - GATE.lexSuccessMargin - 1e-9);
    expect(pooled(mine, 'r1')).toBeLessThanOrEqual(pooled(base.problems, 'r1') + GATE.regretMargin + 1e-9);
  }, 120_000);
});
