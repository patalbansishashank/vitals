/** One signal, its latest reading, its range and its history (r071). */
import { useState } from 'react';
import { Activity, Droplets, HeartPulse, Thermometer, Waves } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GlowLine,
  GradientCard,
  HeroNumber,
  HighlightBars,
  KeyBank,
  MonoMeta,
  RangeScale,
  barsTwin,
  formatNumber,
  lineTwin,
  type InfoSpec,
} from '@/components';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from '../copy';
import { useBaselines, useDaily, useSeries } from '../data';
import { metricDomain } from '../domains';
import {
  BANDS,
  METRICS,
  calendarDate,
  clockOf,
  dailyValues,
  decimalsOf,
  elevatedMinutes,
  mainSession,
  minutesText,
  readingAge,
  shiftDate,
  statusOf,
  stressSegments,
  type RingMetric,
} from '../model';
import { personal } from '../monitor/values';
import { metricScale } from '../scales';
import { bandRange, bandRows } from '../signalWords';
import type { GaugeBucketPoint, GaugeRawPoint } from '../types';
import { useNow } from '../useGauge';
import { StressHistory } from '../components/StressHistory';
import { MeasureKey } from '../components/MeasureKey';
import { Loading, footState, useUnitPrefs } from '../components/parts';
import { quietAge, quietDays } from '../quiet';
import { signalLine } from './detailSeries';
import './details.css';

export type Period = 'day' | 'week' | 'month' | 'year';
const PERIODS = [
  { value: 'day', label: 'Day', days: 1 },
  { value: 'week', label: 'Week', days: 7 },
  { value: 'month', label: 'Month', days: 30 },
  { value: 'year', label: 'Year', days: 365 },
] as const;
const ICONS = { hr: HeartPulse, hrv: Waves, spo2: Droplets, stress: Activity, temp: Thermometer };
const midnight = (date: string) => new Date(`${date}T00:00:00`).getTime();
const INFO: Record<RingMetric, string> = {
  hr: 'Heart-rate readings from the ring. The age beside the latest reading says how fresh it is. Low is under 50, Normal 50–89, Elevated 90–119 and High 120 or over. Measure now takes a spot reading in about 32 seconds. Lowest and highest readings keep their times.',
  hrv: 'Variation between heartbeats, compared with your own usual night after 7 nights. Near usual is within 3 ms or 10 percent of it. The latest reading and daytime line are context; the separately named overnight value is the reading used for your nightly baseline.',
  spo2: 'Blood oxygen from the ring sensor. Normal is 95 percent or over, Slightly low 93–94, Low 89–92 and Very low under 89. The age beside the latest reading says how fresh it is; lowest and highest readings keep their times.',
  stress:
    'Stress is the ring’s own index, not a clinical measure. Calm is under 26, Normal 26–50, Elevated 51–75 and High 76 or over. Time elevated estimates time in Elevated and High. Estimated coverage follows each sample until the next reading, capped at one and a half times the day’s typical sample gap. Unsupported time stays unknown. Dots show individual readings; tap or use the arrow keys to inspect them.',
  temp: 'Skin temperature is shown as a difference from your usual night, in your chosen unit. Near usual is within half a degree Celsius; the baseline needs 7 nights. The latest daytime reading and the separately named overnight reading are different measures.',
};

export function MetricView({ kind, date }: { kind: RingMetric; date: string }) {
  const [period, setPeriod] = useState<Period>('day');
  const prefs = useUnitPrefs();
  const quiet = useQuietMode().on;
  const now = useNow();
  const days = PERIODS.find((p) => p.value === period)!.days;
  const from = shiftDate(date, -(days - 1));
  const q = useSeries(
    kind,
    period === 'day' ? from : shiftDate(from, -28),
    date,
    period === 'day' ? 'raw' : 'day',
  );
  const b = useBaselines(date);
  const daily = useDaily(date);
  const base = personal(b.data ?? null);
  const meta = METRICS[kind];
  const hue = metricDomain(kind);
  const rawAll =
    period === 'day'
      ? [...((q.data?.points ?? []) as GaugeRawPoint[])].sort((a, z) => Date.parse(a.at) - Date.parse(z.at))
      : [];
  const raw = rawAll.filter((p) => p.value !== null && Number.isFinite(p.value));
  const last = raw.at(-1);
  const dates = Array.from({ length: days }, (_, i) => shiftDate(from, i));
  const rawDays =
    period === 'day'
      ? []
      : dailyValues((q.data?.points ?? []) as GaugeBucketPoint[], shiftDate(from, -28), date).slice(28);
  const known = rawDays.filter(Number.isFinite);
  const reading =
    period === 'day'
      ? (last?.value ?? null)
      : known.length
        ? known.reduce((a, v) => a + v, 0) / known.length
        : null;
  const dm = daily.data?.metrics?.[kind];
  const age = last ? readingAge(last.at, dm && 'medianGapS' in dm ? dm.medianGapS : null, now) : null;
  const scale = metricScale(kind, reading, base, prefs, { stale: period === 'day' && (age?.stale ?? false) });
  const display = (v: number) => metricScale(kind, v, base, prefs).value;
  const series = signalLine(
    rawAll.map((p) => ({
      t: Date.parse(p.at),
      v: p.value == null || !Number.isFinite(p.value) ? null : display(p.value),
    })),
  );
  const values = rawDays.map((v) => (Number.isFinite(v) ? display(v) : null));
  const status = reading !== null ? statusOf(kind, reading, base) : null;
  const fmt = (v: number) => formatNumber(v, decimalsOf(kind));
  const finiteSeries = series.filter((p): p is { t: number; v: number } => p.v !== null);
  const low = finiteSeries.reduce<{ t: number; v: number } | null>((a, p) => (!a || p.v < a.v ? p : a), null);
  const high = finiteSeries.reduce<{ t: number; v: number } | null>(
    (a, p) => (!a || p.v > a.v ? p : a),
    null,
  );
  const avg = finiteSeries.length ? finiteSeries.reduce((a, p) => a + p.v, 0) / finiteSeries.length : null;
  const night = daily.data?.sleep ? mainSession(daily.data.sleep, date)?.metrics : null;
  const overnight = kind === 'hrv' ? night?.hrvNightlyMs : kind === 'temp' ? night?.skinTempNightC : null;
  const nightValue = overnight != null ? display(overnight) : null;
  const t0 = midnight(date);
  const stress =
    kind === 'stress' && period === 'day'
      ? stressSegments(
          raw.map((p) => ({ t: Date.parse(p.at), v: p.value! })),
          t0,
          t0 + 86_400_000,
        )
      : [];
  const elevated = elevatedMinutes(stress);
  const usual = scale.usual;
  const normal =
    usual ?? (kind === 'hr' ? [50, 89] : kind === 'spo2' ? [95, 100] : kind === 'stress' ? [26, 50] : null);
  const line = {
    label: `${meta.label} on ${fmtDay(date as LocalDate)}`,
    series,
    unit: scale.delta ? `${scale.unit} vs usual` : scale.unit,
    decimals: scale.decimals,
    from: t0,
    to: t0 + 86_400_000,
  };
  const bars = {
    name: `${meta.label}, daily mean`,
    dates,
    values,
    unit: line.unit,
    average: scale.value ?? undefined,
    format: fmt,
  };
  const info: InfoSpec = {
    title: meta.label,
    body: quiet
      ? 'Readings come from the ring. The age says how fresh the latest reading is. Heart rate, blood oxygen and stress use fixed bands; HRV and skin temperature use your own usual night. Missing readings stay missing. History figures are hidden in quiet mode.'
      : INFO[kind],
    source: {
      kind: 'ring',
      words:
        period === 'day'
          ? 'Raw readings from the ring; overnight readings are named separately.'
          : 'Daily means from the ring through your phone. Each recorded day has equal weight in the period average.',
    },
    range: quiet
      ? undefined
      : BANDS[kind]
        ? bandRows(kind, prefs)
            .map((r) => `${r.word}: ${r.range}`)
            .join(' · ')
        : kind === 'temp'
          ? 'Difference from your usual night; Near usual is within ±0.5 °C (±0.9 °F).'
          : 'Your own usual nightly HRV, once seven nights are recorded.',
    terms:
      !quiet && period === 'day' && avg !== null && low && high
        ? [
            { term: 'Daily average', text: `${fmt(avg)} ${scale.unit}` },
            {
              term: 'Lowest reading',
              text: `${fmt(low.v)} ${scale.unit} · ${clockOf(raw.find((p) => Date.parse(p.at) === low.t)!.at)}`,
            },
            {
              term: 'Highest reading',
              text: `${fmt(high.v)} ${scale.unit} · ${clockOf(raw.find((p) => Date.parse(p.at) === high.t)!.at)}`,
            },
          ]
        : undefined,
    twin: quiet ? undefined : <ChartTwin data={period === 'day' ? lineTwin(line) : barsTwin(bars)} />,
    evidence:
      kind === 'hr' || kind === 'hrv'
        ? { to: '/evidence/19-resting-heart-rate-and-hrv', label: 'Resting heart rate and HRV' }
        : kind === 'stress'
          ? { to: '/evidence/16-psychological-stress', label: 'Psychological stress' }
          : undefined,
  };
  return (
    <GradientCard
      domain={hue}
      size="hero"
      className="rg-detail"
      head={<CardHead as="h2" icon={ICONS[kind]} title={meta.label} info={info} />}
      foot={
        <CardFoot
          state={footState(status, quiet) ?? { word: C.noReadings }}
          right={
            !quiet && reading !== null
              ? (bandRange(kind, reading, prefs) ?? (kind === 'temp' ? 'vs usual night' : 'Your usual night'))
              : undefined
          }
        >
          {kind === 'hr' ? <MeasureKey /> : null}
        </CardFoot>
      }
    >
      <div className="rg-detail__layout">
        <div className="rg-detail__reading">
          <HeroNumber
            size="hero"
            value={scale.value}
            unit={scale.unit}
            decimals={scale.decimals}
            quietWord={quiet ? (footState(status, true)?.word ?? 'No reading') : undefined}
            label={
              quiet
                ? (footState(status, true)?.word ?? 'No reading')
                : `${period === 'day' ? 'Latest' : 'Average'} ${meta.label} ${scale.value === null ? 'not yet available' : `${fmt(scale.value)} ${scale.unit}${scale.delta ? ' vs usual' : ''}`}`
            }
          />
          <MonoMeta tone="hue">
            {quiet
              ? age
                ? quietAge(age.ageMin)
                : quietDays(known.length, days)
              : period === 'day'
                ? [scale.delta ? 'vs usual' : 'Latest', age?.text].filter(Boolean).join(' · ')
                : `Avg per day · ${known.length} of ${days} days`}
          </MonoMeta>
          <RangeScale
            {...scale}
            label={meta.label}
            hue={hue}
            quiet={quiet}
            twin={false}
            ageText={!quiet ? age?.text : undefined}
          />
          {period === 'day' && overnight != null ? (
            <MonoMeta tone="hue">
              {quiet
                ? 'Overnight reading'
                : `Overnight ${nightValue === null ? 'building baseline' : `${fmt(nightValue)} ${scale.unit}${scale.delta ? ' vs usual' : ''}`}`}
            </MonoMeta>
          ) : null}
          {(kind === 'hrv' || kind === 'temp') && scale.state === 'calibrating' ? (
            <MonoMeta tone="hue">Still learning your usual night</MonoMeta>
          ) : null}
        </div>
        <div className="rg-detail__history">
          <KeyBank
            size="md"
            label="Period"
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            onChange={setPeriod}
          />
          <MonoMeta tone="hue">
            {quiet
              ? period === 'day'
                ? 'Through the day'
                : `The past ${period}`
              : period === 'day'
                ? fmtDay(date as LocalDate)
                : `${fmtDay(from as LocalDate)} – ${fmtDay(date as LocalDate)}`}
          </MonoMeta>
          {q.status === 'loading' ? (
            <Loading lines={4} />
          ) : reading === null ? (
            <p className="rg-none">{C.noReadings}</p>
          ) : quiet ? (
            <MonoMeta tone="hue">
              {period === 'day' ? 'History figures hidden in quiet mode' : quietDays(known.length, days)}
            </MonoMeta>
          ) : period === 'day' ? (
            kind === 'stress' ? (
              <StressHistory
                points={raw.map((p) => ({ t: Date.parse(p.at), v: p.value! }))}
                from={t0}
                to={t0 + 86_400_000}
                now={date === calendarDate(now) ? now : null}
                label={line.label}
              />
            ) : (
              <GlowLine
                {...line}
                hue={hue}
                height={220}
                yTicks={3}
                twin={false}
                area
                band={
                  normal ? { lo: series.map(() => normal[0]!), hi: series.map(() => normal[1]!) } : undefined
                }
                state={age?.stale ? 'stale' : 'normal'}
                endDot={date === calendarDate(now) && age && age.ageMin < 15 ? 'pulse' : 'static'}
              />
            )
          ) : (
            <HighlightBars
              {...bars}
              hue={hue}
              height={220}
              twin={false}
              highlight={dates.indexOf(date)}
              showAxis={days <= 31}
            />
          )}
          {kind === 'stress' && period === 'day' && stress.length ? (
            !quiet ? (
              <MonoMeta tone="hue">
                {`${minutesText(elevated)} elevated${stress.some((s) => s.state === 3) ? ' or high' : ''}`}
              </MonoMeta>
            ) : null
          ) : null}
        </div>
      </div>
    </GradientCard>
  );
}
