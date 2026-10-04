/**
 * Blob path (R7 §3): the app's bytes-level chunk store (`chunkStore.ts`, I1) with its IndexedDB index, the memory /
 * OPFS / IndexedDB / endpoint byte backends, and E11's samples-level store and codec (Companion tests and the spike).
 */
export { chunkAad, chunkIdOf, createChunkStore, createMemoryChunkIndex, type BlobPurpose, type ChunkIndex, type ChunkMeta, type ChunkRemote, type ChunkStore, type ChunkStoreOptions } from './chunkStore';
export { BLOB_DATABASE, openBlobDb, type BlobDb } from './idb';
export { CODEC_VERSION, decodeChunk, decodeSamples, encodeChunk, encodeSamples, type DecodedSamples, type Samples } from './codec';
export { CHUNK_ID_RE } from './ids';
export { createMemoryBlobBackend, type MemoryBlobBackend } from './memory';
export { createOpfsBlobBackend, openOpfsBlobBackend } from './opfs';
export { BlobEndpointError, createRemoteBlobBackend, normalizeBlobBaseUrl, type BlobErrorCode, type RemoteBlobBackendOptions } from './remote';
export { blobAad, BLOB_SCHEMA_VERSION, chunkIdFor, createBlobStore, MAX_CHUNK_BYTES, type BlobStoreOptions } from './store';
