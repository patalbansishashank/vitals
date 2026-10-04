/* Synthetic fixtures for the living-chart tests. Every number here is made up. */
import type { BlockBar, CalendarDay, DialItem, ScoreHistoryData, TrendLaneData } from '../types';

/** 14 days ending today (2026-10-01): trend 84.0 → 83.09, realistic band −0.3 / +0.5 around it. */
export function trendFixture(over: Partial<TrendLaneData> = {}): TrendLaneData {
  const days = 14;
  const trend = Array.from({ length: days }, (_, i) => 84 - 0.07 * i);
  return {
    startDate: '2026-09-18',
    days,
    todayIndex: 13,
    unit: 'kg',
    decimals: 1,
    weighIns: [0, 1, 3, 5, 6, 8, 10, 12, 13].map((day) => ({ day, value: 84.2 - 0.07 * day })),
    trend,
    trendSd: Array.from({ length: days }, () => 0.3),
    realistic: { p10: trend.map((v) => v - 0.3), p50: trend.map((v) => v + 0.1), p90: trend.map((v) => v + 0.5) },
    asPrescribed: { p10: trend.map((v) => v - 0.6), p90: trend.map((v) => v - 0.1) },
    goal: { value: 79.5, label: 'goal 79.5 kg' },
    goalDateRange: { from: '2026-12-21', to: '2026-12-30', label: 'likely 21–30 Dec' },
    ...over,
  };
}

const items = (lift: number | null): DialItem[] => [
  { id: 'lunch', label: 'Lunch', weight: 3, credit: 1 },
  { id: 'lift', label: 'Lift · 45 min', weight: 4, credit: lift },
  { id: 'steps', label: 'Steps', weight: 2, credit: 0.5 },
];

/** October 2026 (1 Oct is a Thursday); the plan runs 2–31 Oct; today is Thu 15 Oct. */
export function calendarFixture(): CalendarDay[] {
  const out: CalendarDay[] = [{ date: '2026-10-01', inPlan: false, score: null }];
  for (let d = 2; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    if (d === 5) out.push({ date, inPlan: true, score: null, assumed: true });
    else if (d === 7) out.push({ date, inPlan: true, score: null, paused: true });
    else if (d === 9) out.push({ date, inPlan: true, score: null });
    else if (d === 14) out.push({ date, inPlan: true, score: 84, items: items(1), final: true });
    else if (d === 15) out.push({ date, inPlan: true, score: 62, items: items(null), final: false });
    else if (d < 15) out.push({ date, inPlan: true, score: 70 + d, items: items(0.5), final: true });
    else out.push({ date, inPlan: true, score: null });
  }
  return out;
}

export const BARS: BlockBar[] = [
  { id: 'training', label: 'training', mean: 84, n: 3 },
  { id: 'protein', label: 'protein', mean: 91, n: 7 },
  { id: 'energy', label: 'energy', mean: 62.4, n: 7 },
  { id: 'fasting', label: 'fasting', mean: null, n: 0 },
  { id: 'steps', label: 'steps', mean: 25, n: 7 },
];

/** 28 nights from 23 Sep; a new ring on night 10, model version 1.3 from 20 Oct (night 27). */
export function scoreFixture(over: Partial<ScoreHistoryData> = {}): ScoreHistoryData {
  const days = 28;
  const nightly = Array.from({ length: days }, (_, i) => (i === 4 || i === 15 ? NaN : 42 + Math.sin(i / 2) * 4));
  const mean7 = Array.from({ length: days }, (_, i) => (i < 6 ? NaN : 42 + Math.sin(i / 5)));
  return {
    startDate: '2026-09-23',
    days,
    unit: 'ms',
    decimals: 0,
    nightly,
    mean7,
    normal: { lo: Array.from({ length: days }, (_, i) => (i < 6 ? NaN : 38)), hi: Array.from({ length: days }, (_, i) => (i < 6 ? NaN : 47)) },
    versions: [{ day: 27, label: 'v1.3 from 20 Oct' }],
    deviceChanges: [{ day: 10, label: 'new ring' }],
    compare: { label: 'compare with v1.2', values: mean7.map((v) => v - 1) },
    category: 'recovery',
    ...over,
  };
}
