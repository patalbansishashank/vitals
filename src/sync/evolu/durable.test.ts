// @vitest-environment node
/**
 * A write is on disk when `put`/`delete`/`batch` resolve (R20-OUTBOX-09): a child process opens a file-backed store on
 * the Node platform, writes, and SIGKILLs itself the moment the write resolves; the store reopened here must hold it.
 * Before the fix `put` resolved before Evolu's DbWorker stored the row, and a kill within about 50 ms lost it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeEvoluPlatform } from '../../../packages/companion/src/evoluNode';
import { newOwnerSecret } from '../pairing';
import { KV_COLLECTION } from '../types';
import { createEvoluSyncStore } from './adapter';

const ROOT = join(__dirname, '../../..');
const url = (p: string) => pathToFileURL(join(ROOT, p)).href;
let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-durable-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs `steps` (a script body with `store` open) in a child that kills itself with SIGKILL right after them. */
function writeThenKill(secret: Uint8Array, instance: string, steps: string): Promise<NodeJS.Signals | null> {
  const code = `
    const { installPolyfills } = await import('@evolu/common/polyfills');
    installPolyfills();
    const { createEvoluSyncStore } = await import(${JSON.stringify(url('src/sync/evolu/adapter.ts'))});
    const { createNodeEvoluPlatform } = await import(${JSON.stringify(url('packages/companion/src/evoluNode.ts'))});
    let input = '';
    for await (const c of process.stdin) input += c;
    const store = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: ${JSON.stringify(dir)}, instance: ${JSON.stringify(instance)} }), appName: 'vitalsDurable' });
    await store.open({ secret: new Uint8Array(Buffer.from(input.trim(), 'base64url')), relayUrl: null, deviceId: 'DEVICEKILL', memoryOnly: false });
    ${steps}
    process.kill(process.pid, 'SIGKILL');
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--import', url('qa/scripts/sync/lib/tsResolve.mjs'), '--input-type=module', '-e', code], {
      cwd: ROOT,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (exitCode, signal) => (signal ? resolve(signal) : reject(new Error(`child exited with ${exitCode}: ${err}`))));
    child.stdin.end(Buffer.from(secret).toString('base64url'));
  });
}

const reopen = async (secret: Uint8Array, instance: string) => {
  const s = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance }), appName: 'vitalsDurable' });
  await s.open({ secret, relayUrl: null, deviceId: 'DEVICEREAD', memoryOnly: false });
  return s;
};

describe('durable writes', () => {
  it('put, batch and delete are on disk when they resolve: a SIGKILL 0 ms later loses nothing', async () => {
    const secret = newOwnerSecret();
    const signal = await writeThenKill(
      secret,
      'K1',
      `await store.put('kv', 'gone', { n: 0 });
       await store.put('kv', 'one', { n: 1 });
       await store.batch([{ kind: 'put', col: 'kv', id: 'two', value: { n: 2 }, schema: 1 }, { kind: 'put', col: 'kv', id: 'three', value: { n: 3 }, schema: 1 }]);
       await store.delete('kv', 'gone');`,
    );
    expect(signal).toBe('SIGKILL');
    const s = await reopen(secret, 'K1');
    try {
      expect((await s.get(KV_COLLECTION, 'one'))?.value).toEqual({ n: 1 });
      expect((await s.get(KV_COLLECTION, 'two'))?.value).toEqual({ n: 2 });
      expect((await s.get(KV_COLLECTION, 'three'))?.value).toEqual({ n: 3 });
      expect((await s.get(KV_COLLECTION, 'gone'))?._deleted).toBe(true);
    } finally {
      await s.close();
    }
  }, 60_000);

  it('the last of many writes is on disk when it resolves', async () => {
    const secret = newOwnerSecret();
    await writeThenKill(secret, 'K2', `for (let i = 0; i < 20; i++) await store.put('kv', 'n', { i });`);
    const s = await reopen(secret, 'K2');
    try {
      expect((await s.get(KV_COLLECTION, 'n'))?.value).toEqual({ i: 19 });
    } finally {
      await s.close();
    }
  }, 60_000);

  it('a write whose store is erased before it is stored rejects at once instead of hanging', async () => {
    const s = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ instance: 'K3' }), appName: 'vitalsDurable3', storedTimeoutMs: 300 });
    await s.open({ secret: newOwnerSecret(), relayUrl: null, deviceId: 'DEVICET', memoryOnly: true });
    const pending = s.put(KV_COLLECTION, 'x', { n: 1 });
    await s.eraseLocal(); // the instance is gone before its DbWorker answers
    await expect(pending).rejects.toMatchObject({ code: 'store_closed' });
  }, 30_000);
});
