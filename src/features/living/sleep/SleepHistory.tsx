/**
 * The nights, as the Sleep tab says them (r071, AUDIT cards 28 and 29): the day tab's last four weeks and a week, month,
 * year or range's nights are ONE card. The average night is the number; every night is a bar (the last recorded one
 * bright, no bar where nothing was recorded, an incomplete night an outline: "at least"), the goal a hairline across and
 * the average a line, and never a bar coloured by "goal met" (neither side of it is good). A long period (a year) draws
 * the 7-day average as a line instead of 365 slivers. Quiet: words, no figure, no picture.
 */
import { useMemo, type ReactNode } from 'react';
import { Moon } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, GlowLine, GradientCard, HeroNumber, HighlightBars, MonoMeta, barsTwin, lineTwin } from '@/components';
import { minutesText, trailingMean } from '@/features/ring/model';
import { SLEEP_COPY as C } from './copy';
import { historyInfo } from './info';
import { historyStats, historyWords, hoursText } from './model';
import { sleepHeroParts } from './SleepHero';
import './sleep.css';

export interface SleepHistoryProps {
  /** The card's heading: "Sleep · last four weeks", "Time asleep". */
  title: string;
  /** One ISO date per night, hours asleep (null: nothing recorded) and which of them are incomplete (an outline). */
  dates: string[];
  hours: Array<number | null>;
  outline: boolean[];
  /** The days before the first one that only feed the 7-day average of the line (a period's lead). */
  lead?: Array<number | null>;
  goalMin: number;
  quiet: boolean;
  /** The 7-day average as a line (a year), not a bar a night. */
  line?: boolean;
  infoFooter?: ReactNode;
}

export function SleepHistory({ title, dates, hours, outline, lead = [], goalMin, quiet, line = false, infoFooter }: SleepHistoryProps) {
  const stats = useMemo(() => historyStats(hours, goalMin), [hours, goalMin]);
  const goalH = goalMin / 60;
  const mean = stats.meanHours;
  const points = useMemo(() => {
    if (!line) return [];
    const all = [...lead, ...hours].map((h) => (h === null ? Number.NaN : h));
    const avg = trailingMean(all).map((x, i) => (i < 6 ? Number.NaN : x)).slice(lead.length);
    return dates.map((d, i) => ({ t: Date.parse(`${d}T12:00:00`), v: Number.isFinite(avg[i]!) ? avg[i]! : null }));
  }, [line, lead, hours, dates]);
  const name = 'Time asleep';
  const twin = useMemo(() => {
    if (quiet) return undefined;
    const data = line
      ? lineTwin({ label: `${name}, 7-day average`, unit: 'h', series: points, decimals: 1 })
      : barsTwin({ dates, values: hours, name, format: hoursText, goal: goalH, average: mean ?? undefined });
    return <ChartTwin data={data} />;
  }, [quiet, line, points, dates, hours, goalH, mean]);
  const info = historyInfo({ goalMin, quiet, line, title: title === C.history ? 'Sleep, last four weeks' : title, twin, footer: infoFooter });
  const head = <CardHead as="h2" icon={Moon} title={title} info={info} />;
  if (quiet) {
    const w = historyWords(hours.map((h) => h ?? Number.NaN), goalMin);
    return (
      <GradientCard as="section" domain="sleep" head={head}>
        <MonoMeta as="p">{w.caption}</MonoMeta>
        <p className="rg-note">{w.line}</p>
      </GradientCard>
    );
  }
  return (
    <GradientCard
      as="section"
      domain="sleep"
      head={head}
      foot={stats.nights ? <CardFoot state={{ word: C.goalMet(stats.met, stats.nights) }} right={C.goalWord(minutesText(goalMin))} /> : undefined}
    >
      {mean === null ? (
        <p className="rg-none">{C.noNights}</p>
      ) : (
        <>
          <div className="sl-history__hero">
            <HeroNumber parts={sleepHeroParts(mean * 60)} size="num-l" label={`${name}, average ${minutesText(mean * 60)}`} />
            <MonoMeta tone="hue">{C.avgNights(stats.nights, stats.days)}</MonoMeta>
          </div>
          {line ? (
            <GlowLine label={`${name}, 7-day average`} unit="h" series={points} reference={points.map(() => goalH)} yTicks={0} xTicks="days" endDot="static" height={120} decimals={1} smoothing="spark" />
          ) : (
            <HighlightBars
              dates={dates}
              values={hours}
              name={name}
              format={hoursText}
              goal={goalH}
              average={mean}
              highlight={stats.last}
              outline={outline}
              height={96}
            />
          )}
        </>
      )}
    </GradientCard>
  );
}
