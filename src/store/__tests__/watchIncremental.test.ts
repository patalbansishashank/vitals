/**
 * D13 (docs/review/V1-store-sync.md): query watchers update incrementally. A change re-evaluates only the changed id
 * and clones only changed documents; results must equal a fresh `query` after every write.
 */
import { describe, expect, it, vi } from 'vitest';

const clones = vi.hoisted(() => ({ n: 0 }));
vi.mock('../json', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../json')>();
  return {
    ...actual,
    jsonClone: <T>(x: T): T => {
      clones.n++;
      return actual.jsonClone(x);
    },
  };
});

import { createDocumentStore, createMemoryBackend, mintWriteToken } from '..';
import type { Doc, Query } from '../types';

type Job = { kind: string; state: string; n: number };
const token = () => mintWriteToken('command', { label: 'test' });

function setup() {
  const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
  const store = createDocumentStore({ backend, device: 'TESTDEVICE000001', strict: 'strict', validation: 'off' });
  return { backend, store };
}

function latest<T>(store: ReturnType<typeof setup>['store'], q: Query) {
  const box: { docs: Doc<T>[] | null; calls: number } = { docs: null, calls: 0 };
  const off = store.watch<T>('jobs', q, (docs) => {
    box.docs = docs;
    box.calls++;
  });
  return { box, off };
}

describe('DocumentStore.watch · incremental queries (D13)', () => {
  it('moves documents in and out of a range, keeps sort order, limit and reverse', async () => {
    const { store } = setup();
    await store.ready;
    const ranged = latest<Job>(store, { index: 'n', range: { lower: 3, upper: 7 } });
    const top = latest<Job>(store, { index: 'n', limit: 2 });
    const bottom = latest<Job>(store, { index: 'n', reverse: true, limit: 2 });
    await Promise.resolve();
    const ids = (docs: Doc<Job>[] | null) => (docs ?? []).map((d) => d._id);
    await store.transact(token(), async (tx) => {
      for (const [id, n] of [['a', 1], ['b', 5], ['c', 9], ['d', 4]] as const) await tx.put('jobs', { _id: id, kind: 'k', state: 's', n });
    });
    expect(ids(ranged.box.docs)).toEqual(['d', 'b']);
    expect(ids(top.box.docs)).toEqual(['a', 'd']);
    expect(ids(bottom.box.docs)).toEqual(['c', 'b']);
    // move a into the range (it sorts first), c out of the top end
    await store.transact(token(), (tx) => tx.patch('jobs', 'a', { n: 6 }));
    expect(ids(ranged.box.docs)).toEqual(['d', 'b', 'a']);
    expect(ids(top.box.docs)).toEqual(['d', 'b']);
    // move b out of the range
    await store.transact(token(), (tx) => tx.patch('jobs', 'b', { n: 100 }));
    expect(ids(ranged.box.docs)).toEqual(['d', 'a']);
    expect(ids(bottom.box.docs)).toEqual(['b', 'c']);
    // delete d
    await store.transact(token(), (tx) => tx.remove('jobs', 'd'));
    expect(ids(ranged.box.docs)).toEqual(['a']);
    expect(ids(top.box.docs)).toEqual(['a', 'c']);
    // a change that matches neither before nor after does not notify
    const calls = ranged.box.calls;
    await store.transact(token(), (tx) => tx.patch('jobs', 'c', { n: 50 }));
    expect(ranged.box.calls).toBe(calls);
    // a change that keeps membership but changes the body notifies with the new body, other docs keep their clone
    const before = ranged.box.docs!;
    await store.transact(token(), (tx) => tx.put('jobs', { _id: 'e', kind: 'k', state: 's', n: 7 }));
    expect(ids(ranged.box.docs)).toEqual(['a', 'e']);
    expect(ranged.box.docs![0]).toBe(before[0]);
    expect(ranged.box.docs).not.toBe(before);
    for (const w of [ranged, top, bottom]) w.off();
  });

  it('matches a fresh query after every random write (puts, patches, deletes, batches, remote changes)', async () => {
    const { backend, store } = setup();
    await store.ready;
    const queries: Query[] = [
      {},
      { includeDeleted: true },
      { index: 'n', range: { lower: 3, upper: 7 } },
      { index: 'n', limit: 5 },
      { index: 'n', reverse: true, limit: 4 },
      { index: 'state,n', includeDeleted: true, range: { lower: ['b'], upper: ['c', 5] } },
      { index: 'kind', reverse: true },
      { limit: 0 },
    ];
    const watchers = queries.map((q) => ({ q, ...latest<Job>(store, q) }));
    let seed = 12345;
    const rnd = (k: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % k;
    };
    const id = () => `j${rnd(30)}`;
    const body = () => ({ kind: `k${rnd(4)}`, state: ['a', 'b', 'c'][rnd(3)]!, n: rnd(10) });
    for (let step = 0; step < 300; step++) {
      const r = rnd(10);
      if (r < 6) {
        await store.transact(token(), async (tx) => {
          const count = 1 + rnd(3); // batches of 1–3 ops
          for (let i = 0; i < count; i++) {
            const op = rnd(3);
            const target = id();
            if (op === 0) await tx.put('jobs', { _id: target, ...body() });
            else if (op === 1) await tx.patch('jobs', target, { n: rnd(10) });
            else await tx.remove('jobs', target);
          }
        });
      } else {
        const target = id();
        backend.remote({ _id: target, _col: 'jobs', _schema: 1, _rev: `r${step}`, _device: 'REMOTEDEVICE0001', _created: '2026-10-01T00:00:00.000Z', _updated: '2026-10-01T00:00:01.000Z', _deleted: rnd(4) === 0 ? true : undefined, value: body() } as never);
        await new Promise((res) => setTimeout(res, 0));
      }
      for (const w of watchers) expect(w.box.docs, `step ${step} ${JSON.stringify(w.q)}`).toEqual(await store.query('jobs', w.q));
    }
    for (const w of watchers) w.off();
  });

  it('rebuilds from the cache after an erase', async () => {
    const { store } = setup();
    await store.ready;
    const w = latest<Job>(store, {});
    const one = latest<Job>(store, { id: 'a' } as never);
    await store.transact(token(), async (tx) => {
      await tx.put('jobs', { _id: 'a', kind: 'k', state: 's', n: 1 });
      await tx.put('jobs', { _id: 'b', kind: 'k', state: 's', n: 2 });
    });
    expect(w.box.docs!.map((d) => d._id)).toEqual(['a', 'b']);
    expect(one.box.docs!.map((d) => d._id)).toEqual(['a']);
    await store.erase();
    await store.transact(token(), (tx) => tx.put('jobs', { _id: 'c', kind: 'k', state: 's', n: 3 }));
    expect(w.box.docs!.map((d) => d._id)).toEqual(['c']);
    expect(one.box.docs).toEqual([]);
    w.off();
    one.off();
  });

  it('clones only changed documents: 100 writes with one query watcher on 5,000 documents', async () => {
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    for (let i = 0; i < 5000; i++)
      await backend.put('jobs', `j${String(i).padStart(5, '0')}`, { kind: 'k', state: 's', n: i, pad: 'x'.repeat(200) }, { schema: 1 });
    const store = createDocumentStore({ backend, device: 'TESTDEVICE000001', strict: 'strict', validation: 'off' });
    await store.ready;
    let calls = 0;
    let lastLen = 0;
    const off = store.watch<Job>('jobs', { index: 'n' }, (docs) => {
      calls++;
      lastLen = docs.length;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(lastLen).toBe(5000);
    const start = clones.n;
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) await store.transact(token(), (tx) => tx.patch('jobs', `j${String(i * 37).padStart(5, '0')}`, { n: 10_000 + i }));
    const ms = performance.now() - t0;
    const perWrite = (clones.n - start) / 100;
    // the old watcher cloned the whole collection on every write (≥ 5,000 clones per write)
    expect(perWrite).toBeLessThan(20);
    expect(calls).toBe(101);
    expect(lastLen).toBe(5000);
    console.info(`D13: 100 writes, 5,000 docs, one query watcher: ${ms.toFixed(0)} ms, ${perWrite} clones per write`);
    off();
  }, 60_000);
});
