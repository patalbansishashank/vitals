/**
 * (r087) The owner's "loading forever" on a signal page (HRV): data notifications arrive about once a minute, and a
 * read can take longer than that. Each notification used to cancel the read and ask it again, so it never answered.
 * A read slower than the gap between notifications must still answer, uncancelled, and be asked at most once more.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import type { GaugeCallOptions } from '@/net/gauge';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import type { RingApi } from '../types';
import { clearGaugeCache, refreshGauge, useGauge } from '../useGauge';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
type Hrv = { rmssd: number };

afterEach(() => {
  cleanup();
  setGaugeApi(null);
  clearGaugeCache();
  vi.restoreAllMocks();
});

it('a read slower than the notifications reaches ready, is not cancelled, and is asked at most once more', async () => {
  const options: GaugeCallOptions[] = [];
  const fixture = makeGaugeFixture();
  const api: RingApi = { ...fixture, withOptions: (o) => { options.push(o); return fixture as never; } };
  setGaugeApi(api);
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const asked: Array<ReturnType<typeof deferred<Hrv>>> = [];
  const load = vi.fn(() => { const d = deferred<Hrv>(); asked.push(d); return d.promise; });

  const page = renderHook(() => useGauge('signal:hrv', load));
  expect(page.result.current.status).toBe('loading');
  expect(load).toHaveBeenCalledTimes(1);

  // the read stays queued for minutes while the pulse and the import keep reporting new data about once a minute
  for (let i = 0; i < 5; i++) {
    now += 60_000;
    act(() => { notifyGaugeDataChanged(); refreshGauge(); });
  }
  expect(load).toHaveBeenCalledTimes(1);
  expect(options[0]!.signal!.aborted).toBe(false);
  expect(page.result.current.status).toBe('loading');

  now += 30_000;
  await act(async () => asked[0]!.resolve({ rmssd: 42 }));
  expect(page.result.current).toMatchObject({ status: 'ready', data: { rmssd: 42 } });
  expect(options[0]!.signal!.aborted).toBe(false);
  // asked once more, for data newer than the read's start
  expect(load).toHaveBeenCalledTimes(2);

  await act(async () => asked[1]!.resolve({ rmssd: 43 }));
  expect(page.result.current).toMatchObject({ status: 'ready', data: { rmssd: 43 }, refreshing: false });
  expect(load).toHaveBeenCalledTimes(2);
  expect(options.every((o) => o.signal!.aborted === false)).toBe(true);
});
