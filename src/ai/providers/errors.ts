/**
 * Typed provider errors (R8 §1.7). Rate-limit headers are not exposed cross-origin on OpenAI-style providers, so the
 * classification works from status codes and bodies; `retry-after` is used only when readable (Anthropic, xAI).
 */
import type { ProviderErrorInfo, ProviderErrorKind } from './types';

export class ProviderError extends Error implements ProviderErrorInfo {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly code?: string;
  constructor(info: ProviderErrorInfo) {
    super(redactSecrets(info.message));
    this.name = 'ProviderError';
    this.kind = info.kind;
    this.status = info.status;
    this.retryable = info.retryable;
    this.retryAfterMs = info.retryAfterMs;
    this.code = info.code;
  }
  toInfo(): ProviderErrorInfo {
    const info: ProviderErrorInfo = { kind: this.kind, message: this.message, retryable: this.retryable };
    if (this.status !== undefined) info.status = this.status;
    if (this.retryAfterMs !== undefined) info.retryAfterMs = this.retryAfterMs;
    if (this.code !== undefined) info.code = this.code;
    return info;
  }
}

/** Statuses retried with backoff (R8 §1.7). 529 is Anthropic "overloaded". */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Removes anything that looks like an API key or bearer token from text that may reach a log or the UI. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|rk|pk|gsk|xai|nvapi|csk|fw|or)-[A-Za-z0-9_-]{8,}/g, '$1-…')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-…')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza…')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1…');
}

/** Parses a `retry-after` header (seconds or HTTP date) into milliseconds. `nowMs` is injected (tier H, no clock). */
export function parseRetryAfter(value: string | null | undefined, nowMs?: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  if (Number.isFinite(at) && nowMs !== undefined) return Math.max(0, at - nowMs);
  return undefined;
}

interface ErrorBody {
  message?: string;
  code?: string;
  type?: string;
  param?: string;
}

/** Pulls `{message, code, type}` out of the usual error envelopes (OpenAI, Anthropic, OpenRouter, Mistral, Ollama). */
export function readErrorBody(body: unknown): ErrorBody {
  if (typeof body === 'string') {
    try {
      return readErrorBody(JSON.parse(body));
    } catch {
      return { message: body.slice(0, 300) };
    }
  }
  if (!body || typeof body !== 'object') return {};
  const o = body as Record<string, unknown>;
  const err = (o.error && typeof o.error === 'object' ? o.error : o) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
  return {
    message: str(err.message) ?? str(o.message) ?? (typeof o.error === 'string' ? o.error : undefined) ?? str(o.detail),
    code: str(err.code) ?? str(o.code),
    type: str(err.type) ?? str(o.type),
    param: str(err.param),
  };
}

/** Maps an HTTP failure to a typed error. `body` is the parsed JSON or the raw text. */
export function classifyHttpError(status: number, body: unknown, retryAfter?: string | null, nowMs?: number): ProviderError {
  const b = readErrorBody(body);
  const text = `${b.code ?? ''} ${b.type ?? ''} ${b.message ?? ''}`.toLowerCase();
  const message = b.message ?? `HTTP ${status}`;
  const retryAfterMs = parseRetryAfter(retryAfter, nowMs);
  const base = { status, message, code: b.code ?? b.type, retryAfterMs };
  const make = (kind: ProviderErrorKind, retryable: boolean) => new ProviderError({ ...base, kind, retryable });

  if (status === 401 || status === 403) return make(/quota|billing|credit/.test(text) ? 'quota' : 'auth', false);
  if (status === 402) return make('quota', false);
  if (status === 404) return make(/model/.test(text) || b.param === 'model' ? 'model_not_found' : 'bad_request', false);
  if (status === 413 || /context.length|context_length|maximum context|too many tokens|prompt is too long/.test(text)) {
    return make('context_length', false);
  }
  if (status === 429) {
    // OpenAI and others send 429 for an exhausted balance; retrying does not help.
    if (/insufficient_quota|billing|credit|exceeded your current quota|usage_limit/.test(text)) return make('quota', false);
    return make('rate_limit', true);
  }
  if (status === 529 || /overloaded/.test(text)) return make('overloaded', true);
  if (status >= 500) return make('server', RETRYABLE_STATUSES.has(status));
  if (status === 408 || status === 409) return make('server', true);
  if (/content.policy|content_filter|safety|moderation/.test(text)) return make('content_policy', false);
  if (status === 400 || status === 422) {
    if (/model.*(not found|does not exist|not supported)|unknown model|invalid model/.test(text)) return make('model_not_found', false);
    if (/unsupported|not supported|unrecognized|unknown (field|param|parameter|argument)|extra inputs|not permitted|unexpected/.test(text)) {
      return make('unsupported_param', false);
    }
    return make('bad_request', false);
  }
  return make('bad_request', false);
}

/** Classifies a thrown fetch failure. A `TypeError` against a base URL never reached before is most likely CORS. */
export function classifyFetchFailure(err: unknown, firstContact: boolean, signal?: AbortSignal): ProviderError {
  if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
    return new ProviderError({ kind: 'aborted', message: 'Stopped', retryable: false });
  }
  if (err instanceof Error && err.name === 'NetBlockedError') {
    return new ProviderError({ kind: 'blocked', message: err.message, retryable: false });
  }
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (firstContact && err instanceof TypeError) {
    return new ProviderError({ kind: 'cors', message: `The browser could not reach the provider (${message}).`, retryable: false });
  }
  return new ProviderError({ kind: 'network', message, retryable: true });
}

/** Error carried inside a 200 stream (`{"error":{…}}` chunk or Anthropic `error` event). */
export function streamError(body: unknown): ProviderError {
  const b = readErrorBody(body);
  const text = `${b.code ?? ''} ${b.type ?? ''} ${b.message ?? ''}`.toLowerCase();
  let kind: ProviderErrorKind = 'stream';
  let retryable = false;
  if (/overloaded/.test(text)) [kind, retryable] = ['overloaded', true];
  else if (/rate.limit/.test(text)) [kind, retryable] = ['rate_limit', true];
  else if (/usage_limit|quota|subscription_sharing/.test(text)) kind = 'quota';
  else if (/context/.test(text)) kind = 'context_length';
  else if (/content.policy|content_filter|safety/.test(text)) kind = 'content_policy';
  return new ProviderError({ kind, message: b.message ?? 'The provider stopped the reply with an error', retryable, code: b.code ?? b.type });
}
