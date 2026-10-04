/** Pure scale math shared by ScaleSlider, ScaleRange, RangeBar and Meter. */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Number of decimals implied by a step (0.1 → 1, 0.25 → 2, 5 → 0). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1] ?? 0);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Clamp to [min, max] and round to the nearest step counted from `min`. */
export function snap(v: number, min: number, max: number, step: number): number {
  const c = clamp(v, min, max);
  if (!(step > 0)) return c;
  const n = Math.round((c - min) / step);
  const snapped = min + n * step;
  const d = Math.max(decimalsOf(step), decimalsOf(min));
  return clamp(Number(snapped.toFixed(d)), min, max);
}

/** Position of v in [min, max] as a percentage (0–100). */
export function pct(v: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((clamp(v, min, max) - min) / (max - min)) * 100;
}

export interface Tick {
  value: number;
  major: boolean;
}

/** Printed scale: ticks at absolute multiples of `minor`, majors at multiples of `major`. */
export function scaleTicks(min: number, max: number, minor: number, major: number, limit = 400): Tick[] {
  if (!(minor > 0) || max <= min) return [];
  const out: Tick[] = [];
  const start = Math.ceil(min / minor - 1e-9) * minor;
  const d = Math.max(decimalsOf(minor), decimalsOf(major));
  for (let i = 0; out.length < limit; i++) {
    const v = Number((start + i * minor).toFixed(d + 2));
    if (v > max + 1e-9) break;
    const r = v / major;
    out.push({ value: v, major: major > 0 && Math.abs(r - Math.round(r)) < 1e-6 });
  }
  return out;
}

/** A "nice" step giving about `target` intervals over the span (1, 2, 2.5, 5 × 10^n). */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}
