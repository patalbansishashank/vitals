/** Independent Today cards; each reads the same activity model and keeps its own explanation and table. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Activity, ChevronRight, Circle, Flame, Footprints, Heart, Plus } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  DottedTrack,
  GlowLine,
  GradientCard,
  HeroNumber,
  HighlightBars,
  Key,
  MonoMeta,
  OverflowText,
  StackBar,
  formatNumber,
  formatEnergyRange,
  toEnergyUnit,
  type CardSize,
  type InfoSpec,
} from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { EnergyDay } from '@/living/sensors/energyDay';
import { useActivityData, type TodayActivityView, type DayEnergyView } from '../../activity/data';
import {
  COMPONENT_ORDER,
  COMPONENT_LABEL,
  COMPONENT_HUE,
  COMPONENT_INFO,
  componentsThrough,
  componentRange,
} from '../../energy/model';
import {
  stepsHours,
  lineageText,
  activityRowWord,
  rowName,
  reviewRowTimeText,
  liveLineText,
  pendingHeartPoints,
  heartPointsQuietText,
  HEART_POINTS_GOAL,
  HEART_POINTS_LABEL,
  energyText,
} from '../../activity/model';
import { LIVE_DETECTION_STALE_MS } from '@/state/liveDetections';
import { StepsSourcePanel } from '../../activity/StepsSourceChart';
import { StepsDayChart } from '../../activity/StepsDayChart';
import { PossibleLine } from '../../activity/PossibleLine';
import { stepsBins, binsTotal } from '../../activity/stepsTime';
import { ACTIVITY_COPY as C } from '../../copy';
import { weekOf } from '../../format';
import { energyPaths } from '../../energy/paths';
import { rangeOf, planState, PLAN_STATE_WORD } from '../../activity/energyFigures';
import { FACE_WORDS, shortFacts, stepsPanelDay } from './activityCardModel';
import { withRemoveFoot } from './RemoveFromToday';
import type { TodayCardProps } from './types';
import type { ActivityFaceProps } from '../components/ActivityFace';
import '../../activity/activity.css';
import './activity-cards.css';

export interface ActivityCardInput extends ActivityFaceProps {
  activityView?: TodayActivityView | null;
  stepsGoal?: number | null;
  size?: CardSize;
  onRemove?: (() => void) | undefined;
  record?: { can: boolean; open: () => void };
  log?: { can: boolean; open: () => void };
}

const inputOf = ({ ctx, size, onRemove }: TodayCardProps): ActivityCardInput => ({
  date: ctx.date,
  isToday: ctx.isToday,
  quiet: ctx.quiet,
  review: ctx.review,
  onOpenRow: ctx.openActivity,
  nowMs: ctx.nowMs,
  noPlan: ctx.planless,
  size,
  onRemove,
  record: ctx.record,
  log: ctx.log,
  stepsGoal: ctx.view?.prescription?.steps ?? null,
  ...('activityView' in ctx ? { activityView: ctx.activityView } : {}),
});

export function EnergyCard(p: TodayCardProps) {
  return <EnergyContent {...inputOf(p)} />;
}
export function EnergyBurnedCard(p: TodayCardProps) {
  return <EnergyContent {...inputOf(p)} titleOverride="Energy burned" />;
}
export function StepsCard(p: TodayCardProps) {
  return <StepsContent {...inputOf(p)} />;
}
export function HeartPointsCard(p: TodayCardProps) {
  return <HeartPointsContent {...inputOf(p)} />;
}
export function ActivitiesCard(p: TodayCardProps) {
  return <ActivitiesContent {...inputOf(p)} />;
}
export function EnergyKindsCard(p: TodayCardProps) {
  return <EnergyContent {...inputOf(p)} kinds />;
}
export function StepsDayCard(p: TodayCardProps) {
  return <StepsContent {...inputOf(p)} throughDay />;
}

/** The current hour uses the headline's interpolation; past hours retain their quarter-hour shape. */
export function cumulativeEnergy(day: Pick<EnergyDay, 'bins15'>, nowMs: number) {
  const Q = 900_000;
  const H = 3_600_000;
  const first = day.bins15[0]?.start ?? 0;
  const past = [{ t: first, v: 0 }];
  const future: Array<{ t: number; v: number }> = [];
  const currentStart = Number.isFinite(nowMs) ? first + Math.floor((nowMs - first) / H) * H : Infinity;
  const current = day.bins15.filter((b) => b.start >= currentStart && b.start < currentStart + H);
  const currentTotal = current.reduce((n, b) => n + b.kcal, 0);
  const hourBase = day.bins15.filter((b) => b.start < currentStart).reduce((n, b) => n + b.kcal, 0);
  let total = 0;
  let addedNow = false;
  for (const bin of day.bins15) {
    if (bin.start >= currentStart && bin.start < currentStart + H) {
      if (!addedNow) {
        if (nowMs >= first)
          past.push({
            t: nowMs,
            v: total + currentTotal * Math.min(1, Math.max(0, (nowMs - currentStart) / H)),
          });
        addedNow = true;
      }
      if (bin.start + Q > nowMs)
        future.push({
          t: bin.start + Q,
          v: hourBase + currentTotal * Math.min(1, (bin.start + Q - currentStart) / H),
        });
    } else if (bin.start + Q <= nowMs) past.push({ t: bin.start + Q, v: total + bin.kcal });
    else future.push({ t: bin.start + Q, v: total + bin.kcal });
    total += bin.kcal;
  }
  return {
    past,
    future,
    from: first,
    to: day.bins15.at(-1) ? day.bins15.at(-1)!.start + Q : first + 86_400_000,
  };
}

type EnergyInput = ActivityCardInput & { kinds?: boolean; titleOverride?: string };
const TODAY_COMPONENT_LABEL: Record<(typeof COMPONENT_ORDER)[number], string> = {
  rmr: 'Resting metabolism',
  neatBase: 'Everyday movement',
  stepsEnergy: 'Walking',
  exercise: 'Exercise',
  recovery: 'After exercise',
  tef: 'Food digestion',
  other: 'Model adjustments',
};
export function EnergyContent(p: EnergyInput) {
  return 'activityView' in p ? <EnergyWithView {...p} /> : <EnergyHook {...p} />;
}
function EnergyHook(p: EnergyInput) {
  const data = useActivityData();
  const view = data.useToday(p.date, p.isToday);
  return <EnergyWithView {...p} activityView={view} />;
}
function EnergyWithView(p: EnergyInput) {
  return p.isToday ? <EnergyViewContent {...p} /> : <PastEnergyContent {...p} />;
}
function PastEnergyContent(p: EnergyInput) {
  const data = useActivityData();
  const past = data.useDayEnergy?.(p.date);
  return <EnergyViewContent {...p} past={past} />;
}
function EnergyViewContent({
  date,
  isToday,
  quiet,
  noPlan = false,
  onRemove,
  size = 'card',
  nowMs,
  kinds = false,
  titleOverride,
  activityView: view,
  past,
}: EnergyInput & { past?: DayEnergyView }) {
  const unit = useEnergyUnit();
  if (quiet) return null;
  const day = isToday ? view?.day : past?.day;
  const e = isToday
    ? view?.model.energy
    : day
      ? { soFar: day.total, byBedtime: day.total, plan: null }
      : null;
  const components = day ? componentsThrough(day, isToday ? nowMs : Infinity) : null;
  const positive = components
    ? COMPONENT_ORDER.reduce((sum, id) => sum + Math.max(0, components[id]), 0)
    : 0;
  const parts = components && day
    ? COMPONENT_ORDER.map((id) => {
        const value = components[id];
        const bounds = componentRange(value, day.total, day.envelope);
        return {
          id,
          label: TODAY_COMPONENT_LABEL[id],
          fullLabel: COMPONENT_LABEL[id],
          valueText: energyText(value, unit),
          rangeText: bounds ? formatEnergyRange(bounds.lo, bounds.hi, unit, { withUnit: false }) : null,
          hue: COMPONENT_HUE[id],
          share: positive > 0 ? Math.max(0, value) / positive : 0,
        };
      })
    : [];
  const shownParts = parts.filter((part) => part.valueText !== '0');
  const title = titleOverride ?? (kinds ? 'Energy by kind' : C.energy);
  const info: InfoSpec = withRemoveFoot(
    {
      title,
      body: `Estimated, with likely ranges. Burned so far is what your body has used today. ${noPlan ? FACE_WORDS.noPlanNote : 'Likely by bedtime assumes the rest of the day as planned.'} Resting burn comes from your body model, everyday movement from steps, and food digestion from what you logged. The ring’s estimate is for comparison only.`,
      source: {
        kind: 'engine',
        words: 'The realised day, including the remaining plan or habitual-day assumptions.',
      },
      evidence: { to: '/evidence/02-integrated-daily-expenditure', label: 'Daily energy expenditure' },
      terms: kinds
        ? COMPONENT_ORDER.map((id) => ({ term: COMPONENT_LABEL[id], text: COMPONENT_INFO[id] }))
        : undefined,
      twin:
        day && e ? (
          <ChartTwin
            data={{
              title: kinds ? 'Energy figures and components table' : 'Energy figures table',
              caption: kinds
                ? 'Estimated energy, its seven signed ledger components, and likely ranges. Zero components were not counted today.'
                : 'Estimated energy and likely ranges.',
              head: ['Figure', unit, 'Likely range'],
              rows: [
                [
                  'Burned so far',
                  energyText(e.soFar, unit),
                  rangeOf(e.soFar, day.envelope, day.total, unit)?.text ?? 'Unavailable',
                ],
                ...(isToday
                  ? [
                      [
                        'Likely by bedtime',
                        energyText(e.byBedtime, unit),
                        rangeOf(e.byBedtime, day.envelope, day.total, unit)?.text ?? 'Unavailable',
                      ],
                    ]
                  : []),
                ...(e.plan !== null && e.plan !== undefined
                  ? [
                      [
                        'Planned burn',
                        energyText(e.plan, unit),
                        rangeOf(e.plan, view?.plan?.envelope, view?.plan?.total, unit)?.text ?? 'Unavailable',
                      ],
                    ]
                  : []),
                ...(kinds
                  ? parts.map((part) => [part.fullLabel, part.valueText, part.rangeText ?? 'Unavailable'])
                  : []),
              ],
              fileName: 'vitals-energy-figures.csv',
            }}
          />
        ) : undefined,
    },
    onRemove,
    title,
  );
  if (!e) {
    const missing = view?.model.energyMissing === 'profile' || past?.missing === 'profile';
    return (
      <GradientCard
        as="section"
        aria-label={title}
        domain="energy"
        size={size}
        head={<CardHead icon={Flame} title={title} info={info} />}
      >
        <p className="lv-energy-card__empty">
          {missing
            ? FACE_WORDS.noProfile
            : (isToday ? !view : past?.status === 'loading')
              ? 'Working out the day…'
              : 'Energy is not available for this day.'}
        </p>
        {missing ? (
          <Link className="lm-link" to="/body">
            Your body
          </Link>
        ) : null}
      </GradientCard>
    );
  }
  const range = rangeOf(
    e.soFar,
    day?.envelope ?? view?.plan?.envelope,
    day?.total ?? view?.plan?.total,
    unit,
  );
  const curve = day ? cumulativeEnergy(day, isToday ? nowMs : Infinity) : null;
  const points = curve ? [...curve.past, ...curve.future] : [];
  const envelope = day?.envelope;
  const scale = (n: number) => toEnergyUnit(n, unit);
  const state = !noPlan ? planState(e.byBedtime, e.plan) : null;
  const componentRows = shownParts.map((part) => ({
    id: part.id,
    label: part.fullLabel,
    share: part.share,
    valueText: `${part.valueText} ${unit}`,
    hue: part.hue,
  }));
  return (
    <GradientCard
      as="section"
      aria-label={title}
      domain="energy"
      size={size}
      href={energyPaths.day(isToday ? undefined : date)}
      className="lv-energy-card"
      head={<CardHead icon={Flame} title={title} info={info} />}
      foot={
        <CardFoot
          state={{ word: state ? PLAN_STATE_WORD[state] : 'Estimated' }}
          right={
            isToday && size !== 'tile'
              ? `By bedtime ~${energyText(e.byBedtime, unit)} ${unit}`
              : undefined
          }
        />
      }
    >
      <HeroNumber
        value={scale(e.soFar)}
        format={(n) => `${size === 'tile' ? '~' : ''}${energyText(unit === 'kJ' ? n / 4.184 : n, unit)}`}
        unit={unit}
        size={size === 'tile' ? 'time' : 'num-l'}
        label={`${isToday ? 'Burned so far' : 'Burned'} ${energyText(e.soFar, unit)} ${unit}${range ? `, likely ${range.text}` : ''}`}
        {...(range && size !== 'tile' ? { range: `Likely ${range.text}` } : {})}
      />
      {kinds && day ? (
        <>
          <StackBar
            label="Positive energy components"
            total={`${energyText(e.soFar, unit)} ${unit}`}
            rows={componentRows}
            legend="none"
            twin={false}
          />
          <ul className="lv-energy-card__parts" aria-label="Energy components">
            {shownParts.map((part) => (
              <li key={part.id} className="lv-energy-card__part">
                <MonoMeta className="lv-energy-card__part-name">
                  <i style={{ background: part.hue }} aria-hidden="true" />
                  {part.label}
                </MonoMeta>
                <span className="lv-energy-card__part-figures">
                <OverflowText text={`~${part.valueText} ${unit}`} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {curve ? (
        <GlowLine
          label="Energy burned through the day"
          unit={unit}
          series={curve.past.map((p) => ({ t: p.t, v: scale(p.v) }))}
          future={curve.future.map((p) => ({ t: p.t, v: scale(p.v) }))}
          from={curve.from}
          to={curve.to}
          now={isToday ? nowMs : null}
          height={100}
          yTicks={0}
          xTicks="clock"
          endDot={isToday ? 'pulse' : 'static'}
          twin={false}
          {...(envelope && day.total > 0
            ? {
                band: {
                  lo: points.map((p) => scale((p.v * envelope.lo) / day.total)),
                  hi: points.map((p) => scale((p.v * envelope.hi) / day.total)),
                },
              }
            : {})}
          {...(!noPlan && view?.plan && e.plan !== null
            ? { reference: points.map((p) => scale(cumulativeEnergy(view.plan!, p.t).past.at(-1)?.v ?? 0)) }
            : {})}
        />
      ) : null}
    </GradientCard>
  );
}

type StepsInput = ActivityCardInput & { throughDay?: boolean };
export function StepsContent(p: StepsInput) {
  return 'activityView' in p ? <StepsViewContent {...p} /> : <StepsHook {...p} />;
}
function StepsHook(p: StepsInput) {
  const data = useActivityData();
  const view = data.useToday(p.date, p.isToday);
  return <StepsViewContent {...p} activityView={view} />;
}
function StepsViewContent({
  date,
  isToday,
  quiet,
  review,
  nowMs,
  onRemove,
  size = 'tile',
  throughDay = false,
  activityView: view,
  stepsGoal,
}: StepsInput) {
  const data = useActivityData();
  const timeline = data.useTimeline(date);
  const stepDay = data.useStepsDay(date);
  const [open, setOpen] = useState(false);
  const model = view?.model.steps;
  const bins = timeline ? stepsBins(timeline) : [];
  const value = isToday
    ? (model?.fusedSoFar ?? stepDay?.headline ?? binsTotal(bins))
    : (stepDay?.headline ?? binsTotal(bins));
  const goal =
    model?.goal ?? (stepsGoal ? { value: stepsGoal, source: 'plan' } : { value: 10_000, source: 'default' });
  const likely = isToday && model && model.prior > 0 && value !== null ? model.total : null;
  const hours = timeline ? stepsHours(timeline) : [];
  const lineage = model ? lineageText(model.lineages) : stepDay ? 'Ring and phone' : null;
  const title = throughDay ? 'Steps through the day' : 'Steps';
  const rows = [...review.rows, ...review.decided].filter((r) => r.date === date);
  const panelDay = timeline ? stepsPanelDay(timeline, rows, isToday, stepDay?.headline ?? null) : null;
  const word =
    value === null
      ? FACE_WORDS.noStepData
      : value >= goal.value
        ? 'Goal met'
        : likely !== null
          ? likely >= goal.value
            ? 'On course'
            : 'Likely under'
          : 'Building';
  const info = withRemoveFoot(
    {
      title,
      body: 'For each stretch of the day Vitals counts one step source, ring or phone, never both added. The goal is your plan’s steps, else your ring’s goal, else a default. The forecast assumes the rest of the day as planned.',
      source: { kind: 'ring' as const, words: lineage ?? 'No step data yet.' },
      range: quiet
        ? undefined
        : `${formatNumber(goal.value, 0)} steps · ${goal.source === 'default' ? 'default goal' : `${goal.source} goal`}`,
      evidence: { to: '/evidence/02-neat-activity-steps', label: 'Steps and everyday movement' },
      twin: !quiet ? (
        <ChartTwin
          data={{
            title: 'Steps table',
            caption: 'Counted steps and the goal.',
            head: ['Figure', 'Steps'],
            rows: [
              ['Counted', value ?? 'Unknown'],
              ['Goal', goal.value],
              ...(likely !== null ? [['Likely by bedtime', Math.round(likely)]] : []),
            ],
            fileName: 'vitals-steps.csv',
          }}
        />
      ) : undefined,
    },
    onRemove,
    title,
  );
  return (
    <>
      <GradientCard
        as="section"
        aria-label={title}
        domain="steps"
        size={size}
        onOpen={() => setOpen(true)}
        openLabel="Steps by source"
        className="lv-steps-card"
        head={<CardHead icon={Footprints} title={title} info={info} />}
        foot={
          <CardFoot
            state={{ word }}
            right={!quiet && likely !== null && size !== 'tile' ? `By bedtime ~${formatNumber(likely, 0)}` : undefined}
          />
        }
      >
        {throughDay && panelDay ? (
          <>
            <HeroNumber
              value={value}
              size="num"
              label={quiet ? word : `${value ?? 'Unknown'} counted steps`}
              quietWord={quiet ? word : undefined}
            />
            <StepsDayChart {...panelDay} nowMs={nowMs} quiet={quiet} showTotal={false} />
          </>
        ) : size === 'card' && timeline ? (
          <>
            <HeroNumber
              value={value}
              size="num-l"
              label={quiet ? word : `${value ?? 'Unknown'} steps`}
              quietWord={quiet ? word : undefined}
            />
            <HighlightBars
              dates={bins.map((b) => String(b.start))}
              values={bins.map((b) => b.steps)}
              name="Steps through the day"
              highlight={null}
              showAxis={false}
              height={74}
              quiet={quiet}
              twin={false}
            />
          </>
        ) : (
          <>
            <HeroNumber
              value={value}
              size="time"
              label={quiet ? word : `${value ?? 'Unknown'} steps`}
              quietWord={quiet ? word : undefined}
            />
            {!quiet ? <MonoMeta>of {formatNumber(goal.value, 0)}</MonoMeta> : null}
          <DottedTrack
            label="Steps"
            value={value}
            goal={goal.value}
            valueText={value === null ? FACE_WORDS.noStepData : `${formatNumber(value, 0)} steps`}
            goalText={`${formatNumber(goal.value, 0)} steps`}
            quiet={quiet}
            quietWord={word}
            state={value === null ? 'unknown' : 'normal'}
            twin={false}
          />
          </>
        )}
        {hours.some((h) => h.disagree) ? (
          <MonoMeta className="lv-steps-card__source">
            Sources differ
          </MonoMeta>
        ) : null}
      </GradientCard>
      {open ? (
        <StepsSourcePanel
          open
          onClose={() => setOpen(false)}
          hours={hours}
          located={stepDay?.located ?? value}
          headline={stepDay?.headline ?? null}
          headlinePolicy={stepDay?.headlinePolicy ?? null}
          residual={stepDay?.ringResidual ?? null}
          ringDailyTotal={stepDay?.ringDailyTotal ?? null}
          nowMs={nowMs}
          quiet={quiet}
          {...(panelDay ? { day: panelDay } : {})}
        />
      ) : null}
    </>
  );
}

export function HeartPointsContent({
  date,
  isToday,
  quiet,
  review,
  onRemove,
  size = 'tile',
}: ActivityCardInput) {
  const data = useActivityData();
  const week = weekOf(date);
  const hp = data.useHeartPoints(week[0]!, date);
  const days = data.useHeartPointsDays?.(week[0]!, date);
  const pending = review.provisionalOverlay
    ? week
        .filter((d) => d <= date)
        .reduce(
          (n, d) =>
            n +
            pendingHeartPoints(
              review.rows.filter((r) => r.status === 'pending'),
              d,
            ),
          0,
        )
    : 0;
  const word = heartPointsQuietText(hp?.week ?? null, week.filter((d) => d <= date).length);
  const info = withRemoveFoot(
    {
      title: HEART_POINTS_LABEL,
      body: quiet
        ? 'Heart Points follow Google Fit’s published rule, counted from heart rate, steps or the activity’s effort. Detected activities add points once they are counted. No readings means unknown, not zero.'
        : 'Heart Points follow Google Fit’s published rule: one point a minute at moderate effort, two at hard effort, counted from heart rate, steps or the activity’s effort. The goal is 150 a week. Detected activities add points once counted. No readings means unknown, not zero.',
      source: { kind: 'estimate' as const },
      twin: !quiet ? (
        <ChartTwin
          data={{
            title: 'Heart Points table',
            caption: 'Estimated counted points; pending points are separate.',
            head: ['Figure', 'Points'],
            rows: [
              ['This week', hp?.week ?? 'Unknown'],
              [isToday ? 'Today' : 'That day', hp?.today ?? 'Unknown'],
              ['Not counted yet', pending],
            ],
            fileName: 'vitals-heart-points.csv',
          }}
        />
      ) : undefined,
    },
    onRemove,
    'Heart Points',
  );
  return (
    <GradientCard
      as="section"
      aria-label="Heart Points"
      domain="heart"
      size={size}
      head={<CardHead icon={Heart} title="Heart Points" info={info} />}
      foot={
        <CardFoot
          state={{ word }}
          right={
            !quiet && hp?.today !== null && hp?.today !== undefined
              ? `${formatNumber(hp.today, 0)} ${isToday ? 'today' : 'that day'}`
              : undefined
          }
        />
      }
    >
      <HeroNumber
        value={hp?.week ?? null}
        size={size === 'card' ? 'num-l' : 'num'}
        label={quiet ? `Heart Points: ${word}` : `${hp?.week ?? 'Unknown'} Heart Points this week`}
        quietWord={quiet ? word : undefined}
      />
      {!quiet ? <MonoMeta>of {HEART_POINTS_GOAL} this week</MonoMeta> : null}
      {size === 'card' && days ? (
        <HighlightBars
          dates={days.map((d) => d.date)}
          values={days.map((d) => d.heartPoints)}
          name="Heart Points this week"
          hue="heart"
          quiet={quiet}
          height={60}
          twin={false}
        />
      ) : (
        <DottedTrack
          label={HEART_POINTS_LABEL}
          value={hp?.week ?? null}
          goal={HEART_POINTS_GOAL}
          valueText=""
          quiet={quiet}
          quietWord={word}
          twin={false}
        />
      )}
      {pending > 0 ? (
        <MonoMeta>{quiet ? 'Some not counted yet' : C.heartPointsPending(formatNumber(pending, 0))}</MonoMeta>
      ) : null}
    </GradientCard>
  );
}

export function ActivitiesContent({
  date,
  isToday,
  quiet,
  review,
  onOpenRow,
  nowMs,
  size = 'card',
  onRemove,
  record,
  log,
}: ActivityCardInput) {
  const data = useActivityData();
  const live = data.useLiveDetections?.() ?? [];
  const unit = useEnergyUnit();
  const lines = isToday
    ? live.flatMap((d) => {
        const text = liveLineText(d, nowMs, quiet, LIVE_DETECTION_STALE_MS);
        return text ? [{ id: d.id, text }] : [];
      })
    : [];
  const rows = [...review.rows, ...review.decided]
    .filter((r) => r.date === date && !(r.status === 'rejected' && r.sources.length === 0))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const title = isToday ? C.activities : FACE_WORDS.activitiesOfDay;
  const info = withRemoveFoot(
    {
      title,
      body: 'Activities your ring, your phone or you recorded. A detected one reads “detected, not counted yet” until it counts. A counted one adds its energy to Energy and its points to Heart Points. An activity’s energy is its whole burn, the resting part included.',
      source: { kind: 'logged' as const },
    },
    onRemove,
    title,
  );
  return (
    <GradientCard
      as="section"
      aria-label={title}
      domain="steps"
      size={size}
      head={<CardHead icon={Activity} title={title} info={info} />}
      foot={
        record?.can || log?.can ? (
          <CardFoot>
            {log?.can ? (
              <Key variant="text" icon={Plus} onClick={log.open}>
                {FACE_WORDS.logActivity}
              </Key>
            ) : null}
            {record?.can ? (
              <Key variant="primary" icon={Circle} onClick={record.open}>
                {C.record}
              </Key>
            ) : null}
          </CardFoot>
        ) : undefined
      }
    >
      {lines.map((l) => (
        <p key={l.id} className="lv-act__live lm-meta" role="status">
          <span className="lv-act__live-dot" aria-hidden="true" />
          {l.text}
        </p>
      ))}
      {!rows.length && !lines.length ? (
        <MonoMeta>{isToday ? C.noActivities : FACE_WORDS.noActivitiesOfDay}</MonoMeta>
      ) : null}
      {rows.length ? (
        <ul className="lv-act__list">
          {rows.map((r) => {
            const word = activityRowWord(r, {
              pending: C.statusWord.pending,
              byHand: C.byHand,
              updated: FACE_WORDS.updated,
              status: C.statusWord,
            });
            const name = rowName(r);
            return (
              <li
                key={r.id}
                data-status={r.status}
                data-updated={r.updated || undefined}
                data-detected={r.detection ? '' : undefined}
              >
                <button
                  type="button"
                  className="lv-act__row lv-activity-card__row"
                  aria-label={`${name}, ${reviewRowTimeText(r, quiet)}, ${word}`}
                  disabled={r.status === 'rejected'}
                  onClick={() => onOpenRow(r)}
                >
                  <span className="lv-act__mark" aria-hidden="true" />
                  <span className="lv-act__what">
                    <span className="lv-act__name">{name}</span>
                    <span className="lv-activity-card__facts">
                      {reviewRowTimeText(r, quiet)}
                      {!quiet && r.minutes > 0 ? ` · ${shortFacts(r, false, unit)[0]}` : ''}
                    </span>
                    <MonoMeta>{word}</MonoMeta>
                  </span>
                  {!quiet && r.kcal ? (
                    <span className="lv-activity-card__value">
                      ~{energyText(r.kcal.value, unit)}
                      <MonoMeta>{unit}</MonoMeta>
                      {r.heartPoints !== null && r.heartPoints > 0 ? (
                        <MonoMeta>{formatNumber(r.heartPoints, 0)} HP</MonoMeta>
                      ) : null}
                    </span>
                  ) : null}
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <PossibleLine
        rows={review.possible.filter((r) => r.date === date)}
        quiet={quiet}
        onOpenRow={onOpenRow}
      />
    </GradientCard>
  );
}
