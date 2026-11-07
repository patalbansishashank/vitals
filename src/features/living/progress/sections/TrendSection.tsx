/** Weight keeps the filter's conditional range; the goal distance lives in the Goal hero. */
import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import {
  CardFoot,
  ChartTwin,
  HeroNumber,
  Key,
  KeyBank,
  MonoMeta,
  formatNumber,
  formatRange,
  formatSigned,
  type InfoSpec,
} from '@/components';
import { topicHref } from '@/features/evidence/links';
import { TrendLane } from '@/features/charts/living/TrendLane';
import { trendTwin } from '@/features/charts/living/trend';
import type { LocalDate } from '@/living';
import { addDays } from '@/living/dates';
import type { ActivePlan } from '../../activePlan';
import { useLiving } from '../../data/source';
import { fmtDay, fmtDayMonth } from '../../format';
import { PROGRESS_COPY as C } from '../copy';
import { TREND_RANGES, readTrend, signedInterval, trendWindow, type TrendRange } from '../model';
import { MeasurementPanel } from '../components/MeasurementPanel';
import { ProgressCard } from '../components/ProgressCard';

export interface TrendSectionProps {
  plan: ActivePlan;
  today: LocalDate;
  range: TrendRange;
  onRange: (range: TrendRange) => void;
  quiet: boolean;
}
const PLANLESS_DAYS: Record<TrendRange, number> = { '2wk': 14, '4wk': 28, '12wk': 84, all: 182 };
const INFO: InfoSpec = {
  title: 'Your weight trend',
  body: 'The line smooths water and gut noise, so one weigh-in moves it only a little. The shaded band is what your plan expected at your recorded adherence. Dots are weigh-ins; hollow dots are unusual readings, kept. Version lines mark plan changes. The trend forms after a week of weigh-ins.',
  source: { kind: 'estimate', words: 'Your logged weigh-ins, smoothed.' },
  range:
    'The trend has a conditional estimate range; the forecast band shows the scenario range at your recorded adherence. Neither is a promise.',
  evidence: { to: topicHref('tracking-replanning'), label: 'Tracking and replanning' },
};

export function WeightGhost() {
  return (
    <svg
      className="lv-prog-ghost"
      viewBox="0 0 320 100"
      role="img"
      aria-label="Your weight trend will appear here"
    >
      <path d="M8 24 C80 24 102 48 160 51 S248 74 312 74" />
    </svg>
  );
}
export function LogWeight({ today }: { today: LocalDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Key arrow onClick={() => setOpen(true)}>
        Log your weight
      </Key>
      {open ? <MeasurementPanel open onClose={() => setOpen(false)} date={today} initial="weight" /> : null}
    </>
  );
}

export function WeighInsSection({ today, range, onRange, quiet }: Omit<TrendSectionProps, 'plan'>) {
  const from = addDays(today, -(PLANLESS_DAYS[range] - 1));
  const data = useLiving((s) => s.trend(from, today), [from, today]);
  const last = data?.weighIns.at(-1);
  return (
    <ProgressCard
      id="trend"
      title={C.faces.trend}
      icon={Scale}
      domain="body"
      info={{
        ...INFO,
        body: 'These dots are the weigh-ins you logged, in their own units. Without a running plan there is no filtered trend or forecast. Choose a window to see earlier readings. A single weigh-in can change with water and gut contents, so it need not describe a change in tissue.',
        twin: !quiet && data ? <ChartTwin data={trendTwin(data)} /> : undefined,
      }}
      foot={
        <CardFoot
          state={{ word: last ? 'Logged' : C.noTrend }}
          right={last && data ? fmtDay(addDays(data.startDate, last.day)) : undefined}
          tone="ink"
        />
      }
    >
      {last && data ? (
        <HeroNumber
          size="num-l"
          value={last.value}
          decimals={1}
          unit={data.unit}
          quietWord={quiet ? 'Logged' : undefined}
          label={quiet ? 'Weight logged' : `${formatNumber(last.value, 1)} ${data.unit}`}
        />
      ) : (
        <MonoMeta>{C.noTrend}</MonoMeta>
      )}
      <RangeBank range={range} onRange={onRange} />
      {data && last ? (
        <TrendLane
          data={data}
          quiet={quiet}
          readout={false}
          legend={false}
          tableTwin={false}
          size="progress"
        />
      ) : (
        <>
          <WeightGhost />
          <LogWeight today={today} />
        </>
      )}
    </ProgressCard>
  );
}

function RangeBank({ range, onRange }: Pick<TrendSectionProps, 'range' | 'onRange'>) {
  return (
    <KeyBank<TrendRange>
      size="sm"
      label={C.rangeLabel}
      value={range}
      onChange={onRange}
      options={TREND_RANGES.map((v) => ({ value: v, label: C.ranges[v] }))}
    />
  );
}

export function TrendSection({ plan, today, range, onRange, quiet }: TrendSectionProps) {
  const { from, to } = trendWindow(range, plan, today);
  const data = useLiving((s) => s.trend(from, to), [from, to]);
  const whole = useLiving((s) => s.trend(plan.startDate, today), [plan.startDate, today]);
  const r = readTrend(whole, today);
  const forming = r.weighDays < 7;
  const gap = !forming && r.gapDays !== null && r.gapDays >= 14;
  const shown = useMemo(() => {
    if (!data) return null;
    const rest = { ...data };
    delete rest.asPrescribed;
    return forming ? { ...rest, trend: rest.trend.map(() => Number.NaN) } : rest;
  }, [data, forming]);
  const unit = whole?.unit ?? 'kg';
  const delta = r.now !== null && r.first !== null ? r.now - r.first : null;
  const direction =
    C.directions[delta === null || Math.abs(delta) < 0.2 ? 'steady' : delta < 0 ? 'down' : 'up'];
  const band = r.now !== null && r.sd !== null && r.sd > 0 ? signedInterval(r.now, r.sd) : null;
  const value = band
    ? formatRange(Math.min(...band), Math.max(...band), 1)
    : r.now !== null
      ? formatNumber(r.now, 1)
      : null;
  const ready = !forming && !gap && r.now !== null;
  const state = !r.weighDays ? C.noTrend : gap ? 'Trend paused' : forming ? 'Trend forming' : direction;
  return (
    <ProgressCard
      id="trend"
      title={C.faces.trend}
      icon={Scale}
      domain="body"
      info={{ ...INFO, twin: !quiet && shown ? <ChartTwin data={trendTwin(shown)} /> : undefined }}
      foot={
        <CardFoot
          state={{ word: quiet ? state : forming ? C.trendForming(r.weighDays) : state }}
          right={whole?.goal ? (quiet ? 'Goal' : whole.goal.label) : undefined}
          tone="ink"
        />
      }
    >
      {ready ? (
        <>
          <HeroNumber
            size="num-l"
            value={value}
            unit={unit}
            quietWord={quiet ? direction : undefined}
            label={quiet ? direction : `Trend ${value} ${unit}`}
          />
          {!quiet && delta !== null ? (
            <MonoMeta tone="hue">
              Trend · {C.sinceStart(`${formatSigned(delta, 1)} ${unit}`, fmtDayMonth(plan.startDate))}
            </MonoMeta>
          ) : null}
        </>
      ) : (
        <MonoMeta>{gap && r.lastWeighIn ? C.trendGap(fmtDay(r.lastWeighIn)) : state}</MonoMeta>
      )}
      <RangeBank range={range} onRange={onRange} />
      {shown && r.weighDays ? (
        <TrendLane
          data={shown}
          size="progress"
          quiet={quiet}
          readout={false}
          legend={false}
          tableTwin={false}
          hue="body"
          pulse
        />
      ) : (
        <>
          <WeightGhost />
          <LogWeight today={today} />
        </>
      )}
    </ProgressCard>
  );
}
