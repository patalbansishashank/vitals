// @vitest-environment node
/**
 * Gauge data for Vitals (docs/SERVER.md "Gauge data for Vitals"): `GET /v1/gauge/*` with a Vitals device token answers
 * exactly the matching `gauge_*` tool's JSON, refuses Gauge and agent tokens, checks its parameters and answers 304 to a
 * matching `If-None-Match`; and Gauge's workouts (`activity/session`): ingest checks, newest version per session, soft
 * deletion, `gauge_workouts` and `gauge_data_availability`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '../mcpTestClient.ts';
import { startCompanion, type Companion } from '../server.ts';
import { GAUGE_ROUTES } from './gaugeRoutes.ts';
import { activityDaily, battery, deletion, hcRecord, hr, insight, INSTALL, OTHER_INSTALL, phoneAcquisition, phoneSteps, ringSteps, shortVideo, sleepPacket, workout } from './lumenFixtures.ts';
import { offsetMinutes } from './lumenTools.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const NOW = Date.parse('2026-10-21T04:00:00Z'); // 09:30 in Kolkata
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

async function boot() {
  const dataDir = mkdtempSync(join(TMP, 'gauge-routes-'));
  const clock = { now: NOW };
  const factory: WorkerFactory = async () => ({
    async call(req: PersonRequest): Promise<PersonResponse> {
      if (req.op === 'agentManifest') return { ok: true, value: { format: 'vitals.tools/1', hash: '0', tools: [] } };
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false,
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: factory, now: () => clock.now },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; origin?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin) headers.origin = init.origin;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual', ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    return { status: r.status, text, body: (text ? JSON.parse(text) : null) as Json, headers: r.headers };
  };
  const person = async (label = 'Ana') => {
    const p = await home.persons.add({ label, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(label.length), relayUrl: null });
    const { code } = await home.devices.issueCode(p.id);
    const d = await call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code, label: 'Phone' } });
    return { id: p.id, device: d.body.token as string };
  };
  const pairGauge = async (personId: string) => {
    const { code } = await home.devices.issueCode(personId);
    return (await call('/v1/lumen/pair', { method: 'POST', body: { code, installationId: INSTALL, deviceName: 'OnePlus CPH2661', appVersion: '2.4.0' } })).body.token as string;
  };
  const upload = async (token: string, events: unknown[]) => (await call('/v1/lumen/events', { method: 'POST', token, body: { installationId: INSTALL, events } })).body;
  const agentToken = async (device: string) => (await call('/v1/agents/tokens', { method: 'POST', token: device, origin: SITE, body: { client: 'claude', scope: 'read' } })).body.token as string;
  const mcp = async (device: string) => {
    const client = new Client({ name: 'gauge-routes-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${await agentToken(device)}` } } }));
    cleanup.push(() => client.close());
    return async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })).structuredContent as Json;
  };
  return { c, home, call, person, pairGauge, upload, agentToken, mcp, clock };
}

const ringData = () => [
  hr('2026-10-20T01:00:00Z', 58), hr('2026-10-20T02:00:00Z', 66), activityDaily('2026-10-20T12:00:00Z', 8200),
  sleepPacket('2026-10-19T18:00:00Z', Array.from({ length: 60 }, () => 'light'), { complete: true }),
  insight('sleep_score', '2026-10-19T18:30:00Z', 82), battery('2026-10-20T12:00:00Z', 64),
  shortVideo('2026-10-20', '2026-10-20T16:00:00Z', { instagram: 5 }), workout('w-1', '2026-10-20T01:15:00Z'),
];

/** Each endpoint with a query, and the same call as tool arguments. */
const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['availability', '', {}],
  ['series', '?kind=hr&from=2026-10-20&to=2026-10-20&bucket=hour', { kind: 'hr', from: '2026-10-20', to: '2026-10-20', bucket: 'hour' }],
  ['daily', '?date=2026-10-20', { date: '2026-10-20' }],
  ['sleep', '?from=2026-10-19&to=2026-10-20', { from: '2026-10-19', to: '2026-10-20' }],
  ['activity', '?from=2026-10-20&to=2026-10-20', { from: '2026-10-20', to: '2026-10-20' }],
  ['scores', '?from=2026-10-20&to=2026-10-20&key=sleep_score', { from: '2026-10-20', to: '2026-10-20', key: 'sleep_score' }],
  ['device', '', {}],
  ['short-video', '?from=2026-10-20&to=2026-10-20', { from: '2026-10-20', to: '2026-10-20' }],
  ['workouts', '?from=2026-10-20&to=2026-10-20T23:59', { from: '2026-10-20', to: '2026-10-20T23:59' }],
  ['steps', '?from=2026-10-20&to=2026-10-20', { from: '2026-10-20', to: '2026-10-20' }],
  ['timeline', '?date=2026-10-20', { date: '2026-10-20' }],
  ['hr-intervals', '?from=2026-10-20T05:00&to=2026-10-20T08:00&limit=100', { from: '2026-10-20T05:00', to: '2026-10-20T08:00', limit: '100' }],
  ['baselines', '?date=2026-10-20', { date: '2026-10-20' }],
  ['hc', '?type=Steps&from=2026-10-20&to=2026-10-20', { type: 'Steps', from: '2026-10-20', to: '2026-10-20' }],
  ['changes', '?since=c1.0.0&limit=50', { since: 'c1.0.0', limit: '50' }],
  ['changes-state', '?refs=workout%3Aw-1%2ChcWeight%3Ax', { refs: 'workout:w-1,hcWeight:x' }],
  ['detections', '?from=2026-10-20&to=2026-10-20&limit=50', { from: '2026-10-20', to: '2026-10-20', limit: '50' }],
];

describe('GET /v1/gauge/*', () => {
  it('covers every gauge_* tool, each answering exactly the tool\'s JSON for the same arguments', async () => {
    const t = await boot();
    const a = await t.person();
    expect((await t.upload(await t.pairGauge(a.id), ringData())).rejected).toEqual([]);
    const run = await t.mcp(a.device);
    const tools = new Set(Object.values(GAUGE_ROUTES).map((r) => r.tool));
    expect(CASES.map(([p]) => GAUGE_ROUTES[p]!.tool).sort()).toEqual([...tools].sort());
    expect(tools.size).toBe(17);
    for (const [path, query, args] of CASES) {
      const r = await t.call(`/v1/gauge/${path}${query}`, { token: a.device });
      expect(r.status, path).toBe(200);
      const tool = await run(GAUGE_ROUTES[path]!.tool, args);
      expect(r.body, path).toEqual(tool);
      expect(r.body.ok, path).toBe(true);
    }
    // what the endpoints found, briefly: the data is there
    expect((await t.call('/v1/gauge/workouts?from=2026-10-20&to=2026-10-20', { token: a.device })).body.data.sessions).toHaveLength(1);
    expect((await t.call('/v1/gauge/series?kind=hr&from=2026-10-20&to=2026-10-20', { token: a.device })).body.data.count).toBe(2);
  });

  it('takes the person\'s own Vitals device tokens only: Gauge and agent tokens are 403, no or a bad token 401', async () => {
    const t = await boot();
    const a = await t.person();
    const b = await t.person('Bo');
    const gauge = await t.pairGauge(a.id);
    await t.upload(gauge, ringData());
    const agent = await t.agentToken(a.device);
    for (const [path] of CASES) {
      const url = `/v1/gauge/${path}`;
      expect((await t.call(url)).status, url).toBe(401);
      expect((await t.call(url, { token: 'not-a-real-token-at-all' })).status, url).toBe(401);
      const asGauge = await t.call(url, { token: gauge });
      expect([asGauge.status, asGauge.body.error], url).toEqual([403, 'wrong_kind']);
      const asAgent = await t.call(url, { token: agent });
      expect([asAgent.status, asAgent.body.error], url).toEqual([403, 'wrong_kind']);
    }
    // another person's device sees only that person's (empty) store
    const other = await t.call('/v1/gauge/availability', { token: b.device });
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ categories: [], installations: [], workoutSessions: 0 });
    expect((await t.call('/v1/gauge/availability', { token: a.device })).body.data.categories.length).toBeGreaterThan(0);
    // a revoked device is 401
    expect((await t.call(`/v1/devices/${(await t.call('/v1/pair/status', { token: b.device })).body.deviceId}`, { method: 'DELETE', token: b.device })).status).toBe(204);
    expect((await t.call('/v1/gauge/availability', { token: b.device })).status).toBe(401);
    // a query-string token is never read
    expect((await t.call(`/v1/gauge/availability?token=${a.device}`, { token: a.device })).status).toBe(401);
  });

  it('checks the parameters: only the tool\'s, each once; empty ones are left out; a bad value is 400 with the tool\'s rejection', async () => {
    const t = await boot();
    const a = await t.person();
    await t.upload(await t.pairGauge(a.id), ringData());
    const get = (q: string) => t.call(`/v1/gauge/${q}`, { token: a.device });
    for (const q of ['availability?from=2026-10-20', 'device?x=1', 'sleep?from=2026-10-20&to=2026-10-20&kind=hr', 'daily?date=2026-10-20&date=2026-10-21']) {
      const r = await get(q);
      expect([r.status, r.body.error], q).toEqual([400, 'bad_request']);
    }
    const bad = await get('series?kind=hr&from=yesterday&to=2026-10-20');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual(await (await t.mcp(a.device))('gauge_metric_series', { kind: 'hr', from: 'yesterday', to: '2026-10-20' }));
    expect(bad.body).toMatchObject({ ok: false, status: 'rejected', error: { code: 'invalid_input' } });
    expect(bad.headers.get('etag')).toBeNull();
    expect((await get('sleep?from=2026-10-20')).body.error.code).toBe('invalid_input');
    expect((await get('daily')).status).toBe(400);
    // an empty bucket is the default (raw), an empty key means every score
    expect((await get('series?kind=hr&from=2026-10-20&to=2026-10-20&bucket=')).body.data.bucket).toBe('raw');
    expect(Object.keys((await get('scores?from=2026-10-20&to=2026-10-20&key=')).body.data.scores)).toEqual(['sleep_score']);
    expect((await get('nope')).status).toBe(404);
    expect((await t.call('/v1/gauge/availability', { method: 'POST', token: a.device, body: {} })).status).toBe(405);
  });

  it('answers 304 to a matching If-None-Match until the data changes; the clock alone does not change the tag', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    await t.upload(gauge, ringData());
    const url = '/v1/gauge/series?kind=hr&from=2026-10-20&to=2026-10-20';
    const first = await t.call(url, { token: a.device, origin: SITE });
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
    expect(first.headers.get('cache-control')).toBe('private, max-age=30');
    expect(first.headers.get('last-modified')).toBe(new Date(NOW).toUTCString());
    expect(first.headers.get('vary')).toMatch(/Authorization/);
    expect(first.headers.get('access-control-expose-headers')).toMatch(/ETag/);
    expect(first.headers.get('access-control-expose-headers')).toMatch(/Last-Modified/);

    const same = await t.call(url, { token: a.device, headers: { 'if-none-match': etag } });
    expect([same.status, same.text]).toEqual([304, '']);
    expect(same.headers.get('etag')).toBe(etag);
    expect((await t.call(url, { token: a.device, headers: { 'if-none-match': `"other", ${etag.slice(2)}` } })).status).toBe(304);
    expect((await t.call(url, { token: a.device, headers: { 'if-none-match': '"other"' } })).status).toBe(200);

    // five minutes on: only the minutesSince… counters moved
    t.clock.now += 5 * 60_000;
    const later = await t.call(url, { token: a.device });
    expect(later.body.data.freshness.minutesSinceLastUpload).toBe(5);
    expect(later.headers.get('etag')).toBe(etag);
    expect((await t.call(url, { token: a.device, headers: { 'if-none-match': etag } })).status).toBe(304);

    // a new reading changes the tag
    await t.upload(gauge, [hr('2026-10-20T03:00:00Z', 71)]);
    const changed = await t.call(url, { token: a.device, headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(changed.body.data.count).toBe(3);
    // an auth failure is never a 304
    expect((await t.call(url, { token: gauge, headers: { 'if-none-match': etag } })).status).toBe(403);
  });

  it('answers the browser preflight, allowing If-None-Match and the JSON POST of /steps/fuse', async () => {
    const t = await boot();
    const r = await t.call('/v1/gauge/workouts', { method: 'OPTIONS', origin: SITE, headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization, if-none-match' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toBe('GET, POST');
    expect(r.headers.get('access-control-allow-headers')).toMatch(/if-none-match/);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/content-type/);
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE);
  });

  it('answers "no data yet" before Gauge ever uploaded, without creating lumen.db', async () => {
    const t = await boot();
    const a = await t.person();
    const r = await t.call('/v1/gauge/workouts?from=2026-10-20&to=2026-10-20', { token: a.device });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { sessions: [], totals: { count: 0 }, installations: [] } });
    expect(r.headers.get('last-modified')).toBeNull();
    const { existsSync } = await import('node:fs');
    expect(existsSync(t.home.persons.paths(a.id).lumen)).toBe(false);
  });
});

const iso = (ms: number) => new Date(ms).toISOString();
/** A 10-min walk the ring and the phone both counted, 09:00 IST on the 20th. */
const walk = () => Array.from({ length: 10 }, (_, i) => Date.parse('2026-10-20T03:30:00Z') + i * 60_000).flatMap((m) => [ringSteps(iso(m), 100), phoneSteps(iso(m), iso(m + 60_000), 104)]);

describe('GET /v1/gauge/* derived routes (energy SPEC §2.2)', () => {
  it('steps, timeline, baselines and hc check their parameters: 400 with the tool\'s rejection', async () => {
    const t = await boot();
    const a = await t.person();
    await t.upload(await t.pairGauge(a.id), [...ringData(), ...walk()]);
    const get = (q: string) => t.call(`/v1/gauge/${q}`, { token: a.device });
    for (const q of ['steps?from=2026-01-01&to=2026-12-31', 'steps?from=today&to=2026-10-20', 'timeline?date=20-10-2026', 'timeline', 'baselines?date=2026-02-30',
      'hc?type=Bogus&from=2026-10-20&to=2026-10-20', 'hc?from=2026-10-20&to=2026-10-20', 'hc?type=Steps&from=2026-10-20&to=2026-10-20&limit=0',
      'series?kind=hr&from=2026-10-20&to=2026-10-20&cursor=not-a-cursor', 'series?kind=hr&from=2026-10-20&to=2026-10-20&bucket=day&cursor=abc']) {
      const r = await get(q);
      expect([r.status, r.body.error?.code], q).toEqual([400, 'invalid_input']);
      expect(r.headers.get('etag'), q).toBeNull();
    }
    for (const q of ['steps?from=2026-10-20&to=2026-10-20&kind=hr', 'timeline?date=2026-10-20&from=2026-10-20', 'hc?type=Steps&type=Steps&from=2026-10-20&to=2026-10-20']) {
      expect([(await get(q)).status, (await get(q)).body.error], q).toEqual([400, 'bad_request']);
    }
    const steps = await get('steps?from=2026-10-20&to=2026-10-20');
    expect(steps.status).toBe(200);
    expect(steps.body.data.intervals).toEqual([expect.objectContaining({ start: '2026-10-20T09:00:00+05:30', end: '2026-10-20T09:10:00+05:30', steps: 1000, lineage: 'ring', selectionReason: 'preference' })]);
    expect(steps.body.data.days[0]).toMatchObject({ located: 1000, ringDailyTotal: 8200, headline: 8200, headlinePolicy: 'atLeast' });
  });

  it('pages raw series over HTTP: next → cursor until null, never a silent cut', async () => {
    const t = await boot();
    const a = await t.person();
    await t.upload(await t.pairGauge(a.id), Array.from({ length: 7 }, (_, i) => hr(iso(Date.parse('2026-10-20T00:00:00Z') + i * 600_000), 60 + i)));
    const values: number[] = [];
    let cursor = '';
    for (let n = 0; n < 10; n++) {
      const r = await t.call(`/v1/gauge/series?kind=hr&from=2026-10-20&to=2026-10-20&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token: a.device });
      expect(r.status).toBe(200);
      values.push(...r.body.data.points.map((p: { value: number }) => p.value));
      expect(r.body.data.truncated).toBe(r.body.data.next !== null);
      if (!r.body.data.next) break;
      cursor = r.body.data.next;
    }
    expect(values).toEqual([60, 61, 62, 63, 64, 65, 66]);
  });

  it('the ETag of a derived route follows its inputsHash: a deletion of a source row changes it, another category does not', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    await t.upload(gauge, [...ringData(), ...walk(), hcRecord('Steps', 'fit-1', '2026-10-20T03:30:00Z', '2026-10-20T03:40:00Z', { count: 990 }, { origin: 'com.google.android.apps.fitness', native: false })]);
    const url = '/v1/gauge/steps?from=2026-10-20&to=2026-10-20';
    const first = await t.call(url, { token: a.device });
    const etag = first.headers.get('etag')!;
    expect((await t.call(url, { token: a.device, headers: { 'if-none-match': etag } })).status).toBe(304);
    // a short-video day is not step evidence: same inputs, same tag
    await t.upload(gauge, [shortVideo('2026-10-20', '2026-10-20T16:30:00Z', { instagram: 9 })]);
    expect((await t.call(url, { token: a.device, headers: { 'if-none-match': etag } })).status).toBe(304);
    // Health Connect deletes Fit's record: the alternative goes, the hash and the tag change
    await t.upload(gauge, [{ ...hcRecord('Steps', 'fit-1', '2026-10-20T03:30:00Z', '2026-10-20T03:40:00Z', { count: 990 }), category: 'hc/deleted', type: 'com.pulseloop.hc.deleted.v1', id: 'pl-hcdel-fit-1', data: { schema_version: 1, observed_at: '2026-10-20T05:00:00Z', received_at: '2026-10-20T05:00:00Z', record_type: 'Steps' } }]);
    const after = await t.call(url, { token: a.device, headers: { 'if-none-match': etag } });
    expect(after.status).toBe(200);
    expect(after.body.data.inputsHash).not.toBe(first.body.data.inputsHash);
    expect(after.body.data.intervals[0].alternatives.some((x: { sameLineage?: boolean }) => x.sameLineage)).toBe(false);
    expect(first.body.data.intervals[0].alternatives.some((x: { sameLineage?: boolean }) => x.sameLineage)).toBe(true);
    // a deleted ring minute retracts only its own steps
    await t.upload(gauge, [deletion('2026-10-21T03:00:00Z', { category: 'activity/buckets', from: '2026-10-20T03:30:00Z', to: '2026-10-20T03:30:00Z' }, { receivedAt: '2026-10-21T03:00:00Z' })]);
    const minus = await t.call(url, { token: a.device });
    expect(minus.body.data.days[0].located).toBe(104 + 900);
  });
});

describe('Gauge workouts (activity/session)', () => {
  it('checks each workout on ingest and rejects a malformed one on its own (bad_workout)', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    const at = '2026-10-20T01:15:00Z';
    const bad: Array<[string, unknown]> = [
      ['other type', { ...workout('w-a', at), type: 'health.activity.updated' }],
      ['end before start', workout('w-b', at, { end: '2026-10-20T00:00:00Z' })],
      ['no start', workout('w-c', at, { start: 'soon' })],
      ['over 7 days', workout('w-d', at, { end: '2026-10-28T00:30:00Z' })],
      ['no type', workout('w-e', at, { type: '' })],
      ['no source', workout('w-f', at, { source: undefined })],
      ['no duration', workout('w-g', at, { durationS: undefined })],
      ['duration over the span', workout('w-h', at, { durationS: 9000 })],
      ['negative distance', workout('w-i', at, { distanceM: -1 })],
      ['heart rate out of range', workout('w-j', at, { avgHr: 400 })],
      ['fractional steps', workout('w-k', at, { steps: 1.5 })],
      ['zones a list', workout('w-l', at, { zones: [1, 2] })],
      ['zone seconds negative', workout('w-m', at, { zones: { cardio: -5 } })],
      ['route without polyline', workout('w-n', at, { route: { points: 3 } })],
      ['route with a bad character', workout('w-o', at, { route: { polyline: 'ab cd', points: 2 } })],
    ];
    const minimal = workout('w-ok-min', at, { distanceM: undefined, kcal: null, avgHr: undefined, maxHr: undefined, zones: undefined, steps: undefined, route: null });
    const r = await t.upload(gauge, [...bad.map(([, e]) => e), workout('w-ok', at), minimal]);
    expect(r.accepted).toBe(2);
    expect(r.rejected.map((x: { index: number; reason: string }) => [bad[x.index]?.[0], x.reason])).toEqual(bad.map(([name]) => [name, 'bad_workout']));
    const run = await t.mcp(a.device);
    const w = await run('gauge_workouts', { from: '2026-10-20', to: '2026-10-20' });
    expect(w.data.sessions.map((s: { id: string }) => s.id)).toEqual(['w-ok', 'w-ok-min']);
    expect(w.data.sessions[1]).toMatchObject({ distanceM: null, kcal: null, avgHr: null, maxHr: null, zones: null, steps: null, route: null });
  });

  it('(0.6.3 S26) a workout keeps the catalogue activity chosen when the recording started', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    expect((await t.upload(gauge, [workout('w-bike', '2026-10-20T01:15:00Z', { activity_type_id: 'air_bike' }), workout('w-plain', '2026-10-20T05:00:00Z')])).accepted).toBe(2);
    const run = await t.mcp(a.device);
    const w = await run('gauge_workouts', { from: '2026-10-20', to: '2026-10-20' });
    expect(w.data.sessions.find((s: { id: string }) => s.id === 'w-bike')).toMatchObject({ activityTypeId: 'air_bike' });
    expect(w.data.sessions.find((s: { id: string }) => s.id === 'w-plain')).not.toHaveProperty('activityTypeId');
  });

  it('gauge_workouts shows the newest version of each session in the person\'s zone, with units, totals and provenance', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    // the session is saved at its end, then edited later (a new id; its observed_at moves too)
    const first = workout('w-1', '2026-10-20T01:15:00Z', {}, { receivedAt: '2026-10-20T01:15:00Z' });
    const edited = workout('w-1', '2026-10-20T05:00:00Z', { type: 'trail_run', kcal: 430 }, { receivedAt: '2026-10-20T05:00:00Z' });
    const walk = workout('w-2', '2026-10-20T13:00:00Z', { start: '2026-10-20T12:20:00Z', end: '2026-10-20T13:00:00Z', type: 'walk', durationS: 2400, distanceM: 3000, kcal: 150, zones: null, route: null, steps: 4100 });
    const nextDay = workout('w-3', '2026-10-21T01:00:00Z', { start: '2026-10-20T18:45:00Z', end: '2026-10-20T19:30:00Z' }); // 00:15 IST on the 21st
    expect((await t.upload(gauge, [edited, first, walk, nextDay])).accepted).toBe(4);
    expect((await t.upload(gauge, [first])).duplicates).toBe(1);
    const run = await t.mcp(a.device);
    const w = await run('gauge_workouts', { from: '2026-10-20', to: '2026-10-20' });
    expect(w.ok).toBe(true);
    expect(w.summary).toBe('2 phone-recorded workouts from 2026-10-20T00:00:00+05:30 to 2026-10-20T23:59:59+05:30.');
    expect(w.data.units).toMatchObject({ durationS: 's (moving time)', distanceM: 'm', avgHr: 'bpm', maxHr: 'bpm', steps: 'steps' });
    expect(w.data.units.kcal).toMatch(/^kcal, Phone estimate \(method/);
    expect(w.data.sessions).toEqual([
      {
        id: 'w-1', date: '2026-10-20', start: '2026-10-20T06:00:00+05:30', end: '2026-10-20T06:45:00+05:30', type: 'trail_run', source: 'gauge_gps',
        durationS: 2580, distanceM: 6120, kcal: 430, avgHr: 148, maxHr: 171, zones: { rest: 0, fat_burn: 300, cardio: 1500, peak: 720, max: 60 }, steps: 6900,
        route: { polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', points: 3 }, updatedAt: '2026-10-20T10:30:00+05:30',
        pauses: [], movingS: null, kcalMethod: null, kcalVersion: null, energyBasis: null, zonesVersion: null, kcalLabel: 'Phone estimate (method not stated)',
      },
      expect.objectContaining({ id: 'w-2', type: 'walk', start: '2026-10-20T17:50:00+05:30', zones: null, route: null, steps: 4100 }),
    ]);
    expect(w.data.totals).toEqual({ count: 2, durationS: 4980, distanceM: 9120, kcal: 580, sessions: 2, overlapping: 0 });
    expect(w.data.installations.map((i: { id: string }) => i.id)).toEqual([INSTALL]);
    expect(w.data.freshness.lastReadingAt).toBe('2026-10-20T18:30:00+05:30');
    expect((await run('gauge_workouts', { from: '2026-10-21', to: '2026-10-21' })).data.sessions.map((s: { id: string }) => s.id)).toEqual(['w-3']);
    expect((await run('gauge_workouts', { from: '2026-10-21', to: '2026-10-20' })).error.code).toBe('invalid_input');

    const avail = await run('gauge_data_availability');
    expect(avail.data.workoutSessions).toBe(3);
    expect(avail.data.categories).toEqual([expect.objectContaining({ category: 'activity/session', count: 4, readWith: 'gauge_workouts' })]);
    // workouts stay out of the daily activity
    expect((await run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' })).data.days).toEqual([]);
  });

  it('a deletion of a session hides it, and no older version comes back; an activity group deletion covers workouts', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    const v1 = workout('w-1', '2026-10-20T01:15:00Z', {}, { receivedAt: '2026-10-20T01:15:00Z' });
    const v2 = workout('w-1', '2026-10-20T05:00:00Z', { kcal: 430 }, { receivedAt: '2026-10-20T05:00:00Z' });
    const other = workout('w-2', '2026-10-20T13:00:00Z', { start: '2026-10-20T12:20:00Z', end: '2026-10-20T13:00:00Z', durationS: 2400 });
    await t.upload(gauge, [v1, v2, other, activityDaily('2026-10-20T12:00:00Z', 8200)]);
    const ids = async () => (await t.call('/v1/gauge/workouts?from=2026-10-20&to=2026-10-20', { token: a.device })).body.data.sessions.map((s: { id: string }) => s.id);
    expect(await ids()).toEqual(['w-1', 'w-2']);
    // the person deletes w-1 in Gauge: a tombstone for that session around its newest version only
    expect((await t.upload(gauge, [deletion('2026-10-21T03:00:00Z', { category: 'activity/session', kind: 'w-1', from: '2026-10-20T04:58:30Z', to: '2026-10-20T05:01:30Z' }, { receivedAt: '2026-10-21T03:00:00Z' })])).accepted).toBe(1);
    expect(await ids()).toEqual(['w-2']);
    expect((await t.call('/v1/gauge/availability', { token: a.device })).body.data.workoutSessions).toBe(1);
    // "activity" covers activity/session too
    await t.upload(gauge, [deletion('2026-10-21T03:10:00Z', { category: 'activity', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' }, { receivedAt: '2026-10-21T03:10:00Z' })]);
    expect(await ids()).toEqual([]);
    expect((await t.call('/v1/gauge/activity?from=2026-10-20&to=2026-10-20', { token: a.device })).body.data.days).toEqual([]);
    // a session Gauge sends again after the deletion shows again (as every category does)
    const again = workout('w-2', '2026-10-20T13:00:00Z', { start: '2026-10-20T12:20:00Z', end: '2026-10-20T13:00:00Z', durationS: 2400 }, { receivedAt: '2026-10-21T04:00:00Z' });
    expect(again.id).toBe(other.id);
    expect((await t.upload(gauge, [again])).duplicates).toBe(1);
    expect(await ids()).toEqual(['w-2']);
  });
});

describe('energy fix round 1: server (claude-core F3, F6, F10, F16; codex-core #8, #19, #21)', () => {
  const minutes = (fromIso: string, n: number, steps: number) => Array.from({ length: n }, (_, k) => ringSteps(new Date(Date.parse(fromIso) + k * 60_000).toISOString(), steps));
  /** 20 min of ring arm swings at 100/min from 04:00Z while the phone listened (detector timing) and counted nothing. */
  const mudgar = () => [
    ...minutes('2026-10-20T04:00:00.000Z', 20, 100),
    phoneAcquisition('2026-10-20T03:50:00Z', '2026-10-20T04:30:00Z', 'listening'),
    phoneSteps('2026-10-20T03:51:00Z', '2026-10-20T03:52:00Z', 4),
  ];
  const at04 = (d: Json) => d.data.intervals.find((u: Json) => Date.parse(u.start) <= Date.parse('2026-10-20T04:05:00Z') && Date.parse(u.end) > Date.parse('2026-10-20T04:05:00Z'));

  it('F3: POST /v1/gauge/steps/fuse with a nonLocomotor bout takes the phone\'s observed stillness; with no context it is exactly GET /steps', async () => {
    const t = await boot();
    const a = await t.person();
    expect((await t.upload(await t.pairGauge(a.id), mudgar())).rejected).toEqual([]);
    const get = await t.call('/v1/gauge/steps?from=2026-10-20&to=2026-10-20', { token: a.device });
    expect(at04(get.body)).toMatchObject({ lineage: 'ring', steps: 2000, selectionReason: 'soleSustainedGait' });
    const plain = await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: a.device, body: { from: '2026-10-20', to: '2026-10-20' } });
    expect(plain.status).toBe(200);
    expect(plain.body).toEqual(get.body);
    expect(plain.headers.get('etag')).toBe(get.headers.get('etag'));
    const activities = [{ start: '2026-10-20T09:30:00+05:30', end: '2026-10-20T09:50:00+05:30', kind: 'nonLocomotor' }];
    const fused = await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: a.device, body: { from: '2026-10-20', to: '2026-10-20', tz: 'Asia/Kolkata', activities } });
    expect(fused.status).toBe(200);
    expect(at04(fused.body)).toMatchObject({ lineage: 'phone', steps: 0, selectionReason: 'activityContext' });
    expect(fused.body.data.days[0].located).toBe(4);
    expect(fused.body.data.inputsHash).not.toBe(get.body.data.inputsHash);
    // the switch and the preference reach the fusion
    const off = await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: a.device, body: { from: '2026-10-20', to: '2026-10-20', preference: { stepsPreference: ['phone'], soleSustainedGait: false } } });
    expect(at04(off.body)).toMatchObject({ lineage: 'phone', steps: 0, selectionReason: 'preference' });
    // the MCP tool takes the same arguments
    const run = await t.mcp(a.device);
    const tool = await run('gauge_steps', { from: '2026-10-20', to: '2026-10-20', tz: 'Asia/Kolkata', activities });
    expect(tool).toEqual(fused.body);
    // checks
    for (const body of [{ from: '2026-10-20', to: '2026-10-20', activities: [{ ...activities[0], kind: 'swim' }] }, { from: '2026-10-20', to: '2026-10-20', nope: 1 },
      { from: '2026-10-20', to: '2026-10-20', preference: { stepsPreference: ['ring', 'ring'] } }, { from: '2026-10-20', to: '2026-10-20', corrections: [{ start: 'x', end: 'y', use: 'ring' }] }]) {
      expect((await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: a.device, body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await t.call('/v1/gauge/steps/fuse', { token: a.device })).status).toBe(405);
    expect((await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: await t.agentToken(a.device), body: { from: '2026-10-20', to: '2026-10-20' } })).status).toBe(403);
  });

  it('F6 / codex #8: a day\'s located total never depends on the query\'s from (a counter span across midnight)', async () => {
    const t = await boot();
    const a = await t.person();
    // Kolkata midnight of 2026-10-20 is 18:30Z on the 19th: 10 ring minutes at 50 on each side, under one phone counter span
    const ev = [...minutes('2026-10-19T18:20:00.000Z', 20, 50), phoneSteps('2026-10-19T18:20:00Z', '2026-10-19T18:40:00Z', 1000)];
    expect((await t.upload(await t.pairGauge(a.id), ev)).rejected).toEqual([]);
    const one = (await t.call('/v1/gauge/steps?from=2026-10-20&to=2026-10-20', { token: a.device })).body.data.days;
    const two = (await t.call('/v1/gauge/steps?from=2026-10-19&to=2026-10-20', { token: a.device })).body.data.days;
    expect(one.map((d: Json) => d.located)).toEqual([500]);
    expect(two.map((d: Json) => d.located)).toEqual([500, 500]);
  });

  it('F10: every route takes tz and names the zone it used; else the newest local_offset_min, else the person\'s zone', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    expect((await t.upload(gauge, [...ringData(), ...minutes('2026-10-19T18:20:00.000Z', 20, 50)])).rejected).toEqual([]);
    for (const [path, query] of CASES) {
      const sep = query ? '&' : '?';
      const r = await t.call(`/v1/gauge/${path}${query}${sep}tz=Europe/London`, { token: a.device });
      expect(r.status, path).toBe(200);
      expect(r.body.data.tz, path).toBe('Europe/London');
      // no tz: the ring's offset (330) is the person's zone's there, so the person's zone
      expect((await t.call(`/v1/gauge/${path}${query}`, { token: a.device })).body.data.tz, path).toBe('Asia/Kolkata');
    }
    // days follow the zone: the 18:20–18:40Z minutes are the 19th in UTC, half the 19th and half the 20th in Kolkata
    expect((await t.call('/v1/gauge/steps?from=2026-10-19&to=2026-10-19&tz=UTC', { token: a.device })).body.data.days[0].located).toBe(1000);
    expect((await t.call('/v1/gauge/steps?from=2026-10-19&to=2026-10-19', { token: a.device })).body.data.days[0].located).toBe(500);
    expect((await t.call('/v1/gauge/steps?from=2026-10-20&to=2026-10-20&tz=Not/AZone', { token: a.device })).status).toBe(400);
    // a person whose record says UTC: the observed offset wins, as a fixed-offset zone
    const p = await t.home.persons.add({ label: 'Utc', timeZone: 'UTC', secret: new Uint8Array(32).fill(9), relayUrl: null });
    const { code } = await t.home.devices.issueCode(p.id);
    const device = (await t.call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code, label: 'Phone' } })).body.token as string;
    await t.upload(await t.pairGauge(p.id), minutes('2026-10-19T18:20:00.000Z', 20, 50));
    const u = (await t.call('/v1/gauge/steps?from=2026-10-20&to=2026-10-20', { token: device })).body.data;
    expect(u.tz).toBe('+05:30');
    expect(u.days[0].located).toBe(500);
    expect((await t.call('/v1/gauge/device', { token: device })).body.data.tz).toBe('UTC');
  });

  it('F16 / codex #21: an upload under another installation than the token\'s is 403; a token without one keeps the old behaviour', async () => {
    const t = await boot();
    const a = await t.person();
    const gauge = await t.pairGauge(a.id);
    const r = await t.call('/v1/lumen/events', { method: 'POST', token: gauge, body: { installationId: OTHER_INSTALL, events: [hr('2026-10-20T01:00:00Z', 60)] } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('wrong_installation');
    expect((await t.upload(gauge, [hr('2026-10-20T01:00:00Z', 60)])).accepted).toBe(1);
    const legacy = (await t.home.devices.mint(a.id, { kind: 'lumen', label: 'Old Gauge' })).token;
    const old = await t.call('/v1/lumen/events', { method: 'POST', token: legacy, body: { installationId: OTHER_INSTALL, events: [hr('2026-10-20T02:00:00Z', 61)] } });
    expect(old.status).toBe(200);
  });

  it('codex #19: offsets do not depend on which instant of a half-hour DST hour was asked first', () => {
    // Lord Howe moves from +10:30 to +11:00 at 02:00 local on 2026-10-04 (15:30Z on the 3rd)
    const early = Date.parse('2026-10-03T15:15:00Z');
    const late = Date.parse('2026-10-03T15:45:00Z');
    expect(offsetMinutes(early, 'Australia/Lord_Howe')).toBe(630);
    expect(offsetMinutes(late, 'Australia/Lord_Howe')).toBe(660);
    expect(offsetMinutes(early, 'Australia/Lord_Howe')).toBe(630);
  });
});

describe('r063 S6: POST /v1/gauge/fusion-context, then every fused GET uses it', () => {
  const minutes = (fromIso: string, n: number, steps: number) => Array.from({ length: n }, (_, k) => ringSteps(new Date(Date.parse(fromIso) + k * 60_000).toISOString(), steps));
  const mudgar = () => [
    ...minutes('2026-10-20T04:00:00.000Z', 20, 100),
    phoneAcquisition('2026-10-20T03:50:00Z', '2026-10-20T04:30:00Z', 'listening'),
    phoneSteps('2026-10-20T03:51:00Z', '2026-10-20T03:52:00Z', 4),
  ];
  const body = {
    window: { start: '2026-10-20T00:00:00+05:30', end: '2026-10-21T00:00:00+05:30' }, tz: 'Asia/Kolkata',
    activities: [{ start: '2026-10-20T09:30:00+05:30', end: '2026-10-20T09:50:00+05:30', kind: 'nonLocomotor' }],
    preference: { stepsPreference: ['ring', 'phone', 'hc-other'], soleSustainedGait: true },
  };

  it('stores the context (never cached), changes the ETag of the timeline and steps, and the agent tools see the same', async () => {
    const t = await boot();
    const a = await t.person();
    expect((await t.upload(await t.pairGauge(a.id), mudgar())).rejected).toEqual([]);
    const tl0 = await t.call('/v1/gauge/timeline?date=2026-10-20&tz=Asia/Kolkata', { token: a.device });
    const i = Math.round((Date.parse('2026-10-20T04:05:00Z') - Date.parse(tl0.body.data.start)) / 60_000);
    expect(tl0.body.data.steps.selected[i]).toBe(100);
    const put = await t.call('/v1/gauge/fusion-context', { method: 'POST', token: a.device, body });
    expect(put.status).toBe(200);
    expect(put.headers.get('cache-control')).toBe('no-store');
    expect(put.body.data).toMatchObject({ changed: true, activities: 1, corrections: 0 });
    expect((await t.call('/v1/gauge/fusion-context', { method: 'POST', token: a.device, body })).body.data).toMatchObject({ changed: false, revision: put.body.data.revision });
    // a conditional poll with the old ETag gets the new body
    const tl1 = await t.call('/v1/gauge/timeline?date=2026-10-20&tz=Asia/Kolkata', { token: a.device, headers: { 'if-none-match': tl0.headers.get('etag')! } });
    expect(tl1.status).toBe(200);
    expect(tl1.body.data.steps.selected[i]).toBe(0);
    const steps = await t.call('/v1/gauge/steps?from=2026-10-20&to=2026-10-20&tz=Asia/Kolkata', { token: a.device });
    expect(steps.body.data.days[0].located).toBe(4);
    const fused = await t.call('/v1/gauge/steps/fuse', { method: 'POST', token: a.device, body: { from: '2026-10-20', to: '2026-10-20', tz: 'Asia/Kolkata', activities: body.activities, preference: body.preference } });
    expect(fused.body.data.days).toEqual(steps.body.data.days);
    const run = await t.mcp(a.device);
    expect((await run('gauge_timeline', { date: '2026-10-20', tz: 'Asia/Kolkata' })).data.steps.selected[i]).toBe(0);
    // checks: GET is 405, unknown fields and a bad window are 400, agents and Gauge are refused
    expect((await t.call('/v1/gauge/fusion-context', { token: a.device })).status).toBe(405);
    expect((await t.call('/v1/gauge/fusion-context', { method: 'POST', token: a.device, body: { ...body, nope: 1 } })).status).toBe(400);
    expect((await t.call('/v1/gauge/fusion-context', { method: 'POST', token: a.device, body: { ...body, window: { start: 'x', end: 'y' } } })).status).toBe(400);
    expect((await t.call('/v1/gauge/fusion-context', { method: 'POST', token: a.device, body: { ...body, activities: [{ ...body.activities[0], kind: 'swim' }] } })).status).toBe(400);
    expect((await t.call('/v1/gauge/fusion-context', { method: 'POST', token: await t.agentToken(a.device), body })).status).toBe(403);
  });
});
