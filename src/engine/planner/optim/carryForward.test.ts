// @vitest-environment node
/**
 * Rung stability across tiers (PLANNER_V2_SPEC §12.1): a longer run receives the shorter run's Medium and Easy and keeps
 * them when its own collapse; a carried rung that fails against the new Hard is a stated reason with its numbers.
 */
import { describe, expect, it } from 'vitest';
import type { PlannerConfig, PlannerResult } from './pipeline';
import { createLocalEvaluator, runPlanner } from './pipeline';
import { ladderToy, type ToyPlanner, type ToyStructure } from './toys';

const run = (toy: ToyPlanner, cfg: Partial<PlannerConfig> = {}): Promise<PlannerResult<ToyStructure>> =>
  runPlanner(toy.problem, createLocalEvaluator(toy.model, toy.problem.structures), { seed: 'carry', cvtSamples: 2000, tier: 'S', totalEU: 3000, ...cfg });

const prevOf = (r: PlannerResult<ToyStructure>, tier: string, ids: ReadonlyArray<'hard' | 'medium' | 'easy'> = ['medium', 'easy']): NonNullable<PlannerConfig['previous']> => {
  const rungs: NonNullable<PlannerConfig['previous']>['rungs'] = {};
  for (const id of ids) {
    const o = r.ladder!.rungs[id];
    if (o) rungs[id] = { structure: o.structureIndex, x: Array.from(o.x) };
  }
  return { tier, rungs };
};
const cards = (r: PlannerResult<ToyStructure>) => (['hard', 'medium', 'easy'] as const).filter((k) => r.ladder!.rungs[k]);

describe('carry-forward', () => {
  it('a longer run whose own rungs collapse keeps the shorter run’s Medium and Easy (never fewer cards)', async () => {
    const toy = ladderToy();
    const short = await run(toy, { seed: 'm' });
    expect(cards(short)).toEqual(['hard', 'medium', 'easy']);
    // the "longer" run with its own Medium / Easy machinery off: only carried rungs can fill them
    // (measured: at 100 EU this run's own ladder keeps Hard and Easy and drops Medium)
    const own = await run(toy, { seed: 'x', easySearch: false, mediumBand: false, totalEU: 100 });
    expect(cards(own)).toEqual(['hard', 'easy']);
    const longer = await run(toy, { seed: 'x', easySearch: false, mediumBand: false, totalEU: 100, previous: prevOf(short, 'M') });
    expect(cards(longer)).toEqual(['hard', 'medium', 'easy']);
    expect(longer.ladder!.rungs.medium!.provenance).toBe('carried');
    expect(longer.ladder!.carried.medium).toMatchObject({ kept: true, fromTier: 'M', reason: null });
    // the better of carried and own: the carried Easy needs less effort than this run's own, so it is kept
    expect(longer.ladder!.rungs.easy!.D!).toBeLessThanOrEqual(own.ladder!.rungs.easy!.D! + 1e-12);
    expect(cards(longer).length).toBeGreaterThanOrEqual(cards(short).length);
    // Hard is this run's own, untouched by what was carried
    expect([longer.ladder!.rungs.hard!.structureIndex, Array.from(longer.ladder!.rungs.hard!.x)]).toEqual([own.ladder!.rungs.hard!.structureIndex, Array.from(own.ladder!.rungs.hard!.x)]);
    for (const id of ['medium', 'easy'] as const) {
      const o = longer.ladder!.rungs[id]!;
      expect(['own', 'carried']).toContain(o.provenance);
      if (!own.ladder!.rungs[id]) expect(o.provenance).toBe('carried');
    }
    expect(Object.values(longer.ladder!.carried).every((c) => c.fromTier === 'M')).toBe(true);
    // re-checked against the new Hard: ordered and distinct
    expect(longer.ladder!.checks.ordered).toBe(true);
    expect(longer.ladder!.checks.dHM).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(longer.ladder!.checks.dME).toBeGreaterThanOrEqual(0.15 - 1e-9);
  }, 120_000);

  it('a carried rung that no longer keeps half of the new Hard is dropped with the failing check and its numbers', async () => {
    const toy = ladderToy();
    // an "Easy" at effort 0.05 reaches ≈ 10 % of a Hard near effort 0.9
    const previous = { tier: 'M', rungs: { easy: { structure: 0, x: [0.05, 0.5, 0.5] } } };
    const r = await run(toy, { seed: 'y', easySearch: false, mediumBand: false, totalEU: 400, previous });
    if (r.ladder!.rungs.easy) {
      // its own Easy stood: the carried one lost and says why
      expect(r.ladder!.rungs.easy.provenance).toBe('own');
      expect(r.ladder!.carried.easy).toMatchObject({ kept: false, reason: 'goals' });
    } else {
      const c = r.ladder!.collapsed.find((q) => q.rung === 'easy')!;
      expect(c.detail['carried']).toBe(1);
      expect(c.reason).toBe('infeasible');
      expect(c.detail['gShareCarried']!).toBeLessThan(c.detail['needed']!);
    }
  }, 120_000);

  // Q3b: "Stop here" on an exhaustive search lost the quick search's Medium and Easy ('infeasible', never checked)
  it.each([150, 600, 1500])('a run stopped after %i evaluations keeps the carried Medium and Easy, or says which check failed', async (stopAt) => {
    const toy = ladderToy();
    const short = await run(toy, { seed: 'm' });
    expect(cards(short)).toEqual(['hard', 'medium', 'easy']);
    const signal = { aborted: false };
    const base = createLocalEvaluator(toy.model, toy.problem.structures);
    let n = 0;
    const evaluator = {
      evaluate: (b: Parameters<typeof base.evaluate>[0]) => {
        n += b.length;
        if (n >= stopAt) signal.aborted = true;
        return base.evaluate(b);
      },
    };
    const r = await runPlanner(toy.problem, evaluator, { seed: 'x', cvtSamples: 2000, tier: 'S', totalEU: 3000, previous: prevOf(short, 'S', ['hard', 'medium', 'easy']), signal });
    expect(r.complete).toBe(false);
    const H = r.ladder!.rungs.hard!;
    expect(H).not.toBeNull();
    // Hard: the previous search's Hard is weighed, so a stopped run never returns a weaker one (nominal goal 1)
    const sH = short.ladder!.rungs.hard!;
    expect(H.desirability[0]!).toBeGreaterThanOrEqual(sH.desirability[0]! - 0.05);
    if (H.provenance === 'carried') expect([H.structureIndex, Array.from(H.x)]).toEqual([sH.structureIndex, Array.from(sH.x)]);
    for (const id of ['medium', 'easy'] as const) {
      const o = r.ladder!.rungs[id];
      const cr = r.ladder!.carried[id]!;
      expect(cr.fromTier).toBe('S');
      if (o) {
        if (o.provenance === 'carried') expect(cr).toMatchObject({ kept: true, reason: null });
        continue;
      }
      // dropped: the carried rung was re-checked and failed a stated check, with its numbers
      expect(cr.kept).toBe(false);
      expect(['goals', 'distinct', 'unsafe', 'validation', 'chance']).toContain(cr.reason);
      const c = r.ladder!.collapsed.find((q) => q.rung === id)!;
      expect(c).toBeDefined();
      if (c.reason === 'infeasible') expect(c.detail['carried']).toBe(1);
    }
    // never fewer cards than the quick search unless a carried rung failed a check against the new Hard
    if (Object.values(r.ladder!.carried).every((c) => c.kept || c.reason === 'replaced')) expect(cards(r).length).toBeGreaterThanOrEqual(cards(short).length);
  }, 120_000);

  it('a stopped run without a previous ladder marks unchecked rungs as stopped, never an unproven infeasible', async () => {
    const toy = ladderToy();
    const signal = { aborted: false };
    const base = createLocalEvaluator(toy.model, toy.problem.structures);
    let n = 0;
    const evaluator = {
      evaluate: (b: Parameters<typeof base.evaluate>[0]) => {
        n += b.length;
        if (n >= 150) signal.aborted = true;
        return base.evaluate(b);
      },
    };
    const r = await runPlanner(toy.problem, evaluator, { seed: 'x', cvtSamples: 2000, tier: 'S', totalEU: 3000, signal });
    expect(r.complete).toBe(false);
    for (const id of ['medium', 'easy'] as const) {
      if (r.ladder!.rungs[id]) continue;
      const c = r.ladder!.collapsed.find((q) => q.rung === id)!;
      expect(c).toBeDefined();
      if (c.reason === 'infeasible') expect(Object.keys(c.detail).length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('a structure the run does not have is ignored (another request shape)', async () => {
    const toy = ladderToy();
    const r = await run(toy, { previous: { tier: 'S', rungs: { easy: { structure: 99, x: [0.1] } } } });
    expect(r.ladder!.carried.easy).toMatchObject({ kept: false, reason: 'structure' });
  }, 120_000);
});
