/** Energy burned: one ledger, every day and period, with its components and disclosed scenario ranges. */
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronRight, Flame, Layers3, Activity, Clock3 } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GradientCard,
  GlowLine,
  toEnergyUnit,
  HeroNumber,
  HighlightBars,
  MonoMeta,
  StackBar,
  barsTwin,
  lineTwin,
  formatEnergy,
  formatEnergyRange,
  formatRange,
  durationText,
  type InfoSpec,
  type ShareBarRow,
} from '@/components';
import { Page } from '@/components';
import { TopBar } from '@/app/shell';
import type { LocalDate } from '@/living';
import { isLocalDate } from '@/living/dates';
import type { EnergyDay as LedgerDay, EnergyComponent } from '@/living/sensors/energyDay';
import type { Envelope } from '@/living/sensors/types';
import type { ReviewRow } from '@/living/activityCandidates';
import type { EnergyBasis } from '@/state/livingActivity';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { useActivity } from '@/features/ring/data';
import { Loading } from '@/features/ring/components/parts';
import { DateControl } from '../components/DateControl';
import { ALL_PERIODS, periodDays, periodFromSearch, periodSearch, periodWords, type Period } from '../period';
import { currentDay, useLivingClock } from '../clock';
import { useActivityData } from '../activity/data';
import { dayMarks } from '../activity/ActivityLane';
import { ActivitySheet } from '../activity/ActivitySheet';
import { energyText, partOfDayWords } from '../activity/model';
import { rangeOf } from '../activity/energyFigures';
import { EnergyKindChart, KindTable } from './EnergyKindChart';
import {
  COMPONENT_HUE,
  COMPONENT_INFO,
  COMPONENT_LABEL,
  COMPONENT_ORDER,
  ENERGY_PAGE_WORDS as W,
  KIND_HUE,
  KIND_LABEL,
  KIND_ORDER,
  activityRows,
  componentRange,
  componentsThrough,
  cumulativeSeries,
  emptyComponents,
  kindColumns,
  rowWhen,
  type DayActivityRow,
} from './model';
import { ENERGY_PATH, energyPaths } from './paths';
import { ComponentDays, ComponentDaysTable, type ComponentDay } from './ComponentDays';
import '../activity/activity.css';
import './energy.css';

const NO_ACTS = { approved: [], pending: [] } as const;
const EVIDENCE = [
  { to: '/evidence/02-integrated-daily-expenditure', label: 'Daily energy expenditure' },
  { to: '/evidence/02-resting-rate-equations', label: 'Resting rate equations' },
  { to: '/evidence/02-thermic-effect-of-food', label: 'Food digestion' },
];
type Unit = ReturnType<typeof useEnergyUnit>;
interface DayFigures {
  status: 'loading' | 'ready';
  day: LedgerDay | null;
  soFar: number | null;
  total: number | null;
  missing: 'profile' | null;
  basis: 'plan' | 'body' | null;
  energyBasis?: EnergyBasis;
}

export default function EnergyPage() {
  const { date: param } = useParams();
  const [search] = useSearchParams();
  const today = currentDay(useLivingClock()) as LocalDate;
  if (param !== undefined)
    return (
      <Navigate
        to={isLocalDate(param) && param < today ? energyPaths.day(param) : energyPaths.day()}
        replace
      />
    );
  return <EnergyScreen period={periodFromSearch(search, today, ALL_PERIODS, today)} today={today} />;
}

function EnergyScreen({ period, today }: { period: Period; today: LocalDate }) {
  const navigate = useNavigate();
  const quiet = useQuietMode().on;
  const words = periodWords(period, today);
  return (
    <>
      <TopBar title={W.title} documentTitle={`${W.title} · ${words.text}`} />
      <Page stack className="en-page">
        <DateControl
          value={period}
          today={today}
          max={today}
          periods={ALL_PERIODS}
          onChange={(p) => navigate(`${ENERGY_PATH}${periodSearch(p, today)}`, { replace: true })}
        />
        {period.kind === 'day' || (period.kind === 'range' && period.from === period.to) ? (
          <EnergyDay date={period.from} today={today} quiet={quiet} />
        ) : (
          <EnergyPeriod period={period} today={today} quiet={quiet} />
        )}
      </Page>
    </>
  );
}

function useDayFigures(date: string, isToday: boolean): DayFigures {
  const data = useActivityData();
  const live = data.useToday(date, isToday);
  const past = data.useDayEnergy?.(date) ?? null;
  if (isToday)
    return {
      status: live ? 'ready' : 'loading',
      day: live?.day ?? null,
      soFar: live?.model.energy?.soFar ?? null,
      total: live?.model.energy?.byBedtime ?? null,
      missing: live?.model.energyMissing === 'profile' ? 'profile' : null,
      basis: live?.model.planless ? 'body' : 'plan',
      energyBasis: live?.energyBasis,
    };
  return {
    status: past?.status ?? 'ready',
    day: past?.day ?? null,
    soFar: past?.day?.total ?? null,
    total: past?.day?.total ?? null,
    missing: past?.missing ?? null,
    basis: past?.basis ?? null,
    energyBasis: past?.energyBasis,
  };
}

function EnergyDay({ date, today, quiet }: { date: LocalDate; today: LocalDate; quiet: boolean }) {
  const isToday = date === today;
  const unit = useEnergyUnit();
  const nowMs = useLivingClock().now().getTime();
  const fig = useDayFigures(date, isToday);
  const acts = useActivityData().useDayActivities?.(date) ?? NO_ACTS;
  const rows = useMemo(() => activityRows(acts, date), [acts, date]);
  const ring = useActivity(date, date);
  const ringKcal = ring.status === 'ready' ? (ring.data?.days[0]?.caloriesKcal ?? null) : null;
  if (quiet) return <QuietDay rows={rows} />;
  if (fig.status === 'loading') return <EnergyState loading />;
  if (fig.missing === 'profile') return <EnergyState profile />;
  if (!fig.day || fig.soFar === null) return <EnergyState />;
  const day = fig.day;
  const components = componentsThrough(day, isToday ? nowMs : Infinity);
  const total = fig.soFar;
  const envelope = rangeOf(total, day.envelope, day.total);
  const range = envelope ? { lo: envelope.lo, hi: envelope.hi } : null;
  const cols = kindColumns(day, isToday ? nowMs : Infinity);
  const cumulative = cumulativeSeries(day, isToday ? nowMs : Infinity);
  const line = {
    series: cumulative.series.map((p) => ({ ...p, v: toEnergyUnit(p.v, unit) })),
    future: cumulative.future.map((p) => ({ ...p, v: toEnergyUnit(p.v, unit) })),
  };
  const allPoints = [...line.series, ...line.future];
  const band =
    day.total > 0
      ? {
          lo: allPoints.map((p) => (p.v * day.envelope.lo) / day.total),
          hi: allPoints.map((p) => (p.v * day.envelope.hi) / day.total),
        }
      : undefined;
  const from = day.bins15[0]?.start ?? 0;
  const marks = dayMarks(acts, from, from + cols.length * 900_000);
  const cumulativeTwin = lineTwin({
    label: 'Cumulative energy burned',
    ...line,
    unit,
    from,
    to: from + cols.length * 900_000,
  });
  cumulativeTwin.head.push('Likely range');
  cumulativeTwin.rows = cumulativeTwin.rows.map((r, i) => [
    ...r.map((cell) => (cell === 'Measured' ? 'Estimated' : cell)),
    band ? `${formatRange(band.lo[i]!, band.hi[i]!)} ${unit}` : 'Unavailable',
  ]);
  const info = energyInfo({ day, basis: fig.energyBasis, source: fig.basis, ringKcal, unit });
  return (
    <>
      <GradientCard
        as="section"
        domain="energy"
        size="hero"
        className="en-total"
        head={
          <CardHead
            as="h2"
            icon={Flame}
            title={W.burned}
            info={{
              ...info,
              twin: <ChartTwin data={cumulativeTwin} />,
            }}
          />
        }
        foot={
          <CardFoot
            state={{ word: isToday ? 'So far today' : 'Estimated' }}
            right={
              isToday && fig.total !== null
                ? `By bedtime ~${energyText(fig.total, unit)} ${unit}`
                : undefined
            }
          />
        }
      >
        <HeroNumber
          size="hero"
          value={total}
          format={(v) => energyText(v, unit)}
          unit={unit}
          range={
            range ? `Likely ${formatEnergyRange(range.lo, range.hi, unit, { withUnit: false })} ${unit}` : undefined
          }
          label={`${isToday ? W.soFar : W.burned} ${energyText(total, unit)} ${unit}${range ? `, likely ${energyText(range.lo, unit)} to ${energyText(range.hi, unit)}` : ''}`}
        />
        <GlowLine
          label="Cumulative energy burned"
          series={line.series}
          future={line.future}
          band={band}
          unit={unit}
          from={from}
          to={from + cols.length * 900_000}
          now={isToday ? nowMs : undefined}
          yTicks={0}
          height={140}
          endDot={isToday ? 'pulse' : 'static'}
        />
      </GradientCard>
      <Breakdown components={components} total={total} envelope={range} basis={fig.energyBasis} unit={unit} />
      <GradientCard
        as="section"
        domain="energy"
        size="hero"
        head={
          <CardHead
            as="h2"
            icon={Clock3}
            title={W.throughTheDay}
            info={{ ...info, twin: <KindTable cols={cols} unit={unit} /> }}
          />
        }
      >
        <EnergyKindChart cols={cols} marks={marks} nowMs={isToday ? nowMs : undefined} unit={unit} />
      </GradientCard>
      <ActivitiesCard rows={rows} date={date} unit={unit} />
    </>
  );
}

function EnergyPeriod({ period, today, quiet }: { period: Period; today: LocalDate; quiet: boolean }) {
  const unit = useEnergyUnit();
  const data = useActivityData();
  const now = useLivingClock().now().getTime();
  const dates = useMemo(() => periodDays(period, today), [period, today]);
  const past = data.useEnergyDays?.(dates) ?? null;
  const live = data.useToday(today, dates.includes(today));
  if (quiet) return <QuietDay rows={[]} />;
  if (!past || past.status === 'loading' || (dates.includes(today) && !live))
    return <EnergyState loading title={W.periodTitle} />;
  if (
    (past.missing === 'profile' || live?.model.energyMissing === 'profile') &&
    past.days.every((d) => d.kcal === null) &&
    !live?.model.energy
  )
    return <EnergyState profile title={W.periodTitle} />;
  const byDate = new Map(past.days.map((d) => [d.date, d]));
  const values = dates.map((d) =>
    d === today ? (live?.model.energy?.soFar ?? null) : (byDate.get(d)?.kcal ?? null),
  );
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!known.length) return <EnergyState title={W.periodTitle} text={W.noDays} />;
  const total = known.reduce((s, v) => s + v, 0);
  const complete = dates.flatMap((d, i) => (d !== today && values[i] !== null ? [values[i]!] : []));
  const average =
    (complete.length ? complete : known).reduce((s, v) => s + v, 0) / (complete.length || known.length);
  const components = emptyComponents();
  const envelope = { lo: 0, hi: 0 };
  let full = true;
  let rangesKnown = true;
  const bases: EnergyBasis[] = [];
  const daily: ComponentDay[] = [];
  for (const date of dates) {
    const value = values[dates.indexOf(date)];
    if (value === null || value === undefined) {
      daily.push({ date, total: null, components: null, envelope: null });
      continue;
    }
    const d = byDate.get(date);
    const c = date === today && live?.day ? componentsThrough(live.day, now) : d?.components;
    const e = date === today && live?.day ? rangeOf(value, live.day.envelope, live.day.total) : d?.envelope;
    daily.push({ date, total: value, components: c ?? null, envelope: e ?? null });
    if (c) for (const k of COMPONENT_ORDER) components[k] += c[k];
    else full = false;
    if (e) {
      envelope.lo += e.lo;
      envelope.hi += e.hi;
    } else rangesKnown = false;
    const b = date === today ? live?.energyBasis : d?.energyBasis;
    if (b && !bases.some((x) => x.weightKg === b.weightKg && x.formula === b.formula)) bases.push(b);
  }
  const range = rangesKnown ? envelope : null;
  const barProps = {
    dates,
    values,
    name: 'Energy burned by day',
    format: (v: number) => energyText(v, unit),
    unit,
    average,
    highlight: dates.includes(today) ? dates.indexOf(today) : null,
    outline: dates.map((d) => d === today),
    hue: 'energy' as const,
  };
  const info: InfoSpec = {
    body: [
      { body: W.todaySoFar },
      {
        body: 'Totals use the same engine runs as the individual days. Missing days stay gaps. Ranges add the supplied scenario bounds, allowing shared person-level bias; they are not measurement confidence intervals. The average line uses complete days when available.',
      },
    ],
    source: { kind: 'engine' },
    range: range
      ? `${formatEnergyRange(range.lo, range.hi, unit, { withUnit: false })} ${unit}`
      : 'No scenario range is available for every day.',
    evidence: EVIDENCE,
    twin: <ChartTwin data={barsTwin(barProps)} />,
  };
  return (
    <>
      <GradientCard
        as="section"
        domain="energy"
        size="hero"
        className="en-period"
        head={<CardHead as="h2" icon={Flame} title={W.periodTitle} info={info} />}
        foot={<CardFoot state={{ word: 'Estimated' }} right={`${known.length} of ${dates.length} days`} />}
      >
        <HeroNumber
          size="hero"
          value={total}
          format={(v) => energyText(v, unit)}
          unit={unit}
          range={
            range ? `Likely ${formatEnergyRange(range.lo, range.hi, unit, { withUnit: false })} ${unit}` : undefined
          }
          label={`Total burned ${energyText(total, unit)} ${unit}`}
        />
        <MonoMeta className="en-period__average">
          {W.dailyAverage} {energyText(average, unit)} {unit}
        </MonoMeta>
        <HighlightBars {...barProps} height={150} />
      </GradientCard>
      {full ? (
        <Breakdown
          components={components}
          total={total}
          envelope={range}
          bases={bases}
          unit={unit}
          days={daily}
          today={today}
          average={average}
        />
      ) : (
        <LegacyBreakdown
          days={past.days}
          live={live?.day ? componentsThrough(live.day, now) : null}
          total={total}
          unit={unit}
        />
      )}
    </>
  );
}

const rangeText = (value: number, total: number, envelope: Envelope | null, unit: Unit) => {
  const r = componentRange(value, total, envelope);
  return r ? `${formatEnergyRange(r.lo, r.hi, unit, { withUnit: false })} ${unit}` : 'Range unavailable';
};

function basisWords(basis?: EnergyBasis): string {
  return basis
    ? `${basis.formula}. Profile weight used to anchor this run: ${basis.weightKg.toFixed(1)} kg. The engine updates resting burn as its modelled body composition changes.`
    : 'The run’s formula and profile weight are unavailable from this data source.';
}

function Breakdown({
  components,
  total,
  envelope,
  basis,
  bases,
  unit,
  days,
  today,
  average,
}: {
  days?: ComponentDay[];
  today?: string;
  average?: number;
  components: Record<EnergyComponent, number>;
  total: number;
  envelope: Envelope | null;
  basis?: EnergyBasis;
  bases?: EnergyBasis[];
  unit: Unit;
}) {
  const nonZero = COMPONENT_ORDER.filter((k) => energyText(components[k], unit) !== '0');
  const positive = COMPONENT_ORDER.reduce((s, k) => s + Math.max(0, components[k]), 0);
  const deductions = COMPONENT_ORDER.some((k) => components[k] < -0.01);
  const rows: ShareBarRow[] = COMPONENT_ORDER.map((k) => ({
    id: k,
    label: COMPONENT_LABEL[k],
    valueText: `${energyText(components[k], unit)} ${unit}`,
    share: positive ? Math.max(0, components[k]) / positive : 0,
    hue: COMPONENT_HUE[k],
  }));
  const explanation =
    'These are the actual components of the engine’s energy ledger, each counted once. Component ranges scale the day or period’s scenario envelope; they are not separately measured uncertainties. Negative components reduce the total. The bar shows positive contributions; signed values include deductions. Daily stacks draw deductions below zero; white ticks show true daily totals.';
  const basisText = bases?.length ? bases.map(basisWords).join(' ') : basisWords(basis);
  return (
    <GradientCard
      as="section"
      domain="energy"
      size="hero"
      className="en-breakdown"
      head={
        <CardHead
          as="h2"
          icon={Layers3}
          title="What made up the burn"
          info={{
            body: [
              { body: explanation },
              ...COMPONENT_ORDER.map((k) => ({
                heading: COMPONENT_LABEL[k],
                body: k === 'rmr' ? `${COMPONENT_INFO[k]} ${basisText}` : COMPONENT_INFO[k],
              })),
            ],
            source: { kind: 'engine' },
            range: envelope
              ? `${formatEnergyRange(envelope.lo, envelope.hi, unit, { withUnit: false })} ${unit}`
              : 'Scenario range unavailable.',
            evidence: EVIDENCE,
            twin: days ? (
              <ComponentDaysTable days={days} unit={unit} />
            ) : (
              <ChartTwin
                data={{
                  title: 'Energy components table',
                  caption: explanation,
                  head: ['Component', unit, 'Likely range'],
                  rows: COMPONENT_ORDER.map((k) => [
                    COMPONENT_LABEL[k],
                    energyText(components[k], unit),
                    rangeText(components[k], total, envelope, unit),
                  ]),
                  fileName: 'vitals-energy-components.csv',
                }}
              />
            ),
          }}
        />
      }
    >
      <StackBar
        rows={rows}
        label={deductions ? 'Positive energy contributions' : 'Energy components'}
        total={`${energyText(total, unit)} ${unit}`}
        legend="none"
      />
      {days && today && average !== undefined ? (
        <ComponentDays days={days} today={today} average={average} unit={unit} />
      ) : null}
      <ul className="en-components" aria-label="Energy components">
        {nonZero.map((k) => (
          <li key={k} data-component={k}>
            <span className="en-components__name">
              <i style={{ background: COMPONENT_HUE[k] }} aria-hidden="true" />
              {COMPONENT_LABEL[k]}
            </span>
            <span className="en-components__value">
              {energyText(components[k], unit)} <span>{unit}</span>
            </span>
          </li>
        ))}
      </ul>
    </GradientCard>
  );
}

/** Older stand-ins may supply grouped kinds only. Never invent a split their data does not contain. */
function LegacyBreakdown({
  days,
  live,
  total,
  unit,
}: {
  days: readonly { kinds: Record<string, number> | null }[];
  live: Record<EnergyComponent, number> | null;
  total: number;
  unit: Unit;
}) {
  const kinds = Object.fromEntries(
    KIND_ORDER.map((k) => [k, days.reduce((s, d) => s + (d.kinds?.[k] ?? 0), 0)]),
  );
  if (live) {
    kinds.resting! += live.rmr + live.other;
    kinds.movement! += live.neatBase + live.stepsEnergy;
    kinds.exercise! += live.exercise + live.recovery;
    kinds.digestion! += live.tef;
  }
  return (
    <GradientCard
      as="section"
      domain="energy"
      head={
        <CardHead
          icon={Layers3}
          title="By kind"
          info={{
            body: 'This data source supplies grouped components only. Resting includes model adjustments; everyday movement includes NEAT and walking; exercise includes recovery. Open a day for its detailed ledger.',
            source: { kind: 'engine' },
          }}
        />
      }
    >
      <StackBar
        label="Energy by kind"
        rows={KIND_ORDER.map((k) => ({
          id: k,
          label: KIND_LABEL[k],
          valueText: `${energyText(kinds[k] ?? 0, unit)} ${unit}`,
          share: total > 0 ? Math.max(0, kinds[k] ?? 0) / total : 0,
          hue: KIND_HUE[k],
        }))}
      />
    </GradientCard>
  );
}

function energyInfo({
  day,
  basis,
  source,
  ringKcal,
  unit,
}: {
  day: LedgerDay;
  basis?: EnergyBasis;
  source: 'body' | 'plan' | null;
  ringKcal: number | null;
  unit: Unit;
}): InfoSpec {
  const covered = day.coverage.knownMin ? durationText(Math.min(day.coverage.knownMin, 1440)) : null;
  return {
    title: 'Energy',
    body: [
      { heading: W.measured, body: covered ? W.measuredSteps(covered) : W.measuredNone },
      {
        heading: W.estimated,
        body: `${source === 'plan' ? W.estimatedRestPlan : W.estimatedRestBody}. ${basisWords(basis)} ${W.estimatedActs}.`,
      },
      {
        heading: W.modelled,
        body: `${W.modelledTef}. The total and components use the current hour pro rata; the time chart shows an approximate within-hour allocation. ${W.activitiesNote}`,
      },
      ...(ringKcal !== null
        ? [
            {
              heading: W.comparison,
              body: W.ringComparison(formatEnergy(ringKcal, unit, { withUnit: false }), unit),
            },
          ]
        : []),
    ],
    source: { kind: 'engine' },
    range:
      'Likely ranges are scenario estimates supplied by the engine, not measured calorie readings. Component ranges share the same scenario bias.',
    evidence: EVIDENCE,
  };
}

function EnergyState({
  loading,
  profile,
  title = W.burned,
  text = W.noRun,
}: {
  loading?: boolean;
  profile?: boolean;
  title?: string;
  text?: string;
}) {
  return (
    <GradientCard
      as="section"
      domain="energy"
      size="hero"
      head={<CardHead as="h2" icon={Flame} title={title} />}
    >
      {loading ? (
        <Loading lines={4} />
      ) : (
        <p className="en-empty">
          {profile ? (
            <>
              {W.noProfile}{' '}
              <Link className="lm-link" to="/body">
                {W.yourBody}
              </Link>
            </>
          ) : (
            text
          )}
        </p>
      )}
    </GradientCard>
  );
}

function ActivitiesCard({ rows, date, unit }: { rows: readonly DayActivityRow[]; date: string; unit: Unit }) {
  const review = useActivityData().useReview(date, date);
  const [open, setOpen] = useState<ReviewRow | null>(null);
  const byKey = new Map([...review.rows, ...review.decided].map((r) => [r.id, r]));
  return (
    <GradientCard
      as="section"
      domain="steps"
      size="hero"
      head={
        <CardHead
          as="h2"
          icon={Activity}
          title={W.activities}
          info={{
            body: W.activitiesNote,
            source: {
              kind: 'estimate',
              words:
                'Activity sources are shown on each row; the table keeps estimation methods and ranges. Detected activities waiting for review are not counted.',
            },
            twin: <ChartTwin data={{
              title: 'Activity energy table',
              caption: W.activitiesNote,
              head: ['Activity', 'When', unit, 'Likely range', 'Method'],
              rows: rows.map((r) => [r.name, rowWhen(r), r.kcal === null ? 'Unknown' : energyText(r.kcal, unit), r.range ? formatEnergyRange(r.range.lo, r.range.hi, unit) : 'Unavailable', r.basis]),
              fileName: 'vitals-activity-energy.csv',
            }} />,
          }}
        />
      }
    >
      {rows.length ? (
        <ul className="en-acts">
          {rows.map((r) => {
            const rr = r.candidateKey ? byKey.get(r.candidateKey) : undefined;
            const body = (
              <>
                <span className="en-acts__what">
                  <span className="en-acts__name">{r.name}</span>
                  <MonoMeta className="en-acts__when">{rowWhen(r)}</MonoMeta>
                  <span className="en-acts__basis">{r.basis.split(' · ')[0]}</span>
                </span>
                <span className="en-acts__kcal">
                  <span className="en-acts__v">
                    {r.kcal !== null ? (
                      <>
                        ~{energyText(r.kcal, unit)}
                        <span className="en-acts__u"> {unit}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                </span>
                {rr ? <ChevronRight className="en-acts__chev" size={18} aria-hidden="true" /> : <span />}
              </>
            );
            return (
              <li key={r.id} data-pending={r.pending || undefined}>
                {rr ? (
                  <button
                    type="button"
                    className="en-acts__row"
                    aria-haspopup="dialog"
                    onClick={() => setOpen(rr)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="en-acts__row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="en-empty">{W.noActivities}</p>
      )}
      {open ? <ActivitySheet row={open} onClose={() => setOpen(null)} quiet={false} /> : null}
    </GradientCard>
  );
}

function QuietDay({ rows }: { rows: readonly DayActivityRow[] }) {
  return (
    <GradientCard
      as="section"
      domain="energy"
      size="hero"
      head={<CardHead as="h2" icon={Flame} title={W.title} />}
    >
      <MonoMeta>{W.quiet}</MonoMeta>
      {rows.length ? (
        <ul className="en-acts" aria-label={W.activities}>
          {rows.map((r) => (
            <li key={r.id}>
              <div className="en-acts__row">
                <span className="en-acts__what">
                  <span className="en-acts__name">{r.name}</span>
                  <MonoMeta>{r.start !== null ? partOfDayWords(r.start) : ''}</MonoMeta>
                  <MonoMeta>{r.pending ? W.toReview : r.basis.split(' · ')[0]}</MonoMeta>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="en-empty">{W.noActivities}</p>
      )}
    </GradientCard>
  );
}
