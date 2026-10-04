// @vitest-environment node
import { selectAlternatives } from './archive';
import { compareKeys } from './cmaes';
import type { GoalSpec, Scored } from './goals';
import { Rng } from './rng';
import {
  GOAL_SCORE_STEP,
  GoalSystem,
  MIN_QUANTUM,
  ladderViolation,
  aucAbove,
  compareGoalFirst,
  bindingConstraints,
  complexityPenalty,
  delta,
  endMean,
  hungerCapMargin,
  hungerPenalty,
  ladderTolerance,
  rocWeights,
  softMin,
  timeInRange,
  timeToTarget,
  windowMean,
} from './goals';

describe('metric functionals (§4.5)', () => {
  const y = Float64Array.from({ length: 29 }, (_, t) => 100 - t); // t = 0..28, falling 1/day

  it('END_7, DELTA, MEAN_W', () => {
    expect(endMean(y)).toBeCloseTo(75, 12); // mean of days 22..28
    expect(delta(y)).toBeCloseTo(-25, 12);
    expect(endMean(y, 7, 14)).toBeCloseTo(89, 12); // deadline at day 14
    expect(windowMean(y)).toBeCloseTo(85.5, 12);
    expect(windowMean(y, 1, 1)).toBe(99);
  });

  it('smooth time-in-range, soft minimum, exposure, time-to-target with shaping', () => {
    const tir = timeInRange(y, 80, 90);
    expect(tir).toBeGreaterThan(9 / 28);
    expect(tir).toBeLessThan(12 / 28);
    expect(softMin(y)).toBeLessThanOrEqual(72);
    expect(softMin(y)).toBeGreaterThan(72 * 0.99);
    expect(aucAbove(y, 95)).toBeCloseTo((4 + 3 + 2 + 1) / 28, 12);
    const hit = timeToTarget(y, 89.5, -1);
    expect(hit.tHit).toBeCloseTo(10.5, 12);
    expect(hit.objective).toBeCloseTo(-10.5, 12);
    const miss = timeToTarget(y, 50, -1); // r = 50/28 per day; gap at T = 22 → −28 − 22/r
    expect(miss.tHit).toBeNull();
    expect(miss.objective).toBeCloseTo(-28 - 22 / (50 / 28), 9);
    // shaping is monotone: closer end value → better objective
    expect(timeToTarget(y, 60, -1).objective).toBeGreaterThan(miss.objective);
  });
});

describe('regulariser helpers (§4.9)', () => {
  it('hunger penalty grows with excess and with the longest run above tolerance', () => {
    const low = new Array<number>(28).fill(0.3);
    const high = new Array<number>(28).fill(0.3).map((v, t) => (t >= 10 && t < 17 ? 0.8 : v));
    expect(hungerPenalty(low, 0.55)).toBeLessThan(0.01);
    expect(hungerPenalty(high, 0.55)).toBeGreaterThan(0.5 * (7 / 7));
    expect(hungerCapMargin(low, 0.55)).toBeCloseTo(0.4, 12);
    expect(hungerCapMargin(high, 0.55)).toBeLessThan(0);
  });

  it('complexity penalty uses the dossier coefficients', () => {
    const c = complexityPenalty({
      dayTypesPerPhase: [2, 3],
      distinctPhases: 2,
      phaseTransitions: 1,
      horizonDays: 56,
      eventComplexityCosts: [2],
      meanWindowStartShiftH: 0.5,
      distinctTrainingClockTimes: 2,
      weekRepeatShare: 0.8,
    });
    expect(c).toBeCloseTo(0.015 * 3 + 0.02 + 0.01 * 0.5 + 0.02 + 0.01 + 0.01 + 0.05 * 0.2, 12);
  });
});

describe('binding constraints (§4.14.2)', () => {
  it('reports rules active on ≥ 20 % of days, most active first', () => {
    const log = [
      ...Array.from({ length: 30 }, (_, d) => ({ rule: 'energyFloor', day: d })),
      ...Array.from({ length: 10 }, (_, d) => ({ rule: 'trainingDays', day: d * 3 })),
      { rule: 'energyFloor', day: 3 },
      { rule: 'noDay' },
    ];
    expect(bindingConstraints(log, 84)).toEqual([{ rule: 'energyFloor', share: 30 / 84 }]);
    expect(bindingConstraints(log, 40).map((b) => b.rule)).toEqual(['energyFloor', 'trainingDays']);
  });
});

describe('weights and tolerances (§4.7)', () => {
  it('ROC weights and the 5/10/15 % ladder with strictness', () => {
    expect(Array.from(rocWeights(3), (w) => +w.toFixed(3))).toEqual([0.611, 0.278, 0.111]);
    expect(Array.from(rocWeights(2))).toEqual([0.75, 0.25]);
    expect([0, 1, 2, 5].map((k) => ladderTolerance(k))).toEqual([0.05, 0.1, 0.15, 0.15]);
    expect(ladderTolerance(0, 'strict')).toBe(0.025);
    expect(ladderTolerance(1, 'flexible')).toBe(0.2);
  });
});

describe('desirability normalisation (§4.6)', () => {
  const make = () => {
    const gs = new GoalSystem([
      { id: 'fat', sense: 'min', target: 80 }, // lose to 80 kg-equivalent; baseline 90
      { id: 'lean', sense: 'max' },
      { id: 'ldl', sense: 'band', band: { lo: 2, hi: 3 } },
    ]);
    gs.setBaseline([90, 60, 4]);
    return gs;
  };

  it('maps baseline → 0, target → 1 with satiation, no lower clip; min/max/band senses', () => {
    const gs = make();
    gs.observe(gs.objective([78, 62, 3.5]), true);
    const d = gs.desirability(gs.objective([85, 61, 3.5]));
    expect(d[0]).toBeCloseTo(0.5, 12); // halfway to the target
    expect(d[1]).toBeCloseTo(0.5, 12); // halfway to the anchor 62
    expect(d[2]).toBeCloseTo(0.5, 12); // band: baseline 1 above hi → width 1
    expect(gs.dRaw(0, gs.objective([75, 60, 4])[0]!)).toBe(1); // satiation beyond target
    expect(gs.dRaw(1, gs.objective([90, 58, 4])[1]!)).toBeCloseTo(-1, 12); // worse than baseline, not clipped
    expect(gs.dReported(1, gs.objective([90, 58, 4])[1]!)).toBe(0);
    expect(gs.dRaw(2, gs.objective([90, 60, 2.5])[2]!)).toBe(1); // inside the band
    expect(gs.percentOfPossible(1, 61)).toBeCloseTo(0.5, 12);
    expect(gs.percentOfTarget(0, -85)).toBeCloseTo(0.5, 12);
    expect(gs.utility(gs.objective([80, 62, 2.5]), 0)).toBeCloseTo(1, 12);
  });

  it('is unit-free: scaling a metric by 1024 leaves desirabilities bitwise identical', () => {
    const a = new GoalSystem([{ id: 'x', sense: 'max', target: 7 }]);
    const b = new GoalSystem([{ id: 'x', sense: 'max', target: 7 * 1024 }]);
    a.setBaseline([1.3]);
    b.setBaseline([1.3 * 1024]);
    for (const v of [1.3, 2.71, 5.5, 7.9])
      expect(b.desirability(b.objective([v * 1024]))[0]).toBe(a.desirability(a.objective([v]))[0]);
  });

  it('detects goals met at baseline and goals that cannot be improved', () => {
    const gs = new GoalSystem([
      { id: 'met', sense: 'max', target: 5 },
      { id: 'flat', sense: 'max' },
    ]);
    gs.setBaseline([6, 1]);
    expect(gs.status(0)).toBe('metAtBaseline');
    expect(gs.status(1)).toBe('notImprovable');
    gs.observe([6, 1.5], true);
    expect(gs.status(1)).toBe('active');
    gs.observe([6, 9], false); // infeasible plans never move anchors
    expect(gs.scale(1).a).toBe(1.5);
  });
});

describe('ε-lexicographic floors and comparators (§4.7.3)', () => {
  it('floors: L = d̃* − δ, targets kept, stored in physical units (do not move when anchors improve)', () => {
    const gs = new GoalSystem([
      { id: 'a', sense: 'max' },
      { id: 'b', sense: 'max', target: 10 },
      { id: 'c', sense: 'max' },
    ]);
    gs.setBaseline([0, 0, 0]);
    gs.observe([1, 12, 1], true);
    expect(gs.setFloorFrom(0, 1)).toBeCloseTo(0.95, 12);
    expect(gs.setFloorFrom(1, 11)).toBe(1); // target reached → kept by option A (δ_target = 0)
    expect(gs.floorRelaxation(1)).toBeCloseTo(0.1, 12); // alternatives may fall δ_2 = 10 % of the distance short
    expect(gs.priorityFeasible([1, 9.2, 0.5], true)).toBe(true);
    expect(gs.priorityFeasible([1, 9.2, 0.5], false)).toBe(false);
    expect(gs.setFloorFrom(2, 0.5)).toBeCloseTo(0.35, 12); // 0.5 − 0.15
    const F0 = gs.floorPhysical(0);
    gs.observe([2, 0, 0], true); // anchor of goal 0 doubles
    expect(gs.floorPhysical(0)).toBe(F0);
    expect(gs.floor(0)).toBeCloseTo(0.475, 12);
  });

  it('stage key ranks safety, then priority floors (weighted 2^{k−j}), then the quantised objective, R, then d̃', () => {
    const gs = new GoalSystem([
      { id: 'a', sense: 'max' },
      { id: 'b', sense: 'max' },
      { id: 'c', sense: 'max' },
    ]);
    gs.setBaseline([0, 0, 0]);
    gs.observe([1, 1, 1], true);
    gs.setFloorFrom(0, 1);
    gs.setFloorFrom(1, 1);
    const k = (f: number[], vS = 0, reg = 0) => gs.stageKey(2, { f, vS, reg });
    expect(k([1, 1, 0.2])[1]).toBe(0);
    expect(k([0.85, 1, 1])[1]).toBeCloseTo(4 * 0.1, 12);
    expect(k([1, 0.8, 1])[1]).toBeCloseTo(2 * 0.1, 12);
    // v2 (PLANNER_V2_SPEC §4.3): (v_S, v_L, −⌊d̃/q⌋, R + α·box, −d̃) with q = 0.01 without a tolerance
    expect(k([1, 1, 0.2], 0, 0.1).slice(2)).toEqual([-20, 0.1, -0.2]);
    const ordered = [k([1, 1, 0.9], 0.01), k([0.5, 1, 1]), k([1, 1, 0.3]), k([1, 1, 0.6])].map((key, i) => ({
      key,
      i,
    }));
    ordered.sort((a, b) => {
      for (let j = 0; j < 3; j++) if (a.key[j] !== b.key[j]) return a.key[j]! - b.key[j]!;
      return 0;
    });
    expect(ordered.map((o) => o.i)).toEqual([3, 2, 1, 0]);
    // provisional key quantises desirability in steps of 0.1
    expect(gs.provisionalKey({ f: [0.96, 0.31, 0], vS: 0, reg: 0 }).slice(0, 4)).toEqual([0, -9, -3, -0]);
  });

  it('§4.7.2 worked example: ε-lexicographic keeps d₁ = 0.95 where ROC weights would give 0.909', () => {
    const gs = new GoalSystem([
      { id: 'g1', sense: 'max' },
      { id: 'g2', sense: 'max' },
    ]);
    gs.setBaseline([0, 0]);
    const front = Array.from({ length: 2001 }, (_, i) => [i / 2000, 1 - (i / 2000) ** 4]);
    for (const f of front) gs.observe(f, true);
    const best = (key: (f: number[]) => readonly number[]) =>
      front.reduce((b, f) => {
        const kb = key(b);
        const kf = key(f);
        for (let j = 0; j < kf.length; j++) if (kf[j] !== kb[j]) return kf[j]! < kb[j]! ? f : b;
        return b;
      });
    for (let k = 0; k < 2; k++) gs.setFloorFrom(k, best((f) => gs.stageKey(k, { f, vS: 0, reg: 0 }))[k]!);
    const lex = best((f) => gs.finalKey({ f, vS: 0, reg: 0 }));
    expect(lex[0]).toBeCloseTo(0.95, 3);
    expect(lex[1]).toBeCloseTo(1 - 0.95 ** 4, 3);
    const roc = best((f) => [-gs.utility(f, 0)]);
    expect(roc[0]).toBeCloseTo(0.75 ** (1 / 3), 3); // 0.909: goal 1 silently loses 9 %
  });
});

describe('feasibility report (§4.14)', () => {
  it('flags unattainable, jointly unattainable, attainable and met-at-baseline targets', () => {
    const gs = new GoalSystem([
      { id: 'u', sense: 'max', target: 10 },
      { id: 'j', sense: 'max', target: 5 },
      { id: 'm', sense: 'min', target: 3 },
      { id: 'd', sense: 'max' },
    ]);
    gs.setBaseline([0, 0, 2, 0]);
    gs.observe([7, 6, -2, 1], true);
    const rep = gs.feasibilityReport([6, 4, -2, 0.5]);
    expect(rep.map((r) => r.status)).toEqual([
      'unattainable',
      'attainableAloneNotJointly',
      'metAtBaseline',
      'directional',
    ]);
    expect(rep[0]!.nearestAttainableTarget).toBe(7);
    expect(rep[0]!.bestPercentOfTarget).toBeCloseTo(0.7, 12);
    expect(rep[0]!.percentOfPossible).toBeCloseTo(6 / 7, 12);
    expect(rep[2]!.baseline).toBe(2);
  });
});

describe('keep goals (GoalSpec.keep)', () => {
  it('stay active when the baseline meets them, with desirability falling per keep unit of shortfall', () => {
    // "keep fat mass" (min, target = start 24 kg, keep scale 1.2 kg); the baseline already meets it
    const gs = new GoalSystem([
      { id: 'lean', sense: 'max' },
      { id: 'fat', sense: 'min', target: 24, keep: 1.2 },
    ]);
    gs.setBaseline([61, 23.9]);
    expect(gs.status(1)).toBe('active');
    expect(gs.dRaw(1, gs.objective([61, 23.5])[1]!)).toBe(1);
    expect(gs.dRaw(1, gs.objective([61, 24.6])[1]!)).toBeCloseTo(0.5, 12);
    expect(gs.dRaw(1, gs.objective([61, 25.2])[1]!)).toBeCloseTo(0, 12);
    // floor from a stage winner that meets it: the ladder tolerance (10 % × 1.2 kg) may be given up, no more
    const L = gs.setFloorFrom(1, gs.objective([61, 23.8])[1]!);
    expect(L).toBeCloseTo(0.9, 12);
    expect(gs.floorPhysical(1)).toBeCloseTo(-24.12, 9);
    // a plain target met at baseline is still skipped
    const plain = new GoalSystem([{ id: 'fat', sense: 'min', target: 24 }]);
    plain.setBaseline([23.9]);
    expect(plain.status(0)).toBe('metAtBaseline');
  });
});

describe('floors of unreached targets', () => {
  it('give up δ of the achievable range, not δ of the distance to the target', () => {
    const gs = new GoalSystem([{ id: 'muscle', sense: 'max', target: 35.6 }]);
    gs.setBaseline([33.6]); // target +2 kg
    gs.observe([33.9], true); // only +0.3 kg achievable
    const L = gs.setFloorFrom(0, 33.9);
    // floor in metric units: 33.9 − 5 % × 0.3 kg (not 33.9 − 5 % × 2 kg)
    expect(gs.floorPhysical(0)).toBeCloseTo(33.9 - 0.05 * 0.3, 9);
    expect(L).toBeCloseTo((33.9 - 0.015 - 33.6) / 2, 9);
  });
});

describe('penalty as a true tie-breaker (ruling R-FAST-GATE, PLAN item 8 decision 4)', () => {
  // two goals with ROC weights 0.75 / 0.25; baseline 0, targets 1 → d̃ = f
  const gs = new GoalSystem([
    { id: 'a', sense: 'max', target: 1 },
    { id: 'b', sense: 'max', target: 1 },
  ]);
  gs.setBaseline([0, 0]);
  it('a better weighted goal score wins regardless of the regulariser; within one step the lower penalty wins', () => {
    // golden (d): G 0.728 with a complexity/hunger penalty vs G 0.715 without — the better plan must win
    const fast = { f: Float64Array.of(0.728, 0.728), vS: 0, reg: 0.05 };
    const plain = { f: Float64Array.of(0.715, 0.715), vS: 0, reg: 0 };
    expect(gs.goalScore(fast.f)).toBeCloseTo(0.728, 9);
    expect(compareKeys(gs.finalKey(fast), gs.finalKey(plain))).toBeLessThan(0);
    // the old key (−U with U = G − R) preferred the plain plan
    expect(gs.utility(fast.f, fast.reg)).toBeLessThan(gs.utility(plain.f, plain.reg));
    // same step (0.7201 vs 0.7249): the regulariser decides
    const a = { f: Float64Array.of(0.7249, 0.7249), vS: 0, reg: 0.02 };
    const b = { f: Float64Array.of(0.7201, 0.7201), vS: 0, reg: 0.01 };
    expect(compareKeys(gs.finalKey(b), gs.finalKey(a))).toBeLessThan(0);
    // safety and floors still come first
    expect(compareKeys(gs.finalKey(plain), gs.finalKey({ ...fast, vS: 0.1 }))).toBeLessThan(0);
  });
  it('option A is chosen goal-first by selectAlternatives (G step, then penalty G − U)', () => {
    const cands = [
      { utility: 0.715, goalScore: 0.715, safe: true, strictFeasible: true, relaxedFeasible: true },
      { utility: 0.678, goalScore: 0.728, safe: true, strictFeasible: true, relaxedFeasible: true },
    ];
    expect(selectAlternatives(cands, () => 1, { count: 1 }).chosen[0]).toBe(1);
    expect(compareGoalFirst(cands[1]!, cands[0]!)).toBeLessThan(0);
    // without goal scores the utility decides (older callers)
    expect(selectAlternatives(cands.map(({ goalScore: _g, ...c }) => c), () => 1, { count: 1 }).chosen[0]).toBe(0);
    expect(GOAL_SCORE_STEP).toBe(0.01);
  });
});

describe('quantised keys (PLANNER_V2_SPEC §4.3)', () => {
  it('q_k = max(0.01, minTolerance/(u − b)), q_G = max(0.01, √Σ(w q)²); the level ⌊d̃/q⌋ does not move with the anchor', () => {
    const gs = new GoalSystem([
      { id: 'fat', sense: 'min', minTolerance: 0.4 }, // kg
      { id: 'lean', sense: 'max' },
      { id: 'waist', sense: 'min', target: 80, minTolerance: 0.05 },
    ]);
    gs.setBaseline([20, 50, 90]);
    gs.observe(gs.objective([16, 52, 85]), true); // fat range 4 kg → q = 0.1
    expect(gs.keyQuantum(0)).toBeCloseTo(0.1, 12);
    expect(gs.keyQuantum(1)).toBe(MIN_QUANTUM);
    expect(gs.keyQuantum(2)).toBe(MIN_QUANTUM); // 0.05 cm over a 10 cm target distance < 0.01
    const w = gs.weights;
    expect(gs.goalQuantum()).toBeCloseTo(Math.max(0.01, Math.hypot(w[0]! * 0.1, w[1]! * 0.01, w[2]! * 0.01)), 12);
    const f = gs.objective([18.3, 51, 88]);
    const before = gs.level(0, gs.dRaw(0, f[0]!));
    expect(before).toBe(Math.floor((20 - 18.3) / 0.4)); // 4 tolerance units of loss
    gs.observe(gs.objective([12, 52, 85]), true); // the anchor moves (range 8 kg)
    expect(gs.keyQuantum(0)).toBeCloseTo(0.05, 12);
    expect(gs.level(0, gs.dRaw(0, f[0]!))).toBe(before);
  });

  it('property: the regulariser (and the box penalty) never overturn a quantised goal difference', () => {
    const rng = new Rng('quantised-key-property');
    let compared = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const K = 1 + rng.int(4);
      const specs: GoalSpec[] = Array.from({ length: K }, (_, k) => ({
        id: `g${k}`,
        sense: rng.float() < 0.5 ? 'max' : 'min',
        ...(rng.float() < 0.5 ? { minTolerance: 0.3 * rng.float() } : {}),
      }));
      const gs = new GoalSystem(specs);
      gs.setBaseline(Array.from({ length: K }, () => rng.uniform(-1, 1)));
      for (let i = 0; i < 5; i++) gs.observe(Array.from({ length: K }, () => rng.uniform(-2, 3)), true);
      if (rng.float() < 0.5) gs.setFloorFrom(0, rng.uniform(-1, 2));
      const plan = (): Scored => ({
        f: Array.from({ length: K }, () => rng.uniform(-1, 3)),
        vS: rng.float() < 0.8 ? 0 : rng.float(),
        reg: 2 * rng.float(),
        box: rng.float() < 0.7 ? 0 : rng.float(),
      });
      const a = plan();
      const b = plan();
      const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
      for (let k = 0; k < K; k++) {
        const ka = gs.stageKey(k, a);
        const kb = gs.stageKey(k, b);
        if (ka[0] === kb[0] && ka[1] === kb[1] && ka[2] !== kb[2]) {
          compared++;
          // whatever R and box say, the higher quantised level of goal k ranks first
          expect(sign(compareKeys(ka, kb))).toBe(sign(ka[2]! - kb[2]!));
          expect(sign(compareKeys(gs.stageKey(k, { ...a, reg: 0, box: 0 }), gs.stageKey(k, { ...b, reg: 99, box: 9 })))).toBe(sign(ka[2]! - kb[2]!));
        }
      }
      for (const key of [(s: Scored) => gs.finalKey(s), (s: Scored) => gs.hardKey(s, rng.float())]) {
        const ka = key(a);
        const kb = key(b);
        if (ka[0] === kb[0] && ka[1] === kb[1] && ka[2] !== kb[2]) {
          compared++;
          expect(sign(compareKeys(ka, kb))).toBe(sign(ka[2]! - kb[2]!));
          expect(sign(compareKeys(key({ ...a, reg: 0 }), key({ ...b, reg: 99, box: 9 })))).toBe(sign(ka[2]! - kb[2]!));
          expect(sign(compareKeys(key({ ...a, reg: 99, box: 9 }), key({ ...b, reg: 0 })))).toBe(sign(ka[2]! - kb[2]!));
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('Hard key: among goal ties the least burdensome (⌊D/q_D⌋) wins before R; ladder key: constraints, then ⌊D/q_D⌋', () => {
    const gs = new GoalSystem([
      { id: 'a', sense: 'max', target: 1 },
      { id: 'b', sense: 'max', target: 1 },
    ]);
    gs.setBaseline([0, 0]);
    const p = { f: [0.8, 0.5], vS: 0, reg: 0.3 };
    const q = { f: [0.801, 0.5], vS: 0, reg: 0 };
    // same goal level: D decides (lower D first) even though p has the larger regulariser
    expect(compareKeys(gs.hardKey(p, 0.3), gs.hardKey(q, 0.6))).toBeLessThan(0);
    // same D quantum: R decides
    expect(compareKeys(gs.hardKey(q, 0.305), gs.hardKey(p, 0.3))).toBeLessThan(0);
    // a better goal level beats any D
    expect(compareKeys(gs.hardKey({ ...p, f: [0.9, 0.5] }, 0.99), gs.hardKey(p, 0))).toBeLessThan(0);
    const thr = [0.5, 0.2];
    expect(ladderViolation([0.4, 0.1], thr)).toBeCloseTo(0.1 + 0.25 * 0.1, 12);
    expect(ladderViolation([0.4, 0.5], [0.5, NaN])).toBeCloseTo(0.1, 12);
    const easy = { f: [0.55, 0.3], vS: 0, reg: 0 };
    const hard = { f: [0.95, 0.9], vS: 0, reg: 0 };
    // both meet the rung constraints: the lower difficulty wins whatever the goals
    expect(compareKeys(gs.ladderKey(easy, thr, 0.3), gs.ladderKey(hard, thr, 0.8))).toBeLessThan(0);
    // a plan that misses goal 1's constraint loses to any plan that meets it
    expect(compareKeys(gs.ladderKey(hard, thr, 0.8), gs.ladderKey({ ...easy, f: [0.45, 0.3] }, thr, 0.01))).toBeLessThan(0);
  });
});
