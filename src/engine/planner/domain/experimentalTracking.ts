/**
 * Permission to TRACK an explicitly chosen experimental scenario, separate from the checked-plan certificate.
 * The physiology, validator, margins and their failures are kept unchanged. Only the named population-policy
 * defaults below can be accepted as advisories; missing current checks and medical/clinical restrictions still block.
 */
import type { PlanningContext } from './context';
import type { PlanSafetyEvaluation } from './safetyAudit';
import type { Schedule } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import { MARGIN_IDS, stateMargins } from './model';
import { EXPERIMENTAL_TRACKING_NOTE, type ExperimentalTrackingReview } from '@/lib/experimentalTracking';
export type { ExperimentalTrackingReview } from '@/lib/experimentalTracking';
const ADVISORY_INPUT_RULES = new Set(['HC-E3/E1', 'HC-E4', 'HC-E5', 'HC-E6', 'HC-E7']);
const PROTECTED_MARGINS = new Set(['HC-E1', 'HC-E8', 'HC-P4', 'HC-P5', 'abort', 'userMuscleRetention']);

export function reviewExperimentalTracking(ctx: PlanningContext, schedule: Schedule, evaluation: PlanSafetyEvaluation, sim?: SimulationResult | null): ExperimentalTrackingReview | undefined {
  if (ctx.request.constraints?.experimentalTracking !== true) return undefined;
  const blockers: string[] = [];
  const warnings: string[] = [EXPERIMENTAL_TRACKING_NOTE];
  if (ctx.caps.blocked) blockers.push(ctx.caps.blocked);
  if (ctx.caps.mode !== 'M0') blockers.push('Experimental tracking cannot waive a restricted clinical screening mode.');
  for (const reason of evaluation.validator.reasons) {
    const rule = reason.split(':', 1)[0]!;
    (ADVISORY_INPUT_RULES.has(rule) ? warnings : blockers).push(reason);
  }
  blockers.push(...(evaluation.validator.unchecked ?? []));
  blockers.push(...evaluation.exercise.reasons);
  if (!evaluation.exercise.ok && !evaluation.exercise.reasons.length) blockers.push('Exercise eligibility could not be confirmed.');
  for (const c of evaluation.exercise.intensity)
    if (c.status === 'unchecked' || c.status === 'review' || c.status === 'violation') blockers.push('A clinician exercise-intensity restriction is unresolved or exceeded.');
  if (evaluation.conflicts.length) blockers.push('The plan has conflicting nutrition or clinical limits.');
  for (const r of evaluation.review) if (r.mandatory) blockers.push(`${r.id}: ${r.reason}`);
  for (const r of evaluation.rejected) if (r.mandatory) blockers.push(`${r.constraintId}: ${r.reason}`);
  for (const e of evaluation.evaluations)
    if (e.status === 'violation' || (e.mandatory && (e.status === 'unchecked' || e.capability === 'unsupported')))
      blockers.push(`${e.constraintId}: ${e.status}; applicable nutrition and medical limits remain enforced.`);
  if (!sim || sim.meta.nDays < schedule.horizonDays || sim.meta.aborted || sim.meta.validity?.status === 'modelLimit') blockers.push('A complete current simulation is required for experimental tracking.');
  else {
    // These floors cannot be inferred from an absent trace or the compatibility value for an unevaluated margin.
    for (const key of ['bmi', 'bodyFatPct'] as const)
      if ((sim.safety[key]?.length ?? 0) < schedule.horizonDays || Array.from(sim.safety[key] ?? []).some((v) => !Number.isFinite(v))) blockers.push(`The ${key} trajectory is unavailable.`);
    const margins = stateMargins(ctx, sim, schedule);
    for (let i = 0; i < margins.length; i++) {
      if (!(margins[i]! < 0)) continue;
      const message = `${MARGIN_IDS[i]}: model limit exceeded (margin ${margins[i]!.toFixed(3)}).`;
      (PROTECTED_MARGINS.has(MARGIN_IDS[i]!) ? blockers : warnings).push(message);
    }
    for (const warning of sim.warnings ?? []) warnings.push(warning.message ?? warning.id);
  }
  return { scope: 'experimentalTracking', startable: blockers.length === 0, warnings: [...new Set(warnings)], blockers: [...new Set(blockers)] };
}
