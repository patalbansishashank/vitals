/**
 * Document-store conformance suite (SUITE_SPEC §2.1): the behaviour every engine behind `DocumentStore` must show.
 * Run against the in-memory backend and the IndexedDB backend here; wp/E11 runs it against the Evolu `SyncStore`
 * through the same `PersistenceBackend` seam:
 *
 *   describeConformance('evolu', () => ({ store: createDocumentStore({ backend: evoluStore }), remote: … }));
 */
import { expect, it } from 'vitest';
import { WriteOutsideCommand, mintWriteToken, revokeWriteToken, type DocumentStore, type Encryptor, type StoreChange } from '..';

export interface ConformanceTarget {
  store: DocumentStore;
  /** Inject a document as if merged from another device (optional: backends without a test hook skip those cases). */
  remote?: (doc: { col: string; id: string; value: Record<string, unknown>; rev: string }) => void;
}

const token = () => mintWriteToken('command', { label: 'conformance' });

/** Registers the conformance cases (call inside a `describe`). */
export function conformanceCases(make: () => ConformanceTarget | Promise<ConformanceTarget>): void {
  it('puts, gets and stamps the envelope', async () => {
    const { store } = await make();
    await store.ready;
    const t = token();
    const doc = await store.transact(t, (tx) => tx.put('settings', { _id: 'me', units: 'imperial' }));
    expect(doc).toMatchObject({ _id: 'me', _col: 'settings', units: 'imperial' });
    const got = await store.get<{ units: string }>('settings', 'me');
    expect(got).toMatchObject({ _id: 'me', _col: 'settings', _schema: 1, units: 'imperial', _device: store.device });
    expect(typeof got!._rev).toBe('string');
    const rev1 = got!._rev;
    const created = got!._created;
    await store.transact(t, (tx) => tx.put('settings', { _id: 'me', units: 'metric' }));
    const again = await store.get<{ units: string }>('settings', 'me');
    expect(again!.units).toBe('metric');
    expect(again!._rev).not.toBe(rev1);
    expect(again!._created).toBe(created);
    expect(again!._updated >= created).toBe(true);
  });

  it('patches with JSON merge patch (null removes) and creates when absent', async () => {
    const { store } = await make();
    const t = token();
    await store.transact(t, (tx) => tx.patch('uiPrefs', 'me', { a: 1, nested: { x: 1, y: 2 } }));
    await store.transact(t, (tx) => tx.patch('uiPrefs', 'me', { b: 2, nested: { y: null, z: 3 }, a: null }));
    const d = await store.get<Record<string, unknown>>('uiPrefs', 'me');
    expect(d).toMatchObject({ b: 2, nested: { x: 1, z: 3 } });
    expect(d).not.toHaveProperty('a');
    expect((d!.nested as Record<string, unknown>).y).toBeUndefined();
  });

  it('keeps append-only collections append-only', async () => {
    const { store } = await make();
    const t = token();
    const id = '01J0000000000000000000000A';
    const body = { date: '2026-10-01', metric: 'weightKg', value: 80, source: { by: 'user', method: 'typed' } };
    await store.transact(t, (tx) => tx.append('measurements', { _id: id, ...body }));
    await expect(store.transact(t, (tx) => tx.append('measurements', { _id: id, ...body }))).rejects.toThrow(/already exists/);
    await expect(store.transact(t, (tx) => tx.put('measurements', { _id: id, ...body, value: 81 }))).rejects.toThrow(/append-only/);
    await expect(store.transact(t, (tx) => tx.remove('measurements', id))).rejects.toThrow(/append-only/);
    expect((await store.get<{ value: number }>('measurements', id))!.value).toBe(80);
  });

  it('soft-deletes: gone from get and queries, kept for includeDeleted and dump', async () => {
    const { store } = await make();
    const t = token();
    await store.transact(t, async (tx) => {
      await tx.put('scenarios', { _id: 's1', name: 'A', started: true, schedule: { startDate: '2026-10-05', horizonDays: 7, programs: [{}], days: [] } });
      await tx.put('scenarios', { _id: 's2', name: 'B', started: true, schedule: { startDate: '2026-10-05', horizonDays: 7, programs: [{}], days: [] } });
    });
    await store.transact(t, (tx) => tx.remove('scenarios', 's1'));
    expect(await store.get('scenarios', 's1')).toBeNull();
    expect((await store.query('scenarios')).map((d) => d._id)).toEqual(['s2']);
    const all = await store.query('scenarios', { includeDeleted: true });
    expect(all.find((d) => d._id === 's1')?._deleted).toBe(true);
    const dumped: string[] = [];
    for await (const d of store.dump(['scenarios'])) dumped.push(d._id);
    expect(dumped.sort()).toEqual(['s1', 's2']);
  });

  it('refuses writes without a valid token (WriteOutsideCommand)', async () => {
    const { store } = await make();
    expect(() => store.transact({} as never, async (tx) => tx.put('settings', { _id: 'me', units: 'metric' }))).toThrow(WriteOutsideCommand);
    const t = token();
    revokeWriteToken(t);
    expect(() => store.transact(t, async () => undefined)).toThrow(WriteOutsideCommand);
    expect(await store.get('settings', 'me')).toBeNull();
  });

  it('is atomic: a throwing transaction writes nothing', async () => {
    const { store } = await make();
    const t = token();
    await expect(
      store.transact(t, async (tx) => {
        await tx.put('settings', { _id: 'me', units: 'imperial' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.get('settings', 'me')).toBeNull();
  });

  it('validates ids and bodies against the collection', async () => {
    const { store } = await make();
    const t = token();
    await expect(store.transact(t, (tx) => tx.put('profile', { _id: 'you', shape: {} }))).rejects.toThrow(/not a valid profile key/);
    await expect(store.transact(t, (tx) => tx.put('settings', { _id: 'me', units: 'furlongs' }))).rejects.toThrow(/Invalid settings/);
  });

  it('answers index, range, limit and reverse queries', async () => {
    const { store } = await make();
    const t = token();
    const ids = ['01J0000000000000000000000A', '01J0000000000000000000000B', '01J0000000000000000000000C', '01J0000000000000000000000D'];
    const dates = ['2026-10-03', '2026-10-01', '2026-10-04', '2026-10-02'];
    await store.transact(t, async (tx) => {
      for (const [i, id] of ids.entries()) await tx.append('measurements', { _id: id, date: dates[i], metric: i % 2 ? 'waistCm' : 'weightKg', value: i, source: { by: 'user' } });
    });
    const byDate = await store.query<{ date: string }>('measurements', { index: 'date', range: { lower: '2026-10-02', upper: '2026-10-03' } });
    expect(byDate.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03']);
    const compound = await store.query<{ date: string; metric: string }>('measurements', { index: 'metric,date', range: { lower: ['weightKg', ''], upper: ['weightKg', '9999'] } });
    expect(compound.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-04']);
    const last = await store.query<{ date: string }>('measurements', { index: 'date', reverse: true, limit: 1 });
    expect(last.map((d) => d.date)).toEqual(['2026-10-04']);
  });

  it('watches a collection and a document, and stops when unsubscribed', async () => {
    const { store } = await make();
    const t = token();
    const seen: number[] = [];
    const one: Array<string | undefined> = [];
    const off = store.watch('goals', {}, (docs) => seen.push(docs.length));
    const offOne = store.watch<{ strictness: string }>('goals', { id: 'me' }, (docs) => one.push(docs[0]?.strictness));
    await store.ready;
    await new Promise((r) => setTimeout(r, 0));
    await store.transact(t, (tx) => tx.put('goals', { _id: 'me', goals: [], horizonDays: 112, constraints: {}, strictness: 'balanced' }));
    off();
    await store.transact(t, (tx) => tx.patch('goals', 'me', { strictness: 'strict' }));
    offOne();
    expect(seen).toEqual([0, 1]);
    expect(one).toEqual([undefined, 'balanced', 'strict']);
  });

  it('feeds every change in order and keeps a catch-up window', async () => {
    const { store } = await make();
    const t = token();
    const changes: StoreChange[] = [];
    const off = store.subscribe((c) => changes.push(c));
    await store.transact(t, async (tx) => {
      await tx.put('settings', { _id: 'me', units: 'metric' });
      await tx.put('deviceSettings', { _id: 'me', theme: 'dark' });
    });
    off();
    expect(changes.map((c) => `${c.col}/${c.id}:${c.origin}:${c.writer}`)).toEqual(['settings/me:local:command', 'deviceSettings/me:local:command']);
    expect(changes[1]!.seq).toBeGreaterThan(changes[0]!.seq);
    expect(store.changesSince(changes[0]!.seq).map((c) => c.col)).toEqual(['deviceSettings']);
  });

  it('estimates usage per collection and serves synchronous peeks', async () => {
    const { store } = await make();
    const t = token();
    await store.transact(t, (tx) => tx.put('settings', { _id: 'me', units: 'metric' }));
    const est = await store.estimate();
    expect(est.settings?.docs).toBe(1);
    expect(est.settings!.bytes).toBeGreaterThan(0);
    expect(store.peek<{ units: string }>('settings', 'me')?.units).toBe('metric');
    expect(store.peekAll('settings')).toHaveLength(1);
  });

  it('merges remote changes into the cache, the feed and watchers', async () => {
    const target = await make();
    if (!target.remote) return;
    const { store } = target;
    await store.ready;
    const changes: StoreChange[] = [];
    const off = store.subscribe((c) => changes.push(c));
    target.remote({ col: 'settings', id: 'me', value: { units: 'imperial' }, rev: '9999999999999-0000-REMOTEDEVICE0001' });
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect(changes.some((c) => c.col === 'settings' && c.origin === 'remote')).toBe(true);
    expect(store.peek<{ units: string }>('settings', 'me')?.units).toBe('imperial');
  });
}

/** Sealed collections: refuse without the device key, round-trip through it. */
export function sealedCases(make: (encryptor: Encryptor | null) => ConformanceTarget | Promise<ConformanceTarget>): void {
  const xor: Encryptor = {
    seal: async (plain) => plain.map((b) => b ^ 0x5a),
    open: async (sealed) => sealed.map((b) => b ^ 0x5a),
  };
  it('refuses sealed collections without an encryptor', async () => {
    const { store } = await make(null);
    await expect(store.transact(token(), (tx) => tx.put('secrets', { _id: 'openai', key: 'k' }))).rejects.toThrow(/device key/);
  });
  it('seals at rest and opens on read', async () => {
    const { store } = await make(xor);
    await store.transact(token(), (tx) => tx.put('secrets', { _id: 'openai', key: 'sk-test' }));
    expect((await store.get<{ key: string }>('secrets', 'openai'))!.key).toBe('sk-test');
  });
}
