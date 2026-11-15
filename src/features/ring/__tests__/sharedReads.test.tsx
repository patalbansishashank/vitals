/**
 * (r087) A card and the real client, with someone else waiting on the same request. The client shares identical reads,
 * so a question asked again because something changed (a write, new data, the app coming back) must get its own
 * request: the one already with the server may answer what was true before.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { createGaugeApi, type GaugeApi, type GaugeV2Api } from '@/net/gauge';
import type { GaugeCacheStore } from '@/net/gaugeCache';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { setGaugeApi } from '../api';
import type { RingApi } from '../types';
import { GAUGE_PENDING_MAX_AGE_MS, clearGaugeCache, useGauge } from '../useGauge';

const BASE = 'https://synthetic.invalid';
const DAY = '2026-11-14';
const BEGAN = Date.parse('2026-11-15T12:00:00Z');
const noStore: GaugeCacheStore = { get: async () => null, put: async () => undefined, clear: async () => undefined, retain: async () => undefined };
const answerOf = (steps: number) => ({ date: DAY, activity: { steps }, installations: [] });

interface Call { signal: AbortSignal; answer: (steps: number) => void }

/** A paired server whose every request waits until the test answers it. */
function server() {
  const calls: Call[] = [];
  const fetch = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    calls.push({ signal, answer: (steps) => resolve(new Response(JSON.stringify(answerOf(steps)), { status: 200 })) });
  })) as typeof globalThis.fetch;
  const pairing = { baseUrl: BASE, person: { id: 'p', label: '' }, deviceId: 'd', pairedAt: 'pair' };
  return { calls, pairing: () => pairing, isPaired: () => true, subscribe: () => () => undefined, chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch } }) };
}

let clock: MockInstance<() => number>;
let now = BEGAN;
const pass = (ms: number) => { now += ms; clock.mockReturnValue(now); };
/** Lets the client's own steps (its snapshot read, the queue) and the hook's run. */
const settle = () => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 15)); });
function show(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

let s: ReturnType<typeof server>;
let api: GaugeApi & GaugeV2Api;
const load = (a: RingApi) => a.daily(DAY);
const steps = (card: { result: { current: ReturnType<typeof useGauge<Awaited<ReturnType<typeof load>>>> } }) => card.result.current.data?.activity?.steps;

beforeEach(() => {
  now = BEGAN;
  clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  s = server();
  api = createGaugeApi({ server: s, tz: () => 'UTC', store: noStore });
  setGaugeApi(api);
});
afterEach(() => {
  cleanup();
  setGaugeApi(null);
  clearGaugeCache();
  Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
});

it('refresh() after a write sends a new request, though the import still waits on the one from before', async () => {
  const importer = api.daily(DAY);
  const card = renderHook(() => useGauge('day', load));
  await settle();
  // first asked, the card shares the import's request
  expect(s.calls).toHaveLength(1);
  pass(2000);
  act(() => card.result.current.refresh());
  await settle();
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0]!.signal.aborted).toBe(false);
  await act(async () => { s.calls[0]!.answer(100); await importer; });
  expect(card.result.current.refreshing).toBe(true);
  await act(async () => { s.calls[1]!.answer(200); });
  await settle();
  expect(steps(card)).toBe(200);
  expect(card.result.current).toMatchObject({ cached: false, problem: null, refreshing: false });
  expect(s.calls).toHaveLength(2);
});

it('new data asks a settled card with a new request, not the background read sent before the data changed', async () => {
  const card = renderHook(() => useGauge('day', load));
  await settle();
  await act(async () => { s.calls[0]!.answer(100); });
  await settle();
  expect(steps(card)).toBe(100);
  const background = api.daily(DAY);
  await settle();
  expect(s.calls).toHaveLength(2);
  pass(2000);
  act(() => notifyGaugeDataChanged());
  await settle();
  expect(s.calls).toHaveLength(3);
  await act(async () => { s.calls[1]!.answer(100); await background; });
  expect(steps(card)).toBe(100);
  await act(async () => { s.calls[2]!.answer(200); });
  await settle();
  expect(steps(card)).toBe(200);
  expect(card.result.current).toMatchObject({ cached: false, refreshing: false });
});

it('the once-more read after new data is a new request too, and a later reader joins it', async () => {
  const importer = api.daily(DAY);
  const card = renderHook(() => useGauge('day', load));
  await settle();
  expect(s.calls).toHaveLength(1);
  pass(2000);
  act(() => notifyGaugeDataChanged());
  await settle();
  // the read under way is left alone
  expect(s.calls).toHaveLength(1);
  // another read of the same day goes out before the first answers: it is newer than the change, so it will do
  pass(1000);
  const fresh = api.withOptions!({ since: now - 500 }).daily(DAY);
  await settle();
  expect(s.calls).toHaveLength(2);
  await act(async () => { s.calls[0]!.answer(100); await importer; });
  await settle();
  expect(steps(card)).toBe(100);
  expect(card.result.current.refreshing).toBe(true);
  expect(s.calls).toHaveLength(2);
  await act(async () => { s.calls[1]!.answer(200); await fresh; });
  await settle();
  expect(steps(card)).toBe(200);
  expect(card.result.current.refreshing).toBe(false);
  expect(s.calls).toHaveLength(2);
});

it('coming back after a long pause sends a new request, though another reader still waits on the frozen one', async () => {
  const importer = api.daily(DAY);
  const card = renderHook(() => useGauge('day', load));
  await settle();
  expect(s.calls).toHaveLength(1);
  pass(GAUGE_PENDING_MAX_AGE_MS * 3);
  act(() => { document.dispatchEvent(new Event('resume')); });
  await settle();
  expect(s.calls).toHaveLength(2);
  // the import has not given up its request; the card no longer waits for it
  expect(s.calls[0]!.signal.aborted).toBe(false);
  await act(async () => { s.calls[1]!.answer(200); });
  await settle();
  expect(steps(card)).toBe(200);
  await act(async () => { s.calls[0]!.answer(100); await importer; });
  await settle();
  expect(steps(card)).toBe(200);
  expect(s.calls).toHaveLength(2);
});

it('a read owed once more that answers while the app is hidden is asked when it comes back, not before', async () => {
  const card = renderHook(() => useGauge('day', load));
  await settle();
  pass(1000);
  act(() => notifyGaugeDataChanged());
  act(() => show('hidden'));
  await act(async () => { s.calls[0]!.answer(100); });
  await settle();
  expect(steps(card)).toBe(100);
  expect(s.calls).toHaveLength(1);
  pass(5000);
  act(() => show('visible'));
  await settle();
  expect(s.calls).toHaveLength(2);
  await act(async () => { s.calls[1]!.answer(200); });
  await settle();
  expect(steps(card)).toBe(200);
  // asked once on coming back, and not a third time when that read answered
  expect(s.calls).toHaveLength(2);
});
