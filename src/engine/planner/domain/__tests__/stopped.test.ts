// @vitest-environment node
/**
 * "Stop here" on a longer search (plan-ladder.md §8 "Stopping keeps the plans found so far", PLANNER_V2_SPEC §12.1,
 * §12.3, §12.6): the stopped run re-checks the shown Medium and Easy against its Hard and keeps them or states the failed
 * check; a rung it never checked says the search stopped (never an unproven "no plan"); the Ideal it skipped is said.
 * Request (c) at tier S, one thread.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runLadderPlanner } from '../ladderPlanner';
import { STOPPED_BEFORE_PLAN, stoppedResultWorse } from '../stoppedLadder';
import type { PlannerRequestV2, PlannerResultV2 } from '../types';
import { GOLDEN } from './golden.requests';

const req: PlannerRequestV2 = { ...GOLDEN.c, budget: { tier: 'S' as const } };

/**
 * Run with a signal that aborts at the first progress of `stage` (as "Stop here" does mid-search). The v2 pipeline alone,
 * as tier X runs it (the hybrid runs v2 only for tiers S-L).
 */
async function stoppedRun(request: PlannerRequestV2, stage: string): Promise<PlannerResultV2> {
  const signal = { aborted: false };
  return runLadderPlanner(request, {
    tier: 'S',
    algorithm: 'v2',
    signal,
    onProgress: (p) => {
      if (p.stage.startsWith(stage)) signal.aborted = true;
    },
  });
}

const cards = (v2: PlannerResultV2) => (['hard', 'medium', 'easy'] as const).filter((k) => v2.rungs[k]);

describe('a stopped search keeps what was found', () => {
  it('keeps the previous Medium and Easy (or states the failed check) and says the Ideal was not searched', async () => {
    const quick = await runLadderPlanner(req, { tier: 'S', algorithm: 'v2' });
    expect(quick.status).toBe('ok');
    const rungs: NonNullable<PlannerRequestV2['previous']>['rungs'] = {};
    for (const r of ['hard', 'medium', 'easy'] as const) {
      const g = quick.rungs[r]?.genome;
      if (g) rungs[r] = { structureId: g.structureId, x: [...g.x] };
    }
    const stopped = await stoppedRun({ ...req, previous: { tier: 'S', rungs } }, 'S3');
    expect(stopped.complete).toBe(false);
    expect(stopped.status).toBe('ok');
    // Hard: never weaker than the one shown (the quick search's Hard is weighed by a stopped run), up to goal 1's tolerance
    const sense = req.goals[0]!.direction === 'minimise' || (req.goals[0]!.target ?? 0) < 0 ? -1 : 1;
    const ch = (v: PlannerResultV2) => sense * v.rungs.hard!.summary.outcomes[0]!.change;
    expect(ch(stopped)).toBeGreaterThanOrEqual(ch(quick) - Math.max(0.05 * Math.abs(ch(quick)), 0.1));
    if (stopped.rungs.hard!.provenance === 'carried') expect(stopped.rungs.hard!.fromTier).toBe('S');
    for (const r of ['medium', 'easy'] as const) {
      if (!quick.rungs[r]) continue;
      if (stopped.rungs[r]) continue;
      // dropped: only by a failed check of the carried rung against the new Hard, with its numbers
      const c = stopped.ladder.collapsed.find((q) => q.rung === r)!;
      expect(c).toBeDefined();
      expect(c.carried).toBe(true);
    }
    if (!stopped.ladder.collapsed.some((c) => c.carried)) expect(cards(stopped).length).toBeGreaterThanOrEqual(cards(quick).length);
    for (const r of ['medium', 'easy'] as const) {
      const p = stopped.rungs[r];
      if (p && p.provenance === 'carried') expect(p.fromTier).toBe('S');
    }
    // the Ideal search did not run: said, not silently absent
    expect(stopped.ideal).toBeNull();
    expect(stopped.idealSkipped).toBe('stopped');
    // the convergence trace is on the result for the graph
    expect(stopped.convergence.length).toBeGreaterThan(1);
  }, 1_800_000);

  it('without a previous ladder an unchecked rung says the search stopped, never an unproven "infeasible"', async () => {
    const stopped = await stoppedRun(req, 'S1');
    expect(stopped.complete).toBe(false);
    for (const r of ['medium', 'easy'] as const) {
      if (stopped.rungs[r]) continue;
      const c = stopped.ladder.collapsed.find((q) => q.rung === r)!;
      expect(c).toBeDefined();
      if (c.reason === 'infeasible') expect(Object.keys(c.detail ?? {}).length).toBeGreaterThan(0);
      expect(c.reason).not.toBe('belowMinimal');
      if (c.reason === 'stopped') expect(c.text).toMatch(/^The search was stopped before (Medium|Easy) was found or checked\.$/);
    }
  }, 1_800_000);
});

// Q7 (Q3-J4-09 follow-up): the shipped hybrid stopped in its first phase (v1's search, `stoppedAt: 'S0'`) returned a
// near-empty Hard (≈ 0 kg of fat) as a plan, and it replaced a better previous ladder. Now the previous search's Hard
// outranks the barely searched pinned one, and with no previous ladder no plan is claimed.
describe('a search stopped in its first phase (hybrid)', () => {
  let quick: PlannerResultV2;
  const previousOf = (v2: PlannerResultV2): NonNullable<PlannerRequestV2['previous']> => {
    const rungs: NonNullable<PlannerRequestV2['previous']>['rungs'] = {};
    for (const r of ['hard', 'medium', 'easy'] as const) {
      const g = v2.rungs[r]?.genome;
      if (g) rungs[r] = { structureId: g.structureId, x: [...g.x] };
    }
    return { tier: 'S', rungs };
  };
  /** The default algorithm, stopped at its first progress event. */
  const stopAtOnce = (request: PlannerRequestV2) => {
    const signal = { aborted: false };
    return runLadderPlanner(request, { tier: 'S', signal, onProgress: () => (signal.aborted = true) });
  };
  const sense = req.goals[0]!.direction === 'minimise' || (req.goals[0]!.target ?? 0) < 0 ? -1 : 1;
  const ch = (v: PlannerResultV2) => sense * v.rungs.hard!.summary.outcomes[0]!.change;

  beforeAll(async () => {
    quick = await runLadderPlanner(req, { tier: 'S' });
  }, 1_800_000);

  it('does not replace a better previous ladder: its Hard, Medium and Easy come back (re-checked), and the earlier ladder is kept', async () => {
    expect(quick.status).toBe('ok');
    const stopped = await stopAtOnce({ ...req, previous: previousOf(quick) });
    expect(stopped.complete).toBe(false);
    expect(stopped.stoppedAt).toBe('S0');
    expect(stopped.status).toBe('ok');
    // Hard: the quick search's (carried), never the barely searched start point
    expect(stopped.rungs.hard!.provenance).toBe('carried');
    expect(stopped.rungs.hard!.genome).toEqual(quick.rungs.hard!.genome);
    expect(ch(stopped)).toBeGreaterThanOrEqual(ch(quick) - Math.max(0.05 * Math.abs(ch(quick)), 0.1));
    if (!stopped.ladder.collapsed.some((c) => c.carried)) expect(cards(stopped).length).toBeGreaterThanOrEqual(cards(quick).length);
    expect(stopped.idealSkipped).toBe('stopped');
    // nothing better than the shown ladder: the screens keep it (with its Ideal and range checks)
    expect(stoppedResultWorse(stopped, quick)).not.toBeNull();
  }, 1_800_000);

  it('with no previous ladder claims no plan instead of a near-empty Hard', async () => {
    const stopped = await stopAtOnce(req);
    expect(stopped.complete).toBe(false);
    expect(stopped.stoppedAt).toBe('S0');
    expect(stopped.rungs.hard).toBeUndefined();
    expect(stopped.status).toBe('noSafePlan');
    expect(stopped.message).toBe(STOPPED_BEFORE_PLAN);
    expect(stopped.idealSkipped ?? null).toBeNull();
    // and it never replaces a ladder on screen
    expect(stoppedResultWorse(stopped, quick)).toBe('noPlan');
  }, 1_800_000);
});
