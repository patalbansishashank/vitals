/**
 * In-memory `SyncStore`: the reference behaviour for the conformance tests and a stand-in wherever a real engine is
 * not needed. It is an E4 `PersistenceBackend` (engine 'memory'), like the Evolu store. `link()` joins several memory
 * stores into one simulated relay, so convergence can be tested without the network: each `pull()` copies every newer
 * document from the hub (last writer wins by `_rev`), each `push()` sends every newer local one.
 */
import { deriveVitalsKeys, sha256, toBase64Url } from './crypto';
import { OFF_STATUS, type BackendOp, type Doc, type DocChange, type OpenOptions, type SyncStatus, type SyncStore, type VitalsKeys } from './types';

type Hub = Map<string, Doc>;

let hlcLast = 0;
let hlcCounter = 0;
/** `${ms 13}-${counter hex 4}-${device}`: string order = causal order on one machine (SUITE_SPEC §0.1 Hlc). */
export function nextHlc(device: string, nowMs: number = Date.now()): string {
  if (nowMs > hlcLast) {
    hlcLast = nowMs;
    hlcCounter = 0;
  } else hlcCounter += 1;
  return `${String(hlcLast).padStart(13, '0')}-${hlcCounter.toString(16).padStart(4, '0')}-${device}`;
}

const keyOf = (col: string, id: string) => `${col}\u0000${id}`;

export interface MemorySyncStore extends SyncStore {
  /** Share one in-memory "relay" between stores (tests). */
  link(hub: Hub): void;
}

export function createMemoryHub(): Hub {
  return new Map();
}

export function createMemorySyncStore(): MemorySyncStore {
  const docs = new Map<string, Doc>();
  const listeners = new Set<(c: DocChange) => void>();
  const statusListeners = new Set<(s: SyncStatus) => void>();
  let hub: Hub | null = null;
  let device = '';
  let open = false;
  let keys: VitalsKeys | null = null;
  let relay: string | null = null;
  let current: SyncStatus = OFF_STATUS;

  const setStatus = (s: SyncStatus) => {
    current = s;
    for (const l of statusListeners) l(s);
  };
  const emit = (c: DocChange) => {
    for (const l of listeners) l(c);
  };
  const ensureOpen = () => {
    if (!open) throw new Error('The store is not open.');
  };
  const write = <T>(col: string, id: string, value: T, schema: number, deleted: boolean): Doc<T> => {
    ensureOpen();
    const prev = docs.get(keyOf(col, id));
    const now = new Date().toISOString();
    const doc: Doc<T> = {
      _id: id,
      _col: col,
      _schema: schema,
      _rev: nextHlc(device),
      _device: device,
      _created: prev?._created ?? now,
      _updated: now,
      value,
      ...(deleted ? { _deleted: true as const } : {}),
    };
    docs.set(keyOf(col, id), doc as Doc);
    emit({ col, id, doc: structuredClone(doc) as Doc, origin: 'local' });
    return structuredClone(doc);
  };

  const store: MemorySyncStore = {
    engine: 'memory',
    capabilities: { live: false, history: false, maxRowBytes: Number.POSITIVE_INFINITY },
    get isOpen() {
      return open;
    },
    get keys() {
      return keys;
    },
    async open(o: OpenOptions) {
      device = o.deviceId;
      keys = await deriveVitalsKeys(o.secret, toBase64Url(await sha256(o.secret)).slice(0, 22));
      relay = o.relayUrl;
      open = true;
      setStatus(relay ? { ...OFF_STATUS, state: 'synced', endpoint: relay } : OFF_STATUS);
    },
    async close() {
      open = false;
      setStatus(OFF_STATUS);
    },
    async get<T>(col: string, id: string) {
      ensureOpen();
      const d = docs.get(keyOf(col, id));
      return d ? (structuredClone(d) as Doc<T>) : null;
    },
    async list<T>(col: string, options?: { includeDeleted?: boolean }) {
      ensureOpen();
      return [...docs.values()].filter((d) => d._col === col && (options?.includeDeleted || !d._deleted)).map((d) => structuredClone(d)) as Doc<T>[];
    },
    async put<T>(col: string, id: string, value: T, options?: { schema?: number }) {
      return write(col, id, structuredClone(value), options?.schema ?? 1, false);
    },
    async delete(col: string, id: string) {
      const prev = docs.get(keyOf(col, id));
      if (prev && !prev._deleted) write(col, id, prev.value, prev._schema, true);
    },
    async batch(ops: readonly BackendOp[]) {
      ensureOpen();
      const out: Doc[] = [];
      for (const op of ops) {
        if (op.kind === 'put') out.push(write(op.col, op.id, structuredClone(op.value), op.schema, false));
        else {
          const prev = docs.get(keyOf(op.col, op.id));
          if (prev && !prev._deleted) out.push(write(op.col, op.id, prev.value, prev._schema, true));
        }
      }
      return out;
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async setRelay(url) {
      relay = url;
      setStatus(url ? { ...current, state: 'synced', endpoint: url } : OFF_STATUS);
    },
    async pull() {
      ensureOpen();
      if (!hub || !relay) return { received: 0, collections: [] };
      const cols = new Set<string>();
      let received = 0;
      for (const [k, remote] of hub) {
        const local = docs.get(k);
        if (!local || local._rev < remote._rev) {
          docs.set(k, structuredClone(remote));
          received += 1;
          cols.add(remote._col);
          emit({ col: remote._col, id: remote._id, doc: structuredClone(remote), origin: 'remote' });
        }
      }
      setStatus({ ...current, state: 'synced', lastSyncedAt: new Date().toISOString() });
      return { received, collections: [...cols] };
    },
    async push() {
      ensureOpen();
      if (!hub || !relay) return { sent: 0 };
      let sent = 0;
      for (const [k, local] of docs) {
        const remote = hub.get(k);
        if (!remote || remote._rev < local._rev) {
          hub.set(k, structuredClone(local));
          sent += 1;
        }
      }
      setStatus({ ...current, state: 'synced', lastSyncedAt: new Date().toISOString() });
      return { sent };
    },
    status: () => current,
    onStatus(l) {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    async eraseLocal() {
      docs.clear();
      open = false;
      setStatus(OFF_STATUS);
    },
    link(h) {
      hub = h;
    },
  };
  return store;
}
