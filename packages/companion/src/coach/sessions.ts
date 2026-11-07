/**
 * Server coach sessions (docs/SERVER.md "Coach"): kept in memory only, one folder each under the runtime dir
 * (`/run/user/<uid>/vitals-coach/<session>`, RAM-backed), one short-lived agent token each (scope `edit`, which on this
 * server only stages proposals), deleted `retentionHours` after the last message with the CLI's own transcript. A
 * restart drops every session: the startup sweep removes the folders, their transcripts and the tokens, and clients get
 * 404 ("start a new one").
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRateLimiter, type Logger } from '../security.ts';
import { dayIn } from '../usage.ts';
import { claudeProjectSlug, createBackend, createThinkingProgress, runQuick, type CoachBackend, type CoachEvent, type TurnImage } from './backends.ts';
import type { CoachBackendName, CoachConfig } from './config.ts';
import { contextBlock, GREETINGS, systemPrompt, type CoachApp } from './personas.ts';
import { createReadiness, REASONS } from './status.ts';
import type { ToolResultEnvelope } from '../toolManifest.ts';

export const SWEEP_EVERY_MS = 10 * 60_000;
const HOUR = 3_600_000;

export class CoachError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const COACH_MESSAGES = {
  session_expired: 'This conversation has ended. Start a new one.',
  busy: 'The coach is still answering.',
  server_busy: 'The coach on your server is busy. Try again in a minute.',
  rate_limited: 'Too many requests in a short time. Wait a minute and try again.',
  daily_cap: "Today's limit for the coach on your server is reached. It starts again tomorrow.",
  usage_limit: "The AI's plan limit on your server is reached for now. Try again later.",
  timeout: 'The coach took too long and was stopped. Try again.',
  backend_error: 'The coach on your server hit a problem. Try again.',
  session_full: 'This conversation is full. Start a new one.',
} as const;

export interface CoachCaller {
  personId: string;
  deviceId: string;
  kind: 'device' | 'lumen';
  timeZone: string;
}

/** The short-lived agent tokens, one per session (the home role's device store). */
export interface CoachTokens {
  mint(personId: string, sessionId: string): Promise<{ token: string; id: string }>;
  /** Removes the token and closes its MCP sessions. */
  remove(personId: string, id: string): Promise<void>;
  /** Removes every coach token of every person (startup: no session survives a restart). */
  removeAll(): Promise<number>;
}

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

interface Turn {
  abort: AbortController;
  emit: (e: CoachEvent) => void;
}

interface Session {
  id: string;
  personId: string;
  deviceId: string;
  app: CoachApp;
  title?: string;
  screen?: string;
  date?: string;
  timeZone: string;
  createdAt: number;
  lastMessageAt: number;
  expiresAt: number;
  backend: CoachBackendName;
  cliSessionId: string | null;
  tokenId: string;
  token: string;
  dir: string;
  messages: CoachMessage[];
  turn: Turn | null;
}

export interface CoachOptions {
  cfg: CoachConfig;
  tokens: CoachTokens;
  /** The server's own loopback `/mcp` (known once it listens); null when it listens on no loopback address. */
  mcpUrl: () => string | null;
  log: Logger;
  now?: () => number;
  /** Tests: other backends (fake CLIs). */
  backends?: Partial<Record<CoachBackendName, CoachBackend>>;
}

export function createCoach(o: CoachOptions) {
  const { tokens, log, now = Date.now } = o;
  // the isolation mode may drop to "none" when systemd-run turns out not to work; backends read this copy
  const cfg: CoachConfig = { ...o.cfg };
  const backends: Record<CoachBackendName, CoachBackend> = {
    claude: o.backends?.claude ?? createBackend('claude', cfg),
    codex: o.backends?.codex ?? createBackend('codex', cfg),
  };
  const readiness = createReadiness({ cfg, backends, loopback: () => o.mcpUrl() !== null, now });
  const sessions = new Map<string, Session>();
  const byToken = new Map<string, Session>();
  const perMinute = createRateLimiter({ capacity: Math.max(1, Math.ceil(cfg.turnsPerMinute)), perMinute: cfg.turnsPerMinute }, now);
  const daily = new Map<string, { day: string; n: number }>();
  let running = 0;
  const runningPerPerson = new Map<string, number>();

  const iso = (t: number) => new Date(t).toISOString();
  const retention = () => cfg.retentionHours * HOUR;

  // ------------------------------------------------------------------------------------------------------------
  // Startup sweep and the systemd scope probe

  // a coach that is off touches nothing (no folder, no transcripts, no tokens)
  const startup = (async () => {
    if (!cfg.enabled) return;
    await mkdir(cfg.runtimeDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
    for (const name of await readdir(cfg.runtimeDir).catch(() => [] as string[])) await rm(join(cfg.runtimeDir, name), { recursive: true, force: true }).catch(() => undefined);
    const prefix = `${claudeProjectSlug(cfg.runtimeDir)}-`;
    const projects = join(cfg.claudeConfigDir, 'projects');
    for (const d of await readdir(projects).catch(() => [] as string[])) if (d.startsWith(prefix)) await rm(join(projects, d), { recursive: true, force: true }).catch(() => undefined);
    const n = await tokens.removeAll().catch(() => 0);
    if (n) log(`coach: removed ${n} coach token(s) left from before the restart`);
  })();

  let scopeProbe: Promise<void> | null = null;
  let scopeFailed = false;
  /** systemd-run needs the user manager; without it the CLI runs directly and only one turn runs at a time. */
  const probeScope = () =>
    (scopeProbe ??= (async () => {
      if (cfg.isolation !== 'systemd' || !cfg.systemdRunPath) return;
      const r = await runQuick(cfg.systemdRunPath, ['--user', '--scope', '--quiet', '--collect', '--', 'true'], { ...process.env }, cfg.runtimeDir, 15_000);
      if (r.code !== 0) {
        cfg.isolation = 'none';
        scopeFailed = true;
        log('coach: systemd-run --user does not work here; the CLI runs without its own memory cap, one turn at a time');
      }
    })());
  // without its own scope a CLI counts against the server's memory: one at a time then
  const maxConcurrent = () => (scopeFailed ? 1 : cfg.maxConcurrent);

  // ------------------------------------------------------------------------------------------------------------
  // Lifecycle

  const destroy = async (s: Session, why: string) => {
    if (!sessions.has(s.id)) return;
    sessions.delete(s.id);
    byToken.delete(s.tokenId);
    s.turn?.abort.abort();
    await tokens.remove(s.personId, s.tokenId).catch(() => undefined);
    await rm(s.dir, { recursive: true, force: true }).catch(() => undefined);
    await backends[s.backend].forget(s.dir, s.cliSessionId).catch(() => undefined);
    log(`coach: session ${s.id} deleted (${why})`);
  };

  const expired = (s: Session) => !s.turn && s.expiresAt <= now();

  const sweep = async () => {
    for (const s of [...sessions.values()]) if (expired(s)) await destroy(s, 'expired');
  };
  const timer = setInterval(() => void sweep().catch(() => undefined), SWEEP_EVERY_MS);
  timer.unref();

  /** The caller's own live session, or 404 (unknown, another caller's, or expired: then it is deleted now). */
  const find = async (c: CoachCaller, id: string): Promise<Session> => {
    const s = sessions.get(id);
    if (!s || s.personId !== c.personId || s.deviceId !== c.deviceId) throw new CoachError(404, 'session_expired', COACH_MESSAGES.session_expired);
    if (expired(s)) {
      await destroy(s, 'expired');
      throw new CoachError(404, 'session_expired', COACH_MESSAGES.session_expired);
    }
    return s;
  };

  const unavailable = (reason: string) => new CoachError(503, 'coach_unavailable', reason, { 'Retry-After': '60' });

  const summary = (s: Session) => ({ sessionId: s.id, id: s.id, app: s.app, ...(s.title ? { title: s.title } : {}), createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) });

  return {
    cfg,
    ready: startup,
    async status() {
      await probeScope();
      const r = await readiness.current();
      return { available: r.available, backend: r.backend, ...(cfg.model ? { model: cfg.model } : {}), retentionHours: cfg.retentionHours, ...(r.reason ? { reason: r.reason } : {}) };
    },

    async create(c: CoachCaller, b: { app: CoachApp; title?: string; screen?: string; date?: string }) {
      await startup;
      const r = await readiness.current();
      if (!r.available) throw unavailable(r.reason ?? REASONS.disabled);
      const mcpUrl = o.mcpUrl();
      if (!mcpUrl) throw unavailable(REASONS.no_loopback);
      const mine = [...sessions.values()].filter((s) => s.personId === c.personId).sort((a, b2) => a.lastMessageAt - b2.lastMessageAt);
      while (mine.length >= cfg.maxSessionsPerPerson) {
        const idle = mine.findIndex((s) => !s.turn);
        if (idle === -1) throw new CoachError(429, 'busy', COACH_MESSAGES.busy, { 'Retry-After': '5' });
        await destroy(mine.splice(idle, 1)[0]!, 'too many sessions');
      }
      const id = randomUUID();
      const dir = join(cfg.runtimeDir, id);
      await mkdir(join(dir, 'tmp'), { recursive: true, mode: 0o700 });
      const backend = backends[r.backend];
      let minted: { token: string; id: string };
      try {
        await backend.prepare(dir, mcpUrl);
        minted = await tokens.mint(c.personId, id);
      } catch (e) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw e;
      }
      log.addSecret(minted.token);
      const t = now();
      const s: Session = {
        id, personId: c.personId, deviceId: c.deviceId, app: b.app, ...(b.title ? { title: b.title } : {}), ...(b.screen ? { screen: b.screen } : {}), ...(b.date ? { date: b.date } : {}),
        timeZone: c.timeZone, createdAt: t, lastMessageAt: t, expiresAt: t + retention(), backend: r.backend,
        cliSessionId: r.backend === 'claude' ? randomUUID() : null, tokenId: minted.id, token: minted.token, dir, messages: [], turn: null,
      };
      sessions.set(id, s);
      byToken.set(minted.id, s);
      log(`coach: session ${id} opened (person ${c.personId}, ${b.app}, ${r.backend})`);
      return { sessionId: id, expiresAt: iso(s.expiresAt), greeting: GREETINGS[b.app] };
    },

    async list(c: CoachCaller) {
      const out = [];
      for (const s of [...sessions.values()]) {
        if (s.personId !== c.personId || s.deviceId !== c.deviceId) continue;
        if (expired(s)) await destroy(s, 'expired');
        else out.push(summary(s));
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async get(c: CoachCaller, id: string) {
      const s = await find(c, id);
      return { ...summary(s), messages: s.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, at: m.at })) };
    },

    async remove(c: CoachCaller, id: string) {
      await destroy(await find(c, id), 'deleted');
    },

    async keep(c: CoachCaller, id: string) {
      const s = await find(c, id);
      const t = now();
      s.expiresAt = Math.min(Math.max(s.expiresAt, t) + retention(), t + cfg.maxKeepHours * HOUR);
      return { sessionId: s.id, expiresAt: iso(s.expiresAt) };
    },

    /**
     * Checks everything that answers with an HTTP status (404, 409, 429, 503) and claims the turn; then `run` streams
     * it. Throws CoachError before anything is sent.
     */
    async begin(c: CoachCaller, id: string, msg: { text: string; images: TurnImage[] }) {
      const s = await find(c, id);
      if (s.turn) throw new CoachError(429, 'busy', COACH_MESSAGES.busy, { 'Retry-After': '5' });
      if (s.messages.length + 2 > cfg.maxMessagesPerSession) throw new CoachError(409, 'session_full', COACH_MESSAGES.session_full);
      await probeScope();
      if ((runningPerPerson.get(c.personId) ?? 0) >= cfg.maxConcurrentPerPerson) throw new CoachError(429, 'busy', COACH_MESSAGES.busy, { 'Retry-After': '5' });
      if (running >= maxConcurrent()) throw new CoachError(429, 'server_busy', COACH_MESSAGES.server_busy, { 'Retry-After': '20' });
      const rate = perMinute.take(c.personId);
      if (!rate.ok) throw new CoachError(429, 'rate_limited', COACH_MESSAGES.rate_limited, { 'Retry-After': String(rate.retryAfterSec) });
      const day = dayIn(c.timeZone, new Date(now()));
      const d = daily.get(c.personId);
      const count = d?.day === day ? d.n : 0;
      if (count >= cfg.turnsPerDay) throw new CoachError(429, 'daily_cap', COACH_MESSAGES.daily_cap, { 'Retry-After': '3600' });
      const ready = await readiness.current();
      // an existing session stays on its own backend (a Claude session cannot continue in Codex)
      const own = ready.backend === s.backend ? ready : await (async () => {
        const b = backends[s.backend];
        return { available: Boolean(b.binary) && (await b.signedIn()), reason: REASONS.not_signed_in };
      })();
      if (!own.available) throw unavailable(own.reason ?? REASONS.not_signed_in);
      const mcpUrl = o.mcpUrl();
      if (!mcpUrl) throw unavailable(REASONS.no_loopback);

      daily.set(c.personId, { day, n: count + 1 });
      running += 1;
      runningPerPerson.set(c.personId, (runningPerPerson.get(c.personId) ?? 0) + 1);
      const turn: Turn = { abort: new AbortController(), emit: () => undefined };
      s.turn = turn;
      const t = now();
      s.messages.push({ id: randomUUID(), role: 'user', text: msg.text, at: iso(t) });
      s.lastMessageAt = t;
      s.expiresAt = Math.max(s.expiresAt, t + retention());
      const first = !(await backends[s.backend].started(s.dir, s.cliSessionId).catch(() => false));
      const text = first ? `${contextBlock({ app: s.app, ...(s.title ? { title: s.title } : {}), ...(s.screen ? { screen: s.screen } : {}), ...(s.date ? { date: s.date } : {}), timeZone: s.timeZone }, new Date(t))}\n\n${msg.text}` : msg.text;

      const finish = () => {
        running -= 1;
        const n = (runningPerPerson.get(c.personId) ?? 1) - 1;
        if (n <= 0) runningPerPerson.delete(c.personId);
        else runningPerPerson.set(c.personId, n);
        s.turn = null;
      };

      return {
        abort: () => turn.abort.abort(),
        /** Streams the turn to `emit`; resolves when the CLI is done. Never throws. */
        async run(emit: (e: CoachEvent) => void): Promise<void> {
          turn.emit = emit;
          const backend = backends[s.backend];
          // the model may think for seconds before its first word: a "thinking" status line meanwhile
          const thinking = createThinkingProgress((e) => turn.emit(e));
          try {
            const out = await backend.run(
              { dir: s.dir, cliSessionId: s.cliSessionId, first, text, images: msg.images, systemPrompt: systemPrompt(s.app), token: s.token, mcpUrl },
              { signal: turn.abort.signal, onEvent: thinking.emit },
            );
            if (!turn.abort.signal.aborted) thinking.end();
            s.cliSessionId = out.cliSessionId ?? s.cliSessionId;
            if (out.ok) {
              const at = now();
              const messageId = randomUUID();
              s.messages.push({ id: messageId, role: 'assistant', text: out.text, at: iso(at) });
              s.lastMessageAt = at;
              s.expiresAt = Math.max(s.expiresAt, at + retention());
              turn.emit({ type: 'done', messageId });
              return;
            }
            log(`coach: turn in session ${s.id} failed (${out.failure})`);
            if (out.failure === 'usage_limit' || out.failure === 'coach_unavailable') readiness.noteFailure(s.backend, out.failure, !out.deltaSent);
            if (out.failure === 'aborted') return;
            const message = out.failure === 'coach_unavailable' ? REASONS.not_signed_in : COACH_MESSAGES[out.failure];
            turn.emit({ type: 'error', code: out.failure, message });
          } catch (e) {
            log(`coach: turn in session ${s.id} failed (${e instanceof Error ? e.name : 'error'})`);
            thinking.end();
            turn.emit({ type: 'error', code: 'backend_error', message: COACH_MESSAGES.backend_error });
          } finally {
            thinking.end();
            finish();
            // deleted while it ran: the CLI may have written its transcript after the delete
            if (!sessions.has(s.id)) await backend.forget(s.dir, s.cliSessionId).catch(() => undefined);
          }
        },
      };
    },

    /** The `/mcp` observer: a tool call by a session's token → `tool done` and, for a staged change, `proposal`. */
    onToolCall(e: { tokenId: string; tool: string; envelope: ToolResultEnvelope }) {
      const s = byToken.get(e.tokenId);
      if (!s?.turn) return;
      s.turn.emit({ type: 'tool', name: e.tool, status: 'done' });
      if (e.envelope.status === 'pending_user' && e.envelope.changeId) s.turn.emit({ type: 'proposal', id: e.envelope.changeId, summary: e.envelope.summary });
    },

    /** Tests and status: sessions in memory. */
    size: () => sessions.size,
    sweep,
    async close() {
      clearInterval(timer);
      await startup.catch(() => undefined);
      for (const s of [...sessions.values()]) await destroy(s, 'server stopping');
    },
  };
}

export type Coach = ReturnType<typeof createCoach>;
