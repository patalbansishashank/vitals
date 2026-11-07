/**
 * The person's monitor selection: the synced `settings.ringMonitor` list (SPEC A.1.3, A.1.7). An empty list shows the
 * default set and an "Add signals" key; V3 stores it as a list that starts empty, so a new person sees the same.
 */
import { useSettingsStore } from '@/state/settingsStore';

/** Store the selection. Null resets to the default set. */
export function setRingMonitor(ids: readonly string[] | null): void {
  useSettingsStore.getState().set({ ringMonitor: ids ? [...ids] : [] });
}

/** Tests: back to the default set. */
export function resetRingMonitorCache(): void {
  setRingMonitor(null);
}

/** The stored selection (never null now that the setting is synced; the type keeps the card's "never edited" branch). */
export function useRingMonitor(): string[] | null {
  return useSettingsStore((s) => s.ringMonitor);
}
