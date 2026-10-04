/**
 * The sync runtime over in-memory engines sharing one simulated relay (`createMemoryHub`): pair, join (merge and
 * replace), resume, rotate, unpair (the device keeps its data), erase (stays local) and the rule that device-local
 * collections never reach the engine. Each simulated device boots its own module graph, the way the app starts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createMemoryHub } from '@/sync/memoryStore';

const ULIDS = ['01J0000000000000000000000A', '01J0000000000000000000000B', '01J0000000000000000000000C'] as const;
const [R1, R2, R3] = ULIDS;
const RELAY = 'https://relay.example.ts.net';

type Hub = ReturnType<typeof createMemoryHub>;

async function boot(hub: Hub, name: string, shared?: { vault?: unknown; local?: unknown; lateRows?: number }) {
  vi.resetModules();
  const store = await import('@/store');
  const rt = await import('@/state/runtime');
  const { createSyncRuntime } = await import('@/state/sync/controller');
  const { createMemoryVault } = await import('@/state/sync/vault');
  const { createMemorySyncStore } = await import('@/sync/memoryStore');
  const device = `DEVICE${name}00000000`.slice(0, 16);
  const local = (shared?.local as ReturnType<typeof store.createMemoryBackend> | undefined) ?? store.createMemoryBackend({ device });
  const vault = (shared?.vault as ReturnType<typeof createMemoryVault> | undefined) ?? createMemoryVault();
  rt.setDocumentStore(store.createDocumentStore({ backend: local, device }));
  await rt.bootDocuments();
  const engines: Array<ReturnType<typeof createMemorySyncStore>> = [];
  const sync = createSyncRuntime({
    vault,
    createEngine: async () => {
      const e = createMemorySyncStore();
      e.link(hub);
      // a real engine can finish a round before the received rows reach its snapshot: the first pulls bring nothing
      let late = shared?.lateRows ?? 0;
      const pull = e.pull.bind(e);
      e.pull = async () => (late-- > 0 ? { received: 0, collections: [] } : pull());
      engines.push(e);
      return e;
    },
    localBackend: () => local,

  });
  const put = (col: string, id: string, body: Record<string, unknown>) =>
    rt.getDocumentStore().transact(store.mintWriteToken('command'), (tx) => tx.put(col as never, { _id: id, ...body } as never));
  const get = <T = Record<string, unknown>>(col: string, id: string) => rt.getDocumentStore().get<T>(col as never, id);
  return { sync, put, get, hub, engines, local, vault, rt, store };
}

const hubCols = (hub: Hub) => new Set<string>([...hub.values()].map((d) => d._col));
const hubDoc = (hub: Hub, col: string, id: string) => hub.get(`${col}\u0000${id}`);

beforeEach(() => localStorage.clear());

describe('sync runtime: pair and join', { timeout: 30_000 }, () => {
  it('pair pushes synced documents, never device-local ones, and shows the code', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    await a.put('uiPrefs', 'me', { panel: 'open' });
    await a.put('deviceSettings', 'me', { keepAwake: true });
    const code = await a.sync.pair(RELAY, 'Laptop');
    expect(code.words).toHaveLength(24);
    expect(code.uri).toMatch(/^vitals-sync:1\?/);
    expect(a.sync.view()).toMatchObject({ paired: true, enabled: true, label: 'Laptop' });
    expect(await a.sync.pairingCode()).toMatchObject({ words: code.words });
    expect(hubDoc(hub, 'recipes', R1)?.value).toMatchObject({ name: 'oats' });
    // device-local collections never reach the engine, before or after pairing
    await a.put('uiPrefs', 'me', { panel: 'closed' });
    await a.sync.syncNow();
    const cols = hubCols(hub);
    for (const local of ['uiPrefs', 'deviceSettings', 'changeLog', 'commandLedger', 'jobs', 'syncState', 'secrets']) expect(cols.has(local)).toBe(false);
    for (const e of a.engines) for (const local of ['uiPrefs', 'deviceSettings']) expect(await e.list(local)).toEqual([]);
    expect(await a.get('uiPrefs', 'me')).toMatchObject({ panel: 'closed' });
  });

  it('a second device that joins with merge keeps its own data and takes the synced data', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats', notes: 'synced note' });
    const code = await a.sync.pair(RELAY);

    const b = await boot(hub, 'B');
    await b.put('recipes', R2, { name: 'rice' });
    await b.put('recipes', R1, { name: 'local name', notes: '', extra: 'mine' });
    await b.put('uiPrefs', 'me', { panel: 'b' });
    expect(b.sync.describeLocalData()).toMatch(/custom foods and recipes/);
    await b.sync.join(code.uri, 'merge');
    expect(b.sync.view().paired).toBe(true);
    expect(await b.get('recipes', R1)).toMatchObject({ name: 'oats', notes: 'synced note', extra: 'mine' }); // synced wins, local fills gaps
    expect(await b.get('recipes', R2)).toMatchObject({ name: 'rice' });
    expect(await b.get('uiPrefs', 'me')).toMatchObject({ panel: 'b' });
    await b.sync.syncNow();
    expect(hubDoc(hub, 'recipes', R2)?.value).toMatchObject({ name: 'rice' });
  });

  it('join with replace drops this device’s synced documents but keeps its device-local ones', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    const code = await a.sync.pair(RELAY);

    const b = await boot(hub, 'B');
    await b.put('recipes', R3, { name: 'only on b' });
    await b.put('uiPrefs', 'me', { panel: 'b' });
    await b.sync.join({ words: code.words.join(' '), relayUrl: RELAY }, 'replace');
    expect(await b.get('recipes', R1)).toMatchObject({ name: 'oats' });
    expect(await b.get('recipes', R3)).toBeNull();
    expect(await b.get('uiPrefs', 'me')).toMatchObject({ panel: 'b' });
    await b.sync.syncNow();
    expect(hubDoc(hub, 'recipes', R3)).toBeUndefined();
  });

  it('a joining device waits for the synced data instead of pushing its own over it (rows arrive late)', async () => {
    for (const mode of ['replace', 'merge'] as const) {
      const hub: Hub = new Map();
      const a = await boot(hub, 'A');
      await a.put('recipes', R1, { name: 'oats' });
      const code = await a.sync.pair(RELAY);

      const b = await boot(hub, 'B', { lateRows: 2 });
      await b.put('recipes', R1, { name: 'default on b' });
      await b.sync.join(code.uri, mode);
      expect(await b.get('recipes', R1)).toMatchObject({ name: 'oats' });
      await b.sync.syncNow();
      expect(hubDoc(hub, 'recipes', R1)?.value).toMatchObject({ name: 'oats' });
    }
  });

  it('rejects a bad code, and a second pair on a paired device', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await expect(a.sync.join('not a code', 'merge')).rejects.toMatchObject({ name: 'SyncError', code: 'invalid_code' });
    await expect(a.sync.pair('http://insecure.example', undefined)).rejects.toMatchObject({ code: 'invalid_relay' });
    await a.sync.pair(RELAY);
    await expect(a.sync.pair(RELAY)).rejects.toMatchObject({ code: 'already_paired' });
  });
});

describe('sync runtime: resume, rotate, unpair, erase', { timeout: 30_000 }, () => {
  it('resumes after a restart from the vault and the local copy', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    await a.sync.pair(RELAY, 'Laptop');
    const again = await boot(hub, 'A', { vault: a.vault, local: a.local });
    expect(again.sync.view().paired).toBe(false); // nothing loaded yet
    expect(await again.sync.load()).toMatchObject({ enabled: true, relayUrl: RELAY, label: 'Laptop' });
    await again.sync.resume();
    expect(again.sync.engine).not.toBeNull();
    expect(await again.get('recipes', R1)).toMatchObject({ name: 'oats' });
    await again.put('recipes', R2, { name: 'later' });
    await again.sync.syncNow();
    expect(hubDoc(hub, 'recipes', R2)).toBeDefined();
  });

  it('rotate moves the data to a new key and a new pairing code', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    const first = await a.sync.pair(RELAY);
    const second = await a.sync.rotate();
    expect(second.words).not.toEqual(first.words);
    expect((await a.sync.pairingCode())?.words).toEqual(second.words);
    expect(a.sync.view().paired).toBe(true);
    expect(await a.get('recipes', R1)).toMatchObject({ name: 'oats' });
  });

  it('rotate refuses when sync is not running', async () => {
    const a = await boot(new Map(), 'A');
    await expect(a.sync.rotate()).rejects.toMatchObject({ code: 'not_paired' });
  });

  it('unpair keeps this device’s data, forgets the key and stops sending', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    await a.sync.pair(RELAY);
    const b = await boot(hub, 'B');
    await b.sync.join((await a.sync.pairingCode())!.uri, 'merge');
    await b.put('recipes', R2, { name: 'from b' });
    await b.sync.syncNow();

    await b.sync.unpair();
    expect(b.sync.view()).toMatchObject({ paired: false });
    expect(await b.vault.load()).toBeNull();
    expect(await b.sync.pairingCode()).toBeNull();
    expect(await b.get('recipes', R1)).toMatchObject({ name: 'oats' });
    expect(await b.get('recipes', R2)).toMatchObject({ name: 'from b' });
    const before = hub.size;
    await b.put('recipes', R3, { name: 'after' });
    expect(hub.size).toBe(before);
    expect(hubDoc(hub, 'recipes', R3)).toBeUndefined();
    // the other device keeps syncing
    expect(hubDoc(hub, 'recipes', R2)).toBeDefined();
  });

  it('erase this device stays local: nothing is deleted on the relay, the vault is cleared', async () => {
    const hub: Hub = new Map();
    const a = await boot(hub, 'A');
    await a.put('recipes', R1, { name: 'oats' });
    await a.sync.pair(RELAY);
    const sizeBefore = hub.size;
    await a.sync.eraseLocal();
    expect(a.sync.view().paired).toBe(false);
    expect(await a.vault.load()).toBeNull();
    expect(hub.size).toBe(sizeBefore);
    expect(hubDoc(hub, 'recipes', R1)?._deleted).toBeFalsy();
  });

  it('configure changes the name and pauses without losing the key', async () => {
    const a = await boot(new Map(), 'A');
    await expect(a.sync.configure({ label: 'x' })).rejects.toMatchObject({ code: 'not_paired' });
    await a.sync.pair(RELAY);
    await a.sync.configure({ label: 'Desk', enabled: false });
    expect(a.sync.view()).toMatchObject({ paired: true, enabled: false, label: 'Desk' });
    await a.sync.configure({ enabled: true });
    expect(a.sync.view().enabled).toBe(true);
    expect((await a.vault.load())?.config.label).toBe('Desk');
  });
});
