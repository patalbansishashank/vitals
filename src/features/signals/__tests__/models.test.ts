import { afterEach, describe, expect, it } from 'vitest';
import {
  calendarWeeks,
  canGoEarlier,
  canGoLater,
  containsDate,
  coverageText,
  daysUpTo,
  drillTarget,
  localDayMs,
  parseSignalsQuery,
  pastSlots,
  periodLabel,
  periodWindow,
  referenceDay,
  shiftPeriod,
  signalsHref,
  weekStart,
} from '../models';
import { planGoalsOn } from '../data';

const TODAY = '2026-10-04'; // a Sunday

describe('period windows', () => {
  it('day is one date; week is the ISO week, Monday first; month and year are calendar-aligned', () => {
    expect(periodWindow('day', '2026-10-02', TODAY)).toMatchObject({ start: '2026-10-02', end: '2026-10-03', last: '2026-10-02' });
    const w = periodWindow('week', '2026-10-02', TODAY);
    expect(w).toMatchObject({ start: '2026-09-28', end: '2026-10-05', last: '2026-10-04' });
    expect(w.slots.map((s) => s.start)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    // a Sunday belongs to the week that started on the Monday before
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
    expect(periodWindow('month', '2026-10-17', TODAY)).toMatchObject({ start: '2026-10-01', end: '2026-11-01', last: '2026-10-31' });
    expect(periodWindow('year', '2026-03-03', TODAY)).toMatchObject({ start: '2026-01-01', end: '2027-01-01', last: '2026-12-31' });
  });

  it('month lengths: 28, 29, 30 and 31 slots', () => {
    expect(periodWindow('month', '2026-02-10', TODAY).slots).toHaveLength(28);
    expect(periodWindow('month', '2028-02-10', '2028-12-31').slots).toHaveLength(29);
    expect(periodWindow('month', '2026-09-10', TODAY).slots).toHaveLength(30);
    expect(periodWindow('month', '2026-10-10', TODAY).slots).toHaveLength(31);
  });

  it('year is 12 month slots flagged past, current and future', () => {
    const y = periodWindow('year', TODAY, TODAY);
    expect(y.slots).toHaveLength(12);
    expect(y.slots[0]).toMatchObject({ start: '2026-01-01', end: '2026-02-01', future: false, current: false });
    expect(y.slots[9]).toMatchObject({ start: '2026-10-01', end: '2026-11-01', future: false, current: true });
    expect(y.slots[10]).toMatchObject({ start: '2026-11-01', future: true, current: false });
    expect(y.slots.filter((s) => s.future)).toHaveLength(2);
    expect(pastSlots(y)).toHaveLength(10);
  });

  it('the current period is truncated at today: later slots are future (drawn as nothing), the axis keeps 7 slots', () => {
    const w = periodWindow('week', '2026-10-01', '2026-10-01');
    expect(w.slots).toHaveLength(7);
    expect(w.current).toBe(true);
    expect(w.slots.map((s) => s.future)).toEqual([false, false, false, false, true, true, true]);
    expect(w.slots.find((s) => s.current)?.start).toBe('2026-10-01');
    expect(pastSlots(w)).toHaveLength(4);
    expect(daysUpTo(w, '2026-10-01')).toBe(4);
  });

  it('a 23 h or a 25 h day (a clock change) is still one slot of the week', () => {
    // Europe's clocks go back on Sun 25 Oct 2026 and forward on Sun 29 Mar 2026
    for (const d of ['2026-10-25', '2026-03-29']) {
      const w = periodWindow('week', d, '2026-12-31');
      expect(w.slots).toHaveLength(7);
      expect(w.slots[6]).toMatchObject({ start: d, end: d === '2026-10-25' ? '2026-10-26' : '2026-03-30' });
      expect(periodWindow('day', d, '2026-12-31').slots).toHaveLength(1);
    }
  });

  it('containsDate is half-open', () => {
    const w = periodWindow('week', TODAY, TODAY);
    expect(containsDate(w, '2026-09-28')).toBe(true);
    expect(containsDate(w, '2026-10-04')).toBe(true);
    expect(containsDate(w, '2026-10-05')).toBe(false);
    expect(containsDate(w, '2026-09-27')).toBe(false);
  });
});

describe('local day in milliseconds', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('runs midnight to midnight: 25 h on the autumn clock change, 23 h in spring', () => {
    process.env.TZ = 'Europe/London';
    const h = (d: string) => {
      const { start, end } = localDayMs(d);
      return (end - start) / 3_600_000;
    };
    // the runtime honours a TZ change only on some platforms; when it does, the lengths follow the clock
    if (new Date(2026, 6, 1).getTimezoneOffset() === -60) {
      expect(h('2026-10-25')).toBe(25);
      expect(h('2026-03-29')).toBe(23);
    }
    expect(h('2026-10-04')).toBe(24);
  });
});

describe('navigation', () => {
  it('switching day → week → day keeps the date (the anchor is stored, not the window start)', () => {
    const day = periodWindow('day', '2026-10-02', TODAY);
    const week = periodWindow('week', day.anchor, TODAY);
    expect(week.start).toBe('2026-09-28');
    expect(week.anchor).toBe('2026-10-02');
    const back = periodWindow('day', week.anchor, TODAY);
    expect(back.start).toBe('2026-10-02');
    // and through month and year too
    expect(periodWindow('day', periodWindow('year', periodWindow('month', '2026-10-02', TODAY).anchor, TODAY).anchor, TODAY).start).toBe('2026-10-02');
  });

  it('‹ › step to the canonical start of the neighbouring period', () => {
    expect(shiftPeriod('day', '2026-10-02', -1)).toBe('2026-10-01');
    expect(shiftPeriod('day', '2026-10-02', 1)).toBe('2026-10-03');
    expect(shiftPeriod('week', '2026-10-02', -1)).toBe('2026-09-21');
    expect(shiftPeriod('week', '2026-10-02', 1)).toBe('2026-10-05');
    expect(shiftPeriod('month', '2026-10-17', -1)).toBe('2026-09-01');
    expect(shiftPeriod('month', '2026-12-17', 1)).toBe('2027-01-01');
    expect(shiftPeriod('month', '2026-01-17', -1)).toBe('2025-12-01');
    expect(shiftPeriod('year', '2026-10-17', -1)).toBe('2025-01-01');
  });

  it('› is disabled on the current period (and only there)', () => {
    expect(canGoLater(periodWindow('day', TODAY, TODAY), TODAY)).toBe(false);
    expect(canGoLater(periodWindow('day', '2026-10-03', TODAY), TODAY)).toBe(true);
    expect(canGoLater(periodWindow('week', '2026-09-28', TODAY), TODAY)).toBe(false);
    expect(canGoLater(periodWindow('week', '2026-09-27', TODAY), TODAY)).toBe(true);
    expect(canGoLater(periodWindow('month', '2026-10-01', TODAY), TODAY)).toBe(false);
    expect(canGoLater(periodWindow('year', '2025-06-01', TODAY), TODAY)).toBe(true);
    expect(canGoLater(periodWindow('year', TODAY, TODAY), TODAY)).toBe(false);
  });

  it('‹ stops at the period that holds the first record, and with no record at all', () => {
    const first = '2026-09-15';
    expect(canGoEarlier(periodWindow('day', '2026-09-16', TODAY), first)).toBe(true);
    expect(canGoEarlier(periodWindow('day', '2026-09-15', TODAY), first)).toBe(false);
    expect(canGoEarlier(periodWindow('week', '2026-09-21', TODAY), first)).toBe(true);
    expect(canGoEarlier(periodWindow('week', '2026-09-17', TODAY), first)).toBe(false); // 14–20 Sep holds the 15th
    expect(canGoEarlier(periodWindow('month', '2026-10-01', TODAY), first)).toBe(true);
    expect(canGoEarlier(periodWindow('month', '2026-09-30', TODAY), first)).toBe(false);
    expect(canGoEarlier(periodWindow('year', TODAY, TODAY), first)).toBe(false);
    expect(canGoEarlier(periodWindow('day', TODAY, TODAY), null)).toBe(false);
  });

  it('drill down: a day of a week or month opens that day; a month of a year opens that month', () => {
    const week = periodWindow('week', TODAY, TODAY);
    expect(drillTarget('week', week.slots[2]!.start)).toEqual({ period: 'day', date: '2026-09-30' });
    expect(drillTarget('month', '2026-10-17')).toEqual({ period: 'day', date: '2026-10-17' });
    const year = periodWindow('year', TODAY, TODAY);
    expect(drillTarget('year', year.slots[2]!.start)).toEqual({ period: 'month', date: '2026-03-01' });
    expect(periodWindow('month', drillTarget('year', year.slots[2]!.start).date, TODAY).slots).toHaveLength(31);
  });
});

describe('reference day', () => {
  it('heart and activity: today', () => {
    expect(referenceDay('heart', TODAY, ['2026-10-03'])).toBe(TODAY);
    expect(referenceDay('activity', TODAY, [])).toBe(TODAY);
  });

  it('sleep: the night that ended this morning is "Last night"', () => {
    const ref = referenceDay('sleep', TODAY, ['2026-10-02', '2026-10-04', '2026-10-03']);
    expect(ref).toBe(TODAY);
    expect(periodLabel('sleep', periodWindow('day', ref, TODAY), TODAY)).toBe('Last night');
  });

  it('sleep at 02:00: no night has ended today yet, so the newest one before (not an empty "tonight")', () => {
    const ref = referenceDay('sleep', TODAY, ['2026-10-01', '2026-10-03']);
    expect(ref).toBe('2026-10-03');
    expect(periodLabel('sleep', periodWindow('day', ref, TODAY), TODAY)).toBe('Night to Sat 3 Oct');
  });

  it('sleep: a night dated after today never counts; with no night it falls back to today', () => {
    expect(referenceDay('sleep', '2026-10-03', ['2026-10-04', '2026-10-02'])).toBe('2026-10-02');
    expect(referenceDay('sleep', TODAY, [])).toBe(TODAY);
  });
});

describe('labels', () => {
  const day = (d: string) => periodWindow('day', d, TODAY);
  it('day: Today, Yesterday, a weekday date; sleep: Last night, Night to …', () => {
    expect(periodLabel('heart', day(TODAY), TODAY)).toBe('Today');
    expect(periodLabel('activity', day('2026-10-03'), TODAY)).toBe('Yesterday');
    expect(periodLabel('heart', day('2026-10-01'), TODAY)).toBe('Thu 1 Oct');
    expect(periodLabel('sleep', day(TODAY), TODAY)).toBe('Last night');
    expect(periodLabel('sleep', day('2026-10-03'), TODAY)).toBe('Night to Sat 3 Oct');
    expect(periodLabel('heart', day('2025-10-04'), TODAY)).toBe('Sat 4 Oct 2025');
  });

  it('week: "28 Sep – 4 Oct", one month "21–27 Sep", another year "29 Dec 2025 – 4 Jan 2026"', () => {
    expect(periodLabel('sleep', periodWindow('week', TODAY, TODAY), TODAY)).toBe('28 Sep – 4 Oct');
    expect(periodLabel('sleep', periodWindow('week', '2026-09-23', TODAY), TODAY)).toBe('21–27 Sep');
    expect(periodLabel('sleep', periodWindow('week', '2026-01-01', TODAY), TODAY)).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(periodLabel('sleep', periodWindow('week', '2025-10-08', TODAY), TODAY)).toBe('6–12 Oct 2025');
  });

  it('month and year', () => {
    expect(periodLabel('heart', periodWindow('month', TODAY, TODAY), TODAY)).toBe('October 2026');
    expect(periodLabel('heart', periodWindow('year', TODAY, TODAY), TODAY)).toBe('2026');
  });

  it('follows the month-day date style', () => {
    expect(periodLabel('heart', day('2026-10-01'), TODAY, 'month-day')).toBe('Thu Oct 1');
    expect(periodLabel('sleep', day('2026-10-03'), TODAY, 'month-day')).toBe('Night to Sat Oct 3');
    expect(periodLabel('sleep', periodWindow('week', TODAY, TODAY), TODAY, 'month-day')).toBe('Sep 28 – Oct 4');
    expect(periodLabel('sleep', periodWindow('week', '2026-01-01', TODAY), TODAY, 'month-day')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});

describe('coverage and days up to today', () => {
  it('coverageText', () => {
    expect(coverageText(5, 7, 'nights')).toBe('5 of 7 nights recorded');
    expect(coverageText(26, 31, 'days')).toBe('26 of 31 days recorded');
    expect(coverageText(9, 10, 'months')).toBe('9 of 10 months recorded');
  });

  it('daysUpTo counts only dates up to today', () => {
    expect(daysUpTo(periodWindow('week', '2026-09-21', TODAY), TODAY)).toBe(7);
    expect(daysUpTo(periodWindow('week', TODAY, '2026-09-30'), '2026-09-30')).toBe(3);
    expect(daysUpTo(periodWindow('month', TODAY, TODAY), TODAY)).toBe(4);
    expect(daysUpTo(periodWindow('year', TODAY, TODAY), TODAY)).toBe(277);
    expect(daysUpTo(periodWindow('day', '2026-10-05', TODAY), TODAY)).toBe(0);
  });
});

describe('URL state', () => {
  const parse = (s: string) => parseSignalsQuery(new URLSearchParams(s), TODAY);
  it('reads tab, period and date; anything else falls back to the defaults', () => {
    expect(parse('tab=heart&period=week&date=2026-10-02')).toEqual({ tab: 'heart', period: 'week', date: '2026-10-02' });
    expect(parse('')).toEqual({ tab: 'sleep', period: 'day', date: null });
    expect(parse('tab=steps&period=fortnight&date=yesterday')).toEqual({ tab: 'sleep', period: 'day', date: null });
    expect(parse('date=2026-02-30').date).toBeNull();
  });

  it('a future date is clamped to today', () => {
    expect(parse('date=2026-11-01').date).toBe(TODAY);
  });

  it('writes links that omit the defaults', () => {
    expect(signalsHref()).toBe('/signals');
    expect(signalsHref({ tab: 'sleep', period: 'day' })).toBe('/signals');
    expect(signalsHref({ tab: 'heart', period: 'week', date: '2026-10-02' })).toBe('/signals?tab=heart&period=week&date=2026-10-02');
    expect(signalsHref({ tab: 'activity', date: null })).toBe('/signals?tab=activity');
    // round trip
    expect(parse(signalsHref({ tab: 'activity', period: 'month', date: '2026-09-09' }).split('?')[1]!)).toEqual({ tab: 'activity', period: 'month', date: '2026-09-09' });
  });
});

describe('calendar weeks', () => {
  it('covers the month in Monday-first rows of seven', () => {
    const oct = calendarWeeks('2026-10-17');
    expect(oct).toHaveLength(5);
    expect(oct[0]![0]).toBe('2026-09-28');
    expect(oct[4]![6]).toBe('2026-11-01');
    expect(oct.every((w) => w.length === 7)).toBe(true);
    // Feb 2021 starts on a Monday and fills exactly four rows
    expect(calendarWeeks('2021-02-01')).toHaveLength(4);
    // Aug 2026 starts on a Saturday: six rows
    expect(calendarWeeks('2026-08-01')).toHaveLength(6);
  });
});

describe('goals from the plan', () => {
  const plan = { id: 'p1', status: 'active', startDate: '2026-09-20', pauses: [] as Array<{ from: string; to: string | null }> };
  const schedule = {
    programs: [{ label: 'a', steps: 9000, sleep: { bedH: 23, wakeH: 7 } }],
    days: Array.from({ length: 30 }, () => ({ program: 0 })),
  };
  const version = { status: 'adopted', version: 1, effectiveFromDay: 0, schedule };
  type Docs = Parameters<typeof planGoalsOn>[0];
  const docs = (over: Partial<Record<string, unknown>> = {}) => ({ plan, versions: [version], dayStatus: [], ...over }) as unknown as Docs;

  it('reads steps and sleep hours from the version in force; nothing else is invented', () => {
    expect(planGoalsOn(docs(), TODAY)).toEqual({ steps: 9000, sleepH: 8 });
  });

  it('prefers the day’s frozen prescription', () => {
    const prescribed = { items: [{ itemId: 'steps', target: { steps: 7000 } }, { itemId: 'sleep', target: { hours: 7.5 } }] };
    expect(planGoalsOn(docs({ dayStatus: [{ date: TODAY, planId: 'p1', prescribed }] }), TODAY)).toEqual({ steps: 7000, sleepH: 7.5 });
  });

  it('no plan, before the start or on a paused day: no goals', () => {
    expect(planGoalsOn(docs({ plan: null }), TODAY)).toEqual({});
    expect(planGoalsOn(docs(), '2026-09-01')).toEqual({});
    expect(planGoalsOn(docs({ plan: { ...plan, pauses: [{ from: '2026-10-01', to: null }] } }), TODAY)).toEqual({});
  });
});
