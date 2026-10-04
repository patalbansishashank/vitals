/**
 * The persistence backend the app runs on while sync is on (I1): an E4 `PersistenceBackend` (engine = the sync
 * engine's name) that routes each collection by its sync policy and keeps a write-through local mirror.
 *
 * - **Synced collections** (`isSynced(col)`; the app passes `COLLECTIONS[col].sync === 'yes'`) are read from and written
 *   to the sync engine. Every write, and every remote change the engine merges, is also written to the local backend
 *   (IndexedDB in the app), so the local database always holds a current copy: the app boots from it without waiting
 *   for the engine, and "Stop syncing" only has to switch back to it.
 * - **Every other collection** (device-local `deviceSettings`, `uiPrefs`, `secrets`, `syncState`, the logs and ledgers,
 *   derived caches, and opt-in collections nobody opted into) lives only in the local backend and never reaches the
 *   engine, so it is never sent to the relay.
 * - **Erase stays local**: the local backend is erased and the engine deletes its own local database (`eraseLocal`).
 *   Nothing is ever deleted on the relay.
 *
 * `batch` is atomic per engine (the engine's part lands in one engine transaction, then the mirror and the local part
 * land in one local transaction); there is no transaction spanning both databases.
 */
import { deepEqual } from '../store/json';
import type { BackendChange, BackendDoc, BackendOp, PersistenceBackend, SyncStore } from './types';

export interface SyncedBackend extends PersistenceBackend {
  readonly synced: SyncStore;
  readonly local: PersistenceBackend;
  isSynced(col: string): boolean;
  /** Resolves when every mirror write queued so far has reached the local backend. */
  settled(): Promise<void>;
  /**
   * Make the local mirror equal the engine for these collections: documents the engine holds are written, documents
   * only the mirror holds are soft-deleted. Used when attaching (remote changes merged before the mirror was listening,
   * a join that replaced this device's data) and before detaching.
   */
  refreshMirror(collections: readonly string[]): Promise<{ written: number; removed: number }>;
  /** Stop mirroring remote changes (the engine and the local backend stay open; their owner closes them). */
  detach(): void;
}

export interface SyncedBackendOptions {
  synced: SyncStore;
  local: PersistenceBackend;
  isSynced(col: string): boolean;
  /** Mirror failures (best effort: the engine holds the data; the next attach refreshes the mirror). */
  onMirrorError?(error: unknown, col: string, id: string): void;
}

const sameDoc = (a: BackendDoc, b: BackendDoc) => Boolean(a._deleted) === Boolean(b._deleted) && a._schema === b._schema && deepEqual(a.value, b.value);

export function createSyncedBackend(options: SyncedBackendOptions): SyncedBackend {
  const { synced, local, isSynced } = options;
  const onMirrorError = options.onMirrorError ?? ((e, col, id) => console.warn(`Vitals sync: could not update the local copy of ${col}/${id}`, e));
  let chain: Promise<void> = Promise.resolve();
  let attached = true;

  const queue = (col: string, id: string, fn: () => Promise<unknown>) => {
    chain = chain.then(fn).then(
      () => undefined,
      (e: unknown) => onMirrorError(e, col, id),
    );
  };

  /** Write one engine document into the mirror. */
  const mirrorDoc = (doc: BackendDoc) =>
    queue(doc._col, doc._id, async () => {
      if (doc._deleted) await local.delete(doc._col, doc._id);
      else await local.put(doc._col, doc._id, doc.value, { schema: doc._schema });
    });

  // remote changes the engine merges also reach the mirror
  const offRemote = synced.subscribe((c: BackendChange) => {
    if (!attached || c.origin !== 'remote' || !c.doc || !isSynced(c.col)) return;
    mirrorDoc(c.doc);
  });

  const listeners = new Set<(c: BackendChange) => void>();
  const offSynced = synced.subscribe((c) => {
    if (isSynced(c.col)) for (const l of listeners) l(c);
  });
  const offLocal = local.subscribe((c) => {
    if (!isSynced(c.col)) for (const l of listeners) l(c);
  });

  const route = (col: string): PersistenceBackend => (isSynced(col) ? synced : local);

  const backend: SyncedBackend = {
    get engine() {
      return synced.engine;
    },
    synced,
    local,
    isSynced,

    get: (col, id) => route(col).get(col, id),
    list: (col, opts) => route(col).list(col, opts),

    async put<T>(col: string, id: string, value: T, opts?: { schema?: number }) {
      const doc = await route(col).put(col, id, value, opts);
      if (isSynced(col)) mirrorDoc(doc as BackendDoc);
      return doc;
    },

    async delete(col, id) {
      if (!isSynced(col)) return local.delete(col, id);
      await synced.delete(col, id);
      const after = await synced.get(col, id);
      if (after) mirrorDoc(after);
    },

    async batch(ops: readonly BackendOp[]) {
      const engineOps = ops.filter((o) => isSynced(o.col));
      const localOps = ops.filter((o) => !isSynced(o.col));
      const fromEngine = engineOps.length ? await runBatch(synced, engineOps) : [];
      const fromLocal = localOps.length ? await runBatch(local, localOps) : [];
      for (const d of fromEngine) mirrorDoc(d);
      // results in the order of the ops (the store's change feed follows it)
      const byKey = new Map([...fromEngine, ...fromLocal].map((d) => [`${d._col}\u0000${d._id}`, d]));
      const out: BackendDoc[] = [];
      for (const o of ops) {
        const d = byKey.get(`${o.col}\u0000${o.id}`);
        if (d && !out.includes(d)) out.push(d);
      }
      return out;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async history<T>(col: string, id: string, limit: number) {
      const b = route(col);
      return b.history ? b.history<T>(col, id, limit) : [];
    },

    settled: () => chain,

    async refreshMirror(collections) {
      await chain;
      let written = 0;
      let removed = 0;
      for (const col of collections) {
        if (!isSynced(col)) continue;
        const theirs = await synced.list(col, { includeDeleted: true });
        const mine = new Map((await local.list(col, { includeDeleted: true })).map((d) => [d._id, d]));
        const ops: BackendOp[] = [];
        for (const d of theirs) {
          const m = mine.get(d._id);
          mine.delete(d._id);
          if (m && sameDoc(m, d)) continue;
          if (d._deleted) {
            if (m && !m._deleted) {
              ops.push({ kind: 'delete', col, id: d._id });
              removed++;
            }
            continue;
          }
          ops.push({ kind: 'put', col, id: d._id, value: d.value, schema: d._schema });
          written++;
        }
        for (const m of mine.values()) {
          if (m._deleted) continue;
          ops.push({ kind: 'delete', col, id: m._id });
          removed++;
        }
        if (ops.length) await runBatch(local, ops);
      }
      return { written, removed };
    },

    detach() {
      attached = false;
      offRemote();
    },

    /** Erase this device: the local database and the engine's local database. Never the relay. */
    async erase() {
      backend.detach();
      await chain;
      if (local.erase) await local.erase();
      else await local.eraseLocal?.();
      await synced.eraseLocal();
    },
    async eraseLocal() {
      await backend.erase!();
    },

    async close() {
      backend.detach();
      offSynced();
      offLocal();
      listeners.clear();
      await chain;
    },
  };
  return backend;
}

async function runBatch(b: PersistenceBackend, ops: readonly BackendOp[]): Promise<BackendDoc[]> {
  if (b.batch) return b.batch(ops);
  const out: BackendDoc[] = [];
  for (const op of ops) {
    if (op.kind === 'put') out.push(await b.put(op.col, op.id, op.value, { schema: op.schema }));
    else {
      await b.delete(op.col, op.id);
      const after = await b.get(op.col, op.id);
      if (after) out.push(after);
    }
  }
  return out;
}
