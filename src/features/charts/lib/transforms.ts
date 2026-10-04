/* ==========================================================================
   Overlay transforms (CHART_SPEC §2.1, §5.3).
   pct: 100 × (v − v0) / |v0|   ·   pts: v − v0 (index points)
   Smoothing: 7-day centred mean when the visible window spans > 21 days.
   ========================================================================== */
import { overlayTransformOf, RES_DAILY_ABOVE } from '../catalogue';
import type { ChartSeries, OverlayTransform, Resolution } from '../types';
import { centredMean } from './downsample';
import { baselineOf, trackAt } from './series';

export function changeFromStart(values: ArrayLike<number>, v0: number, mode: Exclude<OverlayTransform, 'none'>): Float32Array {
  const out = new Float32Array(values.length);
  const denom = Math.abs(v0);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v) || !Number.isFinite(v0)) out[i] = NaN;
    else if (mode === 'pts') out[i] = v - v0;
    else out[i] = denom < 1e-9 ? NaN : ((v - v0) / denom) * 100;
  }
  return out;
}

/** Overlay smoothing applies above 21 visible days (daily samples only). */
export function overlaySmoothing(spanDays: number): boolean {
  return spanDays > RES_DAILY_ABOVE;
}

export interface OverlayTrack {
  res: Resolution;
  x: Float64Array;
  values: Float32Array;
  mode: Exclude<OverlayTransform, 'none'>;
  smoothed: boolean;
}

const cache = new WeakMap<ChartSeries, Map<string, OverlayTrack>>();

/** Indexed (and optionally smoothed) track for the overlay. Null when excluded. */
export function overlayTrack(s: ChartSeries, res: Resolution, smooth: boolean): OverlayTrack | null {
  const mode = overlayTransformOf(s);
  if (mode === 'none') return null;
  const tr = trackAt(s, res);
  const doSmooth = smooth && tr.res === 'daily';
  const key = `${tr.res}:${doSmooth ? 1 : 0}`;
  let m = cache.get(s);
  if (!m) {
    m = new Map();
    cache.set(s, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const raw = changeFromStart(tr.values, baselineOf(s), mode);
  const t: OverlayTrack = { res: tr.res, x: tr.x, values: doSmooth ? centredMean(raw, 7) : raw, mode, smoothed: doSmooth };
  m.set(key, t);
  return t;
}
