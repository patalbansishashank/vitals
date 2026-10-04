import type { BlobBackend } from '../types';
import { assertChunkId } from './ids';

export interface MemoryBlobBackend extends Required<BlobBackend> {
  /** The stored bytes, for tests that tamper with them. */
  readonly map: Map<string, Uint8Array>;
}

/** In-memory create-only backend (tests, private windows). Stores copies, so callers cannot mutate stored bytes. */
export function createMemoryBlobBackend(): MemoryBlobBackend {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async put(chunkId, sealed) {
      assertChunkId(chunkId);
      if (map.has(chunkId)) return 'exists';
      map.set(chunkId, sealed.slice());
      return 'created';
    },
    async get(chunkId) {
      return map.get(chunkId)?.slice() ?? null;
    },
    async has(chunkId) {
      return map.has(chunkId);
    },
    async delete(chunkId) {
      map.delete(chunkId);
    },
    async list() {
      return [...map.keys()];
    },
  };
}
