// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRandomBytes } from '@evolu/common';
import { createAppOwner, createOwnerSecret } from '@evolu/common/local-first';
import { WebSocket } from 'ws';
import { createBlobStore, createMemoryBlobBackend, createRemoteBlobBackend } from '../../../src/sync/blobs/index.ts';
import { authVerifier } from '../../../src/sync/crypto.ts';
import { createMemorySyncStore } from '../../../src/sync/memoryStore.ts';
import type { NetPort } from '../../../src/sync/types.ts';
import { startCompanion, type Companion } from './server.ts';

const OWNER = 'Owner_hash-0123456789a';
const CHUNK = 'Chunk_id-0123456789abc';
const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const APP_ORIGIN = 'https://vitals.creative.desi';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let dir: string;
let appDir: string;
let companion: Companion;

/** Raw HTTP so paths reach the server unnormalised and any header (Origin, Host) can be set. */
function call(method: string, path: string, headers: Record<string, string> = {}, body?: Buffer): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: companion.port, method, path, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const auth = (token = TOKEN) => ({ Authorization: `Bearer ${token}` });
const putBlob = (path: string, body: Buffer, headers: Record<string, string> = {}) =>
  call('PUT', path, { ...auth(), 'If-None-Match': '*', 'Content-Type': 'application/octet-stream', ...headers }, body);

function upgrade(path: string, origin?: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${companion.port}${path}`, origin ? { origin } : {});
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('error', () => undefined);
  });
}

const ownerId = () => createAppOwner(createOwnerSecret({ randomBytes: createRandomBytes() })).id;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-companion-'));
  appDir = join(dir, 'dist');
  mkdirSync(join(appDir, 'assets'), { recursive: true });
  writeFileSync(join(appDir, 'index.html'), '<!doctype html><title>Vitals</title>');
  writeFileSync(join(appDir, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(appDir, 'assets', 'sqlite3.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(dir, 'secret.txt'), 'nope');
  companion = await startCompanion({ port: 0, dataDir: join(dir, 'data'), allowedOrigins: [APP_ORIGIN], serveApp: appDir, maxBlobBytes: 1024 });
});

afterAll(async () => {
  await companion.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('companion /blobs', () => {
  const path = `/blobs/${OWNER}/${CHUNK}`;

  it('rejects reads before the owner registered', async () => {
    expect((await call('GET', `/blobs/${OWNER}/${'Z'.repeat(22)}`, auth())).status).toBe(401);
  });

  it('creates once, then answers 412, and serves the bytes back', async () => {
    const created = await putBlob(path, Buffer.from([1, 2, 3]));
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe(`"${CHUNK}"`);
    expect((await putBlob(path, Buffer.from([9]))).status).toBe(412);
    const got = await call('GET', path, auth());
    expect(got.status).toBe(200);
    expect([...got.body]).toEqual([1, 2, 3]);
    expect(got.headers['content-type']).toBe('application/octet-stream');
    const head = await call('HEAD', path, auth());
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('3');
    expect((await call('HEAD', `/blobs/${OWNER}/${'Y'.repeat(22)}`, auth())).status).toBe(404);
    expect((await call('GET', `/blobs/${OWNER}/${'Y'.repeat(22)}`, auth())).status).toBe(404);
    expect(readFileSync(join(dir, 'data', 'blobs', OWNER, CHUNK.slice(0, 2), CHUNK))).toEqual(Buffer.from([1, 2, 3]));
    expect(readFileSync(join(dir, 'data', 'blobs', OWNER, '.auth'), 'utf8')).toBe(await authVerifier(TOKEN));
    expect(readdirSync(join(dir, 'data', 'blobs', OWNER)).filter((n) => n.startsWith('.tmp'))).toEqual([]);
  });

  it('refuses a wrong or missing token after registration', async () => {
    const other = Buffer.alloc(32, 8).toString('base64url');
    expect((await call('GET', path, auth(other))).status).toBe(401);
    expect((await call('HEAD', path, auth(other))).status).toBe(401);
    expect((await call('GET', path)).status).toBe(401);
    expect((await putBlob(`/blobs/${OWNER}/${'X'.repeat(22)}`, Buffer.from([1]), auth(other))).status).toBe(401);
  });

  it('rejects bad ids and traversal attempts with 400', async () => {
    for (const p of [
      `/blobs/${OWNER}/short`,
      `/blobs/${OWNER}/${CHUNK}/extra`,
      `/blobs/${OWNER}/..%2F..%2Fsecret.txt`,
      `/blobs/../${CHUNK}`,
      `/blobs/${OWNER}/../../../secret.txt`,
      `/blobs/${OWNER}/${CHUNK.slice(0, 21)}.`,
      `/blobs/${OWNER}/%2e%2e%2f${CHUNK.slice(0, 13)}`,
      `/blobs/${OWNER}`,
    ]) {
      expect((await call('GET', p, auth())).status, p).toBe(400);
      expect((await putBlob(p, Buffer.from([1]))).status, p).toBe(400);
    }
  });

  it('requires If-None-Match: * on PUT (428) and enforces the size limit (413)', async () => {
    const p = `/blobs/${OWNER}/${'W'.repeat(22)}`;
    expect((await call('PUT', p, { ...auth(), 'Content-Type': 'application/octet-stream' }, Buffer.from([1]))).status).toBe(428);
    expect((await putBlob(p, Buffer.alloc(1025))).status).toBe(413);
    expect((await putBlob(p, Buffer.alloc(1024))).status).toBe(201);
  });

  it('answers CORS preflights for allowed origins and refuses others', async () => {
    const pre = await call('OPTIONS', path, {
      Origin: APP_ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization, if-none-match, content-type',
      'Access-Control-Request-Private-Network': 'true',
    });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(pre.headers['access-control-allow-methods']).toBe('PUT, GET, HEAD');
    expect(pre.headers['access-control-allow-headers']).toBe('Authorization, If-None-Match, Content-Type');
    expect(pre.headers['access-control-allow-private-network']).toBe('true');
    expect(pre.headers.vary).toBe('Origin');
    const got = await call('GET', path, { ...auth(), Origin: APP_ORIGIN });
    expect(got.headers['access-control-expose-headers']).toBe('ETag');
    expect((await call('OPTIONS', path, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', path, { ...auth(), Origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('companion quota', () => {
  it('answers 507 once an owner is over quota', async () => {
    const small = await startCompanion({ port: 0, dataDir: join(dir, 'quota'), allowedOrigins: [], quotaBytesPerOwner: 10 });
    const put = (id: string, n: number) =>
      fetch(`${small.url}/blobs/${OWNER}/${id}`, { method: 'PUT', headers: { ...auth(), 'If-None-Match': '*' }, body: Buffer.alloc(n) });
    try {
      expect((await put('A'.repeat(22), 8)).status).toBe(201);
      expect((await put('B'.repeat(22), 3)).status).toBe(507);
      expect((await put('C'.repeat(22), 2)).status).toBe(201);
    } finally {
      await small.close();
    }
  });
});

describe('companion /sync', () => {
  it('accepts a WebSocket for a valid owner id from allowed or same origins', async () => {
    expect(await upgrade(`/sync?ownerId=${ownerId()}`)).toBe(101);
    expect(await upgrade(`/sync?ownerId=${ownerId()}`, APP_ORIGIN)).toBe(101);
    expect(await upgrade(`/sync?ownerId=${ownerId()}`, `http://127.0.0.1:${companion.port}`)).toBe(101);
  });

  it('rejects foreign origins (403), other paths (404) and a missing owner id (400)', async () => {
    expect(await upgrade(`/sync?ownerId=${ownerId()}`, 'https://evil.example')).toBe(403);
    expect(await upgrade(`/relay?ownerId=${ownerId()}`, APP_ORIGIN)).toBe(404);
    expect(await upgrade('/sync')).toBe(400);
    expect(await upgrade('/sync?ownerId=nope')).toBe(400);
  });

  it('answers plain HTTP on /sync with 426', async () => {
    expect((await call('GET', '/sync')).status).toBe(426);
  });
});

describe('companion /health and static app', () => {
  it('reports version, roles and owner count only', async () => {
    const res = await call('GET', '/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body.toString()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['mqtt', 'ownerCount', 'persons', 'role', 'roles', 'version']);
    expect(body.version).toBe('0.4.0');
    expect(body.roles).toEqual(['relay', 'app']);
    expect(body.ownerCount).toBeGreaterThanOrEqual(1);
  });

  it('serves the app with a strict CSP, MIME types, immutable assets and SPA fallback', async () => {
    const index = await call('GET', '/', { Host: 'box.tail1.ts.net' });
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = String(index.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' wss://box.tail1.ts.net");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(index.headers['cache-control']).toBe('no-cache');

    const route = await call('GET', '/today/details');
    expect(route.status).toBe(200);
    expect(route.body.toString()).toContain('<title>Vitals</title>');

    const js = await call('GET', '/assets/app-123.js');
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await call('GET', '/assets/sqlite3.wasm')).headers['content-type']).toBe('application/wasm');
    expect((await call('GET', '/assets/missing-1.js')).status).toBe(404);
    expect((await call('GET', '/../secret.txt')).body.toString()).not.toContain('nope');
    expect((await call('GET', '/%2e%2e/secret.txt')).body.toString()).not.toContain('nope');
  });
});

describe('src/sync/blobs against the running companion', () => {
  it('uploads, evicts and re-downloads a chunk through the real endpoint', async () => {
    const manifests = createMemorySyncStore();
    await manifests.open({ secret: crypto.getRandomValues(new Uint8Array(32)), relayUrl: null, deviceId: 'dev1' });
    const keys = manifests.keys!;
    const allowed: string[] = [];
    const net: NetPort = {
      fetch: (url, init) => globalThis.fetch(url, init),
      assertAllowed: (url) => void allowed.push(url),
    };
    const remote = createRemoteBlobBackend({ baseUrl: companion.url, keys, net });
    const local = createMemoryBlobBackend();
    const store = createBlobStore({ keys, manifests, local, remote });
    const hour = '2026-09-01T08:00:00.000Z';
    const t0 = Date.parse(hour);
    const samples = { t: Array.from({ length: 60 }, (_, i) => t0 + i * 60_000), v: Array.from({ length: 60 }, (_, i) => 50 + i) };
    const m = await store.put({ source: 'polar', metric: 'hr', hourStartUtc: hour }, samples);
    expect(await store.flush()).toBe(1);
    expect(store.pending()).toBe(0);
    expect(await remote.has(m.chunkId)).toBe(true);
    expect(await remote.put(m.chunkId, local.map.get(m.chunkId)!)).toBe('exists');
    expect(await store.evictLocal('2026-10-01T00:00:00.000Z')).toBe(1);
    expect(await store.hasLocal(m.chunkId)).toBe(false);
    const back = await store.get(m.chunkId);
    expect([...back.v]).toEqual(samples.v);
    expect(allowed.every((u) => u.startsWith(`${companion.url}/blobs/${keys.ownerIdHash}/`))).toBe(true);
  });
});
