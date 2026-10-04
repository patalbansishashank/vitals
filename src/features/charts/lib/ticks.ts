/* ==========================================================================
   Scales and ticks.
   Y: the domain hugs the data; ticks are the nice values (1, 2, 2.5, 5 × 10ⁿ)
   that fall INSIDE it (CHART_SPEC §4.3) — the domain is never rounded outward.
   X: week / day / hour ticks chosen by available pixels (CHART_SPEC §4.7).
   ========================================================================== */
import type { TimeBase } from '../types';
import { dayParts, formatClock, formatDay, weekOf } from './format';

export interface TickSet {
  ticks: number[];
  step: number;
}

const MANTISSAS = [1, 2, 2.5, 5];

/**
 * Nice ticks strictly inside [lo, hi]: the smallest nice step that yields at most
 * `max` ticks (and at least `min` when possible).
 */
export function niceTicksInside(lo: number, hi: number, opts: { min?: number; max?: number } = {}): TickSet {
  const min = opts.min ?? 2;
  const max = opts.max ?? 3;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [], step: 1 };
  if (hi < lo) [lo, hi] = [hi, lo];
  const span = hi - lo || Math.abs(hi) || 1;
  const e0 = Math.floor(Math.log10(span));
  const steps: number[] = [];
  for (let e = e0 - 3; e <= e0 + 1; e++) for (const m of MANTISSAS) steps.push(m * 10 ** e);
  steps.sort((a, b) => a - b);
  let fallback: TickSet | null = null;
  for (const step of steps) {
    const first = Math.ceil(lo / step - 1e-9) * step;
    const n = Math.floor((hi - first) / step + 1e-9) + 1;
    if (n <= max) {
      const set = { ticks: range(first, n, step), step };
      if (n >= min) return set;
      fallback ??= set;
    }
  }
  return fallback ?? { ticks: [lo, hi], step: hi - lo };
}

function range(first: number, n: number, step: number): number[] {
  const out: number[] = [];
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  for (let k = 0; k < n; k++) out.push(Number((first + k * step).toFixed(dec)));
  return out;
}

/* --------------------------------------------------------------- time ticks */

export interface TimeTick {
  /** Position in days. */
  t: number;
  label: string;
  /** Major ticks (week or day boundaries at hour zoom) get a taller mark. */
  major: boolean;
  /** Label anchoring: interval labels start after the tick; point labels centre on it. */
  anchor: 'start' | 'middle';
}

export interface TimeTickOptions {
  /** Average px per character for the label estimate (11 px condensed ≈ 5.4). */
  charPx?: number;
  /** Compact labels ("wk 4") for narrow layouts. */
  compact?: boolean;
}

/** Weekly / daily / hourly ticks for the window [x0, x1] drawn across `widthPx`. */
export function timeTicks(
  time: TimeBase,
  x0: number,
  x1: number,
  widthPx: number,
  opts: TimeTickOptions = {},
): TimeTick[] {
  const charPx = opts.charPx ?? 5.4;
  const span = Math.max(1e-6, x1 - x0);
  const pxPerDay = widthPx / span;
  const out: TimeTick[] = [];
  const gap = 14;

  if (span > 3) {
    // week or day intervals
    const dayLabel = (d: number, long: boolean) =>
      time.startDate ? formatDay(time, d, long ? 'long' : 'short') : `day ${d + 1}`;
    const weekLabel = (d: number) => {
      if (opts.compact || !time.startDate) return `wk ${weekOf(d)}`;
      return `wk ${weekOf(d)} · ${formatDay(time, d, 'short')}`;
    };
    const useWeeks = span > 21 || pxPerDay * 1 < 24;
    if (useWeeks) {
      const sample = weekLabel(7 * 11);
      const need = sample.length * charPx + gap;
      const compactNeed = `wk ${weekOf(77)}`.length * charPx + gap;
      let every = 1;
      let compact = opts.compact ?? false;
      while (7 * every * pxPerDay < (compact ? compactNeed : need) && every < 52) {
        if (!compact && 7 * every * pxPerDay >= compactNeed) {
          compact = true;
          break;
        }
        every = every === 1 ? 2 : every === 2 ? 3 : every === 3 ? 4 : every * 2;
      }
      const lbl = (d: number) => (compact || !time.startDate ? `wk ${weekOf(d)}` : weekLabel(d));
      const firstWeek = Math.ceil(x0 / 7 - 1e-9) + 0;
      for (let w = firstWeek; w * 7 <= x1 + 1e-9; w++) {
        if (w % every !== 0) continue;
        out.push({ t: w * 7, label: lbl(w * 7), major: true, anchor: 'start' });
      }
      return out;
    }
    const longNeed = 'Wed 30 Sep'.length * charPx + gap;
    const shortNeed = '30 Sep'.length * charPx + gap;
    const long = pxPerDay >= longNeed && !opts.compact;
    let every = 1;
    while (every * pxPerDay < (long ? longNeed : shortNeed) && every < 14) every = every === 1 ? 2 : every === 2 ? 3 : 7;
    for (let d = Math.ceil(x0 - 1e-9) + 0; d <= x1 + 1e-9; d++) {
      if (every === 7 ? d % 7 !== 0 : d % every !== 0) continue;
      out.push({ t: d, label: dayLabel(d, long), major: d % 7 === 0, anchor: 'start' });
    }
    return out;
  }

  // hours
  const pxPerHour = pxPerDay / 24;
  const hourNeed = '00:00'.length * charPx + gap;
  const steps = [1, 2, 3, 6, 12];
  const every = steps.find((s) => s * pxPerHour >= hourNeed) ?? 24;
  const h0 = Math.ceil((x0 * 24) / every - 1e-9) * every;
  for (let h = h0; h <= x1 * 24 + 1e-9; h += every) {
    const t = h / 24;
    const isMidnight = h % 24 === 0;
    const day = Math.round(t);
    const p = dayParts(time, day);
    const label = isMidnight ? (p ? `${p.weekday} ${p.date} ${p.month}` : `day ${day + 1}`) : formatClock(h % 24);
    out.push({ t, label, major: isMidnight, anchor: isMidnight ? 'start' : 'middle' });
  }
  return out;
}
