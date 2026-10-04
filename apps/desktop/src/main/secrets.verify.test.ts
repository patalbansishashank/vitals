// @vitest-environment node
/** Adversarial checks of the secrets file: Linux without a keyring, and the file's mode. */
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecrets, type SafeStorageLike } from './secrets';

const base = path.resolve(process.cwd(), '.e6-tmp');
let dir: string;
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'secrets-v-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const storage = (backend?: string): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8'), // basic_text is as good as this: a key everyone has
  decryptString: (b) => b.toString('utf8'),
  ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
});

describe('secrets (verify)', () => {
  it("Linux without a keyring (safeStorage's basic_text backend) keeps tokens in memory, never on disk", async () => {
    const file = path.join(dir, 'Vitals', 'secrets.json');
    const s = createSecrets({ file, safeStorage: storage('basic_text') });
    expect(s.persistent).toBe(false);
    await s.set('agentToken:codex', 'tok-1');
    expect(await s.get('agentToken:codex')).toBe('tok-1');
    await expect(stat(file)).rejects.toThrow();
  });

  it('a real keyring backend persists, mode 0600, no temp file left', async () => {
    const file = path.join(dir, 'Vitals', 'secrets.json');
    const s = createSecrets({ file, safeStorage: storage('gnome_libsecret') });
    expect(s.persistent).toBe(true);
    await s.set('agentToken:codex', 'tok-1');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(path.dirname(file))).toEqual(['secrets.json']);
    const again = createSecrets({ file, safeStorage: storage('gnome_libsecret') });
    expect(await again.get('agentToken:codex')).toBe('tok-1');
  });
});
