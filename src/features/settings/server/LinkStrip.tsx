import { useRef, type ReactNode } from 'react';
import { AlertTriangle, Laptop, Server } from 'lucide-react';
import { Icon, MonoMeta, StatusDot } from '@/components';
import { useDrawIn, useInView } from '@/app/motion';
import type { ServerConnection } from '@/net/server';
import type { SyncStatus } from '@/sync/types';
import { formatSyncTime } from '../sync/status';
import './linkStrip.css';

/** The connection is a relationship, not a second health reading. Words carry every state as well as the line. */
export function LinkStrip({
  host,
  connection,
  sync,
  syncState,
}: {
  host: string;
  connection: ServerConnection;
  sync: SyncStatus | null;
  syncState: ReactNode;
}) {
  const line = useRef<HTMLDivElement>(null);
  const inView = useInView(line);
  const reached = connection.state === 'reachable' || connection.state === 'version';
  const checking = connection.state === 'checking';
  useDrawIn(line, { start: inView && reached });
  const pending = sync ? Math.max(0, sync.pendingChanges + sync.pendingBlobs) : 0;
  return (
    <div
      className="settings-link"
      data-reached={reached || undefined}
      data-checking={checking || sync?.state === 'syncing' || undefined}
    >
      <div className="settings-link__nodes">
        <span className="settings-link__node">
          <Icon icon={Laptop} size={22} />
          <span>This device</span>
        </span>
        <div ref={line} className="settings-link__line" aria-hidden="true">
          <i />
        </div>
        <span className="settings-link__node">
          <Icon icon={Server} size={22} />
          <span>{host}</span>
        </span>
      </div>
      <div className="settings-link__facts">
        {connection.state === 'reachable' ? (
          <MonoMeta>{Math.round(connection.latencyMs)} ms</MonoMeta>
        ) : checking ? (
          <MonoMeta>Checking</MonoMeta>
        ) : reached ? (
          <MonoMeta>Connected</MonoMeta>
        ) : (
          <MonoMeta>
            <Icon icon={AlertTriangle} size={14} />{' '}
            {connection.state === 'unreachable' && connection.error.code === 'server_busy'
              ? 'Server busy'
              : 'Connection unavailable'}
          </MonoMeta>
        )}
        <div className="settings-link__sync">
          <MonoMeta>{syncState}</MonoMeta>
          {sync?.lastSyncedAt ? <MonoMeta>Synced {formatSyncTime(sync.lastSyncedAt)}</MonoMeta> : null}
          {pending > 0 ? (
            <span
              className="settings-link__queue"
              role="img"
              aria-label={`${pending} changes and uploads waiting`}
            >
              <span aria-hidden="true">
                {Array.from({ length: Math.min(12, pending) }, (_, i) => (
                  <i key={i} />
                ))}
                {pending > 12 ? <MonoMeta>+{pending - 12}</MonoMeta> : null}
              </span>
            </span>
          ) : sync?.state === 'syncing' ? (
            <StatusDot tone="live" label="Syncing" pulse />
          ) : null}
        </div>
      </div>
    </div>
  );
}
