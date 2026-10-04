import { describe, expect, it } from 'vitest';
import { createFakeIndexedDb } from '../../../tests/fakeIndexedDb';
import { copyStore, createDocumentStore, createIdbBackend, createMemoryBackend, mintWriteToken } from '..';
import { conformanceCases, sealedCases } from './conformance';

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
