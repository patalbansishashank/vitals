// @vitest-environment node
/** `day-metrics/1` (energy SPEC A.1.1 #24, #25, #34): a golden per field and a dropped `peakHr` spike. */
import { describe, expect, it } from 'vitest';
import { avgWorkoutHr, dropSpikes, heldPeak, idleReadings, nonExerciseHr, peakHr, type Reading } from './dayMetrics.ts';

const T = Date.parse('2026-10-20T03:00:00Z');
const r = (min: number, bpm: number): Reading => ({ tMs: T + min * 60_000, bpm, id: `h${min}` });

describe('derived.peakHr', () => {
  it('drops a reading more than 40 bpm from the median of its ±2 neighbours (a spike), and keeps a real high', () => {
    const day = [r(0, 72), r(10, 75), r(20, 180), r(30, 74), r(40, 76), r(50, 110)];
    expect(dropSpikes(day).map((x) => x.bpm)).toEqual([72, 75, 74, 76, 110]);
    expect(peakHr(day, [])).toEqual({ bpm: 110, at: T + 50 * 60_000, source: 'hr', lowerBound: true });
    expect(peakHr([], [])).toBeNull();
  });

  it('a workout competes with its held peak (2 consecutive 10-s samples); one high sample alone is not held', () => {
    const w = { id: 'w-1', startMs: T + 60 * 60_000, endMs: T + 70 * 60_000, avgHr: 150, durationS: 600, samples: [
      { tMs: T + 61 * 60_000, bpm: 168 }, { tMs: T + 61 * 60_000 + 10_000, bpm: 171 }, { tMs: T + 61 * 60_000 + 20_000, bpm: 190 }, { tMs: T + 63 * 60_000, bpm: 160 },
    ] };
    expect(heldPeak(w.samples)).toEqual({ tMs: T + 61 * 60_000 + 10_000, bpm: 171 });
    const p = peakHr([r(0, 72), r(10, 75), r(20, 80)], [w]);
    expect(p).toEqual({ bpm: 171, at: T + 61 * 60_000 + 10_000, source: 'workout:w-1', lowerBound: true });
    expect(peakHr([r(0, 72)], [w], true)!.lowerBound).toBe(false);
  });
});

describe('derived.nonExerciseHr and sampledIdleHr', () => {
  const ctx = {
    workouts: [{ startMs: T + 60 * 60_000, endMs: T + 90 * 60_000 }],
    sleep: [{ startMs: T - 8 * 60 * 60_000, endMs: T }],
    minuteSteps: new Map([[T + 30 * 60_000, { steps: 95 }]]),
  };
  it('leaves out sleep, workouts plus a 10-min cooldown and minutes with a cadence ≥ 60/min; the median needs 5', () => {
    const xs = [r(-30, 52), r(5, 70), r(15, 72), r(30, 110), r(45, 74), r(75, 150), r(95, 120), r(105, 78), r(120, 71), r(130, 73)];
    expect(idleReadings(xs, ctx).map((x) => x.bpm)).toEqual([70, 72, 74, 78, 71, 73]);
    expect(nonExerciseHr(xs, ctx)).toEqual({ median: 72.5, n: 6 });
    expect(nonExerciseHr(xs.slice(0, 5), ctx)).toEqual({ median: null, n: 3, reason: 'tooFewReadings' });
    // the baselines' sampled form keeps the walking minute (no cadence rule there)
    expect(idleReadings(xs, { workouts: ctx.workouts, sleep: ctx.sleep }).map((x) => x.bpm)).toContain(110);
  });
});

describe('derived.avgWorkoutHr', () => {
  it('weights each workout\'s average by its duration; workouts without one are skipped', () => {
    expect(avgWorkoutHr([{ avgHr: 150, durationS: 1800 }, { avgHr: 120, durationS: 600 }, { avgHr: null, durationS: 900 }])).toEqual({ bpm: 142.5, workoutS: 2400 });
    expect(avgWorkoutHr([{ avgHr: null, durationS: 900 }])).toBeNull();
  });
});

describe('codex-core #20: a duplicated reading is one physical reading', () => {
  it('a 220-bpm spike stored twice (workout telemetry and a metric reading) never becomes the held peak', () => {
    const t = T + 61 * 60_000;
    const xs: Reading[] = [{ tMs: t - 10_000, bpm: 100 }, { tMs: t, bpm: 220, id: 'telemetry' }, { tMs: t, bpm: 220, id: 'metric' }, { tMs: t + 10_000, bpm: 100 }];
    expect(heldPeak(xs)).toEqual({ tMs: t - 10_000, bpm: 100 });
    // two distinct samples 10 s apart still hold it
    expect(heldPeak([{ tMs: t, bpm: 220 }, { tMs: t + 10_000, bpm: 218 }])).toEqual({ tMs: t + 10_000, bpm: 218 });
  });
});
