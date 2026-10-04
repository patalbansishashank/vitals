/**
 * Per-user configuration directory for the Companion's local secrets (pairings, admin token, provider keys, Sign in
 * with ChatGPT tokens). Directories are 0700, secret files 0600 and written atomically (temp file + rename).
 *
 * Future work: SUITE_SPEC §7.1 names the OS keychain for SIWC tokens; a 0600 file in the user's config directory is
 * what v0.2 ships (the same protection the SIWC docs ask for: "protected local storage, 0600 permissions").
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_DIR_NAME = 'vitals-companion';

/** Linux `$XDG_CONFIG_HOME|~/.config`, macOS `~/Library/Application Support`, Windows `%APPDATA%`. */
export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR_NAME);
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_DIR_NAME);
}

export async function ensureConfigDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
}

/** Atomic 0600 write: the secret never exists on disk with wider permissions, and readers never see half a file. */
export async function writeSecretFile(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600).catch(() => undefined);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const writeJsonSecret = (path: string, value: unknown) => writeSecretFile(path, `${JSON.stringify(value, null, 2)}\n`);

export const configFiles = (dir: string) => ({
  pairings: join(dir, 'pairings.json'),
  adminToken: join(dir, 'admin.token'),
  keys: join(dir, 'keys.json'),
  siwc: join(dir, 'siwc.json'),
  install: join(dir, 'install.json'),
});

export interface InstallInfo {
  /** Stable per-install id, sent to OpenAI as `ext_agent_host_id=urn:uuid:<installId>`. */
  installId: string;
  /** The `oaiapp_…` client id OpenAI issued at the first SIWC registration; reused afterwards (survives logout). */
  siwcClientId?: string;
}

export async function readInstallInfo(dir: string): Promise<InstallInfo> {
  await ensureConfigDir(dir);
  const path = configFiles(dir).install;
  const existing = await readJsonFile<InstallInfo>(path);
  if (existing && typeof existing.installId === 'string') return existing;
  const info: InstallInfo = { installId: randomUUID() };
  await writeJsonSecret(path, info);
  return info;
}

export async function updateInstallInfo(dir: string, patch: Partial<InstallInfo>): Promise<InstallInfo> {
  const info = { ...(await readInstallInfo(dir)), ...patch };
  await writeJsonSecret(configFiles(dir).install, info);
  return info;
}

/** The admin token lets local CLI processes (`mcp`, `pair`) talk to the running Companion without an Origin. */
export async function readOrCreateAdminToken(dir: string): Promise<string> {
  await ensureConfigDir(dir);
  const path = configFiles(dir).adminToken;
  const existing = await readFile(path, 'utf8').catch(() => '');
  if (/^[A-Za-z0-9_-]{43}$/.test(existing.trim())) return existing.trim();
  const token = randomBytes(32).toString('base64url');
  await writeSecretFile(path, `${token}\n`);
  return token;
}

export async function readAdminToken(dir: string): Promise<string | null> {
  const text = await readFile(configFiles(dir).adminToken, 'utf8').catch(() => '');
  return text.trim() || null;
}
