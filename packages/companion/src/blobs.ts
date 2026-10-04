/**
 * `/blobs/{ownerIdHash}/{chunkId}`: create-only encrypted chunk storage (R7 §3, §4.1).
 *
 * The server never sees plaintext or the bearer token at rest: `<dataDir>/blobs/<ownerIdHash>/.auth` holds
 * base64url(SHA-256(token bytes)), set by the owner's first PUT (trust on first use). Chunks live at
 * `<dataDir>/blobs/<ownerIdHash>/<chunkId[0..2]>/<chunkId>`, written to a temp file and linked into place, so a
 * chunk appears atomically and a concurrent PUT of the same id gets 412.
 *
 * Status codes: 201 created, 412 exists, 428 PUT without `If-None-Match: *`, 400 bad id, 401 bad or unknown token,
 * 404 missing, 405 other methods, 413 over maxBlobBytes, 507 over the owner's quota.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export interface BlobHandlerOptions {
  dataDir: string;
  maxBlobBytes: number;
  quotaBytesPerOwner: number;
}

export interface BlobHandler {
  handle(req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<void>;
  ownerCount(): Promise<number>;
}

const verifierOf = (token: string) => createHash('sha256').update(Buffer.from(token, 'base64url')).digest('base64url');

function send(res: ServerResponse, status: number, body?: string, headers: Record<string, string | number> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}), ...headers });
  res.end(body);
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code;

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile() && !entry.name.startsWith('.')) total += (await stat(p)).size;
  }
  return total;
}

export function createBlobHandler({ dataDir, maxBlobBytes, quotaBytesPerOwner }: BlobHandlerOptions): BlobHandler {
  const root = join(dataDir, 'blobs');
  const usage = new Map<string, Promise<number>>();
  const usageOf = (owner: string) => {
    let u = usage.get(owner);
    if (!u) usage.set(owner, (u = dirSize(join(root, owner))));
    return u;
  };

  /** 'ok' | 'unknown' (no verifier yet) | 'bad'. */
  const checkAuth = async (owner: string, token: string | null): Promise<'ok' | 'unknown' | 'bad'> => {
    if (!token) return 'bad';
    const stored = await readFile(join(root, owner, '.auth'), 'utf8').catch((e: unknown) => {
      if (errCode(e) === 'ENOENT') return null;
      throw e;
    });
    if (stored === null) return 'unknown';
    const a = Buffer.from(stored.trim());
    const b = Buffer.from(verifierOf(token));
    return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'bad';
  };

  const register = async (owner: string, token: string): Promise<boolean> => {
    await mkdir(join(root, owner), { recursive: true });
    try {
      await writeFile(join(root, owner, '.auth'), verifierOf(token), { flag: 'wx', mode: 0o600 });
      return true;
    } catch (e) {
      if (errCode(e) !== 'EEXIST') throw e;
      return (await checkAuth(owner, token)) === 'ok';
    }
  };

  /** Move tmp to file unless file exists; false if it did. Hard links make the check-and-place atomic. */
  const placeOnce = async (tmp: string, file: string): Promise<boolean> => {
    try {
      await link(tmp, file);
      return true;
    } catch (e) {
      // EEXIST: someone else won. Filesystems without hard links fall back to check + rename.
      if (errCode(e) === 'EEXIST' || (await stat(file).catch(() => null))) return false;
      await rename(tmp, file);
      return true;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  };

  const readBody = (req: IncomingMessage): Promise<Buffer | 'too-large'> =>
    new Promise((resolve, reject) => {
      const parts: Buffer[] = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBlobBytes) {
          done = true;
          resolve('too-large');
          return;
        }
        parts.push(chunk);
      });
      req.on('end', () => {
        if (!done) resolve(Buffer.concat(parts));
      });
      req.on('error', reject);
    });

  const put = async (req: IncomingMessage, res: ServerResponse, owner: string, chunkId: string, token: string) => {
    if (req.headers['if-none-match'] !== '*') return send(res, 428, 'PUT requires If-None-Match: * (chunks are create-only).');
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (declared > maxBlobBytes) return send(res, 413, `Chunks are limited to ${maxBlobBytes} bytes.`, { Connection: 'close' });
    const file = join(root, owner, chunkId.slice(0, 2), chunkId);
    const auth = await checkAuth(owner, token);
    if (auth === 'bad') return send(res, 401, 'Unauthorized.');
    if (auth === 'ok' && (await stat(file).catch(() => null))) return send(res, 412, 'Chunk exists.', { ETag: `"${chunkId}"` });
    if (Number.isFinite(declared) && (await usageOf(owner)) + declared > quotaBytesPerOwner) return send(res, 507, 'Owner quota exceeded.');

    const body = await readBody(req);
    if (body === 'too-large') return send(res, 413, `Chunks are limited to ${maxBlobBytes} bytes.`, { Connection: 'close' });
    if (body.length === 0) return send(res, 400, 'Empty body.');
    if (auth === 'unknown' && !(await register(owner, token))) return send(res, 401, 'Unauthorized.');
    if ((await usageOf(owner)) + body.length > quotaBytesPerOwner) return send(res, 507, 'Owner quota exceeded.');

    const dir = join(root, owner, chunkId.slice(0, 2));
    await mkdir(dir, { recursive: true });
    const tmp = join(root, owner, `.tmp-${randomBytes(8).toString('hex')}`);
    await writeFile(tmp, body, { mode: 0o600 });
    if (!(await placeOnce(tmp, file))) return send(res, 412, 'Chunk exists.', { ETag: `"${chunkId}"` });
    usage.set(owner, usageOf(owner).then((u) => u + body.length));
    send(res, 201, undefined, { ETag: `"${chunkId}"` });
  };

  const get = async (req: IncomingMessage, res: ServerResponse, owner: string, chunkId: string) => {
    const file = join(root, owner, chunkId.slice(0, 2), chunkId);
    const data = await readFile(file).catch((e: unknown) => {
      if (errCode(e) === 'ENOENT') return null;
      throw e;
    });
    if (!data) return send(res, 404, req.method === 'HEAD' ? undefined : 'Not found.');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
      ETag: `"${chunkId}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  };

  return {
    async handle(req, res, rawPath) {
      const parts = rawPath.split('/');
      // ['', 'blobs', owner, chunkId]: anything else (encoded slashes, dots, extra segments) is rejected outright.
      const owner = parts[2] ?? '';
      const chunkId = parts[3] ?? '';
      if (parts.length !== 4 || !ID_RE.test(owner) || !ID_RE.test(chunkId)) return send(res, 400, 'Bad blob path.');
      if (req.method !== 'PUT' && req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed.', { Allow: 'PUT, GET, HEAD, OPTIONS' });
      const m = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
      const token = m && TOKEN_RE.test(m[1]!) ? m[1]! : null;
      if (req.method === 'PUT') return put(req, res, owner, chunkId, token ?? '');
      if ((await checkAuth(owner, token)) !== 'ok') return send(res, 401, req.method === 'HEAD' ? undefined : 'Unauthorized.');
      return get(req, res, owner, chunkId);
    },
    async ownerCount() {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      return entries.filter((e) => e.isDirectory() && ID_RE.test(e.name)).length;
    },
  };
}
