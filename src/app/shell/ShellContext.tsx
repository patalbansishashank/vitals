import { createContext, useContext } from 'react';

export interface BackTarget {
  /** Route to go back to. Omit to go back in history (falls back to "/"). */
  to?: string;
  /** Where it goes, for the label: "Back to Evidence". Shown beside the chevron on mobile. */
  label?: string;
  /** Only on mobile (screens that are top-level on desktop, e.g. Settings). */
  mobileOnly?: boolean;
}

/** What the mobile top bar shows instead of the wordmark. */
export interface MobileHeader {
  back: BackTarget | null;
  /** Screen title shown in the top bar when the screen asks for a compact header. */
  title: string | null;
}

export interface ShellContextValue {
  /** DOM node of the sticky per-screen context bar (TopBar portals here). */
  contextSlot: HTMLElement | null;
  /** DOM node of the action bar at the foot of the screen (ActionBar portals here; on desktop also the TopBar's params and actions). */
  actionSlot: HTMLElement | null;
  setMobileHeader: (h: MobileHeader | null) => void;
  setActionBarCount: (delta: 1 | -1) => void;
  /** Screens that run without the tab bar (first-run intake) register here; see `useChromeless`. */
  setChromelessCount?: (delta: 1 | -1) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
