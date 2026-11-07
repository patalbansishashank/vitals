import { afterEach, expect, it, vi } from 'vitest';

async function coldFile() {
  vi.resetModules();
  localStorage.clear();
  const persistence = await import('@/state/persistence');
  const { getBinding } = await import('@/state/bridge');
  const { makeScenario } = await import('@/state/internal/scheduleModel');
  const { DEFAULT_BODY, profileDocOf } = await import('@/state/internal/profileModel');
  expect(getBinding('vitals.scenarios')).toBeUndefined();
  expect(getBinding('vitals.body')).toBeUndefined();
  const scenario = makeScenario({ id: 'imported-plan', name: 'Saved planning data', startDate: '2026-11-02' });
  const file = {
    vitalsVersion: '2',
    stores: { 'vitals.raw': { version: null, state: 'raw backup content' } },
    collections: {
      profile: [{ _id: 'me', ...profileDocOf({ ...DEFAULT_BODY, weightKg: 73, heightCm: 175 }) }],
      scenarios: [{ _id: scenario.id, ...scenario }],
      uiPrefs: [{ _id: 'me', bodySetup: 'done', activeScenarioId: scenario.id, customPreference: 'kept from file' }],
      dailyLogs: [{ _id: '01J0000000000000000000000A', date: '2026-10-31', kind: 'steps', source: { by: 'user' }, steps: 4321 }],
    },
  };
  return { persistence, file };
}
afterEach(() => { localStorage.clear(); });

it.each(['replace', 'merge'] as const)('keeps every collection through a cold preview, %s import and binding boot', async (mode) => {
  const { persistence, file } = await coldFile();
  const preview = persistence.parseImport(file);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error(preview.message);
  expect(Object.keys(preview.data.stores)).toEqual(['vitals.raw']);
  expect(preview.data.collections).toEqual(file.collections);
  await persistence.importAll(preview, mode);
  const runtime = await import('@/state/runtime');
  await runtime.bootDocuments();
  await runtime.settleUnscopedWrites();
  const docs = runtime.getDocumentStore();
  for (const [col, entries] of Object.entries(file.collections)) for (const entry of entries) {
    expect(docs.peek(col as never, entry._id), `${mode}: ${col}/${entry._id}`).toMatchObject(entry);
  }
  expect((await import('@/state/profileStore')).useProfileStore.getState()).toMatchObject({ weightKg: 73, heightCm: 175 });
  expect((await import('@/state/scheduleStore')).useScheduleStore.getState().scenarios).toContainEqual(expect.objectContaining({ id: 'imported-plan', name: 'Saved planning data' }));
  expect(localStorage.getItem('vitals.raw')).toBe('raw backup content');
});

it('does not infer a scenarios payload from unrelated shared UI fields, but preserves explicit empty scenarios', async () => {
  const { persistence } = await coldFile();
  await (await import('@/state/runtime')).bootDocuments();
  const sharedOnly = persistence.parseImport({ vitalsVersion: '2', stores: { 'vitals.raw': { state: 'text' } }, collections: { uiPrefs: [{ _id: 'me', bodySetup: 'basics' }] } });
  expect(sharedOnly.ok).toBe(true);
  if (!sharedOnly.ok) throw new Error(sharedOnly.message);
  expect(sharedOnly.data.stores).not.toHaveProperty('vitals.scenarios');
  const empty = persistence.parseImport({ vitalsVersion: '2', stores: { 'vitals.raw': { state: 'text' } }, collections: { scenarios: [] } });
  expect(empty.ok).toBe(true);
  if (!empty.ok) throw new Error(empty.message);
  expect(empty.data.stores['vitals.scenarios']?.state).toEqual({ scenarios: [], activeId: null });
  await persistence.importAll(empty, 'replace');
  expect((await import('@/state/scheduleStore')).useScheduleStore.getState().scenarios).toEqual([]);
});

it.each(['direct', 'command'] as const)('%s merge retains existing shared fields and projection ownership while adding missing fields', async (path) => {
  const { persistence, file } = await coldFile();
  const preview = persistence.parseImport(file);
  if (!preview.ok) throw new Error(preview.message);
  const runtime = await import('@/state/runtime');
  await runtime.bootDocuments();
  const { useProfileStore } = await import('@/state/profileStore');
  const { withSystemWrite } = await import('@/state/scope');
  withSystemWrite(() => useProfileStore.setState({ weightKg: 80, setup: 'basics' }));
  await runtime.settleUnscopedWrites();
  persistence.exportAll();
  const { mintWriteToken } = await import('@/store');
  await runtime.getDocumentStore().transact(mintWriteToken('command'), tx => tx.patch('uiPrefs', 'me', { customPreference: 'target value' }));
  Object.assign(preview.data.collections!.uiPrefs![0]!, { addedPreference: 'new from file' });
  if (path === 'command') {
    const { dispatch, mintConfirmation } = await import('@/commands');
    const input = { file: preview.data as unknown as Record<string, unknown>, mode: 'merge' as const };
    expect((await dispatch('data.import', input, { confirmation: mintConfirmation('data.import', input) })).ok).toBe(true);
  } else await persistence.importAll(preview, 'merge');
  await runtime.settleUnscopedWrites();
  expect(useProfileStore.getState().weightKg).toBe(80);
  expect(runtime.getDocumentStore().peek('uiPrefs', 'me')).toMatchObject({ customPreference: 'target value', addedPreference: 'new from file', bodySetup: 'basics' });
});

it('reports validation problems discovered after the cold preview instead of replacing them with its older list', async () => {
  const { persistence } = await coldFile();
  const preview = persistence.parseImport({ vitalsVersion: '2', stores: { 'vitals.raw': { state: 'kept' }, 'vitals.late': { version: 1, state: 'invalid shape' }, 'other.app': { state: 'excluded' } } });
  if (!preview.ok) throw new Error(preview.message);
  expect(preview.damaged.map(problem => problem.key)).toEqual(['other.app']);
  const unregister = persistence.registerStore('vitals.late', 1, { validate: Array.isArray });
  try {
    const result = await persistence.importAll(preview, 'merge');
    expect(result.skipped.map(problem => problem.key).sort()).toEqual(['other.app', 'vitals.late']);
    expect(localStorage.getItem('vitals.late')).toBeNull();
    expect(localStorage.getItem('vitals.raw')).toBe('kept');
  } finally { unregister(); }
});
