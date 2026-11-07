/**
 * IndexedDB `PersistenceBackend` (the reference engine, SUITE_SPEC §2.1 `IdbDocStore`): one object store `docs` keyed
 * by `col \0 id` with an index on `col`, plus a bounded `revs` store of previous revisions. Promise wrappers are written
 * out by hand (idb-style, no dependency). Works in windows, workers and the service worker.
 */
import { restoreOps, restoredRows, stampDoc, type BackendChange, type BackendDoc, type BackendOp, type PersistenceBackend } from './backend';
import { createHlc, newDeviceId } from './ids';

export const IDB_DATABASE = 'vitals-docs';
// v2 preserves the stores but fences v1 clients that cannot enforce restore epochs.
const VERSION = 2;
const DOCS = 'docs';
const REVS = 'revs';
const HISTORY_PER_DOC = 10;
const LOCAL_SESSION = newDeviceId();
const RESTORE_KEY = 'syncState\u0000restore';
const STALE_MESSAGE = 'Data was replaced in another window. Reload Vitals to continue.';

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
  /** A different window restored this database; its old cache must stop editing until reload. */
  onExternalRestore?: () => void;
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
  let restoreEpoch: string | null | undefined;
  let epochOpening: Promise<void> | null = null;
  let invalidated = false;
  let channel: BroadcastChannel | null = null;
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    channel?.close();
    channel = null;
    try { options.onExternalRestore?.(); } catch { console.error('Vitals: restore notification failed'); }
  };
  const epochOf = (row: Row | undefined): string | null => {
    const value = row?.doc.value as { id?: unknown } | undefined;
    return typeof value?.id === 'string' ? value.id : null;
  };
  const listen = () => {
    if (channel || options.factory || typeof BroadcastChannel === 'undefined') return;
    try { channel = new BroadcastChannel(`vitals-doc-restore:${name}`); } catch { return; }
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      const message = data as { type?: string; epoch?: string; source?: string } | null;
      if (message?.type === 'restore' && message.source !== LOCAL_SESSION && typeof message.epoch === 'string' && restoreEpoch !== undefined && message.epoch !== restoreEpoch) invalidate();
    };
  };
  const pinEpoch = (db: IDBDatabase): Promise<void> => {
    if (restoreEpoch !== undefined) { listen(); return Promise.resolve(); }
    epochOpening ??= (async () => {
      const row = await req(db.transaction(DOCS, 'readonly').objectStore(DOCS).get(RESTORE_KEY)) as Row | undefined;
      restoreEpoch = epochOf(row);
      listen();
    })().finally(() => { epochOpening = null; });
    return epochOpening;
  };

  const open = (): Promise<IDBDatabase> => {
    if (invalidated) return Promise.reject(new Error(STALE_MESSAGE));
    if (dbp) return dbp;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (dbp === pending) dbp = null;
        reject(error);
      };
      const r = factory.open(name, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'k' }).createIndex('col', 'col');
        if (!db.objectStoreNames.contains(REVS)) db.createObjectStore(REVS, { keyPath: 'rk' }).createIndex('k', 'k');
      };
      r.onsuccess = () => {
        const db = r.result;
        // A blocked request may succeed after we have rejected it, or close/erase may have
        // invalidated an in-flight open. Do not leak that late connection.
        if (settled) {
          db.close();
          return;
        }
        if (dbp !== pending) {
          db.close();
          fail(new Error('IndexedDB open was closed'));
          return;
        }
        settled = true;
        db.onversionchange = () => {
          if (dbp === pending) dbp = null;
          invalidate(); // deletion has no restore marker; both epochs may otherwise remain null
          db.close(); // another tab erases or upgrades: let it
        };
        resolve(db);
      };
      r.onerror = () => {
        if (r.error?.name === 'VersionError') invalidate();
        fail(r.error ?? new Error('IndexedDB open failed'));
      };
      r.onblocked = () => fail(new Error('IndexedDB is blocked by another tab'));
    });
    dbp = pending;
    // `factory.open` itself can throw (for example SecurityError) before any
    // request handlers exist. The promise constructor turns that into a rejection.
    void pending.catch(() => {
      if (dbp === pending) dbp = null;
    });
    return pending;
  };

  const emit = (docs: BackendDoc[]) => {
    for (const d of docs) for (const l of listeners) l({ col: d._col, id: d._id, doc: d, origin: 'local' });
  };

  async function writeAll(ops: readonly BackendOp[], collections?: readonly string[]): Promise<BackendDoc[]> {
    const db = await open();
    await pinEpoch(db);
    const expectedEpoch = restoreEpoch;
    const tx = db.transaction([DOCS, REVS], 'readwrite');
    const docs = tx.objectStore(DOCS);
    const revs = tx.objectStore(REVS);
    const finished = done(tx);
    const out: BackendDoc[] = [];
    const previous = new Map<string, BackendDoc[]>();
    // A synchronous request/setup error (for example DataCloneError) does not abort
    // IndexedDB automatically. Explicitly abort so an earlier put cannot commit alone.
    // Observe transaction rejection immediately, including failures while awaiting a request.
    void finished.catch(() => undefined);
    try {
      // Checked under the SAME write transaction as the operations. Notifications
      // are only UI hints: a missed/late event can never let a stale tab write.
      const actualEpoch = epochOf(await req(docs.get(RESTORE_KEY)) as Row | undefined);
      if (invalidated || actualEpoch !== expectedEpoch) {
        invalidate();
        throw new Error(STALE_MESSAGE);
      }
      if (collections) for (const col of collections) {
        const rows = await req(docs.index('col').getAll(col)) as Row[];
        previous.set(col, rows.map(row => row.doc));
      }
      for (const op of collections ? restoreOps(ops, previous) : ops) {
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
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already have aborted after a request error.
      }
      await finished.catch(() => undefined);
      throw error;
    }
    const restored = out.findLast((doc) => doc._col === 'syncState' && doc._id === 'restore' && !doc._deleted);
    if (restored) {
      restoreEpoch = epochOf({ k: RESTORE_KEY, col: 'syncState', doc: restored });
      try { if (restoreEpoch) channel?.postMessage({ type: 'restore', epoch: restoreEpoch, source: LOCAL_SESSION }); } catch { /* the committed epoch remains authoritative */ }
    }
    emit(out);
    return collections ? restoredRows(out, previous) : out;
  }

  return {
    engine: 'idb',
    async assertCurrent() {
      const db = await open();
      await pinEpoch(db);
      const actual = epochOf(await req(db.transaction(DOCS, 'readonly').objectStore(DOCS).get(RESTORE_KEY)) as Row | undefined);
      if (invalidated || actual !== restoreEpoch) { invalidate(); throw new Error(STALE_MESSAGE); }
    },
    async get<T>(col: string, id: string) {
      const db = await open();
      await pinEpoch(db);
      const row = (await req(db.transaction(DOCS, 'readonly').objectStore(DOCS).get(keyOf(col, id)))) as Row | undefined;
      return (row?.doc as BackendDoc<T>) ?? null;
    },
    async list<T>(col: string, opts: { includeDeleted?: boolean } = {}) {
      const db = await open();
      await pinEpoch(db);
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
    restoreSnapshot: (collections, ops) => writeAll(ops, collections),
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
      if (invalidated) throw new Error(STALE_MESSAGE);
      channel?.close();
      channel = null;
      restoreEpoch = undefined;
      invalidated = false;
      const pending = dbp;
      dbp = null;
      if (pending) (await pending.catch(() => null))?.close();
      await new Promise<void>((resolve) => {
        const r = factory.deleteDatabase(name);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
        r.onblocked = () => resolve();
      });
    },
    async close() {
      channel?.close();
      channel = null;
      const pending = dbp;
      dbp = null;
      if (pending) (await pending.catch(() => null))?.close();
    },
  };
}
