/**
 * (r069 U2) The period logic behind the shared date control: the periods themselves, their words, the address form
 * that keeps them across navigation, the calendar's month grid and a period's figures.
 */
import {
  coercePeriod,
  dayPeriod,
  monthWeeks,
  overlaps,
  periodDays,
  periodEnd,
  periodFromSearch,
  periodLength,
  periodOf,
  periodSearch,
  periodStats,
  periodWords,
  rangePeriod,
  shiftMonth,
  ALL_PERIODS,
  DAY_ONLY,
  MAX_RANGE_DAYS,
} from '../period';

const TODAY = '2026-10-29'; // a Thursday

describe('periods', () => {
  it('finds the Monday-to-Sunday week, the calendar month and the year holding a day', () => {
    expect(periodOf('day', TODAY)).toEqual({ kind: 'day', from: TODAY, to: TODAY });
    expect(periodOf('week', TODAY)).toEqual({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    expect(periodOf('week', '2026-11-01')).toEqual({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    expect(periodOf('month', TODAY)).toEqual({ kind: 'month', from: '2026-10-01', to: '2026-10-31' });
    expect(periodOf('month', '2028-02-10')).toEqual({ kind: 'month', from: '2028-02-01', to: '2028-02-29' });
    expect(periodOf('year', TODAY)).toEqual({ kind: 'year', from: '2026-01-01', to: '2026-12-31' });
  });

  it('orders a range and keeps it to two years', () => {
    expect(rangePeriod('2026-10-20', '2026-10-12')).toEqual({ kind: 'range', from: '2026-10-12', to: '2026-10-20' });
    const long = rangePeriod('2020-01-01', TODAY);
    expect(long.to).toBe(TODAY);
    expect(periodLength(long)).toBe(MAX_RANGE_DAYS);
  });

  it('ends a running period today and lists only the days that have happened', () => {
    const week = periodOf('week', TODAY);
    expect(periodEnd(week, TODAY)).toBe(TODAY);
    expect(periodDays(week, TODAY)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', TODAY]);
    expect(periodDays(periodOf('month', '2026-09-03'), TODAY)).toHaveLength(30);
    expect(periodDays(periodOf('week', '2026-11-05'), TODAY)).toEqual([]);
  });

  it('turns a period a page cannot show into the day it ends on so far', () => {
    expect(coercePeriod(periodOf('week', TODAY), DAY_ONLY, TODAY)).toEqual(dayPeriod(TODAY));
    expect(coercePeriod(periodOf('month', '2026-09-10'), DAY_ONLY, TODAY)).toEqual(dayPeriod('2026-09-30'));
    expect(coercePeriod(periodOf('month', '2026-09-10'), ALL_PERIODS, TODAY).kind).toBe('month');
  });
});

describe('periodWords', () => {
  it('reads a day relative to today, with the year only when it is another', () => {
    expect(periodWords(dayPeriod(TODAY), TODAY).text).toBe('Today · Thu 29 Oct');
    expect(periodWords(dayPeriod('2026-10-28'), TODAY).text).toBe('Yesterday · Wed 28 Oct');
    expect(periodWords(dayPeriod('2026-10-30'), TODAY).text).toBe('Tomorrow · Fri 30 Oct');
    expect(periodWords(dayPeriod('2026-10-22'), TODAY)).toEqual({ lead: null, detail: 'Thu 22 Oct', text: 'Thu 22 Oct' });
    expect(periodWords(dayPeriod('2025-12-30'), TODAY).text).toBe('Tue 30 Dec 2025');
  });

  it('names this and last week, this month and this year; others by their dates', () => {
    expect(periodWords(periodOf('week', TODAY), TODAY).text).toBe('This week · 26 Oct–1 Nov');
    expect(periodWords(periodOf('week', '2026-10-20'), TODAY).text).toBe('Last week · 19–25 Oct');
    expect(periodWords(periodOf('week', '2026-10-06'), TODAY).text).toBe('Week · 5–11 Oct');
    expect(periodWords(periodOf('month', TODAY), TODAY).text).toBe('This month · October 2026');
    expect(periodWords(periodOf('month', '2026-09-01'), TODAY).text).toBe('September 2026');
    expect(periodWords(periodOf('year', TODAY), TODAY).text).toBe('This year · 2026');
    expect(periodWords(periodOf('year', '2025-04-01'), TODAY).text).toBe('2025');
    expect(periodWords(rangePeriod('2026-10-12', TODAY), TODAY).text).toBe('12–29 Oct · 18 days');
    expect(periodWords(rangePeriod(TODAY, TODAY), TODAY).text).toBe('29 Oct · 1 day');
  });
});

describe('the address', () => {
  const read = (q: string, allowed = ALL_PERIODS) => periodFromSearch(new URLSearchParams(q), TODAY, allowed);

  it('round-trips every period through the query', () => {
    for (const p of [dayPeriod(TODAY), dayPeriod('2026-10-02'), periodOf('week', '2026-10-14'), periodOf('month', '2026-03-03'), periodOf('year', '2025-06-01'), rangePeriod('2026-09-01', '2026-10-10')]) {
      expect(read(periodSearch(p, TODAY))).toEqual(p);
    }
    expect(periodSearch(dayPeriod(TODAY), TODAY)).toBe('');
    expect(periodSearch(periodOf('week', '2026-10-14'), TODAY)).toBe('?period=week&date=2026-10-12');
    expect(periodSearch(rangePeriod('2026-09-01', '2026-10-10'), TODAY)).toBe('?period=range&from=2026-09-01&to=2026-10-10');
  });

  it('keeps the old day links, never opens a day after today, and falls back on anything it does not know', () => {
    expect(read('?date=2026-10-02')).toEqual(dayPeriod('2026-10-02'));
    expect(read('?date=2026-12-02')).toEqual(dayPeriod(TODAY));
    expect(read('?date=nonsense')).toEqual(dayPeriod(TODAY));
    expect(read('?period=fortnight&date=2026-10-02')).toEqual(dayPeriod('2026-10-02'));
    expect(read('?period=range&from=2026-10-02')).toEqual(dayPeriod(TODAY));
    // a week on a Day-only page: the week's last day so far
    expect(read('?period=week&date=2026-10-14', DAY_ONLY)).toEqual(dayPeriod('2026-10-18'));
  });
});

describe('the calendar grid', () => {
  it('lays a month out in Monday-first weeks with no empty sixth week', () => {
    const oct = monthWeeks('2026-10');
    expect(oct).toHaveLength(5);
    expect(oct[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(oct[4]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
    expect(monthWeeks('2027-02')).toHaveLength(4); // 1 Feb 2027 is a Monday
    expect(monthWeeks('2026-08')).toHaveLength(6);
  });

  it('steps months across years and tells which spans meet the bounds', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 14)).toBe('2028-01');
    expect(overlaps('2026-11-01', '2026-11-30', null, TODAY)).toBe(false);
    expect(overlaps('2026-10-01', '2026-10-31', null, TODAY)).toBe(true);
    expect(overlaps('2026-10-01', '2026-10-31', '2026-10-31', null)).toBe(true);
    expect(overlaps('2026-09-01', '2026-09-30', '2026-10-01', null)).toBe(false);
  });
});

describe('periodStats', () => {
  it('sums and averages only the days with a value', () => {
    expect(periodStats([1000, NaN, 3000, null, undefined])).toEqual({ n: 2, sum: 4000, mean: 2000 });
    const none = periodStats([NaN]);
    expect(none.n).toBe(0);
    expect(none.sum).toBe(0);
    expect(Number.isNaN(none.mean)).toBe(true);
  });
});
