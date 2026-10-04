/**
 * Device tokens and pairing codes of a `home` server (SUITE_SPEC §14.2, R18 §3/§7).
 *
 * - Codes: 8 digits, 10 minutes, single use, several open per person; stored as SHA-256 in `<dataDir>/pair-codes.json`
 *   (0600) so the CLI can issue one while the server runs. A wrong guess cannot tell which code it aimed at, so it counts
 *   against every open code: 5 wrong guesses lock them all.
 * - Tokens: 32 random bytes base64url; only the SHA-256 is kept, in `persons/<id>/devices.json`. Not bound to an origin.
 * - `resolve(token)` is the single place a bearer becomes `{ personId, deviceId, kind, scope }`.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, writeJsonSecret, writeSecretFile } from '../config.ts';
import type { PersonRegistry } from './persons.ts';

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;

export type TokenKind = 'device' | 'agent';

export interface DeviceRecord {
  id: string;
  kind: TokenKind;
  label: string;
  originAtPairing?: string;
  scope: string;
  /** Agent tokens: the client it was minted for (§14.4). */
  client?: string;
  hash: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt?: string;
  /** When `POST /v1/sync/key` handed this device the person's sync key (once per device, R20-PAIR). */
  syncKeyIssuedAt?: string;
}

interface CodeRecord {
  hash: string;
  personId: string;
  label?: string;
  expiresAt: number;
  attempts: number;
}

export interface Principal {
  personId: string;
  deviceId: string;
  kind: TokenKind;
  scope: string;
  label: string;
}

export type SyncKeyMark = 'ok' | 'already_issued' | 'window_closed' | 'not_found';
export type ResolveResult = { ok: true; principal: Principal } | { ok: false; error: 'unauthorized' | 'revoked' };
export type PairOutcome =
  | { ok: true; token: string; deviceId: string; personId: string }
  | { ok: false; error: 'invalid_code' | 'expired' | 'locked'; attemptsLeft?: number };

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
export const cleanLabel = (s: unknown, fallback: string) =>
  (typeof s === 'string' && s.trim() ? s.trim().replace(/[^\p{L}\p{N} ._:/@()'-]/gu, '').slice(0, 40) : fallback) || fallback;

export interface DeviceStore {
  issueCode(personId: string, label?: string): Promise<{ code: string; expiresAt: string }>;
  pair(code: string, o: { label?: string; origin?: string }): Promise<PairOutcome>;
  /** Mints a token without a code (agent tokens, §14.4; tests). */
  mint(personId: string, o: { kind: TokenKind; label: string; scope?: string; origin?: string; client?: string }): Promise<{ token: string; deviceId: string }>;
  resolve(token: string | null): Promise<ResolveResult>;
  list(personId: string): Promise<DeviceRecord[]>;
  revoke(personId: string, deviceId: string): Promise<boolean>;
  /**
   * Records that the device got the sync key: once per device, and only within `CODE_TTL_MS` of its pairing (the key
   * window closes with the code window). Returns why not otherwise.
   */
  markSyncKeyIssued(personId: string, deviceId: string): Promise<SyncKeyMark>;
  touch(p: Principal): void;
  /** Admin bearer: `<dataDir>/admin.token` holds its SHA-256 only. */
  mintAdminToken(): Promise<string>;
  isAdmin(token: string | null): Promise<boolean>;
  flush(): Promise<void>;
}

export function createDeviceStore(o: { dataDir: string; persons: PersonRegistry; now?: () => number }): DeviceStore {
  const { dataDir, persons, now = Date.now } = o;
  const codesFile = join(dataDir, 'pair-codes.json');
  const adminFile = join(dataDir, 'admin.token');
  /**
   * token hash → owner; rebuilt from disk when a person's devices.json changes, through this store or another process
   * (the `vitals-server devices revoke` and `agent-token` commands write the same files while the server runs).
   */
  let index: Map<string, { personId: string; rec: DeviceRecord }> | null = null;
  /** Bumped by every write: an index build that began before a write must not be kept (a revoked token would stay valid). */
  let generation = 0;
  /** The files' signature the cached index was built from: a CLI in another process (revoke, agent-token) changes it. */
  let indexSig = '';
  const seen = new Map<string, { personId: string; at: string }>();
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = chain.then(f, f);
    chain = p.catch(() => undefined);
    return p;
  };

  const readDevices = async (personId: string) => (await readJsonFile<DeviceRecord[]>(persons.paths(personId).devices)) ?? [];
  const writeDevices = async (personId: string, list: DeviceRecord[]) => {
    generation++;
    await writeJsonSecret(persons.paths(personId).devices, list);
    generation++;
    index = null;
  };
  /** Persons and the size and time of each devices.json: a cheap check that the cached index is still the files. */
  const signature = async () => {
    const parts: string[] = [];
    for (const p of await persons.list()) {
      const s = await stat(persons.paths(p.id).devices).catch(() => null);
      parts.push(`${p.id}:${s ? `${s.mtimeMs}:${s.size}` : '-'}`);
    }
    return parts.join('|');
  };
  const loadIndex = async () => {
    const sig = await signature();
    if (index && sig === indexSig) return index;
    const built = generation;
    const m = new Map<string, { personId: string; rec: DeviceRecord }>();
    for (const p of await persons.list()) for (const rec of await readDevices(p.id)) m.set(rec.hash, { personId: p.id, rec });
    if (built === generation) {
      index = m;
      indexSig = sig;
    }
    return m;
  };
  const readCodes = async () => ((await readJsonFile<CodeRecord[]>(codesFile)) ?? []).filter((c) => c.expiresAt > now() - CODE_TTL_MS);
  const writeCodes = (list: CodeRecord[]) => writeJsonSecret(codesFile, list);

  const mint: DeviceStore['mint'] = (personId, m) =>
    serial(async () => {
      if (!(await persons.get(personId))) throw new Error('Unknown person.');
      const token = newToken();
      const deviceId = randomUUID();
      const at = new Date(now()).toISOString();
      const rec: DeviceRecord = {
        id: deviceId, kind: m.kind, label: cleanLabel(m.label, m.kind === 'agent' ? 'Agent' : 'Browser'), scope: m.scope ?? 'full',
        hash: hex(token), createdAt: at, lastSeenAt: at, ...(m.origin ? { originAtPairing: m.origin } : {}), ...(m.client ? { client: m.client } : {}),
      };
      await writeDevices(personId, [...(await readDevices(personId)), rec]);
      return { token, deviceId };
    });

  const store: DeviceStore = {
    issueCode: (personId, label) =>
      serial(async () => {
        if (!(await persons.get(personId))) throw new Error('Unknown person.');
        const codes = await readCodes();
        let code: string;
        do code = String(randomInt(0, 100_000_000)).padStart(8, '0');
        while (codes.some((c) => c.hash === hex(code)));
        const expiresAt = now() + CODE_TTL_MS;
        await writeCodes([...codes, { hash: hex(code), personId, expiresAt, attempts: 0, ...(label ? { label: cleanLabel(label, '') } : {}) }]);
        return { code, expiresAt: new Date(expiresAt).toISOString() };
      }),
    async pair(code, p) {
      const outcome = await serial(async (): Promise<PairOutcome | { ok: true; personId: string; label?: string }> => {
        const codes = await readCodes();
        const given = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
        const h = hex(given);
        const open = codes.filter((c) => c.attempts < CODE_MAX_ATTEMPTS);
        const hit = codes.find((c) => timingSafeEqual(Buffer.from(c.hash, 'hex'), Buffer.from(h, 'hex')));
        if (hit && hit.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, error: 'locked' };
        if (hit && hit.expiresAt <= now()) return { ok: false, error: 'expired' };
        if (!hit) {
          if (!open.length) return { ok: false, error: codes.length ? 'locked' : 'invalid_code', attemptsLeft: 0 };
          for (const c of open) c.attempts += 1;
          await writeCodes(codes);
          const left = Math.max(0, CODE_MAX_ATTEMPTS - Math.max(...open.map((c) => c.attempts)));
          return { ok: false, error: left === 0 ? 'locked' : 'invalid_code', attemptsLeft: left };
        }
        await writeCodes(codes.filter((c) => c !== hit));
        return { ok: true, personId: hit.personId, ...(hit.label ? { label: hit.label } : {}) };
      });
      if (!outcome.ok || 'token' in outcome) return outcome;
      const m = await mint(outcome.personId, { kind: 'device', label: cleanLabel(p.label, outcome.label ?? 'Browser'), ...(p.origin ? { origin: p.origin } : {}) });
      return { ok: true, token: m.token, deviceId: m.deviceId, personId: outcome.personId };
    },
    mint,
    async resolve(token) {
      if (!token) return { ok: false, error: 'unauthorized' };
      const hit = (await loadIndex()).get(hex(token));
      if (!hit) return { ok: false, error: 'unauthorized' };
      if (hit.rec.revokedAt) return { ok: false, error: 'revoked' };
      return { ok: true, principal: { personId: hit.personId, deviceId: hit.rec.id, kind: hit.rec.kind, scope: hit.rec.scope, label: hit.rec.label } };
    },
    list: async (personId) => (await readDevices(personId)).filter((d) => !d.revokedAt).map((d) => ({ ...d, lastSeenAt: seen.get(d.id)?.at ?? d.lastSeenAt })),
    revoke: (personId, deviceId) =>
      serial(async () => {
        const list = await readDevices(personId);
        const d = list.find((x) => x.id === deviceId && !x.revokedAt);
        if (!d) return false;
        d.revokedAt = new Date(now()).toISOString();
        await writeDevices(personId, list);
        return true;
      }),
    markSyncKeyIssued: (personId, deviceId) =>
      serial(async (): Promise<SyncKeyMark> => {
        const list = await readDevices(personId);
        const d = list.find((x) => x.id === deviceId && !x.revokedAt);
        if (!d) return 'not_found';
        if (d.syncKeyIssuedAt) return 'already_issued';
        const created = Date.parse(d.createdAt);
        if (!Number.isFinite(created) || now() > created + CODE_TTL_MS) return 'window_closed';
        d.syncKeyIssuedAt = new Date(now()).toISOString();
        await writeDevices(personId, list);
        return 'ok';
      }),
    touch(p) {
      seen.set(p.deviceId, { personId: p.personId, at: new Date(now()).toISOString() });
    },
    async mintAdminToken() {
      const token = newToken();
      await writeSecretFile(adminFile, `${hex(token)}\n`);
      return token;
    },
    async isAdmin(token) {
      if (!token) return false;
      const stored = ((await readJsonFileText(adminFile)) ?? '').trim();
      return /^[0-9a-f]{64}$/.test(stored) && timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hex(token), 'hex'));
    },
    /** Writes `lastSeenAt` (kept in memory between flushes so each request does not rewrite the file). */
    flush: () =>
      serial(async () => {
        const byPerson = new Map<string, Map<string, string>>();
        for (const [id, s] of seen) byPerson.set(s.personId, (byPerson.get(s.personId) ?? new Map()).set(id, s.at));
        seen.clear();
        for (const [personId, ats] of byPerson) {
          if (!(await persons.get(personId))) continue;
          const list = await readDevices(personId);
          for (const d of list) if (ats.has(d.id)) d.lastSeenAt = ats.get(d.id)!;
          await writeDevices(personId, list);
        }
      }),
  };
  return store;
}

async function readJsonFileText(path: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8').catch(() => null);
}
