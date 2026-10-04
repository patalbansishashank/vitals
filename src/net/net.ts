/**
 * The only module allowed to reach the network (SUITE_SPEC §0.3, §9.1, R7 §6). ESLint bans `fetch`, `WebSocket`,
 * `EventSource` and `XMLHttpRequest` everywhere else.
 *
 * Why: the deployed CSP must allow any secure origin in `connect-src` (users enter their own AI base URLs and sync
 * endpoints), so the CSP no longer limits where data can go. This wrapper is the compensating control: every request
 * and socket is checked against a user-managed allowlist of origins, each with a purpose. Same-origin is always allowed;
 * anything else must be https/wss (http/ws only for this computer). The allowlist is device-local: stored under
 * `vitals-net.allow`, which is not a `vitals.` key, so it is never exported or synced.
 *
 * History: E9 (AI layer) and E11 (sync) each wrote a version; this is the merge. E9's API is kept as is (`allowOrigin`
 * returns a revoke function, `netFetch`, `NetBlockedError`); E11 added persistence, ws/wss handling and
 * `assertAllowed`/`netWebSocket`/`browserNet` for the sync engine.
 */
import type { NetPort } from '@/sync/types';

export type NetPurpose = 'ai' | 'sync' | 'server' | 'catalogue' | 'other';
export interface AllowedOrigin {
  origin: string;
  purposes: NetPurpose[];
}

const PURPOSES: readonly NetPurpose[] = ['ai', 'sync', 'server', 'catalogue', 'other'];
const STORAGE_KEY = 'vitals-net.allow';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Thrown (or rejected) for any target that is not allowed. `code` matches the sync layer's error convention. */
export class NetBlockedError extends Error {
  readonly origin: string;
  readonly code = 'net_not_allowed';
  constructor(origin: string, message = `Network access to ${origin} is not allowed. Add it in Settings first.`) {
    super(message);
    this.name = 'NetBlockedError';
    this.origin = origin;
  }
}

let allowed: Map<string, Set<NetPurpose>> | null = null;

function selfOrigin(): string | null {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin && loc.origin !== 'null' ? loc.origin : null;
}

function parse(url: string | URL): URL | null {
  try {
    return new URL(String(url), selfOrigin() ?? undefined);
  } catch {
    return null;
  }
}

/**
 * Normalised origin of a URL: `wss://Host:443/x` → `https://host`, `ws://localhost:80` → `http://localhost`.
 * Null for anything that cannot be parsed or is not http(s)/ws(s).
 */
export function originOf(url: string | URL): string | null {
  const u = parse(url);
  if (!u) return null;
  const scheme = ({ 'http:': 'http:', 'ws:': 'http:', 'https:': 'https:', 'wss:': 'https:' } as Record<string, string>)[u.protocol];
  if (!scheme) return null;
  const port = u.port && u.port !== (scheme === 'https:' ? '443' : '80') ? `:${u.port}` : '';
  return `${scheme}//${u.hostname.toLowerCase()}${port}`;
}

/** E11's name for `originOf`. */
export const normalizeOrigin = originOf;

/** https/wss anywhere; http/ws only for loopback. */
function secureEnough(origin: string): boolean {
  if (origin.startsWith('https://')) return true;
  return LOOPBACK.has(new URL(origin).hostname);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, Set<NetPurpose>> {
  if (allowed) return allowed;
  allowed = new Map();
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as AllowedOrigin[]) : [];
    for (const e of Array.isArray(list) ? list : []) {
      const origin = typeof e?.origin === 'string' ? originOf(e.origin) : null;
      if (origin && Array.isArray(e.purposes)) {
        const set = new Set(e.purposes.filter((p) => PURPOSES.includes(p)));
        if (set.size) allowed.set(origin, set);
      }
    }
  } catch {
    // unreadable storage: start empty
  }
  return allowed;
}

function save(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(listAllowed()));
  } catch {
    // private mode / quota: the allowlist still works for this session
  }
}

/**
 * Allow requests to `originOrUrl`'s origin for `purpose`. Returns a function that revokes exactly this grant.
 * Throws `NetBlockedError` for anything that is not a URL or is plain http to another machine.
 */
export function allowOrigin(originOrUrl: string, purpose: NetPurpose): () => void {
  const origin = originOf(originOrUrl);
  if (!origin || !secureEnough(origin)) {
    throw new NetBlockedError(origin ?? originOrUrl, `Vitals only connects to https:// addresses (http:// only on this computer): ${originOrUrl}`);
  }
  const map = load();
  const set = map.get(origin) ?? new Set<NetPurpose>();
  set.add(purpose);
  map.set(origin, set);
  save();
  return () => revokeOrigin(origin, purpose);
}

/** Removes one purpose (or all of them); the origin is dropped when no purpose is left. */
export function revokeOrigin(url: string, purpose?: NetPurpose): void {
  const origin = originOf(url);
  const map = load();
  const set = origin ? map.get(origin) : undefined;
  if (!origin || !set) return;
  if (purpose) set.delete(purpose);
  if (!purpose || set.size === 0) map.delete(origin);
  save();
}

export function isAllowed(url: string | URL): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  const self = selfOrigin();
  if (self && origin === originOf(self)) return true;
  return secureEnough(origin) && load().has(origin);
}

export function listAllowed(): AllowedOrigin[] {
  return [...load()].map(([origin, p]) => ({ origin, purposes: [...p] }));
}

/** Throws `NetBlockedError` unless `url` may be reached. Engines call it before handing a URL to their own socket. */
export function assertAllowed(url: string | URL): void {
  if (!isAllowed(url)) {
    const origin = originOf(url) ?? String(url);
    throw new NetBlockedError(origin, `Vitals isn't allowed to connect to ${origin}.`);
  }
}

/** `fetch` with the allowlist check. Signature-compatible with `fetch` so it can be injected as a port. */
export const netFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : input;
  try {
    assertAllowed(url);
  } catch (e) {
    return Promise.reject(e);
  }
  return globalThis.fetch(input, init);
};

/** `new WebSocket` with the allowlist check (wss anywhere allowed; ws only to loopback). */
export function netWebSocket(url: string | URL, protocols?: string | string[]): WebSocket {
  assertAllowed(url);
  return new WebSocket(url, protocols);
}

/** The browser `NetPort` for the sync engine and blob store. */
export const browserNet: NetPort = {
  fetch: (input, init) => netFetch(input, init),
  assertAllowed: (url) => assertAllowed(url),
};

/** Test hook: forget every grant (memory and storage). */
export function resetNetAllowlist(): void {
  allowed = new Map();
  save();
  allowed = null;
}

/** Test hook: drop the in-memory copy so the next call re-reads storage (simulates a reload). */
export function reloadNetAllowlistForTests(): void {
  allowed = null;
}
