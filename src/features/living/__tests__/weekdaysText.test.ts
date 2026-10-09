import { describe, expect, it } from 'vitest';
import { weekdayOf } from '@/living/dates';
import { WEEKDAY_SHORT, weekdaysText } from '../format';

describe('weekdaysText (stored plan weekdays are Monday-first)', () => {
  it('weekday 0 reads "Mon" and 6 reads "Sun"', () => {
    expect(weekdaysText([0])).toBe('Mon');
    expect(weekdaysText([6])).toBe('Sun');
  });
  it('sorts in week order and can be lowercase', () => {
    expect(weekdaysText([3, 0])).toBe('Mon · Thu');
    expect(weekdaysText([5, 1, 3], true)).toBe('tue · thu · sat');
  });
  it('agrees with weekdayOf for real dates', () => {
    expect(WEEKDAY_SHORT[weekdayOf('2026-10-05')]).toBe('Mon');
    expect(WEEKDAY_SHORT[weekdayOf('2026-10-11')]).toBe('Sun');
  });
});
