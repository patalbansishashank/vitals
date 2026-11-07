import { afterEach, expect, it, vi } from 'vitest';
import type { MemoryBackend } from '@/store';

const A = '01J0000000000000000000000A';
const B = '01J0000000000000000000000B';
const C = '01J0000000000000000000000C';
const log = (id: string, steps: number) => ({ _id: id, date: '2026-10-31', kind: 'steps', source: { by: 'user' }, steps });
const file = () => ({ vitalsVersion: '2', stores: {
  'vitals.notes': { version: null, state: 'imported notes' },
  'vitals.settings': { version: 3, state: { units: 'metric' } },
}, collections: { dailyLogs: [log(A, 100), log(C, 300)] } });
const mirrors = () => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

async function open(backend?: MemoryBackend) {
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  const be = backend ?? store.createMemoryBackend();
  const docs = store.createDocumentStore({ backend: be });
  runtime.setDocumentStore(docs);
  await runtime.bootDocuments();
  const persistence = await import('@/state/persistence');
  const settings = (await import('@/state/settingsStore')).useSettingsStore;
  const scope = await import('@/state/scope');
  return { store, runtime, backend: be, docs, persistence, settings, scope };
}
async function populated() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
  localStorage.clear();
  const t = await open();
  await t.docs.transact(t.store.mintWriteToken('command'), async tx => {
    await tx.append('dailyLogs', log(A, 10));
    await tx.append('dailyLogs', log(B, 20));
  });
  t.scope.withSystemWrite(() => t.settings.setState({ units: 'imperial' }));
  await t.runtime.settleUnscopedWrites();
  localStorage.setItem('vitals.notes', 'original notes');
  localStorage.setItem('vitals.removed', 'old key');
  localStorage.setItem('vitals.gaugeImport.v1', JSON.stringify({ identity: 'synthetic', backfilled: true, lastDate: '2026-10-31', lastImportAt: '2026-10-31T08:00:00Z' }));
  for (const b of (await import('@/state/bridge')).getBindings()) b.apply(b.snapshot(), 'sync');
  t.persistence.exportAll(); // flush debounced mirrors before taking any before snapshot
  return t;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

it('replaces overlapping append-only IDs, adds new IDs, removes absent IDs and keeps ordinary append protection', async () => {
  const t = await populated();
  const seen: number[][] = [];
  const off = t.docs.subscribe(() => seen.push(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)));
  const result = await t.persistence.importAll(file(), 'replace');
  off();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(steps => JSON.stringify(steps) === '[100,300]')).toBe(true);
  expect(result.written).toContain('vitals.dailyLogs');
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => [d._id, d.steps])).toEqual([[A, 100], [C, 300]]);
  expect(t.docs.peekAll('dailyLogs', { includeDeleted: true }).find(d => d._id === B)?._deleted).toBe(true);
  expect(t.settings.getState().units).toBe('metric');
  expect(localStorage.getItem('vitals.notes')).toBe('imported notes');
  expect(localStorage.getItem('vitals.removed')).toBeNull();
  const backup = t.docs.peek<{ before: { dailyLogs: Array<{ steps: number }> }; mirrors: Record<string, string> }>('syncState', 'restore')!;
  expect(backup.before.dailyLogs.map(d => d.steps)).toEqual([10, 20]);
  expect(backup.mirrors['vitals.notes']).toBe('original notes');
  await expect(t.docs.transact(t.store.mintWriteToken('command'), tx => tx.put('dailyLogs', log(A, 999)))).rejects.toThrow('append-only');
});

it('resets absent projections to defaults instead of carrying old profile values into the restored snapshot', async () => {
  const t = await populated();
  const profile = (await import('@/state/profileStore')).useProfileStore;
  t.scope.withSystemWrite(() => profile.setState({ weightKg: 88, heightCm: 180 }));
  await t.runtime.settleUnscopedWrites();
  await t.persistence.importAll(file(), 'replace');
  expect(profile.getState().weightKg).toBeNull();
  expect(profile.getState().heightCm).toBeNull();
  expect(t.docs.peek('profile', 'me')).toMatchObject({ weightKg: null, heightCm: null });
});

it('leaves documents, mirrors and projections unchanged when the backend batch fails', async () => {
  const t = await populated();
  const before = mirrors();
  const batch = t.backend.batch!.bind(t.backend);
  t.backend.batch = async ops => {
    if (ops.some(op => op.col === 'syncState' && op.id === 'restore')) throw new Error('synthetic backend failure');
    return batch(ops);
  };
  await expect(t.persistence.importAll(file(), 'replace')).rejects.toThrow('synthetic backend failure');
  expect(mirrors()).toEqual(before);
  expect(t.settings.getState().units).toBe('imperial');
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
  expect(t.docs.peek('syncState', 'restore')).toBeNull();
});

it('rolls back already written mirrors when a later localStorage key hits quota', async () => {
  const t = await populated();
  const before = mirrors();
  const setItem = Storage.prototype.setItem;
  let failed = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (!failed && key === 'vitals.settings' && value.includes('metric')) { failed = true; throw new DOMException('full', 'QuotaExceededError'); }
    return setItem.call(this, key, value);
  });
  await expect(t.persistence.importAll(file(), 'replace')).rejects.toThrow('full');
  expect(failed).toBe(true);
  expect(mirrors()).toEqual(before);
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
  expect(t.settings.getState().units).toBe('imperial');
});

it('rejects unserializable and invalid document snapshots before any mutation', async () => {
  const t = await populated();
  const before = mirrors();
  const malformed = file();
  malformed.collections.dailyLogs[0]!._id = 'not-an-id';
  await expect(t.persistence.importAll(malformed, 'replace')).rejects.toThrow('invalid');
  await expect(t.persistence.importAll({ ...file(), collections: { dailyLogs: [null] } }, 'replace')).rejects.toThrow('damaged dailyLogs');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await expect(t.persistence.importAll({ vitalsVersion: '2', stores: { 'vitals.raw': { state: cyclic } } }, 'replace')).rejects.toThrow();
  expect(mirrors()).toEqual(before);
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
});

it('rejects paired replacement without mutation while Merge remains available', async () => {
  const t = await populated();
  t.runtime.setSyncPairedHint(true);
  const before = mirrors();
  await expect(t.persistence.importAll(file(), 'replace')).rejects.toThrow('Disconnect document sync');
  expect(mirrors()).toEqual(before);
  await t.persistence.importAll(file(), 'merge');
  await t.runtime.settleUnscopedWrites();
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => [d._id, d.steps])).toEqual([[A, 10], [B, 20], [C, 300]]);
  expect(t.settings.getState().units).toBe('imperial');
  expect(t.runtime.syncPairedHint()).toBe(true);
});

it('recovers the old mirrors after a restart before the document transaction committed', async () => {
  const t = await populated();
  const before = mirrors();
  const journal = await import('@/state/restoreJournal');
  const pending = { id: 'synthetic-before-commit', before: Object.fromEntries(t.persistence.listStoredKeys().map(k => [k, localStorage.getItem(k)!])), after: { 'vitals.notes': 'uncommitted notes' } };
  localStorage.setItem(journal.RESTORE_JOURNAL_KEY, JSON.stringify(pending));
  journal.applyRestoreMirrors(pending, 'after');
  const reopened = await open(t.backend);
  expect(mirrors()).toEqual(before);
  expect(reopened.settings.getState().units).toBe('imperial');
  expect(reopened.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
});

it('recovers the committed snapshot after restart if journal cleanup was interrupted', async () => {
  const t = await populated();
  const key = (await import('@/state/restoreJournal')).RESTORE_JOURNAL_KEY;
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k) {
    if (k === key) throw new Error('interrupted cleanup');
    return remove.call(this, k);
  });
  await t.persistence.importAll(file(), 'replace');
  expect(localStorage.getItem(key)).not.toBeNull();
  vi.restoreAllMocks();
  const reopened = await open(t.backend);
  expect(reopened.docs.peekAll<{ steps: number }>('dailyLogs').map(d => [d._id, d.steps])).toEqual([[A, 100], [C, 300]]);
  expect(reopened.settings.getState().units).toBe('metric');
  expect(localStorage.getItem('vitals.notes')).toBe('imported notes');
  expect(localStorage.getItem('vitals.removed')).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
});

it('rejects old async command and system scopes after a successful restore', async () => {
  const t = await populated();
  const { defineCommand, dispatch } = await import('@/commands');
  const { T } = await import('@/commands/schema');
  const wait = deferred();
  defineCommand({ id: 'settings.restoreLate', version: 1, title: 'Synthetic late edit', description: '', input: T.Object({}), output: T.Null(), perm: 'write', impact: 'low', surfaces: ['ui'], undo: { kind: 'none' }, idempotency: 'none', sideEffects: ['docs'], execute: async ctx => {
    await wait.promise;
    ctx.write(() => t.settings.setState({ units: 'imperial' }));
    return null;
  } });
  const oldScope = t.scope.createScope('system');
  const late = dispatch('settings.restoreLate', {});
  await t.persistence.importAll(file(), 'replace');
  wait.resolve();
  expect(await late).toMatchObject({ ok: false, error: { code: 'precondition_failed' } });
  expect(() => t.scope.runInScope(oldScope, () => t.settings.setState({ units: 'imperial' }))).toThrow('data was replaced');
  expect(t.settings.getState().units).toBe('metric');
});

it('blocks fresh writes during restore and rejects document work queued against the old snapshot', async () => {
  const t = await populated();
  const entered = deferred();
  const finish = deferred();
  const batch = t.backend.batch!.bind(t.backend);
  t.backend.batch = async ops => {
    if (ops.some(op => op.col === 'syncState' && op.id === 'restore')) { entered.resolve(); await finish.promise; }
    return batch(ops);
  };
  const restoring = t.persistence.importAll(file(), 'replace');
  await entered.promise;
  expect(() => t.scope.withSystemWrite(() => t.settings.setState({ units: 'imperial', energyUnit: 'kJ' }))).toThrow('import is in progress');
  const queued = t.docs.transact(t.store.mintWriteToken('command'), tx => tx.put('settings', { _id: 'me', units: 'imperial' }));
  const rejected = expect(queued).rejects.toThrow('data was replaced');
  finish.resolve();
  await restoring;
  await rejected;
  expect(t.settings.getState().units).toBe('metric');
  expect(t.docs.peek('settings', 'me')).toMatchObject({ units: 'metric' });
});

it('restores original mirrors under a persistent byte quota after an oversized replacement fails', async () => {
  const t = await populated();
  localStorage.setItem('vitals.earlyLarge', 'a'.repeat(1000));
  localStorage.setItem('vitals.lateSmall', 'b');
  const before = mirrors();
  const setItem = Storage.prototype.setItem;
  let cap = Infinity;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    const current = Object.fromEntries(Object.keys(this).map(k => [k, this.getItem(k)!]));
    const size = (values: Record<string, string>) => Object.entries(values).reduce((n, [k, v]) => n + k.length + v.length, 0);
    if (size({ ...current, [key]: value }) > cap) throw new DOMException('persistent quota', 'QuotaExceededError');
    setItem.call(this, key, value);
    // The recovery journal fits; the replacement's much larger values do not.
    if (key === 'vitals.restore.pending') cap = size({ ...current, [key]: value }) + 100;
  });
  const incoming = file();
  Object.assign(incoming.stores, {
    'vitals.earlyLarge': { version: null, state: 'a' },
    'vitals.lateSmall': { version: null, state: 'b'.repeat(50_000) },
  });
  await expect(t.persistence.importAll(incoming, 'replace')).rejects.toThrow('persistent quota');
  expect(mirrors()).toEqual(before);
  expect(t.settings.getState().units).toBe('imperial');
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
});

it('refuses destructive import and erase dry runs without changing documents or mirrors', async () => {
  const t = await populated();
  const { dispatch } = await import('@/commands');
  const before = mirrors();
  const options = { actor: { kind: 'system' as const, id: 'synthetic-dry-run' }, dryRun: true };
  expect(await dispatch('data.import', { file: file(), mode: 'replace' }, options)).toMatchObject({ ok: false, error: { code: 'precondition_failed' } });
  expect(await dispatch('data.eraseAll', {}, options)).toMatchObject({ ok: false, error: { code: 'precondition_failed' } });
  expect(mirrors()).toEqual(before);
  expect(t.settings.getState().units).toBe('imperial');
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
});

it('does not continue destructive import or erase after dispatchSync cancels their asynchronous executors', async () => {
  const t = await populated();
  const { dispatchSync, settleCommits } = await import('@/commands');
  const before = mirrors();
  const options = { actor: { kind: 'system' as const, id: 'synthetic-sync-dispatch' } };
  expect(() => dispatchSync('data.import', { file: file(), mode: 'replace' }, options)).toThrow('use dispatch');
  expect(() => dispatchSync('data.eraseAll', {}, options)).toThrow('use dispatch');
  await settleCommits();
  await t.runtime.settleUnscopedWrites();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(mirrors()).toEqual(before);
  expect(t.docs.peekAll<{ steps: number }>('dailyLogs').map(d => d.steps)).toEqual([10, 20]);
});

it('resets the ring import cursor and rejects an old in-flight completion without changing server pairing', async () => {
  const t = await populated();
  const gauge = await import('@/state/gaugeImport');
  const fetching = deferred();
  const release = deferred();
  const importer = vi.fn(async () => ({ created: [], skipped: [] }));
  localStorage.setItem('vitals.server.v1', 'synthetic pairing retained');
  const api = {
    activity: async () => { fetching.resolve(); await release.promise; return { days: [] }; },
    sleep: async () => ({ sessions: [] }),
    status: () => ({ problem: null }),
  };
  const running = gauge.runGaugeImport({ api: api as never, enabled: () => true, today: () => '2026-10-31', now: () => Date.now(), storage: localStorage, identity: () => 'synthetic', importer });
  await fetching.promise;
  await t.persistence.importAll(file(), 'replace');
  expect(localStorage.getItem(gauge.GAUGE_IMPORT_KEY)).toBeNull();
  expect(localStorage.getItem('vitals.server.v1')).toBe('synthetic pairing retained');
  release.resolve();
  expect(await running).toEqual({ ran: false, reason: 'data_replaced' });
  expect(importer).not.toHaveBeenCalled();
  expect(localStorage.getItem(gauge.GAUGE_IMPORT_KEY)).toBeNull();
  expect(gauge.importWindow(gauge.readGaugeImportState(localStorage, 'synthetic'), '2026-10-31').from).toBe('2026-10-02');
});

it.each([false, true])('settles a command completing during paused restore without replaying stale writes (backend fails: %s)', async (failBackend) => {
  const t = await populated();
  const { defineCommand, dispatch } = await import('@/commands');
  const { T } = await import('@/commands/schema');
  const staged = deferred();
  const finishCommand = deferred();
  defineCommand({ id: 'settings.restorePending', version: 1, title: 'Synthetic pending edit', description: '', input: T.Object({}), output: T.Null(), perm: 'write', impact: 'low', surfaces: ['ui'], undo: { kind: 'none' }, idempotency: 'none', sideEffects: ['docs'], execute: async ctx => {
    await ctx.docs.patch('settings', 'me', { energyUnit: 'kJ' });
    staged.resolve();
    await finishCommand.promise;
    return null;
  } });
  let commandDone = false;
  const command = dispatch('settings.restorePending', {}).finally(() => { commandDone = true; });
  await staged.promise;
  const entered = deferred();
  const finishRestore = deferred();
  const batch = t.backend.batch!.bind(t.backend);
  t.backend.batch = async ops => {
    if (ops.some(op => op.col === 'syncState' && op.id === 'restore')) {
      entered.resolve(); await finishRestore.promise;
      if (failBackend) throw new Error('restore failed');
    }
    return batch(ops);
  };
  const restoring = t.persistence.importAll(file(), 'replace');
  const restoreResult = failBackend ? expect(restoring).rejects.toThrow('restore failed') : restoring;
  await entered.promise;
  finishCommand.resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(commandDone).toBe(false);
  finishRestore.resolve();
  await restoreResult;
  expect(await command).toMatchObject(failBackend ? { ok: true } : { ok: false, error: { code: 'precondition_failed' } });
  expect(t.docs.peek('settings', 'me')).toMatchObject({ energyUnit: failBackend ? 'kJ' : 'kcal' });
});

it('restores bound documents when a v2 file has only a partial legacy stores section', async () => {
  const t = await populated();
  const incoming = file();
  const profile = { ...t.docs.peek('profile', 'me')!, weightKg: 65, heightCm: 168 };
  await t.persistence.importAll({ ...incoming, collections: { ...incoming.collections, profile: [profile] } }, 'replace');
  expect((await import('@/state/profileStore')).useProfileStore.getState().weightKg).toBe(65);
  expect(t.docs.peek('profile', 'me')).toMatchObject({ weightKg: 65, heightCm: 168 });
});

it('reads pre-import mirrors during pending recovery without rewriting another window’s active journal', async () => {
  const t = await populated();
  const { readMirror } = await import('@/state/bridge');
  const journal = await import('@/state/restoreJournal');
  const before = { 'vitals.settings': localStorage.getItem('vitals.settings')! };
  const after = { 'vitals.settings': JSON.stringify({ state: { units: 'metric' }, version: 3 }) };
  const pending = { id: 'synthetic-active-other-window', before, after };
  localStorage.setItem(journal.RESTORE_JOURNAL_KEY, JSON.stringify(pending));
  journal.applyRestoreMirrors(pending, 'after');
  expect(readMirror('vitals.settings')?.state).toMatchObject({ units: 'imperial' });
  expect(localStorage.getItem('vitals.settings')).toBe(after['vitals.settings']);
  expect(localStorage.getItem(journal.RESTORE_JOURNAL_KEY)).toBe(JSON.stringify(pending));
  expect(t.docs.peek('settings', 'me')).toMatchObject({ units: 'imperial' });
});

it('keeps an invalidated window from uploading stale fusion context or starting another import', async () => {
  await populated();
  const gauge = await import('@/state/gaugeImport');
  const barrier = await import('@/state/writeBarrier');
  const hold = deferred();
  const fusionContext = vi.fn(async () => ({}));
  const pending = gauge.syncFusionContext({
    api: { fusionContext } as never, today: () => '2026-10-31', enabled: () => true,
    stepsContext: async () => { await hold.promise; return { activities: [], corrections: [], preference: { stepsPreference: ['ring', 'phone'], soleSustainedGait: true }, headline: 'atLeast' } as never; },
  });
  barrier.invalidateExternalRestore();
  hold.resolve();
  expect(await pending).toBe(false);
  expect(fusionContext).not.toHaveBeenCalled();
  expect(await gauge.runGaugeImport()).toEqual({ ran: false, reason: 'data_replaced' });
});
