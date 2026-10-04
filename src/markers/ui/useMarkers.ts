/**
 * Reading `markers/me` (SUITE_SPEC §13.5) for the screens: a cached snapshot kept fresh by the document store's
 * `watch` (the same pattern as `useIntakeDoc`), the rule context from Your body and the safety screening, and the
 * evaluation. Writes go through the `markers.*` commands; nothing here writes.
 *
 * The headless twin for the command layer (the `planner.find` re-ask precondition) is `pendingMarkerReask` in
 * src/commands/defs/planner.ts (store internals are for commands only).
 */
import { useMemo } from 'react';
import { useSafetyAccess } from '@/features/onboarding';
import type { LocalDate } from '@/store';
import { useBodyContext, usePersonProfile } from '@/state/profileStore';
import { useSafetyStore } from '@/state/safetyStore';
import { markerRuleContext } from '../context';
import { blockingReasks, evaluateMarkers } from '../rules';
import type { MarkerEvaluation, MarkersDoc, RuleContext } from '../types';
import { useMarkerContextSources } from './contextSources';
import { screeningAnsweredOn } from './request';

// The document hooks live in ./markersDoc.ts (no rule engine, so screens that only read the document stay light).
export { markersToday, readMarkersDoc, useMarkerDateStyle, useMarkersDoc } from './markersDoc';
import { markersToday, useMarkerDateStyle, useMarkersDoc } from './markersDoc';

/** The rule context from Your body, the safety screening, the intake answers and the live plan (`markerRuleContext`). */
export function useMarkerRuleContext(today: LocalDate = markersToday()): RuleContext {
  const profile = usePersonProfile();
  const access = useSafetyAccess(useBodyContext());
  const sources = useMarkerContextSources();
  const flagKey = access.outcome.flags.join('|');
  return useMemo(
    () => markerRuleContext({ profile, flags: flagKey ? flagKey.split('|') : [], ...sources }, today),
    [profile, today, flagKey, sources],
  );
}

export interface MarkerEvaluationView {
  doc: MarkersDoc;
  ctx: RuleContext;
  evaluation: MarkerEvaluation;
  /** Re-asks that pause the planner until the safety questions are answered again. */
  blocking: MarkerEvaluation['reasks'];
}

/** The evaluation of the current document (notes, locks, re-asks, retests). */
export function useMarkerEvaluation(today: LocalDate = markersToday()): MarkerEvaluationView {
  const doc = useMarkersDoc();
  const ctx = useMarkerRuleContext(today);
  const dateStyle = useMarkerDateStyle();
  const answeredAt = useSafetyStore((s) => s.answeredAt);
  return useMemo(() => {
    const evaluation = evaluateMarkers(doc, ctx, { dateStyle });
    return { doc, ctx, evaluation, blocking: blockingReasks(evaluation, screeningAnsweredOn(answeredAt)) };
  }, [doc, ctx, dateStyle, answeredAt]);
}
