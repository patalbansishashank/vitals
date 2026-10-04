/**
 * Pairing turns sync on (plan decision 5, R20-PAIR): the browser joins with the key its home server handed over, as a
 * `vitals-sync:1` code built from the server's address, on the same `join` path as the 24 words. The server owns the
 * group: an empty group takes this device's data (push), and a device that holds data merges by default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createMemoryHub } from '@/sync/memoryStore';
import { formatPairingUri, newOwnerSecret, secretToWords } from '@/sync/pairing';

const [R1, R2] = ['01J0000000000000000000000A', '01J0000000000000000000000B'] as const;
const SERVER = 'https://home.example.ts.net:8443';
type Hub = ReturnType<typeof createMemoryHub>;

/** One simulated device with its own module graph, the way the app starts (as in runtime.test.ts). */
async function boot(hub: Hub, name: string) {
  vi.resetModules();
  const store = await import('@/store');
  const rt = await import('@/state/runtime');
  const { createSyncRuntime } = await import('@/state/sync/controller');
  const { createMemoryVault } = await import('@/state/sync/vault');
  const { createMemorySyncStore } = await import('@/sync/memoryStore');
  const device = `DEVICE${name}00000000`.slice(0, 16);
  const local = store.createMemoryBackend({ device });
  rt.setDocumentStore(store.createDocumentStore({ backend: local, device }));
  await rt.bootDocuments();
  const sync = createSyncRuntime({
    vault: createMemoryVault(),
    createEngine: async () => {
      const e = createMemorySyncStore();
      e.link(hub);
      return e;
    },
    localBackend: () => local,
  });
  const put = (col: string, id: string, body: Record<string, unknown>) =>
    rt.getDocumentStore().transact(store.mintWriteToken('command'), (tx) => tx.put(col as never, { _id: id, ...body } as never));
  const get = (col: string, id: string) => rt.getDocumentStore().get(col as never, id);
  return { sync, put, get };
}
const hubDoc = (hub: Hub, col: string, id: string) => hub.get(`${col}\u0000${id}`);

beforeEach(() => localStorage.clear());

describe('joining with the key a home server hands over', { timeout: 60_000 }, () => {
  it('an empty group (a new person on the server) takes this device’s data', async () => {
    const hub: Hub = new Map();
    const key = newOwnerSecret();
    const b = await boot(hub, 'B');
    await b.put('recipes', R1, { name: 'oats' });
    await b.sync.join(formatPairingUri(SERVER, key, 'Sam'), 'merge');
    expect(b.sync.view()).toMatchObject({ paired: true, label: 'Sam' });
    expect(new URL(b.sync.view().relayUrl!).origin).toBe(SERVER);
    expect(hubDoc(hub, 'recipes', R1)?.value).toMatchObject({ name: 'oats' });
    // the key it holds is the server's: the pairing code shows the same words
    expect((await b.sync.pairingCode())?.words).toEqual(secretToWords(key));
  });

  it('merge (the default when this device holds data) keeps both sides', async () => {
    const hub: Hub = new Map();
    const key = newOwnerSecret();
    const srv = await boot(hub, 'S');
    await srv.put('recipes', R1, { name: 'from the server' });
    await srv.sync.join(formatPairingUri(SERVER, key), 'merge');
    const b = await boot(hub, 'B');
    await b.put('recipes', R2, { name: 'only here' });
    expect(b.sync.describeLocalData()).not.toBeNull();
    await b.sync.join(formatPairingUri(SERVER, key), 'merge');
    expect(await b.get('recipes', R1)).toMatchObject({ name: 'from the server' });
    expect(await b.get('recipes', R2)).toMatchObject({ name: 'only here' });
    await b.sync.syncNow();
    expect(hubDoc(hub, 'recipes', R2)?.value).toMatchObject({ name: 'only here' });
  });
});
