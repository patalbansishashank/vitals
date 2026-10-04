/**
 * The `app://vitals/` scheme (SUITE_SPEC §15.6): the web build served from `dist/web`, unknown paths falling back to
 * `index.html` (the router renders the route), every response carrying the same Content-Security-Policy as
 * netlify.toml. The CSP is read from netlify.toml by scripts/build.mjs (csp.ts) and compiled in as `__VITALS_CSP__`, so
 * the two cannot drift. Path resolution is pure so tests cover traversal without Electron.
 */
import path from 'node:path';
import { APP_HOST, APP_SCHEME } from '../shared/bridge';
import { cspFromNetlifyToml } from './csp';

export { cspFromNetlifyToml };

/** Scheme privileges, registered before the app is ready. No service workers: the files are local already. */
export const SCHEME_PRIVILEGES = {
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
} as const;

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
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
};

/** The Content-Type for a file, by extension; unknown kinds are plain bytes. */
export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface Resolved {
  /** Absolute path of the file to serve. */
  file: string;
  /** True when the request did not name a file and gets index.html. */
  fallback: boolean;
}

export interface ResolveOptions {
  webDir: string;
  /** True when the path is an existing regular file. */
  isFile(file: string): boolean;
}

/**
 * The file for a request URL, or null when the URL is not ours (another host, or a path that tries to leave webDir).
 * Encoded segments are decoded first, so `%2e%2e` cannot slip through; any `..` segment is refused outright.
 */
export function resolveAppPath(url: string, o: ResolveOptions): Resolved | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const root = path.resolve(o.webDir);
  const index = { file: path.join(root, 'index.html'), fallback: true };
  const segments = pathname.split(/[\\/]+/).filter((s) => s.length > 0);
  // dots and spaces only (`..`, `...`, `.. `): Windows trims trailing dots and spaces, so none of them names a file
  if (segments.some((s) => /^[. ]+$/.test(s) || s.includes('\0'))) return null;
  if (segments.length === 0) return { file: index.file, fallback: false };
  const file = path.join(root, ...segments);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (o.isFile(file)) return { file, fallback: false };
  return index;
}

/** Response headers: the type and the CSP, nothing else (a hidden extra header is a policy change nobody reviewed). */
export function responseHeaders(file: string, csp: string): Record<string, string> {
  return { 'Content-Type': mimeFor(file), 'Content-Security-Policy': csp };
}

export interface ProtocolDeps {
  webDir: string;
  csp: string;
  isFile(file: string): boolean;
  /** Reads a file as a web stream (Electron: `net.fetch(pathToFileURL(file))`). */
  body(file: string): Promise<ReadableStream<Uint8Array> | ArrayBuffer | string>;
}

/** The handler for `protocol.handle('app', ...)`. Non-GET and foreign URLs get a plain 4xx with the CSP still on. */
export function createAppHandler(d: ProtocolDeps): (request: { url: string; method: string }) => Promise<Response> {
  return async (request) => {
    const headers = (file: string) => responseHeaders(file, d.csp);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: headers('x.txt') });
    }
    const hit = resolveAppPath(request.url, { webDir: d.webDir, isFile: d.isFile });
    if (!hit) return new Response('not found', { status: 404, headers: headers('x.txt') });
    try {
      return new Response(await d.body(hit.file), { status: 200, headers: headers(hit.file) });
    } catch {
      return new Response('not found', { status: 404, headers: headers('x.txt') });
    }
  };
}
