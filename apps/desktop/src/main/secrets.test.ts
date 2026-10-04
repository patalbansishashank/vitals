// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecrets, type SafeStorageLike } from './secrets';

const base = path.resolve(process.cwd(), '.e6-tmp');
let dir: string;
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'secrets-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** A reversible scramble standing in for the OS keyring; `key` tells two computers apart. */
const fakeSafeStorage = (available = true, key = 7): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ key)),
  decryptString: (b) => {
    const out = Buffer.from(b.map((x) => x ^ key)).toString('utf8');
    if (!out.startsWith('{')) throw new Error('decrypt failed');
    return out;
  },
});

describe('secrets', () => {
  it('stores and reads back, deletes with null, survives a restart, never writes plain text, mode 0600', async () => {
    const file = path.join(dir, 'Vitals', 'secrets.json');
    const s = createSecrets({ file, safeStorage: fakeSafeStorage() });
    expect(s.persistent).toBe(true);
    expect(await s.get('agentToken:codex')).toBeNull();
    await s.set('agentToken:codex', 'tok-codex-1');
    await s.set('agentToken:claude-code', 'tok-claude-1');
    expect(await s.get('agentToken:codex')).toBe('tok-codex-1');

    const raw = await readFile(file);
    expect(raw.toString('latin1')).not.toContain('tok-codex-1');
    expect(raw.toString('latin1')).not.toContain('agentToken');
    expect(JSON.parse(raw.toString('utf8'))).toMatchObject({ v: 1 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const again = createSecrets({ file, safeStorage: fakeSafeStorage() });
    expect(await again.get('agentToken:codex')).toBe('tok-codex-1');
    expect(await again.get('agentToken:claude-code')).toBe('tok-claude-1');
    await again.set('agentToken:codex', null);
    expect(await again.get('agentToken:codex')).toBeNull();
    expect(await createSecrets({ file, safeStorage: fakeSafeStorage() }).get('agentToken:codex')).toBeNull();
    // the last secret gone: the file goes too
    await again.set('agentToken:claude-code', null);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('quick successive sets all land', async () => {
    const file = path.join(dir, 'secrets.json');
    const s = createSecrets({ file, safeStorage: fakeSafeStorage() });
    await Promise.all([s.set('agentToken:codex', 'a'), s.set('agentToken:opencode', 'b'), s.set('agentToken:claude-code', 'c')]);
    const again = createSecrets({ file, safeStorage: fakeSafeStorage() });
    expect(await Promise.all([again.get('agentToken:codex'), again.get('agentToken:opencode'), again.get('agentToken:claude-code')])).toEqual(['a', 'b', 'c']);
  });

  it('without encryption keeps secrets in memory only and says so', async () => {
    const file = path.join(dir, 'secrets.json');
    const s = createSecrets({ file, safeStorage: fakeSafeStorage(false) });
    expect(s.persistent).toBe(false);
    await s.set('agentToken:codex', 'tok');
    expect(await s.get('agentToken:codex')).toBe('tok');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a file from another keyring starts empty (logged, not thrown)', async () => {
    const file = path.join(dir, 'secrets.json');
    await createSecrets({ file, safeStorage: fakeSafeStorage(true, 7) }).set('agentToken:codex', 'tok');
    const lines: string[] = [];
    const other = createSecrets({ file, safeStorage: fakeSafeStorage(true, 9), log: (l) => void lines.push(l) });
    expect(await other.get('agentToken:codex')).toBeNull();
    expect(lines.join('\n')).toContain('cannot be decrypted');
    expect(lines.join('\n')).not.toContain('tok');
  });
});
