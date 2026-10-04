/**
 * IndexedDB pieces of the app's blob store: the chunk index (always) and the byte store where OPFS is missing.
 * One database, `vitals-blobs`, with object stores `chunks` (index rows) and `bytes` (`{ chunkId, data }`).
 * Hand-written promise wrappers, like `src/store/idbBackend.ts`.
 */
import type { BlobBackend } from '../types';
import type { ChunkIndex, ChunkMeta } from './chunkStore';
import { assertChunkId, CHUNK_ID_RE } from './ids';

export const BLOB_DATABASE = 'vitals-blobs';
const VERSION = 1;
const CHUNKS = 'chunks';
const BYTES = 'bytes';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface BlobDb {
  index: ChunkIndex;
  /** Byte storage inside IndexedDB (the fallback where OPFS is unavailable). */
  bytes: Required<BlobBackend>;
  close(): void;
}

export async function openBlobDb(options: { factory?: IDBFactory; name?: string } = {}): Promise<BlobDb> {
  const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) throw new Error('IndexedDB is not available here.');
  const open = factory.open(options.name ?? BLOB_DATABASE, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: 'chunkId' });
    if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES, { keyPath: 'chunkId' });
  };
  const db = await req(open);
  // "Erase this device" deletes this database: let it, instead of blocking until every tab reloads
  db.onversionchange = () => db.close();

  const read = async <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = db.transaction(store, 'readonly');
    const r = await req(fn(tx.objectStore(store)));
    return r;
  };
  const write = async (store: string, fn: (s: IDBObjectStore) => void): Promise<void> => {
    const tx = db.transaction(store, 'readwrite');
    const finished = done(tx);
    fn(tx.objectStore(store));
    await finished;
  };

  const index: ChunkIndex = {
    get: async (chunkId) => ((await read<ChunkMeta | undefined>(CHUNKS, (s) => s.get(chunkId) as IDBRequest<ChunkMeta | undefined>)) ?? null),
    put: (meta) => write(CHUNKS, (s) => void s.put({ ...meta })),
    list: () => read<ChunkMeta[]>(CHUNKS, (s) => s.getAll() as IDBRequest<ChunkMeta[]>),
    delete: (chunkId) => write(CHUNKS, (s) => void s.delete(chunkId)),
    async clear() {
      const keys = await read<IDBValidKey[]>(CHUNKS, (s) => s.getAllKeys());
      if (keys.length) await write(CHUNKS, (s) => keys.forEach((k) => s.delete(k)));
    },
  };

  const bytes: Required<BlobBackend> = {
    async put(chunkId, data) {
      assertChunkId(chunkId);
      if (await bytes.has(chunkId)) return 'exists';
      await write(BYTES, (s) => void s.put({ chunkId, data: data.slice() }));
      return 'created';
    },
    async get(chunkId) {
      const row = await read<{ data: Uint8Array } | undefined>(BYTES, (s) => s.get(chunkId) as IDBRequest<{ data: Uint8Array } | undefined>);
      return row ? new Uint8Array(row.data) : null;
    },
    async has(chunkId) {
      return (await read<{ data: Uint8Array } | undefined>(BYTES, (s) => s.get(chunkId) as IDBRequest<{ data: Uint8Array } | undefined>)) !== undefined;
    },
    delete: (chunkId) => write(BYTES, (s) => void s.delete(chunkId)),
    async list() {
      const keys = await read<IDBValidKey[]>(BYTES, (s) => s.getAllKeys());
      return keys.map(String).filter((k) => CHUNK_ID_RE.test(k));
    },
  };

  return { index, bytes, close: () => db.close() };
}
