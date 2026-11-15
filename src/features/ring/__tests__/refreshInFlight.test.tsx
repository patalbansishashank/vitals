/**
 * (r087) New data never cancels a read that is under way; it is asked once more when it answers. Nothing is asked while
 * the app is hidden, and coming back asks once. A read cut off by a suspended app is given up and asked again.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import type { GaugeCallOptions } from '@/net/gauge';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import type { RingApi } from '../types';
import { GAUGE_PENDING_MAX_AGE_MS, clearGaugeCache, refreshGauge, useGauge } from '../useGauge';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
type Steps = { steps: number };

/** A client that records the options every screen read was made with. */
function client() {
  const options: GaugeCallOptions[] = [];
  const fixture = makeGaugeFixture();
  const api: RingApi = { ...fixture, withOptions: (o) => { options.push(o); return fixture as never; } };
  setGaugeApi(api);
  return options;
}
/** A loader whose every call waits for the test to answer it. */
function loader() {
  const asked: Array<ReturnType<typeof deferred<Steps>>> = [];
  const load = vi.fn(() => { const d = deferred<Steps>(); asked.push(d); return d.promise; });
  return { load, asked };
}
function show(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  setGaugeApi(null);
  clearGaugeCache();
  Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
});

it('asks as a screen, leaves a read under way alone when data arrives, and asks it once more when it answers', async () => {
  const options = client();
  const { load, asked } = loader();
  const card = renderHook(() => useGauge('steps', load));
  expect(load).toHaveBeenCalledTimes(1);
  expect(options[0]).toMatchObject({ priority: 'screen' });
  // a pulse and the import that follows it both report
  act(() => { notifyGaugeDataChanged(); notifyGaugeDataChanged(); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(options[0]!.signal!.aborted).toBe(false);
  await act(async () => asked[0]!.resolve({ steps: 1 }));
  expect(card.result.current.data).toEqual({ steps: 1 });
  expect(load).toHaveBeenCalledTimes(2);
  expect(card.result.current.refreshing).toBe(true);
  await act(async () => asked[1]!.resolve({ steps: 2 }));
  expect(card.result.current).toMatchObject({ status: 'ready', data: { steps: 2 }, refreshing: false });
  expect(load).toHaveBeenCalledTimes(2);
  expect(options.every((o) => o.signal!.aborted === false)).toBe(true);
});

it('asks a settled question again at once, and not a read that began after the data changed', async () => {
  client();
  const { load, asked } = loader();
  const card = renderHook(() => useGauge('steps', load));
  await act(async () => asked[0]!.resolve({ steps: 1 }));
  act(() => refreshGauge());
  expect(load).toHaveBeenCalledTimes(2);
  // this report is about data from before that read began: the read already has it
  act(() => refreshGauge(Date.now() - 60_000));
  await act(async () => asked[1]!.resolve({ steps: 2 }));
  expect(card.result.current.data).toEqual({ steps: 2 });
  expect(load).toHaveBeenCalledTimes(2);
});

it('asks nothing while hidden and catches up once on coming back', async () => {
  client();
  const { load, asked } = loader();
  const card = renderHook(() => useGauge('steps', load));
  await act(async () => asked[0]!.resolve({ steps: 1 }));
  act(() => show('hidden'));
  act(() => { refreshGauge(); notifyGaugeDataChanged(); });
  expect(load).toHaveBeenCalledTimes(1);
  act(() => show('visible'));
  expect(load).toHaveBeenCalledTimes(2);
  // the Android shell's own event arrives as well: the same read answers both
  act(() => { document.dispatchEvent(new Event('resume')); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => asked[1]!.resolve({ steps: 2 }));
  expect(card.result.current.data).toEqual({ steps: 2 });
  expect(load).toHaveBeenCalledTimes(2);
});

it('a read that was under way when data arrived in the background is asked once more after it answers', async () => {
  client();
  const { load, asked } = loader();
  const card = renderHook(() => useGauge('steps', load));
  act(() => show('hidden'));
  act(() => refreshGauge());
  act(() => show('visible'));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => asked[0]!.resolve({ steps: 1 }));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => asked[1]!.resolve({ steps: 2 }));
  expect(card.result.current.data).toEqual({ steps: 2 });
  expect(load).toHaveBeenCalledTimes(2);
});

it('on coming back, gives up a read that began before a long pause and asks again; a recent one is kept', async () => {
  const options = client();
  const { load, asked } = loader();
  const began = 1_800_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(began);
  const card = renderHook(() => useGauge('steps', load));
  clock.mockReturnValue(began + GAUGE_PENDING_MAX_AGE_MS - 1000);
  act(() => { document.dispatchEvent(new Event('resume')); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(options[0]!.signal!.aborted).toBe(false);
  clock.mockReturnValue(began + GAUGE_PENDING_MAX_AGE_MS + 1000);
  act(() => { document.dispatchEvent(new Event('resume')); });
  expect(options[0]!.signal!.aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => asked[1]!.resolve({ steps: 2 }));
  expect(card.result.current.data).toEqual({ steps: 2 });
  // the answer of the read that was given up never replaces its successor
  await act(async () => asked[0]!.resolve({ steps: 1 }));
  expect(card.result.current.data).toEqual({ steps: 2 });
});
