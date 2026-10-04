/* ==========================================================================
   Time model: resolutions, sample positions, cursor ↔ index mapping.
   Every sample represents a bucket [start, end) and is plotted at its centre:
   daily i → i + 0.5 · 6-hourly k → (k + 0.5) / 4 · hourly h → (h + 0.5) / 24.
   ========================================================================== */
import { RES_DAILY_ABOVE, RES_HOURLY_AT_OR_BELOW } from '../catalogue';
import type { Resolution, TimeBase } from '../types';
import { formatClock, formatDay } from './format';

export const BUCKET_DAYS: Record<Resolution, number> = { daily: 1, '6h': 0.25, hourly: 1 / 24 };
export const SAMPLES_PER_DAY: Record<Resolution, number> = { daily: 1, '6h': 4, hourly: 24 };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Resolution for a visible span in days (CHART_SPEC §5.2). */
export function resolutionForSpan(spanDays: number): Resolution {
  if (spanDays > RES_DAILY_ABOVE) return 'daily';
  if (spanDays > RES_HOURLY_AT_OR_BELOW) return '6h';
  return 'hourly';
}

/** A series without hourly data is always daily. */
export function seriesResolution(res: Resolution, hasHourly: boolean): Resolution {
  return hasHourly ? res : 'daily';
}

/** Centre of sample i at a resolution, in days. */
export function sampleT(i: number, res: Resolution): number {
  return (i + 0.5) * BUCKET_DAYS[res];
}

/** Index of the bucket containing t (clamped to [0, n − 1]). */
export function indexAt(t: number, res: Resolution, n: number): number {
  return clamp(Math.floor(t / BUCKET_DAYS[res] + 1e-9), 0, Math.max(0, n - 1));
}

/** Snap t to the centre of its bucket, clamped to the horizon. */
export function snapT(t: number, res: Resolution, days: number): number {
  const n = days * SAMPLES_PER_DAY[res];
  return sampleT(indexAt(t, res, n), res);
}

/** Move a snapped cursor by whole samples. */
export function stepT(t: number, res: Resolution, steps: number, days: number): number {
  const n = days * SAMPLES_PER_DAY[res];
  return sampleT(clamp(indexAt(t, res, n) + steps, 0, n - 1), res);
}

/** Inclusive index range of samples whose centres fall inside [x0, x1], plus `margin` on each side. */
export function visibleIndexRange(x0: number, x1: number, res: Resolution, n: number, margin = 1): [number, number] {
  const b = BUCKET_DAYS[res];
  const i0 = clamp(Math.ceil(x0 / b - 0.5 - 1e-9) - margin, 0, n - 1);
  const i1 = clamp(Math.floor(x1 / b - 0.5 + 1e-9) + margin, 0, n - 1);
  return [i0, Math.max(i0, i1)];
}

/** Linear map between days and pixels. */
export function tToPx(t: number, x0: number, x1: number, left: number, width: number): number {
  return left + ((t - x0) / (x1 - x0 || 1)) * width;
}
export function pxToT(px: number, x0: number, x1: number, left: number, width: number): number {
  return x0 + ((px - left) / (width || 1)) * (x1 - x0);
}

/** Linear interpolation of a sampled track at t (for placing dots on drawn lines). */
export function interpolateAt(values: ArrayLike<number>, res: Resolution, t: number): number {
  const b = BUCKET_DAYS[res];
  const n = values.length;
  if (n === 0) return NaN;
  const f = t / b - 0.5;
  if (f <= 0) return values[0]!;
  if (f >= n - 1) return values[n - 1]!;
  const i = Math.floor(f);
  const a = values[i]!;
  const c = values[i + 1]!;
  if (!Number.isFinite(a)) return c;
  if (!Number.isFinite(c)) return a;
  return a + (c - a) * (f - i);
}

/** Readout header for a snapped time: "Thu 19 Nov · day 46", "Thu 19 Nov 18:00", "Thu 19 Nov 18:00–24:00". */
export function describeSample(time: TimeBase, t: number, res: Resolution): string {
  const day = Math.floor(t);
  const date = formatDay(time, day, 'long');
  const dayNo = `day ${day + 1}`;
  if (res === 'daily') return time.startDate ? `${date} · ${dayNo}` : dayNo;
  const b = BUCKET_DAYS[res];
  const start = (Math.floor(t / b + 1e-9) * b - day) * 24;
  if (res === 'hourly') return `${time.startDate ? date : dayNo} ${formatClock(start)}`;
  return `${time.startDate ? date : dayNo} ${formatClock(start)}–${formatClock(start + 6).replace('00:00', '24:00')}`;
}
