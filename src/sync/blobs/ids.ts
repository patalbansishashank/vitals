/** Chunk ids and owner hashes are 22 base64url characters (132 bits); nothing else ever reaches a path or URL. */
export const CHUNK_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function assertChunkId(chunkId: string): void {
  if (!CHUNK_ID_RE.test(chunkId)) throw new Error(`Invalid chunk id: ${JSON.stringify(chunkId).slice(0, 40)}`);
}
