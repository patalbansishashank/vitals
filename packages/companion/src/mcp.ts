/**
 * MCP server over the tool manifest (SUITE_SPEC §7.3): `tools/list` = `toMcpTools(manifest)`, `tools/call` forwarded
 * to the paired tab through the agent hub. The low-level SDK `Server` is used so the manifest's JSON Schemas pass
 * through unchanged. Two transports:
 * - Streamable HTTP at `/mcp` on the Companion's port (stateful sessions bound to the token that opened them);
 * - stdio via `vitals-companion mcp`, a thin process that forwards to the running Companion with the admin token.
 * Every server sends the standing rules as its `instructions` (`MCP_INSTRUCTIONS`, `./briefingRules.ts`) and offers the
 * person's briefing (`briefing_get`) as the `coach` prompt and the `vitals://briefing` resource too.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  isInitializeRequest,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { checkCall, noTabEnvelope, type AgentHub } from './agentHub.ts';
import type { Principal } from './auth.ts';
import { MCP_INSTRUCTIONS } from './briefingRules.ts';
import type { Logger } from './security.ts';
import { parseToolManifest, toMcpTools, type JsonSchema, type McpToolDescriptor, type ToolManifest, type ToolResultEnvelope } from './toolManifest.ts';

export interface McpCallContext {
  clientName: string;
  scope: string;
  requestId: string | number;
}

export interface McpBackend {
  listTools(): Promise<McpToolDescriptor[]>;
  call(tool: string, args: unknown, ctx: McpCallContext): Promise<ToolResultEnvelope>;
}

/** True when an output schema is a plain object schema that takes more fields and does not declare the ones `needs_choice` adds. */
function takesChoiceFields(schema: JsonSchema): boolean {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const composite = ['anyOf', 'oneOf', 'allOf', 'not', 'if', 'patternProperties'].some((k) => k in schema);
  return schema.type === 'object' && !composite && schema.additionalProperties !== false && schema.unevaluatedProperties !== false && !['status', 'summary', 'saved', 'candidates'].some((k) => k in props);
}

/**
 * Envelope → MCP result: text content always carries the full envelope. `structuredContent` is the envelope, except
 * for tools that declare an `outputSchema` (MCP clients validate `structuredContent` against it): there it is the
 * envelope's `data` on success and omitted on error. A `needs_choice` answer also puts its status, summary and
 * candidates there, when the schema takes extra fields, so a client that reads only the structured part sees that
 * nothing was saved; a strict schema keeps the data as it is.
 */
export function toCallToolResult(envelope: ToolResultEnvelope, outputSchema?: JsonSchema): CallToolResult {
  const content = [{ type: 'text' as const, text: JSON.stringify(envelope) }];
  if (outputSchema) {
    const data = envelope.data;
    if (envelope.ok && data && typeof data === 'object' && !Array.isArray(data)) {
      const choice = envelope.status === 'needs_choice' && takesChoiceFields(outputSchema)
        ? { status: envelope.status, saved: false, summary: envelope.summary, ...(envelope.candidates ? { candidates: envelope.candidates } : {}) }
        : {};
      return { content, structuredContent: { ...(data as Record<string, unknown>), ...choice } };
    }
    return { content, isError: !envelope.ok };
  }
  return { content, structuredContent: envelope as unknown as Record<string, unknown>, isError: !envelope.ok };
}

/** The briefing tool, the prompt that carries it and the resource that serves it (plan 04 item 12). */
export const BRIEFING_TOOL = 'briefing_get';
export const COACH_PROMPT = 'coach';
export const BRIEFING_URI = 'vitals://briefing';
const NO_BRIEFING_TOOL = 'This version of the Vitals app cannot share the briefing yet. Update Vitals, then try again.';

/** The person's briefing text through `briefing_get`, or the reason it is not available, in plain words. */
async function readBriefing(backend: McpBackend, ctx: McpCallContext): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const tools = await backend.listTools();
    // no tools at all: no tab or app yet; the call below answers with the right message ("open Vitals")
    if (tools.length && !tools.some((t) => t.name === BRIEFING_TOOL)) return { ok: false, reason: NO_BRIEFING_TOOL };
    const envelope = await backend.call(BRIEFING_TOOL, {}, ctx);
    const data = envelope.data as { text?: unknown } | undefined;
    if (envelope.ok && typeof data?.text === 'string') return { ok: true, text: data.text };
    return { ok: false, reason: envelope.ok ? 'Vitals returned an empty briefing.' : envelope.summary || 'Vitals could not read the briefing.' };
  } catch {
    return { ok: false, reason: 'Vitals could not read the briefing. Try again in a moment.' };
  }
}

export function createMcpServer(backend: McpBackend, opts: { version: string; fallbackClientName: string; scope: () => string }): Server {
  const server = new Server(
    { name: 'vitals', title: 'Vitals', version: opts.version },
    { capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} }, instructions: MCP_INSTRUCTIONS },
  );
  const ctxOf = (requestId: string | number): McpCallContext => ({
    clientName: (server.getClientVersion()?.name ?? '').replace(/[^\w .:@/-]/g, '').slice(0, 64) || opts.fallbackClientName,
    scope: opts.scope(),
    requestId,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await backend.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const tools = await backend.listTools();
    const envelope = await backend.call(name, args ?? {}, ctxOf(extra.requestId));
    return toCallToolResult(envelope, tools.find((t) => t.name === name)?.outputSchema);
  });

  // the same briefing as a prompt and a resource, for clients that use those; the tool works in every client
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: COACH_PROMPT, title: 'Vitals Coach', description: 'Work like the Coach in Vitals: the rules and the person’s briefing (today’s plan, what is logged, kitchen).' }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
    if (request.params.name !== COACH_PROMPT) throw new McpError(ErrorCode.InvalidParams, `There is no prompt called ${JSON.stringify(request.params.name)}.`);
    const b = await readBriefing(backend, ctxOf(extra.requestId));
    const briefing = b.ok ? `The person’s briefing:\n${b.text}` : `The person’s briefing is not available: ${b.reason}`;
    return {
      description: 'The Vitals rules and the person’s briefing',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `${MCP_INSTRUCTIONS}\n\n${briefing}` } }],
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: BRIEFING_URI, name: 'briefing', title: 'Your Vitals briefing', description: 'Today’s plan, what is logged, kitchen and the rest of the briefing the Coach works from.', mimeType: 'text/plain' }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    if (request.params.uri !== BRIEFING_URI) throw new McpError(ErrorCode.InvalidParams, `There is no resource at ${JSON.stringify(request.params.uri)}.`);
    const b = await readBriefing(backend, ctxOf(extra.requestId));
    if (!b.ok) throw new McpError(ErrorCode.InternalError, b.reason);
    return { contents: [{ uri: BRIEFING_URI, mimeType: 'text/plain', text: b.text }] };
  });
  return server;
}

/** Backend for `/mcp`: the in-process hub. */
export function hubBackend(hub: AgentHub): McpBackend {
  return {
    listTools: async () => {
      const m = hub.manifest();
      return m ? toMcpTools(m) : [];
    },
    call: (tool, args, ctx) => hub.call({ tool, args, ...ctx }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Streamable HTTP sessions

export const MCP_MAX_SESSIONS = 32;

export function createMcpHttp(opts: { hub: AgentHub; version: string; log: Logger; maxSessions?: number }) {
  const { hub, version, log, maxSessions = MCP_MAX_SESSIONS } = opts;
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server; principalId: string }>();
  const backend = hubBackend(hub);

  const off = hub.onManifestChange(() => {
    for (const s of sessions.values()) s.server.sendToolListChanged().catch(() => undefined);
  });

  const jsonRpcError = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };

  return {
    async handle(req: IncomingMessage, res: ServerResponse, principal: Principal, body: unknown): Promise<void> {
      const sid = req.headers['mcp-session-id'];
      if (typeof sid === 'string') {
        const s = sessions.get(sid);
        if (!s || s.principalId !== principal.id) return jsonRpcError(res, 404, 'Session not found');
        await s.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST' || !isInitializeRequest(body)) return jsonRpcError(res, 400, 'Bad Request: no valid session id');
      if (sessions.size >= maxSessions) {
        const [oldest, s] = sessions.entries().next().value!;
        sessions.delete(oldest);
        await s.transport.close().catch(() => undefined);
      }
      const holder: { transport?: StreamableHTTPServerTransport } = {};
      const server = createMcpServer(backend, { version, fallbackClientName: principal.label, scope: () => holder.transport?.sessionId ?? 'http' });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, principalId: principal.id });
          log(`mcp: session opened by ${principal.label}`);
        },
      });
      holder.transport = transport;
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    },
    sessionCount: () => sessions.size,
    async close() {
      off();
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map((s) => s.server.close().catch(() => undefined)));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// stdio bridge backend (`vitals-companion mcp`)

export interface RemoteBackendOptions {
  /** Running Companion, e.g. `http://127.0.0.1:4870`. */
  url: string;
  adminToken: string | null;
  fileManifest: ToolManifest | null;
  fetch?: typeof globalThis.fetch;
  log: Logger;
  timeoutMs?: number;
}

/** Forwards to the running Companion (admin token, no Origin); falls back to the `--manifest` file when it is not running. */
export function remoteBackend(opts: RemoteBackendOptions): McpBackend {
  const { url, adminToken, fileManifest, log, timeoutMs = 3_000 } = opts;
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = url.replace(/\/+$/, '');
  if (adminToken) log.addSecret(adminToken);

  const remoteManifest = async (): Promise<{ reachable: boolean; manifest: ToolManifest | null }> => {
    if (!adminToken) return { reachable: false, manifest: null };
    try {
      const res = await doFetch(`${base}/v1/agent/manifest`, { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        log(`mcp: Companion answered ${res.status} for the manifest`);
        return { reachable: false, manifest: null };
      }
      const body = (await res.json()) as { manifest?: unknown };
      return { reachable: true, manifest: body.manifest ? await parseToolManifest(body.manifest) : null };
    } catch (e) {
      log(`mcp: Companion not reachable at ${base} (${e instanceof Error ? e.name : 'error'})`);
      return { reachable: false, manifest: null };
    }
  };

  return {
    async listTools() {
      const r = await remoteManifest();
      const m = r.manifest ?? fileManifest;
      return m ? toMcpTools(m) : [];
    },
    async call(tool, args, ctx) {
      const r = await remoteManifest();
      const check = checkCall(r.manifest ?? fileManifest, tool);
      if (!check.ok) return check.envelope;
      if (!r.reachable) return noTabEnvelope();
      try {
        const res = await doFetch(`${base}/v1/agent/call`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool, args, ...ctx }),
        });
        const body = (await res.json()) as { envelope?: ToolResultEnvelope };
        return body.envelope ?? noTabEnvelope();
      } catch {
        return noTabEnvelope();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Server-side MCP (SUITE_SPEC §14.4): `/mcp` authenticated by an agent token; tools run in the person's store
// through the person worker (`PersonContext.dispatch`), no browser tab involved.

export const MCP_MAX_SESSIONS_PER_TOKEN = 4;

export interface ServerMcpSessionOwner {
  personId: string;
  tokenId: string;
  label: string;
}

export interface ServerMcpOptions {
  version: string;
  log: Logger;
  maxSessions?: number;
  maxSessionsPerToken?: number;
}

/**
 * Streamable HTTP sessions bound to the agent token that opened them. `backend` is built per session by the caller;
 * `refresh(sid)` lets the caller swap in a fresh backend (the token is re-resolved on every request).
 */
export function createServerMcpHttp(opts: ServerMcpOptions) {
  const { version, log, maxSessions = MCP_MAX_SESSIONS, maxSessionsPerToken = MCP_MAX_SESSIONS_PER_TOKEN } = opts;
  type Session = { transport: StreamableHTTPServerTransport; server: Server; owner: ServerMcpSessionOwner; backend: { current: McpBackend } };
  const sessions = new Map<string, Session>();

  const jsonRpcError = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };
  const drop = async (sid: string) => {
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    await s.transport.close().catch(() => undefined);
  };

  return {
    async handle(req: IncomingMessage, res: ServerResponse, owner: ServerMcpSessionOwner, backend: McpBackend, body: unknown): Promise<void> {
      const sid = req.headers['mcp-session-id'];
      if (typeof sid === 'string') {
        const s = sessions.get(sid);
        if (!s || s.owner.tokenId !== owner.tokenId || s.owner.personId !== owner.personId) return jsonRpcError(res, 404, 'Session not found');
        s.backend.current = backend;
        await s.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST' || !isInitializeRequest(body)) return jsonRpcError(res, 400, 'Bad Request: no valid session id');
      const mine = [...sessions.entries()].filter(([, s]) => s.owner.tokenId === owner.tokenId);
      if (mine.length >= maxSessionsPerToken) await drop(mine[0]![0]);
      if (sessions.size >= maxSessions) await drop(sessions.keys().next().value!);
      const holder: { transport?: StreamableHTTPServerTransport } = {};
      const ref = { current: backend };
      const proxyBackend: McpBackend = { listTools: () => ref.current.listTools(), call: (t, a, c) => ref.current.call(t, a, c) };
      const server = createMcpServer(proxyBackend, { version, fallbackClientName: owner.label, scope: () => holder.transport?.sessionId ?? 'http' });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, owner, backend: ref });
          log(`mcp: session opened (person ${owner.personId}, token ${owner.tokenId})`);
        },
      });
      holder.transport = transport;
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    },
    /** Tells every open session of a person that its tool list changed. */
    toolsChanged(personId: string) {
      for (const s of sessions.values()) if (s.owner.personId === personId) s.server.sendToolListChanged().catch(() => undefined);
    },
    /** Closes the sessions of a revoked token. */
    async revokeToken(tokenId: string) {
      for (const [sid, s] of [...sessions]) if (s.owner.tokenId === tokenId) await drop(sid);
    },
    sessionCount: (tokenId?: string) => (tokenId ? [...sessions.values()].filter((s) => s.owner.tokenId === tokenId).length : sessions.size),
    async close() {
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map((s) => s.server.close().catch(() => undefined)));
    },
  };
}
