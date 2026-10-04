/**
 * OpenAI Responses adapter (`POST /responses`), used only for OpenAI direct and SIWC through the Companion (R8
 * summary 1). Always stateless: `store:false`, the whole history is sent each time, and reasoning is carried across
 * turns as encrypted reasoning items (`include:['reasoning.encrypted_content']`) kept opaque in `providerState`.
 *
 * Choices worth knowing:
 * - Leading system messages become `instructions`; later ones become `{role:'developer'}` input items.
 * - An assistant turn with own provider state is echoed as the stored output items, verbatim.
 * - Responses has no `is_error` on tool outputs, so an error result is prefixed with `Error: `.
 * - `max_output_tokens` is sent only when the request sets it (the SIWC backend is not known to accept it).
 */
import { finishToolCall, getJson, joinUrl, makeChatModel, ownState, request, textOf } from './http';
import { streamError } from './errors';
import { resolveAllImages } from './images';
import type { ImagePart, ResolvedImage } from './images';
import { parseSse } from './sse';
import { toOpenAIResponsesTools } from '../tools/render';
import type { AdapterConfig, ChatModel, ChatRequest, ModelInfo, StopReason, StreamEvent, Usage } from './types';

type Item = Record<string, unknown>;

/** Canonical messages → `instructions` + input items. */
export function buildResponsesInput(
  cfg: AdapterConfig,
  req: ChatRequest,
  model: string,
  images: Map<ImagePart, ResolvedImage>,
): { instructions: string[]; input: Item[] } {
  const caps = cfg.capabilities;
  const allImages = req.messages.flatMap((m) => m.parts.filter((p): p is ImagePart => p.type === 'image'));
  const keep = new Set(caps.vision && caps.maxImages > 0 ? allImages.slice(-caps.maxImages) : []);
  const instructions: string[] = [];
  const input: Item[] = [];
  let leading = true;
  for (const m of req.messages) {
    if (m.role !== 'system') leading = false;
    switch (m.role) {
      case 'system': {
        const text = textOf(m.parts);
        if (!text) break;
        if (leading) instructions.push(text);
        else input.push({ role: 'developer', content: text });
        break;
      }
      case 'user': {
        const content: Item[] = [];
        for (const p of m.parts) {
          if (p.type === 'text') {
            if (p.text) content.push({ type: 'input_text', text: p.text });
          } else if (keep.has(p)) {
            const img = images.get(p);
            if (img) content.push({ type: 'input_image', image_url: img.dataUrl });
          }
        }
        if (content.length) input.push({ role: 'user', content });
        break;
      }
      case 'assistant': {
        const state = ownState(cfg, m.providerState, model);
        if (Array.isArray(state)) {
          input.push(...(state as Item[]));
          break;
        }
        const text = textOf(m.parts);
        if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
        for (const c of m.toolCalls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.rawArgs });
        break;
      }
      case 'tool': {
        const text = textOf(m.parts);
        input.push({ type: 'function_call_output', call_id: m.toolCallId ?? '', output: m.isError ? `Error: ${text}` : text });
        break;
      }
    }
  }
  return { instructions, input };
}

/** The full `/responses` request body. */
export function buildResponsesBody(cfg: AdapterConfig, req: ChatRequest, images: Map<ImagePart, ResolvedImage>): Record<string, unknown> {
  const caps = cfg.capabilities;
  const model = req.model ?? cfg.model;
  const { instructions, input } = buildResponsesInput(cfg, req, model, images);
  const body: Record<string, unknown> = { model, stream: true, store: false };
  if (caps.reasoning) body.include = ['reasoning.encrypted_content'];
  if (req.responseSchema) {
    if (caps.jsonSchema) {
      body.text = { format: { type: 'json_schema', name: req.responseSchema.name, schema: req.responseSchema.schema, strict: true } };
    } else {
      instructions.push(
        `Reply with only a JSON object (no prose, no code fence) that matches this JSON Schema named "${req.responseSchema.name}":\n${JSON.stringify(req.responseSchema.schema)}`,
      );
    }
  }
  if (instructions.length) body.instructions = instructions.join('\n\n');
  body.input = input;
  if (caps.tools && req.tools?.length) {
    body.tools = toOpenAIResponsesTools(req.tools, { strict: caps.strictTools, namespace: cfg.preset.quirks.toolNamespace });
    body.tool_choice = req.toolChoice === 'none' ? 'none' : 'auto';
    if (req.parallelTools === false) body.parallel_tool_calls = false;
  }
  if (caps.reasoning && req.effort) body.reasoning = { effort: cfg.preset.effortMap?.[req.effort] ?? req.effort };
  if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  return body;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const input = num(u.input_tokens);
  const output = num(u.output_tokens);
  if (input === undefined && output === undefined) return null;
  const usage: Usage = { inputTokens: input ?? 0, outputTokens: output ?? 0, estimated: false };
  const cached = num((u.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
  if (cached !== undefined) usage.cachedInputTokens = cached;
  const reasoning = num((u.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
  if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  return usage;
}

interface PendingCall {
  index: number;
  id: string;
  name: string;
  args: string;
  done: boolean;
}

async function* responsesStream(cfg: AdapterConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const model = req.model ?? cfg.model;
  const ns = cfg.preset.quirks.toolNamespace;
  /** Namespaced tools may come back as `<ns>.<name>` (unverified); the registry knows bare names. */
  const bare = (name: string) => (ns && name.startsWith(`${ns}.`) ? name.slice(ns.length + 1) : name);
  const images = await resolveAllImages(req.messages);
  const body = buildResponsesBody(cfg, req, images);
  const res = await request(cfg, joinUrl(cfg.baseUrl, 'responses'), { method: 'POST', body }, signal);
  if (!res.body) throw streamError({ message: 'The provider sent an empty reply' });

  const calls = new Map<number, PendingCall>();
  let callCount = 0;

  const finish = function* (response: Record<string, unknown>, stop: StopReason): Generator<StreamEvent> {
    const output = Array.isArray(response.output) ? (response.output as Item[]) : [];
    if (output.some((i) => i.type === 'reasoning')) {
      yield { type: 'provider_state', state: { presetId: cfg.preset.id, model, data: output } };
    }
    const usage = readUsage(response.usage);
    if (usage) yield { type: 'usage', usage };
    yield { type: 'done', stopReason: stop };
  };

  for await (const msg of parseSse(res.body, signal)) {
    if (msg.data === '[DONE]') continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(msg.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof data.type === 'string' ? data.type : msg.event;
    switch (type) {
      case 'response.output_text.delta':
        if (typeof data.delta === 'string' && data.delta) yield { type: 'text', delta: data.delta };
        break;
      case 'response.reasoning_summary_text.delta':
        if (typeof data.delta === 'string' && data.delta) yield { type: 'reasoning', delta: data.delta, visible: true };
        break;
      case 'response.output_item.added': {
        const item = (data.item ?? {}) as Item;
        if (item.type !== 'function_call') break;
        const call: PendingCall = {
          index: callCount++,
          id: String(item.call_id ?? item.id ?? ''),
          name: bare(String(item.name ?? '')),
          args: typeof item.arguments === 'string' ? item.arguments : '',
          done: false,
        };
        calls.set(num(data.output_index) ?? -call.index - 1, call);
        yield { type: 'tool_call_start', index: call.index, id: call.id, name: call.name };
        break;
      }
      case 'response.function_call_arguments.delta': {
        const call = calls.get(num(data.output_index) ?? -1);
        if (call && typeof data.delta === 'string' && data.delta) {
          call.args += data.delta;
          yield { type: 'tool_call_delta', index: call.index, argsDelta: data.delta };
        }
        break;
      }
      case 'response.output_item.done': {
        const item = (data.item ?? {}) as Item;
        if (item.type !== 'function_call') break;
        const call = calls.get(num(data.output_index) ?? -1);
        if (!call || call.done) break;
        call.done = true;
        const args = typeof item.arguments === 'string' ? item.arguments : call.args;
        yield { type: 'tool_call_end', index: call.index, call: finishToolCall(call.id, call.name, args) };
        break;
      }
      case 'response.completed': {
        yield* finish((data.response ?? {}) as Record<string, unknown>, callCount > 0 ? 'tool' : 'end');
        return;
      }
      case 'response.incomplete': {
        const response = (data.response ?? {}) as Record<string, unknown>;
        const reason = (response.incomplete_details as Record<string, unknown> | undefined)?.reason;
        yield* finish(response, reason === 'content_filter' ? 'refusal' : 'length');
        return;
      }
      case 'response.failed': {
        const response = (data.response ?? {}) as Record<string, unknown>;
        throw streamError(response.error ?? { message: 'The response failed' });
      }
      case 'error':
        throw streamError(data.error ?? data);
      default:
        break;
    }
  }
}

async function listResponsesModels(cfg: AdapterConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const json = (await getJson(cfg, joinUrl(cfg.baseUrl, 'models'), signal)) as { data?: unknown };
  const data = Array.isArray(json?.data) ? (json.data as unknown[]) : [];
  return data.flatMap((e) => {
    const id = e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? [{ id }] : [];
  });
}

export function createOpenAIResponsesModel(cfg: AdapterConfig): ChatModel {
  return makeChatModel(
    cfg,
    'openai-responses',
    (req, signal) => responsesStream(cfg, req, signal),
    (signal) => listResponsesModels(cfg, signal),
  );
}
