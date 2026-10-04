/*
 * Android app start (SUITE_SPEC §15.7), owned by L-ANDROID: saving files through the share sheet
 * (androidDownloads.ts), importing files shared to Vitals (androidIntake.ts), and the foreground service and ring
 * alerts that follow the ring service (androidRingLink.ts), and no service worker. Nothing on the web.
 *
 * Call once at app start, after the first render (src/main.tsx, after `createRoot(…).render(…)`):
 *
 *   void Promise.all([import('@/platform/androidBoot'), import('@/biometrics/service')]).then(([m, s]) =>
 *     m.installAndroidShell({ ringService: s.getRingService() }));
 */
import { onAndroid } from './androidShell';
import { installAndroidDownloads } from './androidDownloads';
import { installAndroidIntake } from './androidIntake';
import { installAndroidRingLink, type RingLinkSource } from './androidRingLink';
import { installAndroidScreen } from './androidScreen';

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

/** Install the Android-only file handling; returns the uninstall function (tests). */
export function installAndroidShell(deps: { ringService?: RingLinkSource } = {}): () => void {
  if (!onAndroid()) return () => {};
  void dropServiceWorker().catch(() => undefined);
  const screen = installAndroidScreen();
  const downloads = installAndroidDownloads();
  const intake = installAndroidIntake();
  const ringLink = deps.ringService ? installAndroidRingLink(deps.ringService) : () => {};
  return () => {
    ringLink();
    intake();
    downloads();
    screen();
  };
}
