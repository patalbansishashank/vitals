/**
 * `<app> --mcp [--client <AiToolId>]` (SUITE_SPEC §15.6): the shell calls `maybeRunMcp` first thing in main, before any
 * Electron app API. With `--mcp` present it re-executes the same binary as plain Node (`ELECTRON_RUN_AS_NODE=1`) on the
 * bridge bundle `dist/mcp.cjs` with inherited stdio, forwards signals and exits with the child's code, so no window,
 * single-instance lock or Chromium ever touches the AI tool's stdio. Without `--mcp` it does nothing.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { FLAGS } from '../shared/bridge';
import { APP_COMMAND_ENV, BRIDGE_ENV } from './env';

/** The slice of `ChildProcess` used here, so tests pass a fake. */
export interface ChildLike {
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export interface LaunchOptions {
  argv: string[];
  execPath: string;
  /** The bridge bundle (`dist/mcp.cjs`). */
  mcpScript: string;
  env: NodeJS.ProcessEnv;
  /** The command that starts the app (paths.ts `selfCommand()`); defaults to `$APPIMAGE` or `execPath` with argv's own args. */
  command?: { path: string; args: string[] };
  spawn?: (cmd: string, args: string[], o: { stdio: 'inherit'; env: NodeJS.ProcessEnv }) => ChildLike;
  exit?: (code: number) => void;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
}

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Lets `--mcp` start with no display (an AI tool run over ssh). Chromium picks its display platform before any script
 * runs, so `app.commandLine.appendSwitch` in main is too late and the process exits with an X11 error: the flag has to
 * be on the command line itself, which is why the entry an AI tool runs carries it (Linux only).
 */
export const HEADLESS_FLAG = '--ozone-platform=headless';

/** The arguments an AI tool runs after the app path: `[...base, <headless flag on Linux>, '--mcp', '--client', id]`. */
export function mcpArgs(base: readonly string[], client: string, platform: NodeJS.Platform): string[] {
  return [...base, ...(platform === 'linux' ? [HEADLESS_FLAG] : []), FLAGS.mcp, FLAGS.client, client];
}

/** argv without the `--mcp` / `--client <id>` flags and the headless flag (the rest, like a dev app directory, is kept). */
export function argsWithoutMcp(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === FLAGS.mcp || a === HEADLESS_FLAG) continue;
    if (a === FLAGS.client) {
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Returns false when argv has no `--mcp`; otherwise takes the process over and only returns true for the caller's early return. */
export function maybeRunMcp(o: LaunchOptions): boolean {
  const at = o.argv.indexOf(FLAGS.mcp);
  if (at === -1) return false;
  const spawn: NonNullable<LaunchOptions['spawn']> = o.spawn ?? ((c, a, opts) => nodeSpawn(c, a, opts) as ChildLike);
  const exit = o.exit ?? ((code: number) => process.exit(code));
  const onSignal = o.onSignal ?? ((s, h) => process.on(s, h));
  const command = o.command ?? (o.env.APPIMAGE ? { path: o.env.APPIMAGE, args: [] } : { path: o.execPath, args: argsWithoutMcp(o.argv) });

  const child = spawn(o.execPath, [o.mcpScript, ...o.argv.slice(at)], {
    stdio: 'inherit',
    env: { ...o.env, ELECTRON_RUN_AS_NODE: '1', [BRIDGE_ENV]: '1', [APP_COMMAND_ENV]: JSON.stringify(command) },
  });
  for (const s of SIGNALS) onSignal(s, () => child.kill(s));
  child.on('exit', (code, signal) => exit(code ?? (signal ? 1 : 0)));
  child.on('error', () => exit(1));
  return true;
}
