// @vitest-environment node
/**
 * The dedicated Easy search (PLANNER_V2_SPEC §12.2): budget, intensity bisection, stopping rule, proof of absence, and
 * on the planted ladder front: the least effort that keeps half of Hard's goal-1 progress, without moving Hard.
 */
import { describe, expect, it } from 'vitest';
import { EASY_SEARCH, bisectIntensity, easyProof, easySearchBudget, easyStopRule, lerpGenome } from './easySearch';
import type { PlannerConfig, PlannerResult } from './pipeline';
import { createLocalEvaluator, runPlanner } from './pipeline';
import { functionToy, ladderToy, type ToyPlanner, type ToyStructure } from './toys';

/** The ladder toy with start lines from the habit (effort 0) to Hard's effort (gene 0 is the effort). */
function withLines(toy: ToyPlanner): ToyPlanner {
  return {
    ...toy,
    problem: { ...toy.problem, easyStarts: (s: number, x: Float64Array) => [{ label: 'effort', structure: s, from: [0, x[1]!, x[2]!], to: x }] },
  };
}
const run = (toy: ToyPlanner, cfg: Partial<PlannerConfig> = {}): Promise<PlannerResult<ToyStructure>> =>
  runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { seed: 'easy', cvtSamples: 2000, tier: 'S', totalEU: 3000, ...cfg });

describe('pure parts', () => {
  it('budget: max(6 % of the tier total, 400), tier X 4 %', () => {
    expect(easySearchBudget('S', 3000)).toBe(400);
    expect(easySearchBudget('M', 12000)).toBe(720);
    expect(easySearchBudget('X', 300000)).toBe(12000);
    expect(easySearchBudget('X', 60000)).toBe(2400);
  });

  it('bisection finds the least intensity that meets the constraint (monotone), in ≤ 8 steps after the ends', async () => {
    const calls: number[] = [];
    const r = await bisectIntensity(async (a) => (calls.push(a), a), (a) => a >= 0.37);
    expect(r).not.toBeNull();
    expect(r!.alpha).toBeGreaterThanOrEqual(0.37);
    expect(r!.alpha - 0.37).toBeLessThan(1 / 2 ** EASY_SEARCH.bisectSteps + 1e-12);
    expect(calls.length).toBe(2 + EASY_SEARCH.bisectSteps);
    expect(await bisectIntensity(async (a) => a, () => false)).toBeNull();
    expect((await bisectIntensity(async (a) => a, () => true))!.alpha).toBe(0);
    expect(Array.from(lerpGenome([0, 1], [1, 0], 0.25))).toEqual([0.25, 0.75]);
  });

  it('stopping rule: three stalled generations without a new feasible plan, or the effort lower bound', () => {
    const s = easyStopRule(0.1);
    expect(s.observe(0.5, true)).toBe(false);
    expect(s.observe(0.498, false)).toBe(false);
    expect(s.observe(0.497, false)).toBe(false);
    expect(s.observe(0.497, false)).toBe(true);
    expect(s.reason).toBe('stall');
    const b = easyStopRule(0.2);
    expect(b.observe(0.4, true)).toBe(false);
    expect(b.observe(0.205, true)).toBe(true);
    expect(b.reason).toBe('bound');
    // an improving search keeps going
    const g = easyStopRule(0);
    for (let i = 0; i < 10; i++) expect(g.observe(0.9 - 0.05 * i, true)).toBe(false);
  });

  it('proof: the best goal-1 share among safe plans with less effort that keep the other goals', () => {
    const pts = [
      { D: 0.2, d1: 0.2, safe: true, othersOk: true },
      { D: 0.3, d1: 0.35, safe: true, othersOk: true },
      { D: 0.3, d1: 0.9, safe: false, othersOk: true },
      { D: 0.35, d1: 0.8, safe: true, othersOk: false },
      { D: 0.8, d1: 0.95, safe: true, othersOk: true },
    ];
    const p = easyProof(pts, 1, 0.5, 0.65, 4);
    expect(p).toEqual({ starts: 4, bestG1: 0.35, needed: 0.5, D: 0.3, evaluated: 5 });
    expect(p.bestG1).toBeLessThan(p.needed);
  });
});

describe('on the planted ladder front', () => {
  it('objective order: Easy is the least effort that keeps half of Hard, Hard does not move, EU on top', async () => {
    const toy = withLines(ladderToy());
    const off = await run(toy, { easySearch: false });
    const on = await run(toy);
    const L = on.ladder!;
    expect(L.easySearch).not.toBeNull();
    expect(L.easySearch!.eu).toBeGreaterThan(0);
    expect(on.provenance.stageEU['S5.easy']).toBeGreaterThan(0);
    // Hard untouched
    expect([L.rungs.hard!.structureIndex, Array.from(L.rungs.hard!.x)]).toEqual([off.ladder!.rungs.hard!.structureIndex, Array.from(off.ladder!.rungs.hard!.x)]);
    const E = L.rungs.easy!;
    expect(E).not.toBeNull();
    // keeps half of Hard's goal 1, and is no harder than the ladder's own Easy (one effort quantum)
    expect(E.desirability[0]!).toBeGreaterThanOrEqual(0.5 * L.gHard - 1e-9);
    if (off.ladder!.rungs.easy) expect(E.D!).toBeLessThanOrEqual(off.ladder!.rungs.easy.D! + 0.02 + 1e-9);
    // the planted front: half of Hard at e ≈ 1 − √(1 − g/2); the search lands within a few effort quanta of it
    const gH = L.rungs.hard!.objectives[0]!;
    const eStar = 1 - Math.sqrt(1 - (0.5 * Math.abs(gH)) / 1);
    expect(E.D!).toBeLessThan(eStar + 0.08);
    expect(on.provenance.budgetEU).toBe(3000 + (L.mediumBand?.grantEU ?? 0) + L.easySearch!.grantEU);
    expect(['own', 'easySearch']).toContain(E.provenance);
  }, 60_000);

  it('proof of absence: when half of Hard is out of reach with less effort, the proof says so and the reason holds', async () => {
    // goal 1 = e⁸ (steep): at Hard's effort ≈ 0.95 half of it needs e ≈ 0.87, i.e. less than 0.15 below Hard
    const structures: ToyStructure[] = [{ id: 'steep', dim: 3, tags: [0], x0: [0.5, 0.5, 0.5] }];
    const toy = withLines(
      functionToy(
        structures,
        [
          { id: 'attain', sense: 'max' },
          { id: 'lean', sense: 'max' },
        ],
        { structure: 0, x: [0, 0.5, 0.5] },
        (_s, _i, x) => {
          const e = x[0]!;
          return { goals: [e ** 8, x[1]! - 0.2 * e], margins: [(0.95 - e) / 0.95], reg: 0.01 * e, descriptors: [e, x[1]!, x[2]!], features: [e] };
        },
        { ladder: { gMinMetric: 0.05 }, featureSchema: [{ kind: 'numeric' }] },
      ),
    );
    const r = await run(toy);
    const L = r.ladder!;
    expect(L.rungs.easy).toBeNull();
    const proof = L.easySearch!.proof!;
    expect(proof).not.toBeNull();
    expect(proof.bestG1).toBeLessThan(proof.needed);
    expect(proof.needed).toBeCloseTo(0.5, 6);
    expect(proof.starts).toBeGreaterThan(0);
    const c = L.collapsed.find((q) => q.rung === 'easy')!;
    expect(c).toBeDefined();
    if (c.reason === 'tooClose') expect(c.detail['dGap']!).toBeLessThan(c.detail['minDGap']!);
    else expect(c.reason).toBe('infeasible');
  }, 60_000);

  it('is deterministic', async () => {
    const toy = withLines(ladderToy());
    const a = await run(toy);
    const b = await run(toy);
    expect(a.options.map((o) => [o.rung, o.provenance, Array.from(o.x)])).toEqual(b.options.map((o) => [o.rung, o.provenance, Array.from(o.x)]));
    expect(a.ladder!.easySearch).toEqual(b.ladder!.easySearch);
  }, 60_000);
});
