/**
 * Review V1c: adherence edge cases.
 */
import { describe, expect, it } from 'vitest';
import { windowCredit } from '../adherence';

describe('V1c window credit', () => {
  it('counts a meal after midnight inside a window that runs past midnight (18:00 for 8 h)', () => {
    expect(windowCredit(18, 26, [{ clockH: 19, kcal: 600 }, { clockH: 1, kcal: 400 }])).toBe(1);
  });
  it('still counts a meal outside the window', () => {
    expect(windowCredit(18, 26, [{ clockH: 19, kcal: 600 }, { clockH: 12, kcal: 400 }])).toBeCloseTo(0.6);
    expect(windowCredit(10, 18, [{ clockH: 12, kcal: 500 }, { clockH: 20, kcal: 500 }])).toBeCloseTo(0.5);
  });
});
