/**
 * Local pairing (SUITE_SPEC §7.2 `POST /v1/pair/local`).
 *
 * - On start the Companion mints a one-time 8-digit code (10 min, 5 wrong attempts, single use). A browser tab posts it
 *   with its `Origin` and receives a 32-byte bearer token bound to that origin.
 * - `vitals-companion pair --client <name>` mints a named client token for Streamable HTTP MCP clients (no Origin).
 * - `<configDir>/admin.token` authenticates local CLI processes (`mcp` stdio bridge, `pair`) without an Origin.
 *
 * Only SHA-256 hashes of browser and client tokens are stored (`pairings.json`, 0600). Comparisons are constant-time.
 */
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { configFiles, ensureConfigDir, readJsonFile, readOrCreateAdminToken, writeJsonSecret } from './config.ts';
import { normalizeOrigin, sha256, type Logger } from './security.ts';

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;

export interface PairingRecord {
  id: string;
  kind: 'browser' | 'client';
  /** Hex SHA-256 of the token. */
  hash: string;
  /** Browser tokens only: the origin the token is bound to. */
  origin?: string;
  label: string;
  createdAt: string;
}

interface PairingsFile {
  version: 1;
  pairings: PairingRecord[];
}

export type Principal =
  | { kind: 'admin'; id: 'admin'; label: 'admin' }
  | { kind: 'browser'; id: string; label: string; origin: string }
  | { kind: 'client'; id: string; label: string };

export type PairResult = { ok: true; token: string } | { ok: false; error: 'invalid_code' | 'expired' | 'locked' | 'no_code'; attemptsLeft?: number };

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export interface Auth {
  /** Mints a fresh code (the old one stops working). */
  newCode(): PairingCode;
  /** Exchanges a code for a browser token bound to `origin`. */
  pair(code: string, origin: string, label?: string): Promise<PairResult>;
  /** Mints a named client token (no Origin); printed once by the CLI. */
  mintClientToken(name: string): Promise<string>;
  /** Resolves a bearer: browser tokens need their bound origin; admin/client tokens need no Origin at all. */
  verify(token: string | null, origin: string | undefined): Principal | null;
  list(): readonly PairingRecord[];
}

const newToken = () => randomBytes(32).toString('base64url');
const hashHex = (token: string) => sha256(token).toString('hex');
const cleanLabel = (s: unknown, fallback: string) => (typeof s === 'string' && s.trim() ? s.trim().replace(/[^\p{L}\p{N} ._:/@()-]/gu, '').slice(0, 64) : fallback) || fallback;

export async function createAuth(opts: { configDir: string; log: Logger; now?: () => number }): Promise<Auth> {
  const { configDir, log, now = Date.now } = opts;
  await ensureConfigDir(configDir);
  const files = configFiles(configDir);
  const adminToken = await readOrCreateAdminToken(configDir);
  log.addSecret(adminToken);
  const adminHash = sha256(adminToken);

  const stored = await readJsonFile<PairingsFile>(files.pairings);
  const pairings: PairingRecord[] = Array.isArray(stored?.pairings) ? stored.pairings.filter((p) => typeof p?.hash === 'string' && /^[0-9a-f]{64}$/.test(p.hash)) : [];
  const save = () => writeJsonSecret(files.pairings, { version: 1, pairings } satisfies PairingsFile);
  if (!stored) await save();

  let current: (PairingCode & { attempts: number; used: boolean }) | null = null;

  const newCode = (): PairingCode => {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    current = { code, expiresAt: now() + PAIRING_CODE_TTL_MS, attempts: 0, used: false };
    log.addSecret(code);
    return { code, expiresAt: current.expiresAt };
  };

  /** Constant-time lookup over every stored hash (no early exit). */
  const findByHash = (hash: Buffer): PairingRecord | null => {
    let found: PairingRecord | null = null;
    for (const p of pairings) if (timingSafeEqual(Buffer.from(p.hash, 'hex'), hash)) found = p;
    return found;
  };

  return {
    newCode,
    async pair(code, origin, label) {
      const c = current;
      if (!c || c.used) return { ok: false, error: 'no_code' };
      if (c.attempts >= PAIRING_MAX_ATTEMPTS) return { ok: false, error: 'locked' };
      if (now() > c.expiresAt) return { ok: false, error: 'expired' };
      const given = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
      if (!timingSafeEqual(sha256(given), sha256(c.code))) {
        c.attempts += 1;
        if (c.attempts >= PAIRING_MAX_ATTEMPTS) log('pairing code locked after too many wrong attempts; run `vitals-companion pair` for a new one');
        return { ok: false, error: c.attempts >= PAIRING_MAX_ATTEMPTS ? 'locked' : 'invalid_code', attemptsLeft: PAIRING_MAX_ATTEMPTS - c.attempts };
      }
      c.used = true;
      const token = newToken();
      const o = normalizeOrigin(origin);
      pairings.push({ id: randomUUID(), kind: 'browser', hash: hashHex(token), origin: o, label: cleanLabel(label, o), createdAt: new Date(now()).toISOString() });
      await save();
      log(`paired a browser tab from ${o}`);
      return { ok: true, token };
    },
    async mintClientToken(name) {
      const token = newToken();
      const label = cleanLabel(name, 'mcp-client');
      pairings.push({ id: randomUUID(), kind: 'client', hash: hashHex(token), label, createdAt: new Date(now()).toISOString() });
      await save();
      log(`minted an MCP client token for ${label}`);
      return token;
    },
    verify(token, origin) {
      if (!token) return null;
      const hash = sha256(token);
      const isAdmin = timingSafeEqual(hash, adminHash);
      const p = findByHash(hash);
      if (origin === undefined) {
        if (isAdmin) return { kind: 'admin', id: 'admin', label: 'admin' };
        if (p?.kind === 'client') return { kind: 'client', id: p.id, label: p.label };
        return null;
      }
      if (p?.kind === 'browser' && p.origin === normalizeOrigin(origin)) return { kind: 'browser', id: p.id, label: p.label, origin: p.origin };
      return null;
    },
    list: () => pairings,
  };
}
