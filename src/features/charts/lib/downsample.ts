/* ==========================================================================
   Aggregation and decimation (CHART_SPEC §8.3).
   - aggregate(): hourly → 6-hourly / daily means with a min/max envelope
   - m4(): per-pixel-column first/min/max/last decimation; used whenever a
     visible range has more samples than 2 × plot width
   - centredMean(): NaN-aware centred rolling mean (overlay 7-day average)
   ========================================================================== */

export interface Aggregated {
  mean: Float32Array;
  min: Float32Array;
  max: Float32Array;
}

/** Mean / min / max over consecutive groups of `factor` samples. NaNs are ignored. */
export function aggregate(values: ArrayLike<number>, factor: number): Aggregated {
  const n = Math.floor(values.length / factor);
  const mean = new Float32Array(n);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    let c = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = k * factor; j < (k + 1) * factor; j++) {
      const v = values[j]!;
      if (!Number.isFinite(v)) continue;
      s += v;
      c++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mean[k] = c ? s / c : NaN;
    min[k] = c ? lo : NaN;
    max[k] = c ? hi : NaN;
  }
  return { mean, min, max };
}

export interface Decimated {
  x: Float64Array;
  y: Float32Array;
  lo?: Float32Array;
  hi?: Float32Array;
  /** Source index of each output point (for readouts). */
  idx: Uint32Array;
}

/**
 * M4 decimation over [i0, i1] of (x, y): for every pixel column keep the first, min,
 * max and last sample (in time order). Band arrays collapse to the column envelope.
 * The result draws pixel-identically to the full data at `widthPx`.
 */
export function m4(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  x0: number,
  x1: number,
  widthPx: number,
  band?: { lo: ArrayLike<number>; hi: ArrayLike<number> },
): Decimated {
  const cols = Math.max(1, Math.round(widthPx));
  const scale = cols / (x1 - x0 || 1);
  const outIdx: number[] = [];
  const outLo: number[] = [];
  const outHi: number[] = [];
  let col = NaN;
  let first = -1;
  let last = -1;
  let minI = -1;
  let maxI = -1;
  let bandLo = Infinity;
  let bandHi = -Infinity;

  const flush = () => {
    if (first < 0) return;
    const picks = [first, minI, maxI, last].filter((v) => v >= 0);
    const uniq = Array.from(new Set(picks)).sort((a, b) => a - b);
    for (const i of uniq) {
      outIdx.push(i);
      outLo.push(Number.isFinite(bandLo) ? bandLo : NaN);
      outHi.push(Number.isFinite(bandHi) ? bandHi : NaN);
    }
  };

  for (let i = i0; i <= i1; i++) {
    const c = Math.floor((x[i]! - x0) * scale);
    if (c !== col) {
      flush();
      col = c;
      first = i;
      minI = -1;
      maxI = -1;
      bandLo = Infinity;
      bandHi = -Infinity;
    }
    last = i;
    const v = y[i]!;
    if (Number.isFinite(v)) {
      if (minI < 0 || v < y[minI]!) minI = i;
      if (maxI < 0 || v > y[maxI]!) maxI = i;
    }
    if (band) {
      const l = band.lo[i]!;
      const h = band.hi[i]!;
      if (l < bandLo) bandLo = l;
      if (h > bandHi) bandHi = h;
    }
  }
  flush();

  const n = outIdx.length;
  const res: Decimated = { x: new Float64Array(n), y: new Float32Array(n), idx: new Uint32Array(outIdx) };
  for (let k = 0; k < n; k++) {
    const i = outIdx[k]!;
    res.x[k] = x[i]!;
    res.y[k] = y[i]!;
  }
  if (band) {
    res.lo = Float32Array.from(outLo);
    res.hi = Float32Array.from(outHi);
  }
  return res;
}

/** Centred rolling mean over `window` samples (odd), shrinking at the edges; NaNs are skipped. */
export function centredMean(values: ArrayLike<number>, window: number): Float32Array {
  const n = values.length;
  const half = Math.floor(window / 2);
  const sum = new Float64Array(n + 1);
  const cnt = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const ok = Number.isFinite(v);
    sum[i + 1] = sum[i]! + (ok ? v : 0);
    cnt[i + 1] = cnt[i]! + (ok ? 1 : 0);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const c = cnt[b]! - cnt[a]!;
    out[i] = c ? (sum[b]! - sum[a]!) / c : NaN;
  }
  return out;
}

/** Min / max of a sub-range, ignoring NaN. Returns [NaN, NaN] when empty. */
export function extent(values: ArrayLike<number>, i0 = 0, i1 = values.length - 1): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, i0); i <= Math.min(values.length - 1, i1); i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [NaN, NaN];
}
