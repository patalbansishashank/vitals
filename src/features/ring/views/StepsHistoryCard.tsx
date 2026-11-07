/** One steps history for a day’s last month and every date-control period. Missing days stay gaps. */
import { Footprints } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  DottedTrack,
  GlowLine,
  GradientCard,
  HeroNumber,
  HighlightBars,
  MonoMeta,
  barsTwin,
  formatNumber,
  type TwinData,
} from '@/components';
import { periodStats } from '@/features/living/period';
import { useQuietMode } from '@/state/settingsStore';
import { useActivity } from '../data';
import { useRingDay } from '../day';
import { daysFrom, shiftDate } from '../model';
import { quietDays } from '../quiet';
import { WhenReady } from '../components/parts';
import { BARS_MAX_DAYS } from './periods';
import './activity.css';

export const QUIET_STEPS_HISTORY = 'This chart shows figures, so it stays hidden in quiet mode.';
export const kSteps = (v: number): string =>
  Math.abs(v) >= 1000 ? `${formatNumber(v / 1000, Number.isInteger(v / 1000) ? 0 : 1)}k` : formatNumber(v, 0);

/** Seven-day means require seven observed days. An unknown day must never become a zero. */
export function stepsRollingMean(values: readonly (number | null)[]): Array<number | null> {
  return values.map((_, i) => {
    const week = values.slice(Math.max(0, i - 6), i + 1);
    return week.length === 7 && week.every((v) => v !== null && Number.isFinite(v))
      ? week.reduce<number>((s, v) => s + v!, 0) / 7
      : null;
  });
}

export function StepsHistoryCard({
  from,
  end,
  selected = end,
}: {
  from: string;
  end: string;
  selected?: string;
}) {
  const loadFrom = shiftDate(from, -6);
  const q = useActivity(loadFrom, end);
  const goal = useRingDay(end).goals.steps.value;
  return (
    <WhenReady q={q}>
      {(a) => {
        const by = new Map(a.days.map((d) => [d.date, d.fusedHeadline ?? d.steps ?? null]));
        const all = daysFrom(loadFrom, end).map((d) => by.get(d) ?? null);
        return (
          <StepsHistory
            dates={daysFrom(from, end)}
            values={all.slice(6)}
            lead={all.slice(0, 6)}
            goal={goal}
            selected={selected}
          />
        );
      }}
    </WhenReady>
  );
}

export function StepsHistory({
  dates,
  values,
  lead = [],
  goal,
  selected,
}: {
  dates: string[];
  values: Array<number | null>;
  lead?: Array<number | null>;
  goal: number;
  selected: string;
}) {
  const quiet = useQuietMode().on;
  const st = periodStats(values.map((v) => v ?? NaN));
  const atGoal = values.filter((v) => v !== null && Number.isFinite(v) && v >= goal).length;
  const word = st.n ? `At goal ${quietDays(atGoal, st.n)}` : 'No reading';
  const bars = {
    dates,
    values,
    goal,
    average: st.n ? st.mean : undefined,
    highlight: dates.indexOf(selected),
    name: 'Steps by day',
    unit: 'steps',
    format: kSteps,
  };
  const twin: TwinData = barsTwin({ ...bars, quiet });
  const line = dates.length > BARS_MAX_DAYS;
  const mean = stepsRollingMean([...lead, ...values]).slice(lead.length);
  return (
    <GradientCard
      as="section"
      domain="steps"
      head={
        <CardHead
          as="h2"
          icon={Footprints}
          title="Steps"
          info={{
            title: 'Steps history',
            body: 'One bar per day: steps from your ring and phone, using one source per period. A day with no reading has no bar. The solid line is your average and the dashed line your goal. Longer periods show the seven-day average.',
            source: { kind: 'engine', words: 'Ring and phone' },
            evidence: { to: '/evidence/10-steps-and-health', label: 'Steps and health' },
            twin: <ChartTwin data={twin} />,
          }}
        />
      }
      foot={
        <CardFoot
          state={{ word: quiet ? word : st.n ? `At goal ${atGoal} of ${st.n} days` : 'No reading' }}
          right={quiet ? undefined : `Goal ${formatNumber(goal, 0)}`}
        />
      }
    >
      <div className="rga-history">
        <HeroNumber
          value={st.n ? Math.round(st.mean) : null}
          size="num-l"
          unit="steps"
          quietWord={quiet ? word : st.n ? undefined : 'No reading'}
          label={quiet ? word : st.n ? `Daily average ${formatNumber(st.mean, 0)} steps` : 'No reading'}
        />
        {quiet ? (
          <>
            <p className="rg-none">{QUIET_STEPS_HISTORY}</p>
            <DottedTrack
              label="Days at goal"
              value={atGoal}
              goal={st.n || null}
              valueText=""
              quiet
              quietWord={word}
              hue="steps"
            />
          </>
        ) : (
          <>
            <MonoMeta>
              Avg per day · {st.n} of {dates.length} days
            </MonoMeta>
            {st.n ? <MonoMeta>Total {formatNumber(st.sum, 0)} steps</MonoMeta> : null}
            {line ? (
              <GlowLine
                label="Steps, seven-day average"
                unit="steps"
                series={mean.map((v, i) => ({ t: Date.parse(`${dates[i]}T12:00:00Z`), v }))}
                xTicks="days"
                yTicks={0}
                height={160}
                hue="steps"
                endDot="static"
                area
                gapMs={36 * 3_600_000}
              />
            ) : (
              <HighlightBars {...bars} height={140} hue="steps" />
            )}
          </>
        )}
      </div>
    </GradientCard>
  );
}
