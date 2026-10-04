/**
 * A person's raw-sample bytes on disk (R17 blocker 2): a create-only file `BlobBackend` under `persons/<id>/blobs/`
 * (`<first 2 chars>/<chunkId>`, written to a temporary name and renamed, so a crash never leaves a half chunk under its
 * final name) and the chunk index in `blobs/index.db` (better-sqlite3). Together they make the app's `ChunkStore`
 * (`src/sync/blobs/chunkStore.ts`), which seals and uploads to the relay's `/blobs` like a browser's.
 */
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createChunkStore, type ChunkIndex, type ChunkMeta, type ChunkStore } from '../../../../src/sync/blobs/chunkStore.ts';
import { assertChunkId, CHUNK_ID_RE } from '../../../../src/sync/blobs/ids.ts';
import type { BlobBackend } from '../../../../src/sync/types.ts';

const mkdir0700 = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
};

export function createFileBlobBackend(dir: string): Required<BlobBackend> {
  mkdir0700(dir);
  const pathOf = (chunkId: string) => {
    assertChunkId(chunkId);
    return join(dir, chunkId.slice(0, 2), chunkId);
  };
  return {
    async put(chunkId, bytes) {
      const file = pathOf(chunkId);
      if (existsSync(file)) return 'exists';
      mkdir0700(join(dir, chunkId.slice(0, 2)));
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' });
      await rename(tmp, file);
      return 'created';
    },
    async get(chunkId) {
      try {
        return new Uint8Array(await readFile(pathOf(chunkId)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async has(chunkId) {
      return existsSync(pathOf(chunkId));
    },
    async delete(chunkId) {
      await rm(pathOf(chunkId), { force: true });
    },
    async list() {
      const out: string[] = [];
      for (const shard of readdirSync(dir, { withFileTypes: true })) {
        if (!shard.isDirectory()) continue;
        for (const name of readdirSync(join(dir, shard.name))) if (CHUNK_ID_RE.test(name)) out.push(name);
      }
      return out;
    },
  };
}

export function openSqliteChunkIndex(file: string): ChunkIndex & { close(): void } {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS chunks (chunkId TEXT PRIMARY KEY, meta TEXT NOT NULL) WITHOUT ROWID');
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  const get = db.prepare<[string], { meta: string }>('SELECT meta FROM chunks WHERE chunkId = ?');
  const put = db.prepare<[string, string]>('INSERT OR REPLACE INTO chunks (chunkId, meta) VALUES (?, ?)');
  const list = db.prepare<[], { meta: string }>('SELECT meta FROM chunks');
  const del = db.prepare<[string]>('DELETE FROM chunks WHERE chunkId = ?');
  return {
    async get(chunkId) {
      const row = get.get(chunkId);
      return row ? (JSON.parse(row.meta) as ChunkMeta) : null;
    },
    async put(meta) {
      put.run(meta.chunkId, JSON.stringify(meta));
    },
    async list() {
      return list.all().map((r) => JSON.parse(r.meta) as ChunkMeta);
    },
    async delete(chunkId) {
      del.run(chunkId);
    },
    async clear() {
      db.exec('DELETE FROM chunks');
    },
    close() {
      if (db.open) db.close();
    },
  };
}

/** The person's chunk store: bytes in `<blobsDir>/`, index in `<blobsDir>/index.db`. */
export function openFileChunkStore(blobsDir: string): { store: ChunkStore; close(): void } {
  mkdir0700(blobsDir);
  const index = openSqliteChunkIndex(join(blobsDir, 'index.db'));
  return { store: createChunkStore({ bytes: createFileBlobBackend(blobsDir), index }), close: () => index.close() };
}
