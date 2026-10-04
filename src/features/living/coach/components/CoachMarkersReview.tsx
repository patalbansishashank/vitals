/**
 * E20: the Coach's blood test report card shows the app's review table (design intake-v3 §8.3, `ReviewTable`): every row
 * unticked, "Tick all high-confidence" a visible action, calculated and unplanned rows shown but never confirmable.
 * Its save key is the card's Apply: it passes the ticked rows and the answers about the test as
 * `CardActionExtra.markers` (`markers.confirm` runs as the person). Loaded lazily (the table brings the marker units).
 */
import { useMemo } from 'react';
import type { CardActionExtra, MarkersReviewCard } from '@/ai/coach/types';
import { MarkersEmbedded } from '@/features/intake/chapters/markersParts';
import { ReviewTable, type ReviewApply } from '@/features/intake/chapters/markersReview';
import type { MarkerExtraction, MarkerId } from '@/markers/types';
import { markersToday } from '@/markers/ui/markersDoc';

/** The card's review data as the table reads an extraction. */
export function extractionOfCard(review: MarkersReviewCard): MarkerExtraction {
  return {
    extractionId: review.extractionId,
    route: review.route,
    ...(review.sampleDate ? { sampleDate: review.sampleDate } : {}),
    rows: review.rows.map((r) => ({
      row: r.row,
      markerId: r.markerId as MarkerId | null,
      nameOnReport: r.name,
      value: r.value,
      unit: r.unit,
      ...(r.range ? { labRange: r.range } : {}),
      calculated: r.calculated,
      confidence: r.confidence,
      issues: r.issues,
    })),
    displayOnly: [],
    notInReport: review.notInReport as MarkerId[],
  };
}

/** The table's apply input → the card action's extra. */
export function cardExtraOf(input: ReviewApply): NonNullable<CardActionExtra['markers']> {
  const context: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input.context)) if (typeof v === 'boolean') context[k] = v;
  return { accept: input.accept.map((a) => ({ ...a })), ...(Object.keys(context).length ? { context } : {}) };
}

export interface CoachMarkersReviewProps {
  review: MarkersReviewCard;
  /** The card's Apply with the ticked rows. */
  onApply: (markers: NonNullable<CardActionExtra['markers']>) => Promise<{ ok: boolean; message?: string } | void> | void;
  today?: string;
}

export default function CoachMarkersReview({ review, onApply, today = markersToday() }: CoachMarkersReviewProps) {
  const extraction = useMemo(() => extractionOfCard(review), [review]);
  return (
    <MarkersEmbedded.Provider value>
      <ReviewTable extraction={extraction} attachmentId={review.attachmentId} today={today} onApply={(input) => onApply(cardExtraOf(input))} />
    </MarkersEmbedded.Provider>
  );
}
