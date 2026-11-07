// @vitest-environment node
/**
 * Gauge (formerly Lumen Health) → home server (docs/SERVER.md "Gauge"): pairing with the person's one-time code, the `lumen`
 * token kind and where it works, the upload route (duplicates, rejections, gzip, limits, 401/413/415/429), soft
 * deletion, status, the `pair-code` command, and every `gauge_*` tool through `/mcp` with the MCP SDK client.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '../mcpTestClient.ts';
import { startCompanion, VERSION, type Companion } from '../server.ts';
import type { HomeOptions } from './home.ts';
import { activityBucket, activityDaily, battery, bloodPressure, deletion, hr, insight, INSTALL, lumenEvent, metric, OTHER_INSTALL, shortVideo, sleepPacket, wear, type LumenTestEvent } from './lumenFixtures.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import { serverMain } from './serverCli.ts';
import { defaultServerConfig, writeServerConfig } from './serverConfig.ts';
import type { WorkerFactory } from './workers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool data is read field by field
type Json = Record<string, any>;

const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const NOW = Date.parse('2026-10-21T04:00:00Z'); // 09:30 in Kolkata
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

/** Person workers that answer an empty Vitals manifest (the lumen tools never reach them). */
const workers = () => {
  const seen: PersonRequest[] = [];
  const factory: WorkerFactory = async () => ({
    async call(req: PersonRequest): Promise<PersonResponse> {
      seen.push(req);
      if (req.op === 'agentManifest') return { ok: true, value: { format: 'vitals.tools/1', hash: '0', tools: [] } };
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  return { factory, seen };
};

async function boot(o: { lumen?: HomeOptions['lumen']; rateLimit?: { capacity: number; perMinute: number } } = {}) {
  const dataDir = mkdtempSync(join(TMP, 'lumen-home-'));
  const clock = { now: NOW };
  const w = workers();
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false,
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: o.rateLimit ?? { capacity: 1000, perMinute: 60_000 }, workerFactory: w.factory, now: () => clock.now, ...(o.lumen ? { lumen: o.lumen } : {}) },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; origin?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin) headers.origin = init.origin;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual', ...(init.raw ? { body: new Uint8Array(init.raw) } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test answers are read field by field
    return { status: r.status, body: (text ? JSON.parse(text) : null) as Record<string, any>, headers: r.headers };
  };
  const person = async (label = 'Ana') => {
    const p = await home.persons.add({ label, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(7), relayUrl: null });
    const { code } = await home.devices.issueCode(p.id);
    const d = await call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code, label: 'Phone' } });
    return { id: p.id, device: d.body.token as string };
  };
  const pairLumen = async (personId: string, installationId = INSTALL) => {
    const { code } = await home.devices.issueCode(personId);
    return call('/v1/lumen/pair', { method: 'POST', body: { code, installationId, deviceName: 'OnePlus CPH2661', appVersion: '2.4.0' } });
  };
  const upload = (token: string, events: unknown[], installationId = INSTALL, extra: { gzip?: boolean; headers?: Record<string, string> } = {}) => {
    const json = Buffer.from(JSON.stringify({ installationId, events }));
    return call('/v1/lumen/events', { method: 'POST', token, raw: extra.gzip ? gzipSync(json) : json, headers: { ...(extra.gzip ? { 'content-encoding': 'gzip' } : {}), ...(extra.headers ?? {}) } });
  };
  return { c, home, call, person, pairLumen, upload, clock, dataDir, seen: w.seen };
}

describe('pairing', () => {
  it('pairs Lumen with the one-time code and answers the token and limits; a used, wrong or expired code is refused', async () => {
    const t = await boot();
    const a = await t.person();
    const { code } = await t.home.devices.issueCode(a.id);
    const ok = await t.call('/v1/lumen/pair', { method: 'POST', body: { code, installationId: INSTALL, deviceName: 'OnePlus CPH2661', appVersion: '2.4.0' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), personId: a.id, deviceId: expect.any(String), serverVersion: VERSION, maxBatch: 500, maxBytes: 1048576 });
    // only the hash is stored, beside the person's other devices
    const stored = readFileSync(t.home.persons.paths(a.id).devices, 'utf8');
    expect(stored).not.toContain(ok.body.token);
    expect(JSON.parse(stored).find((d: { kind: string }) => d.kind === 'lumen')).toMatchObject({ label: 'OnePlus CPH2661', scope: 'lumen', installationId: INSTALL, appVersion: '2.4.0' });

    const again = await t.call('/v1/lumen/pair', { method: 'POST', body: { code, installationId: INSTALL } });
    expect([again.status, again.body.error]).toEqual([410, 'used']);
    expect(again.body.message).toMatch(/new one/);
    const wrong = await t.call('/v1/lumen/pair', { method: 'POST', body: { code: code === '11111111' ? '22222222' : '11111111', installationId: INSTALL } });
    expect([wrong.status, wrong.body.error]).toEqual([401, 'invalid_code']);
    const late = await t.home.devices.issueCode(a.id);
    t.clock.now += 11 * 60_000;
    const expired = await t.call('/v1/lumen/pair', { method: 'POST', body: { code: late.code, installationId: INSTALL } });
    expect([expired.status, expired.body.error]).toEqual([410, 'expired']);
    for (const body of [{ installationId: INSTALL }, { code: '123', installationId: INSTALL }, { code: '12345678' }, { code: '12345678', installationId: 'x' }, { code: '12345678', installationId: INSTALL, appVersion: 'two point oh' }]) {
      const bad = await t.call('/v1/lumen/pair', { method: 'POST', body });
      expect([bad.status, bad.body.error], JSON.stringify(body)).toEqual([400, 'bad_request']);
    }
    expect((await t.call('/v1/lumen/pair')).status).toBe(405);
  });

  it('a Vitals device still reads a used code as a wrong one', async () => {
    const t = await boot();
    const a = await t.person();
    const { code } = await t.home.devices.issueCode(a.id);
    expect((await t.call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code } })).status).toBe(200);
    const reuse = await t.call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code } });
    expect([reuse.status, reuse.body.error]).toEqual([401, 'invalid_code']);
  });

  it('a lumen token works on /v1/lumen/* only; it is listed and revoked like any device; pairing again replaces it', async () => {
    const t = await boot();
    const a = await t.person();
    const l = (await t.pairLumen(a.id)).body;
    expect((await t.call('/v1/lumen/status', { token: l.token })).status).toBe(200);
    for (const [path, method] of [['/v1/pair/status', 'GET'], ['/v1/devices', 'GET'], ['/v1/pair/code', 'POST'], ['/v1/sync/key', 'POST'], ['/v1/agents/tokens', 'GET'], ['/v1/ai/status', 'GET']] as const) {
      const r = await t.call(path, { method, token: l.token, body: method === 'POST' ? {} : undefined });
      expect(r.status, path).toBe(403);
    }
    const mcp = await t.call('/mcp', { method: 'POST', token: l.token, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }, headers: { accept: 'application/json, text/event-stream' } });
    expect(mcp.status).toBe(403);
    // the person's other tokens cannot upload
    expect((await t.upload(a.device, [])).status).toBe(403);
    expect((await t.upload('not-a-real-token-at-all', [])).status).toBe(401);
    expect((await t.call('/v1/lumen/events', { method: 'POST', body: { installationId: INSTALL, events: [] } })).status).toBe(401);

    const list = await t.call('/v1/devices', { token: a.device });
    const row = (list.body.devices as Array<{ id: string; kind: string; label: string; scope: string }>).find((d) => d.kind === 'lumen');
    expect(row).toMatchObject({ id: l.deviceId, label: 'OnePlus CPH2661', scope: 'lumen' });

    // pairing the same installation again retires the old token
    const l2 = (await t.pairLumen(a.id)).body;
    expect((await t.call('/v1/lumen/status', { token: l.token })).body.error).toBe('revoked');
    expect((await t.call(`/v1/devices/${l2.deviceId}`, { method: 'DELETE', token: a.device })).status).toBe(204);
    const gone = await t.call('/v1/lumen/status', { token: l2.token });
    expect([gone.status, gone.body.error]).toEqual([401, 'revoked']);
  });

  it('Lumen unpairs itself with POST /v1/lumen/unpair: 204, then its token is revoked; its uploads stay', async () => {
    const t = await boot();
    const a = await t.person();
    const l = (await t.pairLumen(a.id)).body;
    await t.upload(l.token, [hr('2026-10-20T01:00:00Z', 58)], INSTALL, { gzip: true });
    expect((await t.call('/v1/lumen/unpair', { method: 'POST', token: a.device })).status).toBe(403);
    expect((await t.call('/v1/lumen/unpair', { token: l.token })).status).toBe(405);
    const r = await fetch(`${t.c.url}/v1/lumen/unpair`, { method: 'POST', headers: { authorization: `Bearer ${l.token}` }, redirect: 'manual' });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    const after = await t.call('/v1/lumen/events', { method: 'POST', token: l.token, body: { installationId: INSTALL, events: [] } });
    expect([after.status, after.body.error]).toEqual([401, 'revoked']);
    expect((await t.call('/v1/devices', { token: a.device })).body.devices.some((d: { kind: string }) => d.kind === 'lumen')).toBe(false);
    expect((await t.call('/v1/lumen/unpair', { method: 'POST', token: l.token })).status).toBe(401);
    expect(t.home.lumen.peek(a.id)!.status().counts).toEqual({ 'metrics/hr': 1 });
    // unknown Lumen paths answer directly, never with a redirect
    expect((await t.call('/v1/lumen/nope', { method: 'POST', token: l.token })).status).toBe(404);
  });
});

describe('ingest', () => {
  it('accepts a batch, counts re-sent ids as duplicates, rejects malformed events one by one, and reports status', async () => {
    const t = await boot();
    const a = await t.person();
    const { token } = (await t.pairLumen(a.id)).body;
    const batch = [hr('2026-10-20T01:00:00Z', 58), hr('2026-10-20T01:05:00Z', 61), activityDaily('2026-10-20T10:00:00Z', 6400), battery('2026-10-20T10:00:00Z', 81)];
    const first = await t.upload(token, batch);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ accepted: 4, duplicates: 0, rejected: [] });
    const bad = { ...hr('2026-10-20T01:10:00Z', 60), id: 'pl-bad', source: `urn:pulseloop:installation:${OTHER_INSTALL}` };
    const second = await t.upload(token, [...batch.slice(0, 2), bad, { id: 'pl-x' }, hr('2026-10-20T01:15:00Z', 63)]);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ accepted: 1, duplicates: 2, rejected: [{ id: 'pl-bad', index: 2, reason: 'source_mismatch' }, { id: 'pl-x', index: 3, reason: 'bad_specversion' }] });
    const s = await t.call('/v1/lumen/status', { token });
    expect(s.body).toEqual({ personId: a.id, lastEventAt: new Date(NOW).toISOString(), lastObservedAt: '2026-10-20T10:00:00.000Z', counts: { 'activity/daily': 1, 'metrics/hr': 3, 'state/battery': 1 }, deletions: 0, serverVersion: VERSION });
  });

  it('takes gzip, and answers 400 / 413 / 415 for bad gzip, over-limit bodies or batches and other encodings', async () => {
    const t = await boot({ lumen: { maxBatch: 10, maxBytes: 16 * 1024 } });
    const a = await t.person();
    const pair = (await t.pairLumen(a.id)).body;
    expect([pair.maxBatch, pair.maxBytes]).toEqual([10, 16 * 1024]);
    const zipped = await t.upload(pair.token, [hr('2026-10-20T01:00:00Z', 58), hr('2026-10-20T01:01:00Z', 59)], INSTALL, { gzip: true });
    expect(zipped.body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    const notGzip = await t.call('/v1/lumen/events', { method: 'POST', token: pair.token, raw: Buffer.from('{"x":1}'), headers: { 'content-encoding': 'gzip' } });
    expect([notGzip.status, notGzip.body.error]).toEqual([400, 'bad_gzip']);
    // a small gzip body that inflates past maxBytes
    const bomb = gzipSync(Buffer.from(JSON.stringify({ installationId: INSTALL, events: [], pad: 'x'.repeat(200_000) })));
    expect(bomb.length).toBeLessThan(16 * 1024);
    const inflated = await t.call('/v1/lumen/events', { method: 'POST', token: pair.token, raw: bomb, headers: { 'content-encoding': 'gzip' } });
    expect([inflated.status, inflated.body.error]).toEqual([413, 'body_too_large']);
    const big = await t.call('/v1/lumen/events', { method: 'POST', token: pair.token, raw: Buffer.from(JSON.stringify({ installationId: INSTALL, events: [], pad: 'x'.repeat(20_000) })) });
    expect(big.status).toBe(413);
    const many = await t.upload(pair.token, Array.from({ length: 11 }, (_, i) => hr(`2026-10-20T02:${String(i).padStart(2, '0')}:00Z`, 60)));
    expect([many.status, many.body.error]).toEqual([413, 'too_many_events']);
    const br = await t.upload(pair.token, [], INSTALL, { headers: { 'content-encoding': 'br' } });
    expect(br.status).toBe(415);
    const shape = await t.call('/v1/lumen/events', { method: 'POST', token: pair.token, body: { installationId: INSTALL, events: 'none' } });
    expect([shape.status, shape.body.error]).toEqual([400, 'bad_request']);
    const notJson = await t.call('/v1/lumen/events', { method: 'POST', token: pair.token, raw: Buffer.from('{') });
    expect([notJson.status, notJson.body.error]).toEqual([400, 'bad_json']);
  });

  it('limits uploads per token with 429 and Retry-After', async () => {
    const t = await boot({ lumen: { eventsPerMinute: 3 } });
    const a = await t.person();
    const { token } = (await t.pairLumen(a.id)).body;
    for (let i = 0; i < 3; i++) expect((await t.upload(token, [])).status).toBe(200);
    const r = await t.upload(token, []);
    expect([r.status, r.body.error]).toEqual([429, 'rate_limited']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    // status is not an upload
    expect((await t.call('/v1/lumen/status', { token })).status).toBe(200);
    t.clock.now += 60_000;
    expect((await t.upload(token, [])).status).toBe(200);
  });

  it('never logs a payload', async () => {
    const lines: string[] = [];
    const dataDir = mkdtempSync(join(TMP, 'lumen-log-'));
    const c = await startCompanion({ port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false, log: (l) => lines.push(l), home: { dataDir, rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: workers().factory } });
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
    const p = await c.home!.persons.add({ label: 'Log', timeZone: 'UTC', secret: new Uint8Array(32), relayUrl: null });
    const { code } = await c.home!.devices.issueCode(p.id);
    const pair = (await (await fetch(`${c.url}/v1/lumen/pair`, { method: 'POST', body: JSON.stringify({ code, installationId: INSTALL }) })).json()) as { token: string };
    await fetch(`${c.url}/v1/lumen/events`, { method: 'POST', headers: { authorization: `Bearer ${pair.token}` }, body: JSON.stringify({ installationId: INSTALL, events: [hr('2026-10-20T01:00:00Z', 173)] }) });
    const all = lines.join('\n');
    expect(all).toMatch(/lumen: 1 accepted, 0 duplicates, 0 rejected/);
    expect(all).not.toMatch(/pl-[0-9a-f]{8}|2026-10-20T01|metrics\/hr|device_history|bpm/);
  });
});

describe('the pair-code command', () => {
  it('prints a code for the only person, or for --person; with several persons it asks which', async () => {
    const dir = mkdtempSync(join(TMP, 'lumen-cli-'));
    const env0 = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
    cleanup.push(() => {
      for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      rmSync(dir, { recursive: true, force: true });
    });
    process.env.XDG_CONFIG_HOME = join(dir, 'config');
    process.env.XDG_DATA_HOME = join(dir, 'data-home');
    await writeServerConfig(join(dir, 'config', 'vitals-server'), { ...defaultServerConfig(), dataDir: join(dir, 'data') });
    const cli = async (args: string[]) => {
      const lines: string[] = [];
      const code = await serverMain(args, (l) => lines.push(l), Readable.from([]) as unknown as NodeJS.ReadStream);
      return { code, out: lines.join('\n') };
    };
    await expect(cli(['pair-code'])).rejects.toThrow(/Add a person first/);
    const one = (await cli(['persons', 'add', 'Ana', '--tz', 'Asia/Kolkata'])).out.slice(0, 16);
    const r = await cli(['pair-code']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Code \d{8} \(valid until .+, single use\)/);
    await cli(['persons', 'add', 'Bo']);
    await expect(cli(['pair-code'])).rejects.toThrow(/--person <id>/);
    expect((await cli(['pair-code', '--person', one, '--label', 'Lumen'])).out).toMatch(/^Code \d{8}/);
    expect((await cli(['--help'])).out).toMatch(/pair-code \[--person <id>\]/);
  });
});

// ---------------------------------------------------------------------------------------------------------------

async function mcpFor(t: Awaited<ReturnType<typeof boot>>, device: string, scope: 'read' | 'log' | 'edit' = 'read') {
  const agent = (await t.call('/v1/agents/tokens', { method: 'POST', token: device, origin: SITE, body: { client: 'claude', scope } })).body.token as string;
  const client = new Client({ name: 'lumen-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${t.c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agent}` } } }));
  cleanup.push(() => client.close());
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool data is read field by field
    return r.structuredContent as { ok: boolean; status: string; summary: string; data: Record<string, any>; error?: { code: string } };
  };
  return { client, run };
}

/** A day of ring data for person Ana (Asia/Kolkata): readings, activity, a night, scores and device state. */
function ringDay(): LumenTestEvent[] {
  const night = Array.from({ length: 420 }, (_, i) => (i < 90 ? 'light' : i < 150 ? 'deep' : i < 210 ? 'rem' : i < 400 ? 'light' : 'awake'));
  return [
    // 2026-10-20 06:30, 07:30, 08:30 IST and one the day before
    hr('2026-10-20T01:00:00Z', 58), hr('2026-10-20T02:00:00Z', 66), hr('2026-10-20T03:00:00Z', 74), hr('2026-10-19T03:00:00Z', 70),
    metric('spo2', '%', '2026-10-20T01:30:00Z', 97), metric('temp', '°C', '2026-10-20T01:30:00Z', 36.2),
    bloodPressure('2026-10-20T04:00:00Z', 118, 76),
    activityDaily('2026-10-20T06:00:00Z', 3000), activityDaily('2026-10-20T12:00:00Z', 8200),
    activityBucket('2026-10-20T04:30:00Z', 1200), activityBucket('2026-10-20T04:45:00Z', 300), activityBucket('2026-10-20T05:30:00Z', 900),
    // night of 19 → 20 October, 23:30 → 06:30 IST
    sleepPacket('2026-10-19T18:00:00Z', night, { complete: true }),
    insight('sleep_score', '2026-10-19T18:30:00Z', 82), insight('recovery_score', '2026-10-20T00:00:00Z', 71),
    battery('2026-10-20T12:00:00Z', 64), battery('2026-10-20T09:00:00Z', 70), wear('2026-10-20T12:00:00Z', true),
  ];
}

describe('the gauge_* MCP tools', () => {
  it('are listed for a read-scope agent beside the Vitals tools, read-only, and say the data is Gauge\'s (formerly Lumen Health), not Vitals\' manual logs; no lumen_* names remain', async () => {
    const t = await boot();
    const a = await t.person();
    const { client } = await mcpFor(t, a.device, 'read');
    const tools = (await client.listTools()).tools.filter((x) => x.name.startsWith('gauge_'));
    expect(tools.map((x) => x.name)).toEqual(['gauge_data_availability', 'gauge_metric_series', 'gauge_daily_summary', 'gauge_sleep', 'gauge_activity', 'gauge_scores', 'gauge_device_state', 'gauge_short_video', 'gauge_workouts', 'gauge_steps', 'gauge_timeline', 'gauge_hr_intervals', 'gauge_baselines', 'gauge_hc', 'gauge_detections', 'gauge_changes', 'gauge_changes_state']);
    expect((await client.listTools()).tools.filter((x) => /^lumen/.test(x.name))).toEqual([]);
    for (const x of tools) {
      expect(x.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(x.title).toMatch(/^(Ring|Phone|On-device|Fused|Detected|Imported)/);
      expect(x.description).toMatch(/Ring and phone data|Phone data/);

      expect(x.description).toMatch(x.name === 'gauge_short_video' ? /separate from Vitals' manual logs/ : /separate from Vitals' own manual logs, which the person enters by hand/);
    }
    expect(tools.find((x) => x.name === 'gauge_short_video')!.description).toMatch(/^The phone's count of short-form videos \(Reels\/Shorts\) watched per day — counts only, never content; separate from Vitals' manual logs\./);
  });

  it('gauge_short_video reads Gauge\'s short-video days uploaded through /v1/lumen/events, newest per date; a habits deletion hides them', async () => {
    const t = await boot();
    const a = await t.person();
    const { token } = (await t.pairLumen(a.id)).body;
    const up = await t.upload(token, [
      shortVideo('2026-10-20', '2026-10-20T06:00:00Z', { instagram: 4, youtube: 2 }, {}, { receivedAt: '2026-10-20T06:00:00Z' }),
      shortVideo('2026-10-20', '2026-10-20T16:00:00Z', { instagram: 11, youtube: 7 }, { limit: 15, limitHits: 1, cancels: 2 }, { receivedAt: '2026-10-20T16:00:00Z' }),
      { ...shortVideo('2026-10-21', '2026-10-21T03:00:00Z', { instagram: 1 }), subject: 'today' },
    ], INSTALL, { gzip: true });
    expect(up.body).toMatchObject({ accepted: 2, duplicates: 0, rejected: [{ index: 2, reason: 'bad_short_video' }] });
    expect((await t.call('/v1/lumen/status', { token })).body.counts).toEqual({ 'habits/short_video': 2 });
    const { run } = await mcpFor(t, a.device);
    const r = await run('gauge_short_video', { from: '2026-10-20', to: '2026-10-20' });
    expect(r.data.days).toEqual([{ date: '2026-10-20', counts: { instagram: 11, youtube: 7 }, total: 18, limit: 15, limitHits: 1, cancels: 2 }]);
    expect(r.data.averages.last7Days).toMatchObject({ daysWithData: 1, total: 18 });
    expect(r.data.installations.map((i: { id: string }) => i.id)).toEqual([INSTALL]);
    expect((await run('gauge_data_availability')).data.categories.map((c: { category: string; readWith: string }) => [c.category, c.readWith])).toEqual([['habits/short_video', 'gauge_short_video']]);
    await t.upload(token, [deletion('2026-10-21T03:00:00Z', { category: 'habits', from: '2026-10-19T18:30:00Z', to: '2026-10-20T18:29:59Z' }, { receivedAt: '2026-10-21T03:00:00Z' })]);
    expect((await run('gauge_short_video', { from: '2026-10-20', to: '2026-10-20' })).data.days).toEqual([]);
  });

  it('an agent over the per-token request limit gets 429 with Retry-After on /mcp, not a 500', async () => {
    const t = await boot({ rateLimit: { capacity: 3, perMinute: 1 } });
    const ana = await t.person();
    const agent = (await t.call('/v1/agents/tokens', { method: 'POST', token: ana.device, origin: SITE, body: { client: 'claude', scope: 'read' } })).body.token as string;
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await t.call('/mcp', { method: 'POST', token: agent, headers: { accept: 'application/json, text/event-stream' }, body: { jsonrpc: '2.0', id: i, method: 'ping' } });
      statuses.push(r.status);
      if (r.status === 429) retryAfter = r.headers.get('retry-after');
    }
    expect(statuses.slice(3)).toEqual([429, 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('answer "no data yet" before Lumen ever uploaded, without creating lumen.db', async () => {
    const t = await boot();
    const a = await t.person();
    const { run } = await mcpFor(t, a.device);
    const r = await run('gauge_data_availability');
    expect(r).toMatchObject({ ok: true, data: { categories: [], installations: [], freshness: { lastUploadAt: null } } });
    expect(r.summary).toMatch(/pair-code/);
    expect((await run('gauge_sleep', { from: '2026-10-19', to: '2026-10-20' })).data.sessions).toEqual([]);
    const { existsSync } = await import('node:fs');
    expect(existsSync(t.home.persons.paths(a.id).lumen)).toBe(false);
  });

  it('read every view in the person\'s zone with units, the installation and freshness; soft deletions disappear everywhere', async () => {
    const t = await boot();
    const a = await t.person();
    const { token } = (await t.pairLumen(a.id)).body;
    // every Lumen upload is gzipped
    expect((await t.upload(token, ringDay(), INSTALL, { gzip: true })).body.accepted).toBe(ringDay().length);
    const { run } = await mcpFor(t, a.device, 'log');
    const install = [{ id: INSTALL, deviceName: 'OnePlus CPH2661', appVersion: '2.4.0', app: 'gauge', status: 'active', supersededBy: null, lastUploadAt: '2026-10-21T09:30:00+05:30' }];

    const avail = await run('gauge_data_availability');
    expect(avail.ok).toBe(true);
    expect(avail.data.installations).toEqual(install);
    expect(avail.data.timeZone).toBe('Asia/Kolkata');
    expect(avail.data.metricKinds).toEqual(['blood_pressure', 'hr', 'spo2', 'temp']);
    expect(avail.data.categories.find((c: { category: string }) => c.category === 'metrics/hr')).toEqual({ category: 'metrics/hr', count: 4, firstReadingAt: '2026-10-19T08:30:00+05:30', lastReadingAt: '2026-10-20T08:30:00+05:30', readWith: 'gauge_metric_series' });

    const raw = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20' });
    expect(raw.data).toMatchObject({ kind: 'hr', unit: 'bpm', bucket: 'raw', from: '2026-10-20T00:00:00+05:30', to: '2026-10-20T23:59:59+05:30', count: 3, installations: install });
    // raw readings name their event id, quality and physical source (energy SPEC §2.2), oldest first, in pages
    const src = { quality: 'unverified', source: `ring:installation:${INSTALL}` };
    expect(raw.data.points.map(({ id, ...p }: Json) => (expect(id).toMatch(/^pl-/), p))).toEqual([
      { at: '2026-10-20T06:30:00+05:30', value: 58, provenance: 'device_history', ...src },
      { at: '2026-10-20T07:30:00+05:30', value: 66, provenance: 'device_history', ...src },
      { at: '2026-10-20T08:30:00+05:30', value: 74, provenance: 'device_history', ...src },
    ]);
    expect(raw.data).toMatchObject({ truncated: false, next: null });
    const page1 = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20', limit: 2 });
    expect(page1.data).toMatchObject({ count: 2, truncated: true, next: expect.any(String) });
    const page2 = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20', limit: 2, cursor: page1.data.next });
    expect([...page1.data.points, ...page2.data.points].map((p: Json) => p.value)).toEqual([58, 66, 74]);
    expect(page2.data.next).toBeNull();
    expect((await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20', cursor: 'nope' })).error?.code).toBe('invalid_input');
    expect(raw.data.freshness).toMatchObject({ lastReadingAt: '2026-10-20T08:30:00+05:30', minutesSinceLastReading: 1500 });
    const daily = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-19', to: '2026-10-20T23:59', bucket: 'day' });
    expect(daily.data.points).toEqual([
      { date: '2026-10-19', start: '2026-10-19T00:00:00+05:30', count: 1, mean: 70, min: 70, max: 70 },
      { date: '2026-10-20', start: '2026-10-20T00:00:00+05:30', count: 3, mean: 66, min: 58, max: 74 },
    ]);
    const hourly = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20T06:00', to: '2026-10-20T07:59', bucket: 'hour' });
    expect(hourly.data.points.map((p: { start: string; count: number }) => [p.start, p.count])).toEqual([['2026-10-20T06:00:00+05:30', 1], ['2026-10-20T07:00:00+05:30', 1]]);
    const bp = await run('gauge_metric_series', { kind: 'blood_pressure', from: '2026-10-20', to: '2026-10-20' });
    expect(bp.data.unit).toBe('mmHg');
    expect(bp.data.points).toEqual([{ at: '2026-10-20T09:30:00+05:30', systolic: 118, diastolic: 76, provenance: 'device_estimate', id: expect.any(String), quality: null, source: `ring:installation:${INSTALL}` }]);
    const none = await run('gauge_metric_series', { kind: 'glucose', from: '2026-10-20', to: '2026-10-20' });
    expect(none.data).toMatchObject({ count: 0, unit: 'mg/dL', availableKinds: ['blood_pressure', 'hr', 'spo2', 'temp'] });
    expect((await run('gauge_metric_series', { kind: 'hr', from: '2026-10-21', to: '2026-10-20' })).error?.code).toBe('invalid_input');
    expect((await run('gauge_metric_series', { kind: 'hr', from: 'yesterday', to: '2026-10-20' })).error?.code).toBe('invalid_input');

    const sleep = await run('gauge_sleep', { from: '2026-10-20', to: '2026-10-20' });
    expect(sleep.data.units).toMatchObject({ minutes: 'min' });
    expect(sleep.data.sessions).toHaveLength(1);
    expect(sleep.data.sessions[0]).toMatchObject({ wakingDate: '2026-10-20', start: '2026-10-19T23:30:00+05:30', end: '2026-10-20T06:30:00+05:30', inBedMinutes: 420, asleepMinutes: 400, minutes: { deep: 60, rem: 60, light: 280, awake: 20, unknown: 0 } });
    expect(sleep.data.sessions[0].blocks[0]).toEqual({ start: '2026-10-19T23:30:00+05:30', end: '2026-10-20T01:00:00+05:30', stage: 'light', minutes: 90 });
    expect(sleep.data.installations).toEqual(install);

    const act = await run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' });
    expect(act.data.units).toMatchObject({ distanceM: 'm', caloriesKcal: expect.stringMatching(/^kcal/) });
    // the legacy buckets have no known duration: never placed in fusion, so the headline is the ring's total, "at least"
    expect(act.data.days).toEqual([{
      date: '2026-10-20', steps: 8200, distanceM: 5740, caloriesKcal: 328, activeMinutes: 82, bucketSteps: 2400, bucketDistanceM: 1680, lastUpdate: '2026-10-20T17:30:00+05:30',
      fusedHeadline: 8200, fusedHeadlinePolicy: 'atLeast', fusedLocated: null, fusionVersion: 'steps-fuse/1',
    }]);
    expect(act.data.inputsHash).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(act.data.hourly).toEqual([{ start: '2026-10-20T10:00:00+05:30', steps: 1500, distanceM: 1050 }, { start: '2026-10-20T11:00:00+05:30', steps: 900, distanceM: 630 }]);

    const sc = await run('gauge_scores', { from: '2026-10-20', to: '2026-10-20' });
    expect(Object.keys(sc.data.scores)).toEqual(['recovery_score', 'sleep_score']);
    expect(sc.data.scores.sleep_score).toEqual([{ date: '2026-10-20', scopeStart: '2026-10-20T00:00:00+05:30', value: 82, unit: 'score', confidence: 'medium', algorithmVersion: 'lumen-sleep_score-v1', note: null, inputs: { duration_min: 420 }, legacy: true }]);
    expect(sc.data.legacy).toBe(true);
    expect(Object.keys((await run('gauge_scores', { from: '2026-10-20', to: '2026-10-20', key: 'recovery_score' })).data.scores)).toEqual(['recovery_score']);

    const state = await run('gauge_device_state');
    expect(state.data.devices).toEqual([{ installationId: INSTALL, deviceName: 'OnePlus CPH2661', app: 'gauge', status: 'active', supersededBy: null, state: {
      battery: { percent: 64, event: 'health.device.battery.updated', at: '2026-10-20T17:30:00+05:30' },
      wear: { worn: true, event: 'health.device.wear_state.updated', at: '2026-10-20T17:30:00+05:30' },
    } }]);
    expect(state.data.units).toEqual({ 'battery.percent': '%' });

    const day = await run('gauge_daily_summary', { date: '2026-10-20' });
    expect(day.data).toMatchObject({ date: '2026-10-20', from: '2026-10-20T00:00:00+05:30', to: '2026-10-21T00:00:00+05:30', activity: { steps: 8200 }, installations: install });
    expect(day.data.sleep).toHaveLength(1);
    expect(Object.keys(day.data.scores)).toEqual(['recovery_score', 'sleep_score']);
    expect(day.data.metrics.hr).toEqual({ unit: 'bpm', count: 3, mean: 66, min: 58, max: 74, latest: { at: '2026-10-20T08:30:00+05:30', value: 74 }, medianGapS: 3600 });
    expect(day.data.metrics.spo2.medianGapS).toBeNull();
    expect(day.data.derived).toMatchObject({ version: 'day-metrics/1', peakHr: { bpm: 74, at: '2026-10-20T08:30:00+05:30', source: 'hr', lowerBound: true }, avgWorkoutHr: null, ringStepGoal: null });
    // the night's recorded window ends at 06:30 (exclusive): three awake readings, under the 5 a median needs
    expect(day.data.derived.nonExerciseHr).toMatchObject({ median: null, n: 3, reason: 'tooFewReadings' });
    expect(day.data.metrics.blood_pressure).toMatchObject({ unit: 'mmHg', count: 1, meanSystolic: 118, meanDiastolic: 76 });
    expect(day.data.metrics.temp).toMatchObject({ unit: '°C', mean: 36.2 });
    expect((await run('gauge_daily_summary', { date: '20 Oct' })).error?.code).toBe('invalid_input');

    // the person deletes the 07:30 reading in Lumen (a ±90 s tombstone) and then the night
    const del = await t.upload(token, [
      deletion('2026-10-21T03:00:00Z', { category: 'metrics/hr', kind: 'hr', from: '2026-10-20T01:58:30Z', to: '2026-10-20T02:01:30Z' }, { receivedAt: '2026-10-21T03:00:00Z' }),
      deletion('2026-10-21T03:01:00Z', { category: 'sleep/timeline', from: '2026-10-19T18:00:00Z', to: '2026-10-20T01:00:00Z' }, { receivedAt: '2026-10-21T03:01:00Z' }),
    ]);
    expect(del.body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect((await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20' })).data.points.map((p: { value: number }) => p.value)).toEqual([58, 74]);
    expect((await run('gauge_sleep', { from: '2026-10-20', to: '2026-10-20' })).data.sessions).toEqual([]);
    const after = await run('gauge_daily_summary', { date: '2026-10-20' });
    expect(after.data.metrics.hr).toMatchObject({ count: 2, mean: 66 });
    expect(after.data.sleep).toEqual([]);
    expect((await run('gauge_data_availability')).data.deletions).toBe(2);
    expect((await t.call('/v1/lumen/status', { token })).body.counts['metrics/hr']).toBe(3);

    // "Reset App Data": everything from the installation goes, a second phone's data stays
    const other = (await t.pairLumen(a.id, OTHER_INSTALL)).body.token;
    await t.upload(other, [hr('2026-10-20T05:00:00Z', 80, { install: OTHER_INSTALL })], OTHER_INSTALL);
    await t.upload(token, [deletion('2026-10-21T03:30:00Z', { category: '*' }, { receivedAt: '2026-10-21T03:30:00Z' })]);
    const left = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-19', to: '2026-10-20' });
    expect(left.data.points).toEqual([{ at: '2026-10-20T10:30:00+05:30', value: 80, provenance: 'device_history', id: expect.any(String), quality: 'unverified', source: `ring:installation:${OTHER_INSTALL}` }]);
    expect(left.data.installations.map((i: { id: string }) => i.id)).toEqual([OTHER_INSTALL]);
    expect((await run('gauge_device_state')).data.devices).toEqual([]);
    expect((await run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' })).data.days).toEqual([]);
    expect((await t.call('/v1/lumen/status', { token })).body.counts).toEqual({ 'metrics/hr': 1 });

    // the lumen tools never asked the person's worker for anything but the Vitals tool list
    expect(t.seen.every((r) => r.op === 'agentManifest')).toBe(true);
  });
});

describe('(r068) the steps day\'s "Updated"', () => {
  const coverage = (at: string, to: string, complete: boolean) =>
    lumenEvent('state/sync', 'coverage.activity_detail', 'health.sync.coverage', at, { stream: 'activity_detail', from: '2026-10-19T18:30:00Z', to, fromDay: '2026-10-19', toDay: '2026-10-19', complete, reason: 'overlap' });
  it('is when the ring\'s step detail was last read: a sync that found no new steps still moves it; an incomplete read does not', async () => {
    const t = await boot();
    const a = await t.person();
    const { token } = (await t.pairLumen(a.id)).body;
    // the last data is 17:30 IST; the ring is read again at 18:30 (complete, no new steps) and 19:30 (incomplete)
    const events = [...ringDay(), coverage('2026-10-20T13:00:00Z', '2026-10-20T13:06:00Z', true), coverage('2026-10-20T14:00:00Z', '2026-10-20T14:00:00Z', false)];
    expect((await t.upload(token, events, INSTALL, { gzip: true })).body.accepted).toBe(events.length);
    const { run } = await mcpFor(t, a.device, 'log');
    const act = await run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' });
    // never after it was observed (its window may reach past it)
    expect(act.data.days[0].lastUpdate).toBe('2026-10-20T18:30:00+05:30');
  });
});
