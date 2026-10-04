import { vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { setPlatformForTests } from '@/platform';
import { NoticesRegion, useNoticeStore } from '@/app/shell/notices';
import { applyUpdate, reloadOnce, resetController, startPwa, type RegisterSW } from '../controller';
import { InstallSection } from '../InstallSection';
import { getInstallState, resetInstall, startInstallDetection, type BeforeInstallPromptEvent } from '../install';
import { getSwState, resetSw, swReducer, type SwState } from '../swStatus';
import { UPDATE_NOTICE_ID } from '../updateNotice';

const syncState = vi.hoisted(() => ({ paired: false }));
vi.mock('@/state/sync', () => ({ useSyncView: () => ({ paired: syncState.paired }) }));

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

describe('Settings › Install Vitals', () => {
  it('offers the one-tap install when the browser has offered it, and runs the native dialog on tap', async () => {
    const stop = startInstallDetection(window);
    const e = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
    const prompt = vi.fn(() => Promise.resolve());
    Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    render(<InstallSection />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByText('Your server')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pair a server' })).toHaveAttribute('href', '/settings/server');
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.getByText(/Look for Install or Add to Home Screen/)).toBeInTheDocument(); // jsdom's user agent is no known browser

    act(() => void window.dispatchEvent(e));
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState().phase).toBe('installed');
    expect(await screen.findByText('installed')).toBeInTheDocument();
    stop();
  });

  it.each(['android', 'electron'] as const)('in the %s app says installed, with no browser steps and no offline status (J2-03)', (p) => {
    setPlatformForTests(p);
    try {
      resetInstall({ platform: 'chromium', standalone: false });
      const { container } = render(<InstallSection />, { wrapper: MemoryRouter });
      expect(screen.getByText('installed')).toBeInTheDocument();
      expect(screen.queryByText('not installed')).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/browser menu|Add to Home screen|not active here|offline/i);
    } finally {
      setPlatformForTests(undefined);
    }
  });

  it('shows plain steps for Safari on iOS and for Firefox', () => {
    resetInstall({ platform: 'safari-ios', standalone: false });
    const { unmount } = render(<InstallSection />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Tap the Share button, then Add to Home Screen/)).toBeInTheDocument();
    unmount();
    act(() => resetInstall({ platform: 'firefox', standalone: false }));
    render(<InstallSection />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Firefox on a computer cannot install web apps/)).toBeInTheDocument();
  });

  it('says "Works offline after the first visit" with the live state of the worker', () => {
    render(<InstallSection />, { wrapper: MemoryRouter });
    expect(screen.getByText('Works offline after the first visit.')).toBeInTheDocument();
    expect(screen.getByText('not supported by this browser')).toBeInTheDocument(); // jsdom: no service workers

    stubServiceWorker();
    const fake = fakeRegister();
    act(() => startPwa({ registerSW: fake.registerSW, enabled: true }));
    expect(screen.getByText('saving for offline use…')).toBeInTheDocument();
    act(() => fake.options().onOfflineReady?.());
    expect(screen.getByText('ready on this device')).toBeInTheDocument();
  });

  it('with sync on, says the data stays on your devices and that offline changes sync later', () => {
    syncState.paired = true;
    try {
      const stop = startInstallDetection(window);
      act(() => void window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' as const }) })));
      render(<InstallSection />, { wrapper: MemoryRouter });
      expect(screen.getByText(/Your data stays on your devices either way/)).toBeInTheDocument();
      expect(screen.queryByText(/stays on this device/)).not.toBeInTheDocument();
      expect(screen.getByText(/Changes made offline sync when you're back online/)).toBeInTheDocument();
      stop();
    } finally {
      syncState.paired = false;
    }
  });

  it('offers Reload in Settings once an update is waiting', async () => {
    stubServiceWorker();
    const fake = fakeRegister();
    startPwa({ registerSW: fake.registerSW, enabled: true });
    render(<InstallSection />, { wrapper: MemoryRouter });
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    act(() => fake.options().onNeedRefresh?.());
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(fake.updateSW).toHaveBeenCalledWith(true);
  });
});
