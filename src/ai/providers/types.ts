/**
 * Canonical, provider-neutral chat types (R8 §3.1). Every adapter converts to and from these; nothing outside
 * `src/ai/providers/<adapter>.ts` sees a wire format.
 *
 * Tier H (SUITE_SPEC §0.2): no DOM, no React; IO only through the injected `fetch` port.
 */

/** JSON Schema (draft 2020-12 subset: object, properties, required, additionalProperties, enum, items, no $ref). */
import type { Preset } from './presets';

export type JsonSchema = { [k: string]: unknown };

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Image source. Base64 is rebuilt from `localRef` by the caller when sending and is never stored in a transcript
 * (R8 §3.1). Blobs are converted to base64 by `resolveImage` right before the request.
 */
export type ImageSource =
  | { kind: 'base64'; data: string }
  | { kind: 'dataUrl'; url: string }
  | { kind: 'blob'; blob: Blob };

export type Part =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      /** `image/jpeg`, `image/png`, `image/webp` or `image/gif`. */
      mime: string;
      source: ImageSource;
      /** Pixel size, used for token estimates. */
      width?: number;
      height?: number;
      /** Id of the photo kept in IndexedDB. */
      localRef?: string;
    };

/**
 * Opaque round-trip data (Anthropic thinking blocks with signatures, DeepSeek `reasoning_content`, OpenRouter
 * `reasoning_details`, Responses output items). Echoed back only to the same preset and model, otherwise dropped.
 */
export interface ProviderState {
  presetId: string;
  model: string;
  data: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments; `{}` when `parseError` is set. */
  args: Record<string, unknown>;
  /** Arguments exactly as the model produced them. */
  rawArgs: string;
  parseError?: string;
}

export interface ChatMessage {
  role: Role;
  parts: Part[];
  /** Assistant only. */
  toolCalls?: ToolCall[];
  /** Tool only: the call this result answers. */
  toolCallId?: string;
  /** Tool only: the tool name (Mistral requires it on the result message). */
  toolName?: string;
  /** Tool only: the result is an error the model should correct (Anthropic `is_error`). */
  isError?: boolean;
  providerState?: ProviderState;
}

/** A tool as the model sees it. Rendering per adapter lives in `src/ai/tools/render.ts`. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type Effort = 'low' | 'medium' | 'high';

export interface ResponseSchema {
  name: string;
  schema: JsonSchema;
}

export interface ChatRequest {
  /** Overrides the model bound to the ChatModel. */
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Forced choice is not portable (Anthropic 5.x returns 400), so only these two. */
  toolChoice?: 'auto' | 'none';
  /** `false` asks the provider for at most one call per step where it has a switch. */
  parallelTools?: boolean;
  effort?: Effort;
  maxOutputTokens?: number;
  /** Structured output. Unsupported → adapter falls back per capabilities (json_object, then instruction). */
  responseSchema?: ResponseSchema;
  temperature?: number;
  /** Index of the last message of the stable (cacheable) prefix. */
  cacheHint?: number;
}

export interface Usage {
  /** All input tokens, including cached ones. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** Anthropic cache writes. */
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  /** True when the server reported nothing and the numbers come from `estimateUsage`. */
  estimated: boolean;
}

export type StopReason = 'end' | 'tool' | 'length' | 'refusal' | 'error';

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string; visible: boolean }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; argsDelta: string }
  | { type: 'tool_call_end'; index: number; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  /** Emitted once before `done` when the adapter has round-trip data for the assistant message. */
  | { type: 'provider_state'; state: ProviderState }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error: ProviderErrorInfo };

export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'bad_request'
  | 'unsupported_param'
  | 'model_not_found'
  | 'context_length'
  | 'content_policy'
  | 'network'
  | 'cors'
  | 'blocked'
  | 'aborted'
  | 'stream';

/** Plain-data form of `ProviderError` (safe to put in events, logs and stores; never contains a key). */
export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  message: string;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
  /** Provider's own error code or type, when present. */
  code?: string;
}

export type AdapterKind = 'openai-chat' | 'anthropic-messages' | 'openai-responses';

export interface Capabilities {
  tools: boolean;
  parallelTools: boolean;
  /** `strict: true` on tool definitions is honoured. */
  strictTools: boolean;
  vision: boolean;
  /** Max images per request (Groq: 3). */
  maxImages: number;
  jsonSchema: boolean;
  jsonObject: boolean;
  reasoning: boolean;
  streaming: boolean;
  /** Usage is reported on streams (`stream_options.include_usage` or native). */
  streamUsage: boolean;
  contextTokens: number;
  maxOutput: number;
  browserDirect: boolean;
  /** Instant (ISO) of the probe, or null for preset defaults. */
  verifiedAt: string | null;
  source: 'catalog' | 'selftest' | 'preset';
}

export interface ModelInfo {
  id: string;
  label?: string;
  contextTokens?: number;
  /** USD per 1M tokens. */
  price?: { input: number; output: number; cachedInput?: number };
  /** Partial capabilities when the catalogue says so. */
  capabilities?: Partial<Capabilities>;
}

/** Collected result of a stream (`collect` in `stream.ts`). */
export interface ChatResult {
  message: ChatMessage;
  usage: Usage | null;
  stopReason: StopReason;
  error?: ProviderErrorInfo;
}

/**
 * The wrapper every adapter implements (R8 "Provider"). Bound to one preset, base URL, key and model.
 * `stream` never throws for provider problems: it yields an `error` event followed by `done:'error'`.
 * It only rejects on programmer errors.
 */
export interface ChatModel {
  readonly adapter: AdapterKind;
  readonly presetId: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Capabilities currently assumed for this model (probe result if supplied, else preset defaults). */
  readonly capabilities: Capabilities;
  stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  /** `stream` collected into one result. */
  complete(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

/** Ports injected into adapters (tier H: no ambient IO). */
export interface AdapterDeps {
  fetch: typeof fetch;
  /** Retry backoff sleep; tests pass an instant one. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Uniform [0,1) for jitter; tests pass a constant. */
  random?: () => number;
  /** Base URLs that have answered at least once (a first-call `TypeError` there is `network`, not `cors`). */
  reachedBaseUrls?: Set<string>;
  /** Id source for tool calls the server left without an id (Ollama). Default `crypto.randomUUID`. */
  newId?: () => string;
  /** Wall clock in ms, used only to read HTTP-date `retry-after` values. */
  nowMs?: () => number;
}

export interface AdapterConfig {
  preset: Preset;
  /** Effective base URL (custom presets and local servers override the preset's). */
  baseUrl: string;
  model: string;
  /** API key; empty for `authHeader: 'none'` presets and Companion routes. */
  apiKey: string;
  capabilities: Capabilities;
  deps: AdapterDeps;
}
