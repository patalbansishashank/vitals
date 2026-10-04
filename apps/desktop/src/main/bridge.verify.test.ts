// @vitest-environment node
/** Adversarial checks of the `--mcp` bridge: stdout carries JSON-RPC only, odd flags and env, the socket path. */
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { argsWithoutMcp, maybeRunMcp } from '../mcp/launch';
import { appCommandFromEnv, clientFromArgv, runBridge } from '../mcp/node';
import { mcpSocketPath, parseHello } from '../shared/mcpSocket';

/** A connect that always fails, as when the app is not running. */
const refused = (): Socket => {
  const s = new EventEmitter() as unknown as Socket;
  (s as unknown as { destroy(): void }).destroy = () => undefined;
  setImmediate(() => s.emit('error', new Error('ECONNREFUSED')));
  return s;
};

describe('--mcp bridge (verify)', () => {
  it('when the app cannot be reached, stdout gets exactly one JSON-RPC error line for initialize and nothing else', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out: string[] = [];
    stdout.on('data', (c) => out.push(c.toString()));
    const stderr: string[] = [];
    const exit = runBridge({ socketPath: '/nonexistent/mcp.sock', client: 'codex', stdin, stdout, stderr: { write: (s) => stderr.push(s) }, startApp: () => { throw new Error('no app'); }, connect: refused, waitMs: 60, retryMs: 10 });
    stdin.write('garbage line\n');
    stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    stdin.write('{"jsonrpc":"2.0","id":"a","method":"initialize","params":{}}\n');
    expect(await exit).toBe(1);
    const text = out.join('');
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ jsonrpc: '2.0', id: 'a', error: { code: -32000 } });
    expect(stderr.join('')).toContain('could not start');
  });

  it('only a plain id is taken from --client; anything else is no id', () => {
    expect(clientFromArgv(['node', 'mcp.cjs', '--mcp', '--client', 'codex'])).toBe('codex');
    for (const v of ['../codex', 'a b', 'x'.repeat(33), '', '--hidden']) {
      if (v === '--hidden') continue;
      expect(clientFromArgv(['n', 'm', '--client', v]), v).toBeNull();
    }
    expect(clientFromArgv(['n', 'm', '--client'])).toBeNull();
  });

  it('a broken app command in the environment is no command', () => {
    for (const v of [undefined, '', 'not json', '{"path":42}', '{"path":""}', 'null', '[]']) {
      expect(appCommandFromEnv({ VITALS_APP_COMMAND: v }), String(v)).toBeNull();
    }
    expect(appCommandFromEnv({ VITALS_APP_COMMAND: '{"path":"/x","args":["a",1,null]}' })).toEqual({ path: '/x', args: ['a'] });
  });

  it('the hello takes only a plain id; JSON-RPC as the first line is not a hello', () => {
    expect(parseHello('{"client":"codex"}')).toEqual({ client: 'codex' });
    expect(parseHello('{"client":"../../x"}')).toEqual({ client: null });
    expect(parseHello('{"jsonrpc":"2.0","client":"codex","id":1,"method":"initialize"}')).toBeNull();
    expect(parseHello('null')).toBeNull();
    expect(parseHello('"client"')).toBeNull();
  });

  it('the Windows pipe name cannot be steered by the user name; a long Linux path falls back to the per-user runtime dir', () => {
    expect(mcpSocketPath({ platform: 'win32', env: {}, home: 'C:\\Users\\a', userName: '..\\..\\x' })).toBe('\\\\.\\pipe\\vitals-mcp-.._.._x');
    const long = mcpSocketPath({ platform: 'linux', env: { XDG_CONFIG_HOME: `/${'d'.repeat(120)}`, XDG_RUNTIME_DIR: '/run/user/1000' }, home: '/home/a', userName: 'a/b' });
    expect(long).toBe('/run/user/1000/vitals-mcp-a_b.sock');
    expect(mcpSocketPath({ platform: 'linux', env: { XDG_CONFIG_HOME: 'relative/dir' }, home: '/home/a', userName: 'a' })).toBe('/home/a/.config/Vitals/mcp.sock');
  });

  it('--mcp anywhere takes the process over; flags before it are not passed to the bridge, the client flag is dropped from the app command', () => {
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { kill: vi.fn() }));
    const took = maybeRunMcp({ argv: ['/opt/v', '--no-sandbox', '--mcp', '--client', 'codex'], execPath: '/opt/v', mcpScript: '/opt/mcp.cjs', env: {}, spawn: spawn as never, exit: vi.fn(), onSignal: vi.fn() });
    expect(took).toBe(true);
    expect((spawn.mock.calls[0] as unknown as [string, string[]])[1]).toEqual(['/opt/mcp.cjs', '--mcp', '--client', 'codex']);
    expect(argsWithoutMcp(['/opt/v', '--no-sandbox', '--mcp', '--client', 'codex'])).toEqual(['--no-sandbox']);
  });
});
