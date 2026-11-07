/**
 * D2-01/D5-05: Today's fast row. A running fast reads its observed elapsed time and its planned length as separate facts
 * (the plan never extends what was observed); an ended fast reads its counted length and the clock it ended at, or
 * "End unknown" when the end is not an observed instant.
 */
import { describe, expect, it } from 'vitest';
import type { TodayView } from '@/living';
import { todayRows } from '../model';
import { todayViewFixture } from './todayView.fixture';

function fastRowWith(fast: TodayView['logged']['fast'], hours = 16): string {
  const base = todayViewFixture();
  const rx = base.prescription!;
  const view: TodayView = {
    ...base,
    prescription: { ...rx, fast: { lastIntakeAt: '2026-09-29T20:00:00Z', firstIntakeAt: '2026-09-30T12:00:00Z', hours } },
    logged: { ...base.logged, ...(fast ? { fast } : {}) },
    checklist: [...base.checklist, { id: 'fast', kind: 'fast', label: 'Fast', done: false, command: { id: 'log.fast', input: {} } }],
  };
  const row = todayRows(view).find((r) => r.glyph === 'fast');
  return (row?.target ?? '').replace(/[\u2009\u202f\u00a0]/g, ' ');
}

describe('Today fast row (D2-01/D5-05)', () => {
  it('a running fast: elapsed and planned are separate facts', () => {
    expect(fastRowWith({ state: 'running', sinceH: 10.5, remainingH: 5.5 })).toBe('elapsed 10 h 30 · planned 16 h');
  });

  it('an ended fast reads its counted length and end clock, or End unknown', () => {
    expect(fastRowWith({ state: 'done', sinceH: 16.5, endedClockH: 12.5 })).toBe('16 h 30 · ended 12:30');
    expect(fastRowWith({ state: 'broken', sinceH: 10, endedClockH: 6 })).toBe('broken · 10 h · ended 06:00');
    expect(fastRowWith({ state: 'broken' })).toBe('broken · End unknown');
  });

  it('a fast that is not running reads its planned length only', () => {
    expect(fastRowWith({ state: 'notStarted' })).toBe('16 h');
    expect(fastRowWith(undefined, 36)).toBe('36 h');
  });
});

describe('Today sleep row (D8-06)', () => {
  it('shows the entered quality as a word, and nothing when none was entered', () => {
    const base = todayViewFixture();
    const sleep = (logged: Partial<TodayView['logged']>) => todayRows({ ...base, logged: { ...base.logged, ...logged } }).find((r) => r.glyph === 'sleep');
    expect(sleep({ sleepHours: 7.25, sleepQuality: 'fair' })).toMatchObject({ detail: 'quality Fair', logged: { value: 7.25, unit: 'h' } });
    expect(sleep({ sleepHours: 7.25 })?.detail).toBeUndefined();
  });
});
