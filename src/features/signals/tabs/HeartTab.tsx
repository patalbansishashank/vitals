/**
 * Body signals › Heart and recovery (ring-pages.md §7.4, order per §6.5–6.8).
 * - day: heart rate through the day (main) → heart-rate variability last night → blood oxygen at night → skin
 *   temperature at night → your ring says (only when vendor scores are on).
 * - week / month: heart rate per day (main) → resting heart rate → heart-rate variability → blood oxygen per night →
 *   skin temperature per night (→ your ring says). Year: the same five at monthly points.
 * Secondary charts pair up 6/6 at ≥ 1280 px (`.sp-pair`, the page shell's class). Heart-rate variability, blood
 * oxygen and skin temperature are tier C: shown against the person's own normal; the tier note is said once, in the
 * page's source line (SourceLine), as is "your ring hasn't been read since …".
 * Missing is never zero, averages are over recorded slots only and say so, future slots draw nothing.
 */
import { useMemo, type ReactNode } from 'react';
import { Engraved, Faceplate } from '@/components';
import { formatNumber, formatSigned } from '@/components/lib/format';
import type { ResolvedDay } from '@/biometrics/core/types';
import { ScoreHistory } from '@/features/charts/living/ScoreHistory';
import type { ScoreHistoryData } from '@/features/charts/living/types';
import { useLivingClock } from '@/features/living/clock';
import { BaselineGauge } from '@/features/living/components/ScoreTile';
import { fmtDay, fmtMonth } from '@/features/living/format';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { useBaselines, useDays, useSeries, useSignalsPerson, type SignalBaseline, type SignalsPerson } from '../data';
import { coverageText, daysUpTo, type PeriodWindow } from '../models';
import { HEART_COPY as C } from '../charts/copyHeart';
import { DailyRange, type RangeDatum } from '../charts/DailyRange';
import { DayLine } from '../charts/DayLine';
import {
  NORMAL_DAYS,
  dayAggregates,
  dayBounds,
  mean7,
  meanOf,
  monthAggregates,
  normalOf,
  slotValues,
  spo2Slots,
  tempNormal,
  tempSlots,
  toTempDelta,
  toTempUnit,
  type Normal,
} from '../charts/heartModels';
import { TwinTable, useChartSizes } from '../charts/kit';
import { NightRanges, type NightRangeDatum } from '../charts/NightRanges';
import { workoutTypeWord } from '../charts/copy';
import { clockAt, type SeriesPoint } from '../charts/ringData';
import { ZoneLine } from '../charts/ZoneLine';
import { zoneModel } from '../charts/zones';
import '../charts/heart.css';
import type { TabProps } from './types';

const MIN = 60_000;
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: number) => formatNumber(Math.round(v));

/* ------------------------------------------------------------------------------------------------ shared */

/** A personal normal: bio.baselines first (it knows device epochs), else one computed from the stored days. */
function pickNormal(baselines: SignalBaseline[] | null, metric: string, local: Normal | null): { mean: number; lo: number; hi: number; nights: number; forming: boolean } | null {
  const b = baselines?.find((x) => x.metric === metric);
  if (b) return { mean: b.mean, lo: b.lo, hi: b.hi, nights: b.nights, forming: b.forming || b.nights < 14 };
  return local;
}

const hrvOf = (d: ResolvedDay): number | undefined => d.daily?.hrv?.value_ms ?? d.mainSleep?.night?.hrv?.value_ms;
const hrvMetricOf = (d: ResolvedDay): string | undefined => d.daily?.hrv?.metric ?? d.mainSleep?.night?.hrv?.metric;
const restingOf = (d: ResolvedDay): number | undefined => d.daily?.resting_hr_bpm;

function Face({ children }: { children: ReactNode }) {
  return <Faceplate className="hr-face">{children}</Faceplate>;
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="sp-pair">{children}</div>;
}

const VENDOR_KEYS = ['stress', 'readiness', 'sleep', 'recovery', 'strain', 'body_battery'] as const;

/** "stress 34 (their estimate)" items of a day's vendor opinion. */
function vendorItems(d: ResolvedDay): string[] {
  const v = d.daily?.vendor;
  if (!v) return [];
  const out: string[] = [];
  for (const k of VENDOR_KEYS) {
    const x = v[k];
    const n = typeof x === 'number' ? x : x && typeof x === 'object' ? x.value : undefined;
    if (finite(n)) out.push(C.vendorItem(C.vendorWords[k], formatNumber(n, Number.isInteger(n) ? 0 : 1)));
  }
  return out;
}

/** §7.4.8: a plain list, never a chart on a Vitals axis; hidden when vendor scores are off. */
function VendorFace({ person, days, perDay }: { person: SignalsPerson; days: readonly ResolvedDay[]; perDay: boolean }) {
  if (!person.vendorScores) return null;
  const rows = days
    .map((d) => ({ date: d.localDate, items: vendorItems(d) }))
    .filter((r) => r.items.length)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <Face>
      <div className="sg-chart" data-vendor="true">
        <div className="sg-chart__head">
          <Engraved as="p" className="sg-chart__title">
            {C.title.vendor}
          </Engraved>
        </div>
        {rows.length ? (
          <ul className="hr-vendor">
            {rows.flatMap((r) => (perDay ? [<li key={r.date}>{`${fmtDay(r.date)} · ${r.items.join(' · ')}`}</li>] : r.items.map((it) => <li key={`${r.date}${it}`}>{it}</li>)))}
          </ul>
        ) : (
          <p className="hr-text">{C.vendorNone}</p>
        )}
      </div>
    </Face>
  );
}

/* ------------------------------------------------------------------------------------------------ day */

function HeartDay({ window: w, today }: TabProps) {
  const date = w.start;
  const sizes = useChartSizes();
  const person = useSignalsPerson();
  const zones = useMemo(() => zoneModel(person), [person]);
  const clock = useLivingClock();
  const baselines = useBaselines();
  // the date, the 60 days before it (normals) and the next date (tonight's sleep band)
  const days = useDays(addDays(date, -(NORMAL_DAYS - 1)), addDays(date, 1));
  const day = days.find((d) => d.localDate === date);
  const next = days.find((d) => d.localDate === addDays(date, 1));
  const history = useMemo(() => days.filter((d) => d.localDate <= date), [days, date]);
  const { from, to, offsetS } = useMemo(() => dayBounds(date), [date]);
  const nowMs = Math.floor(clock.now().getTime() / MIN) * MIN;
  const now = date === today && nowMs >= from && nowMs < to ? nowMs : undefined;
  const hrDates = useMemo(() => [date], [date]);
  const hr = useSeries('hr', from, to, hrDates);

  const spots = useMemo<SeriesPoint[]>(
    () => (day?.spots ?? []).filter((s) => s.metric === 'hr_bpm' && s.time.at).map((s) => ({ t: Date.parse(s.time.at!), v: s.value })).sort((a, b) => a.t - b.t),
    [day],
  );
  const bands = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ from: number; to: number; kind: 'sleep' | 'workout'; label: string }> = [];
    for (const s of [...(day?.sleeps ?? []), ...(day?.mainSleep ? [day.mainSleep] : []), ...(next?.sleeps ?? []), ...(next?.mainSleep ? [next.mainSleep] : [])]) {
      if (seen.has(s.record_id) || !s.time.start || !s.time.end) continue;
      seen.add(s.record_id);
      const a = Date.parse(s.time.start), b = Date.parse(s.time.end);
      if (b > from && a < to) out.push({ from: a, to: b, kind: 'sleep', label: C.asleep });
    }
    for (const wk of day?.workouts ?? []) {
      if (!wk.time.start || !wk.time.end) continue;
      out.push({ from: Date.parse(wk.time.start), to: Date.parse(wk.time.end), kind: 'workout', label: workoutTypeWord(wk.exercise_type) });
    }
    return out;
  }, [day, next, from, to]);
  const resting = day?.daily?.resting_hr_bpm;

  // the night that ended on this date
  const night = day?.mainSleep?.time.start && day.mainSleep.time.end ? day.mainSleep : undefined;
  const bed = night ? Date.parse(night.time.start!) : null;
  const wake = night ? Date.parse(night.time.end!) : null;
  const nightOffset = night ? night.time.tz_offset_s : offsetS;
  const nightDates = useMemo(() => (bed !== null ? [...new Set([new Date(bed + nightOffset * 1000).toISOString().slice(0, 10), date])] : []), [bed, nightOffset, date]);
  const spo2 = useSeries('spo2', bed, wake, nightDates);
  const temp = useSeries('skin_temp', bed, wake, nightDates);

  return (
    <div className="hr-tab" data-period="day">
      <Face>
        <ZoneLine
          title={C.title.hrDay}
          points={hr.points}
          status={hr.status}
          stale={!!hr.stale}
          {...(hr.retry ? { onRetry: hr.retry } : {})}
          from={from}
          to={to}
          offsetS={offsetS}
          zones={zones}
          {...(finite(resting) ? { restingBpm: resting } : {})}
          spots={spots}
          bands={bands}
          axis="clock"
          {...(now !== undefined ? { now } : {})}
          height={sizes.main}
          emptyLine={C.hrDayEmpty}
        />
      </Face>
      <HrvLastNight day={day} history={history} baselines={baselines} date={date} />
      <Pair>
        <Face>
          <Spo2Night points={spo2.points} status={spo2.status} bed={bed} wake={wake} offsetS={nightOffset} history={history} baselines={baselines} height={sizes.secondary} />
        </Face>
        <Face>
          <TempNight points={temp.points} status={temp.status} bed={bed} wake={wake} offsetS={nightOffset} day={day} history={history} baselines={baselines} unit={person.tempUnit} height={sizes.secondary} />
        </Face>
      </Pair>
      <VendorFace person={person} days={day ? [day] : []} perDay={false} />
    </div>
  );
}

/** §7.4.3: the gauge and "48 ms last night · −6 ms from your normal (41–57 ms)"; forming → the count and the value. */
function HrvLastNight({ day, history, baselines, date }: { day: ResolvedDay | undefined; history: readonly ResolvedDay[]; baselines: SignalBaseline[] | null; date: LocalDate }) {
  const value = day ? hrvOf(day) : undefined;
  const metric = day ? hrvMetricOf(day) : undefined;
  const same = history.filter((d) => !metric || hrvMetricOf(d) === metric);
  const normal = pickNormal(metric === 'rmssd' ? baselines : null, 'hrv_rmssd_ms', normalOf(same.map(hrvOf)));
  const week = meanOf(same.filter((d) => d.localDate > addDays(date, -7)).map(hrvOf));
  let body: ReactNode;
  if (!finite(value)) body = <p className="hr-text">{C.hrvNone}</p>;
  else if (!normal || normal.forming)
    body = (
      <>
        <p className="hr-text" data-forming="true">
          {C.forming(Math.min(normal?.nights ?? 0, 13))}
        </p>
        <p className="hr-text">{C.hrvValue(int(value))}</p>
      </>
    );
  else {
    const span = Math.max(normal.hi - normal.lo, 4);
    const lo = Math.floor(Math.min(normal.lo, value, week ?? value) - span * 0.6);
    const hi = Math.ceil(Math.max(normal.hi, value, week ?? value) + span * 0.6);
    body = (
      <>
        <BaselineGauge min={Math.max(0, lo)} max={hi} normal={{ lo: normal.lo, hi: normal.hi }} {...(week !== null ? { mean7: week } : {})} lastNight={value} unit="ms" decimals={0} width={320} />
        <p className="hr-text">{C.hrvLine(int(value), formatSigned(value - normal.mean, 0), int(normal.lo), int(normal.hi))}</p>
      </>
    );
  }
  return (
    <Face>
      <div className="sg-chart" data-chart="hrv-last-night">
        <div className="sg-chart__head">
          <Engraved as="p" className="sg-chart__title">
            {C.title.hrv}
          </Engraved>
        </div>
        {body}
      </div>
    </Face>
  );
}

interface NightLineProps {
  points: readonly SeriesPoint[];
  status: 'loading' | 'ready' | 'failed';
  bed: number | null;
  wake: number | null;
  offsetS: number;
  history: readonly ResolvedDay[];
  baselines: SignalBaseline[] | null;
  height: number;
}

/** §7.4.4 blood oxygen: absolute %, the person's normal band, "average 96 % · lowest 91 % at 03:12". */
function Spo2Night({ points, status, bed, wake, offsetS, history, baselines, height }: NightLineProps) {
  const normal = pickNormal(baselines, 'spo2_avg_pct', normalOf(history.map((d) => d.daily?.spo2_avg_pct)));
  const band = normal && !normal.forming ? { lo: normal.lo, hi: Math.min(100, normal.hi) } : undefined;
  if (bed === null || wake === null) return <DayLine points={[]} from={0} to={1} offsetS={offsetS} unit="%" title={C.title.spo2Night} hue="recovery" empty={C.noNight} interactive />;
  const avg = meanOf(points.map((p) => p.v));
  const low = points.reduce<SeriesPoint | null>((a, p) => (!a || p.v < a.v ? p : a), null);
  return (
    <DayLine
      points={points}
      status={status}
      from={bed}
      to={wake}
      offsetS={offsetS}
      unit="%"
      title={C.title.spo2Night}
      hue="recovery"
      empty={C.spo2Empty}
      interactive
      height={height}
      {...(band ? { band } : {})}
      {...(avg !== null && low ? { note: C.spo2Readout(formatNumber(avg), formatNumber(low.v), clockAt(low.t, offsetS)) } : {})}
    />
  );
}

/** §7.4.4 skin temperature: change from the person's normal around "your normal"; the absolute value only in the table. */
function TempNight({ points, status, bed, wake, offsetS, day, history, baselines, unit, height }: NightLineProps & { day: ResolvedDay | undefined; unit: 'C' | 'F' }) {
  const u = unit === 'F' ? '°F' : '°C';
  const deltaBase = baselines?.find((b) => b.metric === 'skin_temp_delta_c') ?? null;
  const normal = tempNormal(history, deltaBase);
  if (bed === null || wake === null) return <DayLine points={[]} from={0} to={1} offsetS={offsetS} unit={u} title={C.title.tempNight} hue="recovery" empty={C.noNight} interactive />;
  const shown = points.map((p) => ({ t: p.t, v: toTempUnit(p.v, unit) }));
  // the normal as a temperature: directly (absolute basis), or through the ring's own reference for this night
  let absNormalC: number | null = null;
  if (normal && !normal.forming) {
    if (normal.basis === 'absolute') absNormalC = normal.value;
    else if (finite(day?.daily?.skin_temp_c) && finite(day?.daily?.skin_temp_delta_c)) absNormalC = day.daily.skin_temp_c - day.daily.skin_temp_delta_c + normal.value;
  }
  if (absNormalC === null) {
    const lo = shown.length ? Math.min(...shown.map((p) => p.v)) : NaN, hi = shown.length ? Math.max(...shown.map((p) => p.v)) : NaN;
    return (
      <>
        <DayLine points={shown} status={status} from={bed} to={wake} offsetS={offsetS} unit={u} decimals={1} title={C.title.tempNight} hue="recovery" empty={C.tempEmpty} interactive height={height} {...(shown.length ? { note: C.tempAbsReadout(formatNumber(lo, 1), formatNumber(hi, 1), u) } : {})} />
        {shown.length && normal?.forming ? <p className="hr-text" data-forming="true">{C.forming(Math.min(normal.nights, 13))}</p> : null}
      </>
    );
  }
  const n = toTempUnit(absNormalC, unit);
  const devs = shown.map((p) => ({ t: p.t, d: p.v - n }));
  const avg = meanOf(devs.map((x) => x.d));
  const top = devs.reduce<{ t: number; d: number } | null>((a, x) => (!a || x.d > a.d ? x : a), null);
  return (
    <DayLine
      points={shown}
      status={status}
      from={bed}
      to={wake}
      offsetS={offsetS}
      unit={u}
      decimals={1}
      title={C.title.tempNight}
      hue="recovery"
      empty={C.tempEmpty}
      change={{ normal: n }}
      interactive
      height={height}
      {...(avg !== null && top ? { note: C.tempReadout(formatSigned(avg, 1), u, formatSigned(top.d, 1), clockAt(top.t, offsetS)) } : {})}
    />
  );
}

/* ------------------------------------------------------------------------------------------------ week, month, year */

const slotLabel = (w: PeriodWindow, start: LocalDate) => (w.kind === 'year' ? `${fmtMonth(start)} ${start.slice(0, 4)}` : fmtDay(start));

/** The chart head the other charts get from ChartShell: engraved title left, coverage and readout right. */
function ChartHead({ title, text, extra }: { title: string; text: string; extra?: string | null }) {
  return (
    <div className="sg-chart__head">
      <Engraved as="p" className="sg-chart__title">
        {title}
      </Engraved>
      <div className="sg-chart__readouts" data-coverage="true">
        {extra ? `${text} · ${extra}` : text}
      </div>
    </div>
  );
}

/** New source on a metric: the history joins old and new with a dashed segment. */
function sourceChanges(w: PeriodWindow, all: readonly ResolvedDay[], key: string): Array<{ day: number; label: string }> {
  const by = new Map(all.map((d) => [d.localDate, d]));
  let prev: string | undefined = [...all].filter((d) => d.localDate < w.start && d.sourceByMetric[key]).pop()?.sourceByMetric[key];
  const out: Array<{ day: number; label: string }> = [];
  w.slots.forEach((s, i) => {
    const sk = by.get(s.start)?.sourceByMetric[key];
    if (!sk) return;
    if (prev && sk !== prev) out.push({ day: i, label: C.newSource });
    prev = sk;
  });
  return out;
}

function HeartPeriod({ window: w, today, onDrill }: TabProps) {
  const sizes = useChartSizes();
  const person = useSignalsPerson();
  const baselines = useBaselines();
  const lastDay = w.last < today ? w.last : today;
  const all = useDays(addDays(w.start, -NORMAL_DAYS), w.last);
  const inWin = useMemo(() => all.filter((d) => d.localDate >= w.start && d.localDate <= w.last), [all, w.start, w.last]);
  const history = useMemo(() => all.filter((d) => d.localDate <= lastDay), [all, lastDay]);
  const year = w.kind === 'year';
  const pastDates = useMemo(() => (year ? [] : w.slots.filter((s) => !s.future).map((s) => s.start)), [w, year]);
  const fromMs = pastDates.length ? dayBounds(w.start).from : null;
  const toMs = pastDates.length ? dayBounds(lastDay).to : null;
  const hr = useSeries('hr', fromMs, toMs, pastDates);
  const nDays = daysUpTo(w, today);
  const drill = (i: number) => {
    const s = w.slots[i];
    if (s && !s.future) onDrill(year ? 'month' : 'day', s.start);
  };
  const tempU = person.tempUnit === 'F' ? '°F' : '°C';

  /* heart rate per day / per month (§7.4.5) */
  const range = useMemo(() => {
    const pts = hr.status === 'ready' || hr.stale ? hr.points : null;
    const recordedDays = inWin.filter((d) => finite(d.daily?.resting_hr_bpm) || finite(d.daily?.hr_min_bpm) || finite(d.daily?.hr_max_bpm));
    let data: RangeDatum[];
    let table: ReactNode;
    let lows: number[], highs: number[], rests: number[], recorded: number;
    if (year) {
      const ms = monthAggregates(w.slots, inWin);
      data = ms.map((m) => ({
        start: m.date,
        future: m.future,
        recorded: m.recorded,
        dot: m.resting,
        lo: m.lowest,
        hi: m.highest,
        readout: C.slotReadout(
          slotLabel(w, m.date),
          m.recorded
            ? [
                ...(m.resting !== null ? [C.slotRestingMean(int(m.resting))] : []),
                ...(m.lowest !== null && m.highest !== null ? [C.slotRange(int(m.lowest), int(m.highest))] : []),
                C.slotDays(m.days),
              ]
            : [C.noData],
        ),
      }));
      table = (
        <TwinTable
          caption={C.title.hrPerMonth}
          head={C.monthTableCols}
          rows={ms.filter((m) => !m.future).map((m) => [slotLabel(w, m.date), m.resting !== null ? int(m.resting) : C.noData, m.lowest !== null ? int(m.lowest) : C.noData, m.highest !== null ? int(m.highest) : C.noData, String(m.days)])}
        />
      );
      lows = recordedDays.map((d) => d.daily!.hr_min_bpm).filter(finite);
      highs = recordedDays.map((d) => d.daily!.hr_max_bpm).filter(finite);
      rests = recordedDays.map((d) => d.daily!.resting_hr_bpm).filter(finite);
      recorded = recordedDays.length;
    } else {
      const ds = dayAggregates(w.slots, inWin, pts);
      data = ds.map((d) => ({
        start: d.date,
        future: d.future,
        recorded: d.recorded,
        dot: d.resting,
        lo: d.lowest,
        hi: d.highest,
        readout: C.slotReadout(
          fmtDay(d.date),
          d.recorded
            ? [
                ...(d.resting !== null ? [C.slotResting(int(d.resting))] : []),
                ...(d.lowest !== null && d.highest !== null ? [C.slotRange(int(d.lowest), int(d.highest))] : []),
                ...(d.readings !== null ? [C.slotReadings(formatNumber(d.readings))] : []),
              ]
            : [C.noData],
        ),
      }));
      table = (
        <TwinTable
          caption={C.title.hrPerDay}
          head={C.rangeTableCols}
          rows={ds
            .filter((d) => !d.future)
            .map((d) => [
              fmtDay(d.date),
              d.resting !== null ? int(d.resting) : C.noData,
              d.lowest !== null ? int(d.lowest) : C.noData,
              d.highest !== null ? int(d.highest) : C.noData,
              d.readings !== null ? formatNumber(d.readings) : C.noData,
            ])}
        />
      );
      const rec = ds.filter((d) => d.recorded);
      lows = rec.map((d) => d.lowest).filter(finite);
      highs = rec.map((d) => d.highest).filter(finite);
      rests = rec.map((d) => d.resting).filter(finite);
      recorded = rec.length;
    }
    const avg = meanOf(rests);
    const lo = lows.length ? Math.min(...lows) : null, hi = highs.length ? Math.max(...highs) : null;
    const readout =
      recorded === 0
        ? C.noData
        : avg !== null && lo !== null && hi !== null
          ? C.rangeReadout(int(avg), int(lo), int(hi))
          : avg !== null
            ? C.restingAvg(int(avg), 'bpm', 'days')
            : lo !== null && hi !== null
              ? C.rangeReadoutNoRest(int(lo), int(hi))
              : C.noData;
    return { data, table, readout, recorded };
  }, [hr.status, hr.stale, hr.points, inWin, w, year]);
  const coverage = coverageText(range.recorded, nDays, 'days');

  /* resting heart rate and heart-rate variability (§7.4.6) */
  const restingNormal = pickNormal(baselines, 'resting_hr_bpm', normalOf(history.map(restingOf)));
  const hrvMetric = [...history].reverse().map(hrvMetricOf).find(Boolean);
  const hrvGet = useMemo(() => (d: ResolvedDay) => (!hrvMetric || hrvMetricOf(d) === hrvMetric ? hrvOf(d) : undefined), [hrvMetric]);
  const hrvNormal = pickNormal(hrvMetric === 'rmssd' ? baselines : null, 'hrv_rmssd_ms', normalOf(history.filter((d) => hrvMetricOf(d) === hrvMetric).map(hrvOf)));

  /* blood oxygen and skin temperature per night (§7.4.7) */
  const spo2 = useMemo(() => spo2Slots(w, inWin), [w, inWin]);
  const spo2Normal = pickNormal(baselines, 'spo2_avg_pct', normalOf(history.map((d) => d.daily?.spo2_avg_pct)));
  const tNormal = useMemo(() => tempNormal(history, baselines?.find((b) => b.metric === 'skin_temp_delta_c') ?? null), [history, baselines]);
  const temps = useMemo(() => tempSlots(w, inWin, tNormal), [w, inWin, tNormal]);

  const mainTitle = year ? C.title.hrPerMonth : C.title.hrPerDay;
  return (
    <div className="hr-tab" data-period={w.kind}>
      <Face>
        <DailyRange
          window={w}
          data={range.data}
          hue="cardio"
          unit="bpm"
          title={mainTitle}
          header={
            <>
              <span data-coverage="true">{coverage}</span>
              <br />
              <span data-readouts="true">{range.readout}</span>
            </>
          }
          summary={C.rangeSummary(mainTitle, coverage, range.readout)}
          height={sizes.main}
          emptyLine={range.recorded === 0 ? C.emptyPeriod(w.kind) : null}
          table={range.table}
          onDrill={drill}
        />
      </Face>
      <Pair>
        <Face>
          <History
            w={w}
            all={all}
            inWin={inWin}
            get={restingOf}
            sourceKey="resting_hr_bpm"
            normal={restingNormal}
            title={C.title.resting}
            label="Resting heart rate"
            unit="bpm"
            category="cardio"
            what="days"
            nDays={nDays}
            height={sizes.secondary}
            onDrill={drill}
          />
        </Face>
        <Face>
          <History
            w={w}
            all={all}
            inWin={inWin}
            get={hrvGet}
            sourceKey="hrv"
            normal={hrvNormal}
            title={C.title.hrvHistory}
            label="Heart-rate variability"
            unit="ms"
            category="recovery"
            what="nights"
            nDays={nDays}
            height={sizes.secondary}
            onDrill={drill}
          />
          </Face>
      </Pair>
      <Pair>
        <Face>
          <Spo2Period w={w} slots={spo2} normal={spo2Normal} nDays={nDays} height={sizes.secondary} onDrill={drill} />
        </Face>
        <Face>
          <TempPeriod w={w} slots={temps} normal={tNormal} unit={person.tempUnit} u={tempU} nDays={nDays} height={sizes.secondary} onDrill={drill} />
        </Face>
      </Pair>
      <VendorFace person={person} days={inWin} perDay />
    </div>
  );
}

interface HistoryProps {
  w: PeriodWindow;
  all: readonly ResolvedDay[];
  inWin: readonly ResolvedDay[];
  get: (d: ResolvedDay) => number | undefined;
  sourceKey: string;
  normal: { mean: number; lo: number; hi: number; nights: number; forming: boolean } | null;
  title: string;
  label: string;
  unit: string;
  category: 'cardio' | 'recovery';
  what: 'days' | 'nights';
  nDays: number;
  height: number;
  onDrill: (i: number) => void;
}

/** §7.4.6: `ScoreHistory` for week and month; on the year the monthly means, connected, with the normal band. */
function History({ w, all, inWin, get, sourceKey, normal, title, label, unit, category, what, nDays, height, onDrill }: HistoryProps) {
  const vals = useMemo(() => slotValues(w, inWin, get), [w, inWin, get]);
  const recordedDays = inWin.filter((d) => finite(get(d))).length;
  const avg = meanOf(inWin.map(get));
  const coverage = coverageText(recordedDays, nDays, what);
  const extra = avg !== null ? C.restingAvg(int(avg), unit, what) : null;
  const band = normal && !normal.forming ? normal : null;
  const data = useMemo<ScoreHistoryData | null>(() => {
    if (w.kind === 'year') return null;
    const by = new Map(all.map((d) => [d.localDate, d]));
    const prior: Array<number | null> = [];
    for (let k = 6; k >= 1; k--) {
      const d = by.get(addDays(w.start, -k));
      const v = d ? get(d) : undefined;
      prior.push(finite(v) ? v : null);
    }
    const nightly = vals.map((v) => (v.value === null ? NaN : v.value));
    const m7 = mean7(
      vals.map((v) => v.value),
      prior,
    );
    return {
      startDate: w.start,
      days: w.slots.length,
      unit,
      decimals: 0,
      nightly,
      mean7: m7,
      ...(band ? { normal: { lo: vals.map((v) => (v.future ? NaN : band.lo)), hi: vals.map((v) => (v.future ? NaN : band.hi)) } } : {}),
      deviceChanges: sourceChanges(w, all, sourceKey),
      category,
    };
  }, [w, all, get, vals, unit, band, sourceKey, category]);
  if (data) {
    return (
      <div className="sg-chart" data-chart={sourceKey}>
        <ChartHead title={title} text={coverage} extra={extra} />
        <ScoreHistory data={data} height={height} label={label} />
        {recordedDays === 0 ? <p className="hr-text">{C.emptyHistory(label, w.kind)}</p> : null}
        {normal?.forming && recordedDays > 0 ? <p className="hr-text" data-forming="true">{C.forming(Math.min(normal.nights, 13))}</p> : null}
      </div>
    );
  }
  // year: monthly means
  const rd: RangeDatum[] = vals.map((v) => ({
    start: v.start,
    future: v.future,
    recorded: v.value !== null,
    dot: v.value,
    lo: null,
    hi: null,
    readout: C.slotReadout(slotLabel(w, v.start), v.value !== null ? [C.monthMean(int(v.value), unit), `${v.n} ${what} recorded`] : [C.noData]),
  }));
  return (
    <DailyRange
      window={w}
      data={rd}
      hue={category}
      unit={unit}
      normal={band ? { lo: band.lo, hi: band.hi } : null}
      normalTone="ink"
      emptyDomain={unit === 'ms' ? [20, 80] : [40, 80]}
      title={title}
      header={<span data-coverage="true">{extra ? `${coverage} · ${extra}` : coverage}</span>}
      summary={C.rangeSummary(title, coverage, extra ?? C.noData)}
      height={height}
      emptyLine={recordedDays === 0 ? C.emptyNights('year') : null}
      table={<TwinTable caption={title} head={C.meansTableCols(unit)} rows={vals.filter((v) => !v.future).map((v) => [slotLabel(w, v.start), v.value !== null ? int(v.value) : C.noData, String(v.n)])} />}
      onDrill={onDrill}
    />
  );
}

function Spo2Period({ w, slots, normal, nDays, height, onDrill }: { w: PeriodWindow; slots: ReturnType<typeof spo2Slots>; normal: { lo: number; hi: number; forming: boolean } | null; nDays: number; height: number; onDrill: (i: number) => void }) {
  const title = w.kind === 'year' ? C.title.spo2PerMonth : C.title.spo2PerNight;
  const recorded = w.kind === 'year' ? null : slots.filter((s) => s.recorded).length;
  const avg = meanOf(slots.map((s) => s.avg));
  const coverage = recorded !== null ? coverageText(recorded, nDays, 'nights') : coverageText(slots.filter((s) => s.recorded).length, slots.filter((s) => !s.future).length, 'months');
  const readout = avg !== null ? C.spo2PeriodReadout(formatNumber(avg)) : C.noData;
  const data: NightRangeDatum[] = slots.map((s) => ({
    start: s.date,
    future: s.future,
    recorded: s.recorded,
    avg: s.avg,
    lowest: s.lowest,
    readout: C.slotReadout(slotLabel(w, s.date), s.avg !== null ? [C.spo2Slot(formatNumber(s.avg), s.lowest !== null ? formatNumber(s.lowest) : null)] : [C.noData]),
  }));
  const any = slots.some((s) => s.recorded);
  return (
    <NightRanges
      kind="spo2"
      window={w}
      data={data}
      normal={normal && !normal.forming ? { lo: normal.lo, hi: normal.hi } : null}
      title={title}
      header={<span data-coverage="true">{`${coverage} · ${readout}`}</span>}
      summary={C.rangeSummary(title, coverage, readout)}
      height={height}
      emptyLine={any ? null : C.emptyNights(w.kind)}
      table={
        <TwinTable
          caption={title}
          head={C.spo2TableCols}
          rows={slots.filter((s) => !s.future).map((s) => [slotLabel(w, s.date), s.avg !== null ? `${formatNumber(s.avg)}` : C.noData, s.lowest !== null ? formatNumber(s.lowest) : C.noData])}
        />
      }
      onDrill={onDrill}
    />
  );
}

function TempPeriod({ w, slots, normal, unit, u, nDays, height, onDrill }: { w: PeriodWindow; slots: ReturnType<typeof tempSlots>; normal: ReturnType<typeof tempNormal>; unit: 'C' | 'F'; u: '°C' | '°F'; nDays: number; height: number; onDrill: (i: number) => void }) {
  const title = w.kind === 'year' ? C.title.tempPerMonth : C.title.tempPerNight;
  const recordedSlots = slots.filter((s) => s.recorded);
  const coverage = w.kind === 'year' ? coverageText(recordedSlots.length, slots.filter((s) => !s.future).length, 'months') : coverageText(recordedSlots.length, nDays, 'nights');
  const devAvg = meanOf(slots.map((s) => s.dev));
  const readout = devAvg !== null ? C.tempPeriodReadout(formatSigned(toTempDelta(devAvg, unit), 1), u) : C.noData;
  const data: NightRangeDatum[] = slots.map((s) => ({
    start: s.date,
    future: s.future,
    recorded: s.recorded,
    dev: s.dev !== null ? toTempDelta(s.dev, unit) : null,
    readout: C.slotReadout(
      slotLabel(w, s.date),
      s.dev !== null ? [C.tempSlot(formatSigned(toTempDelta(s.dev, unit), 1), u)] : s.abs !== null ? [C.tempAbs(formatNumber(toTempUnit(s.abs, unit), 1), u)] : s.recorded ? [] : [C.noData],
    ),
  }));
  const forming = !normal || normal.forming;
  const emptyLine = !recordedSlots.length ? C.emptyNights(w.kind) : forming ? C.forming(Math.min(normal?.nights ?? 0, 13)) : null;
  return (
    <NightRanges
      kind="temp"
      unit={u}
      window={w}
      data={data}
      title={title}
      header={<span data-coverage="true">{`${coverage} · ${readout}`}</span>}
      summary={C.rangeSummary(title, coverage, readout)}
      height={height}
      emptyLine={emptyLine}
      table={
        <TwinTable
          caption={title}
          head={C.tempTableColsPeriod(u)}
          rows={slots
            .filter((s) => !s.future)
            .map((s) => [slotLabel(w, s.date), s.abs !== null ? formatNumber(toTempUnit(s.abs, unit), 1) : C.noData, s.dev !== null ? formatSigned(toTempDelta(s.dev, unit), 1) : C.noData])}
        />
      }
      onDrill={onDrill}
    />
  );
}

/* ------------------------------------------------------------------------------------------------ the tab */

export function HeartTab(props: TabProps) {
  return props.window.kind === 'day' ? <HeartDay {...props} /> : <HeartPeriod {...props} />;
}
