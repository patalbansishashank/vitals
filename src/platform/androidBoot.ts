/*
 * Android app start (SUITE_SPEC §15.7), owned by L-ANDROID: saving files through the share sheet
 * (androidDownloads.ts), no service worker, and app updates from the home server (androidUpdates.ts): the web bundle
 * confirms it started (`ready()` after the first render) and the update checks begin. Nothing on the web.
 *
 * Call once at app start, after the first render (src/main.tsx, after `createRoot(…).render(…)`):
 *
 *   void import('@/platform/androidBoot').then((m) => m.installAndroidShell());
 */
import { onAndroid } from './androidShell';
import { installAndroidDownloads } from './androidDownloads';
import { markWebReady, startUpdateChecks } from './androidUpdates';
import { startGaugeEngine } from '@/state/gaugeEngine';

const SW_RELOAD_KEY = 'vitals.android.swReload';

/**
 * The APK leaves the web build's service worker out (apps/android build.gradle), but a phone that ran an earlier build
 * may still have one serving that build's files. Unregister it, drop its caches, and reload once if it served this page.
 */
export async function dropServiceWorker(): Promise<void> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw?.getRegistrations) return;
  const regs = await sw.getRegistrations();
  if (!regs.length) return;
  await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // the worker is gone; stale caches are harmless without it
  }
  if (sw.controller && reloadOnce()) location.reload();
}

/** True the first time in this session, and only if the mark was kept (no reload loop without storage). */
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(SW_RELOAD_KEY) === '1') return false;
    sessionStorage.setItem(SW_RELOAD_KEY, '1');
    return sessionStorage.getItem(SW_RELOAD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Calls `cb` once the app root shows something (the first render has committed and painted), checking every frame. A
 * bundle that never renders never calls it, and the native side rolls it back.
 */
export function whenRendered(cb: () => void, root: () => Element | null = () => document.getElementById('root')): () => void {
  let frame = 0;
  let done = false;
  const tick = () => {
    if (done) return;
    if ((root()?.childElementCount ?? 0) > 0) {
      done = true;
      cb();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    done = true;
    cancelAnimationFrame(frame);
  };
}

/** Install the Android-only file handling and updates; returns the uninstall function (tests). */
export function installAndroidShell(): () => void {
  if (!onAndroid()) return () => {};
  void dropServiceWorker().catch(() => undefined);
  const stopReady = whenRendered(markWebReady);
  const stopChecks = startUpdateChecks();
  const stopDownloads = installAndroidDownloads();
  // (r070) the ring engine inside Vitals: read its state and hand it the paired server (no-op without the plugin)
  const stopEngine = startGaugeEngine();
  return () => {
    stopEngine();
    stopReady();
    stopChecks();
    stopDownloads();
  };
}
