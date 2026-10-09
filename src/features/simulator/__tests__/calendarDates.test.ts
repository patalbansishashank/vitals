import { describe, expect, it } from 'vitest';
import { addDaysISO, calendarGrid, dayAt, formatCellDate, rowDays } from '../lib/calendar';

const nb = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\u200b/g, '');

describe('calendar date labels', () => {
  it('every cell date is day and short month', () => {
    expect(nb(formatCellDate('2026-10-12'))).toBe('12 Oct');
    expect(nb(formatCellDate('2026-11-01'))).toBe('1 Nov');
    expect(formatCellDate('2028-02-29')).toBe('29\u00a0Feb');
  });

  it('is calendar arithmetic: leap day and a DST change do not shift dates', () => {
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysISO('2028-02-28', 2)).toBe('2028-03-01');
    expect(addDaysISO('2026-10-25', 1)).toBe('2026-10-26'); // EU clocks go back that night
    expect(addDaysISO('2026-03-28', 1)).toBe('2026-03-29'); // …and forward
  });

  it('a plan starting mid-week: the first row spans only its real days', () => {
    const start = '2026-10-29'; // Thursday
    const g = calendarGrid(start, 20);
    const first = rowDays(g, 0);
    expect(first).toEqual([0, 1, 2, 3]);
    expect(nb(formatCellDate(addDaysISO(start, first.at(-1)!)))).toBe('1 Nov');
    const lastRow = rowDays(g, g.rows - 1);
    expect(dayAt(g, g.rows - 1, 6)).toBe(lastRow.length === 7 ? 19 : -1);
    expect(addDaysISO(start, lastRow.at(-1)!)).toBe('2026-11-17');
  });
});
