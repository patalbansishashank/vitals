import { describe, expect, it } from 'vitest';
import { createAesGcmEncryptor } from '../crypto';
import { chunkAad, chunkIdOf, createChunkStore, createMemoryChunkIndex } from './chunkStore';
import { createMemoryBlobBackend } from './memory';

const KEY = new Uint8Array(32).fill(9);
const bytesOf = (...n: number[]) => new Uint8Array(n);

function setup(clock = '2026-10-01T12:00:00.000Z') {
  const local = createMemoryBlobBackend();
  const remote = createMemoryBlobBackend();
  const index = createMemoryChunkIndex();
  const pendingSeen: number[] = [];
  const store = createChunkStore({ bytes: local, index, now: () => new Date(clock), onPending: (n) => pendingSeen.push(n) });
  const seal = createAesGcmEncryptor(KEY);
  return { store, local, remote, index, seal, pendingSeen };
}

describe('chunk store · ids', () => {
  it('uses a 22-character aad id as the chunk id and hashes anything else, independent of any key', async () => {
    const id = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(await chunkIdOf(bytesOf(1), { purpose: 'bio', aadId: id })).toBe(id);
    const a = await chunkIdOf(bytesOf(1, 2), { purpose: 'photo', aadId: 'photo-1' });
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await chunkIdOf(bytesOf(1, 2), { purpose: 'photo', aadId: 'photo-1' })).toBe(a);
    expect(await chunkIdOf(bytesOf(1, 3), { purpose: 'photo', aadId: 'photo-1' })).not.toBe(a);
    expect(await chunkIdOf(bytesOf(1, 2), { purpose: 'bio', aadId: 'photo-1' })).not.toBe(a);
  });
});

describe('chunk store · local bytes and the upload queue', () => {
  it('keeps local bytes plain, queues nothing while unpaired and uploads the backlog on pair', async () => {
    const { store, local, remote, index, seal } = setup();
    const { chunkId } = await store.put(bytesOf(1, 2, 3), { purpose: 'bio', aadId: 'a' });
    expect(await local.get(chunkId)).toEqual(bytesOf(1, 2, 3)); // not sealed locally
    expect(store.pending()).toBe(0);
    expect((await index.get(chunkId))?.uploaded).toBe(false);

    await store.attachRemote({ seal, backend: remote });
    expect(store.pending()).toBe(1); // pairing queues what was stored before
    expect(await store.flush()).toBe(1);
    expect(store.pending()).toBe(0);
    expect((await index.get(chunkId))?.uploaded).toBe(true);
    // the relay holds ciphertext, not the plain bytes
    const sealed = (await remote.get(chunkId))!;
    expect(sealed).not.toEqual(bytesOf(1, 2, 3));
    expect(await seal.open(sealed, chunkAad(chunkId))).toEqual(bytesOf(1, 2, 3));
  });

  it('a chunk stored while a flush is running is uploaded by that same flush (the server merges after every ring message)', async () => {
    const { store, remote, index, seal } = setup();
    // a remote whose first put takes long enough for a second chunk to be stored meanwhile
    const gate: { release: (() => void) | null } = { release: null };
    const slow = {
      ...remote,
      put: async (id: string, data: Uint8Array) => {
        if (gate.release === null) await new Promise<void>((r) => (gate.release = r));
        return remote.put(id, data);
      },
    };
    await store.attachRemote({ seal, backend: slow });
    const first = await store.put(bytesOf(1), { purpose: 'bio', aadId: 'first' });
    const flushing = store.flush();
    const second = await store.put(bytesOf(2), { purpose: 'bio', aadId: 'second' });
    expect(store.pending()).toBe(2);
    while (gate.release === null) await new Promise((r) => setTimeout(r, 1)); // the first upload is now blocked inside put
    gate.release();
    expect(await flushing).toBe(2);
    expect(store.pending()).toBe(0);
    expect((await index.get(first.chunkId))?.uploaded).toBe(true);
    expect((await index.get(second.chunkId))?.uploaded).toBe(true);
    expect(await remote.get(second.chunkId)).not.toBeNull();
  });

  it('the queue is the index: a new store over the same index reloads pending uploads', async () => {
    const { store, local, remote, index, seal } = setup();
    await store.put(bytesOf(1), { purpose: 'bio', aadId: 'one' });
    await store.put(bytesOf(2), { purpose: 'bio', aadId: 'two' });
    const reopened = createChunkStore({ bytes: local, index });
    await reopened.attachRemote({ seal, backend: remote });
    expect(reopened.pending()).toBe(2);
    expect(await reopened.flush()).toBe(2);
  });

  it('a failed upload stays queued and shows the error; the next flush retries', async () => {
    const { store, remote, seal } = setup();
    await store.put(bytesOf(1), { purpose: 'bio', aadId: 'a' });
    let fail = true;
    const flaky = { ...remote, put: async (id: string, b: Uint8Array) => (fail ? Promise.reject(new Error('offline')) : remote.put(id, b)) };
    await store.attachRemote({ seal, backend: flaky });
    expect(await store.flush()).toBe(0);
    expect(store.pending()).toBe(1);
    expect(store.lastError?.message).toBe('offline');
    fail = false;
    expect(await store.flush()).toBe(1);
    expect(store.lastError).toBeNull();
  });

  it('queueAll marks everything for upload again (a new key)', async () => {
    const { store, remote, seal, index } = setup();
    const { chunkId } = await store.put(bytesOf(1), { purpose: 'bio', aadId: 'a' });
    await store.attachRemote({ seal, backend: remote });
    await store.flush();
    expect(await store.queueAll()).toBe(1);
    expect((await index.get(chunkId))?.uploaded).toBe(false);
    expect(store.pending()).toBe(1);
  });
});

describe('chunk store · hasRemote', () => {
  it('is false while a chunk waits for upload or unpaired, true once uploaded or when the endpoint has it', async () => {
    const { store, remote, seal } = setup();
    const { chunkId } = await store.put(bytesOf(1, 2, 3), { purpose: 'bio', aadId: 'h1' });
    expect(await store.hasRemote(chunkId)).toBe(false);
    await store.attachRemote({ seal, backend: remote });
    expect(await store.hasRemote(chunkId)).toBe(false);
    await store.flush();
    expect(await store.hasRemote(chunkId)).toBe(true);
    // another device's chunk: asked of the endpoint
    const other = setup();
    await other.store.attachRemote({ seal, backend: remote });
    expect(await other.store.hasRemote(chunkId)).toBe(true);
    expect(await other.store.hasRemote('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });
});

describe('chunk store · sealing and authentication', () => {
  it('opens an evicted chunk from the relay and caches it again', async () => {
    const { store, remote, seal, local } = setup();
    const { chunkId } = await store.put(bytesOf(5, 6), { purpose: 'bio', aadId: 'a', localDate: '2026-01-01' });
    await store.attachRemote({ seal, backend: remote });
    await store.flush();
    expect(await store.evictLocal('2026-06-01', 'bio')).toBe(1);
    expect(await store.hasLocal(chunkId)).toBe(false);
    expect(await store.get(chunkId)).toEqual(bytesOf(5, 6));
    expect(await local.has(chunkId)).toBe(true);
  });

  it('rejects a chunk sealed under another key or another id (AAD binds the chunk id)', async () => {
    const { store, remote, seal } = setup();
    const { chunkId } = await store.put(bytesOf(7), { purpose: 'bio', aadId: 'a', localDate: '2026-01-01' });
    await store.attachRemote({ seal, backend: remote });
    await store.flush();
    await store.evictLocal('2026-06-01', 'bio');

    // another key
    const other = createChunkStore({ bytes: createMemoryBlobBackend(), index: createMemoryChunkIndex() });
    await other.attachRemote({ seal: createAesGcmEncryptor(new Uint8Array(32).fill(1)), backend: remote });
    await expect(other.get(chunkId)).rejects.toThrow(/failed authentication/);

    // the sealed bytes of chunk A served under chunk B's id
    const sealedA = (await remote.get(chunkId))!;
    const swapped = createMemoryBlobBackend();
    await swapped.put('BBBBBBBBBBBBBBBBBBBBBB', sealedA);
    const victim = createChunkStore({ bytes: createMemoryBlobBackend(), index: createMemoryChunkIndex() });
    await victim.attachRemote({ seal, backend: swapped });
    await expect(victim.get('BBBBBBBBBBBBBBBBBBBBBB')).rejects.toThrow(/failed authentication/);
  });

  it('a missing chunk is an error naming where it was looked for', async () => {
    const { store, remote, seal } = setup();
    await expect(store.get('CCCCCCCCCCCCCCCCCCCCCC')).rejects.toThrow(/not stored on this device\./);
    await store.attachRemote({ seal, backend: remote });
    await expect(store.get('CCCCCCCCCCCCCCCCCCCCCC')).rejects.toThrow(/or on the sync server/);
  });
});

describe('chunk store · eviction and erase', () => {
  it('evicts only chunks that were uploaded, older than the cut-off, of that purpose', async () => {
    const { store, remote, seal } = setup();
    const old = await store.put(bytesOf(1), { purpose: 'bio', aadId: 'old', localDate: '2026-01-01' });
    const recent = await store.put(bytesOf(2), { purpose: 'bio', aadId: 'new', localDate: '2026-09-30' });
    const photo = await store.put(bytesOf(3), { purpose: 'photo', aadId: 'p', localDate: '2026-01-01' });
    // unpaired: never drops the only copy
    expect(await store.evictLocal('2026-06-01', 'bio')).toBe(0);
    await store.attachRemote({ seal, backend: remote });
    // paired but not uploaded yet
    expect(await store.evictLocal('2026-06-01', 'bio')).toBe(0);
    expect(await store.hasLocal(old.chunkId)).toBe(true);
    await store.flush();
    // a chunk stored after the first flush is not uploaded: it must stay
    const fresh = await store.put(bytesOf(4), { purpose: 'bio', aadId: 'fresh', localDate: '2026-01-02' });
    expect(await store.evictLocal('2026-06-01', 'bio')).toBe(1);
    expect(await store.hasLocal(old.chunkId)).toBe(false);
    expect(await store.hasLocal(recent.chunkId)).toBe(true);
    expect(await store.hasLocal(photo.chunkId)).toBe(true);
    expect(await store.hasLocal(fresh.chunkId)).toBe(true);
  });

  it('restoreLocal brings back evicted chunks and chunks only other devices stored', async () => {
    const { store, remote, seal, local } = setup();
    const mine = await store.put(bytesOf(1), { purpose: 'bio', aadId: 'm', localDate: '2026-01-01' });
    await store.attachRemote({ seal, backend: remote });
    await store.flush();
    await store.evictLocal('2026-06-01', 'bio');
    // another device's chunk
    const theirs = 'DDDDDDDDDDDDDDDDDDDDDD';
    await remote.put(theirs, await seal.seal(bytesOf(9), chunkAad(theirs)));
    const r = await store.restoreLocal([{ chunkId: theirs, purpose: 'bio', localDate: '2026-02-02' }]);
    expect(r).toEqual({ restored: 2, failed: 0 });
    expect(await local.get(mine.chunkId)).toEqual(bytesOf(1));
    expect(await local.get(theirs)).toEqual(bytesOf(9));
  });

  it('erase deletes local bytes and the index but never the remote copy', async () => {
    const { store, remote, seal, local, index } = setup();
    const { chunkId } = await store.put(bytesOf(1), { purpose: 'bio', aadId: 'a' });
    await store.attachRemote({ seal, backend: remote });
    await store.flush();
    await store.erase();
    expect(await local.has(chunkId)).toBe(false);
    expect(await index.list()).toEqual([]);
    expect(await remote.has(chunkId)).toBe(true);
    expect(store.paired).toBe(false);
  });
});

describe('chunk store · discard', () => {
  it('drops a replaced chunk: local bytes, index row and its pending upload', async () => {
    const { store, local, remote, index, seal } = setup();
    await store.attachRemote({ seal, backend: remote });
    const { chunkId } = await store.put(bytesOf(4, 5), { purpose: 'bio', aadId: 'replaced' });
    const kept = await store.put(bytesOf(6), { purpose: 'bio', aadId: 'kept' });
    expect(store.pending()).toBe(2);
    await store.discard(chunkId);
    expect(store.pending()).toBe(1);
    expect(await local.get(chunkId)).toBeNull();
    expect(await index.get(chunkId)).toBeNull();
    expect(await store.flush()).toBe(1);
    expect(await remote.get(chunkId)).toBeNull();
    expect((await store.localChunks('bio')).map((c) => c.chunkId)).toEqual([kept.chunkId]);
  });
});
