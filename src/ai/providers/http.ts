/**
 * Shared plumbing for adapters: URLs, auth headers, the retried request phase, stream guarding and collection.
 * Adapters only translate shapes; everything about transport and failure handling lives here.
 */
import { classifyFetchFailure, classifyHttpError, ProviderError } from './errors';
import { withRetry } from './retry';
import { addUsage, costUsd, estimateUsage } from './usage';
import { priceOf } from './presets';
import type {
  AdapterConfig,
  AdapterKind,
  ChatModel,
  ChatRequest,
  ChatResult,
  ModelInfo,
  Part,
  ProviderState,
  StopReason,
  StreamEvent,
  ToolCall,
  Usage,
} from './types';

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function authHeaders(cfg: AdapterConfig): Record<string, string> {
  const h: Record<string, string> = { ...cfg.preset.extraHeaders };
  if (cfg.apiKey) {
    if (cfg.preset.authHeader === 'bearer') h.Authorization = `Bearer ${cfg.apiKey}`;
    else if (cfg.preset.authHeader === 'x-api-key') h['x-api-key'] = cfg.apiKey;
  }
  return h;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Sends a request with the retry policy and returns the successful `Response` (body unread). Throws `ProviderError`.
 * Only this phase is retried (see retry.ts).
 */
export async function request(
  cfg: AdapterConfig,
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  signal?: AbortSignal,
): Promise<Response> {
  const { deps } = cfg;
  const headers: Record<string, string> = authHeaders(cfg);
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await deps.fetch(url, {
          method: init.method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal,
        });
      } catch (err) {
        throw classifyFetchFailure(err, !deps.reachedBaseUrls?.has(cfg.baseUrl), signal);
      }
      deps.reachedBaseUrls?.add(cfg.baseUrl);
      if (!res.ok) throw classifyHttpError(res.status, await readBody(res), res.headers.get('retry-after'), deps.nowMs?.());
      return res;
    },
    { sleep: deps.sleep, random: deps.random },
    signal,
  );
}

export async function getJson(cfg: AdapterConfig, url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await request(cfg, url, { method: 'GET' }, signal);
  return res.json();
}

/** Parses tool arguments. Ollama native returns an object; small models emit invalid JSON (R8 §1.2). */
export function finishToolCall(id: string, name: string, raw: string | Record<string, unknown> | undefined): ToolCall {
  if (raw !== undefined && typeof raw === 'object') return { id, name, args: raw, rawArgs: JSON.stringify(raw) };
  const rawArgs = raw ?? '';
  if (rawArgs.trim() === '') return { id, name, args: {}, rawArgs };
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { id, name, args: parsed as Record<string, unknown>, rawArgs };
    return { id, name, args: {}, rawArgs, parseError: 'Arguments must be a JSON object' };
  } catch (e) {
    return { id, name, args: {}, rawArgs, parseError: `Arguments are not valid JSON: ${(e as Error).message}` };
  }
}

export function newCallId(cfg: AdapterConfig): string {
  return cfg.deps.newId?.() ?? `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** Text of a message's text parts joined with blank lines. */
export function textOf(parts: Part[]): string {
  return parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n');
}

/** Provider state is echoed only to the same preset and model (R8 §3.1). */
export function ownState(cfg: AdapterConfig, state: ProviderState | undefined, model: string): unknown {
  return state && state.presetId === cfg.preset.id && state.model === model ? state.data : undefined;
}

/**
 * Wraps an adapter's raw event generator so that the public stream:
 * - never throws for provider problems (yields `error` then `done:'error'`),
 * - always ends with exactly one `done`,
 * - always reports usage (estimated when the server sent none), with cost from the preset table; a request that
 *   failed before the provider sent anything (401, 429 after the retries, CORS, offline) reports zero tokens, so the
 *   spend ledger and the monthly cap are not charged for work that never happened.
 */
export async function* guardStream(
  cfg: AdapterConfig,
  req: ChatRequest,
  inner: AsyncIterable<StreamEvent>,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let usage: Usage | null = null;
  let text = '';
  let stop: StopReason | null = null;
  let received = false;
  const model = req.model ?? cfg.model;
  const finalUsage = (): Usage => {
    const u = usage ?? (received ? estimateUsage(req, text) : { inputTokens: 0, outputTokens: 0, estimated: true });
    const cost = u.costUsd ?? costUsd(u, priceOf(cfg.preset, model));
    return cost === undefined ? u : { ...u, costUsd: cost };
  };
  try {
    for await (const ev of inner) {
      received = true;
      if (ev.type === 'usage') {
        usage = ev.usage.estimated ? usage ?? ev.usage : ev.usage;
        continue;
      }
      if (ev.type === 'done') {
        stop = ev.stopReason;
        break;
      }
      if (ev.type === 'text') text += ev.delta;
      if (ev.type === 'error') {
        yield ev;
        stop = 'error';
        break;
      }
      yield ev;
    }
  } catch (err) {
    const pe = err instanceof ProviderError ? err : classifyFetchFailure(err, false, signal);
    yield { type: 'error', error: pe.toInfo() };
    stop = 'error';
  }
  if (stop === null && signal?.aborted) {
    yield { type: 'error', error: { kind: 'aborted', message: 'Stopped', retryable: false } };
    stop = 'error';
  } else if (stop === null) {
    yield { type: 'error', error: { kind: 'stream', message: 'The reply ended before it was complete', retryable: true } };
    stop = 'error';
  }
  yield { type: 'usage', usage: finalUsage() };
  yield { type: 'done', stopReason: stop };
}

/** Collects a stream into one assistant message. */
export async function collect(events: AsyncIterable<StreamEvent>): Promise<ChatResult> {
  let text = '';
  const calls: ToolCall[] = [];
  let usage: Usage | null = null;
  let stopReason: StopReason = 'error';
  let providerState: ProviderState | undefined;
  let error: ChatResult['error'];
  for await (const ev of events) {
    switch (ev.type) {
      case 'text':
        text += ev.delta;
        break;
      case 'tool_call_end':
        calls[ev.index] = ev.call;
        break;
      case 'usage':
        usage = addUsage(usage, ev.usage);
        break;
      case 'provider_state':
        providerState = ev.state;
        break;
      case 'error':
        error = ev.error;
        break;
      case 'done':
        stopReason = ev.stopReason;
        break;
    }
  }
  const message: ChatResult['message'] = { role: 'assistant', parts: text ? [{ type: 'text', text }] : [] };
  const toolCalls = calls.filter(Boolean);
  if (toolCalls.length) message.toolCalls = toolCalls;
  if (providerState) message.providerState = providerState;
  return error ? { message, usage, stopReason, error } : { message, usage, stopReason };
}

/** Builds a `ChatModel` from an adapter's raw stream function. */
export function makeChatModel(
  cfg: AdapterConfig,
  adapter: AdapterKind,
  rawStream: (req: ChatRequest, signal?: AbortSignal) => AsyncIterable<StreamEvent>,
  listModels: (signal?: AbortSignal) => Promise<ModelInfo[]>,
): ChatModel {
  const stream = (req: ChatRequest, signal?: AbortSignal) => guardStream(cfg, req, rawStream(req, signal), signal);
  return {
    adapter,
    presetId: cfg.preset.id,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    capabilities: cfg.capabilities,
    stream,
    complete: (req, signal) => collect(stream(req, signal)),
    listModels,
  };
}
