/**
 * Secrets kept by the main process (SUITE_SPEC §15.6): the agent tokens the app mints for AI tools, one per tool. One
 * JSON object encrypted with Electron's `safeStorage` (the OS keyring) in `<userData>/secrets.json`, mode 0600. When
 * the keyring is not available the secrets stay in memory until the app quits: nothing is ever written in plain text.
 * Create it after `app.whenReady()` (`isEncryptionAvailable()` is only true then on Linux).
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretKey } from '../shared/bridge';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux: `basic_text` means no keyring, the "encryption" is a fixed key built into Chromium (as good as plain text). */
  getSelectedStorageBackend?(): string;
}

export interface Secrets {
  get(key: SecretKey): Promise<string | null>;
  /** `null` removes the secret. */
  set(key: SecretKey, value: string | null): Promise<void>;
  /** False when the OS keyring is not available: secrets live in memory only and are lost when the app quits. */
  persistent: boolean;
}

export interface SecretsOptions {
  file: string;
  safeStorage: SafeStorageLike;
  log?: (line: string) => void;
}

interface FileShape {
  v: 1;
  /** `safeStorage.encryptString(JSON of the secrets object)`, base64. */
  enc: string;
}

export function createSecrets(o: SecretsOptions): Secrets {
  const { file, safeStorage, log = () => undefined } = o;
  const persistent = safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  let loaded: Promise<Record<string, string>> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = async (): Promise<Record<string, string>> => {
    if (!persistent) return {};
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log(`secrets: cannot read ${file} (${(e as Error).message}); starting empty`);
      return {};
    }
    try {
      const shape = JSON.parse(text) as FileShape;
      const plain = JSON.parse(safeStorage.decryptString(Buffer.from(shape.enc, 'base64'))) as unknown;
      if (!plain || typeof plain !== 'object') return {};
      return Object.fromEntries(Object.entries(plain as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    } catch {
      log(`secrets: ${file} cannot be decrypted on this computer; starting empty`);
      return {};
    }
  };
  const data = () => (loaded ??= load());

  const save = async (values: Record<string, string>): Promise<void> => {
    if (!persistent) return;
    if (Object.keys(values).length === 0) {
      await rm(file, { force: true });
      return;
    }
    const shape: FileShape = { v: 1, enc: safeStorage.encryptString(JSON.stringify(values)).toString('base64') };
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(shape), { mode: 0o600 });
    await rename(tmp, file);
  };

  /** Writes run one after another so two quick `set`s never race on the file. */
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    persistent,
    async get(key) {
      return (await data())[key] ?? null;
    },
    set(key, value) {
      return serial(async () => {
        const values = { ...(await data()) };
        if (value === null) delete values[key];
        else values[key] = value;
        loaded = Promise.resolve(values);
        await save(values);
      });
    },
  };
}
