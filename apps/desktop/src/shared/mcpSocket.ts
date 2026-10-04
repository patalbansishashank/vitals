/**
 * Where the running app listens for `--mcp` bridges (SUITE_SPEC §15.6): `<userData>/mcp.sock` on Linux and macOS, the
 * named pipe `\\.\pipe\vitals-mcp-<user>` on Windows. userData is what Electron uses (`$XDG_CONFIG_HOME/Vitals` or
 * `~/.config/Vitals`; `~/Library/Application Support/Vitals`; `%APPDATA%\Vitals`), computed here without Electron so the
 * bridge process (plain Node) finds the same socket. The first line on the socket is the hello `{"client":"<id>"}`.
 */
import path from 'node:path';

export interface SocketPathInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  userName: string;
}

export const SOCKET_FILE = 'mcp.sock';
/** Longest socket path per platform: `sun_path` holds 108 bytes on Linux and 104 on macOS, one of them the NUL. */
export const SUN_PATH_MAX: Readonly<Record<string, number>> = { linux: 107, darwin: 103 };
const PIPE_PREFIX = '\\\\.\\pipe\\';

const safeUser = (name: string) => name.replace(/[^\w.-]/g, '_').slice(0, 32) || 'user';

/** Electron's `app.getPath('userData')` for the app name `Vitals`. */
export function userDataDir({ platform, env, home }: Omit<SocketPathInput, 'userName'>): string {
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Vitals');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Vitals');
  const config = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(home, '.config');
  return path.posix.join(config, 'Vitals');
}

/** The socket (or pipe) path; a userData path too long for `sun_path` falls back to `$XDG_RUNTIME_DIR`, then tmp. */
export function mcpSocketPath(o: SocketPathInput): string {
  if (o.platform === 'win32') return `${PIPE_PREFIX}vitals-mcp-${safeUser(o.userName)}`;
  const preferred = path.posix.join(userDataDir(o), SOCKET_FILE);
  const max = SUN_PATH_MAX[o.platform] ?? SUN_PATH_MAX.linux!;
  if (Buffer.byteLength(preferred) <= max) return preferred;
  const base = [o.env.XDG_RUNTIME_DIR, o.env.TMPDIR, '/tmp'].find((d) => d && path.posix.isAbsolute(d))!;
  return path.posix.join(base, `vitals-mcp-${safeUser(o.userName)}.sock`);
}

export const isNamedPipe = (socketPath: string): boolean => socketPath.startsWith(PIPE_PREFIX);

export interface Hello {
  /** The AI tool id from `--client`, or null when unknown. */
  client: string | null;
}

export const helloLine = (client: string | null): string => `${JSON.stringify({ client })}\n`;

/** Parses the first line of a connection; null when it is not a hello (a client that skipped it sends JSON-RPC at once). */
export function parseHello(line: string): Hello | null {
  try {
    const v = JSON.parse(line) as unknown;
    if (!v || typeof v !== 'object' || 'jsonrpc' in v || !('client' in v)) return null;
    const client = (v as { client: unknown }).client;
    return { client: typeof client === 'string' && /^[\w-]{1,32}$/.test(client) ? client : null };
  } catch {
    return null;
  }
}
