import { isAllowed, resetNetAllowlist } from '@/net/net';
import { testRelay } from './relayTest';

const reply = (status: number, body: unknown) => async (_url?: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => resetNetAllowlist());
afterEach(() => vi.unstubAllGlobals());

describe('testRelay (test before create)', () => {
  it('accepts a Vitals relay and reports its version', async () => {
    const fetch = vi.fn(reply(200, { version: '0.1.0', roles: ['relay'], ownerCount: 0 }));
    vi.stubGlobal('fetch', fetch);
    const r = await testRelay('http://127.0.0.1:4870');
    expect(r).toMatchObject({ ok: true, version: '0.1.0', ms: expect.any(Number), message: expect.stringMatching(/^Reached the server · version 0\.1\.0 · \d+ ms$/) });
    expect(fetch.mock.calls[0]![0]).toBe('http://127.0.0.1:4870/health');
    expect(isAllowed('http://127.0.0.1:4870')).toBe(true);
  });

  it('says plainly when nothing answers or the address is not a relay, and leaves no grant behind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await testRelay('https://nobody.example.ts.net')).toEqual({ ok: false, message: 'No answer from that address. Is the server running and is Tailscale on?' });
    expect(isAllowed('https://nobody.example.ts.net')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(reply(200, { hello: 'world' })));
    expect(await testRelay('https://web.example.com')).toEqual({ ok: false, message: "That address isn't a Vitals sync server." });
    vi.stubGlobal('fetch', vi.fn(reply(404, {})));
    expect((await testRelay('https://web.example.com')).ok).toBe(false);
  });

  it('refuses plain http to another machine before any request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await testRelay('http://192.168.1.5:4870')).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
