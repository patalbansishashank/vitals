import { createContext, useContext } from 'react';

export interface BackTarget {
  /** Route to go back to. Omit to go back in history (falls back to Today when the screen has no history behind it). */
  to?: string;
  /** Where it goes, for the accessible name: "Back to Evidence". */
  label?: string;
  /**
   * Only below 1024 px (screens that are top-level on desktop, e.g. Settings): the desktop header shows no Back and
   * uses the tab-page title.
   */
  mobileOnly?: boolean;
  /**
   * A way out of a focused flow rather than a step back (a first-run setup step whose own keys go back a step): the
   * key shows ✕ and is named "Close <label>". It goes where Back would.
   */
  close?: boolean;
}

export interface ShellContextValue {
  /** DOM node inside the sticky header at the top of the content column (TopBar portals its header here). */
  contextSlot: HTMLElement | null;
  /**
   * DOM node after the screen's content, in the page flow (ActionBar portals its row here). It docks at the bottom of
   * the screen only on phones for a screen without the tab bar (`useChromeless`).
   */
  actionSlot: HTMLElement | null;
  setActionBarCount: (delta: 1 | -1) => void;
  /** Screens that run without the tab bar (first-run intake) register here; see `useChromeless`. */
  setChromelessCount?: (delta: 1 | -1) => void;
  /** A mounted TopBar registers here, so the shell knows to drop its own fallback header (the ⋯ alone). */
  setHeaderCount?: (delta: 1 | -1) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
