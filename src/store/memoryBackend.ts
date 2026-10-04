/**
 * In-memory `PersistenceBackend`: tests, Node and private windows. `remote()` simulates a merged remote change so the
 * sync path (watch → projection) can be tested without an engine.
 */
import { stampDoc, type BackendChange, type BackendDoc, type BackendOp, type PersistenceBackend } from './backend';
import { createHlc, newDeviceId } from './ids';
import { jsonClone } from './json';

export interface MemoryBackend extends PersistenceBackend {
  /** Merge a document as if it arrived from another device (last writer wins by `_rev`). */
  remote(doc: BackendDoc): void;
  /** Rows currently held (tests). */
  size(): number;
}

const keyOf = (col: string, id: string) => `${col}\u0000${id}`;

export function createMemoryBackend(options: { device?: string; now?: () => number } = {}): MemoryBackend {
  const device = options.device ?? newDeviceId();
  const clock = options.now ?? (() => Date.now());
  const hlc = createHlc(device);
  const rows = new Map<string, BackendDoc>();
  const history = new Map<string, BackendDoc[]>();
  const listeners = new Set<(c: BackendChange) => void>();
  const emit = (c: BackendChange) => {
    for (const l of listeners) l(c);
  };

  const keep = (k: string, prev: BackendDoc | undefined) => {
    if (!prev) return;
    const h = history.get(k) ?? [];
    h.unshift(prev);
    if (h.length > 20) h.length = 20;
    history.set(k, h);
  };

  const write = (op: BackendOp): BackendDoc => {
    const k = keyOf(op.col, op.id);
    const prev = rows.get(k);
    const ms = clock();
    const now = new Date(ms).toISOString();
    const doc =
      op.kind === 'put'
        ? stampDoc(prev, op.col, op.id, jsonClone(op.value), op.schema, hlc(ms), device, now, false)
        : stampDoc(prev, op.col, op.id, prev?.value ?? null, prev?._schema ?? 1, hlc(ms), device, now, true);
    keep(k, prev);
    rows.set(k, doc);
    return doc;
  };

  const backend: MemoryBackend = {
    engine: 'memory',
    async get<T>(col: string, id: string) {
      const d = rows.get(keyOf(col, id));
      return d ? (jsonClone(d) as BackendDoc<T>) : null;
    },
    async list<T>(col: string, opts: { includeDeleted?: boolean } = {}) {
      const out: BackendDoc<T>[] = [];
      for (const d of rows.values()) if (d._col === col && (opts.includeDeleted || !d._deleted)) out.push(jsonClone(d) as BackendDoc<T>);
      return out;
    },
    async put<T>(col: string, id: string, value: T, opts: { schema?: number } = {}) {
      const doc = write({ kind: 'put', col, id, value, schema: opts.schema ?? 1 });
      emit({ col, id, doc: jsonClone(doc), origin: 'local' });
      return jsonClone(doc) as BackendDoc<T>;
    },
    async delete(col: string, id: string) {
      if (!rows.has(keyOf(col, id))) return;
      const doc = write({ kind: 'delete', col, id });
      emit({ col, id, doc: jsonClone(doc), origin: 'local' });
    },
    async batch(ops: readonly BackendOp[]) {
      const docs = ops.map(write);
      docs.forEach((d) => emit({ col: d._col, id: d._id, doc: jsonClone(d), origin: 'local' }));
      return docs.map((d) => jsonClone(d));
    },
    async history<T>(col: string, id: string, limit: number) {
      return (history.get(keyOf(col, id)) ?? []).slice(0, limit).map((d) => jsonClone(d) as BackendDoc<T>);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async erase() {
      rows.clear();
      history.clear();
    },
    remote(doc) {
      const k = keyOf(doc._col, doc._id);
      const prev = rows.get(k);
      if (prev && prev._rev >= doc._rev) return; // older than ours: the loser stays in history only
      keep(k, prev);
      rows.set(k, jsonClone(doc));
      emit({ col: doc._col, id: doc._id, doc: jsonClone(doc), origin: 'remote' });
    },
    size: () => rows.size,
  };
  return backend;
}
