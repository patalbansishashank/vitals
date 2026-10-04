// @vitest-environment node
/**
 * End to end through the public pieces: factory → adapter stream → ToolRunner (mock command port) → tool result
 * message → second request. Runs once per wire dialect with a scripted fake server.
 */
import { createChatModel, type ChatMessage } from './providers';
import { MOCK_COMMANDS, createMockPort } from './tools/__fixtures__/mockCommands';
import { ToolRegistry, ToolRunner } from './tools';
import { fakeFetch, instantSleep, sse, sseEvents, type FakeReply } from './testing/fakeFetch';

const ARGS = { metric: 'weight', value: 81.4, unit: 'kg' };

const toolTurn: Record<string, FakeReply> = {
  'openai-chat': {
    text: sse(
      { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_w1', type: 'function', function: { name: 'log_measurement', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(ARGS) } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } },
      'data: [DONE]\n\n',
    ),
  },
  'anthropic-messages': {
    text: sseEvents(
      { event: 'message_start', data: { type: 'message_start', message: { id: 'm1', role: 'assistant', content: [], usage: { input_tokens: 900, output_tokens: 1 } } } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_w1', name: 'log_measurement', input: {} } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(ARGS) } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ),
  },
  'openai-responses': {
    text: sseEvents(
      { event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_w1', name: 'log_measurement', arguments: '' } } },
      { event: 'response.function_call_arguments.delta', data: { type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify(ARGS) } },
      { event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_w1', name: 'log_measurement', arguments: JSON.stringify(ARGS) } } },
      { event: 'response.completed', data: { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 900, output_tokens: 20 } } } },
    ),
  },
};

const textTurn: Record<string, FakeReply> = {
  'openai-chat': { text: sse({ choices: [{ index: 0, delta: { content: 'Logged 81.4 kg.' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 950, completion_tokens: 8 } }, 'data: [DONE]\n\n') },
  'anthropic-messages': {
    text: sseEvents(
      { event: 'message_start', data: { type: 'message_start', message: { id: 'm2', role: 'assistant', content: [], usage: { input_tokens: 950, output_tokens: 1 } } } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Logged 81.4 kg.' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ),
  },
  'openai-responses': {
    text: sseEvents(
      { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', output_index: 0, delta: 'Logged 81.4 kg.' } },
      { event: 'response.completed', data: { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 950, output_tokens: 8 } } } },
    ),
  },
};

describe.each([
  ['openai-chat', 'openrouter'],
  ['anthropic-messages', 'anthropic'],
  ['openai-responses', 'openai'],
] as const)('%s end to end (%s preset)', (adapter, presetId) => {
  it('streams a tool call, applies it once through the runner and sends the result back', async () => {
    const ff = fakeFetch([toolTurn[adapter]!, textTurn[adapter]!]);
    const model = createChatModel({ preset: presetId, apiKey: 'test-key-0000', deps: { fetch: ff.fetch, sleep: instantSleep().sleep } });
    expect(model.adapter).toBe(adapter);

    const registry = new ToolRegistry(MOCK_COMMANDS);
    const port = createMockPort();
    let n = 0;
    const runner = new ToolRunner({ registry, port, now: () => '2026-10-01T08:00:00.000Z', newId: () => `p${++n}` });
    const tools = registry.toolSpecs({ tier: 'full' });

    const history: ChatMessage[] = [
      { role: 'system', parts: [{ type: 'text', text: 'You are the Vitals coach.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'I weighed 81.4 kg this morning' }] },
    ];
    runner.beginTurn();
    const first = await model.complete({ messages: history, tools, toolChoice: 'auto' });
    expect(first.stopReason).toBe('tool');
    expect(first.message.toolCalls).toHaveLength(1);
    const call = first.message.toolCalls![0]!;
    expect(call.name).toBe('log_measurement');
    expect(call.args).toEqual(ARGS);

    const handled = await runner.handleCall('conv1', call);
    expect(handled.envelope).toMatchObject({ ok: true, status: 'applied' });
    // A retried stream repeating the same call does not write twice.
    await runner.handleCall('conv1', call);
    expect(port.executed).toHaveLength(1);
    expect(port.executed[0]?.opts.idempotencyKey).toBe(`conv1:${call.id}`);

    history.push(first.message, handled.message);
    const second = await model.complete({ messages: history, tools });
    expect(second.stopReason).toBe('end');
    expect(second.message.parts).toEqual([{ type: 'text', text: 'Logged 81.4 kg.' }]);
    expect(second.usage?.estimated).toBe(false);

    // The second request carries the call and its result in the dialect's own shape.
    const body = JSON.stringify(ff.requests[1]!.body);
    expect(body).toContain(call.id);
    expect(body).toContain('log_measurement');
    expect(ff.pending()).toBe(0);
  });
});
