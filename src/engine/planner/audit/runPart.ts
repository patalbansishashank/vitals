/** One part of the slow audit's planner runs: the jobs whose index falls to it (index mod PLAN_PARTS). */
import { PLAN_PARTS, writePart } from './cache';
import { coverageCorpus } from './corpus';
import { jobPlan, runJob, type RunSummary } from './plan';

export async function runPlanPart(part: number): Promise<void> {
  const t0 = performance.now();
  const corpus = coverageCorpus();
  const plan = jobPlan(corpus);
  const runs: RunSummary[] = [];
  for (const [i, job] of plan.jobs.entries()) {
    if (i % PLAN_PARTS !== part) continue;
    runs.push(await runJob(job, corpus, () => performance.now()));
  }
  writePart(`plan.${part}`, { ms: performance.now() - t0, plan, runs });
}
