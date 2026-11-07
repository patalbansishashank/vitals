import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTests } from '@/platform/detect';
import type { NativeUpdateStatus, UpdatesView } from '@/platform/androidUpdates';
import { UpdatesRow } from '@/features/settings/UpdatesRow';
import { AndroidUpdateBanner, androidUpdateBannerState } from '../AndroidUpdateBanner';
import { ANDROID_UPDATE_NOTICE_ID, NoticesRegion, showNotice, useNoticeStore } from '../notices';

const fake = vi.hoisted(() => ({
  view: null as UpdatesView | null,
  listeners: new Set<() => void>(),
  install: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
  apply: vi.fn(async () => {}),
  check: vi.fn(async () => {}),
  agent: false,
  stop: vi.fn(),
}));

vi.mock('@/agents/activity', () => ({ useAgentActive: () => fake.agent, stopAgents: fake.stop }));
vi.mock('@/features/lib/sendCommand', () => ({ sendCommand: vi.fn(async () => {}) }));

vi.mock('@/platform/androidUpdates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUpdatesView: () => fake.view,
  subscribeUpdates: (listener: () => void) => { fake.listeners.add(listener); return () => void fake.listeners.delete(listener); },
  installUpdate: fake.install,
  downloadOfferedUpdate: fake.download,
  applyWebUpdate: fake.apply,
  checkUpdatesNow: fake.check,
  refreshUpdates: vi.fn(async () => {}),
}));

const status = (patch: Partial<NativeUpdateStatus> = {}): NativeUpdateStatus => ({
  versionName: '0.7.5', versionCode: 705, webVersion: 'current', webEmbedded: true,
  webPending: null, bad: [], metered: false, apk: null, canApplyWeb: false, ...patch,
});
const base = (patch: Partial<UpdatesView> = {}): UpdatesView => ({
  status: status(), available: null, checked: true, phase: 'idle', error: null,
  downloadKind: null, lastCheckedAt: null, checkSource: 'automatic', progress: null, ...patch,
});
const offer = { versionName: '0.7.6', versionCode: 706, sha256: '0'.repeat(64), size: 50_000_000, url: 'https://example.test/vitals.apk' };

function publish(next: UpdatesView) {
  act(() => { fake.view = next; fake.listeners.forEach((listener) => listener()); });
}

function mount() {
  return render(<MemoryRouter><AndroidUpdateBanner /><NoticesRegion /></MemoryRouter>);
}

beforeEach(() => {
  setPlatformForTests('android');
  fake.view = base();
  fake.agent = false;
  fake.stop.mockClear();
  fake.listeners.clear();
  fake.install.mockClear(); fake.download.mockClear(); fake.apply.mockClear(); fake.check.mockClear();
  act(() => useNoticeStore.setState({ notices: [] }));
});
afterEach(() => {
  setPlatformForTests(undefined);
  act(() => useNoticeStore.setState({ notices: [] }));
  document.documentElement.style.removeProperty('--lm-update-notice-h');
});

describe('AndroidUpdateBanner', () => {
  it('shows available and ready updates on any page, preserving an active agent Stop key', async () => {
    const { rerender } = mount();
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    act(() => showNotice({ id: 'quiet-info', severity: 'info', title: 'Quiet information' }));
    publish(base({ available: offer }));
    const region = screen.getByRole('region', { name: 'Notices' });
    expect(region).toHaveAttribute('data-android-update', 'true');
    expect(within(region).getByText('Update available')).toBeInTheDocument();
    expect(within(region).queryByText('Download the new Vitals app.')).toBeNull();
    expect(within(region).getByRole('button', { name: 'Download' })).toHaveAttribute('data-variant', 'primary');
    expect(within(region).queryByText('Quiet information')).toBeNull();
    fake.agent = true;
    rerender(<MemoryRouter><AndroidUpdateBanner /><NoticesRegion /></MemoryRouter>);
    expect(await within(region).findByText('Update available')).toBeInTheDocument();
    const stop = within(region).getByRole('button', { name: /Stop agents/ });
    expect(stop).toBeInTheDocument();
    fireEvent.click(stop);
    expect(fake.stop).toHaveBeenCalledOnce();
    fireEvent.click(within(region).getByRole('button', { name: 'Download' }));
    expect(fake.download).toHaveBeenCalledOnce();

    publish(base({ status: status({ apk: { versionName: '0.7.6', versionCode: 706 } }) }));
    expect(within(region).getByText('Update ready')).toBeInTheDocument();
    expect(within(region).queryByText('Install the new Vitals app when you’re ready.')).toBeNull();
    expect(within(region).getByRole('button', { name: /Stop agents/ })).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Install' }));
    expect(fake.install).toHaveBeenCalledOnce();
    expect(useNoticeStore.getState().notices[0]?.id).toBe(ANDROID_UPDATE_NOTICE_ID);
    act(() => showNotice({ id: 'urgent', severity: 'danger', title: 'Urgent notice' }));
    expect(region).not.toHaveAttribute('data-android-update');
  });

  it('keeps download progress and failure visible, then offers the safe retry', () => {
    mount();
    publish(base({ available: offer, phase: 'checking' }));
    expect(screen.getByText('Checking update…')).toBeInTheDocument();
    publish(base({ available: offer, phase: 'downloading', downloadKind: 'apk' }));
    expect(screen.getByText('Downloading the update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    publish(base({ available: offer, phase: 'error', error: 'download' }));
    expect(screen.getByText("Couldn't download the update.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.download).toHaveBeenCalledOnce();
    publish(base({ available: offer, phase: 'error', error: 'check', checkSource: 'manual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.check).toHaveBeenCalledOnce();
    fake.check.mockClear();
    publish(base({ phase: 'error', error: 'check', checkSource: 'manual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.check).toHaveBeenCalledOnce();
  });

  it('offers a real staged update restart only when the native app can apply it', () => {
    mount();
    publish(base({ status: status({ webPending: 'new', canApplyWeb: true }) }));
    expect(screen.getByText('Update ready')).toBeInTheDocument();
    expect(screen.queryByText('Restart Vitals to finish updating.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(fake.apply).toHaveBeenCalledOnce();
    publish(base({ status: status({ webPending: 'new', canApplyWeb: false }) }));
    expect(screen.getByText('An app update is needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    publish(base({ status: status({ webPending: 'new', canApplyWeb: false }), phase: 'error', error: 'check' }));
    expect(screen.getByText('An app update is needed.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't check for updates.")).toBeNull();
  });

  it('shows real progress, an honest legacy indeterminate state, and no Install before verification', () => {
    mount();
    publish(base({ available: offer, phase: 'downloading', downloadKind: 'apk' }));
    expect(screen.getByRole('progressbar', { name: 'Update download' })).not.toHaveAttribute('value');
    publish(base({ available: offer, phase: 'downloading', downloadKind: 'apk', progress: { received: 420, total: 1000, phase: 'downloading' } }));
    expect(screen.getByRole('progressbar', { name: 'Update download' })).toHaveAttribute('value', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('42%').closest('[aria-live]')).toHaveAttribute('aria-live', 'off');
    publish(base({ available: offer, phase: 'downloading', downloadKind: 'apk', progress: { received: 1000, total: 1000, phase: 'verifying' } }));
    expect(screen.getByText('Preparing the update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    publish(base({ status: status({ apk: { versionName: '0.7.6', versionCode: 706 } }) }));
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('does not publish automatic no-update or check failures as global notices', () => {
    mount();
    publish(base({ checked: false, phase: 'error', error: 'check' }));
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    publish(base({ checked: true }));
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    publish(base({ checked: false, phase: 'error', error: 'check', checkSource: 'manual' }));
    expect(screen.getByText("Couldn't check for updates.")).toBeInTheDocument();
  });

  it('does not let an older staged web bundle hide a newer transfer or its failure', () => {
    mount();
    const pending = status({ webPending: 'web-A', canApplyWeb: true });
    publish(base({ status: pending, phase: 'downloading', downloadKind: 'web', progress: { received: 500, total: 1000, phase: 'downloading' } }));
    expect(screen.getByText('Downloading the update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    publish(base({ status: pending, phase: 'error', error: 'download' }));
    expect(screen.getByText("Couldn't download the update.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.check).toHaveBeenCalledOnce();
  });

  it('does not replace an unchanged ready notice on routine status refresh', () => {
    mount();
    const ready = base({ status: status({ apk: { versionName: '0.7.6', versionCode: 706 } }) });
    publish(ready);
    const changed = vi.fn();
    const off = useNoticeStore.subscribe(changed);
    publish({ ...ready, status: { ...ready.status! }, lastCheckedAt: 123 });
    expect(changed).not.toHaveBeenCalled();
    off();
  });

  it('measures only the pinned update and removes its scroll offset when hidden or unmounted', () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lm-notices') ? { height: 72 } as DOMRect : original.call(this);
    });
    try {
      const { unmount } = mount();
      publish(base({ available: offer }));
      expect(document.documentElement.style.getPropertyValue('--lm-update-notice-h')).toBe('72px');
      act(() => showNotice({ id: 'urgent', severity: 'danger', title: 'Urgent notice' }));
      expect(document.documentElement.style.getPropertyValue('--lm-update-notice-h')).toBe('');
      act(() => useNoticeStore.getState().dismiss('urgent'));
      expect(document.documentElement.style.getPropertyValue('--lm-update-notice-h')).toBe('72px');
      unmount();
      expect(document.documentElement.style.getPropertyValue('--lm-update-notice-h')).toBe('');
    } finally { rect.mockRestore(); }
  });

  it('stays absent on web and desktop and does not show routine checking', () => {
    const { rerender } = mount();
    publish(base({ phase: 'checking', checked: false }));
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    for (const platform of ['web', 'electron'] as const) {
      setPlatformForTests(platform);
      rerender(<MemoryRouter><AndroidUpdateBanner /><NoticesRegion /></MemoryRouter>);
      publish(base({ available: offer }));
      expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    }
  });

  it('keeps the Settings row secondary but consistent with a phone update failure', () => {
    publish(base({ available: offer, phase: 'error', error: 'download' }));
    render(<MemoryRouter><UpdatesRow /></MemoryRouter>);
    expect(screen.getAllByText("Couldn't download the update.")).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.download).toHaveBeenCalledOnce();
  });
});

describe('update banner state', () => {
  it('keeps a ready APK ahead of a staged web update and says permission failures plainly', () => {
    const ready = base({ status: status({ apk: { versionName: '0.7.6', versionCode: 706 }, webPending: 'new', canApplyWeb: false }) });
    expect(androidUpdateBannerState(ready)?.action).toBe('install');
    expect(androidUpdateBannerState({ ...ready, phase: 'error', error: 'permission' })).toMatchObject({ action: 'install', actionLabel: 'Try again' });
    const newerOffer = base({ status: status({ apk: { versionName: '0.7.4', versionCode: 704 } }), available: offer });
    expect(androidUpdateBannerState(newerOffer)?.action).toBe('download');
    const downloading = androidUpdateBannerState({ ...newerOffer, phase: 'downloading', downloadKind: 'apk' });
    expect(downloading?.title).toBe('Downloading the update');
    expect(downloading?.action).toBeUndefined();
    const firstCheck = { ...ready, checked: false, phase: 'checking' as const };
    expect(androidUpdateBannerState(firstCheck)).toMatchObject({ title: 'Checking update…', busy: true });
    expect(androidUpdateBannerState(firstCheck)?.action).toBeUndefined();
    expect(androidUpdateBannerState({ ...firstCheck, phase: 'error', error: 'check' })?.action).toBe('install');
  });
});
