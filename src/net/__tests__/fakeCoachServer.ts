/**
 * A fake home server with the Coach routes of the server-coach contract (`/v1/coach/*`), in memory, behind an injected
 * fetch; every other route goes to the pairing fake (`fakeServer`). Turns answer as `text/event-stream`, split into small
 * byte chunks so the SSE parser sees what a real network delivers.
 */
import { chunkedStream } from '@/ai/testing/fakeFetch';
import { BASE, fakeServer, memoryStorage, TOKEN } from '@/features/settings/server/__tests__/fakeServer';
import { createServerClient, SERVER_KEY, type ServerClient } from '../server';
import type { CoachServerEvent, CoachServerStatus } from '../coach';

export interface FakeCoachSession {
  app: string;
  title?: string;
  context?: unknown;
  createdAt: string;
  expiresAt: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
}

export interface FakeCoachState {
  /** null: an older server without the Coach (404). */
  status: CoachServerStatus | null;
  sessions: Map<string, FakeCoachSession>;
  greeting?: string;
  /** The events one turn answers with (default: one delta echoing the text, then done). */
  script: (text: string, sessionId: string) => Array<CoachServerEvent | string>;
  /** The next coach request answers this instead (once). */
  fail?: { status: number; code?: string; retryAfter?: string };
  calls: Array<{ method: string; path: string; auth: string | null; body: unknown }>;
  created: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const NOW = '2026-10-23T10:00:00.000Z';

export { memoryStorage };

export function sseOf(events: Array<CoachServerEvent | string>): string {
  return events.map((e) => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`)).join('');
}

export function fakeCoachServer(overrides: Partial<FakeCoachState> = {}) {
  const base = fakeServer();
  const s: FakeCoachState = {
    status: { available: true, backend: 'codex', model: 'gpt-5.5', retentionHours: 24 },
    sessions: new Map(),
    script: (text) => [{ type: 'delta', text: `You said: ${text}` }, { type: 'done', messageId: 'm1' }],
    calls: [],
    created: 0,
    ...overrides,
  };
  const fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = url.pathname;
    if (!path.startsWith('/v1/coach/')) return base.fetch(input, init);
    const method = init?.method ?? 'GET';
    const auth = new Headers(init?.headers).get('authorization');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    s.calls.push({ method, path, auth, body });
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (`${url.protocol}//${url.host}` !== BASE) throw new TypeError('Failed to fetch');
    if (auth !== `Bearer ${TOKEN}`) return json({ error: { code: 'unauthorized', message: 'unauthorized' } }, 401);
    if (s.fail) {
      const f = s.fail;
      delete s.fail;
      return json({ error: { code: f.code ?? 'error', message: f.code ?? 'error' } }, f.status, f.retryAfter ? { 'retry-after': f.retryAfter } : {});
    }
    if (method === 'GET' && path === '/v1/coach/status') return s.status ? json(s.status) : json({ error: 'not_found' }, 404);
    if (path === '/v1/coach/sessions') {
      if (method === 'GET') return json({ sessions: [...s.sessions].map(([sessionId, x]) => ({ sessionId, app: x.app, ...(x.title ? { title: x.title } : {}), createdAt: x.createdAt, expiresAt: x.expiresAt })) });
      if (method === 'POST') {
        const sessionId = `sess-${++s.created}`;
        const sess: FakeCoachSession = { app: String(body?.app ?? ''), createdAt: NOW, expiresAt: '2026-10-24T10:00:00.000Z', messages: [], ...(body?.context ? { context: body.context } : {}) };
        s.sessions.set(sessionId, sess);
        return json({ sessionId, expiresAt: sess.expiresAt, ...(s.greeting ? { greeting: s.greeting } : {}) }, 201);
      }
    }
    const m = /^\/v1\/coach\/sessions\/([^/]+)(\/messages|\/keep)?$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const sess = s.sessions.get(id);
      if (!sess) return json({ error: { code: 'not_found', message: 'not_found' } }, 404);
      if (m[2] === '/messages' && method === 'POST') {
        const text = String(body?.text ?? '');
        sess.messages.push({ role: 'user', text, at: NOW });
        const events = s.script(text, id);
        const reply = events.flatMap((e) => (typeof e !== 'string' && e.type === 'delta' ? [e.text] : [])).join('');
        sess.messages.push({ role: 'assistant', text: reply, at: NOW });
        return new Response(chunkedStream(sseOf(events), 5), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (m[2] === '/keep' && method === 'POST') {
        sess.expiresAt = '2026-10-25T10:00:00.000Z';
        return json({ sessionId: id, expiresAt: sess.expiresAt });
      }
      if (!m[2] && method === 'GET') return json({ sessionId: id, app: sess.app, createdAt: sess.createdAt, expiresAt: sess.expiresAt, messages: sess.messages });
      if (!m[2] && method === 'DELETE') {
        s.sessions.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    return json({ error: 'not_found' }, 404);
  }) as typeof globalThis.fetch;
  return { state: s, fetch, base };
}

/** A paired client on the fake server (or an unpaired one). */
export function coachClientOn(server: ReturnType<typeof fakeCoachServer>, opts: { paired?: boolean; storage?: Storage } = {}): { client: ServerClient; storage: Storage } {
  const storage = opts.storage ?? memoryStorage();
  if (opts.paired ?? true) storage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: TOKEN, deviceId: 'dev-1', person: { id: 'p1', label: 'Sam' }, pairedAt: '2026-10-03T08:00:00.000Z' }));
  const client = createServerClient({ storage, fetchImpl: server.fetch, localNetworkDenied: async () => false });
  return { client, storage };
}
