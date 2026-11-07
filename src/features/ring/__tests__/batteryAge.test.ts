import { describe, expect, it } from 'vitest';
import { batteryAge, BATTERY_FRESH_MS } from '../views/RingStatusCard';

describe('batteryAge (0.6.4: an old battery reading says how old it is)', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('a fresh reading has no age; an unknown time has none either', () => {
    expect(batteryAge(ago(10 * 60_000), now)).toBeNull();
    expect(batteryAge(ago(BATTERY_FRESH_MS - 1), now)).toBeNull();
    expect(batteryAge(null, now)).toBeNull();
    expect(batteryAge('not a date', now)).toBeNull();
  });
  it('hours, then days; words only in quiet mode', () => {
    expect(batteryAge(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(batteryAge(ago(5 * 86_400_000), now)).toBe('5 d ago');
    expect(batteryAge(ago(5 * 86_400_000), now, true)).toBe('a while ago');
    expect(batteryAge(ago(3 * 3_600_000), now, true)).not.toMatch(/\d/);
  });
});
