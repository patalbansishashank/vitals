// @vitest-environment node
/**
 * Planner v2 end to end on the real engine (PLANNER_V2_SPEC §1-§2, §9.2, §9.7 rows Ladder and Ideal): the ladder from one
 * run, the Ideal with the practical limits removed (safety and consent kept), the cost of each binding limit, the v1 view
 * with fixed ids, and the copy rules. Request (c) (56 days) at tier S keeps it to a few minutes in one thread.
 */
import { describe, expect, it } from 'vitest';
import { toV1Result, V1_ID } from '../compat';
import { lexicographicallyWorse, runLadderPlanner } from '../ladderPlanner';
import { idealRequest, LIMIT_CLASS } from '../limits';
import type { PlannerResultV2, RungId } from '../types';
import { expectLadder } from './golden';
import { GOLDEN } from './golden.requests';

const req = { ...GOLDEN.c, budget: { tier: 'S' as const } };
let cached: Promise<PlannerResultV2> | null = null;
const run = () => (cached ??= runLadderPlanner(req, { tier: 'S' }));

describe('planner v2: ladder, Ideal and limit costs (request c, tier S)', () => {
  it('returns Hard with its summary, an honest ladder and the v1 view with fixed ids', async () => {
    const v2 = await run();
    expect(v2.status).toBe('ok');
    expect(v2.provenance.plannerVersion).toBe(2);
    const v1 = toV1Result(v2);
    expectLadder(v1);
    for (const o of v1.options) {
      const rung = (Object.keys(V1_ID) as RungId[]).find((r) => V1_ID[r] === o.id)!;
      expect(v2.rungs[rung]).toBeDefined();
    }
    const H = v2.rungs.hard!;
    expect(H.summary.title).toBe('Hard');
    expect(H.summary.difficulty.components).toHaveLength(7);
    expect(H.summary.difficulty.D).toBeGreaterThanOrEqual(0);
    expect(H.summary.difficulty.D).toBeLessThanOrEqual(1);
    expect(H.summary.outcomes).toHaveLength(req.goals.length);
    expect(H.genome.x.length).toBeGreaterThan(0);
    // holdout numbers: the P50 sits inside its own band
    for (const oc of H.summary.outcomes) if (oc.band) expect(oc.p50).toBeGreaterThanOrEqual(Math.min(oc.band.p10, oc.band.p90) - 1e-9);
  }, 1_800_000);

  it('runs the Ideal on the relaxed request with safety and consent kept, never startable', async () => {
    const v2 = await run();
    expect(v2.ideal).not.toBeNull();
    const I = v2.ideal!;
    expect(I.kind).toBe('ideal');
    expect(I.summary.title).toBe('Ideal');
    // the Ideal relaxes only practical and preference fields
    const classOf = new Map(LIMIT_CLASS.filter((f) => f.from === 'PracticalConstraints').map((f) => [f.field, f.class]));
    for (const r of I.relaxed) {
      const top = r.field.split('.')[0]!;
      if (classOf.has(top)) expect(['practical', 'preference']).toContain(classOf.get(top));
    }
    expect(idealRequest(req).request.safety).toEqual(req.safety);
    expect(idealRequest(req).request.goals).toEqual(req.goals);
    // the Ideal is the ceiling (ε-lexicographic): on goal 1 it is at least as good as Hard up to goal 1's ladder tolerance
    // (5 % of the achievable range, here ≈ 5 % of Hard's change) and the model's precision, unless a lower-ranked goal gains
    const H = v2.rungs.hard!;
    const senseOf = (k: number) => (req.goals[k]!.direction === 'minimise' || (req.goals[k]!.target ?? 0) < 0 ? -1 : 1);
    const gain = (k: number) => senseOf(k) * (I.summary.outcomes[k]!.p50 - H.summary.outcomes[k]!.p50);
    const tol = Math.max(0.05 * Math.abs(H.summary.outcomes[0]!.change), 0.1);
    if (gain(0) < -tol) expect(I.summary.outcomes.slice(1).some((_, k) => gain(k + 1) > 0), 'goal 1 given up only for a lower-ranked goal').toBe(true);
    expect(gain(0)).toBeGreaterThanOrEqual(-3 * tol);
    // limit costs only for limits Hard presses against; each has a sentence and an adopt patch
    const binding = new Set(H.summary.bindingLimits.map((b) => b.group));
    for (const c of I.limitCosts) {
      expect(binding.has(c.group)).toBe(true);
      expect(c.text).toMatch(/^Allowing /);
      expect(c.deltas).toHaveLength(req.goals.length);
    }
    expect(I.advised.length).toBeGreaterThan(0);
    // QA PLN-03: the Ideal's feasible set contains Hard's plan, so it is never lexicographically worse than Hard (goal by
    // goal on the holdout P50s, beyond 5 % of Hard's change); a fallback to Hard's plan states that no limit binds
    const quanta = H.summary.outcomes.map((oc) => Math.max(0.05 * Math.abs(oc.change), 1e-6));
    expect(lexicographicallyWorse(req.goals.map((_, k) => gain(k)), quanta), 'Ideal below Hard').toBe(false);
    if (I.gapVsHard.every((g) => g.delta === 0)) expect(I.nothingBinds).toBe(true);
    if (I.nothingBinds) for (const g of I.gapVsHard) expect(Math.abs(g.delta)).toBeLessThan(Math.max(1, Math.abs(H.summary.outcomes[g.goal]!.change)));
  }, 1_800_000);
});
