/**
 * Versioned production comparison policy (C7/D4-09). One lexicographic policy governs every comparison the shipped planner
 * makes — priority stages, carried floors, final ranking, rounding selection, chance repair and the ladder's Hard — and the
 * hybrid algorithm's adapter: the frozen v1 search (`bench/baselines/v1`, the historical benchmark comparator, unchanged)
 * may propose Hard, but its proposal competes under this policy's Hard key like any other finalist and wins only when it
 * is not worse there (ties go to the proposal). The frozen v1 comparator subtracts η·R inside the desirability (d − 0.1·R),
 * so a plan with a real outcome sacrifice could win on burden; this policy never lets the regulariser trade outcome
 * outside one declared quantum.
 *
 * Indifference: goal k is resolved to one quantum q_k = max(0.01, minTolerance_k / (u_k − b_k)) desirability units (½ of
 * the ensemble P10–P90 half-width in metric units), the weighted goal score to q_G; inside one quantum the plans are
 * declared outcome-indifferent and burden (difficulty D, then the regulariser R) decides. These quanta are numerical
 * design policy, not empirical clinical equivalence, and burden weights are design priors until calibrated from
 * preferences and adherence. No physiological coefficient is involved.
 *
 * Changing the policy changes `PLANNER_POLICY_FINGERPRINT`, which keys checkpoints and result provenance: optimizer
 * checkpoints from another policy are not resumed, and stored plans keep the fingerprint they were made under.
 */
import { fnv1a } from '../../core/math';

export const PLANNER_COMPARISON_POLICY = {
  version: 2,
  id: 'goalFirstQuantized',
  stageKey: 'vS, vL(j<k), -floor(d_k/q_k), R + boxWeight*box, -d_k',
  finalKey: 'vS, vL, -floor(G/q_G), R + boxWeight*box, -G',
  hardKey: 'jointShortfall, chanceViolation, vL(robust d), -floor(G/q_G), floor(D/q_D), R + boxWeight*box, -G',
  rungKey: 'vS, ladderViolation, floor(D/q_D), -floor(d_k/q_k) k>=2, R + boxWeight*box, D',
  chanceRepair: 'polish with the same role key; replace only when the joint screen passes on the same draws',
  floors: 'L_k = d_k(stage winner) - delta_k, carried in physical units',
  indifference: { goal: 'q_k = max(0.01, minTolerance_k/(u_k - b_k))', score: 'q_G = max(0.01, sqrt(sum (w_k q_k)^2))', unit: 'desirability' },
  regulariser: 'breaks ties only inside one declared quantum',
  hybridAdapter: 'frozen v1 option A competes under hardKey; ties prefer it; never decided by d - eta*R',
  frozenBaseline: 'bench/baselines/v1 (historical comparator, read-only)',
} as const;

/** Fingerprint of the comparison policy (checkpoint keys, result provenance, certificates). */
export const PLANNER_POLICY_FINGERPRINT: string = `pol${PLANNER_COMPARISON_POLICY.version}-${fnv1a(JSON.stringify(PLANNER_COMPARISON_POLICY))}`;
