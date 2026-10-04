// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { KeyVault, WRAPPING_KEY_META, type StoredKeyRecord } from './keys';
import { MemoryKv, type KvStore } from './storage/kv';

const KEY = 'sk-test-SECRETSECRET-1234567890';
const OPENAI = 'https://api.openai.com/v1';

/** MemoryKv that records every call. */
function spyKv<V>(): KvStore<V> & { calls: string[]; inner: MemoryKv<V> } {
  const inner = new MemoryKv<V>();
  const calls: string[] = [];
  return {
    inner,
    calls,
    get: (k) => (calls.push(`get ${k}`), inner.get(k)),
    set: (k, v) => (calls.push(`set ${k}`), inner.set(k, v)),
    delete: (k) => (calls.push(`delete ${k}`), inner.delete(k)),
    keys: () => (calls.push('keys'), inner.keys()),
  };
}

function setup() {
  const keys = spyKv<StoredKeyRecord>();
  const meta = spyKv<unknown>();
  const requestPersist = vi.fn(async () => true);
  const vault = new KeyVault({ keys, meta, now: () => '2026-10-01T10:00:00.000Z', requestPersist });
  return { keys, meta, requestPersist, vault };
}

function includesBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('KeyVault', () => {
  it('round-trips a device key and stores only ciphertext', async () => {
    const { vault, keys } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    expect(await vault.get('openai', OPENAI)).toBe(KEY);
    expect(await vault.get('openai', 'https://api.openai.com/v2/other')).toBe(KEY); // same origin
    expect(await vault.status('openai', OPENAI)).toBe('device');
    expect(await vault.has('openai', OPENAI)).toBe(true);

    const rec = (await keys.inner.get('openai'))!;
    expect(rec.presetId).toBe('openai');
    expect(rec.origin).toBe('https://api.openai.com');
    expect(rec.iv).toBeInstanceOf(Uint8Array);
    expect(rec.iv.byteLength).toBe(12);
    const ct = new Uint8Array(rec.ciphertext);
    expect(includesBytes(ct, new TextEncoder().encode(KEY))).toBe(false);
    expect(includesBytes(ct, new TextEncoder().encode('SECRET'))).toBe(false);
    expect(JSON.stringify({ ...rec, ciphertext: [...ct] })).not.toContain('SECRET');
  });

  it('uses a fresh IV per save', async () => {
    const { vault, keys } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    const iv1 = (await keys.inner.get('openai'))!.iv;
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    const iv2 = (await keys.inner.get('openai'))!.iv;
    expect([...iv1]).not.toEqual([...iv2]);
  });

  it('keeps the wrapping key non-extractable', async () => {
    const { vault, meta } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    const wk = (await meta.inner.get(WRAPPING_KEY_META)) as CryptoKey;
    expect(wk.extractable).toBe(false);
    expect(wk.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', wk)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', wk)).rejects.toThrow();
  });

  it('reuses the stored wrapping key across vault instances', async () => {
    const { vault, keys, meta } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    const again = new KeyVault({ keys, meta, now: () => 'x' });
    expect(await again.get('openai', OPENAI)).toBe(KEY);
  });

  it('refuses the key for another origin and reports origin-mismatch', async () => {
    const { vault } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    expect(await vault.get('openai', 'https://evil.example/v1')).toBeNull();
    expect(await vault.get('openai', 'http://api.openai.com/v1')).toBeNull();
    expect(await vault.get('openai', 'not a url')).toBeNull();
    expect(await vault.status('openai', 'https://evil.example/v1')).toBe('origin-mismatch');
    expect(await vault.has('openai', 'https://evil.example/v1')).toBe(false);
  });

  it('binds records to preset and origin through AAD', async () => {
    const { vault, keys } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    const rec = (await keys.inner.get('openai'))!;
    // Copied under another preset id (even with the presetId field rewritten): authentication fails.
    await keys.inner.set('openai-chat', { ...rec });
    expect(await vault.get('openai-chat', OPENAI)).toBeNull();
    await keys.inner.set('openai-chat', { ...rec, presetId: 'openai-chat' });
    expect(await vault.get('openai-chat', OPENAI)).toBeNull();
    // Origin field edited to re-point the key: authentication fails.
    await keys.inner.set('openai', { ...rec, origin: 'https://evil.example' });
    expect(await vault.get('openai', 'https://evil.example')).toBeNull();
  });

  it('session mode never persists anything', async () => {
    const { vault, keys, meta, requestPersist } = setup();
    await vault.save('groq', 'https://api.groq.com/openai/v1', KEY, { mode: 'session' });
    expect(await vault.get('groq', 'https://api.groq.com/openai/v1')).toBe(KEY);
    expect(await vault.status('groq', 'https://api.groq.com/openai/v1')).toBe('session');
    expect(await vault.status('groq', 'https://other.example')).toBe('origin-mismatch');
    expect(keys.calls.filter((c) => c.startsWith('set'))).toEqual([]);
    expect(meta.calls).toEqual([]);
    expect(await keys.inner.keys()).toEqual([]);
    expect(requestPersist).not.toHaveBeenCalled();
    // A fresh vault (new page load) has forgotten it.
    expect(await new KeyVault({ keys, meta, now: () => 'x' }).get('groq', 'https://api.groq.com/openai/v1')).toBeNull();
  });

  it('switching to session mode drops a remembered copy', async () => {
    const { vault, keys } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    await vault.save('openai', OPENAI, 'sk-other-key-000000', { mode: 'session' });
    expect(await keys.inner.keys()).toEqual([]);
    expect(await vault.get('openai', OPENAI)).toBe('sk-other-key-000000');
  });

  it('requests persistent storage once, at the first device save', async () => {
    const { vault, requestPersist } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    await vault.save('groq', 'https://api.groq.com/openai/v1', KEY, { mode: 'device' });
    expect(requestPersist).toHaveBeenCalledTimes(1);
  });

  it('never reveals keys through String, JSON or list(), nor in errors', async () => {
    const { vault } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    await vault.save('groq', 'https://api.groq.com/openai/v1', KEY, { mode: 'session' });
    expect(String(vault)).toBe('[KeyVault]');
    expect(`${vault}`).not.toContain('sk-');
    expect(JSON.stringify(vault)).toBe('{"type":"KeyVault"}');
    expect(JSON.stringify({ vault })).not.toContain('SECRET');
    expect(Object.keys(vault)).toEqual([]);
    const list = await vault.list();
    expect(list).toEqual([
      { presetId: 'groq', origin: 'https://api.groq.com', mode: 'session', createdAt: '2026-10-01T10:00:00.000Z' },
      { presetId: 'openai', origin: 'https://api.openai.com', mode: 'device', createdAt: '2026-10-01T10:00:00.000Z' },
    ]);
    expect(JSON.stringify(list)).not.toContain('SECRET');
    const err = await vault.save('x', 'nope', KEY, { mode: 'device' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(String((err as Error).message)).not.toContain('SECRET');
  });

  it('remove and clearAll forget keys (clearAll also drops the wrapping key)', async () => {
    const { vault, keys, meta } = setup();
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    await vault.save('groq', 'https://api.groq.com/openai/v1', KEY, { mode: 'device' });
    await vault.save('mistral', 'https://api.mistral.ai/v1', KEY, { mode: 'session' });
    await vault.remove('openai');
    expect(await vault.status('openai', OPENAI)).toBe('none');
    expect(await vault.get('openai', OPENAI)).toBeNull();
    expect((await vault.list()).map((e) => e.presetId)).toEqual(['groq', 'mistral']);

    await vault.clearAll();
    expect(await vault.list()).toEqual([]);
    expect(await keys.inner.keys()).toEqual([]);
    expect(await meta.inner.get(WRAPPING_KEY_META)).toBeUndefined();
    // Still usable afterwards with a new wrapping key.
    await vault.save('openai', OPENAI, KEY, { mode: 'device' });
    expect(await vault.get('openai', OPENAI)).toBe(KEY);
  });
});
