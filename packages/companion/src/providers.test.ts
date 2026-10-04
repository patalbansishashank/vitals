// @vitest-environment node
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORBIDDEN } from '../../../src/content/evidence/__tests__/leakScan.ts';
import { createFileResolver, createFileTokenStore, createPersonDir, credentialsDir, personDir, type PersonDispatch, type TokenStore } from './personContext.ts';
import { AI_ERROR_MESSAGES, AI_ERROR_STATUS, mapUpstreamError } from './providers.ts';
import { UPSTREAMS, type Upstream } from './proxy.ts';
import { startAiServer } from './serverAi.ts';
import { rawCall, sleep, startFakeServer, tempDir, type FakeServer } from './testHelpers.ts';

const KEY_A = 'nvapi-PERSON-A-key-0123456789';
const KEY_B = 'nvapi-PERSON-B-key-9876543210';
const ACCESS_A = 'at-person-A-access-000001';
const REFRESH_A = 'rt-person-A-refresh-000001';

const noDispatch: PersonDispatch = {
  manifest: async () => ({ format: 'vitals.tools/1', hash: 'x', tools: [] }),
  dispatch: async () => ({ ok: false, status: 'rejected', summary: 'no' }),
};

let tmp: ReturnType<typeof tempDir>;
let dataDir: string;
let tokens: TokenStore;
let upstream: FakeServer;
let auth: FakeServer;
let server: Awaited<ReturnType<typeof startAiServer>>;
let A: string, B: string, tokA: string, tokB: string, agentA: string;
const logLines: string[] = [];

const upstreams = (base: string): Record<string, Upstream> => ({
  nim: { ...UPSTREAMS.nim!, baseUrl: `${base}/nim/v1` },
  'opencode-zen': { ...UPSTREAMS['opencode-zen']!, baseUrl: `${base}/zen/v1` },
  siwc: { ...UPSTREAMS.siwc!, baseUrl: `${base}/openai/v1` },
});
const call = (method: string, path: string, token?: string, body?: unknown) =>
  rawCall(server.port, method, path, { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body === undefined ? undefined : JSON.stringify(body));

beforeAll(async () => {
  tmp = tempDir('vitals-e26-providers-');
  dataDir = join(tmp.dir, 'data');
  A = await createPersonDir(dataDir, 'Person A', 'Asia/Kolkata');
  B = await createPersonDir(dataDir, 'Person B', 'America/New_York');
  tokens = createFileTokenStore(dataDir);
  tokA = (await tokens.mint(A, { kind: 'device', label: 'Browser', scope: 'full' })).token;
  tokB = (await tokens.mint(B, { kind: 'device', label: 'Phone', scope: 'full' })).token;
  agentA = (await tokens.mint(A, { kind: 'agent', label: 'Codex', scope: 'log', client: 'codex' })).token;
  upstream = await startFakeServer((req, res) => {
    if (req.url.endsWith('/models')) return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }));
    if (req.url.startsWith('/nim/v1/chat/completions')) {
      const body = JSON.parse(req.body) as { model?: string; stream?: boolean };
      if (body.model === 'fail-400') return void res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'model_not_found', message: 'secret upstream text' } }));
      if (body.model === 'fail-429') return void res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' }).end('{}');
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
        void sleep(30).then(() => {
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`);
          res.end();
        });
        return;
      }
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    }
    if (req.url.startsWith('/openai/v1/responses')) {
      if (req.headers.authorization !== `Bearer ${ACCESS_A}`) return void res.writeHead(401).end('{}');
      const usageLimit = (JSON.parse(req.body) as { model?: string }).model === 'limit';
      if (usageLimit) return void res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 40, output_tokens: 4 } } })}\n\n`);
      return;
    }
    res.writeHead(404).end();
  });
  auth = await startFakeServer((_req, res) => void res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"invalid_grant"}'));
  server = await startAiServer({
    resolvePerson: createFileResolver({ dataDir, tokens, dispatchFor: () => noDispatch }),
    tokens,
    upstreams: upstreams(upstream.url),
    siwcEndpoints: { token: `${auth.url}/token`, revoke: `${auth.url}/revoke` },
    aiRequestsPerMinute: 600,
    log: (l) => logLines.push(l),
  });
});

afterAll(async () => {
  await server?.close();
  await upstream?.close();
  await auth?.close();
  tmp?.cleanup();
});

describe('providers through the server, per person', () => {
  it('keys are written per person (0600, never returned) and each request uses only its own person key', async () => {
    expect((await call('PUT', '/v1/ai/keys/nim', tokA, { key: KEY_A })).status).toBe(204);
    expect((await call('PUT', '/v1/ai/keys/nim', tokB, { key: KEY_B })).status).toBe(204);
    const fileA = join(credentialsDir(dataDir, A), 'providers.json');
    expect(statSync(fileA).mode & 0o777).toBe(0o600);
    expect(statSync(credentialsDir(dataDir, A)).mode & 0o777).toBe(0o700);
    expect(readFileSync(fileA, 'utf8')).toContain(KEY_A);
    expect(readFileSync(fileA, 'utf8')).not.toContain(KEY_B);

    const st = await call('GET', '/v1/ai/status', tokA);
    expect(st.status).toBe(200);
    expect(st.text).not.toContain(KEY_A);
    const presets = (st.json().presets as Array<{ id: string; ready: boolean }>).reduce<Record<string, boolean>>((o, p) => ({ ...o, [p.id]: p.ready }), {});
    expect(presets).toEqual({ siwc: false, nim: true, 'opencode-zen': false });

    upstream.requests.length = 0;
    for (const [tok, key] of [
      [tokA, KEY_A],
      [tokB, KEY_B],
      [tokA, KEY_A],
    ] as const) {
      const r = await call('POST', '/v1/ai/nim/chat/completions', tok, { model: 'm1', messages: [{ role: 'user', content: 'private words' }] });
      expect(r.status).toBe(200);
      expect(upstream.requests.at(-1)!.headers.authorization).toBe(`Bearer ${key}`);
    }
    // the device token never goes upstream
    expect(upstream.requests.some((q) => JSON.stringify(q.headers).includes(tokA) || JSON.stringify(q.headers).includes(tokB))).toBe(false);
  });

  it('a person id in the query or body is ignored; a token in the query is not accepted', async () => {
    upstream.requests.length = 0;
    const r = await call('POST', `/v1/ai/nim/chat/completions?person=${B}`, tokA, { model: 'm1', person: B, messages: [] });
    expect(r.status).toBe(200);
    expect(upstream.requests.at(-1)!.headers.authorization).toBe(`Bearer ${KEY_A}`);
    const q = await call('GET', `/v1/ai/status?token=${tokA}`);
    expect(q.status).toBe(401);
    expect(q.json()).toEqual({ error: { code: 'unauthorized', message: AI_ERROR_MESSAGES.unauthorized } });
  });

  it('streams SSE through unchanged and logs usage per person (no prompt text)', async () => {
    const r = await call('POST', '/v1/ai/nim/chat/completions', tokA, { model: 'm-stream', stream: true, messages: [{ role: 'user', content: 'very private prompt' }] });
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/event-stream');
    expect(r.headers['x-accel-buffering']).toBe('no');
    expect(r.text).toContain('"Hel"');
    expect(r.text).toContain('[DONE]');
    await sleep(20);
    const file = join(personDir(dataDir, A), 'usage.jsonl');
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain('private');
    expect(lines.at(-1)).toMatchObject({ preset: 'nim', model: 'm-stream', inputTokens: 12, outputTokens: 3, status: 200 });
    const usageA = (await call('GET', '/v1/ai/usage', tokA)).json() as { today: { requests: number; inputTokens: number } };
    const usageB = (await call('GET', '/v1/ai/usage', tokB)).json() as { today: { requests: number } };
    expect(usageA.today.requests).toBe(lines.length);
    expect(usageA.today.requests).toBeGreaterThanOrEqual(4);
    expect(usageB.today.requests).toBe(1);
  });

  it('answers with the plain-words error contract', async () => {
    await call('PUT', '/v1/ai/keys/opencode-zen', tokB, { key: 'zen-key-B-000000' });
    const noKey = await call('POST', '/v1/ai/opencode-zen/chat/completions', tokA, { model: 'x', messages: [] });
    expect(noKey.status).toBe(409);
    expect(noKey.json()).toEqual({ error: { code: 'no_key', message: AI_ERROR_MESSAGES.no_key } });

    const signedOut = await call('POST', '/v1/ai/siwc/responses', tokA, { model: 'gpt', input: [] });
    expect(signedOut.status).toBe(409);
    expect((signedOut.json().error as { code: string }).code).toBe('not_signed_in');

    const bad = await call('POST', '/v1/ai/nim/chat/completions', tokA, { model: 'fail-400', messages: [] });
    expect(bad.status).toBe(502);
    expect(bad.json()).toEqual({ error: { code: 'upstream_error', message: AI_ERROR_MESSAGES.upstream_error, detail: { status: 400, upstreamCode: 'model_not_found' } } });
    expect(bad.text).not.toContain('secret upstream text');

    const limited = await call('POST', '/v1/ai/nim/chat/completions', tokA, { model: 'fail-429', messages: [] });
    expect(limited.status).toBe(429);
    expect((limited.json().error as { code: string }).code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBe('7');

    const agent = await call('GET', '/v1/ai/status', agentA);
    expect(agent.status).toBe(403);
    expect((agent.json().error as { code: string }).code).toBe('wrong_kind');

    const unknown = await call('POST', '/v1/ai/openai/chat/completions', tokA, {});
    expect(unknown.status).toBe(404);
    const login = await call('POST', '/v1/ai/siwc/login', tokA, {});
    expect(login.status).toBe(409);
  });

  it('every message is plain words: no internal names, no technical words (§14.3 scan)', () => {
    for (const [code, message] of Object.entries(AI_ERROR_MESSAGES)) {
      for (const [re, name] of FORBIDDEN) expect(re.test(message), `${code}: ${name}`).toBe(false);
      expect(message, code).not.toMatch(/Companion|proxy|preset|token|MCP|\/v1\/|\.json|vitals-/i);
      expect(AI_ERROR_STATUS[code as keyof typeof AI_ERROR_STATUS]).toBeGreaterThanOrEqual(400);
    }
    expect(mapUpstreamError('siwc', 429, JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }))).toMatchObject({ status: 429, body: { error: { code: 'usage_limit' } } });
    expect(mapUpstreamError('nim', 503, 'oops')).toMatchObject({ status: 502, body: { error: { code: 'upstream_error', detail: { status: 503 } } } });
    expect(mapUpstreamError('nim', 504, '')).toMatchObject({ status: 504, body: { error: { code: 'upstream_timeout' } } });
  });

  it('Sign in with ChatGPT is per person: status, use, usage limit, logout', async () => {
    const cred = credentialsDir(dataDir, A);
    writeFileSync(join(cred, 'siwc.json'), JSON.stringify({ accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt: Date.now() + 3_600_000, clientId: 'oaiapp_testA' }), { mode: 0o600 });
    expect((await call('GET', '/v1/ai/siwc/status', tokA)).json()).toMatchObject({ signedIn: true });
    expect((await call('GET', '/v1/ai/siwc/status', tokB)).json()).toEqual({ signedIn: false });
    const ok = await call('POST', '/v1/ai/siwc/responses', tokA, { model: 'gpt-5', input: [{ role: 'user', content: 'hi' }] });
    expect(ok.status).toBe(200);
    expect(upstream.requests.at(-1)!.headers.authorization).toBe(`Bearer ${ACCESS_A}`);
    const notB = await call('POST', '/v1/ai/siwc/responses', tokB, { model: 'gpt-5', input: [] });
    expect(notB.status).toBe(409);
    const limit = await call('POST', '/v1/ai/siwc/responses', tokA, { model: 'limit', input: [] });
    expect(limit.status).toBe(429);
    expect(limit.json()).toEqual({ error: { code: 'usage_limit', message: AI_ERROR_MESSAGES.usage_limit, detail: { status: 429, upstreamCode: 'subscription_sharing_usage_limit_exceeded' } } });
    const probe = await call('GET', '/v1/ai/siwc/probe', tokA);
    expect(probe.json()).toEqual({ ready: true, models: 2 });
    expect((await call('GET', '/v1/ai/nim/probe', tokA)).json()).toEqual({ ready: true, models: 2 });
    expect((await call('GET', '/v1/ai/opencode-zen/probe', tokA)).json()).toMatchObject({ ready: false, error: { code: 'no_key' } });
    expect((await call('POST', '/v1/ai/siwc/logout', tokA)).status).toBe(204);
    expect((await call('GET', '/v1/ai/siwc/status', tokA)).json()).toEqual({ signedIn: false });
    expect(logLines.join('\n')).not.toContain(ACCESS_A);
    expect(logLines.join('\n')).not.toContain(KEY_A);
  });

  it('removes a key; revoked and unknown tokens get 401 with the exact words', async () => {
    expect((await call('DELETE', '/v1/ai/keys/nim', tokB)).status).toBe(204);
    expect(readFileSync(join(credentialsDir(dataDir, A), 'providers.json'), 'utf8')).toContain(KEY_A);
    expect(readFileSync(join(credentialsDir(dataDir, B), 'providers.json'), 'utf8')).not.toContain(KEY_B);
    const rec = (await tokens.list(B, 'device'))[0]!;
    await tokens.revoke(B, rec.id);
    const r = await call('GET', '/v1/ai/status', tokB);
    expect(r.status).toBe(401);
    expect(r.json()).toEqual({ error: { code: 'revoked', message: AI_ERROR_MESSAGES.revoked } });
    expect((await call('GET', '/v1/ai/status', 'not-a-real-token-000')).json()).toEqual({ error: { code: 'unauthorized', message: AI_ERROR_MESSAGES.unauthorized } });
  });
});

describe('limits per person', () => {
  it('per-minute limit and daily cap answer 429 with their own codes', async () => {
    const t = tempDir('vitals-e26-limits-');
    const dd = join(t.dir, 'data');
    const P = await createPersonDir(dd, 'P', 'UTC');
    const store = createFileTokenStore(dd);
    const tok = (await store.mint(P, { kind: 'device', label: 'b', scope: 'full' })).token;
    const s = await startAiServer({
      resolvePerson: createFileResolver({ dataDir: dd, tokens: store, dispatchFor: () => noDispatch }),
      tokens: store,
      upstreams: upstreams(upstream.url),
      aiRequestsPerMinute: 600,
      requestsPerDay: 2,
    });
    try {
      const c = (m: string, p: string, b?: unknown) => rawCall(s.port, m, p, { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, b === undefined ? undefined : JSON.stringify(b));
      await c('PUT', '/v1/ai/keys/nim', { key: 'nvapi-limit-test-000' });
      expect((await c('POST', '/v1/ai/nim/chat/completions', { model: 'a', messages: [] })).status).toBe(200);
      expect((await c('POST', '/v1/ai/nim/chat/completions', { model: 'a', messages: [] })).status).toBe(200);
      await sleep(20);
      const capped = await c('POST', '/v1/ai/nim/chat/completions', { model: 'a', messages: [] });
      expect(capped.status).toBe(429);
      expect((capped.json().error as { code: string }).code).toBe('daily_cap');
      expect((await c('GET', '/v1/ai/usage')).json()).toEqual({ today: { requests: 2, inputTokens: 10, outputTokens: 4 }, cap: { requestsPerDay: 2 } });
    } finally {
      await s.close();
    }
    const s2 = await startAiServer({
      resolvePerson: createFileResolver({ dataDir: dd, tokens: store, dispatchFor: () => noDispatch }),
      tokens: store,
      upstreams: upstreams(upstream.url),
      aiRequestsPerMinute: 2,
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await rawCall(s2.port, 'GET', '/v1/ai/nim/models', { Authorization: `Bearer ${tok}` })).status);
      expect(statuses.slice(0, 2)).toEqual([200, 200]);
      expect(statuses).toContain(429);
    } finally {
      await s2.close();
      t.cleanup();
    }
  });
});
