import { useCallback, useState, useSyncExternalStore } from 'react';
import { getBodySaveStatus, subscribeBodySaveStatus } from '@/state/profileStore';

/** Autosave state for the context bar: 'saved' | 'saving' | 'unavailable'. */
export function useSaveStatus() {
  return useSyncExternalStore(subscribeBodySaveStatus, getBodySaveStatus, getBodySaveStatus);
}

/**
 * Screen-reader snapshot that holds still while a gesture is live (your-body.md §9: the figure's name and the
 * estimates live region update on release, not every frame). `live()` freezes the last committed snapshot on the
 * first frame of a drag; `commit()` releases it. Keyboard steps call both in one tick, so they announce at once.
 */
export function useCommittedSnapshot<T>(current: T) {
  const [frozen, setFrozen] = useState<{ value: T } | null>(null);
  const live = useCallback(() => setFrozen((f) => f ?? { value: current }), [current]);
  const commit = useCallback(() => setFrozen(null), []);
  return { value: frozen ? frozen.value : current, live, commit, dragging: frozen !== null };
}
