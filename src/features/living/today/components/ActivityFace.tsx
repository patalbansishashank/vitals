/** Compatibility composition. Today renders the independent cards from its registry. */
import { useState } from 'react';
import type { LocalDate } from '@/living';
import type { ReviewRow, ReviewSheetModel } from '@/living/activityCandidates';
import { EnergyContent, StepsContent, HeartPointsContent, ActivitiesContent } from '../cards/ActivityCards';
import { RecordSheet } from '../../activity/RecordSheet';
import { useRecording } from '../../activity/RecordBanner';
import { recentTypesOfRows } from '../../activity/recordType';
import { LogActivitySheet } from './LogActivitySheet';
export { FACE_WORDS, shortFacts, stepsPanelDay, LOG_ACTIVITY_PATH } from '../cards/activityCardModel';
export { ENERGY_WORDS, overPlanText, rangeChip, rangeOf } from '../../activity/energyFigures';

export interface ActivityFaceProps {
  date: LocalDate;
  isToday: boolean;
  quiet: boolean;
  /** The review model of this week (from Monday to the date). */
  review: ReviewSheetModel;
  onOpenRow: (row: ReviewRow) => void;
  nowMs: number;
  /**
   * Today without a plan (0.6.3, Planning mode): energy is the habitual day's run from Your body (so far and likely by
   * bedtime, no plan figure), or one line with a link to Your body when its basics are missing; the steps are the Ring's
   * Steps card beside this one, so this card has no steps part.
   */
  noPlan?: boolean;
  /** (r068) Which card to draw: both (default), or one of them where a page places them in different columns. */
  show?: 'all' | 'energy' | 'activity';
}

export function ActivityFace(props: ActivityFaceProps) {
  const { show = 'all', noPlan, isToday, date, quiet, review } = props;
  const recording = useRecording();
  const [open, setOpen] = useState<'record' | 'log' | null>(null);
  return (
    <>
      {show !== 'activity' ? <EnergyContent {...props} /> : null}
      {show !== 'energy' ? (
        <>
          <StepsContent {...props} />
          <HeartPointsContent {...props} />
          <ActivitiesContent
            {...props}
            record={{ can: isToday && recording.available && !recording.rec, open: () => setOpen('record') }}
            log={{ can: !!noPlan && isToday, open: () => setOpen('log') }}
          />
        </>
      ) : null}
      {open === 'record' ? (
        <RecordSheet open onClose={() => setOpen(null)} recent={recentTypesOfRows(review.decided)} />
      ) : null}
      {open === 'log' ? (
        <LogActivitySheet date={date} today={date} quiet={quiet} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
