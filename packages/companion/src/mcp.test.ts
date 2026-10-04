// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import { clientDisplayName, idempotencyKeyFor, NO_TAB_MESSAGE } from './agentHub.ts';
import { BRIDGE_CLOSE, BRIDGE_PATH, type CompanionMessage } from './bridgeProtocol.ts';
import { MCP_INSTRUCTIONS } from './briefingRules.ts';
import { BRIEFING_URI, createMcpServer, remoteBackend, type McpBackend } from './mcp.ts';
import { createRedactingLogger, type Logger } from './security.ts';
import { startCompanion, type Companion } from './server.ts';
import { rawCall, tempDir } from './testHelpers.ts';
import { parseToolManifest, toMcpTools, type McpToolDescriptor, type ToolManifest, type ToolResultEnvelope } from './toolManifest.ts';

const APP = 'https://vitals.creative.desi';
const FIXTURE = fileURLToPath(new URL('../fixtures/tool-manifest.json', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/vitals-companion.mjs', import.meta.url));

let tmp: ReturnType<typeof tempDir>;
let companion: Companion;
let configDir: string;
let manifest: ToolManifest;
let browserToken: string;
let clientToken: string;
let admin: string;
const log: Logger = createRedactingLogger();

interface FakeTab {
  ws: WebSocket;
  calls: Extract<CompanionMessage, { type: 'call' }>[];
  closed: Promise<number>;
  ready: Promise<CompanionMessage>;
}

/** A fake Vitals tab: says hello with the pairing token and answers every call with `answer(call)`. */
function openTab(token: string, opts: { origin?: string; hello?: boolean; manifest?: unknown; answer?: (c: Extract<CompanionMessage, { type: 'call' }>) => ToolResultEnvelope | null } = {}): FakeTab {
  const ws = new WebSocket(`ws://127.0.0.1:${companion.port}${BRIDGE_PATH}`, { origin: opts.origin ?? APP });
  const calls: FakeTab['calls'] = [];
  let resolveReady!: (m: CompanionMessage) => void;
  const ready = new Promise<CompanionMessage>((r) => (resolveReady = r));
  const closed = new Promise<number>((r) => {
    ws.on('close', (code) => r(code));
    ws.on('unexpected-response', (_req, res) => r(res.statusCode ?? 0));
  });
  ws.on('error', () => undefined);
  ws.on('open', () => {
    if (opts.hello !== false) ws.send(JSON.stringify({ type: 'hello', token, manifest: opts.manifest ?? manifest }));
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as CompanionMessage;
    if (msg.type === 'ready') resolveReady(msg);
    if (msg.type === 'call') {
      calls.push(msg);
      const envelope = opts.answer ? opts.answer(msg) : { ok: true, status: msg.stage ? 'pending_user' : 'applied', summary: `did ${msg.tool}`, data: msg.tool === 'today_get' ? { date: '2026-10-01', score: 80 } : undefined };
      if (envelope) ws.send(JSON.stringify({ type: 'result', callId: msg.callId, envelope }));
    }
  });
  return { ws, calls, closed, ready };
}

async function httpClient(token: string, name = 'test-http-client') {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${companion.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const envelopeOf = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as ToolResultEnvelope;

beforeAll(async () => {
  tmp = tempDir();
  configDir = join(tmp.dir, 'config');
  manifest = await parseToolManifest(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  companion = await startCompanion({ port: 0, allowedOrigins: [], relay: false, agent: true, configDir, callTimeoutMs: 300 });
  admin = readFileSync(join(configDir, 'admin.token'), 'utf8').trim();
  const pair = await rawCall(companion.port, 'POST', '/v1/pair/local', { Origin: APP, 'Content-Type': 'application/json' }, JSON.stringify({ code: companion.pairingCode!.code }));
  browserToken = pair.json().token as string;
  clientToken = (await rawCall(companion.port, 'POST', '/v1/pair/client', { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, '{"name":"claude-code"}')).json().token as string;
});
afterAll(async () => {
  await companion.close();
  tmp.cleanup();
});

describe('clientDisplayName (Q5-02)', () => {
  it('maps known MCP client ids to product names and passes unknown ids through', () => {
    expect(clientDisplayName('codex-mcp-client')).toBe('Codex or the ChatGPT app');
    expect(clientDisplayName('cli')).toBe('OpenCode');
    expect(clientDisplayName('opencode')).toBe('OpenCode');
    expect(clientDisplayName('claude-code')).toBe('Claude Code');
    expect(clientDisplayName('chatgpt')).toBe('ChatGPT');
    expect(clientDisplayName('mcp-stdio')).toBe('mcp-stdio');
    expect(clientDisplayName('toString')).toBe('toString');
  });
});

describe('agent bridge WebSocket', () => {
  it('refuses foreign origins, missing/wrong hello and bad manifests', async () => {
    expect(await openTab(browserToken, { origin: 'https://evil.example' }).closed).toBe(403);
    expect(await openTab('x'.repeat(43)).closed).toBe(BRIDGE_CLOSE.unauthorized);
    // token bound to another origin
    expect(await openTab(browserToken, { origin: 'http://localhost:5173' }).closed).toBe(BRIDGE_CLOSE.unauthorized);
    expect(await openTab(browserToken, { manifest: { format: 'nope', tools: [] } }).closed).toBe(BRIDGE_CLOSE.badMessage);
    expect(companion.roles).toContain('agent');
  });
});

describe('MCP over Streamable HTTP', () => {
  it('lists no tools without a manifest, then exactly toMcpTools(fixture) once a tab connects (list_changed sent)', async () => {
    const client = await httpClient(clientToken);
    try {
      expect((await client.listTools()).tools).toEqual([]);
      let changed = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => void changed++);
      const tab = openTab(browserToken);
      await tab.ready;
      await vi.waitFor(() => expect(changed).toBeGreaterThanOrEqual(1), { timeout: 2000 });
      const { tools } = await client.listTools();
      expect(tools).toEqual(toMcpTools(manifest));
      expect(tools.map((t) => t.name).sort()).toEqual(['log_get', 'log_measurement', 'plan_shift', 'today_get']);
      expect(tools.map((t) => t.name)).not.toEqual(expect.arrayContaining(['plan_end']));
      const status = await rawCall(companion.port, 'GET', '/v1/pair/status', { Origin: APP, Authorization: `Bearer ${browserToken}` });
      expect(status.json().tab).toEqual({ connected: true, toolCount: 7 });
      tab.ws.close();
      await tab.closed;
      await vi.waitFor(() => expect(changed).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    } finally {
      await client.close();
    }
  });

  it('forwards calls to the tab with actor, idempotency key and staging; refuses destructive and hidden tools', async () => {
    const tab = openTab(browserToken);
    await tab.ready;
    const client = await httpClient(admin, 'claude-desktop');
    try {
      const logged = await client.callTool({ name: 'log_measurement', arguments: { kind: 'weight', value: 82.4 } });
      expect(logged.isError).toBe(false);
      expect(logged.structuredContent).toMatchObject({ ok: true, status: 'applied' });
      const shifted = await client.callTool({ name: 'plan_shift', arguments: { days: 2 } });
      expect(shifted.structuredContent).toMatchObject({ ok: true, status: 'pending_user' });
      const today = await client.callTool({ name: 'today_get', arguments: {} });
      expect(today.structuredContent).toEqual({ date: '2026-10-01', score: 80 });

      expect(tab.calls.map((c) => [c.tool, c.commandId, c.stage])).toEqual([
        ['log_measurement', 'log.measurement', false],
        ['plan_shift', 'plan.shift', true],
        ['today_get', 'today.get', false],
      ]);
      const first = tab.calls[0]!;
      expect(first.actor).toEqual({ kind: 'mcp', id: 'claude-desktop' });
      expect(first.args).toEqual({ kind: 'weight', value: 82.4 });
      expect(first.idempotencyKey.length).toBeLessThanOrEqual(64);
      expect(new Set(tab.calls.map((c) => c.idempotencyKey)).size).toBe(3);

      for (const name of ['plan_end', 'settings_update', 'nav_open', 'no_such_tool']) {
        const r = await client.callTool({ name, arguments: {} });
        expect(r.isError, name).toBe(true);
        expect(r.structuredContent).toMatchObject({ ok: false, status: 'rejected', error: { code: 'surface_forbidden' } });
      }
      expect(tab.calls).toHaveLength(3);
    } finally {
      await client.close();
      tab.ws.close();
      await tab.closed;
    }
  });

  it('a newer tab replaces the older (4409); a silent tab times out as running', async () => {
    const older = openTab(browserToken);
    await older.ready;
    const newer = openTab(browserToken, { answer: () => null });
    await newer.ready;
    expect(await older.closed).toBe(BRIDGE_CLOSE.replaced);
    const client = await httpClient(admin);
    try {
      const r = await client.callTool({ name: 'log_get', arguments: { from: '2026-09-01', to: '2026-09-30' } });
      expect(r.isError).toBe(true);
      expect(envelopeOf(r)).toMatchObject({ ok: false, status: 'running', error: { code: 'timeout' } });
    } finally {
      await client.close();
      newer.ws.close();
      await newer.closed;
    }
  });

  it('without a tab, calls return the "open Vitals" envelope', async () => {
    const client = await httpClient(admin);
    try {
      const r = await client.callTool({ name: 'log_get', arguments: {} });
      expect(r.isError).toBe(true);
      expect(envelopeOf(r).summary).toBe(NO_TAB_MESSAGE);
    } finally {
      await client.close();
    }
  });

  it('needs an admin or client token, without Origin; sessions are bound to their token', async () => {
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    expect((await rawCall(companion.port, 'POST', '/mcp', h, init)).status).toBe(401);
    expect((await rawCall(companion.port, 'POST', '/mcp', { ...h, Origin: APP, Authorization: `Bearer ${browserToken}` }, init)).status).toBe(401);
    expect((await rawCall(companion.port, 'POST', '/mcp', { ...h, Origin: 'https://evil.example', Authorization: `Bearer ${admin}` }, init)).status).toBe(403);
    const ok = await rawCall(companion.port, 'POST', '/mcp', { ...h, Authorization: `Bearer ${clientToken}` }, init);
    expect(ok.status).toBe(200);
    const sid = ok.headers['mcp-session-id'] as string;
    expect(sid).toBeTruthy();
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((await rawCall(companion.port, 'POST', '/mcp', { ...h, Authorization: `Bearer ${admin}`, 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' }, list)).status).toBe(404);
  });
});

describe('stdio bridge', () => {
  it('in-process: forwards tools/list and tools/call to the running Companion with the admin token', async () => {
    const tab = openTab(browserToken);
    await tab.ready;
    const server = createMcpServer(remoteBackend({ url: companion.url, adminToken: admin, fileManifest: null, log }), { version: '0', fallbackClientName: 'mcp-stdio', scope: () => 'proc-1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'codex', version: '1' });
    await client.connect(b);
    try {
      expect((await client.listTools()).tools).toEqual(toMcpTools(manifest));
      const r = await client.callTool({ name: 'plan_shift', arguments: { days: 1 } });
      expect(r.structuredContent).toMatchObject({ status: 'pending_user' });
      const call = tab.calls.at(-1)!;
      expect(call).toMatchObject({ tool: 'plan_shift', stage: true, actor: { kind: 'mcp', id: 'codex' } });
      expect(call.idempotencyKey).toMatch(/^mcp_/);
      expect((await client.callTool({ name: 'plan_end', arguments: {} })).isError).toBe(true);
      expect(tab.calls.filter((c) => c.tool === 'plan_end')).toHaveLength(0);
    } finally {
      await client.close();
      tab.ws.close();
      await tab.closed;
    }
  });

  it('spawned with --manifest and no Companion: lists the file tools and answers with the no-tab error; stdout is JSON-RPC only', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, 'mcp', '--manifest', FIXTURE, '--url', 'http://127.0.0.1:9', '--config-dir', join(tmp.dir, 'none')],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'spawn-test', version: '1' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toEqual(toMcpTools(manifest));
      const r = await client.callTool({ name: 'log_measurement', arguments: { kind: 'weight', value: 80 } });
      expect(r.isError).toBe(true);
      expect(envelopeOf(r).summary).toBe(NO_TAB_MESSAGE);
      const destructive = await client.callTool({ name: 'plan_end', arguments: {} });
      expect(envelopeOf(destructive).error?.code).toBe('surface_forbidden');
    } finally {
      await client.close();
    }
  }, 20_000);
});

describe('idempotency keys', () => {
  it('derive from (client, scope, request id), ≤ 64 chars, stable', () => {
    const k = idempotencyKeyFor('claude', 's1', 7);
    expect(k).toBe(idempotencyKeyFor('claude', 's1', 7));
    expect(k).not.toBe(idempotencyKeyFor('claude', 's2', 7));
    expect(k).not.toBe(idempotencyKeyFor('codex', 's1', 7));
    expect(k.length).toBeLessThanOrEqual(64);
  });
});

describe('the Coach’s briefing over MCP (plan 04 item 12)', () => {
  const BRIEFING = 'Now: 2026-10-02T08:00:00.000Z · today 2026-10-02.\nPlan: Medium plan (rung medium), day 5 of 28, active, version 1.';
  const briefingTool = { name: 'briefing_get', title: 'Read the person’s briefing', description: 'Call this first.', inputSchema: { type: 'object' as const, properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const, title: 'Read the person’s briefing' } };

  /** A backend with `tools` and a `briefing_get` that answers `answer()`; records the calls. */
  function fakeBackend(tools: McpToolDescriptor[], answer: () => ToolResultEnvelope | Promise<ToolResultEnvelope>) {
    const calls: Array<{ tool: string; args: unknown; clientName: string }> = [];
    const backend: McpBackend = {
      listTools: async () => tools,
      call: async (tool, args, ctx) => {
        calls.push({ tool, args, clientName: ctx.clientName });
        return answer();
      },
    };
    return { backend, calls };
  }

  async function connect(backend: McpBackend) {
    const server = createMcpServer(backend, { version: '0', fallbackClientName: 'mcp-test', scope: () => 's1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'claude-code', version: '1' });
    await client.connect(b);
    return client;
  }

  const ok = (): ToolResultEnvelope => ({ ok: true, status: 'applied', summary: 'Looked at read the person’s briefing.', data: { text: BRIEFING, sections: ['static', 'date', 'plan'], quiet: false } });

  it('initialize carries the rules as instructions (no personal data) and declares prompts and resources', async () => {
    const { backend, calls } = fakeBackend([briefingTool], ok);
    const client = await connect(backend);
    try {
      const instructions = client.getInstructions();
      expect(instructions).toBe(MCP_INSTRUCTIONS);
      expect(instructions).toContain('briefing_get');
      expect(instructions).not.toContain('Medium plan');
      expect(instructions).not.toMatch(/@|\d+(\.\d+)?\s?(kg|kcal|cm)\b/);
      expect(instructions!.length).toBeLessThanOrEqual(2600);
      expect(client.getServerCapabilities()).toMatchObject({ tools: { listChanged: true }, prompts: {}, resources: {} });
      // initialize alone reads nothing of the person
      expect(calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('prompts/list and prompts/get coach: the rules plus the person’s briefing from briefing_get', async () => {
    const { backend, calls } = fakeBackend([briefingTool], ok);
    const client = await connect(backend);
    try {
      expect((await client.listPrompts()).prompts).toEqual([expect.objectContaining({ name: 'coach', title: 'Vitals Coach' })]);
      const p = await client.getPrompt({ name: 'coach' });
      expect(p.messages).toHaveLength(1);
      expect(p.messages[0]!.role).toBe('user');
      const text = (p.messages[0]!.content as { text: string }).text;
      expect(text.startsWith(MCP_INSTRUCTIONS)).toBe(true);
      expect(text).toContain(BRIEFING);
      expect(calls).toEqual([{ tool: 'briefing_get', args: {}, clientName: 'claude-code' }]);
      await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow(/no prompt called "nope"/);
    } finally {
      await client.close();
    }
  });

  it('resources/list and resources/read vitals://briefing give the briefing text', async () => {
    const { backend } = fakeBackend([briefingTool], ok);
    const client = await connect(backend);
    try {
      expect((await client.listResources()).resources).toEqual([expect.objectContaining({ uri: BRIEFING_URI, name: 'briefing', mimeType: 'text/plain' })]);
      const r = await client.readResource({ uri: BRIEFING_URI });
      expect(r.contents).toEqual([{ uri: BRIEFING_URI, mimeType: 'text/plain', text: BRIEFING }]);
      await expect(client.readResource({ uri: 'vitals://other' })).rejects.toThrow(/no resource at/);
    } finally {
      await client.close();
    }
  });

  it('an app without briefing_get, a refused call or a backend that throws: plain words, the session stays up', async () => {
    const older = fakeBackend([{ ...briefingTool, name: 'today_get' }], ok);
    let client = await connect(older.backend);
    try {
      const text = ((await client.getPrompt({ name: 'coach' })).messages[0]!.content as { text: string }).text;
      expect(text).toContain(MCP_INSTRUCTIONS);
      expect(text).toContain('The person’s briefing is not available: This version of the Vitals app cannot share the briefing yet.');
      await expect(client.readResource({ uri: BRIEFING_URI })).rejects.toThrow(/cannot share the briefing yet/);
      expect(older.calls).toEqual([]);
      // tools still work
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['today_get']);
    } finally {
      await client.close();
    }

    const noTab = fakeBackend([], () => ({ ok: false, status: 'rejected', summary: NO_TAB_MESSAGE, error: { code: 'no_tab', message: NO_TAB_MESSAGE } }));
    client = await connect(noTab.backend);
    try {
      await expect(client.readResource({ uri: BRIEFING_URI })).rejects.toThrow(NO_TAB_MESSAGE);
      expect(((await client.getPrompt({ name: 'coach' })).messages[0]!.content as { text: string }).text).toContain(NO_TAB_MESSAGE);
    } finally {
      await client.close();
    }

    const broken = fakeBackend([briefingTool], () => Promise.reject(new Error('socket hang up')));
    client = await connect(broken.backend);
    try {
      await expect(client.readResource({ uri: BRIEFING_URI })).rejects.toThrow(/could not read the briefing/);
      expect((await client.listPrompts()).prompts).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
