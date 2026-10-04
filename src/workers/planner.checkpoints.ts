/**
 * Tier X checkpoints (docs/PLANNER_V2_SPEC.md §4.9): saved by the coordinator inside the engine worker at every race
 * round and stage end, keyed by `checkpointKeyOf(request)` (canonical request + engine, registry, library and planner
 * versions), so a long exhaustive search survives a closed tab and resumes bit-for-bit. Stored in IndexedDB (database
 * `vitals-planner`, store `checkpoints`; workers have IndexedDB); an in-memory map where IndexedDB is missing (Node tests).
 * Only the latest checkpoint per key is kept; results are never stored here.
 */
export interface StoredCheckpoint<C = unknown> {
  key: string;
  createdAt: string;
  euUsed: number;
  stage: string;
  /** The request the run was started with (resume needs nothing else). */
  request: unknown;
  data: C;
}

const DB = 'vitals-planner';
const STORE = 'checkpoints';
const memory = new Map<string, StoredCheckpoint>();

function idb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb()!.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function saveCheckpoint(cp: StoredCheckpoint): Promise<void> {
  if (!idb()) {
    memory.set(cp.key, cp);
    return;
  }
  await tx('readwrite', (s) => s.put(cp));
}

export async function loadCheckpoint(key: string): Promise<StoredCheckpoint | null> {
  if (!idb()) return memory.get(key) ?? null;
  return ((await tx('readonly', (s) => s.get(key))) as StoredCheckpoint | undefined) ?? null;
}

export async function deleteCheckpoint(key: string): Promise<void> {
  if (!idb()) {
    memory.delete(key);
    return;
  }
  await tx('readwrite', (s) => s.delete(key));
}

/** Summaries of every stored checkpoint (no data), newest first. */
export async function listCheckpoints(): Promise<Array<Omit<StoredCheckpoint, 'data' | 'request'>>> {
  const all = !idb() ? [...memory.values()] : ((await tx('readonly', (s) => s.getAll())) as StoredCheckpoint[]);
  return all.map(({ data: _d, request: _r, ...rest }) => rest).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
