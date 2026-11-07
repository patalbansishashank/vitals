import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { clearGaugeCache, useGauge } from '../useGauge';

afterEach(() => { cleanup(); setGaugeApi(null); clearGaugeCache(); });

it('removes a formerly populated card when the server authoritatively returns null', async () => {
  setGaugeApi(makeGaugeFixture());
  let value: { steps: number } | null = { steps: 100 };
  const card = renderHook(() => useGauge('live-steps', async () => value));
  await waitFor(() => expect(card.result.current.data).toEqual({ steps: 100 }));
  value = null;
  await act(async () => card.result.current.refresh());
  expect(card.result.current.status).toBe('unavailable');
  expect(card.result.current.data).toBeUndefined();
});

it('revalidates mounted cards on Android resume without opening a detail view', async () => {
  setGaugeApi(makeGaugeFixture());
  let value = { steps: 100 };
  const card = renderHook(() => useGauge('resume-steps', async () => value));
  await waitFor(() => expect(card.result.current.data).toEqual({ steps: 100 }));
  value = { steps: 200 };
  await act(async () => document.dispatchEvent(new Event('resume')));
  expect(card.result.current.data).toEqual({ steps: 200 });
});

it('keeps cached readings on a rejected read and accepts an explicit empty collection', async () => {
  setGaugeApi(makeGaugeFixture());
  let read: () => Promise<number[] | null> = async () => [100];
  const card = renderHook(() => useGauge('empty-steps', () => read()));
  await waitFor(() => expect(card.result.current.data).toEqual([100]));
  read = async () => { throw new Error('offline'); };
  await act(async () => card.result.current.refresh());
  expect(card.result.current.data).toEqual([100]);
  read = async () => [];
  await act(async () => card.result.current.refresh());
  expect(card.result.current.data).toEqual([]);
});
