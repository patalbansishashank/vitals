/* ==========================================================================
   Living-mode chart helpers (CHART_SPEC §7.8–7.10): pure scales, paths,
   summaries and table rows for <TrendLane> and <ScoreHistory>, the date
   maths the calendar shares, and the quiet vocabulary (COMPONENTS §13.9).
   No React, no DOM. Y-scales hug the data and print 2–3 nice ticks inside
   the domain (§4.3); x labels are dates ("1 Oct"), never smaller than 11 px.
   ========================================================================== */
import type { ChartData, ChartEvent, ChartSeries } from '../types';
import { formatNumber, formatRange, THIN } from '../lib/format';
import { niceTicksInside, type TickSet } from '../lib/ticks';
import type { ScoreHistoryData, TrendLaneData } from './types';

export type TrendSize = 'today' | 'progress' | 'checkin';

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function utc(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

/** ISO date `n` days after `iso` (calendar days, no time zone drift). */
export function isoAddDays(iso: string, n: number): string {
  const t = utc(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + Math.round(n) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function isoDaysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** Monday = 0 … Sunday = 6. */
export function isoWeekday(iso: string): number {
  const t = utc(iso);
  return Number.isFinite(t) ? (new Date(t).getUTCDay() + 6) % 7 : 0;
}

/** "Wed 1 Oct" (long) · "1 Oct" (short). */
export function dateLabel(iso: string, style: 'long' | 'short' = 'long'): string {
  const t = utc(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const s = `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
  return style === 'long' ? `${WEEKDAY[d.getUTCDay()]} ${s}` : s;
}

/** "21 December" (+ year on request). */
export function spokenDate(iso: string, withYear = false): string {
  const t = utc(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** "21 to 30 December" · "28 December to 3 January" · years spelled out when they differ. */
export function spokenDateRange(from: string, to: string): string {
  if (from === to) return spokenDate(from);
  const a = new Date(utc(from));
  const b = new Date(utc(to));
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return `${from} to ${to}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${spokenDate(from, true)} to ${spokenDate(to, true)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} to ${b.getUTCDate()} ${MONTH_LONG[b.getUTCMonth()]}`;
  return `${spokenDate(from)} to ${spokenDate(to)}`;
}

/** "October 2026" for "2026-10". */
export function monthTitle(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${MONTH_LONG[m - 1] ?? ''} ${y}`.trim();
}

const SPOKEN_UNIT: Record<string, string> = {
  kg: 'kilograms',
  lb: 'pounds',
  ms: 'milliseconds',
  bpm: 'beats per minute',
  '%': 'percent',
  h: 'hours',
  min: 'minutes',
  'mL/kg/min': 'millilitres per kilogram per minute',
  '°C': 'degrees Celsius',
};

/** "kilograms" for "kg"; unknown units are read as written. */
export const spokenUnit = (unit: string): string => SPOKEN_UNIT[unit] ?? unit;

/* ------------------------------------------------------- quiet vocabulary */

/** COMPONENTS §13.9: ≥ 85 "as planned" · 60–84 "mostly" · 30–59 "partly" · < 30 "a little" · null → `nullWord`. */
export function quietScoreWord(score: number | null, nullWord = 'not enough logged'): string {
  if (score === null || !Number.isFinite(score)) return nullWord;
  if (score >= 85) return 'as planned';
  if (score >= 60) return 'mostly';
  if (score >= 30) return 'partly';
  return 'a little';
}

/* ---------------------------------------------------------- scale helpers */

type Lists = Array<ArrayLike<number> | undefined>;

/** Finite min / max over several arrays, or null when there is no finite value. */
export function finiteExtent(...lists: Lists): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of lists) {
    if (!l) continue;
    for (let i = 0; i < l.length; i++) {
      const v = l[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Hug the data (CHART_SPEC §4.3): [lo − 10 %, hi + 10 %] of the span, never rounded outward to nice numbers. A flat
 * series gets a minimum span of four display steps (0.4 kg at one decimal) so it reads as flat, not as noise.
 */
export function hugDomain(lo: number, hi: number, decimals: number): [number, number] {
  const minSpan = 4 * 10 ** -Math.max(0, decimals);
  let a = lo;
  let b = hi;
  if (b - a < minSpan) {
    const c = (a + b) / 2;
    a = c - minSpan / 2;
    b = c + minSpan / 2;
  }
  const pad = (b - a) * 0.1;
  return [a - pad, b + pad];
}

/** SVG polyline through the finite values; NaN breaks the line; an isolated value becomes a round dot. */
export function linePath(values: ArrayLike<number>, X: (i: number) => number, Y: (v: number) => number): string {
  let d = '';
  let open = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      open = false;
      continue;
    }
    const next = i + 1 < values.length ? values[i + 1]! : NaN;
    const x = X(i).toFixed(1);
    const y = Y(v).toFixed(1);
    if (!open) {
      d += `M${x},${y}`;
      if (!Number.isFinite(next)) d += 'h0.01';
      open = true;
    } else d += `L${x},${y}`;
  }
  return d;
}

/**
 * A line that must not run straight through certain days (a new device): the solid path breaks before each `break`
 * day, and `joins` lists the dashed segments that bridge the last value before it and the first value from it.
 */
export function linePathWithBreaks(
  values: ArrayLike<number>,
  breaks: readonly number[],
  X: (i: number) => number,
  Y: (v: number) => number,
): { solid: string; joins: Array<{ x1: number; y1: number; x2: number; y2: number }> } {
  const cut = new Set(breaks);
  let solid = '';
  let open = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (cut.has(i)) open = false;
    if (!Number.isFinite(v)) {
      open = false;
      continue;
    }
    const next = i + 1 < values.length && !cut.has(i + 1) ? values[i + 1]! : NaN;
    const p = `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    if (!open) {
      solid += `M${p}${Number.isFinite(next) ? '' : 'h0.01'}`;
      open = true;
    } else solid += `L${p}`;
  }
  const joins: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const d of breaks) {
    let a = d - 1;
    while (a >= 0 && !Number.isFinite(values[a]!)) a--;
    let b = d;
    while (b < values.length && !Number.isFinite(values[b]!)) b++;
    if (a >= 0 && b < values.length) joins.push({ x1: X(a), y1: Y(values[a]!), x2: X(b), y2: Y(values[b]!) });
  }
  return { solid, joins };
}

/** Closed band polygons over every run where both bounds are finite (runs of one day are skipped: no area). */
export function bandPath(lo: ArrayLike<number>, hi: ArrayLike<number>, X: (i: number) => number, Y: (v: number) => number): string {
  const n = Math.min(lo.length, hi.length);
  let d = '';
  let i = 0;
  while (i < n) {
    if (!Number.isFinite(lo[i]!) || !Number.isFinite(hi[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && Number.isFinite(lo[j + 1]!) && Number.isFinite(hi[j + 1]!)) j++;
    if (j > i) {
      let p = '';
      for (let k = i; k <= j; k++) p += `${k === i ? 'M' : 'L'}${X(k).toFixed(1)},${Y(hi[k]!).toFixed(1)}`;
      for (let k = j; k >= i; k--) p += `L${X(k).toFixed(1)},${Y(lo[k]!).toFixed(1)}`;
      d += `${p}Z`;
    }
    i = j + 1;
  }
  return d;
}

/* ----------------------------------------------------------- plot frames */

export interface PlotFrame {
  width: number;
  height: number;
  /** Data area (the tick column sits left of px0, inside the plot). */
  px0: number;
  px1: number;
  py0: number;
  py1: number;
  /** Pixels per day. */
  slot: number;
  days: number;
  lo: number;
  hi: number;
  ticks: TickSet;
  /** Centre of day `d`. */
  X: (d: number) => number;
  Y: (v: number) => number;
  /** Nearest day to an x position (px, relative to the svg). */
  dayAt: (x: number) => number;
}

function frame(width: number, height: number, days: number, m: { l: number; r: number; t: number; b: number }, lo: number, hi: number): PlotFrame {
  const n = Math.max(1, days);
  const px0 = m.l;
  const px1 = Math.max(px0 + 1, width - m.r);
  const py0 = m.t;
  const py1 = Math.max(py0 + 1, height - m.b);
  const slot = (px1 - px0) / n;
  const span = hi - lo || 1;
  return {
    width,
    height,
    px0,
    px1,
    py0,
    py1,
    slot,
    days: n,
    lo,
    hi,
    ticks: niceTicksInside(lo, hi, { min: 2, max: 3 }),
    X: (d) => px0 + (d + 0.5) * slot,
    Y: (v) => py0 + (1 - (v - lo) / span) * (py1 - py0),
    dayAt: (x) => Math.max(0, Math.min(n - 1, Math.round((x - px0) / slot - 0.5))),
  };
}

/** Printed tick column inside the plot (CHART_SPEC §4.3): 32 px, 26 px under 500 px wide. */
export const tickColumn = (width: number): number => (width < 500 ? 26 : 32);

/* ---------------------------------------------------------------- x ticks */

export interface DayTick {
  day: number;
  x: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
}

/** Rough width of an 11 px condensed label (numerals, dates). */
export const labelPx = (text: string): number => text.length * 5.6;

/** Rough width of an 11 px engraved label (500 weight, normal width). */
export const engravedPx = (text: string): number => text.length * 6.2;

export interface PlacedLabel {
  x: number;
  anchor: 'start' | 'end';
  /** False when the label would overprint a neighbour: the mark stays, the text lives in the readout and table. */
  show: boolean;
}

/**
 * Greedy placement of engraved labels along one row (CHART_SPEC §4.5): left to right, each label right of its mark,
 * else left of it; a label that would overlap the previous one or leave [minX, maxX] is dropped — never overprinted.
 */
export function placeLabels(items: ReadonlyArray<{ x: number; text: string }>, minX: number, maxX: number, gap = 6): PlacedLabel[] {
  const out: PlacedLabel[] = items.map((it) => ({ x: it.x, anchor: 'start', show: false }));
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.x - b.x);
  let right = -Infinity;
  for (const it of order) {
    const w = engravedPx(it.text);
    const r0 = it.x + 3;
    const l1 = it.x - 3;
    if (r0 >= right + gap && r0 + w <= maxX) {
      out[it.i] = { x: r0, anchor: 'start', show: true };
      right = r0 + w;
    } else if (l1 - w >= Math.max(minX, right + gap)) {
      out[it.i] = { x: l1, anchor: 'end', show: true };
      right = l1;
    }
  }
  return out;
}

/**
 * Date labels for a day axis: up to 14 days → every 1st, 2nd, 3rd or 7th day by width, counted back from `anchorDay`
 * (today) so today is always labelled; longer windows → Mondays, every 1, 2, 4 or 8 weeks by width.
 */
export function dayTicks(startDate: string, f: PlotFrame, anchorDay: number | null): DayTick[] {
  const need = labelPx('30 Sep') + 12;
  const out: DayTick[] = [];
  const push = (d: number) => {
    const label = dateLabel(isoAddDays(startDate, d), 'short');
    const x = f.X(d);
    const half = labelPx(label) / 2;
    const anchor = x - half < 0 ? 'start' : x + half > f.width ? 'end' : 'middle';
    out.push({ day: d, x, label, anchor });
  };
  if (f.days <= 14) {
    const step = [1, 2, 3, 7].find((s) => s * f.slot >= need) ?? 7;
    const a = anchorDay ?? f.days - 1;
    for (let d = 0; d < f.days; d++) if ((((a - d) % step) + step) % step === 0) push(d);
    return out;
  }
  let weeks = 1;
  while (weeks * 7 * f.slot < need && weeks < 64) weeks *= 2;
  const firstMonday = (7 - isoWeekday(startDate)) % 7;
  for (let d = firstMonday, k = 0; d < f.days; d += 7, k++) if (k % weeks === 0) push(d);
  return out;
}

/* ============================================================ trend lane */

export interface TrendDomain {
  lo: number;
  hi: number;
  /** Where the goal sits relative to the domain (`none` = no goal). */
  goal: 'inside' | 'above' | 'below' | 'none';
}

/**
 * Y-domain of the trend lane: hugs the realistic and as-prescribed bands, the weigh-ins and the trend (+10 %). The goal
 * stretches the domain only on `progress`; elsewhere a far goal becomes an edge label instead.
 */
export function trendDomain(data: TrendLaneData, size: TrendSize): TrendDomain {
  const goal = data.goal?.value;
  const ext = finiteExtent(
    data.trend,
    data.weighIns.map((w) => w.value),
    data.realistic?.p10,
    data.realistic?.p90,
    data.realistic?.p50,
    data.asPrescribed?.p10,
    data.asPrescribed?.p90,
    size === 'progress' && goal !== undefined ? [goal] : undefined,
  ) ?? (goal !== undefined && Number.isFinite(goal) ? [goal, goal] : [0, 1]);
  const [lo, hi] = hugDomain(ext[0], ext[1], data.decimals);
  const pos = goal === undefined || !Number.isFinite(goal) ? 'none' : goal > hi ? 'above' : goal < lo ? 'below' : 'inside';
  return { lo, hi, goal: pos };
}

/** Default heights: today 64–96 (88), progress 240 (180 under 640 px wide), check-in 160. */
export function trendHeight(size: TrendSize, width: number, height?: number): number {
  if (size === 'today') return Math.max(64, Math.min(96, height ?? 88));
  if (height !== undefined) return height;
  return size === 'progress' ? (width < 640 ? 180 : 240) : 160;
}

export interface GoalBracket {
  x0: number;
  x1: number;
  /** The range continues past the left / right edge of the window. */
  clipLeft: boolean;
  clipRight: boolean;
  /** The whole range lies before / after the window: only an arrow and the label at that edge. */
  outside: 'before' | 'after' | null;
  label: string;
}

export interface TrendLayout extends PlotFrame {
  size: TrendSize;
  domain: TrendDomain;
  quiet: boolean;
  /** Baseline of the date labels. */
  xRowY: number;
  /** Centre line of the bracket row (null: no row; an outside bracket shares the date row). */
  bracketRowY: number | null;
  bracket: GoalBracket | null;
  xTicks: DayTick[];
  /** Top margin holds event labels. */
  eventRow: boolean;
}

/** Everything the trend lane needs to draw, from the data and the container width. Pure. */
export function trendLayout(data: TrendLaneData, size: TrendSize, width: number, opts: { height?: number; quiet?: boolean } = {}): TrendLayout {
  const quiet = opts.quiet ?? false;
  const height = trendHeight(size, width, opts.height);
  const domain = trendDomain(data, size);
  const eventRow = (data.events ?? []).length > 0;
  const days = Math.max(1, data.days);
  // where the goal-date range falls relative to the window
  let fromIdx = 0;
  let toIdx = 0;
  let outside: GoalBracket['outside'] = null;
  const g = data.goalDateRange;
  if (g) {
    fromIdx = isoDaysBetween(data.startDate, g.from);
    toIdx = isoDaysBetween(data.startDate, g.to);
    if (toIdx < fromIdx) [fromIdx, toIdx] = [toIdx, fromIdx];
    outside = fromIdx > days - 1 ? 'after' : toIdx < 0 ? 'before' : null;
  }
  const bracketRow = !!g && outside === null;
  // the top row holds event labels and the unit over the tick column (quiet: no unit, no numerals)
  const m = { l: quiet ? 4 : tickColumn(width), r: 8, t: eventRow || !quiet ? 16 : 6, b: 17 + (bracketRow ? 16 : 0) };
  const f = frame(width, height, days, m, domain.lo, domain.hi);
  let bracket: GoalBracket | null = null;
  if (g) {
    if (outside === 'after') bracket = { x0: f.px1, x1: f.px1, clipLeft: false, clipRight: true, outside, label: g.label };
    else if (outside === 'before') bracket = { x0: f.px0, x1: f.px0, clipLeft: true, clipRight: false, outside, label: g.label };
    else
      bracket = {
        x0: Math.max(f.px0, f.px0 + fromIdx * f.slot),
        x1: Math.min(f.px1, f.px0 + (toIdx + 1) * f.slot),
        clipLeft: fromIdx < 0,
        clipRight: toIdx > days - 1,
        outside: null,
        label: g.label,
      };
  }
  let xTicks = dayTicks(data.startDate, f, data.todayIndex);
  if (bracket?.outside) {
    // the edge label shares the date row: drop the dates it would overprint
    const w = engravedPx(bracket.label) + 14;
    const [a, b] = bracket.outside === 'after' ? [f.px1 - w, f.px1 + 8] : [f.px0 - 8, f.px0 + w];
    xTicks = xTicks.filter((t) => {
      const half = labelPx(t.label) / 2;
      const l = t.anchor === 'start' ? t.x : t.anchor === 'end' ? t.x - 2 * half : t.x - half;
      const r = l + 2 * half;
      return r < a - 4 || l > b + 4;
    });
  }
  return {
    ...f,
    size,
    domain,
    quiet,
    xRowY: f.py1 + 13,
    bracketRowY: bracketRow ? f.py1 + 24 : null,
    bracket,
    xTicks,
    eventRow,
  };
}

/** Last day index with a finite trend value at or before today (or the window end). */
export function lastTrendDay(data: TrendLaneData): number {
  const end = Math.min(data.days - 1, data.todayIndex ?? data.days - 1);
  for (let i = end; i >= 0; i--) if (Number.isFinite(data.trend[i] ?? NaN)) return i;
  return Math.max(0, end);
}

/** Direction of the trend over the window up to today, rounded to the display decimals. */
export function trendDirection(data: TrendLaneData): 'down' | 'up' | 'level' | null {
  const end = Math.min(data.days - 1, data.todayIndex ?? data.days - 1);
  let first = NaN;
  let last = NaN;
  for (let i = 0; i <= end; i++) {
    const v = data.trend[i] ?? NaN;
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(first)) first = v;
    last = v;
  }
  if (!Number.isFinite(first)) return null;
  const delta = Number((last - first).toFixed(Math.max(0, data.decimals)));
  return delta === 0 ? 'level' : delta < 0 ? 'down' : 'up';
}

const DIRECTION_WORD = { down: 'going down', up: 'going up', level: 'level' } as const;

const val = (v: number, data: { decimals: number; unit: string }) => `${formatNumber(v, data.decimals)}${THIN}${data.unit}`;

function expectedAt(data: TrendLaneData, day: number): [number, number] | null {
  const lo = data.realistic?.p10[day] ?? NaN;
  const hi = data.realistic?.p90[day] ?? NaN;
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** The line above the plot: "trend 83.1 kg (±0.3) · expected today 82.8–83.6"; quiet: "trend going down". */
export function trendReadoutText(data: TrendLaneData, quiet = false): string {
  if (quiet) {
    const dir = trendDirection(data);
    return dir ? `trend ${DIRECTION_WORD[dir]}` : 'trend starts after about a week of weigh-ins';
  }
  const i = lastTrendDay(data);
  const v = data.trend[i] ?? NaN;
  if (!Number.isFinite(v)) return 'trend starts after about a week of weigh-ins';
  const sd = data.trendSd?.[i];
  const parts = [`trend ${val(v, data)}${sd !== undefined && Number.isFinite(sd) ? ` (±${formatNumber(sd, data.decimals)})` : ''}`];
  const ex = data.todayIndex !== null ? expectedAt(data, data.todayIndex) : null;
  if (ex) parts.push(`expected today ${formatRange(ex[0], ex[1], data.decimals)}`);
  return parts.join(' · ');
}

/**
 * The chart's accessible summary: "Weight trend 83.1 kilograms, expected today 82.8 to 83.6; 9 weigh-ins in the last
 * 14 days; goal date likely 21 to 30 December." Quiet mode keeps the shape and counts, drops the weights.
 */
export function trendSummary(data: TrendLaneData, opts: { quiet?: boolean } = {}): string {
  const parts: string[] = [];
  const i = lastTrendDay(data);
  const v = data.trend[i] ?? NaN;
  if (opts.quiet) {
    const dir = trendDirection(data);
    parts.push(dir ? `Weight trend ${DIRECTION_WORD[dir]}, numbers hidden` : 'Weight trend not available yet, numbers hidden');
  } else if (Number.isFinite(v)) {
    let head = `Weight trend ${formatNumber(v, data.decimals)} ${spokenUnit(data.unit)}`;
    const ex = data.todayIndex !== null ? expectedAt(data, data.todayIndex) : null;
    if (ex) head += `, expected today ${formatNumber(ex[0], data.decimals)} to ${formatNumber(ex[1], data.decimals)}`;
    parts.push(head);
  } else parts.push('Weight trend not available yet');
  const end = Math.min(data.days - 1, data.todayIndex ?? data.days - 1);
  const seen = data.weighIns.filter((w) => w.day >= 0 && w.day <= end);
  const flagged = seen.filter((w) => w.flagged).length;
  let wi = `${seen.length} ${seen.length === 1 ? 'weigh-in' : 'weigh-ins'} in the last ${end + 1} ${end === 0 ? 'day' : 'days'}`;
  if (flagged) wi += `, ${flagged} marked unusual and kept`;
  parts.push(wi);
  if (data.goalDateRange) parts.push(`goal date likely ${spokenDateRange(data.goalDateRange.from, data.goalDateRange.to)}`);
  return `${parts.join('; ')}.`;
}

/** Crosshair readout for one day: date + "weigh-in 83.4 kg" · "trend 83.1 kg" · "expected 82.8–83.6" · events. */
export function trendPointParts(data: TrendLaneData, day: number, quiet = false): { date: string; parts: string[] } {
  const date = dateLabel(isoAddDays(data.startDate, day));
  const parts: string[] = [];
  const ws = data.weighIns.filter((w) => w.day === day);
  const w = ws[ws.length - 1];
  if (quiet) parts.push(w ? 'weighed in' : 'no weigh-in');
  else {
    parts.push(w ? `weigh-in ${val(w.value, data)}${w.flagged ? ', unusual, kept' : ''}` : 'no weigh-in');
    const t = data.trend[day] ?? NaN;
    if (Number.isFinite(t)) parts.push(`trend ${val(t, data)}`);
    const ex = expectedAt(data, day);
    if (ex) parts.push(`expected ${formatRange(ex[0], ex[1], data.decimals)}`);
  }
  for (const e of eventsOn(data, day)) parts.push(e);
  if (day === data.todayIndex) parts.push('today');
  return { date, parts };
}

function eventsOn(data: TrendLaneData, day: number): string[] {
  const out: string[] = [];
  for (const e of data.events ?? []) {
    if (e.kind === 'pause' ? day >= e.day && day <= (e.endDay ?? e.day) : day === e.day) out.push(e.label);
  }
  return out;
}

export interface TrendTableRow {
  day: number;
  date: string;
  /** "Wed 1 Oct". */
  label: string;
  /** Last weigh-in of the day, or null. */
  weighIn: number | null;
  flagged: boolean;
  trend: number | null;
  expectedLo: number | null;
  expectedHi: number | null;
  /** Event labels on that day, joined: "v2", "paused". */
  event: string;
  isToday: boolean;
}

/** Table twin: one row per day of the window — date · weigh-in · trend · expected range · event. */
export function trendTableRows(data: TrendLaneData): TrendTableRow[] {
  const rows: TrendTableRow[] = [];
  for (let d = 0; d < data.days; d++) {
    const date = isoAddDays(data.startDate, d);
    const ws = data.weighIns.filter((w) => w.day === d);
    const w = ws[ws.length - 1];
    const t = data.trend[d] ?? NaN;
    const ex = expectedAt(data, d);
    rows.push({
      day: d,
      date,
      label: dateLabel(date),
      weighIn: w ? w.value : null,
      flagged: !!w?.flagged,
      trend: Number.isFinite(t) ? t : null,
      expectedLo: ex ? ex[0] : null,
      expectedHi: ex ? ex[1] : null,
      event: eventsOn(data, d).join(', '),
      isToday: d === data.todayIndex,
    });
  }
  return rows;
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const plain = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? '' : v.toFixed(d));

/** CSV of the table twin (plain ASCII numbers, ISO dates). */
export function trendTableCSV(rows: readonly TrendTableRow[], unit: string, decimals: number): string {
  const head = ['date', `weigh-in (${unit})`, 'unusual', `trend (${unit})`, 'expected low', 'expected high', 'event'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows)
    lines.push(
      [r.date, plain(r.weighIn, decimals), r.flagged ? 'yes' : '', plain(r.trend, decimals), plain(r.expectedLo, decimals), plain(r.expectedHi, decimals), r.event]
        .map(csvCell)
        .join(','),
    );
  return `${lines.join('\n')}\n`;
}

/**
 * The trend as the module's ChartData, so `DataTable` / `buildTable` / CSV and the Simulator lanes can show it:
 * weigh-ins (NaN on days without one), the filtered trend, and the two forecasts as likely-range bands (the realistic
 * one with its median when given). Events become notes; pauses also become a phase.
 */
export function trendToChartData(data: TrendLaneData): ChartData {
  const n = Math.max(0, data.days);
  const f32 = (src?: ArrayLike<number>) => Float32Array.from({ length: n }, (_, i) => src?.[i] ?? NaN);
  const weigh = new Float32Array(n).fill(NaN);
  for (const w of data.weighIns) if (w.day >= 0 && w.day < n) weigh[w.day] = w.value;
  const base = { unit: data.unit, category: 'body' as const, direction: 'neutral' as const, format: { decimals: data.decimals }, overlay: 'none' as const };
  const series: ChartSeries[] = [
    { ...base, id: 'weigh_in', label: 'Weigh-ins', shortLabel: 'weigh-in', grade: 'A', daily: { values: weigh } },
    { ...base, id: 'weight_trend', label: 'Weight trend', shortLabel: 'trend', grade: 'A', daily: { values: f32(data.trend) } },
  ];
  if (data.realistic)
    series.push({
      ...base,
      id: 'forecast_realistic',
      label: 'Expected at your adherence',
      shortLabel: 'expected',
      grade: 'B',
      daily: { values: f32(data.realistic.p50), band: { lo: f32(data.realistic.p10), hi: f32(data.realistic.p90) } },
    });
  if (data.asPrescribed)
    series.push({
      ...base,
      id: 'forecast_as_prescribed',
      label: 'Expected as prescribed',
      shortLabel: 'as prescribed',
      grade: 'B',
      daily: { values: f32(), band: { lo: f32(data.asPrescribed.p10), hi: f32(data.asPrescribed.p90) } },
    });
  const events: ChartEvent[] = (data.events ?? []).map((e) => ({ day: e.day, type: 'note', label: e.label }));
  const phases = (data.events ?? [])
    .filter((e) => e.kind === 'pause')
    .map((e) => ({ startDay: e.day, endDay: (e.endDay ?? e.day) + 1, label: e.label }));
  return { time: { startDate: data.startDate, days: n }, series, events, ...(phases.length ? { phases } : {}) };
}

/* ========================================================= score history */

export interface ScoreLayout extends PlotFrame {
  xRowY: number;
  xTicks: DayTick[];
  /** Top margin holds version labels. */
  labelRow: boolean;
}

/** Default height: 200 (160 under 640 px wide). */
export const scoreHeight = (width: number, height?: number): number => height ?? (width < 640 ? 160 : 200);

/** Y hugs the nightly dots, the mean, the normal band and the comparison line. */
export function scoreDomain(data: ScoreHistoryData): [number, number] {
  const ext = finiteExtent(data.nightly, data.mean7, data.normal?.lo, data.normal?.hi, data.compare?.values) ?? [0, 1];
  return hugDomain(ext[0], ext[1], data.decimals);
}

export function scoreLayout(data: ScoreHistoryData, width: number, opts: { height?: number } = {}): ScoreLayout {
  const height = scoreHeight(width, opts.height);
  const [lo, hi] = scoreDomain(data);
  const labelRow = (data.versions ?? []).length > 0;
  // the top row always holds the unit over the tick column, and the version labels
  const f = frame(width, height, Math.max(1, data.days), { l: tickColumn(width), r: 8, t: 16, b: 17 }, lo, hi);
  return { ...f, xRowY: f.py1 + 13, xTicks: dayTicks(data.startDate, f, null), labelRow };
}

/** Last day with a finite 7-day mean. */
export function lastMeanDay(data: ScoreHistoryData): number {
  for (let i = data.days - 1; i >= 0; i--) if (Number.isFinite(data.mean7[i] ?? NaN)) return i;
  return -1;
}

/**
 * Accessible summary: "Heart-rate variability, 7-day mean 42 milliseconds on 14 October, your normal range 38 to 47;
 * 26 of 28 nights recorded; v1.3 from 20 Oct; new ring on 12 October."
 */
export function scoreSummary(data: ScoreHistoryData, label = 'Score'): string {
  const parts: string[] = [];
  const i = lastMeanDay(data);
  if (i >= 0) {
    let head = `${label}, 7-day mean ${formatNumber(data.mean7[i]!, data.decimals)} ${spokenUnit(data.unit)} on ${spokenDate(isoAddDays(data.startDate, i))}`;
    const lo = data.normal?.lo[i] ?? NaN;
    const hi = data.normal?.hi[i] ?? NaN;
    head += Number.isFinite(lo) && Number.isFinite(hi) ? `, your normal range ${formatNumber(lo, data.decimals)} to ${formatNumber(hi, data.decimals)}` : ', your normal range is still forming';
    parts.push(head);
  } else parts.push(`${label}, no 7-day mean yet`);
  const nights = data.nightly.filter((v) => Number.isFinite(v)).length;
  parts.push(`${nights} of ${data.days} nights recorded`);
  for (const v of data.versions ?? []) parts.push(v.label);
  for (const d of data.deviceChanges ?? []) parts.push(`${d.label} on ${spokenDate(isoAddDays(data.startDate, d.day))}`);
  if (data.compare) parts.push(`dashed line: ${data.compare.label}`);
  return `${parts.join('; ')}.`;
}

/** Crosshair readout for one night: date + "night 44 ms" · "7-day mean 42 ms" · "normal 38–47" · notes. */
export function scorePointParts(data: ScoreHistoryData, day: number): { date: string; parts: string[] } {
  const v = (x: number | undefined) => `${formatNumber(x ?? NaN, data.decimals)}${THIN}${data.unit}`;
  const parts: string[] = [];
  const night = data.nightly[day] ?? NaN;
  parts.push(Number.isFinite(night) ? `night ${v(night)}` : 'no reading that night');
  const mean = data.mean7[day] ?? NaN;
  if (Number.isFinite(mean)) parts.push(`7-day mean ${v(mean)}`);
  const lo = data.normal?.lo[day] ?? NaN;
  const hi = data.normal?.hi[day] ?? NaN;
  if (Number.isFinite(lo) && Number.isFinite(hi)) parts.push(`normal ${formatRange(lo, hi, data.decimals)}`);
  const c = data.compare?.values[day] ?? NaN;
  if (data.compare && Number.isFinite(c)) parts.push(`${data.compare.label} ${v(c)}`);
  for (const x of data.versions ?? []) if (x.day === day) parts.push(x.label);
  for (const x of data.deviceChanges ?? []) if (x.day === day) parts.push(x.label);
  return { date: dateLabel(isoAddDays(data.startDate, day)), parts };
}

export interface ScoreTableRow {
  day: number;
  date: string;
  label: string;
  night: number | null;
  mean: number | null;
  normalLo: number | null;
  normalHi: number | null;
  compare: number | null;
  note: string;
}

const fin = (v: number | undefined): number | null => (v !== undefined && Number.isFinite(v) ? v : null);

/** Table twin: date · night · 7-day mean · normal range · compare · note (versions, device changes). */
export function scoreTableRows(data: ScoreHistoryData): ScoreTableRow[] {
  const rows: ScoreTableRow[] = [];
  for (let d = 0; d < data.days; d++) {
    const date = isoAddDays(data.startDate, d);
    const notes = [...(data.versions ?? []).filter((v) => v.day === d).map((v) => v.label), ...(data.deviceChanges ?? []).filter((v) => v.day === d).map((v) => v.label)];
    rows.push({
      day: d,
      date,
      label: dateLabel(date),
      night: fin(data.nightly[d]),
      mean: fin(data.mean7[d]),
      normalLo: fin(data.normal?.lo[d]),
      normalHi: fin(data.normal?.hi[d]),
      compare: fin(data.compare?.values[d]),
      note: notes.join(', '),
    });
  }
  return rows;
}

/** CSV of the score table twin. */
export function scoreTableCSV(rows: readonly ScoreTableRow[], data: Pick<ScoreHistoryData, 'unit' | 'decimals' | 'compare'>): string {
  const head = ['date', `night (${data.unit})`, `7-day mean (${data.unit})`, 'normal low', 'normal high', ...(data.compare ? [data.compare.label] : []), 'note'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows)
    lines.push(
      [r.date, plain(r.night, data.decimals), plain(r.mean, data.decimals), plain(r.normalLo, data.decimals), plain(r.normalHi, data.decimals), ...(data.compare ? [plain(r.compare, data.decimals)] : []), r.note]
        .map(csvCell)
        .join(','),
    );
  return `${lines.join('\n')}\n`;
}

/** "38–47" for a table cell, "—" when either bound is missing. */
export function rangeText(lo: number | null, hi: number | null, decimals: number): string {
  return lo === null || hi === null ? '—' : formatRange(lo, hi, decimals);
}

/** A value for a table cell: "83.4", "—" when missing. */
export function cellText(v: number | null, decimals: number): string {
  return v === null ? '—' : formatNumber(v, decimals);
}
