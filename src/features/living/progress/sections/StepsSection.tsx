/** Fused steps: one source per interval, never a sum; unplaced ring steps keep an outline. */
import { useMemo, useState } from 'react';
import { Footprints } from 'lucide-react';
import { CardFoot, ChartTwin, HeroNumber, MonoMeta, formatNumber } from '@/components';
import { ratioWord } from '@/components/viz/geometry';
import { topicHref } from '@/features/evidence/links';
import type { LocalDate } from '@/living';
import { addDays } from '@/living/dates';
import { useQuietMode } from '@/state/settingsStore';
import { useHeartSettings } from '@/features/settings/heart/v3Adapter';
import { useLiving } from '../../data/source';
import { fmtDayMonth } from '../../format';
import { ACTIVITY_COPY as C } from '../copy';
import { DEFAULT_STEPS_GOAL, TREND_DAYS, stepsRows, stepsSummary } from '../activityModel';
import { LaneChart } from '../components/LaneChart';
import { useReportGaugeFreshness } from '../components/GaugeFreshness';
import { ProgressCard } from '../components/ProgressCard';
import { useProgressGauge } from '../data/gauge';

export interface StepsSectionProps {
  today: LocalDate;
  quiet?: boolean;
}

/** The approved bouts around [from, to] as step-fusion context (the same function the Gauge import uses); none when unreadable. */
async function approvedActivities(from: LocalDate, to: LocalDate, today: LocalDate) {
  try {
    const [{ readDocs }, { fuseActivitiesOf }] = await Promise.all([
      import('@/commands/living'),
      import('@/state/gaugeImport'),
    ]);
    const docs = await readDocs(today);
    return fuseActivitiesOf(docs.entries, from, to);
  } catch {
    return [];
  }
}

const n0 = (x: number) => formatNumber(Math.round(x));

export function StepsSection({ today, quiet: quietProp }: StepsSectionProps) {
  const quietSetting = useQuietMode();
  const quiet = quietProp ?? quietSetting.on;
  const [active, setActive] = useState<number | null>(null);
  const heart = useHeartSettings();
  const policy = heart.stepsHeadline;
  const prefKey = `${heart.stepsPreference.join('>')}:${heart.soleSustainedGait ? 1 : 0}`;
  const logRev = useLiving((s) => s.revision(), []);
  const rxSteps = useLiving((s) => s.today(today)?.prescription?.steps ?? null, [today]);
  const from = addDays(today, -(TREND_DAYS - 1));
  const q = useProgressGauge(`steps:${from}:${today}:${prefKey}:${logRev}`, async (api) => {
    if (!api.stepsFuse) return api.steps(from, today);
    const activities = await approvedActivities(from, today, today);
    return api.stepsFuse({
      from,
      to: today,
      ...(activities.length ? { activities } : {}),
      preference: { stepsPreference: [...heart.stepsPreference], soleSustainedGait: heart.soleSustainedGait },
    });
  });
  const rows = useMemo(
    () => (q.status === 'ready' ? stepsRows(q.data.days, from, today, policy) : []),
    [q, from, today, policy],
  );
  useReportGaugeFreshness(q.status === 'ready' && rows.some((r) => r.steps !== null), q);
  if (q.status !== 'ready' || rows.every((r) => r.steps === null)) return null;
  const sum = stepsSummary(rows);
  const goal = rxSteps !== null && rxSteps > 0 ? rxSteps : DEFAULT_STEPS_GOAL;
  const goalText = rxSteps !== null && rxSteps > 0 ? C.goal(n0(goal)) : C.defaultGoal(n0(goal));
  const picked = active === null ? null : (rows[active] ?? null);
  const value = picked ? picked.steps : sum.last7;
  const word = value === null ? 'No readings' : ratioWord(value / goal);
  const labels = rows.map((r, i) => (i % 7 === 0 || i === rows.length - 1 ? fmtDayMonth(r.date) : null));
  const twin = quiet ? (
    <p>Numbers stay hidden in quiet mode.</p>
  ) : (
    <ChartTwin
      data={{
        title: `${C.faces.steps} table`,
        caption: C.faces.steps,
        head: [C.stepsCols.date, C.stepsCols.steps, C.stepsCols.mean, C.stepsCols.note],
        rows: rows.map((r) => [
          r.date,
          r.steps === null ? '—' : n0(r.steps),
          r.mean7 === null ? '—' : n0(r.mean7),
          r.atLeast ? C.atLeastNote : '',
        ]),
        fileName: 'steps.csv',
      }}
    />
  );
  return (
    <ProgressCard
      id="steps"
      title={C.faces.steps}
      icon={Footprints}
      domain="steps"
      info={{
        title: C.faces.steps,
        body: "Steps come from your ring and phone, one source for each stretch of time, never added together. An outlined bar includes ring steps the ring couldn't place in time: that day is 'at least' this many. The thin line is the past week's average; the dotted line is your goal.",
        source: { kind: 'ring', words: 'Ring and phone, fused one source per interval.' },
        range: quiet ? 'Your personal step goal, or the default when none is set.' : goalText,
        evidence: { to: topicHref('daily-activity-maintenance'), label: 'Daily activity and maintenance' },
        twin,
      }}
      foot={
        <CardFoot
          state={{ word: quiet ? 'Step history' : `${C.fourWeeks} ${sum.all === null ? '—' : n0(sum.all)}` }}
          right={quiet ? 'Goal' : goalText}
          link={{ to: '/ring/activity', label: 'Open in Ring' }}
        />
      }
    >
      <HeroNumber
        value={value === null ? null : Math.round(value)}
        unit={picked ? 'steps' : C.aDay}
        size="num"
        quietWord={quiet ? word : undefined}
        label={
          quiet
            ? word
            : `${picked ? fmtDayMonth(picked.date) : C.last7}: ${picked?.atLeast ? 'at least ' : ''}${value === null ? 'No readings' : n0(value)} steps${picked ? '' : ' a day'}`
        }
      />
      <MonoMeta tone="hue">
        {picked
          ? `${fmtDayMonth(picked.date)}${picked.atLeast ? ' · at least' : ''}`
          : quiet
            ? 'Recent days'
            : C.last7}
      </MonoMeta>
      <LaneChart
        className="lv-prog-act__lane"
        quiet={quiet}
        summary={
          quiet
            ? 'Steps by day against your goal; outlines include steps not placed in time.'
            : C.stepsSummary(rows.length, sum.last7 === null ? '—' : n0(sum.last7), goalText)
        }
        count={rows.length}
        xLabels={labels}
        series={[
          {
            id: 'steps',
            kind: 'bars',
            values: rows.map((r) => r.steps),
            outline: rows.map((r) => r.atLeast),
            highlight: rows.length - 1,
            hue: 'var(--lm-hue-steps)',
          },
          {
            id: 'mean7',
            kind: 'line',
            values: rows.map((r) => r.mean7),
            hue: 'var(--lm-hue-steps)',
            focal: true,
            endDot: 'static',
          },
        ]}
        refs={[{ value: goal, label: n0(goal), kind: rxSteps !== null && rxSteps > 0 ? 'goal' : 'default' }]}
        yFormat={(v) => (v >= 1000 ? `${formatNumber(v / 1000, v % 1000 === 0 ? 0 : 1)}k` : formatNumber(v))}
        onScrub={setActive}
        scrubText={(i) => {
          const r = rows[i]!;
          return quiet
            ? fmtDayMonth(r.date)
            : `${fmtDayMonth(r.date)}: ${r.steps === null ? 'No reading' : `${r.atLeast ? 'at least ' : ''}${n0(r.steps)} steps`}`;
        }}
      />
    </ProgressCard>
  );
}
