// Deployment headers (docs/SUITE_SPEC.md §9.1): netlify.toml and `vite preview` must send the same policy, and it must be
// the policy the spec names. Plain text comparisons, so a tweak in one place that forgets the others fails here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs from the repo root (the jsdom environment gives `import.meta.url` no file path to resolve against).
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const netlify = read('netlify.toml');
const vite = read('vite.config.ts');
const spec = read('docs/SUITE_SPEC.md');

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The value of `Name = "value"` inside netlify.toml. */
function netlifyHeader(name: string): string {
  const match = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(netlify);
  if (!match) throw new Error(`netlify.toml has no ${name}`);
  return match[1]!;
}

/** The first header block (`[[headers]] for = "<path>"`) in netlify.toml, as text. */
function netlifyBlock(path: string): string {
  const start = netlify.indexOf(`for = "${path}"`);
  if (start < 0) throw new Error(`netlify.toml has no headers for ${path}`);
  const next = netlify.indexOf('[[headers]]', start);
  return netlify.slice(start, next < 0 ? undefined : next);
}

/** The string constant `const NAME = '…' | "…"` in vite.config.ts. */
function viteConstant(name: string): string {
  const match = new RegExp(`const ${name} =\\s*(['"])(.*?)\\1;`, 's').exec(vite);
  if (!match) throw new Error(`vite.config.ts has no ${name}`);
  return match[2]!;
}

function specLine(header: string): string {
  const section = spec.slice(spec.indexOf('### 9.1 CSP and headers'));
  const block = section.slice(section.indexOf('```') + 3, section.indexOf('```', section.indexOf('```') + 3));
  const start = block.indexOf(`${header}:`);
  const rest = block.slice(start + header.length + 1);
  const end = rest.search(/\n(?=[A-Z][A-Za-z-]+:)/);
  return squash(end < 0 ? rest : rest.slice(0, end));
}

describe('Content-Security-Policy', () => {
  it('is the same in netlify.toml and `vite preview`', () => {
    expect(viteConstant('CSP')).toBe(netlifyHeader('Content-Security-Policy'));
  });

  it('is exactly the policy in SUITE_SPEC §9.1', () => {
    expect(netlifyHeader('Content-Security-Policy')).toBe(specLine('Content-Security-Policy'));
  });

  it('keeps the directives the features rely on', () => {
    const csp = netlifyHeader('Content-Security-Policy');
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';"); // Evolu's SQLite-WASM, never JS eval
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("worker-src 'self' blob:;");
    expect(csp).toContain("connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*;");
    expect(csp).toContain("object-src 'none';");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('Permissions-Policy', () => {
  it('is the same in netlify.toml and `vite preview`', () => {
    expect(viteConstant('PERMISSIONS_POLICY')).toBe(netlifyHeader('Permissions-Policy'));
  });

  it('is the spec policy plus camera=(self) for the pairing QR scan', () => {
    const sent = netlifyHeader('Permissions-Policy');
    expect(sent).toBe('camera=(self), microphone=(), geolocation=(), bluetooth=(self)');
    // The spec line differs only in the camera entry (E11 widened it for scanning a pairing code).
    expect(sent.replace('camera=(self)', 'camera=()')).toBe(specLine('Permissions-Policy'));
  });
});

describe('figure pack caching', () => {
  it('serves /figure/* as immutable octet-stream (the file is gzip already; its name carries the version)', () => {
    const block = netlifyBlock('/figure/*');
    expect(block).toContain('Cache-Control = "public, max-age=31536000, immutable"');
    expect(block).toContain('Content-Type = "application/octet-stream"');
    expect(block).not.toMatch(/Content-Encoding/i);
  });

  it('keeps the hashed-assets rule and the SPA fallback', () => {
    expect(netlifyBlock('/assets/*')).toContain('immutable');
    expect(netlify).toMatch(/from = "\/\*"\s+to = "\/index\.html"\s+status = 200/);
  });
});
