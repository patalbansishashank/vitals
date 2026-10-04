/**
 * The small slice of the operating system that `doctor`, `install`, `service` and `agents register` touch, behind one
 * interface so tests can stub every probe. Nothing here ever prints a file's content or a command's output on its own;
 * callers decide what to show, and they never show secrets.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface RunResult {
  /** null when the program is missing, was killed or timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface FetchResult {
  ok: boolean;
  status?: number;
  json?: unknown;
  /** Short reason when the request failed (timeout, TLS, refused). */
  error?: string;
}

export interface Sys {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  /** Absolute path of the running Node binary (the wrapper pins it). */
  execPath: string;
  run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<RunResult>;
  which(cmd: string): Promise<string | null>;
  fetchJson(url: string, timeoutMs: number): Promise<FetchResult>;
  readText(path: string): Promise<string | null>;
  stat(path: string): Promise<{ mode: number; isDir: boolean } | null>;
  /** True when nothing listens on host:port. */
  portFree(host: string, port: number): Promise<boolean>;
  /** Atomic write (temp + rename) with the given mode; creates the parent directory. */
  writeText(path: string, data: string, mode: number): Promise<void>;
  /** Creates a directory (and parents) with the given mode; no error when it exists. */
  mkdir(path: string, mode: number): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  now(): Date;
}

export function nodeSys(): Sys {
  return {
    env: process.env,
    home: homedir(),
    platform: process.platform,
    nodeVersion: process.versions.node,
    execPath: process.execPath,
    run: (cmd, args, opts = {}) =>
      new Promise((resolve) => {
        execFile(cmd, args, { timeout: opts.timeoutMs ?? 5_000, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
          const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : null) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        });
      }),
    async which(cmd) {
      for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        if (!dir) continue;
        const p = join(dir, cmd);
        try {
          await access(p, constants.X_OK);
          if ((await stat(p)).isFile()) return p;
        } catch {
          // not here
        }
      }
      return null;
    },
    async fetchJson(url, timeoutMs) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
        const json: unknown = await res.json().catch(() => undefined);
        return { ok: res.ok, status: res.status, json };
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        const name = e instanceof Error ? e.name : '';
        return { ok: false, error: name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e)) };
      }
    },
    readText: (path) => readFile(path, 'utf8').catch(() => null),
    async stat(path) {
      try {
        const s = await stat(path);
        return { mode: s.mode & 0o777, isDir: s.isDirectory() };
      } catch {
        return null;
      }
    },
    portFree: (host, port) =>
      new Promise((resolve) => {
        const srv = createServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, host, () => srv.close(() => resolve(true)));
      }),
    async mkdir(path, mode) {
      await mkdir(path, { recursive: true, mode });
    },
    async writeText(path, data, mode) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(tmp, data, { mode, flag: 'wx' });
        await chmod(tmp, mode);
        await rename(tmp, path);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
    },
    copy: (from, to) => copyFile(from, to, constants.COPYFILE_EXCL),
    now: () => new Date(),
  };
}

/** `2026-10-02T14-05-09` for backup file names. */
export const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/:/g, '-');

/** Copies `path` next to itself as `<path>.vitals-backup-<stamp>` and returns the backup path (null if `path` is absent). */
export async function backupFile(sys: Sys, path: string): Promise<string | null> {
  if (!(await sys.stat(path))) return null;
  const to = `${path}.vitals-backup-${stamp(sys.now())}`;
  await sys.copy(path, to);
  return to;
}

export const xdgConfigHome = (sys: Sys) => sys.env.XDG_CONFIG_HOME || join(sys.home, '.config');
export const xdgDataHome = (sys: Sys) => sys.env.XDG_DATA_HOME || join(sys.home, '.local', 'share');
