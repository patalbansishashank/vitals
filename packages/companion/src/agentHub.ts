/**
 * Agent hub (SUITE_SPEC §7.3): the paired Vitals tab connects over `BRIDGE_PATH`, publishes its tool manifest and
 * executes the tool calls MCP clients send to the Companion. The Companion never executes commands itself; it only
 * enforces the external-agent rules again (never destructive, surface must be `mcp`, consequential writes staged).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Auth } from './auth.ts';
import { BRIDGE_CLOSE, CALL_TIMEOUT_MS, type CompanionMessage, type TabMessage } from './bridgeProtocol.ts';
import type { Logger } from './security.ts';
import { exposedTo, mustStage, parseToolManifest, rejected, type ToolManifest, type ToolResultEnvelope } from './toolManifest.ts';

export const HELLO_TIMEOUT_MS = 5_000;
export const NO_TAB_MESSAGE = 'Open Vitals in a browser tab, then try again.';
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export interface CallRequest {
  tool: string;
  args: unknown;
  /** MCP client name (`initialize.clientInfo.name`) or the token label. */
  clientName: string;
  /** Session or process scope, so request ids from different sessions of one client never share a key. */
  scope: string;
  requestId: string | number;
}

/**
 * Product names for the MCP client ids agents send in `initialize.clientInfo.name` (QA Q5-02). Codex CLI and the
 * ChatGPT desktop app share `~/.codex/config.toml` and both say `codex-mcp-client`, so they cannot be told apart.
 * Only for display: idempotency keys and proposal actors keep the raw id.
 */
const CLIENT_PRODUCT_NAMES: Record<string, string> = {
  'codex-mcp-client': 'Codex or the ChatGPT app',
  cli: 'OpenCode',
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
};

/** The product name for a known MCP client id; unknown ids pass through unchanged. */
export function clientDisplayName(clientName: string): string {
  return Object.hasOwn(CLIENT_PRODUCT_NAMES, clientName) ? CLIENT_PRODUCT_NAMES[clientName]! : clientName;
}

/** SUITE_SPEC §1.6: MCP keys derive from (clientName, requestId); ≤ 64 chars. */
export function idempotencyKeyFor(clientName: string, scope: string, requestId: string | number): string {
  return `mcp_${createHash('sha256').update(`${clientName}\u0000${scope}\u0000${String(requestId)}`).digest('base64url').slice(0, 43)}`;
}

export function noTabEnvelope(): ToolResultEnvelope {
  return { ok: false, status: 'rejected', summary: NO_TAB_MESSAGE, error: { code: 'unavailable', message: NO_TAB_MESSAGE } };
}

export function forbiddenEnvelope(tool: string): ToolResultEnvelope {
  return rejected('surface_forbidden', `The tool ${JSON.stringify(tool.slice(0, 64))} is not available to MCP clients.`);
}

/** Checks a call against a manifest: unknown, ui-only/webmcp-only and destructive tools are refused. */
export function checkCall(manifest: ToolManifest | null, tool: string) {
  const entry = manifest?.tools.find((t) => t.name === tool);
  if (!manifest) return { ok: true as const, entry: undefined };
  if (!entry || !exposedTo(entry, 'mcp')) return { ok: false as const, envelope: forbiddenEnvelope(tool) };
  return { ok: true as const, entry };
}

const STATUSES = new Set(['applied', 'pending_user', 'needs_choice', 'rejected', 'running']);
function validEnvelope(e: unknown): e is ToolResultEnvelope {
  if (!e || typeof e !== 'object') return false;
  const v = e as Record<string, unknown>;
  return typeof v.ok === 'boolean' && typeof v.summary === 'string' && STATUSES.has(v.status as string);
}

export interface AgentHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Tab manifest when a tab is connected, else the `--manifest` file. */
  manifest(): ToolManifest | null;
  tab(): { connected: boolean; toolCount: number };
  call(req: CallRequest): Promise<ToolResultEnvelope>;
  /** MCP clients that called a tool since start, newest first (names only; for Settings › Agents). */
  /** Recent MCP clients by product name (`clientDisplayName`), newest first. */
  clients(): Array<{ name: string; lastSeenAt: string }>;
  onManifestChange(cb: () => void): () => void;
  close(): Promise<void>;
}

export function createAgentHub(opts: { auth: Auth; log: Logger; version: string; fileManifest?: ToolManifest | null; callTimeoutMs?: number; helloTimeoutMs?: number }): AgentHub {
  const { auth, log, version, fileManifest = null, callTimeoutMs = CALL_TIMEOUT_MS, helloTimeoutMs = HELLO_TIMEOUT_MS } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  let active: { ws: WebSocket; manifest: ToolManifest } | null = null;
  const pending = new Map<string, { ws: WebSocket; resolve: (e: ToolResultEnvelope) => void; timer: NodeJS.Timeout }>();
  const listeners = new Set<() => void>();
  const seen = new Map<string, number>();
  const changed = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        // listeners must not break the hub
      }
    }
  };

  const send = (ws: WebSocket, msg: CompanionMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const settleAllFor = (ws: WebSocket, envelope: ToolResultEnvelope) => {
    for (const [id, p] of pending) {
      if (p.ws !== ws) continue;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve(envelope);
    }
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin;
    let authed = false;
    const helloTimer = setTimeout(() => ws.close(BRIDGE_CLOSE.unauthorized, 'hello required'), helloTimeoutMs);

    ws.on('message', (data, isBinary) => {
      void (async () => {
        let msg: TabMessage;
        try {
          if (isBinary) throw new Error('binary');
          msg = JSON.parse(data.toString()) as TabMessage;
          if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new Error('shape');
        } catch {
          ws.close(BRIDGE_CLOSE.badMessage, 'bad message');
          return;
        }
        if (!authed) {
          if (msg.type !== 'hello' || typeof msg.token !== 'string' || auth.verify(msg.token, origin)?.kind !== 'browser') {
            clearTimeout(helloTimer);
            ws.close(BRIDGE_CLOSE.unauthorized, 'unauthorized');
            return;
          }
          let manifest: ToolManifest;
          try {
            manifest = await parseToolManifest(msg.manifest);
          } catch (e) {
            clearTimeout(helloTimer);
            log(`agent bridge: rejected manifest (${e instanceof Error ? e.message : 'invalid'})`);
            ws.close(BRIDGE_CLOSE.badMessage, 'bad manifest');
            return;
          }
          clearTimeout(helloTimer);
          authed = true;
          const previous = active;
          active = { ws, manifest };
          if (previous) {
            settleAllFor(previous.ws, rejected('replaced', 'The Vitals tab was replaced by a newer one; try again.'));
            previous.ws.close(BRIDGE_CLOSE.replaced, 'replaced by a newer tab');
          }
          log(`agent bridge: tab connected (${manifest.tools.length} tools)`);
          send(ws, { type: 'ready', companionVersion: version, toolCount: manifest.tools.length });
          if (previous?.manifest.hash !== manifest.hash) changed();
          return;
        }
        if (active?.ws !== ws) return;
        if (msg.type === 'manifest') {
          try {
            const manifest = await parseToolManifest(msg.manifest);
            const before = active.manifest.hash;
            active = { ws, manifest };
            if (before !== manifest.hash) changed();
          } catch {
            send(ws, { type: 'error', message: 'manifest rejected' });
          }
          return;
        }
        if (msg.type === 'result') {
          const p = typeof msg.callId === 'string' ? pending.get(msg.callId) : undefined;
          if (!p || p.ws !== ws) return;
          clearTimeout(p.timer);
          pending.delete(msg.callId);
          p.resolve(validEnvelope(msg.envelope) ? msg.envelope : rejected('bad_result', 'Vitals returned an invalid result.'));
          return;
        }
        send(ws, { type: 'error', message: 'unexpected message' });
      })();
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      settleAllFor(ws, rejected('tab_closed', 'The Vitals tab closed before answering; try again.'));
      if (active?.ws === ws) {
        active = null;
        log('agent bridge: tab disconnected');
        changed();
      }
    });
    ws.on('error', () => undefined);
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    manifest: () => active?.manifest ?? fileManifest,
    tab: () => ({ connected: active !== null, toolCount: active?.manifest.tools.length ?? 0 }),
    clients: () => {
      // Newest first; ids that share a product name (`cli` and `opencode`) are listed once, with the newest time.
      const out = new Map<string, string>();
      for (const [id, t] of [...seen.entries()].sort((x, y) => y[1] - x[1])) {
        const name = clientDisplayName(id);
        if (!out.has(name)) out.set(name, new Date(t).toISOString());
      }
      return [...out].map(([name, lastSeenAt]) => ({ name, lastSeenAt }));
    },
    async call(r) {
      seen.delete(r.clientName);
      seen.set(r.clientName, Date.now());
      if (seen.size > 20) seen.delete(seen.keys().next().value!);
      const check = checkCall(active?.manifest ?? fileManifest, r.tool);
      if (!check.ok) return check.envelope;
      const tab = active;
      if (!tab) return noTabEnvelope();
      const entry = check.entry!;
      const args = r.args && typeof r.args === 'object' && !Array.isArray(r.args) ? (r.args as Record<string, unknown>) : {};
      const callId = randomUUID();
      return new Promise<ToolResultEnvelope>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(callId);
          resolve({
            ok: false,
            status: 'running',
            summary: 'Vitals did not answer in time; the call may still complete. Check Vitals before retrying.',
            error: { code: 'timeout', message: `No answer from the Vitals tab within ${Math.round(callTimeoutMs / 1000)} s` },
          });
        }, callTimeoutMs);
        pending.set(callId, { ws: tab.ws, resolve, timer });
        send(tab.ws, {
          type: 'call',
          callId,
          commandId: entry.id,
          tool: entry.name,
          args,
          actor: { kind: 'mcp', id: r.clientName },
          idempotencyKey: idempotencyKeyFor(r.clientName, r.scope, r.requestId),
          stage: mustStage(entry),
        });
      });
    },
    onManifestChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
