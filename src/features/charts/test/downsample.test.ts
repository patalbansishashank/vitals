import { describe, expect, it } from 'vitest';
import { aggregate, centredMean, extent, m4 } from '../lib/downsample';

describe('aggregate', () => {
  it('computes mean / min / max per group and skips NaN', () => {
    const a = aggregate(new Float32Array([1, 2, 3, 4, NaN, 6, 7, 8]), 4);
    expect(Array.from(a.mean)).toEqual([2.5, 7]);
    expect(Array.from(a.min)).toEqual([1, 6]);
    expect(Array.from(a.max)).toEqual([4, 8]);
  });
});

describe('m4', () => {
  const n = 4416;
  const x = Float64Array.from({ length: n }, (_, i) => (i + 0.5) / 24);
  const y = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7) * 10 + (i === 2000 ? 50 : 0));
  it('keeps first / min / max / last per pixel column in time order', () => {
    const d = m4(x, y, 0, n - 1, 0, 184, 300);
    expect(d.x.length).toBeLessThanOrEqual(300 * 4 + 4);
    expect(d.x.length).toBeGreaterThan(300);
    for (let i = 1; i < d.x.length; i++) expect(d.x[i]!).toBeGreaterThan(d.x[i - 1]!);
    expect(d.x[0]).toBe(x[0]);
    expect(d.x[d.x.length - 1]).toBe(x[n - 1]);
    // the spike survives decimation
    expect(Math.max(...d.y)).toBeCloseTo(Math.max(...y), 4);
    expect(Math.min(...d.y)).toBeCloseTo(Math.min(...y), 4);
  });
  it('collapses bands to the column envelope', () => {
    const lo = Float32Array.from(y, (v) => v - 1);
    const hi = Float32Array.from(y, (v) => v + 1);
    const d = m4(x, y, 0, n - 1, 0, 184, 100, { lo, hi });
    expect(d.lo!.length).toBe(d.x.length);
    expect(Math.max(...d.hi!)).toBeCloseTo(Math.max(...hi), 4);
    expect(Math.min(...d.lo!)).toBeCloseTo(Math.min(...lo), 4);
  });
});

describe('centredMean / extent', () => {
  it('averages a centred window that shrinks at the edges', () => {
    const m = centredMean([0, 0, 0, 7, 0, 0, 0], 7);
    expect(m[3]).toBeCloseTo(1, 6);
    expect(m[0]).toBeCloseTo(7 / 4, 6);
  });
  it('ignores NaN', () => {
    expect(Array.from(centredMean([1, NaN, 3], 3))).toEqual([1, 2, 3]);
    expect(extent([NaN, 3, -2, NaN])).toEqual([-2, 3]);
    expect(extent([NaN])).toEqual([NaN, NaN]);
  });
});
