// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BenchRow } from '../bench/benchEntry';
import { measureWithLoadRetry } from './loadRetry';

const rows = (ms: number): BenchRow[] => [{ mode: 'planner', bestMs: ms, medianMs: ms + 1 }];
const within = (result: BenchRow[]) => result.every((row) => row.bestMs <= 10);
function rig(loads: number[], start = 0) {
  let clock = start;
  let load = loads[0]!;
  return {
    now: () => clock,
    load: vi.fn(() => { load = loads.shift() ?? load; return load; }),
    sleep: vi.fn(async (ms: number) => { clock += ms; }),
  };
}

describe('bounded O-11 retry policy', () => {
  it('accepts a measured pass under high rolling load without waiting or adding samples', async () => {
    const clock = rig([1.28]);
    const bench = vi.fn(() => rows(9));
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock });
    expect(bench.mock.calls).toEqual([[15]]);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(result.retry).toBeUndefined();
    expect(result.rows).toEqual(rows(9));
  });

  it('does not retry an over-budget result with low rolling load', async () => {
    const clock = rig([0.4]);
    const bench = vi.fn(() => rows(12));
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock });
    expect(bench.mock.calls).toEqual([[15]]);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(within(result.rows)).toBe(false);
  });

  it('waits for rolling load to fall, keeps both attempts, and uses only the original 15/25 sample counts', async () => {
    const clock = rig([1.28, 0.8, 0.5, 0.4]);
    const bench = vi.fn((runs: number) => rows(runs === 15 ? 12 : 9));
    const onAttempt = vi.fn();
    const onWait = vi.fn();
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock, onAttempt, onWait });
    expect(bench.mock.calls).toEqual([[15], [25]]);
    expect(result.wait).toEqual({ waitedMs: 2000, initialLoad: 1.28, finalLoad: 0.5, belowThreshold: true });
    expect(result.first.rows).toEqual(rows(12));
    expect(result.retry?.rows).toEqual(rows(9));
    expect(onAttempt.mock.calls.map(([attempt]) => attempt.runs)).toEqual([15, 25]);
    expect(onWait).toHaveBeenCalledWith(result.wait);
  });

  it('caps waiting at 120 seconds and leaves a still-busy over-budget retry failing, never skipped or exempted', async () => {
    const clock = rig([1.28]);
    const bench = vi.fn(() => rows(11.11));
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock });
    expect(result.wait).toEqual({ waitedMs: 120_000, initialLoad: 1.28, finalLoad: 1.28, belowThreshold: false });
    expect(clock.sleep).toHaveBeenCalledTimes(120);
    expect(bench.mock.calls).toEqual([[15], [25]]);
    expect(result.retry?.load).toBe(1.28);
    expect(within(result.rows)).toBe(false);
    expect(() => expect(result.rows[0]!.bestMs).toBeLessThanOrEqual(10)).toThrow();
  });

  it('caps waiting to the remaining deadline after a slow build, preserving retry/cleanup time', async () => {
    const clock = rig([1.28], 209_500);
    const bench = vi.fn(() => rows(12));
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock });
    expect(clock.sleep.mock.calls).toEqual([[500]]);
    expect(result.wait?.waitedMs).toBe(500);
    expect(bench.mock.calls).toEqual([[15], [25]]);
  });

  it('does not wait when the remaining deadline is already reserved for the retry', async () => {
    const clock = rig([1.28], 220_000);
    const bench = vi.fn(() => rows(12));
    const result = await measureWithLoadRetry(bench, within, { deadlineMs: 240_000, ...clock });
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(result.wait?.waitedMs).toBe(0);
    expect(bench.mock.calls).toEqual([[15], [25]]);
    expect(within(result.rows)).toBe(false);
  });
});
