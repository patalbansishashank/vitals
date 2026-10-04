/**
 * The planner request with the blood-marker evaluation applied (SUITE_SPEC §13.5.3). Pure.
 *   - lab locks merged into `safety` by `mergeSafety` (the stricter of lab and screening wins);
 *   - `markerWarnings`: the active notes (shown before the ladder and on the rungs they touch; not a margin);
 *   - `preferLevers`: the ranking bias of prefer rules (≤ 0.02 each; regulariser only).
 */
import type { PlannerRequest } from '@/engine/planner/domain/types';
import type { LocalDate } from '@/store';
import { BLOCKING_REASKS, mergeSafety } from '../rules';
import type { MarkerEvaluation } from '../types';

export const MAX_PREFER_WEIGHT = 0.02;

/** Unchanged object when the evaluation adds nothing (stable request hashes). */
export function withMarkerSafety<R extends PlannerRequest>(request: R, ev: MarkerEvaluation | null | undefined): R {
  if (!ev) return request;
  const hasPatch = ev.safety.plannerLocks.length > 0 || ev.safety.flags.length > 0;
  if (!hasPatch && ev.notes.length === 0 && ev.preferLevers.length === 0) return request;
  const out: R = { ...request };
  if (hasPatch) out.safety = mergeSafety(request.safety, ev.safety);
  if (ev.notes.length) out.markerWarnings = ev.notes;
  if (ev.preferLevers.length) out.preferLevers = ev.preferLevers.map((p) => ({ lever: p.lever, weight: Math.min(MAX_PREFER_WEIGHT, p.weight), rule: p.rule }));
  return out;
}

/**
 * When each re-asked screening item was last answered. The screening stores one answer time for the whole set, so
 * every blocking re-ask reads it: answering the safety questions again clears re-asks raised by older readings.
 */
export function screeningAnsweredOn(answeredAt: string | null | undefined): Partial<Record<string, LocalDate>> {
  if (!answeredAt) return {};
  const day = answeredAt.slice(0, 10);
  return Object.fromEntries([...BLOCKING_REASKS].map((k) => [k, day]));
}

/** Plain words for the screening item a re-ask is about. */
export const REASK_TOPIC: Readonly<Record<string, string>> = {
  diabetes: 'diabetes',
  kidney: 'kidney disease',
  gout: 'gout',
  foodAllergy: 'food allergies',
};

export function reaskMessage(about: string, markerLabel?: string): string {
  const topic = REASK_TOPIC[about] ?? 'your health';
  return `${markerLabel ? `Your ${markerLabel} result` : 'A blood result'} raises a question about ${topic}. Answer it again in your safety settings, then find plans.`;
}
