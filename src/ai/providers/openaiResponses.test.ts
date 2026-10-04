// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOpenAIResponsesModel } from './openaiResponses';
import { getPreset, presetCapabilities } from './presets';
import type { AdapterConfig, Capabilities, ChatMessage, ChatRequest, ToolSpec } from './types';
import { drain, fakeFetch, instantSleep } from '../testing/fakeFetch';
import type { FakeReply } from '../testing/fakeFetch';
import {
  RESPONSES_FAILED,
  RESPONSES_INCOMPLETE,
  RESPONSES_REASONING_ITEM,
  RESPONSES_REASONING_TOOLS,
  RESPONSES_TEXT,
} from './__fixtures__/openaiResponses.fixtures';

const MODEL = 'gpt-5.6-sol';

function setup(replies: FakeReply[], presetId = 'openai', caps: Partial<Capabilities> = {}) {
  const preset = getPreset(presetId)!;
  const ff = fakeFetch(replies);
  const cfg: AdapterConfig = {
    preset,
    baseUrl: preset.baseUrl,
    model: MODEL,
    apiKey: presetId === 'siwc' ? '' : 'sk-test-key-123456789',
    capabilities: { ...presetCapabilities(preset), ...caps },
    deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0.5 },
  };
  return { ff, model: createOpenAIResponsesModel(cfg) };
}

const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] });
const TOOLS: ToolSpec[] = [
  { name: 'get_weight', description: 'Weight', inputSchema: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'] } },
];

async function bodyFor(req: ChatRequest, presetId = 'openai', caps: Partial<Capabilities> = {}) {
  const { ff, model } = setup([{ text: RESPONSES_TEXT }], presetId, caps);
  await model.complete(req);
  return ff.requests[0]!.body as Record<string, unknown> & { input: Array<Record<string, unknown>> };
}

describe('openai responses: streaming', () => {
  it('streams text and usage', async () => {
    const { ff, model } = setup([{ text: RESPONSES_TEXT }]);
    const events = await drain(model.stream({ messages: [user('hi')] }));
    expect(events).toEqual([
      { type: 'text', delta: 'Hi' },
      { type: 'text', delta: ' you' },
      {
        type: 'usage',
        usage: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 100, reasoningTokens: 4, estimated: false, costUsd: expect.any(Number) },
      },
      { type: 'done', stopReason: 'end' },
    ]);
    const r = ff.requests[0]!;
    expect(r.url).toBe('https://api.openai.com/v1/responses');
    expect(r.headers.authorization).toBe('Bearer sk-test-key-123456789');
    expect(r.body).toEqual({
      model: MODEL, stream: true, store: false, include: ['reasoning.encrypted_content'],
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    });
  });

  it('streams a reasoning summary and two function calls, with provider state', async () => {
    const { model } = setup([{ text: RESPONSES_REASONING_TOOLS, chunkSize: 11 }]);
    const events = await drain(model.stream({ messages: [user('how am I doing?')], tools: TOOLS }));
    expect(events.slice(0, -3)).toEqual([
      { type: 'reasoning', delta: 'Look up ', visible: true },
      { type: 'reasoning', delta: 'weight.', visible: true },
      { type: 'tool_call_start', index: 0, id: 'call_A', name: 'get_weight' },
      { type: 'tool_call_delta', index: 0, argsDelta: '{"days":' },
      { type: 'tool_call_delta', index: 0, argsDelta: '7}' },
      { type: 'tool_call_end', index: 0, call: { id: 'call_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days":7}' } },
      { type: 'tool_call_start', index: 1, id: 'call_B', name: 'get_meals' },
      { type: 'tool_call_delta', index: 1, argsDelta: '{"date":"2026-10-01"}' },
      { type: 'tool_call_end', index: 1, call: { id: 'call_B', name: 'get_meals', args: { date: '2026-10-01' }, rawArgs: '{"date":"2026-10-01"}' } },
    ]);
    const [stateEv, usageEv, doneEv] = events.slice(-3);
    expect(stateEv).toMatchObject({ type: 'provider_state', state: { presetId: 'openai', model: MODEL } });
    expect(stateEv?.type === 'provider_state' && (stateEv.state.data as unknown[])[0]).toEqual(RESPONSES_REASONING_ITEM);
    expect(usageEv).toMatchObject({ type: 'usage', usage: { inputTokens: 300, outputTokens: 60, reasoningTokens: 40 } });
    expect(doneEv).toEqual({ type: 'done', stopReason: 'tool' });
  });

  it('maps incomplete max_output_tokens to length', async () => {
    const { model } = setup([{ text: RESPONSES_INCOMPLETE }]);
    const result = await model.complete({ messages: [user('long')] });
    expect(result.stopReason).toBe('length');
    expect(result.message.parts).toEqual([{ type: 'text', text: 'Long answ' }]);
    expect(result.usage).toMatchObject({ inputTokens: 40, outputTokens: 16, estimated: false });
  });

  it('turns response.failed into an error', async () => {
    const { model } = setup([{ text: RESPONSES_FAILED }]);
    const result = await model.complete({ messages: [user('x')] });
    expect(result.stopReason).toBe('error');
    expect(result.error).toMatchObject({ kind: 'stream', message: 'Something broke', code: 'server_error' });
  });

  it('lists model ids', async () => {
    const { ff, model } = setup([{ json: { object: 'list', data: [{ id: 'gpt-5.6-sol', object: 'model' }, { object: 'model' }, { id: 'gpt-5.6-luna' }] } }]);
    expect(await model.listModels()).toEqual([{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-luna' }]);
    expect(ff.requests[0]!.url).toBe('https://api.openai.com/v1/models');
  });
});

describe('openai responses: request body', () => {
  it('builds instructions, developer notes, images, function calls and outputs', async () => {
    const body = await bodyFor({
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'You are a coach.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'meal' }, { type: 'image', mime: 'image/png', source: { kind: 'base64', data: 'QUJD' } }] },
        {
          role: 'assistant', parts: [{ type: 'text', text: 'Checking.' }],
          toolCalls: [{ id: 'call_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days":7}' }],
        },
        { role: 'tool', toolCallId: 'call_A', parts: [{ type: 'text', text: '81 kg' }] },
        { role: 'system', parts: [{ type: 'text', text: 'Note.' }] },
        user('ok'),
      ],
      tools: TOOLS,
      parallelTools: false,
      effort: 'medium',
      maxOutputTokens: 900,
    });
    expect(body.instructions).toBe('You are a coach.');
    expect(body.store).toBe(false);
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'meal' }, { type: 'input_image', image_url: 'data:image/png;base64,QUJD' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }] },
      { type: 'function_call', call_id: 'call_A', name: 'get_weight', arguments: '{"days":7}' },
      { type: 'function_call_output', call_id: 'call_A', output: '81 kg' },
      { role: 'developer', content: 'Note.' },
      { role: 'user', content: [{ type: 'input_text', text: 'ok' }] },
    ]);
    expect(body).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: false, reasoning: { effort: 'medium' }, max_output_tokens: 900 });
    expect(body.tools).toEqual([
      { type: 'function', name: 'get_weight', description: 'Weight', strict: true, parameters: expect.objectContaining({ additionalProperties: false }) },
    ]);
  });

  it('echoes stored output items verbatim only for the same preset and model', async () => {
    const items = [RESPONSES_REASONING_ITEM, { type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'get_weight', arguments: '{"days":7}' }];
    const history = (model: string): ChatMessage[] => [
      user('weight?'),
      {
        role: 'assistant', parts: [],
        toolCalls: [{ id: 'call_A', name: 'get_weight', args: { days: 7 }, rawArgs: '{"days":7}' }],
        providerState: { presetId: 'openai', model, data: items },
      },
      { role: 'tool', toolCallId: 'call_A', parts: [{ type: 'text', text: 'oops' }], isError: true },
    ];
    const same = await bodyFor({ messages: history(MODEL) });
    expect(same.input.slice(1)).toEqual([...items, { type: 'function_call_output', call_id: 'call_A', output: 'Error: oops' }]);
    const other = await bodyFor({ messages: history('gpt-5.6-luna') });
    expect(other.input[1]).toEqual({ type: 'function_call', call_id: 'call_A', name: 'get_weight', arguments: '{"days":7}' });
    expect(other.input).toHaveLength(3);
  });

  it('renders namespaced tools for the siwc preset', async () => {
    const { ff, model } = setup([{ text: RESPONSES_TEXT }], 'siwc');
    await model.complete({ messages: [user('x')], tools: TOOLS, toolChoice: 'none', responseSchema: { name: 'r', schema: { type: 'object' } } });
    const r = ff.requests[0]!;
    expect(r.url).toBe('https://api.openai.com/v1/responses');
    expect(r.headers.authorization).toBeUndefined();
    expect(r.body).toMatchObject({
      store: false,
      tool_choice: 'none',
      text: { format: { type: 'json_schema', name: 'r', schema: { type: 'object' }, strict: true } },
      tools: [{ type: 'namespace', name: 'vitals', tools: [{ type: 'function', name: 'get_weight', strict: true }] }],
    });
    expect(r.body).not.toHaveProperty('max_output_tokens');
  });

  it('drops reasoning and schema format when capabilities say no', async () => {
    const body = await bodyFor({ messages: [user('x')], effort: 'high', responseSchema: { name: 'r', schema: { type: 'object' } } }, 'openai', {
      reasoning: false,
      jsonSchema: false,
    });
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('include');
    expect(body).not.toHaveProperty('text');
    expect(body.instructions).toContain('{"type":"object"}');
  });
});
