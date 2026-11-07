/**
 * Heart Points on Today (A.3.3 `DotFill`, §V4.1): the week's points against 150 as a dot fill, today's points as text,
 * labelled "Heart Points (Fit-compatible estimate)". They come from approved activities only; pending ones are named
 * apart ("12 more once counted"), never counted. Unknown (no step or heart-rate coverage, or still loading) is not zero
 * (UI audit #5): it reads "No readings". Quiet mode (0.6.3 S31) is words only, aria too: the fill in its quiet mode and
 * one line ("Heart Points: on track this week"), with no number anywhere.
 */
import { DotFill, formatNumber } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { ACTIVITY_COPY as C } from '../copy';
import { HEART_POINTS_GOAL, HEART_POINTS_LABEL, heartPointsQuietText } from './model';

export const NO_POINTS = 'No readings';

/** Quiet words beside the week's line (no digits). */
export const HP_QUIET_WORDS = { line: (words: string) => `${C.heartPoints}: ${words}`, pending: 'some not counted yet' } as const;

export interface HeartPointsFillProps {
  week: number | null;
  today: number | null;
  pendingToday?: number;
  loading?: boolean;
  /** Days of the week so far (Monday = 1), for "on track" in quiet mode; the whole week when absent. */
  daysIn?: number;
  /** (r068 T8) The day word after the day's points: "today" (default) or "that day" on a past date. */
  dayWord?: string;
  /** The page's quiet (it knows "Show numbers"); the setting in effect when absent. */
  quiet?: boolean;
}

export function HeartPointsFill({ week, today, pendingToday = 0, loading = false, daysIn = 7, quiet: quietProp, dayWord }: HeartPointsFillProps) {
  const quietMode = useQuietMode().on;
  const quiet = quietProp ?? quietMode;
  const w = week !== null ? Math.round(week) : null;
  const t = today !== null ? Math.round(today) : null;
  const facts = quiet
    ? [loading && w === null ? null : w === null ? NO_POINTS : HP_QUIET_WORDS.line(heartPointsQuietText(w, daysIn)), pendingToday > 0 ? HP_QUIET_WORDS.pending : null].filter(Boolean).join(' · ')
    : [t !== null ? (dayWord ? `${formatNumber(t, 0)} ${dayWord}` : C.heartPointsToday(formatNumber(t, 0))) : loading ? null : `${NO_POINTS} ${dayWord ?? 'today'}`, pendingToday > 0 ? C.heartPointsPending(formatNumber(pendingToday, 0)) : null].filter(Boolean).join(' · ');
  // (r068 V22) nothing known yet: one line with the goal, no empty field of dots repeating it
  if (w === null && !loading)
    return (
      <div className="lv-act__hp">
        <p className="lv-act__fact lm-num">{[quiet ? NO_POINTS : `${NO_POINTS} ${dayWord ?? 'today'} · ${C.heartPointsGoal(formatNumber(HEART_POINTS_GOAL, 0))}`, pendingToday > 0 ? (quiet ? HP_QUIET_WORDS.pending : C.heartPointsPending(formatNumber(pendingToday, 0))) : null].filter(Boolean).join(' · ')}</p>
      </div>
    );
  return (
    <div className="lv-act__hp">
      <DotFill
        label={HEART_POINTS_LABEL}
        value={w}
        goal={HEART_POINTS_GOAL}
        valueText={quiet ? '' : w !== null ? formatNumber(w, 0) : loading ? '…' : '—'}
        goalText={quiet ? '' : C.heartPointsWeek}
        state={loading ? 'loading' : w !== null && w > 0 ? 'normal' : 'zero'}
        quiet={quiet}
      />
      <p className="lv-act__fact">{facts}</p>
    </div>
  );
}
