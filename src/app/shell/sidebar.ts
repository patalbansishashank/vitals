/**
 * The desktop sidebar's state (SPEC §8.2): expanded (~240 px, icons and labels) or collapsed (a 64 px icon rail).
 *
 * - Per device: the person's last choice is kept in localStorage under `vitals-sidebar` (a device-only `vitals-` key,
 *   outside the `vitals.*` data keys, so it is never exported, imported or synced; erased with everything else). Every
 *   read and write is guarded, so blocked storage only means the choice lasts for the session.
 * - Until the person chooses, it follows the window: expanded from 1280 px (wide screens), collapsed from 1024 to
 *   1279 px so a laptop keeps its content column. Below 1024 px there is no sidebar (the phone dock), and nothing here
 *   applies.
 * - Toggled by the top bar's sidebar key and by Ctrl/⌘ + B (AppShell).
 */
import { create } from 'zustand';
import { MQ, useMediaQuery } from '@/components/lib/hooks';

/** localStorage key of the choice ('expanded' | 'collapsed'). */
export const SIDEBAR_KEY = 'vitals-sidebar';
/** The sidebar's element id (the toggle's aria-controls). */
export const SIDEBAR_ID = 'lm-sidebar';
/** The toggle's accessible name; its state is aria-expanded, so the name never changes. */
export const SIDEBAR_LABEL = 'Sidebar';

export type SidebarPref = 'expanded' | 'collapsed';

function readPref(): SidebarPref | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDEBAR_KEY);
    return v === 'expanded' || v === 'collapsed' ? v : null;
  } catch {
    return null;
  }
}

function writePref(pref: SidebarPref): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, pref);
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
}

/** The stored choice, or null while the person has not chosen (then the width decides). */
export const useSidebarPref = create<{ pref: SidebarPref | null }>()(() => ({ pref: readPref() }));

// another window of the app on this device changed it
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SIDEBAR_KEY || e.key === null) useSidebarPref.setState({ pref: readPref() });
  });
}

const wideNow = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MQ.xl).matches;

/** The effective state: the stored choice, else collapsed below 1280 px. */
export function useSidebarCollapsed(): boolean {
  const pref = useSidebarPref((s) => s.pref);
  const wide = useMediaQuery(MQ.xl);
  return pref ? pref === 'collapsed' : !wide;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const pref: SidebarPref = collapsed ? 'collapsed' : 'expanded';
  writePref(pref);
  useSidebarPref.setState({ pref });
}

export function toggleSidebar(): void {
  const { pref } = useSidebarPref.getState();
  const collapsed = pref ? pref === 'collapsed' : !wideNow();
  setSidebarCollapsed(!collapsed);
}

/** "⌘B" on Apple keyboards, "Ctrl+B" elsewhere (the toggle's tooltip). */
export function sidebarShortcut(): string {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/.test(p) ? '⌘B' : 'Ctrl+B';
}
