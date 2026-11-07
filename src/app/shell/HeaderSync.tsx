import { lazy, Suspense } from 'react';

// Loaded on its own so the shell's first chunk stays free of the sync code (main.tsx loads that after the first render).
const SyncStatusIcon = lazy(() => import('@/features/settings/sync/SyncPill').then((m) => ({ default: m.SyncStatusIcon })));

/**
 * The header's sync status icon (SUITE_SPEC §15.4, SPEC §9): Synced / Syncing / Offline · N waiting / Error, opening
 * Settings › Sync; nothing while sync is off. It counts toward the bar's two status icons (TopBar).
 */
export function HeaderSync() {
  return (
    <Suspense fallback={null}>
      <SyncStatusIcon />
    </Suspense>
  );
}
