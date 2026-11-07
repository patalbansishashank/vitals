import { afterEach, expect, it, vi } from 'vitest';

const LOG = { _id: '01J0000000000000000000000A', date: '2026-10-31', kind: 'steps', source: { by: 'user' }, steps: 4567 };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
afterEach(() => { localStorage.clear(); });

it('waits for a slow database boot before exporting existing daily logs', async () => {
  vi.resetModules();
  localStorage.clear();
  const { createMemoryBackend, createDocumentStore } = await import('@/store');
  const { setDocumentStore } = await import('@/state/runtime');
  const backend = createMemoryBackend();
  await backend.put('dailyLogs', LOG._id, LOG);
  const loading = deferred();
  const list = backend.list.bind(backend);
  backend.list = async (col, options) => {
    if (col === 'dailyLogs') await loading.promise;
    return list(col, options);
  };
  setDocumentStore(createDocumentStore({ backend }));
  const { dispatch, outputOf } = await import('@/commands');
  let settled = false;
  const exporting = dispatch('data.export', {}).finally(() => { settled = true; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  } finally {
    loading.resolve();
  }
  const result = await exporting;
  expect(result.ok).toBe(true);
  const file = JSON.parse(outputOf(result)!.text);
  expect(file.collections.dailyLogs).toEqual([expect.objectContaining(LOG)]);
});

it('waits for pending projection writes before finishing an export', async () => {
  vi.resetModules();
  localStorage.clear();
  const { createMemoryBackend, createDocumentStore } = await import('@/store');
  const { setDocumentStore, bootDocuments } = await import('@/state/runtime');
  const backend = createMemoryBackend();
  setDocumentStore(createDocumentStore({ backend }));
  await bootDocuments();
  const saving = deferred();
  const batch = backend.batch!.bind(backend);
  backend.batch = async (ops) => { await saving.promise; return batch(ops); };
  const { withSystemWrite } = await import('@/state/scope');
  const { useSettingsStore } = await import('@/state/settingsStore');
  withSystemWrite(() => useSettingsStore.setState({ units: 'imperial' }));
  const { dispatch, outputOf } = await import('@/commands');
  let settled = false;
  const exporting = dispatch('data.export', {}).finally(() => { settled = true; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  } finally {
    saving.resolve();
  }
  const result = await exporting;
  expect(result.ok).toBe(true);
  expect(JSON.parse(outputOf(result)!.text).stores['vitals.settings'].state.units).toBe('imperial');
  expect((await backend.get('settings', 'me'))?.value).toMatchObject({ units: 'imperial' });
});
