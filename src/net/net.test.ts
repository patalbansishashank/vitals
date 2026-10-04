import { allowOrigin, assertAllowed, browserNet, isAllowed, listAllowed, netFetch, netWebSocket, normalizeOrigin, reloadNetAllowlistForTests, resetNetAllowlist, revokeOrigin } from './net';

const KEY = 'vitals-net.allow';

beforeEach(() => {
  localStorage.clear();
  resetNetAllowlist();
});
afterEach(() => vi.unstubAllGlobals());

describe('normalizeOrigin', () => {
  it('maps ws to http and wss to https, drops default ports and paths, lowercases the host', () => {
    expect(normalizeOrigin('wss://Relay.Example.ts.net:443/sync?owner=x')).toBe('https://relay.example.ts.net');
    expect(normalizeOrigin('https://relay.example.ts.net/blobs')).toBe('https://relay.example.ts.net');
    expect(normalizeOrigin('ws://localhost:80/x')).toBe('http://localhost');
    expect(normalizeOrigin('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000');
    expect(normalizeOrigin('wss://h.example:8443')).toBe('https://h.example:8443');
    expect(normalizeOrigin('ftp://h.example')).toBeNull();
    expect(normalizeOrigin('data:text/plain,hi')).toBeNull();
  });
});

describe('allowlist', () => {
  it('always allows same-origin, including relative URLs', () => {
    expect(isAllowed('/assets/x.json')).toBe(true);
    expect(isAllowed(`${location.origin}/a`)).toBe(true);
  });

  it('rejects other origins until allowed; ws and http share one entry', () => {
    expect(isAllowed('wss://relay.example.ts.net/sync')).toBe(false);
    allowOrigin('https://relay.example.ts.net', 'sync');
    expect(isAllowed('wss://relay.example.ts.net/sync')).toBe(true);
    expect(isAllowed('https://relay.example.ts.net:443/blobs/x')).toBe(true);
    expect(isAllowed('https://relay.example.ts.net:8443/')).toBe(false);
    expect(isAllowed('https://other.example')).toBe(false);
  });

  it('refuses plain http to other machines even when asked, but allows loopback', () => {
    expect(() => allowOrigin('http://192.168.1.4:4000', 'server')).toThrow(expect.objectContaining({ code: 'net_not_allowed' }));
    expect(() => allowOrigin('ftp://x.example', 'ai')).toThrow();
    allowOrigin('http://127.0.0.1:4317', 'server');
    expect(isAllowed('ws://127.0.0.1:4317/sync')).toBe(true);
    allowOrigin('http://[::1]:5000', 'server');
    expect(isAllowed('http://[::1]:5000/x')).toBe(true);
  });

  it('ignores stored http entries for non-loopback hosts', () => {
    localStorage.setItem(KEY, JSON.stringify([{ origin: 'http://evil.example', purposes: ['ai'] }]));
    reloadNetAllowlistForTests();
    expect(isAllowed('http://evil.example/x')).toBe(false);
  });

  it('persists device-locally and survives a reload; revoke removes per reason', () => {
    allowOrigin('https://api.example.com/v1', 'ai');
    allowOrigin('https://api.example.com', 'sync');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([{ origin: 'https://api.example.com', purposes: ['ai', 'sync'] }]);
    expect(Object.keys(localStorage).some((k) => k.startsWith('vitals.'))).toBe(false);
    reloadNetAllowlistForTests();
    expect(listAllowed()).toEqual([{ origin: 'https://api.example.com', purposes: ['ai', 'sync'] }]);
    revokeOrigin('wss://api.example.com', 'ai');
    expect(isAllowed('https://api.example.com')).toBe(true);
    revokeOrigin('https://api.example.com', 'sync');
    expect(isAllowed('https://api.example.com')).toBe(false);
    expect(listAllowed()).toEqual([]);
  });

  it('allowOrigin returns a revoke function for exactly that grant', () => {
    const revoke = allowOrigin('wss://relay.example/sync', 'sync');
    allowOrigin('https://relay.example', 'server');
    revoke();
    expect(listAllowed()).toEqual([{ origin: 'https://relay.example', purposes: ['server'] }]);
  });

  it('survives broken storage', () => {
    localStorage.setItem(KEY, '{not json');
    reloadNetAllowlistForTests();
    expect(listAllowed()).toEqual([]);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => allowOrigin('https://a.example', 'ai')).not.toThrow();
    expect(isAllowed('https://a.example')).toBe(true);
    setItem.mockRestore();
  });

  it('assertAllowed throws a coded error', () => {
    expect(() => assertAllowed('https://nope.example/x')).toThrow(expect.objectContaining({ code: 'net_not_allowed' }));
  });
});

describe('netFetch / netWebSocket / browserNet', () => {
  it('rejects blocked targets without calling fetch, and passes allowed ones through', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(netFetch('https://blocked.example/x')).rejects.toMatchObject({ code: 'net_not_allowed' });
    await expect(browserNet.fetch('https://blocked.example/x')).rejects.toMatchObject({ code: 'net_not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
    allowOrigin('https://ok.example', 'sync');
    const res = await browserNet.fetch('https://ok.example/health', { method: 'GET' });
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('https://ok.example/health', { method: 'GET' });
    expect(() => browserNet.assertAllowed('wss://ok.example/sync')).not.toThrow();
  });

  it('opens sockets only to allowed origins', () => {
    const ctor = vi.fn();
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(...args: unknown[]) {
          ctor(...args);
        }
      },
    );
    expect(() => netWebSocket('wss://blocked.example/sync')).toThrow(expect.objectContaining({ code: 'net_not_allowed' }));
    expect(ctor).not.toHaveBeenCalled();
    allowOrigin('https://relay.example', 'sync');
    netWebSocket('wss://relay.example/sync', ['p']);
    expect(ctor).toHaveBeenCalledWith('wss://relay.example/sync', ['p']);
  });
});
