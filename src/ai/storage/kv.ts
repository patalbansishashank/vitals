/**
 * Tiny key-value port for the AI layer (keys, capability cache, vault metadata).
 *
 * - `MemoryKv` keeps values by reference, which matches what IndexedDB structured clone preserves for the things we
 *   store (a non-extractable `CryptoKey` stays a usable `CryptoKey`). Used in tests and for session-only state.
 * - `IdbKv` is a thin wrapper over raw IndexedDB (no library): database `vitals-ai` v1 with the object stores
 *   `keys`, `capabilities` and `meta` (out-of-line string keys). One transaction per call.
 *
 * Tier H: no DOM. The `IDBFactory` is injected; the default is `globalThis.indexedDB`, resolved lazily so importing
 * this module never touches storage.
 */

export interface KvStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryKv<V> implements KvStore<V> {
  readonly #map = new Map<string, V>();

  async get(key: string): Promise<V | undefined> {
    return this.#map.get(key);
  }

  async set(key: string, value: V): Promise<void> {
    this.#map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#map.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.#map.keys()];
  }
}

export const AI_DB_NAME = 'vitals-ai';
export const AI_DB_VERSION = 1;
export const AI_DB_STORES = ['keys', 'capabilities', 'meta'] as const;
export type AiStoreName = (typeof AI_DB_STORES)[number];

/** Resolves with the request's result, rejects with its error. */
export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when the transaction commits; rejects when it errors or aborts. */
export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** One open connection per factory, shared by every `IdbKv` on it. */
const connections = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

function openAiDb(factory: IDBFactory): Promise<IDBDatabase> {
  const existing = connections.get(factory);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(AI_DB_NAME, AI_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of AI_DB_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema: let it proceed; the next call reopens.
      db.onversionchange = () => {
        db.close();
        connections.delete(factory);
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open the AI database'));
    req.onblocked = () => reject(new Error('The AI database is blocked by another tab'));
  });
  opening.catch(() => connections.delete(factory));
  connections.set(factory, opening);
  return opening;
}

export class IdbKv<V> implements KvStore<V> {
  readonly #store: AiStoreName;
  readonly #factory: IDBFactory | undefined;

  constructor(store: AiStoreName, factory?: IDBFactory) {
    this.#store = store;
    this.#factory = factory;
  }

  #db(): Promise<IDBDatabase> {
    const factory = this.#factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
    return openAiDb(factory);
  }

  async get(key: string): Promise<V | undefined> {
    const db = await this.#db();
    const tx = db.transaction(this.#store, 'readonly');
    return (await idbRequest(tx.objectStore(this.#store).get(key))) as V | undefined;
  }

  async set(key: string, value: V): Promise<void> {
    const db = await this.#db();
    const tx = db.transaction(this.#store, 'readwrite');
    const done = idbDone(tx);
    tx.objectStore(this.#store).put(value, key);
    await done;
  }

  async delete(key: string): Promise<void> {
    const db = await this.#db();
    const tx = db.transaction(this.#store, 'readwrite');
    const done = idbDone(tx);
    tx.objectStore(this.#store).delete(key);
    await done;
  }

  async keys(): Promise<string[]> {
    const db = await this.#db();
    const tx = db.transaction(this.#store, 'readonly');
    const keys = await idbRequest(tx.objectStore(this.#store).getAllKeys());
    return keys.map((k) => String(k));
  }
}
