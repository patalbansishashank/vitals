/** Today's compact intake and weight cards. Numbers keep their uncertainty and unknown means unknown, never zero. */
import { useId, useState } from 'react';
import { Scale, Utensils } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  DottedTrack,
  GlowLine,
  GradientCard,
  HeroNumber,
  InlineWarning,
  Key,
  MonoMeta,
  formatEnergy,
  formatNumber,
  lineTwin,
  type CardSize,
  type GlowLineProps,
  type InfoSpec,
} from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { AdherenceDial } from '@/features/charts/living/AdherenceDial';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { TodayView } from '@/living';
import { TODAY_COPY } from '../../copy';
import { quietEaten, quietWord } from '../../format';
import { coverageText, dialItemsOf, itemLabel } from '../../model/adherence';
import { livingPaths } from '../../paths';
import { useToday } from '../../clock';
import { WeighSheet } from './WeighSheet';
import { withRemoveFoot } from '../cards/RemoveFromToday';
import { INTAKE_UNKNOWN_TEXT, goalDateLine, intakeFigures, openItems, type IntakeFigure } from '../model';
import '../cards/faces.css';

export const SCORE_WORDS = {
  title: 'Plan score',
  soFar: 'How the day follows the plan so far',
  final: 'How the day followed the plan',
} as const;

function unknownText(f: IntakeFigure, over: boolean): string | null {
  return f.kind === 'unknown'
    ? over && f.why === 'nothingLogged'
      ? 'Nothing logged'
      : INTAKE_UNKNOWN_TEXT[f.why]
    : null;
}

const FOOD_INFO =
  'What you have logged against your plan: energy as a target, protein as a floor. Going over is shown, never judged. Unknown is not zero; “at least” means a logged food has no protein figure. The plan score says how the day follows the plan.';

export function SoFarFace({
  view,
  quiet,
  title,
  onArc = () => undefined,
  over = false,
  onRemove,
  cardSize = 'card',
}: {
  view: TodayView;
  quiet: boolean;
  size: 'sm' | 'md';
  title: string;
  onArc?: (itemId: string) => void;
  over?: boolean;
  onRemove?: (() => void) | undefined;
  cardSize?: CardSize;
}) {
  const [open, setOpen] = useState(false);
  const openId = useId();
  const eu = useEnergyUnit();
  const rx = view.prescription;
  const score = view.adherence.today;
  const fig = intakeFigures(view);
  const eaten = fig.eaten.kind === 'unknown' ? null : fig.eaten.value;
  const protein = fig.protein.kind === 'unknown' ? null : fig.protein.value;
  const intakeWord = rx && eaten !== null ? quietEaten(eaten / rx.energyKcal) : 'Nothing logged';
  const label = (id: string) => {
    const it = score?.items.find((i) => i.itemId === id);
    return it ? `the ${itemLabel(id, it.type, rx).toLowerCase()}` : id;
  };
  const open3 = quiet
    ? (score?.items ?? [])
        .filter((i) => i.credit === null)
        .slice(0, 3)
        .map((i) => `${itemLabel(i.itemId, i.type, rx).split(' · ')[0]} is still open`)
    : openItems(view, label);
  const dialItems = dialItemsOf(score, rx).map((i) =>
    quiet ? { ...i, label: i.label.split(' · ')[0]!, detail: i.label.split(' · ')[0]! } : i,
  );
  const hasScore = !!score && score.score !== null;
  const info: InfoSpec = withRemoveFoot(
    {
      title: 'Eaten so far',
      body: FOOD_INFO,
      source: { kind: 'logged' },
      ...(!quiet && score ? { range: coverageText(score) } : {}),
    },
    onRemove,
    'Eaten so far',
  );
  // The page owns the visible title, so callers can still label a past day's total.
  return (
    <GradientCard
      domain="food"
      size={cardSize}
      className="lv-sofar lv-intake-card"
      aria-label={title}
      role="region"
      head={<CardHead icon={Utensils} title={title} info={info} />}
      foot={
        hasScore ? (
          <CardFoot state={{ word: quietWord(score?.score ?? null) }}>
            <Key
              variant="text"
              size="sm"
              aria-expanded={open}
              aria-controls={openId}
              onClick={() => setOpen((o) => !o)}
            >
              {SCORE_WORDS.title}
              {!quiet ? ` · ${formatNumber(score!.score!, 0)}` : ''}
            </Key>
          </CardFoot>
        ) : undefined
      }
    >
      {rx && rx.energyKcal > 0 ? (
        <div className="lv-intake-card__body">
          <div className="lv-intake-card__hero">
            <HeroNumber
              value={eaten}
              unit={eu}
              size={cardSize === 'tile' ? 'time' : 'num-l'}
              unitPlacement={cardSize === 'tile' ? 'below' : 'inline'}
              format={(n) => formatEnergy(n, eu, { withUnit: false })}
              {...(quiet ? { quietWord: intakeWord } : {})}
              label={
                quiet
                  ? `Eaten ${intakeWord}`
                  : eaten === null
                    ? unknownText(fig.eaten, over)!
                    : `${formatEnergy(eaten, eu)} eaten`
              }
            />
            {!quiet ? <MonoMeta tone="hue">of {formatEnergy(rx.energyKcal, eu)}</MonoMeta> : null}
          </div>
          {!quiet && eaten === null ? <MonoMeta tone="hue">{unknownText(fig.eaten, over)}</MonoMeta> : null}
          <DottedTrack
            label="Eaten"
            value={eaten}
            goal={rx.energyKcal}
            unit={eu}
            valueText={eaten === null ? unknownText(fig.eaten, over)! : formatEnergy(eaten, eu)}
            goalText={formatEnergy(rx.energyKcal, eu)}
            quiet={quiet}
            quietWord={intakeWord}
            twin={false}
          />
          {!quiet ? (
            <>
              <div className="lv-intake-card__protein">
                <span>Protein</span>
                <MonoMeta tone="hue">
                  {protein === null
                    ? unknownText(fig.protein, over)
                    : `${fig.protein.kind === 'atLeast' ? 'At least ' : ''}${formatNumber(protein, 0)} / ${formatNumber(rx.macros.proteinG, 0)} g`}
                </MonoMeta>
              </div>
              <DottedTrack
                label="Protein"
                value={protein}
                goal={rx.macros.proteinG}
                goalKind="floor"
                unit="g"
                valueText={
                  protein === null
                    ? unknownText(fig.protein, over)!
                    : `${fig.protein.kind === 'atLeast' ? 'at least ' : ''}${formatNumber(protein, 0)} g`
                }
                goalText={`${formatNumber(rx.macros.proteinG, 0)} g`}
                hue="food"
                twin={false}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {open && hasScore ? (
        <div id={openId} className="lv-intake-card__score">
          <AdherenceDial
            items={dialItems}
            score={score?.score ?? null}
            size="sm"
            final={score?.final ?? false}
            {...(quiet ? { quietWord: quietWord(score?.score ?? null) } : {})}
            onArcClick={onArc}
          />
          <ul>
            {open3.length ? (
              open3.map((t) => <li key={t}>{t}</li>)
            ) : (
              <li>Everything on the plan has an answer.</li>
            )}
          </ul>
        </div>
      ) : null}
    </GradientCard>
  );
}

/** Real dates, gaps, forecast uncertainty and unusual weigh-ins stay intact in the compact line. */
export function weightLine(trend: TrendLaneData, quiet: boolean, height = 72): GlowLineProps {
  const start = new Date(`${trend.startDate}T00:00:00`).getTime();
  const pointTime = (i: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.getTime();
  };
  const first = Math.max(0, trend.days - 14);
  const series = trend.trend
    .slice(first)
    .map((v, i) => ({ t: pointTime(first + i), v: Number.isFinite(v) ? v : null }));
  return {
    label: 'Weight trend',
    series,
    unit: trend.unit,
    decimals: trend.decimals,
    variant: 'spark',
    xTicks: 'none',
    yTicks: 0,
    height,
    quiet,
    hue: 'body',
    twin: false,
    endDot: 'static',
    ...(trend.realistic
      ? {
          band: {
            lo: trend.realistic.p10.slice(first).map((v) => (Number.isFinite(v) ? v : null)),
            hi: trend.realistic.p90.slice(first).map((v) => (Number.isFinite(v) ? v : null)),
          },
        }
      : {}),
    marks: trend.weighIns
      .filter((p) => p.day >= first)
      .map((p) => ({ t: pointTime(p.day), v: p.value, label: '', hollow: !!p.flagged })),
  };
}

const WEIGHT_INFO =
  'Your trend weight, smoothed from your weigh-ins, against the plan’s forecast band. Behind, on track or ahead compares the trend with that band. An unusual weigh-in stays on the chart, hollow, and counts less in the trend. The goal date is a range.';

function WeightCard({
  trend,
  quiet,
  kg,
  range,
  state,
  goal,
  shift,
  unusual,
  cardSize = 'tile',
  onRemove,
  onLog,
  date,
}: {
  trend: TrendLaneData | null;
  quiet: boolean;
  kg: number | null;
  range?: [number, number] | undefined;
  state?: string | undefined;
  goal?: string | null | undefined;
  shift?: string | null | undefined;
  unusual?: number | null | undefined;
  cardSize?: CardSize;
  onRemove?: (() => void) | undefined;
  onLog?: (() => void) | undefined;
  date?: string;
}) {
  const [weighing, setWeighing] = useState(false);
  const today = useToday();
  const line = trend ? weightLine(trend, quiet) : null;
  const unit = trend?.unit ?? 'kg';
  const last = trend?.trend.at(-1);
  const previous = trend?.trend.at(-8);
  const weekly =
    last !== undefined && previous !== undefined && Number.isFinite(last) && Number.isFinite(previous)
      ? last - previous
      : null;
  const info = withRemoveFoot(
    {
      title: 'Weight',
      body: WEIGHT_INFO,
      source: { kind: 'estimate', words: 'Smoothed from the weigh-ins you logged.' },
      ...(!quiet && shift ? { range: shift } : {}),
      evidence: { to: '/evidence/13-scale-weight-decomposition', label: 'How scale weight changes' },
      ...(!quiet && line ? { twin: <ChartTwin data={lineTwin(line)} /> } : {}),
    },
    onRemove,
    'Weight',
  );
  return (
    <>
      <GradientCard
        domain="body"
        size={cardSize}
        className="lv-weight lv-weight-card"
        aria-label="Weight"
        role="region"
        href={livingPaths.progress('trend')}
        head={<CardHead icon={Scale} title="Weight" info={info} />}
        foot={
          <CardFoot
            {...(state ? { state: { word: state } } : {})}
            right={!quiet && goal ? `Goal ${goal}` : undefined}
          />
        }
      >
        {kg !== null ? (
          <HeroNumber
            value={kg}
            unit={unit}
            decimals={1}
            range={range}
            size={cardSize === 'tile' ? 'num' : 'num-l'}
            {...(quiet ? { quietWord: state ?? 'Trend' } : {})}
            label={
              quiet
                ? (state ?? 'Weight trend')
                : `${formatNumber(kg, 1)} ${unit} trend${range ? `, likely ${formatNumber(range[0], 1)} to ${formatNumber(range[1], 1)}` : ''}`
            }
          />
        ) : (
          <div className="lv-weight-card__empty">
            <MonoMeta>No weigh-ins yet</MonoMeta>
            <Key variant="text" size="sm" onClick={onLog ?? (() => setWeighing(true))}>
              Log weight
            </Key>
          </div>
        )}
        {!quiet && weekly !== null ? (
          <MonoMeta tone="hue">
            {weekly < 0 ? '−' : '+'}
            {formatNumber(Math.abs(weekly), 1)} {unit} / week
          </MonoMeta>
        ) : null}
        {line ? <GlowLine {...line} /> : null}
        {unusual !== undefined && unusual !== null && Math.abs(unusual) >= 0.8 && !quiet ? (
          <InlineWarning severity="info">
            {TODAY_COPY.unusualWeighIn(`${unusual > 0 ? '+' : '−'}${formatNumber(Math.abs(unusual), 1)}`)}
          </InlineWarning>
        ) : null}
      </GradientCard>
      {weighing ? <WeighSheet open date={date ?? today} onClose={() => setWeighing(false)} /> : null}
    </>
  );
}

export function WeightFace({
  view,
  trend,
  quiet,
  compact,
  isToday,
  cardSize = 'tile',
  onRemove,
}: {
  view: TodayView;
  trend: TrendLaneData | null;
  quiet: boolean;
  compact: boolean;
  isToday: boolean;
  cardSize?: CardSize;
  onRemove?: (() => void) | undefined;
}) {
  const tw = view.trendWeight;
  const v = trend?.trend.at(-1);
  const kg = tw?.kg ?? (v !== undefined && Number.isFinite(v) ? v : (trend?.weighIns.at(-1)?.value ?? null));
  const drift = view.drift?.[0];
  const gd = goalDateLine(view);
  const todayW =
    trend && trend.todayIndex !== null ? trend.weighIns.find((w) => w.day === trend.todayIndex) : undefined;
  // The Today contract stores kilograms; trend lanes may already be converted to pounds by their source.
  const display = tw && kg !== null && trend?.unit === 'lb' ? kg * 2.20462262185 : kg;
  const sd = tw && Number.isFinite(tw.sd) ? tw.sd : null;
  void compact;
  return (
    <WeightCard
      trend={trend}
      quiet={quiet}
      kg={display}
      range={
        display !== null && sd !== null && sd > 0
          ? [
              display - 1.2816 * sd * (trend?.unit === 'lb' ? 2.20462262185 : 1),
              display + 1.2816 * sd * (trend?.unit === 'lb' ? 2.20462262185 : 1),
            ]
          : undefined
      }
      state={drift ? TODAY_COPY.drift[drift.state] : undefined}
      goal={gd.range}
      shift={gd.shift ? TODAY_COPY.goalShift(gd.shift.days, gd.shift.sd) : null}
      unusual={isToday && todayW && tw && todayW.flagged ? todayW.value - display! : null}
      cardSize={cardSize}
      onRemove={onRemove}
      date={view.date}
    />
  );
}

export function PlanlessWeightFace({
  trend,
  quiet,
  date,
  cardSize = 'tile',
  onRemove,
  onLog,
}: {
  trend: TrendLaneData | null;
  quiet: boolean;
  date: string;
  cardSize?: CardSize;
  onRemove?: (() => void) | undefined;
  onLog?: (() => void) | undefined;
}) {
  const i = trend?.trend.findLastIndex((v) => Number.isFinite(v)) ?? -1;
  const value = i >= 0 ? trend!.trend[i]! : (trend?.weighIns.at(-1)?.value ?? null);
  const sd = i >= 0 ? trend?.trendSd?.[i] : undefined;
  return (
    <WeightCard
      trend={trend}
      quiet={quiet}
      kg={value}
      range={
        value !== null && sd !== undefined && sd > 0 ? [value - 1.2816 * sd, value + 1.2816 * sd] : undefined
      }
      cardSize={cardSize}
      onRemove={onRemove}
      onLog={onLog}
      date={date}
    />
  );
}
