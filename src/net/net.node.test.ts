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
