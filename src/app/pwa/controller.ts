import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { dispatchSw } from './swStatus';
import { showUpdateNotice } from './updateNotice';

/** The shape of `registerSW` from `virtual:pwa-register`, injected so the logic here is testable without a browser. */
export type RegisterSW = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

/** How long to wait for a waiting worker to take over before giving the Reload key back. */
const APPLY_TIMEOUT_MS = 6000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloading = false;
let applyTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Reload the page at most once per page life. A new worker taking control is reported twice over: by the
 * browser's own `controllerchange` (listened to in `startPwa`) and by workbox as "controlling" (once per
 * re-armed update prompt). Every one of those must collapse to a single reload.
 */
export function reloadOnce(reload: () => void = () => window.location.reload()): boolean {
  if (reloading) return false;
  reloading = true;
  clearTimeout(applyTimer);
  reload();
  return true;
}

/** The user chose "Reload": tell the waiting worker to take over. The page reloads when it does. */
export async function applyUpdate(): Promise<void> {
  if (!updateSW) return;
  dispatchSw({ type: 'applying' });
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => dispatchSw({ type: 'apply-failed' }), APPLY_TIMEOUT_MS);
  try {
    await updateSW(true);
  } catch {
    clearTimeout(applyTimer);
    dispatchSw({ type: 'apply-failed' });
  }
}

export interface StartPwaOptions {
  registerSW: RegisterSW;
  /** False on the dev server: no worker there (stale caches make development miserable). */
  enabled: boolean;
  /** Replaces `location.reload()` (tests). */
  reload?: () => void;
}

/**
 * Register the worker once the page has loaded and wire its lifecycle to the status store and the update
 * notice. Registration happens on window load (`immediate: false`), so it never competes with first paint.
 */
export function startPwa({ registerSW, enabled, reload }: StartPwaOptions): void {
  if (!('serviceWorker' in navigator)) {
    dispatchSw({ type: 'unsupported' });
    return;
  }
  if (!enabled) {
    dispatchSw({ type: 'unavailable' });
    return;
  }
  dispatchSw({ type: 'registering' });
  // The reload after an update hangs on `controllerchange` here, not only on workbox's "controlling" event:
  // workbox reports that with isUpdate=false for a page that started life uncontrolled (the first visit, with
  // clientsClaim), and such a tab would be left running old code against a worker that has dropped its chunks.
  // The first change on an uncontrolled page is the worker claiming it, not an update.
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    reloadOnce(reload);
  });
  updateSW = registerSW({
    immediate: false,
    onOfflineReady: () => dispatchSw({ type: 'ready' }),
    onNeedRefresh: () => {
      dispatchSw({ type: 'need-refresh' });
      showUpdateNotice(() => void applyUpdate());
    },
    onNeedReload: () => void reloadOnce(reload),
    onRegisteredSW: (_url, registration) => {
      if (registration?.active) dispatchSw({ type: 'ready' });
    },
    onRegisterError: (error) => dispatchSw({ type: 'unavailable', error: error instanceof Error ? error.message : String(error) }),
  });
  // An active worker means installing (the precache) finished: this also covers every visit after the first.
  void navigator.serviceWorker.ready.then(() => dispatchSw({ type: 'ready' }));
}

/** Test seam. */
export function resetController(): void {
  updateSW = null;
  reloading = false;
  clearTimeout(applyTimer);
}
