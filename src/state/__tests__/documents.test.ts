/**
 * The document store behind the projections: one-time migration from the v0.1 `vitals.*` keys (and a `lumen.*`
 * dump), boot reconciliation, remote changes, the strict-store guard, ChangeSet commits, export v2 / import v1 and v2.
 *
 * Each case boots a fresh module graph (`vi.resetModules`) over seeded localStorage, the way the app starts.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = '2026-10-01T09:00:00.000Z';

const V01 = {
  'vitals.body': {
    version: 1,
    state: {
      sex: 'female', figureBase: null, ageYears: 41, heightCm: 168, weightKg: 71.5, ethnicity: null,
      shape: { bodyFatPct: 31 }, waist: { use: true, cm: 84, neckCm: null, hipCm: 101 },
      knownBodyFat: { use: false, pct: null, source: 'dxa' }, training: { years: 2, quality: 'regular' },
      habits: { typicalSteps: 7200, sessionsPerWeek: 2 }, cycle: { tracking: false }, menopause: 'peri', labs: { ldlMmolL: 3.4 },
      setup: 'done', shapeSkipped: false, habitsSkipped: true, updatedAt: '2026-09-30T08:00:00.000Z', revision: 12,
    },
  },
  'vitals.safety': {
    version: 1,
    state: { answers: { ageBand: '18-39' }, answeredAt: '2026-09-29T08:00:00.000Z', questionSetVersion: 1, acknowledgements: { disclaimer: { version: 1, at: '2026-09-29T08:00:00.000Z' } }, fastingOptIn: null, legacyLongFastsRequest: false, recentIllnessAt: null, shortWindow: null, dangerAcks: {}, pendingReview: false },
  },
  'vitals.planner': {
    version: 1,
    state: { goals: [{ key: 'g1', metric: 'fatMass', mode: 'lose', amount: 4, strength: 'should', functional: null }], horizonDays: 84, startDate: null, constraints: { maxSessionMin: 45 }, strictness: 'strict', lastRequestHash: null, lastRunAt: null },
  },
  'vitals.settings': { version: 2, state: { units: 'imperial', theme: 'dark', chartPatterns: true, allowLongFasts: true } },
  'vitals.results': { version: 1, state: { byScenario: { s1: { pinned: ['weight'] } }, bandOpen: false, breakdownOpen: true } },
  'vitals.ui.lastRoute': { version: 1, state: '/simulate' },
};

function seed(prefix = 'vitals.') {
  for (const [k, v] of Object.entries(V01)) localStorage.setItem(prefix + k.slice('vitals.'.length), JSON.stringify(v));
}

async function boot(backend?: unknown) {
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  const be = (backend as ReturnType<typeof store.createMemoryBackend>) ?? store.createMemoryBackend({ device: 'TESTDEVICE000001' });
  runtime.setDocumentStore(store.createDocumentStore({ backend: be, device: 'TESTDEVICE000001' }));
  const report = await runtime.bootDocuments();
  const docs = runtime.getDocumentStore();
  return { store, runtime, report, docs, backend: be };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('one-time migration from localStorage', { timeout: 30_000 }, () => {
  it('maps every v0.1 store into its collections in one transaction and marks it done', async () => {
    seed();
    const { report, docs } = await boot();
    expect(report.migrated).toBe(true);
    expect(docs.peek('profile', 'me')).toMatchObject({ sex: 'female', ageYears: 41, weightKg: 71.5, shape: { bodyFatPct: 31 }, labs: { ldlMmolL: 3.4 }, revision: 12 });
    expect(docs.peek('profile', 'me')).not.toHaveProperty('setup');
    expect(docs.peek('uiPrefs', 'me')).toMatchObject({
      bodySetup: 'done',
      habitsSkipped: true,
      activeScenarioId: 'starter',
      lastRoute: '/simulate',
      resultsUi: { byScenario: { s1: { pinned: ['weight'] } }, bandOpen: false, breakdownOpen: true },
    });
    expect(docs.peek('safety', 'me')).toMatchObject({ answeredAt: '2026-09-29T08:00:00.000Z', legacyLongFastsRequest: true });
    expect(docs.peek('goals', 'me')).toMatchObject({ horizonDays: 84, strictness: 'strict', constraints: { maxSessionMin: 45 } });
    expect(docs.peek('settings', 'me')).toMatchObject({ units: 'imperial', energyUnit: 'kcal' });
    expect(docs.peek('deviceSettings', 'me')).toMatchObject({ theme: 'dark', chartPatterns: true });
    expect(docs.peekAll('scenarios').map((d) => d._id)).toEqual(['starter']);
    expect(docs.peek('syncState', 'me')).toMatchObject({ migratedFromLocalStorage: NOW });
    expect(localStorage.getItem('vitals.migratedToStore')).toBe(NOW);
    // the v0.1 keys stay (rollback); the boot cache carries the current versions
    expect(JSON.parse(localStorage.getItem('vitals.settings')!).version).toBe(3);
    expect(localStorage.getItem('vitals.results')).not.toBeNull();
  });

  it('runs once: a second boot reconciles instead', async () => {
    seed();
    const first = await boot();
    const again = await boot(first.backend);
    expect(again.report.migrated).toBe(false);
    expect(again.report.fromDocs).toEqual([]);
  });

  it('reads a lumen.* dump from before the rename', async () => {
    seed('lumen.');
    const { docs } = await boot();
    expect(docs.peek('profile', 'me')).toMatchObject({ weightKg: 71.5 });
    expect(docs.peek('settings', 'me')).toMatchObject({ units: 'imperial' });
    expect(localStorage.getItem('lumen.body')).not.toBeNull();
  });

  it('migrates a fresh install too, so every projection has its documents', async () => {
    const { report, docs } = await boot();
    expect(report.migrated).toBe(true);
    expect(docs.peek('profile', 'me')).toMatchObject({ sex: null, weightKg: null });
    expect(docs.peekAll('scenarios')).toHaveLength(1);
  });
});

describe('boot reconciliation and remote changes', { timeout: 30_000 }, () => {
  it('takes newer documents over the boot cache (a change merged while the app was closed)', async () => {
    seed();
    const first = await boot();
    const t = first.store.mintWriteToken('sync');
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    await first.docs.transact(t, (tx) => tx.patch('settings', 'me', { units: 'metric' }));
    const again = await boot(first.backend);
    expect(again.report.fromDocs).toContain('vitals.settings');
    const { useSettingsStore } = await import('@/state/settingsStore');
    expect(useSettingsStore.getState().units).toBe('metric');
    expect(JSON.parse(localStorage.getItem('vitals.settings')!).state.units).toBe('metric');
  });

  it('brings documents up to date from a newer boot cache (a write that never reached the database)', async () => {
    seed();
    const first = await boot();
    vi.setSystemTime(new Date('2026-10-01T11:00:00.000Z'));
    const cache = JSON.parse(localStorage.getItem('vitals.planner')!);
    cache.state.horizonDays = 140;
    cache.at = '2026-10-01T11:00:00.000Z';
    localStorage.setItem('vitals.planner', JSON.stringify(cache));
    const again = await boot(first.backend);
    expect(again.report.fromCache).toContain('vitals.planner');
    await again.runtime.settleUnscopedWrites();
    expect(again.docs.peek('goals', 'me')).toMatchObject({ horizonDays: 140 });
  });

  it('applies merged remote documents to the projection', async () => {
    seed();
    const { backend } = await boot();
    const { useProfileStore } = await import('@/state/profileStore');
    backend.remote({ _id: 'me', _col: 'profile', _schema: 1, _rev: '9999999999999-0000-REMOTEDEVICE0001', _device: 'REMOTEDEVICE0001', _created: NOW, _updated: NOW, value: { ...V01['vitals.body'].state, weightKg: 69 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(useProfileStore.getState().weightKg).toBe(69);
  });
});

describe('writes: commands, ChangeSets and the guard', { timeout: 30_000 }, () => {
  it('commits a command to the documents with its ChangeSet row', async () => {
    seed();
    const { docs } = await boot();
    const { dispatch } = await import('@/commands');
    const r = await dispatch('profile.patch', { weightKg: 70 });
    expect(r.ok).toBe(true);
    await (await import('@/commands')).settleCommits();
    expect(docs.peek('profile', 'me')).toMatchObject({ weightKg: 70, revision: 13 });
    const rows = docs.peekAll<{ commandId: string }>('changeLog');
    expect(rows.map((c) => c.commandId)).toContain('profile.patch');
  });

  it('throws on a projection write outside a command (dev/test), and logs it in production mode', async () => {
    await boot();
    const { useSettingsStore } = await import('@/state/settingsStore');
    const scope = await import('@/state/scope');
    const { WriteOutsideCommand } = await import('@/store');
    expect(() => useSettingsStore.setState({ units: 'imperial' })).toThrow(WriteOutsideCommand);
    expect(useSettingsStore.getState().units).toBe('metric');
    // ephemeral-only writes are not guarded
    expect(() => useSettingsStore.setState({})).not.toThrow();
    const prev = scope.setGuardMode('log');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      act(() => useSettingsStore.setState({ units: 'imperial' }));
      expect(useSettingsStore.getState().units).toBe('imperial');
      expect(err).toHaveBeenCalled();
    } finally {
      scope.setGuardMode(prev);
      err.mockRestore();
    }
  });
});

describe('export v2 and import', { timeout: 30_000 }, () => {
  it('exports documents next to the v1 section and round-trips through erase and import', async () => {
    seed();
    await boot();
    const p = await import('@/state/persistence');
    const { useProfileStore } = await import('@/state/profileStore');
    const file = p.serializeExport(p.exportAll(new Date(NOW)));
    const parsed = JSON.parse(file) as { vitalsVersion: string; collections: Record<string, Array<{ _id: string }>>; stores: Record<string, unknown> };
    expect(parsed.vitalsVersion).toBe('2');
    expect(parsed.collections.profile?.[0]).toMatchObject({ _id: 'me', weightKg: 71.5 });
    expect(Object.keys(parsed.collections)).not.toContain('changeLog');
    expect(Object.keys(parsed.stores)).toContain('vitals.body');

    await p.eraseAll();
    expect(p.listStoredKeys()).toEqual([]);
    const out = await p.importAll(file, 'replace');
    expect(out.written).toContain('vitals.body');
    expect(useProfileStore.getState().weightKg).toBe(71.5);
  });

  it('imports a v2 file that carries documents only', async () => {
    await boot();
    const p = await import('@/state/persistence');
    const { usePlannerStore } = await import('@/state/plannerStore');
    const { useProfileStore } = await import('@/state/profileStore');
    const file = {
      vitalsVersion: '2',
      app: 'vitals',
      collections: {
        goals: [{ _id: 'me', _col: 'goals', goals: [], horizonDays: 56, constraints: {}, strictness: 'flexible', startDate: null, lastRequestHash: null, lastRunAt: null }],
        profile: [{ _id: 'me', _col: 'profile', ...V01['vitals.body'].state, weightKg: 66 }],
        intake: [{ _id: 'me', _col: 'intake', answeredAt: { diet: NOW }, questionSetVersion: { diet: 1 }, diet: { animalFoods: 'none' } }],
      },
    };
    const preview = p.parseImport(JSON.stringify(file));
    expect(preview.ok).toBe(true);
    await p.importAll(preview, 'replace');
    expect(usePlannerStore.getState().horizonDays).toBe(56);
    expect(useProfileStore.getState().weightKg).toBe(66);
    const runtime = await import('@/state/runtime');
    await runtime.settleUnscopedWrites();
    expect(runtime.getDocumentStore().peek('intake', 'me')).toMatchObject({ diet: { animalFoods: 'none' } });
  });
});
