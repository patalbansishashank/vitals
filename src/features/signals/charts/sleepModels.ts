/**
 * Sleep tab models (design/screens/ring-pages.md §7.2, §7.3). Pure: no React, "today" is always an argument.
 *
 * - A night belongs to its wake date (`ResolvedDay.localDate`); `mainSleep` is the main night, the other sessions of
 *   the date are naps (< 3 h, ending after 09:00 and before 21:00) or "another sleep".
 * - The stage stack of a night is deep, light, REM and unknown minutes. Unknown is never folded into light: it is the
 *   larger of the ring's own "unknown" minutes and the asleep time no known stage covers (a night with no stage list,
 *   or a corrected total, is all unknown). "Asleep" on this page is the stack's total.
 * - Missing is never zero: a slot without a night is `null` and every average skips it; stage shares are averaged over
 *   nights that have stage data only.
 */
import type { ResolvedDay, SleepRecord } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import { addDays, daysBetween } from '@/living/dates';
import { clockAt, nightModel, type NightModel, type NightStage, type SeriesPoint } from './ringData';
import { tempNormal } from './heartModels';
import type { PeriodWindow } from '../models';
import type { SignalBaseline } from '../data';

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;

export type StackStage = 'deep' | 'light' | 'rem' | 'unknown';
/** Stack order, bottom → top (§7.3.4). */
export const STACK_STAGES: readonly StackStage[] = ['deep', 'light', 'rem', 'unknown'];

export type StageMinutes = Record<StackStage, number>;

/* ------------------------------------------------------------------------------------------------ one night */

export interface SleepNight {
  /** Wake date. */
  date: LocalDate;
  /** Segments and times; null when the record has no bed and wake times. */
  model: NightModel | null;
  bed: number | null;
  wake: number | null;
  /** Seconds east of UTC (the record's own). */
  offsetS: number;
  stack: StageMinutes;
  /** Total of the stack (deep + light + REM + unknown). */
  asleepMin: number;
  /** Awake minutes from the stages (or the record's total when it has no stage list); null when not recorded. */
  awakeMin: number | null;
  /** At least one classified stage (deep, light or REM). Without, deep/light/REM read "no data", never 0. */
  hasStages: boolean;
  /** The ring had not finished this night ('provisional_stages'). */
  provisional: boolean;
}

export function sleepNight(rec: SleepRecord): SleepNight {
  const model = nightModel(rec);
  const seg = model?.minutes ?? { deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 };
  const known = seg.deep + seg.light + seg.rem;
  const unknown = Math.max(seg.unknown, Math.round(rec.asleep_s / 60) - known);
  const hasSegments = (model?.segments.length ?? 0) > 0;
  // awake is known when the ring told stages apart (or recorded awake time); a night of only "unknown" doesn't say
  const awakeMin = hasSegments ? (known > 0 || seg.awake > 0 ? seg.awake : null) : typeof rec.awake_s === 'number' ? Math.round(rec.awake_s / 60) : null;
  return {
    date: rec.time.local_date,
    model,
    bed: model?.start ?? null,
    wake: model?.end ?? null,
    offsetS: rec.time.tz_offset_s,
    stack: { deep: seg.deep, light: seg.light, rem: seg.rem, unknown },
    asleepMin: known + unknown,
    awakeMin,
    hasStages: known > 0,
    provisional: rec.quality.flags.includes('provisional_stages'),
  };
}

/** The stage the night was in at `t` (true time), or null when no stage covers it. */
export function stageAt(model: NightModel | null, t: number): NightStage | null {
  if (!model) return null;
  for (const s of model.segments) if (s.start <= t && t < s.end) return s.stage;
  return null;
}

/* ------------------------------------------------------------------------------------------------ naps */

export type OtherKind = 'nap' | 'another';

/** A session other than the main night. */
export interface OtherSleep {
  date: LocalDate;
  start: number | null;
  end: number | null;
  offsetS: number;
  minutes: number;
  kind: OtherKind;
}

/** Minutes after local midnight at a fixed offset. */
export function clockMinutes(t: number, offsetS: number): number {
  const d = new Date(t + offsetS * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

/** §7.3.5: < 3 h and ending after 09:00 and before 21:00 → "nap"; any other session → "another sleep". */
export function classifySession(start: number, end: number, offsetS: number): OtherKind {
  const e = clockMinutes(end, offsetS);
  return end - start < 3 * HOUR_MS && e > 9 * 60 && e < 21 * 60 ? 'nap' : 'another';
}

function otherSleep(rec: SleepRecord): OtherSleep {
  const start = rec.time.start ? Date.parse(rec.time.start) : NaN;
  const end = rec.time.end ? Date.parse(rec.time.end) : NaN;
  const timed = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const minutes = rec.asleep_s > 0 ? Math.round(rec.asleep_s / 60) : timed ? Math.round((end - start) / MIN_MS) : 0;
  return {
    date: rec.time.local_date,
    start: timed ? start : null,
    end: timed ? end : null,
    offsetS: rec.time.tz_offset_s,
    minutes,
    kind: timed ? classifySession(start, end, rec.time.tz_offset_s) : 'another',
  };
}

/* ------------------------------------------------------------------------------------------------ one date */

export interface SleepDay {
  date: LocalDate;
  night: SleepNight | null;
  /** Naps and other sessions of the date, by start. */
  others: OtherSleep[];
  /** The ring maker's sleep score (shown only when vendor scores are on). */
  vendorSleep: number | null;
}

export function sleepDay(day: ResolvedDay): SleepDay {
  let main: SleepRecord | undefined = day.mainSleep;
  // The resolver falls back to the longest session when none is flagged main; a lone afternoon nap is still a nap.
  if (main && !main.is_main && main.time.start && main.time.end) {
    const s = Date.parse(main.time.start), e = Date.parse(main.time.end);
    if (e > s && classifySession(s, e, main.time.tz_offset_s) === 'nap') main = undefined;
  }
  const others = day.sleeps
    .filter((s) => s !== main && (!main || s.record_id !== main.record_id))
    .map(otherSleep)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const v = day.daily?.vendor?.sleep;
  return { date: day.localDate, night: main ? sleepNight(main) : null, others, vendorSleep: typeof v === 'number' ? v : null };
}

export function sleepDayMap(days: readonly ResolvedDay[]): Map<LocalDate, SleepDay> {
  return new Map(days.map((d) => [d.localDate, sleepDay(d)]));
}

/* ------------------------------------------------------------------------------------------------ period stats */

/** Clock position in minutes after 18:00 (so a night's bed and wake never wrap around midnight). */
export const fromSix = (t: number, offsetS: number): number => (clockMinutes(t, offsetS) - 18 * 60 + 1440) % 1440;
/** Back from minutes after 18:00 to "HH:MM". */
export function sixToClock(m: number): string {
  const total = Math.round(m + 18 * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface SleepStats {
  /** Slots up to today. */
  slots: number;
  /** Nights recorded in those slots. */
  recorded: number;
  avgAsleepMin: number | null;
  avgAwakeMin: number | null;
  /** Nights with stage data (shares and stage averages use these only). */
  stagedNights: number;
  /** Fractions of asleep per stage over nights with stages; null when none has stages. */
  shares: StageMinutes | null;
  /** Average stage minutes over nights with stages. */
  avgStageMin: StageMinutes | null;
  /** Median bed / wake in minutes after 18:00 (nights with times). */
  medianBed: number | null;
  medianWake: number | null;
  longest: SleepNight | null;
  shortest: SleepNight | null;
  naps: number;
}

/** Stats over the recorded nights of a period (`nights` holds only past slots; null = missing, skipped). */
export function sleepStats(nights: ReadonlyArray<SleepNight | null>, slots: number, naps = 0): SleepStats {
  const rec = nights.filter((n): n is SleepNight => n !== null);
  const staged = rec.filter((n) => n.hasStages);
  const sum = (k: StackStage) => staged.reduce((a, n) => a + n.stack[k], 0);
  const stagedTotal = staged.reduce((a, n) => a + n.asleepMin, 0);
  const shares = staged.length && stagedTotal > 0 ? (Object.fromEntries(STACK_STAGES.map((k) => [k, sum(k) / stagedTotal])) as StageMinutes) : null;
  const avgStageMin = staged.length ? (Object.fromEntries(STACK_STAGES.map((k) => [k, sum(k) / staged.length])) as StageMinutes) : null;
  const timed = rec.filter((n) => n.bed !== null && n.wake !== null);
  const byAsleep = [...rec].sort((a, b) => a.asleepMin - b.asleepMin);
  const awake = rec.map((n) => n.awakeMin).filter((m): m is number => m !== null);
  return {
    slots,
    recorded: rec.length,
    avgAsleepMin: mean(rec.map((n) => n.asleepMin)),
    avgAwakeMin: mean(awake),
    stagedNights: staged.length,
    shares,
    avgStageMin,
    medianBed: median(timed.map((n) => fromSix(n.bed!, n.offsetS))),
    medianWake: median(timed.map((n) => fromSix(n.wake!, n.offsetS))),
    longest: byAsleep[byAsleep.length - 1] ?? null,
    shortest: byAsleep[0] ?? null,
    naps,
  };
}

/** Whole-percent shares that add up to 100 (largest remainder), in stack order. */
export function sharePercents(shares: StageMinutes): StageMinutes {
  const raw = STACK_STAGES.map((k) => shares[k] * 100);
  const floor = raw.map(Math.floor);
  let left = Math.round(raw.reduce((a, b) => a + b, 0)) - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const o of order) {
    if (left <= 0) break;
    floor[o.i]! += 1;
    left -= 1;
  }
  return Object.fromEntries(STACK_STAGES.map((k, i) => [k, floor[i]!])) as StageMinutes;
}

/* ------------------------------------------------------------------------------------------------ y scale (§7.3.4) */

/**
 * Hours axis: the ceiling is the next whole hour of max(longest, goal) × 1.1 (never a whole extra step: 8 h 10 → 9 h,
 * not 10 h); ticks every 2 h, or every hour when the ceiling is 6 h or less; only ticks ≤ the ceiling.
 */
export function yCeiling(longestMin: number, goalH?: number): { ceilingH: number; ticksH: number[] } {
  const top = Math.max(longestMin / 60, goalH ?? 0);
  const ceilingH = Math.max(1, Math.ceil((top > 0 ? top : 8) * 1.1 - 1e-9));
  const step = ceilingH <= 6 ? 1 : 2;
  const ticksH: number[] = [];
  for (let h = 0; h <= ceilingH; h += step) ticksH.push(h);
  return { ceilingH, ticksH };
}

/* ------------------------------------------------------------------------------------------------ columns */

export interface NightColumn {
  date: LocalDate;
  future: boolean;
  night: SleepNight | null;
  others: OtherSleep[];
}

/** One column per date of a week or month window (future slots carry `future`, never a night). */
export function nightColumns(w: PeriodWindow, byDate: ReadonlyMap<LocalDate, SleepDay>): NightColumn[] {
  return w.slots.map((s) => {
    const d = s.future ? undefined : byDate.get(s.start);
    return { date: s.start, future: s.future, night: d?.night ?? null, others: d?.others ?? [] };
  });
}

export interface MonthColumn {
  /** First date of the month. */
  start: LocalDate;
  future: boolean;
  /** Days of the month up to today. */
  days: number;
  recorded: number;
  avgAsleepMin: number | null;
  /** Column segments: the average asleep split by the stage shares of nights with stages (all unknown if none). */
  stack: StageMinutes | null;
  stats: SleepStats;
  provisional: boolean;
}

/** Twelve monthly columns of a year window (§7.3.6); the current month is truncated at today. */
export function monthColumns(w: PeriodWindow, byDate: ReadonlyMap<LocalDate, SleepDay>, today: LocalDate): MonthColumn[] {
  return w.slots.map((s) => {
    const last = addDays(s.end, -1);
    const upTo = s.future ? 0 : daysBetween(s.start, last < today ? last : today) + 1;
    const nights: Array<SleepNight | null> = [];
    let naps = 0;
    for (let i = 0; i < upTo; i++) {
      const d = byDate.get(addDays(s.start, i));
      nights.push(d?.night ?? null);
      naps += d?.others.length ?? 0;
    }
    const stats = sleepStats(nights, upTo, naps);
    const avg = stats.avgAsleepMin;
    const stack =
      avg === null
        ? null
        : stats.shares
          ? (Object.fromEntries(STACK_STAGES.map((k) => [k, avg * stats.shares![k]])) as StageMinutes)
          : { deep: 0, light: 0, rem: 0, unknown: avg };
    return {
      start: s.start, future: s.future, days: upTo, recorded: stats.recorded, avgAsleepMin: avg, stack, stats,
      provisional: nights.some((n) => n?.provisional),
    };
  });
}

/* ------------------------------------------------------------------------------------------------ actogram (§7.3.5) */

/** Minutes after 18:00 of the evening before the wake date (the actogram's y). */
export function actoMinutes(t: number, offsetS: number, wakeDate: LocalDate): number {
  return (t + offsetS * 1000 - Date.parse(`${addDays(wakeDate, -1)}T18:00:00Z`)) / MIN_MS;
}

/** The actogram's span in hours: 18:00 → 14:00 (20 h), extended in 4 h steps (to 28 h at most) when a nap ends later. */
export function actoSpanH(cols: readonly NightColumn[]): number {
  let latest = 0;
  for (const c of cols) for (const o of c.others) if (o.end !== null) latest = Math.max(latest, actoMinutes(o.end, o.offsetS, c.date));
  const h = latest / 60;
  return h <= 20 ? 20 : Math.min(28, 20 + Math.ceil((h - 20) / 4) * 4);
}

/* ------------------------------------------------------------------------------------------------ overnight lanes */

/** A gap in a line is any interval longer than max(3 × the median sample interval, 20 min) (§7.2). */
export function gapThresholdMs(points: readonly SeriesPoint[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i]!.t - points[i - 1]!.t);
  return Math.max(3 * (median(gaps) ?? 0), 20 * MIN_MS);
}

/** The lane's value for [from, to): the mean of samples inside; else the nearest sample within `half` of the middle. */
export function valueIn(points: readonly SeriesPoint[], from: number, to: number, half: number): number | null {
  let n = 0, s = 0, best: SeriesPoint | null = null;
  const mid = (from + to) / 2;
  for (const p of points) {
    if (p.t >= from && p.t < to) {
      n++;
      s += p.v;
    }
    if (Math.abs(p.t - mid) <= half && (!best || Math.abs(p.t - mid) < Math.abs(best.t - mid))) best = p;
  }
  return n ? s / n : best ? best.v : null;
}

/** How far from a bucket's middle a sample may be and still be its value: half the median interval, 2.5–15 min. */
export function nearHalfMs(points: readonly SeriesPoint[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i]!.t - points[i - 1]!.t);
  return Math.min(15 * MIN_MS, Math.max(2.5 * MIN_MS, (median(gaps) ?? 0) / 2));
}

export interface NightBucket {
  /** Bucket start (ms). */
  t: number;
  clock: string;
  /** Inside [bed, wake). */
  inNight: boolean;
  stage: NightStage | null;
  hr: number | null;
  spo2: number | null;
  /** Change from the person's normal, in the display unit. */
  temp: number | null;
}

export const BUCKET_MS = 5 * MIN_MS;

/** 5-minute buckets over [x0, x1): the crosshair stops and the table twin's rows (one source for both). */
export function nightBuckets(
  x0: number,
  x1: number,
  night: SleepNight,
  lanes: { hr: readonly SeriesPoint[]; spo2: readonly SeriesPoint[]; temp: readonly SeriesPoint[] },
): NightBucket[] {
  const halves = { hr: nearHalfMs(lanes.hr), spo2: nearHalfMs(lanes.spo2), temp: nearHalfMs(lanes.temp) };
  const out: NightBucket[] = [];
  for (let t = x0; t < x1; t += BUCKET_MS) {
    const e = t + BUCKET_MS;
    const hr = valueIn(lanes.hr, t, e, halves.hr);
    const spo2 = valueIn(lanes.spo2, t, e, halves.spo2);
    const temp = valueIn(lanes.temp, t, e, halves.temp);
    out.push({
      t,
      clock: clockAt(t, night.offsetS),
      inNight: night.bed !== null && night.wake !== null && t >= night.bed && t < night.wake,
      stage: stageAt(night.model, t + BUCKET_MS / 2),
      hr: hr === null ? null : Math.round(hr),
      spo2: spo2 === null ? null : Math.round(spo2),
      temp: temp === null ? null : Math.round(temp * 10) / 10,
    });
  }
  return out;
}

/** A lane's y scale hugging its data (CHART_SPEC §4.3): [min, max] + 10 %, 2–3 nice ticks inside. */
export function laneScale(values: readonly number[], opts: { include?: readonly number[]; minSpan?: number } = {}): { lo: number; hi: number; ticks: number[] } {
  const all = [...values, ...(opts.include ?? [])];
  if (!all.length) return { lo: 0, hi: 1, ticks: [] };
  let lo = Math.min(...all), hi = Math.max(...all);
  const minSpan = opts.minSpan ?? 1;
  if (hi - lo < minSpan) {
    const c = (lo + hi) / 2;
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const ticks = niceInside(lo, hi);
  return { lo, hi, ticks };
}

function niceInside(lo: number, hi: number): number[] {
  for (const target of [2, 3, 4]) {
    const raw = (hi - lo) / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
    if (out.length >= 2) return out.length > 3 ? out.filter((_, i) => i % 2 === 0) : out;
  }
  return [];
}

/** Local dates (at `offsetS`) that [from, to] touches, for `useSeries`. */
export function datesTouched(from: number, to: number, offsetS: number): LocalDate[] {
  const a = new Date(from + offsetS * 1000).toISOString().slice(0, 10) as LocalDate;
  const b = new Date(to + offsetS * 1000).toISOString().slice(0, 10) as LocalDate;
  const out: LocalDate[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ------------------------------------------------------------------------------------------------ normals */

/**
 * The person's normal skin temperature (absolute °C) for "change from your normal": the `bio.baselines` absolute
 * normal when one exists, else the Heart tab's rule (`tempNormal`: median of the nightly `skin_temp_c` over the last
 * `NORMAL_DAYS`, known from 14 nights), so the same night shows the same change on both tabs.
 */
export function tempNormalC(baselines: readonly SignalBaseline[] | null, history: readonly ResolvedDay[]): number | null {
  const b = baselines?.find((x) => (x.metric === 'skin_temp' || x.metric === 'skin_temp_c') && Number.isFinite(x.mean));
  if (b) return b.mean;
  const n = tempNormal(history);
  return n && n.basis === 'absolute' && !n.forming ? n.value : null;
}

/** The person's normal blood-oxygen range, only once it has 14 nights (§7.3.2). */
export function spo2Band(baselines: readonly SignalBaseline[] | null): { lo: number; hi: number } | null {
  const b = baselines?.find((x) => x.metric === 'spo2' || x.metric === 'spo2_pct' || x.metric === 'spo2_avg_pct');
  return b && b.nights >= 14 && !b.forming ? { lo: b.lo, hi: b.hi } : null;
}
