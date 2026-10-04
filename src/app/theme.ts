/**
 * Theme + motion bootstrap. Imported first in src/main.tsx and run before the
 * first render, so <html data-theme> / data-motion are set before React paints.
 * public/theme-boot.js does the same synchronously in <head> (CSP-safe external
 * classic script) so even the chassis background never flashes.
 *
 * - Theme: 'system' removes data-theme (tokens.css follows the OS); 'light' /
 *   'dark' force it. `?theme=light|dark` in the URL overrides without saving
 *   (review deep links, like the prototype).
 * - Motion: 'on' → data-motion="reduce", 'off' → "full", 'system' → removed.
 */
import { useSettingsStore, type MotionChoice, type ThemeChoice } from '@/state/settingsStore';

export type ResolvedTheme = 'light' | 'dark';

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually shown for a choice. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersDark() ? 'dark' : 'light';
}

function urlOverride(): ResolvedTheme | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('theme');
  return q === 'light' || q === 'dark' ? q : null;
}

let fadeTimer: number | undefined;

/** Write data-theme and the browser theme-color. `animate` cross-fades surfaces (200 ms). */
export function applyTheme(choice: ThemeChoice, options: { animate?: boolean } = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const forced = urlOverride() ?? (choice === 'system' ? null : choice);
  if (options.animate) {
    root.classList.add('lm-theme-fading');
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => root.classList.remove('lm-theme-fading'), 260);
  }
  if (forced) root.setAttribute('data-theme', forced);
  else root.removeAttribute('data-theme');
  syncThemeColor();
}

/** Keep <meta name="theme-color"> equal to the chassis so browser chrome matches. */
export function syncThemeColor(): void {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--lm-chassis-2').trim();
  if (!color) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function applyMotion(choice: MotionChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'on') root.setAttribute('data-motion', 'reduce');
  else if (choice === 'off') root.setAttribute('data-motion', 'full');
  else root.removeAttribute('data-motion');
}

let started = false;

/** Apply the persisted choice now and keep <html> in sync with the settings store and the OS. */
export function initTheme(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  const s = useSettingsStore.getState();
  applyTheme(s.theme);
  applyMotion(s.reduceMotion);

  const unsub = useSettingsStore.subscribe((next, prev) => {
    if (next.theme !== prev.theme) applyTheme(next.theme, { animate: true });
    if (next.reduceMotion !== prev.reduceMotion) applyMotion(next.reduceMotion);
  });
  const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onOs = () => syncThemeColor();
  mql?.addEventListener('change', onOs);
  return () => {
    unsub();
    mql?.removeEventListener('change', onOs);
    started = false;
  };
}

/** Flip between light and dark from whatever is showing now (rail / top-bar theme key). */
export function toggleTheme(): void {
  const { theme, setTheme } = useSettingsStore.getState();
  setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark');
}
