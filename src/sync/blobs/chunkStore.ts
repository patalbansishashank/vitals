/**
 * The app's blob store (SUITE_SPEC §2.4 `BlobStore`, bytes-level; I1): raw-sample chunks (E10's chunk codec is the
 * payload, this store never looks inside) and, later, photos.
 *
 * - **Chunk ids** do not depend on the sync secret. When `aadId` already is a 22-character base64url id (E10's BioStore
 *   passes `chunkIdFor(key, contentHash)`), it is the chunk id; anything else is hashed:
 *   `base64url(SHA-256("vitals/chunk/v1" ‖ purpose ‖ aadId ‖ SHA-256(bytes)))[0..22]`. So chunks stored before pairing
 *   keep their ids, every device names a chunk the same way, and a new sync key (`sync.rotate`) leaves the manifests
 *   in `bioChunks` valid. The relay only ever sees these opaque ids.
 * - **Local copy**: plain bytes (OPFS, else IndexedDB; memory in tests) plus an index row per chunk (purpose, local
 *   date, local/uploaded flags). Local bytes are not sealed: they sit next to the document database, which is not
 *   encrypted at rest either (the browser profile is the at-rest boundary, R7 §7.2).
 * - **Remote copy**, only while paired: sealed with AES-GCM under a per-chunk subkey of K_blob (AAD `${chunkId}|1`,
 *   E11's `createAesGcmEncryptor`) and uploaded create-only to the relay's `/blobs/{ownerIdHash}/{chunkId}`. The upload
 *   queue is the index (`uploaded: false` rows), so it survives reloads; the sync runtime flushes it after every round.
 *   Pairing queues the backlog (everything stored before) the same way.
 * - **Eviction** drops local bytes the endpoint already holds; `get` then fetches, opens and caches them again.
 */
import { sha256, toBase64Url } from '../crypto';
import type { BlobBackend, BlobStore, Encryptor, Instant, LocalDate } from '../types';
import { CHUNK_ID_RE } from './ids';

export type BlobPurpose = 'bio' | 'photo';

export interface ChunkMeta {
  chunkId: string;
  purpose: BlobPurpose;
  /** Local date the chunk belongs to (its data day when the caller says so, else the day it was stored). */
  localDate: LocalDate;
  /** Plain size in bytes. */
  size: number;
  /** The bytes are on this device. */
  local: boolean;
  /** The current sync owner's endpoint holds the sealed chunk. */
  uploaded: boolean;
  storedAt: Instant;
}

/** Where the index rows live (IndexedDB in the app, memory in tests). */
export interface ChunkIndex {
  get(chunkId: string): Promise<ChunkMeta | null>;
  put(meta: ChunkMeta): Promise<void>;
  list(): Promise<ChunkMeta[]>;
  /** Drops one row (a discarded chunk). Optional: without it the row stays, marked not local. */
  delete?(chunkId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ChunkRemote {
  /** K_blob of the paired owner. */
  seal: Encryptor;
  /** The endpoint's `/blobs` (create-only). */
  backend: BlobBackend;
}

export interface ChunkStore extends BlobStore {
  put(bytes: Uint8Array, meta: { purpose: BlobPurpose; aadId: string; localDate?: LocalDate }): Promise<{ chunkId: string; bytes: number }>;
  discard(chunkId: string): Promise<void>;
  localChunks(purpose: BlobPurpose): Promise<Array<{ chunkId: string; storedAt: string }>>;
  /** Record the data day of a chunk (eviction uses it). */
  setLocalDate(chunkId: string, localDate: LocalDate): Promise<void>;
  /** Start sealing and uploading for a paired owner (pending uploads are reloaded from the index). */
  attachRemote(remote: ChunkRemote): Promise<void>;
  detachRemote(): void;
  readonly paired: boolean;
  /** Mark every local chunk for upload (pairing, a new key). Returns how many were queued. */
  queueAll(): Promise<number>;
  /** Upload queued chunks now (8 in parallel). Returns how many reached the endpoint. */
  flush(): Promise<number>;
  /** Chunks waiting for upload. */
  pending(): number;
  /** Calls `fn` with the new count whenever the upload queue changes (the sync status follows it). */
  onPendingChange(fn: (n: number) => void): () => void;
  /** True when the endpoint holds the chunk (its index row says uploaded, else the endpoint is asked). */
  hasRemote(chunkId: string): Promise<boolean>;
  /**
   * Fetch every evicted chunk back from the endpoint, plus `known` chunks this device never stored (manifests other
   * devices wrote), so the device keeps them after unpairing and can re-upload them under a new key.
   */
  restoreLocal(known?: ReadonlyArray<{ chunkId: string; purpose?: BlobPurpose; localDate?: LocalDate }>): Promise<{ restored: number; failed: number }>;
  /** Delete every local chunk and the index (Erase this device). Never touches the endpoint. */
  erase(): Promise<void>;
  /** Last upload error (status line), cleared by a successful flush. */
  readonly lastError: { code: string; message: string; at: Instant } | null;
}

export interface ChunkStoreOptions {
  bytes: BlobBackend;
  index: ChunkIndex;
  now?: () => Date;
  concurrency?: number;
  /** Pending-count changes (status: "3 files waiting"). */
  onPending?(n: number): void;
}

export const CHUNK_AAD_VERSION = 1;
export const chunkAad = (chunkId: string) => `${chunkId}|${CHUNK_AAD_VERSION}`;
const enc = new TextEncoder();

function localDateOf(d: Date): LocalDate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The chunk id for `aadId` and these bytes (see the header). */
export async function chunkIdOf(bytes: Uint8Array, meta: { purpose: BlobPurpose; aadId: string }): Promise<string> {
  if (CHUNK_ID_RE.test(meta.aadId)) return meta.aadId;
  const content = toBase64Url(await sha256(bytes));
  return toBase64Url(await sha256(enc.encode(`vitals/chunk/v1\u0000${meta.purpose}\u0000${meta.aadId}\u0000${content}`))).slice(0, 22);
}

export function createChunkStore(options: ChunkStoreOptions): ChunkStore {
  const { bytes, index } = options;
  const now = options.now ?? (() => new Date());
  const concurrency = options.concurrency ?? 8;
  let remote: ChunkRemote | null = null;
  const pending = new Set<string>();
  let flushing: Promise<number> | null = null;
  let lastError: ChunkStore['lastError'] = null;

  const pendingListeners = new Set<(n: number) => void>();
  const notify = () => {
    options.onPending?.(pending.size);
    for (const fn of pendingListeners) fn(pending.size);
  };

  const fetchRemote = async (chunkId: string): Promise<Uint8Array | null> => {
    if (!remote) return null;
    const sealed = await remote.backend.get(chunkId);
    if (!sealed) return null;
    try {
      return await remote.seal.open(sealed, chunkAad(chunkId));
    } catch {
      throw new Error(`Chunk ${chunkId} failed authentication (tampered, or stored under another key).`);
    }
  };

  /** Cache a chunk fetched from the endpoint (a row is created for chunks other devices stored). */
  const keepLocal = async (chunkId: string, plain: Uint8Array, hint?: { purpose?: BlobPurpose; localDate?: LocalDate }) => {
    await bytes.put(chunkId, plain);
    const row = await index.get(chunkId);
    await index.put(
      row
        ? { ...row, local: true }
        : {
            chunkId,
            purpose: hint?.purpose ?? 'bio',
            localDate: hint?.localDate ?? localDateOf(now()),
            size: plain.length,
            local: true,
            uploaded: true,
            storedAt: now().toISOString(),
          },
    );
  };

  const uploadOne = async (chunkId: string): Promise<boolean> => {
    const r = remote;
    if (!r) return false;
    const plain = await bytes.get(chunkId);
    const row = await index.get(chunkId);
    if (!plain || !row) {
      // evicted or erased before it was uploaded: nothing to send
      pending.delete(chunkId);
      return false;
    }
    await r.backend.put(chunkId, await r.seal.seal(plain, chunkAad(chunkId)));
    await index.put({ ...row, uploaded: true });
    pending.delete(chunkId);
    return true;
  };

  const runFlush = async (): Promise<number> => {
    if (!remote) return 0;
    const ids = [...pending];
    let next = 0;
    let uploaded = 0;
    let failed: unknown = null;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          if (await uploadOne(id)) uploaded++;
        } catch (e) {
          failed = e; // stays queued for the next flush
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
    lastError = failed
      ? {
          code: (failed as { code?: string }).code ?? 'blob_upload',
          message: failed instanceof Error ? failed.message : String(failed),
          at: now().toISOString(),
        }
      : null;
    notify();
    return uploaded;
  };

  const store: ChunkStore = {
    get paired() {
      return remote !== null;
    },
    get lastError() {
      return lastError;
    },

    async put(data, meta) {
      const chunkId = await chunkIdOf(data, meta);
      await bytes.put(chunkId, data);
      const prev = await index.get(chunkId);
      const row: ChunkMeta = {
        chunkId,
        purpose: meta.purpose,
        localDate: meta.localDate ?? prev?.localDate ?? localDateOf(now()),
        size: data.length,
        local: true,
        uploaded: prev?.uploaded ?? false,
        storedAt: prev?.storedAt ?? now().toISOString(),
      };
      await index.put(row);
      if (remote && !row.uploaded) {
        pending.add(chunkId);
        notify();
      }
      return { chunkId, bytes: data.length };
    },

    async get(chunkId) {
      const cached = await bytes.get(chunkId);
      if (cached) return cached;
      const fetched = await fetchRemote(chunkId);
      if (!fetched) throw new Error(`Chunk ${chunkId} is not stored on this device${remote ? ' or on the sync server' : ''}.`);
      await keepLocal(chunkId, fetched);
      return fetched;
    },

    hasLocal: (chunkId) => bytes.has(chunkId),

    async discard(chunkId) {
      // a replaced chunk: never uploaded if it was still waiting (the endpoint's /blobs is create-only, so an uploaded
      // copy stays there), and gone from this device
      if (pending.delete(chunkId)) notify();
      if (bytes.delete) await bytes.delete(chunkId);
      if (index.delete) await index.delete(chunkId);
      else {
        const row = await index.get(chunkId);
        if (row) await index.put({ ...row, local: false, uploaded: true });
      }
    },

    async localChunks(purpose) {
      return (await index.list()).filter((r) => r.purpose === purpose && r.local && !pending.has(r.chunkId)).map((r) => ({ chunkId: r.chunkId, storedAt: r.storedAt }));
    },

    async setLocalDate(chunkId, localDate) {
      const row = await index.get(chunkId);
      if (row) await index.put({ ...row, localDate });
    },

    async evictLocal(olderThan, purpose) {
      // only chunks the endpoint already holds: an unpaired device never drops its only copy
      if (!remote || !bytes.delete) return 0;
      let evicted = 0;
      for (const row of await index.list()) {
        if (row.purpose !== purpose || !row.local || !row.uploaded || pending.has(row.chunkId) || !(row.localDate < olderThan)) continue;
        await bytes.delete(row.chunkId);
        await index.put({ ...row, local: false });
        evicted++;
      }
      return evicted;
    },

    async attachRemote(next) {
      remote = next;
      pending.clear();
      for (const row of await index.list()) if (row.local && !row.uploaded) pending.add(row.chunkId);
      notify();
    },

    detachRemote() {
      remote = null;
      pending.clear();
      notify();
    },

    async queueAll() {
      let n = 0;
      for (const row of await index.list()) {
        if (!row.local) continue;
        if (row.uploaded) await index.put({ ...row, uploaded: false });
        if (remote) pending.add(row.chunkId);
        n++;
      }
      notify();
      return n;
    },

    flush() {
      // A chunk queued while a flush is running (the server merges a day's samples after every ring message) must not
      // wait for the next caller: the run repeats until nothing new is pending or an upload failed.
      flushing ??= (async () => {
        let total = 0;
        do total += await runFlush();
        while (pending.size > 0 && lastError === null && remote !== null);
        return total;
      })().finally(() => {
        flushing = null;
      });
      return flushing;
    },

    pending: () => pending.size,
    onPendingChange(fn) {
      pendingListeners.add(fn);
      return () => void pendingListeners.delete(fn);
    },

    async hasRemote(chunkId) {
      if (pending.has(chunkId)) return false;
      if ((await index.get(chunkId))?.uploaded) return true;
      return remote ? remote.backend.has(chunkId).catch(() => false) : false;
    },

    async restoreLocal(known = []) {
      let restored = 0;
      let failed = 0;
      const wanted = new Map<string, { purpose?: BlobPurpose; localDate?: LocalDate }>();
      for (const row of await index.list()) if (!row.local) wanted.set(row.chunkId, {});
      for (const k of known) if (CHUNK_ID_RE.test(k.chunkId) && !(await bytes.has(k.chunkId))) wanted.set(k.chunkId, k);
      for (const [chunkId, hint] of wanted) {
        try {
          const plain = await fetchRemote(chunkId);
          if (!plain) {
            failed++;
            continue;
          }
          await keepLocal(chunkId, plain, hint);
          restored++;
        } catch {
          failed++;
        }
      }
      return { restored, failed };
    },

    async erase() {
      remote = null;
      pending.clear();
      if (bytes.delete) {
        const ids = bytes.list ? await bytes.list() : (await index.list()).map((r) => r.chunkId);
        for (const id of ids) await bytes.delete(id).catch(() => undefined);
      }
      await index.clear();
      notify();
    },
  };
  return store;
}

/** In-memory index (tests, private windows). */
export function createMemoryChunkIndex(): ChunkIndex & { readonly rows: Map<string, ChunkMeta> } {
  const rows = new Map<string, ChunkMeta>();
  return {
    rows,
    get: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    put: async (meta) => void rows.set(meta.chunkId, { ...meta }),
    delete: async (id) => void rows.delete(id),
    list: async () => [...rows.values()].map((r) => ({ ...r })),
    clear: async () => rows.clear(),
  };
}
