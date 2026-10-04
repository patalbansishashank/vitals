/**
 * "Stopping keeps the plans found so far" (plan-ladder.md §8, PLANNER_V2_SPEC §12.1): when a longer search of the same
 * request is stopped, its result replaces the ladder on screen only when it is at least as complete and no worse. Else
 * the earlier ladder (Hard, Medium, Easy and its Ideal, with its range checks) stays and the result says the search was
 * stopped (`PlannerResultV2.keptAfterStop`).
 */
import type { GoalScoreV2, PlannerResultV2, PlannerTier, RungId } from './types';

/** The message of a stopped run with no plan worth showing yet (its Hard below goal 1's least worthwhile change, g_min). */
export const STOPPED_BEFORE_PLAN = 'The search was stopped before it found a plan.';

const RUNGS: readonly RungId[] = ['hard', 'medium', 'easy'];
/** Hard's goal-1 progress may be this share below the earlier Hard's (nominal vs holdout numbers of the same plan). */
export const STOPPED_HARD_TOLERANCE = 0.02;

/** +1 when goal 1 improves upwards, −1 downwards (a target goal: towards its target from the start). */
function senseOf(s: GoalScoreV2): number {
  if (s.direction === 'minimise') return -1;
  if (s.direction === 'maximise') return 1;
  return s.target !== null && s.target < s.start ? -1 : 1;
}

const sameGenome = (a: { structureId: string; x: number[] }, b: { structureId: string; x: number[] }) =>
  a.structureId === b.structureId && a.x.length === b.x.length && a.x.every((v, i) => Math.abs(v - b.x[i]!) <= 1e-6);

/**
 * Why a stopped search's result is worse than or less complete than the earlier ladder of the same request, or null
 * when it may replace it. The rule, in order:
 * - 'noPlan': the stopped result has no Hard (status not 'ok');
 * - 'fewerRungs': a rung the earlier ladder had (Hard, Medium, Easy) is missing;
 * - 'weakerHard': Hard's goal-1 progress (sense-adjusted change) is below the earlier Hard's by more than
 *   `STOPPED_HARD_TOLERANCE` of it, or a goal the earlier Hard reached or kept is no longer reached;
 * - 'nothingNew': every rung is the earlier ladder's own plan (the stopped search only re-checked them; the earlier
 *   result has the Ideal and the range checks the stopped one skipped).
 * A complete result, or an earlier result without a ladder, is never worse.
 */
export function stoppedResultWorse(stopped: PlannerResultV2, earlier: PlannerResultV2 | null | undefined): 'noPlan' | 'fewerRungs' | 'weakerHard' | 'nothingNew' | null {
  if (stopped.complete || !earlier || earlier.status !== 'ok' || !earlier.rungs.hard) return null;
  const h = stopped.rungs.hard;
  if (stopped.status !== 'ok' || !h) return 'noPlan';
  if (RUNGS.some((r) => earlier.rungs[r] && !stopped.rungs[r])) return 'fewerRungs';
  const e = earlier.rungs.hard;
  const s0 = h.scorecard[0];
  const e0 = e.scorecard[0];
  if (s0 && e0) {
    const sense = senseOf(e0);
    const now = sense * s0.change;
    const before = sense * e0.change;
    if (now < before - STOPPED_HARD_TOLERANCE * Math.abs(before) - 1e-9) return 'weakerHard';
  }
  const was = (v: GoalScoreV2['verdict']) => v === 'reached' || v === 'kept';
  if (e.scorecard.some((g, i) => was(g.verdict) && h.scorecard[i]?.verdict === 'notReached')) return 'weakerHard';
  if (RUNGS.every((r) => { const p = stopped.rungs[r]; const q = earlier.rungs[r]; return !p || (q && sameGenome(p.genome, q.genome)); })) return 'nothingNew';
  return null;
}

/**
 * The earlier result kept after a stopped search of `tier` that was worse (`stoppedResultWorse`). It carries the stopped
 * search's convergence curve when that search recorded one: after "Stop here" at a plateau the person still sees how the
 * long search went (plan-ladder.md §12.4).
 */
export function keepAfterStop(earlier: PlannerResultV2, stopped: PlannerResultV2, why: NonNullable<ReturnType<typeof stoppedResultWorse>>): PlannerResultV2 {
  const convergence = stopped.convergence?.length ? stopped.convergence : earlier.convergence;
  return { ...earlier, convergence, keptAfterStop: { tier: stopped.provenance.tier as PlannerTier, stoppedAt: stopped.stoppedAt, why } };
}
