/**
 * SSE recordings for the `/chat/completions` adapter.
 *
 * Shapes are reconstructed from provider documentation as cited in R8 §1.2–1.7 (OpenAI streaming and usage chunk,
 * OpenRouter keep-alive comments / `reasoning_details` / `usage.cost`, DeepSeek thinking mode `reasoning_content`,
 * Groq `<think>` content and `x_groq.usage`, Ollama OpenAI-compat shim, Mistral function calling). No real-key
 * recordings exist yet; the R8 §4.3 conformance suite with real keys is still to run and should replace these.
 */
import { sse } from '../../testing/fakeFetch';

const base = (id: string, model: string) => ({ id, object: 'chat.completion.chunk', created: 1_790_000_000, model });

// --- OpenAI: plain text, finish chunk, then the usage chunk with empty `choices` ---------------------------------
const oa = base('chatcmpl-AbC123', 'gpt-5.6-sol');
export const OPENAI_TEXT = sse(
  { ...oa, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }], usage: null },
  { ...oa, choices: [{ index: 0, delta: { content: 'Protein ' }, finish_reason: null }], usage: null },
  { ...oa, choices: [{ index: 0, delta: { content: 'is on track ' }, finish_reason: null }], usage: null },
  { ...oa, choices: [{ index: 0, delta: { content: 'today.' }, finish_reason: null }], usage: null },
  { ...oa, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: null },
  {
    ...oa,
    choices: [],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 9,
      total_tokens: 1209,
      prompt_tokens_details: { cached_tokens: 1024 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
  'data: [DONE]\n\n',
);

// --- OpenAI: two parallel tool calls, arguments split across many fragments --------------------------------------
const tc = (index: number, fn: Record<string, unknown>, id?: string) => ({
  ...oa,
  choices: [{ index: 0, delta: { tool_calls: [{ index, ...(id ? { id, type: 'function' } : {}), function: fn }] }, finish_reason: null }],
});
export const OPENAI_PARALLEL_TOOLS = sse(
  { ...oa, choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] },
  tc(0, { name: 'get_day', arguments: '' }, 'call_k1A9xQ2'),
  tc(0, { arguments: '{"da' }),
  tc(0, { arguments: 'te":"2026-' }),
  tc(0, { arguments: '09-30"}' }),
  tc(1, { name: 'get_weight_trend', arguments: '' }, 'call_m7Pz04L'),
  tc(1, { arguments: '{"days"' }),
  tc(1, { arguments: ':14}' }),
  { ...oa, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  { ...oa, choices: [], usage: { prompt_tokens: 800, completion_tokens: 40, total_tokens: 840 } },
  'data: [DONE]\n\n',
);

// --- OpenRouter: keep-alive comments, reasoning + reasoning_details, usage with cost ------------------------------
const or = { ...base('gen-1790000000-XyZ', 'anthropic/claude-sonnet-5.5'), provider: 'Anthropic' };
export const OPENROUTER_REASONING = sse(
  ': OPENROUTER PROCESSING\n\n',
  ': OPENROUTER PROCESSING\n\n',
  {
    ...or,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant', content: '', reasoning: 'Check the ',
        reasoning_details: [{ type: 'reasoning.text', text: 'Check the ', format: 'anthropic-claude-v1', index: 0 }],
      },
      finish_reason: null,
    }],
  },
  {
    ...or,
    choices: [{
      index: 0,
      delta: {
        content: '', reasoning: 'log first.',
        reasoning_details: [{ type: 'reasoning.text', text: 'log first.', signature: 'EqQBCkYIBxgC', format: 'anthropic-claude-v1', index: 0 }],
      },
      finish_reason: null,
    }],
  },
  { ...or, choices: [{ index: 0, delta: { content: 'You logged 3 meals.' }, finish_reason: null }] },
  { ...or, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop', native_finish_reason: 'end_turn' }] },
  ': OPENROUTER PROCESSING\n\n',
  {
    ...or,
    choices: [],
    usage: {
      prompt_tokens: 2000, completion_tokens: 30, total_tokens: 2030, cost: 0.0043,
      prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 12 },
    },
  },
  'data: [DONE]\n\n',
);

// --- DeepSeek: thinking-mode reasoning_content, then a tool call; usage on the final chunk ----------------------
const ds = { ...base('9f3c1e7a-ds', 'deepseek-v4.1-flash'), system_fingerprint: 'fp_ds_0930' };
export const DEEPSEEK_REASONING_TOOL = sse(
  { ...ds, choices: [{ index: 0, delta: { role: 'assistant', content: null, reasoning_content: '' }, finish_reason: null }] },
  { ...ds, choices: [{ index: 0, delta: { content: null, reasoning_content: 'User wants ' }, finish_reason: null }] },
  { ...ds, choices: [{ index: 0, delta: { content: null, reasoning_content: 'the trend.' }, finish_reason: null }] },
  {
    ...ds,
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'call_00_dsK3', type: 'function', function: { name: 'get_weight_trend', arguments: '' } }] },
      finish_reason: null,
    }],
  },
  { ...ds, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"days":7}' } }] }, finish_reason: null }] },
  {
    ...ds,
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'tool_calls' }],
    usage: {
      prompt_tokens: 500, completion_tokens: 25, total_tokens: 525,
      prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 6 },
    },
  },
  'data: [DONE]\n\n',
);

// --- Groq: `<think>` in content with tags split across chunks; usage in x_groq.usage ----------------------------
const gq = { ...base('chatcmpl-gq-7a1', 'qwen/qwen3.8-27b'), system_fingerprint: 'fp_gq', x_groq: { id: 'req_01k' } };
const gqText = (content: string) => ({ ...gq, choices: [{ index: 0, delta: { content }, logprobs: null, finish_reason: null }] });
export const GROQ_THINK = sse(
  { ...gq, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, logprobs: null, finish_reason: null }] },
  gqText('<thi'),
  gqText('nk>Sum the '),
  gqText('meals.</th'),
  gqText('ink>'),
  gqText('Total: 1,850 kcal.'),
  gqText(' <'),
  gqText('3'),
  {
    ...gq,
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }],
    x_groq: { id: 'req_01k', usage: { queue_time: 0.02, prompt_tokens: 300, prompt_time: 0.01, completion_tokens: 20, completion_time: 0.03, total_tokens: 320, total_time: 0.04 } },
  },
  'data: [DONE]\n\n',
);

// --- Ollama shim: object arguments, no id, finish_reason but no [DONE] -------------------------------------------
const ol = { ...base('chatcmpl-412', 'qwen3-vl:8b'), system_fingerprint: 'fp_ollama' };
export const OLLAMA_TOOL_OBJECT_ARGS = sse(
  {
    ...ol,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: '', tool_calls: [{ index: 0, type: 'function', function: { name: 'log_meal', arguments: { name: 'Oats', kcal: 350 } } }] },
      finish_reason: null,
    }],
  },
  { ...ol, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'tool_calls' }] },
  { ...ol, choices: [], usage: { prompt_tokens: 210, completion_tokens: 18, total_tokens: 228 } },
);

// --- Mistral: 9-character ids, whole call in one chunk, no usage --------------------------------------------------
const ms = base('cmpl-e5cc70bb28c444948073e77776eb30ef', 'mistral-medium-latest');
export const MISTRAL_TOOL = sse(
  { ...ms, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  {
    ...ms,
    choices: [{
      index: 0,
      delta: { tool_calls: [{ id: 'D681PevKs', function: { name: 'get_day', arguments: '{"date": "2026-09-30"}' }, index: 0 }] },
      finish_reason: 'tool_calls',
    }],
  },
  'data: [DONE]\n\n',
);

// --- Mid-stream error after HTTP 200 -----------------------------------------------------------------------------
export const MIDSTREAM_ERROR = sse(
  { ...or, choices: [{ index: 0, delta: { role: 'assistant', content: 'Let me ' }, finish_reason: null }] },
  { ...or, error: { code: 502, message: 'Provider returned error: upstream overloaded' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] },
  'data: [DONE]\n\n',
);

// --- EOF without a finish reason (connection dropped) ------------------------------------------------------------
export const EOF_NO_FINISH = sse(
  { ...oa, choices: [{ index: 0, delta: { role: 'assistant', content: 'Your week' }, finish_reason: null }] },
  { ...oa, choices: [{ index: 0, delta: { content: ' looks' }, finish_reason: null }] },
);

// --- Long text stream for abort tests ------------------------------------------------------------------------------
export const OPENAI_LONG_TEXT = sse(
  ...Array.from({ length: 20 }, (_, i) => ({ ...oa, choices: [{ index: 0, delta: { content: `part${i} ` }, finish_reason: null }] })),
  { ...oa, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  'data: [DONE]\n\n',
);

// --- HTTP errors -----------------------------------------------------------------------------------------------------
export const RATE_LIMIT_429 = {
  error: { message: 'Rate limit reached for gpt-5.6-sol in organization org-x on tokens per min (TPM).', type: 'tokens', param: null, code: 'rate_limit_exceeded' },
};
export const AUTH_401 = {
  error: { message: 'Incorrect API key provided: sk-proj-********abcd.', type: 'invalid_request_error', param: null, code: 'invalid_api_key' },
};

// --- Non-streaming response ------------------------------------------------------------------------------------------
export const NON_STREAM_TOOL = {
  id: 'chatcmpl-ns1', object: 'chat.completion', created: 1_790_000_000, model: 'deepseek-v4.1-flash',
  choices: [{
    index: 0,
    message: {
      role: 'assistant', content: 'Checking.', reasoning_content: 'Need data.',
      tool_calls: [{ id: 'call_ns_1', type: 'function', function: { name: 'get_day', arguments: '{"date":"2026-09-30"}' } }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
};

// --- Catalogues ------------------------------------------------------------------------------------------------------
export const OPENROUTER_MODELS = {
  data: [
    {
      id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', context_length: 1_000_000,
      pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002' },
    },
    { id: 'qwen/qwen3.8-27b:free', name: 'Qwen: Qwen3.8 27B (free)', context_length: 131_072, pricing: { prompt: '0', completion: '0' } },
  ],
};
export const OPENAI_MODELS = { object: 'list', data: [{ id: 'gpt-5.6-sol', object: 'model', created: 1_780_000_000, owned_by: 'system' }] };
export const OLLAMA_TAGS = { models: [{ name: 'qwen3-vl:8b', model: 'qwen3-vl:8b', size: 6_100_000_000 }, { name: 'gemma4:latest', model: 'gemma4:latest' }] };
