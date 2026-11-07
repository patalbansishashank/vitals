/**
 * Hybrid planner algorithm (E6 benchmark ruling, 2026-10-01): the frozen v1 search proposes Hard (goal-1 quality), the
 * v2 pipeline builds the ladder (Medium, Easy) around it; the caller runs the Ideal on top as before.
 *
 * Why: on the held-out benchmark v2 was better on the ladder (hypervolume) and no worse on the synthetic suites, but not
 * shown non-inferior to v1 on goal-1 quality for full requests (R2). The ruling ships v2 as the default only when it
 * passes that gate; otherwise this hybrid, with v2 kept selectable (`PlannerAlgorithm`). docs/PLANNER_BENCHMARK.md has
 * both results.
 *
 * Budget: v1 runs its whole tier budget (with the same seed its option A is exactly the v1 planner's), and v2 gets the
 * tier's QD + ladder + robust shares on top for the rungs (about +37 % EU; tier M still ≈ 30 s on 8 workers). A
 * budget-neutral split (v1 on the goal-1 share only) was measured and failed the gate on R1, R2 and T4
 * (docs/PLANNER_BENCHMARK.md). Tier X has no v1 tier and always runs v2 alone.
 *
 * D4-09 production adapter (`PLANNER_COMPARISON_POLICY` v2, `./policy`): the frozen v1 package stays the historical
 * benchmark comparator, untouched; here its option A is only a proposal. The v2 run revalidates it (validator, joint
 * screen, independent safety audit) and it becomes Hard only when it is not worse than v2's own Hard finalists under
 * the production Hard key — the same quantised goal-first comparison the stages, floors, chance repair and rungs use —
 * with ties going to the proposal. So the shipped Hard never comes from v1's d − η·R stage comparator.
 * `stageEU['hybrid.pinnedHard']` reports whether the proposal won; the domain result records the policy version and
 * fingerprint (`provenance.policyVersion` / `policyFingerprint`).
 */
import { runPlannerV1, type PlannerConfigV1, type PlannerProblemV1 } from '../bench/baselines/v1';
import { TIER_BUDGET_EU, TIER_SHARES, runPlanner, type PlannerConfig, type PlannerProblem, type PlannerResult } from './pipeline';
import type { Evaluator, PlanStructure } from './types';

export { PLANNER_COMPARISON_POLICY, PLANNER_POLICY_FINGERPRINT } from './policy';

export type PlannerAlgorithm = 'hybrid' | 'v2';
/** The shipped default (benchmark gate, docs/PLANNER_BENCHMARK.md). */
export const DEFAULT_PLANNER_ALGORITHM: PlannerAlgorithm = 'hybrid';

/** Share of the tier total the hybrid gives the v2 ladder run on top of v1's full budget (QD + ladder + robust). */
export function hybridLadderShare(tier: 'S' | 'M' | 'L'): number {
  const sh = TIER_SHARES[tier];
  return sh.qd + sh.ladder + sh.robust;
}

/** Run `algorithm` on a problem; 'v2' (or no ladder, or tier X) is `runPlanner`. */
export async function runPlannerWith<S extends PlanStructure>(
  algorithm: PlannerAlgorithm,
  problem: PlannerProblem<S>,
  evaluator: Evaluator,
  cfg: PlannerConfig,
): Promise<PlannerResult<S>> {
  const tier = cfg.tier ?? 'S';
  if (algorithm === 'v2' || !problem.ladder || tier === 'X' || cfg.checkpoint) return runPlanner(problem, evaluator, cfg);
  const b1 = cfg.totalEU ?? TIER_BUDGET_EU[tier];
  const b2 = Math.max(1, Math.floor(hybridLadderShare(tier) * b1));
  const total = b1 + b2;
  const { ladder, ...p1 } = problem;
  const c1: PlannerConfigV1 = { seed: cfg.seed, tier, totalEU: b1 };
  if (cfg.ensembleSize !== undefined) c1.ensembleSize = cfg.ensembleSize;
  if (cfg.strictness) c1.strictness = cfg.strictness;
  if (cfg.signal) c1.signal = cfg.signal;
  const onProgress = cfg.onProgress;
  if (onProgress) c1.onProgress = (q) => onProgress({ stage: q.stage, euUsed: q.euUsed, euBudget: total, archiveSize: q.archiveSize, provisional: q.provisional });
  const r1 = await runPlannerV1(p1 as unknown as PlannerProblemV1<S>, evaluator, c1);
  const a = r1.options[0];
  const used1 = r1.provenance.euUsed;
  const c2: PlannerConfig = { ...cfg, totalEU: Math.max(1, total - used1) };
  // v1's unused EU rolls over to the ladder run
  if (onProgress) c2.onProgress = (q) => onProgress({ ...q, euUsed: q.euUsed + used1, euBudget: total });
  // v1 found no plan: v2 searches alone with what is left. The pinned Hard is revalidated by the v2 run (its own
  // validator, joint selection screen and independent safety audit, C5/D4-03): v1's own chance check is not trusted
  const res = await runPlanner(a ? { ...problem, ladder: { ...ladder!, pinHard: { structure: a.structureIndex, x: a.x } } } : problem, evaluator, c2);
  // the ladder run returned nothing although v1 found a plan (its short budget found no safe Hard and the pinned plan
  // did not reach its finalists; 7 of 240 held-out full requests): the v2 search alone with the tier budget, which never
  // returned an empty result on the benchmark
  if (!res.options.length && a && !cfg.signal?.aborted) {
    const used2 = res.provenance.euUsed;
    const c3: PlannerConfig = { ...cfg, totalEU: b1 };
    if (onProgress) c3.onProgress = (q) => onProgress({ ...q, euUsed: q.euUsed + used1 + used2, euBudget: total + b1 });
    const alone = await runPlanner(problem, evaluator, c3);
    alone.provenance.budgetEU = total + b1;
    alone.provenance.euUsed += used1 + used2;
    alone.provenance.stageEU = { ...alone.provenance.stageEU, 'v1.search': used1, 'hybrid.ladderRun': used2, 'hybrid.pinnedHard': 0, 'hybrid.v2Fallback': 1 };
    return alone;
  }
  // Hard is v1's option A unless the ladder run could not validate it (then v2's own Hard; reported for the benchmark)
  const hard = res.options.find((o) => o.rung === 'hard');
  const pinned = !!a && !!hard && hard.structureIndex === a.structureIndex && hard.x.every((v, i) => Math.abs(v - a.x[i]!) <= 1e-6);
  res.provenance.budgetEU = total;
  res.provenance.stageEU = { ...res.provenance.stageEU, 'hybrid.pinnedHard': pinned ? 1 : 0 };
  res.provenance.euUsed += used1;
  res.provenance.stageEU = { ...res.provenance.stageEU, 'v1.search': used1 };
  return res;
}
