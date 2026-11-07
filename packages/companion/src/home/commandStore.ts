/**
 * The command store of one person (`persons/<id>/commands.db`, better-sqlite3, WAL, 0600; energy SPEC §A.4 item 7): the
 * short-lived control plane from Vitals to Gauge. A separate file from `lumen.db`, so S1's migration chain and the
 * health store stay untouched. A command is a request, never data: it carries no health values.
 *
 * - `commands`: one row per client id (16–40 URL-safe characters). `seq` orders delivery. `state` follows
 *   `queued → delivered → running → done | failed | rejected | noop`, plus `expired`, `superseded`, `cancelled`.
 * - Expiry and leases are stamped with the server's clock (`issued_ms`, `expires_ms`, `lease_ms`); the device's
 *   `occurredAt` is advisory and clamped to ±5 min.
 * - `gauge_state`: per Gauge installation, its last poll and the state it last reported (`reels`, `recording`).
 * - `command_aliases` (r063 A35): a request id the server coalesced into a pending command (`hr.measure`,
 *   `update.check`) is stored as a durable alias of it with its body hash: a retry of that id, a lookup and a cancel
 *   answer the command it joined, even after the first response was lost and the command finished, and the id can never
 *   name another command. Purged with its command.
 *
 * Every function takes `now` (epoch ms) so tests drive the clock. Nothing here logs.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';

export const COMMAND_TYPES = ['reels.set', 'workout.start', 'workout.pause', 'workout.resume', 'workout.stop', 'hr.measure', 'update.check', 'ring.sync'] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export type CommandState = 'queued' | 'delivered' | 'running' | 'done' | 'failed' | 'rejected' | 'noop' | 'expired' | 'superseded' | 'cancelled';
export const TERMINAL_STATES: ReadonlySet<CommandState> = new Set(['done', 'failed', 'rejected', 'noop', 'expired', 'superseded', 'cancelled']);
export const PENDING_STATES: ReadonlySet<CommandState> = new Set(['queued', 'delivered', 'running']);
/** What Gauge may ack. */
export const ACK_STATES = ['running', 'done', 'failed', 'rejected', 'noop', 'expired'] as const;
export type AckState = (typeof ACK_STATES)[number];

/** Default (and longest) time to live per type, seconds (§A.4 item 3). */
export const COMMAND_TTL_S: Readonly<Record<CommandType, number>> = {
  'reels.set': 24 * 3600,
  'workout.start': 60,
  'workout.pause': 120,
  'workout.resume': 120,
  'workout.stop': 30 * 60,
  'hr.measure': 60,
  'update.check': 3600,
  // (r068 B2) "Refresh" on another device: a sync that starts two minutes late is still the one asked for
  'ring.sync': 120,
};
/** A `running` command with no terminal ack after this long is `failed: timeout`. */
export const RUN_LIMIT_MS: Readonly<Record<CommandType, number>> = {
  'reels.set': 30_000, 'workout.start': 30_000, 'workout.pause': 30_000, 'workout.resume': 30_000, 'workout.stop': 30_000,
  'hr.measure': 90_000, 'update.check': 30_000,
  // (r068 B2) reconnect (20 s) + the ring's history sync (up to 90 s) + the upload (up to 40 s)
  'ring.sync': 180_000,
};
export const LEASE_MS = 30_000;
export const MAX_PENDING = 20;
export const KEEP_TERMINAL_MS = 30 * 24 * 3600_000;
export const OCCURRED_SKEW_MS = 5 * 60_000;
/** Server-side coalescing: a pending one of these is returned instead of a second. */
const COALESCED: ReadonlySet<CommandType> = new Set(['hr.measure', 'update.check', 'ring.sync']);

export const COMMAND_ID = /^[A-Za-z0-9_-]{16,40}$/;

export interface CommandRow {
  seq: number;
  id: string;
  type: CommandType;
  payload: Record<string, unknown>;
  installationId: string;
  deviceId: string;
  state: CommandState;
  code: string | null;
  detail: string | null;
  result: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string;
  occurredAt: string | null;
  deliveredAt: string | null;
  attempt: number;
  updatedAt: string;
}

export interface GaugeStateRow {
  installationId: string;
  lastPollAt: string | null;
  appVersion: string | null;
  capabilities: string[];
  reels: Record<string, unknown> | null;
  recording: Record<string, unknown> | null;
  stateAt: string | null;
}

export interface EnqueueInput {
  id: string;
  type: CommandType;
  payload: Record<string, unknown>;
  installationId: string;
  deviceId: string;
  ttlS: number;
  occurredMs?: number;
}

export type EnqueueResult =
  | { kind: 'created'; command: CommandRow; superseded: number }
  | { kind: 'deduped'; command: CommandRow; superseded: 0 }
  | { kind: 'coalesced'; command: CommandRow; superseded: 0 }
  | { kind: 'id_reused' }
  | { kind: 'too_many_pending' };

export type AckResult = 'ok' | 'not_found' | 'already_terminal';

export interface CommandStore {
  enqueue(c: EnqueueInput, now: number): EnqueueResult;
  /** The command `id` names: its own, or (r063 A35) the one it was coalesced into. */
  get(id: string): CommandRow | null;
  list(o: { limit: number; type?: CommandType; state?: CommandState }): CommandRow[];
  cancel(id: string, now: number): 'ok' | 'not_found' | 'already_delivered';
  /** The commands to hand Gauge now (queued, or delivered with the lease run out), marked `delivered`, in `seq` order. */
  takeForPoll(installationId: string, now: number): CommandRow[];
  /** Whether a poll would return anything (no state change). */
  hasDeliverable(installationId: string, now: number): boolean;
  ack(id: string, installationId: string, a: { status: AckState; code?: string; detail?: string; result?: Record<string, unknown> }, now: number): AckResult;
  notePoll(installationId: string, now: number): void;
  noteState(installationId: string, s: { appVersion: string; capabilities: string[]; reels?: Record<string, unknown> | null; recording?: Record<string, unknown> | null }, now: number): void;
  gaugeState(installationId: string): GaugeStateRow | null;
  gaugeStates(): GaugeStateRow[];
  /** Expire, time out and purge (§A.4 item 5); returns how many rows changed state. */
  sweep(now: number): number;
  /** The earliest future moment a deliverable command's lease runs out (for a held poll), or null. */
  nextLeaseEnd(installationId: string, now: number): number | null;
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS commands (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    state TEXT NOT NULL,
    code TEXT,
    detail TEXT,
    result TEXT,
    issued_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    occurred_ms INTEGER,
    delivered_ms INTEGER,
    lease_ms INTEGER,
    running_ms INTEGER,
    attempt INTEGER NOT NULL DEFAULT 0,
    updated_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS commands_state ON commands (state, installation_id, seq);
  CREATE TABLE IF NOT EXISTS command_aliases (
    alias TEXT PRIMARY KEY,
    command_id TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS command_aliases_command ON command_aliases (command_id);
  CREATE TABLE IF NOT EXISTS gauge_state (
    installation_id TEXT PRIMARY KEY,
    last_poll_ms INTEGER,
    app_version TEXT,
    capabilities TEXT,
    reels TEXT,
    recording TEXT,
    state_ms INTEGER
  );
`;

/** Key order does not change the hash: `{a,b}` and `{b,a}` are the same body. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const bodyHash = (c: Pick<EnqueueInput, 'type' | 'payload' | 'installationId' | 'ttlS'>) =>
  createHash('sha256').update(canonical({ type: c.type, payload: c.payload, installationId: c.installationId, ttlS: c.ttlS })).digest('base64url');

interface Raw {
  seq: number; id: string; type: string; payload: string; body_hash: string; installation_id: string; device_id: string; state: string;
  code: string | null; detail: string | null; result: string | null; issued_ms: number; expires_ms: number; occurred_ms: number | null;
  delivered_ms: number | null; lease_ms: number | null; running_ms: number | null; attempt: number; updated_ms: number;
}
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const parse = (s: string | null) => (s === null ? null : (JSON.parse(s) as Record<string, unknown>));
const toRow = (r: Raw): CommandRow => ({
  seq: r.seq, id: r.id, type: r.type as CommandType, payload: JSON.parse(r.payload) as Record<string, unknown>, installationId: r.installation_id,
  deviceId: r.device_id, state: r.state as CommandState, code: r.code, detail: r.detail, result: parse(r.result),
  issuedAt: iso(r.issued_ms)!, expiresAt: iso(r.expires_ms)!, occurredAt: iso(r.occurred_ms), deliveredAt: iso(r.delivered_ms), attempt: r.attempt,
  updatedAt: iso(r.updated_ms)!,
});

export function openCommandStore(file: string): CommandStore {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 2000');
  db.exec(SCHEMA);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);

  const q = {
    byId: db.prepare<[string], Raw>('SELECT * FROM commands WHERE id = ?'),
    alias: db.prepare<[string], { command_id: string; body_hash: string }>('SELECT command_id, body_hash FROM command_aliases WHERE alias = ?'),
    addAlias: db.prepare('INSERT OR IGNORE INTO command_aliases (alias, command_id, body_hash, created_ms) VALUES (?, ?, ?, ?)'),
    purgeAliases: db.prepare('DELETE FROM command_aliases WHERE command_id NOT IN (SELECT id FROM commands)'),
    insert: db.prepare(`INSERT INTO commands (id, type, payload, body_hash, installation_id, device_id, state, issued_ms, expires_ms, occurred_ms, updated_ms)
      VALUES (@id, @type, @payload, @body_hash, @installation_id, @device_id, 'queued', @issued_ms, @expires_ms, @occurred_ms, @issued_ms)`),
    pendingCount: db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM commands WHERE state IN ('queued', 'delivered', 'running')`),
    pendingOfType: db.prepare<[string, string], Raw>(`SELECT * FROM commands WHERE type = ? AND installation_id = ? AND state IN ('queued', 'delivered', 'running') ORDER BY seq DESC LIMIT 1`),
    supersede: db.prepare(`UPDATE commands SET state = 'superseded', updated_ms = ? WHERE type = 'reels.set' AND installation_id = ? AND state IN ('queued', 'delivered') AND id <> ?`),
    deliverable: db.prepare<[string, number, number], Raw>(`SELECT * FROM commands WHERE installation_id = ? AND expires_ms > ?
      AND (state = 'queued' OR (state = 'delivered' AND lease_ms <= ?)) ORDER BY seq`),
    deliver: db.prepare(`UPDATE commands SET state = 'delivered', delivered_ms = COALESCE(delivered_ms, @now), lease_ms = @lease, attempt = attempt + 1, updated_ms = @now WHERE seq = @seq`),
    nextLease: db.prepare<[string, number, number], { at: number | null }>(`SELECT MIN(lease_ms) AS at FROM commands WHERE installation_id = ? AND state = 'delivered' AND lease_ms > ? AND expires_ms > ?`),
    setState: db.prepare(`UPDATE commands SET state = @state, code = @code, detail = @detail, result = @result, running_ms = COALESCE(running_ms, @running), updated_ms = @now WHERE seq = @seq`),
    cancel: db.prepare(`UPDATE commands SET state = 'cancelled', updated_ms = ? WHERE id = ? AND state = 'queued'`),
    expire: db.prepare(`UPDATE commands SET state = 'expired', updated_ms = ? WHERE state IN ('queued', 'delivered') AND expires_ms <= ?`),
    runningAll: db.prepare<[], Raw>(`SELECT * FROM commands WHERE state = 'running'`),
    timeout: db.prepare(`UPDATE commands SET state = 'failed', code = 'timeout', updated_ms = ? WHERE seq = ? AND state = 'running'`),
    purge: db.prepare(`DELETE FROM commands WHERE state IN ('done', 'failed', 'rejected', 'noop', 'expired', 'superseded', 'cancelled') AND updated_ms < ?`),
    poll: db.prepare(`INSERT INTO gauge_state (installation_id, last_poll_ms) VALUES (?, ?) ON CONFLICT (installation_id) DO UPDATE SET last_poll_ms = excluded.last_poll_ms`),
    state: db.prepare(`INSERT INTO gauge_state (installation_id, app_version, capabilities, reels, recording, state_ms) VALUES (@id, @app_version, @capabilities, @reels, @recording, @now)
      ON CONFLICT (installation_id) DO UPDATE SET app_version = excluded.app_version, capabilities = excluded.capabilities, reels = COALESCE(excluded.reels, reels),
      recording = CASE WHEN @recording_given = 1 THEN excluded.recording ELSE recording END, state_ms = excluded.state_ms`),
    gaugeOne: db.prepare<[string], { installation_id: string; last_poll_ms: number | null; app_version: string | null; capabilities: string | null; reels: string | null; recording: string | null; state_ms: number | null }>(
      'SELECT * FROM gauge_state WHERE installation_id = ?'),
    gaugeAll: db.prepare<[], { installation_id: string; last_poll_ms: number | null; app_version: string | null; capabilities: string | null; reels: string | null; recording: string | null; state_ms: number | null }>(
      'SELECT * FROM gauge_state ORDER BY last_poll_ms DESC'),
  };
  const toGauge = (r: { installation_id: string; last_poll_ms: number | null; app_version: string | null; capabilities: string | null; reels: string | null; recording: string | null; state_ms: number | null }): GaugeStateRow => ({
    installationId: r.installation_id, lastPollAt: iso(r.last_poll_ms), appVersion: r.app_version,
    capabilities: r.capabilities ? (JSON.parse(r.capabilities) as string[]) : [], reels: parse(r.reels), recording: parse(r.recording), stateAt: iso(r.state_ms),
  });

  const sweep = (now: number): number => {
    let n = q.expire.run(now, now).changes;
    for (const r of q.runningAll.all()) {
      const started = r.running_ms ?? r.updated_ms;
      if (started + RUN_LIMIT_MS[r.type as CommandType] <= now) n += q.timeout.run(now, r.seq).changes;
    }
    if (q.purge.run(now - KEEP_TERMINAL_MS).changes) q.purgeAliases.run();
    return n;
  };
  /** The command an id names: its own, or the one it was coalesced into (r063 A35). */
  const resolve = (id: string): Raw | undefined => {
    const own = q.byId.get(id);
    if (own) return own;
    const a = q.alias.get(id);
    return a ? q.byId.get(a.command_id) : undefined;
  };

  const enqueueTx = db.transaction((c: EnqueueInput, now: number): EnqueueResult => {
    sweep(now);
    const hash = bodyHash(c);
    const known = q.byId.get(c.id);
    if (known) return known.body_hash === hash ? { kind: 'deduped', command: toRow(known), superseded: 0 } : { kind: 'id_reused' };
    // (r063 A35) an id coalesced before: the same body answers the command it joined, whatever its state now
    const alias = q.alias.get(c.id);
    if (alias) {
      const target = alias.body_hash === hash ? q.byId.get(alias.command_id) : undefined;
      if (!target) return { kind: 'id_reused' };
      return { kind: 'coalesced', command: toRow(target), superseded: 0 };
    }
    if (COALESCED.has(c.type)) {
      const pending = q.pendingOfType.get(c.type, c.installationId);
      if (pending) {
        q.addAlias.run(c.id, pending.id, hash, now);
        return { kind: 'coalesced', command: toRow(pending), superseded: 0 };
      }
    }
    if (q.pendingCount.get()!.n >= MAX_PENDING) return { kind: 'too_many_pending' };
    const occurred = c.occurredMs === undefined ? null : Math.min(now + OCCURRED_SKEW_MS, Math.max(now - OCCURRED_SKEW_MS, c.occurredMs));
    q.insert.run({
      id: c.id, type: c.type, payload: JSON.stringify(c.payload), body_hash: hash, installation_id: c.installationId, device_id: c.deviceId,
      issued_ms: now, expires_ms: now + c.ttlS * 1000, occurred_ms: occurred,
    });
    const superseded = c.type === 'reels.set' ? q.supersede.run(now, c.installationId, c.id).changes : 0;
    return { kind: 'created', command: toRow(q.byId.get(c.id)!), superseded };
  });

  const takeTx = db.transaction((installationId: string, now: number): CommandRow[] => {
    sweep(now);
    const rows = q.deliverable.all(installationId, now, now);
    for (const r of rows) q.deliver.run({ seq: r.seq, now, lease: now + LEASE_MS });
    return rows.map((r) => toRow(q.byId.get(r.id)!));
  });

  const ackTx = db.transaction((id: string, installationId: string, a: { status: AckState; code?: string; detail?: string; result?: Record<string, unknown> }, now: number): AckResult => {
    const r = q.byId.get(id);
    if (!r || r.installation_id !== installationId) return 'not_found';
    const current = r.state as CommandState;
    const write = () =>
      q.setState.run({
        seq: r.seq, state: a.status, code: a.code ?? null, detail: a.detail ?? null, result: a.result ? JSON.stringify(a.result) : null,
        running: a.status === 'running' ? now : null, now,
      });
    if (a.status === 'running') {
      if (current === 'running') return 'ok';
      if (current === 'queued' || current === 'delivered') {
        write();
        return 'ok';
      }
      return 'already_terminal';
    }
    if (TERMINAL_STATES.has(current)) {
      const same = current === a.status && (r.code ?? undefined) === a.code && canonical(parse(r.result) ?? undefined) === canonical(a.result ?? undefined);
      // terminal acks are write-once (§A.4 item 6), the sweep's own `expired` included: a late ack never rewrites it
      if (same) return 'ok';
      return 'already_terminal';
    }
    write();
    return 'ok';
  });

  return {
    enqueue: (c, now) => enqueueTx(c, now),
    get: (id) => {
      const r = resolve(id);
      return r ? toRow(r) : null;
    },
    list({ limit, type, state }) {
      const where: string[] = [];
      const args: unknown[] = [];
      if (type) {
        where.push('type = ?');
        args.push(type);
      }
      if (state) {
        where.push('state = ?');
        args.push(state);
      }
      const sql = `SELECT * FROM commands ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`;
      return db.prepare<unknown[], Raw>(sql).all(...args, limit).map(toRow);
    },
    cancel(id, now) {
      const r = resolve(id);
      if (!r) return 'not_found';
      return q.cancel.run(now, r.id).changes === 1 ? 'ok' : 'already_delivered';
    },
    takeForPoll: (installationId, now) => takeTx(installationId, now),
    hasDeliverable: (installationId, now) => q.deliverable.all(installationId, now, now).length > 0,
    ack: (id, installationId, a, now) => ackTx(id, installationId, a, now),
    notePoll: (installationId, now) => void q.poll.run(installationId, now),
    noteState(installationId, s, now) {
      q.state.run({
        id: installationId, app_version: s.appVersion, capabilities: JSON.stringify(s.capabilities), reels: s.reels ? JSON.stringify(s.reels) : null,
        recording: s.recording ? JSON.stringify(s.recording) : null, recording_given: s.recording !== undefined ? 1 : 0, now,
      });
    },
    gaugeState: (installationId) => {
      const r = q.gaugeOne.get(installationId);
      return r ? toGauge(r) : null;
    },
    gaugeStates: () => q.gaugeAll.all().map(toGauge),
    sweep,
    nextLeaseEnd: (installationId, now) => q.nextLease.get(installationId, now, now)?.at ?? null,
    close: () => db.close(),
  };
}
