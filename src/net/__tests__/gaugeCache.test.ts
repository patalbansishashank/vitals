import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDb } from '../../../tests/fakeIndexedDb';
import { createGaugeApi } from '../gauge';
import { createGaugeCacheStore, GAUGE_CACHE_DB, GAUGE_CACHE_MAX_AGE_MS, GAUGE_CACHE_MAX_BYTES, GAUGE_CACHE_MAX_ENTRIES, gaugeSnapshotShape, persistGaugeQuery, validGaugeCacheEntry } from '../gaugeCache';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const DATE = '2026-10-31';
const BODY = { date: DATE, activity: { steps: 456 }, installations: [] };
const response = (body: unknown = BODY, status = 200) => new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { etag: '"revision-1"' } });
function server() {
  let pairing: { baseUrl: string; person: { id: string; label: string }; deviceId: string; pairedAt: string } | null = { baseUrl: 'https://synthetic.invalid', person: { id: 'a', label: '' }, deviceId: 'device-a', pairedAt: 'pair-a' };
  const listeners = new Set<() => void>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
  return {
    fetch,
    pairing: () => pairing,
    isPaired: () => pairing !== null,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    chatModelOptions: () => ({ serverUrl: pairing?.baseUrl ?? '', deps: { fetch } }),
    change: (next: typeof pairing) => { pairing = next; for (const fn of listeners) fn(); },
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 15));
let idb: ReturnType<typeof createFakeIndexedDb>;
beforeEach(() => { idb = createFakeIndexedDb(); vi.stubGlobal('indexedDB', idb.factory); });
afterEach(() => vi.unstubAllGlobals());

describe('durable Gauge snapshots', () => {
  it('reopens before network completion; 304 validates the saved body; offline is never a fresh import', async () => {
    const s = server();
    const a = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: createGaugeCacheStore() });
    expect(await a.daily(DATE)).toEqual(BODY);
    await flush();
    const b = createGaugeApi({ server: s, now: () => NOW + 1000, tz: () => 'UTC', store: createGaugeCacheStore() });
    let finish!: (r: Response) => void;
    s.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const fresh = b.daily(DATE);
    expect(await b.snapshot!((api) => api.daily(DATE))).toEqual({ data: BODY, savedAt: NOW });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(new Headers(s.fetch.mock.calls.at(-1)?.[1]?.headers).get('if-none-match')).toBe('"revision-1"');
    finish(response(null, 304));
    expect(await fresh).toEqual(BODY);
    expect(b.status().problem).toBeNull();
    s.fetch.mockRejectedValue(new TypeError('offline'));
    expect(await b.daily(DATE)).toEqual(BODY);
    expect(b.status().problem).toBe('offline');
    expect(await b.daily(DATE, { cached: false })).toBeNull();
    expect((await b.snapshot!((api) => api.daily(DATE, { cached: false }))).data).toBeNull();
  });

  it('deduplicates simultaneous reads and saves an authoritative deletion instead of merging old readings', async () => {
    const s = server();
    const api = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: createGaugeCacheStore() });
    const values = await Promise.all([api.daily(DATE), api.daily(DATE), api.daily(DATE)]);
    expect(values).toEqual([BODY, BODY, BODY]);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.fetch.mockResolvedValue(response({ date: DATE, activity: null, installations: [] }));
    await api.daily(DATE);
    await flush();
    const again = createGaugeApi({ server: s, now: () => NOW, tz: () => 'UTC', store: createGaugeCacheStore() });
    expect((await again.snapshot!((a) => a.daily(DATE))).data?.activity).toBeNull();
  });

  it('keeps a composed read stale when a healthy sibling finishes after an offline endpoint', async () => {
    const s = server(), api = createGaugeApi({ server: s, now: () => NOW, store: createGaugeCacheStore() });
    await api.daily(DATE);
    const view = api.withOptions!({});
    s.fetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await view.daily(DATE)).toEqual(BODY);
    await view.availability();
    expect(api.status().problem).toBeNull();
    expect(view.status().problem).toBe('offline');
  });

  it('retires data on refusal, unpair, and a new pairing session for the same person', async () => {
    const s = server(), store = createGaugeCacheStore();
    const api = createGaugeApi({ server: s, now: () => NOW, store });
    await api.daily(DATE);
    s.fetch.mockResolvedValue(response({}, 403));
    expect(await api.daily(DATE)).toBeNull();
    expect((await api.snapshot!((a) => a.daily(DATE))).data).toBeNull();
    await flush();
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(0);
    s.change({ ...s.pairing()!, pairedAt: 'pair-b' });
    s.fetch.mockResolvedValue(response());
    await api.daily(DATE);
    await flush();
    s.change(null);
    expect((await api.snapshot!((a) => a.daily(DATE))).data).toBeNull();
    await flush();
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(0);
  });

  it('isolates zones even on a legacy server refusing tz and invalidates context revisions', async () => {
    const s = server(), api = createGaugeApi({ server: s, now: () => NOW, store: createGaugeCacheStore() });
    s.fetch.mockResolvedValueOnce(response({}, 400)).mockResolvedValueOnce(response());
    await api.daily(DATE, { tz: 'UTC' });
    s.fetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await api.daily(DATE, { tz: 'Asia/Kolkata' })).toBeNull();
    s.fetch.mockResolvedValueOnce(response({ revision: 'correction-2', changed: true }));
    await api.fusionContext!({ from: DATE, to: DATE, activities: [] } as never);
    expect((await api.snapshot!((a) => a.daily(DATE, { tz: 'UTC' }))).data).toBeNull();
  });

  it('cancels without retaining a late response from a transport that ignores abort', async () => {
    const s = server();
    let finish!: (r: Response) => void;
    s.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const api = createGaugeApi({ server: s, now: () => NOW, store: createGaugeCacheStore() });
    const controller = new AbortController();
    const pending = api.daily(DATE, { signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish(response());
    expect(await pending).toBeNull();
    expect((await api.snapshot!((a) => a.daily(DATE))).data).toBeNull();
  });

  it('does not persist live/control feeds, old ranges, or revision-specific paged fragments', async () => {
    const s = server(), api = createGaugeApi({ server: s, now: () => NOW, store: createGaugeCacheStore() });
    await api.device();
    await api.daily('2026-09-01');
    s.fetch.mockResolvedValueOnce(response({ points: [1], next: 'cursor-a' })).mockResolvedValueOnce(response({ points: [2] }));
    await api.series({ kind: 'hr', from: DATE, to: DATE });
    await flush();
    expect(idb.peek(GAUGE_CACHE_DB).snapshots ?? 0).toBe(0);
    expect((await api.snapshot!((a) => a.device())).data).toBeNull();
  });
});

describe('bounded optional storage', () => {
  it('expires, bounds entries/size, rejects corrupt/old schemas and retires other scopes', async () => {
    const store = createGaugeCacheStore();
    const value = { data: BODY, etag: null, lastModified: null, savedAt: NOW, context: null };
    for (let i = 0; i < GAUGE_CACHE_MAX_ENTRIES + 3; i++) await store.put('a', String(i), { ...value, savedAt: NOW + i });
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(GAUGE_CACHE_MAX_ENTRIES);
    expect(await store.get('a', '0', NOW + 500)).toBeNull();
    expect(await store.get('a', '10', NOW + GAUGE_CACHE_MAX_AGE_MS + 1000)).toBeNull();
    await store.put('a', 'huge', { ...value, data: { blob: 'x'.repeat(600_000) } });
    expect(await store.get('a', 'huge', NOW)).toBeNull();
    const valid = await store.get('a', '10', NOW + 500);
    expect(valid).not.toBeNull();
    expect(validGaugeCacheEntry({ ...valid, schema: -1 }, NOW)).toBe(false);
    expect(validGaugeCacheEntry({ ...valid, data: [] }, NOW)).toBe(false);
    expect(gaugeSnapshotShape('/v1/gauge/activity', { days: 'broken' })).toBe(false);
    await store.retain('b');
    expect(idb.peek(GAUGE_CACHE_DB).snapshots).toBe(0);
  });
  it('enforces the byte budget and ignores a damaged on-disk record', async () => {
    const store = createGaugeCacheStore();
    const value = { data: { payload: 'x'.repeat(400_000) }, etag: null, lastModified: null, savedAt: NOW, context: null };
    for (let i = 0; i < 24; i++) await store.put('a', String(i), { ...value, savedAt: NOW + i });
    const records = await Promise.all(Array.from({ length: 24 }, (_, i) => store.get('a', String(i), NOW + 100)));
    expect(records.reduce((bytes, e) => bytes + (e?.bytes ?? 0), 0)).toBeLessThanOrEqual(GAUGE_CACHE_MAX_BYTES);
    expect(records.filter(Boolean).length).toBeLessThan(24);
    const good = records.at(-1)!;
    await new Promise<void>((resolve) => {
      const req = idb.factory.open(GAUGE_CACHE_DB);
      req.onsuccess = () => {
        const tx = req.result.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put({ ...good, schema: -1 });
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
    });
    expect(await store.get('a', '23', NOW + 100)).toBeNull();
  });

  it('does not fail a successful response when saving exceeds storage quota', async () => {
    const store = { get: async () => null, put: vi.fn(async () => { throw new DOMException('full', 'QuotaExceededError'); }), clear: async () => undefined, retain: async () => undefined };
    const api = createGaugeApi({ server: server(), now: () => NOW, store });
    expect(await api.daily(DATE)).toEqual(BODY);
    await flush();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('allows network use when IDB is denied, blocked, or absent', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('denied'); } });
    const api = createGaugeApi({ server: server(), now: () => NOW, store: createGaugeCacheStore() });
    expect(await api.daily(DATE)).toEqual(BODY);
    expect(persistGaugeQuery('/v1/gauge/changes?since=a', NOW)).toBe(false);
    expect(persistGaugeQuery('/v1/gauge/daily?date=invalid', NOW)).toBe(false);
  });
});
