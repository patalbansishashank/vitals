import type { Severity } from '@/components';
import type { SyncStatus } from '@/sync/types';
import { STATE_LABEL, SYNC_COPY } from './copy';

/** "14:02" today, "30 Sep 14:02" before. */
export function formatSyncTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(/\bSept\b/, 'Sep')} ${time}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Errors that mean "the server did not answer" rather than "the server said no". */
const UNREACHABLE = /unreach|network|offline|timeout|dns|connect|socket|fetch/i;

export interface StatusView {
  label: string;
  severity: Severity;
  /** "last synced 14:02 · 3 changes waiting · relay.example.ts.net" */
  detail: string;
  /** A sentence for role=alert (offline, error, blocked). */
  problem?: string;
}

export function describeStatus(s: SyncStatus, now = new Date()): StatusView {
  const facts = [
    s.lastSyncedAt ? `last synced ${formatSyncTime(s.lastSyncedAt, now)}` : null,
    s.pendingChanges > 0 ? `${plural(s.pendingChanges, 'change', 'changes')} waiting` : null,
    s.pendingBlobs > 0 ? `${plural(s.pendingBlobs, 'upload', 'uploads')} waiting` : null,
  ].filter((f): f is string => Boolean(f));
  const suffix = facts.length > 0 ? ` (${facts.join(', ')})` : '';
  const detail = [...facts, s.endpoint].filter(Boolean).join(' · ');
  const label = STATE_LABEL[s.state];
  switch (s.state) {
    case 'synced':
      return { label, severity: 'ok', detail };
    case 'offline':
      return { label, severity: 'caution', detail, problem: `${SYNC_COPY.unreachable}${suffix}` };
    case 'needs-permission':
      return { label, severity: 'caution', detail, problem: SYNC_COPY.needsPermission };
    case 'error': {
      const err = s.lastError;
      if (!err || UNREACHABLE.test(`${err.code} ${err.message}`)) return { label, severity: 'danger', detail, problem: `${SYNC_COPY.unreachable}${suffix}` };
      return { label, severity: 'danger', detail, problem: `Sync stopped: ${err.message.replace(/\.?$/, '.')}${suffix}` };
    }
    default:
      return { label, severity: 'info', detail };
  }
}

export interface PillView {
  /** "Synced", "Syncing", "Offline · 3 waiting", "Error · can't reach the server". */
  text: string;
  severity: Severity;
  /** The full sentence from `describeStatus`, for a tooltip. */
  title?: string;
}

const REASON_MAX = 40;

/** A few plain words for why sync stopped. */
function shortReason(s: SyncStatus): string {
  const err = s.lastError;
  if (!err || UNREACHABLE.test(`${err.code} ${err.message}`)) return "can't reach the server";
  const m = err.message.replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  return m.length > REASON_MAX ? `${m.slice(0, REASON_MAX - 1).trimEnd()}…` : m;
}

/** The one-line state for places that are not Settings › Sync (the pill). `null` when sync is off. */
export function describePill(s: SyncStatus, now = new Date()): PillView | null {
  if (s.state === 'off') return null;
  const { severity, problem } = describeStatus(s, now);
  const waiting = s.pendingChanges + s.pendingBlobs;
  switch (s.state) {
    case 'synced':
      return { text: 'Synced', severity };
    case 'syncing':
      return { text: 'Syncing', severity };
    case 'connecting':
      return { text: 'Connecting', severity };
    case 'offline':
      return { text: waiting > 0 ? `Offline · ${waiting} waiting` : 'Offline', severity, title: problem };
    case 'needs-permission':
      return { text: 'Blocked · browser permission', severity, title: problem };
    case 'error':
      return { text: `Error · ${shortReason(s)}`, severity, title: problem };
  }
}
