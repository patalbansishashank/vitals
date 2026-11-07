/**
 * The command channel from Vitals to Gauge through the home server (energy SPEC §A.4; docs/GAUGE-COMMANDS.md). Vitals
 * asks Gauge to set the Reels limit and apps, start, pause, resume or stop a workout recording, measure heart rate now
 * or check for updates. A command is a request, never data: it carries no health values.
 *
 * Vitals (device token; agent and lumen tokens are 403 `wrong_kind`):
 *   POST   /v1/gauge/commands             { id, type, payload, occurredAt?, installationId?, ttlS? } → 201 { command, online }
 *                                         200 with `deduped` or `coalesced`; 400 bad_command; 404 no_gauge; 409 id_reused,
 *                                         ambiguous_target; 429 too_many_pending, rate_limited
 *   GET    /v1/gauge/commands/{id}?wait=&since=   the command, held up to 25 s while its state equals `since`
 *   GET    /v1/gauge/commands?limit=&type=&state= recent commands, newest first
 *   DELETE /v1/gauge/commands/{id}        cancel while `queued`; else 409 already_delivered
 *   GET    /v1/gauge/commands/state       { paired, installationId, app, online, lastPollAt, appVersion, capabilities, reels, recording, serverNow }
 * Where a command goes (r070): the installation named in `installationId`; else the Gauge engine embedded in a Vitals app
 * (`POST /v1/lumen/pair-device`) once one is paired, the standalone Gauge installation before that. `commands/state`
 * describes the same one.
 * Gauge (lumen token, bound to one installation; a device token is 403):
 *   GET    /v1/lumen/commands?wait=0..25  { now, personId, maxWaitS, commands: [{ id, seq, type, payload, issuedAt, expiresAt, attempt }] }
 *   POST   /v1/lumen/commands/{id}/ack    { status, code?, detail?, result? } → 204
 *   POST   /v1/lumen/commands/state       { appVersion, capabilities, reels?, recording? } → 204
 *
 * Transport is a hold-open poll: the server answers at once when a command waits, else holds up to 25 s. Delivery is at
 * least once with a 30 s lease; terminal acks are write-once. Two bearer checks joined only by `personId`: no token is
 * forwarded or embedded. Logs carry ids, types and counts, never a payload, detail or result.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACK_STATES, COMMAND_ID, COMMAND_TTL_S, COMMAND_TYPES, openCommandStore, TERMINAL_STATES,
  type AckState, type CommandRow, type CommandState, type CommandStore, type CommandType, type GaugeStateRow,
} from './commandStore.ts';
import type { DeviceStore } from './devices.ts';
import type { PersonContext } from './home.ts';
import type { PersonRegistry } from './persons.ts';
import { createRateLimiter, HttpError, readJson, sendJson, type Logger } from '../security.ts';

export const COMMANDS_ALLOW_METHODS = 'GET, POST, DELETE';
export const COMMANDS_ALLOW_HEADERS = 'authorization, content-type';
export const MAX_WAIT_S = 25;
export const ONLINE_MS = 55_000;
export const MAX_PAYLOAD_BYTES = 2048;
export const ENQUEUE_PER_MINUTE = 30;
/** One Gauge poll per 2 s. */
export const POLL_PER_MINUTE = 30;
const SWEEP_MS = 30_000;
const IDLE_MS = 10 * 60_000;
const STATES: ReadonlySet<string> = new Set(['queued', 'delivered', 'running', 'done', 'failed', 'rejected', 'noop', 'expired', 'superseded', 'cancelled']);
const REELS_APPS = new Set(['instagram', 'youtube']);
const WORKOUT_TYPES = new Set(['walk', 'run', 'cycle', 'other']);
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
/** (0.6.3 S26) A catalogue activity id (`treadmill_run`, `air_bike`): Gauge 2.8.1's `RecordingActivityType` shape. */
const ACTIVITY_TYPE_ID = /^[a-z0-9][a-z0-9_]{0,47}$/;
/** Feature tokens Gauge may report beside its command types (kept; anything else unknown is dropped). */
const FEATURE_TOKENS: ReadonlySet<string> = new Set(['workout.start.activity_type_id']);

export interface CommandHub {
  owns(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<void>;
  /** Tests: run the expiry sweep now. */
  sweepNow(): void;
  close(): void;
}

export interface CommandHubOptions {
  persons: PersonRegistry;
  devices: DeviceStore;
  /** `home.resolvePerson(req, ['device'])`. */
  resolveDevice: (req: IncomingMessage) => Promise<PersonContext>;
  /** `home.resolvePerson(req, ['lumen'])`. */
  resolveLumen: (req: IncomingMessage) => Promise<PersonContext>;
  log: Logger;
  now?: () => number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const bad = (message: string) => new HttpError(400, 'bad_command', message);

/** The closed payload schema of each type (§A.4 item 3); throws `bad_command`. */
export function checkPayload(type: CommandType, p: unknown): Record<string, unknown> {
  const payload = p === undefined || p === null ? {} : p;
  if (!isObj(payload)) throw bad('payload must be an object');
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) throw bad(`payload over ${MAX_PAYLOAD_BYTES} bytes`);
  const only = (keys: string[]) => {
    for (const k of Object.keys(payload)) if (!keys.includes(k)) throw bad(keys.length ? `${type} takes ${keys.join(', ')}` : `${type} takes no payload`);
  };
  switch (type) {
    case 'reels.set': {
      only(['dailyLimit', 'apps', 'enabled', 'countdownSeconds']);
      if (Object.keys(payload).length === 0) throw bad('reels.set needs dailyLimit, apps, enabled or countdownSeconds');
      if (payload.dailyLimit !== undefined && !isInt(payload.dailyLimit, 1, 500)) throw bad('dailyLimit is 1–500');
      if (payload.countdownSeconds !== undefined && !isInt(payload.countdownSeconds, 3, 30)) throw bad('countdownSeconds is 3–30');
      if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') throw bad('enabled is true or false');
      if (payload.apps !== undefined) {
        const apps = payload.apps;
        if (!Array.isArray(apps) || apps.some((a) => typeof a !== 'string' || !REELS_APPS.has(a)) || new Set(apps).size !== apps.length) {
          throw bad('apps lists instagram and/or youtube, each once');
        }
      }
      return payload;
    }
    case 'workout.start':
      only(['type', 'useGps', 'activityTypeId']);
      if (typeof payload.type !== 'string' || !WORKOUT_TYPES.has(payload.type)) throw bad('type is walk, run, cycle or other');
      if (payload.useGps !== undefined && typeof payload.useGps !== 'boolean') throw bad('useGps is true or false');
      if (payload.activityTypeId !== undefined && (typeof payload.activityTypeId !== 'string' || !ACTIVITY_TYPE_ID.test(payload.activityTypeId))) throw bad('activityTypeId is a catalogue activity id');
      return payload;
    case 'workout.pause':
    case 'workout.resume':
    case 'workout.stop':
      only(['sessionId']);
      if (payload.sessionId !== undefined && (typeof payload.sessionId !== 'string' || !SESSION_ID.test(payload.sessionId))) throw bad('sessionId is the workout id');
      return payload;
    case 'hr.measure':
    case 'update.check':
    case 'ring.sync':
      only([]);
      return payload;
  }
}

/** Gauge's reported state (§A.4 item 8); throws `bad_request`. */
function checkState(body: Record<string, unknown>) {
  const no = (m: string) => new HttpError(400, 'bad_request', m);
  for (const k of Object.keys(body)) if (!['appVersion', 'capabilities', 'reels', 'recording'].includes(k)) throw no(`state takes appVersion, capabilities, reels, recording`);
  if (typeof body.appVersion !== 'string' || !/^[\w.+-]{1,40}$/.test(body.appVersion)) throw no('appVersion is a version like 1.2.3');
  if (!Array.isArray(body.capabilities) || body.capabilities.length > 20 || body.capabilities.some((c) => typeof c !== 'string' || c.length > 40)) throw no('capabilities lists command types');
  const capabilities = (body.capabilities as string[]).filter((c) => (COMMAND_TYPES as readonly string[]).includes(c) || FEATURE_TOKENS.has(c));
  let reels: Record<string, unknown> | undefined;
  if (body.reels !== undefined) {
    const r = body.reels;
    if (!isObj(r) || Object.keys(r).some((k) => !['enabled', 'dailyLimit', 'countdownSeconds', 'apps'].includes(k))) throw no('reels is { enabled, dailyLimit, countdownSeconds, apps }');
    if (typeof r.enabled !== 'boolean' || !isInt(r.dailyLimit, 0, 10_000) || !isInt(r.countdownSeconds, 0, 600)) throw no('reels is { enabled, dailyLimit, countdownSeconds, apps }');
    if (!Array.isArray(r.apps) || r.apps.length > 10 || r.apps.some((a) => typeof a !== 'string' || a.length > 20)) throw no('reels.apps lists app keys');
    reels = { enabled: r.enabled, dailyLimit: r.dailyLimit, countdownSeconds: r.countdownSeconds, apps: r.apps };
  }
  let recording: Record<string, unknown> | null | undefined;
  if (body.recording === null) recording = null;
  else if (body.recording !== undefined) {
    const r = body.recording;
    if (!isObj(r) || Object.keys(r).some((k) => !['sessionId', 'status', 'type', 'startedAt'].includes(k))) throw no('recording is { sessionId, status, type, startedAt } or null');
    if (typeof r.sessionId !== 'string' || !SESSION_ID.test(r.sessionId) || (r.status !== 'recording' && r.status !== 'paused')) throw no('recording is { sessionId, status, type, startedAt } or null');
    if (typeof r.type !== 'string' || r.type.length > 20 || typeof r.startedAt !== 'string' || r.startedAt.length > 40) throw no('recording is { sessionId, status, type, startedAt } or null');
    recording = { sessionId: r.sessionId, status: r.status, type: r.type, startedAt: r.startedAt };
  }
  return { appVersion: body.appVersion, capabilities, ...(reels ? { reels } : {}), ...(recording !== undefined ? { recording } : {}) };
}

/** What Vitals sees of a command. */
export const commandView = (c: CommandRow) => ({
  id: c.id, type: c.type, payload: c.payload, state: c.state, code: c.code, detail: c.detail, result: c.result, issuedAt: c.issuedAt,
  expiresAt: c.expiresAt, occurredAt: c.occurredAt, deliveredAt: c.deliveredAt, attempt: c.attempt, installationId: c.installationId, updatedAt: c.updatedAt,
});
/** What Gauge sees. */
const gaugeView = (c: CommandRow) => ({ id: c.id, seq: c.seq, type: c.type, payload: c.payload, issuedAt: c.issuedAt, expiresAt: c.expiresAt, attempt: c.attempt });

function queryOf(query: string, allowed: readonly string[]): URLSearchParams {
  const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  for (const k of new Set(q.keys())) {
    if (!allowed.includes(k)) throw new HttpError(400, 'bad_request', allowed.length ? `This endpoint takes ${allowed.join(', ')}` : 'This endpoint takes no parameters');
    if (q.getAll(k).length > 1) throw new HttpError(400, 'bad_request', `Send ${k} once`);
  }
  return q;
}
function waitOf(q: URLSearchParams): number {
  const raw = q.get('wait');
  if (raw === null || raw === '') return 0;
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > MAX_WAIT_S) throw new HttpError(400, 'bad_request', `wait is 0–${MAX_WAIT_S} seconds`);
  return Number(raw);
}

export function createCommandHub(o: CommandHubOptions): CommandHub {
  const { persons, devices, now = Date.now } = o;
  const open = new Map<string, { store: CommandStore; usedAt: number }>();
  const waiters = new Map<string, Set<() => void>>();
  const holders = new Set<() => void>();
  const enqueueLimiter = createRateLimiter({ capacity: ENQUEUE_PER_MINUTE, perMinute: ENQUEUE_PER_MINUTE }, now);
  const pollLimiter = createRateLimiter({ capacity: 1, perMinute: POLL_PER_MINUTE }, now);

  const store = (personId: string): CommandStore => {
    const hit = open.get(personId);
    if (hit) {
      hit.usedAt = now();
      return hit.store;
    }
    const dir = persons.paths(personId).dir;
    if (!existsSync(dir)) throw new HttpError(401, 'unauthorized', 'Pair this device with the server again', { 'WWW-Authenticate': 'Bearer' });
    const s = openCommandStore(join(dir, 'commands.db'));
    open.set(personId, { store: s, usedAt: now() });
    return s;
  };
  /** Wake every held request of this person; each re-checks its own condition. */
  const signal = (personId: string) => waiters.get(personId)?.forEach((f) => f());

  /** Hold until `ready()` or `waitMs` (or the client goes away). `recheckAt` names a moment to look again (a lease end). */
  const hold = (personId: string, res: ServerResponse, waitMs: number, ready: () => boolean, recheckAt?: () => number | null) =>
    new Promise<void>((resolve, reject) => {
      if (waitMs <= 0 || ready()) return resolve();
      const set = waiters.get(personId) ?? new Set<() => void>();
      waiters.set(personId, set);
      let recheck: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(recheck);
        set.delete(check);
        if (set.size === 0) waiters.delete(personId);
        res.off('close', done);
        holders.delete(done);
        if (error === undefined) resolve();
        else reject(error);
      };
      const check = () => {
        // This runs from timers and other requests' notifications. Route errors
        // back to this held request rather than throwing outside its HTTP handler.
        try {
          if (ready()) done();
          else arm();
        } catch (error) {
          done(error);
        }
      };
      const arm = () => {
        clearTimeout(recheck);
        const at = recheckAt?.();
        if (at !== null && at !== undefined) recheck = setTimeout(check, Math.max(10, at - now()));
      };
      set.add(check);
      holders.add(done);
      const timer = setTimeout(done, waitMs);
      res.once('close', done);
      try {
        arm();
      } catch (error) {
        done(error);
      }
    });

  const sweep = () => {
    for (const [personId, s] of open) {
      try {
        if (s.store.sweep(now()) > 0) signal(personId);
        if (now() - s.usedAt > IDLE_MS && !waiters.has(personId)) {
          s.store.close();
          open.delete(personId);
        }
      } catch {
        // One unavailable store must not crash the interval or starve other people.
        // Pending requests still expire normally; the next sweep retries this store.
        o.log('commands: expiry sweep failed; retrying next interval');
      }
    }
  };
  const sweepTimer = setInterval(sweep, SWEEP_MS);
  sweepTimer.unref();

  /** The person's active (not revoked) Gauge installations. */
  const gauges = async (personId: string): Promise<string[]> =>
    [...new Set((await devices.list(personId)).filter((d) => d.kind === 'lumen' && !d.revokedAt && d.installationId).map((d) => d.installationId!))];
  /**
   * (r070) The installations commands go to by default: the Gauge engine embedded in a Vitals app once one is paired (the
   * standalone Gauge app is being retired), the standalone Gauge installations before that. An installation named in a
   * command still wins, old or new.
   */
  const targets = async (personId: string): Promise<string[]> => {
    const live = (await devices.list(personId)).filter((d) => d.kind === 'lumen' && !d.revokedAt && d.installationId);
    const embedded = live.filter((d) => d.app === 'vitals');
    return [...new Set((embedded.length ? embedded : live).map((d) => d.installationId!))];
  };
  const installationOf = async (ctx: PersonContext): Promise<string> => {
    const d = (await devices.list(ctx.personId)).find((x) => x.id === ctx.deviceId);
    if (!d?.installationId) throw new HttpError(403, 'wrong_kind', 'This route is for the ring app');
    return d.installationId;
  };
  const online = (g: GaugeStateRow | null) => Boolean(g?.lastPollAt && now() - Date.parse(g.lastPollAt) <= ONLINE_MS);
  /** The Gauge Vitals talks to: the one named, else the only one, else the one that polled last. */
  const linkOf = async (personId: string): Promise<GaugeStateRow | null> => {
    const ids = await targets(personId);
    if (ids.length === 0) return null;
    const s = store(personId);
    const rows = ids.map((id) => s.gaugeState(id) ?? { installationId: id, lastPollAt: null, appVersion: null, capabilities: [], reels: null, recording: null, stateAt: null });
    return rows.sort((a, b) => (b.lastPollAt ?? '').localeCompare(a.lastPollAt ?? ''))[0]!;
  };
  const method = (req: IncomingMessage, ...allowed: string[]) => {
    if (!allowed.includes(req.method ?? '')) throw new HttpError(405, 'method', `Use ${allowed.join(' or ')}`, { Allow: allowed.join(', ') });
  };

  // ---- Vitals ----------------------------------------------------------------------------------------------------

  async function enqueue(req: IncomingMessage, res: ServerResponse, ctx: PersonContext) {
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (!['id', 'type', 'payload', 'occurredAt', 'installationId', 'ttlS'].includes(k)) throw bad(`Unknown field ${k}`);
    if (typeof body.id !== 'string' || !COMMAND_ID.test(body.id)) throw bad('id is 16–40 letters, digits, - or _');
    if (typeof body.type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(body.type)) throw bad(`type is one of ${COMMAND_TYPES.join(', ')}`);
    const type = body.type as CommandType;
    const payload = checkPayload(type, body.payload);
    const maxTtl = COMMAND_TTL_S[type];
    if (body.ttlS !== undefined && !isInt(body.ttlS, 1, 1_000_000)) throw bad('ttlS is a whole number of seconds');
    // a client may ask for a shorter time to live, never a longer one
    const ttlS = Math.min(maxTtl, (body.ttlS as number | undefined) ?? maxTtl);
    let occurredMs: number | undefined;
    if (body.occurredAt !== undefined) {
      occurredMs = typeof body.occurredAt === 'string' ? Date.parse(body.occurredAt) : NaN;
      if (!Number.isFinite(occurredMs)) throw bad('occurredAt is an ISO date-time');
    }
    if (body.installationId !== undefined && (typeof body.installationId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.installationId))) throw bad('installationId must identify a ring app installation');
    const s = store(ctx.personId);
    const at = now();
    // a retry with a known id answers the stored command without spending the rate limit, and is looked up before the
    // target is resolved (energy F17): a Gauge paired since then never turns the retry into `ambiguous_target`
    const known = s.get(body.id);
    let target: string;
    if (known) target = typeof body.installationId === 'string' ? body.installationId : known.installationId;
    else {
      if (typeof body.installationId === 'string') {
        if (!(await gauges(ctx.personId)).includes(body.installationId)) throw new HttpError(404, 'no_gauge', 'That ring app is not paired with this server');
        target = body.installationId;
      } else {
        const ids = await targets(ctx.personId);
        if (ids.length === 0) throw new HttpError(404, 'no_gauge', 'Pair the phone with this server first');
        if (ids.length > 1) throw new HttpError(409, 'ambiguous_target', 'More than one phone is paired: name its installationId');
        target = ids[0]!;
      }
    }
    if (!known) {
      const l = enqueueLimiter.take(ctx.deviceId);
      if (!l.ok) throw new HttpError(429, 'rate_limited', 'Too many commands; wait a moment', { 'Retry-After': String(l.retryAfterSec) });
    }
    const r = s.enqueue({ id: body.id, type, payload, installationId: target, deviceId: ctx.deviceId, ttlS, ...(occurredMs !== undefined ? { occurredMs } : {}) }, at);
    if (r.kind === 'id_reused') throw new HttpError(409, 'id_reused', 'That id was used for a different command');
    if (r.kind === 'too_many_pending') throw new HttpError(429, 'too_many_pending', 'Too many commands are waiting for the phone', { 'Retry-After': '30' });
    const linked = online(s.gaugeState(target));
    if (r.kind === 'created') {
      ctx.log(`command ${r.command.id} ${type} queued${r.superseded ? ` (${r.superseded} superseded)` : ''}`);
      signal(ctx.personId);
      return sendJson(res, 201, { command: commandView(r.command), online: linked });
    }
    ctx.log(`command ${r.command.id} ${type} ${r.kind}`);
    return sendJson(res, 200, { command: commandView(r.command), online: linked, [r.kind]: true });
  }

  async function vitals(req: IncomingMessage, res: ServerResponse, path: string, query: string) {
    const ctx = await o.resolveDevice(req);
    if (path === '/v1/gauge/commands') {
      method(req, 'GET', 'POST');
      if (req.method === 'POST') {
        queryOf(query, []);
        return enqueue(req, res, ctx);
      }
      const q = queryOf(query, ['limit', 'type', 'state']);
      const limitRaw = q.get('limit');
      if (limitRaw && (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100)) throw new HttpError(400, 'bad_request', 'limit is 1–100');
      const type = q.get('type') || undefined;
      if (type && !(COMMAND_TYPES as readonly string[]).includes(type)) throw new HttpError(400, 'bad_request', `type is one of ${COMMAND_TYPES.join(', ')}`);
      const state = q.get('state') || undefined;
      if (state && !STATES.has(state)) throw new HttpError(400, 'bad_request', 'Unknown state');
      const s = store(ctx.personId);
      s.sweep(now());
      const list = s.list({ limit: limitRaw ? Number(limitRaw) : 20, ...(type ? { type: type as CommandType } : {}), ...(state ? { state: state as CommandState } : {}) });
      return sendJson(res, 200, { commands: list.map(commandView) });
    }
    if (path === '/v1/gauge/commands/state') {
      method(req, 'GET');
      queryOf(query, []);
      const g = await linkOf(ctx.personId);
      const app = (await devices.list(ctx.personId)).find((d) => d.kind === 'lumen' && d.installationId === g?.installationId)?.app ?? 'gauge';
      return sendJson(res, 200, {
        paired: g !== null, installationId: g?.installationId ?? null, app: g ? app : null, online: online(g), lastPollAt: g?.lastPollAt ?? null, appVersion: g?.appVersion ?? null,
        capabilities: g?.capabilities ?? [], reels: g?.reels ?? null, recording: g?.recording ?? null, stateAt: g?.stateAt ?? null, serverNow: new Date(now()).toISOString(),
      });
    }
    const m = /^\/v1\/gauge\/commands\/([A-Za-z0-9_-]{16,40})$/.exec(path);
    if (!m) throw new HttpError(404, 'not_found', 'Not found');
    const id = m[1]!;
    method(req, 'GET', 'DELETE');
    const s = store(ctx.personId);
    if (req.method === 'DELETE') {
      queryOf(query, []);
      const r = s.cancel(id, now());
      if (r === 'not_found') throw new HttpError(404, 'not_found', 'No such command');
      if (r === 'already_delivered') throw new HttpError(409, 'already_delivered', 'The phone already has this command');
      ctx.log(`command ${id} cancelled`);
      signal(ctx.personId);
      return sendJson(res, 200, { command: commandView(s.get(id)!) });
    }
    const q = queryOf(query, ['wait', 'since']);
    const wait = waitOf(q);
    const since = q.get('since');
    if (since && !STATES.has(since)) throw new HttpError(400, 'bad_request', 'since is a command state');
    s.sweep(now());
    if (!s.get(id)) throw new HttpError(404, 'not_found', 'No such command');
    if (since) await hold(ctx.personId, res, wait * 1000, () => s.get(id)?.state !== since);
    const c = s.get(id);
    if (!c) throw new HttpError(404, 'not_found', 'No such command');
    return sendJson(res, 200, { command: commandView(c), online: online(s.gaugeState(c.installationId)), terminal: TERMINAL_STATES.has(c.state) });
  }

  // ---- Gauge -----------------------------------------------------------------------------------------------------

  async function gauge(req: IncomingMessage, res: ServerResponse, path: string, query: string) {
    const ctx = await o.resolveLumen(req);
    const installationId = await installationOf(ctx);
    const s = store(ctx.personId);
    if (path === '/v1/lumen/commands') {
      method(req, 'GET');
      const wait = waitOf(queryOf(query, ['wait']));
      const l = pollLimiter.take(ctx.deviceId);
      if (!l.ok) throw new HttpError(429, 'rate_limited', 'Poll at most once every 2 seconds', { 'Retry-After': String(l.retryAfterSec) });
      // (r068 B2) a Gauge that went quiet (a sleeping phone, a dead loop) and polls again: say so, with the gap
      const before = s.gaugeState(installationId)?.lastPollAt;
      const gapS = before ? Math.round((now() - Date.parse(before)) / 1000) : null;
      if (gapS !== null && gapS * 1000 > ONLINE_MS) ctx.log(`commands: Gauge polling again after ${gapS} s`);
      s.notePoll(installationId, now());
      await hold(ctx.personId, res, wait * 1000, () => s.hasDeliverable(installationId, now()), () => s.nextLeaseEnd(installationId, now()));
      if (res.destroyed) return;
      const at = now();
      s.notePoll(installationId, at);
      const commands = s.takeForPoll(installationId, at);
      if (commands.length) ctx.log(`commands: ${commands.length} delivered (${commands.map((c) => `${c.id} ${c.type}`).join(', ')})`);
      return sendJson(res, 200, { now: new Date(at).toISOString(), personId: ctx.personId, maxWaitS: MAX_WAIT_S, commands: commands.map(gaugeView) });
    }
    if (path === '/v1/lumen/commands/state') {
      method(req, 'POST');
      queryOf(query, []);
      const st = checkState(await readJson(req, 4096));
      s.noteState(installationId, st, now());
      ctx.log(`commands: state from Gauge ${st.appVersion}`);
      signal(ctx.personId);
      res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const m = /^\/v1\/lumen\/commands\/([A-Za-z0-9_-]{16,40})\/ack$/.exec(path);
    if (!m) throw new HttpError(404, 'not_found', 'Not found');
    method(req, 'POST');
    queryOf(query, []);
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (!['status', 'code', 'detail', 'result'].includes(k)) throw new HttpError(400, 'bad_request', `Unknown field ${k}`);
    if (typeof body.status !== 'string' || !(ACK_STATES as readonly string[]).includes(body.status)) throw new HttpError(400, 'bad_request', `status is one of ${ACK_STATES.join(', ')}`);
    if (body.code !== undefined && (typeof body.code !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(body.code))) throw new HttpError(400, 'bad_request', 'code is a short snake_case word');
    if (body.detail !== undefined && (typeof body.detail !== 'string' || body.detail.length > 200)) throw new HttpError(400, 'bad_request', 'detail is at most 200 characters');
    if (body.result !== undefined && (!isObj(body.result) || Buffer.byteLength(JSON.stringify(body.result)) > MAX_PAYLOAD_BYTES)) throw new HttpError(400, 'bad_request', `result is an object of at most ${MAX_PAYLOAD_BYTES} bytes`);
    const status = body.status as AckState;
    const r = s.ack(m[1]!, installationId, {
      status, ...(typeof body.code === 'string' ? { code: body.code } : {}), ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
      ...(isObj(body.result) ? { result: body.result } : {}),
    }, now());
    if (r === 'not_found') throw new HttpError(404, 'not_found', 'No such command');
    if (r === 'already_terminal') throw new HttpError(409, 'already_terminal', 'This command already has its final answer');
    ctx.log(`command ${m[1]} ${status}${typeof body.code === 'string' ? ` ${body.code}` : ''}`);
    signal(ctx.personId);
    res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
  }

  const isVitals = (p: string) => p === '/v1/gauge/commands' || p.startsWith('/v1/gauge/commands/');
  const isGauge = (p: string) => p === '/v1/lumen/commands' || p.startsWith('/v1/lumen/commands/');
  return {
    owns: (path) => isVitals(path) || isGauge(path),
    handle: (req, res, path, query) => (isVitals(path) ? vitals(req, res, path, query) : gauge(req, res, path, query)),
    sweepNow: sweep,
    close() {
      clearInterval(sweepTimer);
      for (const done of [...holders]) done();
      for (const s of open.values()) s.store.close();
      open.clear();
    },
  };
}
