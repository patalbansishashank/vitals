import { deriveVitalsKeys, randomBytes } from '../crypto';
import type { NetPort, VitalsKeys } from '../types';
import { createRemoteBlobBackend, normalizeBlobBaseUrl } from './remote';

const id = 'A'.repeat(22);

function fakeNet(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const asserted: string[] = [];
  const net: NetPort = {
    async fetch(url, init = {}) {
      calls.push({ url, init });
      return respond(url, init);
    },
    assertAllowed(url) {
      asserted.push(url);
      if (url.includes('blocked')) throw new Error('blocked by allowlist');
    },
  };
  return { net, calls, asserted };
}

describe('remote blob backend', () => {
  let keys: VitalsKeys;
  beforeAll(async () => {
    keys = await deriveVitalsKeys(randomBytes(32), 'owner-1');
  });

  it('speaks the endpoint protocol', async () => {
    const store = new Map<string, Uint8Array>();
    const { net, calls, asserted } = fakeNet((url, init) => {
      const k = url;
      if (init.method === 'PUT') {
        if (store.has(k)) return new Response(null, { status: 412 });
        store.set(k, new Uint8Array(init.body as ArrayBuffer));
        return new Response(null, { status: 201 });
      }
      const v = store.get(k);
      if (!v) return new Response(null, { status: 404 });
      return new Response(init.method === 'HEAD' ? null : v.slice(), { status: 200 });
    });
    const b = createRemoteBlobBackend({ baseUrl: 'https://box.tail.ts.net/', keys, net });
    expect(await b.has(id)).toBe(false);
    expect(await b.get(id)).toBeNull();
    expect(await b.put(id, new Uint8Array([5, 6]))).toBe('created');
    expect(await b.put(id, new Uint8Array([5, 6]))).toBe('exists');
    expect(await b.has(id)).toBe(true);
    expect([...(await b.get(id))!]).toEqual([5, 6]);

    const url = `https://box.tail.ts.net/blobs/${keys.ownerIdHash}/${id}`;
    expect(calls[2]!.url).toBe(url);
    expect(calls[2]!.init.headers).toMatchObject({
      Authorization: `Bearer ${keys.authToken}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    });
    expect(asserted).toHaveLength(calls.length);
    expect(calls.map((c) => c.init.method)).toEqual(['HEAD', 'GET', 'PUT', 'PUT', 'HEAD', 'GET']);
  });

  it('maps failures to coded errors', async () => {
    for (const [status, code] of [
      [401, 'blob_auth'],
      [403, 'blob_auth'],
      [413, 'blob_too_large'],
      [500, 'blob_server'],
      [507, 'blob_server'],
      [418, 'blob_http'],
    ] as const) {
      const { net } = fakeNet(() => new Response(null, { status }));
      const b = createRemoteBlobBackend({ baseUrl: 'https://h', keys, net });
      await expect(b.put(id, new Uint8Array([1]))).rejects.toMatchObject({ code, status });
    }
    const offline: NetPort = { fetch: () => Promise.reject(new TypeError('Failed to fetch')), assertAllowed: () => undefined };
    await expect(createRemoteBlobBackend({ baseUrl: 'https://h', keys, net: offline }).get(id)).rejects.toMatchObject({ code: 'blob_network' });
  });

  it('checks the allowlist before every request and validates ids', async () => {
    const { net, calls } = fakeNet(() => new Response(null, { status: 404 }));
    await expect(createRemoteBlobBackend({ baseUrl: 'https://blocked.example', keys, net }).get(id)).rejects.toThrow(/allowlist/);
    await expect(createRemoteBlobBackend({ baseUrl: 'https://h', keys, net }).get('../x')).rejects.toThrow(/Invalid chunk id/);
    expect(calls).toHaveLength(0);
  });

  it('normalises the base URL', () => {
    expect(normalizeBlobBaseUrl('wss://h.ts.net/sync')).toBe('https://h.ts.net');
    expect(normalizeBlobBaseUrl('http://127.0.0.1:4870/')).toBe('http://127.0.0.1:4870');
  });
});
