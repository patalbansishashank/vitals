/** The bus's `ctx.today` is the app's day (SUITE_SPEC §3.4): before the 04:00 rollover it is still yesterday. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, outputOf } from '..';
import { freshState } from './harness';

const todayAt = async (wall: Date): Promise<string> => {
  vi.setSystemTime(wall);
  const r = await dispatch('plan.drift', {});
  return (outputOf(r) as { asOf: string }).asOf;
};

describe('ctx.today across midnight', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('is the previous date at 01:00 and 03:59, the calendar date from 04:00', async () => {
    expect(await todayAt(new Date(2026, 9, 2, 1, 0))).toBe('2026-10-01');
    expect(await todayAt(new Date(2026, 9, 2, 3, 59))).toBe('2026-10-01');
    expect(await todayAt(new Date(2026, 9, 2, 4, 0))).toBe('2026-10-02');
    expect(await todayAt(new Date(2026, 9, 2, 13, 0))).toBe('2026-10-02');
  });
});
