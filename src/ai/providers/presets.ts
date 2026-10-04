/**
 * Provider presets (R8 §3.2, §4.2). A provider is data, not code: base URL, adapter, auth header, quirks, default
 * model, browser reachability and a recommended-models table. Probes and prices are as of 2026-10-01.
 *
 * Model ids marked `idVerified: false` are taken from R8's model names, not from a live catalogue; the settings UI
 * should prefer `listModels()` when it answers.
 */
import type { AdapterKind, Capabilities, Effort } from './types';

export type AuthHeader = 'bearer' | 'x-api-key' | 'none';

export interface Quirks {
  /** Mistral: tool-call ids must be exactly 9 chars `[A-Za-z0-9]`; tool results must carry `name`. */
  mistralToolIds?: boolean;
  /** Do not send `tool_choice` (Ollama). */
  noToolChoice?: boolean;
  /** Field to echo prior reasoning back on assistant turns (DeepSeek thinking mode 400s without it). */
  echoReasoning?: 'reasoning_content' | 'reasoning_details' | null;
  /** Strip `<think>…</think>` from content and emit it as reasoning (Groq `raw`, some local models). */
  thinkTags?: boolean;
  /** Remote image URLs are rejected (Ollama). We always send data URLs, so this only guards custom callers. */
  imageUrlUnsupported?: boolean;
  /** Max images per request (Groq: 3). */
  maxImages?: number;
  /** Body keys removed before sending. `messages[].name` removes `name` from every message (Groq). */
  stripParams?: string[];
  /** Token-limit field name on chat completions. Default `max_tokens`; OpenAI reasoning models need the other. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** How `effort` is sent. Default `reasoning_effort`. */
  effortParam?: 'reasoning_effort' | 'openrouter' | 'deepseek' | 'none';
  /** Usage arrives in `x_groq.usage` instead of top-level `usage` (U). */
  groqUsage?: boolean;
  /** `stream_options.include_usage` is not accepted. */
  noStreamOptions?: boolean;
  /** Wrap Responses tools in `{type:'namespace', name}` (SIWC plan usage requires it). */
  toolNamespace?: string;
}

export interface RecommendedModel {
  id: string;
  label: string;
  tier: 'best' | 'balanced' | 'budget' | 'free' | 'local' | 'text-only';
  /** USD per 1M tokens, input/output (and cache read where published). */
  price?: { input: number; output: number; cachedInput?: number };
  vision: boolean;
  /** Tool-use grade prior by family (R8 §4.2), to be confirmed by the conformance suite. */
  toolsGrade: 'A' | 'A-' | 'B+' | 'B' | 'C+' | 'C';
  /** Approximate USD per typical day (80k in, 10k out). */
  usdPerDay?: number;
  idVerified: boolean;
  note?: string;
}

export interface Preset {
  id: string;
  label: string;
  adapter: AdapterKind;
  baseUrl: string;
  authHeader: AuthHeader;
  /** Headers added to every request. Mistral and Gemini get none: their CORS allow-lists reject extras. */
  extraHeaders?: Record<string, string>;
  /**
   * `browser` → the page calls the provider itself with the person's key. `server` → only through the person's Vitals
   * server (`POST /v1/ai/<id>/…`, SUITE_SPEC §14.3): the provider refuses web pages (no CORS) or the sign-in lives on the
   * server; the server adds the key or ChatGPT sign-in, the page sends none.
   */
  via: 'browser' | 'server';
  keyHelpUrl?: string;
  defaultModel: string;
  recommendedModels: RecommendedModel[];
  quirks: Quirks;
  /** Capability defaults for this provider before any probe. Merged over `BASE_CAPABILITIES`. */
  capabilities?: Partial<Capabilities>;
  /** How `effort` maps to the provider's own values. */
  effortMap?: Partial<Record<Effort, string>>;
  /** Shown when a first call fails with a CORS error (local servers). */
  corsFixText?: string;
  /** Where catalogue metadata lives, for `probe.ts`. */
  catalogue?: 'openrouter' | 'anthropic' | 'ollama' | 'ids-only';
  /** True for user-defined presets. */
  custom?: boolean;
}

/** Conservative defaults: assume nothing optional until a probe says so. */
export const BASE_CAPABILITIES: Capabilities = {
  tools: true,
  parallelTools: false,
  strictTools: false,
  vision: false,
  maxImages: 1,
  jsonSchema: false,
  jsonObject: false,
  reasoning: false,
  streaming: true,
  streamUsage: false,
  contextTokens: 32_000,
  maxOutput: 4_096,
  browserDirect: true,
  verifiedAt: null,
  source: 'preset',
};

const OR_HEADERS = { 'HTTP-Referer': 'https://vitals.creative.desi', 'X-Title': 'Vitals' };

const SONNET: RecommendedModel = {
  id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'best', price: { input: 2, output: 10, cachedInput: 0.2 },
  vision: true, toolsGrade: 'A', usdPerDay: 0.12, idVerified: true, note: 'Default "best"',
};

const builtIn: Preset[] = [
  {
    id: 'anthropic', label: 'Anthropic', adapter: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1',
    authHeader: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    via: 'browser', keyHelpUrl: 'https://platform.claude.com/settings/keys', defaultModel: 'claude-sonnet-5-5',
    catalogue: 'anthropic', quirks: {},
    capabilities: { parallelTools: true, strictTools: true, vision: true, maxImages: 20, jsonSchema: true, reasoning: true, streamUsage: true, contextTokens: 200_000, maxOutput: 32_000 },
    recommendedModels: [
      SONNET,
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'best', price: { input: 4, output: 20 }, vision: true, toolsGrade: 'A', usdPerDay: 0.25, idVerified: true, note: 'Re-planning-heavy users' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'balanced', price: { input: 1, output: 5 }, vision: true, toolsGrade: 'B+', usdPerDay: 0.13, idVerified: true, note: 'Cheap Anthropic option; 200K context' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', tier: 'best', price: { input: 10, output: 50 }, vision: true, toolsGrade: 'A', idVerified: true },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', adapter: 'openai-responses', baseUrl: 'https://api.openai.com/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-5.6-sol', quirks: {},
    catalogue: 'ids-only',
    capabilities: { parallelTools: true, strictTools: true, vision: true, maxImages: 10, jsonSchema: true, jsonObject: true, reasoning: true, streamUsage: true, contextTokens: 400_000, maxOutput: 32_000 },
    recommendedModels: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-sol', tier: 'best', price: { input: 2, output: 10 }, vision: true, toolsGrade: 'A-', usdPerDay: 0.26, idVerified: false, note: 'Default for OpenAI keys and SIWC' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-luna', tier: 'balanced', price: { input: 0.2, output: 1.2 }, vision: true, toolsGrade: 'B', usdPerDay: 0.03, idVerified: false, note: 'Cheap OpenAI option' },
      { id: 'gpt-6-luna', label: 'GPT-6-luna', tier: 'balanced', price: { input: 0.1, output: 0.5 }, vision: true, toolsGrade: 'B', idVerified: false },
    ],
  },
  {
    id: 'openai-chat', label: 'OpenAI (chat completions)', adapter: 'openai-chat', baseUrl: 'https://api.openai.com/v1',
    authHeader: 'bearer', via: 'browser', keyHelpUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-5.6-sol',
    catalogue: 'ids-only', quirks: { maxTokensField: 'max_completion_tokens' },
    capabilities: { parallelTools: true, strictTools: true, vision: true, maxImages: 10, jsonSchema: true, jsonObject: true, reasoning: true, streamUsage: true, contextTokens: 400_000, maxOutput: 32_000 },
    recommendedModels: [],
  },
  {
    id: 'openrouter', label: 'OpenRouter', adapter: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', authHeader: 'bearer',
    extraHeaders: OR_HEADERS, via: 'browser', keyHelpUrl: 'https://openrouter.ai/settings/keys',
    defaultModel: 'anthropic/claude-sonnet-5.5', catalogue: 'openrouter',
    quirks: { echoReasoning: 'reasoning_details', effortParam: 'openrouter' },
    capabilities: { streamUsage: true, contextTokens: 128_000 },
    recommendedModels: [
      { ...SONNET, id: 'anthropic/claude-sonnet-5.5', idVerified: false },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'balanced', price: { input: 0.75, output: 3.75 }, vision: true, toolsGrade: 'B+', usdPerDay: 0.1, idVerified: false, note: 'Default "balanced"' },
      { id: 'qwen/qwen3.8-flash', label: 'Qwen3.8-Flash', tier: 'budget', price: { input: 0.15, output: 0.47 }, vision: true, toolsGrade: 'B', usdPerDay: 0.02, idVerified: false, note: 'Default "budget"' },
      { id: 'qwen/qwen3.8-27b:free', label: 'Qwen3.8 27B (free)', tier: 'free', price: { input: 0, output: 0 }, vision: true, toolsGrade: 'C+', usdPerDay: 0, idVerified: true, note: 'Free tier: may be slow or unavailable' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', tier: 'free', price: { input: 0, output: 0 }, vision: true, toolsGrade: 'C+', usdPerDay: 0, idVerified: true, note: 'Free tier: may be slow or unavailable' },
    ],
  },
  {
    id: 'groq', label: 'Groq', adapter: 'openai-chat', baseUrl: 'https://api.groq.com/openai/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://console.groq.com/keys', defaultModel: 'qwen/qwen3.8-27b', catalogue: 'ids-only',
    quirks: { maxImages: 3, thinkTags: true, groqUsage: true, stripParams: ['logprobs', 'logit_bias', 'messages[].name'] },
    capabilities: { jsonObject: true, maxImages: 3, contextTokens: 128_000 },
    recommendedModels: [
      { id: 'qwen/qwen3.8-27b', label: 'Qwen3.8 27B', tier: 'budget', vision: true, toolsGrade: 'B', idVerified: false, note: 'Fast; max 3 images. gpt-oss models: no parallel tools, no vision' },
    ],
  },
  {
    id: 'mistral', label: 'Mistral', adapter: 'openai-chat', baseUrl: 'https://api.mistral.ai/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://console.mistral.ai/api-keys', defaultModel: 'mistral-medium-latest', catalogue: 'ids-only',
    quirks: { mistralToolIds: true },
    capabilities: { parallelTools: true, jsonSchema: true, jsonObject: true, contextTokens: 128_000 },
    recommendedModels: [
      { id: 'mistral-small-latest', label: 'Mistral Small 4', tier: 'budget', price: { input: 0.15, output: 0.6 }, vision: false, toolsGrade: 'B', usdPerDay: 0.02, idVerified: false },
      { id: 'mistral-medium-latest', label: 'Mistral Medium 3.5', tier: 'budget', price: { input: 1.5, output: 7.5 }, vision: true, toolsGrade: 'B', usdPerDay: 0.2, idVerified: false },
    ],
  },
  {
    id: 'deepseek', label: 'DeepSeek', adapter: 'openai-chat', baseUrl: 'https://api.deepseek.com', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://platform.deepseek.com/api_keys', defaultModel: 'deepseek-v4.1-flash', catalogue: 'ids-only',
    quirks: { echoReasoning: 'reasoning_content', effortParam: 'deepseek' },
    capabilities: { jsonObject: true, reasoning: true, streamUsage: true, contextTokens: 128_000 },
    recommendedModels: [
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', tier: 'budget', price: { input: 0.3, output: 1.2 }, vision: true, toolsGrade: 'B', usdPerDay: 0.02, idVerified: false, note: 'Price range 0.03–0.3 / 0.5–1.2 (cache-dependent); upper bound shown' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'text-only', vision: false, toolsGrade: 'A-', idVerified: false, note: 'Text only; use a separate vision model for photos' },
    ],
  },
  {
    id: 'together', label: 'Together AI', adapter: 'openai-chat', baseUrl: 'https://api.together.xyz/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://api.together.ai/settings/api-keys', defaultModel: '', catalogue: 'ids-only',
    quirks: {}, capabilities: { jsonSchema: true, jsonObject: true }, recommendedModels: [],
  },
  {
    id: 'cerebras', label: 'Cerebras', adapter: 'openai-chat', baseUrl: 'https://api.cerebras.ai/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://cloud.cerebras.ai', defaultModel: '', catalogue: 'ids-only', quirks: {}, recommendedModels: [],
  },
  {
    id: 'xai', label: 'xAI', adapter: 'openai-chat', baseUrl: 'https://api.x.ai/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://console.x.ai', defaultModel: '', catalogue: 'ids-only', quirks: {}, recommendedModels: [],
  },
  {
    id: 'fireworks', label: 'Fireworks', adapter: 'openai-chat', baseUrl: 'https://api.fireworks.ai/inference/v1', authHeader: 'bearer',
    via: 'browser', keyHelpUrl: 'https://app.fireworks.ai/settings/users/api-keys', defaultModel: '', catalogue: 'ids-only', quirks: {}, recommendedModels: [],
  },
  {
    id: 'gemini', label: 'Google Gemini', adapter: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authHeader: 'bearer', via: 'browser', keyHelpUrl: 'https://aistudio.google.com/apikey', defaultModel: 'gemini-3.8-flash',
    catalogue: 'ids-only', quirks: {},
    capabilities: { parallelTools: true, vision: true, maxImages: 10, jsonSchema: true, jsonObject: true, reasoning: true, contextTokens: 1_000_000 },
    recommendedModels: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'balanced', price: { input: 0.75, output: 3.75 }, vision: true, toolsGrade: 'B+', usdPerDay: 0.1, idVerified: false, note: 'Direct price valid until 2026-12-31' },
    ],
  },
  {
    id: 'ollama', label: 'Ollama (this computer)', adapter: 'openai-chat', baseUrl: 'http://127.0.0.1:11434/v1', authHeader: 'none',
    via: 'browser', defaultModel: 'qwen3-vl:8b', catalogue: 'ollama', quirks: { noToolChoice: true, imageUrlUnsupported: true, thinkTags: true },
    capabilities: { jsonObject: true, streamUsage: true, contextTokens: 8_192 },
    corsFixText: 'Start Ollama with OLLAMA_ORIGINS=https://vitals.creative.desi, then allow the browser\'s local network prompt.',
    recommendedModels: [
      { id: 'qwen3-vl:8b', label: 'Qwen3-VL 8B', tier: 'local', price: { input: 0, output: 0 }, vision: true, toolsGrade: 'C', usdPerDay: 0, idVerified: false, note: 'Basic tier' },
      { id: 'gemma4', label: 'Gemma 4', tier: 'local', price: { input: 0, output: 0 }, vision: true, toolsGrade: 'C', usdPerDay: 0, idVerified: false, note: 'Basic tier; 26–31B if there is GPU memory' },
    ],
  },
  {
    id: 'lmstudio', label: 'LM Studio (this computer)', adapter: 'openai-chat', baseUrl: 'http://127.0.0.1:1234/v1', authHeader: 'none',
    via: 'browser', defaultModel: '', catalogue: 'ids-only', quirks: { thinkTags: true }, capabilities: { contextTokens: 8_192 },
    corsFixText: 'In LM Studio open the server settings and turn on "Enable CORS", then allow the browser\'s local network prompt.',
    recommendedModels: [],
  },
  {
    id: 'vllm', label: 'vLLM server', adapter: 'openai-chat', baseUrl: 'http://127.0.0.1:8000/v1', authHeader: 'bearer',
    via: 'browser', defaultModel: '', catalogue: 'ids-only', quirks: {}, capabilities: { jsonSchema: true, jsonObject: true, streamUsage: true },
    corsFixText: 'Start vLLM with --allowed-origins \'["https://vitals.creative.desi"]\'. Tools need --enable-auto-tool-choice and a --tool-call-parser.',
    recommendedModels: [],
  },
  {
    id: 'nim', label: 'NVIDIA NIM', adapter: 'openai-chat', baseUrl: 'https://integrate.api.nvidia.com/v1', authHeader: 'bearer',
    via: 'server', keyHelpUrl: 'https://build.nvidia.com', defaultModel: '', catalogue: 'ids-only', quirks: {}, recommendedModels: [],
  },
  {
    id: 'opencode-zen', label: 'OpenCode Zen', adapter: 'openai-chat', baseUrl: 'https://opencode.ai/zen/v1', authHeader: 'bearer',
    via: 'server', keyHelpUrl: 'https://opencode.ai/docs/zen/', defaultModel: 'claude-sonnet-5-5', catalogue: 'ids-only', quirks: {},
    // Ids checked against GET https://opencode.ai/zen/v1/models on 2026-10-03 (86 models; "Load the model list" shows them all).
    recommendedModels: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'best', vision: true, toolsGrade: 'A', idVerified: true },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', tier: 'best', vision: true, toolsGrade: 'A', idVerified: true },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'balanced', vision: true, toolsGrade: 'A-', idVerified: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'budget', vision: true, toolsGrade: 'B+', idVerified: true },
    ],
  },
  {
    id: 'siwc', label: 'Sign in with ChatGPT', adapter: 'openai-responses', baseUrl: 'https://api.openai.com/v1',
    authHeader: 'none', via: 'server', defaultModel: 'gpt-5.6-sol', catalogue: 'ids-only', quirks: { toolNamespace: 'vitals' },
    capabilities: { parallelTools: true, strictTools: true, vision: true, jsonSchema: true, reasoning: true, streamUsage: true, contextTokens: 400_000 },
    recommendedModels: [],
  },
];

const presets = new Map<string, Preset>(builtIn.map((p) => [p.id, p]));

export function listPresets(): Preset[] {
  return [...presets.values()];
}

export function getPreset(id: string): Preset | undefined {
  return presets.get(id);
}

/** Built-in ids cannot be replaced. */
export function isBuiltInPreset(id: string): boolean {
  return builtIn.some((p) => p.id === id);
}

export interface CustomPresetInput {
  id: string;
  label: string;
  adapter: AdapterKind;
  baseUrl: string;
  authHeader?: AuthHeader;
  defaultModel?: string;
  quirks?: Quirks;
  extraHeaders?: Record<string, string>;
  capabilities?: Partial<Capabilities>;
}

/** Validates and builds a user-defined preset. Throws `TypeError` on a bad id or URL. */
export function makeCustomPreset(input: CustomPresetInput): Preset {
  if (!/^custom-[a-z0-9-]{1,40}$/.test(input.id)) throw new TypeError('Custom preset id must look like custom-<name>');
  const url = new URL(input.baseUrl);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Base URL must be https, or http on this computer');
  }
  return {
    id: input.id,
    label: input.label,
    adapter: input.adapter,
    baseUrl: url.href.replace(/\/+$/, ''),
    authHeader: input.authHeader ?? (input.adapter === 'anthropic-messages' ? 'x-api-key' : 'bearer'),
    extraHeaders:
      input.adapter === 'anthropic-messages'
        ? { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', ...input.extraHeaders }
        : input.extraHeaders,
    via: 'browser',
    defaultModel: input.defaultModel ?? '',
    recommendedModels: [],
    quirks: input.quirks ?? {},
    capabilities: input.capabilities,
    catalogue: 'ids-only',
    custom: true,
  };
}

/** Registers (or replaces) a custom preset in this session's registry. Persisting it is the settings store's job. */
export function registerCustomPreset(preset: Preset): void {
  if (!preset.custom || isBuiltInPreset(preset.id)) throw new TypeError('Only custom presets can be registered');
  presets.set(preset.id, preset);
}

export function unregisterCustomPreset(id: string): void {
  if (!isBuiltInPreset(id)) presets.delete(id);
}

/** Preset defaults merged over the base; `browserDirect` follows the preset's `via`. */
export function presetCapabilities(preset: Preset): Capabilities {
  return {
    ...BASE_CAPABILITIES,
    ...preset.capabilities,
    ...(preset.quirks.maxImages ? { maxImages: preset.quirks.maxImages } : {}),
    browserDirect: preset.via === 'browser',
    verifiedAt: null,
    source: 'preset',
  };
}

/** Price for a model from the preset's table, if listed. */
export function priceOf(preset: Preset, model: string): RecommendedModel['price'] | undefined {
  return preset.recommendedModels.find((m) => m.id === model)?.price;
}
