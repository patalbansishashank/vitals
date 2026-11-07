import { durationText, formatNumber, type EnergyUnitChoice } from '@/components';
import type { ReviewRow } from '@/living/activityCandidates';
import type { GaugeTimeline } from '@/net/gauge';
import type { StepsPanelDay } from '../../activity/StepsSourceChart';
import { marksOfRows } from '../../activity/ActivityLane';
import { lastCountedAt, stepsBins } from '../../activity/stepsTime';
import { energyText } from '../../activity/model';

/** The card's words that `ACTIVITY_COPY` does not hold. */
export const FACE_WORDS = {
  /** (Claude P2-16) A.1.4: without a plan or ring goal the 10 000 is a default, and says so. */
  defaultGoal: 'default goal',
  /** (Claude P2-14) unknown steps are not "no steps"; (r068 T15) and nothing is forecast before a step is counted. */
  noStepData: 'No step data yet',
  /** (Claude P1-7) */
  updated: 'counted, updated since',
  /** (Claude P3-9) a past day's card */
  activitiesOfDay: 'Activities',
  noActivitiesOfDay: 'Nothing recorded that day',
  /** (r068 T8) a past day's Heart Points line: "34 that day" */
  thatDay: 'that day',
  /** (0.6.3 S31) quiet: the likely steps by bedtime in words */
  stepsOnCourse: 'On course for the goal by bedtime',
  stepsUnder: 'Likely under the goal by bedtime',
  /** 0.6.3: Today without a plan */
  noPlanCaption: 'From your body and the ring',
  noPlanNote: 'By bedtime assumes your usual steps and no more exercise.',
  /** (r068 V17) the same assumption as the "Likely by bedtime" row's own sub-line */
  noPlanLikely: 'Usual steps, no more exercise',
  noProfile: 'Add your body details to estimate energy.',
  yourBody: 'Your body',
  /** 0.6.3 INT: Today without a plan leads to Train's activity hub to log one by hand */
  logActivity: 'Log an activity',
} as const;

/** (r069 D3) The steps panel's day chart: the timeline in 15-min bins with the day's activities (Today's own rows). */
export function stepsPanelDay(
  t: GaugeTimeline,
  rows: readonly ReviewRow[],
  isToday: boolean,
  headline: number | null,
): StepsPanelDay {
  const bins = stepsBins(t);
  const from = bins[0]?.start ?? 0;
  return {
    bins,
    marks: marksOfRows(rows, from, from + bins.length * 15 * 60_000),
    updatedAt: isToday ? lastCountedAt(t) : null,
    headline,
  };
}

/** Train's activity hub with "Log an activity" open (TrainPage reads `?log=1`). */
export const LOG_ACTIVITY_PATH = '/train?log=1';

/**
 * The activity row's facts, short (r068 T5): "45 min", "~447 kcal", "45 Heart Points" as separate segments that never
 * break inside (the range lives in the activity sheet). Quiet: none (the status word carries the row).
 */
export function shortFacts(
  r: Pick<ReviewRow, 'minutes' | 'kcal' | 'heartPoints'>,
  quiet: boolean,
  unit: EnergyUnitChoice = 'kcal',
): string[] {
  if (quiet) return [];
  return [
    r.minutes > 0 ? durationText(r.minutes) : null,
    r.kcal ? `~${energyText(r.kcal.value, unit)}\u00a0${unit}` : null,
    r.heartPoints !== null && r.heartPoints > 0
      ? `${formatNumber(Math.round(r.heartPoints), 0)}\u00a0Heart\u00a0Points`
      : null,
  ].filter((x): x is string => !!x);
}
