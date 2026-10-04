/** "Erase this device" leaves nothing of Vitals in localStorage, including device bookkeeping outside `vitals.*`. */
import { expect, it, vi } from 'vitest';

it('erases vitals.*, lumen.* and the vitals-* device keys, and leaves other sites alone', async () => {
  localStorage.clear();
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  runtime.setDocumentStore(store.createDocumentStore({ backend: store.createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  await runtime.bootDocuments();
  const p = await import('@/state/persistence');
  localStorage.setItem('vitals.settings', JSON.stringify({ version: 2, state: { units: 'metric' } }));
  localStorage.setItem('lumen.body', '{}');
  localStorage.setItem('vitals-storage-persist', JSON.stringify({ outcome: 'granted' }));
  localStorage.setItem(runtime.SYNC_UNSYNCED_KEY, '["x"]');
  localStorage.setItem(runtime.SYNC_PAIRED_KEY, '1');
  localStorage.setItem('other-app', 'keep');
  await p.eraseAll();
  const left: string[] = [];
  for (let i = 0; i < localStorage.length; i++) left.push(localStorage.key(i)!);
  expect(left).toEqual(['other-app']);
});

it('erase deletes vitals-planner', async () => {
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  runtime.setDocumentStore(store.createDocumentStore({ backend: store.createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  await runtime.bootDocuments();
  const p = await import('@/state/persistence');
  const deleted: string[] = [];
  const deleteDatabase = (name: string) => {
    deleted.push(name);
    const req = {} as { onsuccess?: () => void };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  vi.stubGlobal('indexedDB', { deleteDatabase });
  try {
    await p.eraseAll();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(deleted).toContain('vitals-planner');
});
