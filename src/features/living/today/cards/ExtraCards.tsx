/** Optional Today cards. These adapters read the owning feature's models; no estimate or score is recomputed here. */
import type { ReactNode } from 'react';
import {
  Activity,
  CalendarDays,
  CircleHelp,
  Dumbbell,
  Flame,
  Gauge,
  HeartPulse,
  Hourglass,
  Moon,
  ShoppingBasket,
  Target,
  Thermometer,
  Waves,
} from 'lucide-react';
import {
  CardFoot,
  CardHead,
  DottedTrack,
  GlowLine,
  GradientCard,
  HeroNumber,
  HighlightBars,
  MonoMeta,
  RangeScale,
  WindowBar,
  formatEnergy,
  formatNumber,
  toEnergyUnit,
  type CardSize,
  type Domain,
  type IconComponent,
  type InfoSpec,
} from '@/components';
import { addDays, daysBetween } from '@/living/dates';
import { useSettingsStore } from '@/state/settingsStore';
import { StressHistory } from '@/features/ring/components/StressHistory';
import { useRingDay } from '@/features/ring/day';
import { useSleep, useSeries } from '@/features/ring/data';
import type { GaugeRawPoint } from '@/features/ring/types';
import {
  BANDS,
  deltaToDisplay,
  elevatedMinutes,
  hrvUsualMs,
  minutesText,
  statusOf,
  stressSegments,
  tempDelta,
  toDisplay,
} from '@/features/ring/model';
import { entryValue, personal } from '@/features/ring/monitor/values';
import { useLiving } from '../../data/source';
import { fmtClock, weekOf } from '../../format';
import { livingPaths } from '../../paths';
import { useGroceryList } from '../../food/groceries';
import { energyBalance, energyRows } from '../../progress/activityModel';
import { useProgressActuals } from '../../progress/sections/HeartPointsSection';
import { goalDateLine } from '../model';
import { withRemoveFoot } from './RemoveFromToday';
import type { TodayCardCtx, TodayCardProps } from './types';
import './extra-cards.css';

export interface ExtraTodayCardDef {
  id: string;
  title: string;
  icon: IconComponent;
  domain: Domain;
  group: string;
  description: string;
  sizes: CardSize[];
  defaultSize: CardSize;
  presence: 'library';
  available(ctx: TodayCardCtx): { ok: true } | { ok: false; reason: string };
  render(ctx: TodayCardCtx, size: CardSize, onRemove?: () => void): ReactNode;
}
const yes = { ok: true } as const;
const needsPlan = (c: TodayCardCtx) => (c.plan ? yes : { ok: false as const, reason: 'Needs a plan' });
const needsRing = (c: TodayCardCtx) =>
  c.ring === 'ready' ? yes : { ok: false as const, reason: 'Needs ring data' };
const energyAvailable = (c: TodayCardCtx) =>
  c.quiet ? { ok: false as const, reason: 'Hidden in quiet mode' } : needsPlan(c);
const qWord = (word: string | undefined, fallback: string) => (word && !/\d/.test(word) ? word : fallback);
function Shell({
  size,
  onRemove,
  title,
  icon,
  domain,
  href,
  info,
  state,
  children,
}: TodayCardProps & {
  title: string;
  icon: IconComponent;
  domain: Domain;
  href: string;
  info: InfoSpec;
  state?: string;
  children: ReactNode;
}) {
  return (
    <GradientCard
      as="section"
      domain={domain}
      size={size}
      href={href}
      openLabel={`Open ${title}`}
      className="lv-extra-card"
      head={<CardHead as="h2" icon={icon} title={title} info={withRemoveFoot(info, onRemove, title)} />}
      foot={state ? <CardFoot state={{ word: state }} /> : undefined}
    >
      {children}
    </GradientCard>
  );
}
function PlanDayCard(p: TodayCardProps) {
  const { ctx: c } = p;
  if (!c.plan) return null;
  const of = Math.max(1, daysBetween(c.plan.startDate, c.plan.plannedEndDate));
  const day = Math.max(0, Math.min(of, daysBetween(c.plan.startDate, c.date) + 1));
  return (
    <Shell
      {...p}
      title="Plan day"
      icon={CalendarDays}
      domain="plan"
      href={livingPaths.planActive}
      info={{
        body: 'Your place in the current plan. Pauses and plan versions stay in the plan history. Open the plan to see its start, end and adopted changes.',
        source: { kind: 'plan' },
      }}
    >
      <HeroNumber
        size="num"
        value={day}
        unit="day"
        label={c.quiet ? 'Your plan is in progress' : `Day ${day} of ${of}`}
        {...(c.quiet ? { quietWord: 'In progress' } : {})}
      />
      <DottedTrack
        label="Plan day"
        value={day}
        goal={of}
        valueText={`Day ${day}`}
        goalText={`of ${of}`}
        quiet={c.quiet}
        quietWord="In progress"
        twin={false}
      />
    </Shell>
  );
}
function PlanScoreCard(p: TodayCardProps) {
  const { ctx: c } = p;
  const score = c.view?.adherence.a7 ?? null;
  return (
    <Shell
      {...p}
      title="Plan score"
      icon={Gauge}
      domain="plan"
      href={livingPaths.progress('adherence')}
      info={{
        body: 'The plan score reads the logged parts of your plan over the last week. A missing record is unknown. The Progress page shows which parts have records and how each part contributes.',
        source: { kind: 'logged' },
      }}
      state={score === null ? 'Not enough logged yet' : 'Last week'}
    >
      <HeroNumber
        value={score}
        unit="%"
        size="num"
        label={
          c.quiet
            ? 'How your plan is going'
            : score === null
              ? 'Plan score unknown'
              : `Plan score ${formatNumber(score)} percent`
        }
        {...(c.quiet ? { quietWord: score === null ? 'Learning' : 'As logged' } : {})}
      />
      <DottedTrack
        label="Plan score"
        value={score}
        goal={100}
        valueText={score === null ? 'Unknown' : `${formatNumber(score)}%`}
        quiet={c.quiet}
        quietWord="As logged"
        twin={false}
      />
    </Shell>
  );
}
function TrainingWeekCard(p: TodayCardProps) {
  const c = p.ctx;
  const days = weekOf(c.date);
  const views = useLiving((s) => days.map((d) => s.today(d)), [days[0], days[6]]);
  const values = views.map((v) => v?.prescription?.sessions.length ?? null);
  const total = values.reduce<number>((s, n) => s + (n ?? 0), 0);
  return (
    <Shell
      {...p}
      title="Training week"
      icon={CalendarDays}
      domain="steps"
      href={livingPaths.train(c.date)}
      info={{
        body: 'Sessions prescribed for each day of this week. A missing day stays a gap. Open Train for the exercises, their sets and the status of each session.',
        source: { kind: 'plan' },
      }}
    >
      <HeroNumber
        value={total}
        unit="sessions"
        size="num"
        label={c.quiet ? 'Your training week' : `${total} sessions planned this week`}
        {...(c.quiet ? { quietWord: total ? 'Training planned' : 'Rest week' } : {})}
      />
      <HighlightBars
        name="Planned sessions this week"
        dates={days}
        values={values}
        highlight={days.indexOf(c.today)}
        quiet={c.quiet}
        hue="steps"
        height={64}
        twin={false}
      />
    </Shell>
  );
}
function SessionCard(p: TodayCardProps) {
  const c = p.ctx;
  const sessions = c.view?.prescription?.sessions ?? [];
  const minutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  return (
    <Shell
      {...p}
      title="Today's session"
      icon={Dumbbell}
      domain="steps"
      href={livingPaths.train(c.date, 'session')}
      info={{
        body: 'The sessions prescribed for this day, after the plan’s safety checks. Open Train to see the exercises and log what you did. Planned duration is a target, not a recording.',
        source: { kind: 'plan' },
      }}
      state="Planned"
    >
      <HeroNumber
        value={minutes}
        unit="min"
        size="num"
        label={c.quiet ? 'Training planned' : `${minutes} minutes planned`}
        {...(c.quiet ? { quietWord: 'Training planned' } : {})}
      />
      <ul className="lv-extra-list">
        {sessions.map((s) => (
          <li key={s.slotKey}>
            <span>{s.kind === 'resistance' ? 'Lift' : 'Cardio'}</span>
            <MonoMeta>{fmtClock(s.startH)}</MonoMeta>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
function FastCard(p: TodayCardProps) {
  const c = p.ctx;
  const fast = c.view?.logged.fast;
  const goal = c.view?.prescription?.fast?.hours ?? null;
  const elapsed = fast?.sinceH ?? null;
  const state =
    fast?.state === 'running'
      ? 'Running'
      : fast?.state === 'broken'
        ? 'Ended early'
        : fast?.state === 'done'
          ? 'Ended'
          : 'Planned';
  return (
    <Shell
      {...p}
      title="Fast"
      icon={Hourglass}
      domain="energy"
      href={livingPaths.food(c.date)}
      info={{
        body: 'The fast in your plan and the time you logged for it. A running fast shows observed elapsed time; the remaining time is the plan’s continuation. Ending a fast records your chosen time.',
        source: { kind: 'logged' },
      }}
      state={state}
    >
      <HeroNumber
        value={elapsed}
        unit="h"
        decimals={1}
        size="num"
        label={c.quiet ? state : elapsed === null ? 'Fast not started' : `${elapsed} hours fasted`}
        {...(c.quiet ? { quietWord: state } : {})}
      />
      <DottedTrack
        label="Fast"
        value={elapsed}
        goal={goal}
        valueText={elapsed === null ? 'Not started' : minutesText(elapsed * 60)}
        goalText={goal === null ? undefined : `Planned ${minutesText(goal * 60)}`}
        quiet={c.quiet}
        quietWord={state}
        hue="energy"
        twin={false}
      />
    </Shell>
  );
}
function EnergyBalanceCard(p: TodayCardProps) {
  const c = p.ctx;
  const from = addDays(c.date, -11);
  const actuals = useProgressActuals(from, c.date);
  const rows = energyRows(actuals ?? [], from, c.date);
  const balance = energyBalance(rows);
  const val = balance ? balance.intakeMean - balance.outMean : null;
  if (c.quiet) return null;
  const range = balance
    ? `${formatEnergy(balance.balanceLo, c.eu)}–${formatEnergy(balance.balanceHi, c.eu)}`
    : undefined;
  return (
    <Shell
      {...p}
      title="Energy balance, 12 days"
      icon={Flame}
      domain="energy"
      href={livingPaths.progress()}
      info={{
        body: 'Daily intake minus estimated energy burned. Only days with both a fully logged intake and an expenditure estimate contribute to the average. Gaps remain unknown; the plan never fills them.',
        source: { kind: 'estimate' },
        range: 'The displayed range follows the expenditure model’s scenario range.',
      }}
      state={balance ? 'Daily average' : 'Needs complete days'}
    >
      <HeroNumber
        value={val === null ? null : toEnergyUnit(val, c.eu)}
        unit={c.eu}
        range={range}
        size="num"
        label={
          val === null
            ? 'Energy balance not yet available'
            : `Average energy balance ${formatEnergy(val, c.eu)}${range ? `, range ${range}` : ''}`
        }
      />
      <GlowLine
        label="Daily energy balance"
        unit={c.eu}
        series={rows.map((r) =>
          r.intake === null || r.out === null ? null : toEnergyUnit(r.intake - r.out, c.eu),
        )}
        band={{
          lo: rows.map((r) =>
            r.intake === null || r.outHi === null ? null : toEnergyUnit(r.intake - r.outHi, c.eu),
          ),
          hi: rows.map((r) =>
            r.intake === null || r.outLo === null ? null : toEnergyUnit(r.intake - r.outLo, c.eu),
          ),
        }}
        yTicks={0}
        xTicks="none"
        variant="spark"
        endDot="static"
        quiet={c.quiet}
        twin={false}
      />
    </Shell>
  );
}
const signalInfo: Record<'hr' | 'hrv' | 'stress' | 'temp', string> = {
  hr: 'The ring’s latest heart-rate reading for this day. Readings can change with movement, posture and fit. This is not your waking resting heart rate and is not a diagnosis.',
  hrv: 'Heart-rate variability from the main sleep session, compared with your own overnight baseline once enough nights are available. A daytime reading is never used as a stand-in for an overnight value.',
  stress:
    'The ring’s latest stress index. This is the device’s own unvalidated index, not a medical measurement or a percentage. Open Ring to see readings through the day.',
  temp: 'Overnight skin temperature minus your usual night’s median, in your chosen unit. It needs enough overnight recordings to learn your baseline. This is skin temperature, not core body temperature or a fever reading.',
};
function SignalCard(
  p: TodayCardProps & {
    kind: 'hr' | 'hrv' | 'stress' | 'temp';
    title: string;
    icon: IconComponent;
    domain: Domain;
  },
) {
  const { ctx: c, kind, title, icon, domain } = p;
  const d = useRingDay(c.date);
  const units = useSettingsStore((s) => s.units);
  const prefs = { units };
  const v = entryValue(kind, { ...d, zones: null, prefs, now: c.nowMs });
  const raw = v.reading;
  const status = raw === null ? null : (v.chip ?? statusOf(kind, raw, personal(d.baselines)));
  const tempDifference = kind === 'temp' && raw !== null ? tempDelta(raw, personal(d.baselines)) : null;
  const display =
    kind === 'temp'
      ? tempDifference === null
        ? null
        : deltaToDisplay('temp', tempDifference, prefs)
      : raw === null
        ? null
        : toDisplay(kind, raw, prefs);
  const usual = kind === 'hrv' ? hrvUsualMs(personal(d.baselines)) : null;
  const hrvBase = d.baselines?.hrvBaseline;
  const usualRange: readonly [number, number] | undefined =
    kind === 'hrv' && hrvBase && !v.calibrating
      ? [Math.exp(hrvBase.median - hrvBase.s), Math.exp(hrvBase.median + hrvBase.s)]
      : kind === 'temp' && !v.calibrating
        ? [deltaToDisplay('temp', -0.5, prefs), deltaToDisplay('temp', 0.5, prefs)]
        : undefined;
  const bounds: Record<typeof kind, [number, number]> = {
    hr: [40, 180],
    hrv: [0, Math.max(100, (usual ?? 50) * 2, display ?? 0)],
    stress: [0, 100],
    temp: units === 'imperial' ? [-3.6, 3.6] : [-2, 2],
  };
  return (
    <Shell
      {...p}
      title={title}
      icon={icon}
      domain={domain}
      href={`/ring/signals/${kind}?date=${c.date}`}
      info={{
        body: signalInfo[kind],
        source: { kind: 'ring' },
        range:
          kind === 'hrv'
            ? 'Your usual value is learned from overnight recordings.'
            : kind === 'temp'
              ? 'Compared with your personal overnight baseline.'
              : 'The scale uses the Ring page’s named bands.',
      }}
      state={v.calibrating ? 'Calibrating' : qWord(status?.word, raw === null ? 'No reading' : 'Recorded')}
    >
      <HeroNumber
        value={display}
        unit={v.unit ?? undefined}
        decimals={kind === 'temp' ? 1 : 0}
        {...(kind === 'temp' ? { format: (n: number) => `${n > 0 ? '+' : ''}${formatNumber(n, 1)}` } : {})}
        size="num"
        label={
          c.quiet
            ? qWord(status?.word, 'Recorded')
            : raw === null
              ? `No ${title.toLowerCase()} reading`
              : `${title}${kind === 'temp' ? ' difference from usual' : ''} ${display === null ? 'unavailable' : formatNumber(display, kind === 'temp' ? 1 : 0)} ${v.unit ?? ''}`
        }
        {...(c.quiet ? { quietWord: qWord(status?.word, raw === null ? 'No reading' : 'Recorded') } : {})}
      />
      <RangeScale
        label={title}
        value={display}
        min={bounds[kind][0]}
        max={bounds[kind][1]}
        bands={BANDS[kind]}
        {...(usualRange ? { usual: usualRange } : {})}
        unit={v.unit ?? undefined}
        quiet={c.quiet}
        state={v.calibrating ? 'calibrating' : display === null ? 'none' : 'normal'}
        twin={false}
      />
      {kind === 'hr' ? <HeartRateTrace ctx={c} /> : kind === 'hrv' ? <HrvHistory ctx={c} /> : null}
    </Shell>
  );
}
function HeartRateTrace({ ctx: c }: { ctx: TodayCardCtx }) {
  const q = useSeries('hr', c.date, c.date, 'raw');
  const points = (q.data?.points ?? [])
    .filter((p): p is GaugeRawPoint => 'at' in p)
    .map((p) => ({ t: Date.parse(p.at), v: p.value ?? null }));
  return (
    <GlowLine
      label="Heart rate through the day"
      series={points}
      unit="bpm"
      variant="spark"
      yTicks={0}
      xTicks="none"
      quiet={c.quiet}
      endDot={c.isToday ? 'pulse' : 'static'}
      twin={false}
    />
  );
}
function HrvHistory({ ctx: c }: { ctx: TodayCardCtx }) {
  const from = addDays(c.date, -13);
  const q = useSleep(from, c.date);
  const dates = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const values = dates.map((date) => {
    const sessions = q.data?.sessions.filter((s) => s.wakingDate === date) ?? [];
    return sessions.length
      ? (sessions.reduce((a, b) => (a.asleepMinutes >= b.asleepMinutes ? a : b)).metrics?.hrvNightlyMs ??
          null)
      : null;
  });
  return (
    <HighlightBars
      name="Overnight HRV across recent nights"
      dates={dates}
      values={values}
      unit="ms"
      height={38}
      variant="spark"
      hue="recovery"
      quiet={c.quiet}
      twin={false}
    />
  );
}
function StressCard(p: TodayCardProps) {
  const c = p.ctx;
  const q = useSeries('stress', c.date, c.date, 'raw');
  const from = new Date(`${c.date}T00:00:00`).getTime();
  const end = c.isToday ? Math.min(from + 86400000, c.nowMs) : from + 86400000;
  const points = (q.data?.points ?? [])
    .filter((p): p is GaugeRawPoint => 'at' in p && p.value !== null)
    .map((p) => ({ t: Date.parse(p.at), v: p.value! }));
  const segments = stressSegments(points, from, end);
  const minutes = segments.length ? elevatedMinutes(segments) : null;
  const word = minutes === null ? 'No readings' : minutes > 0 ? 'Some elevated' : 'Calm in covered time';
  return (
    <Shell
      {...p}
      title="Stress today"
      icon={Activity}
      domain="recovery"
      href={`/ring/signals/stress?date=${c.date}`}
      info={{
        body: 'Estimated time in the Elevated or High bands of the ring’s own unvalidated stress index. Estimated coverage follows each sample until the next reading, capped at one and a half times the day’s typical sample gap. Unsupported time stays unknown; the index is not a clinical measurement or a percentage.',
        source: { kind: 'ring' },
      }}
      state={q.data?.truncated ? 'Partial recording' : word}
    >
      <HeroNumber
        value={minutes === null ? null : minutesText(minutes)}
        unit="elevated"
        size="num"
        label={
          c.quiet
            ? word
            : minutes === null
              ? 'No stress readings'
              : `${minutesText(minutes)} elevated or high in estimated covered time`
        }
        {...(c.quiet ? { quietWord: word } : {})}
      />
      <StressHistory
        points={points}
        from={from}
        to={from + 86400000}
        now={c.isToday ? c.nowMs : null}
        quiet={c.quiet}
      />
    </Shell>
  );
}
function DayScoreCard(p: TodayCardProps) {
  const c = p.ctx;
  const d = useRingDay(c.date);
  const score = d.scores?.day.value ?? null;
  const source = d.scores?.source === 'legacy' ? 'On-device scores' : 'Vitals experimental';
  return (
    <Shell
      {...p}
      title="Day score"
      icon={Gauge}
      domain="recovery"
      href={`/ring/scores?date=${c.date}`}
      info={{
        body: 'An experimental wellness index combining the available sleep, recovery and activity parts. Missing parts remain missing. The score is not a diagnosis, fitness test or measure of your worth.',
        source: { kind: 'engine', words: source },
      }}
      state={source}
    >
      <HeroNumber
        value={score}
        unit="/ 100"
        size="num"
        label={
          c.quiet ? 'Your day score' : score === null ? 'Day score unavailable' : `Day score ${score} of 100`
        }
        {...(c.quiet ? { quietWord: score === null ? 'Learning' : 'Day recorded' } : {})}
      />
      <DottedTrack
        label="Day score"
        value={score}
        goal={100}
        valueText={score === null ? 'Unknown' : String(Math.round(score))}
        quiet={c.quiet}
        quietWord="Day recorded"
        twin={false}
      />
    </Shell>
  );
}
function SleepTimingCard(p: TodayCardProps) {
  const c = p.ctx;
  const night = useRingDay(c.date).night;
  const onset = night?.onset ?? null;
  const wake = night?.wake ?? null;
  const from = new Date(`${addDays(c.date, -1)}T18:00:00`).getTime();
  return (
    <Shell
      {...p}
      title="Last night's timing"
      icon={Moon}
      domain="sleep"
      href={`/sleep?date=${c.date}`}
      info={{
        body: 'The main sleep session ending on this day. Fell asleep and woke are the ring’s observed sleep window, not the time you got into or out of bed. Missing endpoints stay unknown.',
        source: { kind: 'ring' },
      }}
      state={night ? 'Recorded' : 'No night yet'}
    >
      <HeroNumber
        value={
          onset === null
            ? null
            : new Date(onset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        }
        size="time"
        label={
          c.quiet
            ? 'Last night’s sleep timing'
            : onset === null
              ? 'Sleep onset unknown'
              : `Fell asleep ${new Date(onset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
        }
        {...(c.quiet ? { quietWord: 'Last night' } : {})}
      />
      {!c.quiet && wake !== null ? (
        <MonoMeta>
          Woke {new Date(wake).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
        </MonoMeta>
      ) : null}
      <WindowBar
        label="Sleep timing"
        axis={[from, from + 18 * 3600000]}
        {...(onset !== null && wake !== null ? { actual: { from: onset, to: wake } } : {})}
        quiet={c.quiet}
        twin={false}
      />
    </Shell>
  );
}
function SleepHrCard(p: TodayCardProps) {
  const c = p.ctx;
  const night = useRingDay(c.date).night;
  const low = night?.hr.low?.v ?? null;
  return (
    <Shell
      {...p}
      title="Sleep heart rate"
      icon={HeartPulse}
      domain="heart"
      href={`/sleep?date=${c.date}`}
      info={{
        body: 'Heart rate during the main sleep session. The low is a sleeping value, never a waking resting-heart-rate measurement. Gaps remain gaps and sparse recordings do not produce a low.',
        source: { kind: 'ring' },
      }}
      state={night?.hr.sparse ? 'Few readings' : qWord(night?.hr.trend?.word, 'Overnight')}
    >
      <HeroNumber
        value={low}
        unit="bpm"
        size="num"
        label={
          c.quiet
            ? 'Overnight heart rate'
            : low === null
              ? 'No sleeping low heart rate'
              : `Sleeping low heart rate ${Math.round(low)} beats per minute`
        }
        {...(c.quiet ? { quietWord: 'Overnight' } : {})}
      />
      <GlowLine
        label="Sleep heart rate"
        series={night?.hr.points ?? []}
        unit="bpm"
        yTicks={0}
        xTicks="none"
        endDot="static"
        quiet={c.quiet}
        twin={false}
      />
    </Shell>
  );
}
/** Main sleep per waking date; gaps never become zero and an incomplete night keeps both bounds. */
export function sleepHistoryData(
  dates: readonly string[],
  sessions: ReadonlyArray<{
    wakingDate: string;
    asleepMinutes: number;
    metrics?: { tstLowerMin: number; tstUpperMin: number; incomplete?: boolean };
  }>,
) {
  const nights = dates.map((date) => {
    const found = sessions.filter((s) => s.wakingDate === date);
    return found.length ? found.reduce((a, b) => (a.asleepMinutes >= b.asleepMinutes ? a : b)) : null;
  });
  const values = nights.map((s) => (s ? (s.metrics?.tstLowerMin ?? s.asleepMinutes) : null));
  const upper = nights.map((s) => (s ? (s.metrics?.tstUpperMin ?? s.asleepMinutes) : null));
  const known = values.filter((v): v is number => v !== null);
  const high = upper.filter((v): v is number => v !== null);
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const averageUpper = high.length ? high.reduce((a, b) => a + b, 0) / high.length : null;
  return {
    values,
    average,
    averageUpper,
    nights: known.length,
    outline: nights.map((s) => s?.metrics?.incomplete === true),
  };
}
function SleepHistoryCard(p: TodayCardProps) {
  const c = p.ctx;
  const from = addDays(c.date, -27);
  const q = useSleep(from, c.date);
  const dates = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const history = sleepHistoryData(dates, q.data?.sessions ?? []);
  const avg = history.average;
  const title = c.quiet ? 'Recent sleep' : 'Sleep, 4 weeks';
  const range =
    avg !== null && history.averageUpper !== null && history.averageUpper > avg
      ? `Recorded ${minutesText(avg)}–${minutesText(history.averageUpper)}`
      : undefined;
  return (
    <Shell
      {...p}
      title={title}
      icon={Moon}
      domain="sleep"
      href={`/sleep?period=month&date=${c.date}`}
      info={{
        body: 'The main sleep session on each recorded night in the last four weeks. Missing nights stay as gaps. The average includes recorded nights only; an incomplete night retains its observed bounds.',
        source: { kind: 'ring' },
      }}
      state={history.nights ? 'Recorded nights' : 'No nights yet'}
    >
      <HeroNumber
        value={avg === null ? null : minutesText(avg)}
        range={range}
        size="num"
        label={
          c.quiet
            ? 'Sleep over recent weeks'
            : avg === null
              ? 'No sleep history'
              : `Average sleep ${minutesText(avg)}${range ? `, ${range}` : ''}`
        }
        {...(c.quiet ? { quietWord: 'Recent nights' } : {})}
      />
      <HighlightBars
        name="Sleep over recent weeks"
        dates={dates}
        values={history.values}
        average={avg ?? undefined}
        format={minutesText}
        height={70}
        hue="sleep"
        quiet={c.quiet}
        outline={history.outline}
        twin={false}
      />
    </Shell>
  );
}
function GroceriesCard(p: TodayCardProps) {
  const c = p.ctx;
  const list = useGroceryList(c.plan?.id ?? null, c.date, addDays(c.date, 6));
  const items = list.groups.flatMap((g) => g.items);
  const left = items.filter((i) => !i.bought && !i.have);
  return (
    <Shell
      {...p}
      title="Groceries"
      icon={ShoppingBasket}
      domain="food"
      href={livingPaths.food(c.date, 'groceries')}
      info={{
        body: 'Ingredients from the accepted recipes over the coming week. Items marked bought or already at home are covered. Open Food to change the horizon, tick your list or share it.',
        source: { kind: 'plan' },
      }}
      state={list.count === 0 ? 'Plan meals to build your list' : left.length ? 'To buy' : 'Covered'}
    >
      <HeroNumber
        value={left.length}
        unit="to buy"
        size="num"
        label={c.quiet ? 'Your grocery list' : `${left.length} grocery items to buy`}
        {...(c.quiet ? { quietWord: left.length ? 'A few things to buy' : 'Covered' } : {})}
      />
      {left.length ? (
        <MonoMeta>
          {left
            .slice(0, 3)
            .map((i) => i.name)
            .join(' · ')}
        </MonoMeta>
      ) : null}
    </Shell>
  );
}
function GoalCard(p: TodayCardProps) {
  const c = p.ctx;
  const goal = c.view ? goalDateLine(c.view) : null;
  return (
    <Shell
      {...p}
      title="Goal"
      icon={Target}
      domain="body"
      href={livingPaths.progress('goals')}
      info={{
        body: 'The goal-date range from your current plan projection, updated by the recorded trend and adherence. It is a forecast, not a deadline or promise. Open Progress to see the range and what moved it.',
        source: { kind: 'estimate' },
      }}
      state={c.view?.drift?.[0]?.state ?? 'Learning'}
    >
      <p className="lv-extra-card__forecast">{c.quiet ? 'Your forecast' : (goal?.range ?? 'Learning')}</p>
    </Shell>
  );
}
function WhyCard(p: TodayCardProps) {
  return (
    <Shell
      {...p}
      title="Why it works"
      icon={CircleHelp}
      domain="plan"
      href="/evidence"
      info={{
        body: 'The Evidence library explains the mechanisms and assumptions behind the plan, with sources and evidence grades. Estimates keep their uncertainty; a model’s prediction is not a promise about an individual outcome.',
        source: { kind: 'engine' },
      }}
    >
      <span className="lv-extra-card__reading">The model behind your plan</span>
    </Shell>
  );
}
function def(
  id: string,
  title: string,
  icon: IconComponent,
  domain: Domain,
  description: string,
  size: CardSize,
  component: (p: TodayCardProps) => ReactNode,
  available: ExtraTodayCardDef['available'] = needsPlan,
): ExtraTodayCardDef {
  return {
    id,
    title,
    icon,
    domain,
    group: domain === 'steps' ? 'Move' : domain[0]!.toUpperCase() + domain.slice(1),
    description,
    sizes: size === 'slim' ? [size] : size === 'tile' ? ['tile', 'card', 'wide'] : ['card', 'wide'],
    defaultSize: size,
    presence: 'library',
    available,
    render: (ctx, size, onRemove) => component({ ctx, size, onRemove }),
  };
}
export const extraTodayCards: ExtraTodayCardDef[] = [
  def('plan-day', 'Plan day', CalendarDays, 'plan', 'Your place in the plan', 'slim', (p) => (
    <PlanDayCard {...p} />
  )),
  def(
    'plan-score',
    'Plan score',
    Gauge,
    'plan',
    'How the past week went',
    'tile',
    (p) => <PlanScoreCard {...p} />,
    (c) => (c.isToday ? needsPlan(c) : { ok: false, reason: 'Available on today' }),
  ),
  def('week', 'Training week', CalendarDays, 'steps', 'Sessions across this week', 'card', (p) => (
    <TrainingWeekCard {...p} />
  )),
  def(
    'session',
    "Today's session",
    Dumbbell,
    'steps',
    'The session planned for this day',
    'card',
    (p) => <SessionCard {...p} />,
    (c) => (c.view?.prescription?.sessions.length ? yes : { ok: false, reason: 'Needs a planned session' }),
  ),
  def(
    'fast',
    'Fast',
    Hourglass,
    'energy',
    'Elapsed time against your planned fast',
    'tile',
    (p) => <FastCard {...p} />,
    (c) => (c.view?.prescription?.fast ? yes : { ok: false, reason: 'Needs a planned fast' }),
  ),
  def(
    'energy-balance',
    'Energy balance, 12 days',
    Flame,
    'energy',
    'Intake against estimated energy burned',
    'card',
    (p) => <EnergyBalanceCard {...p} />,
    energyAvailable,
  ),
  def(
    'heart-rate',
    'Heart rate',
    HeartPulse,
    'heart',
    'The latest ring heart rate',
    'tile',
    (p) => <SignalCard {...p} kind="hr" title="Heart rate" icon={HeartPulse} domain="heart" />,
    needsRing,
  ),
  def(
    'hrv',
    'HRV vs usual',
    Waves,
    'recovery',
    'Overnight variability against your usual',
    'tile',
    (p) => <SignalCard {...p} kind="hrv" title="HRV vs usual" icon={Waves} domain="recovery" />,
    needsRing,
  ),
  def(
    'stress',
    'Stress today',
    Activity,
    'recovery',
    'Time elevated during the recorded day',
    'tile',
    (p) => <StressCard {...p} />,
    needsRing,
  ),
  def(
    'skin-temp',
    'Skin temperature',
    Thermometer,
    'recovery',
    'Overnight skin temperature against your usual',
    'tile',
    (p) => <SignalCard {...p} kind="temp" title="Skin temp" icon={Thermometer} domain="recovery" />,
    needsRing,
  ),
  def(
    'day-score',
    'Day score',
    Gauge,
    'recovery',
    'Sleep, recovery and activity together',
    'card',
    (p) => <DayScoreCard {...p} />,
    needsRing,
  ),
  def(
    'sleep-timing',
    "Last night's timing",
    Moon,
    'sleep',
    'When your main sleep happened',
    'card',
    (p) => <SleepTimingCard {...p} />,
    needsRing,
  ),
  def(
    'sleep-hr',
    'Sleep heart rate',
    HeartPulse,
    'heart',
    'Heart rate through your main sleep',
    'card',
    (p) => <SleepHrCard {...p} />,
    needsRing,
  ),
  def(
    'sleep-4w',
    'Sleep, 4 weeks',
    Moon,
    'sleep',
    'Recorded nights over four weeks',
    'card',
    (p) => <SleepHistoryCard {...p} />,
    needsRing,
  ),
  def('groceries', 'Groceries', ShoppingBasket, 'food', 'What remains on your shopping list', 'slim', (p) => (
    <GroceriesCard {...p} />
  )),
  def('goal', 'Goal', Target, 'body', 'The plan’s current goal-date forecast', 'slim', (p) => (
    <GoalCard {...p} />
  )),
  def('why', 'Why it works', CircleHelp, 'plan', 'Evidence and assumptions behind your plan', 'slim', (p) => (
    <WhyCard {...p} />
  )),
];
