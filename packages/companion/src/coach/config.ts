/**
 * The server coach's settings (`server.json` `coach`, docs/SERVER.md "Coach"). Every field is optional; `resolveCoachConfig`
 * fills the defaults and finds the CLIs. The service's PATH does not hold `~/.npm-global/bin`, so the CLIs are always
 * run by absolute path: the configured one, else the first of the usual install places that exists.
 */
import { accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export type CoachBackendName = 'claude' | 'codex';

/** What `server.json` may hold under `coach`. */
export interface CoachSettings {
  /** Default true when the block is there; a missing block means the coach is off. */
  enabled?: boolean;
  backend?: CoachBackendName;
  /** "none" (default) or "codex". Codex cannot remove one session's traces from its shared stores, so it is opt-in. */
  fallback?: 'none' | 'codex';
  claudePath?: string;
  codexPath?: string;
  systemdRunPath?: string;
  model?: string | null;
  effort?: string | null;
  retentionHours?: number;
  maxKeepHours?: number;
  /** Turns running at once on the whole server (default 2). */
  maxConcurrent?: number;
  /** Turns running at once per person (default 1). */
  maxConcurrentPerPerson?: number;
  turnTimeoutSec?: number;
  /** A turn with no CLI output for this long is stopped (default 90). */
  idleTimeoutSec?: number;
  /** MemoryMax of each CLI's transient scope (default 700). */
  memoryMaxMB?: number;
  turnsPerMinute?: number;
  turnsPerDay?: number;
  maxSessionsPerPerson?: number;
  maxMessagesPerSession?: number;
  /** Where session folders go (default `$XDG_RUNTIME_DIR/vitals-coach`, i.e. /run/user/<uid>/vitals-coach). */
  runtimeDir?: string;
  /** "systemd" (default when systemd-run exists) runs each CLI in its own scope under vitals-coach.slice; "none" spawns it directly. */
  isolation?: 'systemd' | 'none';
  /** HOME the CLIs run with (default the server user's home): their own logins live there. */
  home?: string;
  /** Claude Code's folder, passed to it as CLAUDE_CONFIG_DIR (default: the server's CLAUDE_CONFIG_DIR, else not set: `<home>/.claude`). */
  claudeConfigDir?: string;
  /** Codex's folder, passed as CODEX_HOME (default: the server's CODEX_HOME, else not set: `<home>/.codex`). */
  codexHome?: string;
}

export interface CoachConfig {
  enabled: boolean;
  backend: CoachBackendName;
  fallback: 'none' | 'codex';
  claudePath: string | null;
  codexPath: string | null;
  systemdRunPath: string | null;
  model: string | null;
  effort: string | null;
  retentionHours: number;
  maxKeepHours: number;
  maxConcurrent: number;
  maxConcurrentPerPerson: number;
  turnTimeoutSec: number;
  idleTimeoutSec: number;
  memoryMaxMB: number;
  turnsPerMinute: number;
  turnsPerDay: number;
  maxSessionsPerPerson: number;
  maxMessagesPerSession: number;
  runtimeDir: string;
  isolation: 'systemd' | 'none';
  home: string;
  /** Claude Code's own folder (transcripts are removed from here). */
  claudeConfigDir: string;
  /** Codex's own folder. */
  codexHome: string;
  /** Set in the CLI's environment only when configured or inherited: Claude reads `~/.claude.json` only without it. */
  env: { CLAUDE_CONFIG_DIR?: string; CODEX_HOME?: string };
}

const executable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The first executable path of `candidates`, or null. */
export const firstExecutable = (candidates: readonly string[]): string | null => candidates.find((p) => p && executable(p)) ?? null;

export const claudeCandidates = (home: string) => [join(home, '.npm-global/bin/claude'), join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/usr/local/bin/claude', '/usr/bin/claude'];
export const codexCandidates = (home: string) => [join(home, '.npm-global/bin/codex'), join(home, '.local/bin/codex'), '/usr/local/bin/codex', '/usr/bin/codex'];
const SYSTEMD_RUN = ['/usr/bin/systemd-run', '/bin/systemd-run'];

const num = (v: unknown, dflt: number, min = 1, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.min(max, v) : dflt;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function resolveCoachConfig(s: CoachSettings | undefined | null, env: NodeJS.ProcessEnv = process.env): CoachConfig {
  const set = s ?? {};
  const home = str(set.home) ?? homedir();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const runtimeBase = str(env.XDG_RUNTIME_DIR) ?? (executable(`/run/user/${uid}`) ? `/run/user/${uid}` : tmpdir());
  const systemdRunPath = str(set.systemdRunPath) ?? firstExecutable(SYSTEMD_RUN);
  const claudeDir = str(set.claudeConfigDir) ?? str(env.CLAUDE_CONFIG_DIR);
  const codexDir = str(set.codexHome) ?? str(env.CODEX_HOME);
  return {
    enabled: s ? set.enabled !== false : false,
    backend: set.backend === 'codex' ? 'codex' : 'claude',
    fallback: set.fallback === 'codex' ? 'codex' : 'none',
    claudePath: str(set.claudePath) ?? firstExecutable(claudeCandidates(home)),
    codexPath: str(set.codexPath) ?? firstExecutable(codexCandidates(home)),
    systemdRunPath,
    model: str(set.model),
    effort: str(set.effort),
    retentionHours: num(set.retentionHours, 24, 1 / 60, 24 * 30),
    maxKeepHours: num(set.maxKeepHours, 168, 1 / 60, 24 * 90),
    maxConcurrent: Math.floor(num(set.maxConcurrent, 2, 1, 16)),
    maxConcurrentPerPerson: Math.floor(num(set.maxConcurrentPerPerson, 1, 1, 16)),
    turnTimeoutSec: num(set.turnTimeoutSec, 240, 1, 3600),
    idleTimeoutSec: num(set.idleTimeoutSec, 90, 1, 3600),
    memoryMaxMB: Math.floor(num(set.memoryMaxMB, 700, 128, 16_384)),
    turnsPerMinute: num(set.turnsPerMinute, 6),
    turnsPerDay: Math.floor(num(set.turnsPerDay, 300)),
    maxSessionsPerPerson: Math.floor(num(set.maxSessionsPerPerson, 5, 1, 100)),
    maxMessagesPerSession: Math.floor(num(set.maxMessagesPerSession, 200, 2, 10_000)),
    runtimeDir: str(set.runtimeDir) ?? join(runtimeBase, 'vitals-coach'),
    isolation: set.isolation === 'none' || !systemdRunPath ? 'none' : 'systemd',
    home,
    claudeConfigDir: claudeDir ?? join(home, '.claude'),
    codexHome: codexDir ?? join(home, '.codex'),
    env: { ...(claudeDir ? { CLAUDE_CONFIG_DIR: claudeDir } : {}), ...(codexDir ? { CODEX_HOME: codexDir } : {}) },
  };
}
