// @vitest-environment node
/**
 * The per-thread lock manager (`./threadLocks.ts`) and the guard that the Node Evolu platform never uses Node's
 * process-wide `navigator.locks` (on Node 24.21 that kept every idle person worker awake: docs/wp/E34.md).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvoluSyncStore } from '../../../../src/sync/evolu/adapter.ts';
import { newOwnerSecret } from '../../../../src/sync/pairing.ts';
import { KV_COLLECTION } from '../../../../src/sync/types.ts';
import { createNodeEvoluPlatform } from '../evoluNode.ts';
import { createThreadLockManager } from './threadLocks.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createThreadLockManager', () => {
  it('grants an exclusive lock to one holder at a time, in request order', async () => {
    const m = createThreadLockManager();
    const order: string[] = [];
    let release!: () => void;
    const first = m.request('a', { mode: 'exclusive' }, () => new Promise<void>((r) => (order.push('1 in'), (release = r))));
    const second = m.request('a', () => void order.push('2 in'));
    const third = m.request('a', () => void order.push('3 in'));
    await tick();
    expect(order).toEqual(['1 in']);
    expect((await m.query()).pending.map((l) => l.name)).toEqual(['a', 'a']);
    release();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['1 in', '2 in', '3 in']);
    expect(await m.query()).toEqual({ held: [], pending: [] });
  });

  it('keeps names apart and resolves to what the callback returns', async () => {
    const m = createThreadLockManager();
    let release!: () => void;
    void m.request('a', () => new Promise<void>((r) => (release = r)));
    expect(await m.request('b', () => 42)).toBe(42);
    release();
  });

  it('an aborted wait rejects and leaves the queue; the holder is unaffected', async () => {
    const m = createThreadLockManager();
    let release!: () => void;
    const held = m.request('leader', () => new Promise<void>((r) => (release = r)));
    const ac = new AbortController();
    const cb = vi.fn();
    const waiting = m.request('leader', { mode: 'exclusive', signal: ac.signal }, cb);
    ac.abort();
    await expect(waiting).rejects.toBeTruthy();
    expect((await m.query()).pending).toEqual([]);
    release();
    await held;
    expect(cb).not.toHaveBeenCalled();
    // an already aborted signal never queues
    await expect(m.request('leader', { signal: ac.signal }, cb)).rejects.toBeTruthy();
  });

  it('a callback that throws releases the lock', async () => {
    const m = createThreadLockManager();
    await expect(m.request('a', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await m.request('a', () => 'next')).toBe('next');
  });

  it('shared holders run together; an exclusive request waits for them, and ifAvailable answers null at once', async () => {
    const m = createThreadLockManager();
    const ends: Array<() => void> = [];
    const s1 = m.request('s', { mode: 'shared' }, () => new Promise<void>((r) => ends.push(r)));
    const s2 = m.request('s', { mode: 'shared' }, () => new Promise<void>((r) => ends.push(r)));
    await tick();
    expect(ends).toHaveLength(2);
    expect(await m.request('s', { ifAvailable: true }, (l) => l)).toBeNull();
    let got = false;
    const ex = m.request('s', () => void (got = true));
    ends[0]!();
    await tick();
    expect(got).toBe(false);
    ends[1]!();
    await Promise.all([s1, s2, ex]);
    expect(got).toBe(true);
  });
});

describe('Node Evolu platform', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('opens, writes and reads a store without touching navigator.locks', async () => {
    const request = vi.spyOn(navigator.locks, 'request');
    const query = vi.spyOn(navigator.locks, 'query');
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'thread-locks-'));
    dirs.push(dir);
    const store = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'L' }), appName: 'vitalsL' });
    await store.open({ secret: newOwnerSecret(), relayUrl: null, deviceId: 'DEVICEL', memoryOnly: false });
    await store.put(KV_COLLECTION, 'vitals.settings', { state: { units: 'metric' }, version: 3 }, { schema: 3 });
    expect((await store.get(KV_COLLECTION, 'vitals.settings'))?.value).toMatchObject({ state: { units: 'metric' } });
    await store.close();
    expect(request).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  }, 60_000);
});
