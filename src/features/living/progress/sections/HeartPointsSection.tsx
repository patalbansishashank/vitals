/** Heart Points and WHO guideline minutes are separate measures; unknown weeks stay gaps. */
import { useMemo, useSyncExternalStore } from 'react';
import { Heart } from 'lucide-react';
import { CardFoot, ChartTwin, HeroNumber, MonoMeta, formatNumber } from '@/components';
import { topicHref } from '@/features/evidence/links';
import type { LocalDate } from '@/living';
import { addDays, compareDates } from '@/living/dates';
import { useBodyEstimate } from '@/state/profileStore';
import { useQuietMode, useSettingsStore } from '@/state/settingsStore';
import { RING_COPY } from '@/features/ring/copy';
import { heartPointsQuietText } from '../../activity/model';
import { livingPaths } from '../../paths';
import { fmtDayMonth } from '../../format';
import { ACTIVITY_COPY as C } from '../copy';
import {
  POINT_WEEKS,
  POINTS_GOAL,
  POINTS_UPPER,
  pointsStanding,
  pointsWeeks,
  weekStarts,
  whoWeek,
  type WhoWeek,
} from '../activityModel';
import { LaneChart } from '../components/LaneChart';
import { ProgressCard } from '../components/ProgressCard';
import {
  progressActualsAdapter,
  progressActualsRevision,
  subscribeProgressActuals,
  type ProgressDayActual,
} from '../v3Adapter';

export interface HeartPointsSectionProps {
  today: LocalDate;
  quiet?: boolean;
}
const pts = (x: number | null) => (x === null ? C.noPoints : formatNumber(Math.round(x)));
const whoText = (w: WhoWeek) =>
  w.sessions === 0
    ? '—'
    : w.minutes !== null
      ? formatNumber(Math.round(w.minutes))
      : C.whoRange(formatNumber(Math.round(w.range[0])), formatNumber(Math.round(w.range[1])));

/** The adapter's answer, re-read when the adapter changes. */
export function useProgressActuals(from: LocalDate, to: LocalDate) {
  const rev = useSyncExternalStore(
    subscribeProgressActuals,
    progressActualsRevision,
    progressActualsRevision,
  );
  return useMemo(
    () => (rev >= 0 ? progressActualsAdapter().progressActuals(from, to) : null),
    [from, to, rev],
  );
}

/**
 * The answers of the weeks starting on `starts`, each week its own window of the adapter; read again only when the
 * adapter moved, and the same days while no week's answer changed.
 */
function weeksReader(starts: readonly LocalDate[], today: LocalDate): () => readonly ProgressDayActual[] | null {
  const spans = starts.map((from) => {
    const end = addDays(from, 6);
    return { from, to: compareDates(end, today) > 0 ? today : end };
  });
  let seen = -1;
  let parts: ReadonlyArray<readonly ProgressDayActual[] | null> = [];
  let days: readonly ProgressDayActual[] | null = null;
  return () => {
    const rev = progressActualsRevision();
    if (rev === seen) return days;
    seen = rev;
    const adapter = progressActualsAdapter();
    const next: Array<readonly ProgressDayActual[] | null> = spans.map(() => null);
    // the newest week is asked first: it is the one on screen first
    for (let i = spans.length - 1; i >= 0; i--) {
      const { from, to } = spans[i]!;
      if (compareDates(from, to) <= 0) next[i] = adapter.progressActuals(from, to);
    }
    if (next.length === parts.length && next.every((p, i) => p === parts[i])) return days;
    parts = next;
    days = next.some((p) => p !== null)
      ? next.flatMap((p, i) =>
          (p ?? []).filter(
            (d) => compareDates(d.date, spans[i]!.from) >= 0 && compareDates(d.date, spans[i]!.to) <= 0,
          ),
        )
      : null;
    return days;
  };
}

/**
 * (r087 C3) The days of the weeks starting on `starts` (oldest first), each week read on its own: the chart shows the
 * weeks it has and fills in the others as they load, the current week first, instead of waiting for all of them. A week
 * is whole or absent, so a bar never shows part of its week. Null until a week has loaded. The current week is the
 * window Today's Heart Points read, so both show one answer.
 */
export function useProgressWeeks(starts: readonly LocalDate[], today: LocalDate): readonly ProgressDayActual[] | null {
  const read = useMemo(() => weeksReader(starts, today), [starts, today]);
  return useSyncExternalStore(subscribeProgressActuals, read, read);
}

export function HeartPointsSection({ today, quiet: quietProp }: HeartPointsSectionProps) {
  const quietSetting = useQuietMode();
  const quiet = quietProp ?? quietSetting.on;
  const weekStart = useSettingsStore((s) => s.weekStart);
  const body = useBodyEstimate();
  const age = body.missing.includes('age') ? undefined : body.ageYears;
  const starts = useMemo(() => weekStarts(today, POINT_WEEKS, weekStart), [today, weekStart]);
  const actuals = useProgressWeeks(starts, today);
  const weeks = useMemo(
    () => (actuals ? pointsWeeks(actuals, today, weekStart) : []),
    [actuals, today, weekStart],
  );
  const who = useMemo(
    () => (actuals ? weeks.map((w) => whoWeek(actuals, w.start, addDays(w.start, 6), age)) : []),
    [actuals, weeks, age],
  );
  if (!actuals || (weeks.every((w) => w.points === null) && who.every((w) => w.sessions === 0))) return null;
  const cur = weeks[weeks.length - 1]!;
  const curWho = who[who.length - 1]!;
  const quietWord = heartPointsQuietText(cur.points, cur.daysElapsed);
  const labels = weeks.map((w, i) => ((weeks.length - 1 - i) % 2 === 0 ? fmtDayMonth(w.start) : null));
  const summary = quiet
    ? `Heart Points by week: ${quietWord}. The outline is the current, partial week.`
    : `Heart Points by week: ${weeks.map((w) => `${fmtDayMonth(w.start)} ${pts(w.points)}`).join(', ')}. Goal reference at ${POINTS_GOAL}. This week so far ${pts(cur.points)}, day ${cur.daysElapsed} of 7; outline means the week is partial.`;
  const twin = quiet ? (
    <p>Numbers stay hidden in quiet mode.</p>
  ) : (
    <ChartTwin
      data={{
        title: `${C.faces.points} table`,
        caption: C.pointsName,
        head: [C.pointsCols.week, C.pointsCols.points, C.pointsCols.days, C.pointsCols.who],
        rows: weeks.map((w, i) => [w.start, pts(w.points), w.daysWithData, whoText(who[i]!)]),
        fileName: 'heart-points.csv',
        rowNoun: ['week', 'weeks'],
      }}
    />
  );
  return (
    <ProgressCard
      id="heart-points"
      domain="heart"
      icon={Heart}
      title={C.faces.points}
      info={{
        title: C.faces.points,
        body: quiet
          ? "Heart Points follow Google Fit's published effort rule, using your heart rate, step cadence or the activity you logged. Vigorous effort counts twice as much as moderate effort. The current week's outline is still filling. This is an estimate, separate from WHO guideline minutes; neither figure is a medical assessment."
          : "Heart Points follow Google Fit's published rule: one point per moderate minute, two per vigorous minute, using heart rate, step cadence or logged activity. The weekly goal is 150. The current week's outline is still filling. This is an estimate, separate from WHO minutes; unclassified WHO minutes keep their range.",
        source: { kind: 'estimate', words: 'Ring heart rate, counted steps and approved activities.' },
        range: quiet
          ? 'Weekly goal and upper reference stay hidden in quiet mode.'
          : `Weekly goal ${POINTS_GOAL}; upper reference ${POINTS_UPPER}. WHO minutes follow their own guideline.`,
        evidence: { to: topicHref('cardio-activity'), label: 'Activity and effort' },
        twin,
      }}
      foot={
        <CardFoot
          state={{ word: quiet ? quietWord : C.standing[pointsStanding(cur.points, cur)] }}
          right={quiet ? 'WHO minutes hidden' : `WHO min ${whoText(curWho)}`}
          link={{ to: livingPaths.movement(), label: `Open in ${RING_COPY.activityHub.title}` }}
        />
      }
    >
      <HeroNumber
        value={cur.points}
        unit="pts"
        size="num"
        quietWord={quiet ? quietWord : undefined}
        label={quiet ? quietWord : `${C.thisWeek} ${pts(cur.points)} Heart Points`}
      />
      <MonoMeta tone="hue">
        {quiet ? C.pointsCaption : `${C.soFar(cur.daysElapsed)} · ${C.pointsCaption}`}
      </MonoMeta>
      <LaneChart
        className="lv-prog-act__lane"
        quiet={quiet}
        summary={summary}
        count={weeks.length}
        xLabels={labels}
        series={[
          {
            id: 'points',
            kind: 'bars',
            values: weeks.map((w) => w.points),
            outline: weeks.map((w) => w.current),
            highlight: weeks.length - 1,
            hue: 'var(--lm-hue-heart)',
          },
        ]}
        refs={[{ value: POINTS_GOAL, label: C.goalRef, kind: 'goal' }]}
        yFormat={(v) => formatNumber(v)}
        height={112}
        refTicks
      />
    </ProgressCard>
  );
}
