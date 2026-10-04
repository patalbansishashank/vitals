/**
 * Local-first document store contracts (SUITE_SPEC §0.1, §2.2–§2.6). Tier H: no DOM, no React, no app state.
 *
 * `DocumentStore` (alias `DocStore`, the spec's name) is the app-facing interface every feature reads and writes
 * through; engines plug in underneath through the much smaller `PersistenceBackend` seam (`./backend.ts`), which the
 * Evolu `SyncStore` (wp/E11) satisfies structurally.
 */

/** 'YYYY-MM-DD'. */
export type LocalDate = string;
/** ISO-8601 UTC with 'Z', millisecond precision. */
export type Instant = string;
/** 16 chars base32, random, minted once per browser profile / Companion install. */
export type DeviceId = string;
/** ULID. */
export type Id = string;
/** Opaque document revision from the engine; compared only for equality. */
export type Rev = string;

/** Every collection of SUITE_SPEC §2.3 (policies in `./collections.ts`). */
export const COLLECTION_IDS = [
  'profile',
  'intake',
  'safety',
  'goals',
  // E20: blood markers (`vitals.markers/1`, SUITE_SPEC §13.5)
  'markers',
  'scenarios',
  'plans',
  'planVersions',
  'activePlan',
  'dailyLogs',
  'dayStatus',
  'measurements',
  'anchors',
  'bioRecords',
  'bioChunks',
  'bioSources',
  'bioScores',
  'decisionLog',
  // E28 (SUITE_SPEC §14.6): the person's corrections of device values, `vitals.bio_correction/1`
  'bioCorrections',
  'conversations',
  'messages',
  'attachments',
  'catalogueCustom',
  'recipes',
  'mealPlans',
  'kitchen',
  'pantry',
  'settings',
  'devices',
  'pendingChanges',
  'providerKeys',
  'deviceSettings',
  'uiPrefs',
  'secrets',
  'changeLog',
  'commandLedger',
  'jobs',
  'aiUsage',
  'derived',
  'syncState',
] as const;
export type CollectionId = (typeof COLLECTION_IDS)[number];

export function isCollectionId(x: unknown): x is CollectionId {
  return typeof x === 'string' && (COLLECTION_IDS as readonly string[]).includes(x);
}

export interface DocMeta {
  _id: string;
  _col: CollectionId;
  /** Schema version of the body; migrated forward on read by the collection's migrator. */
  _schema: number;
  _rev: Rev;
  _device: DeviceId;
  _created: Instant;
  _updated: Instant;
  /** Soft delete. */
  _deleted?: true;
}
export type Doc<T = Record<string, unknown>> = DocMeta & T;

/** RFC 7396 JSON merge patch over `T` (null removes a field). */
export type JsonMergePatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: JsonMergePatch<T[K]> | null }
    : T;

/** RFC 6902 operations (the subset ChangeSet inverses use). */
export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string };

/* ---------------------------------------------------------------- write tokens */

export type WriteTokenKind = 'command' | 'sync' | 'migration' | 'derive';
declare const TOKEN_BRAND: unique symbol;
export interface WriteToken {
  readonly kind: WriteTokenKind;
  readonly changeSetId?: Id;
  /** Who minted it (debugging, logs). */
  readonly label?: string;
  readonly [TOKEN_BRAND]: true;
}

/** Thrown by `DocumentStore.transact` and by guarded projections when a write has no valid token (dev, test). */
export class WriteOutsideCommand extends Error {
  override readonly name = 'WriteOutsideCommand';
  constructor(what: string) {
    super(`${what}: user data may only change through a command (dispatch), sync, the one-time migration or a derive job.`);
  }
}

/* ---------------------------------------------------------------- queries and the store */

export interface Query {
  /** A top-level field name, or several joined with ',' for a compound index (`'planId,date'`). */
  index?: string;
  range?: { lower?: unknown; upper?: unknown };
  limit?: number;
  reverse?: boolean;
  includeDeleted?: boolean;
}

/** One change on the feed: a committed local transaction or a merged remote document. */
export interface StoreChange {
  /** Monotonic per store instance. */
  seq: number;
  col: CollectionId;
  id: string;
  /** State after the change (soft-deleted documents carry `_deleted`). */
  doc: Doc<unknown> | null;
  origin: 'local' | 'remote';
  /** Token kind of the local writer. */
  writer?: WriteTokenKind;
  changeSetId?: Id;
}

export interface Tx {
  get<T>(col: CollectionId, id: string): Promise<Doc<T> | null>;
  /** LWW-F collections: replace the document body. */
  put<T>(col: CollectionId, doc: T & { _id: string }): Promise<Doc<T>>;
  /** RFC 7396 merge patch on the stored body (creates the document when absent). */
  patch<T>(col: CollectionId, id: string, mergePatch: JsonMergePatch<T>): Promise<Doc<T>>;
  /** APP/IMM collections; throws if the id exists. */
  append<T>(col: CollectionId, doc: T & { _id: string }): Promise<Doc<T>>;
  /** Soft delete. */
  remove(col: CollectionId, id: string): Promise<void>;
}

export interface CollectionStats {
  docs: number;
  bytes: number;
}

export interface DocumentStore {
  readonly ready: Promise<void>;
  /** Engine name of the backend ('idb', 'memory', 'evolu', …). */
  readonly engine: string;
  readonly device: DeviceId;
  get<T>(col: CollectionId, id: string): Promise<Doc<T> | null>;
  query<T>(col: CollectionId, q?: Query): Promise<Doc<T>[]>;
  /** `list(col)` = `query(col)` (the engine-neutral name used by the sync side). */
  list<T>(col: CollectionId, options?: { includeDeleted?: boolean }): Promise<Doc<T>[]>;
  /** Called with the current matches now and after every local or remote change that touches the collection. */
  watch<T>(col: CollectionId, q: Query | { id: string }, cb: (docs: Doc<T>[]) => void): () => void;
  /** Atomic: every write inside `fn` lands together or not at all. Requires a valid token. */
  transact<R>(token: WriteToken, fn: (tx: Tx) => Promise<R>): Promise<R>;
  history?<T>(col: CollectionId, id: string, limit: number): Promise<Array<{ rev: string; at: Instant; device: DeviceId; doc: Doc<T> }>>;
  estimate(): Promise<Partial<Record<CollectionId, CollectionStats>>>;
  /** Every document (including soft-deleted ones) of the given collections: export, `copyStore`. */
  dump(cols: readonly CollectionId[]): AsyncIterable<Doc<unknown>>;
  /** The change feed (local commits and remote merges). */
  subscribe(listener: (change: StoreChange) => void): () => void;
  /** Changes after `seq` still held in memory (bounded ring; for catch-up after a short disconnect). */
  changesSince(seq: number): StoreChange[];
  /** Synchronous read of the in-memory cache (loaded at `ready`); null before ready or when absent. */
  peek<T>(col: CollectionId, id: string): Doc<T> | null;
  /** Synchronous list from the cache (non-deleted unless asked). */
  peekAll<T>(col: CollectionId, options?: { includeDeleted?: boolean }): Doc<T>[];
  /** Deletes the local database of this store (Erase this device). */
  erase(): Promise<void>;
  close(): Promise<void>;
}
/** The spec's name (SUITE_SPEC §2.4). */
export type DocStore = DocumentStore;

/* ---------------------------------------------------------------- policies (merge-rule metadata) */

/** Merge strategies of SUITE_SPEC §2.3. */
export type MergeStrategy = 'lwwField' | 'append' | 'immutable' | 'blob' | 'derived' | 'local';

export interface CollectionPolicy {
  col: CollectionId;
  strategy: MergeStrategy;
  sync: 'yes' | 'no' | 'optIn';
  /** Hydration / copy order (lower first). */
  order: number;
}

/* ---------------------------------------------------------------- sync side (interfaces only; engines are wp/E11) */

export interface Encryptor {
  seal(plain: Uint8Array, aad: string): Promise<Uint8Array>;
  open(sealed: Uint8Array, aad: string): Promise<Uint8Array>;
}

export interface BlobStore {
  put(bytes: Uint8Array, meta: { purpose: 'bio' | 'photo'; aadId: string }): Promise<{ chunkId: string; bytes: number }>;
  get(chunkId: string): Promise<Uint8Array>;
  hasLocal(chunkId: string): Promise<boolean>;
  evictLocal(olderThan: LocalDate, purpose: 'bio' | 'photo'): Promise<number>;
  /** Drops a chunk this device no longer needs (a replaced one): local bytes, index row, pending upload. Optional. */
  discard?(chunkId: string): Promise<void>;
  /** The chunks held on this device (pruning). Optional. */
  localChunks?(purpose: 'bio' | 'photo'): Promise<Array<{ chunkId: string; storedAt: string }>>;
}

export type SyncState = 'off' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'error' | 'needs-permission';
export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: Instant | null;
  pendingChanges: number;
  pendingBlobs: number;
  lastError?: { code: string; message: string; at: Instant };
  endpoint?: string;
}
export const SYNC_OFF: SyncStatus = { state: 'off', lastSyncedAt: null, pendingChanges: 0, pendingBlobs: 0 };

export interface SyncTarget {
  kind: 'relay';
  url: string;
  label: string;
}
export interface PairingCode {
  uri: string;
  words: string[];
}
export interface SyncAdapter {
  readonly engine: 'evolu' | 'pouchdb';
  readonly capabilities: { live: boolean; history: boolean; maxRowBytes: number };
  open(store: 'local' | { secret: Uint8Array }): Promise<void>;
  pair(target: SyncTarget): Promise<PairingCode>;
  join(code: string, onExisting: (summary: string) => Promise<'merge' | 'replace'>): Promise<void>;
  push(): Promise<{ sent: number }>;
  pull(): Promise<{ received: number; collections: CollectionId[] }>;
  subscribe(cb: (s: SyncStatus) => void): () => void;
  revokeAndRotate(): Promise<void>;
  rekey(): Promise<PairingCode>;
  eraseThisDevice(): Promise<void>;
  eraseEverywhere(): Promise<void>;
}
