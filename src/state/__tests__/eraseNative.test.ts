import { afterEach, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('indexedDB', undefined);
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  const docs = store.createDocumentStore({ backend: store.createMemoryBackend() });
  runtime.setDocumentStore(docs);
  await runtime.bootDocuments();
  const persistence = await import('@/state/persistence');
  const native = await import('@/state/gaugeEngine');
  const clear = vi.spyOn(native, 'clearGaugeEngineServer');
  const erase = vi.spyOn(docs, 'erase');
  localStorage.setItem('vitals.notes', 'saved planning note');
  return { persistence, clear, erase };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('retains planning data when native server detach fails', async () => {
  const { persistence, clear, erase } = await setup();
  clear.mockRejectedValue(new Error('native detach unavailable'));
  await expect(persistence.eraseAll()).rejects.toThrow('native detach unavailable');
  expect(localStorage.getItem('vitals.notes')).toBe('saved planning note');
  expect(erase).not.toHaveBeenCalled();
});

it('stops erasure if its caller cancels while native detach is pending', async () => {
  const { persistence, clear, erase } = await setup();
  const gate = deferred();
  clear.mockReturnValue(gate.promise);
  const abort = new AbortController();
  const pending = persistence.eraseAll({ signal: abort.signal });
  await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
  abort.abort();
  gate.resolve();
  await expect(pending).rejects.toThrow('cancelled');
  expect(localStorage.getItem('vitals.notes')).toBe('saved planning note');
  expect(erase).not.toHaveBeenCalled();
});

it('does not erase a replacement completed while native detach was pending', async () => {
  const { persistence, clear, erase } = await setup();
  const gate = deferred();
  clear.mockReturnValue(gate.promise);
  const pending = persistence.eraseAll();
  await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce());
  const barrier = (await import('@/state/writeBarrier')).beginRestore();
  barrier.committed('synthetic-new-snapshot');
  barrier.release();
  gate.resolve();
  await expect(pending).rejects.toThrow('data was replaced');
  expect(localStorage.getItem('vitals.notes')).toBe('saved planning note');
  expect(erase).not.toHaveBeenCalled();
});

it('detaches native uploads before erasing planning data on success', async () => {
  const { persistence, clear, erase } = await setup();
  let detached = false;
  clear.mockImplementation(async () => { detached = true; });
  erase.mockImplementation(async () => { expect(detached).toBe(true); });
  await persistence.eraseAll();
  expect(clear).toHaveBeenCalledOnce();
  expect(erase).toHaveBeenCalledOnce();
  expect(localStorage.getItem('vitals.notes')).toBeNull();
});
