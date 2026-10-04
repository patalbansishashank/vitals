// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AI_DB_NAME, AI_DB_STORES, IdbKv, MemoryKv } from './kv';

/**
 * Minimal hand-written IndexedDB fake: enough of open/upgrade, transactions, get/put/delete/getAllKeys for IdbKv.
 * Requests succeed asynchronously and the transaction completes after its requests, like the real thing.
 * Values are kept by reference (real IDB structured-clones them).
 */
function fakeIndexedDB() {
  const dbs = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();
  const log: string[] = [];
  const later = (fn: () => void) => setTimeout(fn, 0);

  function makeRequest<T>(run: () => T) {
    const req = { result: undefined as T | undefined, error: null, onsuccess: null as null | (() => void), onerror: null };
    later(() => {
      req.result = run();
      req.onsuccess?.();
    });
    return req;
  }

  const factory = {
    open(name: string, version: number) {
      log.push(`open ${name} v${version}`);
      const req = {
        result: undefined as unknown,
        error: null,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
        onblocked: null,
      };
      later(() => {
        let entry = dbs.get(name);
        const upgrade = !entry || entry.version < version;
        if (!entry) dbs.set(name, (entry = { version, stores: new Map() }));
        const stores = entry.stores;
        const db = {
          objectStoreNames: { contains: (s: string) => stores.has(s) },
          createObjectStore: (s: string) => {
            log.push(`create ${s}`);
            stores.set(s, new Map());
          },
          onversionchange: null,
          close() {},
          transaction(storeName: string, mode: string) {
            log.push(`tx ${storeName} ${mode}`);
            const tx = { oncomplete: null as null | (() => void), onerror: null, onabort: null, error: null };
            let pending = 0;
            const finish = () => later(() => tx.oncomplete?.());
            const store = stores.get(storeName)!;
            const track = <T>(run: () => T) => {
              pending++;
              const r = makeRequest(() => {
                const v = run();
                if (--pending === 0) finish();
                return v;
              });
              return r;
            };
            return Object.assign(tx, {
              objectStore: () => ({
                get: (k: string) => track(() => store.get(k)),
                put: (v: unknown, k: string) => track(() => void store.set(k, v)),
                delete: (k: string) => track(() => void store.delete(k)),
                getAllKeys: () => track(() => [...store.keys()]),
              }),
            });
          },
        };
        req.result = db;
        if (upgrade) {
          entry.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, dbs, log };
}

describe('MemoryKv', () => {
  it('stores, lists and deletes values by reference', async () => {
    const kv = new MemoryKv<{ a: number }>();
    const v = { a: 1 };
    await kv.set('x', v);
    expect(await kv.get('x')).toBe(v);
    expect(await kv.get('missing')).toBeUndefined();
    await kv.set('y', { a: 2 });
    expect((await kv.keys()).sort()).toEqual(['x', 'y']);
    await kv.delete('x');
    expect(await kv.keys()).toEqual(['y']);
  });

  it('keeps a non-extractable CryptoKey usable', async () => {
    const kv = new MemoryKv<CryptoKey>();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kv.set('k', key);
    const back = (await kv.get('k'))!;
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, back, new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('IdbKv (hand-written fake IndexedDB)', () => {
  it('creates the vitals-ai v1 schema and round-trips values per store', async () => {
    const { factory, dbs, log } = fakeIndexedDB();
    const keys = new IdbKv<string>('keys', factory);
    const meta = new IdbKv<number>('meta', factory);
    await keys.set('openai', 'record');
    await meta.set('n', 42);
    expect(await keys.get('openai')).toBe('record');
    expect(await meta.get('n')).toBe(42);
    expect(await keys.get('n')).toBeUndefined();
    expect(await keys.keys()).toEqual(['openai']);
    await keys.delete('openai');
    expect(await keys.keys()).toEqual([]);

    expect([...dbs.get(AI_DB_NAME)!.stores.keys()]).toEqual([...AI_DB_STORES]);
    // One shared connection per factory; one transaction per call.
    expect(log.filter((l) => l.startsWith('open'))).toEqual(['open vitals-ai v1']);
    expect(log.filter((l) => l.startsWith('tx'))).toHaveLength(8); // 8 calls above
    expect(log).toContain('tx keys readwrite');
    expect(log).toContain('tx meta readonly');
  });

  it('rejects clearly when IndexedDB is not available', async () => {
    const g = globalThis as { indexedDB?: IDBFactory };
    const saved = g.indexedDB;
    delete g.indexedDB;
    try {
      await expect(new IdbKv('keys').get('x')).rejects.toThrow('IndexedDB is not available');
    } finally {
      if (saved) g.indexedDB = saved;
    }
  });
});
