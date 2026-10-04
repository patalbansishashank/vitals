/**
 * Capability probing (R8 §3.3) and the graceful-degradation matrix (R8 §3.6).
 *
 * 1. Catalogue metadata first: OpenRouter `/models`, Anthropic `/models/{id}`, Ollama `POST /api/show`.
 * 2. Otherwise, with the user's consent, a 3-call self-test (tool call, image, JSON schema; +1 json_object retry).
 * 3. Results are cached per `(normalised baseUrl, model)` with `verifiedAt`; stale after 30 days, and invalidated on a
 *    400 that names an unsupported parameter (`shouldReprobe`).
 *
 * Tier H: network only through `cfg.deps.fetch` via `request`/`getJson` (retry and error classification apply).
 */
import { ProviderError } from './errors';
import { getJson, joinUrl, request } from './http';
import { presetCapabilities } from './presets';
import { bytesToBase64, digitPng } from './selftestImage';
import type { AdapterConfig, Capabilities, ChatModel, ChatRequest, ChatResult, ProviderErrorInfo, ToolSpec } from './types';
import type { KvStore } from '../storage/kv';

export const PROBE_MAX_AGE_DAYS = 30;
const DAY_MS = 86_400_000;

/** `https://openrouter.ai/api/v1/` → `https://openrouter.ai/api/v1` (scheme and host lower-cased by URL). */
export function normaliseBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl.trim());
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

export function capabilityKey(baseUrl: string, model: string): string {
  return `${normaliseBaseUrl(baseUrl)}|${model}`;
}

export class CapabilityCache {
  readonly #kv: KvStore<Capabilities>;
  constructor(kv: KvStore<Capabilities>) {
    this.#kv = kv;
  }

  /** Cached capabilities, or undefined when absent, unverified or older than `PROBE_MAX_AGE_DAYS`. */
  async get(baseUrl: string, model: string, nowIso: string): Promise<Capabilities | undefined> {
    const caps = await this.#kv.get(capabilityKey(baseUrl, model));
    if (!caps?.verifiedAt) return undefined;
    const age = Date.parse(nowIso) - Date.parse(caps.verifiedAt);
    return age <= PROBE_MAX_AGE_DAYS * DAY_MS ? caps : undefined; // NaN → stale
  }

  async set(baseUrl: string, model: string, caps: Capabilities): Promise<void> {
    await this.#kv.set(capabilityKey(baseUrl, model), caps);
  }

  async invalidate(baseUrl: string, model: string): Promise<void> {
    await this.#kv.delete(capabilityKey(baseUrl, model));
  }
}

/** A 400 naming an unsupported parameter means the cached capabilities are wrong: invalidate and re-probe. */
export function shouldReprobe(error: ProviderErrorInfo): boolean {
  return error.kind === 'unsupported_param';
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);

/** Errors that say nothing about the model and must not be turned into "capability missing". */
const FATAL_KINDS = new Set(['auth', 'quota', 'network', 'cors', 'blocked', 'aborted', 'rate_limit', 'overloaded', 'server', 'stream']);

function parseOpenRouter(body: unknown, model: string): Partial<Capabilities> | null {
  const list = isObj(body) && Array.isArray(body.data) ? body.data : [];
  const m = list.find((x): x is Obj => isObj(x) && (x.id === model || x.canonical_slug === model));
  if (!m) return null;
  const out: Partial<Capabilities> = {};
  const sp = strings(m.supported_parameters);
  if (sp) {
    const structured = sp.includes('structured_outputs');
    out.tools = sp.includes('tools');
    out.parallelTools = out.tools && sp.includes('parallel_tool_calls');
    out.strictTools = out.tools && structured;
    out.jsonSchema = structured;
    // `response_format` alone means json_object only; structured outputs imply it too.
    out.jsonObject = structured || sp.includes('response_format');
    out.reasoning = sp.includes('reasoning') || sp.includes('include_reasoning');
  }
  const modalities = isObj(m.architecture) ? strings(m.architecture.input_modalities) : undefined;
  if (modalities) out.vision = modalities.includes('image');
  const ctx = posInt(m.context_length);
  if (ctx) out.contextTokens = ctx;
  const maxOut = isObj(m.top_provider) ? posInt(m.top_provider.max_completion_tokens) : undefined;
  if (maxOut) out.maxOutput = maxOut;
  return out;
}

/** Anthropic capability flags are either booleans or `{supported: boolean}`; several key spellings are accepted. */
function anthropicFlag(caps: Obj, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = caps[k];
    if (typeof v === 'boolean') return v;
    if (isObj(v) && typeof v.supported === 'boolean') return v.supported;
  }
  return undefined;
}

function parseAnthropic(body: unknown): Partial<Capabilities> | null {
  if (!isObj(body)) return null;
  const out: Partial<Capabilities> = { tools: true, parallelTools: true };
  const ctx = posInt(body.max_input_tokens);
  if (ctx) out.contextTokens = ctx;
  const maxOut = posInt(body.max_tokens);
  if (maxOut) out.maxOutput = maxOut;
  if (isObj(body.capabilities)) {
    const vision = anthropicFlag(body.capabilities, ['image_input', 'vision']);
    if (vision !== undefined) out.vision = vision;
    const structured = anthropicFlag(body.capabilities, ['structured_outputs', 'json_schema']);
    if (structured !== undefined) out.jsonSchema = out.strictTools = structured;
    const thinking = anthropicFlag(body.capabilities, ['thinking', 'extended_thinking']);
    if (thinking !== undefined) out.reasoning = thinking;
  }
  return out;
}

function parseOllama(body: unknown): Partial<Capabilities> | null {
  if (!isObj(body)) return null;
  const out: Partial<Capabilities> = {};
  const caps = strings(body.capabilities);
  if (caps) {
    out.tools = caps.includes('tools');
    out.vision = caps.includes('vision');
    out.reasoning = caps.includes('thinking');
  }
  if (isObj(body.model_info)) {
    for (const [k, v] of Object.entries(body.model_info)) {
      const n = k.endsWith('.context_length') ? posInt(v) : undefined;
      if (n) out.contextTokens = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Ollama's native API lives at the server root: strip a trailing `/v1` from the OpenAI-compatible base URL. */
export function ollamaRoot(baseUrl: string): string {
  return normaliseBaseUrl(baseUrl).replace(/\/v1$/, '');
}

/**
 * Catalogue metadata for `cfg.model`, or null when the preset has no catalogue, the model is not listed, or the
 * catalogue answered with a model-specific error. Auth, network and similar failures are rethrown.
 */
export async function readCatalogue(cfg: AdapterConfig, signal?: AbortSignal): Promise<Partial<Capabilities> | null> {
  try {
    switch (cfg.preset.catalogue) {
      case 'openrouter':
        return parseOpenRouter(await getJson(cfg, joinUrl(cfg.baseUrl, 'models'), signal), cfg.model);
      case 'anthropic':
        return parseAnthropic(await getJson(cfg, joinUrl(cfg.baseUrl, `models/${encodeURIComponent(cfg.model)}`), signal));
      case 'ollama': {
        const res = await request(cfg, joinUrl(ollamaRoot(cfg.baseUrl), 'api/show'), { method: 'POST', body: { model: cfg.model } }, signal);
        return parseOllama(await res.json());
      }
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof ProviderError && !FATAL_KINDS.has(err.kind)) return null;
    if (err instanceof SyntaxError) return null; // catalogue body was not JSON
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Self-test

export const PING_ECHO_TOOL: ToolSpec = {
  name: 'ping_echo',
  description: 'Echoes the number n back. Used to check that tool calls work.',
  inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false },
};

const OK_SCHEMA = {
  name: 'ok_check',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
};

export interface SelfTestOptions {
  /** Digit drawn in the vision image (default 6). */
  digit?: number;
}

/** Errors that mean "this model or server does not support what was asked". Anything else aborts the self-test. */
function isCapabilityError(e: ProviderErrorInfo): boolean {
  return e.kind === 'bad_request' || e.kind === 'unsupported_param';
}

/** Runs one self-test call. Returns null when the call failed for capability reasons; throws on anything else. */
async function attempt(model: ChatModel, req: ChatRequest, signal?: AbortSignal): Promise<ChatResult | null> {
  const res = await model.complete(req, signal);
  if (!res.error) return res;
  if (isCapabilityError(res.error)) return null;
  throw new ProviderError(res.error);
}

const textOfResult = (r: ChatResult): string =>
  r.message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('').trim();

/**
 * Three calls (plus one json_object retry when json_schema is rejected with a 400). `makeModel` builds a model that
 * assumes the given capabilities, so the adapter actually sends tools, images and json_schema during the test.
 * Auth, network, rate-limit and other non-capability failures abort and rethrow: a bogus result is never returned.
 */
export async function runSelfTest(
  makeModel: (caps: Capabilities) => ChatModel,
  base: Capabilities,
  signal?: AbortSignal,
  opts: SelfTestOptions = {},
): Promise<Partial<Capabilities>> {
  const optimistic: Capabilities = { ...base, tools: true, parallelTools: true, vision: true, maxImages: Math.max(1, base.maxImages), jsonSchema: true };
  const model = makeModel(optimistic);
  const out: Partial<Capabilities> = {};

  // (a) Tool call, and parallel tool calls in one reply.
  const toolRes = await attempt(
    model,
    {
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Call the ping_echo tool twice in this same reply: once with n=3 and once with n=4. Do not write any other text.' }],
        },
      ],
      tools: [PING_ECHO_TOOL],
      toolChoice: 'auto',
      parallelTools: true,
      maxOutputTokens: 200,
    },
    signal,
  );
  const ns = new Set(
    (toolRes?.message.toolCalls ?? [])
      .filter((c) => c.name === 'ping_echo' && !c.parseError && (c.args.n === 3 || c.args.n === 4))
      .map((c) => c.args.n),
  );
  out.tools = ns.size > 0;
  out.parallelTools = ns.size === 2;

  // (b) Vision.
  const digit = opts.digit ?? 6;
  const visionRes = await attempt(
    model,
    {
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'image', mime: 'image/png', source: { kind: 'base64', data: bytesToBase64(digitPng(digit)) }, width: 64, height: 64 },
            { type: 'text', text: 'Reply with only the digit in the image.' },
          ],
        },
      ],
      maxOutputTokens: 20,
    },
    signal,
  );
  const digits = visionRes ? textOfResult(visionRes).match(/\d/g) ?? [] : [];
  out.vision = digits.length > 0 && digits.every((d) => d === String(digit));

  // (c) Structured output: json_schema, then json_object once if json_schema is rejected.
  const jsonReq: ChatRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with a JSON object {"ok": true} and nothing else.' }] }],
    responseSchema: OK_SCHEMA,
    maxOutputTokens: 50,
  };
  const okJson = (r: ChatResult | null): boolean => {
    if (!r) return false;
    try {
      const v: unknown = JSON.parse(textOfResult(r));
      return isObj(v) && typeof v.ok === 'boolean';
    } catch {
      return false;
    }
  };
  const schemaRes = await attempt(model, jsonReq, signal);
  if (schemaRes) {
    out.jsonSchema = okJson(schemaRes);
  } else {
    out.jsonSchema = false;
    const objModel = makeModel({ ...optimistic, jsonSchema: false, jsonObject: true });
    out.jsonObject = okJson(await attempt(objModel, jsonReq, signal));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Orchestration

export interface ProbeArgs {
  cfg: AdapterConfig;
  cache: CapabilityCache;
  nowIso: string;
  /** The user agreed to spend ~600 tokens on the self-test. */
  allowSelfTest: boolean;
  makeModel?: (caps: Capabilities) => ChatModel;
  signal?: AbortSignal;
  selfTest?: SelfTestOptions;
}

/** Cache → catalogue → self-test (if allowed) → preset defaults (not cached). */
export async function probeCapabilities(args: ProbeArgs): Promise<Capabilities> {
  const { cfg, cache, nowIso, signal } = args;
  const base = presetCapabilities(cfg.preset);
  const hit = await cache.get(cfg.baseUrl, cfg.model, nowIso);
  if (hit) return { ...hit, browserDirect: base.browserDirect };

  const catalogue = await readCatalogue(cfg, signal);
  if (catalogue) {
    const caps: Capabilities = { ...base, ...catalogue, browserDirect: base.browserDirect, verifiedAt: nowIso, source: 'catalog' };
    await cache.set(cfg.baseUrl, cfg.model, caps);
    return caps;
  }
  if (args.allowSelfTest && args.makeModel) {
    const st = await runSelfTest(args.makeModel, base, signal, args.selfTest);
    const caps: Capabilities = { ...base, ...st, browserDirect: base.browserDirect, verifiedAt: nowIso, source: 'selftest' };
    await cache.set(cfg.baseUrl, cfg.model, caps);
    return caps;
  }
  return base;
}

// ---------------------------------------------------------------------------------------------------------------
// Degradation (R8 §3.6)

export interface Degradation {
  /** No tools: answer from the briefing; logging via structured extraction shown as a proposal. */
  chatOnly: boolean;
  structuredExtraction: boolean;
  /** Photo button visible. Without vision, offer "describe the meal in words" or a vision fallback model. */
  photoButton: boolean;
  /** No parallel tools: one call per step, step cap raised to 12. */
  singleToolPerStep: boolean;
  maxToolSteps: number;
  /** No json_schema/strict: validate and repair once, then show raw text and "Fill the form instead". */
  validateAndRepair: boolean;
  /** No streaming: non-stream request with a spinner. */
  nonStreaming: boolean;
  /** Usage not reported on streams: numbers are estimated and flagged `~`. */
  usageEstimated: boolean;
  /** Preset is not reachable from the browser: "Needs the Vitals Companion". */
  needsCompanion: boolean;
  /** Small/local model: only `read` and `log` tools (`get_*`, `log_*`); plan edits and simulations refused. */
  basicTier: boolean;
}

/**
 * Basic-tier heuristic (R8 §3.6 "small/local model (<15B)"): the model id names a size under 15B (`8b`, `1.5b`,
 * `0.5b`, `14b`; also sizes in millions like `360m`), or the preset is a local server (Ollama, LM Studio), where
 * models are usually quantised and small. MoE ids like `30b-a3b` count by their total size (the `a3b` part is not a
 * separate word). The heuristic errs on the side of "basic"; the conformance suite can override it later.
 */
export function isBasicTier(modelId: string, presetId?: string): boolean {
  if (presetId === 'ollama' || presetId === 'lmstudio') return true;
  return /\b(0|[1-9]|1[0-4])(\.\d+)?b\b/i.test(modelId) || /\b\d{2,3}m\b/i.test(modelId);
}

export function degradeFor(caps: Capabilities, ctx: { model?: string; presetId?: string } = {}): Degradation {
  const chatOnly = !caps.tools;
  const singleToolPerStep = !chatOnly && !caps.parallelTools;
  return {
    chatOnly,
    structuredExtraction: chatOnly,
    photoButton: caps.vision,
    singleToolPerStep,
    maxToolSteps: singleToolPerStep ? 12 : 8,
    validateAndRepair: !caps.jsonSchema || !caps.strictTools,
    nonStreaming: !caps.streaming,
    usageEstimated: !caps.streamUsage,
    needsCompanion: !caps.browserDirect,
    basicTier: isBasicTier(ctx.model ?? '', ctx.presetId),
  };
}
