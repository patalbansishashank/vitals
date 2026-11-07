/**
 * Commands from Vitals to Gauge through the person's home server (energy SPEC §A.4; docs/GAUGE-COMMANDS.md): set the
 * Reels limit and apps, start / pause / resume / stop a workout recording, measure heart rate now, check for updates,
 * and (r068 B2) sync the ring now (`ring.sync`: Gauge pulls the ring's history and uploads it before it answers).
 * A command is a request, never data: it carries no health values.
 *
 *   POST   /v1/gauge/commands                 enqueue (the client id is the idempotency key, reused on every retry)
 *   GET    /v1/gauge/commands/{id}?wait&since  watch one until a terminal state (the server holds up to 25 s)
 *   GET    /v1/gauge/commands?limit&type&state recent commands
 *   DELETE /v1/gauge/commands/{id}            cancel while queued
 *   GET    /v1/gauge/commands/state           { online, lastPollAt, appVersion, capabilities, reels, recording, serverNow }
 *
 * Requests go through the paired server's own fetch (`ServerClient.chatModelOptions()`: the bearer only to the paired
 * origin, and a 401 ends the pairing there). There is no offline queue: a command that cannot reach the server fails
 * at once with `server_unreachable`, so nothing starts late.
 */
import { ServerError, getServerClient, type ServerClient } from './server';

export const GAUGE_COMMAND_TYPES = ['reels.set', 'workout.start', 'workout.pause', 'workout.resume', 'workout.stop', 'hr.measure', 'update.check', 'ring.sync'] as const;
export type GaugeCommandType = (typeof GAUGE_COMMAND_TYPES)[number];
export type GaugeCommandState = 'queued' | 'delivered' | 'running' | 'done' | 'failed' | 'rejected' | 'noop' | 'expired' | 'superseded' | 'cancelled';
export const TERMINAL_COMMAND_STATES: ReadonlySet<GaugeCommandState> = new Set(['done', 'failed', 'rejected', 'noop', 'expired', 'superseded', 'cancelled']);
export const isTerminal = (s: GaugeCommandState) => TERMINAL_COMMAND_STATES.has(s);
export const isWorkoutCommand = (t: GaugeCommandType) => t.startsWith('workout.');

export type ReelsApp = 'instagram' | 'youtube';
export type WorkoutType = 'walk' | 'run' | 'cycle' | 'other';

/**
 * (0.6.3 S26) Feature tokens Gauge reports beside its command types: `workout.start.activity_type_id` = this Gauge build
 * (2.8.1+) takes `activityTypeId` on `workout.start`. An older Gauge rejects a payload key it does not know, so the
 * server path sends the id only when the token is reported.
 */
export const GAUGE_ACTIVITY_TYPE_CAPABILITY = 'workout.start.activity_type_id';
export type GaugeCapability = GaugeCommandType | typeof GAUGE_ACTIVITY_TYPE_CAPABILITY;
/** The catalogue id shape Gauge accepts (lowercase words joined by `_`, at most 48 characters). */
export const ACTIVITY_TYPE_ID = /^[a-z0-9][a-z0-9_]{0,47}$/;

/** Each type's payload (closed schemas; the server and Gauge check the ranges again). */
export interface GaugeCommandPayloads {
  'reels.set': { dailyLimit?: number; apps?: ReelsApp[]; enabled?: boolean; countdownSeconds?: number };
  /**
   * `type` is the coarse ring sport mode; `activityTypeId` (0.6.3 S26) the catalogue activity the person picked
   * (`treadmill_run`, `air_bike`, …), kept on the session and uploaded back as `activity_type_id`.
   */
  'workout.start': { type: WorkoutType; useGps?: boolean; activityTypeId?: string };
  'workout.pause': { sessionId?: string };
  'workout.resume': { sessionId?: string };
  'workout.stop': { sessionId?: string };
  'hr.measure': Record<string, never>;
  'update.check': Record<string, never>;
  /** (r068 B2) Gauge 2.8.4+: sync the ring now and upload; `done {syncedAt, complete, uploaded}`. */
  'ring.sync': Record<string, never>;
}

/** A command as the server stores it. */
export interface GaugeCommand {
  id: string;
  type: GaugeCommandType;
  payload: Record<string, unknown>;
  state: GaugeCommandState;
  code: string | null;
  detail: string | null;
  result: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string;
  occurredAt: string | null;
  deliveredAt: string | null;
  attempt: number;
  installationId: string;
  updatedAt: string;
}

export interface GaugeReelsState {
  enabled: boolean;
  dailyLimit: number;
  countdownSeconds: number;
  apps: string[];
}
export interface GaugeRecordingState {
  sessionId: string;
  status: 'recording' | 'paused';
  type: string;
  startedAt: string;
}

/** `GET /v1/gauge/commands/state`. */
export interface GaugeLinkState {
  paired: boolean;
  installationId: string | null;
  /** Gauge polled in the last 55 s. */
  online: boolean;
  lastPollAt: string | null;
  appVersion: string | null;
  capabilities: GaugeCapability[];
  reels: GaugeReelsState | null;
  recording: GaugeRecordingState | null;
  serverNow: string;
}

/** Why a request did not give an answer. */
export type GaugeCommandProblem =
  | 'server_unreachable'
  | 'not_paired'
  | 'unauthorized'
  | 'bad_command'
  | 'no_gauge'
  | 'id_reused'
  | 'ambiguous_target'
  | 'too_many_pending'
  | 'rate_limited'
  | 'not_found'
  | 'already_delivered'
  | 'server_error';

export type Answer<T> = ({ ok: true } & T) | { ok: false; problem: GaugeCommandProblem; message?: string };

export interface SendInput<T extends GaugeCommandType = GaugeCommandType> {
  /** Reuse the same id on every retry of one user action. */
  id: string;
  type: T;
  payload: GaugeCommandPayloads[T];
  ttlS?: number;
  installationId?: string;
}

export interface GaugeCommandsApi {
  send<T extends GaugeCommandType>(c: SendInput<T>, o?: { signal?: AbortSignal }): Promise<Answer<{ command: GaugeCommand; online: boolean; deduped?: boolean; coalesced?: boolean }>>;
  /** One read; with `since`, the server holds up to `wait` s while the state equals it. */
  get(id: string, o?: { wait?: number; since?: GaugeCommandState; signal?: AbortSignal }): Promise<Answer<{ command: GaugeCommand; online: boolean }>>;
  /** Reads until a terminal state (or the signal aborts, or `deadlineMs` passes); `onUpdate` hears every change. */
  watch(id: string, o?: { since?: GaugeCommandState; signal?: AbortSignal; deadlineMs?: number; onUpdate?: (c: GaugeCommand, online: boolean) => void }): Promise<Answer<{ command: GaugeCommand; online: boolean }>>;
  list(o?: { limit?: number; type?: GaugeCommandType; state?: GaugeCommandState }): Promise<Answer<{ commands: GaugeCommand[] }>>;
  cancel(id: string): Promise<Answer<{ command: GaugeCommand }>>;
  state(): Promise<Answer<{ state: GaugeLinkState }>>;
}

/** A hold is 25 s on the server; the client allows the network some more. */
export const WATCH_WAIT_S = 25;
const REQUEST_TIMEOUT_MS = 20_000;
const HOLD_SLACK_MS = 15_000;

/** A fresh command id (a UUID: 36 URL-safe characters). */
export function newCommandId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Server = Pick<ServerClient, 'chatModelOptions' | 'isPaired'>;

const PROBLEMS: ReadonlySet<string> = new Set(['bad_command', 'no_gauge', 'id_reused', 'ambiguous_target', 'too_many_pending', 'rate_limited', 'not_found', 'already_delivered']);

export function createGaugeCommandsApi(opts: { server?: Server | (() => Server) } = {}): GaugeCommandsApi {
  const serverOf = (): Server => (typeof opts.server === 'function' ? opts.server() : (opts.server ?? getServerClient()));

  async function request<T>(method: string, path: string, o: { body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Answer<T>> {
    const server = serverOf();
    if (!server.isPaired()) return { ok: false, problem: 'not_paired' };
    let base: string;
    let doFetch: typeof fetch;
    try {
      const w = server.chatModelOptions();
      base = w.serverUrl.replace(/\/+$/, '');
      doFetch = w.deps.fetch;
    } catch (e) {
      return { ok: false, problem: e instanceof ServerError && e.code === 'not_paired' ? 'not_paired' : 'server_unreachable' };
    }
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (o.signal?.aborted) ctl.abort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { accept: 'application/json', ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal: ctl.signal,
        cache: 'no-store',
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      if (e instanceof ServerError && e.code === 'not_paired') return { ok: false, problem: 'not_paired' };
      return { ok: false, problem: 'server_unreachable' };
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }
    let body: Record<string, unknown>;
    try {
      const text = await res.text();
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (res.ok) return { ok: true, ...(body as T) };
    if (res.status === 401 || res.status === 403) return { ok: false, problem: 'unauthorized' };
    const code = typeof body.error === 'string' ? body.error : '';
    const message = typeof body.message === 'string' ? body.message : undefined;
    return { ok: false, problem: PROBLEMS.has(code) ? (code as GaugeCommandProblem) : 'server_error', ...(message ? { message } : {}) };
  }

  const api: GaugeCommandsApi = {
    send: (c, o = {}) =>
      request('POST', '/v1/gauge/commands', {
        body: { id: c.id, type: c.type, payload: c.payload, occurredAt: new Date().toISOString(), ...(c.ttlS ? { ttlS: c.ttlS } : {}), ...(c.installationId ? { installationId: c.installationId } : {}) },
        ...(o.signal ? { signal: o.signal } : {}),
      }),
    get(id, o = {}) {
      const qs = new URLSearchParams();
      if (o.since) {
        qs.set('wait', String(Math.min(WATCH_WAIT_S, Math.max(0, o.wait ?? WATCH_WAIT_S))));
        qs.set('since', o.since);
      }
      const q = qs.toString();
      return request('GET', `/v1/gauge/commands/${encodeURIComponent(id)}${q ? `?${q}` : ''}`, {
        ...(o.signal ? { signal: o.signal } : {}),
        timeoutMs: (o.since ? (o.wait ?? WATCH_WAIT_S) * 1000 : 0) + HOLD_SLACK_MS,
      });
    },
    async watch(id, o = {}) {
      const deadline = o.deadlineMs ?? Number.POSITIVE_INFINITY;
      let since = o.since;
      let last: { ok: true; command: GaugeCommand; online: boolean } | null = null;
      for (;;) {
        const remaining = deadline - Date.now();
        if (last && remaining <= 0) return last;
        const wait = Number.isFinite(remaining) ? Math.min(WATCH_WAIT_S, Math.max(0, Math.ceil(remaining / 1000))) : WATCH_WAIT_S;
        const r = await api.get(id, { ...(since && wait > 0 ? { since, wait } : {}), ...(o.signal ? { signal: o.signal } : {}) });
        if (!r.ok) return r;
        last = r;
        if (r.command.state !== since) o.onUpdate?.(r.command, r.online);
        if (isTerminal(r.command.state) || Date.now() >= deadline || o.signal?.aborted) return r;
        since = r.command.state;
      }
    },
    list(o = {}) {
      const qs = new URLSearchParams();
      if (o.limit) qs.set('limit', String(o.limit));
      if (o.type) qs.set('type', o.type);
      if (o.state) qs.set('state', o.state);
      const q = qs.toString();
      return request('GET', `/v1/gauge/commands${q ? `?${q}` : ''}`);
    },
    cancel: (id) => request('DELETE', `/v1/gauge/commands/${encodeURIComponent(id)}`),
    async state() {
      const r = await request<GaugeLinkState>('GET', '/v1/gauge/commands/state');
      if (!r.ok) return r;
      const { ok: _ok, ...state } = r;
      return { ok: true, state: state as GaugeLinkState };
    },
  };
  return api;
}

/** The app's command client, over the app's server client (read on every call). */
export const gaugeCommandsApi: GaugeCommandsApi = createGaugeCommandsApi({ server: () => getServerClient() });
