import { vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { setPlatformForTests } from '@/platform';
import { NoticesRegion, useNoticeStore } from '@/app/shell/notices';
import { applyUpdate, reloadOnce, resetController, startPwa, UPDATE_CHECK_MS, type RegisterSW } from '../controller';
import { InstallSettings } from '@/features/settings/InstallSettings';
import { SettingsIndex } from '@/features/settings/SettingsIndex';
import { getInstallState, resetInstall, startInstallDetection, type BeforeInstallPromptEvent } from '../install';
import { getSwState, resetSw, swReducer, type SwState } from '../swStatus';
import { UPDATE_NOTICE_ID } from '../updateNotice';

type Options = NonNullable<Parameters<RegisterSW>[0]>;

/** A stand-in for the `registerSW` of vite-plugin-pwa that hands the lifecycle callbacks to the test. */
function fakeRegister() {
  const updateSW = vi.fn((_reload?: boolean) => Promise.resolve());
  let options: Options = {};
  const registerSW: RegisterSW = vi.fn((o = {}) => {
    options = o;
    return updateSW;
  });
  return { registerSW, updateSW, options: () => options };
}

/** `navigator.serviceWorker` as an event target, so tests can fire `controllerchange`. */
function stubServiceWorker(ready: Promise<unknown> = new Promise(() => undefined), controller: object | null = null) {
  const container = Object.assign(new EventTarget(), { ready, controller });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return container;
}

beforeEach(() => {
  useNoticeStore.setState({ notices: [] });
  resetController();
  resetSw();
  resetInstall({ platform: 'chromium', standalone: false });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.useRealTimers();
});

describe('swReducer', () => {
  const base: SwState = { offline: 'unavailable', needRefresh: false, applying: false, error: null };

  it('moves preparing → ready, and a waiting update implies the app is already saved offline', () => {
    const preparing = swReducer(base, { type: 'registering' });
    expect(preparing.offline).toBe('preparing');
    expect(swReducer(preparing, { type: 'ready' }).offline).toBe('ready');
    expect(swReducer(preparing, { type: 'need-refresh' })).toMatchObject({ offline: 'ready', needRefresh: true });
  });

  it('never demotes a ready app back to preparing, and only applies an update that exists', () => {
    const ready = swReducer(base, { type: 'ready' });
    expect(swReducer(ready, { type: 'registering' })).toBe(ready);
    expect(swReducer(ready, { type: 'applying' })).toBe(ready);
    const waiting = swReducer(ready, { type: 'need-refresh' });
    const applying = swReducer(waiting, { type: 'applying' });
    expect(applying.applying).toBe(true);
    expect(swReducer(applying, { type: 'apply-failed' })).toMatchObject({ applying: false, needRefresh: true });
  });
});

describe('startPwa', () => {
  it('reports an unsupported browser and a dev server without registering anything', () => {
    const { registerSW } = fakeRegister();
    startPwa({ registerSW, enabled: true });
    expect(getSwState().offline).toBe('unsupported');
    stubServiceWorker();
    startPwa({ registerSW, enabled: false });
    expect(getSwState().offline).toBe('unavailable');
    expect(registerSW).not.toHaveBeenCalled();
  });

  it('registers after load (not immediately) and reports ready from the offline-ready callback', () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    expect(fake.options().immediate).toBe(false);
    expect(getSwState().offline).toBe('preparing');
    act(() => fake.options().onOfflineReady?.());
    expect(getSwState().offline).toBe('ready');
  });

  it('reports ready on a later visit, when an active worker already exists', async () => {
    stubServiceWorker(Promise.resolve({}));
    startPwa({ registerSW: fakeRegister().registerSW, enabled: true });
    await vi.waitFor(() => expect(getSwState().offline).toBe('ready'));
  });

  it('falls back to unavailable, with the reason, when registration fails', () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    act(() => fake.options().onRegisterError?.(new Error('SecurityError')));
    expect(getSwState()).toMatchObject({ offline: 'unavailable', error: 'SecurityError' });
  });
});

describe('update checks while the page stays open', () => {
  const setVisibility = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  function registered(controller: object | null = {}) {
    stubServiceWorker(undefined, controller);
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    const registration = Object.assign(new EventTarget(), {
      active: {},
      installing: null as (EventTarget & { state: string }) | null,
      waiting: null as object | null,
      update: vi.fn(() => Promise.resolve()),
    });
    fake.options().onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration);
    return { fake, registration };
  }

  /** The browser found a worker: it starts installing and ends `installed` (waiting) or `redundant` (failed). */
  function install(registration: ReturnType<typeof registered>['registration'], outcome: 'installed' | 'redundant') {
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.state = outcome;
    registration.installing = null;
    if (outcome === 'installed') registration.waiting = worker;
    worker.dispatchEvent(new Event('statechange'));
    return worker;
  }

  const offerShown = () => useNoticeStore.getState().notices.filter((n) => n.id === UPDATE_NOTICE_ID).length;

  it('asks for a new worker when the page comes back into view, not when it is hidden', () => {
    const { registration } = registered();
    expect(registration.update).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(registration.update).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('asks hourly while the page stays open, and skips while a worker is already installing', () => {
    vi.useFakeTimers();
    const { registration } = registered();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
    registration.installing = Object.assign(new EventTarget(), { state: 'installing' });
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('a failed check stays quiet, and a found update still waits for the Reload prompt', async () => {
    const { fake, registration } = registered();
    registration.update.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    setVisibility('visible');
    await Promise.resolve();
    expect(getSwState().error).toBeNull();
    act(() => fake.options().onNeedRefresh?.());
    expect(getSwState().needRefresh).toBe(true);
    expect(fake.updateSW).not.toHaveBeenCalled();
  });

  it('skips the check while offline', () => {
    const { registration } = registered();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      setVisibility('visible');
      expect(registration.update).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'onLine');
    }
  });

  it('offers the update when a later check installs a worker after an earlier one failed', () => {
    const { registration } = registered();
    install(registration, 'redundant');
    expect(offerShown()).toBe(0);
    expect(getSwState().needRefresh).toBe(false);
    install(registration, 'installed');
    expect(offerShown()).toBe(1);
    expect(getSwState().needRefresh).toBe(true);
  });

  it('offers a worker that is already waiting when the next check runs, once, even after the offer was dismissed', () => {
    const { registration } = registered();
    registration.waiting = {};
    setVisibility('visible');
    expect(offerShown()).toBe(1);
    act(() => useNoticeStore.setState({ notices: [] }));
    setVisibility('visible');
    expect(offerShown()).toBe(0);
  });

  it('does not treat the first install on an uncontrolled page as an update', () => {
    const { registration } = registered(null);
    install(registration, 'installed');
    expect(offerShown()).toBe(0);
    expect(getSwState().needRefresh).toBe(false);
  });

  it('stops checking once torn down', () => {
    vi.useFakeTimers();
    const { registration } = registered();
    resetController();
    setVisibility('visible');
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).not.toHaveBeenCalled();
    install(registration, 'installed');
    expect(offerShown()).toBe(0);
  });
});

describe('update bar', () => {
  it('shows "Update available" with a Reload key when a new version is waiting, and Reload applies it', async () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    render(<NoticesRegion />);
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();

    act(() => fake.options().onNeedRefresh?.());
    expect(useNoticeStore.getState().notices.map((n) => n.id)).toEqual([UPDATE_NOTICE_ID]);
    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(getSwState().needRefresh).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(fake.updateSW).toHaveBeenCalledWith(true);
    expect(getSwState().applying).toBe(true);
  });

  it('can be dismissed without losing the Settings entry', async () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    render(<NoticesRegion />);
    act(() => fake.options().onNeedRefresh?.());
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
    expect(getSwState().needRefresh).toBe(true);
  });

  it('gives the Reload key back if the waiting worker never takes over', async () => {
    vi.useFakeTimers();
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    act(() => fake.options().onNeedRefresh?.());
    await act(() => applyUpdate());
    expect(getSwState().applying).toBe(true);
    act(() => vi.advanceTimersByTime(6000));
    expect(getSwState()).toMatchObject({ applying: false, needRefresh: true });
  });

  it('reloads once when the new worker takes over a page that was already controlled', () => {
    const container = stubServiceWorker(undefined, {});
    const reload = vi.fn();
    startPwa({ registerSW: fakeRegister().registerSW, enabled: true, reload });
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first visit, when the worker merely claims the uncontrolled page; later updates do', () => {
    const container = stubServiceWorker(undefined, null);
    const reload = vi.fn();
    startPwa({ registerSW: fakeRegister().registerSW, enabled: true, reload });
    container.dispatchEvent(new Event('controllerchange')); // clientsClaim on first install
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange')); // an update takes over (workbox would report isUpdate=false here)
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once however many times the new worker reports taking control', () => {
    stubServiceWorker();
    const reload = vi.fn();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true, reload });
    fake.options().onNeedReload?.();
    fake.options().onNeedReload?.();
    expect(reloadOnce(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('Settings › Install', () => {
  it('offers the one-tap install when the browser has offered it, and runs the native dialog on tap', async () => {
    const stop = startInstallDetection(window);
    const e = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
    const prompt = vi.fn(() => Promise.resolve());
    Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    render(<InstallSettings />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: 'Install' })).toBeInTheDocument();
    // the server pairing and its ring wording are gone from Install (Settings › Server holds pairing)
    expect(screen.queryByText('Your server')).not.toBeInTheDocument();
    expect(screen.queryByText(/ring/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.getByText(/Look for Install or Add to Home Screen/)).toBeInTheDocument(); // jsdom's user agent is no known browser

    act(() => void window.dispatchEvent(e));
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState().phase).toBe('installed');
    expect(await screen.findByText('Installed')).toBeInTheDocument();
    stop();
  });

  it.each(['android', 'electron'] as const)('in the %s app the Settings index has no Install row (J2-03)', (p) => {
    setPlatformForTests(p);
    try {
      render(<SettingsIndex />, { wrapper: MemoryRouter });
      expect(screen.queryByRole('link', { name: /^Install/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^About/ })).toBeInTheDocument();
    } finally {
      setPlatformForTests(undefined);
    }
  });

  it('shows plain steps for Safari on iOS and for Firefox', () => {
    resetInstall({ platform: 'safari-ios', standalone: false });
    const { unmount } = render(<InstallSettings />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Tap the Share button, then Add to Home Screen/)).toBeInTheDocument();
    unmount();
    act(() => resetInstall({ platform: 'firefox', standalone: false }));
    render(<InstallSettings />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Firefox on a computer cannot install web apps/)).toBeInTheDocument();
  });

  it('offers Reload in Settings once an update is waiting', async () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    render(<InstallSettings />, { wrapper: MemoryRouter });
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    act(() => fake.options().onNeedRefresh?.());
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(fake.updateSW).toHaveBeenCalledWith(true);
  });
});
