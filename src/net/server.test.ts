import { BASE, fakeClient, fakeServer, TOKEN } from '@/features/settings/server/__tests__/fakeServer';
import {
  compareVersions,
  normalizeServerCode,
  normalizeServerUrl,
  pairingLinkFor,
  parsePairingLink,
  SERVER_KEY,
  SERVER_MESSAGES,
  ServerError,
  createServerClient,
  REQUEST_TIMEOUT_MS,
  watchServer,
} from './server';

describe('server addresses and codes', () => {
  it('accepts only https:// addresses', () => {
    expect(normalizeServerUrl('vitals.example.ts.net:8443/')).toBe('https://vitals.example.ts.net:8443');
    expect(normalizeServerUrl(' https://Box.example.ts.net ')).toBe('https://box.example.ts.net');
    expect(() => normalizeServerUrl('http://100.64.0.1:4870')).toThrow(expect.objectContaining({ code: 'http_address', message: 'Use the https:// address of your server.' }));
    expect(() => normalizeServerUrl('http://localhost:4870')).toThrow(expect.objectContaining({ code: 'http_address' }));
    expect(() => normalizeServerUrl('not a url')).toThrow(expect.objectContaining({ code: 'invalid_address', message: "That doesn't look like a web address." }));
    expect(() => normalizeServerUrl('ftp://x.example')).toThrow(expect.objectContaining({ code: 'invalid_address' }));
  });

  it('reads 8-digit codes with spaces or a dash', () => {
    expect(normalizeServerCode('1234-5678')).toBe('12345678');
    expect(normalizeServerCode('1234 5678')).toBe('12345678');
    expect(normalizeServerCode('1234567')).toBeNull();
    expect(normalizeServerCode('K7QM4XRD')).toBeNull();
  });

  it('parses the QR string and the link that carries it in the fragment', () => {
    const qr = `vitals-server:1?u=${encodeURIComponent(BASE)}&c=12345678&n=Phone`;
    expect(parsePairingLink(qr)).toEqual({ baseUrl: BASE, code: '12345678', label: 'Phone' });
    const link = pairingLinkFor(qr);
    expect(link).toBe(`https://vitals.creative.desi/settings?section=server#${qr}`);
    expect(parsePairingLink(link)).toEqual({ baseUrl: BASE, code: '12345678', label: 'Phone' });
    expect(parsePairingLink(`vitals-server:1?u=${encodeURIComponent('http://100.64.0.1:4870')}&c=12345678`)).toBeNull();
    expect(parsePairingLink('vitals-sync:1?k=abc')).toBeNull();
  });

  it('compares versions', () => {
    expect(compareVersions('0.3.2', '0.4.0')).toBe(-1);
    expect(compareVersions('v0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.4.0')).toBe(1);
  });

  it('error messages name no internal words', () => {
    for (const m of Object.values(SERVER_MESSAGES)) expect(m).not.toMatch(/Companion|proxy|preset|token|MCP|§|dossier|R\d\d|\bE\d\d\b|SPEC|\bWP\d|kcal/);
  });
});

describe('server client', () => {
  it('pairs with a code, stores the token device-locally and sends it only as a bearer', async () => {
    const { client, server, storage } = fakeClient();
    const done = await client.pair({ baseUrl: BASE, code: '1234-5678', label: 'Phone' });
    expect(done).toMatchObject({ baseUrl: BASE, deviceId: 'dev-1', person: { id: 'p1', label: 'Sam' }, server: { version: '0.4.0', role: 'home' } });
    expect(server.state.calls[0]).toMatchObject({ method: 'POST', path: '/v1/pair/device', auth: null, body: { code: '12345678', label: 'Phone' } });
    expect(JSON.parse(storage.getItem(SERVER_KEY)!)).toMatchObject({ baseUrl: BASE, token: TOKEN, deviceId: 'dev-1', person: { id: 'p1', label: 'Sam' } });
    expect(client.pairing()).not.toHaveProperty('token');
    await client.status();
    const last = server.state.calls.at(-1)!;
    expect(last.auth).toBe(`Bearer ${TOKEN}`);
    for (const c of server.state.calls) expect(c.path).not.toContain(TOKEN);
  });

  it('maps pairing errors: wrong code with tries left, expired, locked, not a Vitals server, unreachable', async () => {
    const { client } = fakeClient();
    await expect(client.pair({ baseUrl: BASE, code: '11112222' })).rejects.toMatchObject({ code: 'invalid_code', attemptsLeft: 4 });
    await expect(client.pair({ baseUrl: BASE, code: '00000000' })).rejects.toMatchObject({ code: 'expired' });
    await expect(client.pair({ baseUrl: 'https://elsewhere.example', code: '12345678' })).rejects.toMatchObject({ code: 'server_unreachable', message: SERVER_MESSAGES.server_unreachable });
    await expect(client.pair({ baseUrl: 'http://vitals.example.ts.net', code: '12345678' })).rejects.toMatchObject({ code: 'http_address' });
    const locked = fakeClient({ server: fakeServer({ attempts: 0 }) });
    await expect(locked.client.pair({ baseUrl: BASE, code: '12345678' })).rejects.toMatchObject({ code: 'locked' });
    const html = fakeClient({ server: { state: fakeServer().state, fetch: (async () => new Response('<html>', { status: 404 })) as typeof fetch } });
    await expect(html.client.pair({ baseUrl: BASE, code: '12345678' })).rejects.toMatchObject({ code: 'not_vitals' });
  });

  it('reports a local-network denial in plain words when the browser blocked it', async () => {
    const { createServerClient } = await import('./server');
    const c = createServerClient({ storage: null, fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, localNetworkDenied: async () => true });
    await expect(c.pair({ baseUrl: BASE, code: '12345678' })).rejects.toMatchObject({ code: 'local_network_denied' });
  });

  it('clears the pairing on any 401 and remembers that the device was removed', async () => {
    const { client, server, storage } = fakeClient({ paired: true });
    let changes = 0;
    client.subscribe(() => changes++);
    server.state.fail = { status: 401, code: 'revoked' };
    await expect(client.devices()).rejects.toMatchObject({ code: 'revoked', message: SERVER_MESSAGES.revoked });
    expect(storage.getItem(SERVER_KEY)).toBeNull();
    expect(client.isPaired()).toBe(false);
    expect(client.ended()).toMatchObject({ baseUrl: BASE, reason: 'revoked' });
    expect(changes).toBe(1);
  });

  it('the AI fetch adds the device token only for the paired origin, strips provider keys and ends the pairing on 401', async () => {
    const { client, server } = fakeClient({ paired: true });
    const { serverUrl, deps } = client.chatModelOptions();
    expect(serverUrl).toBe(BASE);
    await deps.fetch(`${BASE}/v1/ai/nim/models`, { headers: { 'x-api-key': 'sk-should-go' } });
    expect(server.state.calls.at(-1)).toMatchObject({ path: '/v1/ai/nim/models', auth: `Bearer ${TOKEN}` });
    await expect(deps.fetch('https://api.openai.com/v1/models')).rejects.toMatchObject({ code: 'net_not_allowed' });
    server.state.fail = { status: 401, code: 'unauthorized' };
    const res = await deps.fetch(`${BASE}/v1/ai/nim/chat/completions`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(client.isPaired()).toBe(false);
    expect(() => client.chatModelOptions()).toThrow(ServerError);
  });

  it('keys go to the server and are never kept in the browser', async () => {
    const { client, server, storage } = fakeClient({ paired: true });
    await client.setKey('nim', 'nvapi-SECRET-1234');
    expect(server.state.keys.nim).toBe('nvapi-SECRET-1234');
    expect(server.state.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/v1/ai/keys/nim' });
    for (let i = 0; i < storage.length; i++) expect(storage.getItem(storage.key(i)!)).not.toContain('nvapi');
    await client.removeKey('nim');
    expect(server.state.keys.nim).toBeUndefined();
  });
});

describe('status watcher', () => {
  it('polls while reachable, backs off when unreachable, and turns to revoked on 401', async () => {
    const { client, server } = fakeClient({ paired: true });
    const timers: number[] = [];
    let pending: (() => void) | null = null;
    const w = watchServer(client, { intervalMs: 60_000, backoffMs: { base: 5_000, max: 300_000 }, random: () => 0.5, setTimer: (fn, ms) => ((pending = fn), timers.push(ms), timers.length), clearTimer: () => undefined });
    await w.check();
    expect(w.get()).toMatchObject({ state: 'reachable' });
    expect(timers.at(-1)).toBe(60_000);
    server.state.fail = 'network';
    await w.check();
    expect(w.get()).toMatchObject({ state: 'unreachable', error: { code: 'server_unreachable' } });
    expect(timers.at(-1)).toBe(5_000);
    pending!();
    await new Promise((r) => setTimeout(r, 0));
    expect(timers.at(-1)).toBe(10_000);
    server.state.fail = { status: 401, code: 'revoked' };
    await w.check();
    expect(w.get()).toEqual({ state: 'revoked' });
    w.stop();
  });

  it('flags a server older than this page', async () => {
    const { client } = fakeClient({ paired: true, server: fakeServer({ version: '0.3.2' }) });
    const w = watchServer(client, { setTimer: () => 0, clearTimer: () => undefined });
    await w.check();
    expect(w.get()).toMatchObject({ state: 'version' });
    w.stop();
  });
});

describe('server client: V2 review', () => {
  it('a request that never answers ends as unreachable after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { storage } = fakeClient({ paired: true });
      const hang: typeof fetch = (_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
      const client = createServerClient({ storage, fetchImpl: hang, localNetworkDenied: async () => false });
      const p = client.devices();
      const assertion = expect(p).rejects.toMatchObject({ code: 'server_unreachable' });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
      await assertion;
      expect(client.isPaired()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late 401 for an old pairing does not end a newer pairing', async () => {
    const { storage } = fakeClient({ paired: true });
    let release!: (r: Response) => void;
    const slow: typeof fetch = () => new Promise<Response>((r) => (release = r));
    const client = createServerClient({ storage, fetchImpl: slow, localNetworkDenied: async () => false });
    const p = client.devices().catch((e: unknown) => e);
    client.forget();
    storage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: BASE, token: 'new-token', deviceId: 'dev-2', person: { id: 'p1', label: 'Sam' }, pairedAt: '' }));
    release(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    await p;
    expect(client.isPaired()).toBe(true);
    expect(client.pairing()?.deviceId).toBe('dev-2');
  });

  it('the token is only in the Authorization header: never the URL, and not in an error', async () => {
    const urls: string[] = [];
    const { storage } = fakeClient({ paired: true });
    const f: typeof fetch = async (u) => {
      urls.push(String(u));
      return new Response('<html>nope</html>', { status: 500 });
    };
    const client = createServerClient({ storage, fetchImpl: f, localNetworkDenied: async () => false });
    const err = (await client.status().catch((e: unknown) => e)) as ServerError;
    expect(err.code).toBe('server_error');
    expect(`${err.message}${JSON.stringify(err)}`).not.toContain(TOKEN);
    expect(urls.join()).not.toContain(TOKEN);
    const ok: typeof fetch = async () => new Response('<html>', { status: 200 });
    const c2 = createServerClient({ storage, fetchImpl: ok, localNetworkDenied: async () => false });
    await expect(c2.status()).rejects.toMatchObject({ code: 'server_error' });
  });

  it('a status answer that arrives after Forget does not show reachable', async () => {
    const { storage } = fakeClient({ paired: true });
    const server = fakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f: typeof fetch = async (u, i) => {
      await gate;
      return server.fetch(u, i);
    };
    const client = createServerClient({ storage, fetchImpl: f, localNetworkDenied: async () => false });
    const w = watchServer(client, { setTimer: () => 0, clearTimer: () => undefined });
    const check = w.check();
    client.forget();
    release();
    await check;
    expect(w.get().state).toBe('unpaired');
    w.stop();
  });
});
