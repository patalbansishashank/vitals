/**
 * Fastest-safe-rate worker (ruling R-TTT): answers `estimateTargets(request)` for the Goals screen off the main thread.
 * Keeps the route cache of `reach.ts` alive between requests, so editing only a target amount is a lookup.
 */
import { estimateTargets } from '@/engine/planner/domain/reach';
import type { PlannerRequest } from '@/engine/planner/domain/types';

self.onmessage = (ev: MessageEvent) => {
  const { id, request } = ev.data as { id: number; request: PlannerRequest };
  try {
    self.postMessage({ id, result: estimateTargets(request) });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
