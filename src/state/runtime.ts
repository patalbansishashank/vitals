/**
 * The app's document-store runtime: the singleton `DocumentStore`, boot (migration from `vitals.*` localStorage, or
 * reconciliation with the boot cache), the remote-change feed into the projections, the op writer shared with the
 * dispatcher, and the `PersistenceBackend` seam the sync runtime (`./sync`, I1) plugs the Evolu engine into.
 *
 *   await bootDocuments();                          // browser: scheduled by ./persistence.ts after first paint
 *   await installPersistenceBackend(backend);       // copyStore(current → new) once, then switch engines
 *   await installPersistenceBackend(backend, { copy: transfer, prefer: 'docs' });   // the sync runtime's own transfer
 *
 * While this device is paired but the sync engine is not attached yet (app start, or the engine failed to open),
 * writes to synced collections land in the local database only; they are recorded (`vitals-sync.unsynced`) so the
 * sync runtime carries them into the engine when it attaches.
 */
import {
  COLLECTIONS,
  copyStore,
  createDocumentStore,
  createIdbBackend,
  createMemoryBackend,
  isIndexedDbAvailable,
  jsonClone,
  mintWriteToken,
  newDeviceId,
  revokeWriteToken,
  type CollectionId,
  type DeviceId,
  type Doc,
  type DocumentStore,
  type Instant,
  type PersistenceBackend,
  type Tx,
  type WriteToken,
  type WriteTokenKind,
  isCollectionId,
} from '@/store';
import { bindingsFor, docKey, getBindings, ownsDoc, pickFields, readMirror, setUnscopedSink, type Binding, type DocReader } from './bridge';
import { migrateProfileDocBody } from './internal/profileModel';
import { createScope, runInScope, type DocOpRecord, type ScopeKind } from './scope';

export const DEVICE_KEY = 'vitals.device';
/** Written by older versions after the first migration and never read; no longer written (stays internal so an old one is never exported). */
export const MIGRATED_KEY = 'vitals.migratedToStore';
/** Keys under `vitals.*` that are not user data (never listed, exported or imported). */
/** Device-local keys under `vitals.` that are never exported, imported or synced (`vitals.server.v1` holds the server pairing, SUITE_SPEC §14.2). */
export const INTERNAL_KEYS: ReadonlySet<string> = new Set([DEVICE_KEY, MIGRATED_KEY, 'vitals.__probe', 'vitals.server.v1']);
const MARKER_COL: CollectionId = 'syncState';
const MARKER_ID = 'me';

let store: DocumentStore | null = null;
let feedOff: (() => void) | null = null;
let booted: Promise<BootReport> | null = null;
const switchListeners = new Set<(s: DocumentStore) => void>();

function isTest(): boolean {
  return (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
}

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** This browser profile's DeviceId (minted once). */
export function deviceId(): DeviceId {
  const s = ls();
  const existing = s?.getItem(DEVICE_KEY);
  if (existing && /^[0-9A-HJKMNP-TV-Z]{16}$/.test(existing)) return existing;
  const id = newDeviceId();
  try {
    s?.setItem(DEVICE_KEY, id);
  } catch {
    /* storage blocked: a fresh id per session */
  }
  return id;
}

/** Schema migrations that need state-layer models (the store itself must not import them); passed to every document store. */
export const STATE_MIGRATIONS: NonNullable<Parameters<typeof createDocumentStore>[0]['migrations']> = {
  profile: { version: 2, migrate: (body, from) => (from < 2 ? migrateProfileDocBody(body) : body) },
};

function defaultStore(): DocumentStore {
  const device = deviceId();
  if (isTest() || !isIndexedDbAvailable()) return createDocumentStore({ backend: createMemoryBackend({ device }), device, migrations: STATE_MIGRATIONS });
  const s = createDocumentStore({
    device,
    migrations: STATE_MIGRATIONS,
    backend: async () => {
      const idb = createIdbBackend({ device });
      try {
        await idb.list('syncState');
        return idb;
      } catch (e) {
        // private windows that refuse IndexedDB: the boot cache still holds everything (as in v0.1)
        console.warn('IndexedDB unavailable; documents stay in memory for this session', e);
        return createMemoryBackend({ device });
      }
    },
  });
  if (syncPairedHint()) trackUnsyncedWrites(s);
  return s;
}

export function getDocumentStore(): DocumentStore {
  store ??= defaultStore();
  return store;
}

/** Tests: start from a fresh store (and re-boot on next use). */
export function setDocumentStore(next: DocumentStore | null): void {
  feedOff?.();
  feedOff = null;
  stopTrackingUnsynced();
  store = next;
  booted = null;
}

/* ---------------------------------------------------------------- sync hint and unsynced writes (I1) */

/** Set while this device is paired (outside `vitals.*`: never exported, never synced). */
export const SYNC_PAIRED_KEY = 'vitals-sync.paired';
/** Synced-collection documents written while the sync engine was not attached (`col\0id`, or '*' after overflow). */
export const SYNC_UNSYNCED_KEY = 'vitals-sync.unsynced';
const UNSYNCED_CAP = 5000;
let unsyncedOff: (() => void) | null = null;

export function syncPairedHint(): boolean {
  return ls()?.getItem(SYNC_PAIRED_KEY) === '1';
}
export function setSyncPairedHint(on: boolean): void {
  try {
    if (on) ls()?.setItem(SYNC_PAIRED_KEY, '1');
    else ls()?.removeItem(SYNC_PAIRED_KEY);
  } catch {
    /* storage blocked */
  }
}

function readUnsynced(): string[] {
  try {
    const v: unknown = JSON.parse(ls()?.getItem(SYNC_UNSYNCED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeUnsynced(keys: string[]): void {
  try {
    if (keys.length === 0) ls()?.removeItem(SYNC_UNSYNCED_KEY);
    else ls()?.setItem(SYNC_UNSYNCED_KEY, JSON.stringify(keys.length > UNSYNCED_CAP ? ['*'] : keys));
  } catch {
    /* storage blocked: the in-memory session still carries them over */
  }
}

/** Record local writes of synced collections on `s` (the local store while paired but detached). */
export function trackUnsyncedWrites(s: DocumentStore): void {
  stopTrackingUnsynced();
  unsyncedOff = s.subscribe((c) => {
    if (c.origin !== 'local' || !isCollectionId(c.col) || COLLECTIONS[c.col].sync !== 'yes') return;
    const keys = readUnsynced();
    const k = `${c.col}\u0000${c.id}`;
    if (keys[0] === '*' || keys.includes(k)) return;
    keys.push(k);
    writeUnsynced(keys);
  });
}
export function stopTrackingUnsynced(): void {
  unsyncedOff?.();
  unsyncedOff = null;
}
/** The recorded writes: document keys, or 'all' when too many were recorded to list. */
export function unsyncedWrites(): Array<{ col: CollectionId; id: string }> | 'all' {
  const keys = readUnsynced();
  if (keys[0] === '*') return 'all';
  return keys
    .map((k) => k.split('\u0000') as [string, string])
    .filter((x): x is [CollectionId, string] => isCollectionId(x[0]) && typeof x[1] === 'string')
    .map(([col, id]) => ({ col, id }));
}
/** Forget recorded writes (the given ones, or all). */
export function clearUnsyncedWrites(done?: ReadonlyArray<{ col: string; id: string }> | 'all'): void {
  if (!done || done === 'all') return writeUnsynced([]);
  const gone = new Set(done.map((d) => `${d.col}\u0000${d.id}`));
  const left = readUnsynced().filter((k) => !gone.has(k));
  writeUnsynced(left[0] === '*' ? [] : left);
}

export function onDocumentStoreSwitch(fn: (s: DocumentStore) => void): () => void {
  switchListeners.add(fn);
  return () => switchListeners.delete(fn);
}

/* ---------------------------------------------------------------- op writer */

/** Apply one projection op inside a transaction. */
export async function applyOp(tx: Tx, op: DocOpRecord): Promise<void> {
  if (op.kind === 'append' && op.after) {
    await tx.append(op.col, { ...op.after, _id: op.id });
    return;
  }
  if (op.after === null) {
    if (op.fields) {
      const nulls: Record<string, null> = {};
      for (const f of op.fields) nulls[f] = null;
      await tx.patch(op.col, op.id, nulls);
    } else await tx.remove(op.col, op.id);
    return;
  }
  if (op.fields) {
    const patch: Record<string, unknown> = {};
    for (const f of op.fields) patch[f] = op.after[f] === undefined ? null : op.after[f];
    await tx.patch(op.col, op.id, patch);
    return;
  }
  await tx.put(op.col, { ...op.after, _id: op.id });
}

const tokenKind = (k: ScopeKind | null): WriteTokenKind => (k === 'derive' ? 'derive' : k === 'sync' ? 'sync' : k === null ? 'derive' : 'migration');

/** Write ops outside the dispatcher (migration, derive, system seeds, production fallbacks). */
export async function writeOps(kind: WriteTokenKind, ops: readonly DocOpRecord[], label?: string): Promise<void> {
  if (ops.length === 0) return;
  const token = mintWriteToken(kind, { label });
  try {
    await getDocumentStore().transact(token, async (tx) => {
      for (const op of ops) await applyOp(tx, op);
    });
  } finally {
    revokeWriteToken(token);
  }
}

let unscopedChain: Promise<void> = Promise.resolve();
setUnscopedSink((kind, ops) => {
  const copy = ops.map((o) => jsonClone(o));
  unscopedChain = unscopedChain
    .then(() => writeOps(tokenKind(kind), copy, kind ?? 'unscoped'))
    .catch((e: unknown) => console.error('Vitals: could not save to the document store', e));
});

/** Wait until projection writes made outside commands have reached the store (tests, export). */
export function settleUnscopedWrites(): Promise<void> {
  return unscopedChain;
}

/** Commit with an existing token (the dispatcher's ChangeSet commit). */
export async function commitWithToken(token: WriteToken, ops: readonly DocOpRecord[], extra?: (tx: Tx) => Promise<void>): Promise<void> {
  await getDocumentStore().transact(token, async (tx) => {
    for (const op of ops) await applyOp(tx, op);
    if (extra) await extra(tx);
  });
}

/* ---------------------------------------------------------------- readers */

/** A reader over the store's cache (bodies without metadata). */
export function storeReader(s: DocumentStore = getDocumentStore()): DocReader {
  const strip = (d: Doc<unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = v;
    return out;
  };
  return {
    get: (col, id) => {
      const d = s.peek<unknown>(col, id);
      return d ? strip(d) : null;
    },
    list: (col) => s.peekAll<unknown>(col).map((d) => ({ id: d._id, body: strip(d) })),
  };
}

/* ---------------------------------------------------------------- boot: migration or reconciliation */

export interface BootReport {
  migrated: boolean;
  /** Bindings whose projection was refreshed from newer documents. */
  fromDocs: string[];
  /** Bindings whose documents were rewritten from a newer boot cache. */
  fromCache: string[];
  at: Instant;
}

/** Every store module that registers a binding (dynamic, so boot never pulls them into the first chunk). */
async function loadBindings(): Promise<void> {
  await Promise.all([
    import('./profileStore'),
    import('./scheduleStore'),
    import('./simulationStore'),
    import('./plannerStore'),
    import('./safetyStore'),
    import('./settingsStore'),
  ]);
}

function storedBodies(b: Binding, read: DocReader): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const col of b.owns) for (const { id, body } of read.list(col)) out.set(docKey(col, id), body);
  for (const [col, prefix] of Object.entries(b.ownsPrefix ?? {}) as Array<[CollectionId, string]>)
    for (const { id, body } of read.list(col)) if (id.startsWith(prefix)) out.set(docKey(col, id), body);
  for (const sh of b.shares ?? []) {
    const body = read.get(sh.col, sh.id);
    if (body) out.set(docKey(sh.col, sh.id), pickFields(body, sh.fields));
  }
  return out;
}

function latestUpdate(b: Binding, s: DocumentStore): string | null {
  let max: string | null = null;
  const consider = (d: Doc<unknown> | null) => {
    if (d && (!max || d._updated > max)) max = d._updated;
  };
  for (const col of b.owns) for (const d of s.peekAll<unknown>(col)) consider(d);
  for (const [col, prefix] of Object.entries(b.ownsPrefix ?? {}) as Array<[CollectionId, string]>)
    for (const d of s.peekAll<unknown>(col)) if (d._id.startsWith(prefix)) consider(d);
  for (const sh of b.shares ?? []) consider(s.peek<unknown>(sh.col, sh.id));
  return max;
}

/** Raw v0.1 keys without a binding that map into documents (SUITE_SPEC §2.8). */
async function rawLegacyOps(): Promise<DocOpRecord[]> {
  const ops: DocOpRecord[] = [];
  const ui: Record<string, unknown> = {};
  const results = readMirror('vitals.results');
  if (results) {
    const { sanitizeResultsUi } = await import('@/features/simulator/results/store');
    ui.resultsUi = sanitizeResultsUi(results.state);
  }
  const route = readMirror('vitals.ui.lastRoute');
  if (route && typeof route.state === 'string') ui.lastRoute = route.state;
  if (Object.keys(ui).length) ops.push({ col: 'uiPrefs', id: 'me', before: null, after: ui, fields: Object.keys(ui) });
  return ops;
}

async function migrate(s: DocumentStore, at: Instant): Promise<void> {
  const ops: DocOpRecord[] = [];
  for (const b of getBindings()) {
    for (const w of b.toDocs(b.snapshot())) ops.push({ col: w.col, id: w.id, before: null, after: w.fields ? pickFields(w.body, w.fields) : w.body, fields: w.fields, binding: b.key });
  }
  ops.push(...(await rawLegacyOps()));
  const token = mintWriteToken('migration', { label: 'localStorage → documents' });
  try {
    await s.transact(token, async (tx) => {
      for (const op of ops) await applyOp(tx, op);
      await tx.patch(MARKER_COL, MARKER_ID, { migratedFromLocalStorage: at });
    });
  } finally {
    revokeWriteToken(token);
  }
}

async function reconcile(s: DocumentStore, report: BootReport, prefer: BootOptions['prefer'] = 'auto', writeDefaults = true): Promise<void> {
  const read = storeReader(s);
  for (const b of getBindings()) {
    const stored = storedBodies(b, read);
    b.known.clear();
    for (const [k, body] of stored) {
      const [col, id] = k.split('\u0000') as [CollectionId, string];
      const share = (b.shares ?? []).find((x) => x.col === col);
      b.known.set(k, { body, owned: ownsDoc(b, col, id), fields: share?.fields });
    }
    const desired = b.toDocs(b.snapshot());
    const same =
      desired.length === stored.size &&
      desired.every((w) => {
        const body = stored.get(docKey(w.col, w.id));
        return body !== undefined && JSON.stringify(sortKeys(w.fields ? pickFields(w.body, w.fields) : w.body)) === JSON.stringify(sortKeys(body));
      });
    if (same) continue;
    const docsAt = latestUpdate(b, s);
    const mirrorAt = readMirror(b.key)?.at ?? null;
    const fromDocs = stored.size > 0 ? b.fromDocs(read) : null;
    // after a sync engine switch the documents are the truth wherever they exist (prefer 'docs'); otherwise the newer
    // of the documents and the boot cache wins
    if (fromDocs && (prefer === 'docs' || (docsAt && (!mirrorAt || docsAt > mirrorAt)))) {
      b.apply(fromDocs, 'sync');
      report.fromDocs.push(b.key);
    } else if (writeDefaults) {
      // the boot cache is newer (a write that never reached IndexedDB): bring the documents up to date
      runInScope(createScope('migration', { label: 'catch-up' }), () => b.capture());
      report.fromCache.push(b.key);
    }
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

/** Re-read the projections owning these documents from the store (writes that reached the store without them). */
export function refreshProjections(docs: ReadonlyArray<{ col: string; id: string }>): void {
  const s = getDocumentStore();
  const dirty = new Set<Binding>();
  for (const { col, id } of docs) if (isCollectionId(col)) for (const b of bindingsFor(col, id)) dirty.add(b);
  if (dirty.size === 0) return;
  const read = storeReader(s);
  for (const b of dirty) {
    const next = b.fromDocs(read);
    if (next) b.apply(next, 'sync');
  }
}

/** Remote changes → projections (batched per microtask). */
function attachFeed(s: DocumentStore): void {
  feedOff?.();
  const dirty = new Set<Binding>();
  let scheduled = false;
  feedOff = s.subscribe((c) => {
    if (c.origin !== 'remote') return;
    for (const b of bindingsFor(c.col, c.id)) dirty.add(b);
    if (scheduled || dirty.size === 0) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const read = storeReader(s);
      for (const b of dirty) {
        const next = b.fromDocs(read);
        if (next) b.apply(next, 'sync');
      }
      dirty.clear();
    });
  });
}

export interface BootOptions {
  /**
   * 'docs': documents win over the boot cache wherever they exist (used after a sync engine switch). Unset on a paired
   * device: 'docs' with no catch-up (the boot cache is never written back).
   */
  prefer?: 'auto' | 'docs';
  /**
   * false: never write the in-memory defaults as documents (no first-boot migration, no catch-up). A headless replica
   * (the server's person program) opens empty before the group's documents arrive; written defaults would carry newer
   * field clocks and win over the person's real values on every device (per-field sync).
   */
  writeDefaults?: boolean;
}

export function bootDocuments(options: BootOptions = {}): Promise<BootReport> {
  booted ??= (async () => {
    await loadBindings();
    const s = getDocumentStore();
    await s.ready;
    const at = new Date().toISOString();
    const report: BootReport = { migrated: false, fromDocs: [], fromCache: [], at };
    const marker = s.peek<{ migratedFromLocalStorage?: Instant }>(MARKER_COL, MARKER_ID);
    if (!marker?.migratedFromLocalStorage && options.writeDefaults !== false) {
      await migrate(s, at);
      report.migrated = true;
      const read = storeReader(s);
      for (const b of getBindings()) {
        b.known.clear();
        for (const [k, body] of storedBodies(b, read)) {
          const [col, id] = k.split('\u0000') as [CollectionId, string];
          b.known.set(k, { body, owned: ownsDoc(b, col, id), fields: (b.shares ?? []).find((x) => x.col === col)?.fields });
        }
      }
    } else if (options.prefer === undefined && syncPairedHint()) {
      // paired app start: the documents carry the group's merged state; the boot cache is for first paint only and is
      // never written back (a catch-up would carry fresh field clocks into the engine and beat newer remote edits)
      await reconcile(s, report, 'docs', false);
    } else await reconcile(s, report, options.prefer, options.writeDefaults !== false);
    attachFeed(s);
    return report;
  })();
  return booted;
}

/** Has boot finished (tests). */
export function bootPromise(): Promise<BootReport> | null {
  return booted;
}

export interface InstallOptions {
  /**
   * true (default): E4's `copyStore(current → new)` once (marker in both stores). false: no copy. A function: the
   * caller's own transfer, run with both stores ready before the switch (the sync runtime's push / merge / replace).
   */
  copy?: boolean | ((previous: DocumentStore, next: DocumentStore) => Promise<void>);
  /** Boot reconciliation after the switch (see `BootOptions.prefer`). */
  prefer?: BootOptions['prefer'];
  /** See `BootOptions.writeDefaults`. */
  writeDefaults?: boolean;
}

/**
 * Engine seam: switch the app to another engine. The current documents are copied once (`copyStore`, marker in both
 * stores) unless the caller transfers them itself, the projections are reconciled against the new store, and the
 * remote-change feed moves over. A boot still in progress finishes first.
 */
export async function installPersistenceBackend(backend: PersistenceBackend, options: InstallOptions = {}): Promise<DocumentStore> {
  if (booted) await booted.catch(() => undefined);
  const previous = getDocumentStore();
  const next = createDocumentStore({ backend, device: previous.device || deviceId(), migrations: STATE_MIGRATIONS });
  await next.ready;
  await previous.ready.catch(() => undefined);
  if (typeof options.copy === 'function') await options.copy(previous, next);
  else if (options.copy !== false) await copyStore(previous, next);
  feedOff?.();
  feedOff = null;
  store = next;
  booted = null;
  await bootDocuments({ prefer: options.prefer, ...(options.writeDefaults === false ? { writeDefaults: false } : {}) });
  for (const fn of switchListeners) fn(next);
  return next;
}
