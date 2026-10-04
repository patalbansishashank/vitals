import { lazy, Suspense } from 'react';

// Loaded on its own so the shell's first chunk stays free of the sync code (main.tsx loads that after the first render).
const SyncPill = lazy(() => import('@/features/settings/sync/SyncPill').then((m) => ({ default: m.SyncPill })));

/** The header sync chip (SUITE_SPEC §15.4): Synced / Syncing / Offline · N waiting / Error; nothing while sync is off. */
export function HeaderSync() {
  return (
    <Suspense fallback={null}>
      <SyncPill />
    </Suspense>
  );
}
