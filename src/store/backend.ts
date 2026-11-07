/**
 * `PersistenceBackend`: the small engine seam under the `DocumentStore` (tier H).
 *
 * An engine stores whole documents as `{ ...meta, value }` rows keyed by `(col, id)`, reports local writes and merged
 * remote changes on one feed, and may offer an atomic `batch`. That is all the app needs from it: tokens, queries,
 * watches, schema migration on read, encryption hooks and the change feed live in `createDocumentStore`
 * (`./documentStore.ts`), so every engine gets them for free.
 *
 * The shape is deliberately the engine-side `SyncStore` of wp/E11 (get/list/put/delete/subscribe with
 * `Doc = DocMeta & { value }`), so an opened Evolu store plugs in unchanged:
 *
 *   const sync = createEvoluSyncStore(...); await sync.open(...);
 *   await installPersistenceBackend(sync);          // src/state/persistence.ts: copyStore(idb → evolu) once, then switch
 */
import type { DocMeta, Instant } from './types';

export interface BackendDoc<T = unknown> extends Omit<DocMeta, '_col'> {
  _col: string;
  value: T;
}

export interface BackendChange {
  col: string;
  id: string;
  /** State after the change (soft-deleted documents carry `_deleted`); null = hard-deleted. */
  doc: BackendDoc | null;
  /** 'local' = written through this backend instance; 'remote' = merged from another device. */
  origin: 'local' | 'remote';
}

export type BackendOp =
  | { kind: 'put'; col: string; id: string; value: unknown; schema: number }
  | { kind: 'delete'; col: string; id: string };

export interface PersistenceBackend {
  /** 'idb' | 'memory' | 'evolu' | 'pouchdb' | … */
  readonly engine: string;
  get<T>(col: string, id: string): Promise<BackendDoc<T> | null>;
  list<T>(col: string, options?: { includeDeleted?: boolean }): Promise<BackendDoc<T>[]>;
  put<T>(col: string, id: string, value: T, options?: { schema?: number }): Promise<BackendDoc<T>>;
  /** Soft delete. */
  delete(col: string, id: string): Promise<void>;
  subscribe(listener: (change: BackendChange) => void): () => void;
  /** Optional atomic multi-write; without it the store writes in order (crash between writes = partial ChangeSet). */
  batch?(ops: readonly BackendOp[]): Promise<BackendDoc[]>;
  /** Local restore only: enumerate replaced collections and commit their exact snapshot in one transaction. */
  restoreSnapshot?(collections: readonly string[], ops: readonly BackendOp[]): Promise<BackendDoc[]>;
  /** Optional: previous revisions (concurrent LWW losers, SUITE_SPEC §2.3). */
  history?<T>(col: string, id: string, limit: number): Promise<BackendDoc<T>[]>;
  /** Optional: delete the local database (Erase this device). E11's SyncStore names it `eraseLocal`. */
  erase?(): Promise<void>;
  eraseLocal?(): Promise<void>;
  /** Optional: reject a replica pinned before a restore in another window. */
  assertCurrent?(): Promise<void>;
  /** Optional: release resources. */
  close?(): Promise<void>;
}

/** Stamp a new row (shared by the reference backends). */
export function stampDoc<T>(
  prev: BackendDoc | null | undefined,
  col: string,
  id: string,
  value: T,
  schema: number,
  rev: string,
  device: string,
  now: Instant,
  deleted: boolean,
): BackendDoc<T> {
  return {
    _id: id,
    _col: col,
    _schema: schema,
    _rev: rev,
    _device: device,
    _created: prev?._created ?? now,
    _updated: now,
    value,
    ...(deleted ? { _deleted: true as const } : {}),
  };
}

/** Restore planning against rows read under the backend's write transaction, never a tab's stale cache. */
export function restoreOps(ops: readonly BackendOp[], previous: ReadonlyMap<string, readonly BackendDoc[]>): BackendOp[] {
  const wanted = new Set(ops.filter(op => op.kind === 'put').map(op => `${op.col}\0${op.id}`));
  const next: BackendOp[] = ops.filter(op => op.kind !== 'delete' || !previous.has(op.col));
  const before: Record<string, unknown[]> = {};
  for (const [col, rows] of previous) {
    before[col] = rows.map(({ value, ...meta }) => ({ ...(value as Record<string, unknown>), ...meta }));
    for (const doc of rows) if (!doc._deleted && !wanted.has(`${col}\0${doc._id}`)) next.push({ kind: 'delete', col, id: doc._id });
  }
  return next.map(op => op.kind === 'put' && op.col === 'syncState' && op.id === 'restore'
    ? { ...op, value: { ...(op.value as Record<string, unknown>), before } } : op);
}
/** Include untouched tombstones so a restored cache retains append-only ID protection. */
export function restoredRows(written: readonly BackendDoc[], previous: ReadonlyMap<string, readonly BackendDoc[]>): BackendDoc[] {
  const all = new Map<string, BackendDoc>();
  for (const rows of previous.values()) for (const doc of rows) all.set(`${doc._col}\0${doc._id}`, doc);
  for (const doc of written) all.set(`${doc._col}\0${doc._id}`, doc);
  return [...all.values()];
}
