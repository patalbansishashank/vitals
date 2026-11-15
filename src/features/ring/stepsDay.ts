/**
 * (r069 D3) The day's steps in time for the Ring's Activity tab, its Steps card and the Steps by source panel: the fused
 * minute timeline in 15-minute bins (`stepsBins`), the day's activities as marks on the same axis (`ringActivities`: the
 * in-force sessions, hand logs included, and the ones still to review) and when the steps were last updated (the end of
 * the last counted minute, or the time of this phone's newer ring count while that is the total shown). One read, so the
 * card's "Updated hh:mm", its total and the chart agree.
 */
import { useMemo } from 'react';
import { dayMarks, type DayMark } from '@/features/living/activity/ActivityLane';
import { lastCountedAt, stepsBins, type StepsBin } from '@/features/living/activity/stepsTime';
import { useSteps, useTimeline } from './data';
import { stepsUpdatedAt, useGaugeLive } from './localFill';
import { shiftDate } from './model';
import { useRingActivities } from './useActivities';

export interface StepsDayView {
  /** False while the timeline loads (or without one: an older server, no pairing). */
  ready: boolean;
  bins: StepsBin[];
  marks: DayMark[];
  updatedAt: number | null;
}

const EMPTY: StepsDayView = { ready: false, bins: [], marks: [], updatedAt: null };

export function useStepsDay(date: string): StepsDayView {
  const tq = useTimeline(date);
  const acts = useRingActivities(shiftDate(date, -1), date);
  const t = tq.status === 'ready' ? tq.data : null;
  const view = useMemo(() => {
    if (!t) return EMPTY;
    const bins = stepsBins(t);
    const from = bins[0]?.start ?? 0;
    const to = from + bins.length * 15 * 60_000;
    return { ready: true, bins, marks: dayMarks(acts, from, to), updatedAt: lastCountedAt(t) };
  }, [t, acts]);
  // the phone's newer ring count carries its own time (once the server's own total is known); the chart stays the server's
  const local = useGaugeLive().local;
  const sq = useSteps(date, date);
  const stepsDay = sq.data?.days.find((d) => d.date === date) ?? null;
  const updatedAt =
    view.ready && sq.status === 'ready' ? stepsUpdatedAt(view.updatedAt, { date, local, stepsDay }) : view.updatedAt;
  return useMemo(() => (updatedAt === view.updatedAt ? view : { ...view, updatedAt }), [view, updatedAt]);
}
