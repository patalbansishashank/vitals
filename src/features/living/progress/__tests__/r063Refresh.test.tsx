/**
 * r063 S27/A29: live numbers refresh. Today's steps read a live snapshot apart from the throttled entry; Progress's caches
 * expire and retry a failed (null) load instead of keeping it for the session.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveStepsOverlay, planGaugeImport } from '@/living/gaugeImport';
import { todayActual } from '@/living/todayReplay';
import type { DayTemplate } from '@/engine';
import type { LogEntry, PrescribedDaySnapshot } from '@/living/types';
import type { GaugeTimeline } from '@/net/gauge';
import { clearTimelines, setTimelineSource, timelinesFor } from '../data/timelines';
import { PROGRESS_GAUGE_RETRY_MS, setProgressGauge, useProgressGauge, type ProgressGauge } from '../data/gauge';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-21';

describe("S27: today's steps come from a live snapshot, persistence stays throttled", () => {
  const head = { label: 'd', steps: 10_000, sleep: { bedH: 23, wakeH: 7 } } as unknown as DayTemplate;
  const rx = { sessions: [], template: head, steps: 10_000 } as unknown as PrescribedDaySnapshot;
  it('the probe: 1,000 → 2,000 steps 30 minutes later writes nothing (throttled); the live reading still reaches Today', () => {
    const first = planGaugeImport({ entries: [], steps: [{ date: TODAY, steps: 1000 }], sleep: [], tz: TZ, today: TODAY, now: '2026-10-21T04:00:00.000Z' });
    const entries = first.create.map((c) => ({ ...c.entry, id: c.id }) as LogEntry);
    const later = planGaugeImport({ entries, steps: [{ date: TODAY, steps: 2000 }], sleep: [], tz: TZ, today: TODAY, now: '2026-10-21T04:30:00.000Z' });
    expect(later.create).toEqual([]);
    expect(later.skipped[0]!.reason).toBe('throttled');
    const nowMs = Date.parse('2026-10-21T04:30:00.000Z');
    const stale = todayActual({ date: TODAY, prescription: rx, headTemplate: head, entries, nowMs, tz: TZ });
    expect(stale.steps.fusedSoFar).toBe(1000);
    const live = liveStepsOverlay(entries, { day: { date: TODAY, steps: 2000 }, at: '2026-10-21T04:30:00.000Z' }, { today: TODAY, tz: TZ });
    expect(live.filter((e) => e.kind === 'steps')).toHaveLength(1);
    expect(todayActual({ date: TODAY, prescription: rx, headTemplate: head, entries: live, nowMs, tz: TZ }).steps.fusedSoFar).toBe(2000);
  });
  it("the person's own steps still win; another day's snapshot is ignored", () => {
    const own = [{ id: 'u', date: TODAY, tz: TZ, kind: 'steps', steps: 500, source: { by: 'user', method: 'typed' } } as LogEntry];
    expect(liveStepsOverlay(own, { day: { date: TODAY, steps: 2000 }, at: 'x' }, { today: TODAY, tz: TZ })).toEqual(own);
    expect(liveStepsOverlay([], { day: { date: '2026-10-20', steps: 2000 }, at: 'x' }, { today: TODAY, tz: TZ })).toEqual([]);
  });
});

describe('A29: Progress caches expire and retry failures', () => {
  afterEach(() => {
    setTimelineSource(null);
    clearTimelines();
    setProgressGauge(null);
    vi.useRealTimers();
  });

  it('timelines: a failed (null) date is asked again after a minute; an old date after half an hour', async () => {
    let calls = 0;
    let up = false;
    setTimelineSource(async (date) => {
      calls++;
      return up ? ({ date, minutes: 1440 } as unknown as GaugeTimeline) : null;
    });
    const t0 = Date.parse('2026-10-21T06:00:00Z');
    expect((await timelinesFor(['2026-10-10'], TODAY, t0)).get('2026-10-10')).toBeNull();
    up = true;
    // the probe: offline at first, the day stayed empty for the session; now it is retried after the short wait
    await timelinesFor(['2026-10-10'], TODAY, t0 + 30_000);
    expect(calls).toBe(1);
    expect((await timelinesFor(['2026-10-10'], TODAY, t0 + 61_000)).get('2026-10-10')).not.toBeNull();
    expect(calls).toBe(2);
    await timelinesFor(['2026-10-10'], TODAY, t0 + 20 * 60_000);
    expect(calls).toBe(2);
    await timelinesFor(['2026-10-10'], TODAY, t0 + 32 * 60_000);
    expect(calls).toBe(3);
  });

  it('a failed Gauge answer is asked again while the card is on screen', async () => {
    vi.useFakeTimers();
    let answer: { n: number } | null = null;
    const load = vi.fn(async () => answer);
    setProgressGauge({} as ProgressGauge);
    const { result } = renderHook(() => useProgressGauge('q', load));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current).toEqual({ status: 'unavailable' });
    answer = { n: 1 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_GAUGE_RETRY_MS + 100);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ status: 'ready', data: { n: 1 } });
  });
});
