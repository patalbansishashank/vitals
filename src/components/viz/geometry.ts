/* ==========================================================================
   Shared viz geometry and wording (SPEC A.3.2). Pure: no React, no DOM.
   `polar` and `arcPath` are copied from charts/living/adherenceGeometry.ts
   (components never import features); __tests__/contract.test.tsx fails if
   the two drift apart. Angles: radians, 0 at 12 o'clock, clockwise.
   ========================================================================== */
import { EM_DASH, MINUS } from '../lib/format';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Point on the circle at angle `a` (0 = 12 o'clock, clockwise; SVG y grows down). */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** SVG path of a circular arc from a0 to a1 (clockwise). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 <= 1e-6) return '';
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

const TIDY = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest tidy number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k) at or above `x`. */
export function tidyCeil(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const k = 10 ** Math.floor(Math.log10(x));
  const m = x / k;
  const t = TIDY.find((s) => s >= m - 1e-9) ?? 10;
  return Number((t * k).toPrecision(6));
}

/** A 1 / 2 / 5 step at or above `x`. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const k = 10 ** Math.floor(Math.log10(x));
  const m = x / k;
  const s = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return Number((s * k).toPrecision(6));
}

/** Piecewise-linear interpolation through knots [x, y] (x ascending), clamped to the end values. */
export function interpolate(v: number, knots: ReadonlyArray<readonly [number, number]>): number {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!first || !last) return 0;
  if (v <= first[0]) return first[1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    if (v <= b[0]) return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

/* ------------------------------------------------------------------ words */

/** The spoken form of a visible string: a true minus is read "minus". */
export const speak = (s: string): string => s.replace(/\u2212\s?/g, 'minus ').replace(/[ \t\n]+/g, ' ').trim();

/** Lower-case the first letter (status words inside a sentence). */
export const lowerFirst = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Drop a leading "of " ("of 7 h" → "7 h"). */
export const stripOf = (s: string): string => s.replace(/^of\s+/i, '');

/** A visible value or the em dash. */
export const dash = (s: string | null | undefined): string => (s == null || s === '' ? EM_DASH : s);

/** "1 h 08", "45 min", "0 min" (minutes in, the Vitals duration voice). */
export function durationText(min: number): string {
  if (!Number.isFinite(min)) return EM_DASH;
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

const clockCache = new Map<string, Intl.DateTimeFormat>();

/** "02:25" in the given zone (default the device zone), 24-hour. */
export function clockText(t: number, tz?: string): string {
  const key = tz ?? '';
  let f = clockCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) });
    clockCache.set(key, f);
  }
  return f.format(new Date(t));
}

/** Minutes since local midnight of `t` in the zone. */
export function minuteOfDay(t: number, tz?: string): number {
  const [h, m] = clockText(t, tz).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export { MINUS };

/* ==========================================================================
   r071 pictures (RadialTicks, DottedTrack): ring ticks, quiet steps and the words of a ratio. Appended by package 0B;
   everything above is untouched.
   ========================================================================== */

export interface RingTick {
  /** 0-based index along the ring or arc. */
  i: number;
  /** Radians, 0 at 12 o'clock, clockwise. */
  angle: number;
  /** A longer tick (every `majorEvery`th). */
  major: boolean;
}

/**
 * The ticks of a ring or of one arc of it, shared by RadialTicks and the DayDisc wrapper. `startRad` is where the arc
 * begins, `sweepRad` the angle it owns (a full ring is 2π) and `gapRad` the part of it left empty at the end so the arcs
 * of one ring do not touch. A closed ring (full sweep, no gap) puts tick 0 exactly at `startRad` (12 o'clock); an arc
 * centres its ticks in their slots. Every `majorEvery`th tick (default 6; 0 for none) is major.
 */
export function tickRing(p: { count: number; startRad?: number; sweepRad?: number; gapRad?: number; majorEvery?: number }): RingTick[] {
  const count = Math.max(1, Math.round(p.count));
  const start = p.startRad ?? 0;
  const sweep = p.sweepRad ?? TAU;
  const gap = p.gapRad ?? 0;
  const majorEvery = p.majorEvery ?? 6;
  const closed = sweep >= TAU - 1e-9 && gap === 0;
  const pitch = (sweep - gap) / count;
  return Array.from({ length: count }, (_, i) => ({ i, angle: start + (closed ? i : i + 0.5) * pitch, major: majorEvery > 0 && i % majorEvery === 0 }));
}

/** Quiet mode's three steps for a ring or arc of `count` ticks: a third, two thirds, all; none when there is nothing. */
export function quietStep(ratio: number, count: number): number {
  if (!(ratio > 0)) return 0;
  return ratio < 0.34 ? Math.round(count / 3) : ratio < 0.67 ? Math.round((2 * count) / 3) : count;
}

/** Quiet words for a ratio (no digits). A null value is unknown, never "none" (Claude UI P2-15). Same words as DotFill's. */
export function ratioWord(ratio: number, known = true): string {
  if (!known) return 'no value yet';
  if (ratio <= 0) return 'none yet';
  if (ratio < 0.5) return 'under half of the goal';
  if (ratio < 1) return 'over half of the goal';
  if (ratio < 1.0001) return 'goal reached';
  return 'past the goal';
}

export type GoalKind = 'target' | 'floor' | 'limit';

/** "goal 9 000 steps", "at least 150 g", "limit 2 100 kcal": how a goal is spoken. `goal` is its visible words. */
export function goalPhrase(kind: GoalKind, goal: string): string {
  return `${kind === 'floor' ? 'at least' : kind === 'limit' ? 'limit' : 'goal'} ${stripOf(goal)}`;
}

/** What a value that has reached or passed its goal is called: never praise and never blame, "over" only for a limit. */
export function reachedPhrase(kind: GoalKind, ratio: number): string | null {
  if (ratio > 1.0001) return kind === 'limit' ? 'over the limit' : 'past the goal';
  if (ratio >= 1 - 1e-9) return kind === 'limit' ? 'at the limit' : 'goal reached';
  return null;
}
