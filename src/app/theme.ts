/**
 * Theme + motion bootstrap. Imported first in src/main.tsx and run before the
 * first render. public/theme-boot.js does the same synchronously in <head>
 * (CSP-safe external classic script) so nothing flashes before React paints.
 *
 * - Theme: Vitals is DARK ONLY (Ember, SPEC §1). <html> always carries
 *   data-theme="dark" and color-scheme: dark, whatever the stored setting, the
 *   OS preference or a `?theme=` query says. The attribute stays (rather than
 *   being removed) so any stylesheet or canvas reader that still checks
 *   [data-theme="dark"] keeps resolving to the one palette. tokens.css has no
 *   light palette to fall back to.
 * - Motion: 'on' → data-motion="reduce", 'off' → "full", 'system' → removed.
 *
 * applyTheme / resolveTheme / syncThemeColor / toggleTheme keep their names
 * and signatures for existing callers; they no longer switch anything.
 */
import { useSettingsStore, type MotionChoice, type ThemeChoice } from '@/state/settingsStore';

export type ResolvedTheme = 'dark';

/** The one theme, and the browser chrome colour that matches the backdrop (--lm-chassis). */
export const THEME: ResolvedTheme = 'dark';
export const THEME_COLOR = '#090909';

/** The theme actually shown: always dark. */
export function resolveTheme(_choice?: ThemeChoice): ResolvedTheme {
  return THEME;
}

/** Pin <html> to the dark theme and the browser theme-color. The choice is ignored (dark only). */
export function applyTheme(_choice?: ThemeChoice, _options: { animate?: boolean } = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', THEME);
  root.style.colorScheme = 'dark';
  syncThemeColor();
}

/** Keep one <meta name="theme-color"> equal to the backdrop so browser chrome matches. */
export function syncThemeColor(): void {
  if (typeof document === 'undefined') return;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    if (i > 0) m.remove();
  });
  let meta = metas[0] ?? null;
  if (!meta || !meta.isConnected) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.removeAttribute('media');
  meta.content = THEME_COLOR;
}

export function applyMotion(choice: MotionChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'on') root.setAttribute('data-motion', 'reduce');
  else if (choice === 'off') root.setAttribute('data-motion', 'full');
  else root.removeAttribute('data-motion');
}

let started = false;

/** Pin the dark theme now and keep data-motion in sync with the settings store. */
export function initTheme(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  applyTheme();
  applyMotion(useSettingsStore.getState().reduceMotion);

  const unsub = useSettingsStore.subscribe((next, prev) => {
    if (next.reduceMotion !== prev.reduceMotion) applyMotion(next.reduceMotion);
  });
  return () => {
    unsub();
    started = false;
  };
}

