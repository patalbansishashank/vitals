// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CapabilityCache,
  capabilityKey,
  degradeFor,
  isBasicTier,
  probeCapabilities,
  readCatalogue,
  runSelfTest,
  shouldReprobe,
} from './probe';
import { getPreset, presetCapabilities } from './presets';
import { adler32, crc32, DIGIT_ORIGIN, DIGIT_SCALE, digitPng, isDigitInk, SELFTEST_BG, SELFTEST_FG } from './selftestImage';
import { MemoryKv } from '../storage/kv';
import { fakeFetch, instantSleep, type FakeReply } from '../testing/fakeFetch';
import type { AdapterConfig, Capabilities, ChatModel, ChatRequest, ChatResult, ProviderErrorInfo } from './types';

const NOW = '2026-10-01T12:00:00.000Z';

function cfgFor(presetId: string, model: string, replies: FakeReply[], baseUrl?: string) {
  const preset = getPreset(presetId)!;
  const ff = fakeFetch(replies);
  const cfg: AdapterConfig = {
    preset,
    baseUrl: baseUrl ?? preset.baseUrl,
    model,
    apiKey: 'sk-test-key-123456789',
    capabilities: presetCapabilities(preset),
    deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 },
  };
  return { cfg, ff };
}

const OPENROUTER_MODELS = {
  data: [
    {
      id: 'qwen/qwen3.8-flash',
      context_length: 262144,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 65536 },
      supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs', 'reasoning', 'parallel_tool_calls'],
    },
    {
      id: 'meta/text-only-7b',
      context_length: 32768,
      architecture: { input_modalities: ['text'] },
      top_provider: { max_completion_tokens: null },
      supported_parameters: ['response_format', 'temperature'],
    },
  ],
};

const ANTHROPIC_MODEL = {
  type: 'model',
  id: 'claude-sonnet-5-5',
  display_name: 'Claude Sonnet 5.5',
  max_input_tokens: 1000000,
  max_tokens: 64000,
  capabilities: { image_input: { supported: true }, structured_outputs: true, thinking: { supported: true, types: {} } },
};

const OLLAMA_SHOW = {
  details: { family: 'qwen3vl', parameter_size: '8.8B' },
  model_info: { 'general.architecture': 'qwen3vl', 'qwen3vl.context_length': 262144, 'qwen3vl.embedding_length': 4096 },
  capabilities: ['completion', 'vision', 'tools', 'thinking'],
};

describe('readCatalogue', () => {
  it('reads OpenRouter supported_parameters and modalities for the right model', async () => {
    const { cfg, ff } = cfgFor('openrouter', 'qwen/qwen3.8-flash', [{ json: OPENROUTER_MODELS }]);
    expect(await readCatalogue(cfg)).toEqual({
      tools: true,
      parallelTools: true,
      strictTools: true,
      jsonSchema: true,
      jsonObject: true,
      reasoning: true,
      vision: true,
      contextTokens: 262144,
      maxOutput: 65536,
    });
    expect(ff.requests[0]).toMatchObject({ url: 'https://openrouter.ai/api/v1/models', method: 'GET' });
  });

  it('treats response_format alone as json_object only', async () => {
    const { cfg } = cfgFor('openrouter', 'meta/text-only-7b', [{ json: OPENROUTER_MODELS }]);
    const caps = await readCatalogue(cfg);
    expect(caps).toMatchObject({ tools: false, jsonSchema: false, jsonObject: true, vision: false, reasoning: false, contextTokens: 32768 });
    expect(caps).not.toHaveProperty('maxOutput');
  });

  it('returns null when the model is not in the OpenRouter catalogue', async () => {
    const { cfg } = cfgFor('openrouter', 'nope/missing', [{ json: OPENROUTER_MODELS }]);
    expect(await readCatalogue(cfg)).toBeNull();
  });

  it('reads Anthropic /models/{id} with defensive capability parsing', async () => {
    const { cfg, ff } = cfgFor('anthropic', 'claude-sonnet-5-5', [{ json: ANTHROPIC_MODEL }]);
    expect(await readCatalogue(cfg)).toEqual({
      tools: true,
      parallelTools: true,
      contextTokens: 1000000,
      maxOutput: 64000,
      vision: true,
      jsonSchema: true,
      strictTools: true,
      reasoning: true,
    });
    expect(ff.requests[0]!.url).toBe('https://api.anthropic.com/v1/models/claude-sonnet-5-5');
    expect(ff.requests[0]!.headers['x-api-key']).toBe('sk-test-key-123456789');
  });

  it('reads Ollama /api/show at the server root', async () => {
    const { cfg, ff } = cfgFor('ollama', 'qwen3-vl:8b', [{ json: OLLAMA_SHOW }]);
    expect(await readCatalogue(cfg)).toEqual({ tools: true, vision: true, reasoning: true, contextTokens: 262144 });
    expect(ff.requests[0]).toMatchObject({ url: 'http://127.0.0.1:11434/api/show', method: 'POST', body: { model: 'qwen3-vl:8b' } });
  });

  it('ids-only presets have no catalogue and make no request', async () => {
    const { cfg, ff } = cfgFor('groq', 'qwen/qwen3.8-27b', []);
    expect(await readCatalogue(cfg)).toBeNull();
    expect(ff.requests).toHaveLength(0);
  });

  it('model-specific errors give null; auth errors are rethrown', async () => {
    const nf = cfgFor('anthropic', 'claude-x', [{ status: 404, json: { error: { type: 'not_found_error', message: 'model: claude-x' } } }]);
    expect(await readCatalogue(nf.cfg)).toBeNull();
    const auth = cfgFor('anthropic', 'claude-x', [{ status: 401, json: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    await expect(readCatalogue(auth.cfg)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('CapabilityCache', () => {
  const caps = (verifiedAt: string | null): Capabilities => ({ ...presetCapabilities(getPreset('openrouter')!), verifiedAt, source: 'catalog' });

  it('keys by normalised base URL and model', () => {
    expect(capabilityKey('HTTPS://OpenRouter.ai/api/v1/', 'm')).toBe('https://openrouter.ai/api/v1|m');
  });

  it('expires after 30 days and can be invalidated', async () => {
    const cache = new CapabilityCache(new MemoryKv());
    await cache.set('https://x.example/v1', 'm', caps('2026-09-02T12:00:00.000Z'));
    expect(await cache.get('https://x.example/v1/', 'm', NOW)).toBeDefined(); // 29 days
    expect(await cache.get('https://x.example/v1', 'm', '2026-10-02T12:00:01.000Z')).toBeUndefined(); // 30 days + 1 s
    await cache.invalidate('https://x.example/v1', 'm');
    expect(await cache.get('https://x.example/v1', 'm', NOW)).toBeUndefined();
    await cache.set('https://x.example/v1', 'm', caps(null));
    expect(await cache.get('https://x.example/v1', 'm', NOW)).toBeUndefined();
  });

  it('shouldReprobe only on unsupported_param', () => {
    const e = (kind: ProviderErrorInfo['kind']): ProviderErrorInfo => ({ kind, message: '', retryable: false, status: 400 });
    expect(shouldReprobe(e('unsupported_param'))).toBe(true);
    expect(shouldReprobe(e('bad_request'))).toBe(false);
    expect(shouldReprobe(e('auth'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------

type Behaviour = {
  tools?: 'parallel' | 'single' | 'none' | 'error400';
  vision?: 'right' | 'wrong' | 'error400';
  schema?: 'ok' | 'garbage' | 'error400';
  object?: 'ok' | 'garbage';
  fail?: ProviderErrorInfo;
};

function stubModels(b: Behaviour) {
  const calls: Array<{ req: ChatRequest; caps: Capabilities }> = [];
  const err400: ProviderErrorInfo = { kind: 'unsupported_param', message: 'unsupported', status: 400, retryable: false };
  const text = (t: string): ChatResult => ({ message: { role: 'assistant', parts: [{ type: 'text', text: t }] }, usage: null, stopReason: 'end' });
  const fail = (error: ProviderErrorInfo): ChatResult => ({ message: { role: 'assistant', parts: [] }, usage: null, stopReason: 'error', error });
  const makeModel = (caps: Capabilities): ChatModel => ({
    adapter: 'openai-chat',
    presetId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'm',
    capabilities: caps,
    stream: () => {
      throw new Error('not used');
    },
    listModels: async () => [],
    complete: async (req) => {
      calls.push({ req, caps });
      if (b.fail) return fail(b.fail);
      if (req.tools) {
        const call = (id: string, n: unknown) => ({ id, name: 'ping_echo', args: { n }, rawArgs: JSON.stringify({ n }) });
        if (b.tools === 'error400') return fail(err400);
        if (b.tools === 'none') return text('I cannot call tools.');
        const toolCalls = b.tools === 'single' ? [call('a', 3)] : [call('a', 3), call('b', 4)];
        return { message: { role: 'assistant', parts: [], toolCalls }, usage: null, stopReason: 'tool' };
      }
      if (req.messages[0]!.parts.some((p) => p.type === 'image')) {
        if (b.vision === 'error400') return fail({ ...err400, kind: 'bad_request' });
        return text(b.vision === 'wrong' ? '8' : '6');
      }
      if (caps.jsonSchema) {
        if (b.schema === 'error400') return fail(err400);
        return text(b.schema === 'garbage' ? 'Sure! ok' : '{"ok":true}');
      }
      return text(b.object === 'garbage' ? 'nope' : '{"ok": false}');
    },
  });
  return { makeModel, calls };
}

const BASE = presetCapabilities(getPreset('groq')!);

describe('runSelfTest', () => {
  it('passes everything in exactly 3 calls', async () => {
    const { makeModel, calls } = stubModels({ tools: 'parallel', vision: 'right', schema: 'ok' });
    expect(await runSelfTest(makeModel, BASE)).toEqual({ tools: true, parallelTools: true, vision: true, jsonSchema: true });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.req).toMatchObject({ toolChoice: 'auto', tools: [{ name: 'ping_echo' }] });
    expect(calls[0]!.caps).toMatchObject({ tools: true, vision: true, jsonSchema: true });
    const img = calls[1]!.req.messages[0]!.parts[0]!;
    expect(img).toMatchObject({ type: 'image', mime: 'image/png', width: 64, height: 64 });
    expect(calls[2]!.req.responseSchema?.schema).toMatchObject({ properties: { ok: { type: 'boolean' } } });
  });

  it('records failures without extra calls', async () => {
    const { makeModel, calls } = stubModels({ tools: 'single', vision: 'wrong', schema: 'garbage' });
    expect(await runSelfTest(makeModel, BASE)).toEqual({ tools: true, parallelTools: false, vision: false, jsonSchema: false });
    expect(calls).toHaveLength(3);
  });

  it('treats 400s as missing capabilities and retries json_schema once as json_object', async () => {
    const { makeModel, calls } = stubModels({ tools: 'error400', vision: 'error400', schema: 'error400', object: 'ok' });
    expect(await runSelfTest(makeModel, BASE)).toEqual({
      tools: false,
      parallelTools: false,
      vision: false,
      jsonSchema: false,
      jsonObject: true,
    });
    expect(calls).toHaveLength(4);
    expect(calls[3]!.caps).toMatchObject({ jsonSchema: false, jsonObject: true });
  });

  it('json_object fallback that fails is recorded as false', async () => {
    const { makeModel } = stubModels({ tools: 'none', vision: 'right', schema: 'error400', object: 'garbage' });
    expect(await runSelfTest(makeModel, BASE)).toMatchObject({ tools: false, jsonSchema: false, jsonObject: false });
  });

  it('aborts and rethrows on auth errors without caching', async () => {
    const auth: ProviderErrorInfo = { kind: 'auth', message: 'Invalid key', status: 401, retryable: false };
    const { makeModel, calls } = stubModels({ fail: auth });
    await expect(runSelfTest(makeModel, BASE)).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);

    const kv = new MemoryKv<Capabilities>();
    const { cfg } = cfgFor('groq', 'm', []);
    await expect(
      probeCapabilities({ cfg, cache: new CapabilityCache(kv), nowIso: NOW, allowSelfTest: true, makeModel }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(await kv.keys()).toEqual([]);
  });
});

describe('probeCapabilities', () => {
  it('uses the catalogue, caches it, and then hits the cache without network', async () => {
    const kv = new MemoryKv<Capabilities>();
    const cache = new CapabilityCache(kv);
    const { cfg, ff } = cfgFor('openrouter', 'qwen/qwen3.8-flash', [{ json: OPENROUTER_MODELS }]);
    const caps = await probeCapabilities({ cfg, cache, nowIso: NOW, allowSelfTest: false });
    expect(caps).toMatchObject({ source: 'catalog', verifiedAt: NOW, vision: true, browserDirect: true, streamUsage: true });
    expect(ff.requests).toHaveLength(1);
    const again = await probeCapabilities({ cfg, cache, nowIso: NOW, allowSelfTest: false });
    expect(again).toEqual(caps);
    expect(ff.requests).toHaveLength(1); // fakeFetch would throw on an unexpected request anyway
  });

  it('falls back to the self-test, then caches it', async () => {
    const kv = new MemoryKv<Capabilities>();
    const { cfg, ff } = cfgFor('groq', 'qwen/qwen3.8-27b', []);
    const { makeModel } = stubModels({ tools: 'parallel', vision: 'right', schema: 'ok' });
    const caps = await probeCapabilities({ cfg, cache: new CapabilityCache(kv), nowIso: NOW, allowSelfTest: true, makeModel });
    expect(caps).toMatchObject({ source: 'selftest', verifiedAt: NOW, tools: true, parallelTools: true, vision: true, jsonSchema: true, maxImages: 3 });
    expect(ff.requests).toHaveLength(0);
    expect(await kv.keys()).toEqual(['https://api.groq.com/openai/v1|qwen/qwen3.8-27b']);
  });

  it('without consent returns preset defaults and caches nothing', async () => {
    const kv = new MemoryKv<Capabilities>();
    const { cfg } = cfgFor('nim', 'x', []);
    const caps = await probeCapabilities({ cfg, cache: new CapabilityCache(kv), nowIso: NOW, allowSelfTest: false });
    expect(caps).toEqual(presetCapabilities(getPreset('nim')!));
    expect(caps).toMatchObject({ source: 'preset', verifiedAt: null, browserDirect: false });
    expect(await kv.keys()).toEqual([]);
  });
});

describe('degradeFor', () => {
  it('mirrors the R8 §3.6 matrix', () => {
    const full: Capabilities = { ...presetCapabilities(getPreset('anthropic')!) };
    expect(degradeFor(full, { model: 'claude-sonnet-5-5', presetId: 'anthropic' })).toEqual({
      chatOnly: false,
      structuredExtraction: false,
      photoButton: true,
      singleToolPerStep: false,
      maxToolSteps: 8,
      validateAndRepair: false,
      nonStreaming: false,
      usageEstimated: false,
      needsCompanion: false,
      basicTier: false,
    });
    const weak = degradeFor({ ...BASE, tools: false, streaming: false, browserDirect: false });
    expect(weak).toMatchObject({ chatOnly: true, structuredExtraction: true, photoButton: false, validateAndRepair: true, nonStreaming: true, needsCompanion: true });
    expect(degradeFor({ ...BASE, parallelTools: false })).toMatchObject({ singleToolPerStep: true, maxToolSteps: 12 });
  });

  it('basic tier heuristic', () => {
    for (const id of ['qwen3-vl:8b', 'llama3.1-8b-instruct', 'qwen2.5:0.5b', 'phi-3.5-mini-3.8b', 'gemma-14b', 'smollm-360m']) {
      expect(isBasicTier(id), id).toBe(true);
    }
    for (const id of ['qwen/qwen3.8-27b', 'gemma-4-31b-it', 'qwen3-30b-a3b', 'claude-sonnet-5-5', 'gpt-5.6-luna', 'llama-70b']) {
      expect(isBasicTier(id), id).toBe(false);
    }
    expect(isBasicTier('gemma4', 'ollama')).toBe(true);
    expect(isBasicTier('anything', 'lmstudio')).toBe(true);
  });
});

describe('self-test PNG', () => {
  const png = digitPng(6);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  function chunks() {
    const out: Array<{ type: string; data: Uint8Array; crc: number; crcInput: Uint8Array }> = [];
    let o = 8;
    while (o < png.length) {
      const len = view.getUint32(o);
      const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
      out.push({ type, data: png.subarray(o + 8, o + 8 + len), crc: view.getUint32(o + 8 + len), crcInput: png.subarray(o + 4, o + 8 + len) });
      o += 12 + len;
    }
    return out;
  }

  it('has a valid signature, IHDR 64×64 RGB and correct chunk CRCs', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cs = chunks();
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(cs[0]!.data.buffer, cs[0]!.data.byteOffset, 13);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), ihdr.getUint8(8), ihdr.getUint8(9)]).toEqual([64, 64, 8, 2]);
    for (const c of cs) expect(crc32(c.crcInput), c.type).toBe(c.crc);
  });

  it('checksums match known vectors', () => {
    const abc = new TextEncoder().encode('123456789');
    expect(crc32(abc)).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });

  it('inflates (node:zlib) to the expected pixels', async () => {
    const zlibId = 'node:zlib';
    const { inflateSync } = (await import(/* @vite-ignore */ zlibId)) as { inflateSync(b: Uint8Array): Uint8Array };
    const raw = inflateSync(chunks()[1]!.data);
    expect(raw.length).toBe(64 * (1 + 64 * 3));
    const px = (x: number, y: number) => [...raw.subarray(y * 193 + 1 + x * 3, y * 193 + 4 + x * 3)];
    // Top-left glyph row of "6" is 00110: column 2 is ink.
    const sx = DIGIT_ORIGIN.x + 2 * DIGIT_SCALE + 3;
    const sy = DIGIT_ORIGIN.y + 3;
    expect(isDigitInk(6, sx, sy)).toBe(true);
    expect(px(sx, sy)).toEqual([...SELFTEST_FG]);
    expect(px(0, 0)).toEqual([...SELFTEST_BG]);
    expect(px(DIGIT_ORIGIN.x + 1, DIGIT_ORIGIN.y + 1)).toEqual([...SELFTEST_BG]); // column 0 of row 0 is blank
    for (let y = 0; y < 64; y++) expect(raw[y * 193]).toBe(0); // filter None
  });
});
