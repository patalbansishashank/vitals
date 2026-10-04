/**
 * SUITE_SPEC §14.9 "Coach through the server" (E26), the server half of "Website through the server, Coach with
 * tools": a typed message → the model's reply with a tool call → a document change, end to end through the server's
 * provider routes (§14.3), with a scripted OpenAI-compatible stand-in upstream.
 *
 * Server side: the real `startAiServer` over the file token store and resolver (two persons on one server), with the
 * `nim` upstream pointed at the stand-in. Client side: the app's real pieces — `createChatModel` aimed at
 * `${server}/v1/ai/nim` with the device token as the bearer (as the browser sends it), and the Coach adapter
 * (`createCoachAdapter(...).send`) over the REAL command bus and an in-memory document store.
 *
 * Proves: the reply streams back; the tool call runs through the bus and the day's steps are in the log; the stand-in
 * sees only the person's own provider key, never the device token, never the other person's key; usage is counted per
 * person (`GET /v1/ai/usage`, `usage.jsonl` 0600 without prompt text); no token → 401 `unauthorized`, a revoked token
 * → 401 `revoked`, both with the exact §14.3 wording; SSE is passed through chunk by chunk (no buffering).
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { createChatModel, getPreset, presetCapabilities } from '../providers';
import { createCoachAdapter } from '../coach/adapter';
import { appBus } from '../coach/runtime';
import type { StreamEventView } from '../coach/types';
import { startAiServer } from '../../../packages/companion/src/serverAi.ts';
import { AI_ERROR_MESSAGES } from '../../../packages/companion/src/providers.ts';
import { createFileResolver, createFileTokenStore, createPersonDir, personDir, type PersonDispatch, type TokenStore } from '../../../packages/companion/src/personContext.ts';
import { UPSTREAMS } from '../../../packages/companion/src/proxy.ts';

const DAY = '2026-10-01';
const STEPS = 12_345;
const PROMPT = 'I walked 12345 steps today, please log them';
const REPLY = 'Logged 12,345 steps for today.';
const KEY_A = 'nvapi-test-A-0123456789abcdef';
const KEY_B = 'nvapi-test-B-fedcba9876543210';

/* ------------------------------------------------------------------------------------------------ stand-in upstream */

interface Seen {
  path: string;
  authorization: string | undefined;
  body: string;
}

const chunk = (v: unknown) => `data: ${JSON.stringify(v)}\n\n`;

/**
 * OpenAI-compatible `POST /chat/completions`. Script: no tool result in the conversation yet → stream a `log_steps`
 * call; otherwise a short text reply. Every answer ends with a `usage` chunk. Model `slow` streams its first chunk,
 * then waits for `releaseSlow()` before the rest (the no-buffering check).
 */
function startStandIn() {
  const seen: Seen[] = [];
  let release: () => void = () => undefined;
  let slowFinished = false;
  const slowGate = new Promise<void>((r) => (release = r));
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      seen.push({ path: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"not found"}}');
        return;
      }
      const parsed = JSON.parse(body) as { model?: string; stream?: boolean; messages?: Array<{ role: string }> };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (parsed.model === 'slow') {
        res.write(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'first' } }] }));
        void slowGate.then(() => {
          res.write(chunk({ choices: [{ index: 0, delta: { content: ' second' }, finish_reason: 'stop' }] }));
          res.write(chunk({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
          res.end('data: [DONE]\n\n');
          slowFinished = true;
        });
        return;
      }
      const hasToolResult = (parsed.messages ?? []).some((m) => m.role === 'tool');
      if (!hasToolResult) {
        res.write(chunk({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_steps_1', type: 'function', function: { name: 'log_steps', arguments: '' } }] } }] }));
        res.write(chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ date: DAY, steps: STEPS }) } }] } }] }));
        res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        res.write(chunk({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } }));
      } else {
        res.write(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Logged 12,345 ' } }] }));
        res.write(chunk({ choices: [{ index: 0, delta: { content: 'steps for today.' }, finish_reason: 'stop' }] }));
        res.write(chunk({ choices: [], usage: { prompt_tokens: 950, completion_tokens: 8 } }));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return {
    seen,
    releaseSlow: () => release(),
    slowFinished: () => slowFinished,
    async listen(): Promise<string> {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

/* ------------------------------------------------------------------------------------------------ setup */

/** The Coach executes its tools in the app; the server's agent dispatch is not used here. */
const noDispatch: PersonDispatch = {
  manifest: async () => {
    throw new Error('not used in this test');
  },
  dispatch: async () => {
    throw new Error('not used in this test');
  },
};

let dataDir = '';
let standIn: ReturnType<typeof startStandIn>;
let server: Awaited<ReturnType<typeof startAiServer>>;
let tokens: TokenStore;
let personA = '';
let personB = '';
let tokenA = '';
let tokenAId = '';
let tokenB = '';

// eslint-disable-next-line no-restricted-properties -- the test's own loopback server and stand-in, not app network access
const realFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const api = (path: string, token: string | null, init: RequestInit = {}) =>
  realFetch(`${server.url}${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });

beforeAll(async () => {
  dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'e26-coach-'));
  personA = await createPersonDir(dataDir, 'Person A', 'UTC');
  personB = await createPersonDir(dataDir, 'Person B', 'UTC');
  tokens = createFileTokenStore(dataDir);
  const a = await tokens.mint(personA, { kind: 'device', label: 'Browser', scope: 'full' });
  const b = await tokens.mint(personB, { kind: 'device', label: 'Browser', scope: 'full' });
  tokenA = a.token;
  tokenAId = a.record.id;
  tokenB = b.token;

  standIn = startStandIn();
  const standInUrl = await standIn.listen();
  server = await startAiServer({
    resolvePerson: createFileResolver({ dataDir, tokens, dispatchFor: () => noDispatch }),
    tokens,
    upstreams: { ...UPSTREAMS, nim: { ...UPSTREAMS.nim!, baseUrl: standInUrl } },
    log: () => undefined,
  });
});

afterAll(async () => {
  await server?.close();
  await standIn?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------------------------------ tests */

describe('Coach through the server (§14.9, E26)', () => {
  it('each person puts their own nim key through the route (204, never returned)', async () => {
    const ra = await api('/v1/ai/keys/nim', tokenA, { method: 'PUT', body: JSON.stringify({ key: KEY_A }) });
    expect(ra.status).toBe(204);
    const rb = await api('/v1/ai/keys/nim', tokenB, { method: 'PUT', body: JSON.stringify({ key: KEY_B }) });
    expect(rb.status).toBe(204);
    const status = await (await api('/v1/ai/status', tokenA)).text();
    expect(status).not.toContain(KEY_A);
    expect(JSON.parse(status)).toMatchObject({ presets: expect.arrayContaining([expect.objectContaining({ id: 'nim', ready: true })]) });
  });

  it('a typed message → a streamed tool call → the log changes on the real bus → the reply streams back', async () => {
    freshState({ cleared: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // the browser: the nim preset aimed at the server's route, the device token as the bearer
    const preset = { ...getPreset('nim')!, browserDirect: 'yes' as const };
    const model = createChatModel({
      preset,
      model: 'meta/llama-4-test',
      serverUrl: server.url,
      apiKey: tokenA,
      capabilities: { ...presetCapabilities(preset), tools: true, streaming: true, streamUsage: true, vision: false },
      // what the paired client's fetch does (src/net/server.ts): the device token as the bearer, only to the server
      deps: { fetch: ((input: RequestInfo | URL, init?: RequestInit) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), authorization: `Bearer ${tokenA}` } })) as typeof fetch, sleep: async () => undefined, random: () => 0 },
    });
    let n = 0;
    const adapter = createCoachAdapter({
      bus: appBus,
      model,
      provider: { name: 'NVIDIA NIM', model: model.model, keyOwner: 'local' },
      aiActorId: 'nim',
      now: () => new Date(`${DAY}T12:00:00.000Z`),
      newId: () => `e26-${++n}`,
      sleep: async () => undefined,
    });
    const before = standIn.seen.length;
    const events: StreamEventView[] = [];
    await adapter.send({ conversationId: 'coach', text: PROMPT }, (e) => events.push(e), new AbortController().signal);
    vi.restoreAllMocks();

    // the reply streamed back
    const turn = adapter.history('coach').at(-1)!;
    expect(turn.text).toBe(REPLY);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    // the tool call went through the real bus and the document changed
    expect(turn.cards).toHaveLength(1);
    expect(turn.cards[0]).toMatchObject({ state: 'applied' });
    await settleCommits();
    const got = await dispatch('log.get', { from: DAY, to: DAY, kinds: ['steps'] });
    expect(got.ok).toBe(true);
    const entries = (got as { output: Array<Record<string, unknown>> }).output;
    expect(JSON.stringify(entries)).toContain(String(STEPS));

    // what the stand-in saw: two requests (tool turn, then the reply with the tool result), A's key only
    const mine = standIn.seen.slice(before);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((s) => s.path === '/chat/completions')).toBe(true);
    for (const s of mine) {
      expect(s.authorization).toBe(`Bearer ${KEY_A}`);
      expect(s.authorization).not.toContain(tokenA);
      expect(s.body).not.toContain(tokenA);
      expect(s.body).not.toContain(KEY_B);
      expect(s.authorization).not.toContain(KEY_B);
    }
    expect(mine.some((s) => s.body.includes('"role":"tool"') && s.body.includes('call_steps_1'))).toBe(true);
  });

  it('usage is counted per person: A has the requests and tokens, B none; usage.jsonl is 0600 and holds no prompt text', async () => {
    const ua = (await (await api('/v1/ai/usage', tokenA)).json()) as { today: { requests: number; inputTokens: number; outputTokens: number } };
    expect(ua.today.requests).toBeGreaterThanOrEqual(2);
    expect(ua.today.inputTokens).toBeGreaterThanOrEqual(900 + 950);
    expect(ua.today.outputTokens).toBeGreaterThanOrEqual(20 + 8);
    const ub = (await (await api('/v1/ai/usage', tokenB)).json()) as { today: { requests: number } };
    expect(ub.today.requests).toBe(0);

    const file = join(personDir(dataDir, personA), 'usage.jsonl');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const text = await readFile(file, 'utf8');
    expect(text.trim().split('\n').length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('steps today');
    expect(text).not.toContain(PROMPT);
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain(tokenA);
    for (const line of text.trim().split('\n')) expect(Object.keys(JSON.parse(line) as object).sort()).toEqual(['at', 'inputTokens', 'model', 'outputTokens', 'preset', 'status']);
    await expect(stat(join(personDir(dataDir, personB), 'usage.jsonl'))).rejects.toThrow();
  });

  it('SSE is passed through chunk by chunk: the first chunk reaches the client before the upstream finishes', async () => {
    const r = await api('/v1/ai/nim/chat/completions', tokenA, { method: 'POST', body: JSON.stringify({ model: 'slow', stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    expect(r.headers.get('x-accel-buffering')).toBe('no');
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let got = '';
    while (!got.includes('first')) {
      const { value, done } = await reader.read();
      if (done) break;
      got += decoder.decode(value, { stream: true });
    }
    expect(got).toContain('"content":"first"');
    // the upstream is still holding the rest back: nothing was buffered until its end
    expect(standIn.slowFinished()).toBe(false);
    standIn.releaseSlow();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += decoder.decode(value, { stream: true });
    }
    expect(standIn.slowFinished()).toBe(true);
    expect(got).toContain(' second');
    expect(got).toContain('[DONE]');
  });

  it('no token → 401 unauthorized with the exact §14.3 body', async () => {
    const r = await api('/v1/ai/nim/chat/completions', null, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: 'unauthorized', message: AI_ERROR_MESSAGES.unauthorized } });
    expect(AI_ERROR_MESSAGES.unauthorized).toBe('This device is no longer connected to your server. Connect it again in Settings › Server.');
  });

  it("A's token after revocation → 401 revoked with the exact §14.3 body, and the upstream is not called", async () => {
    expect(await tokens.revoke(personA, tokenAId)).toBe(true);
    const before = standIn.seen.length;
    const r = await api('/v1/ai/nim/chat/completions', tokenA, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: 'revoked', message: 'This device was removed from your server. Connect it again in Settings › Server.' } });
    expect(standIn.seen.length).toBe(before);
    // B is unaffected
    expect((await api('/v1/ai/usage', tokenB)).status).toBe(200);
  });

  it('the stand-in never saw a device token or B’s key in any of A’s requests', () => {
    for (const s of standIn.seen) {
      expect(s.authorization).toBe(`Bearer ${KEY_A}`);
      for (const t of [tokenA, tokenB, KEY_B]) {
        expect(s.authorization ?? '').not.toContain(t);
        expect(s.body).not.toContain(t);
      }
    }
  });
});
