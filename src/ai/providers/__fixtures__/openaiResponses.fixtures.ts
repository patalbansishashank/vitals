/**
 * OpenAI Responses SSE fixtures. Shapes are reconstructed from the provider's docs as cited in R8 §1 (streaming event
 * names, usage details, incomplete details); they are NOT recordings made with a real key.
 */
import { sseEvents } from '../../testing/fakeFetch';

type Ev = Record<string, unknown> & { type: string };
/** Responses streams name each event and repeat the name as `type` in the data. */
const ev = (...items: Ev[]) => sseEvents(...items.map((data) => ({ event: data.type, data })));

const created = { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } };

/** Text reply with usage (cached and reasoning token details). */
export const RESPONSES_TEXT = ev(
  created,
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] } },
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'Hi' },
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: ' you' },
  {
    type: 'response.completed',
    response: {
      id: 'resp_1', status: 'completed',
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Hi you' }] }],
      usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 100 }, output_tokens: 9, output_tokens_details: { reasoning_tokens: 4 } },
    },
  },
);

export const RESPONSES_REASONING_ITEM = {
  type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Look up weight.' }], encrypted_content: 'gAAAAenc',
};

/** Reasoning summary, then two function calls with argument deltas. */
export const RESPONSES_REASONING_TOOLS = ev(
  created,
  { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, item_id: 'rs_1', delta: 'Look up ' },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, item_id: 'rs_1', delta: 'weight.' },
  { type: 'response.output_item.done', output_index: 0, item: RESPONSES_REASONING_ITEM },
  { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'get_weight', arguments: '' } },
  { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: '{"days":' },
  { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_1', delta: '7}' },
  { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'get_weight', arguments: '{"days":7}' } },
  { type: 'response.output_item.added', output_index: 2, item: { type: 'function_call', id: 'fc_2', call_id: 'call_B', name: 'get_meals', arguments: '' } },
  { type: 'response.function_call_arguments.delta', output_index: 2, item_id: 'fc_2', delta: '{"date":"2026-10-01"}' },
  { type: 'response.output_item.done', output_index: 2, item: { type: 'function_call', id: 'fc_2', call_id: 'call_B', name: 'get_meals', arguments: '{"date":"2026-10-01"}' } },
  {
    type: 'response.completed',
    response: {
      id: 'resp_2', status: 'completed',
      output: [
        RESPONSES_REASONING_ITEM,
        { type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'get_weight', arguments: '{"days":7}' },
        { type: 'function_call', id: 'fc_2', call_id: 'call_B', name: 'get_meals', arguments: '{"date":"2026-10-01"}' },
      ],
      usage: { input_tokens: 300, output_tokens: 60, output_tokens_details: { reasoning_tokens: 40 } },
    },
  },
);

/** Cut off by `max_output_tokens`. */
export const RESPONSES_INCOMPLETE = ev(
  created,
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'Long answ' },
  {
    type: 'response.incomplete',
    response: {
      id: 'resp_3', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Long answ' }] }],
      usage: { input_tokens: 40, output_tokens: 16 },
    },
  },
);

/** Mid-stream failure. */
export const RESPONSES_FAILED = ev(
  created,
  { type: 'response.failed', response: { id: 'resp_4', status: 'failed', error: { code: 'server_error', message: 'Something broke' } } },
);
