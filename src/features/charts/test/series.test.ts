import { describe, expect, it } from 'vitest';
import { baselineOf, isWideRange, laneDomain, trackAt, valueAt } from '../lib/series';
import { changeFromStart, overlaySmoothing, overlayTrack } from '../lib/transforms';
import type { ChartSeries } from '../types';

function series(values: number[], extra: Partial<ChartSeries> = {}): ChartSeries {
  const v = Float32Array.from(values);
  return {
    id: 's',
    label: 'S',
    unit: 'kg',
    category: 'body',
    direction: 'lower',
    grade: 'A',
    format: { decimals: 1 },
    daily: { values: v, band: { lo: Float32Array.from(values, (x) => x - 1), hi: Float32Array.from(values, (x) => x + 1) } },
    ...extra,
  };
}

describe('laneDomain', () => {
  it('hugs [min(lo), max(hi)] over the visible window plus 10 %', () => {
    const s = series([24, 23, 22, 21, 20]);
    const [a, b] = laneDomain(s, trackAt(s, 'daily'), 0, 5);
    expect(a).toBeCloseTo(19 - 0.6, 6);
    expect(b).toBeCloseTo(25 + 0.6, 6);
  });
  it('follows the visible window only', () => {
    const s = series([24, 23, 22, 21, 20]);
    const [a, b] = laneDomain(s, trackAt(s, 'daily'), 3, 5);
    expect(a).toBeCloseTo(19 - 0.3, 6);
    expect(b).toBeCloseTo(22 + 0.3, 6);
  });
  it('fixes indices at 0–100', () => {
    const s = series([40, 50], { unit: 'index' });
    expect(laneDomain(s, trackAt(s, 'daily'), 0, 2)).toEqual([0, 100]);
  });
  it('anchors near-zero threshold lanes at 0 and reaches 1.2 × the nearby threshold', () => {
    const s = series([0.1, 0.8, 1.2], { unit: 'mmol/L', thresholds: [{ value: 0.5, label: 'n' }, { value: 3, label: 'deep' }], daily: { values: Float32Array.from([0.1, 0.8, 1.2]) } });
    const [a, b] = laneDomain(s, trackAt(s, 'daily'), 0, 3);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(1.2 + 0.11, 6); // 3.0 is not "near" data that peaks at 1.2
    const deep = series([0.1, 2.4], { thresholds: [{ value: 0.5, label: 'n' }, { value: 3, label: 'deep' }], daily: { values: Float32Array.from([0.1, 2.4]) } });
    expect(laneDomain(deep, trackAt(deep, 'daily'), 0, 2)[1]).toBeCloseTo(3.6, 6);
  });
  it('extends a hugging domain to include a nearby threshold (BP 130)', () => {
    const s = series([124, 126, 127], { thresholds: [{ value: 130, label: 'stage 1' }], daily: { values: Float32Array.from([124, 126, 127]) } });
    const [a, b] = laneDomain(s, trackAt(s, 'daily'), 0, 3);
    expect(a).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(130);
  });
  it('forces a zero baseline on request', () => {
    const s = series([24, 20]);
    expect(laneDomain(s, trackAt(s, 'daily'), 0, 2, { fromZero: true })[0]).toBe(0);
  });
});

describe('series access', () => {
  it('derives 6-hourly means from hourly data and falls back to daily', () => {
    const hourly = Float32Array.from({ length: 48 }, (_, i) => i);
    const s = series([1, 2], { hourly: { values: hourly } });
    const six = trackAt(s, '6h');
    expect(six.values.length).toBe(8);
    expect(six.values[0]).toBeCloseTo(2.5, 6);
    expect(trackAt(series([1, 2]), 'hourly').res).toBe('daily');
  });
  it('reads the value and range of the bucket under the cursor', () => {
    const s = series([10, 20, 30]);
    expect(valueAt(s, 1.7, 'daily')).toMatchObject({ v: 20, lo: 19, hi: 21, i: 1 });
  });
  it('uses the explicit baseline when given', () => {
    expect(baselineOf(series([10, 20], { baseline: 9 }))).toBe(9);
    expect(baselineOf(series([10, 20]))).toBe(10);
  });
  it('flags wide ranges (> ±25 %)', () => {
    expect(isWideRange(series([10, 2]))).toBe(true);
    expect(isWideRange(series([10, 20]))).toBe(false);
  });
});

describe('change from start', () => {
  it('computes % for amounts and points for indices', () => {
    expect(Array.from(changeFromStart([24, 18], 24, 'pct'))).toEqual([0, -25]);
    expect(Array.from(changeFromStart([40, 55], 40, 'pts'))).toEqual([0, 15]);
    expect(Array.from(changeFromStart([1, 2], 0, 'pct')).every(Number.isNaN)).toBe(true);
  });
  it('smooths with a 7-day centred mean only above 21 visible days', () => {
    expect(overlaySmoothing(84)).toBe(true);
    expect(overlaySmoothing(21)).toBe(false);
    const saw = Array.from({ length: 28 }, (_, i) => (i % 2 ? 110 : 90));
    const s = series(saw, { baseline: 100 });
    const raw = overlayTrack(s, 'daily', false)!;
    const smooth = overlayTrack(s, 'daily', true)!;
    expect(Math.abs(raw.values[10]!)).toBeCloseTo(10, 4);
    expect(Math.abs(smooth.values[10]!)).toBeLessThan(2);
    expect(smooth.smoothed).toBe(true);
  });
  it('excludes metrics whose transform is none', () => {
    expect(overlayTrack(series([1, 2], { overlay: 'none' }), 'daily', false)).toBeNull();
  });
});
