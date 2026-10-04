/* ==========================================================================
   Series access at a resolution (cached), values at a cursor, y-domains.
   ========================================================================== */
import { laneKindOf } from '../catalogue';
import type { ChartSeries, Resolution } from '../types';
import { aggregate, extent } from './downsample';
import { indexAt, sampleT, seriesResolution, visibleIndexRange } from './time';

export interface ResTrack {
  res: Resolution;
  x: Float64Array;
  values: Float32Array;
  lo?: Float32Array;
  hi?: Float32Array;
}

const xCache = new Map<string, Float64Array>();
/** Sample centres for n samples at a resolution (shared, cached). */
export function samplePositions(res: Resolution, n: number): Float64Array {
  const key = `${res}:${n}`;
  let x = xCache.get(key);
  if (!x) {
    x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = sampleT(i, res);
    xCache.set(key, x);
  }
  return x;
}

const trackCache = new WeakMap<ChartSeries, Map<Resolution, ResTrack>>();

/** The series at a resolution; falls back to daily when it has no hourly data. */
export function trackAt(s: ChartSeries, requested: Resolution): ResTrack {
  const res = seriesResolution(requested, !!s.hourly);
  let m = trackCache.get(s);
  if (!m) {
    m = new Map();
    trackCache.set(s, m);
  }
  const hit = m.get(res);
  if (hit) return hit;
  let t: ResTrack;
  if (res === 'daily') {
    t = { res, x: samplePositions('daily', s.daily.values.length), values: s.daily.values, lo: s.daily.band?.lo, hi: s.daily.band?.hi };
  } else if (res === 'hourly') {
    const h = s.hourly!;
    t = { res, x: samplePositions('hourly', h.values.length), values: h.values, lo: h.band?.lo, hi: h.band?.hi };
  } else {
    const h = s.hourly!;
    const v = aggregate(h.values, 6).mean;
    t = {
      res,
      x: samplePositions('6h', v.length),
      values: v,
      lo: h.band ? aggregate(h.band.lo, 6).mean : undefined,
      hi: h.band ? aggregate(h.band.hi, 6).mean : undefined,
    };
  }
  m.set(res, t);
  return t;
}

export function baselineOf(s: ChartSeries): number {
  return s.baseline ?? s.daily.values[0] ?? NaN;
}

export function endValueOf(s: ChartSeries): number {
  return s.daily.values[s.daily.values.length - 1] ?? NaN;
}

export interface CursorValue {
  v: number;
  lo: number;
  hi: number;
  i: number;
  res: Resolution;
}

/** Value (and likely range) of the bucket containing t. */
export function valueAt(s: ChartSeries, t: number, res: Resolution): CursorValue {
  const tr = trackAt(s, res);
  const i = indexAt(t, tr.res, tr.values.length);
  return { v: tr.values[i] ?? NaN, lo: tr.lo?.[i] ?? NaN, hi: tr.hi?.[i] ?? NaN, i, res: tr.res };
}

/* ------------------------------------------------------------------ domains */

export interface DomainOptions {
  fromZero?: boolean;
  /** Fraction of the span added on each side (default 0.1). */
  pad?: number;
}

/**
 * Y-domain for a lane over the visible window (CHART_SPEC §4.3): [min(lo), max(hi)] of the
 * visible samples plus 10 %. Thresholds: near-zero data anchors at 0 and extends to 1.2 × the
 * highest threshold; otherwise the domain extends to include nearby thresholds.
 */
export function laneDomain(s: ChartSeries, track: ResTrack, x0: number, x1: number, opts: DomainOptions = {}): [number, number] {
  const kind = laneKindOf(s);
  if (typeof s.domain === 'object') return [s.domain.min, s.domain.max];
  if (kind === 'index') return [0, 100];
  const n = track.values.length;
  const [i0, i1] = visibleIndexRange(x0, x1, track.res, n, 0);
  let [lo, hi] = extent(track.values, i0, i1);
  if (track.lo && track.hi) {
    const [bl] = extent(track.lo, i0, i1);
    const [, bh] = extent(track.hi, i0, i1);
    if (Number.isFinite(bl)) lo = Math.min(lo, bl);
    if (Number.isFinite(bh)) hi = Math.max(hi, bh);
  }
  if (kind === 'stacked-area') {
    let top = hi;
    const cf = s.stack?.counterfactual?.daily;
    if (cf) {
      const [, ch] = extent(cf, Math.floor(x0), Math.ceil(x1));
      if (Number.isFinite(ch)) top = Math.max(top, ch);
    }
    return [0, top * 1.1];
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  const padF = opts.pad ?? 0.1;
  let span = hi - lo;
  if (span < 1e-9) span = Math.max(Math.abs(hi) * 0.1, 1e-3);
  const pad = span * padF;
  const thr = (s.thresholds ?? []).map((t) => t.value);
  const zero =
    s.domain === 'zero' || (thr.length > 0 && s.domain !== 'hug' && lo >= 0 && lo < 0.5 * hi);
  if (zero) {
    // 1.2 × the highest threshold the data comes near (a 3 mM "deep" line must not squash 0.1–1.5 mM data)
    const near = thr.filter((t) => t <= hi * 1.5);
    const topThr = near.length ? Math.max(...near) * 1.2 : -Infinity;
    return [Math.min(0, lo), Math.max(hi + pad, topThr)];
  }
  let a = lo - pad;
  let b = hi + pad;
  for (const t of thr) {
    // include thresholds within one data span of the visible data
    if (t >= lo - span && t <= hi + span) {
      a = Math.min(a, t - pad);
      b = Math.max(b, t + pad);
    }
  }
  if (opts.fromZero) {
    if (a > 0) a = 0;
    if (b < 0) b = 0;
  }
  return [a, b];
}

/** Whether the likely range at the end exceeds ±25 % of the value (the "wide range" note). */
export function isWideRange(s: ChartSeries): boolean {
  const b = s.daily.band;
  if (!b) return false;
  const i = s.daily.values.length - 1;
  const v = s.daily.values[i]!;
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return false;
  const half = (b.hi[i]! - b.lo[i]!) / 2;
  return Math.abs(half / v) > 0.25;
}
