/**
 * 0.6.3 FX1 (final review sR15, aR11): Progress's caches and today's live steps never outlive a refusal or the pairing.
 *  - sR15 probe: a 403 (the token may not read Gauge data; the pairing stays) used to keep Progress's cached answers on
 *    screen like an offline read. Now a refusal forgets them (the Gauge answers and the timelines); offline still keeps
 *    the last good answer.
 *  - aR11: today's live step snapshot is scoped by the Gauge identity: unpairing or another person clears it, and a
 *    snapshot read under one identity is never answered under another.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GaugeProblem, GaugeTimeline } from '@/net/gauge';
import { setGaugeIdentityClientForTests } from '@/net/gaugeIdentity';
import { liveTodaySteps, setLiveTodaySteps } from '@/state/liveSteps';
import { clearTimelines, setTimelineSource, timelinesFor } from '../data/timelines';
import { PROGRESS_GAUGE_TTL_MS, setProgressGauge, useProgressGauge, type ProgressGauge } from '../data/gauge';

const TODAY = '2026-10-21';

function fakeClient(paired: { baseUrl: string; person: { id: string } } | null) {
  const listeners = new Set<() => void>();
  let p = paired;
  return {
    pairing: () => p as never,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(next: typeof paired) {
      p = next;
      for (const l of [...listeners]) l();
    },
  };
}

afterEach(() => {
  setProgressGauge(null);
  setTimelineSource(null);
  clearTimelines();
  setLiveTodaySteps(null);
  setGaugeIdentityClientForTests(null);
  vi.useRealTimers();
});

describe('sR15: a refusal is not an offline read', () => {
  it('the probe: an answer shown, then a 403 on the refresh: the card is unavailable, the old answer gone', async () => {
    vi.useFakeTimers();
    let problem: GaugeProblem | null = null;
    let answer: { n: number } | null = { n: 5 };
    const api = { status: () => ({ lastOkAt: null, problem }) } as unknown as ProgressGauge;
    setProgressGauge(api);
    const load = vi.fn(async () => answer);
    const { result } = renderHook(() => useProgressGauge('hp', load));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current).toEqual({ status: 'ready', data: { n: 5 } });
    // the server now refuses (403: unauthorized), the pairing stays
    answer = null;
    problem = 'unauthorized';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_GAUGE_TTL_MS + 100);
    });
    expect(load).toHaveBeenCalledTimes(2);
    // the reproduction: { status: 'ready', data: { n: 5 } }
    expect(result.current).toEqual({ status: 'unavailable' });
  });

  it('offline keeps the last good answer (unchanged)', async () => {
    vi.useFakeTimers();
    let answer: { n: number } | null = { n: 5 };
    const api = { status: () => ({ lastOkAt: null, problem: answer ? null : 'offline' }) } as unknown as ProgressGauge;
    setProgressGauge(api);
    const { result } = renderHook(() => useProgressGauge('hp', async () => answer));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    answer = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_GAUGE_TTL_MS + 100);
    });
    expect(result.current).toEqual({ status: 'ready', data: { n: 5 }, cached: true, savedAt: null });
  });

  it('timelines: a refused re-read drops every day kept; an offline one keeps it', async () => {
    let problem: GaugeProblem | null = null;
    let up = true;
    setTimelineSource(async (date) => (up ? ({ date, minutes: 1440 } as unknown as GaugeTimeline) : null), () => problem);
    const t0 = Date.parse('2026-10-21T06:00:00Z');
    await timelinesFor(['2026-10-20', '2026-10-21'], TODAY, t0);
    up = false;
    problem = 'offline';
    expect((await timelinesFor(['2026-10-21'], TODAY, t0 + 6 * 60_000)).get('2026-10-21')).not.toBeNull();
    problem = 'unauthorized';
    expect((await timelinesFor(['2026-10-21'], TODAY, t0 + 12 * 60_000)).get('2026-10-21')).toBeNull();
    // the other day, fresh until now, is gone too
    expect((await timelinesFor(['2026-10-20'], TODAY, t0 + 12 * 60_000 + 1)).get('2026-10-20')).toBeNull();
  });
});

describe('aR11: the live step snapshot is scoped by the Gauge identity', () => {
  it('unpairing clears it; a snapshot taken for another person is never read; a stale read is dropped', () => {
    const c = fakeClient({ baseUrl: 'https://home.example', person: { id: 'p1' } });
    setGaugeIdentityClientForTests(c);
    setLiveTodaySteps({ day: { date: TODAY, steps: 4200 }, at: '2026-10-21T05:00:00Z' });
    expect(liveTodaySteps()).toMatchObject({ day: { steps: 4200 } });
    // another person on the same server: never read back
    c.set({ baseUrl: 'https://home.example', person: { id: 'p2' } });
    expect(liveTodaySteps()).toBeNull();
    // a read that started under p1 and lands now is obsolete
    setLiveTodaySteps({ day: { date: TODAY, steps: 9999 }, at: '2026-10-21T05:05:00Z' }, 'https://home.example|p1');
    expect(liveTodaySteps()).toBeNull();
    setLiveTodaySteps({ day: { date: TODAY, steps: 100 }, at: '2026-10-21T05:06:00Z' });
    expect(liveTodaySteps()).toMatchObject({ day: { steps: 100 } });
    // unpaired: cleared
    c.set(null);
    expect(liveTodaySteps()).toBeNull();
    c.set({ baseUrl: 'https://home.example', person: { id: 'p2' } });
    expect(liveTodaySteps()).toBeNull();
  });
});
