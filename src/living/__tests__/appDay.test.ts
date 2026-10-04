import { describe, expect, it } from 'vitest';
import { appDay, DEFAULT_ROLLOVER_H, rolloverOf } from '../appDay';

// local wall times in the runtime zone (the default when no tz is given)
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('appDay (SUITE_SPEC §3.4: the day rolls over at 04:00)', () => {
  it('is yesterday between midnight and the rollover hour, today from 04:00', () => {
    expect(DEFAULT_ROLLOVER_H).toBe(4);
    expect(appDay(local(2026, 10, 2, 0, 30))).toBe('2026-10-01');
    expect(appDay(local(2026, 10, 2, 3, 59))).toBe('2026-10-01');
    expect(appDay(local(2026, 10, 2, 4, 0))).toBe('2026-10-02');
    expect(appDay(local(2026, 10, 2, 23, 59))).toBe('2026-10-02');
    // month and year boundaries
    expect(appDay(local(2026, 1, 1, 1, 0))).toBe('2025-12-31');
    expect(appDay(local(2026, 3, 1, 2, 0).getTime())).toBe('2026-02-28');
  });

  it('honours a rollover hour (0 = calendar date) and ignores invalid ones', () => {
    expect(appDay(local(2026, 10, 2, 1, 0), { rolloverH: 0 })).toBe('2026-10-02');
    expect(appDay(local(2026, 10, 2, 5, 0), { rolloverH: 6 })).toBe('2026-10-01');
    expect(appDay(local(2026, 10, 2, 1, 0), { rolloverH: Number.NaN })).toBe('2026-10-01');
    expect(rolloverOf({ dayRolloverH: 5 })).toBe(5);
    expect(rolloverOf({ dayRolloverH: 30 })).toBe(4);
    expect(rolloverOf(undefined)).toBe(4);
  });

  it('reads the wall clock of an explicit zone, so a DST change in the small hours does not move the rollover', () => {
    // Europe/Berlin springs forward 2026-03-29 02:00 CET → 03:00 CEST; 04:30 CEST is 02:30Z.
    // "now minus 4 h" would land on 23:30 CET the day before; the wall clock says it is past 04:00.
    expect(appDay(Date.parse('2026-03-29T02:30:00Z'), { tz: 'Europe/Berlin' })).toBe('2026-03-29');
    expect(appDay(Date.parse('2026-03-29T01:30:00Z'), { tz: 'Europe/Berlin' })).toBe('2026-03-28'); // 03:30 CEST
    // falls back 2026-10-25 03:00 CEST → 02:00 CET; 03:59 CET is 02:59Z, 04:00 CET is 03:00Z
    expect(appDay(Date.parse('2026-10-25T02:59:00Z'), { tz: 'Europe/Berlin' })).toBe('2026-10-24');
    expect(appDay(Date.parse('2026-10-25T03:00:00Z'), { tz: 'Europe/Berlin' })).toBe('2026-10-25');
    // a zone ahead of UTC: 01:00 IST on Oct 2 is 19:30Z Oct 1
    expect(appDay(Date.parse('2026-10-01T19:30:00Z'), { tz: 'Asia/Kolkata' })).toBe('2026-10-01');
    expect(appDay(Date.parse('2026-10-01T22:30:00Z'), { tz: 'Asia/Kolkata' })).toBe('2026-10-02'); // 04:00 IST
  });
});
