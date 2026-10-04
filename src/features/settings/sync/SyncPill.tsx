import { Link } from 'react-router';
import { Chip } from '@/components';
import { useSyncStatus } from '@/state/sync';
import type { SyncStatus } from '@/sync/types';
import { describePill } from './status';

/**
 * The sync state in a few words, linking to Settings › Sync: `Synced`, `Syncing`, `Offline · 3 waiting`,
 * `Error · <reason>`. Nothing when sync is off. This is the presentational part (a place that already holds the status
 * passes it in); `SyncPill` reads the live status.
 */
export function SyncPillView({ status, className }: { status: SyncStatus; className?: string }) {
  const pill = describePill(status);
  if (!pill) return null;
  return (
    <span role="status" className={className ?? 'inline-flex'}>
      <span className="lm-sr">Sync: </span>
      <Link to="/settings/sync" className="inline-flex no-underline" title={pill.title}>
        <Chip kind="status" severity={pill.severity}>
          {pill.text}
        </Chip>
      </Link>
    </span>
  );
}

export function SyncPill({ className }: { className?: string }) {
  return <SyncPillView status={useSyncStatus()} className={className} />;
}
