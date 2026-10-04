/**
 * Slow audit, report: merges the parts (static, liveness, planner runs) and writes docs/PLANNER_COVERAGE.md and
 * public/validation/planner-coverage.json. Fails on an unsourced gate, a missing part, an internal reference in the text or an unexpected difference between the
 * fasting gate and the evidence graph.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { GATES } from '../domain/gates';
import { PLAN_PARTS, REPO_ROOT, readPart } from './cache';
import { coverageCorpus } from './corpus';
import { dynamicReachability, gateCosts, type JobPlan, type RunSummary } from './plan';
import { auditTiming, markdown, summarise, type LivenessPart, type PlanPart, type StaticPart } from './report';
import { QA_KEYS } from '../__tests__/qa/requests';
import type { LevelDigest, LevelTier } from './levels';
import { LEVELS_DIR, TIMING_DIR } from './levelsRun';
import { levelsMarkdown, levelsSummary, type LevelsSummary } from './levelsReport';
import before from './levels.before.json';

/** Plain names of the QA requests in the level table. */
const REQUEST_NAME: Readonly<Record<string, string>> = {
  a: 'Reference a', b: 'Reference b', c: 'Reference c', d: 'Reference d', e: 'Reference e', af: 'Autophagy first', flf: 'Fat loss first',
};

it('writes the coverage report', () => {
  const s = readPart<StaticPart>('static');
  const l = readPart<LivenessPart>('liveness');
  expect(s, 'static part').not.toBeNull();
  expect(l, 'liveness part').not.toBeNull();
  const runs = new Map<string, RunSummary>();
  let plan: JobPlan | null = null;
  let ms = 0;
  for (let i = 0; i < PLAN_PARTS; i++) {
    const p = readPart<{ ms: number; plan: JobPlan; runs: RunSummary[] }>(`plan.${i}`);
    expect(p, `planner part ${i}`).not.toBeNull();
    plan = p!.plan;
    ms = Math.max(ms, p!.ms);
    for (const r of p!.runs) runs.set(r.key, r);
  }
  const corpus = coverageCorpus();
  const planPart: PlanPart = { ms, runs: runs.size, dynamic: dynamicReachability(plan!, runs), gates: gateCosts(plan!, runs, corpus) };
  const generated = new Date(performance.timeOrigin + performance.now()).toISOString().slice(0, 10);
  const chains = QA_KEYS.map((k) => {
    const f = path.join(LEVELS_DIR, `${k}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Partial<Record<LevelTier, LevelDigest>>) : null;
  });
  expect(chains.map((c, i) => (c ? null : QA_KEYS[i])).filter(Boolean), 'level matrix chains').toEqual([]);
  const levels = levelsSummary(chains as Array<Partial<Record<LevelTier, LevelDigest>>>, before as LevelsSummary['before']);
  const sum = { ...summarise(s!, l!, planPart), levels };
  const md = markdown(sum, s!, l!, planPart) + '\n' + levelsMarkdown(levels, (k) => REQUEST_NAME[k] ?? `Generated request ${k.replace('fuzz', '')}`);
  const json = JSON.stringify(sum, null, 1);
  mkdirSync(TIMING_DIR, { recursive: true });
  writeFileSync(path.join(TIMING_DIR, 'audit.json'), JSON.stringify(auditTiming(s!, l!, planPart, generated), null, 1) + '\n');
  expect(leak(md)).toBeNull();
  expect(leak(json)).toBeNull();
  writeFileSync(`${REPO_ROOT}docs/PLANNER_COVERAGE.md`, md);
  mkdirSync(`${REPO_ROOT}public/validation`, { recursive: true });
  writeFileSync(`${REPO_ROOT}public/validation/planner-coverage.json`, json + '\n');
  expect(GATES.filter((g) => g.source === null).map((g) => g.id)).toEqual([]);
  expect(sum.fastingGateVsGraph.unexpected, 'fasting gate vs evidence graph').toEqual([]);
  expect(levels.failures, 'every ladder level is a valid card or absent with a verified reason').toEqual([]);
});
