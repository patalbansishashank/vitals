/**
 * r063 CORE, the client side of the server routes: timelines always arrive in their full shape with step support (S1,
 * S5), Health Connect reads follow every page (S15), the change feed (S13) and the fusion context (S6), whose new
 * revision drops the cached answers and tells the listeners.
 */
import { describe, expect, it } from 'vitest';
import { ServerError } from '../server';
import { adaptGaugeData, createGaugeApi, normaliseTimeline, onFusionContextChange, type GaugeTimeline } from '../gauge';

const BASE = 'https://home.example:8443';
const envelope = (data: unknown) => ({ ok: true, status: 'applied', summary: 'ok', data });
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'down';

function fakeServer(replies: Reply[]) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    const r = replies.shift() ?? { status: 500 };
    if (r === 'down') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  };
  const server = {
    isPaired: () => true,
    subscribe: () => () => undefined,
    chatModelOptions: () => {
      if (!fetchImpl) throw new ServerError('not_paired');
      return { serverUrl: `${BASE}/`, deps: { fetch: fetchImpl } };
    },
  };
  return { server, calls };
}
const api = (replies: Reply[]) => {
  const f = fakeServer(replies);
  return { ...f, api: createGaugeApi({ server: f.server, now: () => Date.parse('2026-10-20T07:00:00Z'), tz: () => 'Asia/Kolkata' }) };
};

describe('S5 / S1: a timeline always in its full shape, with step support', () => {
  it('a partial success (an older server with no store: date, tz, minutes only) is completed, null-filled', () => {
    const t = normaliseTimeline({ date: '2026-10-20', tz: 'Asia/Kolkata', minutes: 1440 }) as unknown as GaugeTimeline;
    for (const a of [t.steps.selected, t.steps.support, t.steps.source, t.steps.ring, t.steps.phone, t.hr.bpm, t.hr.supportedS, t.sleep.stage, t.acquisition.ring, t.acquisition.phone]) {
      expect(a).toHaveLength(1440);
      expect(a.every((x) => x === null)).toBe(true);
    }
    expect(t.sessions).toEqual([]);
    expect(t.hcExercise).toEqual([]);
  });

  it('an older server without steps.support: a selected count is a minute unit\'s; short arrays are padded, bad values null', () => {
    const t = normaliseTimeline({ date: '2026-10-20', tz: 'UTC', minutes: 4, steps: { selected: [110, null, 'x', 90], source: ['ring'], ring: [], phone: [] } }) as unknown as GaugeTimeline;
    expect(t.steps.selected).toEqual([110, null, null, 90]);
    expect(t.steps.support).toEqual(['minute', null, null, 'minute']);
    expect(t.steps.source).toEqual(['ring', null, null, null]);
    // the server's own support is kept as sent
    const u = normaliseTimeline({ date: '2026-10-20', minutes: 2, steps: { selected: [null, 5], support: ['coarse', 'minute'] } }) as unknown as GaugeTimeline;
    expect(u.steps.support).toEqual(['coarse', 'minute']);
    expect(normaliseTimeline({ minutes: 1440 })).toBeNull();
    expect(adaptGaugeData('/v1/gauge/timeline', { nope: true })).toEqual({});
  });

  it('the client answers null (server error) for a timeline that cannot be one, never a broken object', async () => {
    const { api: a } = api([{ status: 200, body: envelope({ tz: 'UTC' }) }]);
    expect(await a.timeline('2026-10-20', { cached: false })).toBeNull();
    expect(a.status().problem).toBe('server_error');
  });
});

describe('S15: Health Connect reads follow every page', () => {
  const rec = (id: string) => ({ id, recordType: 'ExerciseSession', origin: 'com.strava', start: '2026-10-20T07:00:00+05:30', end: '2026-10-20T07:30:00+05:30', payload: {} });
  it('follows next to the end; deleted comes with the first page', async () => {
    const { api: a, calls } = api([
      { status: 200, body: envelope({ type: 'ExerciseSession', from: '', to: '', records: [rec('a'), rec('b')], deleted: [{ id: 'z', recordType: 'ExerciseSession', start: '', end: '', deletedAt: null }], next: 'c2' }) },
      { status: 200, body: envelope({ type: 'ExerciseSession', from: '', to: '', records: [rec('c')], deleted: [], next: null }) },
    ]);
    const r = (await a.hc('ExerciseSession', '2026-10-01', '2026-10-20'))!;
    expect(r.records.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.records[2]!.originPackage).toBe('com.strava');
    expect(r.deleted?.map((x) => x.id)).toEqual(['z']);
    expect(r.truncated).toBe(false);
    expect(calls[1]!.url).toContain('cursor=c2');
  });

  it('a page that does not arrive leaves truncated: true', async () => {
    const { api: a } = api([{ status: 200, body: envelope({ records: [rec('a')], next: 'c2' }) }, 'down']);
    const r = (await a.hc('ExerciseSession', '2026-10-01', '2026-10-20'))!;
    expect(r.records).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});

describe('S13: the change feed', () => {
  it('follows more, keeps the last cursor, keeps resync, and drops malformed entries', async () => {
    const ch = (id: string, change: string) => ({ kind: 'hcExercise', id, ref: `hc:${id}`, change, start: null, end: null, at: null });
    const { api: a, calls } = api([
      { status: 200, body: envelope({ cursor: 'c1.10.0', more: true, resync: false, changes: [ch('a', 'deleted'), { kind: 'x' }] }) },
      { status: 200, body: envelope({ cursor: 'c1.20.1', more: false, resync: false, changes: [ch('b', 'revised')] }) },
    ]);
    const r = (await a.changes!('c1.0.0'))!;
    expect(r).toEqual({ cursor: 'c1.20.1', resync: false, truncated: false, changes: [expect.objectContaining({ ref: 'hc:a', change: 'deleted' }), expect.objectContaining({ ref: 'hc:b', change: 'revised' })] });
    expect(calls[0]!.url).toContain('since=c1.0.0');
    expect(calls[1]!.url).toContain('since=c1.10.0');
    // no cursor: the request names none
    const { api: b, calls: c2 } = api([{ status: 200, body: envelope({ cursor: 'c1.5.0', more: false, resync: true, changes: [] }) }]);
    expect(await b.changes!(null)).toMatchObject({ cursor: 'c1.5.0', resync: true });
    expect(c2[0]!.url).not.toContain('since=');
  });
});

describe('S6: the fusion context', () => {
  it('posts it with the zone; a new revision drops the cached answers and tells the listeners', async () => {
    const heard: string[] = [];
    const off = onFusionContextChange((r) => heard.push(r));
    const day = envelope({ date: '2026-10-20', tz: 'UTC', minutes: 1 });
    const { api: a, calls } = api([
      { status: 200, body: day, headers: { etag: 'W/"1"' } },
      { status: 200, body: envelope({ revision: 'fc:1', changed: true }) },
      { status: 200, body: day },
      { status: 200, body: envelope({ revision: 'fc:1', changed: false }) },
    ]);
    await a.timeline('2026-10-20');
    const body = { window: { start: '2026-09-16T00:00', end: '2026-10-22T00:00' }, activities: [{ start: '2026-10-20T04:00:00.000Z', end: '2026-10-20T04:20:00.000Z', kind: 'nonLocomotor' as const }] };
    expect(await a.fusionContext!(body)).toEqual({ revision: 'fc:1', changed: true });
    expect(calls[1]).toMatchObject({ method: 'POST', url: `${BASE}/v1/gauge/fusion-context` });
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ ...body, tz: 'Asia/Kolkata' });
    expect(heard).toEqual(['fc:1']);
    // the cache was dropped: the next read is not a conditional poll
    await a.timeline('2026-10-20');
    expect(calls[2]!.url).toContain('/v1/gauge/timeline');
    // the same revision again: nothing to tell
    await a.fusionContext!(body);
    expect(heard).toEqual(['fc:1']);
    off();
  });

  it('an older server without the route: null', async () => {
    const { api: a } = api([{ status: 404, body: { error: 'not_found' } }]);
    expect(await a.fusionContext!({ window: { start: 'a', end: 'b' }, activities: [] })).toBeNull();
  });
});
