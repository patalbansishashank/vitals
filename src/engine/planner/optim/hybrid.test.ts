// @vitest-environment node
/** Hybrid algorithm (v1 decides Hard, v2 builds the ladder): Hard is v1's option A, the budget is shared, v2 stays selectable. */
import { describe, expect, it } from 'vitest';
import { runPlannerV1, type PlannerProblemV1 } from '../bench/baselines/v1';
import { runPlannerWith, hybridLadderShare } from './hybrid';
import { TIER_BUDGET_EU, createLocalEvaluator } from './pipeline';
import { ladderToy, type ToyStructure } from './toys';

describe('hybrid planner algorithm', () => {
  it('pins Hard to the v1 planner’s own option A (same seed, full budget) and runs the ladder on top', async () => {
    const toy = ladderToy();
    const ev = () => createLocalEvaluator(toy.model, toy.problem.structures);
    const cfg = { seed: 'hy', tier: 'S' as const, cvtSamples: 2000, ensembleSize: 8, holdoutSize: 8 };
    const res = await runPlannerWith('hybrid', toy.problem, ev(), cfg);
    const { ladder: _l, ...p1 } = toy.problem;
    const v1 = await runPlannerV1(p1 as unknown as PlannerProblemV1<ToyStructure>, ev(), { seed: 'hy', tier: 'S', ensembleSize: 8 });
    const hard = res.options.find((o) => o.rung === 'hard');
    expect(hard).toBeDefined();
    expect([hard!.structureIndex, Array.from(hard!.x)]).toEqual([v1.options[0]!.structureIndex, Array.from(v1.options[0]!.x)]);
    const total = TIER_BUDGET_EU.S + Math.floor(hybridLadderShare('S') * TIER_BUDGET_EU.S);
    expect(res.provenance.budgetEU).toBe(total);
    expect(res.provenance.euUsed).toBeLessThanOrEqual(total);
    expect(res.provenance.stageEU['v1.search']).toBeGreaterThan(0);
    expect(res.provenance.stageEU['hybrid.pinnedHard']).toBe(1);
  }, 120_000);

  it("'v2' and problems without a ladder run the v2 pipeline alone", async () => {
    const toy = ladderToy();
    const res = await runPlannerWith('v2', toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { seed: 'hy2', tier: 'S', cvtSamples: 2000, ensembleSize: 8, holdoutSize: 8 });
    expect(res.provenance.stageEU['v1.search']).toBeUndefined();
  }, 120_000);
});
