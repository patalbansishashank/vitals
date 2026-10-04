/**
 * Anthropic Messages adapter (`POST /v1/messages`, R8 §2). Translates canonical requests to the Messages wire format
 * and the SSE event stream back to canonical `StreamEvent`s.
 *
 * Choices worth knowing:
 * - Leading system messages become the top-level `system` blocks. A system message later in the conversation becomes a
 *   `<system-note>…</system-note>` text block in a user turn (merged with the neighbouring user turn). R8 says
 *   mid-conversation `{role:"system"}` works on the 5.5 models, but that is unverified, so we use the portable form.
 * - Consecutive tool results go into ONE user message (splitting them trains the model away from parallel calls), and
 *   two same-role messages are never sent back to back: they are merged.
 * - Thinking blocks are kept opaque in `providerState` (the raw content block array) and echoed back unchanged, only
 *   to the same preset and model. History is never rewritten.
 * - `tool_choice` is only ever `auto` or `none`: forced choice returns 400 on the 5.x models.
 */
import { finishToolCall, getJson, joinUrl, makeChatModel, ownState, request, textOf } from './http';
import { streamError } from './errors';
import { resolveAllImages } from './images';
import type { ImagePart, ResolvedImage } from './images';
import { parseSse } from './sse';
import { toAnthropicTools } from '../tools/render';
import type {
  AdapterConfig,
  Capabilities,
  ChatMessage,
  ChatModel,
  ChatRequest,
  ModelInfo,
  StopReason,
  StreamEvent,
  ToolCall,
  Usage,
} from './types';

/** Default `max_tokens` cap when the request does not set one. */
const DEFAULT_MAX_TOKENS = 8192;
/** Anthropic allows at most 4 `cache_control` breakpoints per request. */
const MAX_CACHE_BREAKPOINTS = 4;

type Block = Record<string, unknown> & { type: string };

interface WireMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

const EPHEMERAL = { type: 'ephemeral' } as const;

const STOP_MAP: Record<string, StopReason> = {
  end_turn: 'end',
  stop_sequence: 'end',
  pause_turn: 'end',
  tool_use: 'tool',
  max_tokens: 'length',
  refusal: 'refusal',
};

function isThinking(b: { type?: unknown }): boolean {
  return b.type === 'thinking' || b.type === 'redacted_thinking';
}

/** Images to keep: the last `maxImages` across the conversation (0 when the model has no vision). */
function keptImages(messages: ChatMessage[], caps: Capabilities): Set<ImagePart> {
  const all = messages.flatMap((m) => m.parts.filter((p): p is ImagePart => p.type === 'image'));
  const n = caps.vision ? Math.max(0, caps.maxImages) : 0;
  return new Set(n === 0 ? [] : all.slice(-n));
}

interface Built {
  system: Block[];
  messages: WireMessage[];
  /** Last block of message `req.cacheHint`, if it produced any. */
  hintBlock?: Block;
}

/** Canonical messages → `system` blocks + alternating user/assistant messages. */
export function buildAnthropicMessages(
  cfg: AdapterConfig,
  req: ChatRequest,
  model: string,
  images: Map<ImagePart, ResolvedImage>,
): Built {
  const system: Block[] = [];
  const out: WireMessage[] = [];
  const keep = keptImages(req.messages, cfg.capabilities);
  let leading = true;
  let hintBlock: Block | undefined;

  const push = (role: WireMessage['role'], content: Block[]) => {
    if (!content.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...content);
    else out.push({ role, content: [...content] });
  };

  req.messages.forEach((m, i) => {
    let blocks: Block[] = [];
    let role: WireMessage['role'] = 'user';
    if (m.role !== 'system') leading = false;
    switch (m.role) {
      case 'system': {
        const text = textOf(m.parts);
        if (!text) break;
        if (leading) {
          const b: Block = { type: 'text', text };
          system.push(b);
          if (i === req.cacheHint) hintBlock = b;
          return;
        }
        blocks = [{ type: 'text', text: `<system-note>${text}</system-note>` }];
        break;
      }
      case 'user': {
        // Images first, then text (R8 §2).
        for (const p of m.parts) {
          if (p.type !== 'image' || !keep.has(p)) continue;
          const img = images.get(p);
          if (img) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
        }
        for (const p of m.parts) if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
        break;
      }
      case 'assistant': {
        role = 'assistant';
        const state = ownState(cfg, m.providerState, model);
        if (Array.isArray(state)) {
          // Echoed unchanged (thinking signatures must match); shallow copies so cache_control never touches the store.
          blocks = (state as Block[]).map((b) => ({ ...b }));
          break;
        }
        const text = textOf(m.parts);
        if (text) blocks.push({ type: 'text', text });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        break;
      }
      case 'tool': {
        const b: Block = { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: textOf(m.parts) };
        if (m.isError) b.is_error = true;
        blocks = [b];
        break;
      }
    }
    if (i === req.cacheHint) {
      const last = blocks[blocks.length - 1];
      if (last && !isThinking(last)) hintBlock = last;
    }
    push(role, blocks);
  });
  return { system, messages: out, hintBlock };
}

/** The full `/v1/messages` request body. */
export function buildAnthropicBody(
  cfg: AdapterConfig,
  req: ChatRequest,
  images: Map<ImagePart, ResolvedImage>,
): Record<string, unknown> {
  const caps = cfg.capabilities;
  const model = req.model ?? cfg.model;
  const { system, messages, hintBlock } = buildAnthropicMessages(cfg, req, model, images);
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxOutputTokens ?? Math.min(caps.maxOutput, DEFAULT_MAX_TOKENS),
    stream: true,
  };
  const outputConfig: Record<string, unknown> = {};
  if (req.responseSchema) {
    if (caps.jsonSchema) outputConfig.format = { type: 'json_schema', schema: req.responseSchema.schema };
    else {
      system.push({
        type: 'text',
        text: `Reply with only a JSON object (no prose, no code fence) that matches this JSON Schema named "${req.responseSchema.name}":\n${JSON.stringify(req.responseSchema.schema)}`,
      });
    }
  }
  if (req.effort && caps.reasoning) outputConfig.effort = cfg.preset.effortMap?.[req.effort] ?? req.effort;

  let breakpoints = 0;
  const mark = (b: Block | undefined) => {
    if (!b || b.cache_control || breakpoints >= MAX_CACHE_BREAKPOINTS) return;
    b.cache_control = EPHEMERAL;
    breakpoints++;
  };

  if (caps.tools && req.tools?.length) {
    const tools: Array<Record<string, unknown>> = toAnthropicTools(req.tools, { strict: caps.strictTools });
    const lastTool = tools[tools.length - 1];
    if (lastTool) tools[tools.length - 1] = { ...lastTool, cache_control: EPHEMERAL };
    breakpoints++;
    body.tools = tools;
    const choice: Record<string, unknown> = { type: req.toolChoice === 'none' ? 'none' : 'auto' };
    if (req.parallelTools === false && choice.type === 'auto') choice.disable_parallel_tool_use = true;
    body.tool_choice = choice;
  }
  if (system.length) {
    mark(system[system.length - 1]);
    body.system = system;
  }
  mark(hintBlock);
  body.messages = messages;
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  return body;
}

interface StreamBlock {
  raw: Block;
  /** Ordinal among tool_use blocks. */
  toolIndex?: number;
  args?: string;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function* anthropicStream(cfg: AdapterConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const model = req.model ?? cfg.model;
  const images = await resolveAllImages(req.messages);
  const body = buildAnthropicBody(cfg, req, images);
  const res = await request(cfg, joinUrl(cfg.baseUrl, 'messages'), { method: 'POST', body }, signal);
  if (!res.body) throw streamError({ message: 'The provider sent an empty reply' });

  const blocks = new Map<number, StreamBlock>();
  let toolCount = 0;
  let input = 0;
  let cacheRead: number | undefined;
  let cacheWrite: number | undefined;
  let output = 0;
  let sawUsage = false;
  let stop: StopReason = 'end';

  for await (const msg of parseSse(res.body, signal)) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(msg.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof data.type === 'string' ? data.type : msg.event;
    switch (type) {
      case 'message_start': {
        const u = ((data.message as Record<string, unknown> | undefined)?.usage ?? {}) as Record<string, unknown>;
        input = num(u.input_tokens) ?? 0;
        cacheRead = num(u.cache_read_input_tokens);
        cacheWrite = num(u.cache_creation_input_tokens);
        output = num(u.output_tokens) ?? 0;
        sawUsage = num(u.input_tokens) !== undefined;
        break;
      }
      case 'content_block_start': {
        const index = num(data.index) ?? blocks.size;
        const cb = { ...(data.content_block as Block) };
        const sb: StreamBlock = { raw: cb };
        if (cb.type === 'tool_use') {
          sb.toolIndex = toolCount++;
          sb.args = '';
          yield { type: 'tool_call_start', index: sb.toolIndex, id: String(cb.id ?? ''), name: String(cb.name ?? '') };
        } else if (cb.type === 'text' && typeof cb.text === 'string' && cb.text) {
          yield { type: 'text', delta: cb.text };
        } else if (cb.type === 'thinking' && typeof cb.thinking === 'string' && cb.thinking) {
          yield { type: 'reasoning', delta: cb.thinking, visible: true };
        }
        blocks.set(index, sb);
        break;
      }
      case 'content_block_delta': {
        const sb = blocks.get(num(data.index) ?? -1);
        const d = (data.delta ?? {}) as Record<string, unknown>;
        if (!sb) break;
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          sb.raw.text = String(sb.raw.text ?? '') + d.text;
          yield { type: 'text', delta: d.text };
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string' && sb.toolIndex !== undefined) {
          sb.args = (sb.args ?? '') + d.partial_json;
          if (d.partial_json) yield { type: 'tool_call_delta', index: sb.toolIndex, argsDelta: d.partial_json };
        } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') {
          sb.raw.thinking = String(sb.raw.thinking ?? '') + d.thinking;
          yield { type: 'reasoning', delta: d.thinking, visible: true };
        } else if (d.type === 'signature_delta' && typeof d.signature === 'string') {
          sb.raw.signature = String(sb.raw.signature ?? '') + d.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const sb = blocks.get(num(data.index) ?? -1);
        if (sb && sb.toolIndex !== undefined) {
          const call: ToolCall = finishToolCall(String(sb.raw.id ?? ''), String(sb.raw.name ?? ''), sb.args);
          sb.raw.input = call.args;
          yield { type: 'tool_call_end', index: sb.toolIndex, call };
        }
        break;
      }
      case 'message_delta': {
        const d = (data.delta ?? {}) as Record<string, unknown>;
        if (typeof d.stop_reason === 'string') stop = STOP_MAP[d.stop_reason] ?? 'end';
        const u = (data.usage ?? {}) as Record<string, unknown>;
        output = num(u.output_tokens) ?? output;
        // Newer servers repeat cumulative input counts here; prefer them when present.
        input = num(u.input_tokens) ?? input;
        cacheRead = num(u.cache_read_input_tokens) ?? cacheRead;
        cacheWrite = num(u.cache_creation_input_tokens) ?? cacheWrite;
        if (num(u.output_tokens) !== undefined) sawUsage = true;
        break;
      }
      case 'message_stop': {
        const raw = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b.raw);
        if (raw.some(isThinking)) yield { type: 'provider_state', state: { presetId: cfg.preset.id, model, data: raw } };
        if (sawUsage) {
          const usage: Usage = { inputTokens: input + (cacheRead ?? 0) + (cacheWrite ?? 0), outputTokens: output, estimated: false };
          if (cacheRead !== undefined) usage.cachedInputTokens = cacheRead;
          if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;
          yield { type: 'usage', usage };
        }
        yield { type: 'done', stopReason: stop };
        return;
      }
      case 'error':
        throw streamError(data.error ?? data);
      default:
        // `ping` and unknown future events are ignored.
        break;
    }
  }
}

/** Reads a capability flag that may be a boolean or `{supported:boolean}` under any of `keys`. */
function flag(caps: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = caps[k];
    if (typeof v === 'boolean') return v;
    if (v && typeof v === 'object' && typeof (v as { supported?: unknown }).supported === 'boolean') {
      return (v as { supported: boolean }).supported;
    }
  }
  return undefined;
}

/** `GET /v1/models` entry → `ModelInfo` with whatever capabilities the catalogue states. */
export function anthropicModelInfo(entry: Record<string, unknown>): ModelInfo | null {
  if (typeof entry.id !== 'string') return null;
  const info: ModelInfo = { id: entry.id };
  if (typeof entry.display_name === 'string') info.label = entry.display_name;
  const ctx = num(entry.max_input_tokens);
  if (ctx !== undefined) info.contextTokens = ctx;
  const caps: Partial<Capabilities> = {};
  if (ctx !== undefined) caps.contextTokens = ctx;
  const maxOut = num(entry.max_tokens);
  if (maxOut !== undefined) caps.maxOutput = maxOut;
  const raw = entry.capabilities;
  if (raw && typeof raw === 'object') {
    const c = raw as Record<string, unknown>;
    const vision = flag(c, ['image_input', 'vision', 'images']);
    if (vision !== undefined) caps.vision = vision;
    const tools = flag(c, ['tool_use', 'tools']);
    if (tools !== undefined) caps.tools = tools;
    const schema = flag(c, ['structured_outputs', 'json_schema']);
    if (schema !== undefined) caps.jsonSchema = schema;
    const reasoning = flag(c, ['thinking', 'reasoning', 'effort']);
    if (reasoning !== undefined) caps.reasoning = reasoning;
  }
  if (Object.keys(caps).length) info.capabilities = caps;
  return info;
}

async function listAnthropicModels(cfg: AdapterConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  // `limit` lifts the default page size of 20 so one call returns the whole catalogue.
  const json = (await getJson(cfg, joinUrl(cfg.baseUrl, 'models?limit=1000'), signal)) as { data?: unknown };
  const data = Array.isArray(json?.data) ? (json.data as unknown[]) : [];
  return data.flatMap((e) => {
    const info = e && typeof e === 'object' ? anthropicModelInfo(e as Record<string, unknown>) : null;
    return info ? [info] : [];
  });
}

export function createAnthropicMessagesModel(cfg: AdapterConfig): ChatModel {
  return makeChatModel(
    cfg,
    'anthropic-messages',
    (req, signal) => anthropicStream(cfg, req, signal),
    (signal) => listAnthropicModels(cfg, signal),
  );
}
