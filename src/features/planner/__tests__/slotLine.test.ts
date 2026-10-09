import { describe, expect, it } from 'vitest';
import { fmtPct } from '../format';
import { slotLine } from '../RunView';

describe('slotLine', () => {
  it('joins only the parts that exist: no stray separator', () => {
    expect(slotLine({ title: 'Steady deficit', D: 0.18, pct: 81 }, 'easy')).toBe(`Steady deficit · effort 18 · goal 1 at ${fmtPct(81)}`);
    expect(slotLine({ title: 'Weekly 24-hour fasts · time-restricted eating', D: null, pct: 85 }, 'hard')).toBe(`Weekly 24-hour fasts · time-restricted eating · goal 1 at ${fmtPct(85)}`);
    expect(slotLine({ title: 'Plan', D: Number.NaN, pct: 93 }, 'hard')).toBe(`Plan · goal 1 at ${fmtPct(93)}`);
    expect(slotLine({ title: 'Hard', D: null, pct: null }, 'hard')).toBe('');
  });
});
