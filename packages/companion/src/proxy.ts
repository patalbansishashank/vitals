/**
 * Provider proxy (SUITE_SPEC §7.2 `POST /v1/ai/{preset}/…`, alias `/proxy/{preset}/…` used by `src/ai/providers`):
 * the page sends its local pairing bearer and no provider auth; the Companion strips every incoming credential, adds
 * its own, and streams the upstream body back unchanged. Provider keys and OAuth tokens never reach the page.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { configFiles, ensureConfigDir, readJsonFile, writeJsonSecret } from './config.ts';
import { HttpError, readBody, sendJson, type Logger } from './security.ts';
import { SiwcError, type Siwc } from './siwc.ts';

export interface Upstream {
  baseUrl: string;
  /** Allowed sub-paths and their method. */
  paths: Record<string, 'GET' | 'POST'>;
  auth: { kind: 'key'; env: string } | { kind: 'siwc' };
  label: string;
  /** Sub-paths the upstream answers without a credential (e.g. a public model catalogue), forwarded key-less when no key is set. */
  publicPaths?: readonly string[];
}

/** Upstream table. `siwc` goes to the public Responses API, never `chatgpt.com/backend-api` (research §1.4). */
export const UPSTREAMS: Record<string, Upstream> = {
  nim: {
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    paths: { 'chat/completions': 'POST', models: 'GET' },
    auth: { kind: 'key', env: 'NVIDIA_API_KEY' },
  },
  'opencode-zen': {
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    paths: { 'chat/completions': 'POST', models: 'GET' },
    auth: { kind: 'key', env: 'OPENCODE_API_KEY' },
    // GET https://opencode.ai/zen/v1/models answers without a key (checked 2026-10-03), so the picker can list models first.
    publicPaths: ['models'],
  },
  siwc: {
    label: 'Sign in with ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    paths: { responses: 'POST', models: 'GET' },
    auth: { kind: 'siwc' },
  },
};

export const KEY_PRESETS = Object.keys(UPSTREAMS).filter((id) => UPSTREAMS[id]!.auth.kind === 'key');
export const PROXY_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Request headers forwarded upstream; everything else (Authorization, Cookie, Origin, …) is dropped. */
const FORWARD_REQUEST = ['content-type', 'accept', 'openai-beta'];
/** Response headers passed back; notably never `set-cookie`, and no length/encoding (fetch decoded the body). */
const FORWARD_RESPONSE = /^(content-type|cache-control|retry-after|x-request-id|openai-processing-ms|x-ratelimit-[a-z-]+)$/;

// ---------------------------------------------------------------------------------------------------------------
// Keys (`<configDir>/keys.json`, 0600; environment variables win)

type KeysFile = Record<string, string>;

/**
 * `file` overrides `<configDir>/keys.json` (the server keeps a person's keys in `persons/<id>/credentials/providers.json`,
 * SUITE_SPEC §14.1); a person's store passes `env: {}` so a host environment variable never serves every person.
 */
export function createKeyStore(configDir: string, env: NodeJS.ProcessEnv = process.env, file: string = configFiles(configDir).keys) {
  const readAll = async (): Promise<KeysFile> => {
    const k = await readJsonFile<KeysFile>(file);
    return k && typeof k === 'object' ? k : {};
  };
  return {
    async get(preset: string): Promise<string | null> {
      const u = UPSTREAMS[preset];
      if (!u || u.auth.kind !== 'key') return null;
      const fromEnv = env[u.auth.env]?.trim();
      if (fromEnv) return fromEnv;
      const v = (await readAll())[preset];
      return typeof v === 'string' && v ? v : null;
    },
    async set(preset: string, key: string): Promise<void> {
      await ensureConfigDir(configDir);
      await writeJsonSecret(file, { ...(await readAll()), [preset]: key });
    },
    async remove(preset: string): Promise<boolean> {
      const all = await readAll();
      if (!(preset in all)) return false;
      delete all[preset];
      await writeJsonSecret(file, all);
      return true;
    },
    async configured(): Promise<Record<string, boolean>> {
      const out: Record<string, boolean> = {};
      for (const id of KEY_PRESETS) out[id] = (await this.get(id)) !== null;
      return out;
    },
    /** For `keys list`: where each key comes from. */
    async sources(): Promise<Record<string, 'env' | 'file' | null>> {
      const all = await readAll();
      const out: Record<string, 'env' | 'file' | null> = {};
      for (const id of KEY_PRESETS) {
        const u = UPSTREAMS[id]!;
        out[id] = u.auth.kind === 'key' && env[u.auth.env]?.trim() ? 'env' : typeof all[id] === 'string' && all[id] ? 'file' : null;
      }
      return out;
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

// ---------------------------------------------------------------------------------------------------------------
// SIWC request rewriting (research §1.2 "Unsupported", "Tools")

export const SIWC_UNSUPPORTED_PARAMS = [
  'previous_response_id',
  'temperature',
  'top_p',
  'max_output_tokens',
  'metadata',
  'background',
  'prompt',
  'truncation',
  'user',
  'service_tier',
];

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

export const SIWC_USAGE_LIMIT_CODE = 'subscription_sharing_usage_limit_exceeded';

/** The body sent for a ChatGPT 429: OpenAI's error shape, with an actionable message for the usage-limit code. */
export function siwcLimitBody(upstreamText: string): { error: { message: string; type: string; code: string } } {
  let code = 'rate_limit_exceeded';
  try {
    const e = (JSON.parse(upstreamText) as { error?: { code?: unknown } }).error;
    if (typeof e?.code === 'string') code = e.code;
  } catch {
    if (upstreamText.includes(SIWC_USAGE_LIMIT_CODE)) code = SIWC_USAGE_LIMIT_CODE;
  }
  const message =
    code === SIWC_USAGE_LIMIT_CODE
      ? 'Your ChatGPT plan has reached its usage limit for now (the limit is shared with other apps that use your plan). See ChatGPT › Settings › Usage: https://chatgpt.com/settings/usage'
      : 'ChatGPT is limiting requests right now. Wait a minute and try again.';
  return { error: { message, type: 'rate_limit', code } };
}

/** What the namespace says about itself; OpenAI requires a description on every tool entry (400 without it). */
export const SIWC_NAMESPACE_DESCRIPTION = "Vitals: the person's plan, logs, measurements and settings. Call these to read or change them.";

/** `store:false`, unsupported params removed, `system` input items → `instructions`, function tools namespaced, `stream:true`. */
export function rewriteSiwcBody(body: Record<string, unknown>, namespace = 'vitals'): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, store: false };
  for (const p of SIWC_UNSUPPORTED_PARAMS) delete out[p];
  if (Array.isArray(out.input)) {
    const system: string[] = [];
    out.input = out.input.filter((item: unknown) => {
      if (item && typeof item === 'object' && (item as { role?: unknown }).role === 'system') {
        const t = textOf((item as { content?: unknown }).content);
        if (t) system.push(t);
        return false;
      }
      return true;
    });
    if (system.length) out.instructions = [typeof out.instructions === 'string' ? out.instructions : '', ...system].filter(Boolean).join('\n\n');
  }
  if (Array.isArray(out.tools)) {
    // every namespace needs a description (OpenAI: 400 "Missing required parameter: 'tools[0].description'")
    for (const t of out.tools) {
      if (t && typeof t === 'object' && (t as { type?: unknown }).type === 'namespace' && !(t as { description?: unknown }).description) {
        (t as { description?: string }).description = SIWC_NAMESPACE_DESCRIPTION;
      }
    }
    const loose = out.tools.filter((t: unknown) => t && typeof t === 'object' && ['function', 'custom'].includes((t as { type?: unknown }).type as string));
    if (loose.length) {
      const rest = out.tools.filter((t: unknown) => !loose.includes(t));
      const existing = rest.find((t: unknown) => (t as { type?: unknown; name?: unknown })?.type === 'namespace' && (t as { name?: unknown }).name === namespace) as
        | { tools?: unknown[] }
        | undefined;
      if (existing) {
        existing.tools = [...(Array.isArray(existing.tools) ? existing.tools : []), ...loose];
        if (!(existing as { description?: unknown }).description) (existing as { description?: string }).description = SIWC_NAMESPACE_DESCRIPTION;
        out.tools = rest;
      } else {
        out.tools = [...rest, { type: 'namespace', name: namespace, description: SIWC_NAMESPACE_DESCRIPTION, tools: loose }];
      }
    }
  }
  // The ChatGPT-plan backend answers "Stream must be set to true" (400) to non-streaming requests; the proxy streams
  // upstream and, for a caller that did not ask for a stream, collapses the events into the final response (below).
  out.stream = true;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Handler

/** One AI request as the usage log records it (no prompt text). */
export interface ProxyUsage {
  preset: string;
  path: string;
  model: string | null;
  status: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProxyOptions {
  upstreams?: Record<string, Upstream>;
  keys: KeyStore;
  siwc: Siwc;
  log: Logger;
  fetch?: typeof globalThis.fetch;
  maxBodyBytes?: number;
  /** Called once per upstream answer, after the body was passed on (server usage log). */
  onUsage?: (u: ProxyUsage) => void;
  /**
   * When set, a non-2xx upstream answer is not passed through: the hook gets its status and text and answers with
   * its own status and JSON body (the server's plain-words error contract). The ChatGPT 429 goes here too.
   */
  mapUpstreamError?: (preset: string, status: number, text: string) => { status: number; body: unknown; headers?: Record<string, string> };
  /** Time to the upstream's response headers before answering 504 `upstream_timeout` (default none). */
  upstreamTimeoutMs?: number;
}

/** Matches `/proxy/<preset>/<path>` and `/v1/ai/<preset>/<path>`. */
export function parseProxyPath(rawPath: string): { preset: string; path: string } | null {
  const m = /^\/(?:proxy|v1\/ai)\/([a-z0-9-]+)\/(.+)$/.exec(rawPath);
  return m ? { preset: m[1]!, path: m[2]! } : null;
}

export function createProxy(opts: ProxyOptions) {
  const upstreams = opts.upstreams ?? UPSTREAMS;
  const { keys, siwc, log, maxBodyBytes = PROXY_MAX_BODY_BYTES, onUsage, mapUpstreamError, upstreamTimeoutMs } = opts;
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const credentialFor = async (u: Upstream, preset: string, path: string): Promise<string | null> => {
    if (u.auth.kind === 'siwc') {
      try {
        return await siwc.accessToken();
      } catch (e) {
        if (e instanceof SiwcError) throw new HttpError(e.code === 'signed_out' ? 401 : 502, e.code === 'signed_out' ? 'siwc_signed_out' : 'siwc_refresh_failed', e.message);
        throw e;
      }
    }
    const key = await keys.get(preset);
    if (!key && !u.publicPaths?.includes(path)) throw new HttpError(503, 'key_missing', `No ${u.label} key on the Companion. Run: vitals-companion keys set ${preset}`);
    if (key) log.addSecret(key);
    return key ?? null;
  };

  return {
    has: (preset: string, path: string) => Boolean(upstreams[preset]?.paths[path]),
    /**
     * Readiness check for a preset: the credential is there (refreshed if needed) and the upstream model list
     * answers. Throws the same HttpErrors as `handle` for a missing credential; never returns a credential.
     */
    async probe(preset: string, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; models: number; text?: string }> {
      const u = upstreams[preset];
      if (!u || u.paths.models !== 'GET') throw new HttpError(404, 'unknown_route', 'Unknown preset or path');
      if (u.auth.kind === 'key' && !(await keys.get(preset))) throw new HttpError(503, 'key_missing', `No ${u.label} key`);
      const credential = await credentialFor(u, preset, 'models');
      let r: Response;
      try {
        r = await doFetch(`${u.baseUrl}/models`, {
          method: 'GET',
          headers: credential ? { authorization: `Bearer ${credential}`, accept: 'application/json' } : { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'TimeoutError') throw new HttpError(504, 'upstream_timeout', `${u.label} did not answer in time`);
        throw new HttpError(502, 'upstream_unreachable', `${u.label} could not be reached`);
      }
      const text = await r.text().catch(() => '');
      if (!r.ok) return { ok: false, status: r.status, models: 0, text };
      const body = preset === 'siwc' ? siwcModelsBody(text) : (() => {
        try {
          return JSON.parse(text) as { data?: unknown[] };
        } catch {
          return { data: [] };
        }
      })();
      return { ok: true, status: r.status, models: Array.isArray(body.data) ? body.data.length : 0 };
    },
    async handle(req: IncomingMessage, res: ServerResponse, preset: string, path: string, query: string): Promise<void> {
      const u = upstreams[preset];
      const method = u?.paths[path];
      if (!u || !method) throw new HttpError(404, 'unknown_route', 'Unknown preset or path');
      if (req.method !== method) throw new HttpError(405, 'method', `Use ${method}`, { Allow: method });

      let body: Buffer | undefined;
      let collapseStream = false;
      let model: string | null = null;
      if (method === 'POST') {
        body = await readBody(req, maxBodyBytes);
        if (onUsage) model = modelOf(body);
        if (preset === 'siwc' && path === 'responses') {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString('utf8'));
          } catch {
            throw new HttpError(400, 'bad_json', 'Body must be JSON');
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
          collapseStream = (parsed as { stream?: unknown }).stream !== true;
          body = Buffer.from(JSON.stringify(rewriteSiwcBody(parsed as Record<string, unknown>)));
        }
      }

      const credential = await credentialFor(u, preset, path);

      const headers: Record<string, string> = {};
      for (const h of FORWARD_REQUEST) {
        const v = req.headers[h];
        if (typeof v === 'string') headers[h] = v;
      }
      if (body && !headers['content-type']) headers['content-type'] = 'application/json';
      if (credential) headers.authorization = `Bearer ${credential}`;

      const ac = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) ac.abort();
      };
      res.on('close', onClose);

      let upstream: Response;
      let timedOut = false;
      const timer = upstreamTimeoutMs
        ? setTimeout(() => {
            timedOut = true;
            ac.abort();
          }, upstreamTimeoutMs)
        : null;
      try {
        upstream = await doFetch(`${u.baseUrl}/${path}${query}`, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: ac.signal, redirect: 'error' });
      } catch (e) {
        res.off('close', onClose);
        if (timedOut) {
          log(`proxy ${preset}/${path}: upstream timed out`);
          throw new HttpError(504, 'upstream_timeout', `${u.label} did not answer in time`);
        }
        if (ac.signal.aborted) return;
        log(`proxy ${preset}/${path}: upstream unreachable (${e instanceof Error ? e.name : 'error'})`);
        throw new HttpError(502, 'upstream_unreachable', `${u.label} could not be reached`);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const usage = { input: 0, output: 0 };
      const report = (status: number) => onUsage?.({ preset, path, model, status, inputTokens: usage.input, outputTokens: usage.output });

      if (mapUpstreamError && !upstream.ok) {
        res.off('close', onClose);
        const text = await upstream.text().catch(() => '');
        const mapped = mapUpstreamError(preset, upstream.status, text);
        const retry = upstream.headers.get('retry-after');
        log(`proxy ${preset}/${path} → ${upstream.status} (answered ${mapped.status})`);
        report(upstream.status);
        if (retry) res.setHeader('Retry-After', retry);
        return void sendJson(res, mapped.status, mapped.body, mapped.headers);
      }

      if (preset === 'siwc' && upstream.status === 429) {
        // ChatGPT plan limit (shared with other apps): say so in plain words, keep OpenAI's error shape and code.
        res.off('close', onClose);
        const text = await upstream.text().catch(() => '');
        const retry = upstream.headers.get('retry-after');
        log(`proxy ${preset}/${path} → 429`);
        if (retry) res.setHeader('Retry-After', retry);
        return void sendJson(res, 429, siwcLimitBody(text));
      }
      if (preset === 'siwc' && path === 'models' && upstream.ok) {
        // The ChatGPT-plan backend lists `{models:[{slug,…}]}`; the app reads the OpenAI shape `{data:[{id,…}]}`.
        res.off('close', onClose);
        const text = await upstream.text().catch(() => '');
        log(`proxy ${preset}/${path} → ${upstream.status} (translated)`);
        return void sendJson(res, 200, siwcModelsBody(text));
      }
      if (collapseStream && upstream.ok && (upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
        // The caller did not ask for a stream: hand back the final response object as JSON.
        const text = await upstream.text().catch(() => '');
        res.off('close', onClose);
        const final = finalResponseOf(text);
        log(`proxy ${preset}/${path} → ${upstream.status} (collapsed)`);
        if (onUsage) {
          sniffUsage(text, usage);
          report(final?.status ?? 502);
        }
        if (!final) throw new HttpError(502, 'upstream_stream', `${u.label} ended the stream without a final response`);
        return void sendJson(res, final.status, final.body);
      }
      const out: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
      upstream.headers.forEach((v, k) => {
        if (FORWARD_RESPONSE.test(k)) out[k] = v;
      });
      for (const [k, v] of Object.entries(out)) res.setHeader(k, v);
      res.writeHead(upstream.status);
      res.flushHeaders();
      log(`proxy ${preset}/${path} → ${upstream.status}`);
      if (!upstream.body) {
        res.end();
        report(upstream.status);
        return;
      }
      // Usage is read from the passing bytes without holding the body back: one line buffer, nothing else kept.
      const sniffer = onUsage ? createUsageSniffer(usage) : null;
      try {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          if (res.destroyed) break;
          res.write(chunk);
          sniffer?.push(chunk);
        }
        res.end();
      } catch {
        // Client went away (aborted upstream) or the upstream broke mid-stream.
        res.destroy();
      } finally {
        res.off('close', onClose);
        sniffer?.end();
        report(upstream.status);
      }
    },
  };
}

/** `{models:[{slug,…}]}` from the ChatGPT-plan backend → OpenAI's `{object:'list', data:[{id,…}]}`, raw fields kept. */
export function siwcModelsBody(text: string): { object: 'list'; data: Array<Record<string, unknown>> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { object: 'list', data: [] };
  }
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
    ? ((parsed as { data: unknown[] }).data)
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
      ? ((parsed as { models: unknown[] }).models)
      : [];
  const data = list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({ ...m, id: typeof m.id === 'string' ? m.id : String(m.slug ?? ''), object: 'model' }))
    .filter((m) => m.id);
  return { object: 'list', data };
}

/**
 * The final object of a Responses SSE stream: `response.completed|failed|incomplete` → 200 with its `response`;
 * an `error` event → its status (default 502) and body. Null when neither arrived.
 */
export function finalResponseOf(sse: string): { status: number; body: unknown } | null {
  let result: { status: number; body: unknown } | null = null;
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    let ev: unknown;
    try {
      ev = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object') continue;
    const type = (ev as { type?: unknown }).type;
    if (type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete') {
      result = { status: 200, body: (ev as { response?: unknown }).response ?? ev };
    } else if (type === 'error') {
      const e = ev as { status?: unknown; code?: unknown; message?: unknown; error?: unknown };
      const status = typeof e.status === 'number' ? e.status : 502;
      result = { status, body: e.error ?? { error: { message: String(e.message ?? 'stream error'), code: e.code ?? null, type: 'stream_error' } } };
    }
  }
  return result;
}

/** The `model` of a JSON request body, or null. */
function modelOf(body: Buffer): string | null {
  try {
    const m = (JSON.parse(body.toString('utf8')) as { model?: unknown }).model;
    return typeof m === 'string' ? m.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Token counts from an OpenAI-style `usage` object (Chat Completions or Responses naming). */
function readUsage(u: unknown, into: { input: number; output: number }): void {
  if (!u || typeof u !== 'object') return;
  const v = u as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  const input = num(v.prompt_tokens) ?? num(v.input_tokens);
  const output = num(v.completion_tokens) ?? num(v.output_tokens);
  if (input !== null) into.input = input;
  if (output !== null) into.output = output;
}

/** Usage from a JSON body or an SSE text (`data:` lines carrying `usage` or `response.usage`). */
export function sniffUsage(text: string, into: { input: number; output: number }): void {
  const visit = (raw: string) => {
    if (!raw.includes('usage')) return;
    try {
      const v = JSON.parse(raw) as { usage?: unknown; response?: { usage?: unknown } };
      readUsage(v.usage, into);
      readUsage(v.response?.usage, into);
    } catch {
      // not JSON
    }
  };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return visit(trimmed);
  for (const line of text.split(/\r?\n/)) if (line.startsWith('data:')) visit(line.slice(5).trim());
}

/** Incremental `sniffUsage` over a byte stream; keeps at most one partial line (capped at 1 MiB). */
function createUsageSniffer(into: { input: number; output: number }) {
  const decoder = new TextDecoder();
  let carry = '';
  let first = true;
  let json = false;
  const MAX = 1024 * 1024;
  return {
    push(chunk: Uint8Array) {
      const text = decoder.decode(chunk, { stream: true });
      if (first && text.trim()) {
        first = false;
        json = text.trimStart().startsWith('{');
      }
      carry += text;
      if (json) {
        if (carry.length > 8 * MAX) carry = '';
        return;
      }
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? '';
      if (carry.length > MAX) carry = '';
      for (const l of lines) if (l.startsWith('data:')) sniffUsage(l, into);
    },
    end() {
      carry += decoder.decode();
      if (carry) sniffUsage(carry, into);
      carry = '';
    },
  };
}
