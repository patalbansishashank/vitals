/**
 * MQTT ingest state of one server (SUITE_SPEC §14.5): broker credentials (scrypt), installation pins, the per-person
 * write-ahead log, dead letters and the counters behind `GET /v1/mqtt/status`.
 *
 * WAL `persons/<id>/ingest/wal.jsonl`: `{ envelopeId, topic, receivedAt, payload }` lines appended and fsynced before the
 * PUBACK, then `{ done: envelopeId }` lines once imported. Compaction drops payloads of done entries but keeps their ids
 * for 7 days, so a resend after a lost PUBACK is still recognised.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { appendFile, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readJsonFile, writeJsonSecret } from '../config.ts';
import type { IngestLumenResult, LumenInstallation } from './personRpc.ts';
import { mkdirPrivate, type PersonRegistry } from './persons.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const BASE_TOPIC = 'lumen-health/v1';
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_CREDENTIALS = 2;
const DEADLETTER_DAYS = 30;
const DONE_KEEP_MS = 7 * 86_400_000;
/** Done markers kept at most (newest first); a resend after a lost PUBACK is recognised for these. */
export const WAL_DONE_MAX = 100_000;
/** Acknowledged but not yet imported bytes per person; beyond this a publish gets no PUBACK, so Lumen keeps it in its outbox. */
export const WAL_PENDING_MAX_BYTES = 64 * 1024 * 1024;
/** The WAL file is rewritten without done payloads when it grows past this, even under a stream that never goes idle. */
export const WAL_COMPACT_BYTES = 8 * 1024 * 1024;
/** One dead-letter file (one day) stops taking lines at this size; further ones are only counted in `<day>.dropped`. */
export const DEADLETTER_DAY_MAX_BYTES = 1024 * 1024;

export type DeadReason = 'too_large' | 'not_json' | 'not_cloudevent' | 'wrong_installation' | 'unknown_type' | 'invalid_payload' | 'validation_failed' | 'import_error';

export interface CredentialRecord {
  username: string;
  passwordHash: string;
  baseTopic: typeof BASE_TOPIC;
  createdAt: string;
  revokedAt?: string;
  pinnedInstallation?: string;
  lastConnectAt?: string;
}

export interface MqttCredential {
  address: string;
  username: string;
  password: string;
  baseTopic: typeof BASE_TOPIC;
}

export interface MqttStatus {
  enabled: boolean;
  address: string | null;
  credentials: Array<{ username: string; createdAt: string; connected: boolean; lastConnectAt: string | null }>;
  lastEventAt: string | null;
  eventsToday: Array<{ stream: string; count: number }>;
  /** The ring's battery from the newest battery event (`health.device.battery.updated`), with the time it was read. */
  battery: { percent: number; at: string } | null;
  /** `byReason`: counts over the last 7 days, for "See why". */
  deadLetters: { today: number; last7d: number; lastReason: string | null; byReason: Record<string, number> };
}

export interface WalEntry {
  envelopeId: string;
  topic: string;
  receivedAt: string;
  payload: string;
}

interface Stats {
  date: string;
  streams: Record<string, number>;
  lastEventAt: string | null;
  battery?: unknown;
  connection?: unknown;
}

const hashPassword = async (pw: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await scrypt(pw, salt, 32)).toString('base64url')}`;
};
const checkPassword = async (pw: string, stored: string) => {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length);
  return timingSafeEqual(want, got);
};
export const usernamePerson = (u: string) => /^p([0-9a-f]{16})-\d+$/.exec(u)?.[1] ?? null;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** fsynced append: the line is on disk when this resolves. */
export async function appendDurable(file: string, line: string): Promise<void> {
  const fh = await open(file, 'a', 0o600);
  try {
    await fh.appendFile(line.endsWith('\n') ? line : `${line}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export interface IngestState {
  addCredential(personId: string, address: string): Promise<MqttCredential>;
  revokeCredential(personId: string, username: string): Promise<boolean>;
  credentials(personId: string): Promise<CredentialRecord[]>;
  /** The person behind a username/password, or null. */
  authenticate(username: string, password: string): Promise<string | null>;
  /** Pins the first installation seen on a credential; false when another one is pinned. */
  pin(personId: string, username: string, installationId: string): Promise<boolean>;
  clearPin(personId: string, username: string): Promise<boolean>;
  noteConnect(personId: string, username: string): Promise<void>;
  /** Hook for tests: replaces the WAL append (e.g. to fail or delay it). */
  walAppend: (file: string, line: string) => Promise<void>;
  walWrite(personId: string, e: WalEntry): Promise<'written' | 'duplicate'>;
  walDone(personId: string, envelopeId: string): Promise<void>;
  walPending(personId: string): Promise<WalEntry[]>;
  walCompact(personId: string): Promise<void>;
  deadLetter(personId: string, d: { reason: DeadReason; envelopeId?: string; type?: string; bytes: number; sample: string }, durable?: boolean): Promise<void>;
  installations(personId: string): Promise<Record<string, LumenInstallation>>;
  recordImport(personId: string, r: IngestLumenResult): Promise<void>;
  status(personId: string, o: { enabled: boolean; address: string | null; connected: (username: string) => boolean }): Promise<MqttStatus>;
  pruneDeadLetters(personId: string): Promise<void>;
}

export function createIngestState(o: { persons: PersonRegistry; now?: () => number; walPendingMaxBytes?: number }): IngestState {
  const { persons, now = Date.now, walPendingMaxBytes = WAL_PENDING_MAX_BYTES } = o;
  const P = (id: string) => persons.paths(id);
  const statsFile = (id: string) => join(P(id).ingest, 'stats.json');
  const readCreds = async (id: string) => (await readJsonFile<CredentialRecord[]>(P(id).mqtt)) ?? [];
  /** Envelope ids already in each person's WAL (loaded lazily). */
  const walIds = new Map<string, Set<string>>();
  const chains = new Map<string, Promise<unknown>>();
  const prunedOn = new Map<string, string>();
  const serial = <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const p = (chains.get(key) ?? Promise.resolve()).then(f, f);
    chains.set(key, p.catch(() => undefined));
    return p;
  };

  const readWal = async (id: string) => {
    const text = await readFile(P(id).wal, 'utf8').catch(() => '');
    const entries = new Map<string, WalEntry>();
    const done = new Map<string, number>();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line) as WalEntry | { done: string; at?: number };
        if ('done' in v) done.set(v.done, v.at ?? now());
        else if (typeof v.envelopeId === 'string') entries.set(v.envelopeId, v);
      } catch {
        /* a torn last line (crash mid-append) was never acknowledged */
      }
    }
    return { entries, done };
  };
  /** Bytes of each acknowledged-but-not-imported entry, per person. */
  const walPendingBytes = new Map<string, Map<string, number>>();
  const ids = async (id: string) => {
    let s = walIds.get(id);
    if (!s) {
      const w = await readWal(id);
      s = new Set([...w.entries.keys(), ...w.done.keys()]);
      walIds.set(id, s);
      walPendingBytes.set(id, new Map([...w.entries].filter(([k]) => !w.done.has(k)).map(([k, e]) => [k, Buffer.byteLength(e.payload)])));
    }
    return s;
  };
  /** Rewrites the WAL: pending entries in full, done markers of the last 7 days (newest `WAL_DONE_MAX`). Call inside `serial('wal:id')`. */
  const compactNow = async (id: string) => {
    const w = await readWal(id);
    const keep = [...w.done].filter(([, at]) => at > now() - DONE_KEEP_MS).slice(-WAL_DONE_MAX);
    const pending = [...w.entries.values()].filter((e) => !w.done.has(e.envelopeId));
    await writeJsonSecretLines(P(id).wal, [...pending.map((e) => JSON.stringify(e)), ...keep.map(([done, at]) => JSON.stringify({ done, at }))]);
    walIds.set(id, new Set([...keep.map(([k]) => k), ...pending.map((e) => e.envelopeId)]));
    walPendingBytes.set(id, new Map(pending.map((e) => [e.envelopeId, Buffer.byteLength(e.payload)])));
  };
  const updateCreds = (id: string, f: (list: CredentialRecord[]) => boolean) =>
    serial(`creds:${id}`, async () => {
      const list = await readCreds(id);
      const changed = f(list);
      if (changed) await writeJsonSecret(P(id).mqtt, list);
      return changed;
    });

  const state: IngestState = {
    addCredential: (id, address) =>
      serial(`creds:${id}`, async () => {
        const list = await readCreds(id);
        if (list.filter((c) => !c.revokedAt).length >= MAX_CREDENTIALS) throw Object.assign(new Error('At most two broker logins per person. Remove one first.'), { code: 'limit' });
        const n = list.reduce((m, c) => Math.max(m, Number(c.username.split('-')[1]) || 0), 0) + 1;
        const password = randomBytes(24).toString('base64url');
        const username = `p${id}-${n}`;
        list.push({ username, passwordHash: await hashPassword(password), baseTopic: BASE_TOPIC, createdAt: new Date(now()).toISOString() });
        await writeJsonSecret(P(id).mqtt, list);
        return { address, username, password, baseTopic: BASE_TOPIC };
      }),
    revokeCredential: (id, username) =>
      updateCreds(id, (list) => {
        const c = list.find((x) => x.username === username && !x.revokedAt);
        if (c) c.revokedAt = new Date(now()).toISOString();
        return Boolean(c);
      }),
    credentials: async (id) => (await readCreds(id)).filter((c) => !c.revokedAt),
    async authenticate(username, password) {
      const id = usernamePerson(username);
      if (!id || !(await persons.get(id))) return null;
      const c = (await readCreds(id)).find((x) => x.username === username && !x.revokedAt);
      return c && (await checkPassword(password, c.passwordHash)) ? id : null;
    },
    async pin(id, username, installationId) {
      let ok = false;
      await updateCreds(id, (list) => {
        const c = list.find((x) => x.username === username && !x.revokedAt);
        if (!c) return false;
        if (!c.pinnedInstallation) {
          c.pinnedInstallation = installationId;
          ok = true;
          return true;
        }
        ok = c.pinnedInstallation === installationId;
        return false;
      });
      return ok;
    },
    clearPin: (id, username) =>
      updateCreds(id, (list) => {
        const c = list.find((x) => x.username === username && !x.revokedAt);
        if (c) delete c.pinnedInstallation;
        return Boolean(c);
      }),
    noteConnect: async (id, username) =>
      void (await updateCreds(id, (list) => {
        const c = list.find((x) => x.username === username);
        if (c) c.lastConnectAt = new Date(now()).toISOString();
        return Boolean(c);
      })),
    walAppend: appendDurable,
    walWrite: (id, e) =>
      serial(`wal:${id}`, async () => {
        const seen = await ids(id);
        if (seen.has(e.envelopeId)) return 'duplicate';
        await mkdirPrivate(P(id).ingest);
        if (((await stat(P(id).wal).catch(() => null))?.size ?? 0) > WAL_COMPACT_BYTES) await compactNow(id);
        const pend = walPendingBytes.get(id)!;
        const size = Buffer.byteLength(e.payload);
        let total = size;
        for (const n of pend.values()) total += n;
        // refusing is the back-pressure: no PUBACK, the connection closes, the sender resends later
        if (total > walPendingMaxBytes) throw Object.assign(new Error('The server has too many messages waiting to be imported.'), { code: 'wal_full' });
        await state.walAppend(P(id).wal, JSON.stringify(e));
        seen.add(e.envelopeId);
        pend.set(e.envelopeId, size);
        return 'written';
      }),
    walDone: (id, envelopeId) =>
      serial(`wal:${id}`, async () => {
        await appendDurable(P(id).wal, JSON.stringify({ done: envelopeId, at: now() }));
        walPendingBytes.get(id)?.delete(envelopeId);
      }),
    async walPending(id) {
      const w = await readWal(id);
      return [...w.entries.values()].filter((e) => !w.done.has(e.envelopeId));
    },
    walCompact: (id) =>
      serial(`wal:${id}`, async () => {
        const w = await readWal(id);
        if ([...w.entries.keys()].some((k) => !w.done.has(k))) return;
        await compactNow(id);
      }),
    async deadLetter(id, d, durable = true) {
      await mkdirPrivate(P(id).deadletter);
      const line = JSON.stringify({ at: new Date(now()).toISOString(), reason: d.reason, ...(d.envelopeId ? { envelopeId: d.envelopeId } : {}), ...(d.type ? { type: d.type } : {}), bytes: d.bytes, sample: d.sample.slice(0, 2048) });
      const today = day(now());
      const file = join(P(id).deadletter, `${today}.jsonl`);
      // one prune per person per day while running (it used to run only at start-up)
      if (prunedOn.get(id) !== today) {
        prunedOn.set(id, today);
        await state.pruneDeadLetters(id).catch(() => undefined);
      }
      // a flood of bad messages cannot fill the disk: past the day's cap lines are only counted
      if (((await stat(file).catch(() => null))?.size ?? 0) + Buffer.byteLength(line) > DEADLETTER_DAY_MAX_BYTES) {
        const dropped = join(P(id).deadletter, `${today}.dropped`);
        await appendFile(dropped, '.', { mode: 0o600 }); // one byte per dropped line
        return;
      }
      if (durable) await appendDurable(file, line);
      else await appendFile(file, `${line}\n`, { mode: 0o600 });
    },
    installations: async (id) => (await readJsonFile<Record<string, LumenInstallation>>(P(id).installations)) ?? {},
    recordImport: (id, r) =>
      serial(`stats:${id}`, async () => {
        await writeJsonSecret(P(id).installations, r.installations);
        const today = day(now());
        const s = (await readJsonFile<Stats>(statsFile(id))) ?? { date: today, streams: {}, lastEventAt: null };
        const next: Stats = s.date === today ? s : { ...s, date: today, streams: {} };
        for (const [k, n] of Object.entries(r.streams)) next.streams[k] = (next.streams[k] ?? 0) + n;
        next.lastEventAt = new Date(now()).toISOString();
        for (const st of r.status) next[st.kind] = { at: st.at, value: st.value };
        await writeJsonSecret(statsFile(id), next);
      }),
    async status(id, s) {
      const creds = await state.credentials(id);
      const stats = await readJsonFile<Stats>(statsFile(id));
      const today = day(now());
      let todayN = 0;
      let week = 0;
      let lastReason: string | null = null;
      const byReason: Record<string, number> = {};
      const files = (await readdir(P(id).deadletter).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
      for (const f of files) {
        const d = f.slice(0, 10);
        if (Date.parse(d) < Date.parse(today) - 6 * 86_400_000) continue;
        const lines = (await readFile(join(P(id).deadletter, f), 'utf8')).split('\n').filter(Boolean);
        week += lines.length;
        if (d === today) todayN += lines.length;
        const dropped = (await stat(join(P(id).deadletter, `${f.slice(0, 10)}.dropped`)).catch(() => null))?.size ?? 0;
        week += dropped;
        if (d === today) todayN += dropped;
        const last = lines.at(-1);
        if (last) lastReason = (JSON.parse(last) as { reason: string }).reason;
        for (const l of lines) {
          const reason = (JSON.parse(l) as { reason?: string }).reason ?? 'unknown';
          byReason[reason] = (byReason[reason] ?? 0) + 1;
        }
      }
      const b = stats?.battery as { at?: unknown; value?: unknown } | undefined;
      return {
        enabled: s.enabled,
        address: s.address,
        credentials: creds.map((c) => ({ username: c.username, createdAt: c.createdAt, connected: s.connected(c.username), lastConnectAt: c.lastConnectAt ?? null })),
        lastEventAt: stats?.lastEventAt ?? null,
        eventsToday: stats && stats.date === today ? Object.entries(stats.streams).map(([stream, count]) => ({ stream, count })) : [],
        battery: b && typeof b.value === 'number' && Number.isFinite(b.value) && typeof b.at === 'string' ? { percent: b.value, at: b.at } : null,
        deadLetters: { today: todayN, last7d: week, lastReason, byReason },
      };
    },
    async pruneDeadLetters(id) {
      const cutoff = day(now() - DEADLETTER_DAYS * 86_400_000);
      for (const f of await readdir(P(id).deadletter).catch(() => [] as string[])) if (f.slice(0, 10) < cutoff) await rm(join(P(id).deadletter, f), { force: true });
    },
  };
  return state;
}

async function writeJsonSecretLines(path: string, lines: string[]): Promise<void> {
  const { writeSecretFile } = await import('../config.ts');
  await writeSecretFile(path, lines.length ? `${lines.join('\n')}\n` : '');
}
