/**
 * The Planner's single call site into the optimiser workers (src/workers/plannerClient.ts, documented in
 * src/engine/planner/domain/README.md §1). Everything in this feature goes through here, so tests mock one module.
 *
 * - `planLadder(request, { onProgress, signal, tier })`: the plan ladder (Hard · Medium · Easy) and the Ideal. Abort =
 *   cooperative stop (resolves with the best result so far, `complete: false`). Tier X is the exhaustive search.
 * - `resumeLadder(checkpointKey, options)`: continue a stored exhaustive search; `checkpointFor(request)` says whether
 *   one is stored for these goals, or that one for other goals was set aside (`discardCheckpoint` then deletes it).
 * - `cancelPlanning()`: hard stop (terminates the workers; the pending promise rejects with an AbortError).
 * - `estimateTargetsAsync(request)`: the fastest-safe-rate answer per goal for the Goals screen's pre-run hints.
 */
import { TIER_BUDGET_EU } from '@/engine/planner/optim/pipeline';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';
import { hasCheckpoint } from '@/workers/plannerClient';

export { planLadder, resumeLadder, hasCheckpoint, discardCheckpoint, cancelPlanning, estimateTargetsAsync } from '@/workers/plannerClient';
export type { PlanLadderOptions } from '@/workers/plannerClient';

export type CheckpointState = { state: 'none' } | { state: 'resume'; key: string; fraction: number | null } | { state: 'discarded'; key: string };

/** Whether an exhaustive search can be resumed for this request (normalised; never throws). */
export async function checkpointFor(request: PlannerRequestV2): Promise<CheckpointState> {
  try {
    const r = await hasCheckpoint(request);
    if (!r) return { state: 'none' };
    if ('stale' in r) return { state: 'discarded', key: r.key };
    const f = r.euUsed / TIER_BUDGET_EU.X;
    return { state: 'resume', key: r.key, fraction: Number.isFinite(f) ? Math.min(0.99, Math.max(0, f)) : null };
  } catch {
    return { state: 'none' };
  }
}
