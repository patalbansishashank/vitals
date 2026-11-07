/**
 * Client for the Coach that runs on the person's home server (vitals-research/server-coach/CONTRACT.md): status,
 * temporary sessions, one streamed turn per message (`text/event-stream`), keep and delete. Every request goes through
 * the paired server's own fetch (`ServerClient.chatModelOptions()`): the device token as `Authorization: Bearer …`, only
 * to the paired origin, and a `401` ends the pairing there.
 *
 * Nothing here is stored: the server deletes a session `retentionHours` after its last message, and the app keeps at
 * most the open session in memory (and its id for this tab, so a reload can reattach until it expires).
 */
import { parseSse } from '@/ai/providers/sse';
import { ServerError, type ServerClient } from './server';

export interface CoachServerStatus {
  available: boolean;
  backend: string;
  model?: string;
  retentionHours: number;
  reason?: string;
}

export interface CoachContext {
  screen?: string;
  /** YYYY-MM-DD. */
  date?: string;
}

export interface CoachSessionCreated {
  sessionId: string;
  expiresAt: string;
  greeting?: string;
}

export interface CoachSessionInfo {
  sessionId: string;
  app: string;
  title?: string;
  createdAt: string;
  expiresAt: string;
}

export interface CoachSessionMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface CoachSessionDetail extends CoachSessionInfo {
  messages: CoachSessionMessage[];
}

export interface CoachAttachment {
  kind: 'image';
  mime: string;
  /** base64. */
  data: string;
}

export type CoachServerEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' }
  | { type: 'proposal'; id: string; summary: string }
  | { type: 'done'; messageId?: string }
  | { type: 'error'; code: string; message: string };

/**
 * `unauthorized` (401: the pairing ended, connect again) · `expired` (404 on a session: start a new one) · `busy`
 * (429 / 503, `retryAfterS` from `Retry-After`) · `not_paired` · `unreachable` · `server_error`.
 */
export type CoachErrorCode = 'unauthorized' | 'expired' | 'busy' | 'not_paired' | 'unreachable' | 'not_supported' | 'server_error';

export class CoachError extends Error {
  readonly code: CoachErrorCode;
  readonly status?: number;
  readonly retryAfterS?: number;
  constructor(code: CoachErrorCode, opts: { status?: number; retryAfterS?: number; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = 'CoachError';
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterS !== undefined) this.retryAfterS = opts.retryAfterS;
  }
}

export interface ServerCoachClient {
  status(signal?: AbortSignal): Promise<CoachServerStatus>;
  createSession(args: { title?: string; context?: CoachContext }, signal?: AbortSignal): Promise<CoachSessionCreated>;
  /** One turn: the server's events as they arrive. Throws `CoachError` before the stream starts. */
  send(sessionId: string, body: { text: string; attachments?: CoachAttachment[] }, signal?: AbortSignal): AsyncGenerator<CoachServerEvent>;
  session(sessionId: string, signal?: AbortSignal): Promise<CoachSessionDetail>;
  sessions(signal?: AbortSignal): Promise<CoachSessionInfo[]>;
  remove(sessionId: string): Promise<void>;
  /** Extends `expiresAt` by `retentionHours`; resolves with the new `expiresAt` when the server says it. */
  keep(sessionId: string): Promise<{ expiresAt?: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `Retry-After` in seconds (a number or an HTTP date); undefined when absent or unreadable. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined;
}

/** A JSON request's answer may not take longer than this; a stream's first byte neither. */
export const COACH_REQUEST_TIMEOUT_MS = 30_000;

export function parseCoachEvent(data: string): CoachServerEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'delta':
      return typeof v.text === 'string' ? { type: 'delta', text: v.text } : null;
    case 'tool':
      return str(v.name) ? { type: 'tool', name: str(v.name), status: v.status === 'done' ? 'done' : 'start' } : null;
    case 'proposal':
      return str(v.id) ? { type: 'proposal', id: str(v.id), summary: str(v.summary) } : null;
    case 'done':
      return { type: 'done', ...(str(v.messageId) ? { messageId: str(v.messageId) } : {}) };
    case 'error':
      return { type: 'error', code: str(v.code) || 'error', message: str(v.message) };
    default:
      return null;
  }
}

function sessionInfo(v: Record<string, unknown>): CoachSessionInfo {
  return {
    sessionId: str(v.sessionId) || str(v.id),
    app: str(v.app),
    ...(str(v.title) ? { title: str(v.title) } : {}),
    createdAt: str(v.createdAt),
    expiresAt: str(v.expiresAt),
  };
}

type Server = Pick<ServerClient, 'chatModelOptions'>;

export function createServerCoachClient(opts: { server: Server; app?: 'vitals' | 'gauge'; now?: () => number }): ServerCoachClient {
  const app = opts.app ?? 'vitals';
  const now = opts.now ?? (() => Date.now());

  function wire(): { base: string; fetch: typeof fetch } {
    try {
      const o = opts.server.chatModelOptions();
      return { base: o.serverUrl.replace(/\/+$/, ''), fetch: o.deps.fetch };
    } catch (e) {
      if (e instanceof ServerError && e.code === 'not_paired') throw new CoachError('not_paired');
      throw e;
    }
  }

  /** The answer of a request, or a `CoachError`; `session` marks the routes where 404 means "it expired". */
  async function call(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; accept?: string; session?: boolean } = {}): Promise<Response> {
    const { base, fetch } = wire();
    const ctl = new AbortController();
    const outer = init.signal;
    const onAbort = () => ctl.abort();
    if (outer?.aborted) ctl.abort();
    else outer?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, COACH_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { accept: init.accept ?? 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: ctl.signal,
        cache: 'no-store',
      });
    } catch (e) {
      if (timedOut) throw new CoachError('unreachable');
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      if (e instanceof ServerError && e.code === 'not_paired') throw new CoachError('not_paired');
      throw new CoachError('unreachable', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
    if (res.ok) return res;
    let message: string | undefined;
    try {
      const b = (await res.json()) as unknown;
      const err = isObj(b) && isObj(b.error) ? b.error : isObj(b) ? b : {};
      message = str(err.message) || undefined;
    } catch {
      // no JSON body
    }
    const m = message ? { message } : {};
    if (res.status === 401) throw new CoachError('unauthorized', { status: 401, ...m });
    if (res.status === 404) throw new CoachError(init.session ? 'expired' : 'not_supported', { status: 404, ...m });
    if (res.status === 429 || res.status === 503) {
      const retryAfterS = retryAfterSeconds(res.headers.get('retry-after'), now());
      throw new CoachError('busy', { status: res.status, ...(retryAfterS !== undefined ? { retryAfterS } : {}), ...m });
    }
    throw new CoachError('server_error', { status: res.status, ...m });
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new CoachError('server_error', { status: res.status });
    }
  }

  const sid = (id: string) => `/v1/coach/sessions/${encodeURIComponent(id)}`;

  return {
    async status(signal) {
      const r = await json(await call('/v1/coach/status', signal ? { signal } : {}));
      if (!isObj(r)) throw new CoachError('server_error');
      const hours = typeof r.retentionHours === 'number' && r.retentionHours > 0 ? r.retentionHours : 24;
      return {
        available: r.available === true,
        backend: str(r.backend),
        ...(str(r.model) ? { model: str(r.model) } : {}),
        retentionHours: hours,
        ...(str(r.reason) ? { reason: str(r.reason) } : {}),
      };
    },

    async createSession({ title, context }, signal) {
      const body = { app, ...(title ? { title } : {}), ...(context && (context.screen || context.date) ? { context } : {}) };
      const r = await json(await call('/v1/coach/sessions', { method: 'POST', body, ...(signal ? { signal } : {}) }));
      if (!isObj(r) || !str(r.sessionId)) throw new CoachError('server_error');
      return { sessionId: str(r.sessionId), expiresAt: str(r.expiresAt), ...(str(r.greeting) ? { greeting: str(r.greeting) } : {}) };
    },

    async *send(sessionId, body, signal) {
      const res = await call(`${sid(sessionId)}/messages`, { method: 'POST', body, accept: 'text/event-stream', session: true, ...(signal ? { signal } : {}) });
      if (!res.body) throw new CoachError('server_error', { status: res.status });
      for await (const msg of parseSse(res.body, signal)) {
        const ev = parseCoachEvent(msg.data);
        if (ev) yield ev;
      }
    },

    async session(sessionId, signal) {
      const r = await json(await call(sid(sessionId), { session: true, ...(signal ? { signal } : {}) }));
      if (!isObj(r)) throw new CoachError('server_error');
      const messages = Array.isArray(r.messages)
        ? r.messages.flatMap((m): CoachSessionMessage[] => (isObj(m) && (m.role === 'user' || m.role === 'assistant') ? [{ role: m.role, text: str(m.text), at: str(m.at) }] : []))
        : [];
      return { ...sessionInfo(r), sessionId: str(r.sessionId) || sessionId, messages };
    },

    async sessions(signal) {
      const r = await json(await call('/v1/coach/sessions', signal ? { signal } : {}));
      const rows = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.sessions) ? r.sessions : [];
      return rows.flatMap((x): CoachSessionInfo[] => (isObj(x) ? [sessionInfo(x)] : [])).filter((s) => s.sessionId);
    },

    async remove(sessionId) {
      try {
        await call(sid(sessionId), { method: 'DELETE', session: true });
      } catch (e) {
        // already gone is what was asked for
        if (e instanceof CoachError && e.code === 'expired') return;
        throw e;
      }
    },

    async keep(sessionId) {
      const res = await call(`${sid(sessionId)}/keep`, { method: 'POST', body: {}, session: true });
      if (res.status === 204) return {};
      try {
        const r = (await res.json()) as unknown;
        return isObj(r) && str(r.expiresAt) ? { expiresAt: str(r.expiresAt) } : {};
      } catch {
        return {};
      }
    },
  };
}
