// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { APP_COMMAND_ENV, BRIDGE_ENV } from './env';
import { argsWithoutMcp, HEADLESS_FLAG, maybeRunMcp, mcpArgs } from './launch';

class FakeChild extends EventEmitter {
  kill = vi.fn((_s?: NodeJS.Signals) => true);
}

const run = (argv: string[], env: NodeJS.ProcessEnv = {}, command?: { path: string; args: string[] }) => {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  const exit = vi.fn();
  const handlers = new Map<string, () => void>();
  const took = maybeRunMcp({ argv, execPath: '/opt/Vitals/vitals', mcpScript: '/opt/Vitals/resources/app/dist/mcp.cjs', env, command, spawn, exit, onSignal: (s, h) => handlers.set(s, h) });
  return { took, child, spawn, exit, handlers };
};

describe('maybeRunMcp', () => {
  it('does nothing without --mcp', () => {
    const r = run(['/opt/Vitals/vitals', '--hidden']);
    expect(r.took).toBe(false);
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it('re-executes the binary as Node on the bridge bundle with inherited stdio, the client flag and the app command', () => {
    const r = run(['/opt/Vitals/vitals', '--mcp', '--client', 'codex'], { HOME: '/home/ann', ELECTRON_RUN_AS_NODE: undefined });
    expect(r.took).toBe(true);
    expect(r.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = r.spawn.mock.calls[0] as unknown as [string, string[], { stdio: string; env: NodeJS.ProcessEnv }];
    expect(cmd).toBe('/opt/Vitals/vitals');
    expect(args).toEqual(['/opt/Vitals/resources/app/dist/mcp.cjs', '--mcp', '--client', 'codex']);
    expect(opts.stdio).toBe('inherit');
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(opts.env[BRIDGE_ENV]).toBe('1');
    expect(opts.env.HOME).toBe('/home/ann');
    expect(JSON.parse(opts.env[APP_COMMAND_ENV]!)).toEqual({ path: '/opt/Vitals/vitals', args: [] });
  });

  it('prefers the AppImage path, then an explicit command; a dev app dir is kept in the default', () => {
    const a = run(['/tmp/.mount/vitals', '--mcp'], { APPIMAGE: '/home/ann/Apps/Vitals.AppImage' });
    expect(JSON.parse((a.spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env[APP_COMMAND_ENV]!)).toEqual({ path: '/home/ann/Apps/Vitals.AppImage', args: [] });
    const b = run(['/opt/Vitals/vitals', '--mcp'], {}, { path: '/x/electron', args: ['/x/app'] });
    expect(JSON.parse((b.spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env[APP_COMMAND_ENV]!)).toEqual({ path: '/x/electron', args: ['/x/app'] });
    expect(argsWithoutMcp(['/x/electron', '/x/app', '--mcp', '--client', 'codex', '--no-sandbox'])).toEqual(['/x/app', '--no-sandbox']);
  });

  it('forwards signals and exits with the child code', () => {
    const r = run(['/opt/Vitals/vitals', '--mcp']);
    r.handlers.get('SIGTERM')!();
    expect(r.child.kill).toHaveBeenCalledWith('SIGTERM');
    r.child.emit('exit', 3, null);
    expect(r.exit).toHaveBeenCalledWith(3);
    const k = run(['/opt/Vitals/vitals', '--mcp']);
    k.child.emit('exit', null, 'SIGKILL');
    expect(k.exit).toHaveBeenCalledWith(1);
    const e = run(['/opt/Vitals/vitals', '--mcp']);
    e.child.emit('error', new Error('ENOENT'));
    expect(e.exit).toHaveBeenCalledWith(1);
  });
});

describe('`--mcp` without a display (an AI tool over ssh)', () => {
  const HEADLESS = '--ozone-platform=headless';
  // Chromium picks its display platform before main runs, so app.commandLine.appendSwitch is too late: the entry itself carries the flag
  it('the entry an AI tool runs starts headless on Linux, with the flag ahead of --mcp, and only on Linux', () => {
    expect(HEADLESS_FLAG).toBe(HEADLESS);
    expect(mcpArgs([], 'claude-code', 'linux')).toEqual([HEADLESS, '--mcp', '--client', 'claude-code']);
    expect(mcpArgs(['/x/app'], 'codex', 'linux')).toEqual(['/x/app', HEADLESS, '--mcp', '--client', 'codex']);
    expect(mcpArgs([], 'codex', 'win32')).toEqual(['--mcp', '--client', 'codex']);
    expect(mcpArgs([], 'codex', 'darwin')).toEqual(['--mcp', '--client', 'codex']);
  });

  it('the app the bridge starts for the person is not started headless', () => {
    expect(argsWithoutMcp(['/opt/Vitals/vitals', HEADLESS, '--mcp', '--client', 'codex'])).toEqual([]);
    expect(argsWithoutMcp(['/x/electron', '/x/app', HEADLESS, '--mcp', '--client', 'codex', '--no-sandbox'])).toEqual(['/x/app', '--no-sandbox']);
    const r = run(['/opt/Vitals/vitals', '--no-sandbox', HEADLESS, '--mcp', '--client', 'codex']);
    const [, args, opts] = r.spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args).toEqual(['/opt/Vitals/resources/app/dist/mcp.cjs', '--mcp', '--client', 'codex']);
    expect(JSON.parse(opts.env[APP_COMMAND_ENV]!)).toEqual({ path: '/opt/Vitals/vitals', args: ['--no-sandbox'] });
  });
});
