import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropServiceWorker, installAndroidShell } from '../androidBoot';
import { resetAndroidShellForTests } from '../androidShell';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

function fakeServiceWorker(opts: { regs: number; controlled: boolean }) {
  const regs = Array.from({ length: opts.regs }, () => ({ unregister: vi.fn(async () => true) }));
  const sw = { getRegistrations: vi.fn(async () => regs), controller: opts.controlled ? {} : null };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  const cacheStore = { keys: vi.fn(async () => ['workbox-precache-v2']), delete: vi.fn(async () => true) };
  vi.stubGlobal('caches', cacheStore);
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
  return { regs, cacheStore, reload };
}

const realLocation = window.location;
beforeEach(() => {
  resetAndroidShellForTests();
  sessionStorage.clear();
});
afterEach(() => {
  removeFakeCapacitor();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
});

describe('dropServiceWorker', () => {
  it('unregisters, empties the caches and reloads once when an old worker served the page', async () => {
    const f = fakeServiceWorker({ regs: 1, controlled: true });
    await dropServiceWorker();
    await dropServiceWorker();
    expect(f.regs[0]?.unregister).toHaveBeenCalled();
    expect(f.cacheStore.delete).toHaveBeenCalledWith('workbox-precache-v2');
    expect(f.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a registration, and does not reload a page no worker served', async () => {
    const none = fakeServiceWorker({ regs: 0, controlled: false });
    await dropServiceWorker();
    expect(none.cacheStore.keys).not.toHaveBeenCalled();
    const uncontrolled = fakeServiceWorker({ regs: 1, controlled: false });
    await dropServiceWorker();
    expect(uncontrolled.regs[0]?.unregister).toHaveBeenCalled();
    expect(uncontrolled.reload).not.toHaveBeenCalled();
  });
});

describe('installAndroidShell', () => {
  it('leaves the service worker alone on the web', async () => {
    const f = fakeServiceWorker({ regs: 1, controlled: true });
    installAndroidShell()();
    await flush();
    expect(f.regs[0]?.unregister).not.toHaveBeenCalled();
  });

  it('drops it in the Android app', async () => {
    installFakeCapacitor();
    const f = fakeServiceWorker({ regs: 1, controlled: false });
    const off = installAndroidShell();
    await flush();
    off();
    expect(f.regs[0]?.unregister).toHaveBeenCalled();
  });
});
