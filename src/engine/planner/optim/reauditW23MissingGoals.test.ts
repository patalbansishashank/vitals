// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_VERSION, decodeCheckpoint, encodeCheckpoint, type PlannerCheckpointData } from './checkpoint';
import { GoalSystem, type GoalSpec } from './goals';
import { runPlanner, type PlannerConfig, type PlannerProblem } from './pipeline';
import { robustRerank, robustSummary } from './robust';
import { HOLDOUT_DRAW_OFFSET, type EvalOutput, type Evaluator, type PlanStructure } from './types';

const output = (goals: number[], missingGoals: number[] = []): EvalOutput => ({
  goals, missingGoals, margins: [1], regulariser: 0, descriptors: [0],
});

describe('A2-001: unavailable endpoints never become compatibility observations', () => {
  const cases: Array<{ goal: GoalSpec; baseline: number; compatibility: number }> = [
    { goal: { id: 'min', sense: 'min', target: 2 }, baseline: 10, compatibility: 1 },
    { goal: { id: 'max', sense: 'max', target: 10 }, baseline: 2, compatibility: 11 },
    { goal: { id: 'band', sense: 'band', band: { lo: 2, hi: 3 } }, baseline: 10, compatibility: 2.5 },
    { goal: { id: 'baseline-met', sense: 'min', target: 10 }, baseline: 10, compatibility: 1 },
    { goal: { id: 'keep', sense: 'min', target: 10, keep: 2 }, baseline: 10, compatibility: 1 },
  ];

  it.each(cases)('scores missing $goal.id at no benefit before special-case attainment', ({ goal, baseline, compatibility }) => {
    const g = new GoalSystem([goal]);
    g.setBaseline([baseline]);
    const f = g.objective([compatibility], undefined, [0]);
    expect(f[0]).toBeNaN();
    expect(g.dRaw(0, f[0]!)).toBe(0);
    expect(g.dReported(0, f[0]!)).toBe(0);
    expect(g.setFloorFrom(0, f[0]!)).toBeNaN();
    expect(g.floor(0)).toBeNaN();
    expect(g.observe(f, true)).toBe(false);
    expect(g.stageKey(0, { f, vS: 0, reg: 0 }).every(Number.isFinite)).toBe(true);
    for (const mode of ['mean', 'cvar'] as const) {
      const r = robustSummary([output([compatibility], [0])], g, { mode });
      expect(r.robustD[0]).toBe(0);
      expect(r.goals[0]!.metric.p50).toBeNaN();
      expect(r.goals[0]!.pTargetMet).toBeNaN();
      expect(r.goals[0]!.availability).toMatchObject({ status: 'unavailable', attempted: 1, available: 0, excluded: 1 });
    }
  });

  it.each(['mean', 'cvar'] as const)('retains missing members in %s ranking while withholding only their endpoint band', (mode) => {
    const g = new GoalSystem([{ id: 'min', sense: 'min', target: 2 }, { id: 'max', sense: 'max', target: 10 }]);
    g.setBaseline([10, 0]);
    const complete = robustSummary([output([6, 5]), output([6, 5])], g, { mode });
    const mixed = robustSummary([output([6.4, 5]), output([1, 5], [0])], g, { mode });
    expect(mixed.draws).toBe(2);
    expect(mixed.goals[0]!.availability).toMatchObject({ status: 'partial', attempted: 2, available: 1, excluded: 1, memberAvailable: [true, false], policy: 'allRequiredMembers' });
    expect(mixed.goals[0]!.metric.p10).toBeNaN();
    expect(mixed.goals[0]!.p90).toBeNaN();
    expect(mixed.goals[0]!.pTargetMet).toBeNaN();
    expect(mixed.robustD[0]).toBeCloseTo(mode === 'mean' ? 0.225 : 0);
    expect(mixed.goals[1]!.metric.p50).toBe(5);
    expect(mixed.goals[1]!.availability.status).toBe('complete');
    expect(robustRerank([mixed, complete], g)).toEqual([1, 0]);
  });

  it('abstains on missing baseline scales, including keep/band, and restores that mask', () => {
    for (const { goal, baseline, compatibility } of cases) {
      const g = new GoalSystem([goal, { id: 'supported', sense: 'max', target: 10 }]);
      g.setBaseline([baseline, 0], [0]);
      expect(g.status(0)).toBe('unavailable');
      expect(g.scale(0).b).toBeNaN();
      expect(g.scale(0).a).toBeNaN();
      expect(g.scale(0).u).toBeNaN();
      expect(g.objective([compatibility, 5])[0]).toBeNaN();
      const restored = new GoalSystem(g.goals);
      restored.setState(g.getState());
      expect(restored.status(0)).toBe('unavailable');
      const r = robustSummary([output([compatibility, 5])], restored);
      expect(r.goals[0]!.availability.reasons).toContain('baselineUnavailable');
      expect(r.goals[0]!.metric.mean).toBeNaN();
      expect(r.robustD[0]).toBe(0);
      expect(r.goals[1]!.metric.mean).toBe(5);
      expect(r.robustD[1]).toBe(0.5);
    }
  });
});

const structures: PlanStructure[] = ['baseline', 'supported', 'unavailable'].map((id) => ({ id, dim: 1, x0: [0.5] }));
const problem: PlannerProblem<PlanStructure> = {
  structures,
  baseline: { structure: 0, x: [0.5] },
  goals: [{ id: 'loss', sense: 'min', target: 2 }],
  seeds: [{ structure: 1, x: [0.5] }, { structure: 2, x: [0.5] }],
};
const config: PlannerConfig = {
  seed: 'A2-001', totalEU: 900, tier: 'S', ensembleSize: 8, holdoutSize: 8,
  cvtSamples: 100, archiveCells: 12, maxFinalists: 8, optionCount: 3, diagnostics: true,
};

describe('A2-001 production planner paths', () => {
  it.each(['mean', 'cvar'] as const)('supported nominal/member=6 outranks nominal=6.4/member compatibility=1 in %s mode, including resume', async (robustMode) => {
    let unavailableMemberCalls = 0;
    const evaluator: Evaluator = { evaluate: (requests) => requests.map((r) => {
      if (r.structure === 2 && r.draw >= 0) unavailableMemberCalls++;
      return {
        ...output([r.structure === 0 ? 10 : r.structure === 1 ? 6 : r.draw < 0 ? 6.4 : 1], r.structure === 2 && r.draw >= 0 ? [0] : []),
        descriptors: [r.structure / 2],
      };
    }) };
    const saved: string[] = [];
    const cfg = { ...config, robustMode };
    const full = await runPlanner(problem, evaluator, { ...cfg, checkpoint: { save: (cp) => { saved.push(encodeCheckpoint(cp)); } } });
    expect(unavailableMemberCalls).toBeGreaterThan(0);
    expect(full.options[0]!.structure.id).toBe('supported');
    expect(full.options[0]!.robustSelection!.goals[0]!.metric.mean).toBe(6);
    expect(full.options[0]!.robust!.goals[0]!.metric.mean).toBe(6);
    expect(full.options[0]!.goalAvailability[0]!.status).toBe('complete');
    for (const o of full.options.filter((o) => o.structure.id === 'unavailable')) {
      expect(o.robustSelection!.robustD[0]).toBe(0);
      expect(o.robust!.goals[0]!.pTargetMet).toBeNaN();
      expect(o.goalAvailability[0]!.status).toBe('unavailable');
    }
    const checkpoint = decodeCheckpoint(saved[Math.floor(saved.length / 2)]!);
    expect(CHECKPOINT_VERSION).toBe(8);
    const resumed = await runPlanner(problem, evaluator, { ...cfg, checkpoint: { save: () => {}, resume: checkpoint } });
    expect(resumed.provenance.resumedFrom).toBe(checkpoint.label);
    expect(resumed.options.map((o) => [o.structure.id, o.goalAvailability, o.robustSelection, o.robust])).toEqual(
      full.options.map((o) => [o.structure.id, o.goalAvailability, o.robustSelection, o.robust]),
    );
  });

  it('withholds a mixed holdout endpoint without erasing complete selection coverage or another endpoint', async () => {
    const two = { ...problem, goals: [...problem.goals, { id: 'other', sense: 'max' as const, target: 10 }] };
    const evaluator: Evaluator = { evaluate: (requests) => requests.map((r) => output(
      [r.structure === 0 ? 10 : 6, r.structure === 0 ? 0 : 5],
      r.draw >= HOLDOUT_DRAW_OFFSET && r.draw % 2 === 0 ? [0] : [],
    )) };
    const r = await runPlanner(two, evaluator, config);
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.robustSelection!.goals[0]!.availability.status).toBe('complete');
      expect(o.robust!.goals[0]!.availability.status).toBe('partial');
      expect(o.robust!.goals[0]!.availability).toMatchObject({ attempted: 8, available: 4, excluded: 4 });
      expect(o.robust!.goals[0]!.metric.p50).toBeNaN();
      expect(o.robust!.goals[0]!.pTargetMet).toBeNaN();
      expect(o.goalAvailability[0]!.status).toBe('partial');
      expect(o.robust!.goals[1]!.availability.status).toBe('complete');
      expect(o.robust!.goals[1]!.metric.p50).toBe(5);
    }
  });

  it('carries nominal availability into public options and family rows without an ensemble', async () => {
    const two = {
      ...problem,
      goals: [...problem.goals, { id: 'other', sense: 'max' as const, target: 10 }],
      group: (structure: number) => String(structure),
    };
    const evaluator: Evaluator = { evaluate: (requests) => requests.map((r) => ({
      ...output([r.structure === 0 ? 10 : 1, r.structure === 0 ? 0 : 5], r.structure === 0 ? [] : [0]),
      descriptors: [r.structure / 2],
    })) };
    const r = await runPlanner(two, evaluator, { ...config, ensembleSize: 0 });
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.robust).toBeNull();
      expect(o.metricValues[0]).toBeNaN();
      expect(o.desirability[0]).toBe(0);
      expect(o.goalAvailability[0]).toMatchObject({ status: 'unavailable', attempted: 1, available: 0 });
      expect(o.goalAvailability[1]!.status).toBe('complete');
      expect(o.metricValues[1]).toBe(5);
    }
    expect(r.groupBest!['1']!.metricValues[0]).toBeNaN();
    expect(r.groupBest!['1']!.goalAvailability[0]!.status).toBe('unavailable');
  });

  it('retains the missing-baseline mask through production checkpoint reconstruction while planning supported goals', async () => {
    const two = { ...problem, goals: [...problem.goals, { id: 'other', sense: 'max' as const, target: 10 }] };
    const evaluator: Evaluator = { evaluate: (requests) => requests.map((r) => output(
      [r.structure === 0 ? 10 : 1, r.structure === 0 ? 0 : 5], r.structure === 0 ? [0] : [],
    )) };
    let cp: PlannerCheckpointData | undefined;
    const full = await runPlanner(two, evaluator, { ...config, checkpoint: { save: (next) => { if (next.phase === 2) cp = decodeCheckpoint(encodeCheckpoint(next)); } } });
    expect(cp).toBeDefined();
    expect(full.goals.status).toEqual(['unavailable', 'active']);
    expect(full.options[0]!.metricValues[0]).toBeNaN();
    expect(full.options[0]!.robust!.goals[0]!.metric.mean).toBeNaN();
    expect(full.options[0]!.robust!.goals[1]!.metric.mean).toBe(5);
    const resumed = await runPlanner(two, evaluator, { ...config, checkpoint: { save: () => {}, resume: cp! } });
    expect(resumed.goals).toEqual(full.goals);
    expect(resumed.options.map((o) => [o.structure.id, o.goalAvailability])).toEqual(full.options.map((o) => [o.structure.id, o.goalAvailability]));
  });

  it('refreshes endpoint coverage when chance repair replaces a finalist', async () => {
    const one: PlannerProblem<PlanStructure> = {
      structures: [{ id: 'repair', dim: 1, x0: [0.8] }],
      baseline: { structure: 0, x: [0] },
      goals: [{ id: 'loss', sense: 'min', target: 2 }],
    };
    let repairedDraws = 0;
    const evaluator: Evaluator = { evaluate: (requests) => requests.map((r) => {
      const x = r.x[0]!;
      const missing = r.draw >= 0 && x < 0.75 && r.draw % 2 === 1;
      if (r.draw >= 0 && r.draw < HOLDOUT_DRAW_OFFSET && x > 0.01 && x < 0.75) repairedDraws++;
      return { ...output([missing ? 1 : 10 - 4 * x], missing ? [0] : []), margins: [r.draw < 0 ? 0.8 - x : (r.draw % 2 === 0 ? 0.6 : 1) - x] };
    }) };
    const r = await runPlanner(one, evaluator, { ...config, totalEU: 3000, optionCount: 1, ocba: false });
    expect(repairedDraws).toBeGreaterThan(0);
    expect(r.options.length).toBe(1);
    const o = r.options[0]!;
    expect(o.x[0]!).toBeLessThan(0.75);
    expect(o.robustSelection!.chanceFeasible).toBe(true);
    expect(o.robustSelection!.goals[0]!.availability.status).toBe('partial');
    expect(o.robustSelection!.goals[0]!.metric.mean).toBeNaN();
    expect(o.robustSelection!.goals[0]!.pTargetMet).toBeNaN();
    expect(o.robustSelection!.robustD[0]!).toBeLessThanOrEqual(0.2);
    expect(o.robust!.goals[0]!.availability.status).toBe('partial');
  });
});
