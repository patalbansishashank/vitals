// @vitest-environment node
/**
 * Benchmark metrics against hand-computed values, and the synthetic suites' ground truth checked by sampling: no
 * feasible plan of a planted-priorities problem beats its analytic optimum within the goal-1 floor, the noisy variant's
 * optimum holds its constraint in 90 % of draws, and the frontier suite's ladder follows the plan-ladder rules.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../optim/rng';
import { desirability, ecdfArea, goalScore, hypervolume, igdPlus, ladderCheck, lexOutcome, lexReference, nondominated, runtimeEcdf, timeToTargets, unitGower, visitedQd, type GoalRef } from './metrics';
import { buildToy, ladderOnFront, toySpecs } from './suites/toys';

const G2: GoalRef[] = [
  { id: 'a', sense: 'max', b: 0, u: 10, delta: 0.05, unit: 'kg', active: true },
  { id: 'b', sense: 'min', b: -5, u: 0, delta: 0.1, unit: 'cm', active: true },
];

describe('lexicographic regret', () => {
  it('desirability, regret, lex-success and the first failing goal', () => {
    expect(desirability(G2, [5, 2.5])).toEqual([0.5, 0.5]);
    expect(desirability(G2, [12, 0])).toEqual([1, 1]);
    const ok = lexOutcome(G2, [1, 0.6], [0.98, 0.65]);
    expect(ok.success).toBe(true);
    expect(ok.regret[0]).toBeCloseTo(0.02, 12);
    expect(ok.r1Metric).toBeCloseTo(0.2, 12); // 0.02 × 10 kg
    const fail1 = lexOutcome(G2, [1, 0.6], [0.97, 0.9]);
    expect(fail1.firstFail).toBe(1);
    const fail2 = lexOutcome(G2, [1, 0.6], [1, 0.54]);
    expect(fail2.firstFail).toBe(2);
    expect(lexOutcome(G2, [1, 0.6], null).success).toBe(false);
  });

  it('ε-lexicographic reference: stage optima, floors, then the best goal score', () => {
    const c = [
      { d: [1, 0.2], feasible: true },
      { d: [0.97, 0.9], feasible: true }, // within goal 1's floor (1 − 0.05)
      { d: [0.9, 1], feasible: true }, // below the floor
      { d: [1, 1], feasible: false },
    ];
    const r = lexReference(G2, c);
    expect(r.stage[0]).toBe(1);
    expect(r.stage[1]).toBe(0.9);
    expect(r.index).toBe(1);
    expect(goalScore(G2, [1, 1])).toBeCloseTo(1, 12);
  });
});

describe('time to quality', () => {
  it('first EU and wall time at which the best-so-far score reaches each level', () => {
    const goals: GoalRef[] = [{ id: 'a', sense: 'max', b: 0, u: 1, delta: 0.05, unit: '', active: true }];
    const trace = [
      { eu: 10, ms: 1, raw: [0.4], D: NaN, b1: NaN },
      { eu: 50, ms: 5, raw: [0.85], D: NaN, b1: NaN },
      { eu: 200, ms: 20, raw: [0.96], D: NaN, b1: NaN },
    ];
    const h = timeToTargets(goals, trace, 1);
    expect(h.map((x) => x?.eu ?? null)).toEqual([50, 50, 200, 200, null]);
    const ecdf = runtimeEcdf([h.map((x) => x?.eu ?? null)], [10, 100, 1000]);
    expect(ecdf).toEqual([0, 0.4, 0.8]);
    expect(ecdfArea([1, 1], [10, 1000])).toBe(1);
  });
});

describe('ladder metrics', () => {
  it('hypervolume of {(g, 1 − D)} against (0, 0)', () => {
    expect(hypervolume([{ g: 1, D: 0 }])).toBe(1);
    expect(hypervolume([{ g: 0.5, D: 0.5 }])).toBe(0.25);
    expect(hypervolume([{ g: 1, D: 0.5 }, { g: 0.5, D: 0 }])).toBeCloseTo(0.75, 12);
    expect(hypervolume([{ g: 1, D: 0.5 }, { g: 0.5, D: 0 }, { g: 0.4, D: 0.6 }])).toBeCloseTo(0.75, 12); // dominated point adds nothing
    expect(nondominated([{ g: 0.4, D: 0.6 }, { g: 1, D: 0.5 }]).length).toBe(1);
  });

  it('IGD⁺ is 0 on the front and grows with the distance behind it', () => {
    const front = [{ g: 0.5, D: 0.25 }, { g: 1, D: 1 }];
    expect(igdPlus(front, front)).toBe(0);
    expect(igdPlus([{ g: 0.5, D: 0.25 }], front)).toBeCloseTo(0.5 / 2, 12); // (0 + 0.5)/2
    expect(igdPlus([], front)).toBe(Infinity);
  });

  it('distinctness and monotonicity of a ladder', () => {
    const ok = ladderCheck(
      [
        { g: 1, D: 0.8, features: [1, 1] },
        { g: 0.8, D: 0.5, features: [0.5, 0.5] },
        { g: 0.5, D: 0.2, features: [0, 0] },
      ],
      unitGower,
    );
    expect(ok.pass).toBe(true);
    expect(ok.monotonicityViolations).toBe(0);
    const bad = ladderCheck(
      [
        { g: 0.7, D: 0.8, features: [1, 1] },
        { g: 0.8, D: 0.7, features: [0.9, 0.9] },
      ],
      unitGower,
    );
    expect(bad.pass).toBe(false);
    expect(bad.monotonicityViolations).toBe(1);
  });

  it('visited-archive QD on a 10 × 10 grid', () => {
    const goals: GoalRef[] = [{ id: 'a', sense: 'max', b: 0, u: 1, delta: 0.05, unit: '', active: true }];
    const q = visitedQd(goals, [{ eu: 0, ms: 0, raw: [1], D: 0.05, b1: 0.05 }, { eu: 0, ms: 0, raw: [0.5], D: 0.95, b1: 0.95 }], 1);
    expect(q.coverage).toBeCloseTo(0.02, 12);
    expect(q.score).toBeCloseTo(0.015, 12);
  });
});

describe('synthetic suites: the known optimum is the optimum', () => {
  it('planted priorities: no sampled feasible plan within goal 1 floor beats the analytic optimum on goal 2 (or 3, 4)', () => {
    for (const spec of toySpecs('T2', 'train')) {
      const tp = buildToy(spec);
      const dStar = tp.reference.dStar;
      expect(dStar[0]).toBeCloseTo(1, 12);
      const rng = new Rng(`t2check/${spec.id}`);
      const nS = tp.problem.structures.length;
      const xStar = Float64Array.from((tp.reference.detail as { x: number[] }).x);
      const sStar = (tp.reference.detail as { sStar: number }).sStar;
      for (let i = 0; i < 6000; i++) {
        const s = i < 3000 ? sStar : rng.int(nS);
        // around the optimum (half) and anywhere (half)
        const z = Float64Array.from(xStar, (v) => (i % 2 ? rng.float() : Math.min(1, Math.max(0, v + 0.08 * (rng.float() - 0.5)))));
        const o = tp.fn(s, z, -1);
        if (o.margins.some((m) => m < 0)) continue;
        const d = desirability(tp.goals, o.goals);
        if (d[0]! < 1 - tp.goals[0]!.delta) continue;
        // lexicographic: nothing within goal 1's floor improves goal 2 beyond the optimum
        expect(d[1]!).toBeLessThanOrEqual(dStar[1]! + 1e-9);
      }
      // decoys never reach goal 1's floor
      for (let s = 0; s < nS; s++) {
        if (s === sStar) continue;
        const z = Float64Array.from(xStar);
        expect(desirability(tp.goals, tp.fn(s, z, -1).goals)[0]!).toBeLessThan(1 - tp.goals[0]!.delta);
      }
    }
  });

  it('uncertain physiology: the robust optimum keeps its constraint in ≥ 90 % of draws, the nominal one does not', () => {
    const spec = toySpecs('T5', 'train')[0]!;
    const tp = buildToy(spec);
    const det = tp.reference.detail as { x: number[]; sStar: number };
    const ex = tp.exact!(det.sStar, Float64Array.from(det.x));
    expect(ex.pFeasible).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(ex.pFeasible).toBeLessThan(0.92);
    const nominal = Float64Array.from(det.x);
    nominal[0] = 0.55;
    nominal[1] = 0.45;
    expect(tp.exact!(det.sStar, nominal).pFeasible).toBeLessThan(0.6);
  });

  it('effort-attainment frontier: analytic ladders follow the rung rules', () => {
    const front = Array.from({ length: 2001 }, (_, i) => ({ D: i / 2000, g: Math.sqrt(i / 2000) }));
    const L = ladderOnFront(front, 0.1);
    expect(L[0]).toEqual([1, 1]);
    expect(L[L.length - 1]![0]).toBeCloseTo(0.5, 3);
    expect(L[L.length - 1]![1]).toBeCloseTo(0.25, 3);
    expect(L.length).toBe(3);
    for (const spec of toySpecs('T4', 'train')) {
      const tp = buildToy(spec);
      expect(tp.reference.rungs!.length).toBeGreaterThanOrEqual(2);
      expect(tp.reference.front!.length).toBeGreaterThan(10);
      expect(hypervolume(tp.reference.front!.map(([g, D]) => ({ g, D })))).toBeGreaterThan(hypervolume(tp.reference.rungs!.map(([g, D]) => ({ g, D }))) - 1e-12);
    }
  });
});
