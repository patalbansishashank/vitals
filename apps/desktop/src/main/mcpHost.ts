/**
 * The app's MCP host (SUITE_SPEC §15.6): listens on the local socket the `--mcp` bridge process connects to, one MCP
 * session per connection. With a server paired for that AI tool, the session's JSON-RPC goes raw to the server's
 * Streamable HTTP `/mcp` with the tool's agent token (the server's instructions, tools, prompts and resources pass
 * through unchanged; the token never leaves this process). Otherwise the Companion's `createMcpServer` runs here over
 * the socket, and tool calls go to the page through the relay.
 */
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isJSONRPCRequest, isJSONRPCResponse, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { checkCall, idempotencyKeyFor } from '../../../../packages/companion/src/agentHub.ts';
import { createMcpServer, type McpBackend } from '../../../../packages/companion/src/mcp.ts';
import { parseToolManifest, rejected, toMcpTools, type ToolManifest } from '../../../../packages/companion/src/toolManifest.ts';
import { AI_TOOL_IDS, isServerMcpUrl, type AiToolId } from '../shared/bridge';
import { isNamedPipe, parseHello } from '../shared/mcpSocket';
import type { PageRelay } from './pageRelay';

export const NOT_READY_MESSAGE = 'Vitals is still starting; try again in a moment.';
const MAX_LINE_BYTES = 4 * 1024 * 1024;

export interface RemoteTarget {
  mcpUrl: string;
  token: string;
}

export interface McpHostOptions {
  /** How long `tools/list` waits for the page's first manifest (default LIST_WAIT_MS; tests pass 0). */
  listWaitMs?: number;
  socketPath: string;
  version: string;
  relay: PageRelay;
  /** The paired server's `/mcp` and the agent token for this AI tool; null → run tools locally through the page. */
  remote(client: AiToolId | null): Promise<RemoteTarget | null>;
  /** Diagnostics only; never gets a token. */
  log(line: string): void;
}

export interface McpHost {
  start(): Promise<void>;
  close(): Promise<void>;
  sessionCount(): number;
}

interface Session {
  handle(line: string): Promise<void>;
  close(): Promise<void>;
}

const isAiToolId = (v: string | null): v is AiToolId => v !== null && (AI_TOOL_IDS as readonly string[]).includes(v);

const errorResponse = (id: string | number | null, message: string, code = -32000): string =>
  `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`;

/** Splits a stream into lines; a line over `MAX_LINE_BYTES` ends the connection. */
function lineReader(socket: Socket, onLine: (line: string) => void): void {
  let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    let at: number;
    while ((at = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, at).toString('utf8').replace(/\r$/, '');
      buffer = buffer.subarray(at + 1);
      if (line.trim()) onLine(line);
    }
    if (buffer.length > MAX_LINE_BYTES) socket.destroy();
  });
}

/** How long `tools/list` waits for the page's first manifest (a cold start takes a few seconds). */
export const LIST_WAIT_MS = 20_000;

function manifestOrTimeout(relay: PageRelay, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      off();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const off = relay.onManifestChange(() => {
      if (relay.manifest()) done();
    });
  });
}

/** The tool backend over the page relay: the page's manifest, validated once per change; destructive tools never listed. */
export function relayBackend(relay: PageRelay, log: (line: string) => void, listWaitMs = LIST_WAIT_MS): McpBackend & { dispose(): void } {
  let manifest: Promise<ToolManifest | null> = Promise.resolve(null);
  const refresh = () => {
    const raw = relay.manifest();
    manifest = raw
      ? parseToolManifest(raw).catch((e: unknown) => {
          log(`mcp: the page's tool manifest is not valid (${e instanceof Error ? e.message : 'error'})`);
          return null;
        })
      : Promise.resolve(null);
  };
  refresh();
  const off = relay.onManifestChange(refresh);
  return {
    async listTools() {
      // a tool started together with the app asks before the page has published its tools: wait for them a little
      if (!relay.manifest() && listWaitMs > 0) await manifestOrTimeout(relay, listWaitMs);
      const m = await manifest;
      return m ? toMcpTools(m) : [];
    },
    async call(tool, args, ctx) {
      const m = await manifest;
      if (!m) return rejected('unavailable', NOT_READY_MESSAGE);
      const check = checkCall(m, tool);
      if (!check.ok) return check.envelope;
      // the bus needs a key for these writes; the same request id in the same session gets the same key (§1.6)
      const key = check.entry?.idempotency === 'key' ? idempotencyKeyFor(ctx.clientName, ctx.scope, ctx.requestId) : undefined;
      return relay.call({ client: ctx.clientName, tool, args, ...(key ? { idempotencyKey: key } : {}) });
    },
    dispose: off,
  };
}

export function createMcpHost(o: McpHostOptions): McpHost {
  const { socketPath, version, relay, log } = o;
  const pipe = isNamedPipe(socketPath);
  const sessions = new Set<Session>();
  let server: NetServer | null = null;
  const backend = relayBackend(relay, log, o.listWaitMs);

  const write = (socket: Socket, text: string) => {
    if (!socket.destroyed) socket.write(text);
  };

  /** The Companion's MCP server over this socket; `scope` tells the idempotency keys of two sessions apart. */
  const localSession = async (socket: Socket, client: string | null): Promise<Session> => {
    const scope = randomUUID();
    const transport: Transport = {
      start: async () => undefined,
      send: async (m) => write(socket, serializeMessage(m)),
      close: async () => {
        socket.end();
        transport.onclose?.();
      },
    };
    const mcp = createMcpServer(backend, { version, fallbackClientName: client ?? 'mcp', scope: () => scope });
    await mcp.connect(transport);
    const off = relay.onManifestChange(() => void mcp.sendToolListChanged().catch(() => undefined));
    return {
      async handle(line) {
        let message: JSONRPCMessage;
        try {
          message = deserializeMessage(line);
        } catch {
          write(socket, errorResponse(null, 'Parse error', -32700));
          return;
        }
        transport.onmessage?.(message);
      },
      async close() {
        off();
        await mcp.close().catch(() => undefined);
      },
    };
  };

  /** Raw JSON-RPC relay to the server's `/mcp`; the first message decides reachability (the caller falls back to local). */
  const remoteSession = (socket: Socket, target: RemoteTarget): Session => {
    const transport = new StreamableHTTPClientTransport(new URL(target.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${target.token}` } } });
    transport.onmessage = (m) => {
      if (isJSONRPCResponse(m) && typeof (m.result as { protocolVersion?: unknown })?.protocolVersion === 'string') {
        transport.setProtocolVersion((m.result as { protocolVersion: string }).protocolVersion);
      }
      write(socket, serializeMessage(m));
    };
    transport.onerror = (e) => log(`mcp: server session: ${e.message}`);
    let first = true;
    return {
      async handle(line) {
        // only the probe (the first line) may throw: the caller falls back to local; any later failure is answered
        const probing = first;
        first = false;
        let message: JSONRPCMessage;
        try {
          message = deserializeMessage(line);
        } catch {
          write(socket, errorResponse(null, 'Parse error', -32700));
          return;
        }
        try {
          await transport.send(message);
        } catch (e) {
          if (probing) throw e;
          const status = /HTTP (\d{3})/.exec(e instanceof Error ? e.message : '')?.[1];
          if (isJSONRPCRequest(message)) write(socket, errorResponse(message.id, status ? `Your Vitals server refused the call (HTTP ${status}).` : 'Your Vitals server did not answer.'));
        }
      },
      async close() {
        await transport.terminateSession().catch(() => undefined);
        await transport.close().catch(() => undefined);
      },
    };
  };

  const onConnection = (socket: Socket) => {
    socket.setNoDelay?.(true);
    let session: Session | null = null;
    let client: string | null = null;
    let started = false;
    const queue: string[] = [];
    let draining: Promise<void> = Promise.resolve();

    const closeSession = () => {
      const s = session;
      session = null;
      if (s) {
        sessions.delete(s);
        void s.close();
      }
    };

    /** Keeps a session only while the connection is still there (it can close while the session starts). */
    const keep = (s: Session): boolean => {
      if (socket.destroyed) {
        void s.close();
        return false;
      }
      session = s;
      sessions.add(s);
      return true;
    };
    const failed = (e: unknown) => {
      log(`mcp: session failed to start (${e instanceof Error ? e.message : 'error'})`);
      socket.destroy();
    };

    // undefined until remote() has answered; the session itself opens on the first JSON-RPC line (the probe)
    let target: RemoteTarget | null | undefined;
    let opening = false;
    const resolveTarget = async (): Promise<RemoteTarget | null> => {
      const id = isAiToolId(client) ? client : null;
      try {
        const t = await o.remote(id);
        if (!t || isServerMcpUrl(t.mcpUrl)) return t;
        // the key is never sent in clear text over a network, or to an address that is not a server
        log('mcp: the server address is not https; running locally');
        return null;
      } catch (e) {
        log(`mcp: no server details for ${id ?? 'this tool'} (${e instanceof Error ? e.message : 'error'})`);
        return null;
      }
    };

    /** Through the server when the probe gets there, else locally; then the lines that queued meanwhile. */
    const open = async (probe: string) => {
      opening = true;
      const id = isAiToolId(client) ? client : null;
      if (target) {
        const remote = remoteSession(socket, target);
        try {
          await remote.handle(probe);
          if (!keep(remote)) return;
          log(`mcp: ${id ?? 'a client'} connected through the server`);
        } catch (e) {
          await remote.close();
          log(`mcp: server not reachable (${e instanceof Error ? e.message : 'error'}); running locally`);
          const local = await localSession(socket, client);
          if (!keep(local)) return;
          await local.handle(probe);
        }
      } else {
        const local = await localSession(socket, client);
        if (!keep(local)) return;
        log(`mcp: ${id ?? 'a client'} connected locally`);
        await local.handle(probe);
      }
      while (queue.length && session) await session.handle(queue.shift()!);
    };

    lineReader(socket, (line) => {
      if (!started) {
        started = true;
        const hello = parseHello(line);
        client = hello?.client ?? null;
        if (!hello) queue.push(line);
        draining = resolveTarget()
          .then((t) => {
            target = t;
            const probe = queue.shift();
            if (probe !== undefined && !socket.destroyed) return open(probe);
          })
          .catch(failed);
        return;
      }
      if (session) {
        const s = session;
        draining = draining.then(() => s.handle(line)).catch(() => undefined);
      } else if (target !== undefined && !opening) {
        draining = open(line).catch(failed);
      } else {
        queue.push(line);
      }
    });
    socket.on('error', (e) => log(`mcp: socket error (${e.message})`));
    socket.on('close', closeSession);
  };

  return {
    async start() {
      if (!pipe) {
        await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
        await unlink(socketPath).catch(() => undefined);
      }
      const srv = createServer(onConnection);
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(socketPath, () => {
          srv.off('error', reject);
          resolve();
        });
      });
      srv.on('error', (e) => log(`mcp: socket server error (${e.message})`));
      if (!pipe) await chmod(socketPath, 0o600);
      server = srv;
      log(`mcp: listening on ${socketPath}`);
    },
    async close() {
      backend.dispose();
      const all = [...sessions];
      sessions.clear();
      await Promise.all(all.map((s) => s.close()));
      const srv = server;
      server = null;
      if (srv) await new Promise<void>((resolve) => srv.close(() => resolve()));
      if (!pipe) await unlink(socketPath).catch(() => undefined);
    },
    sessionCount: () => sessions.size,
  };
}
