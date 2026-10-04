/*
 * Which shell this copy of Vitals runs in. Decided once, then frozen (tests may force it).
 * Order: the desktop preload bridge, the Capacitor Android shell, an installed PWA, else the website.
 */

export type Platform = 'web' | 'pwa' | 'electron' | 'android';

interface ShellGlobals {
  vitalsDesktop?: unknown;
  Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
}

function isStandalone(win: Window): boolean {
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  // `standalone` only, as in src/app/pwa/install.ts: `fullscreen` also matches F11 in an ordinary tab
  return iosStandalone || win.matchMedia?.('(display-mode: standalone)').matches === true;
}

function read(): Platform {
  if (typeof window === 'undefined') return 'web';
  const shell = window as Window & ShellGlobals;
  if (shell.vitalsDesktop) return 'electron';
  const cap = shell.Capacitor;
  if (cap?.isNativePlatform?.() === true && cap.getPlatform?.() === 'android') return 'android';
  if (isStandalone(window)) return 'pwa';
  return 'web';
}

let frozen: Platform | undefined;

export function detectPlatform(): Platform {
  frozen ??= read();
  return frozen;
}

/** Tests only: force a platform, or pass `undefined` to detect again. */
export function setPlatformForTests(p: Platform | undefined): void {
  frozen = p;
}
