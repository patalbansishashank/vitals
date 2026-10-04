/**
 * Sync engine contracts (SUITE_SPEC §2.4, §2.6; R7 §7, §8).
 *
 * Tier H: no DOM, no React, no app state. Every implementation runs in the browser main thread, in a worker and in
 * Node 22 (the Companion and the two-device tests). IO arrives through injected ports (`NetPort`, `BlobBackend`).
 *
 * E4's interfaces in `src/store` are canonical: `SyncStatus`, `Encryptor`, the bytes-level `BlobStore`, `SyncTarget`
 * and the base `PairingCode` are re-exported from there, and an engine store is an E4 `PersistenceBackend`
 * (`SyncStore extends PersistenceBackend`), so an opened Evolu store plugs into `installPersistenceBackend` unchanged.
 * This file adds only what the sync engine needs on top: open/close, the relay, rounds, keys, the samples-level chunk
 * store E11 built for the spike, the network port and the pairing config.
 *
 * Imports stay relative and reach only the two leaf files of `src/store` (`types.ts`, `backend.ts`), because the
 * Companion package type-checks `src/sync` without the app's `@/` alias.
 */
import type { BackendChange, BackendDoc, PersistenceBackend } from '../store/backend';
import type { DeviceId, Encryptor, Instant, PairingCode as StorePairingCode, SyncStatus } from '../store/types';

export type { BackendChange, BackendDoc, BackendOp, PersistenceBackend } from '../store/backend';
export type { BlobStore, DeviceId, Encryptor, Instant, LocalDate, SyncState, SyncStatus, SyncTarget } from '../store/types';
export { SYNC_OFF, SYNC_OFF as OFF_STATUS } from '../store/types';

/** An engine row: `DocMeta & { value }` (E4's `BackendDoc`; E11 called it `Doc`). */
export type Doc<T = unknown> = BackendDoc<T>;
/** A local write or a merged remote change (E4's `BackendChange`). */
export type DocChange = BackendChange;

/** Legacy phase-1 collection of E11's spike (one document per former `vitals.*` key). The app no longer writes it. */
export const KV_COLLECTION = 'kv';
/** Manifest rows of raw-sample chunks (bytes live in the blob store). */
export const BLOB_MANIFEST_COLLECTION = 'bioChunks';

/** Keys Vitals derives itself from the owner secret (R7 §7.2), separate from Evolu's SLIP-21 tree. */
export interface VitalsKeys {
  /** AEAD for blobs (AES-GCM-256, per-chunk subkey, see `crypto.ts`). */
  blob: Encryptor;
  /** HMAC-SHA256 under K_blobid (E11's samples-level chunk ids). */
  blobId(message: Uint8Array): Promise<Uint8Array>;
  /** Bearer for `/blobs`, base64url of K_auth. The endpoint stores only SHA-256 of it. */
  authToken: string;
  /** base64url(SHA-256("vitals-owner" ‖ ownerId))[0..22]; names the owner's blob directory on the endpoint. */
  ownerIdHash: string;
}

export interface OpenOptions {
  /** 32 random bytes (the pairing secret). */
  secret: Uint8Array;
  /** `wss://host[:port][/sync]`, `https://…` (converted to wss) or null for local-only. */
  relayUrl: string | null;
  deviceId: DeviceId;
  /** Keep the database in memory (tests, private windows). */
  memoryOnly?: boolean;
}

export interface ListOptions {
  includeDeleted?: boolean;
}

/**
 * A sync-capable engine (R7 §10.1 `SyncStore`; SUITE_SPEC §2.6 `SyncAdapter`, engine side). It is an E4
 * `PersistenceBackend` (get/list/put/delete/subscribe over `BackendDoc`, optional batch/eraseLocal/close) plus the
 * sync controls. Implementations: `createEvoluSyncStore` (production) and `createMemorySyncStore` (tests, reference).
 */
export interface SyncStore extends PersistenceBackend {
  readonly engine: 'evolu' | 'pouchdb' | 'memory';
  readonly capabilities: { live: boolean; history: boolean; maxRowBytes: number };
  open(options: OpenOptions): Promise<void>;
  /** Stops syncing and releases the database; the data stays on the device. */
  close(): Promise<void>;
  readonly isOpen: boolean;

  /** Change or clear the relay without reopening (null = local only). */
  setRelay(url: string | null): Promise<void>;
  /** Drop the current relay connection and open a fresh one now (network back, "Sync now"); no-op without a relay. */
  reconnect?(): Promise<void>;
  /** Ask the relay for anything missing. Resolves when a round completed or failed (never rejects for network errors). */
  pull(): Promise<{ received: number; collections: string[] }>;
  /** Send local changes the relay has not acknowledged (Evolu: the same RBSR round as pull). */
  push(): Promise<{ sent: number }>;
  status(): SyncStatus;
  onStatus(listener: (status: SyncStatus) => void): () => void;

  /** Encryption hooks derived from the owner secret; null before `open`. */
  readonly keys: VitalsKeys | null;
  /** Deletes the local database (Erase this device). Never touches the relay. */
  eraseLocal(): Promise<void>;
}

/** Fetch/WebSocket port. The browser passes `src/net/net.ts` (allowlisted); Node passes the globals. */
export interface NetPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Throws if the URL is not allowed (browser allowlist). Engines call it before handing a URL to their own socket. */
  assertAllowed(url: string): void;
}

/** E11's samples-level chunk identity: one chunk per source × metric × UTC hour (R7 §3). */
export interface BlobKey {
  source: string;
  metric: string;
  /** ISO UTC, truncated to the hour: `2026-10-01T14:00:00.000Z`. */
  hourStartUtc: Instant;
}

/** Manifest row of E11's samples-level store (collection `bioChunks`, id = chunkId). */
export interface BlobManifest extends BlobKey {
  chunkId: string;
  n: number;
  min: number;
  max: number;
  /** Encrypted size in bytes. */
  bytes: number;
  /** base64url SHA-256 of the plaintext chunk. */
  contentHash: string;
  schemaVersion: 1;
  createdAt: Instant;
  supersedes?: string;
}

/**
 * E11's samples-level chunk store (encode → gzip → AEAD, manifest row in `bioChunks`). The app uses E4's bytes-level
 * `BlobStore` instead (E10's chunk codec is the payload, `./blobs/chunkStore.ts`); this one stays for the Companion's
 * tests and the spike.
 */
export interface SampleBlobStore {
  put(key: BlobKey, samples: { t: ArrayLike<number>; v: ArrayLike<number> }, options?: { scale?: number; supersedes?: string }): Promise<BlobManifest>;
  get(chunkId: string): Promise<{ t: Float64Array; v: Float64Array }>;
  getSealed(chunkId: string): Promise<Uint8Array>;
  hasLocal(chunkId: string): Promise<boolean>;
  evictLocal(before: Instant): Promise<number>;
  flush(): Promise<number>;
  pending(): number;
}

/** Byte storage for chunks (OPFS, IndexedDB, memory, the endpoint). Create-only: `put` of an existing id is a no-op. */
export interface BlobBackend {
  put(chunkId: string, bytes: Uint8Array): Promise<'created' | 'exists'>;
  get(chunkId: string): Promise<Uint8Array | null>;
  has(chunkId: string): Promise<boolean>;
  delete?(chunkId: string): Promise<void>;
  list?(): Promise<string[]>;
}

/* ---------------------------------------------------------------------------
   Pairing and device configuration (SUITE_SPEC §2.6, UI side)
   --------------------------------------------------------------------------- */

/** What "Show pairing code" displays: E4's `{ uri, words }` plus the relay and the label carried in the URI. */
export interface PairingCode extends StorePairingCode {
  relayUrl: string;
  label?: string;
}

/** Device-local sync configuration (never synced, never exported; kept in the device vault). */
export interface SyncConfig {
  /** False while sync is paused on this device (paired, relay disconnected). */
  enabled: boolean;
  relayUrl: string;
  /** This device's name in the devices list. */
  label?: string;
  deviceId: DeviceId;
  pairedAt: Instant;
}

