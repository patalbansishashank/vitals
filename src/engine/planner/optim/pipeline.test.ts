// @vitest-environment node
import { GoalSystem } from './goals';
import type { PlannerConfig, PlannerResult } from './pipeline';
import {
  TIER_BUDGET_EU,
  TIER_SHARES,
  budgetForDevice,
  idealBudgetEU,
  createLocalEvaluator,
  createPooledEvaluator,
  planBudget,
  runPlanner,
} from './pipeline';
import type { ToyPlanner, ToyStructure } from './toys';
import {
  adaptationToy,
  conflictToy,
  functionToy,
  linearEnergyBalanceToy,
  microLibraryToy,
  regimesToy,
  twoGoalFrontToy,
} from './toys';
import type { EvalOutput, Evaluator } from './types';
import { violation } from './types';

const base: Partial<PlannerConfig> = { cvtSamples: 2000 };

function run(
  toy: ToyPlanner,
  cfg: Partial<PlannerConfig> = {},
  evaluator?: Evaluator,
): Promise<PlannerResult<ToyStructure>> {
  return runPlanner(toy.problem, evaluator ?? createLocalEvaluator(toy.model, toy.problem.structures), {
    seed: 'test',
    ...base,
    ...cfg,
  });
}

/** Bitwise fingerprint of everything a user would see. */
function fingerprint(r: PlannerResult<ToyStructure>): string {
  return JSON.stringify({
    options: r.options.map((o) => [
      o.label,
      o.structureIndex,
      Array.from(o.x),
      Array.from(o.desirability),
      o.robust ? Array.from(o.robust.robustD) : null,
    ]),
    floors: r.goals.floorsPhysical,
    kappa: Array.from(r.conflicts.kappa),
    eu: r.provenance.euUsed,
    requests: r.provenance.requests,
    archive: r.archive.filled,
  });
}

/** Pool of async "workers" that finish in a scrambled (but deterministic) order. */
function scrambledPool(inner: Evaluator, workers: number, chunk: number): Evaluator {
  return createPooledEvaluator(
    Array.from({ length: workers }, (_, w) => async (batch) => {
      const spins = (w * 7 + batch.length * 13 + batch[0]!.structure) % 5;
      for (let i = 0; i < spins; i++) await Promise.resolve();
      return (await inner.evaluate(batch)) as EvalOutput[];
    }),
    chunk,
  );
}

describe('budgets (PLANNER_V2_SPEC §4.8)', () => {
  it('splits every tier by its shares; ladder runs budget the Ideal on top of the total', () => {
    for (const tier of ['S', 'M', 'L', 'X'] as const) {
      const sh = TIER_SHARES[tier];
      expect(sh.race + sh.stages + sh.qd + sh.ladder + sh.ideal + sh.robust).toBeCloseTo(1, 12);
      for (let K = 1; K <= 6; K++) {
        for (const ladder of [false, true]) {
          const b = planBudget(tier, K, undefined, ladder);
          const T = TIER_BUDGET_EU[tier];
          expect(b.total).toBe(T);
          expect(b.ideal).toBe(ladder ? idealBudgetEU(tier, T) : 0);
          expect(b.run).toBe(T);
          const sum = b.race + b.anchors + b.stages + b.qd + b.ladder + b.robust;
          expect(sum).toBeLessThanOrEqual(b.run);
          expect(sum).toBeGreaterThan(b.run - 6);
          expect(b.anchors).toBe(K > 1 ? Math.floor(0.25 * (b.anchors + b.stages)) : 0);
          if (ladder) expect(b.ladder).toBe(Math.floor(sh.ladder * T));
          else expect(b.ladder).toBe(0);
        }
      }
    }
    expect(idealBudgetEU('M')).toBe(1440);
    expect(planBudget('S', 3, undefined, true).run).toBe(3000);
    // goal 1's search (race + P3) gets about the same EU with and without a ladder (shares P5 vs P6: ±2 % of the total)
    for (const tier of ['S', 'M', 'L', 'X'] as const) {
      const [a, b] = [planBudget(tier, 3, undefined, false), planBudget(tier, 3, undefined, true)];
      expect(Math.abs(b.race + b.anchors + b.stages - (a.race + a.anchors + a.stages))).toBeLessThanOrEqual(0.02 * a.total + 1);
    }
  });
  it('selects the tier from device calibration', () => {
    expect(budgetForDevice({ msPerEU: 30, workers: 3, targetSeconds: 20 }).tier).toBe('S');
    expect(budgetForDevice({ msPerEU: 5, workers: 7, targetSeconds: 10 }).tier).toBe('M');
    expect(budgetForDevice({ msPerEU: 2, workers: 8, targetSeconds: 10 }).tier).toBe('L');
  });
});

describe('evaluators (§4.19)', () => {
  it('pooled evaluator re-assembles by request index for any worker count and chunking', async () => {
    const toy = regimesToy();
    const local = createLocalEvaluator(toy.model, toy.problem.structures);
    const batch = Array.from({ length: 37 }, (_, i) => ({
      structure: i % 3,
      x: Float64Array.of((i * 0.37) % 1, 0.5, (i * 0.11) % 1),
      draw: i % 4 === 0 ? i % 7 : -1,
    }));
    const ref = JSON.stringify((local.evaluate(batch) as EvalOutput[]).map((o) => Array.from(o.goals)));
    for (const [w, c] of [
      [1, 1],
      [4, 3],
      [8, 5],
      [3, 64],
    ] as const) {
      const outs = await scrambledPool(local, w, c).evaluate(batch);
      expect(JSON.stringify(outs.map((o) => Array.from(o.goals)))).toBe(ref);
    }
  });
});

describe('optimiser correctness on toys with known optima (§7.2)', () => {
  it('7.2.3 two-goal front d₂ = 1 − d₁⁴: ε-lexicographic output at d₁ = 0.95, d₂ = 0.185 (≥ 9/10 seeds)', async () => {
    let pass = 0;
    for (let s = 0; s < 10; s++) {
      const r = await run(twoGoalFrontToy(), { seed: `front${s}`, ensembleSize: 0 });
      const a = r.options[0]!;
      const [d1, d2] = [a.desirability[0]!, a.desirability[1]!];
      if (d1 >= 1 - 0.05 - 0.02 && Math.abs(d2 - (1 - 0.95 ** 4)) <= 0.02) pass++;
    }
    expect(pass).toBeGreaterThanOrEqual(9);
  });

  it('7.2.2 linear energy balance: ≥ 99 % of the analytic optimum on the tier-S budget', async () => {
    const toy = linearEnergyBalanceToy(12);
    const r = await run(toy, { tier: 'S' });
    expect(r.provenance.euUsed).toBeLessThanOrEqual(TIER_BUDGET_EU.S);
    expect(r.options[0]!.metricValues[0]!).toBeGreaterThanOrEqual(0.99 * toy.optimum);
    expect(violation(r.options[0]!.output.margins)).toBe(0);
  });

  it('7.2.7 price of structure: structured optimum vs a large-budget unstructured weekly CVP (gap ≤ 5 %)', async () => {
    const toy = linearEnergyBalanceToy(12);
    const structured = (await run(toy)).options[0]!.metricValues[0]!;
    const cvpOnly = {
      ...toy,
      problem: {
        ...toy.problem,
        structures: [toy.problem.structures[2]!],
        baseline: { structure: 0, x: new Array<number>(12).fill(1) },
      },
    };
    const cvpToy = functionToy(
      cvpOnly.problem.structures,
      toy.problem.goals,
      cvpOnly.problem.baseline,
      (_s, _i, x) => toy.evaluate(2, x),
    );
    const cvp = (await run(cvpToy, { tier: 'M', ensembleSize: 0 })).options[0]!.metricValues[0]!;
    const gap = (cvp - structured) / cvp;
    expect(gap).toBeLessThanOrEqual(0.05);
  });

  it('7.2.4 structure discovery: adaptation mechanism → cycle skeleton; without it → steady skeleton', async () => {
    const withMech = await run(adaptationToy(true), { ensembleSize: 0 });
    const without = await run(adaptationToy(false), { ensembleSize: 0 });
    expect(withMech.options[0]!.structure.id).toBe('cycle');
    expect(without.options[0]!.structure.id).toBe('steady');
    // cycle beats the best steady plan by a clear margin under the mechanism
    const bestSteady = Math.max(
      ...[0, 0.25, 0.5, 0.75, 1].map((v) => adaptationToy(true).evaluate(0, [v]).goals[0]!),
    );
    expect(withMech.options[0]!.metricValues[0]!).toBeGreaterThan(1.3 * bestSteady);
  });

  it('7.2.6 brute-force oracle: micro-library (12 skeletons × 21² grid) — planner within 1 % under the same comparator', async () => {
    const toy = microLibraryToy();
    const gs = new GoalSystem(toy.problem.goals);
    gs.setBaseline(toy.evaluate(0, [0, 0]).goals);
    const plans: Array<{ f: Float64Array; vS: number; reg: number }> = [];
    for (let s = 0; s < toy.problem.structures.length; s++)
      for (let i = 0; i <= 20; i++)
        for (let j = 0; j <= 20; j++) {
          const out = toy.evaluate(s, [i / 20, j / 20]);
          const p = { f: gs.objective(out.goals), vS: violation(out.margins ?? []), reg: out.reg ?? 0 };
          gs.observe(p.f, p.vS === 0);
          plans.push(p);
        }
    expect(plans.length).toBe(5292);
    const argmin = (key: (p: (typeof plans)[number]) => readonly number[]) =>
      plans.reduce((b, p) => {
        const kb = key(b);
        const kp = key(p);
        for (let i = 0; i < kp.length; i++) if (kp[i] !== kb[i]) return kp[i]! < kb[i]! ? p : b;
        return b;
      });
    for (let k = 0; k < gs.K; k++) gs.setFloorFrom(k, argmin((p) => gs.stageKey(k, p)).f[k]!);
    const oracle = argmin((p) => gs.finalKey(p));
    const uOracle = gs.utility(oracle.f, oracle.reg);
    const r = await run(toy);
    const a = r.options[0]!;
    const fa = gs.objective(a.output.goals);
    expect(violation(a.output.margins)).toBe(0);
    expect(gs.floorViolation(fa, gs.K)).toBeLessThanOrEqual(0.01);
    expect(gs.utility(fa, a.output.regulariser)).toBeGreaterThanOrEqual(uOracle - 0.01);
  });
});

describe('goal conflicts, diversity and robustness (§7.6, §4.15)', () => {
  it('7.6.2 conflict matrix from the run history classifies every pair of a constructed toy', async () => {
    const r = await run(conflictToy(), { ensembleSize: 0 });
    const K = 5;
    const expected = (i: number, j: number) =>
      (i === 0 && j === 1) || (i === 1 && j === 0)
        ? 'conflict'
        : (i === 2 && j === 4) || (i === 4 && j === 2)
          ? 'synergy'
          : 'compatible';
    for (let i = 0; i < K; i++)
      for (let j = 0; j < K; j++)
        if (i !== j) expect([i, j, r.conflicts.cls[i * K + j]]).toEqual([i, j, expected(i, j)]);
    const conflictMsg = r.relations.find((m) => m.kind === 'conflict');
    expect(conflictMsg).toMatchObject({ higher: 0, lower: 1 });
    expect(conflictMsg!.retainedShare).toBeLessThan(0.2);
  });

  it('7.6.1 2-3 options that are mutually distant (D ≥ 0.20) and respect the relaxed floors', async () => {
    const r = await run(regimesToy({ spread: 0 }), { tier: 'S' });
    expect(r.options.length).toBeGreaterThanOrEqual(2);
    expect(new Set(r.options.map((o) => o.label)).size).toBe(r.options.length);
    const floors = r.goals.floors;
    r.options.forEach((o, i) => {
      if (i > 0) expect(o.distanceToChosen).toBeGreaterThanOrEqual(0.2);
      const d = o.robust?.robustD ?? o.desirability;
      floors.forEach((L, j) => {
        if (!Number.isNaN(L)) expect(d[j]!).toBeGreaterThanOrEqual(L - r.goals.relaxation[j]! - 1e-9);
      });
      for (const c of o.costVsA) expect(i === 0 ? c === 0 : Number.isFinite(c)).toBe(true);
    });
    expect(r.options[0]!.strictFeasible).toBe(true);
  });

  it('§4.15 chance constraint: nominally optimal plans that break the bound at P90 are repaired or dropped', async () => {
    const toy = regimesToy({ spread: 0.2 });
    const r = await run(toy, { tier: 'S', holdoutSize: 32 });
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    for (const o of r.options) {
      // chosen on the selection ensemble (16 draws), reported on the holdout ensemble (32 other draws)
      expect(o.robustSelection).not.toBeNull();
      expect(o.robustSelection!.draws).toBe(16);
      expect(o.robustSelection!.chanceFeasible).toBe(true);
      expect(o.robustSelection!.margins[0]!.p10).toBeGreaterThanOrEqual(0);
      expect(o.robust!.draws).toBe(32);
      expect(o.robust!.margins[0]!.p10).toBeGreaterThan(-0.05);
    }
    expect(r.holdoutGap).toHaveLength(3);
    for (const g of r.holdoutGap) expect(Number.isFinite(g)).toBe(true);
    // the nominal optimum sits on the nominal bound (margin 0) and would violate it in ≥ 10 % of draws
    const nominalBest = r.feasibility[0]!.best;
    expect(r.options[0]!.metricValues[0]!).toBeLessThan(nominalBest);
    // with a small spread the chance-feasible options still honour the relaxed floors
    const small = await run(regimesToy({ spread: 0.05 }), { tier: 'S' });
    expect(small.floorsRelaxedForA).toBe(false);
    for (const o of small.options) {
      expect(o.robustSelection!.chanceFeasible).toBe(true);
      small.goals.floors.forEach((L, j) =>
        expect(o.robustSelection!.robustD[j]!).toBeGreaterThanOrEqual(L - small.goals.relaxation[j]! - 1e-9),
      );
    }
  });
});

describe('determinism (§4.19, §7.3.7)', () => {
  it('same seed → identical output; different seed → different trajectory', async () => {
    const a = fingerprint(await run(regimesToy(), { seed: 'd1' }));
    const b = fingerprint(await run(regimesToy(), { seed: 'd1' }));
    const c = fingerprint(await run(regimesToy(), { seed: 'd2' }));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('bitwise-identical results for worker counts / batch sizes 1, 4 and 8 with scrambled completion order', async () => {
    const toy = regimesToy({ spread: 0.05 });
    const local = createLocalEvaluator(toy.model, toy.problem.structures);
    const ref = fingerprint(await run(toy, { seed: 'w' }, local));
    for (const [w, chunk] of [
      [1, 1],
      [4, 4],
      [8, 8],
      [8, 1],
    ] as const)
      expect(fingerprint(await run(toy, { seed: 'w' }, scrambledPool(local, w, chunk)))).toBe(ref);
  });
});

describe('metamorphic relations (§7.3)', () => {
  const scaled = (toy: ToyPlanner, goal: number, factor: number): ToyPlanner =>
    functionToy(toy.problem.structures, toy.problem.goals, toy.problem.baseline, (_s, i, x, draw) => {
      const o = toy.evaluate(i, x, draw);
      return { ...o, goals: o.goals.map((g, k) => (k === goal ? g * factor : g)) };
    });

  it('7.3.5 changing a metric unit (×1024) leaves the plan bitwise identical', async () => {
    const toy = regimesToy({ spread: 0.05 });
    const a = await run(toy, { seed: 'unit' });
    const b = await run(scaled(toy, 0, 1024), { seed: 'unit' });
    expect(b.options.map((o) => Array.from(o.x))).toEqual(a.options.map((o) => Array.from(o.x)));
    expect(b.options.map((o) => Array.from(o.desirability))).toEqual(
      a.options.map((o) => Array.from(o.desirability)),
    );
  });

  it('7.3.3 swapping goals i < j never lowers the promoted goal', async () => {
    const toy = regimesToy({ spread: 0 });
    const before = await run(toy, { seed: 'swap', ensembleSize: 0 });
    const g = toy.problem.goals;
    const swappedToy = functionToy(
      toy.problem.structures,
      [g[0]!, g[2]!, g[1]!],
      toy.problem.baseline,
      (_s, i, x, d) => {
        const o = toy.evaluate(i, x, d);
        return { ...o, goals: [o.goals[0]!, o.goals[2]!, o.goals[1]!] };
      },
    );
    const after = await run(swappedToy, { seed: 'swap', ensembleSize: 0 });
    const range = before.goals.scales[2]!.a - before.goals.scales[2]!.b;
    expect(after.options[0]!.objectives[1]!).toBeGreaterThanOrEqual(
      before.options[0]!.objectives[2]! - 0.02 * range,
    );
  });

  it('7.3.4 appending a lowest-priority goal does not lower higher goals beyond their δ', async () => {
    const toy = twoGoalFrontToy();
    const before = await run(toy, { seed: 'append', ensembleSize: 0 });
    const extended = functionToy(
      toy.problem.structures,
      [...toy.problem.goals, { id: 'g3', sense: 'min' }],
      toy.problem.baseline,
      (_s, i, x) => {
        const o = toy.evaluate(i, x);
        return { ...o, goals: [...o.goals, x[0]! + x[1]!] };
      },
    );
    const after = await run(extended, { seed: 'append', ensembleSize: 0 });
    for (let k = 0; k < 2; k++)
      expect(after.options[0]!.desirability[k]!).toBeGreaterThanOrEqual(
        before.options[0]!.desirability[k]! - [0.05, 0.1][k]! - 0.02,
      );
  });

  it('7.3.1 relaxing a constraint never lowers the top goal (lexicographic attainment)', async () => {
    const tight = await run(regimesToy({ spread: 0, lossCap: 0.4 }), { seed: 'relax', ensembleSize: 0 });
    const loose = await run(regimesToy({ spread: 0, lossCap: 0.45 }), { seed: 'relax', ensembleSize: 0 });
    const range = tight.goals.scales[0]!.a - tight.goals.scales[0]!.b;
    expect(loose.options[0]!.objectives[0]!).toBeGreaterThanOrEqual(
      tight.options[0]!.objectives[0]! - 0.02 * range,
    );
  });

  it('7.3.2 extending the horizon never lowers target attainment; §4.14 reports the unattainable target', async () => {
    const short = await run(linearEnergyBalanceToy(8, { targetKg: 6 }), { seed: 'h', ensembleSize: 0 });
    const long = await run(linearEnergyBalanceToy(12, { targetKg: 6 }), { seed: 'h', ensembleSize: 0 });
    expect(long.options[0]!.percentOfTarget[0]!).toBeGreaterThanOrEqual(
      short.options[0]!.percentOfTarget[0]! - 0.02,
    );
    expect(short.feasibility[0]!.status).toBe('unattainable');
    expect(short.feasibility[0]!.nearestAttainableTarget!).toBeCloseTo(5.6, 1);
    expect(long.feasibility[0]!.status).toBe('attainable');
  });
});

describe('orchestration features', () => {
  it('publishes provisional A after S3.1 and A/B/C after S4', async () => {
    const seen: Array<{ stage: string; alts: number; prov: boolean }> = [];
    await run(regimesToy({ spread: 0 }), {
      onProgress: (p) =>
        seen.push({ stage: p.stage, alts: p.alternatives?.length ?? 0, prov: !!p.provisional }),
    });
    const firstProv = seen.findIndex((s) => s.prov);
    expect(seen[firstProv]!.stage).toBe('S3.1');
    expect(seen.some((s) => s.stage === 'S4' && s.alts >= 2)).toBe(true);
  });

  it('reports progress with the provisional plan and stops cooperatively on abort (anytime result)', async () => {
    const signal = { aborted: false };
    const stages: string[] = [];
    let lastEU = 0;
    const r = await run(regimesToy(), {
      signal,
      onProgress: (p) => {
        stages.push(p.stage);
        expect(p.euUsed).toBeGreaterThanOrEqual(lastEU);
        lastEU = p.euUsed;
        // the provisional plan A appears when S3 stage 1 completes (§4.11 anytime behaviour)
        if (p.stage === 'S3.1' && p.provisional) signal.aborted = true;
      },
    });
    expect(stages[0]).toBe('S0');
    expect(r.complete).toBe(false);
    expect(r.stoppedAt).toBe('S3');
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    expect(r.provenance.euUsed).toBeLessThan(0.5 * TIER_BUDGET_EU.S);
  });

  it('returns "no safe plan" with the violated constraints when nothing is safety-feasible', async () => {
    const toy = functionToy(
      [{ id: 'x', dim: 2, tags: [] }],
      [{ id: 'g', sense: 'max' }],
      { structure: 0, x: [0.5, 0.5] },
      (_s, _i, x) => ({
        goals: [x[0]!],
        margins: [0.5, -0.1 - x[1]!],
        descriptors: [x[0]!],
      }),
    );
    const r = await run(toy, { totalEU: 400, ensembleSize: 0 });
    expect(r.options).toEqual([]);
    expect(r.shortfall).toBe('noCandidates');
    expect(r.noSafePlan!.violated).toEqual([1]);
    expect(r.noSafePlan!.vS).toBeCloseTo(0.1, 2);
  });

  it('round-and-verify, validator and ablations hooks', async () => {
    const toy = microLibraryToy();
    const round = (_s: number, x: Float64Array) => Float64Array.from(x, (v) => Math.round(v * 20) / 20);
    const problem = {
      ...toy.problem,
      roundGenome: round,
      gridStep: () => [0.05, 0.05],
      validate: (_s: number, x: Float64Array) => ({
        ok: x[0]! < 0.79,
        reasons: ['u ≥ 0.79 rejected by validator'],
      }),
      ablations: (s: number, x: Float64Array) =>
        toy.problem.structures[s]!.tags[2] === 1 ? [{ label: 'no weekly pattern', structure: s - 1, x }] : [],
    };
    const r = await runPlanner(problem, createLocalEvaluator(toy.model, toy.problem.structures), {
      seed: 'hooks',
      cvtSamples: 2000,
    });
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    for (const o of r.options) {
      expect(o.x[0]!).toBeLessThan(0.79);
      if (o.rounded) for (const v of o.x) expect(Math.abs(v * 20 - Math.round(v * 20))).toBeLessThan(1e-9);
    }
    expect(r.options.some((o) => o.rounded)).toBe(true);
    const withPattern = r.options.find((o) => o.structure.tags[2] === 1);
    if (withPattern) expect(withPattern.ablations[0]!.label).toBe('no weekly pattern');
  });
});
