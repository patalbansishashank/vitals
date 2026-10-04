/**
 * 24 h clock-ring geometry (COMPONENTS §4 ClockRing): 00:00 at the top, clockwise, 15° per hour.
 * Pure functions so the editor's drag/keyboard behaviour is testable without layout.
 */
export const HOURS = 24;
export const DEG_PER_HOUR = 15;
/** Pointer snap (15 min) and fine snap with ⇧ (5 min), in hours. */
export const SNAP_H = 0.25;
export const FINE_SNAP_H = 5 / 60;

/** Angle in radians, 0 at the top, increasing clockwise. */
export function hourToAngle(h: number): number {
  return (h / HOURS) * 2 * Math.PI;
}

/** SVG point for an hour on a circle (y grows downwards). */
export function polar(cx: number, cy: number, r: number, h: number): [number, number] {
  const a = hourToAngle(h);
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Hour (0 ≤ h < 24) pointed at from the centre. */
export function pointToHour(cx: number, cy: number, x: number, y: number): number {
  let a = Math.atan2(x - cx, cy - y);
  if (a < 0) a += 2 * Math.PI;
  const h = (a / (2 * Math.PI)) * HOURS;
  return h >= HOURS ? 0 : h;
}

/** Shortest signed difference b − a on the 24 h circle, in (−12, 12]. */
export function wrapDelta(a: number, b: number): number {
  let d = (((b - a) % HOURS) + HOURS) % HOURS;
  if (d > HOURS / 2) d -= HOURS;
  return d;
}

export function snapHour(h: number, step = SNAP_H): number {
  return Math.round(h / step) * step;
}

export const clampHour = (h: number, lo = 0, hi = HOURS): number => Math.min(hi, Math.max(lo, h));

/** Clockwise span from h0 to h1 in hours (0 < span ≤ 24; equal ends = full circle only when `full`). */
export function spanHours(h0: number, h1: number): number {
  const s = (((h1 - h0) % HOURS) + HOURS) % HOURS;
  return s;
}

/**
 * Clockwise arc path from h0 to h1. Spans ≥ 24 h draw a full circle (two half arcs); zero spans draw nothing.
 */
export function arcPath(cx: number, cy: number, r: number, h0: number, h1: number, full = false): string {
  const span = full ? HOURS : spanHours(h0, h1);
  if (span <= 1e-6) return '';
  if (span >= HOURS - 1e-6) {
    const [x0, y0] = polar(cx, cy, r, h0);
    const [x1, y1] = polar(cx, cy, r, h0 + 12);
    return `M${f(x0)},${f(y0)}A${r},${r} 0 1 1 ${f(x1)},${f(y1)}A${r},${r} 0 1 1 ${f(x0)},${f(y0)}`;
  }
  const [x0, y0] = polar(cx, cy, r, h0);
  const [x1, y1] = polar(cx, cy, r, h0 + span);
  const large = span > 12 ? 1 : 0;
  return `M${f(x0)},${f(y0)}A${r},${r} 0 ${large} 1 ${f(x1)},${f(y1)}`;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

// ---------------------------------------------------------------- meal-window model

/** Minimum gap kept between neighbouring meals when dragging, h. */
export const MIN_MEAL_GAP_H = 0.5;

/** Eating window = first meal → last meal (the engine's own definition: compile derives it from meal times). */
export function windowOf(times: readonly number[]): { start: number; end: number; length: number } {
  if (times.length === 0) return { start: 0, end: 0, length: 0 };
  const start = Math.min(...times);
  const end = Math.max(...times);
  return { start, end, length: end - start };
}

/** Daily fast between the last meal and the next day's first meal (same plan every day), h. */
export function dailyFastHours(times: readonly number[]): number {
  if (times.length === 0) return 24;
  const w = windowOf(times);
  return HOURS - w.length;
}

/** Move the whole meal set by `delta` hours, kept inside the day [0, 24]. */
export function shiftMeals(times: readonly number[], delta: number): number[] {
  const w = windowOf(times);
  const d = Math.max(-w.start, Math.min(HOURS - w.end, delta));
  return times.map((t) => t + d);
}

/**
 * Drag the window's start or end to `h` (the first or last meal); the meals between are rescaled
 * proportionally so their relative spacing is kept. The window keeps at least MIN_MEAL_GAP_H per interval.
 */
export function setWindowEdge(times: readonly number[], edge: 'start' | 'end', h: number): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  if (sorted.length === 0) return sorted;
  const w = windowOf(sorted);
  const minLen = MIN_MEAL_GAP_H * (sorted.length - 1);
  let start = w.start;
  let end = w.end;
  if (sorted.length === 1) return [clampHour(h, 0, 23.75)];
  if (edge === 'start') start = clampHour(h, 0, end - minLen);
  else end = clampHour(h, start + minLen, HOURS);
  const len = end - start;
  return sorted.map((t) => (w.length > 0 ? start + ((t - w.start) / w.length) * len : start));
}

/** Drag meal `i` (in sorted order) to `h`, between its neighbours (edges move the window, see setWindowEdge). */
export function moveMeal(times: readonly number[], i: number, h: number): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  if (i === 0 && sorted.length > 1) return setWindowEdge(sorted, 'start', h);
  if (i === sorted.length - 1 && sorted.length > 1) return setWindowEdge(sorted, 'end', h);
  if (sorted.length === 1) return [clampHour(h, 0, 23.75)];
  const lo = sorted[i - 1]! + MIN_MEAL_GAP_H;
  const hi = sorted[i + 1]! - MIN_MEAL_GAP_H;
  sorted[i] = Math.min(hi, Math.max(lo, h));
  return sorted;
}

/** Evenly spaced meal times over a window (the engine's window shorthand). */
export function evenMeals(count: number, start: number, length: number): number[] {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, i) => start + (length * i) / (count - 1));
}

/** True when the times are the evenly spaced shorthand for their window (so the plan can stay in shorthand form). */
export function isEven(times: readonly number[]): boolean {
  const sorted = [...times].sort((a, b) => a - b);
  const w = windowOf(sorted);
  const ev = evenMeals(sorted.length, w.start, w.length);
  return sorted.every((t, i) => Math.abs(t - ev[i]!) < 1e-6);
}

/** Keyboard step for a clock thumb: ←/↓ −15 min, →/↑ +15 min, ⇧ = 5 min, PgUp/PgDn ±1 h. Null for other keys. */
export function keyStep(key: string, shift: boolean): number | null {
  const s = shift ? FINE_SNAP_H : SNAP_H;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return s;
    case 'ArrowLeft':
    case 'ArrowDown':
      return -s;
    case 'PageUp':
      return 1;
    case 'PageDown':
      return -1;
    default:
      return null;
  }
}
