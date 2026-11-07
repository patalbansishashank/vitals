/**
 * `usePlannerModel()` — everything the Planner screens derive from the stores: effective limits (Habits defaults +
 * the user's overrides), the start date, the safety snapshot, the engine request and its hash, staleness, and the
 * pre-run hints. One place, so the Goals screen, the run and the results agree on "the current request".
 *
 * A1-002: the request's clinical safety comes from the same headless composer every lifecycle boundary and the re-plan
 * request use (`withCurrentSafety`: current screening input, explicit bounds, the current marker evaluation under the
 * Planner's own rule context and app day, kidney findings), so publishing and a custom scenario's start cannot drift.
 * Without goals nothing is published (the boundaries build their own current safety; a goal is never needed for it).
 */
import { useEffect, useMemo, useState } from 'react';
import type { TargetReach } from '@/engine/planner/domain/types';
import { useShallow } from 'zustand/react/shallow';
import { useIntakeDoc } from '@/features/intake/doc';
import { useTrainingSetup } from '@/features/living/train/setup';
import { useSafetyAccess } from '@/features/onboarding';
import { suggestionSafetyFrom } from '@/features/onboarding/safetyRules';
import { useBodyContext, useBodyEstimate } from '@/state/profileStore';
import { isPlannerResultStale, usePlannerStore } from '@/state/plannerStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useSafetyStore } from '@/state/safetyStore';
import { withMarkerLabs } from '@/markers/baselines'; // E20: markers
import { screeningAnsweredOn, withCurrentSafety } from '@/markers/ui/request'; // E20: markers, A1-002
import { useMarkerEvaluation } from '@/markers/ui/useMarkers'; // E20: markers
import { estimateTargetsAsync } from './plannerClient';
import { preflightHints, type BodyFacts } from './preflight';
import {
  buildPlannerRequest,
  plannableGoals,
  effectiveConstraints,
  nextMondayISO,
  requestHash,
  supplementSnapshot,
  type SafetySnapshot,
} from './request';

export function usePlannerModel(options: { estimateReach?: boolean } = {}) {
  const estimateReach = options.estimateReach !== false;
  const draft = usePlannerStore(
    useShallow((s) => ({
      goals: s.goals,
      horizonDays: s.horizonDays,
      startDate: s.startDate,
      overrides: s.constraints,
      strictness: s.strictness,
    })),
  );
  const run = usePlannerStore((s) => s.run);
  const body = useBodyEstimate();
  const bodyContext = useBodyContext();
  const access = useSafetyAccess(bodyContext);
  const units = useSettingsStore((s) => s.units);
  // E20: markers — entered blood results replace the population starting values (Body page labs stay the fallback)
  const markers = useMarkerEvaluation();
  // D7-05: the full rule context, so the rules and the engine baseline share the diet and medication change dates
  const profile = useMemo(
    () => withMarkerLabs(body.profile, markers.doc, markers.ctx),
    [body.profile, markers.doc, markers.ctx],
  );

  // the longest fast follows the opted-in fasting tier until the user sets it (PLANNER_V2_SPEC §3.7)
  const optedTier = access.fasting.optedTier;
  const safetyMaxFastH = access.fasting.maxFastHours;
  const constraints = useMemo(
    () => effectiveConstraints(draft.overrides, profile.habits, { optedTier, maxFastHours: safetyMaxFastH }),
    [draft.overrides, profile.habits, optedTier, safetyMaxFastH],
  );
  const today = new Date().toISOString().slice(0, 10);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed once a day (the date string is the dependency)
  const startDate = useMemo(() => draft.startDate ?? nextMondayISO(), [draft.startDate, today]);

  // supplements per row (SUITE_SPEC §13.2): taking / have at home → consented levers; not for me → refused. A NEW lever
  // needs a suggestible decision under the same D7-03 policy Food, the Coach and the commands use (screening tri-state,
  // marker flags/noSuggest, food allergies once the food rules are answered)
  const intakeDoc = useIntakeDoc();
  const trainingSetup = useTrainingSetup();
  const suppDoc = intakeDoc.supplements;
  const dietDoc = intakeDoc.diet;
  const screening = useSafetyStore(
    useShallow((st) => ({ answers: st.answers, pendingReview: st.pendingReview, answeredAt: st.answeredAt })),
  );
  const evaluation = markers.evaluation;
  const suppPolicy = useMemo(
    () =>
      suggestionSafetyFrom(screening.answers, {
        ...(screening.pendingReview ? { pendingReview: true } : {}),
        markers: evaluation
          ? {
              flags: [...evaluation.safety.flags],
              noSuggest: (evaluation.noSuggest ?? []).map((n) => ({
                rule: n.rule,
                markerId: n.markerId,
                subject: n.subject,
                sampleDate: n.sampleDate,
                stale: n.stale,
                applicability: n.applicability,
              })),
            }
          : null,
        diet: dietDoc && dietDoc.rulesComplete ? { rulesComplete: true, allergies: dietDoc.allergies } : null,
      }),
    [screening.answers, screening.pendingReview, evaluation, dietDoc],
  );
  const supp = useMemo(() => supplementSnapshot(suppDoc, suppPolicy), [suppDoc, suppPolicy]);
  const snapshot = useMemo<SafetySnapshot>(
    () => ({
      outcome: access.outcome,
      plannerAccess: access.plannerAccess,
      optedTier: access.fasting.optedTier,
      shortWindowOn: access.fasting.shortWindowOn,
      ...supp,
    }),
    [access.outcome, access.plannerAccess, access.fasting.optedTier, access.fasting.shortWindowOn, supp],
  );

  const request = useMemo(() => {
    if (trainingSetup.status !== 'ready' || plannableGoals(draft.goals, profile).length === 0) return null;
    const built = buildPlannerRequest({
      goals: draft.goals,
      horizonDays: draft.horizonDays,
      startDate,
      constraints,
      strictness: draft.strictness,
      profile,
      safety: snapshot,
      training: trainingSetup.profile,
    });
    // E20/A1-002: the shared current-safety composer — the screening input with its explicit bounds, the current marker
    // locks/flags (stricter wins), warnings, prefer biases and kidney findings under the Planner's rule context and day
    const current = withCurrentSafety(built, {
      screening: built.safety ?? null,
      markers: markers.evaluation,
      markersDoc: markers.doc,
      today: markers.ctx.today,
      answeredOn: screeningAnsweredOn(screening.answeredAt),
    });
    // required clinical coverage missing: no request (never a prescription from an older or partial clinical input)
    return current.status === 'current' ? current.request : null;
  }, [
    draft.goals,
    draft.horizonDays,
    startDate,
    constraints,
    draft.strictness,
    profile,
    snapshot,
    markers.evaluation,
    markers.doc,
    markers.ctx.today,
    screening.answeredAt,
    trainingSetup,
  ]);
  const hash = useMemo(() => (request ? requestHash(request) : null), [request]);
  const stale = isPlannerResultStale(run, hash);

  // The planner's fastest-safe-rate answer for this exact request (R-TTT), off the main thread: the pre-run hints use it
  // so "expect about X in this horizon" / "Extend to N weeks" match the run's time-to-target. Pending until it lands.
  const [reachState, setReachState] = useState<{ hash: string; reach: TargetReach[] } | null>(null);
  useEffect(() => {
    if (!estimateReach || !request || !hash) return;
    let alive = true;
    estimateTargetsAsync(request)
      .then((reach) => alive && setReachState({ hash, reach }))
      .catch(() => alive && setReachState({ hash, reach: [] }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hash identifies the request
  }, [hash, estimateReach]);
  const reach = hash && reachState?.hash === hash ? reachState.reach : null;
  const reachPending = estimateReach && hash !== null && reach === null;

  const noWeightLossGoal = access.plannerLocks.some((l) => l.id === 'no-weight-loss-goal');
  const facts = useMemo<BodyFacts>(
    () => ({
      weightKg: body.complete ? body.weightKg : null,
      bmi: body.complete ? body.bmi : null,
      bodyFatPct: body.complete ? body.bodyFatPct : null,
      sex: body.sex === 'male' || body.sex === 'female' ? body.sex : null,
      trainingHistory: profile.habits?.trainingHistory ?? null,
    }),
    [body.complete, body.weightKg, body.bmi, body.bodyFatPct, body.sex, profile.habits?.trainingHistory],
  );
  const hints = useMemo(
    () =>
      preflightHints({
        goals: draft.goals,
        horizonDays: draft.horizonDays,
        constraints,
        body: facts,
        noWeightLossGoal,
        safetyMaxFastH,
        fastingOptedTier: optedTier,
        units,
        reach,
      }),
    [
      draft.goals,
      draft.horizonDays,
      constraints,
      facts,
      noWeightLossGoal,
      safetyMaxFastH,
      optedTier,
      units,
      reach,
    ],
  );

  return {
    goals: draft.goals,
    profile,
    runnableGoalCount: plannableGoals(draft.goals, profile).length,
    horizonDays: draft.horizonDays,
    startDate,
    strictness: draft.strictness,
    constraints,
    overrides: draft.overrides,
    run,
    body,
    bodyContext,
    access,
    units,
    request,
    hash,
    stale,
    hints,
    /** The reachability estimate for the current goals is still being computed. */
    reachPending,
  };
}

export type PlannerModel = ReturnType<typeof usePlannerModel>;
