import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { dispatchSw } from './swStatus';
import { showUpdateNotice } from './updateNotice';

/** The shape of `registerSW` from `virtual:pwa-register`, injected so the logic here is testable without a browser. */
export type RegisterSW = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

/** How long to wait for a waiting worker to take over before giving the Reload key back. */
const APPLY_TIMEOUT_MS = 6000;
/** How often an open page asks the server for a new worker (an installed app can stay open for days). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloading = false;
let applyTimer: ReturnType<typeof setTimeout> | undefined;
let stopUpdateChecks: (() => void) | null = null;

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

type WatchedRegistration = Pick<ServiceWorkerRegistration, 'update' | 'installing' | 'waiting' | 'addEventListener' | 'removeEventListener'>;

/**
 * The browser looks for a new worker only on navigation, so an installed app or a tab left open would never hear of
 * a release. Ask again whenever the page comes back into view and hourly while it stays open.
 *
 * A worker found this way is announced here, not left to workbox alone: workbox stops listening for new workers after
 * the first one it sees, so if that one failed to install (a precache fetch dropped on a phone network) the next,
 * good one would wait unannounced until the next cold start. `onWaiting` is called once per waiting worker, and only
 * on a page a worker already controls (the first install activates straight away; it is not an update).
 */
export function watchForUpdates(registration: WatchedRegistration, onWaiting: () => void, doc: Document = document): () => void {
  let announced: ServiceWorker | null = null;
  const announce = () => {
    const waiting = registration.waiting;
    if (!waiting || waiting === announced || !navigator.serviceWorker?.controller) return;
    announced = waiting;
    onWaiting();
  };
  const check = () => {
    // one found earlier may have finished installing while nobody was looking
    announce();
    // a worker already installing will report itself; offline the fetch can only fail
    if (registration.installing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    void registration.update().catch(() => undefined);
  };
  const onFound = () => {
    const worker = registration.installing;
    if (!worker) return;
    const onState = () => {
      if (worker.state === 'installed') announce();
      if (worker.state !== 'installing') worker.removeEventListener('statechange', onState);
    };
    worker.addEventListener('statechange', onState);
  };
  const onVisible = () => {
    if (doc.visibilityState === 'visible') check();
  };
  registration.addEventListener('updatefound', onFound);
  doc.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, UPDATE_CHECK_MS);
  return () => {
    registration.removeEventListener('updatefound', onFound);
    doc.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
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

/** A new worker is waiting: say so, and let "Reload" hand over to it. */
function needRefresh(): void {
  dispatchSw({ type: 'need-refresh' });
  showUpdateNotice(() => void applyUpdate());
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
    onNeedRefresh: needRefresh,
    onNeedReload: () => void reloadOnce(reload),
    onRegisteredSW: (_url, registration) => {
      if (registration?.active) dispatchSw({ type: 'ready' });
      if (registration) {
        stopUpdateChecks?.();
        stopUpdateChecks = watchForUpdates(registration, needRefresh);
      }
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
  stopUpdateChecks?.();
  stopUpdateChecks = null;
}
