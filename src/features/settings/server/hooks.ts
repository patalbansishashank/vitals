/** React bindings for the server client: the pairing (no token) and the connection state from the status watcher. */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getServerClient, watchServer, type ServerClient, type ServerConnection, type ServerPairing, type ServerWatcher } from '@/net/server';

/** One watcher per client, created on first use and shared by every view (the app has one client). */
const watchers = new WeakMap<ServerClient, ServerWatcher>();

/** Tests and stories pass their own client; the app uses the singleton. */
export const ServerClientContext = createContext<ServerClient | null>(null);

export function useServerClient(): ServerClient {
  return useContext(ServerClientContext) ?? getServerClient();
}

/** The current pairing (no token), re-rendering on pair, forget and a 401. */
export function useServerPairing(): ServerPairing | null {
  const client = useServerClient();
  const key = useSyncExternalStore(client.subscribe, () => {
    const p = client.pairing();
    return p ? `${p.baseUrl}|${p.deviceId}|${p.pairedAt}` : '';
  });
  return useMemo(() => (key ? client.pairing() : null), [client, key]);
}

function watcherFor(client: ServerClient): ServerWatcher {
  let w = watchers.get(client);
  if (!w) {
    w = watchServer(client);
    watchers.set(client, w);
  }
  return w;
}

/**
 * The connection state (unpaired / checking / reachable / unreachable / revoked / version). The watcher polls
 * `/v1/pair/status` while paired (every minute, backoff on failure); mounting a view that shows it checks at once.
 */
export function useServerConnection(): { connection: ServerConnection; check: () => Promise<void> } {
  const client = useServerClient();
  const watcher = watcherFor(client);
  const connection = useSyncExternalStore(watcher.subscribe, watcher.get, watcher.get);
  useEffect(() => {
    if (client.isPaired()) void watcher.check();
  }, [client, watcher]);
  return { connection, check: watcher.check };
}
