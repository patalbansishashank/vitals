/**
 * Local data: registry, export, import and erase (settings-data.md §6–§7; SUITE_SPEC §2.8).
 *
 * v0.2: user data lives in the document store (`@/store`, IndexedDB in the browser) and every Zustand store is a
 * projection bound to its documents (`./bridge.ts`). The v0.1 `vitals.*` keys are kept as the synchronous boot cache and
 * rollback copy, so this registry keeps working over them:
 *
 *   registerStore('vitals.scenarios', 3, {
 *     label: 'scenarios',
 *     describe: (s) => `${(s as Scenarios).list.length} scenarios`,
 *     validate: (s) => typeof s === 'object' && s !== null && 'list' in s,
 *     merge: (current, incoming) => mergeScenarios(current, incoming),
 *     rehydrate: () => useScenarioStore.persist.rehydrate(),
 *   });
 *   registerDatabase('vitals-projections');   // IndexedDB caches wiped by eraseAll()
 *
 * Export v2 = `{ vitalsVersion: '2', …, stores (v1 section, one entry per key), collections (documents) }`; import
 * accepts v1 files (through the migration mapping: stores → projections → documents) and v2 files (collections that
 * no projection owns are written as documents; owned ones come back through their projection).
 *
 * The engine seam lives here too (re-exported from `./runtime`): `installPersistenceBackend(backend)`. Sync (I1,
 * `./sync`) plugs the Evolu engine in through it; nothing in this file knows whether sync is on. `registerEraseHook`
 * lets sync detach and delete its local database before an erase, so "Erase this device" stays local.
 */
import { COLLECTIONS, exportedCollections, isCollectionId, jsonClone, IDB_DATABASE, type CollectionId, type Doc, type Tx } from '@/store';
import { bindingCollections, forgetKnown, getBinding, getBindings, knownReader, type DocReader } from './bridge';
import { bootDocuments, clearUnsyncedWrites, deviceId, getDocumentStore, INTERNAL_KEYS, setSyncPairedHint, writeOps } from './runtime';
import { createScope, runInScope, withSystemWrite } from './scope';

export type { PersistenceBackend } from '@/store';
export { installPersistenceBackend, bootDocuments, getDocumentStore, type InstallOptions } from './runtime';

export const STORAGE_PREFIX = 'vitals.';
/** Before the 2026-10-01 rename, data lived under `lumen.*` keys and exports carried `lumenVersion`. */
export const LEGACY_PREFIX = 'lumen.';
/** Device-only bookkeeping keys (never exported); erased with everything else. */
const DEVICE_PREFIX = 'vitals-';
const LEGACY_VERSION_FIELD = 'lumenVersion';
/** Export file format ("vitalsVersion"). v2 adds `collections` (documents) next to the v1 `stores` section. */
export const EXPORT_FORMAT_VERSION = '2';
/** Rough per-origin localStorage budget used by the storage meter. */
export const LOCAL_STORAGE_QUOTA = 5_000_000;

export interface StoreRegistration {
  key: string;
  /** Current schema version of the store (the zustand persist `version`). */
  version: number;
  /** Plural noun for UI: "settings", "scenarios", "body". */
  label: string;
  /** One-line summary of a stored state for the import preview / data section ("3 scenarios"). */
  describe?: (state: unknown) => string | null;
  /** Reject damaged state before anything is written. */
  validate?: (state: unknown) => boolean;
  /** Merge-mode import. Without it, merge keeps the current value when the key already exists. */
  merge?: (current: unknown, incoming: unknown) => unknown;
  /** Re-read the store from storage after an import (e.g. `useStore.persist.rehydrate`). */
  rehydrate?: () => void | Promise<void>;
  /**
   * Deprecated (E11's localStorage mirror). What syncs is decided per collection now (`COLLECTIONS[col].sync`). The
   * last route and the results layout are device-local: their primary copies are the `vitals.ui.lastRoute` and
   * `vitals.results` keys (the first migration copied them once into `uiPrefs`, which nothing reads back). Kept so
   * existing registrations compile.
   */
  syncable?: boolean;
}

export interface ExportEntry {
  /** Store schema version, or null for raw keys that are not zustand-persisted. */
  version: number | null;
  state: unknown;
}

export interface DataExport {
  vitalsVersion: string;
  app: 'vitals';
  appVersion: string;
  exportedAt: string;
  stores: Record<string, ExportEntry>;
  /** v2: documents per collection (synced collections plus deviceSettings and uiPrefs; never secrets, keys, logs). */
  collections?: Partial<Record<CollectionId, Array<Doc<unknown>>>>;
  device?: string;
  blobs?: 'omitted' | 'inline';
}

const registry = new Map<string, StoreRegistration>();
const databases = new Set<string>();
const eraseHooks = new Set<() => Promise<void> | void>();

let appVersion = '0.0.0';

/** Called once by the app with the package version (shown in exports and About). */
export function setAppVersion(v: string): void {
  appVersion = v;
}

/** Register a persisted store. Returns an unregister function (tests, HMR). */
export function registerStore(key: string, version: number, options: Omit<StoreRegistration, 'key' | 'version' | 'label'> & { label?: string } = {}): () => void {
  if (!key.startsWith(STORAGE_PREFIX)) throw new Error(`Store key "${key}" must start with "${STORAGE_PREFIX}"`);
  const reg: StoreRegistration = { key, version, label: options.label ?? key.slice(STORAGE_PREFIX.length), ...options };
  registry.set(key, reg);
  return () => {
    if (registry.get(key) === reg) registry.delete(key);
  };
}

/** Register an IndexedDB database that eraseAll() must delete (projection caches). */
export function registerDatabase(name: string): void {
  databases.add(name);
}

/** Run before eraseAll() clears anything (sync detaches and deletes its local database, so the erase stays local). */
export function registerEraseHook(fn: () => Promise<void> | void): () => void {
  eraseHooks.add(fn);
  return () => eraseHooks.delete(fn);
}

export function getRegisteredStores(): StoreRegistration[] {
  return Array.from(registry.values());
}

/** The boot cache (v0.1 `vitals.*` keys in localStorage). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True when the browser actually persists (false in some private modes). */
export function isStorageAvailable(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const probe = `${STORAGE_PREFIX}__probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function keysWithPrefix(s: Storage, prefix: string, includeInternal = false): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(prefix) && (includeInternal || !INTERNAL_KEYS.has(k))) keys.push(k);
  }
  return keys.sort();
}

/** Every `vitals.*` data key currently in localStorage, sorted (internal keys such as the device id excluded). */
export function listStoredKeys(): string[] {
  const s = storage();
  return s ? keysWithPrefix(s, STORAGE_PREFIX) : [];
}

/**
 * One-time rename migration, run when this module loads (before any store hydrates): copies each `lumen.*` key
 * whose `vitals.*` twin is absent. It only copies while no `vitals.*` key exists, so data the user later erases or
 * replaces by an import is never copied back. A `lumen.*` key whose `vitals.*` twin exists (copied now or by an older
 * version) is removed. Returns the keys written.
 */
export function migrateLegacyKeys(): string[] {
  const s = storage();
  if (!s) return [];
  const written: string[] = [];
  try {
    const fresh = keysWithPrefix(s, STORAGE_PREFIX).length === 0;
    for (const old of keysWithPrefix(s, LEGACY_PREFIX)) {
      const key = STORAGE_PREFIX + old.slice(LEGACY_PREFIX.length);
      const value = s.getItem(old);
      if (fresh && value !== null && s.getItem(key) === null) {
        s.setItem(key, value);
        written.push(key);
      }
      if (s.getItem(key) !== null) s.removeItem(old);
    }
  } catch {
    /* storage blocked or full: the old keys are untouched */
  }
  return written;
}

function parseStored(raw: string): ExportEntry {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && 'state' in v && 'version' in v && typeof (v as { version: unknown }).version === 'number') {
      return { version: (v as { version: number }).version, state: (v as { state: unknown }).state };
    }
    return { version: null, state: v };
  } catch {
    return { version: null, state: raw };
  }
}

/** Bytes used by Vitals' localStorage keys (UTF-16: 2 bytes per code unit). */
export function storageUsage(): { bytes: number; keys: number } {
  const s = storage();
  if (!s) return { bytes: 0, keys: 0 };
  let bytes = 0;
  const keys = listStoredKeys();
  for (const k of keys) bytes += (k.length + (s.getItem(k)?.length ?? 0)) * 2;
  return { bytes, keys: keys.length };
}

/** Short summaries of what is stored, from registered `describe` functions. */
export function describeStored(): Array<{ key: string; label: string; summary: string }> {
  const s = storage();
  if (!s) return [];
  return listStoredKeys()
    .map((k) => {
      const reg = registry.get(k);
      if (!reg) return null;
      const raw = s.getItem(k);
      if (raw === null) return null;
      const entry = parseStored(raw);
      const summary = reg.describe ? safe(() => reg.describe!(entry.state)) : reg.label;
      return summary ? { key: k, label: reg.label, summary } : null;
    })
    .filter((x): x is { key: string; label: string; summary: string } => x !== null);
}

/* ---------------------------------------------------------------- export */

/** Documents of every exported collection: the projections' current documents over the store's cache. */
export function exportCollections(): Partial<Record<CollectionId, Array<Doc<unknown>>>> {
  getBindings().forEach((b) => b.flushMirror());
  const s = getDocumentStore();
  const bound = new Set<CollectionId>();
  for (const b of getBindings()) bindingCollections(b).forEach((c) => bound.add(c));
  const read = knownReader();
  const out: Partial<Record<CollectionId, Array<Doc<unknown>>>> = {};
  for (const col of exportedCollections()) {
    const cached = new Map(s.peekAll<unknown>(col).map((d) => [d._id, d]));
    const docs: Array<Doc<unknown>> = [];
    if (bound.has(col)) {
      for (const { id, body } of read.list(col)) {
        const meta = cached.get(id);
        const merged = col === 'uiPrefs' && meta ? { ...stripMeta(meta), ...body } : body;
        docs.push({ ...merged, _id: id, _col: col, _schema: COLLECTIONS[col].schemaVersion, _rev: meta?._rev ?? '', _device: meta?._device ?? deviceId(), _created: meta?._created ?? '', _updated: meta?._updated ?? '' } as Doc<unknown>);
        cached.delete(id);
      }
      if (col !== 'uiPrefs') cached.clear(); // projections are the truth for their own collections
    }
    for (const d of cached.values()) docs.push(jsonClone(d));
    if (docs.length) out[col] = docs;
  }
  return out;
}

function stripMeta(d: Doc<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/** Snapshot every vitals.* key and every exported collection into an export object. */
export function exportAll(now: Date = new Date()): DataExport {
  getBindings().forEach((b) => b.flushMirror());
  const s = storage();
  const stores: Record<string, ExportEntry> = {};
  if (s) {
    for (const k of listStoredKeys()) {
      const raw = s.getItem(k);
      if (raw !== null) stores[k] = parseStored(raw);
    }
  }
  return {
    vitalsVersion: EXPORT_FORMAT_VERSION,
    app: 'vitals',
    appVersion,
    exportedAt: now.toISOString(),
    device: deviceId(),
    blobs: 'omitted',
    stores,
    collections: exportCollections(),
  };
}

export function serializeExport(data: DataExport): string {
  return JSON.stringify(data, null, 2);
}

/** "vitals-2026-09-30.json" (local date). */
export function exportFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `vitals-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/* ---------------------------------------------------------------------------
   Import
   --------------------------------------------------------------------------- */

export interface ImportProblem {
  key: string;
  label: string;
  reason: string;
}

export interface ImportPreviewEntry {
  key: string;
  label: string;
  version: number | null;
  summary: string;
  /** The key already holds data on this device. */
  exists: boolean;
  registered: boolean;
}

export interface ImportPreview {
  ok: true;
  data: DataExport;
  exportedAt: Date | null;
  appVersion: string | null;
  entries: ImportPreviewEntry[];
  /** Entries that cannot be imported; the rest can ("Import the rest?"). */
  damaged: ImportProblem[];
}

export type ImportErrorCode = 'not-json' | 'not-export' | 'newer-version' | 'empty';

export interface ImportFailure {
  ok: false;
  code: ImportErrorCode;
  message: string;
}

const NOT_EXPORT =
  "This file isn't a Vitals export. It's missing the vitalsVersion field. Choose a .json file exported from Settings › Your data.";

/** v2 files without a `stores` entry for a bound key: rebuild the v1 state from the documents. */
function storesFromCollections(collections: Record<string, unknown>): Record<string, ExportEntry> {
  const byCol = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [col, docs] of Object.entries(collections)) {
    if (!isCollectionId(col) || !Array.isArray(docs)) continue;
    const m = new Map<string, Record<string, unknown>>();
    for (const d of docs) {
      if (!d || typeof d !== 'object' || typeof (d as { _id?: unknown })._id !== 'string' || (d as { _deleted?: unknown })._deleted) continue;
      m.set((d as { _id: string })._id, stripMeta(d as Doc<unknown>));
    }
    byCol.set(col, m);
  }
  const reader: DocReader = {
    get: (col, id) => byCol.get(col)?.get(id) ?? null,
    list: (col) => Array.from(byCol.get(col) ?? [], ([id, body]) => ({ id, body })),
  };
  const out: Record<string, ExportEntry> = {};
  for (const b of getBindings()) {
    if (!bindingCollections(b).some((c) => byCol.has(c))) continue;
    const state = b.fromDocs(reader);
    if (state !== null) out[b.key] = { version: b.version, state };
  }
  return out;
}

/** Validate a file before anything is written (settings-data.md §7). */
export function parseImport(input: string | unknown): ImportPreview | ImportFailure {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, code: 'not-json', message: "This file isn't a Vitals export. It isn't readable JSON. Choose a .json file exported from Settings › Your data." };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, code: 'not-export', message: NOT_EXPORT };
  // Files exported before the rename carry `lumenVersion` and `lumen.*` keys; both are read as their Vitals twins.
  const versionField = 'vitalsVersion' in data ? 'vitalsVersion' : LEGACY_VERSION_FIELD in data ? LEGACY_VERSION_FIELD : null;
  if (!versionField) return { ok: false, code: 'not-export', message: NOT_EXPORT };
  const d = data as Partial<DataExport> & Record<string, unknown>;
  const fileVersion = String(d[versionField]);
  const major = Number.parseInt(fileVersion, 10);
  if (!Number.isFinite(major)) return { ok: false, code: 'not-export', message: NOT_EXPORT };
  if (major > Number.parseInt(EXPORT_FORMAT_VERSION, 10)) {
    return { ok: false, code: 'newer-version', message: `This file is from a newer Vitals (${d.appVersion ?? fileVersion}). Update the app, then import again.` };
  }
  const collections = d.collections && typeof d.collections === 'object' ? (d.collections as Record<string, unknown>) : null;
  let stores = d.stores as Record<string, unknown> | undefined;
  // A v2 file without the v1 section (another producer): rebuild the projections' states from the documents.
  if ((!stores || typeof stores !== 'object') && collections) stores = storesFromCollections(collections);
  if (!stores || typeof stores !== 'object')
    return { ok: false, code: 'not-export', message: "This file isn't a complete Vitals export: it has no data section. Choose a .json file exported from Settings › Your data." };

  const s = storage();
  const entries: ImportPreviewEntry[] = [];
  const damaged: ImportProblem[] = [];
  const clean: Record<string, ExportEntry> = {};
  for (const [fileKey, value] of Object.entries(stores)) {
    const key = fileKey.startsWith(LEGACY_PREFIX) ? STORAGE_PREFIX + fileKey.slice(LEGACY_PREFIX.length) : fileKey;
    if (key !== fileKey && key in stores) continue; // the file also has the current key
    if (INTERNAL_KEYS.has(key)) continue;
    const reg = registry.get(key);
    const label = reg?.label ?? key.slice(STORAGE_PREFIX.length);
    if (!key.startsWith(STORAGE_PREFIX)) {
      damaged.push({ key, label: key, reason: 'is not Vitals data' });
      continue;
    }
    if (!value || typeof value !== 'object' || !('state' in value)) {
      damaged.push({ key, label, reason: 'is damaged' });
      continue;
    }
    const entry = value as { version?: unknown; state: unknown };
    const version = typeof entry.version === 'number' ? entry.version : null;
    if (reg && version !== null && version > reg.version) {
      damaged.push({ key, label, reason: 'is from a newer version of Vitals' });
      continue;
    }
    if (reg?.validate && !safe(() => reg.validate!(entry.state))) {
      damaged.push({ key, label, reason: 'is damaged' });
      continue;
    }
    clean[key] = { version, state: entry.state };
    entries.push({
      key,
      label,
      version,
      summary: (reg?.describe && safe(() => reg.describe!(entry.state))) || label,
      exists: s ? s.getItem(key) !== null : false,
      registered: Boolean(reg),
    });
  }
  // Collections no projection owns (intake, plans, logs, …) travel as documents.
  const unbound: Partial<Record<CollectionId, Array<Doc<unknown>>>> = {};
  if (collections) {
    const bound = new Set<string>();
    for (const b of getBindings()) bindingCollections(b).forEach((c) => bound.add(c));
    for (const [col, docs] of Object.entries(collections)) {
      if (!isCollectionId(col) || bound.has(col) || !COLLECTIONS[col].exported || !Array.isArray(docs)) continue;
      const ok = docs.filter((x): x is Doc<unknown> => !!x && typeof x === 'object' && typeof (x as { _id?: unknown })._id === 'string');
      if (ok.length) {
        unbound[col] = ok;
        entries.push({ key: `${STORAGE_PREFIX}${col}`, label: col, version: null, summary: `${ok.length} ${col} document${ok.length === 1 ? '' : 's'}`, exists: getDocumentStore().peekAll(col).length > 0, registered: true });
      }
    }
  }
  if (entries.length === 0) {
    return damaged.length > 0
      ? { ok: false, code: 'empty', message: `Nothing in this file could be read (${damaged.map((p) => `${p.label} ${p.reason}`).join('; ')}).` }
      : { ok: false, code: 'empty', message: 'This Vitals export is empty. There is nothing to import.' };
  }
  const exportedAt = typeof d.exportedAt === 'string' && !Number.isNaN(Date.parse(d.exportedAt)) ? new Date(d.exportedAt) : null;
  return {
    ok: true,
    data: {
      vitalsVersion: fileVersion,
      app: 'vitals',
      appVersion: String(d.appVersion ?? ''),
      exportedAt: d.exportedAt ?? '',
      stores: clean,
      ...(Object.keys(unbound).length ? { collections: unbound } : {}),
    },
    exportedAt,
    appVersion: typeof d.appVersion === 'string' ? d.appVersion : null,
    entries,
    damaged,
  };
}

async function safeAsync(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch {
    /* an erase hook failing must not stop the erase */
  }
}

function safe<T>(fn: () => T): T | false {
  try {
    return fn();
  } catch {
    return false;
  }
}

export type ImportMode = 'replace' | 'merge';

export interface ImportResult {
  written: string[];
  /** Merge mode: keys kept as they were because data already existed and the store has no merge rule. */
  kept: string[];
  skipped: ImportProblem[];
}

export interface ImportOptions {
  /**
   * Runs the projection writes in the caller's write scope (the `data.import` command passes `ctx.write`, so the
   * import is one ChangeSet). Direct calls run as a system write.
   */
  write?: <R>(fn: () => R) => R;
  /** Where documents of collections no projection owns go (the command's buffered transaction). */
  docs?: Pick<Tx, 'put'>;
}

/**
 * Write a validated export. `replace` removes every vitals.* key first; `merge`
 * keeps existing data (using the store's `merge` rule when registered).
 * Registered stores are rehydrated afterwards, and their documents follow.
 */
export async function importAll(input: string | unknown | ImportPreview, mode: ImportMode = 'replace', options: ImportOptions = {}): Promise<ImportResult> {
  const preview = isPreview(input) ? input : parseImport(input);
  if (!preview.ok) throw new Error(preview.message);
  const s = storage();
  if (!s) throw new Error("This browser isn't saving data, so nothing can be imported.");
  const system = createScope('system', { label: 'import' });
  const inScope = options.write ?? (<R>(fn: () => R): R => runInScope(system, fn));
  if (mode === 'replace') for (const k of listStoredKeys()) s.removeItem(k);

  const written: string[] = [];
  const kept: string[] = [];
  for (const [key, entry] of Object.entries(preview.data.stores)) {
    const reg = registry.get(key);
    let state = entry.state;
    const existing = s.getItem(key);
    if (mode === 'merge' && existing !== null) {
      if (!reg?.merge) {
        kept.push(key);
        continue;
      }
      state = reg.merge(parseStored(existing).state, entry.state);
    }
    const version = entry.version ?? (reg ? reg.version : null);
    const raw = version !== null ? JSON.stringify({ state, version }) : typeof state === 'string' ? state : JSON.stringify(state);
    s.setItem(key, raw);
    written.push(key);
  }
  const regs = getRegisteredStores().filter((r) => r.rehydrate && (written.includes(r.key) || mode === 'replace'));
  for (const r of regs) await inScope(() => r.rehydrate?.());
  // the projections changed from the boot cache: their documents follow, in the caller's scope
  inScope(() => {
    for (const r of regs) getBinding(r.key)?.capture();
  });
  // documents of collections no projection owns
  const docs = preview.data.collections ?? {};
  const ops = [];
  for (const [col, list] of Object.entries(docs) as Array<[CollectionId, Array<Doc<unknown>>]>) {
    const existing = new Set(getDocumentStore().peekAll(col).map((d) => d._id));
    for (const d of list) {
      if (mode === 'merge' && existing.has(d._id)) continue;
      ops.push({ col, id: d._id, before: null, after: stripMeta(d) });
    }
    written.push(`${STORAGE_PREFIX}${col}`);
  }
  if (ops.length) {
    if (options.docs) for (const op of ops) await options.docs.put(op.col, { ...op.after, _id: op.id });
    else await writeOps('migration', ops, 'import');
  }
  return { written, kept, skipped: preview.damaged };
}

function isPreview(x: unknown): x is ImportPreview {
  return Boolean(x && typeof x === 'object' && (x as { ok?: unknown }).ok === true && 'entries' in (x as object));
}

/**
 * Erase everything Vitals stored on this device: the document database, all vitals.* localStorage keys (and any
 * `lumen.*` keys left from before the rename) and the registered IndexedDB databases. In-memory stores keep their
 * values until the page reloads — callers should navigate with a full reload.
 */
export async function eraseAll(): Promise<{ keys: number; databases: number }> {
  for (const hook of eraseHooks) await safeAsync(hook);
  const s = storage();
  const keys = listStoredKeys();
  getBindings().forEach((b) => b.flushMirror());
  // `vitals-*` keys are device bookkeeping outside the data prefix (sync pairing hint, unsynced writes, storage-persist record)
  if (s) for (const k of [...keysWithPrefix(s, STORAGE_PREFIX, true), ...keysWithPrefix(s, DEVICE_PREFIX, true), ...keysWithPrefix(s, LEGACY_PREFIX)]) s.removeItem(k);
  let dbs = 0;
  try {
    await getDocumentStore().erase();
    dbs += 1;
  } catch {
    /* already gone */
  }
  for (const b of getBindings()) forgetKnown(b);
  if (typeof indexedDB !== 'undefined') {
    await Promise.all(
      Array.from(databases)
        .filter((name) => name !== IDB_DATABASE)
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              try {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => {
                  dbs += 1;
                  resolve();
                };
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              } catch {
                resolve();
              }
            }),
        ),
    );
  }
  return { keys: keys.length, databases: dbs };
}

// The IA names this cache; register it here so eraseAll() always covers it.
registerDatabase('vitals-projections');
registerDatabase(IDB_DATABASE);
// Sync (I1): the device vault (wrapped secret), the raw-data file index. "Erase this device" stays local: sync detaches
// and deletes its own local database first, and forgets the secret; nothing is deleted on the sync server.
registerDatabase('vitals-sync');
registerDatabase('vitals-blobs');
// The AI layer's database (also registered by Settings › AI; listed here so an erase covers it even if that never loaded).
registerDatabase('vitals-ai');
// The planner worker's checkpoints (each keeps the full request, body inputs included).
registerDatabase('vitals-planner');
registerEraseHook(async () => {
  await (await import('./sync')).eraseSyncLocal();
  setSyncPairedHint(false);
  clearUnsyncedWrites('all');
});

// Every store imports this module, so the rename migration runs before any of them reads storage.
migrateLegacyKeys();

// Browser: open the document store after the first paint, migrate or reconcile, then follow remote changes.
const env = (import.meta as { env?: { MODE?: string } }).env;
if (typeof window !== 'undefined' && env?.MODE !== 'test') {
  setTimeout(() => {
    void bootDocuments()
      // then the living plan's upkeep: prescription rollover, assimilation after logs
      .then(() =>
        import('@/commands').then((c) => {
          c.loadChangeLog(); // undo keeps working across reloads
          void c.pruneLocalLogs();
          c.startLivingAutomation();
        }),
      )
      .catch((e: unknown) => console.error('Vitals: document store boot failed', e));
  }, 0);
}

/** Test helper: run a seeding function as a system write (projection + documents, no command). */
export const seedWrite = withSystemWrite;
