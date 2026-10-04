/**
 * "Couldn't save that change; it was undone." — the screen side of a rolled-back ChangeSet (src/commands/history.ts):
 * when the document store refuses a write (quota, an IndexedDB error), the bus puts the screens back and emits
 * `commitFailed` with `rolledBack: true`; this shows its plain-language notice as a toast (one at a time: a second
 * failure replaces the first). Nothing to act on, so a toast rather than a notice. Mounted once by the app shell.
 *
 * The bus is loaded lazily: the shell is in the main chunk and must not pull the command bus into it. A failure can only
 * happen after a command ran, and every command loads the bus first.
 */
import type { ReactNode } from 'react';
import { toast as showToast, type ToastOptions } from '@/components/Toast';
import { SAVE_FAILED_NOTICE, type BusEvent } from '@/commands/types';

export const SAVE_FAILED_TOAST_ID = 'save-failed';

/** The bus's `on`, loaded on first use. */
function lazyOn(listener: (e: BusEvent) => void): () => void {
  let off: (() => void) | null = null;
  let stopped = false;
  void import('@/commands/bus').then((m) => {
    if (!stopped) off = m.on(listener);
  });
  return () => {
    stopped = true;
    off?.();
  };
}

export function startSaveFailureNotices(
  toast: (message: ReactNode, options?: ToastOptions) => string = showToast,
  subscribe: (listener: (e: BusEvent) => void) => () => void = lazyOn,
): () => void {
  return subscribe((e) => {
    if (e.type !== 'commitFailed' || !e.rolledBack) return;
    toast(e.notice ?? SAVE_FAILED_NOTICE, { id: SAVE_FAILED_TOAST_ID, duration: 8000 });
  });
}
