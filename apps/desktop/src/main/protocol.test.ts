import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppHandler, cspFromNetlifyToml, mimeFor, resolveAppPath, responseHeaders, SCHEME_PRIVILEGES } from './protocol';

const webDir = path.resolve('/srv/vitals/web');
const files = new Set(['index.html', 'assets/app-abc.js', 'assets/app-abc.css', 'assets/sqlite3-x.wasm', 'manifest.webmanifest', 'fonts/a.woff2', 'figure/figure-v1.bin', 'icons/icon-192.png'].map((f) => path.join(webDir, f)));
const isFile = (f: string): boolean => files.has(f);
const resolve = (url: string) => resolveAppPath(url, { webDir, isFile });

describe('resolveAppPath', () => {
  it('serves index.html for the root', () => {
    expect(resolve('app://vitals/')).toEqual({ file: path.join(webDir, 'index.html'), fallback: false });
    expect(resolve('app://vitals')).toEqual({ file: path.join(webDir, 'index.html'), fallback: false });
  });

  it('serves an existing file, ignoring the query and hash', () => {
    expect(resolve('app://vitals/assets/app-abc.js?v=1#x')?.file).toBe(path.join(webDir, 'assets/app-abc.js'));
    expect(resolve('app://vitals/assets/app-abc.js')?.fallback).toBe(false);
  });

  it('falls back to index.html for a route without a file', () => {
    expect(resolve('app://vitals/settings/sync')).toEqual({ file: path.join(webDir, 'index.html'), fallback: true });
    expect(resolve('app://vitals/assets/missing.js')?.fallback).toBe(true);
  });

  it('decodes encoded segments before looking', () => {
    expect(resolve('app://vitals/assets/app%2Dabc.js')?.file).toBe(path.join(webDir, 'assets/app-abc.js'));
  });

  it('refuses every way out of the web dir', () => {
    for (const url of [
      'app://vitals/..%2f..%2fetc/passwd',
      'app://vitals/assets/%2e%2e%2f%2e%2e%2fetc/passwd',
      'app://vitals/assets/..%2F..%2Fetc/passwd',
      'app://vitals/assets/..\\..\\etc\\passwd',
      'app://vitals/assets/%5c..%5c..%5cetc%5cpasswd',
      'app://vitals/a%00.js',
      'app://vitals/%ZZ',
    ]) {
      expect(resolve(url), url).toBeNull();
    }
  });

  it('stays inside the web dir for dot segments the URL parser folds before we see them (plain or %2e)', () => {
    for (const url of ['app://vitals/../index.html', 'app://vitals/assets/../../x', 'app://vitals/./index.html', 'app://vitals/a/b/../../../../index.html', 'app://vitals/%2e%2e/%2e%2e/etc/passwd', 'app://vitals/%2e/index.html']) {
      const hit = resolve(url);
      expect(hit, url).not.toBeNull();
      expect(path.relative(webDir, hit!.file).startsWith('..'), url).toBe(false);
    }
  });

  it('refuses other hosts and schemes', () => {
    expect(resolve('app://other/index.html')).toBeNull();
    expect(resolve('https://vitals/index.html')).toBeNull();
    expect(resolve('not a url')).toBeNull();
  });
});

describe('mimeFor', () => {
  it('knows the types the build ships', () => {
    expect(mimeFor('a.html')).toBe('text/html; charset=utf-8');
    expect(mimeFor('a.js')).toBe('text/javascript; charset=utf-8');
    expect(mimeFor('a.mjs')).toBe('text/javascript; charset=utf-8');
    expect(mimeFor('a.css')).toBe('text/css; charset=utf-8');
    expect(mimeFor('a.wasm')).toBe('application/wasm');
    expect(mimeFor('a.svg')).toBe('image/svg+xml');
    expect(mimeFor('a.webmanifest')).toBe('application/manifest+json; charset=utf-8');
    expect(mimeFor('a.json')).toBe('application/json; charset=utf-8');
    expect(mimeFor('a.woff2')).toBe('font/woff2');
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('A.PNG')).toBe('image/png');
    expect(mimeFor('figure-v1.bin')).toBe('application/octet-stream');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
  });
});

describe('CSP', () => {
  const netlify = readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf8');

  it("is read from netlify.toml's header block", () => {
    const csp = cspFromNetlifyToml(netlify);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/"/);
  });

  it('throws when netlify.toml has none (the build must not ship without a policy)', () => {
    expect(() => cspFromNetlifyToml('[build]\n')).toThrow(/Content-Security-Policy/);
  });

  it('is the whole header set: the type and the policy, nothing else', () => {
    const h = responseHeaders('/x/a.css', 'default-src x');
    expect(h).toEqual({ 'Content-Type': 'text/css; charset=utf-8', 'Content-Security-Policy': 'default-src x' });
  });
});

describe('createAppHandler', () => {
  const csp = cspFromNetlifyToml(readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf8'));
  const handler = createAppHandler({ webDir, csp, isFile, body: async (file) => `body of ${path.relative(webDir, file)}` });

  it('answers a file with its type and the CSP', async () => {
    const r = await handler({ url: 'app://vitals/assets/sqlite3-x.wasm', method: 'GET' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/wasm');
    expect(r.headers.get('Content-Security-Policy')).toBe(csp);
    expect(await r.text()).toBe('body of assets/sqlite3-x.wasm');
  });

  it('answers a route with index.html, status 200, with the CSP', async () => {
    const r = await handler({ url: 'app://vitals/plan/today', method: 'GET' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('Content-Security-Policy')).toBe(csp);
    expect(await r.text()).toBe('body of index.html');
  });

  it('refuses traversal, other hosts and other methods, still with the CSP', async () => {
    expect((await handler({ url: 'app://vitals/..%2f..%2fx', method: 'GET' })).status).toBe(404);
    expect((await handler({ url: 'app://other/', method: 'GET' })).status).toBe(404);
    const r = await handler({ url: 'app://vitals/', method: 'POST' });
    expect(r.status).toBe(405);
    expect(r.headers.get('Content-Security-Policy')).toBe(csp);
  });

  it('turns a read failure into 404', async () => {
    const h = createAppHandler({
      webDir,
      csp,
      isFile,
      body: async () => {
        throw new Error('gone');
      },
    });
    expect((await h({ url: 'app://vitals/index.html', method: 'GET' })).status).toBe(404);
  });
});

describe('SCHEME_PRIVILEGES', () => {
  it('is a standard, secure scheme with fetch and streams, and no service workers', () => {
    expect(SCHEME_PRIVILEGES.scheme).toBe('app');
    expect(SCHEME_PRIVILEGES.privileges).toMatchObject({ standard: true, secure: true, supportFetchAPI: true, stream: true });
    expect('allowServiceWorkers' in SCHEME_PRIVILEGES.privileges).toBe(false);
    expect('bypassCSP' in SCHEME_PRIVILEGES.privileges).toBe(false);
  });
});
