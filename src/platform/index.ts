/*
 * Where this copy of Vitals is running; owned by L-WEB. Best-effort today: the desktop and Android shells will expose
 * their own marker, and this reads what they have now.
 */

export type Platform = 'web' | 'pwa' | 'electron' | 'android';

interface ShellGlobals {
  Capacitor?: { getPlatform?: () => string };
}

export function platform(): Platform {
  if (typeof window === 'undefined') return 'web';
  const shell = window as Window & ShellGlobals;
  if (shell.Capacitor?.getPlatform?.() === 'android') return 'android';
  if (/\bElectron\//.test(window.navigator.userAgent)) return 'electron';
  // `standalone` only, as in src/app/pwa/install.ts: `fullscreen` also matches F11 in an ordinary tab
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
  return 'web';
}
