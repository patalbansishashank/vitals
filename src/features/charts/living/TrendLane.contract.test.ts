/**
 * C2/C6 consumer check (D5-02, D5-05): the trend lane draws a forecast band only when the plan version holds one (the
 * living source fills an unavailable realistic band with gaps; it is never relabelled from the as-prescribed band), and
 * the goal-date bracket reads as a plain range.
 */
import { describe, expect, it } from 'vitest';
import { shownTrendData } from './TrendLane';
import type { TrendLaneData } from './types';

const N = 3;
const gaps = () => Array.from({ length: N }, () => Number.NaN);
const base: TrendLaneData = {
  startDate: '2026-10-01',
  days: N,
  todayIndex: 1,
  unit: 'kg',
  decimals: 1,
  weighIns: [],
  trend: [90, 89.8, Number.NaN],
  realistic: { p10: gaps(), p50: gaps(), p90: gaps() },
  asPrescribed: { p10: [89, 88.8, 88.6], p90: [90, 89.9, 89.8] },
  goalDateRange: { from: '2026-12-21', to: '2026-12-30', label: 'likely 21–30 Dec' },
};

describe('trend lane as drawn (C2/C6)', () => {
  it('an unavailable realistic band (all gaps) is absent, never an empty "Forecast"; the as-prescribed band stays', () => {
    const d = shownTrendData(base);
    expect(d.realistic).toBeUndefined();
    expect(d.asPrescribed).toEqual(base.asPrescribed);
  });

  it('a realistic band with values is kept as given', () => {
    const realistic = { p10: [89, 88.9, Number.NaN], p50: [89.5, 89.4, Number.NaN], p90: [90, 89.9, Number.NaN] };
    expect(shownTrendData({ ...base, realistic }).realistic).toBe(realistic);
  });

  it('the goal-date bracket is a plain range', () => {
    expect(shownTrendData(base).goalDateRange?.label).toBe('21–30 Dec');
    expect(shownTrendData({ ...base, goalDateRange: { ...base.goalDateRange!, label: '21–30 Dec' } }).goalDateRange?.label).toBe('21–30 Dec');
  });
});
