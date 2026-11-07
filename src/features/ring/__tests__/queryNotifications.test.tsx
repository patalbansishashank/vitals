import { StrictMode, type ReactNode } from 'react';
import type { GaugeProblem } from '@/net/gauge';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { clearGaugeCache, useGauge } from '../useGauge';
import { useTimelines } from '../load';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
afterEach(() => { cleanup(); setGaugeApi(null); clearGaugeCache(); });

it('unrelated query completion and refresh do not rerender a ready card or rebuild its timelines', async () => {
  const waiting = deferred<{ n: number }>();
  let other = waiting.promise;
  setGaugeApi(makeGaugeFixture());
  let renders = 0;
  const stable = renderHook(() => { renders++; return useTimelines([], '2026-11-01'); });
  const sibling = renderHook(() => useGauge('sibling', () => other));
  await waitFor(() => expect(stable.result.current).not.toBeNull());
  const before = renders, timelines = stable.result.current;
  await act(async () => { waiting.resolve({ n: 2 }); });
  await waitFor(() => expect(sibling.result.current.data).toEqual({ n: 2 }));
  console.info(JSON.stringify({ probe: 'unrelated completion', before, after: renders, timelineRebuilt: stable.result.current !== timelines }));
  expect(renders).toBe(before);
  expect(stable.result.current).toBe(timelines);
  other = Promise.resolve({ n: 3 });
  await act(async () => sibling.result.current.refresh());
  await waitFor(() => expect(sibling.result.current.data).toEqual({ n: 3 }));
  expect(renders).toBe(before);
  expect(stable.result.current).toBe(timelines);
});

it('same-query subscribers share the request and both update; an unrelated parent render keeps the result stable', async () => {
  setGaugeApi(makeGaugeFixture());
  let value = { n: 1 };
  const load = vi.fn(async () => value);
  const first = renderHook(() => useGauge('shared', load));
  const second = renderHook(() => useGauge('shared', load));
  await waitFor(() => expect(first.result.current.data).toEqual(value));
  expect(second.result.current.data).toEqual(value);
  expect(load).toHaveBeenCalledTimes(1);
  const before = first.result.current;
  first.rerender();
  expect(first.result.current).toBe(before);
  value = { n: 2 };
  await act(async () => first.result.current.refresh());
  await waitFor(() => expect(first.result.current.data).toEqual(value));
  expect(second.result.current.data).toEqual(value);
  expect(load).toHaveBeenCalledTimes(2);
});

it('changing the source still invalidates every query and displays the new source', async () => {
  const source = (n: number) => ({ ...makeGaugeFixture(), availability: async () => ({ n }) as never });
  setGaugeApi(source(1));
  const first = renderHook(() => useGauge('source-a', (api) => api.availability()));
  const second = renderHook(() => useGauge('source-b', (api) => api.availability()));
  await waitFor(() => expect(first.result.current.data).toEqual({ n: 1 }));
  act(() => setGaugeApi(source(2)));
  await waitFor(() => expect(first.result.current.data).toEqual({ n: 2 }));
  expect(second.result.current.data).toEqual({ n: 2 });
  act(() => setGaugeApi(null));
  await waitFor(() => expect(first.result.current.status).toBe('unavailable'));
  expect(second.result.current.status).toBe('unavailable');
  expect(first.result.current.data).toBeUndefined();
});

it('same-key saved hydration, validation, offline and refusal remain reactive under Strict Mode', async () => {
  const disk = deferred<never>(), server = deferred<never>();
  let answer: Promise<never> = server.promise;
  let problem: GaugeProblem | null = null;
  setGaugeApi({ ...makeGaugeFixture(), availability: () => answer, snapshot: () => disk.promise, status: () => ({ lastOkAt: null, problem }) });
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
  const query = renderHook(() => useGauge('stages', (api) => api.availability()), { wrapper });
  expect(query.result.current.status).toBe('loading');
  await act(async () => disk.resolve({ data: { n: 1 }, savedAt: 1234 } as never));
  expect(query.result.current).toMatchObject({ status: 'ready', data: { n: 1 }, cached: true, savedAt: 1234, refreshing: true });
  await act(async () => server.resolve({ n: 2 } as never));
  expect(query.result.current).toMatchObject({ status: 'ready', data: { n: 2 }, cached: false, refreshing: false, problem: null });
  answer = Promise.resolve(null as never);
  problem = 'offline';
  await act(async () => query.result.current.refresh());
  expect(query.result.current).toMatchObject({ status: 'ready', data: { n: 2 }, cached: true, stale: true, refreshing: false, problem: 'offline' });
  problem = 'unauthorized';
  await act(async () => query.result.current.refresh());
  expect(query.result.current).toMatchObject({ status: 'unavailable', problem: 'unauthorized' });
  expect(query.result.current.data).toBeUndefined();
});
