/**
 * Vitals Server configuration (SUITE_SPEC §14.1): `$XDG_CONFIG_HOME/vitals-server/server.json` (0600). It never holds a
 * secret; secrets live under `dataDir` only.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureConfigDir, readJsonFile, writeJsonSecret } from '../config.ts';
import { PUBLIC_APP_ORIGIN } from '../security.ts';

export const SERVER_DIR_NAME = 'vitals-server';
export const SERVER_SCHEMA = 'vitals.server/1';

export interface ServerConfig {
  schema: typeof SERVER_SCHEMA;
  role: 'relay' | 'home';
  listen: { host: string; port: number };
  publicOrigin: string;
  publicHosts?: string[];
  allowedOrigins: string[];
  dataDir: string;
  /** `tls`: MQTT over TLS for phones that reach the server by a public name (certFile/keyFile are read at start; replace them and restart to renew). */
  mqtt?: { enabled: boolean; tcp?: { host: string; port: number }; tls?: { listen: Array<{ host: string; port: number }>; certFile: string; keyFile: string }; ws?: { path: '/mqtt' } };
  tls?: { certFile: string; keyFile: string };
  limits?: { aiRequestsPerMinute?: number; aiRequestsPerDay?: number; bodyBytes?: number };
  /** Person workers open at once (default 4); the least recently used idle one closes to make room. */
  maxOpenPersons?: number;
}

export const serverConfigDir = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()) =>
  join(env.XDG_CONFIG_HOME || join(home, '.config'), SERVER_DIR_NAME);

export const defaultServerDataDir = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()) =>
  join(env.XDG_DATA_HOME || join(home, '.local', 'share'), SERVER_DIR_NAME);

export const serverConfigFile = (dir: string) => join(dir, 'server.json');

export function defaultServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    schema: SERVER_SCHEMA,
    role: 'home',
    listen: { host: '127.0.0.1', port: 4870 },
    publicOrigin: '',
    allowedOrigins: [PUBLIC_APP_ORIGIN],
    dataDir: defaultServerDataDir(env),
    mqtt: { enabled: true, ws: { path: '/mqtt' } },
  };
}

export async function readServerConfig(dir: string): Promise<ServerConfig | null> {
  const c = await readJsonFile<ServerConfig>(serverConfigFile(dir));
  if (!c || c.schema !== SERVER_SCHEMA) return null;
  return { ...defaultServerConfig(), ...c };
}

export async function writeServerConfig(dir: string, c: ServerConfig): Promise<void> {
  await ensureConfigDir(dir);
  await writeJsonSecret(serverConfigFile(dir), c);
}

const LOOPBACK = /^(127(?:\.\d{1,3}){3}|::1|localhost)$/i;
/** Tailscale's CGNAT range 100.64.0.0/10. */
const isTailnet = (h: string) => {
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
};

/** `home` refuses a public bind without TLS (§14.1): its routes hand out health data. */
export function bindAllowed(c: Pick<ServerConfig, 'role' | 'listen' | 'tls'>): boolean {
  if (c.role !== 'home' || c.tls) return true;
  return LOOPBACK.test(c.listen.host) || isTailnet(c.listen.host);
}
