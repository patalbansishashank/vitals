// @vitest-environment node
/**
 * Evidence-coverage audit check 6 (PLANNER_V2_SPEC §6.3; R6 §7.2 item 6): explanation honesty. One small planner run
 * (tier S, small budget) with fasting offered; then, independently of the planner's own bookkeeping:
 *  - every claimed lever contribution re-verifies by ablation: the plan and its neutralised variant (the planner's own
 *    ablation definitions) are decoded, repaired and simulated again, and goal 1 differs by the reported amount;
 *  - every fasting rival's numbers re-verify: the rival plan (the best plan with a fast the search kept) and the option
 *    are re-simulated in the Simulator's mode, and the per-goal differences equal the reported ones; the stated reason
 *    agrees with the numbers;
 *  - C6 (W1: D1-05, D7-07, D8-02): every goal score states its capability and status; a status that withholds the
 *    objective shows no range and asserts no target; ranges are parameter-sensitivity ranges with unvalidated coverage
 *    from stochastic members only; non-objective outcomes (adherence, keto adaptation, IGF-1, BMD, micronutrient score,
 *    generic endurance) never compile, never open fasting and never get a "what moves this goal" lever.
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
import { GOAL_CAPABILITY, type MetricId } from '../../../types/metrics';
import { objectiveEdgesTo } from '../evidenceGraph';
import { INTERPRETABLE_STATUSES } from '@/lib/bodyContracts';

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

/**
 * A focused contribution fixture: improving aerobic fitness makes cardio serve the primary goal. It uses the supported
 * v2 path with the same audit budget, so coverage does not depend on optional explanation work fitting into the hybrid's
 * smaller ladder allocation after safety checks. The hybrid fasting request above still audits every claim it emits.
 * No particular lever is required to win; the ablation check below still requires at least one real metric-unit claim.
 */
const CONTRIBUTION_REQUEST: PlannerRequest = {
  ...REQUEST,
  goals: [{ metric: 'vo2max', direction: 'maximise' }],
  constraints: { fasting: 'none' },
  seed: 'audit-honesty-cardio',
};

describe('check 6: explanation honesty', () => {
  let res: PlannerResult;
  let raw: OptimResult<SkeletonStructure> | undefined;
  let contributionResult: PlannerResult;
  let contributionRaw: OptimResult<SkeletonStructure> | undefined;
  const ctx = compileRequest(REQUEST);
  const structures = enumerateStructures(ctx, 100000);
  const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
  const planner = new EnginePlanModel(ctx, { bindings });
  const contributionContext = compileRequest(CONTRIBUTION_REQUEST);
  const contributionStructures = enumerateStructures(contributionContext, 100000);
  const contributionModel = new EnginePlanModel(contributionContext, { bindings: contributionContext.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass })) });
  const goalsOf = (st: SkeletonStructure, x: Float64Array, model: EnginePlanModel) => model.goals(model.simulate(model.repair(st, model.decode(st, x)).schedule, -1));

  it('runs the planner once (tier S)', { timeout: 300_000 }, async () => {
    // the audit's own run budget (900 EU, the old value, finds no safe plan for this request since the v2 pipeline)
    res = await runDomainPlanner(REQUEST, { tier: AUDIT_RUN.tier, totalEU: AUDIT_RUN.totalEU, timeToTarget: false, onOptimResult: (r) => (raw = r) });
    expect(res.status).toBe('ok');
    expect(res.options.length).toBeGreaterThan(0);
    expect(raw?.options.length).toBeGreaterThan(0);
    contributionResult = await runDomainPlanner(CONTRIBUTION_REQUEST, { tier: AUDIT_RUN.tier, totalEU: AUDIT_RUN.totalEU, algorithm: 'v2', timeToTarget: false, onOptimResult: (r) => (contributionRaw = r) });
    expect(contributionResult.status).toBe('ok');
    expect(contributionRaw?.options.length).toBeGreaterThan(0);
  });

  it('every claimed lever contribution re-verifies by ablation (goal 1, metric units)', { timeout: 120_000 }, () => {
    let checked = 0;
    const bad: string[] = [];
    const check = (result: PlannerResult, optim: OptimResult<SkeletonStructure>, sts: readonly SkeletonStructure[], model: EnginePlanModel) =>
      result.options.forEach((o, k) => {
        // the optimiser's options come in the same order as the result's (A/B/C, or the rungs Hard/Medium/Easy)
        const r = optim.options[k];
        if (!r) return;
        const i = sts.findIndex((s) => s.id === r.structure.id);
        expect(i, `${r.structure.id} is enumerated`).toBeGreaterThanOrEqual(0);
        const variants = ablationsFor(sts, i, r.x);
        const g0 = goalsOf(sts[i]!, r.x, model)[0]!;
        for (const c of o.contributions) {
          if (c.deltaGoal1Metric === undefined) continue;
          const v = variants.find((a) => a.label === c.label);
          if (!v) {
            bad.push(`${o.id}: no ablation "${c.label}"`);
            continue;
          }
          const d = g0 - goalsOf(sts[v.structure]!, v.x, model)[0]!;
          checked++;
          if (Math.abs(d - c.deltaGoal1Metric) > 1e-3 + 1e-3 * Math.abs(d)) bad.push(`${o.id} "${c.label}": reported ${c.deltaGoal1Metric}, re-run ${d.toFixed(4)}`);
        }
      });
    check(res, raw!, structures, planner);
    check(contributionResult, contributionRaw!, contributionStructures, contributionModel);
    expect(bad).toEqual([]);
    expect(checked, `Contribution fixture: ${JSON.stringify({ stageEU: contributionRaw?.provenance.stageEU, options: contributionResult.options.map(o => ({ id: o.id, claims: o.contributions.length })) })}`).toBeGreaterThan(0);
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

  it('C6: every score states its capability and status; withheld statuses show no range or target; bands are sensitivity ranges (D8-02)', () => {
    let scores = 0;
    for (const r of [res, contributionResult]) {
      for (const o of r.options) {
        for (const sc of o.scorecard) {
          scores++;
          expect(sc.capability, sc.metric).toBe(GOAL_CAPABILITY[sc.metric as MetricId].availability);
          expect(sc.status, sc.metric).toBeDefined();
          // a status that forbids interpretation, or a guarded objective (Limited with a partition / ketogenic reason),
          // shows no range and asserts no target
          if (!INTERPRETABLE_STATUSES.has(sc.status!)) {
            expect(sc.band, sc.metric).toBeNull();
            expect(sc.met, sc.metric).toBeNull();
          }
          if (sc.band) {
            expect(sc.bandMeta, sc.metric).toMatchObject({ method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', nominalInQuantiles: false });
            expect(sc.bandMeta!.draws).toBeGreaterThan(0);
          }
        }
        for (const [id, b] of Object.entries(o.bands?.series ?? {})) {
          expect(b!.meta, id).toMatchObject({ method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', nominalInQuantiles: false });
          expect(b!.meta!.draws, id).toBeGreaterThan(0);
          expect(b!.meta!.draws, id).toBeLessThanOrEqual(o.bands!.draws);
        }
      }
    }
    expect(scores).toBeGreaterThan(0);
  });
});

describe('check 6b: no explanation credits an outcome without an optimizable capability (C6)', () => {
  const NON_OBJECTIVE: MetricId[] = ['adherence', 'ketoAdaptation', 'igf1', 'hipBmdChange', 'micronutrientScore', 'enduranceCapacity', 'menstrualRisk', 'moodTier'];

  it('saved goals on them resolve to Review, never compile, open no fasting and have no steering edges', () => {
    for (const metric of NON_OBJECTIVE) {
      const ctx = compileRequest({ ...REQUEST, goals: [{ metric, direction: 'maximise' }, REQUEST.goals[0]!] });
      expect(ctx.goals.map((g) => g.metric), metric).toEqual(['fatMass']);
      expect(ctx.goalReviews?.find((r) => r.metric === metric)?.resolution, metric).toBe('pendingReview');
      // the refused goal (rank 1) never serves fasting; the fat-loss goal (rank 2) may
      expect(ctx.fastingServedGoal, metric).not.toBe(0);
      expect(objectiveEdgesTo(metric), metric).toEqual([]);
    }
  });
});
