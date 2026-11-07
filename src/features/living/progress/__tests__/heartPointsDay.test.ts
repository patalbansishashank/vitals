// Progress counts Heart Points the way Today does (audit P2-25): a minute earns inside an approved activity or with
// supported locomotion (§V2.3); an approved bout adds its MET; a pending candidate adds nothing.
import { describe, expect, it } from 'vitest';
import { dayHeartPoints, type DayBout } from '../data/actuals';
import type { TimelineMinute } from '../data/timelines';

const T0 = Date.parse('2026-10-01T04:00:00Z');
const MIN = 60_000;
const walkBout = (startMin: number, lenMin: number): DayBout => ({ id: 'b', window: { start: T0 + startMin * MIN, end: T0 + (startMin + lenMin) * MIN }, met: 6, gait: 'walk', incrementalKcalPerMin: null, envelope: null });
/** Brisk cadence (steps) with minute support all day, no HR. */
const brisk: TimelineMinute = { sleep: 'none', steps: 120, support: 'minute', hr: null };

describe('Progress Heart Points (fit-points/1 eligibility)', () => {
  it('brisk walking earns with no activity booked (supported locomotion, as Fit counts it)', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt: () => brisk, bouts: [], ageY: 40 });
    // 120 minutes at a brisk cadence: 1 point a minute
    expect(p).toBeCloseTo(120, 5);
  });

  it('still minutes outside any activity earn nothing (covered, so 0 and not unknown)', () => {
    const still: TimelineMinute = { sleep: 'none', steps: 0, support: 'minute', hr: null };
    expect(dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt: () => still, bouts: [], ageY: 40 })).toBe(0);
  });

  it('an approved bout counts each minute once, on one channel', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt: () => brisk, bouts: [walkBout(10, 30)], ageY: 40 });
    // the bout's 30 minutes are not counted twice: the day stays within one point a minute plus the bout's MET channel
    expect(p).toBeGreaterThanOrEqual(120);
    expect(p).toBeLessThanOrEqual(150);
  });

  it('an approved activity with no clock time (a past-day manual log) counts on its equivalent MET', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt: () => undefined, bouts: [], unplaced: [{ durationMin: 30, met: 6, gait: null }], ageY: 40 });
    expect(p).toBeCloseTo(60, 5); // 6 MET is vigorous: 2 a minute
  });

  it('no coverage and no activity is unknown, never 0', () => {
    expect(dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt: () => undefined, bouts: [], ageY: 40 })).toBeNull();
  });
});
