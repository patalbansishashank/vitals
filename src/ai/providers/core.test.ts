// @vitest-environment node
import { classifyFetchFailure, classifyHttpError, parseRetryAfter, ProviderError, redactSecrets, streamError } from './errors';
import { collect, finishToolCall, guardStream, request } from './http';
import { BASE_CAPABILITIES, getPreset, listPresets, makeCustomPreset, presetCapabilities, registerCustomPreset } from './presets';
import { backoffDelay, RETRY_POLICY, withRetry } from './retry';
import { parseSse } from './sse';
import { costUsd, estimateTextTokens } from './usage';
import type { AdapterConfig, StreamEvent } from './types';
import { chunkedStream, drain, fakeFetch, instantSleep } from '../testing/fakeFetch';

function cfgFor(presetId: string, fetchFn: typeof fetch, extra: Partial<AdapterConfig['deps']> = {}): AdapterConfig {
  const preset = getPreset(presetId)!;
  return {
    preset,
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    apiKey: 'sk-test-1234567890',
    capabilities: presetCapabilities(preset),
    deps: { fetch: fetchFn, sleep: instantSleep().sleep, random: () => 0.5, ...extra },
  };
}

describe('retry policy', () => {
  it('is base 1 s, cap 30 s, 4 tries (R8 §1.7)', () => {
    expect(RETRY_POLICY).toEqual({ tries: 4, baseMs: 1000, capMs: 30_000 });
  });

  it('uses full jitter over min(cap, base·2^n)', () => {
    expect(backoffDelay(0, RETRY_POLICY, () => 0.5)).toBe(500);
    expect(backoffDelay(3, RETRY_POLICY, () => 0.5)).toBe(4000);
    expect(backoffDelay(10, RETRY_POLICY, () => 0.999)).toBe(29_970);
    expect(backoffDelay(2, RETRY_POLICY, () => 0)).toBe(0);
  });

  it('honours retry-after, capped', () => {
    expect(backoffDelay(0, RETRY_POLICY, () => 0.5, 2000)).toBe(2000);
    expect(backoffDelay(0, RETRY_POLICY, () => 0.5, 120_000)).toBe(30_000);
  });

  it('retries retryable errors up to 4 tries, then throws', async () => {
    const { sleep, delays } = instantSleep();
    let calls = 0;
    const err = new ProviderError({ kind: 'rate_limit', message: 'slow down', retryable: true, status: 429 });
    await expect(withRetry(async () => { calls++; throw err; }, { sleep, random: () => 0.5 })).rejects.toBe(err);
    expect(calls).toBe(4);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    const err = new ProviderError({ kind: 'auth', message: 'bad key', retryable: false, status: 401 });
    await expect(withRetry(async () => { calls++; throw err; }, instantSleep())).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  it('returns the first success', async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      if (++calls < 3) throw new ProviderError({ kind: 'server', message: 'x', retryable: true, status: 503 });
      return 'ok';
    }, instantSleep());
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });
});

describe('error classification', () => {
  it.each([
    [401, { error: { message: 'Incorrect API key' } }, 'auth', false],
    [403, { error: { message: 'forbidden' } }, 'auth', false],
    [402, { error: { message: 'Insufficient credits' } }, 'quota', false],
    [429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 'quota', false],
    [429, { error: { message: 'Rate limit reached' } }, 'rate_limit', true],
    [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'overloaded', true],
    [500, 'Internal error', 'server', true],
    [503, { error: { message: 'unavailable' } }, 'server', true],
    [404, { error: { message: 'The model `x` does not exist', code: 'model_not_found' } }, 'model_not_found', false],
    [400, { error: { message: "This model's maximum context length is 128000 tokens" } }, 'context_length', false],
    [400, { error: { message: 'Unrecognized request argument supplied: parallel_tool_calls' } }, 'unsupported_param', false],
    [400, { error: { message: 'tools: Extra inputs are not permitted' } }, 'unsupported_param', false],
    [400, { error: { message: 'messages: field required' } }, 'bad_request', false],
  ] as const)('%i %j → %s', (status, body, kind, retryable) => {
    const e = classifyHttpError(status, body);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
    expect(e.status).toBe(status);
  });

  it('reads retry-after seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('Thu, 01 Oct 2026 10:00:05 GMT', Date.parse('2026-10-01T10:00:00Z'))).toBe(5000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(classifyHttpError(429, {}, '7').retryAfterMs).toBe(7000);
  });

  it('classifies a first-contact TypeError as cors, later ones as network, aborts as aborted', () => {
    expect(classifyFetchFailure(new TypeError('Failed to fetch'), true).kind).toBe('cors');
    const later = classifyFetchFailure(new TypeError('Failed to fetch'), false);
    expect(later.kind).toBe('network');
    expect(later.retryable).toBe(true);
    const ac = new AbortController();
    ac.abort();
    expect(classifyFetchFailure(new DOMException('x', 'AbortError'), false, ac.signal).kind).toBe('aborted');
    const blocked = Object.assign(new Error('not allowed'), { name: 'NetBlockedError' });
    expect(classifyFetchFailure(blocked, true).kind).toBe('blocked');
  });

  it('classifies mid-stream errors, including the SIWC usage limit', () => {
    expect(streamError({ type: 'overloaded_error', message: 'Overloaded' }).kind).toBe('overloaded');
    expect(streamError({ code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' }).kind).toBe('quota');
  });

  it('redacts keys from messages', () => {
    const msg = 'Incorrect API key provided: sk-proj-abcdefghijklmnop and Bearer sk-ant-api03-zzzzzzzzzzzz';
    const out = redactSecrets(msg);
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).not.toContain('zzzzzzzzzzzz');
    expect(new ProviderError({ kind: 'auth', message: msg, retryable: false }).message).not.toContain('abcdefghijklmnop');
  });
});

describe('SSE parser', () => {
  it('handles comments, event names, multi-line data, CRLF and 1-byte chunks', async () => {
    const text = ': OPENROUTER PROCESSING\r\n\r\nevent: ping\r\ndata: {"a":1}\r\n\r\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n';
    for (const size of [1, 2, 5, 1000]) {
      const out = await drain(parseSse(chunkedStream(text, size)));
      expect(out).toEqual([
        { event: 'ping', data: '{"a":1}' },
        { event: 'message', data: 'line1\nline2' },
        { event: 'message', data: '[DONE]' },
      ]);
    }
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const out = await drain(parseSse(chunkedStream('data: dal-chāwal — ठीक\n\n', 1)));
    expect(out[0]?.data).toBe('dal-chāwal — ठीक');
  });

  it('cancels the body when the reader stops early, so the connection is released', async () => {
    let cancelled = false;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: one\n\ndata: two\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const m of parseSse(body)) {
      expect(m.data).toBe('one');
      break;
    }
    expect(cancelled).toBe(true);
  });

  it('flushes a final event without a trailing blank line', async () => {
    const out = await drain(parseSse(chunkedStream('data: {"x":2}', 3)));
    expect(out).toEqual([{ event: 'message', data: '{"x":2}' }]);
  });
});

describe('request phase', () => {
  it('retries 429 then succeeds; marks the base URL as reached', async () => {
    const ff = fakeFetch([{ status: 429, json: { error: { message: 'Rate limit' } } }, { json: { ok: 1 } }]);
    const { sleep, delays } = instantSleep();
    const reached = new Set<string>();
    const cfg = cfgFor('openrouter', ff.fetch, { sleep, reachedBaseUrls: reached });
    const res = await request(cfg, 'https://openrouter.ai/api/v1/x', { method: 'POST', body: { a: 1 } });
    expect(await res.json()).toEqual({ ok: 1 });
    expect(ff.requests).toHaveLength(2);
    expect(delays).toEqual([500]);
    expect(reached.has(cfg.baseUrl)).toBe(true);
    expect(ff.requests[0]?.headers.authorization).toBe('Bearer sk-test-1234567890');
    expect(ff.requests[0]?.headers['http-referer']).toBe('https://vitals.creative.desi');
    expect(ff.requests[0]?.headers['content-type']).toBe('application/json');
  });

  it('does not retry 401 and does not leak the key', async () => {
    const ff = fakeFetch([{ status: 401, json: { error: { message: 'Incorrect API key provided: sk-test-1234567890' } } }]);
    const err = await request(cfgFor('openai', ff.fetch), 'https://api.openai.com/v1/x', { method: 'GET' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain('1234567890');
    expect(ff.requests).toHaveLength(1);
  });

  it('sends Anthropic browser headers and x-api-key', async () => {
    const ff = fakeFetch([{ json: {} }]);
    await request(cfgFor('anthropic', ff.fetch), 'https://api.anthropic.com/v1/models', { method: 'GET' });
    const h = ff.requests[0]!.headers;
    expect(h['x-api-key']).toBe('sk-test-1234567890');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h.authorization).toBeUndefined();
  });

  it('first-contact fetch TypeError is cors and not retried', async () => {
    const ff = fakeFetch([{ throws: new TypeError('Failed to fetch') }]);
    const err = await request(cfgFor('ollama', ff.fetch), 'http://127.0.0.1:11434/v1/models', { method: 'GET' }).catch((e) => e);
    expect(err.kind).toBe('cors');
    expect(ff.requests).toHaveLength(1);
  });
});

describe('guardStream and collect', () => {
  const req = { messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hello there' }] }] };

  async function* gen(events: StreamEvent[], throwAfter?: unknown): AsyncGenerator<StreamEvent> {
    for (const e of events) yield e;
    if (throwAfter) throw throwAfter;
  }

  it('estimates usage when the server reports none and adds cost from the preset table', async () => {
    const cfg = cfgFor('anthropic', fakeFetch([]).fetch);
    const out = await drain(guardStream(cfg, req, gen([{ type: 'text', delta: 'hi' }, { type: 'done', stopReason: 'end' }])));
    const usage = out.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ usage: { estimated: true, outputTokens: 1 } });
    expect(usage && usage.type === 'usage' && usage.usage.costUsd).toBeGreaterThan(0);
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });

  it('charges nothing for a request that failed before the provider answered (401, 429 after retries, CORS)', async () => {
    const cfg = cfgFor('anthropic', fakeFetch([]).fetch);
    const failed = await drain(guardStream(cfg, req, gen([], new ProviderError({ kind: 'auth', message: 'bad key', status: 401, retryable: false }))));
    const usage = failed.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ usage: { inputTokens: 0, outputTokens: 0, estimated: true } });
    expect(usage && usage.type === 'usage' && (usage.usage.costUsd ?? 0)).toBe(0);
  });

  it('turns a throw into error + done:error, and EOF without done into a stream error', async () => {
    const cfg = cfgFor('openai', fakeFetch([]).fetch);
    const thrown = await drain(guardStream(cfg, req, gen([], new ProviderError({ kind: 'overloaded', message: 'busy', retryable: true }))));
    expect(thrown.filter((e) => e.type === 'error')).toEqual([{ type: 'error', error: { kind: 'overloaded', message: 'busy', retryable: true } }]);
    expect(thrown.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
    const eof = await drain(guardStream(cfg, req, gen([{ type: 'text', delta: 'par' }])));
    expect(eof.find((e) => e.type === 'error')).toMatchObject({ error: { kind: 'stream' } });
    expect(eof.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('collects text, tool calls in index order and provider state', async () => {
    const cfg = cfgFor('deepseek', fakeFetch([]).fetch);
    const call0 = finishToolCall('a', 'log_meal', '{"g":1}');
    const call1 = finishToolCall('b', 'get_log', '{}');
    const res = await collect(
      guardStream(cfg, req, gen([
        { type: 'text', delta: 'Lo' },
        { type: 'text', delta: 'gging' },
        { type: 'tool_call_end', index: 1, call: call1 },
        { type: 'tool_call_end', index: 0, call: call0 },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, estimated: false } },
        { type: 'provider_state', state: { presetId: 'deepseek', model: 'm', data: 'thought' } },
        { type: 'done', stopReason: 'tool' },
      ])),
    );
    expect(res.stopReason).toBe('tool');
    expect(res.message.parts).toEqual([{ type: 'text', text: 'Logging' }]);
    expect(res.message.toolCalls?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(res.message.providerState?.data).toBe('thought');
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, estimated: false });
  });

  it('finishToolCall keeps raw arguments and reports parse errors', () => {
    expect(finishToolCall('1', 't', '{"n":7}').args).toEqual({ n: 7 });
    expect(finishToolCall('1', 't', { n: 7 }).rawArgs).toBe('{"n":7}');
    expect(finishToolCall('1', 't', '{"n":').parseError).toMatch(/not valid JSON/);
    expect(finishToolCall('1', 't', '[1]').parseError).toMatch(/object/);
    expect(finishToolCall('1', 't', '').args).toEqual({});
  });
});

describe('presets', () => {
  it('ships every preset R8 §3.2 lists, with NIM and Zen through the server', () => {
    const ids = listPresets().map((p) => p.id);
    for (const id of ['openai', 'anthropic', 'openrouter', 'groq', 'mistral', 'deepseek', 'together', 'gemini', 'ollama', 'lmstudio', 'vllm', 'nim', 'opencode-zen', 'cerebras', 'xai', 'fireworks', 'siwc']) {
      expect(ids).toContain(id);
    }
    expect(getPreset('nim')?.via).toBe('server');
    expect(getPreset('opencode-zen')?.via).toBe('server');
    expect(presetCapabilities(getPreset('nim')!).browserDirect).toBe(false);
  });

  it('keeps Mistral and Gemini free of extra headers (their CORS allow-lists reject them)', () => {
    expect(getPreset('mistral')?.extraHeaders).toBeUndefined();
    expect(getPreset('gemini')?.extraHeaders).toBeUndefined();
  });

  it('has the R8 default tiers and prices', () => {
    const sonnet = getPreset('anthropic')!.recommendedModels.find((m) => m.id === 'claude-sonnet-5-5');
    expect(sonnet?.price).toEqual({ input: 2, output: 10, cachedInput: 0.2 });
    const qwen = getPreset('openrouter')!.recommendedModels.find((m) => m.tier === 'budget');
    expect(qwen?.price).toEqual({ input: 0.15, output: 0.47 });
    expect(presetCapabilities(getPreset('groq')!).maxImages).toBe(3);
  });

  it('validates custom presets', () => {
    const p = makeCustomPreset({ id: 'custom-box', label: 'Box', adapter: 'openai-chat', baseUrl: 'https://llm.example.ts.net/v1/' });
    expect(p.baseUrl).toBe('https://llm.example.ts.net/v1');
    expect(p.authHeader).toBe('bearer');
    expect(() => makeCustomPreset({ id: 'custom-x', label: 'x', adapter: 'openai-chat', baseUrl: 'http://192.168.1.5:8000/v1' })).toThrow(/https/);
    expect(() => makeCustomPreset({ id: 'openai', label: 'x', adapter: 'openai-chat', baseUrl: 'https://a.b' })).toThrow();
    const a = makeCustomPreset({ id: 'custom-proxy', label: 'P', adapter: 'anthropic-messages', baseUrl: 'http://localhost:8787/v1' });
    expect(a.extraHeaders?.['anthropic-dangerous-direct-browser-access']).toBe('true');
    registerCustomPreset(a);
    expect(getPreset('custom-proxy')).toBe(a);
    expect(() => registerCustomPreset({ ...getPreset('openai')! })).toThrow();
  });

  it('base capabilities assume nothing optional', () => {
    expect(BASE_CAPABILITIES).toMatchObject({ vision: false, jsonSchema: false, parallelTools: false, strictTools: false });
  });
});

describe('usage', () => {
  it('estimates at 3.5 chars per token and prices cached input separately', () => {
    expect(estimateTextTokens('a'.repeat(35))).toBe(10);
    const cost = costUsd({ inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000, estimated: false }, { input: 2, output: 10, cachedInput: 0.2 });
    expect(cost).toBeCloseTo(1 + 0.1 + 1, 10);
  });
});
