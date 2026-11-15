// @vitest-environment node
/**
 * (r087 S5) Shutdown order and /health. `close()` used to close the stores first and the listener last, so a request
 * that resumed after an await (an upload still receiving its body) met "The database connection is not open". Now it
 * stops taking work, ends responses that only wait (hold-open polls, an MCP client's event stream), lets running
 * requests finish (up to `drainMs`), and only then closes stores. A request counts until its handler returns, not only
 * until its client goes away.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from './mcpTestClient.ts';
import { startCompanion, type Companion } from './server.ts';
import { hr, INSTALL } from './home/lumenFixtures.ts';
import type { PersonRequest, PersonResponse } from './home/personRpc.ts';
import type { WorkerFactory } from './home/workers.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function boot(drainMs?: number) {
  const dataDir = mkdtempSync(join(TMP, 'server-shutdown-'));
  const lines: string[] = [];
  const factory: WorkerFactory = async () => ({
    async call(req: PersonRequest): Promise<PersonResponse> {
      if (req.op === 'agentManifest') return { ok: true, value: { format: 'vitals.tools/1', hash: '0', tools: [] } };
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false, log: (l) => lines.push(l),
    ...(drainMs !== undefined ? { drainMs } : {}),
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: factory },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; origin?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin) headers.origin = init.origin;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
    return { status: r.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };
  const p = await home.persons.add({ label: 'Ana', timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(3), relayUrl: null });
  const device = (await call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code: (await home.devices.issueCode(p.id)).code, label: 'Phone' } })).body.token as string;
  const gauge = (await call('/v1/lumen/pair', { method: 'POST', body: { code: (await home.devices.issueCode(p.id)).code, installationId: INSTALL, deviceName: 'Phone', appVersion: '2.8.7' } })).body.token as string;
  return { c, call, device, gauge, lines };
}

/** An upload whose body arrives in two halves: the request is running (waiting on its body) between them. */
function slowUpload(url: string, token: string) {
  const body = Buffer.from(JSON.stringify({ installationId: INSTALL, events: [hr('2026-11-15T08:00:00Z', 61), hr('2026-11-15T08:01:00Z', 63)] }));
  let req!: ClientRequest;
  const answer = new Promise<{ status: number; text: string }>((resolve, reject) => {
    req = httpRequest(`${url}/v1/lumen/events`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': String(body.length) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
  });
  const half = Math.floor(body.length / 2);
  req.write(body.subarray(0, half));
  return { answer, finish: () => req.end(body.subarray(half)), abort: () => req.destroy() };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('close() (r087 S5)', () => {
  it('lets a running upload finish into an open store before the stores close, and cuts hold-open polls at once', async () => {
    const t = await boot(5000);
    const pulse = (await t.call('/v1/gauge/pulse', { token: t.device })).body.token as string;
    const held = fetch(`${t.c.url}/v1/gauge/pulse?since=${pulse}&wait=25`, { headers: { authorization: `Bearer ${t.device}` } }).then(
      (r) => r.status,
      () => 'cut',
    );
    const upload = slowUpload(t.c.url, t.gauge);
    await settle(100);

    let closed = false;
    const started = Date.now();
    const closing = t.c.close().then(() => (closed = true));
    // the hold-open poll ends straight away (cut, not answered: its store may already be going); the upload keeps the
    // server open
    expect(await held).toBe('cut');
    await settle(200);
    expect(closed).toBe(false);

    upload.finish();
    const answer = await upload.answer;
    expect(answer.status).toBe(200);
    await closing;
    expect(Date.now() - started).toBeLessThan(4000);
    expect(t.lines.filter((l) => l.includes('request failed'))).toEqual([]);
  });

  it('refuses a new request on an open connection while it drains', async () => {
    const t = await boot(5000);
    const body = JSON.stringify({ installationId: INSTALL, events: [hr('2026-11-15T08:00:00Z', 61)] });
    const half = Math.floor(body.length / 2);
    const socket = connect(Number(new URL(t.c.url).port), '127.0.0.1');
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => (raw += d));
    const ended = new Promise<void>((r) => socket.on('close', () => r()));
    await new Promise<void>((r) => socket.once('connect', () => r()));
    socket.write(`POST /v1/lumen/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${t.gauge}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, half)}`);
    await settle(100);

    const closing = t.c.close();
    await settle(50);
    // the rest of the upload, then a second request on the same connection
    socket.write(`${body.slice(half)}GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    await ended;
    await closing;
    const statuses = [...raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
    expect(statuses).toEqual([200, 503]);
    expect(raw).toContain('"error":"shutting_down"');
    expect(t.lines.filter((l) => l.includes('request failed'))).toEqual([]);
  });

  it('answers the app on another origin 503 with CORS headers while it drains, so it reads Retry-After', async () => {
    const t = await boot(5000);
    const body = JSON.stringify({ installationId: INSTALL, events: [hr('2026-11-15T08:00:00Z', 61)] });
    const half = Math.floor(body.length / 2);
    // one open connection per origin, each kept open by an upload still sending its body
    const open = async () => {
      const socket = connect(Number(new URL(t.c.url).port), '127.0.0.1');
      const got = { raw: '' };
      socket.setEncoding('utf8');
      socket.on('data', (d: string) => (got.raw += d));
      const ended = new Promise<void>((r) => socket.on('close', () => r()));
      await new Promise<void>((r) => socket.once('connect', () => r()));
      socket.write(`POST /v1/lumen/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${t.gauge}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, half)}`);
      const next = (origin: string) => socket.write(`${body.slice(half)}GET /v1/gauge/pulse HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${origin}\r\nAuthorization: Bearer ${t.device}\r\n\r\n`);
      return { got, ended, next };
    };
    const app = await open();
    const foreign = await open();
    await settle(100);

    const closing = t.c.close();
    await settle(50);
    app.next(SITE);
    foreign.next('https://evil.example');
    await Promise.all([app.ended, foreign.ended, closing]);

    const refusal = (raw: string) => raw.slice(raw.indexOf('HTTP/1.1 503')).toLowerCase();
    for (const c of [app, foreign]) expect([...c.got.raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]))).toEqual([200, 503]);
    const seen = refusal(app.got.raw);
    expect(seen).toContain(`access-control-allow-origin: ${SITE}`);
    expect(seen).toContain('access-control-expose-headers: retry-after');
    expect(seen).toContain('retry-after: 5');
    expect(seen).toContain('vary: origin');
    expect(seen).toContain('"error":"shutting_down"');
    // an origin the server does not know gets the refusal without them
    expect(refusal(foreign.got.raw)).toContain('"error":"shutting_down"');
    expect(refusal(foreign.got.raw)).not.toContain('access-control-allow-origin');
    expect(t.lines.filter((l) => l.includes('request failed'))).toEqual([]);
  });

  it('stops waiting after drainMs', async () => {
    const t = await boot(300);
    const upload = slowUpload(t.c.url, t.gauge);
    upload.answer.catch(() => undefined);
    await settle(100);
    const started = Date.now();
    await t.c.close();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(3000);
    upload.abort();
  });

  it('cuts a command hold with nothing else running, and the code it resumes still finds its store open', async () => {
    const t = await boot(5000);
    const id = 'cmd-abcdefghijklmnop';
    expect((await t.call('/v1/gauge/commands', { method: 'POST', token: t.device, origin: SITE, body: { id, type: 'hr.measure' } })).status).toBe(201);
    const held = fetch(`${t.c.url}/v1/gauge/commands/${id}?wait=25&since=queued`, { headers: { authorization: `Bearer ${t.device}`, origin: SITE } }).then(
      (r) => r.status,
      () => 'cut',
    );
    await settle(200);
    const started = Date.now();
    await t.c.close();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await held).toBe('cut');
    await settle(100);
    expect(t.lines.filter((l) => l.includes('request failed'))).toEqual([]);
  });

  it('waits for a handler whose client went away before it closes the stores', async () => {
    const t = await boot(5000);
    const persons = t.c.home!.persons;
    const get = persons.get.bind(persons);
    let resumedAt = 0;
    let slow = true;
    vi.spyOn(persons, 'get').mockImplementation(async (id) => {
      if (slow) {
        slow = false;
        await settle(600);
        resumedAt = Date.now();
      }
      return get(id);
    });
    const ac = new AbortController();
    const read = fetch(`${t.c.url}/v1/gauge/availability`, { headers: { authorization: `Bearer ${t.device}`, origin: SITE }, signal: ac.signal }).then(
      (r) => r.status,
      () => 'aborted',
    );
    await settle(100);
    ac.abort();
    expect(await read).toBe('aborted');
    await settle(100);
    await t.c.close();
    expect(resumedAt).toBeGreaterThan(0);
    expect(Date.now()).toBeGreaterThanOrEqual(resumedAt);
    expect(t.lines.filter((l) => l.includes('request failed'))).toEqual([]);
  });

  it("does not wait on an idle MCP client's event stream", async () => {
    const t = await boot(5000);
    const agent = (await t.call('/v1/agents/tokens', { method: 'POST', token: t.device, origin: SITE, body: { client: 'claude', scope: 'read' } })).body.token as string;
    const client = new Client({ name: 'shutdown-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${t.c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agent}` } } }));
    cleanup.push(() => client.close().catch(() => undefined));
    // the client opens its standalone GET stream once the session starts
    await settle(300);
    const started = Date.now();
    await t.c.close();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('closes at once when nothing is running', async () => {
    const t = await boot(5000);
    const started = Date.now();
    await t.c.close();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('/health (r087 S5)', () => {
  it('answers without waiting on slow counts, with the last known ones', async () => {
    const t = await boot();
    const first = await t.call('/health');
    expect(first.body).toMatchObject({ role: 'home', persons: 1, ownerCount: 0 });
    vi.spyOn(t.c.home!, 'health').mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    const second = await t.call('/health');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ role: 'home', persons: 1, ownerCount: 0 });
    expect(second.body.eventLoop).toBeTruthy();
  });

  it('still answers 200 when the counts fail', async () => {
    const t = await boot();
    vi.spyOn(t.c.home!, 'health').mockRejectedValue(new Error('index unreadable'));
    const r = await t.call('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: 'home', persons: null, ownerCount: null });
  });
});
