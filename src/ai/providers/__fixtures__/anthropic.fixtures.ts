/**
 * Anthropic Messages SSE fixtures. Shapes are reconstructed from the provider's docs as cited in R8 §2 (streaming
 * events, usage fields, error events); they are NOT recordings made with a real key.
 */
import { sseEvents } from '../../testing/fakeFetch';

const start = (usage: Record<string, number>) => ({
  event: 'message_start',
  data: {
    type: 'message_start',
    message: { id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage },
  },
});
const stop = { event: 'message_stop', data: { type: 'message_stop' } };
const ping = { event: 'ping', data: { type: 'ping' } };
const blockStart = (index: number, content_block: Record<string, unknown>) => ({
  event: 'content_block_start',
  data: { type: 'content_block_start', index, content_block },
});
const delta = (index: number, d: Record<string, unknown>) => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: d } });
const blockStop = (index: number) => ({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
const msgDelta = (stop_reason: string, output_tokens: number) => ({
  event: 'message_delta',
  data: { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens } },
});

/** Plain text reply with cache read and cache write tokens. */
export const ANTHROPIC_TEXT = sseEvents(
  start({ input_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, output_tokens: 1 }),
  blockStart(0, { type: 'text', text: '' }),
  ping,
  delta(0, { type: 'text_delta', text: 'Hello' }),
  delta(0, { type: 'text_delta', text: ' there' }),
  blockStop(0),
  msgDelta('end_turn', 12),
  stop,
);

/** Thinking with a signature, a short text, then two parallel tool_use blocks with split partial JSON. */
export const ANTHROPIC_THINKING_TOOLS = sseEvents(
  start({ input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }),
  blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
  delta(0, { type: 'thinking_delta', thinking: 'Need weight ' }),
  delta(0, { type: 'thinking_delta', thinking: 'and meals.' }),
  delta(0, { type: 'signature_delta', signature: 'EqQBCgIYAh' }),
  blockStop(0),
  blockStart(1, { type: 'text', text: '' }),
  delta(1, { type: 'text_delta', text: 'Checking.' }),
  blockStop(1),
  blockStart(2, { type: 'tool_use', id: 'toolu_A', name: 'get_weight', input: {} }),
  delta(2, { type: 'input_json_delta', partial_json: '' }),
  delta(2, { type: 'input_json_delta', partial_json: '{"days"' }),
  delta(2, { type: 'input_json_delta', partial_json: ': 7}' }),
  blockStop(2),
  blockStart(3, { type: 'tool_use', id: 'toolu_B', name: 'get_meals', input: {} }),
  delta(3, { type: 'input_json_delta', partial_json: '{"date": "2026-' }),
  delta(3, { type: 'input_json_delta', partial_json: '10-01"}' }),
  blockStop(3),
  msgDelta('tool_use', 90),
  stop,
);

/** Overloaded `error` event after some text (HTTP 200). */
export const ANTHROPIC_OVERLOADED_MIDSTREAM = sseEvents(
  start({ input_tokens: 10, output_tokens: 1 }),
  blockStart(0, { type: 'text', text: '' }),
  delta(0, { type: 'text_delta', text: 'Partial' }),
  { event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
);

/** Body of an HTTP 529. */
export const ANTHROPIC_529_BODY = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };

/** Refusal stop. */
export const ANTHROPIC_REFUSAL = sseEvents(
  start({ input_tokens: 15, output_tokens: 1 }),
  blockStart(0, { type: 'text', text: '' }),
  delta(0, { type: 'text_delta', text: 'I can’t help with that.' }),
  blockStop(0),
  msgDelta('refusal', 8),
  stop,
);

/** `GET /v1/models` page. */
export const ANTHROPIC_MODELS = {
  data: [
    {
      type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-08-01T00:00:00Z',
      max_input_tokens: 1_000_000, max_tokens: 64_000,
      capabilities: { image_input: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true } },
    },
    { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000, capabilities: { vision: false, tool_use: true } },
    { type: 'model', display_name: 'no id' },
  ],
  has_more: false,
};
