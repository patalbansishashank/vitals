/**
 * Immutable encrypted chunk store (R7 §3): encode → gzip → AEAD, local cache first, remote endpoint second.
 *
 *   contentHash = base64url(SHA-256(uncompressed v1 encoding))            deterministic across browsers (gzip is not)
 *   chunkId     = base64url(HMAC(K_blobid, source‖0‖metric‖0‖hourStartUtc‖0‖contentHash))[0..22]
 *   sealed      = keys.blob.seal(gzip(encoding), aad = `${chunkId}|1`)
 *
 * The manifest row goes through the SyncStore (collection `bioChunks`, id = chunkId); bytes never touch the CRDT.
 * The upload queue lives in memory: chunks put in a session are uploaded by `flush()`.
 *
 * I1: the app does not use this samples-level store. E10's own chunk codec is the payload and the app's blob store is
 * E4's bytes-level `BlobStore` (`./chunkStore.ts`); this one stays for the Companion's tests and `pnpm spike:sync`.
 */
import { sha256, toBase64Url } from '../crypto';
import { BLOB_MANIFEST_COLLECTION, type BlobBackend, type BlobKey, type BlobManifest, type SampleBlobStore, type SyncStore, type VitalsKeys } from '../types';
import { decodeChunk, encodeSamples, gzip, quantize } from './codec';
import { assertChunkId } from './ids';

export const BLOB_SCHEMA_VERSION = 1;
/** Callers split larger chunks (R7 §3 target ≤ 256 KB). */
export const MAX_CHUNK_BYTES = 256 * 1024;
const HOUR_MS = 3_600_000;
const enc = new TextEncoder();

export interface BlobStoreOptions {
  keys: VitalsKeys;
  manifests: SyncStore;
  local: BlobBackend;
  remote: BlobBackend | null;
  now?: () => Date;
  concurrency?: number;
}

export const blobAad = (chunkId: string) => `${chunkId}|${BLOB_SCHEMA_VERSION}`;

function hourStartMs(key: BlobKey): number {
  for (const [name, value] of [['source', key.source], ['metric', key.metric]] as const) {
    if (typeof value !== 'string' || value === '' || value.includes('\u0000')) throw new Error(`Invalid blob key ${name}.`);
  }
  const ms = Date.parse(key.hourStartUtc);
  if (!Number.isFinite(ms) || ms % HOUR_MS !== 0 || new Date(ms).toISOString() !== key.hourStartUtc) {
    throw new Error(`hourStartUtc must be an exact UTC hour like 2026-10-01T14:00:00.000Z (got ${key.hourStartUtc}).`);
  }
  return ms;
}

/** Derive the content-blind chunk id. */
export async function chunkIdFor(keys: VitalsKeys, key: BlobKey, contentHash: string): Promise<string> {
  const message = enc.encode(`${key.source}\u0000${key.metric}\u0000${key.hourStartUtc}\u0000${contentHash}`);
  return toBase64Url(await keys.blobId(message)).slice(0, 22);
}

export function createBlobStore({ keys, manifests, local, remote, now = () => new Date(), concurrency = 8 }: BlobStoreOptions): SampleBlobStore {
  const queue = new Set<string>();
  let flushing: Promise<number> | null = null;

  const fetchSealed = async (chunkId: string): Promise<{ sealed: Uint8Array; fromRemote: boolean }> => {
    assertChunkId(chunkId);
    const cached = await local.get(chunkId);
    if (cached) return { sealed: cached, fromRemote: false };
    const fetched = remote ? await remote.get(chunkId) : null;
    if (!fetched) throw new Error(`Chunk ${chunkId} is not stored locally${remote ? ' or on the endpoint' : ''}.`);
    return { sealed: fetched, fromRemote: true };
  };

  const open = async (chunkId: string, sealed: Uint8Array) => {
    try {
      return await keys.blob.open(sealed, blobAad(chunkId));
    } catch {
      throw new Error(`Chunk ${chunkId} failed authentication (tampered, or stored under another id).`);
    }
  };

  const uploadOne = async (chunkId: string): Promise<boolean> => {
    const sealed = await local.get(chunkId);
    if (!sealed) {
      queue.delete(chunkId);
      return false;
    }
    await remote!.put(chunkId, sealed);
    queue.delete(chunkId);
    return true;
  };

  const runFlush = async (): Promise<number> => {
    if (!remote) return 0;
    const ids = [...queue];
    let next = 0;
    let uploaded = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          if (await uploadOne(id)) uploaded++;
        } catch {
          // Stays queued for the next flush.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
    return uploaded;
  };

  return {
    async put(key, samples, options = {}) {
      const start = hourStartMs(key);
      const { t, v } = samples;
      for (let i = 0; i < t.length; i++) {
        const ti = t[i]!;
        if (!(ti >= start && ti < start + HOUR_MS)) throw new Error(`Sample ${i} lies outside the hour starting ${key.hourStartUtc}.`);
      }
      const scale = options.scale ?? 1;
      const plain = encodeSamples(samples, scale);
      const contentHash = toBase64Url(await sha256(plain));
      const chunkId = await chunkIdFor(keys, key, contentHash);
      const compressed = await gzip(plain);
      if (compressed.length > MAX_CHUNK_BYTES) {
        throw new Error(`Chunk too large (${compressed.length} bytes compressed, limit ${MAX_CHUNK_BYTES}); split the samples into smaller chunks.`);
      }
      const sealed = await keys.blob.seal(compressed, blobAad(chunkId));
      await local.put(chunkId, sealed);

      const s = Math.fround(scale);
      let min = Infinity;
      let max = -Infinity;
      for (const q of quantize(v, scale)) {
        min = Math.min(min, q / s);
        max = Math.max(max, q / s);
      }
      const manifest: BlobManifest = {
        source: key.source,
        metric: key.metric,
        hourStartUtc: key.hourStartUtc,
        chunkId,
        n: t.length,
        min,
        max,
        bytes: sealed.length,
        contentHash,
        schemaVersion: BLOB_SCHEMA_VERSION,
        createdAt: now().toISOString(),
        ...(options.supersedes ? { supersedes: options.supersedes } : {}),
      };
      const existing = await manifests.get<BlobManifest>(BLOB_MANIFEST_COLLECTION, chunkId);
      const row = existing && !existing._deleted ? existing.value : (await manifests.put(BLOB_MANIFEST_COLLECTION, chunkId, manifest)).value;
      if (remote) queue.add(chunkId);
      return row;
    },

    async get(chunkId) {
      const { sealed, fromRemote } = await fetchSealed(chunkId);
      const plain = await open(chunkId, sealed);
      if (fromRemote) await local.put(chunkId, sealed);
      return decodeChunk(plain);
    },

    async getSealed(chunkId) {
      const { sealed, fromRemote } = await fetchSealed(chunkId);
      if (fromRemote) {
        await open(chunkId, sealed);
        await local.put(chunkId, sealed);
      }
      return sealed;
    },

    hasLocal: (chunkId) => local.has(chunkId),

    async evictLocal(before) {
      if (!remote) return 0;
      if (!local.delete) throw new Error('The local blob backend cannot delete.');
      const limit = Date.parse(before);
      if (!Number.isFinite(limit)) throw new Error(`Invalid instant: ${before}`);
      let evicted = 0;
      for (const doc of await manifests.list<BlobManifest>(BLOB_MANIFEST_COLLECTION)) {
        const { chunkId, hourStartUtc } = doc.value;
        if (!(Date.parse(hourStartUtc) < limit) || queue.has(chunkId)) continue;
        if (!(await local.has(chunkId)) || !(await remote.has(chunkId))) continue;
        await local.delete(chunkId);
        evicted++;
      }
      return evicted;
    },

    flush() {
      flushing ??= runFlush().finally(() => {
        flushing = null;
      });
      return flushing;
    },

    pending: () => queue.size,
  };
}
