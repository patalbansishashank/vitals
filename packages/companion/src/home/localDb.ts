/**
 * `PersistenceBackend` on better-sqlite3 for a person's local-only collections (`persons/<id>/local.db`; R17 blocker 3):
 * the undo log, the idempotency ledger, jobs, AI usage, scores and caches survive a restart. Same semantics as
 * `src/store/memoryBackend.ts` (stamping, soft delete, the last 20 revisions as history, one feed of local changes);
 * `batch` is one SQLite transaction.
 */
import Database from 'better-sqlite3';
import { chmodSync, existsSync } from 'node:fs';
import { stampDoc, type BackendChange, type BackendDoc, type BackendOp, type PersistenceBackend } from '../../../../src/store/backend.ts';
import { createHlc } from '../../../../src/store/ids.ts';
import type { DeviceId } from '../../../../src/store/types.ts';

export interface LocalDbBackend extends PersistenceBackend {
  /** Rows currently held, deleted ones included (stats, tests). */
  size(): number;
  close(): Promise<void>;
}

const HISTORY = 20;

export function openLocalDb(file: string, options: { device: string; now?: () => number }): LocalDbBackend {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (col, id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS history (col TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (col, id, seq)) WITHOUT ROWID;
  `);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  const device = options.device;
  const clock = options.now ?? (() => Date.now());
  const hlc = createHlc(device as DeviceId);
  const q = {
    get: db.prepare<[string, string], { doc: string }>('SELECT doc FROM docs WHERE col = ? AND id = ?'),
    list: db.prepare<[string], { doc: string }>('SELECT doc FROM docs WHERE col = ?'),
    put: db.prepare<[string, string, string]>('INSERT OR REPLACE INTO docs (col, id, doc) VALUES (?, ?, ?)'),
    lastSeq: db.prepare<[string, string], { seq: number | null }>('SELECT MAX(seq) AS seq FROM history WHERE col = ? AND id = ?'),
    keep: db.prepare<[string, string, number, string]>('INSERT INTO history (col, id, seq, doc) VALUES (?, ?, ?, ?)'),
    trim: db.prepare<[string, string, number]>('DELETE FROM history WHERE col = ? AND id = ? AND seq <= ?'),
    history: db.prepare<[string, string, number], { doc: string }>('SELECT doc FROM history WHERE col = ? AND id = ? ORDER BY seq DESC LIMIT ?'),
    count: db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM docs'),
  };
  const listeners = new Set<(c: BackendChange) => void>();
  const emit = (doc: BackendDoc) => {
    for (const l of listeners) l({ col: doc._col, id: doc._id, doc: structuredClone(doc), origin: 'local' });
  };
  const read = (col: string, id: string): BackendDoc | null => {
    const row = q.get.get(col, id);
    return row ? (JSON.parse(row.doc) as BackendDoc) : null;
  };

  const write = (op: BackendOp): BackendDoc => {
    const prev = read(op.col, op.id);
    const ms = clock();
    const now = new Date(ms).toISOString();
    const doc =
      op.kind === 'put'
        ? stampDoc(prev, op.col, op.id, op.value, op.schema, hlc(ms), device, now, false)
        : stampDoc(prev, op.col, op.id, prev?.value ?? null, prev?._schema ?? 1, hlc(ms), device, now, true);
    if (prev) {
      const seq = (q.lastSeq.get(op.col, op.id)?.seq ?? 0) + 1;
      q.keep.run(op.col, op.id, seq, JSON.stringify(prev));
      q.trim.run(op.col, op.id, seq - HISTORY);
    }
    // JSON round trip = the memory backend's jsonClone (undefined fields dropped, no shared references)
    const json = JSON.stringify(doc);
    q.put.run(op.col, op.id, json);
    return JSON.parse(json) as BackendDoc;
  };
  const writeAll = db.transaction((ops: readonly BackendOp[]) => ops.map(write));

  return {
    engine: 'sqlite',
    async get<T>(col: string, id: string) {
      return read(col, id) as BackendDoc<T> | null;
    },
    async list<T>(col: string, opts: { includeDeleted?: boolean } = {}) {
      const out: BackendDoc<T>[] = [];
      for (const row of q.list.all(col)) {
        const d = JSON.parse(row.doc) as BackendDoc<T>;
        if (opts.includeDeleted || !d._deleted) out.push(d);
      }
      return out;
    },
    async put<T>(col: string, id: string, value: T, opts: { schema?: number } = {}) {
      const doc = writeAll([{ kind: 'put', col, id, value, schema: opts.schema ?? 1 }])[0]!;
      emit(doc);
      return doc as BackendDoc<T>;
    },
    async delete(col: string, id: string) {
      if (!read(col, id)) return;
      emit(writeAll([{ kind: 'delete', col, id }])[0]!);
    },
    async batch(ops: readonly BackendOp[]) {
      const docs = writeAll(ops);
      docs.forEach(emit);
      return docs.map((d) => structuredClone(d));
    },
    async history<T>(col: string, id: string, limit: number) {
      return q.history.all(col, id, limit).map((r) => JSON.parse(r.doc) as BackendDoc<T>);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async erase() {
      db.exec('DELETE FROM docs; DELETE FROM history;');
    },
    size: () => q.count.get()!.n,
    async close() {
      listeners.clear();
      if (db.open) db.close();
    },
  };
}
