import { describe, expect, it } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '..';
import { conformanceCases, sealedCases } from './conformance';

describe('DocumentStore conformance · memory backend', () => {
  conformanceCases(() => {
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    return {
      store: createDocumentStore({ backend, device: 'TESTDEVICE000001', strict: 'strict' }),
      remote: ({ col, id, value, rev }) =>
        backend.remote({ _id: id, _col: col, _schema: 1, _rev: rev, _device: 'REMOTEDEVICE0001', _created: '2026-10-01T00:00:00.000Z', _updated: '2026-10-01T00:00:01.000Z', value }),
    };
  });
  sealedCases((encryptor) => ({ store: createDocumentStore({ backend: createMemoryBackend(), strict: 'strict', encryptor }) }));

  it('runs migration hooks on read for documents of an older schema', async () => {
    const backend = createMemoryBackend();
    await backend.put('intake', 'me', { answeredAt: {}, questionSetVersion: {}, legacy: 1 }, { schema: 1 });
    const store = createDocumentStore({
      backend,
      strict: 'strict',
      migrations: { intake: { version: 2, migrate: (b) => ({ ...b, migrated: true, legacy: undefined }) } },
    });
    const d = await store.get<Record<string, unknown>>('intake', 'me');
    expect(d).toMatchObject({ _schema: 2, migrated: true });
    // the next write stores the new schema version
    await store.transact(mintWriteToken('migration'), (tx) => tx.patch('intake', 'me', { touched: true }));
    expect((await backend.get('intake', 'me'))!._schema).toBe(2);
  });

  it('keeps concurrent losers in history (last writer wins by revision)', async () => {
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    const store = createDocumentStore({ backend, strict: 'strict' });
    await store.transact(mintWriteToken('command'), (tx) => tx.put('settings', { _id: 'me', units: 'metric' }));
    backend.remote({ _id: 'me', _col: 'settings', _schema: 1, _rev: '0000000000001-0000-OLDDEVICE0000001', _device: 'OLD', _created: '', _updated: '', value: { units: 'imperial' } });
    expect((await store.get<{ units: string }>('settings', 'me'))!.units).toBe('metric');
    backend.remote({ _id: 'me', _col: 'settings', _schema: 1, _rev: '9999999999999-0000-NEWDEVICE0000001', _device: 'NEW', _created: '', _updated: '', value: { units: 'imperial' } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.get<{ units: string }>('settings', 'me'))!.units).toBe('imperial');
    const h = await store.history!<{ units: string }>('settings', 'me', 5);
    expect(h[0]!.doc.units).toBe('metric');
  });

  it('still opens when one sealed document cannot be decrypted or one migration throws', async () => {
    const backend = createMemoryBackend({ device: 'D1' });
    await backend.put('secrets', 'a', { $sealed: 'AAAA' }, { schema: 1 });
    await backend.put('profile', 'me', { weightKg: 70 }, { schema: 1 });
    await backend.put('goals', 'me', { horizonDays: 56 }, { schema: 1 });
    const store = createDocumentStore({
      backend,
      device: 'D1',
      validation: 'off',
      encryptor: { seal: async (p) => p, open: async () => Promise.reject(new Error('wrong key')) },
      migrations: { profile: { version: 2, migrate: () => { throw new Error('bad shape'); } } },
    });
    await store.ready;
    expect(store.peek('secrets', 'a')).toBeNull();
    expect(store.peek('profile', 'me')).toMatchObject({ weightKg: 70, _schema: 1 });
    expect(store.peek('goals', 'me')).toMatchObject({ horizonDays: 56 });
  });

  it('applies remote changes of one document in arrival order even when decrypting takes different times', async () => {
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    const delays = [30, 0];
    const encryptor = {
      seal: async (p: Uint8Array) => p,
      open: async (p: Uint8Array) => {
        await new Promise((r) => setTimeout(r, delays.shift() ?? 0));
        return p;
      },
    };
    const store = createDocumentStore({ backend, strict: 'strict', encryptor });
    await store.ready;
    const sealed = (v: unknown) => ({ $sealed: btoa(JSON.stringify(v)) });
    const row = (rev: string, v: unknown) => ({ _id: 'k', _col: 'providerKeys', _schema: 1, _rev: rev, _device: 'R', _created: '', _updated: '', value: sealed(v) });
    backend.remote(row('0000000000001-0000-REMOTEDEVICE001', { presetId: 'k', n: 1 }));
    backend.remote(row('0000000000002-0000-REMOTEDEVICE001', { presetId: 'k', n: 2 }));
    await new Promise((r) => setTimeout(r, 60));
    expect(store.peek<{ n: number }>('providerKeys', 'k')!.n).toBe(2);
  });
});

