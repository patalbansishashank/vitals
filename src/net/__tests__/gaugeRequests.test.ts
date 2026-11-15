/**
 * (r087) How the Gauge client sends: three requests at a time with screens first, one request for identical reads
 * whoever cancels, a timeout that counts the server's time only, and a start that keeps the saved snapshots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDb } from '../../../tests/fakeIndexedDb';
import { GAUGE_REQUEST_TIMEOUT_MS, createGaugeApi, onFusionContextChange } from '../gauge';
import { GAUGE_CACHE_DB, createGaugeCacheStore, persistGaugeQuery, type GaugeCacheStore } from '../gaugeCache';
import { createGaugePulseApi } from '../gaugePulse';

const BASE = 'https://synthetic.invalid';
const NOW = Date.parse('2026-11-15T12:00:00Z');
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
const daily = (date: string) => ({ date, activity: { steps: 100 }, installations: [] });
const noStore: GaugeCacheStore = { get: async () => null, put: async () => undefined, clear: async () => undefined, retain: async () => undefined };

interface Call {
  url: string;
  method: string;
  headers: Headers;
  signal: AbortSignal;
  answer: (body?: unknown, status?: number, headers?: Record<string, string>) => void;
}

/** A paired server whose every request waits until the test answers it, and gives up when its signal aborts. */
function server() {
  const calls: Call[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    calls.push({
      url: String(input).slice(BASE.length), method: init?.method ?? 'GET', headers: new Headers(init?.headers), signal,
      answer: (body = {}, status = 200, headers = {}) => resolve(new Response(status === 304 ? null : JSON.stringify(body), { status, headers })),
    });
  })) as typeof globalThis.fetch;
  const pairing = { baseUrl: BASE, person: { id: 'p', label: '' }, deviceId: 'd', pairedAt: 'pair' };
  return {
    calls,
    pairing: () => pairing,
    isPaired: () => true,
    subscribe: () => () => undefined,
    chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch } }),
    /** The requests for a route, in the order they were sent. */
    sent: (route: string) => calls.filter((c) => c.url.startsWith(`/v1/gauge/${route}`)),
  };
}
const dateOf = (c: Call) => new URL(c.url, BASE).searchParams.get('date');
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the request queue in the client', () => {
  it('has three requests with the server at most, sends a screen read before waiting background reads, and never counts the pulse', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const pulse = createGaugePulseApi({ server: s });
    const held = pulse.pulse('token', { wait: 25 });
    const background = [1, 2, 3, 4, 5].map((n) => api.daily(day(n)));
    await settle();
    expect(s.sent('pulse')).toHaveLength(1);
    expect(s.sent('daily').map(dateOf)).toEqual([day(1), day(2), day(3)]);
    // an older caller that passes only a signal still works, and waits with the background reads
    const older = api.withOptions!({ signal: new AbortController().signal }).daily(day(6));
    const card = api.withOptions!({ priority: 'screen' }).daily(day(7));
    await settle();
    expect(s.sent('daily')).toHaveLength(3);
    s.sent('daily')[0]!.answer(daily(day(1)));
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(4));
    expect(dateOf(s.sent('daily')[3]!)).toBe(day(7));
    for (let i = 1; i < 7; i++) {
      await vi.waitFor(() => expect(s.sent('daily').length).toBeGreaterThan(i));
      const c = s.sent('daily')[i]!;
      c.answer(daily(dateOf(c)!));
    }
    expect((await Promise.all([...background, older, card])).map((d) => d?.date)).toEqual([1, 2, 3, 4, 5, 6, 7].map(day));
    expect(s.sent('daily').map(dateOf)).toEqual([1, 2, 3, 7, 4, 5, 6].map(day));
    s.sent('pulse')[0]!.answer({ token: 't', boot: 'b', uploads: 1, data: 1 });
    expect((await held).ok).toBe(true);
  });

  it('moves a waiting background read up when a screen asks the same question', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const busy = [1, 2, 3].map((n) => api.daily(day(n)));
    const importer = [4, 5].map((n) => api.daily(day(n), { cached: true }));
    const card = api.withOptions!({ priority: 'screen', signal: new AbortController().signal }).daily(day(5));
    await settle();
    s.sent('daily')[0]!.answer(daily(day(1)));
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(4));
    expect(dateOf(s.sent('daily')[3]!)).toBe(day(5));
    for (const c of s.sent('daily').slice(1)) c.answer(daily(dateOf(c)!));
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(5));
    s.sent('daily')[4]!.answer(daily(day(4)));
    await Promise.all([...busy, ...importer, card]);
    // the card and the importer shared one request for the same day
    expect(s.sent('daily')).toHaveLength(5);
  });

  it('starts the timeout when a request leaves the queue, and a slow answer does not mark the client offline', async () => {
    vi.useFakeTimers({ now: NOW });
    const s = server();
    const api = createGaugeApi({ server: s, tz: () => 'UTC', store: noStore });
    const views = [1, 2, 3, 4].map(() => api.withOptions!({}));
    const reads = views.map((v, i) => v.daily(day(i + 1)));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.sent('daily')).toHaveLength(3);
    s.sent('daily')[0]!.answer(daily(day(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.sent('daily')).toHaveLength(4);
    // the second and third have had their time; the fourth waited 15 s for a slot and that does not count
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS - 15_000);
    expect(s.sent('daily').map((c) => c.signal.aborted)).toEqual([false, true, true, false]);
    expect(await reads[1]).toBeNull();
    expect(await reads[2]).toBeNull();
    // the server answered the first while these two waited: slow, not out of reach
    expect(views[1]!.status().problem).toBe('server_error');
    expect(api.status().problem).toBeNull();
    // nothing answers while the fourth runs out of time: one slow read is that read's failure, not the client's
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.sent('daily')[3]!.signal.aborted).toBe(true);
    expect(await reads[3]).toBeNull();
    expect(views[3]!.status().problem).toBe('server_error');
    expect(api.status().problem).toBeNull();
  });

  it('is offline only when the requests sent after a full round of timeouts hear nothing either, and at once when none can be sent', async () => {
    vi.useFakeTimers({ now: NOW });
    const s = server();
    const api = createGaugeApi({ server: s, tz: () => 'UTC', store: noStore });
    const views = [1, 2, 3, 4, 5].map(() => api.withOptions!({}));
    const reads = views.map((v, i) => v.daily(day(i + 1)));
    // a busy server keeps all three it was sent waiting too long
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS);
    expect(await Promise.all(reads.slice(0, 3))).toEqual([null, null, null]);
    expect(views.slice(0, 3).map((v) => v.status().problem)).toEqual(['server_error', 'server_error', 'server_error']);
    expect(api.status().problem).toBeNull();
    // the next ones left after those gave up, and hear nothing either
    expect(s.sent('daily')).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS);
    expect(await reads[3]).toBeNull();
    expect(views[3]!.status().problem).toBe('offline');
    expect(api.status().problem).toBe('offline');
    // one answer, and a slow read is a slow read again
    const ok = api.daily(day(6));
    await vi.advanceTimersByTimeAsync(0);
    s.sent('daily')[5]!.answer(daily(day(6)));
    await ok;
    expect(api.status().problem).toBeNull();
    const slow = api.withOptions!({});
    const late = slow.daily(day(7));
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS);
    expect(await late).toBeNull();
    expect(slow.status().problem).toBe('server_error');
    expect(api.status().problem).toBeNull();
    // a request the network refuses outright is a real failure, the first time
    const down = createGaugeApi({ server: { ...s, chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof globalThis.fetch } }) }, tz: () => 'UTC', store: noStore });
    expect(await down.daily(day(1))).toBeNull();
    expect(down.status().problem).toBe('offline');
  });

  it('keeps the saved answer through a slow read, and does not call a suspended app offline', async () => {
    vi.useFakeTimers({ now: NOW });
    const s = server();
    let clock = NOW;
    const api = createGaugeApi({ server: s, now: () => clock, tz: () => 'UTC', store: noStore });
    const first = api.daily(day(1));
    await vi.advanceTimersByTimeAsync(0);
    s.calls[0]!.answer(daily(day(1)));
    expect(await first).toEqual(daily(day(1)));
    const view = api.withOptions!({});
    const slow = view.daily(day(1));
    const other = api.daily(day(2));
    await vi.advanceTimersByTimeAsync(1000);
    s.sent('daily')[2]!.answer(daily(day(2)));
    await other;
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS);
    expect(await slow).toEqual(daily(day(1)));
    expect(view.status().problem).toBe('server_error');
    expect(api.status().problem).toBeNull();
    // the phone slept with a request under way: its timer fires on waking, minutes late
    const frozen = api.daily(day(3));
    await vi.advanceTimersByTimeAsync(0);
    clock += 10 * 60_000;
    await vi.advanceTimersByTimeAsync(GAUGE_REQUEST_TIMEOUT_MS);
    expect(await frozen).toBeNull();
    expect(api.status().problem).toBeNull();
  });
});

describe('identical reads share one request', () => {
  it('sends once for callers with and without signals; one cancelling leaves the others their answer', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const a = new AbortController(), b = new AbortController();
    const first = api.daily(day(1), { signal: a.signal });
    const second = api.withOptions!({ signal: b.signal, priority: 'screen' }).daily(day(1));
    const third = api.daily(day(1));
    await settle();
    expect(s.calls).toHaveLength(1);
    a.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.calls[0]!.signal.aborted).toBe(false);
    s.calls[0]!.answer(daily(day(1)));
    expect(await second).toEqual(daily(day(1)));
    expect(await third).toEqual(daily(day(1)));
    expect(s.calls).toHaveLength(1);
  });

  it('cancels the request when the last caller has gone, and a later caller starts a new one', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const a = new AbortController(), b = new AbortController();
    const first = api.daily(day(1), { signal: a.signal });
    const second = api.daily(day(1), { signal: b.signal });
    await settle();
    a.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    b.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.calls[0]!.signal.aborted).toBe(true);
    const again = api.daily(day(1));
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    s.calls[1]!.answer(daily(day(1)));
    expect(await again).toEqual(daily(day(1)));
    // a signal that was already aborted asks nothing
    expect(await api.daily(day(2), { signal: a.signal })).toBeNull();
    expect(s.calls).toHaveLength(2);
  });

  it('shares between a caller that takes the last good answer and one that wants fresh data only; each gets its own', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const first = api.daily(day(1));
    await settle();
    s.calls[0]!.answer(daily(day(1)));
    await first;
    const card = api.withOptions!({ priority: 'screen' }).daily(day(1));
    const importer = api.daily(day(1), { cached: false });
    await settle();
    expect(s.calls).toHaveLength(2);
    s.calls[1]!.answer({}, 500);
    expect(await card).toEqual(daily(day(1)));
    expect(await importer).toBeNull();
    // and both take a fresh answer
    const again = [api.daily(day(1)), api.daily(day(1), { cached: false })];
    await settle();
    expect(s.calls).toHaveLength(3);
    s.calls[2]!.answer(daily(day(1)));
    expect(await Promise.all(again)).toEqual([daily(day(1)), daily(day(1))]);
  });

  it('tells every caller of a shared read why it failed', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const one = api.withOptions!({}), two = api.withOptions!({ signal: new AbortController().signal });
    const reads = [one.daily(day(1)), two.daily(day(1))];
    await settle();
    s.calls[0]!.answer({}, 500);
    expect(await Promise.all(reads)).toEqual([null, null]);
    expect(one.status().problem).toBe('server_error');
    expect(two.status().problem).toBe('server_error');
  });

  it('tells a caller that joins a read which has already failed, so its null is not taken for an empty answer', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: noStore });
    const first = api.daily(day(1));
    await settle();
    s.calls[0]!.answer({}, 403);
    expect(await first).toBeNull();
    // the client is refused now: both ask in the same turn, and the second joins the read the first has just failed
    const one = api.withOptions!({}), two = api.withOptions!({});
    expect(await Promise.all([one.daily(day(14)), two.daily(day(14))])).toEqual([null, null]);
    expect(s.calls).toHaveLength(1);
    expect(one.status().problem).toBe('unauthorized');
    expect(two.status().problem).toBe('unauthorized');
  });
});

describe('a read that must be newer than a moment (`since`)', () => {
  it('does not join a request sent before that moment; it sends a new one, which later callers join', async () => {
    const s = server();
    let clock = NOW;
    const api = createGaugeApi({ server: s, now: () => clock, tz: () => 'UTC', store: noStore });
    const importer = api.daily(day(1));
    await settle();
    expect(s.calls).toHaveLength(1);
    // the data changed five seconds after that request left
    clock += 5000;
    const card = api.withOptions!({ priority: 'screen', since: clock, signal: new AbortController().signal }).daily(day(1));
    const other = api.daily(day(1));
    await settle();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]!.signal.aborted).toBe(false);
    s.calls[0]!.answer({ ...daily(day(1)), activity: { steps: 100 } });
    s.calls[1]!.answer({ ...daily(day(1)), activity: { steps: 200 } });
    expect((await importer)?.activity?.steps).toBe(100);
    expect((await card)?.activity?.steps).toBe(200);
    expect((await other)?.activity?.steps).toBe(200);
    expect(s.calls).toHaveLength(2);
  });

  it('joins a request sent after that moment, and one still waiting in the queue', async () => {
    const s = server();
    let clock = NOW;
    const api = createGaugeApi({ server: s, now: () => clock, tz: () => 'UTC', store: noStore });
    const busy = [1, 2, 3].map((n) => api.daily(day(n)));
    // asked long ago, but the server has not been sent it yet
    const waiting = api.daily(day(4));
    await settle();
    clock += 60_000;
    const card = api.withOptions!({ priority: 'screen', since: clock }).daily(day(4));
    await settle();
    expect(s.sent('daily')).toHaveLength(3);
    clock += 1000;
    s.sent('daily')[0]!.answer(daily(day(1)));
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(4));
    // it left a second after the change: a caller who needs that change joins it
    const later = api.withOptions!({ since: clock - 1000 }).daily(day(4));
    await settle();
    expect(s.sent('daily')).toHaveLength(4);
    for (const c of s.sent('daily').slice(1)) c.answer(daily(dateOf(c)!));
    expect((await Promise.all([...busy, waiting, card, later])).map((d) => d?.date)).toEqual([1, 2, 3, 4, 4, 4].map(day));
    expect(s.sent('daily')).toHaveLength(4);
  });
});

describe('starting the app keeps the saved snapshots', () => {
  let idb: ReturnType<typeof createFakeIndexedDb>;
  beforeEach(() => { idb = createFakeIndexedDb(); vi.stubGlobal('indexedDB', idb.factory); });
  const context = { window: { start: '2026-11-01T00:00', end: '2026-11-16T00:00' }, activities: [] };
  const TODAY = day(15);

  /** One earlier session: a read, then (when `revision` is given) its fusion context. */
  async function earlier(s: ReturnType<typeof server>, revision: string | null) {
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: createGaugeCacheStore() });
    const read = api.daily(TODAY);
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    s.calls[0]!.answer(daily(TODAY), 200, { etag: '"v1"' });
    await read;
    if (revision) {
      const post = api.fusionContext!(context);
      await vi.waitFor(() => expect(s.calls).toHaveLength(2));
      s.calls[1]!.answer({ revision, changed: false });
      await post;
    }
    await settle();
    s.calls.length = 0;
  }

  it('the first fusion-context post of a session, unchanged, drops nothing and cancels nothing', async () => {
    const s = server();
    await earlier(s, 'fc:1');
    const heard: string[] = [];
    const off = onFusionContextChange((r) => heard.push(r));
    const api = createGaugeApi({ server: s, now: () => NOW + 60_000, tz: () => 'UTC', store: createGaugeCacheStore() });
    const read = api.daily(TODAY);
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(1));
    expect(s.sent('daily')[0]!.headers.get('if-none-match')).toBe('"v1"');
    const post = api.fusionContext!(context);
    await vi.waitFor(() => expect(s.sent('fusion-context')).toHaveLength(1));
    s.sent('fusion-context')[0]!.answer({ revision: 'fc:1', changed: false });
    expect(await post).toEqual({ revision: 'fc:1', changed: false });
    expect(heard).toEqual([]);
    expect(s.sent('daily')[0]!.signal.aborted).toBe(false);
    expect(await api.snapshot!((a) => a.daily(TODAY))).toEqual({ data: daily(TODAY), savedAt: NOW });
    s.sent('daily')[0]!.answer(null, 304);
    expect(await read).toEqual(daily(TODAY));
    await settle();
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(1);
    off();
  });

  it('an answer read before the session knew the context stands once the context proves unchanged, on disk too', async () => {
    const s = server();
    // this earlier session ended before it posted: its snapshot names no revision
    await earlier(s, null);
    const api = createGaugeApi({ server: s, now: () => NOW + 60_000, tz: () => 'UTC', store: createGaugeCacheStore() });
    const read = api.daily(TODAY);
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(1));
    const post = api.fusionContext!(context);
    await vi.waitFor(() => expect(s.sent('fusion-context')).toHaveLength(1));
    s.sent('fusion-context')[0]!.answer({ revision: 'fc:1', changed: false });
    await post;
    // the server confirms the very body that was on disk
    s.sent('daily')[0]!.answer(null, 304);
    expect(await read).toEqual(daily(TODAY));
    expect(api.status().problem).toBeNull();
    const fresh = api.daily(day(14));
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(2));
    s.sent('daily')[1]!.answer(daily(day(14)));
    await fresh;
    await settle();
    // a third session reads both back after it has heard the same revision
    const next = createGaugeApi({ server: s, now: () => NOW + 120_000, tz: () => 'UTC', store: createGaugeCacheStore() });
    const again = next.fusionContext!(context);
    await vi.waitFor(() => expect(s.sent('fusion-context')).toHaveLength(2));
    s.sent('fusion-context')[1]!.answer({ revision: 'fc:1', changed: false });
    await again;
    expect((await next.snapshot!((a) => a.daily(TODAY))).data).toEqual(daily(TODAY));
    expect((await next.snapshot!((a) => a.daily(day(14)))).data).toEqual(daily(day(14)));
  });

  it('a context that really changed still drops the fused answers and cancels reads, without emptying the disk', async () => {
    const s = server();
    await earlier(s, 'fc:1');
    const heard: string[] = [];
    const off = onFusionContextChange((r) => heard.push(r));
    const store = createGaugeCacheStore();
    const clear = vi.spyOn(store, 'clear');
    const api = createGaugeApi({ server: s, now: () => NOW + 60_000, tz: () => 'UTC', store });
    const read = api.daily(TODAY);
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(1));
    const post = api.fusionContext!(context);
    await vi.waitFor(() => expect(s.sent('fusion-context')).toHaveLength(1));
    s.sent('fusion-context')[0]!.answer({ revision: 'fc:2', changed: true });
    await post;
    expect(heard).toEqual(['fc:2']);
    expect(s.sent('daily')[0]!.signal.aborted).toBe(true);
    expect(await read).toBeNull();
    // the snapshot made under fc:1 is not read back under fc:2, and the next read is not a conditional one
    expect((await api.snapshot!((a) => a.daily(TODAY))).data).toBeNull();
    const fresh = api.daily(TODAY);
    await vi.waitFor(() => expect(s.sent('daily')).toHaveLength(2));
    expect(s.sent('daily')[1]!.headers.get('if-none-match')).toBeNull();
    s.sent('daily')[1]!.answer(daily(TODAY));
    await fresh;
    // another device changed it since this one last posted: the same, though this post changed nothing
    const later = api.fusionContext!(context);
    await vi.waitFor(() => expect(s.sent('fusion-context')).toHaveLength(2));
    s.sent('fusion-context')[1]!.answer({ revision: 'fc:3', changed: false });
    await later;
    expect(heard).toEqual(['fc:2', 'fc:3']);
    expect(clear).not.toHaveBeenCalled();
    off();
  });
});

describe('which windows are kept on disk', () => {
  const at = (route: string, from: string, to: string) => persistGaugeQuery(`/v1/gauge/${route}?from=${from}&to=${to}&tz=UTC`, NOW);
  it('keeps the month and two-month windows of the day summaries that end today, and nothing older or wider', () => {
    for (const route of ['activity', 'steps', 'sleep', 'scores']) {
      expect(at(route, '2026-10-17', '2026-11-15')).toBe(true);
      expect(at(route, '2026-09-21', '2026-11-15')).toBe(true);
      // yesterday's window (a late night, another zone) still counts; a month that ended last week is browsing
      expect(at(route, '2026-10-16', '2026-11-14')).toBe(true);
      expect(at(route, '2026-10-08', '2026-11-08')).toBe(false);
      expect(at(route, '2026-08-01', '2026-11-15')).toBe(false);
    }
    // minute-level and paged routes stay at a week
    for (const route of ['workouts', 'short-video', 'hr-intervals', 'series']) expect(at(route, '2026-10-17', '2026-11-15')).toBe(false);
    expect(at('workouts', '2026-11-09', '2026-11-15')).toBe(true);
    expect(at('activity', '2026-11-15', '2026-11-20')).toBe(false);
  });

  it('drops saved windows that have passed when a session starts, and keeps the ones still read back', async () => {
    const idb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const store = createGaugeCacheStore();
    const value = { data: { days: [] }, etag: null, lastModified: null, savedAt: NOW - 3 * 86_400_000, context: null };
    const key = (from: string, to: string) => `/v1/gauge/activity?from=${from}&to=${to}&tz=UTC`;
    await store.put('a', key('2026-10-17', '2026-11-15'), value);
    await store.put('a', key('2026-10-13', '2026-11-11'), value);
    await store.put('a', '/v1/gauge/daily?date=2026-11-01&tz=UTC', { ...value, data: daily(day(1)) });
    await store.put('b', key('2026-10-17', '2026-11-15'), value);
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(4);
    await store.retain('a', NOW);
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(1);
    expect(await store.get('a', key('2026-10-17', '2026-11-15'), NOW)).not.toBeNull();
  });

  it('a 304 moves the date on disk only every few minutes; a new body is always written', async () => {
    const s = server();
    let clock = NOW;
    const put = vi.fn(async () => undefined);
    const api = createGaugeApi({ server: s, now: () => clock, tz: () => 'UTC', store: { ...noStore, put } });
    const ask = async (answer: (c: Call) => void) => {
      const n = s.calls.length;
      const read = api.daily(day(15));
      await vi.waitFor(() => expect(s.calls).toHaveLength(n + 1));
      answer(s.calls[n]!);
      return read;
    };
    await ask((c) => c.answer(daily(day(15)), 200, { etag: '"v1"' }));
    expect(put).toHaveBeenCalledTimes(1);
    clock += 60_000;
    expect(await ask((c) => c.answer(null, 304))).toEqual(daily(day(15)));
    expect(put).toHaveBeenCalledTimes(1);
    clock += 10 * 60_000;
    await ask((c) => c.answer(null, 304));
    expect(put).toHaveBeenCalledTimes(2);
    clock += 1000;
    await ask((c) => c.answer({ ...daily(day(15)), activity: { steps: 200 } }, 200, { etag: '"v2"' }));
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('saves a 30-day answer and reads it back before the network on the next start', async () => {
    vi.stubGlobal('indexedDB', createFakeIndexedDb().factory);
    const s = server();
    const month = { from: '2026-10-17', to: '2026-11-15', units: {}, days: Array.from({ length: 30 }, (_, i) => ({ date: day(i + 1), steps: 100 * i })) };
    const a = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: createGaugeCacheStore() });
    const read = a.activity('2026-10-17', '2026-11-15');
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    s.calls[0]!.answer(month);
    await read;
    await settle();
    const b = createGaugeApi({ server: s, now: () => NOW + 1000, tz: () => 'UTC', store: createGaugeCacheStore() });
    expect((await b.snapshot!((api) => api.activity('2026-10-17', '2026-11-15'))).data).toEqual(month);
    expect(s.calls).toHaveLength(1);
  });
});
