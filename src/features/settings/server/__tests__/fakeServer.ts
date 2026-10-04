/** A fake Vitals server for tests: the §14.2–§14.4 routes, in memory, behind an injected fetch. */
import { createServerClient, SERVER_KEY, type ServerClient } from '@/net/server';

export const BASE = 'https://vitals.example.ts.net:8443';
export const TOKEN = 'tok-device-1-secret';
/** The person's sync key the fake home server hands over once (base64url of 32 bytes of 0x2a). */
export const SYNC_KEY = 'KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio';

export interface FakeServerState {
  code: string;
  attempts: number;
  version: string;
  /** `home` hands the sync key over; anything else has no `/v1/sync/key` (404). */
  role: string;
  syncKey: string | null;
  keyIssued: boolean;
  devices: Array<{ id: string; kind: string; label: string; scope: string; createdAt: string; lastSeenAt: string; current: boolean }>;
  presets: Array<{ id: string; label: string; ready: boolean }>;
  siwc: { signedIn: boolean; plan?: string };
  keys: Record<string, string>;
  tokens: Array<{ id: string; client: string; label: string; scope: string; createdAt: string; lastUsedAt: string | null }>;
  /** Next answer for every authed route (e.g. 401 revoked). */
  fail?: { status: number; code: string } | 'network';
  calls: Array<{ method: string; path: string; auth: string | null; body: unknown }>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => json({ error: { code, message: code, ...extra } }, status);

export function fakeServer(overrides: Partial<FakeServerState> = {}) {
  const s: FakeServerState = {
    code: '12345678',
    attempts: 5,
    version: '0.4.0',
    role: 'home',
    syncKey: SYNC_KEY,
    keyIssued: false,
    devices: [
      { id: 'dev-1', kind: 'device', label: 'Chrome on Linux', scope: 'full', createdAt: '2026-10-03T08:00:00.000Z', lastSeenAt: '2026-10-03T09:00:00.000Z', current: true },
      { id: 'dev-2', kind: 'device', label: 'Laptop · Firefox', scope: 'full', createdAt: '2026-10-03T07:00:00.000Z', lastSeenAt: '2026-10-03T07:30:00.000Z', current: false },
    ],
    presets: [
      { id: 'siwc', label: 'Sign in with ChatGPT', ready: false },
      { id: 'nim', label: 'NVIDIA NIM', ready: false },
      { id: 'opencode-zen', label: 'OpenCode Zen', ready: true },
    ],
    siwc: { signedIn: false },
    keys: {},
    tokens: [],
    calls: [],
    ...overrides,
  };
  const fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? 'GET';
    const auth = new Headers(init?.headers).get('authorization');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const path = url.pathname;
    s.calls.push({ method, path, auth, body });
    if (`${url.protocol}//${url.host}` !== BASE) throw new TypeError('Failed to fetch');
    if (method === 'POST' && path === '/v1/pair/device') {
      if (s.attempts <= 0) return err(423, 'locked');
      if (body?.code === '00000000') return err(410, 'expired');
      if (body?.code !== s.code) {
        s.attempts -= 1;
        return err(401, 'invalid_code', { attemptsLeft: s.attempts });
      }
      return json({ token: TOKEN, deviceId: 'dev-1', person: { id: 'p1', label: 'Sam' }, server: { version: s.version, role: s.role } });
    }
    if (s.fail === 'network') throw new TypeError('Failed to fetch');
    if (auth !== `Bearer ${TOKEN}`) return err(401, 'unauthorized');
    if (s.fail) return err(s.fail.status, s.fail.code);
    if (method === 'GET' && path === '/v1/pair/status')
      return json({ deviceId: 'dev-1', label: 'Chrome on Linux', kind: 'device', scope: 'full', person: { id: 'p1', label: 'Sam' }, createdAt: '2026-10-03T08:00:00.000Z', lastSeenAt: '2026-10-03T09:00:00.000Z', server: { version: s.version, role: 'home', mqtt: null } });
    if (method === 'GET' && path === '/v1/devices') return json({ devices: s.devices });
    if (method === 'POST' && path === '/v1/sync/key') {
      if (s.role !== 'home' || !s.syncKey) return err(404, 'not_found');
      if (s.keyIssued) return json({ error: 'already_issued', message: 'already_issued' }, 409);
      s.keyIssued = true;
      return json({ key: s.syncKey, format: 'owner-secret-v1' });
    }
    if (method === 'DELETE' && path.startsWith('/v1/devices/')) {
      s.devices = s.devices.filter((d) => d.id !== decodeURIComponent(path.slice('/v1/devices/'.length)));
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && path === '/v1/pair/code') return json({ code: '87654321', expiresAt: new Date(Date.now() + 600_000).toISOString(), qr: `vitals-server:1?u=${encodeURIComponent(BASE)}&c=87654321` });
    if (method === 'GET' && path === '/v1/ai/status') return json({ presets: s.presets });
    if (method === 'GET' && path === '/v1/ai/siwc/status') return json(s.siwc);
    if (method === 'POST' && path === '/v1/ai/siwc/logout') {
      s.siwc = { signedIn: false };
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/v1/ai/keys/')) {
      const id = path.slice('/v1/ai/keys/'.length);
      if (method === 'PUT') s.keys[id] = String(body?.key);
      else delete s.keys[id];
      s.presets = s.presets.map((p) => (p.id === id ? { ...p, ready: method === 'PUT' } : p));
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && /^\/v1\/ai\/[^/]+\/models$/.test(path)) return json({ data: [{ id: 'gpt-5.6-sol' }, { id: 'zz-new-model' }] });
    if (method === 'GET' && path === '/v1/agents/tokens') return json({ tokens: s.tokens });
    if (method === 'POST' && path === '/v1/agents/tokens') {
      const t = { id: `at-${s.tokens.length + 1}`, client: String(body?.client), label: String(body?.label ?? ''), scope: String(body?.scope), createdAt: '2026-10-03T09:00:00.000Z', lastUsedAt: null };
      s.tokens.push(t);
      return json({ token: 'agent-secret-xyz', id: t.id, mcpUrl: `${BASE}/mcp`, recipes: [] });
    }
    if (method === 'DELETE' && path.startsWith('/v1/agents/tokens/')) {
      s.tokens = s.tokens.filter((t) => t.id !== path.slice('/v1/agents/tokens/'.length));
      return new Response(null, { status: 204 });
    }
    return err(404, 'not_found');
  }) as typeof fetch;
  return { state: s, fetch };
}

export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** A client on the fake server, optionally already paired. */
export function fakeClient(opts: { paired?: boolean; server?: ReturnType<typeof fakeServer>; storage?: Storage } = {}): { client: ServerClient; server: ReturnType<typeof fakeServer>; storage: Storage } {
  const server = opts.server ?? fakeServer();
  const storage = opts.storage ?? memoryStorage();
  if (opts.paired) storage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: TOKEN, deviceId: 'dev-1', person: { id: 'p1', label: 'Sam' }, pairedAt: '2026-10-03T08:00:00.000Z' }));
  const client = createServerClient({ storage, fetchImpl: server.fetch, localNetworkDenied: async () => false });
  return { client, server, storage };
}
