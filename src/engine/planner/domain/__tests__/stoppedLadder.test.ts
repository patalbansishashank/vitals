// @vitest-environment node
/**
 * The rule for "worse" (Q7, Q3-J4-09 follow-up): a stopped longer search replaces the shown ladder only when it has
 * every rung the shown ladder has, a Hard at least as good on goal 1 (2 % tolerance) that keeps every goal the shown Hard
 * reached, and at least one plan of its own.
 */
import { describe, expect, it } from 'vitest';
import { keepAfterStop, stoppedResultWorse } from '../stoppedLadder';
import type { GoalScoreV2, PlannerResultV2, RungId, RungPlan } from '../types';

const score = (change: number, verdict: GoalScoreV2['verdict'] = 'notReached'): GoalScoreV2 =>
  ({ goal: 0, metric: 'fatMass', label: 'Fat mass', unit: 'kg', direction: 'target', start: 25, value: 25 + change, change, target: 20, percentOfAchievable: 80, percentOfTarget: null, met: verdict === 'reached', verdict, costVsHard: 0 }) as unknown as GoalScoreV2;
const rung = (kind: RungId, id: string, change: number, verdict?: GoalScoreV2['verdict']): RungPlan =>
  ({ kind, genome: { structureId: id, x: [0.5] }, scorecard: [score(change, verdict)] }) as unknown as RungPlan;
const result = (rungs: Partial<Record<RungId, RungPlan>>, over: Partial<PlannerResultV2> = {}): PlannerResultV2 =>
  ({ status: rungs.hard ? 'ok' : 'noSafePlan', complete: true, stoppedAt: null, rungs, ideal: null, provenance: { tier: 'S' }, ...over }) as unknown as PlannerResultV2;
const stopped = (rungs: Partial<Record<RungId, RungPlan>>) => result(rungs, { complete: false, stoppedAt: 'S3', provenance: { tier: 'X' } as PlannerResultV2['provenance'] });

const quick = result({ hard: rung('hard', 'h', -5), medium: rung('medium', 'm', -3), easy: rung('easy', 'e', -2) });

describe('stoppedResultWorse', () => {
  it('no plan, a missing rung, a weaker Hard or nothing new keeps the earlier ladder', () => {
    expect(stoppedResultWorse(stopped({}), quick)).toBe('noPlan');
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h2', -6), easy: rung('easy', 'e2', -2) }), quick)).toBe('fewerRungs');
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h2', -4.8), medium: rung('medium', 'm2', -3), easy: rung('easy', 'e', -2) }), quick)).toBe('weakerHard');
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h', -5.1), medium: rung('medium', 'm', -3), easy: rung('easy', 'e', -2) }), quick)).toBe('nothingNew');
    // a goal the earlier Hard reached and the new one misses
    const reached = result({ hard: rung('hard', 'h', -5, 'reached') });
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h2', -5.2, 'notReached') }), reached)).toBe('weakerHard');
  });

  it('a complete set with a Hard as good (within 2 %) or better and a plan of its own may replace it', () => {
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h2', -4.95), medium: rung('medium', 'm', -3), easy: rung('easy', 'e', -2) }), quick)).toBeNull();
    expect(stoppedResultWorse(stopped({ hard: rung('hard', 'h', -5), medium: rung('medium', 'm2', -3.5), easy: rung('easy', 'e', -2) }), quick)).toBeNull();
  });

  it('never applies to a complete search or without an earlier ladder', () => {
    expect(stoppedResultWorse(result({}), quick)).toBeNull();
    expect(stoppedResultWorse(stopped({}), null)).toBeNull();
    expect(stoppedResultWorse(stopped({}), result({}))).toBeNull();
  });

  it('keepAfterStop is the earlier result, marked with the stopped search', () => {
    const s = stopped({});
    const kept = keepAfterStop(quick, s, 'noPlan');
    expect(kept.rungs).toBe(quick.rungs);
    expect(kept.complete).toBe(true);
    expect(kept.keptAfterStop).toEqual({ tier: 'X', stoppedAt: 'S3', why: 'noPlan' });
  });

  it('keepAfterStop carries the stopped search\'s convergence curve (a plateau stop still shows how the search went)', () => {
    const curve = [{ eu: 10, hardY: -4 }, { eu: 50, hardY: -5 }] as unknown as PlannerResultV2['convergence'];
    const kept = keepAfterStop({ ...quick, convergence: [] }, { ...stopped({}), convergence: curve }, 'nothingNew');
    expect(kept.convergence).toBe(curve);
    const none = keepAfterStop({ ...quick, convergence: curve }, { ...stopped({}), convergence: [] }, 'noPlan');
    expect(none.convergence).toBe(curve);
  });
});
