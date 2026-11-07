/**
 * The AI CLIs the server coach drives (docs/SERVER.md "Coach"): Claude Code (primary) and Codex (opt-in fallback). One
 * process per turn, in the session's own folder, inside a transient systemd scope with a memory cap (so a CLI can never
 * push the server over its own MemoryMax). The agent token reaches the CLI only through its environment
 * (`VITALS_TOKEN`); argv and files never hold it.
 *
 * Claude Code runs isolated from the owner's own setup: `--restricted` and `--setting-sources ""` load no user, project
 * or local settings (so the owner's hooks never see a health chat), `--settings {"disableAllHooks":true}` turns off any
 * other hook, `--strict-mcp-config` loads only our `mcp.json`, `--tools ""` removes every built-in tool and
 * `--allowedTools mcp__vitals` allows only the server's own tools.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoachBackendName, CoachConfig } from './config.ts';

export const TOKEN_ENV = 'VITALS_TOKEN';
export const MCP_SERVER_NAME = 'vitals';
export const COACH_SLICE = 'vitals-coach.slice';

export type CoachEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' }
  | { type: 'proposal'; id: string; summary: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string };

export type TurnFailure = 'usage_limit' | 'timeout' | 'backend_error' | 'coach_unavailable' | 'aborted';

export interface TurnImage {
  mime: string;
  data: Buffer;
}

export interface TurnInput {
  /** The session folder (cwd of the CLI). */
  dir: string;
  /** Claude: the `--session-id` we chose. Codex: the thread id from the first turn (null before it). */
  cliSessionId: string | null;
  first: boolean;
  text: string;
  images: TurnImage[];
  systemPrompt: string;
  token: string;
  mcpUrl: string;
}

export type TurnOutcome =
  | { ok: true; text: string; cliSessionId: string | null }
  | { ok: false; failure: TurnFailure; deltaSent: boolean; cliSessionId: string | null };

export interface RunOptions {
  signal: AbortSignal;
  onEvent: (e: CoachEvent) => void;
}

export interface CoachBackend {
  name: CoachBackendName;
  /** Writes what the CLI reads from the session folder (never the token). */
  prepare(dir: string, mcpUrl: string): Promise<void>;
  run(input: TurnInput, o: RunOptions): Promise<TurnOutcome>;
  /** Removes the CLI's own copies of the session (transcripts and per-session files). */
  forget(dir: string, cliSessionId: string | null): Promise<void>;
  /** True once the CLI holds the conversation (so the next turn resumes it). */
  started(dir: string, cliSessionId: string | null): Promise<boolean>;
  /** The binary to check for readiness. */
  binary: string | null;
  /** `auth status` style readiness: true when signed in. */
  signedIn(): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------------------------
// Process running

export interface SpawnPlan {
  command: string;
  args: string[];
}

/** Wraps a CLI in a transient scope under `vitals-coach.slice` with a memory cap (or runs it directly). */
export function spawnPlan(cfg: Pick<CoachConfig, 'isolation' | 'systemdRunPath' | 'memoryMaxMB' | 'turnTimeoutSec'>, command: string, args: string[]): SpawnPlan {
  if (cfg.isolation !== 'systemd' || !cfg.systemdRunPath) return { command, args };
  return {
    command: cfg.systemdRunPath,
    args: [
      '--user', '--scope', '--quiet', '--collect', `--slice=${COACH_SLICE}`,
      '-p', `MemoryMax=${cfg.memoryMaxMB}M`, '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=150%',
      '-p', `RuntimeMaxSec=${Math.ceil(cfg.turnTimeoutSec) + 30}`,
      '--', command, ...args,
    ],
  };
}

/**
 * The CLI's environment: a small fixed set, never the server's own environment (which may hold other secrets). `tmp`
 * is its TMPDIR (the session folder's `tmp/`, removed with it).
 */
export function cliEnv(cfg: Pick<CoachConfig, 'home' | 'env'>, tmp: string, token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = (k: string) => (base[k] ? { [k]: base[k] } : {});
  return {
    HOME: cfg.home,
    PATH: [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    LANG: base.LANG || 'C.UTF-8',
    ...keep('USER'), ...keep('LOGNAME'), ...keep('XDG_RUNTIME_DIR'), ...keep('DBUS_SESSION_BUS_ADDRESS'),
    TMPDIR: tmp,
    [TOKEN_ENV]: token,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...cfg.env,
  };
}

export interface CliRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  timedOut: boolean;
  idle: boolean;
  aborted: boolean;
  spawnError: boolean;
}

/**
 * Runs one CLI turn: writes `stdin` and closes it, hands every stdout JSON line to `onLine`, keeps the last 16 KB of
 * stderr (for error mapping only; never logged or returned raw). The process group is killed on abort, on the wall
 * clock timeout and when the CLI says nothing for `idleMs`.
 */
export function runCli(o: {
  plan: SpawnPlan;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  timeoutMs: number;
  idleMs: number;
  signal: AbortSignal;
  onLine: (value: unknown) => void;
}): Promise<CliRun> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    const state = { timedOut: false, idle: false, aborted: false };
    let stderr = '';
    try {
      child = spawn(o.plan.command, o.plan.args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: null, signal: null, stderr: '', ...state, spawnError: true });
      return;
    }
    let killTimer: NodeJS.Timeout | null = null;
    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const group = (sig: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      };
      group('SIGTERM');
      killTimer ??= setTimeout(() => group('SIGKILL'), 3_000);
      killTimer.unref();
    };
    const wall = setTimeout(() => {
      state.timedOut = true;
      kill();
    }, o.timeoutMs);
    let idle = setTimeout(() => undefined, 0);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        state.idle = true;
        kill();
      }, o.idleMs);
    };
    bump();
    const onAbort = () => {
      state.aborted = true;
      kill();
    };
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener('abort', onAbort, { once: true });

    let buf = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      bump();
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let v: unknown;
        try {
          v = JSON.parse(line);
        } catch {
          continue;
        }
        try {
          o.onLine(v);
        } catch {
          // a mapping bug must not leave the turn hanging
        }
      }
      if (buf.length > 8 * 1024 * 1024) buf = '';
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      bump();
      stderr = (stderr + chunk).slice(-16 * 1024);
    });
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(o.stdin);
    let spawnError = false;
    child.on('error', () => {
      spawnError = true;
    });
    child.on('close', (code, signal) => {
      clearTimeout(wall);
      clearTimeout(idle);
      if (killTimer) clearTimeout(killTimer);
      o.signal.removeEventListener('abort', onAbort);
      resolve({ code, signal, stderr, ...state, spawnError });
    });
  });
}

/** Runs a short helper command (`auth status`, `login status`); never throws. */
export function runQuick(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs = 15_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: null, out: '' });
      return;
    }
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const add = (c: Buffer) => {
      out = (out + c.toString('utf8')).slice(-64 * 1024);
    };
    child.stdout!.on('data', add);
    child.stderr!.on('data', add);
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

const USAGE_RE = /usage limit|rate limit|rate_limit|limit reached|quota|too many requests|\b429\b|overloaded/i;
const AUTH_RE = /not logged in|log ?in again|please run .*login|authenticat|oauth|invalid api key|credential|unauthori[sz]ed|\b401\b/i;

/** The failure a CLI's error text points at. */
export function classifyFailure(text: string, status?: number | null): TurnFailure {
  if (status === 429 || status === 529 || USAGE_RE.test(text)) return 'usage_limit';
  if (status === 401 || status === 403 || AUTH_RE.test(text)) return 'coach_unavailable';
  return 'backend_error';
}

const failureOf = (r: CliRun, reported: TurnFailure | null): TurnFailure => {
  if (r.aborted) return 'aborted';
  if (r.timedOut || r.idle) return 'timeout';
  if (reported) return reported;
  if (r.spawnError) return 'coach_unavailable';
  return classifyFailure(r.stderr);
};

// ---------------------------------------------------------------------------------------------------------------
// Claude Code

export const CLAUDE_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
export const CLAUDE_SETTINGS = JSON.stringify({ disableAllHooks: true });

/** `mcp.json` for Claude Code: our `/mcp` with the bearer read from the environment at start. */
export function claudeMcpConfig(mcpUrl: string): string {
  return `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } } }, null, 2)}\n`;
}

export function claudeArgs(o: { dir: string; systemPrompt: string; sessionId: string; first: boolean; model?: string | null; effort?: string | null }): string[] {
  return [
    '-p',
    '--restricted',
    '--setting-sources', '',
    '--settings', CLAUDE_SETTINGS,
    '--strict-mcp-config',
    '--mcp-config', join(o.dir, 'mcp.json'),
    '--tools', '',
    '--allowedTools', `mcp__${MCP_SERVER_NAME}`,
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--input-format', 'stream-json',
    '--system-prompt', o.systemPrompt,
    ...(o.first ? ['--session-id', o.sessionId] : ['--resume', o.sessionId]),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

/** The user turn as one stream-json line: text and image blocks. */
export function claudeUserLine(text: string, images: TurnImage[]): string {
  const content = [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data.toString('base64') } })),
    { type: 'text', text },
  ];
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

/**
 * The "thinking" progress line (docs CONTRACT: the optional tool event). The model may reason for 3-15 s before its
 * first word; the apps show this as a status line so the reply does not look stuck.
 */
export const THINKING_TOOL = 'thinking';
/** Without a thinking chunk by then (Codex, or a CLI that hides it), the line goes up anyway. */
export const THINKING_DELAY_MS = 300;

/**
 * Wraps a turn's event sink: `tool thinking start` on the backend's first thinking signal or after `delayMs`,
 * `tool thinking done` on the first text delta (or at `end()`). At most one start and one done per turn.
 */
export function createThinkingProgress(emit: (e: CoachEvent) => void, delayMs = THINKING_DELAY_MS) {
  let state: 'waiting' | 'shown' | 'over' = 'waiting';
  const start = () => {
    if (state !== 'waiting') return;
    clearTimeout(timer);
    state = 'shown';
    emit({ type: 'tool', name: THINKING_TOOL, status: 'start' });
  };
  const end = () => {
    clearTimeout(timer);
    if (state === 'shown') emit({ type: 'tool', name: THINKING_TOOL, status: 'done' });
    state = 'over';
  };
  const timer = setTimeout(start, delayMs);
  return {
    emit(e: CoachEvent) {
      if (e.type === 'tool' && e.name === THINKING_TOOL) {
        if (e.status === 'start') start();
        return;
      }
      if (e.type === 'delta') end();
      emit(e);
    },
    /** Closes the line before the turn's `done` or `error`, and stops the timer. */
    end,
  };
}

const thinkingStart: CoachEvent = { type: 'tool', name: THINKING_TOOL, status: 'start' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Claude stream-json → contract events. Text comes from the partial `text_delta`s (or, without partials, from each
 * assistant message); a tool start from the `tool_use` block of the main conversation (subagent output is ignored);
 * a thinking block before any text → `tool thinking start` (createThinkingProgress dedupes it and closes it).
 * Separate assistant messages of one turn are joined with a blank line.
 */
export function createClaudeMapper(emit: (e: CoachEvent) => void) {
  let text = '';
  let partials = false;
  let needGap = false;
  const toolIds = new Set<string>();
  let result: { ok: boolean; failure: TurnFailure | null } | null = null;
  const add = (t: string) => {
    if (!t) return;
    if (needGap && text) {
      text += '\n\n';
      emit({ type: 'delta', text: '\n\n' });
    }
    needGap = false;
    text += t;
    emit({ type: 'delta', text: t });
  };
  const toolStart = (id: unknown, name: unknown) => {
    if (typeof name !== 'string') return;
    if (typeof id === 'string') {
      if (toolIds.has(id)) return;
      toolIds.add(id);
    }
    emit({ type: 'tool', name: name.startsWith(CLAUDE_TOOL_PREFIX) ? name.slice(CLAUDE_TOOL_PREFIX.length) : name, status: 'start' });
  };
  return {
    feed(v: unknown) {
      if (!isObj(v)) return;
      if (v.parent_tool_use_id) return;
      if (v.type === 'stream_event' && isObj(v.event)) {
        partials = true;
        const ev = v.event;
        if (ev.type === 'content_block_start' && isObj(ev.content_block)) {
          if (!text && (ev.content_block.type === 'thinking' || ev.content_block.type === 'redacted_thinking')) emit(thinkingStart);
          if (ev.content_block.type === 'tool_use') toolStart(ev.content_block.id, ev.content_block.name);
          if (ev.content_block.type === 'text') needGap = true;
        }
        if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'thinking_delta' && !text) emit(thinkingStart);
        if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') add(ev.delta.text);
        return;
      }
      if (v.type === 'assistant' && isObj(v.message) && Array.isArray(v.message.content)) {
        for (const b of v.message.content as unknown[]) {
          if (!isObj(b)) continue;
          if (b.type === 'tool_use') toolStart(b.id, b.name);
          if (b.type === 'text' && !partials && typeof b.text === 'string') {
            needGap = true;
            add(b.text);
          }
        }
        return;
      }
      if (v.type === 'result') {
        const ok = v.subtype === 'success' && v.is_error !== true;
        const status = typeof v.api_error_status === 'number' ? v.api_error_status : null;
        result = { ok, failure: ok ? null : classifyFailure(`${typeof v.result === 'string' ? v.result : ''} ${Array.isArray(v.errors) ? v.errors.join(' ') : ''}`, status) };
        if (ok && !text && typeof v.result === 'string') add(v.result);
      }
    },
    get text() {
      return text;
    },
    get result() {
      return result;
    },
  };
}

export function createClaudeBackend(cfg: CoachConfig): CoachBackend {
  const binary = cfg.claudePath;
  return {
    name: 'claude',
    binary,
    async prepare(dir, mcpUrl) {
      await writeFile(join(dir, 'mcp.json'), claudeMcpConfig(mcpUrl), { mode: 0o600 });
    },
    async run(input, o) {
      const sessionId = input.cliSessionId ?? randomUUID();
      if (!binary) return { ok: false, failure: 'coach_unavailable', deltaSent: false, cliSessionId: sessionId };
      let deltaSent = false;
      const mapper = createClaudeMapper((e) => {
        if (e.type === 'delta') deltaSent = true;
        o.onEvent(e);
      });
      const r = await runCli({
        plan: spawnPlan(cfg, binary, claudeArgs({ dir: input.dir, systemPrompt: input.systemPrompt, sessionId, first: input.first, model: cfg.model, effort: cfg.effort })),
        cwd: input.dir,
        env: cliEnv(cfg, join(input.dir, 'tmp'), input.token),
        stdin: claudeUserLine(input.text, input.images),
        timeoutMs: cfg.turnTimeoutSec * 1000,
        idleMs: cfg.idleTimeoutSec * 1000,
        signal: o.signal,
        onLine: (v) => mapper.feed(v),
      });
      const res = mapper.result;
      if (res?.ok && !r.aborted && !r.timedOut && !r.idle) return { ok: true, text: mapper.text, cliSessionId: sessionId };
      return { ok: false, failure: failureOf(r, res?.failure ?? null), deltaSent, cliSessionId: sessionId };
    },
    async forget(dir, cliSessionId) {
      const projects = join(cfg.claudeConfigDir, 'projects');
      await rm(join(projects, claudeProjectSlug(dir)), { recursive: true, force: true }).catch(() => undefined);
      if (!cliSessionId || !/^[0-9a-f-]{36}$/.test(cliSessionId)) return;
      // a transcript under another slug (a CLI version that names folders differently)
      for (const d of await readdir(projects).catch(() => [] as string[])) {
        await rm(join(projects, d, `${cliSessionId}.jsonl`), { force: true }).catch(() => undefined);
        await rm(join(projects, d, cliSessionId), { recursive: true, force: true }).catch(() => undefined);
      }
      for (const sub of ['session-env', 'file-history', 'todos', 'shell-snapshots', 'debug', 'tasks']) {
        const base = join(cfg.claudeConfigDir, sub);
        for (const name of await readdir(base).catch(() => [] as string[])) {
          if (name.includes(cliSessionId)) await rm(join(base, name), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    },
    async started(dir, cliSessionId) {
      if (!cliSessionId) return false;
      return stat(join(cfg.claudeConfigDir, 'projects', claudeProjectSlug(dir), `${cliSessionId}.jsonl`)).then(() => true, () => false);
    },
    async signedIn() {
      if (!binary) return false;
      const r = await runQuick(binary, ['auth', 'status', '--json'], cliEnv(cfg, tmpdir(), ''), tmpdir());
      try {
        return r.code === 0 && (JSON.parse(r.out.slice(r.out.indexOf('{'))) as { loggedIn?: unknown }).loggedIn === true;
      } catch {
        return false;
      }
    },
  };
}

/** Claude Code's folder name for a working directory under `projects/`: every character but [A-Za-z0-9] becomes "-". */
export const claudeProjectSlug = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-');

// ---------------------------------------------------------------------------------------------------------------
// Codex (fallback; opt-in with `coach.fallback: "codex"`)

const toml = (s: string) => JSON.stringify(s);

export function codexArgs(o: { dir: string; mcpUrl: string; systemPrompt: string; threadId: string | null; model?: string | null; images: string[] }): string[] {
  const common = [
    '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', o.dir,
    '-c', 'history.persistence="none"',
    '-c', `mcp_servers.${MCP_SERVER_NAME}.url=${toml(o.mcpUrl)}`,
    '-c', `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var=${toml(TOKEN_ENV)}`,
    '-c', `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
    '-c', `developer_instructions=${toml(o.systemPrompt)}`,
    ...(o.model ? ['-m', o.model] : []),
    ...o.images.flatMap((p) => ['-i', p]),
  ];
  return o.threadId ? ['exec', ...common, 'resume', o.threadId, '-'] : ['exec', ...common, '-'];
}

/** Codex `exec --json` events → contract events. Codex sends whole messages, not partial text. */
export function createCodexMapper(emit: (e: CoachEvent) => void) {
  let text = '';
  let threadId: string | null = null;
  let result: { ok: boolean; failure: TurnFailure | null } | null = null;
  return {
    feed(v: unknown) {
      if (!isObj(v)) return;
      if (v.type === 'thread.started' && typeof v.thread_id === 'string') threadId = v.thread_id;
      const item = isObj(v.item) ? v.item : null;
      if (v.type === 'item.started' && item?.type === 'reasoning' && !text) emit(thinkingStart);
      if (v.type === 'item.started' && item?.type === 'mcp_tool_call' && typeof item.tool === 'string') emit({ type: 'tool', name: item.tool, status: 'start' });
      if (v.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        const t = text ? `\n\n${item.text}` : item.text;
        text += t;
        emit({ type: 'delta', text: t });
      }
      if (v.type === 'turn.completed') result = { ok: true, failure: null };
      if (v.type === 'turn.failed' || v.type === 'error') {
        const msg = isObj(v.error) && typeof v.error.message === 'string' ? v.error.message : typeof v.message === 'string' ? v.message : '';
        result = { ok: false, failure: classifyFailure(msg) };
      }
    },
    get text() {
      return text;
    },
    get threadId() {
      return threadId;
    },
    get result() {
      return result;
    },
  };
}

export function createCodexBackend(cfg: CoachConfig): CoachBackend {
  const binary = cfg.codexPath;
  return {
    name: 'codex',
    binary,
    async prepare() {
      // everything goes on the command line (-c); no file needed
    },
    async run(input, o) {
      if (!binary) return { ok: false, failure: 'coach_unavailable', deltaSent: false, cliSessionId: input.cliSessionId };
      const images: string[] = [];
      if (input.images.length) {
        const at = join(input.dir, 'attachments');
        await mkdir(at, { recursive: true, mode: 0o700 });
        for (const [i, img] of input.images.entries()) {
          const p = join(at, `${Date.now()}-${i}.${img.mime.split('/')[1] ?? 'img'}`);
          await writeFile(p, img.data, { mode: 0o600 });
          images.push(p);
        }
      }
      let deltaSent = false;
      const mapper = createCodexMapper((e) => {
        if (e.type === 'delta') deltaSent = true;
        o.onEvent(e);
      });
      const r = await runCli({
        plan: spawnPlan(cfg, binary, codexArgs({ dir: input.dir, mcpUrl: input.mcpUrl, systemPrompt: input.systemPrompt, threadId: input.cliSessionId, model: cfg.model, images })),
        cwd: input.dir,
        env: cliEnv(cfg, join(input.dir, 'tmp'), input.token),
        stdin: input.text,
        timeoutMs: cfg.turnTimeoutSec * 1000,
        idleMs: cfg.idleTimeoutSec * 1000,
        signal: o.signal,
        onLine: (v) => mapper.feed(v),
      });
      const threadId = mapper.threadId ?? input.cliSessionId;
      if (mapper.result?.ok && !r.aborted && !r.timedOut && !r.idle) return { ok: true, text: mapper.text, cliSessionId: threadId };
      return { ok: false, failure: failureOf(r, mapper.result?.failure ?? null), deltaSent, cliSessionId: threadId };
    },
    async forget(_dir, threadId) {
      // the rollout files only; Codex's shared sqlite stores cannot be cleaned per session (docs/SERVER.md "Coach")
      if (!threadId || !/^[0-9A-Za-z-]{8,64}$/.test(threadId)) return;
      const base = join(cfg.codexHome, 'sessions');
      const entries = await readdir(base, { recursive: true }).catch(() => [] as string[]);
      for (const rel of entries) if (rel.endsWith('.jsonl') && rel.includes(threadId)) await rm(join(base, rel), { force: true }).catch(() => undefined);
    },
    started: async (_dir, threadId) => threadId !== null,
    async signedIn() {
      if (!binary) return false;
      const r = await runQuick(binary, ['login', 'status'], cliEnv(cfg, tmpdir(), ''), tmpdir());
      return r.code === 0 && /logged in/i.test(r.out);
    },
  };
}

export function createBackend(name: CoachBackendName, cfg: CoachConfig): CoachBackend {
  return name === 'codex' ? createCodexBackend(cfg) : createClaudeBackend(cfg);
}
