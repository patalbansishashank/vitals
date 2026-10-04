/**
 * The app-side sync runtime (I1): pairing, joining, status, triggers, a new key, unpairing and erase, on top of E4's
 * engine seam (`installPersistenceBackend`, `../runtime.ts`).
 *
 * Sync is off until the person pairs (PLAN item 18): the app runs on the IndexedDB backend and the engine is never
 * loaded. When paired, the app runs on a `SyncedBackend` (`@/sync/syncedBackend`): synced collections
 * (`COLLECTIONS[col].sync === 'yes'`) live in the engine with a write-through copy in IndexedDB; device-local
 * collections (sync 'no' and opt-in ones nobody opted into) stay in IndexedDB only and never reach the engine.
 *
 * How data moves when the engine attaches (the `transfer` of `installPersistenceBackend`):
 * - **pair** (first device) — push: every synced document of this device is copied into the new, empty owner.
 * - **join, replace** — the synced data stands; this device's synced documents are not copied (its device-local ones
 *   stay). The IndexedDB copy is made equal to the synced data.
 * - **join, merge** — nothing is dropped: documents only this device has are added; for a document both sides have,
 *   each top-level field keeps the synced value and takes this device's value only where the synced one is missing or
 *   empty (append-only and immutable entries are unions by id); a live document beats a deletion.
 * - **join of an owner with no data yet** — push, whatever the mode (there is nothing to replace this device's data with).
 * - **resume** (app start) — the engine's documents stand; writes made on this device while the engine was not
 *   attached (recorded by `../runtime.ts`) are carried into it first.
 * After the switch the projections follow the documents (`prefer: 'docs'`).
 *
 * Stop syncing switches back to IndexedDB (made equal to the engine first, so this device keeps everything), fetches
 * raw chunks it only had on the server, deletes the engine's local database and forgets the secret. Erase this device
 * does the same without the copy. Neither ever deletes anything on the relay.
 */
import {
  bodyOf,
  COLLECTIONS,
  deepEqual,
  isCollectionId,
  mintWriteToken,
  orderedCollections,
  revokeWriteToken,
  SYNC_OFF,
  type CollectionId,
  type Doc,
  type DocumentStore,
  type PersistenceBackend,
  type SyncStatus,
  type Tx,
} from '@/store';
import { newOwnerSecret, normalizeRelayUrl, pairingCodeOf, parsePairingUri, wordsToSecret } from '@/sync/pairing';
import { createSyncScheduler, type SyncScheduler, type SyncTrigger } from '@/sync/scheduler';
import { createSyncedBackend, type SyncedBackend } from '@/sync/syncedBackend';
import type { BlobBackend, PairingCode, SyncConfig, SyncStore, VitalsKeys } from '@/sync/types';
import type { ChunkStore } from '@/sync/blobs/chunkStore';
import {
  bootDocuments,
  clearUnsyncedWrites,
  deviceId,
  getDocumentStore,
  installPersistenceBackend,
  refreshProjections,
  setSyncPairedHint,
  stopTrackingUnsynced,
  trackUnsyncedWrites,
  unsyncedWrites,
} from '../runtime';
import type { SyncVault } from './vault';

export type AttachMode = 'resume' | 'push' | 'merge' | 'replace';
export type JoinMode = 'merge' | 'replace';

export interface SyncRuntimeDeps {
  vault: SyncVault;
  /** Creates (does not open) the sync engine; the app loads Evolu here, lazily. */
  createEngine(): Promise<SyncStore>;
  /** The backend of the device-local collections and of the synced copy (IndexedDB in the app). */
  localBackend(): PersistenceBackend;
  /** Grants the relay's origin in the network allowlist before anything connects. */
  allowRelay?(relayUrl: string): void;
  /** DOM wiring for triggers (visibility, online). Returns a cleanup. */
  watchEnvironment?(scheduler: SyncScheduler): () => void;
  /** The app's chunk store (raw samples), attached for sealing and upload while paired. */
  blobs?(): Promise<ChunkStore | null>;
  /** The relay's `/blobs` for these keys. */
  remoteBlobs?(relayUrl: string, keys: VitalsKeys): BlobBackend;
  /** Erase this device without an attached engine: delete every local engine database of this app. */
  deleteEngineData?(): Promise<void>;
  memoryOnly?: boolean;
  now?: () => Date;
  /** Joining: how long to wait for the owner's documents to stop arriving (see `settleRemote`). */
  joinSettle?: { quietMs: number; maxMs: number };
}

/** What Settings › Sync and `sync.status` show. */
export interface SyncView {
  status: SyncStatus;
  paired: boolean;
  /** False while paired but paused (relay disconnected). */
  enabled: boolean;
  relayUrl: string | null;
  label: string | null;
  deviceId: string;
}

export interface SyncRuntime {
  status(): SyncStatus;
  config(): SyncConfig | null;
  view(): SyncView;
  /** Status or configuration changed. */
  subscribe(listener: () => void): () => void;
  /** Reads the vault (configuration only; does not attach). */
  load(): Promise<SyncConfig | null>;
  /** App start: attach if this device was paired. A failure shows in the status. */
  resume(): Promise<void>;
  pair(relayUrl: string, label?: string): Promise<PairingCode>;
  join(code: string | { words: string; relayUrl: string }, mode: JoinMode): Promise<void>;
  pairingCode(): Promise<PairingCode | null>;
  configure(change: { relayUrl?: string; label?: string; enabled?: boolean }): Promise<SyncConfig>;
  /** One round now (pull, push, blob uploads). */
  syncNow(): Promise<SyncStatus>;
  /** A new key: this device moves its data to a new owner and shows the new code; other devices join again. */
  rotate(): Promise<PairingCode>;
  unpair(): Promise<void>;
  /** Erase this device: detach and delete the engine's local database and the vault. Never the relay. */
  eraseLocal(): Promise<void>;
  /** "This device has …" for the merge/replace question, or null when it holds no user data. */
  describeLocalData(): string | null;
  /** The engine while attached (tests). */
  readonly engine: SyncStore | null;
  readonly backend: SyncedBackend | null;
}

export class SyncError extends Error {
  constructor(
    readonly code: 'not_paired' | 'already_paired' | 'invalid_code' | 'invalid_relay' | 'engine_failed' | 'not_supported',
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Collections that sync (the rest never reach the engine). */
export function isSyncedCollection(col: string): boolean {
  return isCollectionId(col) && COLLECTIONS[col].sync === 'yes';
}
const SYNCED: CollectionId[] = orderedCollections()
  .filter((c) => c.sync === 'yes')
  .map((c) => c.col);

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function platformName(): string {
  const nav = (globalThis as { navigator?: { userAgentData?: { platform?: string }; platform?: string } }).navigator;
  return nav?.userAgentData?.platform || nav?.platform || 'web';
}

/** Run `fn` with a sync write token (transfers are sync writes, not commands). */
async function syncWrite<R>(s: DocumentStore, label: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
  const token = mintWriteToken('sync', { label });
  try {
    return await s.transact(token, fn);
  } finally {
    revokeWriteToken(token);
  }
}

const isEmpty = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Field-wise merge of one document: the synced value wins unless it is missing or empty. */
export function mergeBodies(synced: Record<string, unknown>, mine: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...synced };
  for (const [k, v] of Object.entries(mine)) if (isEmpty(out[k]) && !isEmpty(v)) out[k] = v;
  return out;
}

function byId(docs: Array<Doc<unknown>>): Map<string, Doc<unknown>> {
  return new Map(docs.map((d) => [d._id, d]));
}

/** Write one document of `from` into `next` (append-only and immutable: only when absent). Returns false when skipped. */
async function copyDoc(tx: Tx, col: CollectionId, d: Doc<unknown>, tombstones: string[]): Promise<boolean> {
  const strategy = COLLECTIONS[col].strategy;
  const body = bodyOf(d as unknown as Record<string, unknown>);
  if (strategy === 'append' || strategy === 'immutable') {
    if (d._deleted || (await tx.get(col, d._id))) return false;
    await tx.append(col, { ...body, _id: d._id });
    return true;
  }
  if (d._deleted) {
    if (await tx.get(col, d._id)) tombstones.push(d._id);
    return false;
  }
  await tx.put(col, { ...body, _id: d._id });
  return true;
}

/** Copy every synced document of `from` into `to` (pair: the new owner is empty). */
async function pushAll(from: DocumentStore, to: DocumentStore): Promise<number> {
  let copied = 0;
  for (const col of SYNCED) {
    const docs = from.peekAll<unknown>(col, { includeDeleted: true });
    if (docs.length === 0) continue;
    const tombstones: string[] = [];
    await syncWrite(to, 'sync: push this device', async (tx) => {
      for (const d of docs) {
        try {
          if (await copyDoc(tx, col, d, tombstones)) copied++;
        } catch (e) {
          console.warn(`Vitals sync: skipped ${col}/${d._id}`, e);
        }
      }
    });
    if (tombstones.length) await syncWrite(to, 'sync: push deletions', async (tx) => Promise.all(tombstones.map((id) => tx.remove(col, id))));
  }
  return copied;
}

/** Join, merge: see the header. */
async function mergeInto(from: DocumentStore, to: DocumentStore): Promise<number> {
  let changed = 0;
  for (const col of SYNCED) {
    const mine = from.peekAll<unknown>(col, { includeDeleted: true });
    if (mine.length === 0) continue;
    const theirs = byId(to.peekAll<unknown>(col, { includeDeleted: true }));
    const strategy = COLLECTIONS[col].strategy;
    await syncWrite(to, 'sync: merge this device', async (tx) => {
      for (const d of mine) {
        if (d._deleted) continue; // a deletion on this device never removes synced data
        const other = theirs.get(d._id);
        try {
          if (!other || other._deleted) {
            if (strategy === 'append' || strategy === 'immutable') {
              if (!other) {
                await tx.append(col, { ...bodyOf(d as unknown as Record<string, unknown>), _id: d._id });
                changed++;
              }
            } else {
              await tx.put(col, { ...bodyOf(d as unknown as Record<string, unknown>), _id: d._id });
              changed++;
            }
            continue;
          }
          if (strategy === 'append' || strategy === 'immutable') continue; // same id, same entry
          const syncedBody = bodyOf(other as unknown as Record<string, unknown>);
          const merged = mergeBodies(syncedBody, bodyOf(d as unknown as Record<string, unknown>));
          if (!deepEqual(merged, syncedBody)) {
            await tx.put(col, { ...merged, _id: d._id });
            changed++;
          }
        } catch (e) {
          console.warn(`Vitals sync: could not merge ${col}/${d._id}`, e);
        }
      }
    });
  }
  return changed;
}

/** Carry writes made while the engine was detached (recorded by the runtime) from `from` into `to`. */
async function carryUnsynced(from: DocumentStore, to: DocumentStore): Promise<Array<{ col: string; id: string }>> {
  const recorded = unsyncedWrites();
  const wanted = new Map<CollectionId, Set<string> | 'all'>();
  if (recorded === 'all') for (const col of SYNCED) wanted.set(col, 'all');
  else
    for (const { col, id } of recorded) {
      if (!isSyncedCollection(col)) continue;
      const set = wanted.get(col);
      if (set === 'all') continue;
      wanted.set(col, (set ?? new Set<string>()).add(id));
    }
  const carried: Array<{ col: string; id: string }> = [];
  for (const [col, ids] of wanted) {
    const mine = from.peekAll<unknown>(col, { includeDeleted: true }).filter((d) => ids === 'all' || ids.has(d._id));
    const theirs = byId(to.peekAll<unknown>(col, { includeDeleted: true }));
    const tombstones: string[] = [];
    await syncWrite(to, 'sync: carry offline writes', async (tx) => {
      for (const d of mine) {
        const other = theirs.get(d._id);
        if (other && Boolean(other._deleted) === Boolean(d._deleted) && deepEqual(bodyOf(other as unknown as Record<string, unknown>), bodyOf(d as unknown as Record<string, unknown>))) continue;
        try {
          await copyDoc(tx, col, d, tombstones);
          carried.push({ col, id: d._id });
        } catch (e) {
          console.warn(`Vitals sync: could not carry ${col}/${d._id}`, e);
        }
      }
    });
    if (tombstones.length) await syncWrite(to, 'sync: carry deletions', async (tx) => Promise.all(tombstones.map((id) => tx.remove(col, id))));
  }
  return carried;
}

async function hasSyncedDocs(engine: SyncStore): Promise<boolean> {
  return (await countSyncedDocs(engine)) > 0;
}

async function countSyncedDocs(engine: SyncStore): Promise<number> {
  let n = 0;
  for (const col of SYNCED) n += (await engine.list(col, { includeDeleted: true })).length;
  return n;
}

const JOIN_SETTLE = { quietMs: 1000, maxMs: 12_000 };

/**
 * Joining: pull until the owner's documents stop arriving. The engine can report a round as finished before the rows it
 * received have reached its snapshot, so one pull cannot tell "the owner has no data" from "the data is still on its
 * way"; deciding too early made a joining device push its own (default) documents over the synced ones.
 */
async function settleRemote(engine: SyncStore, o: { quietMs: number; maxMs: number }): Promise<void> {
  const end = Date.now() + o.maxMs;
  let last = -1;
  for (;;) {
    await engine.pull();
    if (o.quietMs > 0) await new Promise((r) => setTimeout(r, o.quietMs));
    const n = await countSyncedDocs(engine);
    if ((n > 0 && n === last) || Date.now() >= end) return;
    last = n;
  }
}

export function createSyncRuntime(deps: SyncRuntimeDeps): SyncRuntime {
  const now = deps.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  let config: SyncConfig | null = null;
  let secret: Uint8Array | null = null;
  let engine: SyncStore | null = null;
  let backend: SyncedBackend | null = null;
  let blobs: ChunkStore | null = null;
  let scheduler: SyncScheduler | null = null;
  let engineStatus: SyncStatus = SYNC_OFF;
  let localError: SyncStatus['lastError'] | undefined;
  let current: SyncStatus = SYNC_OFF;
  let currentView: SyncView | null = null;
  let loaded: Promise<SyncConfig | null> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const cleanups: Array<() => void> = [];

  const notify = () => {
    for (const l of listeners) l();
  };
  const recompute = () => {
    const base: SyncStatus = engine ? engineStatus : config ? { ...SYNC_OFF } : SYNC_OFF;
    const blobError = blobs?.lastError ?? undefined;
    const lastError = localError ?? base.lastError ?? blobError;
    current = {
      ...base,
      pendingBlobs: blobs?.paired ? blobs.pending() : 0,
      ...(lastError ? { lastError } : {}),
      ...(localError ? { state: 'error' as const } : {}),
    };
    if (!lastError) delete (current as { lastError?: unknown }).lastError;
    currentView = null;
    notify();
  };
  const fail = (code: string, e: unknown) => {
    localError = { code, message: messageOf(e), at: now().toISOString() };
    recompute();
  };

  /** One operation at a time (pair, join, unpair, rotate, resume, erase). */
  const exclusive = <R>(fn: () => Promise<R>): Promise<R> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const round = async (_reason: SyncTrigger): Promise<boolean> => {
    const e = engine;
    if (!e || !config?.enabled) return false;
    await e.pull();
    await e.push();
    if (blobs?.paired) await blobs.flush();
    recompute();
    return e.status().state === 'synced' && !blobs?.lastError;
  };

  const writeDeviceDoc = async (cfg: SyncConfig) => {
    if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(cfg.deviceId)) return;
    try {
      await syncWrite(getDocumentStore(), 'sync: this device', (tx) =>
        tx.patch('devices', cfg.deviceId, { name: cfg.label ?? 'This device', platform: platformName(), lastSeen: now().toISOString(), roles: ['app'] }),
      );
    } catch (e) {
      console.warn('Vitals sync: could not update the devices list', e);
    }
  };

  /** Open the engine for `cfg` and switch the app onto it, moving data by `mode` (see the header). */
  const attach = async (cfg: SyncConfig, key: Uint8Array, mode: AttachMode): Promise<void> => {
    if (engine) throw new SyncError('already_paired', 'This device already syncs.');
    await bootDocuments();
    const previous = getDocumentStore();
    setSyncPairedHint(true);
    // writes to synced collections from now until the switch are recorded and carried over
    trackUnsyncedWrites(previous);
    if (cfg.enabled) deps.allowRelay?.(cfg.relayUrl);
    const e = await deps.createEngine();
    const offStatus = e.onStatus((s) => {
      engineStatus = s;
      if (s.state === 'synced') localError = undefined;
      recompute();
    });
    try {
      await e.open({ secret: key, relayUrl: cfg.enabled ? cfg.relayUrl : null, deviceId: cfg.deviceId, memoryOnly: deps.memoryOnly });
    } catch (err) {
      offStatus();
      await e.close().catch(() => undefined);
      fail((err as { code?: string })?.code ?? 'store_start_failed', err);
      throw new SyncError('engine_failed', messageOf(err));
    }
    let effective: AttachMode = mode;
    let installed: SyncedBackend;
    try {
      const joining = mode === 'merge' || mode === 'replace';
      if (joining || (mode === 'resume' && !(await hasSyncedDocs(e)))) {
        // joining (or a local engine database that is gone): fetch everything the owner has before deciding
        if (cfg.enabled) await settleRemote(e, deps.joinSettle ?? JOIN_SETTLE);
        if (!(await hasSyncedDocs(e))) effective = 'push';
      }
      const b = createSyncedBackend({ synced: e, local: deps.localBackend(), isSynced: isSyncedCollection });
      const transfer = async (from: DocumentStore, to: DocumentStore) => {
        if (effective === 'push') await pushAll(from, to);
        else if (effective === 'merge') await mergeInto(from, to);
        if (effective !== 'replace') await carryUnsynced(from, to);
        await b.settled();
        await b.refreshMirror(SYNCED);
      };
      await installPersistenceBackend(b, { copy: transfer, prefer: effective === 'push' ? 'auto' : 'docs' });
      // writes that reached the local store during the switch
      const late = effective === 'replace' ? [] : await carryUnsynced(previous, getDocumentStore());
      if (late.length) refreshProjections(late);
      stopTrackingUnsynced();
      clearUnsyncedWrites('all');
      engine = e;
      backend = b;
      installed = b;
      engineStatus = e.status();
      localError = undefined;
      cleanups.push(offStatus);
    } catch (err) {
      offStatus();
      await e.close().catch(() => undefined);
      fail('attach_failed', err);
      throw err;
    }

    // triggers: local writes of synced collections, visibility, network, heartbeat, Sync now
    const s = createSyncScheduler({ round });
    scheduler = s;
    cleanups.push(
      installed.subscribe((c) => {
        if (c.origin === 'local' && isSyncedCollection(c.col)) s.noteWrite();
      }),
    );
    if (deps.watchEnvironment) cleanups.push(deps.watchEnvironment(s));

    // raw chunks: seal and upload while paired; a new owner gets the whole backlog
    if (cfg.enabled) await attachBlobs(cfg, e, mode !== 'resume');

    config = cfg;
    secret = key;
    await writeDeviceDoc(cfg);
    recompute();
    if (cfg.enabled) s.start();
  };

  const attachBlobs = async (cfg: SyncConfig, e: SyncStore, backlog: boolean) => {
    const cs = deps.blobs ? await deps.blobs().catch(() => null) : null;
    if (!cs || !e.keys || !deps.remoteBlobs) return;
    await cs.attachRemote({ seal: e.keys.blob, backend: deps.remoteBlobs(cfg.relayUrl, e.keys) });
    if (backlog) await cs.queueAll();
    blobs = cs;
  };

  /** Switch back to the local backend, keeping everything this device has; delete the engine's local database. */
  const detach = async (options: { keepData: boolean }): Promise<void> => {
    scheduler?.stop();
    scheduler = null;
    for (const c of cleanups.splice(0)) c();
    const e = engine;
    const b = backend;
    const cs = blobs;
    engine = null;
    backend = null;
    blobs = null;
    if (options.keepData && e && b) {
      if (cs) {
        // raw chunks this device only had on the server
        const known = getDocumentStore()
          .peekAll<{ chunkId?: string; local_date?: string }>('bioChunks')
          .map((d) => ({ chunkId: typeof d.chunkId === 'string' ? d.chunkId : d._id, ...(typeof d.local_date === 'string' ? { localDate: d.local_date } : {}) }));
        const r = await cs.restoreLocal(known).catch(() => ({ restored: 0, failed: 0 }));
        if (r.failed) console.warn(`Vitals sync: ${r.failed} raw-data files could not be fetched from the sync server before stopping`);
      }
      await b.settled();
      await b.refreshMirror(SYNCED);
      await installPersistenceBackend(deps.localBackend(), { copy: false, prefer: 'docs' });
      b.detach();
      await b.close?.();
    } else b?.detach();
    cs?.detachRemote();
    if (e) await e.eraseLocal().catch((err: unknown) => console.warn('Vitals sync: could not delete the local sync database', err));
    stopTrackingUnsynced();
    clearUnsyncedWrites('all');
    engineStatus = SYNC_OFF;
  };

  const parseCode = (code: string | { words: string; relayUrl: string }) => {
    try {
      if (typeof code === 'string' && /^\s*vitals-sync:/i.test(code)) return parsePairingUri(code);
      if (typeof code === 'string') throw new Error('Paste the whole pairing code (it starts with vitals-sync:1?), or enter the 24 words and the sync address.');
      return { relayUrl: normalizeRelayUrl(code.relayUrl), secret: wordsToSecret(code.words) };
    } catch (e) {
      throw new SyncError('invalid_code', messageOf(e));
    }
  };
  const relayOrThrow = (url: string) => {
    try {
      return normalizeRelayUrl(url);
    } catch (e) {
      throw new SyncError('invalid_relay', messageOf(e));
    }
  };

  const runtime: SyncRuntime = {
    get engine() {
      return engine;
    },
    get backend() {
      return backend;
    },
    status: () => current,
    config: () => config,
    /** Stable between changes (a `useSyncExternalStore` snapshot). */
    view: () =>
      (currentView ??= {
        status: current,
        paired: config !== null,
        enabled: config?.enabled ?? false,
        relayUrl: config?.relayUrl ?? null,
        label: config?.label ?? null,
        deviceId: config?.deviceId ?? deviceId(),
      }),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    load() {
      loaded ??= deps.vault.load().then(
        (saved) => {
          if (!config && saved) config = saved.config;
          recompute();
          return config;
        },
        () => null,
      );
      return loaded;
    },

    resume: () =>
      exclusive(async () => {
        if (engine) return;
        const saved = await deps.vault.load();
        loaded = Promise.resolve(saved?.config ?? null);
        if (!saved) {
          setSyncPairedHint(false);
          return;
        }
        config = saved.config;
        secret = saved.secret;
        recompute();
        try {
          await attach(saved.config, saved.secret, 'resume');
        } catch (e) {
          // stays on the local database; writes keep being recorded for the next start
          trackUnsyncedWrites(getDocumentStore());
          console.warn('Vitals sync: could not start', e);
        }
      }),

    pair: (relayUrl, label) =>
      exclusive(async () => {
        await runtime.load();
        if (config && secret) throw new SyncError('already_paired', 'This device already syncs. Stop syncing on it first.');
        const url = relayOrThrow(relayUrl);
        const key = newOwnerSecret();
        const cfg: SyncConfig = { enabled: true, relayUrl: url, deviceId: deviceId(), pairedAt: now().toISOString(), ...(label ? { label } : {}) };
        await attach(cfg, key, 'push');
        await deps.vault.save(cfg, key);
        localError = undefined;
        recompute();
        return pairingCodeOf(url, key, label);
      }),

    join: (code, mode) =>
      exclusive(async () => {
        await runtime.load();
        if (config && secret) throw new SyncError('already_paired', 'This device already syncs. Stop syncing on it first.');
        const parsed = parseCode(code);
        const label = 'label' in parsed && typeof parsed.label === 'string' ? parsed.label : undefined;
        const cfg: SyncConfig = { enabled: true, relayUrl: parsed.relayUrl, deviceId: deviceId(), pairedAt: now().toISOString(), ...(label ? { label } : {}) };
        await attach(cfg, parsed.secret, mode);
        await deps.vault.save(cfg, parsed.secret);
        localError = undefined;
        recompute();
      }),

    async pairingCode() {
      if (!config || !secret) return null;
      return pairingCodeOf(config.relayUrl, secret, config.label);
    },

    configure: (change) =>
      exclusive(async () => {
        await runtime.load();
        if (!config) throw new SyncError('not_paired', "Sync isn't set up on this device. Set it up first.");
        const next: SyncConfig = { ...config };
        if (change.relayUrl !== undefined) next.relayUrl = relayOrThrow(change.relayUrl);
        if (change.label !== undefined) {
          if (change.label.trim()) next.label = change.label.trim();
          else delete next.label;
        }
        if (change.enabled !== undefined) next.enabled = change.enabled;
        const relayChanged = next.relayUrl !== config.relayUrl || next.enabled !== config.enabled;
        if (next.enabled) deps.allowRelay?.(next.relayUrl);
        if (engine && relayChanged) {
          await engine.setRelay(next.enabled ? next.relayUrl : null);
          blobs?.detachRemote();
          blobs = null;
          if (next.enabled) await attachBlobs(next, engine, false);
        }
        config = next;
        await deps.vault.saveConfig(next);
        if (engine && change.label !== undefined) await writeDeviceDoc(next);
        if (!next.enabled) scheduler?.stop();
        else if (relayChanged) {
          scheduler?.start();
          void scheduler?.trigger('manual');
        }
        recompute();
        return next;
      }),

    async syncNow() {
      if (!config) throw new SyncError('not_paired', "Sync isn't set up on this device.");
      if (!engine) {
        // paired but the engine never started (or failed): try again
        await runtime.resume();
        return current;
      }
      if (scheduler) await scheduler.trigger('manual');
      else await round('manual').catch((e: unknown) => fail('round_failed', e));
      recompute();
      return current;
    },

    rotate: () =>
      exclusive(async () => {
        if (!config || !secret || !engine) throw new SyncError('not_paired', "Sync isn't running on this device, so there is no key to replace.");
        const old = { config, secret };
        await detach({ keepData: true });
        const key = newOwnerSecret();
        const cfg: SyncConfig = { ...old.config, pairedAt: now().toISOString() };
        config = null;
        secret = null;
        try {
          await attach(cfg, key, 'push');
        } catch (e) {
          // back to the old key, so the device keeps syncing as before
          await attach(old.config, old.secret, 'resume').catch(() => undefined);
          throw e;
        }
        await deps.vault.save(cfg, key);
        recompute();
        return pairingCodeOf(cfg.relayUrl, key, cfg.label);
      }),

    unpair: () =>
      exclusive(async () => {
        await runtime.load();
        await detach({ keepData: true });
        await deps.vault.clear();
        setSyncPairedHint(false);
        config = null;
        secret = null;
        localError = undefined;
        recompute();
      }),

    eraseLocal: () =>
      exclusive(async () => {
        const cs = blobs ?? (deps.blobs ? await deps.blobs().catch(() => null) : null);
        const attached = engine !== null;
        await detach({ keepData: false });
        if (!attached) await deps.deleteEngineData?.().catch(() => undefined);
        await cs?.erase().catch(() => undefined);
        await deps.vault.clear().catch(() => undefined);
        setSyncPairedHint(false);
        config = null;
        secret = null;
        loaded = null;
        localError = undefined;
        recompute();
      }),

    describeLocalData() {
      const s = getDocumentStore();
      const parts: string[] = [];
      const count = (col: CollectionId) => s.peekAll(col).length;
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      const profile = s.peek<{ weightKg?: unknown; heightCm?: unknown }>('profile', 'me');
      if (profile && (profile.weightKg != null || profile.heightCm != null)) parts.push('your body');
      const goals = s.peek<{ goals?: unknown[] }>('goals', 'me');
      if (goals?.goals?.length) parts.push('your goals');
      const scenarios = count('scenarios');
      if (scenarios) parts.push(plural(scenarios, 'scenario', 'scenarios'));
      const plans = count('plans');
      if (plans) parts.push(plural(plans, 'plan', 'plans'));
      const logs = count('dailyLogs') + count('measurements');
      if (logs) parts.push(plural(logs, 'log entry', 'log entries'));
      const health = count('bioRecords') + count('bioChunks');
      if (health) parts.push(plural(health, 'health record', 'health records'));
      const coach = count('conversations');
      if (coach) parts.push(plural(coach, 'Coach conversation', 'Coach conversations'));
      const custom = count('catalogueCustom') + count('recipes') + count('mealPlans');
      if (custom) parts.push(plural(custom, 'custom food or recipe', 'custom foods and recipes'));
      if (parts.length === 0) return null;
      const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
      return `This device has ${list}.`;
    },
  };
  return runtime;
}
