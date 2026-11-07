/* ==========================================================================
   Display smoothing (r064 VIZ). DISPLAY ONLY: everything here shapes what a
   chart draws. Totals, metrics, spoken sentences, tables and CSVs read the
   raw data, never these results.

   - smoothStages(): a night of raw stage epochs into a calm four-level
     hypnogram (Awake / REM / Light / Deep). "Mixed" takes the majority stage
     of its neighbours, short "no reading" holes are bridged, long ones stay
     one gap, and runs shorter than a minimum fold into their neighbours.
   - smoothSeries(): a stream of readings into a robust line with a quiet
     IQR band: per-bucket medians, a 3-bucket rolling median, then a light
     Gaussian, all inside runs. A real gap breaks the line; nothing is ever
     interpolated across it.
   - monotonePath(): a monotone cubic through the smoothed points (no
     overshoot past a local extreme).
   Pure; O(n log n). Components memoise the calls.
   ========================================================================== */

const MIN = 60_000;

/**
 * A cheap content key of some numbers (a running 32-bit hash plus the count), so a component can memoise its smoothing
 * even when the caller rebuilds the same data as new arrays on every render. O(n), far below the smoothing's cost.
 */
export function dataKey(nums: Iterable<number | null | undefined>): string {
  let h = 2166136261;
  let n = 0;
  for (const x of nums) {
    const v = x === null || x === undefined || !Number.isFinite(x) ? -1 : Math.round(x * 1000);
    h = Math.imul(h ^ (v | 0), 16777619) ^ Math.floor(v / 4294967296);
    n++;
  }
  return `${n}:${(h >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------- stages

/** A raw span: a stage index (0 Awake, 1 REM, 2 Light, 3 Deep), 'mixed' (asleep, stage unclear) or null (no reading). */
export interface RawStageSpan {
  from: number;
  to: number;
  state: number | 'mixed' | null;
}

/** A drawn span: a stage index, or null for a long "no reading" gap. */
export interface StageSpan {
  from: number;
  to: number;
  state: number | null;
}

export interface StageSmoothing {
  /** Mixed takes the majority stage within this much either side (default 10 min). */
  mixedWindowMs?: number;
  /** A "no reading" hole this short or shorter is bridged from its neighbours (default 12 min). */
  bridgeMs?: number;
  /** A run shorter than this folds into a neighbour (default 4 min). */
  minMs?: number;
}

export const STAGE_SMOOTHING = { mixedWindowMs: 10 * MIN, bridgeMs: 12 * MIN, minMs: 4 * MIN } as const;

/**
 * The raw spans clipped to [from, to], sorted, overlaps dropped (a span that starts inside an earlier one loses the
 * overlap) and every uncovered stretch filled with null ("no reading"). This is the raw timeline the table, the CSV and
 * the totals read. Pure.
 */
export function stageTimeline(spans: readonly RawStageSpan[], from?: number, to?: number): RawStageSpan[] {
  const lo = from ?? Math.min(...spans.map((s) => s.from));
  const hi = to ?? Math.max(...spans.map((s) => s.to));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const xs = spans
    .map((s) => ({ ...s, from: Math.max(lo, s.from), to: Math.min(hi, s.to) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const out: RawStageSpan[] = [];
  let cur = lo;
  for (const s of xs) {
    const start = Math.max(cur, s.from);
    if (start > cur) out.push({ from: cur, to: start, state: null });
    if (s.to > start) out.push({ from: start, to: s.to, state: s.state });
    cur = Math.max(cur, s.to);
  }
  if (hi > cur) out.push({ from: cur, to: hi, state: null });
  return out;
}

/** Minutes per state over the raw timeline: stage index, 'mixed' and 'none'. The totals a summary reads. Pure. */
export function stageTotals(spans: readonly RawStageSpan[], from?: number, to?: number): Map<number | 'mixed' | 'none', number> {
  const m = new Map<number | 'mixed' | 'none', number>();
  for (const s of stageTimeline(spans, from, to)) {
    const k = s.state === null ? 'none' : s.state;
    m.set(k, (m.get(k) ?? 0) + (s.to - s.from) / MIN);
  }
  return m;
}

function mergeEqual(xs: StageSpan[]): StageSpan[] {
  const out: StageSpan[] = [];
  for (const s of xs) {
    const prev = out[out.length - 1];
    if (prev && prev.state === s.state && prev.to === s.from) prev.to = s.to;
    else out.push({ ...s });
  }
  return out;
}

/**
 * The hypnogram's spans (DISPLAY ONLY; see the file header). Mixed → the majority neighbour stage; interior holes up to
 * `bridgeMs` bridged (one neighbour each side meets at the middle); holes at the night's edges up to `bridgeMs` dropped;
 * longer holes kept as one null span; then runs under `minMs` fold into their longer stage neighbour, shortest first.
 * Never mutates its input. Pure.
 */
export function smoothStages(spans: readonly RawStageSpan[], opts: StageSmoothing & { from?: number; to?: number } = {}): StageSpan[] {
  const W = opts.mixedWindowMs ?? STAGE_SMOOTHING.mixedWindowMs;
  const bridge = opts.bridgeMs ?? STAGE_SMOOTHING.bridgeMs;
  const minMs = opts.minMs ?? STAGE_SMOOTHING.minMs;
  const tl = stageTimeline(spans, opts.from, opts.to);
  if (!tl.length) return [];

  // 1. Mixed: the stage with the most time within W either side (read from the raw timeline, so order never matters)
  const firm = tl.filter((s): s is StageSpan => typeof s.state === 'number');
  let xs: StageSpan[] = tl.map((s) => {
    if (s.state !== 'mixed') return { from: s.from, to: s.to, state: s.state };
    const a = s.from - W;
    const b = s.to + W;
    const votes = new Map<number, number>();
    for (const f of firm) {
      const o = Math.min(b, f.to) - Math.max(a, f.from);
      if (o > 0) votes.set(f.state!, (votes.get(f.state!) ?? 0) + o);
    }
    let best: number | null = null;
    let bestV = 0;
    for (const [k, v] of votes) if (v > bestV || (v === bestV && best !== null && k > best)) [best, bestV] = [k, v];
    return { from: s.from, to: s.to, state: best };
  });
  xs = mergeEqual(xs);

  // 2. Holes: bridge short interior ones, drop short edge ones, keep long ones
  const bridged: StageSpan[] = [];
  for (let i = 0; i < xs.length; i++) {
    const s = xs[i]!;
    if (s.state !== null || s.to - s.from > bridge) {
      bridged.push(s);
      continue;
    }
    const L = xs[i - 1];
    const R = xs[i + 1];
    if (L && R && L.state !== null && R.state !== null) {
      if (L.state === R.state) bridged.push({ ...s, state: L.state });
      else {
        const mid = s.from + (s.to - s.from) / 2;
        bridged.push({ from: s.from, to: mid, state: L.state }, { from: mid, to: s.to, state: R.state });
      }
    } else if (!L || !R) continue; // a short hole at the night's edge: nothing to draw
    else bridged.push(s); // a short hole beside a long one (cannot happen after merging; kept for safety)
  }
  xs = mergeEqual(bridged);

  // 3. Minimum length: fold the shortest short run into its longer stage neighbour until none is left
  for (let guard = xs.length * 2 + 4; guard > 0; guard--) {
    let k = -1;
    for (let i = 0; i < xs.length; i++) {
      const s = xs[i]!;
      if (s.state === null || s.to - s.from >= minMs) continue;
      const L = xs[i - 1];
      const R = xs[i + 1];
      const hasL = L && L.state !== null && L.to === s.from;
      const hasR = R && R.state !== null && R.from === s.to;
      if (!hasL && !hasR) continue;
      if (k < 0 || s.to - s.from < xs[k]!.to - xs[k]!.from) k = i;
    }
    if (k < 0) break;
    const s = xs[k]!;
    const L = xs[k - 1];
    const R = xs[k + 1];
    const useL = L && L.state !== null && L.to === s.from;
    const useR = R && R.state !== null && R.from === s.to;
    const into = useL && useR ? (L!.to - L!.from >= R!.to - R!.from ? L! : R!) : useL ? L! : R!;
    xs[k] = { ...s, state: into.state };
    xs = mergeEqual(xs);
  }
  return xs;
}

// ---------------------------------------------------------------- series

export interface SeriesPoint {
  t: number;
  v: number;
}

/** A smoothed point: the line value `v` and the band [lo, hi] (the buckets' interquartile spread, smoothed, around `v`). */
export interface SmoothPoint {
  t: number;
  v: number;
  lo: number;
  hi: number;
  /** Raw readings in the bucket. */
  n: number;
}

export interface SeriesSmoothing {
  /** Bucket width (the points' time unit). */
  bucket: number;
  /** A gap between consecutive readings wider than this breaks the line (the points' time unit). */
  gap: number;
  /** Rolling-median window in buckets (odd; default 3). */
  medianWindow?: number;
  /** Gaussian sigma in buckets (default 1). */
  sigma?: number;
}

/** Median spacing of consecutive sorted times; 0 with fewer than two. Pure. */
export function medianSpacing(ts: readonly number[]): number {
  const d: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const x = ts[i]! - ts[i - 1]!;
    if (x > 0) d.push(x);
  }
  if (!d.length) return 0;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

function quantile(sorted: readonly number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

const NICE_MIN = [1, 2, 5, 10, 15, 20, 30, 60, 120, 240, 360];

/**
 * The bucket and the break gap for a view: about one bucket per `pxPerBucket` px (default 4), on a 1/2/5/10/15/20/30
 * minute ladder, never finer than the sampling step; the line breaks past three sampling steps or 2.5 buckets,
 * whichever is wider. `unitMs` is the size of one time unit of the points (1 for ms, 3 600 000 for clock hours). Pure.
 */
export function smoothingFor(o: { span: number; px: number; step: number; unitMs?: number; pxPerBucket?: number }): { bucket: number; gap: number } {
  const unit = o.unitMs ?? 1;
  const want = (o.span * unit) / Math.max(1, o.px / (o.pxPerBucket ?? 4));
  const nice = NICE_MIN.find((m) => m * MIN >= want) ?? NICE_MIN[NICE_MIN.length - 1]!;
  const bucket = Math.max(o.step, (nice * MIN) / unit);
  const gap = Math.max(3 * o.step, 2.5 * bucket);
  return { bucket, gap };
}

/**
 * Runs of smoothed points (DISPLAY ONLY; see the file header). Readings split into runs at every gap wider than `gap`;
 * inside a run, each bucket gives its median and interquartile range, a rolling median over `medianWindow` buckets takes
 * out lone spikes, and a Gaussian of `sigma` buckets (by time, inside the run only) softens the rest; the band is the
 * buckets' interquartile spread, smoothed over twice that, around the line. Pure.
 */
export function smoothSeries(points: readonly SeriesPoint[], o: SeriesSmoothing): SmoothPoint[][] {
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (!pts.length || !(o.bucket > 0)) return [];
  const runs: SeriesPoint[][] = [[pts[0]!]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.t - pts[i - 1]!.t > o.gap) runs.push([]);
    runs[runs.length - 1]!.push(pts[i]!);
  }
  const half = Math.floor((o.medianWindow ?? 3) / 2);
  const sigma = (o.sigma ?? 1) * o.bucket;
  return runs.map((run) => {
    // buckets on a fixed grid (stable under scrolling the data), each at the mean time of its readings
    const bins: Array<{ t: number; vs: number[] }> = [];
    let key = NaN;
    for (const p of run) {
      const k = Math.floor(p.t / o.bucket);
      if (k !== key) {
        bins.push({ t: 0, vs: [] });
        key = k;
      }
      const b = bins[bins.length - 1]!;
      b.t += p.t;
      b.vs.push(p.v);
    }
    const raw = bins.map((b) => {
      const vs = [...b.vs].sort((x, y) => x - y);
      return { t: b.t / vs.length, med: quantile(vs, 0.5), q1: quantile(vs, 0.25), q3: quantile(vs, 0.75), n: vs.length };
    });
    // rolling median of the bucket medians (lone spikes out)
    const med = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - half), i + half + 1).map((b) => b.med).sort((x, y) => x - y);
      return quantile(w, 0.5);
    });
    // Gaussian by time, inside the run; the band twice as wide as the line, so it reads as a quiet halo of spread
    const gauss = (i: number, val: (j: number) => number, sg: number): number => {
      const t = raw[i]!.t;
      let sw = 0;
      let sv = 0;
      for (let j = i; j >= 0 && t - raw[j]!.t <= 3 * sg; j--) {
        const w = Math.exp(-(((t - raw[j]!.t) / sg) ** 2) / 2);
        sw += w;
        sv += w * val(j);
      }
      for (let j = i + 1; j < raw.length && raw[j]!.t - t <= 3 * sg; j++) {
        const w = Math.exp(-(((raw[j]!.t - t) / sg) ** 2) / 2);
        sw += w;
        sv += w * val(j);
      }
      return sv / sw;
    };
    return raw.map((b, i) => {
      const v = gauss(i, (j) => med[j]!, sigma);
      // the band is the smoothed spread below and above each bucket's median, hung on the line (never off to one side)
      const below = gauss(i, (j) => raw[j]!.med - raw[j]!.q1, 2 * sigma);
      const above = gauss(i, (j) => raw[j]!.q3 - raw[j]!.med, 2 * sigma);
      return { t: b.t, v, lo: v - Math.max(0, below), hi: v + Math.max(0, above), n: b.n };
    });
  });
}

/**
 * The value range a smoothed chart's axis should cover: the drawn line and band, widened to the raw 5th–95th percentile
 * so a smoothed wobble is never blown up to fill the plot, while a lone spike still does not set the scale. Pure.
 */
export function displayDomain(runs: readonly SmoothPoint[][], raw: readonly number[]): [number, number] | null {
  const drawn = runs.flat();
  const xs = raw.filter(Number.isFinite).sort((a, b) => a - b);
  if (!drawn.length && !xs.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of drawn) {
    lo = Math.min(lo, p.lo);
    hi = Math.max(hi, p.hi);
  }
  if (xs.length) {
    lo = Math.min(lo, quantile(xs, 0.05));
    hi = Math.max(hi, quantile(xs, 0.95));
  }
  return [lo, hi];
}

/** The smoothed extremes of a set of runs (for a caption or a check), null when empty. Pure. */
export function smoothExtremes(runs: readonly SmoothPoint[][]): { lo: SmoothPoint; hi: SmoothPoint } | null {
  const all = runs.flat();
  if (!all.length) return null;
  return { lo: all.reduce((a, p) => (p.v < a.v ? p : a)), hi: all.reduce((a, p) => (p.v > a.v ? p : a)) };
}

// ---------------------------------------------------------------- paths

type Cubic = [number, number, number, number, number, number];

/** The Fritsch–Carlson control points of each segment of [x, y] points sorted by x. */
function monotoneCubics(xy: ReadonlyArray<readonly [number, number]>): Cubic[] {
  const n = xy.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xy[i + 1]![0] - xy[i]![0];
    dx.push(h);
    m.push(h === 0 ? 0 : (xy[i + 1]![1] - xy[i]![1]) / h);
  }
  const tan: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1]! * m[i]! <= 0) tan.push(0);
    else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      tan.push((w1 + w2) / (w1 / m[i - 1]! + w2 / m[i]!));
    }
  }
  tan.push(m[n - 2]!);
  const out: Cubic[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = xy[i]!;
    const [x1, y1] = xy[i + 1]!;
    const h = dx[i]! / 3;
    out.push([x0 + h, y0 + tan[i]! * h, x1 - h, y1 - tan[i + 1]! * h, x1, y1]);
  }
  return out;
}

const f1 = (v: number) => v.toFixed(1);

/** A monotone cubic (Fritsch–Carlson) through [x, y] points sorted by x: smooth, and never past a local extreme. */
export function monotonePath(xy: ReadonlyArray<readonly [number, number]>): string {
  if (xy.length === 0) return '';
  const head = `M${f1(xy[0]![0])},${f1(xy[0]![1])}`;
  if (xy.length === 1) return head;
  return head + monotoneCubics(xy).map((c) => `C${c.map(f1).join(',')}`).join('');
}

/** A closed band: `top` left to right, then `bottom` right to left, both monotone cubics (same x for both). */
export function bandPath(top: ReadonlyArray<readonly [number, number]>, bottom: ReadonlyArray<readonly [number, number]>): string {
  if (top.length < 2 || bottom.length !== top.length) return '';
  const back = monotoneCubics(bottom);
  const last = bottom[bottom.length - 1]!;
  let d = `${monotonePath(top)}L${f1(last[0])},${f1(last[1])}`;
  for (let i = back.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = back[i]!;
    const [x0, y0] = bottom[i]!;
    d += `C${[c2x, c2y, c1x, c1y, x0, y0].map(f1).join(',')}`;
  }
  return `${d}Z`;
}

// ---------------------------------------------------------------- r071 additions (package 0B)

/**
 * The soft area under a line: the monotone path through `xy`, closed down to the baseline `y0`. A flat wash only (the
 * card already carries its one gradient; a second one would read as a woven grid). Empty under two points. Pure.
 */
export function areaPath(xy: ReadonlyArray<readonly [number, number]>, y0: number): string {
  if (xy.length < 2) return '';
  const first = xy[0]!;
  const last = xy[xy.length - 1]!;
  return `${monotonePath(xy)}L${f1(last[0])},${f1(y0)}L${f1(first[0])},${f1(y0)}Z`;
}

/** How a `GlowLine` smooths its readings: `fine` is the Ring's day line, `night` the overnight trace, `spark` none. */
export type SmoothPreset = 'fine' | 'night' | 'spark';

/**
 * The bucket / median / Gaussian settings of the two presets that smooth. `fine` (DayLine: `{pxPerBucket 1.5,
 * medianWindow 1, sigma 0.6}`) keeps a day's readings close to as they are; `night` (OvernightTrace) is the calm
 * four-pixel bucket with a three-bucket rolling median. `spark` is not in the table: it draws the points it is given.
 */
/** Fewer readings than one per this many px are never smoothed (the line goes through them). */
const SPARSE_PX = 6;

export const SMOOTH_PRESETS = {
  fine: { pxPerBucket: 1.5, medianWindow: 1, sigma: 0.6 },
  night: { pxPerBucket: 4, medianWindow: 3, sigma: 1 },
} as const;

/**
 * One run of readings into drawable points under a preset. `spark` passes the points through (band [v, v]): the caller
 * already thinned or trended them (the 14-day weight trend), and a series of 14 points has nothing to bucket. `fine` and
 * `night` bucket by the zoom (`span` in the points' time unit across `px`), and break at a gap wider than `gap` (default
 * three sampling steps or 2.5 buckets). Times must be milliseconds for the bucketed presets. Readings fewer than one per
 * 6 px are drawn as they are. Pure.
 */
export function smoothPreset(preset: SmoothPreset, points: readonly SeriesPoint[], o: { span: number; px: number; gap?: number }): SmoothPoint[][] {
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  // sparse data (fewer than one reading per 6 px) is drawn as it is: bucketing a handful of points only blurs them
  if (preset === 'spark' || pts.length < 3 || pts.length <= o.px / SPARSE_PX) return [pts.map((p) => ({ t: p.t, v: p.v, lo: p.v, hi: p.v, n: 1 }))];
  const cfg = SMOOTH_PRESETS[preset];
  const step = medianSpacing(pts.map((p) => p.t));
  const auto = smoothingFor({ span: o.span, px: o.px, step, pxPerBucket: cfg.pxPerBucket });
  return smoothSeries(pts, { bucket: auto.bucket, gap: o.gap ?? auto.gap, medianWindow: cfg.medianWindow, sigma: cfg.sigma });
}
