/**
 * The page side of the desktop app's MCP host (SUITE_SPEC §15.6). Without a server, an AI tool's `--mcp` process
 * reaches the running app over a local socket and main relays each call here; this runs it through the same
 * `guardedCall` as the Companion bridge and WebMCP (actor `{ kind: 'mcp', id: <client> }`: never destructive,
 * consequential writes staged as proposals unless the person allowed that client to apply them). It also keeps main
 * told of the tool manifest and of the paired server's MCP address.
 */
import { useEffect } from 'react';
// not '@/agents': its index re-exports AgentSurfaces, which mounts this host
import { getAgentDispatcher, guardedCall, subscribeAgentDispatcher } from '@/agents/dispatcher';
import { rejected, type ToolManifest } from '@/agents/manifest';
import { getServerClient, type ServerClient } from '@/net/server';
import { desktopBridge, type DesktopMcpBridge } from './desktop';

/** Starts the host when running in the desktop app; returns the stop function (a no-op elsewhere). */
export function startDesktopMcpHost(bridge: DesktopMcpBridge | undefined = desktopBridge(), serverClient?: ServerClient): () => void {
  if (!bridge) return () => undefined;
  const client = serverClient ?? getServerClient();
  let live = true;

  // the manifest, as the bus serves it to every agent surface; published again whenever the bus reports a change
  let published: string | null | undefined;
  let seq = 0;
  const publish = (m: ToolManifest | null) => {
    const hash = m ? m.hash : null;
    if (hash === published) return;
    published = hash;
    bridge.mcp.setManifest(m);
  };
  const refreshManifest = () => {
    const n = ++seq;
    const dispatcher = getAgentDispatcher();
    if (!dispatcher) return publish(null);
    Promise.resolve()
      .then(() => dispatcher.manifest())
      .then(
        (m) => live && n === seq && publish(m),
        () => live && n === seq && publish(null),
      );
  };
  refreshManifest();
  const offDispatcher = subscribeAgentDispatcher(refreshManifest);

  const offCall = bridge.mcp.onCall(async ({ client: name, tool, args, idempotencyKey }) => {
    const dispatcher = getAgentDispatcher();
    if (!dispatcher) return rejected('internal', 'Vitals is not ready for agents yet.');
    let manifest: ToolManifest;
    try {
      manifest = await dispatcher.manifest();
    } catch {
      return rejected('internal', 'Vitals is not ready for agents yet.');
    }
    return guardedCall(dispatcher, manifest, 'mcp', tool, args, { actor: { kind: 'mcp', id: name }, ...(idempotencyKey ? { idempotencyKey } : {}) });
  });

  // the paired server's MCP address (no token): main forwards an AI tool there with that tool's own agent key
  let server: string | null | undefined;
  const syncServer = () => {
    const p = client.pairing();
    const url = p ? `${p.baseUrl}/mcp` : null;
    if (url === server) return;
    server = url;
    bridge.mcp.setServer(url ? { mcpUrl: url } : null);
  };
  syncServer();
  const offServer = client.subscribe(syncServer);

  return () => {
    live = false;
    offDispatcher();
    offCall();
    offServer();
  };
}

/** Runs the desktop MCP host for as long as the app is open. Mount once, in `AgentSurfaces`. */
export function useDesktopMcpHost(): void {
  useEffect(() => startDesktopMcpHost(), []);
}
