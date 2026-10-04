/**
 * AI providers through the server (SUITE_SPEC §14.3). Every route resolves the person from the device token alone
 * and uses only that person's credentials (`persons/<id>/credentials/providers.json` for keys, `…/siwc.json` for the
 * ChatGPT sign-in), usage log and limits. The upstream request and the SSE passthrough are the Companion proxy's
 * (`proxy.ts`), unchanged; what this file adds is the person, the per-person limits, the usage log and the
 * plain-words error contract. Nothing here returns a key or a ChatGPT token.
 *
 * Routes (device tokens of kind `device` only):
 *   GET    /v1/ai/status                 which services are ready for this person
 *   PUT    /v1/ai/keys/{preset}          { key }  → 204   (nim, opencode-zen)
 *   DELETE /v1/ai/keys/{preset}          → 204
 *   GET    /v1/ai/siwc/status            { signedIn, plan?, expiresAt? }
 *   POST   /v1/ai/siwc/logout            → 204
 *   GET    /v1/ai/{preset}/models        upstream list
 *   GET    /v1/ai/{preset}/probe         { ready, models } (credential present and the model list answers)
 *   POST   /v1/ai/{preset}/{path}        upstream answer; SSE passed through chunk by chunk
 *   GET    /v1/ai/usage                  today's requests and tokens, and the daily cap
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { createKeyStore, createProxy, KEY_PRESETS, PROXY_MAX_BODY_BYTES, SIWC_USAGE_LIMIT_CODE, UPSTREAMS, type KeyStore, type Upstream } from './proxy.ts';
import { isFailure, type PersonContext, type ResolvePerson } from './personContext.ts';
import { createRateLimiter, HttpError, readBody, readJson, sendJson, type Logger } from './security.ts';
import { createSiwc, type Siwc, type SiwcEndpoints } from './siwc.ts';
import { createUsageLog, type UsageLog } from './usage.ts';

// ---------------------------------------------------------------------------------------------------------------
// Error contract (§14.3). `message` is shown to the person as is: plain words, no file, module, route or plan names.

export const AI_ERROR_MESSAGES = {
  unauthorized: 'This device is no longer connected to your server. Connect it again in Settings › Server.',
  revoked: 'This device was removed from your server. Connect it again in Settings › Server.',
  not_signed_in: "ChatGPT isn't signed in on your server yet. Whoever runs your server can do that once.",
  no_key: 'Add a key for this service in Settings › Coach first.',
  usage_limit: "Your ChatGPT plan's limit is reached for now. Try again later or pick another service.",
  rate_limited: 'Too many requests in a short time. Wait a minute and try again.',
  upstream_error: 'The AI service answered with an error. Try again in a moment.',
  upstream_timeout: 'The AI service did not answer in time. Try again.',
  // not in the §14.3 table: the service said the key is wrong or revoked (the message names the service)
  key_refused: 'The service refused the key kept on your server. Replace it above.',
  // not in the §14.3 table; decided here (hand-back E26): the per-person daily cap and plain request errors
  daily_cap: "Today's limit for AI requests on your server is reached. It starts again tomorrow.",
  wrong_kind: 'This connection cannot do that. Use the Vitals app on a connected device.',
  bad_request: 'That request could not be read. Try again.',
  too_large: 'That message is too large to send. Try a shorter one or a smaller picture.',
  not_found: "That isn't available on your server.",
} as const;
export type AiErrorCode = keyof typeof AI_ERROR_MESSAGES;

export const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
  unauthorized: 401,
  revoked: 401,
  not_signed_in: 409,
  no_key: 409,
  usage_limit: 429,
  rate_limited: 429,
  upstream_error: 502,
  upstream_timeout: 504,
  key_refused: 502,
  daily_cap: 429,
  wrong_kind: 403,
  bad_request: 400,
  too_large: 413,
  not_found: 404,
};

export function aiErrorBody(code: AiErrorCode, detail?: Record<string, unknown>) {
  return { error: { code, message: AI_ERROR_MESSAGES[code], ...(detail ? { detail } : {}) } };
}

export class AiError extends Error {
  code: AiErrorCode;
  detail?: Record<string, unknown>;
  headers: Record<string, string>;
  constructor(code: AiErrorCode, detail?: Record<string, unknown>, headers: Record<string, string> = {}) {
    super(AI_ERROR_MESSAGES[code]);
    this.code = code;
    this.detail = detail;
    this.headers = headers;
  }
}

export function sendAiError(res: ServerResponse, e: AiError): void {
  sendJson(res, AI_ERROR_STATUS[e.code], aiErrorBody(e.code, e.detail), e.code === 'unauthorized' || e.code === 'revoked' ? { 'WWW-Authenticate': 'Bearer', ...e.headers } : e.headers);
}

/** The proxy's own HttpError codes → the contract. */
export function fromProxyError(e: HttpError): AiError {
  switch (e.code) {
    case 'siwc_signed_out':
      return new AiError('not_signed_in');
    case 'siwc_refresh_failed':
      return new AiError('upstream_error', { status: 0 });
    case 'key_missing':
      return new AiError('no_key');
    case 'upstream_timeout':
      return new AiError('upstream_timeout');
    case 'upstream_unreachable':
    case 'upstream_stream':
      return new AiError('upstream_error', { status: 0 });
    case 'body_too_large':
      return new AiError('too_large');
    case 'unknown_route':
      return new AiError('not_found');
    case 'rate_limited':
      return new AiError('rate_limited', undefined, e.headers);
    default:
      return new AiError('bad_request');
  }
}

/** Upstream error text → a short detail (OpenAI-style `error.code` / `error.type` only; never the raw body). */
function upstreamCode(text: string): string | undefined {
  try {
    const e = (JSON.parse(text) as { error?: { code?: unknown; type?: unknown } }).error;
    const c = typeof e?.code === 'string' ? e.code : typeof e?.type === 'string' ? e.type : undefined;
    return c ? c.replace(/[^\w.-]/g, '').slice(0, 64) : undefined;
  } catch {
    return text.includes(SIWC_USAGE_LIMIT_CODE) ? SIWC_USAGE_LIMIT_CODE : undefined;
  }
}

export function mapUpstreamError(preset: string, status: number, text: string): { status: number; body: unknown } {
  const code = upstreamCode(text);
  const detail = { status, ...(code ? { upstreamCode: code } : {}) };
  if (status === 429) {
    const which: AiErrorCode = preset === 'siwc' && code === SIWC_USAGE_LIMIT_CODE ? 'usage_limit' : 'rate_limited';
    return { status: 429, body: aiErrorBody(which, detail) };
  }
  if (status === 504 || status === 408) return { status: 504, body: aiErrorBody('upstream_timeout', detail) };
  // a key service that refuses the key: trying again will not help, the person replaces the key (502, never 401: the
  // website reads 401 as "this device is unpaired")
  const upstream = UPSTREAMS[preset];
  if ((status === 401 || status === 403 || status === 410) && upstream?.auth.kind === 'key') {
    const message = `${upstream.label} refused the key kept on your server. Replace it above.`;
    return { status: AI_ERROR_STATUS.key_refused, body: { error: { code: 'key_refused', message, detail } } };
  }
  return { status: 502, body: aiErrorBody('upstream_error', detail) };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-person parts

export const SERVER_PRESETS = ['siwc', 'nim', 'opencode-zen'] as const;
export type ServerPreset = (typeof SERVER_PRESETS)[number];
export const DEFAULT_AI_REQUESTS_PER_MINUTE = 30;
/** A limit from a config file: a whole number of at least 1, or undefined (NaN, 0, negative and text mean no setting, never a block). */
export const positiveInt = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined);
/** Time to the upstream's response headers (a long stream after that is fine). */
export const UPSTREAM_HEADERS_TIMEOUT_MS = 120_000;

interface PersonAi {
  keys: KeyStore;
  siwc: Siwc;
  usage: UsageLog;
  proxy: ReturnType<typeof createProxy>;
  timeZone: string;
}

export interface ProviderRoutesOptions {
  resolvePerson: ResolvePerson;
  log: Logger;
  fetch?: typeof globalThis.fetch;
  upstreams?: Record<string, Upstream>;
  siwcEndpoints?: Partial<SiwcEndpoints>;
  /** `server.json` `limits.aiRequestsPerMinute` (default 30 per person). */
  aiRequestsPerMinute?: number;
  /** Optional cap of AI requests per person per day (the person's day). */
  requestsPerDay?: number;
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
  now?: () => number;
}

export function createProviderRoutes(opts: ProviderRoutesOptions) {
  const { resolvePerson, log, upstreams = UPSTREAMS, maxBodyBytes = PROXY_MAX_BODY_BYTES, now = Date.now } = opts;
  const perMinute = positiveInt(opts.aiRequestsPerMinute) ?? DEFAULT_AI_REQUESTS_PER_MINUTE;
  const limiter = createRateLimiter({ capacity: Math.max(1, Math.min(perMinute, 20)), perMinute }, now);
  const persons = new Map<string, PersonAi>();

  /** One set per person, so concurrent refreshes of one ChatGPT session share one request. */
  const partsFor = (p: PersonContext): PersonAi => {
    const have = persons.get(p.id);
    if (have) {
      have.timeZone = p.timeZone;
      return have;
    }
    const keys = createKeyStore(p.configDir, {}, join(p.configDir, 'providers.json'));
    const siwc = createSiwc({ configDir: p.configDir, log, endpoints: opts.siwcEndpoints, fetch: opts.fetch, openBrowser: () => undefined, now });
    const parts: PersonAi = { keys, siwc, timeZone: p.timeZone } as PersonAi;
    parts.usage = createUsageLog({ personDir: p.dataDir, timeZone: () => parts.timeZone, requestsPerDay: positiveInt(opts.requestsPerDay), now });
    parts.proxy = createProxy({
      keys,
      siwc,
      log,
      fetch: opts.fetch,
      upstreams,
      maxBodyBytes,
      upstreamTimeoutMs: opts.upstreamTimeoutMs ?? UPSTREAM_HEADERS_TIMEOUT_MS,
      mapUpstreamError,
      onUsage: (u) => {
        if (u.path === 'models') return;
        void parts.usage.append({ preset: u.preset, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, status: u.status });
      },
    });
    persons.set(p.id, parts);
    return parts;
  };

  const method = (req: IncomingMessage, m: string) => {
    if (req.method !== m) throw new AiError('not_found');
  };

  const status = async (a: PersonAi) => {
    const configured = await a.keys.configured();
    const s = await a.siwc.status();
    return SERVER_PRESETS.map((id) => ({
      id,
      label: upstreams[id]?.label ?? id,
      ready: id === 'siwc' ? s.signedIn : configured[id] === true,
    }));
  };

  const take = (p: PersonContext) => {
    const r = limiter.take(p.id);
    if (!r.ok) throw new AiError('rate_limited', undefined, { 'Retry-After': String(r.retryAfterSec) });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<void> => {
    const resolved = await resolvePerson(req);
    if (isFailure(resolved)) throw new AiError(resolved.error);
    const p = resolved;
    if (p.kind !== 'device') throw new AiError('wrong_kind');
    const a = partsFor(p);
    const rest = path.slice('/v1/ai/'.length);

    if (rest === 'status') {
      method(req, 'GET');
      return void sendJson(res, 200, { presets: await status(a) });
    }
    if (rest === 'usage') {
      method(req, 'GET');
      return void sendJson(res, 200, await a.usage.summary());
    }
    const keyRoute = /^keys\/([a-z0-9-]+)$/.exec(rest);
    if (keyRoute) {
      const preset = keyRoute[1]!;
      if (!KEY_PRESETS.includes(preset) || !upstreams[preset]) throw new AiError('not_found');
      take(p);
      if (req.method === 'PUT') {
        const body = await readJson(req, 16 * 1024).catch((e: unknown) => {
          throw e instanceof HttpError && e.code === 'body_too_large' ? new AiError('too_large') : new AiError('bad_request');
        });
        const key = typeof body.key === 'string' ? body.key.trim() : '';
        if (!key || key.length > 4096 || /\s/.test(key)) throw new AiError('bad_request');
        log.addSecret(key);
        await a.keys.set(preset, key);
        log(`ai: key for ${preset} saved (person ${p.id})`);
        res.writeHead(204).end();
        return;
      }
      if (req.method === 'DELETE') {
        await a.keys.remove(preset);
        log(`ai: key for ${preset} removed (person ${p.id})`);
        res.writeHead(204).end();
        return;
      }
      throw new AiError('not_found');
    }
    if (rest === 'siwc/status') {
      method(req, 'GET');
      const s = await a.siwc.status();
      return void sendJson(res, 200, { signedIn: s.signedIn, ...(s.expiresAt ? { expiresAt: s.expiresAt } : {}) });
    }
    if (rest === 'siwc/logout') {
      method(req, 'POST');
      await readBody(req, 4096).catch(() => undefined);
      await a.siwc.logout();
      log(`ai: ChatGPT signed out (person ${p.id})`);
      res.writeHead(204).end();
      return;
    }
    if (rest === 'siwc/login') {
      // The browser has no sign-in route on the server (§14.3): it is an admin step.
      throw new AiError('not_signed_in');
    }

    const m = /^([a-z0-9-]+)\/(.+)$/.exec(rest);
    if (!m || !(SERVER_PRESETS as readonly string[]).includes(m[1]!)) throw new AiError('not_found');
    const preset = m[1]!;
    const sub = m[2]!;
    if (sub === 'probe') {
      method(req, 'GET');
      take(p);
      return probe(res, a, preset);
    }
    if (!a.proxy.has(preset, sub)) throw new AiError('not_found');
    take(p);
    if (req.method === 'POST' && (await a.usage.capReached())) throw new AiError('daily_cap');
    try {
      await a.proxy.handle(req, res, preset, sub, query);
    } catch (e) {
      if (e instanceof HttpError) throw fromProxyError(e);
      throw e;
    }
  };

  /** Readiness check: credential present (a ChatGPT session is refreshed if needed), then the model list answers. */
  const probe = async (res: ServerResponse, a: PersonAi, preset: string) => {
    try {
      const r = await a.proxy.probe(preset);
      if (r.ok) return void sendJson(res, 200, { ready: true, models: r.models });
      const mapped = mapUpstreamError(preset, r.status, r.text ?? '') as { body: { error: { code: AiErrorCode } } };
      return void sendJson(res, 200, { ready: false, error: mapped.body.error });
    } catch (e) {
      if (e instanceof HttpError) {
        const err = fromProxyError(e);
        return void sendJson(res, 200, { ready: false, error: { code: err.code, message: err.message } });
      }
      throw e;
    }
  };

  return {
    /** True for paths this module answers. */
    owns: (path: string) => path.startsWith('/v1/ai/'),
    async handle(req: IncomingMessage, res: ServerResponse, path: string, query = ''): Promise<void> {
      try {
        await handle(req, res, path, query);
      } catch (e) {
        if (e instanceof AiError) return sendAiError(res, e);
        if (e instanceof HttpError) return sendAiError(res, fromProxyError(e));
        log(`ai: request failed (${e instanceof Error ? e.name : 'error'})`);
        if (!res.headersSent) sendJson(res, 500, aiErrorBody('upstream_error', { status: 500 }));
        else res.destroy();
      }
    },
    /** For the server's status page and tests. */
    personCount: () => persons.size,
    close() {
      for (const a of persons.values()) a.siwc.close();
      persons.clear();
    },
  };
}
