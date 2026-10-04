/**
 * IndexedDB `PersistenceBackend` (the reference engine, SUITE_SPEC §2.1 `IdbDocStore`): one object store `docs` keyed
 * by `col \0 id` with an index on `col`, plus a bounded `revs` store of previous revisions. Promise wrappers are written
 * out by hand (idb-style, no dependency). Works in windows, workers and the service worker.
 */
import { stampDoc, type BackendChange, type BackendDoc, type BackendOp, type PersistenceBackend } from './backend';
import { createHlc, newDeviceId } from './ids';

export const IDB_DATABASE = 'vitals-docs';
const VERSION = 1;
const DOCS = 'docs';
const REVS = 'revs';
const HISTORY_PER_DOC = 10;

interface Row {
  k: string;
  col: string;
  doc: BackendDoc;
}
interface RevRow {
  /** `${k}\0${rev}` */
  rk: string;
  k: string;
  doc: BackendDoc;
}

const keyOf = (col: string, id: string) => `${col}\u0000${id}`;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface IdbBackendOptions {
  name?: string;
  device?: string;
  factory?: IDBFactory;
  now?: () => number;
}

export function isIndexedDbAvailable(factory?: IDBFactory): boolean {
  try {
    return Boolean(factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB);
  } catch {
    return false;
  }
}

export function createIdbBackend(options: IdbBackendOptions = {}): PersistenceBackend {
  const name = options.name ?? IDB_DATABASE;
  const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) throw new Error('IndexedDB is not available here.');
  const device = options.device ?? newDeviceId();
  const clock = options.now ?? (() => Date.now());
  const hlc = createHlc(device);
  const listeners = new Set<(c: BackendChange) => void>();
  let dbp: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(name, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'k' }).createIndex('col', 'col');
        if (!db.objectStoreNames.contains(REVS)) db.createObjectStore(REVS, { keyPath: 'rk' }).createIndex('k', 'k');
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => db.close(); // another tab erases or upgrades: let it
        resolve(db);
      };
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
      r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    return dbp;
  };

  const emit = (docs: BackendDoc[]) => {
    for (const d of docs) for (const l of listeners) l({ col: d._col, id: d._id, doc: d, origin: 'local' });
  };

  async function writeAll(ops: readonly BackendOp[]): Promise<BackendDoc[]> {
    const db = await open();
    const tx = db.transaction([DOCS, REVS], 'readwrite');
    const docs = tx.objectStore(DOCS);
    const revs = tx.objectStore(REVS);
    const finished = done(tx);
    const out: BackendDoc[] = [];
    for (const op of ops) {
      const k = keyOf(op.col, op.id);
      const prev = ((await req(docs.get(k))) as Row | undefined)?.doc;
      if (op.kind === 'delete' && !prev) continue;
      const ms = clock();
      const now = new Date(ms).toISOString();
      const doc =
        op.kind === 'put'
          ? stampDoc(prev, op.col, op.id, op.value, op.schema, hlc(ms), device, now, false)
          : stampDoc(prev, op.col, op.id, prev!.value, prev!._schema, hlc(ms), device, now, true);
      if (prev) {
        revs.put({ rk: `${k}\u0000${prev._rev}`, k, doc: prev } satisfies RevRow);
        const old = (await req(revs.index('k').getAllKeys(k))) as string[];
        old.sort();
        for (const rk of old.slice(0, Math.max(0, old.length - HISTORY_PER_DOC))) revs.delete(rk);
      }
      docs.put({ k, col: op.col, doc } satisfies Row);
      out.push(doc);
    }
    await finished;
    emit(out);
    return out;
  }

  return {
    engine: 'idb',
    async get<T>(col: string, id: string) {
      const db = await open();
      const row = (await req(db.transaction(DOCS, 'readonly').objectStore(DOCS).get(keyOf(col, id)))) as Row | undefined;
      return (row?.doc as BackendDoc<T>) ?? null;
    },
    async list<T>(col: string, opts: { includeDeleted?: boolean } = {}) {
      const db = await open();
      const rows = (await req(db.transaction(DOCS, 'readonly').objectStore(DOCS).index('col').getAll(col))) as Row[];
      return rows.map((r) => r.doc as BackendDoc<T>).filter((d) => opts.includeDeleted || !d._deleted);
    },
    async put<T>(col: string, id: string, value: T, opts: { schema?: number } = {}) {
      const [doc] = await writeAll([{ kind: 'put', col, id, value, schema: opts.schema ?? 1 }]);
      return doc as BackendDoc<T>;
    },
    async delete(col: string, id: string) {
      await writeAll([{ kind: 'delete', col, id }]);
    },
    batch: writeAll,
    async history<T>(col: string, id: string, limit: number) {
      const db = await open();
      const rows = (await req(db.transaction(REVS, 'readonly').objectStore(REVS).index('k').getAll(keyOf(col, id)))) as RevRow[];
      return rows
        .map((r) => r.doc as BackendDoc<T>)
        .sort((a, b) => (a._rev < b._rev ? 1 : -1))
        .slice(0, limit);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async erase() {
      if (dbp) (await dbp.catch(() => null))?.close();
      dbp = null;
      await new Promise<void>((resolve) => {
        const r = factory.deleteDatabase(name);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
        r.onblocked = () => resolve();
      });
    },
    async close() {
      if (dbp) (await dbp.catch(() => null))?.close();
      dbp = null;
    },
  };
}
