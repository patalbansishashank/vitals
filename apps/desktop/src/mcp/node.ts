/**
 * The `--mcp` bridge (SUITE_SPEC §15.6), run as plain Node (`ELECTRON_RUN_AS_NODE=1`, see launch.ts): a byte pipe
 * between the AI tool's stdio and the running app's local socket. First the hello line, then newline-delimited
 * JSON-RPC both ways. When the app is not running it is started hidden and the socket is retried for up to 30 s; if
 * that fails the `initialize` request is answered with a JSON-RPC error and the process exits non-zero. stdout carries
 * nothing but JSON-RPC; diagnostics go to stderr.
 */
import { spawn } from 'node:child_process';
import { connect as netConnect, type Socket } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { FLAGS } from '../shared/bridge';
import { helloLine, mcpSocketPath } from '../shared/mcpSocket';
import { APP_COMMAND_ENV, BRIDGE_ENV, SOCKET_ENV } from './env';

export const START_WAIT_MS = 30_000;
export const RETRY_MS = 250;
export const NOT_RUNNING_MESSAGE = 'Vitals is not running and could not be started';

export interface BridgeOptions {
  socketPath: string;
  client: string | null;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: { write(text: string): unknown };
  /** Starts the app hidden; called once when the socket is not there. */
  startApp(): void;
  connect?: (path: string) => Socket;
  waitMs?: number;
  retryMs?: number;
}

const tryConnect = (connect: (p: string) => Socket, socketPath: string): Promise<Socket | null> =>
  new Promise((resolve) => {
    const s = connect(socketPath);
    s.once('connect', () => {
      s.removeAllListeners('error');
      resolve(s);
    });
    s.once('error', () => {
      s.destroy();
      resolve(null);
    });
  });

const parseLoose = (line: string): { id?: unknown; method?: unknown } | null => {
  try {
    return JSON.parse(line) as { id?: unknown; method?: unknown };
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reads stdin until an `initialize` request shows up (or stdin ends) and answers it with the error. */
function answerNotRunning(o: BridgeOptions): Promise<number> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let at: number;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        const msg = parseLoose(line);
        if (msg && msg.method === 'initialize' && msg.id !== undefined) {
          o.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: NOT_RUNNING_MESSAGE } })}\n`);
          o.stdin.off('data', onData);
          resolve(1);
          return;
        }
      }
    };
    o.stdin.on('data', onData);
    o.stdin.once('end', () => resolve(1));
    o.stdin.resume();
  });
}

/** Runs the bridge; resolves with the process exit code. */
export async function runBridge(o: BridgeOptions): Promise<number> {
  const connect = o.connect ?? ((p: string) => netConnect(p));
  const waitMs = o.waitMs ?? START_WAIT_MS;
  const retryMs = o.retryMs ?? RETRY_MS;

  let socket = await tryConnect(connect, o.socketPath);
  if (!socket) {
    o.stderr.write('vitals mcp: Vitals is not running; starting it\n');
    try {
      o.startApp();
    } catch (e) {
      o.stderr.write(`vitals mcp: could not start Vitals (${e instanceof Error ? e.message : 'error'})\n`);
    }
    const deadline = Date.now() + waitMs;
    while (!socket && Date.now() < deadline) {
      await sleep(retryMs);
      socket = await tryConnect(connect, o.socketPath);
    }
  }
  if (!socket) {
    o.stderr.write(`vitals mcp: ${NOT_RUNNING_MESSAGE}\n`);
    return answerNotRunning(o);
  }

  const sock = socket;
  return new Promise<number>((resolve) => {
    sock.write(helloLine(o.client));
    sock.pipe(o.stdout, { end: false });
    o.stdin.pipe(sock);
    o.stdin.once('end', () => sock.end());
    sock.once('error', (e) => {
      o.stderr.write(`vitals mcp: connection to Vitals lost (${e.message})\n`);
      resolve(1);
    });
    sock.once('close', () => resolve(0));
  });
}

/** `--client <id>` from the bridge's own arguments. */
export function clientFromArgv(argv: readonly string[]): string | null {
  const at = argv.indexOf(FLAGS.client);
  const v = at === -1 ? undefined : argv[at + 1];
  return v && /^[\w-]{1,32}$/.test(v) ? v : null;
}

/** The app command launch.ts passed in the environment. */
export function appCommandFromEnv(env: NodeJS.ProcessEnv): { path: string; args: string[] } | null {
  try {
    const v = JSON.parse(env[APP_COMMAND_ENV] ?? '') as { path?: unknown; args?: unknown };
    if (typeof v.path !== 'string' || !v.path) return null;
    return { path: v.path, args: Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : [] };
  } catch {
    return null;
  }
}

/** Starts the app hidden and detached; `ELECTRON_RUN_AS_NODE` must not leak into it or it would start as Node too. */
export function startAppHidden(command: { path: string; args: string[] }, env: NodeJS.ProcessEnv): void {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv[BRIDGE_ENV];
  delete childEnv[APP_COMMAND_ENV];
  const args = command.args.includes(FLAGS.hidden) ? command.args : [...command.args, FLAGS.hidden];
  spawn(command.path, args, { detached: true, stdio: 'ignore', env: childEnv }).unref();
}

export async function main(): Promise<number> {
  const env = process.env;
  const socketPath = env[SOCKET_ENV] || mcpSocketPath({ platform: process.platform, env, home: homedir(), userName: safeUserName() });
  const command = appCommandFromEnv(env);
  return runBridge({
    socketPath,
    client: clientFromArgv(process.argv),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    startApp: () => {
      if (!command) throw new Error(`${APP_COMMAND_ENV} is not set`);
      startAppHidden(command, env);
    },
  });
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'user';
  }
}

if (process.env[BRIDGE_ENV] === '1') {
  main().then(
    // an empty write flushes what is still queued for stdout before the process ends
    (code) => process.stdout.write('', () => process.exit(code)),
    (e: unknown) => {
      process.stderr.write(`vitals mcp: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
