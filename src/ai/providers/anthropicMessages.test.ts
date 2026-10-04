// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAnthropicMessagesModel } from './anthropicMessages';
import { getPreset, presetCapabilities } from './presets';
import type { AdapterConfig, Capabilities, ChatMessage, ChatRequest, Part, ToolSpec } from './types';
import { drain, fakeFetch, instantSleep } from '../testing/fakeFetch';
import type { FakeReply } from '../testing/fakeFetch';
import {
  ANTHROPIC_529_BODY,
  ANTHROPIC_MODELS,
  ANTHROPIC_OVERLOADED_MIDSTREAM,
  ANTHROPIC_REFUSAL,
  ANTHROPIC_TEXT,
  ANTHROPIC_THINKING_TOOLS,
} from './__fixtures__/anthropic.fixtures';

const MODEL = 'claude-sonnet-5-5';

function setup(replies: FakeReply[], caps: Partial<Capabilities> = {}, model = MODEL) {
  const preset = getPreset('anthropic')!;
  const ff = fakeFetch(replies);
  const sleeper = instantSleep();
  const cfg: AdapterConfig = {
    preset,
    baseUrl: preset.baseUrl,
    model,
    apiKey: 'sk-ant-test-key-123456',
    capabilities: { ...presetCapabilities(preset), ...caps },
    deps: { fetch: ff.fetch, sleep: sleeper.sleep, random: () => 0.5 },
  };
  return { ff, sleeper, model: createAnthropicMessagesModel(cfg) };
}

const user = (text: string, extra: Part[] = []): ChatMessage => ({ role: 'user', parts: [...extra, { type: 'text', text }] });
const img = (data: string): Part => ({ type: 'image', mime: 'image/jpeg', source: { kind: 'base64', data } });
const TOOLS: ToolSpec[] = [
  { name: 'get_weight', description: 'Weight', inputSchema: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'] } },
  { name: 'get_meals', description: 'Meals', inputSchema: { type: 'object', properties: { date: { type: 'string' } } } },
];

/** Body of the only request sent for `req`. */
async function bodyFor(req: ChatRequest, caps: Partial<Capabilities> = {}) {
  const { ff, model } = setup([{ text: ANTHROPIC_TEXT }], caps);
  await model.complete(req);
  return ff.requests[0]!.body as Record<string, unknown> & { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };
}

describe('anthropic messages: streaming', () => {
  it('streams text with cache-aware usage and sends the browser headers', async () => {
    const { ff, model } = setup([{ text: ANTHROPIC_TEXT }]);
    const events = await drain(model.stream({ messages: [user('hi')] }));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'usage', 'done']);
    expect(events.slice(0, 2)).toEqual([{ type: 'text', delta: 'Hello' }, { type: 'text', delta: ' there' }]);
    const usage = events[2]!;
    expect(usage).toMatchObject({
      type: 'usage',
      usage: { inputTokens: 1320, cachedInputTokens: 1000, cacheWriteTokens: 300, outputTokens: 12, estimated: false },
    });
    expect(usage.type === 'usage' && usage.usage.costUsd).toBeCloseTo((320 * 2 + 1000 * 0.2 + 12 * 10) / 1e6, 12);
    expect(events[3]).toEqual({ type: 'done', stopReason: 'end' });

    const r = ff.requests[0]!;
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.method).toBe('POST');
    expect(r.headers['x-api-key']).toBe('sk-ant-test-key-123456');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(r.headers.authorization).toBeUndefined();
    expect(r.body).toMatchObject({ model: MODEL, max_tokens: 8192, stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
    expect(r.body).not.toHaveProperty('temperature');
    expect(r.body).not.toHaveProperty('tools');
  });

  it('streams thinking, two parallel tool calls and provider state', async () => {
    const { model } = setup([{ text: ANTHROPIC_THINKING_TOOLS, chunkSize: 5 }]);
    const events = await drain(model.stream({ messages: [user('how am I doing?')], tools: TOOLS }));
    const [stateEv, usageEv, doneEv] = events.slice(-3);
    expect(events.slice(0, -3)).toEqual([
      { type: 'reasoning', delta: 'Need weight ', visible: true },
      { type: 'reasoning', delta: 'and meals.', visible: true },
      { type: 'text', delta: 'Checking.' },
      { type: 'tool_call_start', index: 0, id: 'toolu_A', name: 'get_weight' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"days"' },
      { type: 'tool_call_delta', index: 0, argsDelta: ': 7}' },
      { type: 'tool_call_end', index: 0, call: { id: 'toolu_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days": 7}' } },
      { type: 'tool_call_start', index: 1, id: 'toolu_B', name: 'get_meals' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{"date": "2026-' },
      { type: 'tool_call_delta', index: 1, argsDelta: '10-01"}' },
      { type: 'tool_call_end', index: 1, call: { id: 'toolu_B', name: 'get_meals', args: { date: '2026-10-01' }, rawArgs: '{"date": "2026-10-01"}' } },
    ]);
    expect(stateEv).toEqual({
      type: 'provider_state',
      state: {
        presetId: 'anthropic',
        model: MODEL,
        data: [
          { type: 'thinking', thinking: 'Need weight and meals.', signature: 'EqQBCgIYAh' },
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_A', name: 'get_weight', input: { days: 7 } },
          { type: 'tool_use', id: 'toolu_B', name: 'get_meals', input: { date: '2026-10-01' } },
        ],
      },
    });
    expect(usageEv).toMatchObject({ type: 'usage', usage: { inputTokens: 50, outputTokens: 90, cachedInputTokens: 0, cacheWriteTokens: 0 } });
    expect(doneEv).toEqual({ type: 'done', stopReason: 'tool' });
  });

  it('omits provider state when there are no thinking blocks', async () => {
    const { model } = setup([{ text: ANTHROPIC_TEXT }]);
    const result = await model.complete({ messages: [user('hi')] });
    expect(result.message).toEqual({ role: 'assistant', parts: [{ type: 'text', text: 'Hello there' }] });
    expect(result.stopReason).toBe('end');
  });

  it('turns an overloaded error event into error + done:error (no retry mid-stream)', async () => {
    const { ff, model } = setup([{ text: ANTHROPIC_OVERLOADED_MIDSTREAM }]);
    const events = await drain(model.stream({ messages: [user('hi')] }));
    expect(events.map((e) => e.type)).toEqual(['text', 'error', 'usage', 'done']);
    expect(events[1]).toMatchObject({ type: 'error', error: { kind: 'overloaded', retryable: true, message: 'Overloaded', code: 'overloaded_error' } });
    expect(events[2]).toMatchObject({ type: 'usage', usage: { estimated: true } });
    expect(events[3]).toEqual({ type: 'done', stopReason: 'error' });
    expect(ff.requests).toHaveLength(1);
  });

  it('retries a 529 and honours retry-after', async () => {
    const { ff, sleeper, model } = setup([
      { status: 529, headers: { 'retry-after': '2' }, json: ANTHROPIC_529_BODY },
      { text: ANTHROPIC_TEXT },
    ]);
    const result = await model.complete({ messages: [user('hi')] });
    expect(result.stopReason).toBe('end');
    expect(result.message.parts).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(sleeper.delays).toEqual([2000]);
    expect(ff.requests).toHaveLength(2);
  });

  it('retries a 529 without retry-after using jittered backoff', async () => {
    const { sleeper, model } = setup([{ status: 529, json: ANTHROPIC_529_BODY }, { text: ANTHROPIC_TEXT }]);
    await model.complete({ messages: [user('hi')] });
    expect(sleeper.delays).toEqual([500]);
  });

  it('maps a refusal stop', async () => {
    const { model } = setup([{ text: ANTHROPIC_REFUSAL }]);
    const result = await model.complete({ messages: [user('bad')] });
    expect(result.stopReason).toBe('refusal');
    expect(result.usage).toMatchObject({ inputTokens: 15, outputTokens: 8, estimated: false });
  });
});

describe('anthropic messages: request body', () => {
  it('merges consecutive tool results and a following user message into one user turn', async () => {
    const body = await bodyFor({
      messages: [
        user('weigh and meals?'),
        {
          role: 'assistant', parts: [{ type: 'text', text: 'Checking.' }],
          toolCalls: [
            { id: 'toolu_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days":7}' },
            { id: 'toolu_B', name: 'get_meals', args: {}, rawArgs: '{}' },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_A', parts: [{ type: 'text', text: '81.2 kg' }] },
        { role: 'tool', toolCallId: 'toolu_B', parts: [{ type: 'text', text: 'bad date' }], isError: true },
        user('also, thanks'),
      ],
    });
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'weigh and meals?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_A', name: 'get_weight', input: { days: 7 } },
          { type: 'tool_use', id: 'toolu_B', name: 'get_meals', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_A', content: '81.2 kg' },
          { type: 'tool_result', tool_use_id: 'toolu_B', content: 'bad date', is_error: true },
          { type: 'text', text: 'also, thanks' },
        ],
      },
    ]);
  });

  it('puts leading system messages in `system` and later ones in a <system-note> user block', async () => {
    const body = await bodyFor({
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'You are a coach.' }] },
        { role: 'system', parts: [{ type: 'text', text: 'Briefing.' }] },
        user('hi'),
        { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
        { role: 'system', parts: [{ type: 'text', text: 'User logged a meal.' }] },
        user('what now?'),
      ],
    });
    expect(body.system).toEqual([
      { type: 'text', text: 'You are a coach.' },
      { type: 'text', text: 'Briefing.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'user', content: [{ type: 'text', text: '<system-note>User logged a meal.</system-note>' }, { type: 'text', text: 'what now?' }] },
    ]);
    expect(body.messages.every((m, i, a) => i === 0 || a[i - 1]!.role !== m.role)).toBe(true);
  });

  const thinkingState = [
    { type: 'thinking', thinking: 'Plan.', signature: 'sig==' },
    { type: 'tool_use', id: 'toolu_A', name: 'get_weight', input: { days: 7 } },
  ];
  const history = (stateModel: string): ChatMessage[] => [
    user('weight?'),
    {
      role: 'assistant', parts: [],
      toolCalls: [{ id: 'toolu_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days":7}' }],
      providerState: { presetId: 'anthropic', model: stateModel, data: thinkingState },
    },
    { role: 'tool', toolCallId: 'toolu_A', parts: [{ type: 'text', text: '81 kg' }] },
  ];

  it('echoes thinking blocks verbatim for the same preset and model', async () => {
    const body = await bodyFor({ messages: history(MODEL), cacheHint: 1 });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [thinkingState[0], { ...thinkingState[1], cache_control: { type: 'ephemeral' } }],
    });
    // The stored state is not mutated by cache marking.
    expect(thinkingState[1]).not.toHaveProperty('cache_control');
  });

  it('drops thinking blocks for another model and rebuilds from tool calls', async () => {
    const body = await bodyFor({ messages: history('claude-opus-5-5') });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_A', name: 'get_weight', input: { days: 7 } }],
    });
  });

  it('places at most 4 cache breakpoints: last tool, last system block, cache hint', async () => {
    const body = await bodyFor({
      messages: [{ role: 'system', parts: [{ type: 'text', text: 'Sys' }] }, user('a'), { role: 'assistant', parts: [{ type: 'text', text: 'b' }] }, user('c')],
      tools: TOOLS,
      cacheHint: 2,
    });
    const json = JSON.stringify(body);
    const count = json.split('"cache_control"').length - 1;
    expect(count).toBe(3);
    expect(count).toBeLessThanOrEqual(4);
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]).not.toHaveProperty('cache_control');
    expect(tools[1]).toMatchObject({ name: 'get_meals', strict: true, cache_control: { type: 'ephemeral' } });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }] });
  });

  it('never forces tool_choice; none and disable_parallel_tool_use pass through', async () => {
    const auto = await bodyFor({ messages: [user('x')], tools: TOOLS, parallelTools: false });
    expect(auto.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    const none = await bodyFor({ messages: [user('x')], tools: TOOLS, toolChoice: 'none' });
    expect(none.tool_choice).toEqual({ type: 'none' });
    const off = await bodyFor({ messages: [user('x')], tools: TOOLS }, { tools: false });
    expect(off).not.toHaveProperty('tools');
    expect(off).not.toHaveProperty('tool_choice');
  });

  it('sends images before text and keeps only the last maxImages', async () => {
    const body = await bodyFor(
      { messages: [user('first', [img('AAA')]), { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }, { role: 'user', parts: [{ type: 'text', text: 'second' }, img('BBB'), img('CCC')] }] },
      { maxImages: 2 },
    );
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'first' }] });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'CCC' } },
        { type: 'text', text: 'second' },
      ],
    });
  });

  it('maps effort, response schema, max tokens and temperature', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const body = await bodyFor({ messages: [user('x')], effort: 'low', responseSchema: { name: 'r', schema }, maxOutputTokens: 500, temperature: 0.2 });
    expect(body).toMatchObject({ max_tokens: 500, temperature: 0.2, output_config: { effort: 'low', format: { type: 'json_schema', schema } } });

    const fallback = await bodyFor({ messages: [user('x')], effort: 'low', responseSchema: { name: 'r', schema } }, { jsonSchema: false, reasoning: false });
    expect(fallback).not.toHaveProperty('output_config');
    const sys = fallback.system as Array<{ text: string }>;
    expect(sys[sys.length - 1]!.text).toContain(JSON.stringify(schema));
  });
});

describe('anthropic messages: listModels', () => {
  it('parses ids, labels, limits and capabilities defensively', async () => {
    const { ff, model } = setup([{ json: ANTHROPIC_MODELS }]);
    const models = await model.listModels();
    expect(ff.requests[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(ff.requests[0]!.method).toBe('GET');
    expect(models).toEqual([
      {
        id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextTokens: 1_000_000,
        capabilities: { contextTokens: 1_000_000, maxOutput: 64_000, vision: true, jsonSchema: true, reasoning: true },
      },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextTokens: 200_000, capabilities: { contextTokens: 200_000, vision: false, tools: true } },
    ]);
  });
});
