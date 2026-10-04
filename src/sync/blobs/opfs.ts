/**
 * Origin Private File System backend: `<dir>/<first 2 chars>/<chunkId>`, create-only. `createWritable` writes to a
 * swap file and commits on close, so a crash never leaves a half-written chunk under its final name.
 */
import type { BlobBackend } from '../types';
import { assertChunkId, CHUNK_ID_RE } from './ids';

/** The slice of the File System Access API this backend uses (keeps the in-memory test fake small). */
interface Dir {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Dir>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  keys?(): AsyncIterable<string>;
}

interface FileHandle {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable?(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}

const isNotFound = (e: unknown) => (e as { name?: string } | null)?.name === 'NotFoundError' || (e as { name?: string } | null)?.name === 'TypeMismatchError';

export function createOpfsBlobBackend(root: FileSystemDirectoryHandle, dirName = 'vitals-blobs'): Required<BlobBackend> {
  let base: Promise<Dir> | null = null;
  const baseDir = () => (base ??= (root as unknown as Dir).getDirectoryHandle(dirName, { create: true }));
  const shard = async (chunkId: string, create: boolean): Promise<Dir | null> => {
    assertChunkId(chunkId);
    try {
      return await (await baseDir()).getDirectoryHandle(chunkId.slice(0, 2), { create });
    } catch (e) {
      if (!create && isNotFound(e)) return null;
      throw e;
    }
  };
  const file = async (chunkId: string): Promise<FileHandle | null> => {
    const dir = await shard(chunkId, false);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(chunkId);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  };

  return {
    async put(chunkId, sealed) {
      if (await file(chunkId)) return 'exists';
      const handle = await (await shard(chunkId, true))!.getFileHandle(chunkId, { create: true });
      if (!handle.createWritable) throw new Error('This browser cannot write OPFS files from this context (no createWritable).');
      const writable = await handle.createWritable();
      try {
        await writable.write(sealed.slice());
        await writable.close();
      } catch (e) {
        await writable.abort?.().catch(() => undefined);
        throw e;
      }
      return 'created';
    },
    async get(chunkId) {
      const handle = await file(chunkId);
      return handle ? new Uint8Array(await (await handle.getFile()).arrayBuffer()) : null;
    },
    async has(chunkId) {
      return (await file(chunkId)) !== null;
    },
    async delete(chunkId) {
      const dir = await shard(chunkId, false);
      try {
        await dir?.removeEntry(chunkId);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
    async list() {
      const dir = await baseDir();
      if (!dir.keys) throw new Error('This browser cannot list OPFS directories.');
      const out: string[] = [];
      for await (const prefix of dir.keys()) {
        const sub = await dir.getDirectoryHandle(prefix).catch(() => null);
        if (!sub?.keys) continue;
        for await (const name of sub.keys()) if (CHUNK_ID_RE.test(name)) out.push(name);
      }
      return out;
    },
  };
}

/** OPFS backend on `navigator.storage.getDirectory()`; throws a clear error where OPFS is unavailable. */
export async function openOpfsBlobBackend(dirName = 'vitals-blobs'): Promise<Required<BlobBackend>> {
  const storage = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } } }).navigator?.storage;
  if (typeof storage?.getDirectory !== 'function') {
    throw new Error('The Origin Private File System is not available here (needs a secure context in a current browser).');
  }
  return createOpfsBlobBackend(await storage.getDirectory(), dirName);
}
