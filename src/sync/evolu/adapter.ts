/**
 * `SyncStore` on Evolu (R7 §2, SUITE_SPEC §2.1): SQLite on OPFS in a worker, per-column last-writer-wins by HLC,
 * end-to-end encryption under keys Evolu derives from the owner secret (SLIP-21), range-based reconciliation with a
 * relay over one WebSocket.
 *
 * The platform (browser workers + SQLite-WASM, or Node in-process workers + better-sqlite3) is injected, so this file
 * stays tier H and the same adapter runs in the app, the Companion and the two-device tests.
 *
 * Reads come from an in-memory snapshot of the `doc` table kept current by one Evolu subscription (phase-1 data is a
 * few hundred rows); writes upsert and update the snapshot at once, so `get` after `put` is consistent.
 *
 * The store is an E4 `PersistenceBackend` (I1): `engine: 'evolu'`, get/list/put/delete/subscribe over
 * `BackendDoc = DocMeta & { value }` with local/remote origins, an atomic `batch` (every upsert of one batch lands in the
 * same Evolu microtask, which Evolu applies as one SQLite transaction), `eraseLocal` and `close`. `_rev` is
 * `<last write instant>|<device>|<content hash>`, so two writes in the same millisecond still get different revisions.
 *
 * Conflicts resolve per field (SUITE_SPEC §2.3 LWW-F, `fieldMerge.ts`): a local write stamps only the fields it changes
 * with this device's HLC; when Evolu's subscription shows a version from elsewhere, the adapter merges it with what this
 * device holds, and writes the merged result as a new version when it is not what the database kept.
 */
import { installPolyfills } from '@evolu/common/polyfills';
import { createAppOwner, createOwnerWebSocketTransport, getOrThrow, NonNegativeInt, OwnerSecret, sqliteTrue, type AppOwner } from '@evolu/common';
import {
  AppName,
  createEvolu,
  createQueryBuilder,
  maxMutationSize,
  syncStateToOwnerSyncStatus,
  type Evolu,
  type EvoluDeps,
  type OwnerSyncStatus,
  type UnuseOwner,
} from '@evolu/common/local-first';
import { deriveVitalsKeys } from '../crypto';
import { relayHost, relaySocketUrl } from '../pairing';
import { OFF_STATUS, type BackendOp, type Doc, type DocChange, type NetPort, type OpenOptions, type SyncStatus, type SyncStore, type VitalsKeys } from '../types';
import { createHlc, decode, encode, flatten, legacyClock, maxClock, merge, sameState, stamp, valueOf, type FieldState, type HlcClock } from './fieldMerge';
import { docRowId, vitalsEvoluSchema, type VitalsEvoluSchema } from './schema';

// Evolu's own compatibility fixes (DisposableStack and friends for Safari, Map/WeakMap upsert): idempotent, installs
// only what the runtime lacks. The Companion bin calls the same function; this is the browser's entry to sync.
installPolyfills();

/** Platform glue: Evolu deps for this runtime and a runner for Evolu tasks. */
export interface EvoluPlatform {
  readonly deps: EvoluDeps;
  /** Runs an Evolu Task with the platform deps and returns its Result. */
  run<T>(task: unknown): Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;
  /** Deletes the local database files of `name` (Evolu's own deleteDatabase is not implemented in 8.14). */
  deleteDatabase?(name: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface EvoluStoreOptions {
  /** Called once per `open` (the platform owns workers and must not outlive the store). */
  platform: () => EvoluPlatform | Promise<EvoluPlatform>;
  net?: NetPort;
  appName?: string;
  /** How long `pull`/`push` wait for a round to finish. */
  roundTimeoutMs?: number;
  /** How long `open` waits for the database (a blocked WASM compile never answers). */
  startTimeoutMs?: number;
  /**
   * Field paths (JSON pointers, e.g. `/state`) per collection whose children merge as fields of their own. Every other
   * nested object merges as one top-level field.
   */
  deepFields?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Evolu leaves queries pending when the database cannot start (for example when the CSP forbids compiling WASM), so
 * the first load races Evolu's error store and a timeout.
 */
function startedOrFailed<T>(load: Promise<T>, deps: EvoluDeps, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fail = (message: string, code: string) => {
      clearTimeout(timer);
      off();
      reject(Object.assign(new Error(message), { code }));
    };
    const timer = setTimeout(
      () => fail("The local database didn't start. Reload the page; if it keeps happening, this browser may be blocking WebAssembly.", 'store_start_timeout'),
      timeoutMs,
    );
    const off = deps.evoluError.subscribe(() => {
      const e = deps.evoluError.get();
      if (e) fail(`The local database could not start (${e.type}).`, 'store_start_failed');
    });
    load.then(
      (v) => {
        clearTimeout(timer);
        off();
        resolve(v);
      },
      (e: unknown) => fail(String(e), 'store_start_failed'),
    );
  });
}

interface Row {
  id: string;
  col: string | null;
  key: string | null;
  json: string | null;
  schema: number | null;
  device: string | null;
  created?: string | null;
  createdAt: string;
  updatedAt: string | null;
  isDeleted: number | null;
}

const rowKey = (col: string, key: string) => `${col}\u0000${key}`;
const markerOf = (r: Pick<Row, 'json' | 'isDeleted'>) => (r.isDeleted === sqliteTrue ? `\u0000deleted` : (r.json ?? ''));
const INFLIGHT_MS = 10_000;

/** FNV-1a 32-bit, base36: a short content tag for `_rev` (not a security hash). */
function contentTag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Last write of the row: Evolu's upsert rewrites `createdAt` on every write and leaves `updatedAt` empty. */
const lastWrite = (r: Row) => (r.updatedAt && r.updatedAt > r.createdAt ? r.updatedAt : r.createdAt);

function rowToDoc(r: Row): Doc | null {
  if (r.col === null || r.key === null || r.json === null) return null;
  let value: unknown;
  try {
    value = valueOf(JSON.parse(r.json));
  } catch {
    return null;
  }
  const updated = lastWrite(r);
  const deleted = r.isDeleted === sqliteTrue;
  return {
    _id: r.key,
    _col: r.col,
    _schema: r.schema ?? 1,
    _rev: `${updated}|${r.device ?? ''}|${contentTag(`${deleted ? 'D' : 'L'}${r.json}`)}`,
    _device: r.device ?? '',
    _created: r.created ?? r.createdAt,
    _updated: updated,
    value,
    ...(deleted ? { _deleted: true as const } : {}),
  };
}

function mapStatus(s: OwnerSyncStatus, prev: SyncStatus, endpoint: string | undefined, pending: number): SyncStatus {
  const now = new Date().toISOString();
  const base = { ...prev, endpoint, pendingChanges: pending };
  switch (s.type) {
    case 'NoRelays':
      return { ...base, state: endpoint ? 'connecting' : 'off' };
    case 'Syncing':
      return { ...base, state: prev.lastSyncedAt ? 'syncing' : 'connecting' };
    case 'Synced':
      return { ...base, state: 'synced', lastSyncedAt: now, pendingChanges: 0, lastError: undefined };
    case 'Offline':
      return { ...base, state: 'offline' };
    case 'Error':
      return { ...base, state: 'error', lastError: { code: s.error.type, message: `The sync server reported ${s.error.type}.`, at: now } };
  }
}

export function createEvoluSyncStore(options: EvoluStoreOptions): SyncStore {
  const listeners = new Set<(c: DocChange) => void>();
  const statusListeners = new Set<(s: SyncStatus) => void>();
  const snapshot = new Map<string, Row>();
  /**
   * Local writes Evolu has not echoed back yet, per key, oldest first. Evolu's query fires after each applied batch,
   * so an echo of an older write can arrive while a newer one is queued: those rows are ours and are not re-emitted
   * (no flicker back to an older value). Entries expire after `INFLIGHT_MS` (a write that lost to a newer remote one
   * is never echoed), and a re-check then takes whatever the database holds.
   */
  const inflight = new Map<string, Array<{ marker: string; at: number }>>();
  /** Last database marker seen per key, so a row that did not change is not merged twice. */
  const dbSeen = new Map<string, string>();
  /** Decoded per-field state of the snapshot rows (by row content). */
  const states = new Map<string, { json: string; deleted: number | null; st: FieldState | null }>();
  let hlc: HlcClock = createHlc('');
  const deepOf = (col: string): ReadonlySet<string> | undefined => {
    const d = options.deepFields?.[col];
    return d && d.length ? new Set(d) : undefined;
  };
  /** Per-field state of a row; a row from before per-field clocks gets its last write time on every field. */
  const stateOf = (k: string, r: Row): FieldState | null => {
    if (r.json === null || r.col === null) return null;
    const c = states.get(k);
    if (c && c.json === r.json && c.deleted === r.isDeleted) return c.st;
    const st = decode(r.json, { clock: legacyClock(lastWrite(r), r.device ?? ''), deleted: r.isDeleted === sqliteTrue }, deepOf(r.col));
    states.set(k, { json: r.json, deleted: r.isDeleted, st });
    return st;
  };
  let recheck: ReturnType<typeof setTimeout> | null = null;
  let platform: EvoluPlatform | null = null;
  let evolu: Evolu<VitalsEvoluSchema> | null = null;
  let owner: AppOwner | null = null;
  let device = '';
  let keys: VitalsKeys | null = null;
  let unuse: UnuseOwner | null = null;
  let endpoint: string | undefined;
  let current: SyncStatus = OFF_STATUS;
  let pending = 0;
  let received = 0;
  const cleanups: Array<() => void> = [];

  const createQuery = createQueryBuilder(vitalsEvoluSchema);
  const allRows = createQuery((db) => db.selectFrom('doc').selectAll());

  const setStatus = (s: SyncStatus) => {
    current = s;
    for (const l of statusListeners) l(s);
  };
  const emit = (c: DocChange) => {
    for (const l of listeners) l(c);
  };
  const need = (): Evolu<VitalsEvoluSchema> => {
    if (!evolu) throw new Error('The sync store is not open.');
    return evolu;
  };

  /**
   * A version of `prev`'s document arrived from the database (another device's write that Evolu kept). Merge it field
   * by field with what this device holds; when the result is not what the database kept, write it as a new version
   * (which then reaches every other device) and show it. Returns false when the arrived version already holds
   * everything, so the caller takes it as is.
   */
  const mergeRemote = (k: string, prev: Row, r: Row): boolean => {
    const mine = stateOf(k, prev);
    const theirs = stateOf(k, r);
    if (!mine || !theirs || r.col === null || r.key === null) return false;
    hlc.observe(maxClock(theirs));
    const merged = merge(mine, theirs);
    if (sameState(merged, theirs)) return false;
    const now = new Date().toISOString();
    const w: Pending = { col: r.col, key: r.key, json: encode(merged), schema: Math.max(prev.schema ?? 1, r.schema ?? 1), deleted: merged.deleted, st: merged };
    let values: ReturnType<typeof prepare>;
    try {
      values = prepare(w, now);
    } catch {
      return false; // too large to send: the version Evolu kept stands
    }
    const row = write(w, values, now);
    if (!sameState(merged, mine)) {
      received += 1;
      emit({ col: r.col, id: r.key, doc: rowToDoc(row), origin: 'remote' });
    }
    return true;
  };

  const absorb = (rows: ReadonlyArray<Row>) => {
    const nowMs = Date.now();
    for (const r of rows) {
      if (r.col === null || r.key === null) continue;
      const k = rowKey(r.col, r.key);
      const prev = snapshot.get(k);
      const marker = markerOf(r);
      const unchangedInDb = dbSeen.get(k) === marker;
      dbSeen.set(k, marker);
      const queue = inflight.get(k);
      if (queue) {
        while (queue.length > 0 && nowMs - queue[0]!.at > INFLIGHT_MS) queue.shift();
        const i = r.device === device ? queue.findIndex((q) => q.marker === marker) : -1;
        if (i >= 0) {
          // our own write came back: settle the row once nothing newer of ours is still on its way
          queue.splice(0, i + 1);
          if (queue.length === 0) {
            inflight.delete(k);
            snapshot.set(k, r);
          }
          continue;
        }
        if (queue.length > 0) {
          // a newer local write is queued: keep showing it, merged with any other version that arrived meanwhile
          if (unchangedInDb || !prev || mergeRemote(k, prev, r)) continue;
        }
        inflight.delete(k);
      }
      if (prev && prev.json === r.json && prev.isDeleted === r.isDeleted && lastWrite(prev) === lastWrite(r)) continue;
      const sameContent = prev !== undefined && prev.json === r.json && prev.isDeleted === r.isDeleted;
      if (prev && !sameContent && mergeRemote(k, prev, r)) continue;
      snapshot.set(k, r);
      if (sameContent) continue; // only the timestamp settled
      received += 1;
      emit({ col: r.col, id: r.key, doc: rowToDoc(r), origin: 'remote' });
    }
    if (recheck) clearTimeout(recheck);
    recheck =
      inflight.size > 0 && evolu
        ? setTimeout(() => {
            recheck = null;
            if (evolu) absorb(evolu.getQueryRows(allRows) as ReadonlyArray<Row>);
          }, INFLIGHT_MS + 50)
        : null;
    (recheck as { unref?: () => void } | null)?.unref?.();
  };
  const stopRecheck = () => {
    if (recheck) clearTimeout(recheck);
    recheck = null;
    inflight.clear();
    dbSeen.clear();
    states.clear();
  };

  const connect = (relayUrl: string | null) => {
    unuse?.();
    unuse = null;
    endpoint = undefined;
    if (!evolu || !owner || !relayUrl) {
      setStatus({ ...OFF_STATUS, pendingChanges: pending });
      return;
    }
    const url = relaySocketUrl(relayUrl);
    options.net?.assertAllowed(url);
    endpoint = relayHost(relayUrl);
    unuse = evolu.useOwner(owner, [createOwnerWebSocketTransport({ url, ownerId: owner.id })]);
    setStatus({ ...current, state: 'connecting', endpoint, lastError: undefined });
  };

  interface Pending {
    col: string;
    key: string;
    json: string;
    schema: number;
    deleted: boolean;
    st: FieldState;
  }

  /**
   * The next version of a document after a local put (`value`) or delete (`value` omitted): only the fields that
   * changed get a new clock. `base` overrides the snapshot (earlier writes of the same batch). Null: nothing to delete.
   */
  const nextVersion = (col: string, key: string, base: Pending | undefined, put: { value: unknown; schema: number } | null): Pending | null => {
    const k = rowKey(col, key);
    const prevRow = base ? undefined : snapshot.get(k);
    const prevSt = base ? base.st : prevRow ? stateOf(k, prevRow) : null;
    const prevDeleted = base ? base.deleted : prevRow?.isDeleted === sqliteTrue;
    if (!put && (!prevSt || prevDeleted)) return null;
    if (prevSt) hlc.observe(maxClock(prevSt));
    const clock = hlc.next();
    const st = put ? stamp(prevSt, flatten(put.value, deepOf(col)), false, clock) : stamp(prevSt, prevSt!.texts, true, clock);
    const schema = put ? put.schema : (base?.schema ?? prevRow?.schema ?? 1);
    return { col, key, json: encode(st), schema, deleted: !put, st };
  };

  /** Builds the Evolu values of one write and checks its size (throws before anything is queued). */
  const prepare = (w: Pending, now: string) => {
    const e = need();
    const prev = snapshot.get(rowKey(w.col, w.key));
    const created = prev ? (prev.created ?? prev.createdAt) : now;
    const values = { id: docRowId(w.col, w.key), col: w.col, key: w.key, json: w.json, schema: NonNegativeInt.orThrow(w.schema), device, created };
    if (e.getMutationSize('doc', values) > maxMutationSize) {
      throw Object.assign(new Error(`Document ${w.col}/${w.key} is larger than a sync message allows (${maxMutationSize} bytes).`), { code: 'doc_too_large' });
    }
    return values;
  };

  const write = (w: Pending, values: ReturnType<typeof prepare>, now: string): Row => {
    const { col, key, json, schema, deleted } = w;
    need().upsert('doc', { ...values, isDeleted: deleted ? sqliteTrue : 0 });
    const k = rowKey(col, key);
    states.set(k, { json, deleted: deleted ? sqliteTrue : 0, st: w.st });
    const row: Row = {
      id: values.id,
      col,
      key,
      json,
      schema,
      device,
      created: values.created,
      createdAt: now,
      updatedAt: now,
      isDeleted: deleted ? sqliteTrue : 0,
    };
    snapshot.set(k, row);
    const queue = inflight.get(k) ?? [];
    queue.push({ marker: markerOf(row), at: Date.now() });
    inflight.set(k, queue);
    pending += 1;
    if (endpoint && current.state === 'synced') setStatus({ ...current, state: 'syncing', pendingChanges: pending });
    else setStatus({ ...current, pendingChanges: pending });
    return row;
  };

  /** Waits for the owner's status to leave Syncing/connecting, or for the timeout. */
  const waitForRound = (timeoutMs: number) =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      let sawSyncing = false;
      const off = store.onStatus((s) => {
        if (s.state === 'syncing' || s.state === 'connecting') sawSyncing = true;
        else if (sawSyncing || s.state === 'error' || s.state === 'offline') finish();
      });
      // A round that finishes before the next status change still resolves via the timeout; a short grace keeps
      // `pull` from returning before Evolu has even started the request.
      setTimeout(() => {
        if (!sawSyncing && current.state === 'synced') finish();
      }, 250);
    });

  const round = async (): Promise<number> => {
    const e = need();
    if (!owner || !endpoint) return 0;
    const before = received;
    e.requestSync(owner.id);
    await waitForRound(options.roundTimeoutMs ?? 15_000);
    return received - before;
  };

  const store: SyncStore = {
    engine: 'evolu',
    // Concurrent edits merge per field, so no edit is lost to a whole-document overwrite; Evolu keeps every column
    // change in evolu_history, but this adapter does not read it back yet (no `history`).
    capabilities: { live: true, history: false, maxRowBytes: maxMutationSize },
    get isOpen() {
      return evolu !== null;
    },
    get keys() {
      return keys;
    },

    async open(o: OpenOptions) {
      if (evolu) await store.close();
      device = o.deviceId;
      hlc = createHlc(device);
      platform = await options.platform();
      owner = createAppOwner(OwnerSecret.orThrow(o.secret as never));
      keys = await deriveVitalsKeys(o.secret, owner.id);
      const result = await platform.run<Evolu<VitalsEvoluSchema>>(
        createEvolu(vitalsEvoluSchema, {
          appName: AppName.orThrow(options.appName ?? 'vitals'),
          appOwner: owner,
          memoryOnly: o.memoryOnly ?? false,
          transports: [],
        }),
      );
      if (!result.ok) throw new Error(`The local database could not start (${String((result.error as { type?: string })?.type ?? result.error)}).`);
      evolu = result.value;
      snapshot.clear();
      inflight.clear();
      dbSeen.clear();
      states.clear();
      absorb((await startedOrFailed(evolu.loadQuery(allRows), platform.deps, options.startTimeoutMs ?? 20_000)) as ReadonlyArray<Row>);
      cleanups.push(evolu.subscribeQuery(allRows)(() => absorb(evolu!.getQueryRows(allRows) as ReadonlyArray<Row>)));
      const name = evolu.name;
      const ownerId = owner.id;
      const syncState = platform.deps.syncState;
      cleanups.push(
        syncState.subscribe(() => {
          if (!endpoint) return;
          setStatus(mapStatus(syncStateToOwnerSyncStatus(syncState.get(), name, ownerId), current, endpoint, pending));
          if (current.state === 'synced') pending = 0;
        }),
      );
      connect(o.relayUrl);
    },

    async close() {
      stopRecheck();
      unuse?.();
      unuse = null;
      for (const c of cleanups.splice(0)) c();
      const e = evolu;
      evolu = null;
      endpoint = undefined;
      if (e) await e[Symbol.asyncDispose]();
      await platform?.dispose();
      platform = null;
      // the derived keys (blob encryption, relay bearer) do not outlive the open store
      keys = null;
      owner = null;
      setStatus(OFF_STATUS);
    },

    async get<T>(col: string, id: string) {
      need();
      const r = snapshot.get(rowKey(col, id));
      return r ? (rowToDoc(r) as Doc<T> | null) : null;
    },

    async list<T>(col: string, opts?: { includeDeleted?: boolean }) {
      need();
      const out: Doc<T>[] = [];
      for (const r of snapshot.values()) {
        if (r.col !== col) continue;
        const d = rowToDoc(r);
        if (d && (opts?.includeDeleted || !d._deleted)) out.push(d as Doc<T>);
      }
      return out.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    },

    async put<T>(col: string, id: string, value: T, opts?: { schema?: number }) {
      const now = new Date().toISOString();
      const w = nextVersion(col, id, undefined, { value, schema: opts?.schema ?? 1 })!;
      const doc = rowToDoc(write(w, prepare(w, now), now)) as Doc<T>;
      emit({ col, id, doc, origin: 'local' });
      return doc;
    },

    async delete(col: string, id: string) {
      const w = nextVersion(col, id, undefined, null);
      if (!w) return;
      const now = new Date().toISOString();
      const doc = rowToDoc(write(w, prepare(w, now), now));
      emit({ col, id, doc, origin: 'local' });
    },

    /** Atomic: sizes are checked first, then every upsert is queued in this tick (one Evolu transaction). */
    async batch(ops: readonly BackendOp[]) {
      const now = new Date().toISOString();
      const writes: Pending[] = [];
      const latest = new Map<string, Pending>();
      for (const op of ops) {
        const k = rowKey(op.col, op.id);
        const w = nextVersion(op.col, op.id, latest.get(k), op.kind === 'put' ? { value: op.value, schema: op.schema } : null);
        if (!w) continue;
        latest.set(k, w);
        writes.push(w);
      }
      const prepared = writes.map((w) => prepare(w, now));
      const docs = writes.map((w, i) => rowToDoc(write(w, prepared[i]!, now))!);
      for (const d of docs) emit({ col: d._col, id: d._id, doc: d, origin: 'local' });
      return docs;
    },

    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    async setRelay(url) {
      need();
      connect(url);
    },

    async pull() {
      const before = new Set<string>();
      const off = store.subscribe((c) => {
        if (c.origin === 'remote') before.add(c.col);
      });
      try {
        return { received: await round(), collections: [...before] };
      } finally {
        off();
      }
    },

    async push() {
      const sent = pending;
      await round();
      return { sent: current.state === 'synced' ? sent : 0 };
    },

    status: () => current,
    onStatus(l) {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },

    async eraseLocal() {
      stopRecheck();
      const name = evolu?.name;
      const p = platform;
      if (evolu) {
        // Evolu 8.14 has no deleteDatabase yet: dispose, then let the platform remove the files.
        unuse?.();
        unuse = null;
        for (const c of cleanups.splice(0)) c();
        await evolu[Symbol.asyncDispose]();
        evolu = null;
      }
      if (name && p?.deleteDatabase) await p.deleteDatabase(name);
      await p?.dispose();
      platform = null;
      snapshot.clear();
      keys = null;
      owner = null;
      setStatus(OFF_STATUS);
    },
  };
  return store;
}

/** Throws unless `result` is ok; used by platforms that return Evolu `Result`s. */
export const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => getOrThrow(r as never) as T;
