/**
 * Cross-cutting HTTP hardening for the Companion (SUITE_SPEC §7.2): Origin allow-list and CORS, Host checks against DNS
 * rebinding, per-token rate limits, body-size limits and one redacting logger.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const PUBLIC_APP_ORIGIN = 'https://vitals.creative.desi';
/** The packaged apps' own origins (SUITE_SPEC §15.5): Electron's `app://vitals`, the Capacitor WebView on Android and iOS. Always allowed. */
export const APP_SHELL_ORIGINS = ['app://vitals', 'https://localhost', 'capacitor://localhost'] as const;

export class HttpError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;
  constructor(status: number, code: string, message?: string, headers: Record<string, string> = {}) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * A person-worker failure that a route let escape (`code` is the worker's error code). A full server is a 503 with
 * `Retry-After: 60` and the plain-words message the worker gave; anything else is not handled here (null).
 */
export function busyError(e: unknown): HttpError | null {
  if (!(e instanceof Error) || (e as { code?: unknown }).code !== 'server_busy') return null;
  return new HttpError(503, 'server_busy', e.message || 'The server is busy with other people right now. Try again in a minute.', { 'Retry-After': '60' });
}

export const sha256 = (text: string): Buffer => createHash('sha256').update(text).digest();

/** Constant-time comparison of two strings through their SHA-256 (equal length by construction). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

// ---------------------------------------------------------------------------------------------------------------
// Origin and Host

export const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();

const LOOPBACK_NAME = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const TS_NET = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/** Splits `host[:port]` / `[v6]:port`; returns the lowercased host name without the port. */
export function hostName(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

/** Hosts whose "same origin" we trust; a DNS-rebinding page has its own name and so never matches. */
export const trustedSelfHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/i.test(host);

export interface OriginPolicy {
  /** `Origin` absent (CLI, MCP client, Evolu node), allowed, or forbidden. */
  check(req: IncomingMessage): 'none' | 'allowed' | 'forbidden';
  /** DNS-rebinding guard: Host must be loopback, the bind address or a `*.ts.net` name. */
  hostAllowed(req: IncomingMessage): boolean;
}

export function createOriginPolicy(opts: { allowedOrigins: readonly string[]; bindHost: string }): OriginPolicy {
  const allowed = new Set([PUBLIC_APP_ORIGIN, ...APP_SHELL_ORIGINS, ...opts.allowedOrigins].map(normalizeOrigin));
  const bind = hostName(opts.bindHost.includes(':') && !opts.bindHost.startsWith('[') ? `[${opts.bindHost}]` : opts.bindHost);
  const wildcardBind = bind === '0.0.0.0' || bind === '[::]';

  const hostAllowedName = (name: string) => {
    if (!name) return false;
    if (LOOPBACK_NAME.test(name) || TS_NET.test(name) || name === bind) return true;
    return wildcardBind && isIP(name.replace(/^\[|\]$/g, '')) !== 0;
  };

  return {
    check(req) {
      const origin = req.headers.origin;
      if (origin === undefined) return 'none';
      const o = normalizeOrigin(origin);
      if (allowed.has(o) || LOOPBACK_ORIGIN.test(o)) return 'allowed';
      const forwarded = req.headers['x-forwarded-host'];
      const hosts = [req.headers.host, ...(typeof forwarded === 'string' ? forwarded.split(',') : [])]
        .filter((h): h is string => Boolean(h))
        .map((h) => h.trim().toLowerCase());
      // Same origin as the served app: only for Host names that pass the rebinding check (so a rebinding page never matches).
      return hosts.some((h) => (trustedSelfHost(h) || hostAllowedName(hostName(h))) && (o === `https://${h}` || o === `http://${h}`)) ? 'allowed' : 'forbidden';
    },
    hostAllowed(req) {
      const host = req.headers.host;
      return typeof host === 'string' && hostAllowedName(hostName(host));
    },
  };
}

export const API_ALLOW_HEADERS = 'Authorization, Content-Type';
export const MCP_ALLOW_HEADERS = 'Authorization, Content-Type, mcp-session-id, mcp-protocol-version, last-event-id';

/** CORS response headers for an allowed origin (never for others). */
export function applyCors(req: IncomingMessage, res: ServerResponse, expose = 'Retry-After'): void {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Expose-Headers', expose);
}

export function answerPreflight(res: ServerResponse, methods: string, headers: string): void {
  res.writeHead(204, {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Max-Age': '600',
    // Chrome Local Network Access / Private Network Access preflights.
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end();
}

// ---------------------------------------------------------------------------------------------------------------
// Rate limit

export interface RateLimitOptions {
  /** Burst size. */
  capacity: number;
  /** Sustained requests per minute. */
  perMinute: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { capacity: 20, perMinute: 60 };

export function createRateLimiter(opts: RateLimitOptions = DEFAULT_RATE_LIMIT, now: () => number = Date.now) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const perMs = opts.perMinute / 60_000;
  return {
    /** Takes one token; returns the seconds to wait when empty. */
    take(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
      const t = now();
      const b = buckets.get(key) ?? { tokens: opts.capacity, at: t };
      b.tokens = Math.min(opts.capacity, b.tokens + (t - b.at) * perMs);
      b.at = t;
      buckets.set(key, b);
      if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value!);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000)) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bodies

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, 'body_too_large', `Request body over ${limit} bytes`);
  }
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, 'body_too_large', `Request body over ${limit} bytes`);
    }
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const body = await readBody(req, limit);
  if (body.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  return value as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, e: HttpError): void {
  sendJson(res, e.status, { error: e.code, message: e.message }, e.headers);
}

/** Bearer value of the Authorization header, or null. */
export function bearerOf(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{8,512})\s*$/i.exec(h);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Logging

export interface Logger {
  (line: string): void;
  /** Registers a value that must never appear in a log line (it is replaced with `[redacted]`). */
  addSecret(value: string | null | undefined): void;
  redact(line: string): string;
}

const SECRET_PARAMS = /([?&](?:code|state|nonce|token|access_token|refresh_token|id_token|client_secret|code_verifier|key|api_key|password)=)[^&#\s]*/gi;
const PATTERNS: RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^\s,;]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bnvapi-[A-Za-z0-9_-]{8,}/g,
  /\boaiapp_[A-Za-z0-9_-]{4,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*\.?[A-Za-z0-9_-]*/g,
  /"(access_token|refresh_token|id_token|token|code|apiKey|api_key|key|secret)"\s*:\s*"[^"]*"/gi,
];

/** Wraps a sink so nothing secret reaches it: registered values, bearer/cookie headers, token-shaped strings, callback queries. */
export function createRedactingLogger(sink: (line: string) => void = () => undefined): Logger {
  const secrets = new Set<string>();
  const redact = (line: string): string => {
    let out = line;
    for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join('[redacted]');
    out = out.replace(/(\/callback)\?[^\s"']*/gi, '$1?[redacted]');
    out = out.replace(SECRET_PARAMS, '$1[redacted]');
    for (const p of PATTERNS) out = out.replace(p, (_m, g1: string) => (typeof g1 === 'string' && g1 ? `${g1} [redacted]` : '[redacted]'));
    return out;
  };
  const log = ((line: string) => sink(redact(line))) as Logger;
  log.addSecret = (value) => {
    if (value && value.length >= 6) secrets.add(value);
  };
  log.redact = redact;
  return log;
}
