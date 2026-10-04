/**
 * `createDocumentStore(backend)`: the app-facing `DocumentStore` (SUITE_SPEC §2.4) over any `PersistenceBackend`.
 *
 * - Bodies are flattened into the spec envelope (`Doc<T> = DocMeta & T`); engines store `{ ...meta, value }`.
 * - Every write needs a valid `WriteToken` (strict: throws `WriteOutsideCommand` in dev/test, rejects + logs in
 *   production). Transactions are serialised, buffered, validated and committed in one `backend.batch` when the engine
 *   offers it.
 * - An in-memory cache of every document is loaded at `ready` (v0.2 volumes are small; large append-only collections
 *   will page later) and kept current by local commits and the backend's remote-change feed, so reads, `watch` and the
 *   synchronous `peek` are cheap.
 * - Schema migration hooks run on read (`COLLECTIONS[col].migrate`); sealed collections pass through the `Encryptor`.
 */
import type { BackendDoc, BackendOp, PersistenceBackend } from './backend';
import { COLLECTIONS, orderedCollections, validateDoc } from './collections';
import { newDeviceId } from './ids';
import { applyMergePatch, isPlainObject, jsonBytes, jsonClone } from './json';
import { defaultStrictMode, isValidWriteToken, rejectWrite, type StrictMode } from './tokens';
import {
  COLLECTION_IDS,
  isCollectionId,
  type CollectionId,
  type CollectionStats,
  type DeviceId,
  type Doc,
  type DocumentStore,
  type Encryptor,
  type Instant,
  type JsonMergePatch,
  type Query,
  type StoreChange,
  type Tx,
  type WriteToken,
} from './types';

export interface DocumentStoreOptions {
  backend: PersistenceBackend | (() => PersistenceBackend | Promise<PersistenceBackend>);
  device?: DeviceId;
  strict?: StrictMode;
  /** Body validation on write: throw (dev/test default), log (production default) or off. */
  validation?: 'throw' | 'log' | 'off';
  /** Encryption hook for sealed collections (`secrets`, `providerKeys`). Without it those collections refuse writes. */
  encryptor?: Encryptor | null;
  /** Migration hooks per collection (override or add to `COLLECTIONS[col].migrate`): run on read for older `_schema`. */
  migrations?: Partial<Record<CollectionId, { version: number; migrate: (body: Record<string, unknown>, fromSchema: number) => Record<string, unknown> }>>;
}

const META = new Set(['_id', '_col', '_schema', '_rev', '_device', '_created', '_updated', '_deleted']);
const SEALED_FIELD = '$sealed';
const RING = 500;

export function bodyOf<T = Record<string, unknown>>(doc: Doc<unknown> | Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!META.has(k)) out[k] = v;
  return out as T;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Pending =
  | { kind: 'put'; col: CollectionId; id: string; body: Record<string, unknown> }
  | { kind: 'delete'; col: CollectionId; id: string };

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const strict = options.strict ?? defaultStrictMode();
  const validation = options.validation ?? (strict === 'strict' ? 'throw' : 'log');
  const encryptor = options.encryptor ?? null;
  const cache = new Map<CollectionId, Map<string, Doc<unknown>>>();
  for (const c of COLLECTION_IDS) cache.set(c, new Map());
  const listeners = new Set<(c: StoreChange) => void>();
  const ring: StoreChange[] = [];
  let seq = 0;
  let backend: PersistenceBackend | null = null;
  let unsubscribeBackend: (() => void) | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const remoteInFlight = new Map<string, Promise<void>>();
  let closed = false;
  let device: DeviceId = options.device ?? '';
  /** Bumped by `erase`, which clears the cache without change events: query watchers rebuild on their next change. */
  let epoch = 0;

  async function toDoc(raw: BackendDoc): Promise<Doc<unknown> | null> {
    if (!isCollectionId(raw._col)) return null;
    const def = COLLECTIONS[raw._col];
    let value = raw.value as Record<string, unknown> | null;
    if (def.sealed && isPlainObject(value) && typeof value[SEALED_FIELD] === 'string') {
      if (!encryptor) return null; // cannot read without the device key
      try {
        const plain = await encryptor.open(unb64(value[SEALED_FIELD] as string), `${raw._col}/${raw._id}`);
        value = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
      } catch (e) {
        // a wrong key or a damaged row: unreadable like a missing key, and the rest of the store still opens
        console.error(`Vitals: could not open ${raw._col}/${raw._id}`, e);
        return null;
      }
    }
    let body = isPlainObject(value) ? value : {};
    let schema = raw._schema;
    const hook = options.migrations?.[raw._col];
    const target = hook?.version ?? def.schemaVersion;
    const migrate = hook?.migrate ?? def.migrate;
    if (migrate && schema < target) {
      try {
        body = migrate(body, schema);
        schema = target;
      } catch (e) {
        // keep the stored body at its old schema rather than failing the whole store
        console.error(`Vitals: could not migrate ${raw._col}/${raw._id} from schema ${schema}`, e);
      }
    }
    const doc = { ...body, _id: raw._id, _col: raw._col, _schema: schema, _rev: raw._rev, _device: raw._device, _created: raw._created, _updated: raw._updated } as Doc<unknown>;
    if (raw._deleted) (doc as { _deleted?: true })._deleted = true;
    return doc;
  }

  function emit(change: Omit<StoreChange, 'seq'>) {
    const c = { ...change, seq: ++seq } as StoreChange;
    ring.push(c);
    if (ring.length > RING) ring.shift();
    for (const l of listeners) {
      try {
        l(c);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function absorb(raw: BackendDoc | null, col: string, id: string, origin: 'local' | 'remote', token?: WriteToken) {
    if (!isCollectionId(col)) return;
    const doc = raw ? await toDoc(raw) : null;
    const m = cache.get(col)!;
    if (doc) m.set(id, doc);
    else m.delete(id);
    emit({ col, id, doc: doc ? jsonClone(doc) : null, origin, writer: token?.kind, changeSetId: token?.changeSetId });
  }

  const ready: Promise<void> = (async () => {
    backend = typeof options.backend === 'function' ? await options.backend() : options.backend;
    if (!device) device = newDeviceId();
    for (const def of orderedCollections()) {
      const rows = await backend.list<unknown>(def.col, { includeDeleted: true });
      const m = cache.get(def.col)!;
      for (const raw of rows) {
        const d = await toDoc(raw);
        if (d) m.set(d._id, d);
      }
    }
    unsubscribeBackend = backend.subscribe((change) => {
      if (change.origin !== 'remote' || closed) return;
      // in order per document: decrypting takes varying time, and a later change must not land before an earlier one
      const key = `${change.col}\u0000${change.id}`;
      const before = remoteInFlight.get(key);
      const run = () => absorb(change.doc, change.col, change.id, 'remote');
      const p = (before ? before.then(run) : run()).catch((e: unknown) => console.error(e));
      remoteInFlight.set(key, p);
      void p.then(() => {
        if (remoteInFlight.get(key) === p) remoteInFlight.delete(key);
      });
    });
  })();
  ready.catch((e: unknown) => console.error('Vitals document store failed to open', e));

  const checkCol = (col: CollectionId) => {
    if (!isCollectionId(col)) throw new Error(`Unknown collection "${String(col)}"`);
  };

  function validateOrReport(col: CollectionId, id: string, body: unknown) {
    if (validation === 'off') return;
    const errors = validateDoc(col, id, body);
    if (errors.length === 0) return;
    const msg = `Invalid ${col}/${id}: ${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`;
    if (validation === 'throw') throw new Error(msg);
    console.error(msg);
  }

  async function seal(col: CollectionId, id: string, body: Record<string, unknown>): Promise<unknown> {
    if (!COLLECTIONS[col].sealed) return body;
    if (!encryptor) throw new Error(`Collection "${col}" is encrypted at rest and needs the device key (Encryptor) to write.`);
    const sealed = await encryptor.seal(new TextEncoder().encode(JSON.stringify(body)), `${col}/${id}`);
    return { [SEALED_FIELD]: b64(sealed) };
  }

  function matches(q: Query | undefined, d: Doc<unknown>): boolean {
    if (d._deleted && !q?.includeDeleted) return false;
    if (!q?.index || !q.range) return true;
    const key = indexKey(q.index, d);
    if (q.range.lower !== undefined && compare(key, q.range.lower) < 0) return false;
    if (q.range.upper !== undefined && compare(key, q.range.upper) > 0) return false;
    return true;
  }
  function indexKey(index: string, d: Doc<unknown>): unknown {
    const fields = index.split(',').map((f) => f.trim());
    const rec = d as unknown as Record<string, unknown>;
    return fields.length === 1 ? rec[fields[0]!] : fields.map((f) => rec[f]);
  }
  function compare(a: unknown, b: unknown): number {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const c = compare(a[i], b[i]);
        if (c !== 0) return c;
      }
      return a.length - b.length;
    }
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const sa = String(a ?? '');
    const sb = String(b ?? '');
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  /** The query order: index key, then `_id` (unique per collection, so a total order). */
  function orderOf(q: Query | undefined): (a: Doc<unknown>, b: Doc<unknown>) => number {
    const index = q?.index;
    return (a, b) => (index ? compare(indexKey(index, a), indexKey(index, b)) : 0) || compare(a._id, b._id);
  }
  function runQuery<T>(col: CollectionId, q?: Query): Doc<T>[] {
    const all = Array.from(cache.get(col)!.values()).filter((d) => matches(q, d));
    all.sort(orderOf(q));
    if (q?.reverse) all.reverse();
    const out = q?.limit !== undefined ? all.slice(0, q.limit) : all;
    return out.map((d) => jsonClone(d) as Doc<T>);
  }

  /**
   * Incremental query watcher state (D13). Cached documents are never mutated in place (every absorb stores a new
   * object), so reference identity of a cache entry says "unchanged". `members` holds every matching cache entry in
   * query order (before reverse/limit); `clones` keeps the clone last handed out per id, reused while its source entry
   * is the same object. A change re-evaluates only the changed id; an erase (no change events) forces a full rebuild.
   */
  function queryWatcher<T>(col: CollectionId, q: Query, cb: (docs: Doc<T>[]) => void) {
    const order = orderOf(q);
    let members: Doc<unknown>[] = [];
    const byId = new Map<string, Doc<unknown>>();
    const clones = new Map<string, { src: Doc<unknown>; clone: Doc<unknown> }>();
    let last: Array<{ id: string; rev: string }> | null = null;
    let builtEpoch = -1;
    // first index whose element sorts at or after d
    const lowerBound = (d: Doc<unknown>) => {
      let lo = 0;
      let hi = members.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (order(members[mid]!, d) < 0) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const rebuild = () => {
      members = Array.from(cache.get(col)!.values()).filter((d) => matches(q, d));
      members.sort(order);
      byId.clear();
      for (const d of members) byId.set(d._id, d);
      for (const [id, e] of clones) if (byId.get(id) !== e.src) clones.delete(id);
      builtEpoch = epoch;
    };
    const update = (id: string): boolean => {
      const prev = byId.get(id);
      const next = cache.get(col)!.get(id);
      const nextIn = next !== undefined && matches(q, next);
      if (prev === undefined && !nextIn) return false;
      if (prev === next) return false;
      if (prev !== undefined) {
        let i = lowerBound(prev);
        if (members[i] !== prev) i = members.indexOf(prev);
        if (i >= 0) members.splice(i, 1);
        byId.delete(id);
        clones.delete(id);
      }
      if (nextIn) {
        members.splice(lowerBound(next), 0, next);
        byId.set(id, next);
      }
      return true;
    };
    const notify = () => {
      const n = q.limit !== undefined ? Math.max(0, Math.min(q.limit, members.length)) : members.length;
      const window: Doc<unknown>[] = new Array(n);
      for (let i = 0; i < n; i++) window[i] = members[q.reverse ? members.length - 1 - i : i]!;
      if (last && last.length === n && window.every((d, i) => d._id === last![i]!.id && d._rev === last![i]!.rev)) return;
      last = window.map((d) => ({ id: d._id, rev: d._rev }));
      const out = window.map((d) => {
        const e = clones.get(d._id);
        if (e && e.src === d) return e.clone as Doc<T>;
        const clone = jsonClone(d);
        clones.set(d._id, { src: d, clone });
        return clone as Doc<T>;
      });
      cb(out);
    };
    const full = () => {
      rebuild();
      notify();
    };
    return {
      full,
      change(id: string) {
        if (builtEpoch !== epoch) full();
        else if (update(id)) notify();
      },
    };
  }

  async function commit(token: WriteToken, pending: Map<string, Pending>): Promise<void> {
    if (pending.size === 0) return;
    const b = backend!;
    const ops: BackendOp[] = [];
    for (const p of pending.values()) {
      if (p.kind === 'delete') ops.push({ kind: 'delete', col: p.col, id: p.id });
      else ops.push({ kind: 'put', col: p.col, id: p.id, value: await seal(p.col, p.id, p.body), schema: options.migrations?.[p.col]?.version ?? COLLECTIONS[p.col].schemaVersion });
    }
    let written: BackendDoc[];
    if (b.batch) written = await b.batch(ops);
    else {
      written = [];
      for (const op of ops) {
        if (op.kind === 'put') written.push(await b.put(op.col, op.id, op.value, { schema: op.schema }));
        else {
          await b.delete(op.col, op.id);
          const after = await b.get(op.col, op.id);
          if (after) written.push(after);
        }
      }
    }
    for (const raw of written) await absorb(raw, raw._col, raw._id, 'local', token);
  }

  const store: DocumentStore = {
    ready,
    get engine() {
      return backend?.engine ?? 'opening';
    },
    get device() {
      return device;
    },
    async get<T>(col: CollectionId, id: string) {
      checkCol(col);
      await ready;
      const d = cache.get(col)!.get(id);
      return d && !d._deleted ? (jsonClone(d) as Doc<T>) : null;
    },
    async query<T>(col: CollectionId, q?: Query) {
      checkCol(col);
      await ready;
      return runQuery<T>(col, q);
    },
    async list<T>(col: CollectionId, opts: { includeDeleted?: boolean } = {}) {
      return store.query<T>(col, { includeDeleted: opts.includeDeleted });
    },
    watch<T>(col: CollectionId, q: Query | { id: string }, cb: (docs: Doc<T>[]) => void) {
      checkCol(col);
      // Payload: a fresh array per notification; a document whose cache entry did not change is the same clone object
      // as in the previous notification of this watcher, so callers must treat the documents as read-only.
      let active = true;
      let started = false;
      let onChange: (id: string) => void;
      let start: () => void;
      if ('id' in q && typeof q.id === 'string') {
        const id = q.id;
        let lastSrc: Doc<unknown> | undefined;
        let lastSig: string | null = null;
        let lastClone: Doc<T> | null = null;
        let seenEpoch = epoch;
        const run = () => {
          seenEpoch = epoch;
          const d = cache.get(col)!.get(id);
          const live = d && !d._deleted ? d : undefined;
          const sig = live ? `${live._id}@${live._rev}` : '';
          if (lastSig !== null && sig === lastSig) return;
          lastSig = sig;
          if (live && live !== lastSrc) lastClone = jsonClone(live) as Doc<T>;
          lastSrc = live;
          cb(live ? [lastClone!] : []);
        };
        start = run;
        onChange = (changed) => {
          if (changed === id || seenEpoch !== epoch) run();
        };
      } else {
        const w = queryWatcher<T>(col, q as Query, cb);
        start = () => w.full();
        onChange = (changed) => w.change(changed);
      }
      void ready.then(() => {
        if (!active) return;
        started = true;
        start();
      });
      const off = store.subscribe((c) => {
        if (c.col === col && active && started) onChange(c.id);
      });
      return () => {
        active = false;
        off();
      };
    },
    transact<R>(token: WriteToken, fn: (tx: Tx) => Promise<R>): Promise<R> {
      if (!isValidWriteToken(token)) {
        try {
          rejectWrite('DocumentStore.transact without a valid write token', strict);
        } catch (e) {
          if (strict === 'strict') throw e;
          return Promise.reject(e);
        }
      }
      const run = async (): Promise<R> => {
        await ready;
        if (closed) throw new Error('The document store is closed.');
        const pending = new Map<string, Pending>();
        const k = (col: string, id: string) => `${col}\u0000${id}`;
        const current = (col: CollectionId, id: string): Doc<unknown> | null => {
          const p = pending.get(k(col, id));
          if (p) {
            if (p.kind === 'delete') {
              const prev = cache.get(col)!.get(id);
              return prev ? ({ ...prev, _deleted: true } as Doc<unknown>) : null;
            }
            const prev = cache.get(col)!.get(id);
            const meta: Record<string, unknown> = {};
            if (prev) for (const f of META) if (f !== '_deleted' && f in prev) meta[f] = (prev as unknown as Record<string, unknown>)[f];
            return { ...meta, ...p.body, _id: id, _col: col } as Doc<unknown>;
          }
          return cache.get(col)!.get(id) ?? null;
        };
        const tx: Tx = {
          async get<T>(col: CollectionId, id: string) {
            checkCol(col);
            const d = current(col, id);
            return d && !d._deleted ? (jsonClone(d) as Doc<T>) : null;
          },
          async put<T>(col: CollectionId, doc: T & { _id: string }) {
            checkCol(col);
            const s = COLLECTIONS[col].strategy;
            const exists = current(col, doc._id);
            if ((s === 'append' || s === 'immutable') && exists && !exists._deleted)
              throw new Error(`${col} is ${s === 'append' ? 'append-only' : 'immutable'}: edits are new entries (append), not puts.`);
            const body = bodyOf(jsonClone(doc) as Record<string, unknown>);
            validateOrReport(col, doc._id, body);
            pending.set(k(col, doc._id), { kind: 'put', col, id: doc._id, body });
            return jsonClone(current(col, doc._id)) as Doc<T>;
          },
          async patch<T>(col: CollectionId, id: string, mergePatch: JsonMergePatch<T>) {
            checkCol(col);
            const s = COLLECTIONS[col].strategy;
            const prev = current(col, id);
            if (s === 'append') throw new Error(`${col} is append-only: append a superseding entry instead of patching.`);
            if (s === 'immutable' && prev && Object.keys(mergePatch as object).some((f) => f !== 'status'))
              throw new Error(`${col} is immutable: only "status" may change.`);
            const body = applyMergePatch(prev && !prev._deleted ? bodyOf(prev) : {}, jsonClone(mergePatch));
            validateOrReport(col, id, body);
            pending.set(k(col, id), { kind: 'put', col, id, body });
            return jsonClone(current(col, id)) as Doc<T>;
          },
          async append<T>(col: CollectionId, doc: T & { _id: string }) {
            checkCol(col);
            const exists = current(col, doc._id);
            if (exists) throw new Error(`${col}/${doc._id} already exists (append never overwrites).`);
            const body = bodyOf(jsonClone(doc) as Record<string, unknown>);
            validateOrReport(col, doc._id, body);
            pending.set(k(col, doc._id), { kind: 'put', col, id: doc._id, body });
            return jsonClone(current(col, doc._id)) as Doc<T>;
          },
          async remove(col: CollectionId, id: string) {
            checkCol(col);
            if (COLLECTIONS[col].strategy === 'append') throw new Error(`${col} is append-only: append a retract entry instead.`);
            if (!current(col, id)) return;
            pending.set(k(col, id), { kind: 'delete', col, id });
          },
        };
        const result = await fn(tx);
        await commit(token, pending);
        return result;
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
    async history<T>(col: CollectionId, id: string, limit: number) {
      await ready;
      if (!backend?.history) return [];
      const rows = await backend.history<T>(col, id, limit);
      const out: Array<{ rev: string; at: Instant; device: DeviceId; doc: Doc<T> }> = [];
      for (const r of rows) {
        const d = await toDoc(r as BackendDoc);
        if (d) out.push({ rev: r._rev, at: r._updated, device: r._device, doc: d as Doc<T> });
      }
      return out;
    },
    async estimate() {
      await ready;
      const out: Partial<Record<CollectionId, CollectionStats>> = {};
      for (const [col, m] of cache) {
        if (m.size === 0) continue;
        let bytes = 0;
        for (const d of m.values()) bytes += jsonBytes(d);
        out[col] = { docs: m.size, bytes };
      }
      return out;
    },
    async *dump(cols: readonly CollectionId[]) {
      await ready;
      for (const col of cols) for (const d of cache.get(col)?.values() ?? []) yield jsonClone(d);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changesSince(since: number) {
      return ring.filter((c) => c.seq > since);
    },
    peek<T>(col: CollectionId, id: string) {
      const d = cache.get(col)?.get(id);
      return d && !d._deleted ? (jsonClone(d) as Doc<T>) : null;
    },
    peekAll<T>(col: CollectionId, opts: { includeDeleted?: boolean } = {}) {
      return Array.from(cache.get(col)?.values() ?? [])
        .filter((d) => opts.includeDeleted || !d._deleted)
        .map((d) => jsonClone(d) as Doc<T>);
    },
    async erase() {
      await ready.catch(() => undefined);
      await queue;
      if (backend?.erase) await backend.erase();
      else if (backend?.eraseLocal) await backend.eraseLocal();
      for (const m of cache.values()) m.clear();
      epoch++;
    },
    async close() {
      closed = true;
      unsubscribeBackend?.();
      await queue;
      await backend?.close?.();
    },
  };
  return store;
}
