/**
 * A small in-memory IndexedDB for tests (jsdom has none): the subset `src/store/idbBackend.ts` uses — open with
 * upgrade, object stores with a keyPath, simple indexes, readonly/readwrite transactions that auto-commit when no
 * request is pending after the microtasks of the last callback, get / put / delete / getAll / getAllKeys, and
 * deleteDatabase. Values are structured-cloned like the real thing.
 */

type Key = string;

interface StoreData {
  keyPath: string;
  rows: Map<Key, unknown>;
  indexes: Map<string, string>;
}

interface DbData {
  version: number;
  stores: Map<string, StoreData>;
}

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((this: FakeRequest<T>) => void) | null = null;
  onerror: ((this: FakeRequest<T>) => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

const field = (v: unknown, path: string): Key => String((v as Record<string, unknown>)[path]);

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  private pending = 0;
  private done = false;
  constructor(
    private readonly db: FakeDatabase,
    private readonly names: readonly string[],
    readonly mode: 'readonly' | 'readwrite',
  ) {
    this.checkDone();
  }
  objectStore(name: string): FakeObjectStore {
    if (!this.names.includes(name)) throw new Error(`Store ${name} is not in this transaction`);
    return new FakeObjectStore(this, this.db.data.stores.get(name)!);
  }
  request<T>(fn: () => T): FakeRequest<T> {
    if (this.done) throw new Error('TransactionInactiveError');
    const r = new FakeRequest<T>();
    this.pending++;
    queueMicrotask(() => {
      try {
        r.result = fn();
        r.onsuccess?.call(r);
      } catch (e) {
        r.error = e as Error;
        r.onerror?.call(r);
      } finally {
        this.pending--;
        this.checkDone();
      }
    });
    return r;
  }
  private checkDone() {
    setTimeout(() => {
      if (this.done || this.pending > 0) return;
      this.done = true;
      this.oncomplete?.();
    }, 0);
  }
}

class FakeIndex {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly store: StoreData,
    private readonly path: string,
  ) {}
  getAll(key: Key) {
    return this.tx.request(() => [...this.store.rows.values()].filter((v) => field(v, this.path) === key).map((v) => structuredClone(v)));
  }
  getAllKeys(key: Key) {
    return this.tx.request(() => [...this.store.rows.entries()].filter(([, v]) => field(v, this.path) === key).map(([k]) => k));
  }
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly store: StoreData,
  ) {}
  createIndex(name: string, keyPath: string) {
    this.store.indexes.set(name, keyPath);
  }
  index(name: string) {
    const path = this.store.indexes.get(name);
    if (!path) throw new Error(`No index ${name}`);
    return new FakeIndex(this.tx, this.store, path);
  }
  get(key: Key) {
    return this.tx.request(() => {
      const v = this.store.rows.get(key);
      return v === undefined ? undefined : structuredClone(v);
    });
  }
  put(value: unknown) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    const copy = structuredClone(value);
    return this.tx.request(() => {
      this.store.rows.set(field(copy, this.store.keyPath), copy);
      return field(copy, this.store.keyPath);
    });
  }
  delete(key: Key) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    return this.tx.request(() => {
      this.store.rows.delete(key);
      return undefined;
    });
  }
}

class FakeDatabase {
  onversionchange: (() => void) | null = null;
  closed = false;
  constructor(readonly data: DbData) {}
  get objectStoreNames() {
    const names = [...this.data.stores.keys()];
    return { contains: (n: string) => names.includes(n), length: names.length };
  }
  createObjectStore(name: string, options: { keyPath: string }) {
    const s: StoreData = { keyPath: options.keyPath, rows: new Map(), indexes: new Map() };
    this.data.stores.set(name, s);
    const upgrade = new FakeTransaction(this, [name], 'readwrite');
    return new FakeObjectStore(upgrade, s);
  }
  transaction(names: string | string[], mode: 'readonly' | 'readwrite' = 'readonly') {
    if (this.closed) throw new Error('InvalidStateError: the database is closed');
    return new FakeTransaction(this, Array.isArray(names) ? names : [names], mode);
  }
  close() {
    this.closed = true;
  }
}

export interface FakeIndexedDb {
  factory: IDBFactory;
  /** Row counts per store (tests). */
  peek(name: string): Record<string, number>;
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const dbs = new Map<string, DbData>();
  const open = new Map<string, FakeDatabase[]>();
  const factory = {
    open(name: string, version = 1) {
      const r = new FakeRequest<FakeDatabase>();
      setTimeout(() => {
        let data = dbs.get(name);
        const fresh = !data || data.version < version;
        if (!data) {
          data = { version, stores: new Map() };
          dbs.set(name, data);
        }
        const db = new FakeDatabase(data);
        open.set(name, [...(open.get(name) ?? []), db]);
        r.result = db;
        if (fresh) {
          data.version = version;
          r.onupgradeneeded?.();
        }
        r.onsuccess?.call(r);
      }, 0);
      return r;
    },
    deleteDatabase(name: string) {
      const r = new FakeRequest<undefined>();
      setTimeout(() => {
        for (const db of open.get(name) ?? []) if (!db.closed) db.onversionchange?.();
        dbs.delete(name);
        open.delete(name);
        r.onsuccess?.call(r);
      }, 0);
      return r;
    },
  };
  return {
    factory: factory as unknown as IDBFactory,
    peek(name) {
      const out: Record<string, number> = {};
      for (const [k, s] of dbs.get(name)?.stores ?? []) out[k] = s.rows.size;
      return out;
    },
  };
}
