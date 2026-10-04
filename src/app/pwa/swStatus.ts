import { useSyncExternalStore } from 'react';

/** Where offline support stands for this page (Settings › Install Vitals › offline). */
export type OfflineState =
  /** This browser has no service workers. */
  | 'unsupported'
  /** Supported, but no worker runs here: the dev server, or registration failed. */
  | 'unavailable'
  /** The worker is installing: the app is still being saved for offline use. */
  | 'preparing'
  /** An active worker holds the whole app: a reload with no network still opens it. */
  | 'ready';

export interface SwState {
  offline: OfflineState;
  /** A newer version is installed and waiting for the user to reload. */
  needRefresh: boolean;
  /** The user asked to apply the waiting version; the page reloads when it takes over. */
  applying: boolean;
  error: string | null;
}

export type SwAction =
  | { type: 'unsupported' }
  | { type: 'unavailable'; error?: string }
  | { type: 'registering' }
  | { type: 'ready' }
  | { type: 'need-refresh' }
  | { type: 'applying' }
  | { type: 'apply-failed' };

export function swReducer(state: SwState, action: SwAction): SwState {
  switch (action.type) {
    case 'unsupported':
      return { ...state, offline: 'unsupported', needRefresh: false, applying: false };
    case 'unavailable':
      return { ...state, offline: 'unavailable', error: action.error ?? null };
    case 'registering':
      return state.offline === 'ready' ? state : { ...state, offline: 'preparing', error: null };
    case 'ready':
      return { ...state, offline: 'ready', error: null };
    case 'need-refresh':
      // a worker only waits while an older one is active, so the app is already saved for offline use
      return { ...state, offline: 'ready', needRefresh: true, applying: false };
    case 'applying':
      return state.needRefresh ? { ...state, applying: true } : state;
    case 'apply-failed':
      return { ...state, applying: false };
  }
}

export function initialSwState(): SwState {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  return { offline: supported ? 'unavailable' : 'unsupported', needRefresh: false, applying: false, error: null };
}

let state: SwState = initialSwState();
const listeners = new Set<() => void>();

export function dispatchSw(action: SwAction): void {
  const next = swReducer(state, action);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export const getSwState = (): SwState => state;

export function subscribeSw(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSwState(): SwState {
  return useSyncExternalStore(subscribeSw, getSwState, getSwState);
}

/** Test seam. */
export function resetSw(): void {
  state = initialSwState();
  listeners.forEach((l) => l());
}
