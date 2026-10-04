/**
 * Vitals-owned key schedule (R7 §7.2, SUITE_SPEC §2.6) on WebCrypto, so it runs unchanged in browsers and Node 22.
 *
 *   PRK         = HKDF-Extract(salt = "vitals/sync/v1", IKM = secret)            SHA-256
 *   K_blob      = HKDF-Expand(PRK, "blob-aead", 32)
 *   K_blobid    = HKDF-Expand(PRK, "blob-id", 32)
 *   K_auth      = HKDF-Expand(PRK, "endpoint-auth", 32)                          bearer for /blobs
 *   ownerIdHash = base64url(SHA-256("vitals-owner" ‖ ownerId))[0..22]
 *
 * Blob AEAD is AES-GCM-256 (WebCrypto, no extra dependency). R7 chose XChaCha20 because 96-bit random nonces bound
 * one AES-GCM key to about 2^32 messages; here every chunk gets its own subkey,
 * `HKDF-Expand(K_blob, "chunk:" ‖ aad)`, and the AAD carries the chunk id, so each key seals exactly one message and
 * the nonce bound does not apply. Sealed layout: `0x01 ‖ nonce(12) ‖ ciphertext‖tag(16)`.
 */
import type { Encryptor, VitalsKeys } from './types';

const SEALED_VERSION = 1;
const NONCE_BYTES = 12;
const enc = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is unavailable (needs a secure context: https or localhost).');
  return s;
}

/** ArrayBuffer-backed copy, as WebCrypto's BufferSource typing wants. */
export function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url.');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest('SHA-256', buf(bytes)));
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await subtle().importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, buf(message)));
}

/** RFC 5869 Extract. */
export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return hmacSha256(salt, ikm);
}

/** RFC 5869 Expand (L ≤ 32·255). */
export async function hkdfExpand(prk: Uint8Array, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(length);
  let prev: Uint8Array = new Uint8Array(0);
  const infoBytes = enc.encode(info);
  for (let i = 0, o = 0; o < length; i++) {
    prev = await hmacSha256(prk, concatBytes(prev, infoBytes, new Uint8Array([i + 1])));
    out.set(prev.subarray(0, Math.min(prev.length, length - o)), o);
    o += prev.length;
  }
  return out;
}

export interface RawKeys {
  blob: Uint8Array;
  blobId: Uint8Array;
  auth: Uint8Array;
}

export async function deriveRawKeys(secret: Uint8Array): Promise<RawKeys> {
  if (secret.length !== 32) throw new Error('The owner secret must be 32 bytes.');
  const prk = await hkdfExtract(enc.encode('vitals/sync/v1'), secret);
  const [blob, blobId, auth] = await Promise.all([hkdfExpand(prk, 'blob-aead', 32), hkdfExpand(prk, 'blob-id', 32), hkdfExpand(prk, 'endpoint-auth', 32)]);
  return { blob, blobId, auth };
}

export async function ownerIdHashOf(ownerId: string): Promise<string> {
  return toBase64Url(await sha256(enc.encode(`vitals-owner${ownerId}`))).slice(0, 22);
}

/** The endpoint's stored verifier for a bearer token: base64url(SHA-256(K_auth)). */
export async function authVerifier(authToken: string): Promise<string> {
  return toBase64Url(await sha256(fromBase64Url(authToken)));
}

/** AES-GCM with a per-message subkey `HKDF-Expand(key, "chunk:" ‖ aad, 32)`; the AAD is also authenticated. */
export function createAesGcmEncryptor(key: Uint8Array): Encryptor {
  const keyCopy = buf(key);
  const subkey = async (aad: string, usage: KeyUsage) =>
    subtle().importKey('raw', await hkdfExpand(keyCopy, `chunk:${aad}`, 32), { name: 'AES-GCM' }, false, [usage]);
  return {
    async seal(plain, aad) {
      const nonce = randomBytes(NONCE_BYTES);
      const ct = await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, await subkey(aad, 'encrypt'), buf(plain));
      return concatBytes(new Uint8Array([SEALED_VERSION]), nonce, new Uint8Array(ct));
    },
    async open(sealed, aad) {
      if (sealed.length < 1 + NONCE_BYTES + 16 || sealed[0] !== SEALED_VERSION) throw new Error('Not a sealed Vitals blob.');
      const nonce = sealed.slice(1, 1 + NONCE_BYTES);
      const pt = await subtle().decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) },
        await subkey(aad, 'decrypt'),
        buf(sealed.subarray(1 + NONCE_BYTES)),
      );
      return new Uint8Array(pt);
    },
  };
}

/** Everything the blob path and the endpoint need, from the owner secret and the engine's owner id. */
export async function deriveVitalsKeys(secret: Uint8Array, ownerId: string): Promise<VitalsKeys> {
  const raw = await deriveRawKeys(secret);
  return {
    blob: createAesGcmEncryptor(raw.blob),
    blobId: (message) => hmacSha256(raw.blobId, message),
    authToken: toBase64Url(raw.auth),
    ownerIdHash: await ownerIdHashOf(ownerId),
  };
}
