/**
 * Ladder hooks (plan-ladder v2, SUITE_SPEC §13.5.7): the marker banner above the cards and the "because …" chips on
 * the rungs a note touches. The notes are the ones the plans were found with (`request.markerWarnings`), so the chips
 * match the result on screen; without them (results found before markers) the live evaluation is used.
 */
import type { PlannerRequest } from '@/engine/planner/domain/types';
import type { Schedule } from '@/engine/types/schedule';
import type { MarkerNote } from '../types';
import { BecauseChips } from './BecauseChip';
import { MarkerBanner } from './MarkerBanner';
import { notesTouching, planLevers } from './planLevers';
import { markersToday, useMarkerDateStyle, useMarkerEvaluation } from './useMarkers';

const isNote = (x: unknown): x is MarkerNote => !!x && typeof x === 'object' && 'because' in x && 'levers' in x && 'rule' in x;

/** The marker notes a request carries, else the live ones. */
export function useRequestMarkerNotes(request: Pick<PlannerRequest, 'markerWarnings'> | null | undefined): MarkerNote[] {
  const live = useMarkerEvaluation().evaluation.notes;
  const carried = request?.markerWarnings;
  return Array.isArray(carried) ? carried.filter(isNote) : live;
}

export function LadderMarkerBanner({ request }: { request: Pick<PlannerRequest, 'markerWarnings'> | null | undefined }) {
  const notes = useRequestMarkerNotes(request);
  const dateStyle = useMarkerDateStyle();
  return <MarkerBanner notes={notes} dateStyle={dateStyle} today={markersToday()} className="lp-marker-banner" />;
}

interface RungPlanLike {
  schedule?: Schedule;
  summary: { fasting?: { longestFastH?: number }; meanWindowH?: number };
}

/** Chips for one rung: the notes whose levers this plan uses (max 2, then "+n more"). */
export function RungBecauseChips({ request, plan }: { request: Pick<PlannerRequest, 'markerWarnings' | 'profile'>; plan: RungPlanLike }) {
  const notes = useRequestMarkerNotes(request);
  const dateStyle = useMarkerDateStyle();
  if (notes.length === 0) return null;
  const levers = planLevers({
    schedule: plan.schedule ?? null,
    ...(plan.summary.fasting?.longestFastH !== undefined ? { longestFastH: plan.summary.fasting.longestFastH } : {}),
    ...(plan.summary.meanWindowH !== undefined ? { meanWindowH: plan.summary.meanWindowH } : {}),
    ...(request.profile?.body?.weightKg ? { weightKg: request.profile.body.weightKg } : {}),
  });
  const touching = notesTouching(notes, levers);
  if (touching.length === 0) return null;
  return (
    <p className="lp-lcard__line lp-lcard__because">
      <BecauseChips notes={touching} dateStyle={dateStyle} today={markersToday()} />
    </p>
  );
}
