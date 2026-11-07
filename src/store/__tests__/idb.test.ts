import { describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDb } from '../../../tests/fakeIndexedDb';
import { copyStore, createDocumentStore, createIdbBackend, createMemoryBackend, mintWriteToken } from '..';
import { backendAtomicityCases, conformanceCases, sealedCases, snapshotRestoreCases } from './conformance';

describe('DocumentStore conformance · IndexedDB backend', () => {
  conformanceCases(() => {
    const idb = createFakeIndexedDb();
    return { store: createDocumentStore({ backend: createIdbBackend({ factory: idb.factory, device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001', strict: 'strict' }) };
  });
  sealedCases((encryptor) => ({ store: createDocumentStore({ backend: createIdbBackend({ factory: createFakeIndexedDb().factory }), strict: 'strict', encryptor }) }));

  it('persists across reopening, with revision history', async () => {
    const idb = createFakeIndexedDb();
    const a = createDocumentStore({ backend: createIdbBackend({ factory: idb.factory }), strict: 'strict' });
    const t = mintWriteToken('command');
    await a.transact(t, (tx) => tx.put('settings', { _id: 'me', units: 'imperial' }));
    await a.transact(t, (tx) => tx.patch('settings', 'me', { units: 'metric' }));
    await a.close();
    const b = createDocumentStore({ backend: createIdbBackend({ factory: idb.factory }), strict: 'strict' });
    expect((await b.get<{ units: string }>('settings', 'me'))!.units).toBe('metric');
    const h = await b.history!<{ units: string }>('settings', 'me', 5);
    expect(h.map((x) => x.doc.units)).toEqual(['imperial']);
    expect(idb.peek('vitals-docs').docs).toBe(1);
  });

  it('erases the local database', async () => {
    const idb = createFakeIndexedDb();
    const s = createDocumentStore({ backend: createIdbBackend({ factory: idb.factory }), strict: 'strict' });
    await s.transact(mintWriteToken('command'), (tx) => tx.put('settings', { _id: 'me', units: 'imperial' }));
    await s.erase();
    expect(s.peek('settings', 'me')).toBeNull();
    const again = createDocumentStore({ backend: createIdbBackend({ factory: idb.factory }), strict: 'strict' });
    expect(await again.get('settings', 'me')).toBeNull();
  });

  it('copies a store into another engine once (copyStore)', async () => {
    const from = createDocumentStore({ backend: createMemoryBackend(), strict: 'strict' });
    const t = mintWriteToken('command');
    await from.transact(t, async (tx) => {
      await tx.put('settings', { _id: 'me', units: 'imperial' });
      await tx.put('scenarios', { _id: 's1', name: 'A', started: true, schedule: { startDate: '2026-10-05', horizonDays: 7, programs: [{}], days: [] } });
      await tx.append('measurements', { _id: '01J0000000000000000000000A', date: '2026-10-01', metric: 'weightKg', value: 80, source: { by: 'user' } });
    });
    await from.transact(t, (tx) => tx.remove('scenarios', 's1'));
    const to = createDocumentStore({ backend: createIdbBackend({ factory: createFakeIndexedDb().factory }), strict: 'strict' });
    const first = await copyStore(from, to);
    expect(first.skipped).toBe(false);
    expect((await to.get<{ units: string }>('settings', 'me'))!.units).toBe('imperial');
    expect(await to.get('scenarios', 's1')).toBeNull();
    expect((await to.query('scenarios', { includeDeleted: true }))[0]?._deleted).toBe(true);
    expect(await to.get('measurements', '01J0000000000000000000000A')).not.toBeNull();
    expect((await copyStore(from, to)).skipped).toBe(true);
  });
});

describe('IndexedDB connection lifecycle', () => {
  it('invalidates an old backend after external deletion and lets a fresh instance reopen', async () => {
    const idb = createFakeIndexedDb();
    const invalidated = vi.fn();
    const backend = createIdbBackend({ factory: idb.factory, name: 'external-delete', onExternalRestore: invalidated });
    await backend.put('settings', 'me', { units: 'metric' });
    const deleted = idb.factory.deleteDatabase('external-delete');
    await new Promise<void>((resolve, reject) => {
      deleted.onsuccess = () => resolve();
      deleted.onerror = () => reject(deleted.error);
    });
    expect(invalidated).toHaveBeenCalledTimes(1);
    await expect(backend.get('settings', 'me')).rejects.toThrow('Reload Vitals');
    await expect(backend.put('settings', 'me', { units: 'imperial' })).rejects.toThrow('Reload Vitals');
    await expect(backend.erase!()).rejects.toThrow('Reload Vitals');
    await backend.close!();
    await expect(backend.put('settings', 'me', { units: 'imperial' })).rejects.toThrow('Reload Vitals');
    const fresh = createIdbBackend({ factory: idb.factory, name: 'external-delete' });
    expect(await fresh.get('settings', 'me')).toBeNull();
    expect((await fresh.put('settings', 'me', { units: 'metric' })).value).toEqual({ units: 'metric' });
  });

  it('allows explicit close and reopen when the database was not externally invalidated', async () => {
    const backend = createIdbBackend({ factory: createFakeIndexedDb().factory, name: 'explicit-close' });
    await backend.put('settings', 'me', { units: 'metric' });
    await backend.close!();
    expect((await backend.get('settings', 'me'))?.value).toEqual({ units: 'metric' });
    await backend.put('settings', 'me', { units: 'imperial' });
    expect((await backend.get('settings', 'me'))?.value).toEqual({ units: 'imperial' });
  });

  it('retries a rejected open and closes a late success from a blocked request', async () => {
    const idb = createFakeIndexedDb();
    const realOpen = idb.factory.open.bind(idb.factory);
    let first: IDBOpenDBRequest | null = null;
    const open = vi.fn((name: string, version: number) => {
      const request = realOpen(name, version);
      if (!first) {
        first = request;
        queueMicrotask(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      }
      return request;
    });
    const backend = createIdbBackend({ factory: { open } as unknown as IDBFactory, name: 'blocked-retry' });
    await expect(backend.get('settings', 'me')).rejects.toThrow(/blocked/);
    expect(await backend.get('settings', 'me')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((first as IDBOpenDBRequest | null)?.result).toBeTruthy();
    expect((first as unknown as { result: { closed: boolean } }).result.closed).toBe(true);
    expect((await backend.put('settings', 'me', { units: 'metric' })).value).toEqual({ units: 'metric' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('retries after an open request errors', async () => {
    const idb = createFakeIndexedDb();
    const realOpen = idb.factory.open.bind(idb.factory);
    let attempts = 0;
    const factory = {
      open(name: string, version: number) {
        if (++attempts > 1) return realOpen(name, version);
        const request = { error: new Error('open failed'), onerror: null as ((event: Event) => void) | null };
        queueMicrotask(() => request.onerror?.(new Event('error')));
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    const backend = createIdbBackend({ factory, name: 'error-retry' });
    await expect(backend.list('settings')).rejects.toThrow('open failed');
    expect(await backend.list('settings')).toEqual([]);
    expect(attempts).toBe(2);
  });

  it('retries when factory.open throws before returning a request', async () => {
    const idb = createFakeIndexedDb();
    const realOpen = idb.factory.open.bind(idb.factory);
    let attempts = 0;
    const factory = {
      open(name: string, version: number) {
        if (++attempts === 1) throw new DOMException('access denied', 'SecurityError');
        return realOpen(name, version);
      },
    } as unknown as IDBFactory;
    const backend = createIdbBackend({ factory, name: 'sync-throw-retry' });
    await expect(backend.get('settings', 'me')).rejects.toThrow('access denied');
    expect(await backend.get('settings', 'me')).toBeNull();
    expect(attempts).toBe(2);
  });

  it('settles a pending open when close races its success, then reopens', async () => {
    const idb = createFakeIndexedDb();
    const backend = createIdbBackend({ factory: idb.factory, name: 'close-during-open' });
    const reading = backend.list('settings');
    if (!backend.close) throw new Error('The IndexedDB backend must support close');
    const closing = backend.close();
    await expect(reading).rejects.toThrow('IndexedDB open was closed');
    await Promise.race([
      closing,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('close hung on pending open')), 100)),
    ]);
    expect(await backend.list('settings')).toEqual([]);
  });
});

describe('idb backend atomic batches', () => {
  backendAtomicityCases((now) => createIdbBackend({ factory: createFakeIndexedDb().factory, now }));
});

describe('IndexedDB synchronous request failures', () => {
  it('aborts queued writes on DataCloneError without emitting changes', async () => {
    const backend = createIdbBackend({ factory: createFakeIndexedDb().factory });
    await backend.put('settings', 'me', { units: 'metric' });
    const original = await backend.get('settings', 'me');
    const changes: unknown[] = [];
    backend.subscribe((change) => changes.push(change));
    await expect(backend.batch!([
      { kind: 'put', col: 'settings', id: 'me', value: { units: 'imperial' }, schema: 1 },
      { kind: 'put', col: 'uiPrefs', id: 'bad', value: { uncloneable: () => undefined }, schema: 1 },
    ])).rejects.toThrow();
    expect(await backend.get('settings', 'me')).toEqual(original);
    expect(await backend.get('uiPrefs', 'bad')).toBeNull();
    expect(await backend.history!('settings', 'me', 10)).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe('restore epoch fencing', () => {
  it('rejects a stale backend inside its write transaction without relying on notification delivery', async () => {
    const factory = createFakeIndexedDb().factory;
    const restored = createIdbBackend({ factory, name: 'shared-restore' });
    const invalidated = vi.fn();
    const stale = createIdbBackend({ factory, name: 'shared-restore', onExternalRestore: invalidated });
    await restored.put('dailyLogs', 'old', { steps: 10 });
    await stale.get('dailyLogs', 'old'); // pin the pre-restore epoch
    await restored.batch!([
      { kind: 'delete', col: 'dailyLogs', id: 'old' },
      { kind: 'put', col: 'syncState', id: 'restore', value: { id: 'new-restore' }, schema: 1 },
    ]);
    await expect(stale.put('dailyLogs', 'old', { steps: 999 })).rejects.toThrow('Reload Vitals');
    await expect(stale.assertCurrent!()).rejects.toThrow('Reload Vitals');
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect((await restored.get('dailyLogs', 'old'))?._deleted).toBe(true);
    const fresh = createIdbBackend({ factory, name: 'shared-restore' });
    await fresh.put('dailyLogs', 'new', { steps: 20 });
    expect((await fresh.get('dailyLogs', 'new'))?.value).toEqual({ steps: 20 });
  });

  it('reports a newer database version instead of accepting writes', async () => {
    const invalidated = vi.fn();
    const factory = { open: () => {
      const request = { error: new DOMException('newer schema', 'VersionError'), onerror: null as (() => void) | null };
      queueMicrotask(() => request.onerror?.());
      return request;
    } } as unknown as IDBFactory;
    const backend = createIdbBackend({ factory, onExternalRestore: invalidated });
    await expect(backend.get('settings', 'me')).rejects.toMatchObject({ name: 'VersionError' });
    await expect(backend.put('settings', 'me', { units: 'metric' })).rejects.toThrow('Reload Vitals');
    expect(invalidated).toHaveBeenCalledTimes(1);
  });
});

describe('idb backend snapshot restore', () => {
  snapshotRestoreCases(() => createIdbBackend({ factory: createFakeIndexedDb().factory }));
});
