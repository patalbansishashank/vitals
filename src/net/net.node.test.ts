// @vitest-environment node
import { allowOrigin, isAllowed, listAllowed, NetBlockedError, netFetch, originOf, resetNetAllowlist } from './net';

afterEach(() => {
  resetNetAllowlist();
  vi.unstubAllGlobals();
});

describe('net allowlist', () => {
  it('blocks origins that were not allowed, without calling fetch', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    await expect(netFetch('https://api.openai.com/v1/models')).rejects.toBeInstanceOf(NetBlockedError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows a granted origin for any path, and revoke removes only that grant', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    const revokeAi = allowOrigin('https://openrouter.ai/api/v1', 'ai');
    const revokeOther = allowOrigin('https://openrouter.ai', 'other');
    expect(isAllowed('https://openrouter.ai/api/v1/chat/completions')).toBe(true);
    expect(isAllowed('https://openrouter.ai.evil.example/x')).toBe(false);
    expect(isAllowed('http://openrouter.ai/x')).toBe(false);
    await netFetch('https://openrouter.ai/api/v1/models');
    expect(spy).toHaveBeenCalledTimes(1);
    revokeAi();
    expect(listAllowed()).toEqual([{ origin: 'https://openrouter.ai', purposes: ['other'] }]);
    revokeOther();
    expect(isAllowed('https://openrouter.ai/x')).toBe(false);
  });

  it('normalises origins (default ports, case)', () => {
    expect(originOf('HTTPS://API.Anthropic.com:443/v1')).toBe('https://api.anthropic.com');
    expect(originOf('not a url')).toBeNull();
    allowOrigin('http://127.0.0.1:11434/v1', 'ai');
    expect(isAllowed('http://127.0.0.1:11434/api/show')).toBe(true);
    expect(isAllowed('http://127.0.0.1:1234/v1')).toBe(false);
  });
});

/**
 * Same-origin bundle assets (the 3D figure's `/figure/*.bin`) on every platform. Node has no `window`, so stubbing
 * `location` alone is exactly what a worker global looks like. `origin: 'null'` is what some runtimes report for the
 * non-special `app:` / `capacitor:` schemes; Chromium reports `app://vitals` for the registered standard scheme.
 */
describe('same-origin on every platform', () => {
  const asSelf = (href: string, origin: string) => vi.stubGlobal('location', { href, origin });

  // Each case: [where the code runs, href, location.origin, same-origin URLs, refused URLs].
  const cases: [string, string, string, string[], string[]][] = [
    [
      'web (https)',
      'https://vitals.example/body',
      'https://vitals.example',
      ['/figure/anatomy-v1.bin', 'https://vitals.example/figure/figure-v2.bin', 'wss://vitals.example/sync', 'HTTPS://VITALS.EXAMPLE:443/x'],
      ['https://vitals.example.evil.com/x', 'http://vitals.example/x', 'https://vitals.example:8443/x', 'app://vitals/x'],
    ],
    [
      'desktop, Chromium origin',
      'app://vitals/body',
      'app://vitals',
      ['/figure/anatomy-v1.bin', 'figure/figure-v2.bin', 'app://vitals/figure/anatomy-v1.bin', 'app://VITALS/x'],
      ['app://vitals.evil/x', 'app://evil/x', 'app://vitals:8080/x', 'app://vitals@evil/x', 'https://vitals/x', 'capacitor://vitals/x'],
    ],
    [
      'desktop, "null" origin',
      'app://vitals/body',
      'null',
      ['/figure/anatomy-v1.bin', 'app://vitals/figure/figure-v2.bin'],
      ['app://vitals.evil/x', 'https://vitals/x', 'https://evil.example/x'],
    ],
    [
      'desktop worker from a blob: URL',
      'blob:app://vitals/6f1c2a8e-0000-4000-8000-000000000000',
      'null',
      ['/figure/anatomy-v1.bin', 'app://vitals/figure/anatomy-v1.bin'],
      ['app://vitals.evil/x', 'blob:app://evil/x', 'https://evil.example/x'],
    ],
    [
      'desktop module worker',
      'app://vitals/assets/anatomy.worker-abc123.js',
      'app://vitals',
      ['/figure/anatomy-v1.bin', 'app://vitals/figure/figure-v2.bin'],
      ['app://vitals.evil/x', 'https://evil.example/x'],
    ],
    [
      'Android (Capacitor https)',
      'https://localhost/body',
      'https://localhost',
      ['/figure/anatomy-v1.bin', 'https://localhost/_capacitor_file_/data/x.csv'],
      ['https://localhost.evil.com/x', 'http://localhost/x', 'https://localhost:8443/x', 'capacitor://localhost/x'],
    ],
    [
      'Capacitor scheme',
      'capacitor://localhost/body',
      'null',
      ['/figure/anatomy-v1.bin', 'capacitor://localhost/figure/figure-v2.bin'],
      ['capacitor://localhost.evil.com/x', 'https://localhost.evil.com/x', 'capacitor://evil/x'],
    ],
    [
      'web worker from a blob: URL',
      'blob:https://vitals.example/6f1c2a8e-0000-4000-8000-000000000000',
      'https://vitals.example',
      ['/figure/anatomy-v1.bin', 'https://vitals.example/figure/figure-v2.bin'],
      ['https://vitals.example.evil.com/x', 'https://evil.example/x'],
    ],
  ];

  it.each(cases)('%s: bundle assets pass, every other origin is refused', (_where, href, origin, ok, refused) => {
    asSelf(href, origin);
    for (const u of ok) expect(isAllowed(u), u).toBe(true);
    for (const u of refused) expect(isAllowed(u), u).toBe(false);
  });

  it('netFetch reaches the figure asset inside a desktop worker and still blocks a lookalike', async () => {
    asSelf('blob:app://vitals/6f1c2a8e-0000-4000-8000-000000000000', 'null');
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);
    await expect(netFetch('/figure/anatomy-v1.bin')).resolves.toBeInstanceOf(Response);
    await expect(netFetch('app://vitals.evil/figure/anatomy-v1.bin')).rejects.toBeInstanceOf(NetBlockedError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an http(s) page with an opaque ("null") origin is not same-origin with its href host', () => {
    asSelf('https://vitals.example/body', 'null');
    expect(isAllowed('https://vitals.example/figure/anatomy-v1.bin')).toBe(false);
    expect(isAllowed('/figure/anatomy-v1.bin')).toBe(false);
  });

  it('with no location at all (Node, a file:// page) only allowlisted origins pass', () => {
    vi.stubGlobal('location', undefined);
    expect(isAllowed('/figure/anatomy-v1.bin')).toBe(false);
    asSelf('file:///opt/vitals/index.html', 'null');
    expect(isAllowed('/figure/anatomy-v1.bin')).toBe(false);
    expect(isAllowed('file:///etc/passwd')).toBe(false);
  });

  it('the allowlist still refuses non-http schemes even when a host is granted', () => {
    asSelf('https://vitals.example/', 'https://vitals.example');
    expect(() => allowOrigin('app://evil', 'other')).toThrow(NetBlockedError);
    allowOrigin('https://evil.example', 'other');
    expect(isAllowed('app://evil.example/x')).toBe(false);
  });
});
