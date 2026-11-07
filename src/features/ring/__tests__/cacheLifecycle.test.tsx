import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeGaugeFixture } from '../fixtures';
import { setGaugeApi } from '../api';
import { clearGaugeCache, useGauge } from '../useGauge';
import { createGaugeApi, gaugeApi, type GaugeProblem } from '@/net/gauge';
import { setServerClientForTests } from '@/net/server';
import { gaugeIdentity, onGaugeIdentityChange, setGaugeIdentityClientForTests } from '@/net/gaugeIdentity';
import { setProgressGauge, useProgressGauge } from '@/features/living/progress/data/gauge';

afterEach(() => { setServerClientForTests(null); setGaugeApi(null); setProgressGauge(null); clearGaugeCache(); setGaugeIdentityClientForTests(null); });
const defer = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

it('shares one visible query, displays disk first, then replaces it with validated data for both consumers', async () => {
  const pending = defer<never>();
  const api = { ...makeGaugeFixture(), availability: vi.fn(() => pending.promise), snapshot: vi.fn(async () => ({ data: { n: 1 }, savedAt: 1234 })) };
  setGaugeApi(api as never);
  const a = renderHook(() => useGauge('availability', (g) => g.availability()));
  const b = renderHook(() => useGauge('availability', (g) => g.availability()));
  await waitFor(() => expect(a.result.current.data).toEqual({ n: 1 }));
  expect(b.result.current.data).toEqual({ n: 1 });
  expect(a.result.current.cached).toBe(true);
  expect(a.result.current.refreshing).toBe(true);
  expect(api.availability).toHaveBeenCalledTimes(1);
  act(() => pending.resolve({ n: 2 } as never));
  await waitFor(() => expect(b.result.current.data).toEqual({ n: 2 }));
  expect(a.result.current.cached).toBe(false);
  expect(a.result.current.refreshing).toBe(false);
});

it('ignores a superseded response, a late disk read, and an abandoned question', async () => {
  const old = defer<never>(), current = defer<never>(), disk = defer<never>();
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  setGaugeApi({ ...makeGaugeFixture(), availability: load, snapshot: () => disk.promise });
  const { result, unmount } = renderHook(() => useGauge('availability', (g) => g.availability()));
  act(() => result.current.refresh());
  act(() => current.resolve({ n: 2 } as never));
  await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
  await act(async () => { old.resolve({ n: 1 } as never); disk.resolve({ data: { n: 0 }, savedAt: 1 } as never); });
  expect(result.current.data).toEqual({ n: 2 });
  unmount();
});

it('a refused read outside the mounted query removes every shown snapshot', async () => {
  const pairing = { baseUrl: 'https://synthetic.invalid', person: { id: 'p', label: '' }, deviceId: 'd', pairedAt: 'pair' };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ categories: [], n: 1 })));
  const server = { pairing: () => pairing, isPaired: () => true, subscribe: () => () => undefined, chatModelOptions: () => ({ serverUrl: pairing.baseUrl, deps: { fetch } }) };
  setGaugeIdentityClientForTests(server);
  const api = createGaugeApi({ server });
  setGaugeApi(api);
  const { result } = renderHook(() => useGauge('availability', (a) => a.availability()));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  fetch.mockResolvedValue(new Response(null, { status: 403 }));
  await act(async () => { await api.daily('2026-10-31', { cached: false }); });
  expect(result.current.status).toBe('unavailable');
  expect(result.current.problem).toBe('unauthorized');
});

it('Progress rejects a late response from a previous client and can show a saved GET while waiting', async () => {
  const first = defer<never>(), next = defer<never>();
  const api = { ...makeGaugeFixture(), sleep: () => first.promise };
  setProgressGauge(api as never);
  const { result } = renderHook(() => useProgressGauge('sleep', (a) => a.sleep('2026-10-31', '2026-10-31')));
  act(() => setProgressGauge({ ...api, sleep: () => next.promise, snapshot: async () => ({ data: { sessions: ['saved'] }, savedAt: 1 }) } as never));
  await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: { sessions: ['saved'] }, cached: true, savedAt: 1 }));
  await act(async () => first.resolve({ sessions: ['old-person'] } as never));
  expect(result.current).toEqual({ status: 'ready', data: { sessions: ['saved'] }, cached: true, savedAt: 1 });
  act(() => next.resolve({ sessions: [] } as never));
  await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: { sessions: [] } }));
});

it('a same-person re-pair retires screen caches without resetting the stable import identity', () => {
  let pair = { baseUrl: 'https://fixture.invalid', person: { id: 'p', label: '' }, deviceId: 'd', pairedAt: 'one' };
  const listeners = new Set<() => void>();
  setGaugeIdentityClientForTests({ pairing: () => pair, subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } });
  const identity = gaugeIdentity();
  const changed = vi.fn();
  const off = onGaugeIdentityChange(changed);
  pair = { ...pair, pairedAt: 'two' };
  for (const fn of listeners) fn();
  expect(changed).toHaveBeenCalledWith(identity);
  expect(gaugeIdentity()).toBe(identity);
  off();
});

it('an external refusal retires pending Progress disk and derived responses without an immediate retry', async () => {
  const disk = defer<never>(), network = defer<never>();
  let problem: GaugeProblem | null = null;
  const pairing = { baseUrl: 'https://synthetic.invalid', person: { id: 'refusal', label: '' }, deviceId: 'refusal', pairedAt: 'refusal' };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
  const server = { pairing: () => pairing, isPaired: () => true, subscribe: () => () => undefined,
    chatModelOptions: () => ({ serverUrl: pairing.baseUrl, deps: { fetch } }) };
  setServerClientForTests(server as never);
  setGaugeIdentityClientForTests(server);
  await gaugeApi.availability();
  fetch.mockResolvedValue(new Response(null, { status: 403 }));
  const read = vi.fn(() => network.promise);
  setProgressGauge({ sleep: read, snapshot: () => disk.promise, status: () => ({ lastOkAt: null, problem }) } as never);
  const { result, unmount } = renderHook(() => useProgressGauge('refusal-sleep', (a) => a.sleep('2026-10-31', '2026-10-31')));
  await act(async () => { problem = 'unauthorized'; await gaugeApi.daily('2026-10-31', { cached: false }); });
  expect(result.current.status).toBe('unavailable');
  await act(async () => {
    disk.resolve({ data: { sessions: ['old disk'] }, savedAt: 1234 } as never);
    network.resolve({ sessions: ['old derived result'] } as never);
  });
  expect(result.current.status).toBe('unavailable');
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
});
