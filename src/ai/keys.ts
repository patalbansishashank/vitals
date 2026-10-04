/**
 * KeyVault: local storage of provider API keys (R8 §7, summary item 12).
 *
 * HOW IT WORKS
 * - A random AES-GCM 256 "wrapping key" is generated once with `extractable: false` and stored in the `meta` object
 *   store as a `CryptoKey` object (IndexedDB structured clone keeps it usable; its raw bytes are never exposed to
 *   JavaScript and cannot be exported).
 * - Each API key is encrypted with that wrapping key and a fresh random 96-bit IV. The record
 *   `{presetId, origin, iv, ciphertext, createdAt}` goes to the `keys` store. The additional authenticated data is
 *   `${presetId}|${origin}`, so a record copied to another preset or edited to another origin fails to decrypt.
 * - A key is released only for the origin it was saved with: `get()` compares `new URL(baseUrl).origin` with the stored
 *   origin. Changing a preset's base URL therefore forces the key to be re-entered (`status()` → 'origin-mismatch').
 * - "This session only" keys live in memory in this object and are never persisted.
 * - `navigator.storage.persist()` is requested once, at the first device save, so eviction does not silently drop keys.
 *
 * THREAT MODEL (honest version)
 * Protects against:
 * - casual reads of the disk, browser profile or backups (the stored ciphertext is useless without the wrapping key,
 *   whose raw bytes never leave the browser's key store);
 * - leaks through export files and sync: keys are excluded from exports, and any copied IndexedDB data is ciphertext.
 * Does NOT protect against:
 * - XSS or a malicious browser extension running in this origin: such code can simply call `decrypt` (or this vault).
 *   The real protections there are a strict CSP (`script-src 'self'`), no third-party scripts, and Trusted Types
 *   where feasible;
 * - someone using the unlocked device and browser profile;
 * - local malware.
 * Rules: localStorage/sessionStorage are never used; keys are never logged, never in error messages, transcripts or
 * exports. `toString`/`toJSON`/inspection of the vault reveal nothing.
 *
 * NOT IMPLEMENTED YET (future work)
 * - Optional "Lock keys with passkey": WebAuthn PRF output → HKDF → wrapping key (feature-detected; PRF is patchy on
 *   iOS 18 and Windows), with a passphrase fallback (PBKDF2-SHA-256, 600k iterations, or Argon2id via WASM).
 * - Sync (item 18): opt-in only, inside the end-to-end-encrypted payload, re-wrapped per device.
 * - The strongest option remains the Vitals Companion holding keys in the OS keychain (127.0.0.1 proxy).
 */
import { IdbKv, type KvStore } from './storage/kv';

export type KeyMode = 'device' | 'session';
export type KeyStatus = 'none' | 'session' | 'device' | 'origin-mismatch';

export interface StoredKeyRecord {
  presetId: string;
  origin: string;
  /** 12 random bytes. */
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  createdAt: string;
}

export interface KeyListEntry {
  presetId: string;
  origin: string;
  mode: KeyMode;
  createdAt: string;
}

export interface KeyVaultOptions {
  keys: KvStore<StoredKeyRecord>;
  meta: KvStore<unknown>;
  subtle?: SubtleCrypto;
  getRandomValues?: <T extends Uint8Array<ArrayBuffer>>(array: T) => T;
  /** ISO instant, for `createdAt`. */
  now: () => string;
  /** Called once at the first device save; the browser wiring passes `() => navigator.storage.persist()`. */
  requestPersist?: () => Promise<boolean>;
}

/** Key under which the wrapping `CryptoKey` lives in the `meta` store. */
export const WRAPPING_KEY_META = 'keyVault.wrappingKey.v1';

interface SessionEntry {
  origin: string;
  apiKey: string;
  createdAt: string;
}

function originOf(baseUrl: string): string | null {
  try {
    const origin = new URL(baseUrl).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function aad(presetId: string, origin: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${presetId}|${origin}`);
}

function isCryptoKey(v: unknown): v is CryptoKey {
  return !!v && typeof v === 'object' && 'algorithm' in v && 'type' in v && 'usages' in v;
}

function isRecord(v: unknown): v is StoredKeyRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.presetId === 'string' &&
    typeof r.origin === 'string' &&
    r.iv instanceof Uint8Array &&
    r.iv.byteLength === 12 &&
    r.ciphertext instanceof ArrayBuffer &&
    typeof r.createdAt === 'string'
  );
}

export class KeyVault {
  readonly #keys: KvStore<StoredKeyRecord>;
  readonly #meta: KvStore<unknown>;
  readonly #subtle: SubtleCrypto;
  readonly #random: <T extends Uint8Array<ArrayBuffer>>(array: T) => T;
  readonly #now: () => string;
  readonly #requestPersist?: () => Promise<boolean>;
  readonly #session = new Map<string, SessionEntry>();
  #wrappingKey: Promise<CryptoKey> | null = null;
  #persistRequested = false;

  constructor(opts: KeyVaultOptions) {
    this.#keys = opts.keys;
    this.#meta = opts.meta;
    this.#subtle = opts.subtle ?? globalThis.crypto.subtle;
    this.#random = opts.getRandomValues ?? ((a) => globalThis.crypto.getRandomValues(a));
    this.#now = opts.now;
    this.#requestPersist = opts.requestPersist;
  }

  /** Loads the wrapping key, generating and storing it on first use. Concurrent callers share one key. */
  #getWrappingKey(): Promise<CryptoKey> {
    if (!this.#wrappingKey) {
      this.#wrappingKey = (async () => {
        const stored = await this.#meta.get(WRAPPING_KEY_META);
        if (isCryptoKey(stored)) return stored;
        const key = await this.#subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await this.#meta.set(WRAPPING_KEY_META, key);
        return key;
      })();
      this.#wrappingKey.catch(() => (this.#wrappingKey = null));
    }
    return this.#wrappingKey;
  }

  async save(presetId: string, baseUrl: string, apiKey: string, opts: { mode: KeyMode }): Promise<void> {
    const origin = originOf(baseUrl);
    if (!origin) throw new TypeError('The base URL is not a valid URL');
    if (!presetId) throw new TypeError('A preset id is required');
    if (!apiKey.trim()) throw new TypeError('The API key is empty');
    const createdAt = this.#now();

    if (opts.mode === 'session') {
      this.#session.set(presetId, { origin, apiKey, createdAt });
      // "Don't remember on this device" must not leave an older remembered copy behind.
      await this.#keys.delete(presetId);
      return;
    }

    const wrappingKey = await this.#getWrappingKey();
    const iv = this.#random(new Uint8Array(12));
    let ciphertext: ArrayBuffer;
    try {
      ciphertext = await this.#subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(presetId, origin) },
        wrappingKey,
        new TextEncoder().encode(apiKey),
      );
    } catch {
      throw new Error('Could not encrypt the API key on this device');
    }
    await this.#keys.set(presetId, { presetId, origin, iv, ciphertext, createdAt });
    this.#session.delete(presetId);

    if (!this.#persistRequested && this.#requestPersist) {
      this.#persistRequested = true;
      await this.#requestPersist().catch(() => false);
    }
  }

  /** The key for this preset, only when `baseUrl`'s origin equals the stored origin. Null otherwise. */
  async get(presetId: string, baseUrl: string): Promise<string | null> {
    const origin = originOf(baseUrl);
    if (!origin) return null;
    const session = this.#session.get(presetId);
    if (session) return session.origin === origin ? session.apiKey : null;

    const record = await this.#keys.get(presetId);
    if (!isRecord(record) || record.origin !== origin) return null;
    try {
      const wrappingKey = await this.#getWrappingKey();
      // AAD uses the *requested* preset id: a record copied under another preset fails authentication.
      const plain = await this.#subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv, additionalData: aad(presetId, origin) },
        wrappingKey,
        record.ciphertext,
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  async has(presetId: string, baseUrl: string): Promise<boolean> {
    const s = await this.status(presetId, baseUrl);
    return s === 'session' || s === 'device';
  }

  /** Where the key lives, or 'origin-mismatch' when the preset's base URL moved to another origin since saving. */
  async status(presetId: string, baseUrl: string): Promise<KeyStatus> {
    const origin = originOf(baseUrl);
    const session = this.#session.get(presetId);
    if (session) return session.origin === origin ? 'session' : 'origin-mismatch';
    const record = await this.#keys.get(presetId);
    if (!isRecord(record)) return 'none';
    return record.origin === origin ? 'device' : 'origin-mismatch';
  }

  async remove(presetId: string): Promise<void> {
    this.#session.delete(presetId);
    await this.#keys.delete(presetId);
  }

  /** Forgets every key and the wrapping key itself (a fresh one is generated on the next device save). */
  async clearAll(): Promise<void> {
    this.#session.clear();
    for (const k of await this.#keys.keys()) await this.#keys.delete(k);
    await this.#meta.delete(WRAPPING_KEY_META);
    this.#wrappingKey = null;
  }

  /** Metadata only; never the key. */
  async list(): Promise<KeyListEntry[]> {
    const out: KeyListEntry[] = [];
    for (const [presetId, s] of this.#session) out.push({ presetId, origin: s.origin, mode: 'session', createdAt: s.createdAt });
    for (const k of await this.#keys.keys()) {
      if (this.#session.has(k)) continue;
      const r = await this.#keys.get(k);
      if (isRecord(r)) out.push({ presetId: k, origin: r.origin, mode: 'device', createdAt: r.createdAt });
    }
    return out.sort((a, b) => a.presetId.localeCompare(b.presetId));
  }

  toString(): string {
    return '[KeyVault]';
  }

  toJSON(): { type: 'KeyVault' } {
    return { type: 'KeyVault' };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[KeyVault]';
  }
}

/** Browser wiring: IndexedDB stores plus `navigator.storage.persist()` when the browser has it. */
export function createBrowserKeyVault(factory?: IDBFactory): KeyVault {
  const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator?.storage;
  const requestPersist = typeof storage?.persist === 'function' ? () => storage.persist!() : undefined;
  return new KeyVault({
    keys: new IdbKv<StoredKeyRecord>('keys', factory),
    meta: new IdbKv<unknown>('meta', factory),
    now: () => new Date().toISOString(),
    requestPersist,
  });
}

/* ---- the app's one vault ------------------------------------------------------------------------------------- */

let shared: KeyVault | null = null;

/**
 * A shared vault (created on first use over IndexedDB) for callers that want one instance, so "this session only"
 * keys (held in memory by the instance) are visible to all of them. Not used by the app itself: Settings and the
 * Coach both use `defaultAiDeps().vault`.
 */
export function sharedKeyVault(): KeyVault {
  return (shared ??= createBrowserKeyVault());
}

/** Tests: replace the shared vault (e.g. one over `MemoryKv`), or `null` to create a fresh browser vault next time. */
export function setSharedKeyVault(vault: KeyVault | null): void {
  shared = vault;
}
