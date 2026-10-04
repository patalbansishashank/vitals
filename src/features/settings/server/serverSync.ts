/**
 * Pairing turns sync on (plan decision 5, R20-PAIR §4). Right after `client.pair()` the device asks its home server once
 * for the person's sync key and joins the group the server already holds, on the same path as the 24 words
 * (`sync.join` with a `vitals-sync:1` code). The key stays in memory between the two calls: it is never written to
 * `vitals.server.v1` or any other store; `sync.join` keeps it in its wrapped vault like a typed code.
 */
import { dispatch } from '@/commands';
import { originOf } from '@/net/net';
import { ServerError, type ServerClient } from '@/net/server';
import { describeLocalData, type SyncView } from '@/state/sync';
import { formatPairingUri } from '@/sync/pairing';
import { unwrap } from '../sync/unwrap';

export type ServerJoinOutcome =
  | { kind: 'joined' }
  /** Already syncing through this server: nothing to do. */
  | { kind: 'already' }
  /** Syncing with another key or another server: told, not switched. */
  | { kind: 'other_key' }
  /** The server gave no key (older server, key already handed, window closed): the words path stays. */
  | { kind: 'no_key' }
  | { kind: 'failed'; message: string };

/** True when the sync address is the paired server's (the same rule as Settings › Sync). */
export function syncsThroughServer(view: Pick<SyncView, 'paired' | 'relayUrl'>, baseUrl: string): boolean {
  return Boolean(view.paired && view.relayUrl && originOf(view.relayUrl) === originOf(baseUrl));
}

export async function joinSyncFromServer(o: {
  client: ServerClient;
  baseUrl: string;
  label?: string;
  view: Pick<SyncView, 'paired' | 'relayUrl'>;
  /** Asked only when this device already holds data (the existing-data dialog). */
  ask: (summary: string) => Promise<'merge' | 'replace'>;
}): Promise<ServerJoinOutcome> {
  if (o.view.paired) return syncsThroughServer(o.view, o.baseUrl) ? { kind: 'already' } : { kind: 'other_key' };
  let key: Uint8Array | null;
  try {
    key = await o.client.syncKey();
  } catch (e) {
    return { kind: 'failed', message: e instanceof ServerError ? e.message : String(e) };
  }
  if (!key) return { kind: 'no_key' };
  try {
    const code = formatPairingUri(o.baseUrl, key, o.label || undefined);
    const local = describeLocalData();
    const onExisting = local ? await o.ask(local) : 'merge';
    unwrap(await dispatch('sync.join', { code, onExisting }));
    return { kind: 'joined' };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  } finally {
    key.fill(0);
  }
}
