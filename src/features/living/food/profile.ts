/**
 * What Food needs to know about the person's food setup: whether the food rules are answered (recipes pause until
 * then — they are never guessed), the rules themselves for the recipe provider, family-food mode, a kitchen scale, the
 * supplement stance and the safety flags that hide supplement cards. Read from the intake document; tests and the
 * gallery override it with `<FoodProfileContext.Provider>`.
 *
 * D7-03: the supplement suggestions read the real current safety state (`useFoodSafety`) as the shared suggestion-policy
 * input: the tri-state screening answers ("not answered" stays distinct from a negative screen), the blood-marker flags
 * and noSuggest decisions with their provenance, the food allergies and clinician stops — the same input the Planner,
 * the Coach and the commands build.
 */
import { createContext, useContext, useMemo } from 'react';
import { useIntakeDoc } from '@/features/intake/doc';
import { useShallow } from 'zustand/react/shallow';
import { suggestionSafetyFrom, type ScreeningAnswers } from '@/features/onboarding/safetyRules';
import type { MarkerNoSuggestInput } from '@/lib/safetyPolicy';
import { useMarkerEvaluation } from '@/markers/ui/useMarkers';
import type { MarkerEvaluation } from '@/markers/types';
import { useSafetyStore } from '@/state/safetyStore';
import { canonicalSupplementId, withPersonFlags, type FoodSafetyContext } from './supplements';
import { profileFromIntake, type FoodProfileView } from './profileModel';

export { profileFromIntake, type DietKind, type FoodProfileView } from './profileModel';

export const FoodProfileContext = createContext<FoodProfileView | null>(null);

export function useFoodProfile(): FoodProfileView {
  const doc = useIntakeDoc();
  const override = useContext(FoodProfileContext);
  return useMemo(() => override ?? profileFromIntake(doc), [override, doc]);
}

/**
 * The marker part of the shared suggestion input (D7-03): the marker flags (eGFR < 60 → kidney disease) and every
 * noSuggest decision of a fired or applicability-unresolved rule, with its rule, marker, sample date, freshness and
 * applicability (the evaluator keeps unresolved ones Unchecked, never silently dropped).
 */
export function markerSafety(ev: Pick<MarkerEvaluation, 'safety' | 'noSuggest'> | null | undefined): { flags: string[]; noSuggest: MarkerNoSuggestInput[] } {
  if (!ev) return { flags: [], noSuggest: [] };
  return { flags: [...ev.safety.flags], noSuggest: (ev.noSuggest ?? []).map((n) => ({ rule: n.rule, markerId: n.markerId, subject: n.subject, sampleDate: n.sampleDate, stale: n.stale, applicability: n.applicability })) };
}

/**
 * Food's current safety state (D7-03) as the shared suggestion-policy input, built exactly as the Planner, the Coach and
 * the commands build it (`suggestionSafetyFrom`): the tri-state screening answers (none, or answers waiting for import
 * review = unknown), the marker decisions, the food allergies once the food rules are answered, and clinician stops on
 * the person's rows; the profile's extra positive flags (tests, gallery) join last.
 */
export function foodSafetyInput(o: {
  answers?: ScreeningAnswers | null;
  pendingReview?: boolean;
  evaluation?: Pick<MarkerEvaluation, 'safety' | 'noSuggest'> | null;
  profile: Pick<FoodProfileView, 'safetyFlags' | 'foodRules' | 'supplements'>;
}): FoodSafetyContext {
  const rows = o.profile.supplements?.rows ?? [];
  const stops = rows.filter((r) => r.clinicianStop && r.supplementId).map((r) => canonicalSupplementId(r.supplementId!));
  const rules = o.profile.foodRules;
  const base = suggestionSafetyFrom(o.answers ?? null, {
    ...(o.pendingReview ? { pendingReview: true } : {}),
    markers: markerSafety(o.evaluation),
    diet: rules ? { rulesComplete: true, allergies: rules.allergies } : null,
    ...(stops.length ? { clinicianStops: stops } : {}),
  });
  return withPersonFlags(base, o.profile.safetyFlags);
}

/** Food's current safety state (D7-03, `foodSafetyInput`) from the stored screening and the current marker evaluation. */
export function useFoodSafety(profile: Pick<FoodProfileView, 'safetyFlags' | 'foodRules' | 'supplements'>): FoodSafetyContext {
  const { answers, pendingReview } = useSafetyStore(useShallow((st) => ({ answers: st.answers, pendingReview: st.pendingReview })));
  const { evaluation } = useMarkerEvaluation();
  return useMemo(() => foodSafetyInput({ answers, pendingReview, evaluation, profile }), [answers, pendingReview, evaluation, profile]);
}
