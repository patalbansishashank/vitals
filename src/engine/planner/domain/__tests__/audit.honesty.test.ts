// @vitest-environment node
/**
 * Evidence-coverage audit check 6 (PLANNER_V2_SPEC §6.3; R6 §7.2 item 6): explanation honesty. One small planner run
 * (tier S, small budget) with fasting offered; then, independently of the planner's own bookkeeping:
 *  - every claimed lever contribution re-verifies by ablation: the plan and its neutralised variant (the planner's own
 *    ablation definitions) are decoded, repaired and simulated again, and goal 1 differs by the reported amount;
 *  - every fasting rival's numbers re-verify: the rival plan (the best plan with a fast the search kept) and the option
 *    are re-simulated in the Simulator's mode, and the per-goal differences equal the reported ones; the stated reason
 *    agrees with the numbers.
 */
import { describe, expect, it } from 'vitest';
import type { PlannerResult as OptimResult } from '../../optim/pipeline';
import { compileRequest } from '../context';
import { EnginePlanModel } from '../model';
import { ablationsFor, equalEnergyFastTwins, nearestFastingStructures, runDomainPlanner } from '../planner';
import { enumerateStructures, transferGenome as transfer, type SkeletonStructure } from '../skeleton';
import type { PlannerRequest, PlannerResult } from '../types';
import { CORPUS_PERSONAS } from '../../audit/corpus';
import { AUDIT_RUN } from '../../audit/plan';

const REQUEST: PlannerRequest = {
  profile: CORPUS_PERSONAS.man88!,
  goals: [
    { metric: 'fatMass', direction: 'target', target: -5, targetKind: 'change' },
    { metric: 'leanTissue', direction: 'maximise' },
  ],
  horizonDays: 56,
  safety: { optIns: { fastingTier: 'T2' } },
  seed: 'audit-honesty',
};

describe('check 6: explanation honesty', () => {
  let res: PlannerResult;
  let raw: OptimResult<SkeletonStructure> | undefined;
  const ctx = compileRequest(REQUEST);
  const structures = enumerateStructures(ctx, 100000);
  const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
  const planner = new EnginePlanModel(ctx, { bindings });
  const goalsOf = (st: SkeletonStructure, x: Float64Array, model: EnginePlanModel) => model.goals(model.simulate(model.repair(st, model.decode(st, x)).schedule, -1));

  it('runs the planner once (tier S)', { timeout: 300_000 }, async () => {
    // the audit's own run budget (900 EU, the old value, finds no safe plan for this request since the v2 pipeline)
    res = await runDomainPlanner(REQUEST, { tier: AUDIT_RUN.tier, totalEU: AUDIT_RUN.totalEU, timeToTarget: false, onOptimResult: (r) => (raw = r) });
    expect(res.status).toBe('ok');
    expect(res.options.length).toBeGreaterThan(0);
    expect(raw?.options.length).toBeGreaterThan(0);
  });

  it('every claimed lever contribution re-verifies by ablation (goal 1, metric units)', { timeout: 120_000 }, () => {
    let checked = 0;
    const bad: string[] = [];
    res.options.forEach((o, k) => {
      // the optimiser's options come in the same order as the result's (A/B/C, or the rungs Hard/Medium/Easy)
      const r = raw!.options[k];
      if (!r) return;
      const i = structures.findIndex((s) => s.id === r.structure.id);
      expect(i, `${r.structure.id} is enumerated`).toBeGreaterThanOrEqual(0);
      const variants = ablationsFor(structures, i, r.x);
      const g0 = goalsOf(structures[i]!, r.x, planner)[0]!;
      for (const c of o.contributions) {
        if (c.deltaGoal1Metric === undefined) continue;
        const v = variants.find((a) => a.label === c.label);
        if (!v) {
          bad.push(`${o.id}: no ablation "${c.label}"`);
          continue;
        }
        const d = g0 - goalsOf(structures[v.structure]!, v.x, planner)[0]!;
        checked++;
        if (Math.abs(d - c.deltaGoal1Metric) > 1e-3 + 1e-3 * Math.abs(d)) bad.push(`${o.id} "${c.label}": reported ${c.deltaGoal1Metric}, re-run ${d.toFixed(4)}`);
      }
    });
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('every fasting rival’s numbers re-verify in the Simulator’s mode, and its reason agrees with them', { timeout: 120_000 }, () => {
    const full = new EnginePlanModel(ctx, { bindings, fullMode: true, recordAll: true });
    const groups = Object.values(raw!.groupBest ?? {}) as Array<{ structureId: string; x: Float64Array }>;
    let checked = 0;
    const bad: string[] = [];
    res.options.forEach((o, k) => {
      const rival = o.fasting?.rival;
      if (!rival) return;
      // reason vs numbers: "goalLoss" means the rival is worse on the first goal whose level differs
      if (rival.reason === 'goalLoss') {
        const first = rival.goalDeltas.find((g) => Math.abs(g.delta) > 1e-9);
        const sense = (gi: number) => (ctx.goals[gi]!.direction === 'maximise' || (ctx.goals[gi]!.spec.target ?? 0) > 0 ? 1 : -1);
        if (first && first.delta * sense(first.goal) > 0) bad.push(`${o.id}: goalLoss although the rival is better on goal ${first.goal + 1}`);
      }
      const r = raw!.options[k];
      if (!r) return;
      const oi = structures.findIndex((s) => s.id === r.structure.id);
      const si = structures.findIndex((s) => s.id === rival.structureId);
      // the rival is shared by all rungs: an equal-energy fasting twin of the Hard plan (option 0), else the run's best plan
      // with a fast (its family's best), else the Hard plan's genome on the nearest fasting structure
      const h = raw!.options[0]!;
      const hi = structures.findIndex((s) => s.id === h.structure.id);
      const rv =
        equalEnergyFastTwins(ctx, structures, hi, h.x).find((t) => t.structure === si) ??
        groups.find((g) => g.structureId === rival.structureId) ??
        (nearestFastingStructures(structures, hi, 4).includes(si) ? { x: transfer(structures[hi]!, structures[si]!, h.x) } : undefined);
      if (!rv) {
        bad.push(`${o.id}: rival ${rival.structureId} not found among the Hard plan's fasting twins, the family bests and the nearest fasting structures`);
        return;
      }
      const gr = goalsOf(structures[si]!, rv.x, full);
      const go = goalsOf(structures[oi]!, r.x, full);
      for (const gd of rival.goalDeltas) {
        const d = gr[gd.goal]! - go[gd.goal]!;
        checked++;
        if (Math.abs(d - gd.delta) > 2e-3 + 1e-3 * Math.abs(d)) bad.push(`${o.id} vs rival ${rival.structureId}, goal ${gd.goal + 1}: reported ${gd.delta}, re-run ${d.toFixed(4)}`);
      }
    });
    expect(bad).toEqual([]);
    // the run offers fasting for a fat-loss goal; an option without a fast must name its rival
    const withRival = res.options.filter((o) => o.fasting?.rival).length;
    expect(res.fasting?.offered).toBe(true);
    expect(withRival + res.options.filter((o) => o.fasting?.used).length).toBe(res.options.length);
    expect(checked).toBe(res.options.reduce((n, o) => n + (o.fasting?.rival?.goalDeltas.length ?? 0), 0));
  });
});
