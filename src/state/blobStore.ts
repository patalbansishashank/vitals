/**
 * The app's blob store (SUITE_SPEC §2.4 `BlobStore`, the bytes-level shape in `@/store`): raw-sample chunks (biometrics)
 * and photos. Consumers (src/biometrics' document-backed BioStore, later photos) call `getBlobStore()` and never know
 * whether sync is on.
 *
 * I1 contract (stable): `getBlobStore(): Promise<BlobStore>` always resolves (paired or not); `setBlobStore(b)` swaps it
 * (tests); `onBlobStoreChange(fn)` reports swaps. In the browser the store is persistent (`@/sync/blobs/chunkStore`:
 * bytes in OPFS, else IndexedDB, with an IndexedDB index `vitals-blobs`); the sync runtime attaches the sealing and the
 * upload queue to it while this device is paired (`@/state/sync`), so the same instance serves before and after pairing.
 * Under test, and where neither OPFS nor IndexedDB works, it is the in-memory placeholder below.
 *
 * Chunk ids: the caller's `aadId` when it already is a 22-character base64url id (E10's `chunkIdFor`), else a hash of
 * purpose, aadId and content (the placeholder keeps the aadId as is). `put` also accepts an optional `localDate` (the
 * chunk's data day), which `evictLocal` compares against; without it the day of storing is used.
 */
import type { BlobStore, LocalDate } from '@/store';
import type { ChunkStore } from '@/sync/blobs/chunkStore';

/** In-memory placeholder (tests, and where no persistent storage works). The chunk id is the `aadId`. */
export function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, { bytes: Uint8Array; purpose: 'bio' | 'photo'; localDate?: LocalDate }>();
  return {
    put: async (bytes, meta) => {
      blobs.set(meta.aadId, { bytes: bytes.slice(), purpose: meta.purpose });
      return { chunkId: meta.aadId, bytes: bytes.length };
    },
    get: async (chunkId) => {
      const b = blobs.get(chunkId);
      if (!b) throw new Error(`blob ${chunkId} not found`);
      return b.bytes.slice();
    },
    hasLocal: async (chunkId) => blobs.has(chunkId),
    evictLocal: async () => 0,
    discard: async (chunkId) => void blobs.delete(chunkId),
  };
}

/** The persistent store can seal and upload (the sync runtime checks this before attaching). */
export function isChunkStore(b: BlobStore | null | undefined): b is ChunkStore {
  return Boolean(b && typeof (b as Partial<ChunkStore>).attachRemote === 'function');
}

function isTest(): boolean {
  return (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
}

/** OPFS writes from the main thread need `createWritable` (missing in some Safari versions): else IndexedDB. */
function opfsWritable(): boolean {
  const g = globalThis as { FileSystemFileHandle?: { prototype?: { createWritable?: unknown } }; navigator?: { storage?: { getDirectory?: unknown } } };
  return typeof g.navigator?.storage?.getDirectory === 'function' && typeof g.FileSystemFileHandle?.prototype?.createWritable === 'function';
}

async function createPersistent(): Promise<BlobStore> {
  if (isTest() || typeof indexedDB === 'undefined') return createMemoryBlobStore();
  try {
    const [{ createChunkStore }, { openBlobDb }] = await Promise.all([import('@/sync/blobs/chunkStore'), import('@/sync/blobs/idb')]);
    const db = await openBlobDb();
    let bytes = db.bytes;
    if (opfsWritable()) {
      try {
        bytes = await (await import('@/sync/blobs/opfs')).openOpfsBlobBackend('vitals-blobs');
      } catch {
        /* IndexedDB keeps the bytes */
      }
    }
    return createChunkStore({ bytes, index: db.index });
  } catch (e) {
    console.warn('Vitals: raw data files stay in memory for this session', e);
    return createMemoryBlobStore();
  }
}

let current: BlobStore | null = null;
let opening: Promise<BlobStore> | null = null;
const listeners = new Set<(b: BlobStore) => void>();

export async function getBlobStore(): Promise<BlobStore> {
  if (current) return current;
  opening ??= createPersistent().then((b) => {
    current ??= b;
    opening = null;
    return current;
  });
  return opening;
}

export function setBlobStore(next: BlobStore | null): void {
  current = next;
  opening = null;
  if (next) for (const fn of listeners) fn(next);
}

export function onBlobStoreChange(fn: (b: BlobStore) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
