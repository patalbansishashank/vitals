/**
 * Heart and recovery models (design/screens/ring-pages.md §7.2, §7.4). Pure: no React, no clock; "now" and "today" are
 * arguments. Nothing is filled in: a gap between readings stays a gap (`max(3 × median interval, 20 min)`, E29
 * `runsOf`), a day without a record stays missing (never zero) and every average says it is over recorded slots only.
 */
import type { ResolvedDay } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import type { PeriodWindow, Slot } from '../models';
import { localOffsetS, runsOf, type SeriesPoint } from './ringData';
import { zoneOf, type Zone, type ZoneModel } from './zones';

/* ------------------------------------------------------------------------------------------------ numbers */

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Mean of the recorded values only; null when there are none. */
export function meanOf(values: ReadonlyArray<number | null | undefined>): number | null {
  const xs = values.filter(finite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function medianOf(values: ReadonlyArray<number | null | undefined>): number | null {
  const xs = values.filter(finite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/** Linear-interpolated percentile (p in 0..1) of a sorted list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** "Nice" ticks (1, 2, 2.5, 5 × 10ⁿ) that fall inside [lo, hi]: 2 or 3 of them (CHART_SPEC §4.3). */
export function niceTicks(lo: number, hi: number, max = 3): number[] {
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo] : [];
  const span = hi - lo;
  const steps = [1, 2, 2.5, 5];
  let mag = 10 ** Math.floor(Math.log10(span / max));
  for (let guard = 0; guard < 8; guard++) {
    for (const s of steps) {
      const step = s * mag;
      const first = Math.ceil(lo / step - 1e-9) * step;
      const out: number[] = [];
      for (let v = first; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
      if (out.length <= max && out.length >= 1) return out;
    }
    mag *= 10;
  }
  return [lo, hi];
}

/* ------------------------------------------------------------------------------------------------ gaps */

export const GAP_FLOOR_MS = 20 * 60_000;

/** Median spacing of consecutive samples (0 with fewer than two). */
export function medianInterval(points: readonly SeriesPoint[]): number {
  const d: number[] = [];
  for (let i = 1; i < points.length; i++) d.push(points[i]!.t - points[i - 1]!.t);
  return medianOf(d) ?? 0;
}

/** §7.2: a gap is any interval longer than `max(3 × median sample interval, 20 min)`. */
export function gapMs(points: readonly SeriesPoint[]): number {
  return Math.max(3 * medianInterval(points), GAP_FLOOR_MS);
}

/* ------------------------------------------------------------------------------------------------ downsampling */

/**
 * M4 per pixel column: in every column keep the first, lowest, highest and last sample (in time order), so the drawn
 * line keeps every peak and dip and every run boundary. `columns` is the plot width in px.
 */
export function m4(points: readonly SeriesPoint[], from: number, to: number, columns: number): SeriesPoint[] {
  const n = Math.max(1, Math.floor(columns));
  const span = Math.max(1, to - from);
  const out: SeriesPoint[] = [];
  let col = -1;
  let bucket: SeriesPoint[] = [];
  const flush = () => {
    if (!bucket.length) return;
    let lo = bucket[0]!, hi = bucket[0]!;
    for (const p of bucket) {
      if (p.v < lo.v) lo = p;
      if (p.v > hi.v) hi = p;
    }
    const keep = new Set([bucket[0]!, lo, hi, bucket[bucket.length - 1]!]);
    out.push(...bucket.filter((p) => keep.has(p)));
    bucket = [];
  };
  for (const p of points) {
    const c = Math.min(n - 1, Math.max(0, Math.floor(((p.t - from) / span) * n)));
    if (c !== col) {
      flush();
      col = c;
    }
    bucket.push(p);
  }
  flush();
  return out;
}

/** M4 only when there are more than two samples per pixel column (§7.4.2). */
export function downsampleFor(points: readonly SeriesPoint[], from: number, to: number, width: number): readonly SeriesPoint[] {
  return points.length > 2 * width ? m4(points, from, to, width) : points;
}

/* ------------------------------------------------------------------------------------------------ zone segments */

export interface ZoneSegment {
  /** null = no zones (no age set): the plain cardio line. 0 = resting range. */
  zone: Zone | null;
  points: SeriesPoint[];
}

/**
 * Splits one run into segments of one zone each. Where the line crosses a zone boundary the segment ends exactly at
 * the boundary (time interpolated linearly) and the next one starts there, so colours change at the boundary value,
 * not at a sample.
 */
export function zoneSegments(run: readonly SeriesPoint[], z: ZoneModel | null): ZoneSegment[] {
  if (!run.length) return [];
  if (!z) return [{ zone: null, points: [...run] }];
  const segs: ZoneSegment[] = [];
  let cur: ZoneSegment = { zone: zoneOf(run[0]!.v, z), points: [run[0]!] };
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!, b = run[i]!;
    const zb = zoneOf(b.v, z);
    if (zb === cur.zone) {
      cur.points.push(b);
      continue;
    }
    // every boundary between a and b, in the order the line meets them
    const up = b.v > a.v;
    const edges = z.lower.filter((e) => (up ? e > a.v && e <= b.v : e <= a.v && e > b.v)).sort((x, y) => (up ? x - y : y - x));
    for (const e of edges) {
      const t = a.t + ((e - a.v) / (b.v - a.v)) * (b.t - a.t);
      const at = { t, v: e };
      cur.points.push(at);
      segs.push(cur);
      // going up, the boundary value starts the upper zone; going down, the line is below it right after
      const next: Zone = up ? zoneOf(e, z) : (Math.max(0, zoneOf(e, z) - 1) as Zone);
      cur = { zone: next, points: [at] };
    }
    cur.points.push(b);
    cur.zone = zb;
  }
  segs.push(cur);
  return segs;
}

/** Runs (broken at gaps) of zone segments. */
export function lineSegments(points: readonly SeriesPoint[], z: ZoneModel | null, maxGapMs: number): ZoneSegment[][] {
  return runsOf(points, maxGapMs).map((r) => zoneSegments(r, z));
}

/* ------------------------------------------------------------------------------------------------ the day */

/**
 * Local midnight to the next local midnight (a day with a clock change is 23 or 25 hours long). The runtime's own
 * calendar gives each midnight at the offset in force at that instant (noon's offset would be an hour off on the day
 * the clocks change). `offsetS` is the offset at noon, for clock labels.
 */
export function dayBounds(date: LocalDate): { from: number; to: number; offsetS: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y, m - 1, d + 1).getTime();
  return { from, to, offsetS: localOffsetS(from + 12 * 3_600_000) };
}

export interface HrDayModel {
  /** Samples in the window, cut at now. */
  points: SeriesPoint[];
  lowest: SeriesPoint | null;
  highest: SeriesPoint | null;
  resting: number | null;
  readings: number;
  gapMs: number;
}

export function hrDayModel(points: readonly SeriesPoint[], opts: { from: number; to: number; resting?: number | null; now?: number }): HrDayModel {
  const end = opts.now !== undefined ? Math.min(opts.to, opts.now) : opts.to;
  const pts = points.filter((p) => p.t >= opts.from && p.t <= end && Number.isFinite(p.v));
  let lowest: SeriesPoint | null = null, highest: SeriesPoint | null = null;
  for (const p of pts) {
    if (!lowest || p.v < lowest.v) lowest = p;
    if (!highest || p.v > highest.v) highest = p;
  }
  return { points: pts, lowest, highest, resting: finite(opts.resting) ? opts.resting : null, readings: pts.length, gapMs: gapMs(pts) };
}

/**
 * y domain that hugs the data: p10–p90 plus 10 % padding, always including the resting value (and `include`). The
 * domain then widens to the day's lowest and highest reading, so no part of the line is ever cut off at the edge (a
 * clipped heart-rate line would read as a plateau).
 */
export function hugDomain(values: readonly number[], include: ReadonlyArray<number | null | undefined> = []): [number, number] {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  const extra = include.filter(finite);
  if (!xs.length && !extra.length) return [40, 100];
  let lo = xs.length ? percentile(xs, 0.1) : Infinity, hi = xs.length ? percentile(xs, 0.9) : -Infinity;
  for (const v of extra) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const pad = Math.max((hi - lo) * 0.1, 2);
  lo -= pad;
  hi += pad;
  if (xs.length) {
    lo = Math.min(lo, xs[0]! - pad / 2);
    hi = Math.max(hi, xs[xs.length - 1]! + pad / 2);
  }
  return [lo, hi];
}

/* ------------------------------------------------------------------------------------------------ normals */

export const NORMAL_NIGHTS = 14;
/** Days of history a local normal is computed over (bio.baselines uses 60). */
export const NORMAL_DAYS = 60;

export interface Normal {
  mean: number;
  median: number;
  /** Likely range: mean ± half a standard deviation (as bio.baselines). */
  lo: number;
  hi: number;
  nights: number;
  forming: boolean;
}

/** A personal normal from recorded values; null without any. Forming until 14 nights. */
export function normalOf(values: ReadonlyArray<number | null | undefined>): Normal | null {
  const xs = values.filter(finite);
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0;
  return { mean, median: medianOf(xs)!, lo: mean - 0.5 * sd, hi: mean + 0.5 * sd, nights: xs.length, forming: xs.length < NORMAL_NIGHTS };
}

/** A personal normal as the charts use it (bio.baselines or `normalOf`). */
export interface PersonalNormal {
  mean: number;
  lo: number;
  hi: number;
  nights: number;
  forming: boolean;
}

/** `bio.baselines` ids a blood-oxygen normal may come under (the service's id first). */
export const SPO2_BASELINE_IDS = ['spo2_avg_pct', 'spo2_pct', 'spo2'] as const;

/** The night's average blood oxygen (%): the day's figure, else the main sleep's. */
export const spo2NightOf = (d: ResolvedDay): number | undefined => d.daily?.spo2_avg_pct ?? d.mainSleep?.night?.spo2_avg_pct;

/**
 * The person's blood-oxygen normal (tier C: shown as change from it, ring-pages.md D6): bio.baselines first (it knows
 * device epochs), else one computed from the nightly averages given. Forming until 14 nights; null without any.
 */
export function spo2Normal(baselines: ReadonlyArray<{ metric: string; mean: number; lo: number; hi: number; nights: number; forming: boolean }> | null, history: readonly ResolvedDay[]): PersonalNormal | null {
  const b = SPO2_BASELINE_IDS.map((id) => baselines?.find((x) => x.metric === id && finite(x.mean))).find(Boolean);
  if (b) return { mean: b.mean, lo: b.lo, hi: b.hi, nights: b.nights, forming: b.forming || b.nights < NORMAL_NIGHTS };
  return normalOf(history.map(spo2NightOf));
}

/* ------------------------------------------------------------------------------------------------ per day / month */

export interface DayAgg {
  date: LocalDate;
  future: boolean;
  resting: number | null;
  lowest: number | null;
  highest: number | null;
  /** Samples that day (null when the samples were not loaded or there were none). */
  readings: number | null;
  recorded: boolean;
}

/**
 * Per-day lowest / highest / resting for week and month: from the day's record (the importer's full-day figures),
 * falling back to that day's loaded samples. A day with neither is missing (not zero); a future day draws nothing.
 */
export function dayAggregates(slots: readonly Slot[], days: readonly ResolvedDay[], points: readonly SeriesPoint[] | null): DayAgg[] {
  const by = new Map(days.map((d) => [d.localDate, d]));
  const perDay = new Map<LocalDate, SeriesPoint[]>();
  if (points) {
    const bounds = slots.map((s) => ({ date: s.start, ...dayBounds(s.start) }));
    let j = 0;
    for (const p of points) {
      while (j < bounds.length && p.t >= bounds[j]!.to) j++;
      const b = bounds[j];
      if (!b || p.t < b.from) continue;
      const list = perDay.get(b.date);
      if (list) list.push(p);
      else perDay.set(b.date, [p]);
    }
  }
  return slots.map((s) => {
    if (s.future) return { date: s.start, future: true, resting: null, lowest: null, highest: null, readings: null, recorded: false };
    const d = by.get(s.start)?.daily;
    const pts = perDay.get(s.start) ?? [];
    const vals = pts.map((p) => p.v);
    const lowest = finite(d?.hr_min_bpm) ? d.hr_min_bpm : vals.length ? Math.min(...vals) : null;
    const highest = finite(d?.hr_max_bpm) ? d.hr_max_bpm : vals.length ? Math.max(...vals) : null;
    const resting = finite(d?.resting_hr_bpm) ? d.resting_hr_bpm : null;
    return { date: s.start, future: false, resting, lowest, highest, readings: pts.length ? pts.length : null, recorded: resting !== null || lowest !== null || highest !== null };
  });
}

export interface MonthAgg {
  /** First date of the month. */
  date: LocalDate;
  future: boolean;
  /** Mean of the recorded days' resting values. */
  resting: number | null;
  lowest: number | null;
  highest: number | null;
  /** Recorded days in the month. */
  days: number;
  recorded: boolean;
}

/** Monthly points for the year (from per-day figures, recorded days only). */
export function monthAggregates(slots: readonly Slot[], days: readonly ResolvedDay[]): MonthAgg[] {
  return slots.map((s) => {
    if (s.future) return { date: s.start, future: true, resting: null, lowest: null, highest: null, days: 0, recorded: false };
    const inMonth = days.filter((d) => d.localDate >= s.start && d.localDate < s.end && d.daily);
    const recs = inMonth.filter((d) => finite(d.daily!.resting_hr_bpm) || finite(d.daily!.hr_min_bpm) || finite(d.daily!.hr_max_bpm));
    const lows = recs.map((d) => d.daily!.hr_min_bpm).filter(finite);
    const highs = recs.map((d) => d.daily!.hr_max_bpm).filter(finite);
    return {
      date: s.start,
      future: false,
      resting: meanOf(recs.map((d) => d.daily!.resting_hr_bpm)),
      lowest: lows.length ? Math.min(...lows) : null,
      highest: highs.length ? Math.max(...highs) : null,
      days: recs.length,
      recorded: recs.length > 0,
    };
  });
}

/** One value per slot (date or month) from a per-day getter: the day's value, or the month's mean of recorded days. */
export function slotValues(w: PeriodWindow, days: readonly ResolvedDay[], get: (d: ResolvedDay) => number | null | undefined): Array<{ value: number | null; n: number; future: boolean; start: LocalDate }> {
  const by = new Map(days.map((d) => [d.localDate, d]));
  return w.slots.map((s) => {
    if (s.future) return { value: null, n: 0, future: true, start: s.start };
    if (w.kind !== 'year') {
      const d = by.get(s.start);
      const v = d ? get(d) : undefined;
      return { value: finite(v) ? v : null, n: finite(v) ? 1 : 0, future: false, start: s.start };
    }
    const vals = days.filter((d) => d.localDate >= s.start && d.localDate < s.end).map(get).filter(finite);
    return { value: meanOf(vals), n: vals.length, future: false, start: s.start };
  });
}

/**
 * The 7-day mean per day of the window (recorded nights only, at least 3 of the 7), using the six days before the
 * window too. A day without its own value gets no mean, so the line never runs across a missing night.
 */
export function mean7(values: ReadonlyArray<number | null>, prior: ReadonlyArray<number | null>): number[] {
  const all = [...prior.slice(-6), ...values];
  const off = all.length - values.length;
  return values.map((v, i) => {
    if (v === null) return NaN;
    const win = all.slice(Math.max(0, off + i - 6), off + i + 1).filter(finite);
    return win.length >= 3 ? win.reduce((a, b) => a + b, 0) / win.length : NaN;
  });
}

/* ------------------------------------------------------------------------------------------------ nights */

export interface NightSpo2 {
  date: LocalDate;
  future: boolean;
  /** Absolute average and lowest (%), table only once the normal has formed. */
  avg: number | null;
  lowest: number | null;
  /** Change of the average and of the lowest from the person's normal (% points); null while the normal forms. */
  avgDev: number | null;
  lowestDev: number | null;
  recorded: boolean;
}

/**
 * Blood oxygen per night (week, month) or per month (year: mean of nightly averages, lowest of nightly lows), with the
 * change from the person's normal once it has formed.
 */
export function spo2Slots(w: PeriodWindow, days: readonly ResolvedDay[], normal: PersonalNormal | null = null): NightSpo2[] {
  const avg = slotValues(w, days, spo2NightOf);
  const ref = normal && !normal.forming ? normal.mean : null;
  const dev = (v: number | null) => (v !== null && ref !== null ? v - ref : null);
  return w.slots.map((s, i) => {
    if (s.future) return { date: s.start, future: true, avg: null, lowest: null, avgDev: null, lowestDev: null, recorded: false };
    const inSlot = days.filter((d) => d.localDate >= s.start && d.localDate < s.end);
    const lows = inSlot.map((d) => d.daily?.spo2_min_pct).filter(finite);
    const a = avg[i]!.value;
    const lowest = lows.length ? Math.min(...lows) : null;
    return { date: s.start, future: false, avg: a, lowest, avgDev: dev(a), lowestDev: dev(lowest), recorded: a !== null || lows.length > 0 };
  });
}

export interface TempNormal {
  /** How deviations are taken: absolute night temperature minus the normal, or the ring's delta minus its normal. */
  basis: 'absolute' | 'delta';
  /** The normal in °C (absolute: a temperature; delta: the person's usual delta). */
  value: number;
  nights: number;
  forming: boolean;
}

/**
 * The person's skin-temperature normal: the median of nightly absolute temperatures over the history given (as the
 * temperature score does), or, without absolute nights, the usual delta the ring reports (`deltaBaseline` from
 * bio.baselines when present).
 */
export function tempNormal(history: readonly ResolvedDay[], deltaBaseline?: { mean: number; nights: number; forming: boolean } | null): TempNormal | null {
  const abs = history.map((d) => d.daily?.skin_temp_c).filter(finite);
  if (abs.length) return { basis: 'absolute', value: medianOf(abs)!, nights: abs.length, forming: abs.length < NORMAL_NIGHTS };
  if (deltaBaseline) return { basis: 'delta', value: deltaBaseline.mean, nights: deltaBaseline.nights, forming: deltaBaseline.forming };
  const deltas = history.map((d) => d.daily?.skin_temp_delta_c ?? d.mainSleep?.night?.skin_temp_delta_c).filter(finite);
  if (!deltas.length) return null;
  return { basis: 'delta', value: medianOf(deltas)!, nights: deltas.length, forming: deltas.length < NORMAL_NIGHTS };
}

export interface NightTemp {
  date: LocalDate;
  future: boolean;
  /** Absolute night temperature (°C), table only. */
  abs: number | null;
  /** Change from the person's normal (°C); null while the normal forms or without a value. */
  dev: number | null;
  recorded: boolean;
}

/** Skin temperature per night (or per month: mean of nights) as change from the person's normal. */
export function tempSlots(w: PeriodWindow, days: readonly ResolvedDay[], normal: TempNormal | null): NightTemp[] {
  const devOf = (d: ResolvedDay): number | null => {
    if (!normal || normal.forming) return null;
    if (normal.basis === 'absolute') return finite(d.daily?.skin_temp_c) ? d.daily.skin_temp_c - normal.value : null;
    const delta = d.daily?.skin_temp_delta_c ?? d.mainSleep?.night?.skin_temp_delta_c;
    return finite(delta) ? delta - normal.value : null;
  };
  const abs = slotValues(w, days, (d) => d.daily?.skin_temp_c);
  const dev = slotValues(w, days, devOf);
  const any = slotValues(w, days, (d) => (finite(d.daily?.skin_temp_c) || finite(d.daily?.skin_temp_delta_c) || finite(d.mainSleep?.night?.skin_temp_delta_c) ? 1 : null));
  return w.slots.map((s, i) => ({
    date: s.start,
    future: s.future,
    abs: abs[i]!.value,
    dev: dev[i]!.value,
    recorded: !s.future && any[i]!.value !== null,
  }));
}

/* ------------------------------------------------------------------------------------------------ units */

export const toTempUnit = (c: number, unit: 'C' | 'F'): number => (unit === 'F' ? (c * 9) / 5 + 32 : c);
export const toTempDelta = (dc: number, unit: 'C' | 'F'): number => (unit === 'F' ? (dc * 9) / 5 : dc);
