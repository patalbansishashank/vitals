// @vitest-environment node
/** `hr-support/1` (energy SPEC §S2.3): gap bridging, duplicates, unknown cadence, boundaries, minute means. */
import { describe, expect, it } from 'vitest';
import { declaredCadenceS, medianGapS, minuteMeans, sampledStats, supportedSeconds, supportSegments, timeWeightedMean, type Sample } from './hrSupport.ts';

const T = Date.parse('2026-10-20T01:00:00Z');
const s = (sec: number, value: number, cadenceS: number | null = 10, id = `h${sec}`): Sample => ({ tMs: T + sec * 1000, value, cadenceS, id });

describe('hr-support/1', () => {
  it('a 10-s workout stream: each sample holds ±5 s, clipped at the midpoints to its neighbours', () => {
    const seg = supportSegments([s(0, 100), s(10, 110), s(20, 120)], T - 60_000, T + 60_000);
    expect(seg.map((x) => [(x.startMs - T) / 1000, (x.endMs - T) / 1000, x.value])).toEqual([[-5, 5, 100], [5, 15, 110], [15, 25, 120]]);
    expect(supportedSeconds(seg, T - 60_000, T + 60_000)).toBe(30);
    expect(timeWeightedMean(seg, T - 60_000, T + 60_000)).toBe(110);
  });

  it('never bridges a gap over min(2c, 60 s): the missing minute stays unsupported', () => {
    const seg = supportSegments([s(0, 100), s(10, 100), s(80, 140), s(90, 140)], T - 60_000, T + 120_000);
    expect(seg.map((x) => [(x.startMs - T) / 1000, (x.endMs - T) / 1000])).toEqual([[-5, 5], [5, 15], [75, 85], [85, 95]]);
    expect(supportedSeconds(seg, T + 15_000, T + 75_000)).toBe(0);
    // a 60-s cadence holds ±30 s at most, so two readings 2 min apart leave a minute unsupported
    const sparse = supportSegments([s(0, 60, 60), s(120, 62, 60)], T - 60_000, T + 240_000);
    expect(supportedSeconds(sparse, T + 30_000, T + 90_000)).toBe(0);
    // a long declared cadence is capped at 60 s (h ≤ 30 s)
    expect(supportSegments([s(0, 60, 300)], T - 600_000, T + 600_000).map((x) => [(x.startMs - T) / 1000, (x.endMs - T) / 1000])).toEqual([[-30, 30]]);
  });

  it('two readings at one instant are one: duplicates never add coverage, whatever their order', () => {
    const a = supportSegments([s(0, 100), s(0, 104, 10, 'h0b'), s(10, 110)], T - 60_000, T + 60_000);
    const b = supportSegments([s(10, 110), s(0, 104, 10, 'h0b'), s(0, 100)], T - 60_000, T + 60_000);
    expect(a).toEqual(b);
    expect(supportedSeconds(a, T - 60_000, T + 60_000)).toBe(20);
  });

  it('an unknown cadence gives no supported time: only sampled statistics', () => {
    const xs = [s(0, 58, null), s(300, 61, null), s(600, 55, null)];
    expect(supportSegments(xs, T - 3_600_000, T + 3_600_000)).toEqual([]);
    expect(sampledStats(xs)).toEqual({ n: 3, first: 58, last: 55, median: 58, mean: 58 });
    expect(declaredCadenceS('device_history', undefined)).toBeNull();
    expect(declaredCadenceS('device_history', 300)).toBe(300);
    expect(declaredCadenceS('device_workout', undefined)).toBe(10);
  });

  it('stops at session and pause boundaries and at the window', () => {
    const seg = supportSegments([s(0, 100), s(10, 110)], T - 2000, T + 60_000, [T + 8000]);
    expect(seg.map((x) => [(x.startMs - T) / 1000, (x.endMs - T) / 1000])).toEqual([[-2, 5], [8, 15]]);
  });

  it('minute means are time-weighted over supported seconds; unsupported minutes stay null', () => {
    const xs = Array.from({ length: 6 }, (_, i) => s(i * 10 + 5, i < 3 ? 100 : 130));
    const m = minuteMeans(supportSegments(xs, T, T + 180_000), T, 3);
    expect(m).toEqual({ bpm: [115, null, null], supportedS: [60, 0, 0] });
  });

  it('medianGapS needs at least 3 readings', () => {
    expect(medianGapS([T, T + 60_000])).toBeNull();
    expect(medianGapS([T, T + 60_000, T + 300_000])).toBe(150);
  });
});
