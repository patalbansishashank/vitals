// @vitest-environment node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createAuth, PAIRING_CODE_TTL_MS } from './auth.ts';
import { defaultConfigDir } from './config.ts';
import { createRateLimiter, createRedactingLogger } from './security.ts';
import { startCompanion, type Companion } from './server.ts';
import { rawCall, tempDir } from './testHelpers.ts';

const APP = 'https://vitals.creative.desi';
const EVIL = 'https://evil.example';

let tmp: ReturnType<typeof tempDir>;
let companion: Companion;
let configDir: string;
const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => rawCall(companion.port, method, path, headers, body);
const json = { 'Content-Type': 'application/json' };

beforeAll(async () => {
  tmp = tempDir();
  configDir = join(tmp.dir, 'config');
  companion = await startCompanion({ port: 0, allowedOrigins: [], relay: false, agent: true, configDir });
});
afterAll(async () => {
  await companion.close();
  tmp.cleanup();
});

describe('config dir', () => {
  it('follows each OS convention', () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe('/x/vitals-companion');
    expect(defaultConfigDir({}, 'linux', '/home/a')).toBe('/home/a/.config/vitals-companion');
    expect(defaultConfigDir({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Application Support/vitals-companion');
    expect(defaultConfigDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toContain('vitals-companion');
  });

  it('creates the config dir 0700 and the admin token 0600', () => {
    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(configDir, 'admin.token')).mode & 0o777).toBe(0o600);
  });
});

describe('origin, host and CORS', () => {
  it('answers /health without auth, with roles', async () => {
    const res = await call('GET', '/health', { Origin: APP });
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ version: '0.4.0', role: 'relay', roles: ['proxy', 'agent'], ownerCount: 0, persons: 0, mqtt: 'off' });
    expect(res.headers['access-control-allow-origin']).toBe(APP);
  });

  it('rejects a disallowed Origin with 403 on every route, without CORS headers', async () => {
    for (const [m, p] of [
      ['GET', '/health'],
      ['POST', '/v1/pair/local'],
      ['GET', '/v1/pair/status'],
      ['POST', '/proxy/nim/chat/completions'],
      ['POST', '/v1/ai/siwc/login'],
      ['POST', '/mcp'],
      ['OPTIONS', '/v1/pair/status'],
      ['GET', '/anything'],
    ] as const) {
      const res = await call(m, p, { Origin: EVIL });
      expect(res.status, `${m} ${p}`).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect((await call('GET', '/health', { Origin: 'null' })).status).toBe(403);
  });

  it('allows the public app, the packaged apps, loopback dev servers and the same origin', async () => {
    for (const origin of [APP, 'app://vitals', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:9999', `http://127.0.0.1:${companion.port}`]) {
      const res = await call('OPTIONS', '/v1/pair/status', { Origin: origin, 'Access-Control-Request-Method': 'GET' });
      expect(res.status, origin).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
      expect(res.headers['access-control-allow-private-network']).toBe('true');
    }
    const mcp = await call('OPTIONS', '/mcp', { Origin: APP });
    expect(mcp.headers['access-control-allow-headers']).toBe('Authorization, Content-Type, mcp-session-id, mcp-protocol-version, last-event-id');
    expect(mcp.headers['access-control-allow-methods']).toBe('GET, POST, DELETE');
  });

  it('rejects DNS rebinding: Host must be loopback, the bind address or *.ts.net', async () => {
    expect((await call('GET', '/health', { Host: 'attacker.example:4870' })).status).toBe(403);
    expect((await call('GET', '/health', { Host: '192.168.1.5' })).status).toBe(403);
    expect((await call('GET', '/health', { Host: 'localhost:4870' })).status).toBe(200);
    expect((await call('GET', '/health', { Host: 'box.tail1.ts.net' })).status).toBe(200);
    // A rebinding page's origin is its own name: never "same origin".
    expect((await call('GET', '/health', { Host: 'attacker.example', Origin: 'http://attacker.example' })).status).toBe(403);
  });
});

describe('bearer auth', () => {
  const routes = [
    ['GET', '/v1/pair/status'],
    ['POST', '/v1/pair/code'],
    ['POST', '/v1/pair/client'],
    ['POST', '/v1/ai/siwc/login'],
    ['GET', '/v1/ai/siwc/status'],
    ['POST', '/v1/ai/siwc/logout'],
    ['POST', '/proxy/nim/chat/completions'],
    ['POST', '/v1/ai/nim/chat/completions'],
    ['GET', '/v1/ai/siwc/models'],
    ['GET', '/v1/agent/manifest'],
    ['POST', '/v1/agent/call'],
    ['POST', '/mcp'],
  ] as const;

  it('answers 401 for a missing or wrong bearer on every new route', async () => {
    for (const [m, p] of routes) {
      const body = m === 'GET' ? undefined : '{}';
      const missing = await call(m, p, { Origin: APP, ...json }, body);
      expect(missing.status, `${m} ${p}`).toBe(401);
      expect(missing.headers['www-authenticate']).toBe('Bearer');
      expect((await call(m, p, { Origin: APP, Authorization: `Bearer ${'x'.repeat(43)}`, ...json }, body)).status, `${m} ${p}`).toBe(401);
      expect((await call(m, p, { Authorization: `Bearer ${'x'.repeat(43)}`, ...json }, body)).status, `${m} ${p}`).toBe(401);
    }
  });

  it('pairs a tab: single-use code, token bound to its origin, hashes only in pairings.json (0600)', async () => {
    const code = companion.pairingCode!.code;
    expect(code).toMatch(/^\d{8}$/);
    expect((await call('POST', '/v1/pair/local', json, JSON.stringify({ code }))).status).toBe(400); // no Origin
    const ok = await call('POST', '/v1/pair/local', { Origin: APP, ...json }, JSON.stringify({ code, label: 'Laptop Chrome' }));
    expect(ok.status).toBe(200);
    const token = ok.json().token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ok.headers['access-control-allow-origin']).toBe(APP);
    // single use
    expect((await call('POST', '/v1/pair/local', { Origin: APP, ...json }, JSON.stringify({ code }))).status).toBe(409);

    const status = await call('GET', '/v1/pair/status', { Origin: APP, Authorization: `Bearer ${token}` });
    expect(status.status).toBe(200);
    expect(status.json()).toEqual({
      ok: true,
      version: '0.4.0',
      roles: ['proxy', 'agent'],
      presets: { siwc: { signedIn: false }, nim: { configured: false }, 'opencode-zen': { configured: false } },
      tab: { connected: false, toolCount: 0 },
      mcpClients: [],
    });
    // bound to its origin: another allowed origin or no Origin at all is refused
    expect((await call('GET', '/v1/pair/status', { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await call('GET', '/v1/pair/status', { Authorization: `Bearer ${token}` })).status).toBe(401);
    // and it cannot reach admin-only or MCP routes
    expect((await call('POST', '/v1/pair/code', { Origin: APP, Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await call('POST', '/mcp', { Origin: APP, Authorization: `Bearer ${token}`, ...json }, '{}')).status).toBe(401);

    const file = join(configDir, 'pairings.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(token);
    const stored = JSON.parse(text) as { pairings: { hash: string; origin: string; label: string; createdAt: string; kind: string }[] };
    expect(stored.pairings).toHaveLength(1);
    expect(stored.pairings[0]).toMatchObject({ kind: 'browser', origin: APP, label: 'Laptop Chrome' });
    expect(stored.pairings[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('admin token (no Origin) mints codes and client tokens; client tokens work without Origin only', async () => {
    const admin = readFileSync(join(configDir, 'admin.token'), 'utf8').trim();
    const a = { Authorization: `Bearer ${admin}` };
    expect((await call('POST', '/v1/pair/code', { ...a, Origin: APP })).status).toBe(401);
    const fresh = await call('POST', '/v1/pair/code', a);
    expect(fresh.json().code).toMatch(/^\d{8}$/);
    const client = await call('POST', '/v1/pair/client', { ...a, ...json }, JSON.stringify({ name: 'claude-code' }));
    const token = client.json().token as string;
    expect((await call('GET', '/v1/pair/status', { Authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await call('GET', '/v1/pair/status', { Authorization: `Bearer ${token}`, Origin: APP })).status).toBe(401);
    expect((await call('POST', '/v1/pair/code', { Authorization: `Bearer ${token}` })).status).toBe(401);
    expect(readFileSync(join(configDir, 'pairings.json'), 'utf8')).not.toContain(token);
  });
});

describe('pairing code rules', () => {
  it('expires after 10 minutes and locks after 5 wrong attempts', async () => {
    const t = tempDir();
    let now = 1_000_000;
    const auth = await createAuth({ configDir: t.dir, log: createRedactingLogger(), now: () => now });
    try {
      let { code } = auth.newCode();
      now += PAIRING_CODE_TTL_MS + 1;
      expect(await auth.pair(code, APP)).toEqual({ ok: false, error: 'expired' });

      ({ code } = auth.newCode());
      const wrong = code === '00000000' ? '11111111' : '00000000';
      for (let i = 1; i <= 4; i++) expect(await auth.pair(wrong, APP)).toEqual({ ok: false, error: 'invalid_code', attemptsLeft: 5 - i });
      expect(await auth.pair(wrong, APP)).toEqual({ ok: false, error: 'locked', attemptsLeft: 0 });
      expect(await auth.pair(code, APP)).toEqual({ ok: false, error: 'locked' });

      ({ code } = auth.newCode());
      const r = await auth.pair(code, APP);
      expect(r.ok).toBe(true);
      expect(auth.verify(r.ok ? r.token : '', APP)?.kind).toBe('browser');
      expect(auth.verify(r.ok ? r.token : '', 'http://localhost:5173')).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it('maps pairing failures to HTTP statuses', async () => {
    const res = await call('POST', '/v1/pair/local', { Origin: APP, ...json }, JSON.stringify({ code: 'nope' }));
    expect([401, 409]).toContain(res.status);
  });
});

describe('rate limiter and logger', () => {
  it('token bucket: burst, then Retry-After', () => {
    let now = 0;
    const rl = createRateLimiter({ capacity: 3, perMinute: 60 }, () => now);
    expect([rl.take('a').ok, rl.take('a').ok, rl.take('a').ok]).toEqual([true, true, true]);
    expect(rl.take('a')).toEqual({ ok: false, retryAfterSec: 1 });
    expect(rl.take('b').ok).toBe(true);
    now += 1000;
    expect(rl.take('a').ok).toBe(true);
  });

  it('redacts registered secrets, bearer headers, token-shaped values and callback queries', () => {
    const lines: string[] = [];
    const log = createRedactingLogger((l) => lines.push(l));
    log.addSecret('supersecretvalue');
    log('got supersecretvalue in body');
    log('Authorization: Bearer abcdefghijkl');
    log('key nvapi-abcdefghijklmnop and sk-abcdefghijklmnop');
    log('GET http://127.0.0.1:5555/callback?code=abc&state=xyz');
    log('{"access_token":"tok-1234567","refresh_token":"r-1234567"}');
    expect(lines.join('\n')).not.toMatch(/supersecretvalue|abcdefghijkl|nvapi-a|sk-a|code=abc|state=xyz|tok-1234567|r-1234567/);
  });
});
