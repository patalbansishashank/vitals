/* ==========================================================================
   <GlowLine> (r071, AUDIT §5.2 and §4.3): the smooth line of an intraday or daily series, with a live end dot. It
   replaces OvernightTrace, the Ring's DayLine and the sparks of Progress and the Ring. One picture for one data shape:
   a value that moves over time.

   - The line is ivory, 2.25 px, round caps, drawn in real px from the measured width (so smoothing is never
     distorted by a stretched viewBox). A null reading breaks the line, and a gap is never bridged.
   - The hue lives in the card's glow and in the secondary marks (the band, the hatched spans), never in the line.
   - The end dot is a mark, not a surface: 10 px ivory with a 2 px ring, and two thin halos that pulse twice (4.8 s in
     all, under the WCAG 2.2.2 line) and stop. `endDot="static"` is a finished series (a past day, a night).
   - An estimate keeps its range: `band` is the likely range (a flat wash, never a gradient: two gradients on a card
     read as a woven grid), `future` the dotted projection, `reference` the plan line.
   - Hover or focus reads a point (crosshair, tooltip, a polite live region); the keyboard walks the points. The
     spoken sentence and the table read the RAW readings, never the smoothed line.
   - Draw-in (first 20 % in view): the line wipes in over 1,200 ms, the band and area fade in after, the projection
     last, the end dot appears at the line's end and then pulses. `animate={false}`, reduced motion and jsdom render
     the final frame at once, with the markup the animation ends on.
   ========================================================================== */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { clamp, clockText, isNum, niceStep, speak } from './geometry';
import { useWidth } from './hooks';
import { areaPath, bandPath, dataKey, monotonePath, smoothPreset, type SmoothPoint, type SmoothPreset } from './smooth';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './glow.css';

export interface LinePoint {
  /** Milliseconds, or the index for a bare number series. */
  t: number;
  /** null breaks the line. */
  v: number | null;
}

export interface LineSpan {
  from: number;
  to: number;
  /** `awake` is hatched (a pattern, never colour alone); `workout` is a flat wash. */
  kind: 'awake' | 'workout';
}

export interface LineMark {
  t: number;
  v: number;
  /** "Lowest 49 · 09:55": the caller's words (hidden when `quiet`). */
  label: string;
  /** An outlined dot (a planned or provisional point). */
  hollow?: boolean;
  /** Where the words sit: `below` for a low point, `above` for a high one. Default: below when the value is under the median. */
  placement?: 'above' | 'below';
}

/** The likely range: arrays aligned with the series points followed by the `future` points, or `'iqr'` from the data. */
export type LineBand = { lo: ReadonlyArray<number | null>; hi: ReadonlyArray<number | null> } | 'iqr';

export type LineState = 'normal' | 'stale' | 'none' | 'loading';

export interface GlowLineProps {
  /** "Energy burned" */
  label: string;
  /** "kcal" */
  unit?: string;
  /** Points `{ t, v }` (v null breaks the line), or bare numbers (evenly spaced, t = index; null breaks). */
  series: ReadonlyArray<LinePoint> | ReadonlyArray<number | null>;
  /** The time window drawn (default the first and last point). */
  from?: number;
  to?: number;
  /** The live instant: labels the end dot (mono HH:MM) and makes it pulse by default. */
  now?: number | null;
  /** The dotted projection that continues the line (after the series). */
  future?: ReadonlyArray<LinePoint>;
  /** The likely range, aligned with `[...series, ...future]` (or 'iqr'). A flat wash. */
  band?: LineBand;
  /** The plan line, one value per `[...series, ...future]` point. A hairline. */
  reference?: ReadonlyArray<number | null>;
  /** Awake (hatched) and workout (washed) columns behind the line. */
  spans?: ReadonlyArray<LineSpan>;
  /** Labelled points on the line (the lowest reading, a peak). */
  marks?: ReadonlyArray<LineMark>;
  /** How many y labels (default 3 for `full`, 0 for `spark`; 0 draws none). Hidden when quiet. */
  yTicks?: number;
  /** x labels: `clock` 00 · 12 · 24, `hours` round hours, `days` dates, `none`. Default clock for `full`. */
  xTicks?: 'clock' | 'hours' | 'days' | 'none';
  /** `pulse` (live: two pulses, then still) · `static` (finished) · `none`. Default pulse with `now`, else static. */
  endDot?: 'pulse' | 'static' | 'none';
  /** A flat ivory wash under the line: true is 8 %, a number is that alpha. Default off (the card glow tints). */
  area?: boolean | number;
  /** Override the card's domain colours for this picture. */
  hue?: Domain;
  /** `fine` (a day of readings), `night` (calm, bucketed), `spark` (the points as given). Default fine, spark when `spark`. */
  smoothing?: SmoothPreset;
  /** `full` has labels and a read-out; `spark` is the line and its end dot only. */
  variant?: 'full' | 'spark';
  /** Plot height in px (default 120, 56 for `spark`). */
  height?: number;
  /** Decimals of the values (0 for kcal, 1 for kg). */
  decimals?: number;
  /** A gap wider than this (ms) breaks the bucketed presets' line (default three sampling steps). */
  gapMs?: number;
  /** Time zone for clock text (default the device's). */
  tz?: string;
  /** False renders the final frame at once (the end frame of a widget preview, a test). */
  animate?: boolean;
  /** AUDIT name for the line's draw-in; `false` is the same as `animate={false}` for this picture. */
  drawIn?: boolean;
  /** Quiet mode: no digits anywhere (axes, labels, read-out, sentence); the line still draws. */
  quiet?: boolean;
  state?: LineState;
  /** Draw the "Table" key and the table twin under the picture (the (i) panel hosts it instead on a card). */
  twin?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ pure model */

const H = 3_600_000;

/** Points and whether the series was bare numbers. */
export function linePoints(series: GlowLineProps['series']): { points: LinePoint[]; indexed: boolean } {
  const objects = series.some((s) => typeof s === 'object' && s !== null);
  if (objects) return { points: (series as ReadonlyArray<LinePoint>).map((s) => ({ t: s.t, v: isNum(s.v) ? s.v : null })), indexed: false };
  return { points: (series as ReadonlyArray<number | null>).map((v, i) => ({ t: i, v: isNum(v) ? v : null })), indexed: true };
}

/** `n` evenly spaced nice values (a 1 / 2 / 5 step) that cover [lo, hi], and the domain they span. */
export function lineTicks(lo: number, hi: number, n: number): { ticks: number[]; domain: [number, number] } {
  const count = Math.max(2, Math.round(n));
  let step = niceStep(Math.max(hi - lo, 1e-6) / (count - 1));
  for (let guard = 0; guard < 12; guard++) {
    const a = Math.floor(lo / step + 1e-9) * step;
    if (a + (count - 1) * step >= hi - 1e-9) {
      const ticks = Array.from({ length: count }, (_, i) => Number((a + i * step).toPrecision(10)));
      return { ticks, domain: [ticks[0]!, ticks[count - 1]!] };
    }
    step = niceStep(step * 1.01);
  }
  return { ticks: [lo, hi], domain: [lo, hi] };
}

/** "00", "12", "24" for whole hours (the end of a whole day reads 24), "07:30" otherwise. */
function hourText(t: number, tz?: string, endOfDay = false): string {
  const [h, m] = clockText(t, tz).split(':') as [string, string];
  if (m !== '00') return `${h}:${m}`;
  return endOfDay && h === '00' ? '24' : h;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayText(t: number, tz?: string): string {
  const key = tz ?? '';
  let f = dayFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) });
    dayFormats.set(key, f);
  }
  return f.format(new Date(t));
}

/** The x labels: three for `clock` and `days` (start, middle, end), round hours for `hours`; none for a bare series. */
export function lineXTicks(kind: NonNullable<GlowLineProps['xTicks']>, from: number, to: number, plotW: number, tz?: string, indexed = false): Array<{ t: number; text: string }> {
  if (kind === 'none' || indexed || !(to > from)) return [];
  const mid = from + (to - from) / 2;
  if (kind === 'clock') {
    const wholeDay = to - from >= 20 * H;
    return [from, mid, to].map((t, i) => ({ t, text: hourText(t, tz, wholeDay && i === 2) }));
  }
  if (kind === 'days') return [from, mid, to].map((t) => ({ t, text: dayText(t, tz) }));
  const perHour = plotW / Math.max(1e-6, (to - from) / H);
  const every = perHour >= 52 ? 1 : perHour >= 26 ? 2 : perHour >= 17 ? 3 : 6;
  const minute = Number(clockText(from, tz).split(':')[1] ?? 0);
  const first = from - (from % 60_000) + ((60 - minute) % 60) * 60_000;
  const out: Array<{ t: number; text: string }> = [];
  for (let t = first; t <= to + 1; t += H) {
    const hh = Number(clockText(t, tz).split(':')[0]);
    if (hh % every === 0) out.push({ t, text: `${String(hh).padStart(2, '0')}:00` });
  }
  return out;
}

export interface LineHover {
  t: number;
  v: number;
  x: number;
  y: number;
  /** Part of the projection, not a reading. */
  future: boolean;
}

export interface LineModel {
  /** No finite reading. */
  empty: boolean;
  indexed: boolean;
  points: LinePoint[];
  futurePoints: LinePoint[];
  from: number;
  to: number;
  /** The y domain and the labelled values in it. */
  domain: [number, number];
  ticks: number[];
  /** Smoothed points in px, per run. A run of one point is drawn as a dot. */
  runs: Array<Array<{ t: number; v: number; x: number; y: number }>>;
  linePaths: string[];
  areaPaths: string[];
  dots: Array<{ x: number; y: number }>;
  futurePath: string;
  bandPaths: string[];
  refPath: string;
  spans: Array<{ kind: LineSpan['kind']; x0: number; x1: number }>;
  marks: Array<{ x: number; y: number; label: string; hollow: boolean; placement: 'above' | 'below' }>;
  /** The end of the line: where the dot sits. */
  end: { t: number; v: number; x: number; y: number } | null;
  /** The raw readings the pointer and the keyboard step through (series, then projection). */
  hover: LineHover[];
  /** The geometry, in px. */
  box: { w: number; h: number; padL: number; padR: number; padT: number; padB: number };
  x: (t: number) => number;
  y: (v: number) => number;
  xLabels: Array<{ t: number; text: string }>;
}

type ModelInput = Pick<GlowLineProps, 'series' | 'future' | 'from' | 'to' | 'band' | 'reference' | 'spans' | 'marks' | 'yTicks' | 'xTicks' | 'smoothing' | 'variant' | 'gapMs' | 'tz' | 'decimals'> & { height: number };

/**
 * The picture's geometry for a plot `width` px wide: the smoothed runs in px, every path, the y domain and its labels,
 * the end point, and the raw points the pointer snaps to. Pure.
 */
export function lineModel(p: ModelInput, width: number): LineModel {
  const full = (p.variant ?? 'full') === 'full';
  const { points, indexed } = linePoints(p.series);
  const future = (p.future ?? []).filter((f) => isNum(f.v) && Number.isFinite(f.t)).sort((a, b) => a.t - b.t);
  const finite = points.filter((q) => isNum(q.v) && Number.isFinite(q.t));
  const ts = [...points, ...future].map((q) => q.t).filter(Number.isFinite);
  const from = p.from ?? (ts.length ? Math.min(...ts) : 0);
  const to = p.to ?? (ts.length ? Math.max(...ts) : 1);
  const yN = p.yTicks ?? (full ? 3 : 0);
  const decimals = p.decimals ?? 0;
  const plotH = Math.max(10, p.height - 12);
  const padT = 6;
  const padB = 6;

  // runs of raw points, broken at every null, then smoothed under the preset (about one bucket per few px of the plot)
  const rawRuns: Array<Array<{ t: number; v: number }>> = [];
  let cur: Array<{ t: number; v: number }> = [];
  for (const q of points) {
    if (isNum(q.v) && Number.isFinite(q.t)) cur.push({ t: q.t, v: q.v });
    else if (cur.length) {
      rawRuns.push(cur);
      cur = [];
    }
  }
  if (cur.length) rawRuns.push(cur);
  const preset: SmoothPreset = indexed ? 'spark' : (p.smoothing ?? (full ? 'fine' : 'spark'));
  const smooth: SmoothPoint[][] = rawRuns.flatMap((r) => {
    const runs = smoothPreset(preset, r, { span: to - from, px: Math.max(20, width - (yN > 0 ? 34 : 0)), gap: p.gapMs });
    // the end of a smoothed line is the last reading itself: the dot, its label and the sentence must agree
    const last = r[r.length - 1]!;
    const tail = runs[runs.length - 1];
    if (tail && tail.length > 1 && last.t >= tail[tail.length - 1]!.t) tail[tail.length - 1] = { t: last.t, v: last.v, lo: last.v, hi: last.v, n: 1 };
    return runs;
  });

  // the y domain: the drawn line, the projection, the band, the plan line and the marks
  const vals: number[] = [];
  for (const run of smooth)
    for (const q of run) {
      vals.push(q.v);
      if (p.band === 'iqr') vals.push(q.lo, q.hi);
    }
  for (const f of future) vals.push(f.v!);
  if (p.band && p.band !== 'iqr') for (const v of [...p.band.lo, ...p.band.hi]) if (isNum(v)) vals.push(v);
  for (const v of p.reference ?? []) if (isNum(v)) vals.push(v);
  for (const m of p.marks ?? []) if (isNum(m.v)) vals.push(m.v);
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  let ticks: number[] = [];
  let domain: [number, number];
  if (yN >= 2 && vals.length) {
    const t = lineTicks(lo, hi, yN);
    ticks = t.ticks;
    domain = t.domain;
  } else {
    const span = hi - lo;
    const pad = span > 0 ? span * 0.08 : Math.max(1, Math.abs(hi) * 0.05);
    lo -= pad;
    hi += pad;
    domain = [lo, hi];
  }
  // the y labels sit in a left gutter as wide as the longest one (mono, about 7.6 px a character)
  const longest = ticks.reduce((n, v) => Math.max(n, formatNumber(v, decimals).length), 0);
  const padL = ticks.length ? clamp(Math.ceil(8 + longest * 7.6), 24, 72) : 0;
  const box = { w: Math.max(40, width), h: p.height, padL, padR: 0, padT, padB };
  const plotW = Math.max(20, box.w - box.padL - box.padR);
  const [d0, d1] = domain;
  const x = (t: number): number => (to > from ? box.padL + ((t - from) / (to - from)) * plotW : box.padL + plotW / 2);
  const y = (v: number): number => box.padT + (1 - (v - d0) / Math.max(1e-9, d1 - d0)) * plotH;

  const runs = smooth.map((r) => r.map((q) => ({ t: q.t, v: q.v, x: x(q.t), y: y(q.v) })));
  const xy = (r: (typeof runs)[number]): Array<[number, number]> => r.map((q) => [q.x, q.y]);
  const base = box.padT + plotH;
  const linePaths = runs.filter((r) => r.length >= 2).map((r) => monotonePath(xy(r)));
  const areaPaths = runs.filter((r) => r.length >= 2).map((r) => areaPath(xy(r), base));
  const dots = runs.filter((r) => r.length === 1).map((r) => ({ x: r[0]!.x, y: r[0]!.y }));
  const lastRun = [...runs].reverse().find((r) => r.length > 0);
  const endPt = lastRun ? lastRun[lastRun.length - 1]! : null;
  const end = endPt ? { t: endPt.t, v: endPt.v, x: endPt.x, y: endPt.y } : null;

  // the projection continues from the end of the line
  const ahead = end ? future.filter((f) => f.t > end.t) : [];
  const futurePath = end && ahead.length ? monotonePath([[end.x, end.y], ...ahead.map((f): [number, number] => [x(f.t), y(f.v!)])]) : '';

  // aligned arrays (band, reference) run over the series points followed by the projection
  const combined = [...points, ...future];
  const bandPaths: string[] = [];
  if (p.band === 'iqr') {
    for (const r of smooth) if (r.length >= 2) bandPaths.push(bandPath(r.map((q): [number, number] => [x(q.t), y(q.hi)]), r.map((q): [number, number] => [x(q.t), y(q.lo)])));
  } else if (p.band) {
    const top: Array<[number, number]> = [];
    const bottom: Array<[number, number]> = [];
    combined.forEach((q, i) => {
      const l = p.band && p.band !== 'iqr' ? p.band.lo[i] : null;
      const h = p.band && p.band !== 'iqr' ? p.band.hi[i] : null;
      if (isNum(l) && isNum(h) && Number.isFinite(q.t)) {
        top.push([x(q.t), y(h)]);
        bottom.push([x(q.t), y(l)]);
      }
    });
    if (top.length >= 2) bandPaths.push(bandPath(top, bottom));
  }
  const refXY: Array<[number, number]> = [];
  combined.forEach((q, i) => {
    const v = p.reference?.[i];
    if (isNum(v) && Number.isFinite(q.t)) refXY.push([x(q.t), y(v)]);
  });
  const refPath = refXY.length >= 2 ? monotonePath(refXY) : '';

  const spans = (p.spans ?? [])
    .map((s) => ({ kind: s.kind, x0: x(clamp(s.from, from, to)), x1: x(clamp(s.to, from, to)) }))
    .filter((s) => s.x1 - s.x0 > 0.5);
  // the words of a low point hang below it (under the line, in the empty part of the plot), a high point's above
  const sorted = finite.map((q) => q.v!).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const marks = (p.marks ?? [])
    .filter((m) => isNum(m.v) && m.t >= from && m.t <= to)
    .map((m) => ({ x: x(m.t), y: y(m.v), label: m.label, hollow: Boolean(m.hollow), placement: m.placement ?? (m.v <= median ? ('below' as const) : ('above' as const)) }));
  const hover: LineHover[] = [
    ...finite.map((q) => ({ t: q.t, v: q.v!, x: x(q.t), y: y(q.v!), future: false })),
    ...future.map((q) => ({ t: q.t, v: q.v!, x: x(q.t), y: y(q.v!), future: true })),
  ];
  return {
    empty: finite.length === 0,
    indexed,
    points,
    futurePoints: future,
    from,
    to,
    domain,
    ticks,
    runs,
    linePaths,
    areaPaths,
    dots,
    futurePath,
    bandPaths,
    refPath,
    spans,
    marks,
    end,
    hover,
    box,
    x,
    y,
    xLabels: lineXTicks(p.xTicks ?? (full ? 'clock' : 'none'), from, to, plotW, p.tz, indexed),
  };
}

/* ------------------------------------------------------------------ words */

type SpokenInput = Pick<GlowLineProps, 'label' | 'unit' | 'series' | 'future' | 'from' | 'to' | 'now' | 'decimals' | 'quiet' | 'state' | 'tz'>;

const valueText = (v: number, unit: string | undefined, decimals: number) => `${formatNumber(v, decimals)}${unit ? ` ${unit}` : ''}`;

/** rising / falling / steady, in words (a change of under 6 % of the range is steady). */
function trendWord(first: number, last: number, lo: number, hi: number): 'rising' | 'falling' | 'steady' {
  const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1e-9);
  const d = (last - first) / span;
  return d > 0.06 ? 'rising' : d < -0.06 ? 'falling' : 'steady';
}

/**
 * "Energy burned, 00:00 to 24:00: starts at 0, ends at 1 096 kcal at 14:58, lowest 0, highest 1 096; expected to reach
 * 2 595 kcal; 24 readings". Quiet: the direction in words, no digit. From the RAW readings. Pure.
 */
export function spokenLine(p: SpokenInput): string {
  if (p.state === 'loading') return `${p.label}: loading`;
  const { points, indexed } = linePoints(p.series);
  const finite = points.filter((q) => isNum(q.v)) as Array<{ t: number; v: number }>;
  if (p.state === 'none' || finite.length === 0) return `${p.label}: no readings`;
  const decimals = p.decimals ?? 0;
  const vs = finite.map((q) => q.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const first = finite[0]!;
  const last = finite[finite.length - 1]!;
  const stale = p.state === 'stale' ? '; stale' : '';
  const future = (p.future ?? []).filter((f) => isNum(f.v)) as Array<{ t: number; v: number }>;
  if (p.quiet) {
    const w = trendWord(first.v, last.v, lo, hi);
    const ahead = future.length ? `; heading ${future[future.length - 1]!.v >= last.v ? 'higher' : 'lower'}` : '';
    return `${p.label}: ${finite.length === 1 ? 'one reading' : w}${ahead}${stale}`;
  }
  const times = !indexed && Number.isFinite(p.from ?? first.t) ? `, ${clockText(p.from ?? first.t, p.tz)} to ${clockText(p.to ?? last.t, p.tz)}` : '';
  const at = isNum(p.now) ? ` at ${clockText(p.now, p.tz)}` : '';
  const parts = [`starts at ${valueText(first.v, undefined, decimals)}`, `ends at ${valueText(last.v, p.unit, decimals)}${at}`, `lowest ${valueText(lo, undefined, decimals)}`, `highest ${valueText(hi, undefined, decimals)}`];
  if (future.length) parts.push(`expected to reach ${valueText(future[future.length - 1]!.v, p.unit, decimals)}`);
  parts.push(finite.length === 1 ? '1 reading' : `${finite.length} readings`);
  return speak(`${p.label}${times}: ${parts.join(', ')}${stale}`);
}

/** One reading as the tooltip and the live region say it: "14:58, 1 096 kcal" (a bare series: "3 of 14"). */
function readText(h: LineHover, m: LineModel, p: Pick<GlowLineProps, 'unit' | 'decimals' | 'tz'>, index: number): string {
  const when = m.indexed ? `${index + 1} of ${m.hover.filter((q) => !q.future).length}` : m.to - m.from > 36 * H ? dayText(h.t, p.tz) : clockText(h.t, p.tz);
  return `${when}, ${valueText(h.v, p.unit, p.decimals ?? 0)}${h.future ? ', projected' : ''}`;
}

/**
 * The Table twin of the picture: every raw reading with its time (and, when there is a projection, whether it was
 * measured or projected). A page puts it in the card's (i) panel; `twin` draws it under the picture. Pure.
 */
export function lineTwin(p: SpokenInput & Pick<GlowLineProps, 'twin'>): TwinData {
  const { points, indexed } = linePoints(p.series);
  const future = (p.future ?? []).filter((f) => isNum(f.v));
  const spanLong = (p.to ?? Math.max(...points.map((q) => q.t), 0)) - (p.from ?? Math.min(...points.map((q) => q.t), 0)) > 36 * H;
  const when = (t: number, i: number) => (indexed ? String(i + 1) : spanLong ? dayText(t, p.tz) : clockText(t, p.tz));
  const unit = p.unit ? ` (${p.unit})` : '';
  const cell = (v: number | null) => (isNum(v) ? formatNumber(v, p.decimals ?? 0) : '—');
  const head = [indexed ? 'Reading' : spanLong ? 'Day' : 'Time', `${p.label}${unit}`, ...(future.length ? ['Kind'] : [])];
  const rows: Array<Array<string | number>> = [
    ...points.map((q, i) => [when(q.t, i), cell(q.v), ...(future.length ? ['Measured'] : [])]),
    ...future.map((q, i) => [when(q.t, points.length + i), cell(q.v), 'Projected']),
  ];
  return { title: `${p.label} table`, caption: spokenLine(p), head, rows, fileName: twinFileName(p.label), rowNoun: ['reading', 'readings'] };
}

/* ------------------------------------------------------------------ component */

/** The two halo rings of the live end dot: scale up and fade, twice, then rest (the keyframes of the prototype). */
const PULSE: Array<{ keyframes: Keyframe[]; duration: number; delay: number }> = [
  { keyframes: [{ transform: 'scale(0.55)', opacity: 0.8 }, { offset: 0.7, transform: 'scale(1.12)', opacity: 0 }, { transform: 'none', opacity: 0.55 }], duration: 2400, delay: 1000 },
  { keyframes: [{ transform: 'scale(0.5)', opacity: 0.6 }, { offset: 0.7, transform: 'scale(1.1)', opacity: 0 }, { transform: 'none', opacity: 0.3 }], duration: 2200, delay: 1200 },
];
export const PULSE_CYCLES = 2;

export function GlowLine(props: GlowLineProps) {
  const { unit, now = null, quiet = false, state = 'normal', decimals = 0, hue, variant = 'full', twin = false, animate = true, drawIn, area = false, className, tz } = props;
  const full = variant === 'full';
  const height = props.height ?? (full ? 120 : 56);
  const [widthRef, width] = useWidth<HTMLDivElement>(288);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(revealRef);
  const pending = (animate && drawIn !== false) && !inView;
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      widthRef.current = el;
      revealRef.current = el;
    },
    [widthRef, revealRef],
  );
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const haloA = useRef<SVGCircleElement>(null);
  const haloB = useRef<SVGCircleElement>(null);

  // memoised on the data's content: callers rebuild their arrays on every render
  const key = [
    dataKey(linePoints(props.series).points.flatMap((q) => [q.t, q.v])),
    dataKey((props.future ?? []).flatMap((q) => [q.t, q.v])),
    props.band && props.band !== 'iqr' ? dataKey([...props.band.lo, ...props.band.hi]) : (props.band ?? ''),
    dataKey(props.reference ?? []),
    dataKey((props.spans ?? []).flatMap((s) => [s.from, s.to, s.kind === 'awake' ? 0 : 1])),
    dataKey((props.marks ?? []).flatMap((m) => [m.t, m.v, m.hollow ? 1 : 0])),
    props.from,
    props.to,
    props.yTicks,
    props.xTicks,
    props.smoothing,
    props.gapMs,
    props.tz,
    props.decimals,
    variant,
    height,
    width,
  ].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => lineModel({ ...props, height }, width), [key]);
  const spoken = spokenLine(props);
  const live = state === 'normal' || state === 'stale';
  const shown = state === 'none' || state === 'loading' || model.empty ? null : model;
  const endMode = props.endDot ?? (isNum(now) ? 'pulse' : 'static');
  const stale = state === 'stale';
  const showEnd = shown?.end && endMode !== 'none';
  const pulse = endMode === 'pulse' && !stale;
  const areaAlpha = area === true ? 0.08 : typeof area === 'number' ? clamp(area, 0, 1) : 0;
  const hatch = `${id}-hatch`;
  const targets = shown?.hover ?? [];
  const hit = active !== null ? targets[active] : undefined;

  // the two halo pulses start when the picture is first revealed (and only then), as the line finishes drawing
  const wasPending = useRef(pending);
  useEffect(() => {
    const was = wasPending.current;
    wasPending.current = pending;
    if (!was || pending || !pulse) return;
    const els = [haloA.current, haloB.current];
    if (typeof els[0]?.animate !== 'function') return;
    const anims = els.map((el, i) => el?.animate(PULSE[i]!.keyframes, { duration: PULSE[i]!.duration, delay: PULSE[i]!.delay, iterations: PULSE_CYCLES, easing: 'ease-out' }));
    return () => anims.forEach((a) => a?.cancel());
  }, [pending, pulse]);

  const nearest = (clientX: number, el: HTMLElement): number | null => {
    if (!targets.length) return null;
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < targets.length; i++) if (Math.abs(targets[i]!.x - px) < Math.abs(targets[best]!.x - px)) best = i;
    return best;
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => setActive(nearest(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!targets.length) return;
    const last = targets.length - 1;
    let next: number;
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(last, active + 1);
    else if (e.key === 'ArrowLeft') next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };

  const m = shown;
  const box = model.box;
  const yLabels = full && !quiet && m ? m.ticks : [];
  const xLabels = full && !quiet && m ? m.xLabels : [];
  const nowLabel = full && !quiet && m?.end && isNum(now) ? clockText(now, tz) : null;
  const sentence = hit && m ? readText(hit, m, { unit, decimals, tz }, active ?? 0) : '';
  const reading = quiet ? '' : sentence;
  const spanWord = (k: LineSpan['kind']) => (k === 'awake' ? 'Awake' : 'Workout');

  return (
    <div
      ref={setRef}
      className={cx('lmz lmz-line', className)}
      data-variant={variant}
      data-state={state}
      data-hue={hue}
      data-reveal={pending ? 'pending' : undefined}
      data-now={nowLabel ? '' : undefined}
      data-xaxis={xLabels.length ? '' : undefined}
      aria-busy={state === 'loading' || undefined}
      style={{ '--lmz-h': `${height}px`, '--lmz-area': areaAlpha } as CSSProperties}
    >
      <div
        className="lmz-line__plot"
        role="img"
        aria-label={spoken}
        tabIndex={live && m && full ? 0 : undefined}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={full ? onPointer : undefined}
        onPointerDown={full ? onPointer : undefined}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
      >
        {/* under: the grid and the spans */}
        <svg className="lmz-line__layer lmz-line__under" width={box.w} height={box.h} aria-hidden="true">
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="lmz-line__hatch" />
            </pattern>
          </defs>
          {full && m && yLabels.length
            ? yLabels.map((v) => <line key={v} className="lmz-line__grid" x1={box.padL} x2={box.w} y1={Math.round(m.y(v)) + 0.5} y2={Math.round(m.y(v)) + 0.5} />)
            : null}
          {m?.spans.map((s, i) => (
            <rect key={i} className="lmz-line__span" data-kind={s.kind} x={s.x0} y={box.padT} width={s.x1 - s.x0} height={box.h - box.padT - box.padB} rx={4} fill={s.kind === 'awake' ? `url(#${hatch})` : undefined} />
          ))}
          {state === 'loading' || state === 'none' || model.empty ? <line className="lmz-line__rest" x1={box.padL} x2={box.w} y1={box.h / 2} y2={box.h / 2} /> : null}
        </svg>
        {/* the drawing: wiped in left to right while it is revealed */}
        <svg className="lmz-line__layer lmz-line__data" width={box.w} height={box.h} aria-hidden="true">
          {m?.bandPaths.map((d, i) => <path key={i} className="lmz-line__band" d={d} />)}
          {areaAlpha > 0 && m?.areaPaths.map((d, i) => <path key={i} className="lmz-line__area" d={d} />)}
          {m?.refPath ? <path className="lmz-line__ref" d={m.refPath} /> : null}
          {m?.futurePath ? <path className="lmz-line__proj" d={m.futurePath} /> : null}
          {m?.linePaths.map((d, i) => <path key={i} className="lmz-line__main" d={d} data-stale={stale || undefined} />)}
          {m?.dots.map((d, i) => <circle key={i} className="lmz-line__lone" cx={d.x} cy={d.y} r={2.25} />)}
        </svg>
        {/* over: the marks, the end dot and the crosshair */}
        <svg className="lmz-line__layer lmz-line__over" width={box.w} height={box.h} aria-hidden="true">
          {full
            ? m?.marks.map((k, i) => (
                <circle key={i} className="lmz-line__mark" data-hollow={k.hollow || undefined} cx={k.x} cy={k.y} r={k.hollow ? 3.5 : 4} />
              ))
            : null}
          {hit && !quiet ? (
            <g className="lmz-line__cross">
              <line x1={hit.x} x2={hit.x} y1={box.padT} y2={box.h - box.padB} />
              <circle cx={hit.x} cy={hit.y} r={4} />
            </g>
          ) : null}
          {showEnd && m?.end ? (
            <g className="lmz-line__end" data-end={endMode} data-hollow={stale || undefined}>
              {pulse ? (
                <>
                  <circle ref={haloA} className="lmz-line__halo lmz-line__halo--a" cx={m.end.x} cy={m.end.y} r={11} />
                  <circle ref={haloB} className="lmz-line__halo lmz-line__halo--b" cx={m.end.x} cy={m.end.y} r={18} />
                </>
              ) : null}
              <circle className="lmz-line__ring" cx={m.end.x} cy={m.end.y} r={6} />
              <circle className="lmz-line__dot" cx={m.end.x} cy={m.end.y} r={5} />
            </g>
          ) : null}
        </svg>
        {/* words: HTML, so they are real mono text and wrap nothing */}
        {m && full && !quiet
          ? m.spans.map((s, i) =>
              s.x1 - s.x0 >= 44 ? (
                <span key={i} className="lm-mono lmz-line__spanword" data-size="sm" style={{ left: s.x0 + 6, top: box.padT + 4 }}>
                  {spanWord(m.spans[i]!.kind)}
                </span>
              ) : null,
            )
          : null}
        {m && full && !quiet
          ? m.marks.map((k, i) => (
              <span key={i} className="lm-mono lmz-line__markword" data-size="sm" data-tone="ink" data-placement={k.placement} style={{ left: clamp(k.x, 72, box.w - 72), top: k.y }}>
                {k.label}
              </span>
            ))
          : null}
        {m
          ? yLabels.map((v) => (
              <span key={v} className="lm-mono lmz-line__y" data-size="sm" data-tone="ink" style={{ top: m.y(v) }}>
                {formatNumber(v, decimals)}
              </span>
            ))
          : null}
        {nowLabel && m?.end ? (
          <span className="lm-mono lmz-line__now" data-size="sm" data-tone="ink" style={{ left: clamp(m.end.x, 24, box.w - 24), top: m.end.y }}>
            {nowLabel}
          </span>
        ) : null}
        {xLabels.map((l) => {
          // a label at either end of the plot sits inside it; the rest are centred on their tick
          const lx = m?.x(l.t) ?? 0;
          const edge = lx - box.padL < 16 ? 'start' : box.w - lx < 16 ? 'end' : undefined;
          return (
            <span key={l.t} className="lm-mono lmz-line__x" data-size="sm" data-tone="ink" data-edge={edge} style={{ left: lx }}>
              {l.text}
            </span>
          );
        })}
        {hit && !quiet ? (
          <div className="lmz-tip" style={{ left: clamp(hit.x, 56, box.w - 56), top: hit.y }} aria-hidden="true">
            <span className="lmz-tip__v">{valueText(hit.v, unit, decimals)}</span> {m?.indexed ? '' : m && m.to - m.from > 36 * H ? dayText(hit.t, tz) : clockText(hit.t, tz)}
            {hit.future ? ' · projected' : ''}
          </div>
        ) : null}
      </div>
      <span className="lmz-sr" aria-live="polite">
        {reading}
      </span>
      {twin && live && !quiet ? <InlineTwin data={lineTwin(props)} /> : null}
    </div>
  );
}
