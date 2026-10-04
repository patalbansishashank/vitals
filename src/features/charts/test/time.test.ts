import { describe, expect, it } from 'vitest';
import { describeSample, indexAt, interpolateAt, pxToT, resolutionForSpan, sampleT, snapT, stepT, tToPx, visibleIndexRange } from '../lib/time';

describe('resolution', () => {
  it('switches daily → 6-hourly → hourly at 21 and 7 days', () => {
    expect(resolutionForSpan(84)).toBe('daily');
    expect(resolutionForSpan(21.5)).toBe('daily');
    expect(resolutionForSpan(21)).toBe('6h');
    expect(resolutionForSpan(8)).toBe('6h');
    expect(resolutionForSpan(7)).toBe('hourly');
    expect(resolutionForSpan(1)).toBe('hourly');
  });
});

describe('cursor ↔ index mapping', () => {
  it('plots samples at bucket centres', () => {
    expect(sampleT(0, 'daily')).toBe(0.5);
    expect(sampleT(5, '6h')).toBe(1.375);
    expect(sampleT(24, 'hourly')).toBeCloseTo(1 + 1 / 48, 9);
  });
  it('maps a time to the bucket that contains it', () => {
    expect(indexAt(45.99, 'daily', 84)).toBe(45);
    expect(indexAt(46, 'daily', 84)).toBe(46);
    expect(indexAt(3.75, 'hourly', 84 * 24)).toBe(90);
    expect(indexAt(-1, 'daily', 84)).toBe(0);
    expect(indexAt(1000, 'daily', 84)).toBe(83);
  });
  it('snaps and steps by whole samples, clamped to the horizon', () => {
    expect(snapT(45.2, 'daily', 84)).toBe(45.5);
    expect(snapT(45.2, 'hourly', 84)).toBeCloseTo(45 + 4.5 / 24, 9);
    expect(stepT(45.5, 'daily', 7, 84)).toBe(52.5);
    expect(stepT(83.5, 'daily', 1, 84)).toBe(83.5);
    expect(stepT(0.5, 'daily', -3, 84)).toBe(0.5);
  });
  it('round-trips between days and pixels', () => {
    const px = tToPx(21, 14, 42, 32, 1000);
    expect(px).toBeCloseTo(32 + 250, 9);
    expect(pxToT(px, 14, 42, 32, 1000)).toBeCloseTo(21, 9);
  });
  it('finds visible index ranges with a margin', () => {
    expect(visibleIndexRange(7, 14, 'daily', 84, 0)).toEqual([7, 13]);
    expect(visibleIndexRange(7, 14, 'daily', 84, 1)).toEqual([6, 14]);
    expect(visibleIndexRange(0, 84, 'daily', 84, 1)).toEqual([0, 83]);
  });
  it('interpolates drawn values between sample centres', () => {
    const v = [0, 10, 20];
    expect(interpolateAt(v, 'daily', 1)).toBeCloseTo(5, 9);
    expect(interpolateAt(v, 'daily', 0.1)).toBe(0);
    expect(interpolateAt(v, 'daily', 9)).toBe(20);
  });
  it('describes the sample under the cursor', () => {
    const time = { startDate: '2026-10-05', days: 84 };
    expect(describeSample(time, 45.5, 'daily')).toBe('Thu 19 Nov · day 46');
    expect(describeSample(time, 45 + 18.5 / 24, 'hourly')).toBe('Thu 19 Nov 18:00');
    expect(describeSample(time, 45 + 19 / 24, '6h')).toBe('Thu 19 Nov 18:00–24:00');
  });
});
