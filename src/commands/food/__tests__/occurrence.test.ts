// @vitest-environment node
/** Meal occurrence (C1/D5-01): explicit instants and clock hours only; DST folds become intervals, gaps stay date-only. */
import { describe, expect, it } from 'vitest';
import { mealOccurrence, wallInstants, zoneOffsetMin } from '../occurrence';

describe('meal occurrence', () => {
  it('a wall clock in a zone maps to one instant normally, two in a DST fold, none in a gap', () => {
    expect(wallInstants('2026-07-01', 12, 'UTC')).toEqual([Date.parse('2026-07-01T12:00:00Z')]);
    expect(wallInstants('2026-07-01', 12, 'Asia/Kolkata')).toEqual([Date.parse('2026-07-01T06:30:00Z')]);
    // Europe/London: clocks go back at 02:00 BST on 2026-10-25 (01:30 happens twice) and forward at 01:00 GMT on 2026-03-29
    expect(wallInstants('2026-10-25', 1.5, 'Europe/London')).toEqual([Date.parse('2026-10-25T00:30:00Z'), Date.parse('2026-10-25T01:30:00Z')]);
    expect(wallInstants('2026-03-29', 1.5, 'Europe/London')).toEqual([]);
    expect(zoneOffsetMin(Date.parse('2026-07-01T00:00:00Z'), 'Europe/London')).toBe(60);
  });

  it('explicit clock → exact; fold → interval; nothing stated → date-only (never the entry time or noon)', () => {
    expect(mealOccurrence({ date: '2026-07-01', tz: 'Asia/Kolkata', clockH: 20, source: 'user' }).occurrence).toMatchObject({ precision: 'exact', at: '2026-07-01T14:30:00.000Z', date: '2026-07-01', dateMeaning: 'appDay', source: 'user' });
    expect(mealOccurrence({ date: '2026-10-25', tz: 'Europe/London', clockH: 1.5, source: 'user' }).occurrence).toMatchObject({ precision: 'interval', dstAmbiguous: true });
    const none = mealOccurrence({ date: '2026-07-01', tz: 'UTC', source: 'user' });
    expect(none.occurrence).toMatchObject({ precision: 'dateOnly', date: '2026-07-01', dateMeaning: 'appDay' });
    expect(none.clockH).toBeUndefined();
    // an explicit instant wins and gives the clock on that date (after midnight of the app day: clock past 24)
    const late = mealOccurrence({ date: '2026-07-01', tz: 'UTC', occurredAt: '2026-07-02T01:15:00Z', clockH: 13, source: 'device' });
    expect(late.occurrence).toMatchObject({ precision: 'exact', at: '2026-07-02T01:15:00.000Z', source: 'device' });
    expect(late.clockH).toBeCloseTo(25.25, 9);
  });
});
