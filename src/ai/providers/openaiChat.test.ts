// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOpenAIChatModel, mistralId, parseModelList, ThinkTagSplitter } from './openaiChat';
import type { ThinkPiece } from './openaiChat';
import { getPreset, presetCapabilities } from './presets';
import type { Preset, Quirks } from './presets';
import type { AdapterConfig, Capabilities, ChatMessage, ChatRequest, StreamEvent, ToolSpec } from './types';
import { drain, fakeFetch, instantSleep, sse } from '../testing/fakeFetch';
import type { FakeFetch, FakeReply, RecordedRequest } from '../testing/fakeFetch';
import * as fx from './__fixtures__/openaiChat.fixtures';

interface Setup {
  preset?: string;
  model?: string;
  apiKey?: string;
  caps?: Partial<Capabilities>;
  quirks?: Partial<Quirks>;
  presetOver?: Partial<Preset>;
}

function setup(replies: Array<FakeReply | ((req: RecordedRequest) => FakeReply)>, s: Setup = {}) {
  const base = getPreset(s.preset ?? 'openai-chat');
  if (!base) throw new Error('missing preset');
  const preset: Preset = { ...base, ...s.presetOver, quirks: { ...base.quirks, ...s.quirks } };
  const ff: FakeFetch = fakeFetch(replies);
  const { sleep, delays } = instantSleep();
  let n = 0;
  const cfg: AdapterConfig = {
    preset,
    baseUrl: preset.baseUrl,
    model: s.model ?? (preset.defaultModel || 'test-model'),
    apiKey: s.apiKey ?? 'sk-test-0123456789',
    capabilities: { ...presetCapabilities(preset), ...s.caps },
    deps: { fetch: ff.fetch, sleep, random: () => 0.5, newId: () => `gen_${++n}` },
  };
  return { model: createOpenAIChatModel(cfg), ff, delays, cfg };
}

const text = (t: string) => ({ type: 'text' as const, text: t });
const user = (t: string): ChatMessage => ({ role: 'user', parts: [text(t)] });
const REQ: ChatRequest = { messages: [{ role: 'system', parts: [text('You are a coach.')] }, user('How am I doing?')] };
const TOOLS: ToolSpec[] = [
  {
    name: 'get_day',
    description: 'Read one day',
    inputSchema: { type: 'object', properties: { date: { type: 'string', format: 'date' }, detail: { type: 'boolean' } }, required: ['date'] },
  },
];
const ok = (t: string): FakeReply => ({ text: t });
const body = (ff: FakeFetch, i = 0) => ff.requests[i]?.body as Record<string, unknown>;
const msgs = (ff: FakeFetch, i = 0) => body(ff, i).messages as Array<Record<string, unknown>>;
const noUsage = (evs: StreamEvent[]) => evs.filter((e) => e.type !== 'usage');
const usageOf = (evs: StreamEvent[]) => evs.find((e) => e.type === 'usage');

describe('streaming fixtures', () => {
  it('OpenAI plain text with a trailing usage chunk', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)]);
    const evs = await drain(model.stream(REQ));
    expect(evs).toEqual([
      { type: 'text', delta: 'Protein ' },
      { type: 'text', delta: 'is on track ' },
      { type: 'text', delta: 'today.' },
      {
        type: 'usage',
        usage: { inputTokens: 1200, outputTokens: 9, cachedInputTokens: 1024, reasoningTokens: 0, estimated: false },
      },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(ff.requests[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body(ff)).toEqual({
      model: 'gpt-5.6-sol',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'You are a coach.' },
        { role: 'user', content: 'How am I doing?' },
      ],
    });
  });

  it('OpenAI parallel tool calls with fragmented arguments', async () => {
    const { model } = setup([ok(fx.OPENAI_PARALLEL_TOOLS)]);
    const evs = noUsage(await drain(model.stream(REQ)));
    expect(evs).toEqual([
      { type: 'tool_call_start', index: 0, id: 'call_k1A9xQ2', name: 'get_day' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"da' },
      { type: 'tool_call_delta', index: 0, argsDelta: 'te":"2026-' },
      { type: 'tool_call_delta', index: 0, argsDelta: '09-30"}' },
      { type: 'tool_call_start', index: 1, id: 'call_m7Pz04L', name: 'get_weight_trend' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{"days"' },
      { type: 'tool_call_delta', index: 1, argsDelta: ':14}' },
      { type: 'tool_call_end', index: 0, call: { id: 'call_k1A9xQ2', name: 'get_day', args: { date: '2026-09-30' }, rawArgs: '{"date":"2026-09-30"}' } },
      { type: 'tool_call_end', index: 1, call: { id: 'call_m7Pz04L', name: 'get_weight_trend', args: { days: 14 }, rawArgs: '{"days":14}' } },
      { type: 'done', stopReason: 'tool' },
    ]);
  });

  it('OpenRouter comments, reasoning_details and usage cost', async () => {
    const { model, ff } = setup([ok(fx.OPENROUTER_REASONING)], { preset: 'openrouter' });
    const res = await model.complete(REQ);
    expect(res.stopReason).toBe('end');
    expect(res.message.parts).toEqual([text('You logged 3 meals.')]);
    expect(res.usage).toEqual({ inputTokens: 2000, outputTokens: 30, cachedInputTokens: 0, reasoningTokens: 12, costUsd: 0.0043, estimated: false });
    expect(res.message.providerState).toEqual({
      presetId: 'openrouter',
      model: 'anthropic/claude-sonnet-5.5',
      data: [{ type: 'reasoning.text', text: 'Check the log first.', signature: 'EqQBCkYIBxgC', format: 'anthropic-claude-v1', index: 0 }],
    });
    const evs = await drain(setup([ok(fx.OPENROUTER_REASONING)], { preset: 'openrouter' }).model.stream(REQ));
    expect(evs.filter((e) => e.type === 'reasoning')).toEqual([
      { type: 'reasoning', delta: 'Check the ', visible: false },
      { type: 'reasoning', delta: 'log first.', visible: false },
    ]);
    const h = ff.requests[0]?.headers ?? {};
    expect(h.authorization).toBe('Bearer sk-test-0123456789');
    expect(h['http-referer']).toBe('https://vitals.creative.desi');
    expect(h['x-title']).toBe('Vitals');
  });

  it('DeepSeek reasoning_content then a tool call', async () => {
    const { model } = setup([ok(fx.DEEPSEEK_REASONING_TOOL)], { preset: 'deepseek' });
    const evs = await drain(model.stream(REQ));
    expect(noUsage(evs)).toEqual([
      { type: 'reasoning', delta: 'User wants ', visible: false },
      { type: 'reasoning', delta: 'the trend.', visible: false },
      { type: 'tool_call_start', index: 0, id: 'call_00_dsK3', name: 'get_weight_trend' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"days":7}' },
      { type: 'tool_call_end', index: 0, call: { id: 'call_00_dsK3', name: 'get_weight_trend', args: { days: 7 }, rawArgs: '{"days":7}' } },
      { type: 'provider_state', state: { presetId: 'deepseek', model: 'deepseek-v4.1-flash', data: 'User wants the trend.' } },
      { type: 'done', stopReason: 'tool' },
    ]);
    // Cost from the preset table (0.3 / 1.2 per 1M) because the server sent none.
    expect(usageOf(evs)).toEqual({
      type: 'usage',
      usage: { inputTokens: 500, outputTokens: 25, reasoningTokens: 6, estimated: false, costUsd: (500 * 0.3 + 25 * 1.2) / 1e6 },
    });
  });

  it('Groq <think> tags split across chunks and x_groq.usage', async () => {
    const { model } = setup([ok(fx.GROQ_THINK)], { preset: 'groq' });
    const evs = await drain(model.stream(REQ));
    expect(noUsage(evs)).toEqual([
      { type: 'reasoning', delta: 'Sum the ', visible: false },
      { type: 'reasoning', delta: 'meals.', visible: false },
      { type: 'text', delta: 'Total: 1,850 kcal.' },
      { type: 'text', delta: ' ' },
      { type: 'text', delta: '<3' },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(usageOf(evs)).toEqual({ type: 'usage', usage: { inputTokens: 300, outputTokens: 20, estimated: false } });
  });

  it('Ollama object arguments, missing id, no [DONE]', async () => {
    const { model } = setup([ok(fx.OLLAMA_TOOL_OBJECT_ARGS)], { preset: 'ollama' });
    const res = await model.complete({ ...REQ, tools: TOOLS, toolChoice: 'auto' });
    expect(res.stopReason).toBe('tool');
    expect(res.message.toolCalls).toEqual([
      { id: 'gen_1', name: 'log_meal', args: { name: 'Oats', kcal: 350 }, rawArgs: '{"name":"Oats","kcal":350}' },
    ]);
    expect(res.usage).toEqual({ inputTokens: 210, outputTokens: 18, estimated: false, costUsd: 0 });
  });

  it('Mistral 9-character ids pass through; no usage → estimated', async () => {
    const { model } = setup([ok(fx.MISTRAL_TOOL)], { preset: 'mistral' });
    const res = await model.complete(REQ);
    expect(res.stopReason).toBe('tool');
    expect(res.message.toolCalls?.[0]).toEqual({ id: 'D681PevKs', name: 'get_day', args: { date: '2026-09-30' }, rawArgs: '{"date": "2026-09-30"}' });
    expect(res.usage?.estimated).toBe(true);
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
  });

  it('mid-stream error after HTTP 200', async () => {
    const { model } = setup([ok(fx.MIDSTREAM_ERROR)], { preset: 'openrouter' });
    const evs = noUsage(await drain(model.stream(REQ)));
    expect(evs).toEqual([
      { type: 'text', delta: 'Let me ' },
      { type: 'error', error: { kind: 'overloaded', message: 'Provider returned error: upstream overloaded', retryable: true, code: '502' } },
      { type: 'done', stopReason: 'error' },
    ]);
  });

  it('skips a chunk that is not JSON instead of failing the reply as a network error', async () => {
    const body = sse(
      { choices: [{ index: 0, delta: { content: 'Hi' } }] },
      'data: {"choices":[{"index":0,"delta":{"content":"bro\n\n',
      { choices: [{ index: 0, delta: { content: ' there' }, finish_reason: 'stop' }] },
      'data: [DONE]\n\n',
    );
    const { model } = setup([ok(body)]);
    const res = await model.complete(REQ);
    expect(res.error).toBeUndefined();
    expect(res.stopReason).toBe('end');
    expect(res.message.parts).toEqual([text('Hi there')]);
  });

  it('EOF without finish_reason is a stream error', async () => {
    const { model } = setup([ok(fx.EOF_NO_FINISH)]);
    const res = await model.complete(REQ);
    expect(res.stopReason).toBe('error');
    expect(res.error?.kind).toBe('stream');
    expect(res.message.parts).toEqual([text('Your week looks')]);
  });

  it('abort mid-stream yields aborted then done:error', async () => {
    const { model } = setup([{ text: fx.OPENAI_LONG_TEXT, chunkSize: 16 }]);
    const ctrl = new AbortController();
    const evs: StreamEvent[] = [];
    for await (const ev of model.stream(REQ, ctrl.signal)) {
      evs.push(ev);
      if (ev.type === 'text') ctrl.abort();
    }
    expect(evs.filter((e) => e.type === 'text')).toHaveLength(1);
    expect(evs.at(-2)).toEqual({ type: 'usage', usage: expect.objectContaining({ estimated: true }) });
    expect(evs.find((e) => e.type === 'error')).toEqual({ type: 'error', error: { kind: 'aborted', message: 'Stopped', retryable: false } });
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });
});

describe('retry and HTTP errors', () => {
  it('429 then success after a jittered 500 ms delay', async () => {
    const { model, ff, delays } = setup([{ status: 429, json: fx.RATE_LIMIT_429 }, ok(fx.OPENAI_TEXT)]);
    const res = await model.complete(REQ);
    expect(res.stopReason).toBe('end');
    expect(ff.requests).toHaveLength(2);
    expect(delays).toEqual([500]);
  });

  it('401 is not retried', async () => {
    const { model, ff, delays } = setup([{ status: 401, json: fx.AUTH_401 }]);
    const res = await model.complete(REQ);
    expect(ff.requests).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(res.stopReason).toBe('error');
    expect(res.error).toMatchObject({ kind: 'auth', status: 401, retryable: false, code: 'invalid_api_key' });
  });
});

describe('request bodies', () => {
  it('strict tools, tool_choice and parallel_tool_calls on OpenAI', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)]);
    await model.complete({ ...REQ, tools: TOOLS, toolChoice: 'auto', parallelTools: false, maxOutputTokens: 500, temperature: 0.2, effort: 'low' });
    const b = body(ff);
    expect(b.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_day',
          description: 'Read one day',
          strict: true,
          parameters: {
            type: 'object',
            // the one strict projection (src/commands/adapters/strict.ts): an optional `T` becomes `T | null`
            properties: { date: { type: 'string' }, detail: { anyOf: [{ type: 'boolean' }, { type: 'null' }] } },
            required: ['date', 'detail'],
            additionalProperties: false,
          },
        },
      },
    ]);
    expect(b.tool_choice).toBe('auto');
    expect(b.parallel_tool_calls).toBe(false);
    expect(b.max_completion_tokens).toBe(500);
    expect(b.max_tokens).toBeUndefined();
    expect(b.temperature).toBe(0.2);
    expect(b.reasoning_effort).toBe('low');
  });

  it('non-strict tools; no tools when capability is off; no parallel flag without the capability', async () => {
    const a = setup([ok(fx.OPENAI_TEXT)], { preset: 'groq' });
    await a.model.complete({ ...REQ, tools: TOOLS, parallelTools: false });
    expect((body(a.ff).tools as Array<{ function: Record<string, unknown> }>)[0]?.function).toEqual({
      name: 'get_day', description: 'Read one day', parameters: TOOLS[0]?.inputSchema,
    });
    expect('parallel_tool_calls' in body(a.ff)).toBe(false);
    expect('stream_options' in body(a.ff)).toBe(false);
    const b = setup([ok(fx.OPENAI_TEXT)], { caps: { tools: false } });
    await b.model.complete({ ...REQ, tools: TOOLS, toolChoice: 'auto' });
    expect('tools' in body(b.ff)).toBe(false);
    expect('tool_choice' in body(b.ff)).toBe(false);
  });

  it('Ollama: no tool_choice, no auth header', async () => {
    const { model, ff } = setup([ok(fx.OLLAMA_TOOL_OBJECT_ARGS)], { preset: 'ollama', apiKey: '' });
    await model.complete({ ...REQ, tools: TOOLS, toolChoice: 'auto' });
    expect(body(ff).tools).toBeDefined();
    expect('tool_choice' in body(ff)).toBe(false);
    expect(ff.requests[0]?.headers.authorization).toBeUndefined();
    expect(ff.requests[0]?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('authHeader none sends no Authorization even with a key', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)], { preset: 'lmstudio', apiKey: 'sk-test-0123456789' });
    await model.complete(REQ);
    expect(ff.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('keeps only the last maxImages images', async () => {
    const img = (n: number) => ({ type: 'image' as const, mime: 'image/png', source: { kind: 'base64' as const, data: `AAA${n}` } });
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)], { preset: 'groq' });
    await model.complete({
      messages: [
        { role: 'user', parts: [text('first'), img(1), img(2)] },
        { role: 'assistant', parts: [text('ok')] },
        { role: 'user', parts: [text('second'), img(3), img(4)] },
      ],
    });
    expect(msgs(ff)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA2' } }] },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'second' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA3' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA4' } },
        ],
      },
    ]);
  });

  it('stripParams removes top-level keys and messages[].name (Groq)', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)], {
      preset: 'groq',
      quirks: { mistralToolIds: true, stripParams: ['messages[].name', 'temperature'] },
    });
    await model.complete({
      temperature: 0.5,
      messages: [
        user('hi'),
        { role: 'assistant', parts: [], toolCalls: [{ id: 'abcdefghi', name: 'get_day', args: {}, rawArgs: '{}' }] },
        { role: 'tool', parts: [text('{}')], toolCallId: 'abcdefghi', toolName: 'get_day' },
      ],
    });
    expect('temperature' in body(ff)).toBe(false);
    expect(msgs(ff)[2]).toEqual({ role: 'tool', tool_call_id: 'abcdefghi', content: '{}' });
  });

  it('Mistral rewrites ids consistently and names the tool result', async () => {
    const { model, ff } = setup([ok(fx.MISTRAL_TOOL)], { preset: 'mistral' });
    const longId = 'call_k1A9xQ2_long-id';
    await model.complete({
      messages: [
        user('day?'),
        {
          role: 'assistant', parts: [text('Looking.')],
          toolCalls: [
            { id: longId, name: 'get_day', args: { date: '2026-09-30' }, rawArgs: '{"date":"2026-09-30"}' },
            { id: 'D681PevKs', name: 'get_day', args: {}, rawArgs: '{}' },
          ],
        },
        { role: 'tool', parts: [text('{"kcal":1800}')], toolCallId: longId, toolName: 'get_day' },
        { role: 'tool', parts: [text('{}')], toolCallId: 'D681PevKs', toolName: 'get_day' },
      ],
    });
    const m = msgs(ff);
    const rewritten = mistralId(longId);
    expect(rewritten).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(m[1]).toEqual({
      role: 'assistant',
      content: 'Looking.',
      tool_calls: [
        { id: rewritten, type: 'function', function: { name: 'get_day', arguments: '{"date":"2026-09-30"}' } },
        { id: 'D681PevKs', type: 'function', function: { name: 'get_day', arguments: '{}' } },
      ],
    });
    expect(m[2]).toEqual({ role: 'tool', tool_call_id: rewritten, name: 'get_day', content: '{"kcal":1800}' });
    expect(m[3]).toMatchObject({ tool_call_id: 'D681PevKs', name: 'get_day' });
    expect(ff.requests[0]?.headers['http-referer']).toBeUndefined();
  });

  it('mistralId is deterministic, 9 base62 chars, and distinguishes ids', () => {
    expect(mistralId('call_1')).toBe(mistralId('call_1'));
    expect(mistralId('call_1')).not.toBe(mistralId('call_2'));
    expect(mistralId('')).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(mistralId('abc123XYZ')).toBe('abc123XYZ');
    expect(mistralId('abc123XY_')).toMatch(/^[A-Za-z0-9]{9}$/);
  });

  it('DeepSeek echoes reasoning_content only for the same preset and model', async () => {
    const asst = (presetId: string, model: string): ChatMessage => ({
      role: 'assistant', parts: [],
      toolCalls: [{ id: 'call_00_dsK3', name: 'get_weight_trend', args: { days: 7 }, rawArgs: '{"days":7}' }],
      providerState: { presetId, model, data: 'User wants the trend.' },
    });
    const { model, ff } = setup([ok(fx.OPENAI_TEXT), ok(fx.OPENAI_TEXT), ok(fx.OPENAI_TEXT)], { preset: 'deepseek' });
    const run = (m: ChatMessage) => model.complete({ messages: [user('trend?'), m, { role: 'tool', parts: [text('[]')], toolCallId: 'call_00_dsK3' }] });
    await run(asst('deepseek', 'deepseek-v4.1-flash'));
    await run(asst('deepseek', 'deepseek-v4-pro'));
    await run(asst('openrouter', 'deepseek-v4.1-flash'));
    expect(msgs(ff, 0)[1]).toEqual({
      role: 'assistant', content: null, reasoning_content: 'User wants the trend.',
      tool_calls: [{ id: 'call_00_dsK3', type: 'function', function: { name: 'get_weight_trend', arguments: '{"days":7}' } }],
    });
    expect('reasoning_content' in (msgs(ff, 1)[1] ?? {})).toBe(false);
    expect('reasoning_content' in (msgs(ff, 2)[1] ?? {})).toBe(false);
  });

  it('OpenRouter echoes reasoning_details and sends reasoning.effort', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)], { preset: 'openrouter', caps: { reasoning: true } });
    const details = [{ type: 'reasoning.text', text: 'x', signature: 's', index: 0 }];
    await model.complete({
      effort: 'medium',
      messages: [user('a'), { role: 'assistant', parts: [text('b')], providerState: { presetId: 'openrouter', model: 'anthropic/claude-sonnet-5.5', data: details } }, user('c')],
    });
    expect(msgs(ff)[1]).toEqual({ role: 'assistant', content: 'b', reasoning_details: details });
    expect(body(ff).reasoning).toEqual({ effort: 'medium' });
  });

  it('effort mapping: DeepSeek medium→high; omitted without reasoning capability', async () => {
    const a = setup([ok(fx.OPENAI_TEXT)], { preset: 'deepseek' });
    await a.model.complete({ ...REQ, effort: 'medium' });
    expect(body(a.ff).reasoning_effort).toBe('high');
    const b = setup([ok(fx.OPENAI_TEXT)], { preset: 'groq' });
    await b.model.complete({ ...REQ, effort: 'low' });
    expect('reasoning_effort' in body(b.ff)).toBe(false);
    const c = setup([ok(fx.OPENAI_TEXT)], { presetOver: { effortMap: { low: 'minimal' } } });
    await c.model.complete({ ...REQ, effort: 'low' });
    expect(body(c.ff).reasoning_effort).toBe('minimal');
    const d = setup([ok(fx.OPENAI_TEXT)], { quirks: { effortParam: 'none' } });
    await d.model.complete({ ...REQ, effort: 'low' });
    expect('reasoning_effort' in body(d.ff)).toBe(false);
  });

  it('response_format: json_schema, json_object + instruction, instruction only', async () => {
    const rs = { name: 'meal', schema: { type: 'object', properties: { kcal: { type: 'number' } } } };
    const a = setup([ok(fx.OPENAI_TEXT)]);
    await a.model.complete({ ...REQ, responseSchema: rs });
    expect(body(a.ff).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'meal', schema: rs.schema, strict: true } });
    expect(msgs(a.ff)[0]).toEqual({ role: 'system', content: 'You are a coach.' });

    const b = setup([ok(fx.OPENAI_TEXT)], { preset: 'deepseek' });
    await b.model.complete({ ...REQ, responseSchema: rs });
    expect(body(b.ff).response_format).toEqual({ type: 'json_object' });
    expect(msgs(b.ff)[0]?.content).toContain('You are a coach.\n\nReply with only a JSON object named "meal"');
    expect(msgs(b.ff)[0]?.content).toContain(JSON.stringify(rs.schema));

    const c = setup([ok(fx.OPENAI_TEXT)], { preset: 'cerebras', model: 'llama' });
    await c.model.complete({ messages: [user('lunch')], responseSchema: rs });
    expect('response_format' in body(c.ff)).toBe(false);
    expect(msgs(c.ff)).toHaveLength(2);
    expect(msgs(c.ff)[0]).toMatchObject({ role: 'system' });
    expect(String(msgs(c.ff)[0]?.content)).toContain('"kcal"');
  });

  it('noStreamOptions suppresses stream_options', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)], { quirks: { noStreamOptions: true } });
    await model.complete(REQ);
    expect('stream_options' in body(ff)).toBe(false);
    expect(body(ff).stream).toBe(true);
  });

  it('request override model is sent', async () => {
    const { model, ff } = setup([ok(fx.OPENAI_TEXT)]);
    await model.complete({ ...REQ, model: 'gpt-6-luna' });
    expect(body(ff).model).toBe('gpt-6-luna');
  });
});

describe('non-streaming fallback', () => {
  it('converts the JSON message into the same events', async () => {
    const { model, ff } = setup([{ json: fx.NON_STREAM_TOOL }], { preset: 'deepseek', caps: { streaming: false } });
    const evs = await drain(model.stream({ ...REQ, tools: TOOLS }));
    expect('stream' in body(ff)).toBe(false);
    expect('stream_options' in body(ff)).toBe(false);
    expect(noUsage(evs)).toEqual([
      { type: 'reasoning', delta: 'Need data.', visible: false },
      { type: 'text', delta: 'Checking.' },
      { type: 'tool_call_start', index: 0, id: 'call_ns_1', name: 'get_day' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"date":"2026-09-30"}' },
      { type: 'tool_call_end', index: 0, call: { id: 'call_ns_1', name: 'get_day', args: { date: '2026-09-30' }, rawArgs: '{"date":"2026-09-30"}' } },
      { type: 'provider_state', state: { presetId: 'deepseek', model: 'deepseek-v4.1-flash', data: 'Need data.' } },
      { type: 'done', stopReason: 'tool' },
    ]);
    expect(usageOf(evs)).toMatchObject({ usage: { inputTokens: 100, outputTokens: 10, estimated: false } });
  });
});

describe('misc stream shapes', () => {
  it('finish_reason stop with tool calls still returns tool; length and content_filter map', async () => {
    const chunk = (delta: unknown, finish: string | null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
    const a = setup([ok(sse(chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_day', arguments: '{}' } }] }, 'stop'), 'data: [DONE]\n\n'))]);
    expect((await a.model.complete(REQ)).stopReason).toBe('tool');
    const b = setup([ok(sse(chunk({ content: 'x' }, 'length'), 'data: [DONE]\n\n'))]);
    expect((await b.model.complete(REQ)).stopReason).toBe('length');
    const c = setup([ok(sse(chunk({ content: '' }, 'content_filter')))]);
    expect((await c.model.complete(REQ)).stopReason).toBe('refusal');
  });

  it('invalid tool JSON is reported as parseError, not thrown', async () => {
    const { model } = setup([ok(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a":' } }] }, finish_reason: 'tool_calls' }] }))]);
    const res = await model.complete(REQ);
    expect(res.message.toolCalls?.[0]).toMatchObject({ id: 'c1', args: {}, rawArgs: '{"a":' });
    expect(res.message.toolCalls?.[0]?.parseError).toMatch(/not valid JSON/);
  });
});

describe('ThinkTagSplitter', () => {
  const run = (chunks: string[]) => {
    const s = new ThinkTagSplitter();
    const out: ThinkPiece[] = [];
    for (const c of chunks) out.push(...s.push(c));
    out.push(...s.flush());
    const join = (k: ThinkPiece['kind']) => out.filter((p) => p.kind === k).map((p) => p.text).join('');
    return { text: join('text'), reasoning: join('reasoning') };
  };

  it('splits whole and char-by-char input identically', () => {
    const src = 'a<think>b < c</think>d <thinker> e';
    expect(run([src])).toEqual({ text: 'ad <thinker> e', reasoning: 'b < c' });
    expect(run([...src])).toEqual({ text: 'ad <thinker> e', reasoning: 'b < c' });
  });

  it('flushes an unfinished tag fragment as content', () => {
    expect(run(['hello <thi'])).toEqual({ text: 'hello <thi', reasoning: '' });
    expect(run(['<think>abc</thi'])).toEqual({ text: '', reasoning: 'abc</thi' });
  });
});

describe('listModels', () => {
  it('reads OpenRouter data[] with per-1M prices', async () => {
    const { model, ff } = setup([{ json: fx.OPENROUTER_MODELS }], { preset: 'openrouter' });
    expect(await model.listModels()).toEqual([
      { id: 'anthropic/claude-sonnet-5.5', label: 'Anthropic: Claude Sonnet 5.5', contextTokens: 1_000_000, price: { input: 2, output: 10, cachedInput: 0.2 } },
      { id: 'qwen/qwen3.8-27b:free', label: 'Qwen: Qwen3.8 27B (free)', contextTokens: 131_072, price: { input: 0, output: 0 } },
    ]);
    expect(ff.requests[0]).toMatchObject({ method: 'GET', url: 'https://openrouter.ai/api/v1/models' });
  });

  it('reads OpenAI ids and Ollama models[]', () => {
    expect(parseModelList(fx.OPENAI_MODELS)).toEqual([{ id: 'gpt-5.6-sol' }]);
    expect(parseModelList(fx.OLLAMA_TAGS)).toEqual([{ id: 'qwen3-vl:8b' }, { id: 'gemma4:latest' }]);
    expect(parseModelList('nope')).toEqual([]);
  });
});
