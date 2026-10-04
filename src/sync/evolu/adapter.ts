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
import { createAppOwner, createOwnerWebSocketTransport, getOrThrow, NonNegativeInt, OwnerSecret, QuarantineOrigin, QuarantineReason, sqliteTrue, type AppOwner } from '@evolu/common';
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
import { docRowId, unsentRowId, vitalsEvoluSchema, type VitalsEvoluSchema } from './schema';

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
  /** How long `put`/`delete`/`batch` wait for Evolu to report the write stored before they reject. */
  storedTimeoutMs?: number;
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

/** A completed relay exchange does not mean future-dated messages were applied locally. */
export function withClockDriftStatus(
  status: SyncStatus,
  localMessages: number,
  remoteMessages: number,
): SyncStatus {
  if (localMessages + remoteMessages === 0) return status;
  return {
    ...status,
    state: 'error',
    pendingChanges: Math.max(status.pendingChanges, localMessages),
    lastError: {
      code: 'clock_drift',
      message:
        'Check the date and time on your devices, then restart the app. Some changes are waiting because device clocks differ.',
      at: new Date().toISOString(),
    },
  };
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
  /**
   * Documents written here that the relay has not acknowledged (`col/key` → row of the device-local `_unsent` table).
   * Loaded on `open`, so the count survives a reload; cleared when the owner's status is Synced.
   */
  const unsent = new Map<string, ReturnType<typeof unsentRowId>>();
  let received = 0;
  /** Bumped by `reconnect`, so the next transport is a new one instead of the socket waiting out its back-off. */
  let generation = 0;
  let relay: string | null = null;
  const cleanups: Array<() => void> = [];

  const createQuery = createQueryBuilder(vitalsEvoluSchema);
  const allRows = createQuery((db) => db.selectFrom('doc').selectAll());
  const unsentRows = createQuery((db) => db.selectFrom('_unsent').select(['id', 'doc']));
  const drainQuery = createQuery((db) => db.selectFrom('_unsent').select(['id']).limit(1));
  const driftRows = createQuery((db) => db.selectFrom('evolu_message_quarantine')
    .select(['ownerId', 'timestamp', 'origin'])
    .where('reason', '=', QuarantineReason.TimestampDrift)
    .distinct());
  let driftLocal = 0;
  let driftRemote = 0;

  const setStatus = (s: SyncStatus) => {
    current = withClockDriftStatus(s, driftLocal, driftRemote);
    for (const l of statusListeners) l(current);
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

  /** The relay acknowledged everything: forget the unsent rows. */
  const clearUnsent = () => {
    if (unsent.size === 0) return;
    const e = evolu;
    for (const id of unsent.values()) e?.update('_unsent', { id, isDeleted: sqliteTrue });
    unsent.clear();
  };
  const noteUnsent = (col: string, key: string) => {
    const k = rowKey(col, key);
    if (unsent.has(k)) return;
    const id = unsentRowId(col, key);
    unsent.set(k, id);
    need().upsert('_unsent', { id, doc: `${col}/${key}` });
  };

  const connect = (relayUrl: string | null) => {
    unuse?.();
    unuse = null;
    endpoint = undefined;
    relay = relayUrl;
    if (!evolu || !owner || !relayUrl) {
      setStatus({ ...OFF_STATUS, pendingChanges: unsent.size });
      return;
    }
    const url = relaySocketUrl(relayUrl);
    options.net?.assertAllowed(url);
    endpoint = relayHost(relayUrl);
    const base = createOwnerWebSocketTransport({ url, ownerId: owner.id });
    // Evolu shares sockets by transport URL and keeps an unused one for 3 s, so a reconnect needs a URL of its own:
    // `?r<n>&ownerId=…` reaches the same relay (which reads only `ownerId`, the last parameter).
    const transport = generation > 0 ? { ...base, url: base.url.replace('?ownerId=', `?r${generation}&ownerId=`) as typeof base.url } : base;
    unuse = evolu.useOwner(owner, [transport]);
    setStatus({ ...current, state: 'connecting', endpoint, lastError: undefined, pendingChanges: unsent.size });
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

  /** Settles every `whenStored` wait still open (close, erase), so none waits out its timeout. */
  const storing = new Set<(error?: Error) => void>();
  /**
   * A wait for one Evolu mutation: pass `onComplete` to the last upsert of a write, and await `done`. Evolu calls
   * `onComplete` once its DbWorker has committed the batch that holds the upsert (all upserts of one tick are one batch
   * and one SQLite transaction), so a process killed after `done` resolves keeps the write (R20-OUTBOX-09). Evolu never
   * calls it when the database is gone or the batch failed; the wait then rejects after `storedTimeoutMs`.
   */
  const whenStored = () => {
    let onComplete: () => void = () => {};
    const done = new Promise<void>((resolve, reject) => {
      const settle = (error?: Error) => {
        clearTimeout(timer);
        storing.delete(settle);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => settle(Object.assign(new Error('This device did not confirm that the change was saved. Try again.'), { code: 'store_write_timeout' })),
        options.storedTimeoutMs ?? 5_000,
      );
      storing.add(settle);
      onComplete = () => settle();
    });
    done.catch(() => undefined); // a write that threw before it was queued is never awaited
    return { onComplete, done };
  };
  const settleStoring = (why: string) => {
    for (const settle of [...storing]) settle(Object.assign(new Error(why), { code: 'store_closed' }));
  };

  const write = (w: Pending, values: ReturnType<typeof prepare>, now: string, onComplete?: () => void): Row => {
    const { col, key, json, schema, deleted } = w;
    need().upsert('doc', { ...values, isDeleted: deleted ? sqliteTrue : 0 }, onComplete ? { onComplete } : undefined);
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
    noteUnsent(col, key);
    if (endpoint && current.state === 'synced') setStatus({ ...current, state: 'syncing', pendingChanges: unsent.size });
    else setStatus({ ...current, pendingChanges: unsent.size });
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
      unsent.clear();
      driftLocal = 0;
      driftRemote = 0;
      generation = 0;
      absorb((await startedOrFailed(evolu.loadQuery(allRows), platform.deps, options.startTimeoutMs ?? 20_000)) as ReadonlyArray<Row>);
      cleanups.push(evolu.subscribeQuery(allRows)(() => absorb(evolu!.getQueryRows(allRows) as ReadonlyArray<Row>)));
      const updateDrift = (rows: ReadonlyArray<{ origin: number }>) => {
        driftLocal = rows.filter((r) => r.origin === QuarantineOrigin.LocalMutation).length;
        driftRemote = rows.length - driftLocal;
        const base = syncStateToOwnerSyncStatus(platform!.deps.syncState.get(), evolu!.name, owner!.id);
        setStatus(mapStatus(base, current, endpoint, unsent.size));
      };
      updateDrift((await startedOrFailed(evolu.loadQuery(driftRows), platform.deps, options.startTimeoutMs ?? 20_000)) as ReadonlyArray<{ origin: number }>);
      cleanups.push(evolu.subscribeQuery(driftRows)(() => updateDrift(evolu!.getQueryRows(driftRows) as ReadonlyArray<{ origin: number }>)));
      // documents written before the last reload that the relay has not acknowledged (the database is up by now)
      for (const r of (await evolu.loadQuery(unsentRows)) as ReadonlyArray<{ id: ReturnType<typeof unsentRowId>; doc: string | null }>) {
        const slash = r.doc?.indexOf('/') ?? -1;
        if (r.doc && slash > 0) unsent.set(rowKey(r.doc.slice(0, slash), r.doc.slice(slash + 1)), r.id);
      }
      const name = evolu.name;
      const ownerId = owner.id;
      const syncState = platform.deps.syncState;
      cleanups.push(
        syncState.subscribe(() => {
          if (!endpoint) return;
          const next = mapStatus(syncStateToOwnerSyncStatus(syncState.get(), name, ownerId), current, endpoint, unsent.size);
          if (next.state === 'synced' && driftLocal === 0) clearUnsent();
          setStatus(next);
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
      // Evolu applies mutations in its DbWorker after `put` returns; a query sent now is answered after them, so a write
      // made just before a close (or a reload) is on disk. Bounded: a stuck worker must not block the close.
      if (e) await Promise.race([e.loadQuery(drainQuery), new Promise((r) => setTimeout(r, 2_000))]).catch(() => undefined);
      settleStoring('The sync store closed before the change was confirmed as saved.');
      evolu = null;
      endpoint = undefined;
      relay = null;
      unsent.clear();
      driftLocal = 0;
      driftRemote = 0;
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

    /** Resolves once Evolu has stored the write (see `whenStored`); readers and listeners see it at once. */
    async put<T>(col: string, id: string, value: T, opts?: { schema?: number }) {
      const now = new Date().toISOString();
      const w = nextVersion(col, id, undefined, { value, schema: opts?.schema ?? 1 })!;
      const values = prepare(w, now);
      const stored = whenStored();
      const doc = rowToDoc(write(w, values, now, stored.onComplete)) as Doc<T>;
      emit({ col, id, doc, origin: 'local' });
      await stored.done;
      return doc;
    },

    async delete(col: string, id: string) {
      const w = nextVersion(col, id, undefined, null);
      if (!w) return;
      const now = new Date().toISOString();
      const values = prepare(w, now);
      const stored = whenStored();
      const doc = rowToDoc(write(w, values, now, stored.onComplete));
      emit({ col, id, doc, origin: 'local' });
      await stored.done;
    },

    /**
     * Atomic: sizes are checked first, then every upsert is queued in this tick (one Evolu transaction). Resolves once
     * that transaction is stored: one `onComplete` on the last upsert covers the batch.
     */
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
      const stored = writes.length > 0 ? whenStored() : null;
      const docs = writes.map((w, i) => rowToDoc(write(w, prepared[i]!, now, i === writes.length - 1 ? stored?.onComplete : undefined))!);
      for (const d of docs) emit({ col: d._col, id: d._id, doc: d, origin: 'local' });
      await stored?.done;
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

    /**
     * A fresh socket to the relay now. Evolu's own socket retries with a back-off of up to 30 s and listens to no
     * network event, so the app calls this when the network comes back or the person taps "Sync now".
     */
    async reconnect() {
      need();
      if (!relay) return;
      generation += 1;
      connect(relay);
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
      const sent = unsent.size;
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
      settleStoring('The local data was erased before the change was confirmed as saved.');
      if (name && p?.deleteDatabase) await p.deleteDatabase(name);
      await p?.dispose();
      platform = null;
      snapshot.clear();
      unsent.clear();
      driftLocal = 0;
      driftRemote = 0;
      relay = null;
      keys = null;
      owner = null;
      setStatus(OFF_STATUS);
    },
  };
  return store;
}

/** Throws unless `result` is ok; used by platforms that return Evolu `Result`s. */
export const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => getOrThrow(r as never) as T;
