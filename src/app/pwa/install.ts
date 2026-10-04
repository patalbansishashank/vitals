import { useSyncExternalStore } from 'react';

/**
 * Install hint state machine (Settings › Install Vitals).
 *
 * Chromium fires `beforeinstallprompt` once the page is installable; the app keeps that event so one tap can
 * show the native install dialog. Everywhere else (Safari, Firefox, Chromium before the event arrives) the hint
 * shows plain instructions. All transitions are the pure `installReducer`; the store below only feeds it
 * browser events. The event arrives early, before Settings mounts, so `startInstallDetection()` is called at
 * startup (src/app/pwa/index.ts) rather than from the screen.
 */

export type InstallPlatform = 'chromium' | 'safari-ios' | 'safari-mac' | 'firefox' | 'other';

export type InstallPhase =
  /** Running as an installed app, or the install just finished. */
  | 'installed'
  /** A native install prompt is on hold: one tap installs. */
  | 'promptable'
  /** The native install dialog is open. */
  | 'prompting'
  /** The user closed the native dialog; the held prompt is spent. */
  | 'declined'
  /** No prompt available: show the by-hand steps for this platform. */
  | 'manual';

export interface InstallState {
  phase: InstallPhase;
  platform: InstallPlatform;
  /** True while this window is the installed app itself (display-mode standalone). */
  standalone: boolean;
}

export type InstallEvent =
  | { type: 'prompt-available' }
  | { type: 'prompt-requested' }
  | { type: 'prompt-accepted' }
  | { type: 'prompt-dismissed' }
  | { type: 'installed' }
  | { type: 'display-mode'; standalone: boolean };

export function installReducer(state: InstallState, event: InstallEvent): InstallState {
  switch (event.type) {
    case 'prompt-available':
      // an installed app never gets offered itself again; otherwise a (new) prompt always wins over instructions
      return state.phase === 'installed' || state.phase === 'prompting' ? state : { ...state, phase: 'promptable' };
    case 'prompt-requested':
      return state.phase === 'promptable' ? { ...state, phase: 'prompting' } : state;
    case 'prompt-accepted':
      return state.phase === 'prompting' ? { ...state, phase: 'installed' } : state;
    case 'prompt-dismissed':
      return state.phase === 'prompting' ? { ...state, phase: 'declined' } : state;
    case 'installed':
      return { ...state, phase: 'installed' };
    case 'display-mode':
      if (event.standalone) return { ...state, phase: 'installed', standalone: true };
      return state.standalone ? { ...state, phase: 'manual', standalone: false } : state;
  }
}

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** Which install instructions apply. iPadOS reports a Mac user agent, so touch points give it away. */
export function detectInstallPlatform(nav: NavigatorLike): InstallPlatform {
  const ua = nav.userAgent;
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'safari-ios'; // every iOS browser installs through the Share sheet
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|Edg\/|OPR\/|SamsungBrowser\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari-mac';
  return 'other';
}

export function initialInstallState(env: { platform: InstallPlatform; standalone: boolean }): InstallState {
  return { phase: env.standalone ? 'installed' : 'manual', platform: env.platform, standalone: env.standalone };
}

/** The non-standard event Chromium fires when the page can be installed. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

// Only `standalone`: the manifest asks for it, and `fullscreen` would also match F11 in an ordinary browser tab.
const STANDALONE_QUERIES = ['(display-mode: standalone)'];

function isStandalone(win: Window): boolean {
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || STANDALONE_QUERIES.some((q) => win.matchMedia?.(q).matches === true);
}

function readEnv(win: Window): { platform: InstallPlatform; standalone: boolean } {
  return { platform: detectInstallPlatform(win.navigator), standalone: isStandalone(win) };
}

// ---- store ----------------------------------------------------------------------------------------------------

let state: InstallState = initialInstallState(typeof window === 'undefined' ? { platform: 'other', standalone: false } : readEnv(window));
let held: BeforeInstallPromptEvent | null = null;
let stopDetection: (() => void) | null = null;
const listeners = new Set<() => void>();

function dispatch(event: InstallEvent): void {
  const next = installReducer(state, event);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export const getInstallState = (): InstallState => state;

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, getInstallState, getInstallState);
}

/** Listen for the browser's install events. Idempotent; returns a function that stops listening. */
export function startInstallDetection(win: Window = window): () => void {
  if (stopDetection) return stopDetection;
  state = initialInstallState(readEnv(win));
  const onPrompt = (e: Event) => {
    e.preventDefault(); // hold it: no mini-infobar, the Settings key shows the dialog instead
    held = e as BeforeInstallPromptEvent;
    dispatch({ type: 'prompt-available' });
  };
  const onInstalled = () => {
    held = null;
    dispatch({ type: 'installed' });
  };
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);
  const queries = STANDALONE_QUERIES.map((q) => win.matchMedia?.(q)).filter((m): m is MediaQueryList => Boolean(m));
  const onMode = () => dispatch({ type: 'display-mode', standalone: isStandalone(win) });
  queries.forEach((m) => m.addEventListener?.('change', onMode));
  listeners.forEach((l) => l());
  stopDetection = () => {
    win.removeEventListener('beforeinstallprompt', onPrompt);
    win.removeEventListener('appinstalled', onInstalled);
    queries.forEach((m) => m.removeEventListener?.('change', onMode));
    stopDetection = null;
  };
  return stopDetection;
}

/** Show the native install dialog (only when a prompt is held). Resolves once the user has answered. */
export async function requestInstall(): Promise<void> {
  const event = held;
  if (!event || state.phase !== 'promptable') return;
  held = null; // a prompt can be used once
  dispatch({ type: 'prompt-requested' });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    dispatch({ type: choice.outcome === 'accepted' ? 'prompt-accepted' : 'prompt-dismissed' });
  } catch {
    dispatch({ type: 'prompt-dismissed' });
  }
}

/** Test seam: forget everything and start from a given environment. */
export function resetInstall(env?: { platform: InstallPlatform; standalone: boolean }): void {
  stopDetection?.();
  held = null;
  state = initialInstallState(env ?? readEnv(window));
  listeners.forEach((l) => l());
}
