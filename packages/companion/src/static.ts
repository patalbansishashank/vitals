/** Static Vitals build at `/` with SPA fallback and a strict CSP (R7 §4.1, §6). */
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/**
 * The served app talks only to its own origin (relay and blobs are same-origin). CSP Level 3 lets 'self' match
 * ws:/wss: on the same host (Chrome 73+, Firefox 69+, Safari 15.4+); older engines need the explicit wss:// source,
 * so it is added whenever the Host header is a plain host[:port].
 */
export function contentSecurityPolicy(host?: string): string {
  const ws = host && HOST_RE.test(host) ? ` wss://${host} ws://${host}` : '';
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${ws}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createStaticHandler(appDir: string) {
  const root = resolve(appDir);

  const fileAt = async (p: string) => {
    const s = await stat(p).catch(() => null);
    return s?.isFile() ? p : null;
  };

  return async function serveStatic(req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const target = resolve(root, `.${path}`);
    const inside = target === root || target.startsWith(root + sep);
    let file = inside && !path.includes('\0') ? await fileAt(target === root ? join(root, 'index.html') : target) : null;
    // SPA fallback for routes; missing assets (anything with an extension) stay 404 so stale chunks fail loudly.
    if (!file && inside && !extname(path)) file = await fileAt(join(root, 'index.html'));
    const headers: Record<string, string | number> = {
      'Content-Security-Policy': contentSecurityPolicy(req.headers.host),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
    };
    if (!file) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : 'Not found.');
      return;
    }
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    headers['Content-Type'] = MIME[ext] ?? 'application/octet-stream';
    headers['Content-Length'] = body.length;
    headers['Cache-Control'] = path.startsWith('/assets/') && file !== join(root, 'index.html') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body);
  };
}
