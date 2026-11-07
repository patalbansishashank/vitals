import { Link } from 'react-router';
import { CloudAlert, CloudCheck, CloudOff, RefreshCw } from 'lucide-react';
import { Chip, StatusCapsule, type IconComponent } from '@/components';
import { useSyncStatus } from '@/state/sync';
import type { SyncStatus } from '@/sync/types';
import { describePill } from './status';

const SYNC_TO = '/settings/sync';

/**
 * The sync state in a few words, linking to Settings › Sync: `Synced`, `Syncing`, `Offline · 3 waiting`,
 * `Error · <reason>`. Nothing when sync is off. For a place that already holds the status (Settings › Server); the
 * header shows it as an icon (`SyncStatusIcon`).
 */
export function SyncPillView({ status, className }: { status: SyncStatus; className?: string }) {
  const pill = describePill(status);
  if (!pill) return null;
  return (
    <span role="status" className={className ?? 'inline-flex'}>
      <span className="lm-sr">Sync: </span>
      <Link to={SYNC_TO} className="inline-flex no-underline" title={pill.title}>
        <Chip kind="status" severity={pill.severity}>
          {pill.text}
        </Chip>
      </Link>
    </span>
  );
}

export interface SyncIconView {
  icon: IconComponent;
  /** The full meaning: "Sync: Offline · 3 waiting", or the problem's sentence when sync stopped. */
  label: string;
  /** Something waits on the person or stopped (offline with changes waiting, blocked, an error): the gold dot. */
  attention: boolean;
  /** A sync in flight: the dot breathes. */
  pulse: boolean;
  tone: 'signal' | 'danger';
}

/** How the header's status icon shows a sync state; null while sync is off. */
export function describeSyncIcon(status: SyncStatus): SyncIconView | null {
  const pill = describePill(status);
  if (!pill) return null;
  // a stop says why in its own sentence ("Sync stopped: the relay is full."); every other state in a few words
  const stopped = status.state === 'error' || status.state === 'needs-permission';
  const label = stopped && pill.title ? pill.title : `Sync: ${pill.text}`;
  switch (status.state) {
    case 'synced':
      return { icon: CloudCheck, label, attention: false, pulse: false, tone: 'signal' };
    case 'syncing':
    case 'connecting':
      return { icon: RefreshCw, label, attention: false, pulse: true, tone: 'signal' };
    case 'offline':
      return { icon: CloudOff, label, attention: status.pendingChanges + status.pendingBlobs > 0, pulse: false, tone: 'signal' };
    case 'needs-permission':
      return { icon: CloudAlert, label, attention: true, pulse: false, tone: 'signal' };
    default:
      return { icon: CloudAlert, label, attention: true, pulse: false, tone: 'danger' };
  }
}

/**
 * The header's sync status (SUITE_SPEC §15.4, SPEC §9): an icon that opens Settings › Sync, on every screen while sync
 * is on (a cloud with a check, the arrows while syncing, a crossed cloud offline, an alert when it stopped), its words
 * in the name and tooltip, and announced politely as they change. Nothing while sync is off.
 */
export function SyncStatusIcon() {
  const view = describeSyncIcon(useSyncStatus());
  return (
    <>
      <span role="status" className="lm-sr">
        {view?.label ?? ''}
      </span>
      {view ? <StatusCapsule icon={view.icon} label={view.label} attention={view.attention} pulse={view.pulse} tone={view.tone} to={SYNC_TO} /> : null}
    </>
  );
}
