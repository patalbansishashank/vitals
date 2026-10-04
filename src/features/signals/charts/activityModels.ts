/**
 * Activity models (design/screens/ring-pages.md §7.2, §7.5). Pure: "now" and "today" are arguments.
 * Missing is never zero: an hour with no sample and a day with no record are `null` (drawn as a stub, left out of every
 * average); a record that says 0 is 0 (nothing above the baseline). Future slots are flagged and draw nothing.
 */
import type { BioProvenance, ResolvedDay, SleepRecord, WorkoutRecord } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import { addDays, daysBetween } from '@/living/dates';
import type { Slot } from '../models';
import type { SeriesPoint } from './ringData';
import { timeInZones, type ZoneModel } from './zones';

/* ------------------------------------------------------------------------------------------------ scales */

const COARSE = [1, 2, 2.5, 5] as const;
const FINE = [1, 2, 2.5, 3, 4, 5, 6, 8] as const;

/**
 * The smallest "nice" number ≥ `raw`: 1, 2, 2.5 or 5 × 10ⁿ (`fine` adds 3, 4, 6 and 8, so a chart's ceiling sits closer
 * to its tallest column; the goal meter keeps the coarse steps so its majors land on minor ticks).
 */
export function niceStep(raw: number, fine = false): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of fine ? FINE : COARSE) if (m * p >= raw * (1 - 1e-9)) return m * p;
  return 10 * p;
}

/**
 * A y scale from 0: `count` nice steps up to a ceiling that clears the tallest value and the goal (5 % headroom for the
 * goal label). `fallback` is the ceiling of an empty period (the frame and axes stay).
 */
export function columnScale(
  maxValue: number,
  goal: number | undefined,
  count: number,
  fallback: number,
): { max: number; ticks: number[] } {
  const top = Math.max(maxValue > 0 ? maxValue : 0, goal && goal > 0 ? goal * 1.05 : 0) || fallback;
  const step = niceStep(top / count, true);
  const max = Math.ceil(top / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max, ticks };
}

/** "8k", "2.5k", "600": tick numerals that fit the 26–32 px tick column (tables carry the exact numbers). */
export function compactTick(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(v * 10) / 10);
}

/** A column with a rounded top (radius `r`, never more than half its width or its height); '' for a zero height. */
export function columnPath(x: number, top: number, width: number, base: number, r = 4): string {
  const h = base - top;
  if (!(h > 0) || !(width > 0)) return '';
  const rr = Math.min(r, width / 2, h);
  return `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + width - rr}Q${x + width},${top} ${x + width},${top + rr}V${base}Z`;
}

/* ------------------------------------------------------------------------------------------------ goal meter */

/** §7.5.1 domain: 0 → max(goal × 1.25, value × 1.05); no goal: value × 1.25 (0 = nothing to scale: an empty well). */
export function goalMeterMax(value: number | null, goal?: number): number {
  const v = value !== null && value > 0 ? value : 0;
  if (goal !== undefined && goal > 0) return Math.max(goal * 1.25, v * 1.05);
  return v * 1.25;
}

export interface MeterTick {
  v: number;
  major: boolean;
  /** The goal tick (drawn taller, labelled "goal 8 000"). */
  goal?: boolean;
  /** Numeral under a major tick ("0", "4 000"); the goal's own label comes from the copy. */
  numeral?: boolean;
}

/** Minor ticks at 10 % of the goal, majors at 0, ½ goal and the goal; without a goal, nice steps of the value scale. */
export function goalMeterTicks(max: number, goal?: number): MeterTick[] {
  if (!(max > 0)) return [];
  const out: MeterTick[] = [];
  if (goal !== undefined && goal > 0) {
    const minor = goal / 10;
    for (let k = 0; k * minor <= max * (1 + 1e-9); k++) {
      const v = k * minor;
      if (k === 10) out.push({ v, major: true, goal: true });
      else if (k === 0 || k === 5) out.push({ v, major: true, numeral: true });
      else out.push({ v, major: false });
    }
    return out;
  }
  const minor = niceStep(max / 10);
  const major = niceStep(max / 2);
  for (let k = 0; k * minor <= max * (1 + 1e-9); k++) {
    const v = Math.round(k * minor * 1000) / 1000;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    out.push({ v, major: isMajor, numeral: isMajor });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ hours */

export interface HourSlot {
  hour: number;
  /** Local start and end of the hour (ms). */
  start: number;
  end: number;
  /** null = no sample in this hour (missing); 0 = samples that add up to 0. */
  steps: number | null;
  /** The hour starts after now: draw nothing. */
  future: boolean;
}

const ymdOf = (date: LocalDate): [number, number, number] =>
  date.split('-').map(Number) as [number, number, number];

/** Local [start, end) of a calendar date in ms (a 23 h or 25 h day is still one day). */
export function localDayBounds(date: LocalDate): { start: number; end: number } {
  const [y, m, d] = ymdOf(date);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

/** Local dates an interval touches ([from, to], ms), oldest first. */
export function datesTouched(from: number, to: number): LocalDate[] {
  const f = new Date(from),
    t = new Date(Math.max(from, to));
  const first = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  const last = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const out: LocalDate[] = [];
  for (let d = first; d <= last && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Steps per local hour of `date` from step samples: an hour with no sample is missing (null), an hour whose samples add
 * up to 0 is 0, an hour that starts after `nowMs` is future (no value, drawn as nothing).
 */
export function stepsByHour(points: readonly SeriesPoint[], date: LocalDate, nowMs: number): HourSlot[] {
  const [y, m, d] = ymdOf(date);
  const slots: HourSlot[] = Array.from({ length: 24 }, (_, h) => {
    const start = new Date(y, m - 1, d, h).getTime();
    return {
      hour: h,
      start,
      end: new Date(y, m - 1, d, h + 1).getTime(),
      steps: null,
      future: start > nowMs,
    };
  });
  for (const p of points) {
    if (!Number.isFinite(p.v)) continue;
    const t = new Date(p.t);
    if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) continue;
    const s = slots[t.getHours()]!;
    if (s.future) continue;
    s.steps = (s.steps ?? 0) + Math.max(0, p.v);
  }
  for (const s of slots) if (s.steps !== null) s.steps = Math.round(s.steps);
  return slots;
}

/** Sleep sessions clipped to [dayStart, dayEnd) (the steps-by-hour shading: a quiet night reads as asleep). */
export function sleepBands(
  sleeps: readonly SleepRecord[],
  dayStart: number,
  dayEnd: number,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const s of sleeps) {
    if (!s.time.start || !s.time.end) continue;
    const from = Math.max(dayStart, Date.parse(s.time.start)),
      to = Math.min(dayEnd, Date.parse(s.time.end));
    if (to > from) out.push({ from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/* ------------------------------------------------------------------------------------------------ days */

export interface ActivityDay {
  date: LocalDate;
  future: boolean;
  steps: number | null;
  /** light + moderate + vigorous minutes. */
  activeMin: number | null;
  activeKcal: number | null;
  distanceM: number | null;
  /** Workouts recorded that day (0 when the day has records but no workout). */
  workouts: number;
  /** Any record for the day (daily, sleep or workout). */
  any: boolean;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function activeMinOf(d: ResolvedDay['daily']): number | null {
  const am = d?.active_min;
  if (!am) return null;
  const sum = (finite(am.light) ?? 0) + (finite(am.moderate) ?? 0) + (finite(am.vigorous) ?? 0);
  return Math.round(sum);
}

/** One entry per day slot of a week or month, oldest first; a day without a record carries nulls. */
export function activityDays(days: readonly ResolvedDay[], slots: readonly Slot[]): ActivityDay[] {
  const by = new Map(days.map((d) => [d.localDate, d]));
  return slots.map((s) => {
    const r = s.future ? undefined : by.get(s.start);
    const daily = r?.daily;
    return {
      date: s.start,
      future: s.future,
      steps: finite(daily?.steps),
      activeMin: activeMinOf(daily),
      activeKcal: finite(daily?.active_kcal),
      distanceM: finite(daily?.distance_m),
      workouts: r?.workouts.length ?? 0,
      any: Boolean(r),
    };
  });
}

/** Mean of the recorded values only (null and non-finite left out), with how many there were. */
export function recordedAverage(values: ReadonlyArray<number | null>): { avg: number | null; n: number } {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return { avg: known.length ? known.reduce((s, v) => s + v, 0) / known.length : null, n: known.length };
}

/** Days up to today (`elapsed`), those with a value (`recorded`) and those at or over the goal (`at`): a count, never a streak. */
export function goalCount(
  days: readonly ActivityDay[],
  pick: (d: ActivityDay) => number | null,
  goal: number | undefined,
  today: LocalDate,
): { at: number; recorded: number; elapsed: number } {
  let at = 0,
    recorded = 0,
    elapsed = 0;
  for (const d of days) {
    if (d.future || d.date > today) continue;
    elapsed++;
    const v = pick(d);
    if (v === null) continue;
    recorded++;
    if (goal !== undefined && goal > 0 && v >= goal) at++;
  }
  return { at, recorded, elapsed };
}

/* ------------------------------------------------------------------------------------------------ months (year) */

export interface MonthActivity {
  /** First date of the month. */
  start: LocalDate;
  end: LocalDate;
  future: boolean;
  current: boolean;
  /** Average steps per recorded day (null: no day of the month recorded). */
  avgSteps: number | null;
  avgActiveMin: number | null;
  /** Days with a steps record. */
  recorded: number;
  /** Days of the month up to today (the denominator of "21/31"). */
  days: number;
  /** Workouts in the month; null when the month has no record at all (missing, not zero). */
  workouts: number | null;
}

export function monthlyActivity(
  days: readonly ResolvedDay[],
  slots: readonly Slot[],
  today: LocalDate,
): MonthActivity[] {
  return slots.map((s) => {
    if (s.future)
      return {
        start: s.start,
        end: s.end,
        future: true,
        current: false,
        avgSteps: null,
        avgActiveMin: null,
        recorded: 0,
        days: 0,
        workouts: null,
      };
    const inMonth = days.filter((d) => d.localDate >= s.start && d.localDate < s.end && d.localDate <= today);
    const steps = recordedAverage(inMonth.map((d) => finite(d.daily?.steps)));
    const active = recordedAverage(inMonth.map((d) => activeMinOf(d.daily)));
    const last = addDays(s.end, -1) < today ? addDays(s.end, -1) : today;
    return {
      start: s.start,
      end: s.end,
      future: false,
      current: s.current,
      avgSteps: steps.avg,
      avgActiveMin: active.avg,
      recorded: steps.n,
      days: daysBetween(s.start, last) + 1,
      workouts: inMonth.length ? inMonth.reduce((n, d) => n + d.workouts.length, 0) : null,
    };
  });
}

/* ------------------------------------------------------------------------------------------------ workouts */

export type WorkoutSource = 'ring' | 'hand' | 'import';

/** "from your ring" / "logged by hand" / "from an import", from the record's provenance (never a brand or device name). */
export function workoutSource(p: BioProvenance): WorkoutSource {
  if (p.channel === 'manual' || p.recording_method === 'manual' || p.modality === 'self_reported')
    return 'hand';
  if (
    p.device?.type === 'ring' ||
    p.channel.startsWith('ble:') ||
    /^(file:lumen_|mqtt:lumen)/.test(p.channel)
  )
    return 'ring';
  return 'import';
}

export interface WorkoutItem {
  id: string;
  date: LocalDate;
  /** ms */
  start: number;
  end: number;
  /** The record's own offset (s east of UTC) for clock times. */
  offsetS: number;
  type: string;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  activeKcal: number | null;
  source: WorkoutSource;
}

export function workoutItem(w: WorkoutRecord): WorkoutItem | null {
  if (!w.time.start) return null;
  const start = Date.parse(w.time.start);
  if (!Number.isFinite(start)) return null;
  const endParsed = w.time.end ? Date.parse(w.time.end) : NaN;
  const end =
    Number.isFinite(endParsed) && endParsed > start
      ? endParsed
      : start + Math.max(0, w.active_duration_s) * 1000;
  return {
    id: w.record_id,
    date: w.time.local_date,
    start,
    end,
    offsetS: w.time.tz_offset_s,
    type: w.exercise_type,
    durationS: w.active_duration_s,
    avgHr: finite(w.hr_avg_bpm),
    maxHr: finite(w.hr_max_bpm),
    distanceM: finite(w.distance_m),
    activeKcal: finite(w.active_kcal),
    source: workoutSource(w.provenance),
  };
}

/** Every workout of the days, newest first. */
export function workoutItems(days: readonly ResolvedDay[]): WorkoutItem[] {
  return days
    .flatMap((d) => d.workouts)
    .map(workoutItem)
    .filter((w): w is WorkoutItem => w !== null)
    .sort((a, b) => b.start - a.start);
}

/** Rows grouped by day (newest day first, the order of `items`). */
export function groupByDay(items: readonly WorkoutItem[]): Array<{ date: LocalDate; items: WorkoutItem[] }> {
  const out: Array<{ date: LocalDate; items: WorkoutItem[] }> = [];
  for (const w of items) {
    const g = out.find((x) => x.date === w.date);
    if (g) g.items.push(w);
    else out.push({ date: w.date, items: [w] });
  }
  return out;
}

/** A gap in a line (§7.2): longer than max(3 × median sample interval, 20 min). */
export function gapLimitMs(points: readonly SeriesPoint[]): number {
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i]!.t - points[i - 1]!.t;
    if (dt > 0) dts.push(dt);
  }
  dts.sort((a, b) => a - b);
  const median = dts.length ? dts[Math.floor(dts.length / 2)]! : 0;
  return Math.max(3 * median, 20 * 60_000);
}

/** Samples inside a workout's window. */
export function samplesIn(points: readonly SeriesPoint[], from: number, to: number): SeriesPoint[] {
  return points.filter((p) => p.t >= from && p.t <= to);
}

/** Minutes per zone (index 0 = resting range) over the workout's heart-rate samples; null without zones or samples. */
export function workoutZoneMinutes(
  points: readonly SeriesPoint[],
  w: Pick<WorkoutItem, 'start' | 'end'>,
  zones: ZoneModel | null,
): number[] | null {
  if (!zones) return null;
  const inside = samplesIn(points, w.start, w.end);
  if (inside.length < 2) return null;
  return timeInZones(inside, zones, gapLimitMs(inside));
}

/** Average and highest heart rate of samples (null when none). */
export function hrStats(points: readonly SeriesPoint[]): { avg: number; max: number } | null {
  if (!points.length) return null;
  let sum = 0,
    max = -Infinity;
  for (const p of points) {
    sum += p.v;
    if (p.v > max) max = p.v;
  }
  return { avg: Math.round(sum / points.length), max: Math.round(max) };
}
