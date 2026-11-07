import { afterEach, expect, it, vi } from 'vitest';
import type { MemoryBackend } from '@/store';
import type { createMemoryHub } from '@/sync/memoryStore';

const OLD = '2026-11-01T08:00:00.000Z';
const NOW = '2026-11-01T12:00:00.000Z';
const A_LAYOUT = ['steps:tile', 'energy:wide'];
const B_LAYOUT = ['sleep:card', 'weight:wide'];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear();
});

async function start(backend?: MemoryBackend, hold?: Promise<void>) {
  vi.resetModules();
  const store = await import('@/store');
  const rt = await import('@/state/runtime');
  const be = backend ?? store.createMemoryBackend();
  rt.setDocumentStore(store.createDocumentStore({ backend: hold ? async () => { await hold; return be; } : be, device: 'TESTDEVICE000001' }));
  const settings = (await import('@/state/settingsStore')).useSettingsStore;
  const commands = await import('@/commands');
  return { backend: be, rt, store, settings, commands, boot: () => rt.bootDocuments(), update: (patch: Record<string, unknown>) => commands.dispatch('settings.update', { patch }, { actor: { kind: 'system', id: 'synthetic-device' } }) };
}

async function legacy(options: { layout?: string[] | null; local?: string[] | null; units?: 'metric' | 'imperial'; mirror?: { todayCards?: string[] | null; units: 'metric' | 'imperial'; at: string; restoreEpoch?: string | null }; uiAt?: string; restoreId?: string } = {}) {
  localStorage.clear(); vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(OLD));
  const { createMemoryBackend } = await import('@/store');
  const { DEFAULT_SETTINGS, SYNCED_SETTING_KEYS } = await import('@/state/internal/settingsModel');
  const backend = createMemoryBackend();
  await backend.put('settings', 'me', { ...Object.fromEntries(SYNCED_SETTING_KEYS.map(key => [key, DEFAULT_SETTINGS[key]])), units: options.units ?? 'metric', todayCards: options.layout ?? A_LAYOUT });
  await backend.put('deviceSettings', 'me', { theme: 'dark' });
  await backend.put('syncState', 'me', { migratedFromLocalStorage: OLD });
  if (options.restoreId) await backend.put('syncState', 'restore', { id: options.restoreId });
  if (options.uiAt) vi.setSystemTime(new Date(options.uiAt));
  await backend.put('uiPrefs', 'me', { bodySetup: 'basics', ...(Object.hasOwn(options, 'local') ? { todayCardsLocalSet: true, ...(options.local === null ? {} : { todayCardsLocal: options.local }) } : {}) });
  if (options.mirror) {
    const { at, restoreEpoch, ...state } = options.mirror;
    localStorage.setItem('vitals.settings', JSON.stringify({ state, at, restoreEpoch: restoreEpoch ?? null, version: 3 }));
  }
  vi.setSystemTime(new Date(NOW));
  return backend;
}

const localLayout = (t: Awaited<ReturnType<typeof start>>) => t.rt.getDocumentStore().peek<{ todayCardsLocalSet: boolean; todayCardsLocal?: string[] }>('uiPrefs', 'me');

it.each([null, [], B_LAYOUT])('preserves the actual saved device mirror once, including %j', async (layout) => {
  const backend = await legacy({ layout: A_LAYOUT, mirror: { todayCards: layout, units: 'imperial', at: '2026-11-01T09:00:00.000Z' } });
  const t = await start(backend); await t.boot();
  expect(t.settings.getState().todayCards).toEqual(layout);
  expect(localLayout(t)).toMatchObject({ todayCardsLocalSet: true });
  expect(localLayout(t)?.todayCardsLocal ?? null).toEqual(layout);
  expect((await backend.get<{ todayCards: string[] }>('settings', 'me'))?.value.todayCards).toEqual(A_LAYOUT);
  expect(t.settings.getState().units).toBe('imperial');
});

it('does not promote an old mirror or a newly written UI migration timestamp over newer shared settings', async () => {
  const backend = await legacy({ units: 'imperial', mirror: { todayCards: B_LAYOUT, units: 'metric', at: '2026-11-01T07:00:00.000Z' } });
  const t = await start(backend); await t.boot();
  expect(t.settings.getState()).toMatchObject({ units: 'imperial', todayCards: B_LAYOUT });
  expect((await backend.get('settings', 'me'))?.value).toMatchObject({ units: 'imperial', todayCards: A_LAYOUT });
});

it('ignores unrelated shared uiPrefs timestamps when choosing newer unsaved settings', async () => {
  const backend = await legacy({ local: B_LAYOUT, uiAt: '2026-11-01T11:00:00.000Z', mirror: { todayCards: A_LAYOUT, units: 'imperial', at: '2026-11-01T09:00:00.000Z' } });
  const t = await start(backend); await t.boot();
  expect(t.settings.getState()).toMatchObject({ units: 'imperial', todayCards: B_LAYOUT });
  expect((await backend.get('settings', 'me'))?.value).toMatchObject({ units: 'imperial', todayCards: A_LAYOUT });
});

it.each([null, [], B_LAYOUT])('keeps an existing local choice %j through legacy updates and a newer legacy mirror on reload', async (layout) => {
  const backend = await legacy({ local: layout, mirror: { todayCards: A_LAYOUT, units: 'metric', at: '2026-11-01T11:00:00.000Z' } });
  const t = await start(backend); await t.boot();
  const prior = await backend.get('settings', 'me');
  backend.remote({ ...prior!, value: { ...prior!.value as object, units: 'imperial', todayCards: ['heart-rate:wide'] }, _rev: '9999999999999-0000-REMOTE', _updated: '2026-11-01T13:00:00.000Z' });
  await new Promise(r => setTimeout(r, 0));
  expect(t.settings.getState()).toMatchObject({ units: 'imperial', todayCards: layout });
  localStorage.setItem('vitals.settings', JSON.stringify({ state: { units: 'imperial', todayCards: ['legacy-new:wide'] }, version: 3, at: '2099-01-01T00:00:00Z' }));
  const reloaded = await start(backend); await reloaded.boot();
  expect(reloaded.settings.getState().todayCards).toEqual(layout);
});

it('waits for stored documents instead of seeding an initial default null', async () => {
  const backend = await legacy(); const hold = deferred();
  const t = await start(backend, hold.promise); const booting = t.boot();
  expect(t.settings.getState().todayCards).toBeNull();
  expect((await backend.get('uiPrefs', 'me'))?.value).not.toHaveProperty('todayCardsLocalSet');
  hold.resolve(); await booting;
  expect(t.settings.getState().todayCards).toEqual(A_LAYOUT);
});

it('does not mistake an unrelated early setting edit for a saved default layout', async () => {
  const backend = await legacy(); const hold = deferred();
  const t = await start(backend, hold.promise); const booting = t.boot();
  const editing = t.update({ units: 'imperial' });
  hold.resolve(); await Promise.all([booting, editing]);
  expect(t.settings.getState()).toMatchObject({ units: 'imperial', todayCards: A_LAYOUT });
});

it('preserves an explicit early null layout edit while document opening is delayed', async () => {
  const backend = await legacy(); const hold = deferred();
  const t = await start(backend, hold.promise); const booting = t.boot();
  const editing = t.update({ todayCards: null });
  hold.resolve(); await Promise.all([booting, editing]);
  expect(t.settings.getState().todayCards).toBeNull();
  expect(localLayout(t)?.todayCardsLocalSet).toBe(true);
  expect(localLayout(t)?.todayCardsLocal).toBeUndefined();
});

it('does not seed from a boot mirror belonging to a pre-restore snapshot', async () => {
  const backend = await legacy({ layout: B_LAYOUT, restoreId: 'restored-snapshot', mirror: { todayCards: A_LAYOUT, units: 'metric', at: '2099-01-01T00:00:00Z', restoreEpoch: 'old-snapshot' } });
  const t = await start(backend); await t.boot();
  expect(t.settings.getState().todayCards).toEqual(B_LAYOUT);
});

it('survives the 0.7.8 full deviceSettings write and field-owned uiPrefs write without changing the legacy shared layout', async () => {
  const backend = await legacy(); const t = await start(backend); await t.boot();
  await t.update({ todayCards: B_LAYOUT });
  const shared = await backend.get('settings', 'me');
  await t.rt.getDocumentStore().transact(t.store.mintWriteToken('command'), async tx => {
    await tx.put('deviceSettings', { _id: 'me', theme: 'light', widgetWeight: true });
    await tx.patch('uiPrefs', 'me', { activeScenarioId: 'legacy-scenario' });
  });
  const reloaded = await start(backend); await reloaded.boot();
  expect(reloaded.settings.getState().todayCards).toEqual(B_LAYOUT);
  expect(localLayout(reloaded)).toMatchObject({ activeScenarioId: 'legacy-scenario' });
  expect((await backend.get('settings', 'me'))?.value).toEqual(shared?.value);
});

it('keeps two devices independent through real simulated relay exchange, legacy edits, and reload', async () => {
  localStorage.clear(); vi.stubGlobal('localStorage', undefined);
  const hub: ReturnType<typeof createMemoryHub> = new Map();
  async function device(name: string, layout: string[]) {
    vi.resetModules();
    const store = await import('@/store');
    const { DEFAULT_SETTINGS, SYNCED_SETTING_KEYS } = await import('@/state/internal/settingsModel');
    const local = store.createMemoryBackend({ device: name });
    await local.put('settings', 'me', { ...Object.fromEntries(SYNCED_SETTING_KEYS.map(key => [key, DEFAULT_SETTINGS[key]])), todayCards: layout });
    await local.put('syncState', 'me', { migratedFromLocalStorage: OLD });
    const t = await start(local); await t.boot();
    t.commands.setOutputValidation('throw');
    const { createSyncRuntime } = await import('@/state/sync/controller');
    const { createMemoryVault } = await import('@/state/sync/vault');
    const { createMemorySyncStore } = await import('@/sync/memoryStore');
    const engines: ReturnType<typeof createMemorySyncStore>[] = [];
    const sync = createSyncRuntime({ vault: createMemoryVault(), localBackend: () => local, createEngine: async () => { const engine = createMemorySyncStore(); engine.link(hub); engines.push(engine); return engine; }, joinSettle: { quietMs: 1, maxMs: 100 } });
    cleanups.push(() => sync.unpair());
    return { ...t, sync, engines };
  }
  const a = await device('DEVICEA0000000001', A_LAYOUT);
  const code = await a.sync.pair('https://relay.example.test');
  const b = await device('DEVICEB0000000001', B_LAYOUT);
  await b.sync.join(code.uri, 'replace');
  expect(a.settings.getState().todayCards).toEqual(A_LAYOUT);
  expect(b.settings.getState().todayCards).toEqual(B_LAYOUT);
  const changed = ['heart-rate:wide', 'energy:card'];
  const sharedBeforeLayout = [...hub.values()].find(row => row._col === 'settings' && row._id === 'me')?._rev;
  expect((await a.update({ todayCards: changed })).ok).toBe(true);
  await a.sync.syncNow(); await b.sync.syncNow();
  expect([...hub.values()].find(row => row._col === 'settings' && row._id === 'me')?._rev).toBe(sharedBeforeLayout);
  expect((await a.update({ units: 'imperial' })).ok).toBe(true);
  await a.sync.syncNow(); await b.sync.syncNow();
  await new Promise(r => setTimeout(r, 0));
  expect(b.settings.getState()).toMatchObject({ units: 'imperial', todayCards: B_LAYOUT, hrProfile: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false } });
  await b.update({ todayCards: [] });
  await b.sync.syncNow(); await a.sync.syncNow();
  const shared = [...hub.values()].find(row => row._col === 'settings' && row._id === 'me');
  expect(shared?.value).toMatchObject({ todayCards: A_LAYOUT });
  expect(shared?.value).not.toHaveProperty('theme');
  expect(shared?.value).not.toHaveProperty('widgetWeight');
  expect([...hub.values()].some(row => row._col === 'uiPrefs' || row._col === 'deviceSettings')).toBe(false);
  expect(JSON.stringify([...hub.values()])).not.toContain('heart-rate:wide');
  // A legacy writer updates the old shared field; the other device must retain its explicit empty local list.
  await a.rt.getDocumentStore().transact(a.store.mintWriteToken('command'), tx => tx.patch('settings', 'me', { todayCards: ['old-renderer:wide'], units: 'metric' }));
  await a.sync.syncNow(); await b.sync.syncNow(); await new Promise(r => setTimeout(r, 0));
  expect(b.settings.getState()).toMatchObject({ units: 'metric', todayCards: [] });
  const reloadedA = await start(a.backend); await reloadedA.boot();
  expect(reloadedA.settings.getState().todayCards).toEqual(changed);
  const reloadedB = await start(b.backend); await reloadedB.boot();
  expect(reloadedB.settings.getState().todayCards).toEqual([]);
});

it('keeps nullable HR settings equivalent while unrelated settings and local layout change', async () => {
  const backend = await legacy(); const t = await start(backend); await t.boot();
  t.commands.setOutputValidation('throw');
  expect((await t.update({ hrProfile: { hrMaxOverride: 185, hrRestOverride: 58, useSleepLowAsRest: true } })).ok).toBe(true);
  expect((await t.update({ hrProfile: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false } })).ok).toBe(true);
  expect((await t.update({ todayCards: [], units: 'imperial' })).ok).toBe(true);
  const reloaded = await start(backend); await reloaded.boot();
  expect(reloaded.settings.getState()).toMatchObject({ units: 'imperial', todayCards: [], hrProfile: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false } });
});

it('does not seed a device layout in a headless replica boot that forbids defaults', async () => {
  const backend = await legacy(); const t = await start(backend);
  await t.rt.bootDocuments({ prefer: 'docs', writeDefaults: false });
  expect((await backend.get('uiPrefs', 'me'))?.value).not.toHaveProperty('todayCardsLocalSet');
  expect((await backend.get('settings', 'me'))?.value).toMatchObject({ todayCards: A_LAYOUT });
});

it('does not turn a failed early layout command into the migrated local choice', async () => {
  const backend = await legacy(); const hold = deferred();
  const batch = backend.batch!.bind(backend); let fail = true;
  backend.batch = async ops => {
    if (fail && ops.some(op => op.kind === 'put' && op.col === 'uiPrefs' && (op.value as { todayCardsLocalSet?: boolean }).todayCardsLocalSet)) {
      fail = false; throw new Error('synthetic local write failure');
    }
    return batch(ops);
  };
  const t = await start(backend, hold.promise); const booting = t.boot();
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const editing = t.update({ todayCards: B_LAYOUT });
    hold.resolve();
    const result = await editing;
    await booting;
    expect(result.ok).toBe(false);
    expect(t.settings.getState().todayCards).toEqual(A_LAYOUT);
    expect(localLayout(t)?.todayCardsLocal).toEqual(A_LAYOUT);
  } finally { error.mockRestore(); }
});
