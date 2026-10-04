/**
 * `/chat/completions` adapter (R8 §1.2–1.7): OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together, Cerebras, xAI,
 * Fireworks, Gemini (OpenAI-compat), Ollama, LM Studio, vLLM, NIM and Zen. Provider differences are driven by
 * `preset.quirks` and the capability record, never by preset id.
 *
 * Tier H: IO only through `cfg.deps.fetch` (via `request`/`getJson`).
 */
import { streamError } from './errors';
import { finishToolCall, getJson, joinUrl, makeChatModel, newCallId, ownState, request, textOf } from './http';
import { resolveAllImages } from './images';
import type { ImagePart, ResolvedImage } from './images';
import { parseSse } from './sse';
import { toOpenAIChatTools } from '../tools/render';
import type {
  AdapterConfig,
  ChatMessage,
  ChatModel,
  ChatRequest,
  Effort,
  ModelInfo,
  StopReason,
  StreamEvent,
  Usage,
} from './types';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Mistral tool-call ids
// ---------------------------------------------------------------------------------------------------------------

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;
const BASE62_9 = 62n ** 9n;

/**
 * Mistral accepts only 9-character `[A-Za-z0-9]` tool-call ids (R8 §1.2). Other ids are rewritten deterministically
 * (64-bit FNV-1a over the UTF-16 code units, reduced to 9 base62 digits), so an assistant call and its tool result
 * still pair up without keeping a map.
 */
export function mistralId(id: string): string {
  if (/^[A-Za-z0-9]{9}$/.test(id)) return id;
  let h = FNV64_OFFSET;
  for (let i = 0; i < id.length; i++) {
    h ^= BigInt(id.charCodeAt(i));
    h = (h * FNV64_PRIME) & MASK64;
  }
  let n = h % BASE62_9;
  let out = '';
  for (let i = 0; i < 9; i++) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// <think> splitter
// ---------------------------------------------------------------------------------------------------------------

export interface ThinkPiece {
  kind: 'text' | 'reasoning';
  text: string;
}

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Splits `<think>…</think>` out of streamed content (Groq `raw`, local reasoning models). Tags may be split across
 * chunks: a trailing fragment that could be the start of the next tag is held back until the next `push` or `flush`.
 */
export class ThinkTagSplitter {
  private inThink = false;
  private held = '';

  push(chunk: string): ThinkPiece[] {
    const out: ThinkPiece[] = [];
    let buf = this.held + chunk;
    this.held = '';
    while (buf) {
      const tag = this.inThink ? CLOSE_TAG : OPEN_TAG;
      const kind = this.inThink ? 'reasoning' : 'text';
      const at = buf.indexOf(tag);
      if (at >= 0) {
        if (at > 0) out.push({ kind, text: buf.slice(0, at) });
        buf = buf.slice(at + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Hold back the longest suffix that is a proper prefix of the tag.
      let keep = 0;
      for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) {
        if (tag.startsWith(buf.slice(buf.length - k))) {
          keep = k;
          break;
        }
      }
      const emit = buf.slice(0, buf.length - keep);
      if (emit) out.push({ kind, text: emit });
      this.held = buf.slice(buf.length - keep);
      buf = '';
    }
    return out;
  }

  /** Releases anything held back (an unfinished tag fragment is plain content of the current kind). */
  flush(): ThinkPiece[] {
    const held = this.held;
    this.held = '';
    return held ? [{ kind: this.inThink ? 'reasoning' : 'text', text: held }] : [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------------------------------------------

/** Instruction used when the model cannot be held to a schema by the server (R8 §1.5). */
export function schemaInstruction(name: string, schema: unknown): string {
  return `Reply with only a JSON object named "${name}" (no prose, no code fence) that matches this JSON Schema:\n${JSON.stringify(schema)}`;
}

function wireMessages(cfg: AdapterConfig, req: ChatRequest, model: string, images: Map<ImagePart, ResolvedImage>): Json[] {
  const { quirks } = cfg.preset;
  // Keep only the last `maxImages` user images; older ones are dropped (Groq: 3).
  const allImages = req.messages.flatMap((m) => (m.role === 'user' ? m.parts.filter((p): p is ImagePart => p.type === 'image') : []));
  const keep = new Set(allImages.slice(Math.max(0, allImages.length - Math.max(0, cfg.capabilities.maxImages))));
  const callId = (id: string) => (quirks.mistralToolIds ? mistralId(id) : id);

  return req.messages.map((m: ChatMessage): Json => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: textOf(m.parts) };
      case 'user': {
        const hasImage = m.parts.some((p) => p.type === 'image' && keep.has(p));
        if (!hasImage) return { role: 'user', content: textOf(m.parts) };
        const content: Json[] = [];
        for (const p of m.parts) {
          if (p.type === 'text') content.push({ type: 'text', text: p.text });
          else if (keep.has(p)) {
            const img = images.get(p);
            if (img) content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
          }
        }
        return { role: 'user', content };
      }
      case 'assistant': {
        const text = textOf(m.parts);
        const out: Json = { role: 'assistant', content: text || null };
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((c) => ({
            id: callId(c.id),
            type: 'function',
            function: { name: c.name, arguments: c.rawArgs },
          }));
        }
        if (quirks.echoReasoning) {
          const data = ownState(cfg, m.providerState, model);
          if (quirks.echoReasoning === 'reasoning_content' && typeof data === 'string') out.reasoning_content = data;
          if (quirks.echoReasoning === 'reasoning_details' && Array.isArray(data)) out.reasoning_details = data;
        }
        return out;
      }
      case 'tool': {
        const out: Json = { role: 'tool', tool_call_id: callId(m.toolCallId ?? ''), content: textOf(m.parts) };
        if (quirks.mistralToolIds && m.toolName) out.name = m.toolName;
        return out;
      }
    }
  });
}

function effortValue(cfg: AdapterConfig, e: Effort): string {
  return cfg.preset.effortMap?.[e] ?? e;
}

/** Builds the wire body. `stream` false gives the non-streaming fallback body. */
export function buildBody(cfg: AdapterConfig, req: ChatRequest, images: Map<ImagePart, ResolvedImage>, stream: boolean): Json {
  const { quirks } = cfg.preset;
  const caps = cfg.capabilities;
  const model = req.model ?? cfg.model;
  const messages = wireMessages(cfg, req, model, images);

  const body: Json = { model, messages };
  if (stream) {
    body.stream = true;
    if (caps.streamUsage && !quirks.noStreamOptions) body.stream_options = { include_usage: true };
  }
  if (caps.tools && req.tools?.length) {
    body.tools = toOpenAIChatTools(req.tools, { strict: caps.strictTools });
    if (req.toolChoice && !quirks.noToolChoice) body.tool_choice = req.toolChoice;
    if (req.parallelTools === false && caps.parallelTools) body.parallel_tool_calls = false;
  }
  if (req.maxOutputTokens !== undefined) body[quirks.maxTokensField ?? 'max_tokens'] = req.maxOutputTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.effort && caps.reasoning) {
    const mode = quirks.effortParam ?? 'reasoning_effort';
    if (mode === 'reasoning_effort') body.reasoning_effort = effortValue(cfg, req.effort);
    else if (mode === 'openrouter') body.reasoning = { effort: effortValue(cfg, req.effort) };
    // DeepSeek takes low/high/max.
    else if (mode === 'deepseek') body.reasoning_effort = cfg.preset.effortMap?.[req.effort] ?? (req.effort === 'medium' ? 'high' : req.effort);
  }
  if (req.responseSchema) {
    const { name, schema } = req.responseSchema;
    if (caps.jsonSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name, schema, strict: true } };
    } else {
      if (caps.jsonObject) body.response_format = { type: 'json_object' };
      // Appended to the leading system message, or added as one: a late system message upsets some templates.
      const instruction = schemaInstruction(name, schema);
      const first = messages[0];
      if (first && first.role === 'system') first.content = `${String(first.content)}\n\n${instruction}`;
      else messages.unshift({ role: 'system', content: instruction });
    }
  }

  for (const key of quirks.stripParams ?? []) {
    const m = /^messages\[\]\.(.+)$/.exec(key);
    if (m?.[1]) for (const msg of messages) delete msg[m[1]];
    else delete body[key];
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------------------------------------------

/** Wire usage → canonical usage. Returns null when the object carries no token counts. */
export function toUsage(u: unknown): Usage | null {
  if (!isObj(u)) return null;
  const input = num(u.prompt_tokens);
  const output = num(u.completion_tokens);
  if (input === undefined && output === undefined) return null;
  const out: Usage = { inputTokens: input ?? 0, outputTokens: output ?? 0, estimated: false };
  const cached = isObj(u.prompt_tokens_details) ? num(u.prompt_tokens_details.cached_tokens) : undefined;
  if (cached !== undefined) out.cachedInputTokens = cached;
  const reasoning = isObj(u.completion_tokens_details) ? num(u.completion_tokens_details.reasoning_tokens) : undefined;
  if (reasoning !== undefined) out.reasoningTokens = reasoning;
  const cost = num(u.cost);
  if (cost !== undefined) out.costUsd = cost;
  return out;
}

function mapFinish(reason: string, hasCalls: boolean): StopReason {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'refusal';
  // Some servers report `stop` after tool calls.
  return hasCalls ? 'tool' : 'end';
}

interface PendingCall {
  index: number;
  id: string;
  name: string;
  args: string;
}

/** Shared state machine for streamed chunks and the non-streaming message. */
class Assembler {
  private readonly calls = new Map<number, PendingCall>();
  private lastIndex = -1;
  private readonly think: ThinkTagSplitter | null;
  private reasoningContent = '';
  private readonly details: Json[] = [];
  private callsEnded = false;
  finish: string | null = null;

  constructor(private readonly cfg: AdapterConfig, private readonly model: string) {
    this.think = cfg.preset.quirks.thinkTags ? new ThinkTagSplitter() : null;
  }

  *content(text: string): Generator<StreamEvent> {
    if (!text) return;
    if (!this.think) {
      yield { type: 'text', delta: text };
      return;
    }
    yield* this.pieces(this.think.push(text));
  }

  private *pieces(ps: ThinkPiece[]): Generator<StreamEvent> {
    for (const p of ps) {
      yield p.kind === 'text' ? { type: 'text', delta: p.text } : { type: 'reasoning', delta: p.text, visible: false };
    }
  }

  *reasoning(src: Json): Generator<StreamEvent> {
    const rc = str(src.reasoning_content);
    if (rc) {
      this.reasoningContent += rc;
      yield { type: 'reasoning', delta: rc, visible: false };
    }
    const r = str(src.reasoning);
    if (r && !rc) yield { type: 'reasoning', delta: r, visible: false };
    if (Array.isArray(src.reasoning_details)) {
      for (const item of src.reasoning_details) {
        if (!isObj(item)) continue;
        this.addDetail(item);
        const text = str(item.text);
        const summary = str(item.summary);
        // OpenRouter may send the same text as `reasoning` too; emit it once.
        if (text && !r) yield { type: 'reasoning', delta: text, visible: false };
        if (summary && !r) yield { type: 'reasoning', delta: summary, visible: true };
      }
    }
  }

  /** OpenRouter streams detail items in fragments that share an `index`; fragments of one item are merged. */
  private addDetail(item: Json): void {
    const idx = num(item.index);
    const prev = idx === undefined ? undefined : this.details.find((d) => d.index === idx && d.type === item.type);
    if (!prev) {
      this.details.push({ ...item });
      return;
    }
    for (const [k, v] of Object.entries(item)) {
      if ((k === 'text' || k === 'summary') && typeof v === 'string') prev[k] = `${str(prev[k]) ?? ''}${v}`;
      else if (v !== undefined && v !== null) prev[k] = v;
    }
  }

  *toolFragment(tc: Json): Generator<StreamEvent> {
    const fn = isObj(tc.function) ? tc.function : {};
    const id = str(tc.id) || undefined;
    let index = num(tc.index);
    if (index === undefined) {
      // No index (some compat layers): a new id opens a new call, otherwise it continues the last one.
      const last = this.calls.get(this.lastIndex);
      index = !last || (id && id !== last.id) ? this.calls.size : this.lastIndex;
    } else {
      // Same index reused for a different, already-named call (seen on compat layers): give it a new slot.
      const existing = this.calls.get(index);
      if (existing && id && id !== existing.id && existing.name && str(fn.name)) index = Math.max(...this.calls.keys()) + 1;
    }
    this.lastIndex = index;
    let call = this.calls.get(index);
    if (!call) {
      call = { index, id: id ?? newCallId(this.cfg), name: str(fn.name) ?? '', args: '' };
      this.calls.set(index, call);
      yield { type: 'tool_call_start', index, id: call.id, name: call.name };
    } else if (!call.name && str(fn.name)) {
      call.name = str(fn.name) ?? '';
    }
    const raw = fn.arguments;
    const delta = typeof raw === 'string' ? raw : isObj(raw) ? JSON.stringify(raw) : '';
    if (delta) {
      call.args += delta;
      yield { type: 'tool_call_delta', index, argsDelta: delta };
    }
  }

  get hasCalls(): boolean {
    return this.calls.size > 0;
  }

  /** Flushes held think text and closes every gathered call, ordered by index. Idempotent. */
  *endCalls(): Generator<StreamEvent> {
    if (this.think) yield* this.pieces(this.think.flush());
    if (this.callsEnded) return;
    this.callsEnded = true;
    for (const c of [...this.calls.values()].sort((a, b) => a.index - b.index)) {
      yield { type: 'tool_call_end', index: c.index, call: finishToolCall(c.id, c.name, c.args) };
    }
  }

  /** `provider_state` (when echoing is on and something was collected), then `done`. */
  *end(): Generator<StreamEvent> {
    yield* this.endCalls();
    const echo = this.cfg.preset.quirks.echoReasoning;
    let data: unknown;
    if (echo === 'reasoning_content' && this.reasoningContent) data = this.reasoningContent;
    if (echo === 'reasoning_details' && this.details.length) data = this.details;
    if (data !== undefined) yield { type: 'provider_state', state: { presetId: this.cfg.preset.id, model: this.model, data } };
    yield { type: 'done', stopReason: mapFinish(this.finish ?? 'stop', this.hasCalls) };
  }
}

function chunkUsage(cfg: AdapterConfig, chunk: Json): Usage | null {
  const u = toUsage(chunk.usage);
  if (u) return u;
  if (cfg.preset.quirks.groqUsage && isObj(chunk.x_groq)) return toUsage(chunk.x_groq.usage);
  return null;
}

async function* streamEvents(cfg: AdapterConfig, res: Response, model: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  if (!res.body) return;
  const asm = new Assembler(cfg, model);
  for await (const msg of parseSse(res.body, signal)) {
    const data = msg.data.trim();
    if (data === '[DONE]') break;
    if (!data) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      // a garbled chunk is skipped (as the other adapters do); a reply that never finishes still ends as a stream error
      continue;
    }
    if (!isObj(chunk)) continue;
    if (chunk.error !== undefined && chunk.error !== null) throw streamError(chunk.error);
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (isObj(choice)) {
      const delta = isObj(choice.delta) ? choice.delta : {};
      yield* asm.reasoning(delta);
      const text = str(delta.content);
      if (text) yield* asm.content(text);
      if (Array.isArray(delta.tool_calls)) for (const tc of delta.tool_calls) if (isObj(tc)) yield* asm.toolFragment(tc);
      const fr = str(choice.finish_reason);
      if (fr) {
        asm.finish = fr;
        yield* asm.endCalls();
      }
    }
    const usage = chunkUsage(cfg, chunk);
    if (usage) yield { type: 'usage', usage };
  }
  // EOF without a finish reason: return silently, `guardStream` reports the truncation.
  if (asm.finish === null) return;
  yield* asm.end();
}

async function* jsonEvents(cfg: AdapterConfig, res: Response, model: string): AsyncGenerator<StreamEvent> {
  const json: unknown = await res.json();
  if (!isObj(json)) return;
  if (json.error !== undefined && json.error !== null) throw streamError(json.error);
  const asm = new Assembler(cfg, model);
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
  if (isObj(choice)) {
    const msg = isObj(choice.message) ? choice.message : {};
    yield* asm.reasoning(msg);
    const text = str(msg.content);
    if (text) yield* asm.content(text);
    if (Array.isArray(msg.tool_calls)) {
      let i = 0;
      for (const tc of msg.tool_calls) if (isObj(tc)) yield* asm.toolFragment({ ...tc, index: num(tc.index) ?? i++ });
    }
    asm.finish = str(choice.finish_reason) ?? 'stop';
  }
  const usage = chunkUsage(cfg, json);
  if (usage) yield { type: 'usage', usage };
  if (asm.finish === null) return;
  yield* asm.end();
}

// ---------------------------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------------------------

/** USD-per-token string → USD per 1M, rounded to drop float noise. */
function perMillion(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : num(v);
  return n === undefined || !Number.isFinite(n) || n < 0 ? undefined : Number((n * 1e6).toPrecision(12));
}

export function parseModelList(json: unknown): ModelInfo[] {
  if (!isObj(json)) return [];
  const out: ModelInfo[] = [];
  if (Array.isArray(json.data)) {
    for (const m of json.data) {
      if (!isObj(m) || !str(m.id)) continue;
      const info: ModelInfo = { id: str(m.id) ?? '' };
      const label = str(m.name);
      if (label) info.label = label;
      const ctx = num(m.context_length);
      if (ctx !== undefined) info.contextTokens = ctx;
      if (isObj(m.pricing)) {
        const input = perMillion(m.pricing.prompt);
        const output = perMillion(m.pricing.completion);
        if (input !== undefined && output !== undefined) {
          info.price = { input, output };
          const cached = perMillion(m.pricing.input_cache_read);
          if (cached !== undefined) info.price.cachedInput = cached;
        }
      }
      out.push(info);
    }
  } else if (Array.isArray(json.models)) {
    for (const m of json.models) {
      if (!isObj(m)) continue;
      const id = str(m.model) ?? str(m.name);
      if (!id) continue;
      const label = str(m.name);
      out.push(label && label !== id ? { id, label } : { id });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------

export function createOpenAIChatModel(cfg: AdapterConfig): ChatModel {
  const url = joinUrl(cfg.baseUrl, 'chat/completions');
  const streaming = cfg.capabilities.streaming !== false;

  async function* raw(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const model = req.model ?? cfg.model;
    const images = await resolveAllImages(req.messages);
    const body = buildBody(cfg, req, images, streaming);
    const res = await request(cfg, url, { method: 'POST', body }, signal);
    if (streaming) yield* streamEvents(cfg, res, model, signal);
    else yield* jsonEvents(cfg, res, model);
  }

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    return parseModelList(await getJson(cfg, joinUrl(cfg.baseUrl, 'models'), signal));
  }

  return makeChatModel(cfg, 'openai-chat', raw, listModels);
}
