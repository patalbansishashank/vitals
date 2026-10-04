/**
 * Publishes the Planner's current request (goals, limits, body, safety, markers) to the planner port, and what the
 * goal suggester needs (effective limits, safety access) to its port, while mounted, so `planner.find` and
 * `goals.suggest` from the Coach or an agent use what the Planner screens would. Mounted lazily by the Coach runtime
 * (src/ai/coach/CoachRuntimeProvider.tsx) once a provider is configured.
 */
import { useEffect } from 'react';
import { usePlannerModel } from './model';
import { publishPlannerRequest } from './run';
import { setSuggestContext } from './suggestInput';

export default function PlannerRequestPublisher(): null {
  const { request, hash, constraints, access, startDate } = usePlannerModel();
  useEffect(() => {
    publishPlannerRequest(request, hash);
    return () => publishPlannerRequest(null, null);
  }, [request, hash]);
  const optedTier = access.fasting.optedTier;
  useEffect(() => {
    setSuggestContext({
      constraints,
      safety: { outcome: access.outcome, plannerAccess: access.plannerAccess, optedTier, shortWindowOn: access.fasting.shortWindowOn },
      startDate,
      noWeightLossGoal: access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal'),
      optedTier,
      maxFastHours: access.fasting.maxFastHours,
    });
  }, [constraints, access.outcome, access.plannerAccess, access.plannerLocks, access.fasting.shortWindowOn, access.fasting.maxFastHours, optedTier, startDate]);
  return null;
}
