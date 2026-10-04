/**
 * Pairing turns sync on (plan decision 5, R20-PAIR §4). Right after `client.pair()` the device asks its home server once
 * for the person's sync key and joins the group the server already holds, on the same path as the 24 words
 * (`sync.join` with a `vitals-sync:1` code). The key stays in memory between the two calls: it is never written to
 * `vitals.server.v1` or any other store; `sync.join` keeps it in its wrapped vault like a typed code.
 *
 * The server hands the key over once per device. When the join then fails (the sync relay did not answer, say), the key
 * is kept in this module's memory for Try again, never stored, and zeroed once the join works, the pairing ends or the
 * page closes.
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
  /** The server has no key to give (a relay): the words path stays. */
  | { kind: 'no_key' }
  /** `retry`: Try again can work (a held key, a network error); false when only a new pairing or the words can. */
  | { kind: 'failed'; message: string; retry: boolean };

/** A key whose join failed, for Try again (memory only). */
let held: { baseUrl: string; key: Uint8Array } | null = null;

/** Zeroes and forgets a held key (the join worked, or the pairing ended). */
export function dropHeldSyncKey(): void {
  held?.key.fill(0);
  held = null;
}

/** Errors no retry of the same request can fix. */
const FINAL = new Set(['key_used', 'wrong_kind', 'unauthorized', 'revoked', 'not_paired']);

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
  if (o.view.paired) {
    dropHeldSyncKey();
    return syncsThroughServer(o.view, o.baseUrl) ? { kind: 'already' } : { kind: 'other_key' };
  }
  if (held && held.baseUrl !== o.baseUrl) dropHeldSyncKey();
  if (!held) {
    let key: Uint8Array | null;
    try {
      key = await o.client.syncKey();
    } catch (e) {
      return { kind: 'failed', message: e instanceof ServerError ? e.message : String(e), retry: !(e instanceof ServerError && FINAL.has(e.code)) };
    }
    if (!key) return { kind: 'no_key' };
    held = { baseUrl: o.baseUrl, key };
  }
  try {
    const code = formatPairingUri(o.baseUrl, held.key, o.label || undefined);
    const local = describeLocalData();
    const onExisting = local ? await o.ask(local) : 'merge';
    unwrap(await dispatch('sync.join', { code, onExisting }));
    dropHeldSyncKey();
    return { kind: 'joined' };
  } catch (e) {
    // the server will not hand the key over again: keep it (memory only) so Try again can join
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e), retry: held !== null };
  }
}
