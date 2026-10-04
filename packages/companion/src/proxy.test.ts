// @vitest-environment node
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { writeJsonSecret } from './config.ts';
import { finalResponseOf, rewriteSiwcBody, siwcLimitBody, siwcModelsBody, SIWC_NAMESPACE_DESCRIPTION, SIWC_USAGE_LIMIT_CODE, UPSTREAMS, type Upstream } from './proxy.ts';
import { startCompanion, type Companion } from './server.ts';
import { rawCall, sleep, startFakeServer, tempDir, type FakeServer, type Reply } from './testHelpers.ts';

const APP = 'https://vitals.creative.desi';
const NIM_KEY = 'nvapi-COMPANIONKEY-0123456789';
const ZEN_KEY = 'zen-ENVKEY-abcdef0123';
const ACCESS_OLD = 'at-OLD-secret-access-0001';
const REFRESH_OLD = 'rt-OLD-secret-refresh-0001';
const ACCESS_NEW = 'at-NEW-secret-access-0002';
const REFRESH_NEW = 'rt-NEW-secret-refresh-0002';
const PAGE_SECRET = 'page-sent-credential-xyz';

let tmp: ReturnType<typeof tempDir>;
let upstream: FakeServer;
let authServer: FakeServer;
let companion: Companion;
let configDir: string;
let token: string;
const logLines: string[] = [];
const printLines: string[] = [];
const responses: Reply[] = [];

const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: string) => {
  const r = await rawCall(companion.port, method, path, headers, body);
  responses.push(r);
  return r;
};
const authed = (extra: Record<string, string> = {}) => ({ Origin: APP, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra });

const upstreams = (base: string): Record<string, Upstream> => ({
  nim: { ...UPSTREAMS.nim!, baseUrl: `${base}/nim/v1` },
  'opencode-zen': { ...UPSTREAMS['opencode-zen']!, baseUrl: `${base}/zen/v1` },
  siwc: { ...UPSTREAMS.siwc!, baseUrl: `${base}/openai/v1` },
});

let refreshCalls = 0;

beforeAll(async () => {
  tmp = tempDir();
  configDir = join(tmp.dir, 'config');
  upstream = await startFakeServer();
  authServer = await startFakeServer(async (req, res) => {
    if (req.url === '/token') {
      refreshCalls++;
      await sleep(50);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: ACCESS_NEW, refresh_token: REFRESH_NEW, expires_in: 3600 }));
      return;
    }
    res.writeHead(200).end();
  });
  companion = await startCompanion({
    port: 0,
    allowedOrigins: [],
    relay: false,
    agent: true,
    configDir,
    upstreams: upstreams(upstream.url),
    siwcEndpoints: { token: `${authServer.url}/token`, revoke: `${authServer.url}/revoke` },
    env: { OPENCODE_API_KEY: ZEN_KEY },
    rateLimit: { capacity: 1000, perMinute: 6000 },
    proxyMaxBodyBytes: 64 * 1024,
    log: (l) => logLines.push(l),
    print: (l) => printLines.push(l),
  });
  await writeJsonSecret(join(configDir, 'keys.json'), { nim: NIM_KEY });
  const pair = await rawCall(companion.port, 'POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: companion.pairingCode!.code }));
  token = pair.json().token as string;
});

afterAll(async () => {
  await companion.close();
  await upstream.close();
  await authServer.close();
  tmp.cleanup();
});

beforeEach(() => {
  upstream.requests.length = 0;
  upstream.handler = (_r, res) => void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
});

describe('proxy forwarding', () => {
  it('forwards with the Companion key, strips the page Authorization, cookies and other headers', async () => {
    upstream.handler = (_r, res) =>
      void res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=upstream-cookie; HttpOnly', 'X-Request-Id': 'req_1' }).end('{"id":"chatcmpl-1"}');
    const res = await call('POST', '/proxy/nim/chat/completions', authed({ Cookie: `vitals=${PAGE_SECRET}`, 'X-Api-Key': PAGE_SECRET, 'X-Custom': 'drop-me' }), '{"model":"m","messages":[]}');
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"id":"chatcmpl-1"}');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-request-id']).toBe('req_1');
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    const got = upstream.requests[0]!;
    expect(got.url).toBe('/nim/v1/chat/completions');
    expect(got.headers.authorization).toBe(`Bearer ${NIM_KEY}`);
    expect(got.headers.cookie).toBeUndefined();
    expect(got.headers['x-api-key']).toBeUndefined();
    expect(got.headers['x-custom']).toBeUndefined();
    expect(got.headers.origin).toBeUndefined();
    expect(JSON.stringify(got.headers)).not.toContain(token);
    expect(got.body).toBe('{"model":"m","messages":[]}');
  });

  it('uses the environment key for OpenCode Zen and the /v1/ai alias; GET models', async () => {
    const res = await call('GET', '/v1/ai/opencode-zen/models', authed());
    expect(res.status).toBe(200);
    expect(upstream.requests[0]).toMatchObject({ method: 'GET', url: '/zen/v1/models' });
    expect(upstream.requests[0]!.headers.authorization).toBe(`Bearer ${ZEN_KEY}`);
  });

  it('streams SSE chunk by chunk with text/event-stream', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    upstream.handler = async (_r, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"n":1}\n\n');
      await gate;
      res.write('data: {"n":2}\n\n');
      res.end('data: [DONE]\n\n');
    };
    const chunks: string[] = [];
    const headers = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: companion.port, method: 'POST', path: '/proxy/nim/chat/completions', headers: authed() }, (res) => {
        res.on('data', (c: Buffer) => {
          chunks.push(c.toString());
          if (chunks.length === 1) release();
        });
        res.on('end', () => resolve(res.headers));
      });
      req.on('error', reject);
      req.end('{"stream":true}');
    });
    expect(headers['content-type']).toBe('text/event-stream');
    // The first event arrived before the upstream sent the second (released only once chunk 1 was received).
    expect(chunks[0]).toBe('data: {"n":1}\n\n');
    expect(chunks.join('')).toBe('data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n');
  });

  it('aborts the upstream when the client disconnects', async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((r) => (upstreamClosed = r));
    upstream.handler = (_r, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: 1\n\n');
      res.on('close', () => upstreamClosed());
    };
    await new Promise<void>((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: companion.port, method: 'POST', path: '/proxy/nim/chat/completions', headers: authed() }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => undefined);
      req.end('{}');
    });
    await closed;
  });

  it('404 for unknown presets or paths, 405 for wrong methods, 413 over the body limit', async () => {
    expect((await call('POST', '/proxy/openai/chat/completions', authed(), '{}')).status).toBe(404);
    expect((await call('POST', '/proxy/nim/embeddings', authed(), '{}')).status).toBe(404);
    expect((await call('POST', '/proxy/siwc/chat/completions', authed(), '{}')).status).toBe(404);
    expect((await call('GET', '/proxy/nim/chat/completions', authed())).status).toBe(405);
    expect((await call('POST', '/proxy/nim/chat/completions', authed(), 'x'.repeat(64 * 1024 + 1))).status).toBe(413);
    expect(upstream.requests).toHaveLength(0);
  });

  it('rate limits per token (429 + Retry-After)', async () => {
    const small = await startCompanion({ port: 0, allowedOrigins: [], relay: false, agent: true, configDir: join(tmp.dir, 'rl'), upstreams: upstreams(upstream.url), env: { NVIDIA_API_KEY: NIM_KEY }, rateLimit: { capacity: 3, perMinute: 1 } });
    try {
      const pair = await rawCall(small.port, 'POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: small.pairingCode!.code }));
      const h = { Origin: APP, Authorization: `Bearer ${pair.json().token as string}` };
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await rawCall(small.port, 'GET', '/proxy/nim/models', h)).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      const limited = await rawCall(small.port, 'GET', '/proxy/nim/models', h);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['access-control-expose-headers']).toContain('Retry-After');
    } finally {
      await small.close();
    }
  });

  it('answers 503 key_missing when no key is configured', async () => {
    const bare = await startCompanion({ port: 0, allowedOrigins: [], relay: false, agent: true, configDir: join(tmp.dir, 'bare'), upstreams: upstreams(upstream.url), env: {} });
    try {
      const pair = await rawCall(bare.port, 'POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: bare.pairingCode!.code }));
      const res = await rawCall(bare.port, 'GET', '/proxy/nim/models', { Origin: APP, Authorization: `Bearer ${pair.json().token as string}` });
      expect(res.status).toBe(503);
      expect(res.json().error).toBe('key_missing');
      // OpenCode Zen's model catalogue is public: forwarded without a key so the picker can list models before one is set
      const zen = await rawCall(bare.port, 'GET', '/proxy/opencode-zen/models', { Origin: APP, Authorization: `Bearer ${pair.json().token as string}` });
      expect(zen.status).toBe(200);
      const zenChat = await rawCall(bare.port, 'POST', '/proxy/opencode-zen/chat/completions', { Origin: APP, Authorization: `Bearer ${pair.json().token as string}`, 'Content-Type': 'application/json' }, '{}');
      expect(zenChat.json().error).toBe('key_missing');
      const siwc = await rawCall(bare.port, 'POST', '/proxy/siwc/responses', { Origin: APP, Authorization: `Bearer ${pair.json().token as string}` }, '{}');
      expect(siwc.status).toBe(401);
      expect(siwc.json().error).toBe('siwc_signed_out');
    } finally {
      await bare.close();
    }
  });
});

describe('siwc rewriting', () => {
  it('forces store:false, strips unsupported params, moves system items to instructions, namespaces tools', () => {
    const out = rewriteSiwcBody({
      model: 'gpt-6.1-sol',
      store: true,
      stream: true,
      temperature: 0.2,
      top_p: 1,
      previous_response_id: 'resp_1',
      max_output_tokens: 100,
      metadata: { a: 1 },
      user: 'u',
      service_tier: 'flex',
      instructions: 'Base.',
      input: [
        { role: 'system', content: 'Be brief.' },
        { role: 'system', content: [{ type: 'input_text', text: 'Use kg.' }] },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        { type: 'function', name: 'log_get', parameters: {} },
        { type: 'function', name: 'today_get', parameters: {} },
      ],
    });
    expect(out).toEqual({
      model: 'gpt-6.1-sol',
      store: false,
      stream: true,
      instructions: 'Base.\n\nBe brief.\n\nUse kg.',
      input: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'namespace', name: 'vitals', description: SIWC_NAMESPACE_DESCRIPTION, tools: [{ type: 'function', name: 'log_get', parameters: {} }, { type: 'function', name: 'today_get', parameters: {} }] }],
    });
    const already = [{ type: 'namespace', name: 'vitals', description: 'mine', tools: [{ type: 'function', name: 'x' }] }];
    expect(rewriteSiwcBody({ tools: already }).tools).toEqual(already);
    // a namespace the app built itself (quirk toolNamespace) gets the description too
    expect(rewriteSiwcBody({ tools: [{ type: 'namespace', name: 'vitals', tools: [] }] }).tools).toEqual([{ type: 'namespace', name: 'vitals', tools: [], description: SIWC_NAMESPACE_DESCRIPTION }]);
    // a non-streaming caller: the proxy streams upstream anyway (the backend refuses stream:false) and collapses later
    expect(rewriteSiwcBody({ model: 'm', input: 'hi' })).toEqual({ model: 'm', input: 'hi', store: false, stream: true });
  });

  it('translates the ChatGPT-plan model list into the OpenAI shape', () => {
    const body = siwcModelsBody(JSON.stringify({ models: [{ slug: 'gpt-5.6-sol', tool_mode: 'code_mode_only', input_modalities: ['text', 'image'] }, { slug: 'gpt-5.5' }, { nope: true }] }));
    expect(body.data.map((m) => m.id)).toEqual(['gpt-5.6-sol', 'gpt-5.5']);
    expect(body.data[0]).toMatchObject({ id: 'gpt-5.6-sol', object: 'model', tool_mode: 'code_mode_only' });
    expect(siwcModelsBody(JSON.stringify({ object: 'list', data: [{ id: 'x' }] })).data).toEqual([{ id: 'x', object: 'model' }]);
    expect(siwcModelsBody('nope').data).toEqual([]);
  });

  it('collapses a Responses SSE stream into its final object for a non-streaming caller', () => {
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"get_weather","namespace":"vitals","arguments":"{}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[{"type":"function_call","name":"get_weather","arguments":"{}"}]}}',
      '',
    ].join('\n');
    expect(finalResponseOf(sse)).toEqual({ status: 200, body: { id: 'r1', status: 'completed', output: [{ type: 'function_call', name: 'get_weather', arguments: '{}' }] } });
    expect(finalResponseOf('data: {"type":"error","status":400,"error":{"message":"bad"}}\n')).toEqual({ status: 400, body: { message: 'bad' } });
    expect(finalResponseOf('data: {"type":"response.created"}\n')).toBeNull();
  });
});

describe('siwc proxy with token refresh', () => {
  it('refreshes before expiry once for concurrent requests, persists the rotated token, rewrites the body', async () => {
    await writeJsonSecret(join(configDir, 'siwc.json'), { accessToken: ACCESS_OLD, refreshToken: REFRESH_OLD, expiresAt: Date.now() + 30_000, clientId: 'oaiapp_test' });
    refreshCalls = 0;
    const body = JSON.stringify({ model: 'gpt-6.1-sol', temperature: 1, input: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], tools: [{ type: 'function', name: 'log_get' }] });
    const [a, b] = await Promise.all([call('POST', '/v1/ai/siwc/responses', authed(), body), call('POST', '/proxy/siwc/responses', authed(), body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(refreshCalls).toBe(1);
    const tokenReq = authServer.requests.find((r) => r.url === '/token')!;
    expect(Object.fromEntries(new URLSearchParams(tokenReq.body))).toEqual({ grant_type: 'refresh_token', refresh_token: REFRESH_OLD, client_id: 'oaiapp_test' });
    for (const r of upstream.requests) {
      expect(r.url).toBe('/openai/v1/responses');
      expect(r.headers.authorization).toBe(`Bearer ${ACCESS_NEW}`);
      expect(JSON.parse(r.body)).toEqual({
        model: 'gpt-6.1-sol',
        store: false,
        stream: true,
        instructions: 'S',
        input: [{ role: 'user', content: 'U' }],
        tools: [{ type: 'namespace', name: 'vitals', description: SIWC_NAMESPACE_DESCRIPTION, tools: [{ type: 'function', name: 'log_get' }] }],
      });
    }
    const saved = JSON.parse(readFileSync(join(configDir, 'siwc.json'), 'utf8')) as { accessToken: string; refreshToken: string };
    expect(saved).toMatchObject({ accessToken: ACCESS_NEW, refreshToken: REFRESH_NEW });
    // No second refresh while the new token is fresh.
    expect((await call('GET', '/proxy/siwc/models', authed())).status).toBe(200);
    expect(refreshCalls).toBe(1);
    const status = await call('GET', '/v1/ai/siwc/status', authed());
    expect(Object.keys(status.json()).sort()).toEqual(['expiresAt', 'signedIn']);
  });

  it('streams upstream for a non-streaming caller and hands back the final response as JSON; translates the model list', async () => {
    await writeJsonSecret(join(configDir, 'siwc.json'), { accessToken: ACCESS_NEW, refreshToken: REFRESH_NEW, expiresAt: Date.now() + 3_600_000, clientId: 'oaiapp_test' });
    const prev = upstream.handler;
    upstream.handler = (r, res) => {
      if (r.url.endsWith('/openai/v1/models')) return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ models: [{ slug: 'gpt-5.6-sol', tool_mode: 'code_mode_only' }, { slug: 'gpt-5.5' }] }));
      if (r.url.endsWith('/openai/v1/responses')) {
        const sent = JSON.parse(r.body) as { stream?: boolean };
        if (sent.stream !== true) return void res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"detail":"Stream must be set to true"}');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: response.created\ndata: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\n\n');
        res.write('event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}]}}\n\n');
        return void res.end();
      }
      return prev(r, res);
    };
    try {
      const plain = await call('POST', '/proxy/siwc/responses', authed(), JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi' }));
      expect(plain.status).toBe(200);
      expect(plain.headers['content-type']).toContain('application/json');
      expect(plain.json()).toMatchObject({ id: 'r1', status: 'completed' });
      const streamed = await call('POST', '/proxy/siwc/responses', authed(), JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi', stream: true }));
      expect(streamed.status).toBe(200);
      expect(streamed.headers['content-type']).toContain('text/event-stream');
      expect(streamed.text).toContain('response.completed');
      const models = await call('GET', '/proxy/siwc/models', authed());
      expect(models.json()).toEqual({ object: 'list', data: [{ id: 'gpt-5.6-sol', slug: 'gpt-5.6-sol', tool_mode: 'code_mode_only', object: 'model' }, { id: 'gpt-5.5', slug: 'gpt-5.5', object: 'model' }] });
    } finally {
      upstream.handler = prev;
    }
  });

  it('never leaks provider keys, OAuth tokens, pairing tokens or codes into logs or browser responses', async () => {
    const admin = readFileSync(join(configDir, 'admin.token'), 'utf8').trim();
    const secrets = [NIM_KEY, ZEN_KEY, ACCESS_OLD, REFRESH_OLD, ACCESS_NEW, REFRESH_NEW, admin, PAGE_SECRET];
    // A pairing that fails and one more admin-minted code, so codes have passed through the logger too.
    await call('POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: '12345678' }));
    const code = (await rawCall(companion.port, 'POST', '/v1/pair/code', { Authorization: `Bearer ${admin}` })).json().code as string;
    const paired = await rawCall(companion.port, 'POST', '/v1/pair/local', { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, JSON.stringify({ code }));
    const token2 = paired.json().token as string;
    await call('GET', '/v1/pair/status', { Origin: 'http://localhost:5173', Authorization: `Bearer ${token2}` });
    expect(logLines.length).toBeGreaterThan(3);
    const logged = [...logLines, ...printLines].join('\n');
    for (const s of [...secrets, token, token2, code, companion.pairingCode!.code]) expect(logged).not.toContain(s);
    const browser = responses.map((r) => `${JSON.stringify(r.headers)}\n${r.text}`).join('\n');
    for (const s of secrets) expect(browser).not.toContain(s);
  });
});

describe('siwc usage limit (429)', () => {
  it('turns the plan-limit code into an actionable message and keeps the code', () => {
    const body = siwcLimitBody(JSON.stringify({ error: { code: SIWC_USAGE_LIMIT_CODE, message: 'x' } }));
    expect(body.error.code).toBe(SIWC_USAGE_LIMIT_CODE);
    expect(body.error.message).toContain('https://chatgpt.com/settings/usage');
    expect(siwcLimitBody('not json').error).toMatchObject({ code: 'rate_limit_exceeded', type: 'rate_limit' });
    expect(siwcLimitBody(`oops ${SIWC_USAGE_LIMIT_CODE}`).error.code).toBe(SIWC_USAGE_LIMIT_CODE);
  });
});
