import { useEffect, useSyncExternalStore } from 'react';
import { Key } from '@/components/Key';
import { detectPlatform } from '@/platform/detect';
import {
  applyWebUpdate,
  checkUpdatesNow,
  downloadOfferedUpdate,
  getUpdatesView,
  installUpdate,
  subscribeUpdates,
  updateState,
  type UpdatesView,
} from '@/platform/androidUpdates';
import { ANDROID_UPDATE_NOTICE_ID, dismissNotice, showNotice } from './notices';

export type UpdateAction = 'install' | 'download' | 'apply' | 'retry-check';
export interface UpdateBannerState {
  title: string;
  body?: string;
  action?: UpdateAction;
  actionLabel?: string;
  busy?: boolean;
  /** Undefined outside a transfer; null for legacy native bridges without byte telemetry. */
  progress?: number | null;
}

/** The one state worth showing under the header, with APK work taking priority over a staged web refresh. */
export function androidUpdateBannerState(view: UpdatesView): UpdateBannerState | null {
  const { status, available, phase, error } = view;
  const state = updateState(view);
  const downloading = (): UpdateBannerState => ({
    title: view.progress?.phase === 'verifying' ? 'Preparing the update' : 'Downloading the update',
    busy: true,
    progress: view.progress ? Math.floor(view.progress.received / view.progress.total * 100) : null,
  });
  if (state === 'ready') {
    if (phase === 'checking' && !view.checked) return { title: 'Checking update…', busy: true };
    if (error === 'permission') return { title: 'Allow Vitals to install the update.', body: 'Android needs your permission before installation.', action: 'install', actionLabel: 'Try again' };
    if (error === 'install') return { title: "Couldn't open the installer.", action: 'install', actionLabel: 'Try again' };
    if (phase === 'installing') return { title: 'Opening the installer…', busy: true };
    return { title: 'Update ready', action: 'install', actionLabel: 'Install' };
  }
  if (state === 'available' && available) {
    if (phase === 'checking') return { title: 'Checking update…', busy: true };
    if (phase === 'downloading') return downloading();
    if (error === 'check' && view.checkSource === 'manual') return { title: "Couldn't check for updates.", action: 'retry-check', actionLabel: 'Try again' };
    if (error === 'download') return { title: "Couldn't download the update.", action: 'download', actionLabel: 'Try again' };
    return { title: 'Update available', action: 'download', actionLabel: 'Download' };
  }
  if (phase === 'downloading') return downloading();
  if (phase === 'error' && error === 'download') return { title: "Couldn't download the update.", action: 'retry-check', actionLabel: 'Try again' };
  if (status?.webPending) {
    if (!('canApplyWeb' in status && status.canApplyWeb === true)) return { title: 'An app update is needed.', body: 'Install the newer Vitals app to finish updating.' };
    if (error === 'apply') return { title: "Couldn't restart Vitals.", action: 'apply', actionLabel: 'Try again' };
    if (phase === 'applying') return { title: 'Restarting Vitals…', busy: true };
    return { title: 'Update ready', action: 'apply', actionLabel: 'Install' };
  }
  // Routine launch/foreground/offline checks are silent until a real transfer or an explicit user request.
  if (phase === 'error' && error === 'check' && view.checkSource === 'manual') return { title: "Couldn't check for updates.", action: 'retry-check', actionLabel: 'Try again' };
  return null;
}

export function performAndroidUpdateAction(action: UpdateAction): Promise<void> {
  const task = action === 'install' ? installUpdate
    : action === 'download' ? downloadOfferedUpdate
      : action === 'apply' ? applyWebUpdate : checkUpdatesNow;
  return task();
}

/** Android-only, persistent update notice. Boot checks provide its state; visiting Settings is never required. */
export function AndroidUpdateBanner() {
  const view = useSyncExternalStore(subscribeUpdates, getUpdatesView, getUpdatesView);
  const android = detectPlatform() === 'android';
  const banner = android ? androidUpdateBannerState(view) : null;
  const title = banner?.title;
  const body = banner?.body;
  const action = banner?.action;
  const actionLabel = banner?.actionLabel;
  const busy = banner?.busy;
  const progress = banner?.progress;
  useEffect(() => {
    if (!title) {
      dismissNotice(ANDROID_UPDATE_NOTICE_ID);
      return;
    }
    showNotice({
      id: ANDROID_UPDATE_NOTICE_ID,
      severity: 'caution',
      priority: 0,
      title: <span role="status">{title}</span>,
      body: progress === undefined ? body : <span className="lm-update-progress" aria-live="off">
        <progress className="lm-update-progress__track" max={100} value={progress ?? undefined} aria-label="Update download" />
        {progress !== null ? <span className="lm-update-progress__value">{progress}%</span> : null}
      </span>,
      announce: false,
      actions: action ? <Key size="sm" variant="primary" loading={busy} onClick={() => void performAndroidUpdateAction(action).catch(() => undefined)}>{actionLabel}</Key> : undefined,
    });
  }, [title, body, action, actionLabel, busy, progress]);
  useEffect(() => () => dismissNotice(ANDROID_UPDATE_NOTICE_ID), []);
  return null;
}
