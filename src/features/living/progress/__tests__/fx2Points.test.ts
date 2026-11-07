// r063 FX2 (final review sR04/aR07, sR05/aR06): the day's Heart Points partition time into disjoint pieces at bout and
// HR boundaries (each second once, its own channel), read the exact source-aware HR segments like a bout's own points,
// and give untimed activities only time that earned nothing else.
import { describe, expect, it } from 'vitest';
import { dayHeartPoints, type DayBout } from '../data/actuals';
import type { TimelineMinute } from '../data/timelines';

const T0 = Date.parse('2026-10-01T04:00:00Z');
const MIN = 60_000;
const S = 1000;
const bout = (id: string, start: number, end: number, met: number, gait: 'walk' | 'run' | null = null): DayBout => ({ id, window: { start, end }, met, gait, incrementalKcalPerMin: null, envelope: null });
const none = (): TimelineMinute | undefined => undefined;
const brisk: TimelineMinute = { sleep: 'none', steps: 120, support: 'minute', hr: null };
const still: TimelineMinute = { sleep: 'none', steps: 0, support: 'minute', hr: null };

describe('sR04/aR07: disjoint daily accounting', () => {
  it('one moderate 30-second bout earns 0.5', () => {
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: none, bouts: [bout('a', T0, T0 + 30 * S, 4)], ageY: 40 })).toBeCloseTo(0.5, 9);
  });

  it('two bouts over the same moderate 30 seconds earn 0.5, not 1', () => {
    const bouts = [bout('a', T0, T0 + 30 * S, 4), bout('b', T0, T0 + 30 * S, 4)];
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: none, bouts, ageY: 40 })).toBeCloseTo(0.5, 9);
  });

  it('adjacent moderate and vigorous 30-second bouts earn 1.5 (each piece its own MET)', () => {
    const bouts = [bout('m', T0, T0 + 30 * S, 4), bout('v', T0 + 30 * S, T0 + MIN, 8)];
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: none, bouts, ageY: 40 })).toBeCloseTo(1.5, 9);
  });

  it('partly overlapping bouts count their union once', () => {
    // a: 0-40 s, b: 20-60 s, both moderate: the union is the whole minute = 1 point
    const bouts = [bout('a', T0, T0 + 40 * S, 4), bout('b', T0 + 20 * S, T0 + MIN, 4)];
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: none, bouts, ageY: 40 })).toBeCloseTo(1, 9);
  });

  it('a timed moderate minute plus an untimed minute in a one-minute window: the untimed one has no free time', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: none, bouts: [bout('a', T0, T0 + MIN, 4)], unplaced: [{ durationMin: 1, met: 4, gait: null }], ageY: 40 });
    expect(p).toBeCloseTo(1, 9);
  });

  it('an untimed activity never stacks on time that already earned from locomotion', () => {
    // an hour of brisk walking (60 points) and an untimed 30-minute 6-MET log: no second of the hour is free
    const p = dayHeartPoints({ start: T0, end: T0 + 60 * MIN, minuteAt: () => brisk, bouts: [], unplaced: [{ durationMin: 30, met: 6, gait: null }], ageY: 40 });
    expect(p).toBeCloseTo(60, 6);
  });

  it('an untimed activity earns on its MET in time that earned nothing', () => {
    const minuteAt = (t: number) => (t < T0 + 60 * MIN ? brisk : still);
    const p = dayHeartPoints({ start: T0, end: T0 + 120 * MIN, minuteAt, bouts: [], unplaced: [{ durationMin: 30, met: 6, gait: null }], ageY: 40 });
    expect(p).toBeCloseTo(60 + 60, 6);
  });

  it('asleep time is never free time for an untimed activity', () => {
    const asleep: TimelineMinute = { sleep: 'asleep', steps: null, support: null, hr: null };
    const p = dayHeartPoints({ start: T0, end: T0 + 10 * MIN, minuteAt: () => asleep, bouts: [], unplaced: [{ durationMin: 30, met: 6, gait: null }], ageY: 40 });
    expect(p).toBe(0);
  });

  it('the settled rule holds: brisk walking earns outside activities, still minutes do not', () => {
    expect(dayHeartPoints({ start: T0, end: T0 + 30 * MIN, minuteAt: () => brisk, bouts: [], ageY: 40 })).toBeCloseTo(30, 6);
    expect(dayHeartPoints({ start: T0, end: T0 + 30 * MIN, minuteAt: () => still, bouts: [], ageY: 40 })).toBe(0);
  });
});

describe('sR05/aR06: daily points read the exact HR segments', () => {
  // age 40: Fit HRmax 178.4; 110 bpm = 62 % (1/min), 150 bpm = 84 % (2/min), the minute mean 130 = 73 % (2/min)
  const meanMinute: TimelineMinute = { sleep: 'none', steps: null, support: null, hr: { bpm: 130, supportedS: 60 } };
  const exact = [
    { start: T0, end: T0 + 30 * S, bpm: 110 },
    { start: T0 + 30 * S, end: T0 + MIN, bpm: 150 },
  ];

  it('30 s at 110 then 30 s at 150 inside an approved bout earn 1.5, as the bout estimate does', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: () => meanMinute, bouts: [bout('a', T0, T0 + MIN, 4)], hrExact: exact, ageY: 40 });
    expect(p).toBeCloseTo(1.5, 9);
  });

  it('without exact segments the minute mean stands for the minute (2)', () => {
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: () => meanMinute, bouts: [bout('a', T0, T0 + MIN, 4)], ageY: 40 })).toBeCloseTo(2, 9);
  });

  it('exact segments are clipped to the bout\'s moving parts and the day bounds', () => {
    // the bout moves only in the second half of the minute: only the 150-bpm half earns inside it (1 point); the first
    // half has no locomotion and no activity, so its HR earns nothing
    const b: DayBout = { ...bout('a', T0, T0 + MIN, 4), parts: [{ start: T0 + 30 * S, end: T0 + MIN }] };
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: () => meanMinute, bouts: [b], hrExact: exact, ageY: 40 })).toBeCloseTo(1, 9);
    // the day ends 30 s into the minute: only the first half counts
    expect(dayHeartPoints({ start: T0, end: T0 + 30 * S, minuteAt: () => meanMinute, bouts: [bout('a', T0, T0 + MIN, 4)], hrExact: exact, ageY: 40 })).toBeCloseTo(0.5, 9);
  });

  it('a Health Connect minute keeps its minute mean even with Gauge segments elsewhere', () => {
    const hcMinute: TimelineMinute = { sleep: 'none', steps: null, support: null, hr: { bpm: 150, supportedS: 60, source: 'hc:com.example' } };
    const minuteAt = (t: number) => (t < T0 + MIN ? meanMinute : hcMinute);
    // minute 1: Gauge exact (1.5); minute 2: HC minute mean 150 (2), though the Gauge answer has nothing there
    const p = dayHeartPoints({ start: T0, end: T0 + 2 * MIN, minuteAt, bouts: [bout('a', T0, T0 + 2 * MIN, 4)], hrExact: exact, ageY: 40 });
    expect(p).toBeCloseTo(3.5, 9);
  });

  it('a Gauge minute the exact answer has nothing for keeps its minute mean (never unknown)', () => {
    const p = dayHeartPoints({ start: T0, end: T0 + 2 * MIN, minuteAt: () => meanMinute, bouts: [bout('a', T0, T0 + 2 * MIN, 4)], hrExact: exact, ageY: 40 });
    expect(p).toBeCloseTo(1.5 + 2, 9);
  });

  it('partial minute-mean support is shared, never used twice inside and outside a bout', () => {
    // 30 supported seconds at 150 in a minute whose second half is a bout: the bout takes the 30 s first (1 point), the
    // rest of the minute (no activity, no locomotion) earns nothing either way
    const half: TimelineMinute = { sleep: 'none', steps: 120, support: 'minute', hr: { bpm: 150, supportedS: 30 } };
    const b = bout('a', T0 + 30 * S, T0 + MIN, 4);
    // bout half: 30 s HR at 150 (2/min) = 1; other half: walking, HR all used, cadence 120 (1/min) = 0.5
    expect(dayHeartPoints({ start: T0, end: T0 + MIN, minuteAt: () => half, bouts: [b], ageY: 40 })).toBeCloseTo(1.5, 9);
  });
});
