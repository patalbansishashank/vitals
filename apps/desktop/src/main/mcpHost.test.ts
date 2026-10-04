// @vitest-environment node
/**
 * End to end over a real local socket under .e6-tmp: the host (as in the app's main process), the bridge's pipe logic
 * (as in the `--mcp` child) with fake stdio, and an MCP SDK Client on top, as an AI tool would be.
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServerMcpHttp, type McpBackend } from '../../../../packages/companion/src/mcp.ts';
import { createRedactingLogger } from '../../../../packages/companion/src/security.ts';
import { parseToolManifest, toMcpTools, type ToolManifest, type ToolResultEnvelope } from '../../../../packages/companion/src/toolManifest.ts';
import { NOT_RUNNING_MESSAGE, runBridge } from '../mcp/node';
import type { McpCallRequest } from '../shared/bridge';
import { createMcpHost, NOT_READY_MESSAGE, type RemoteTarget } from './mcpHost';
import { createPageRelay, type PageRelay } from './pageRelay';

const FIXTURE = fileURLToPath(new URL('../../../../packages/companion/fixtures/tool-manifest.json', import.meta.url));
const base = path.resolve(process.cwd(), '.e6-tmp');
let dir: string;
let manifestJson: unknown;
let manifest: ToolManifest;
const cleanups: Array<() => Promise<unknown> | unknown> = [];

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'mcphost-'));
  manifestJson = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  manifest = await parseToolManifest(manifestJson);
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(() => rm(dir, { recursive: true, force: true }));

/** The page: answers every relayed call at once and remembers it. */
function fakePage(opts: { manifest?: unknown; answer?: (r: McpCallRequest) => ToolResultEnvelope } = {}) {
  const calls: McpCallRequest[] = [];
  const relay: PageRelay = createPageRelay({
    send: (req) => {
      calls.push(req);
      const envelope = opts.answer ? opts.answer(req) : { ok: true, status: 'applied' as const, summary: `did ${req.tool}`, data: req.tool === 'today_get' ? { date: '2026-10-01', score: 80 } : undefined };
      setImmediate(() => relay.handleResult({ callId: req.callId, envelope }));
    },
    timeoutMs: 500,
  });
  if (opts.manifest !== null) relay.setManifest(opts.manifest ?? manifestJson);
  return { relay, calls };
}

let n = 0;
async function startHost(relay: PageRelay, remote: (client: string | null) => Promise<RemoteTarget | null> = async () => null) {
  const socketPath = path.join(dir, `h${++n}.sock`);
  const lines: string[] = [];
  const host = createMcpHost({ socketPath, version: '0.4.0-test', relay, remote, listWaitMs: 0, log: (l) => void lines.push(l) });
  await host.start();
  cleanups.push(() => host.close());
  return { host, socketPath, lines };
}

/** An SDK transport over two streams, as the AI tool's stdio pair looks from its side. */
function streamTransport(toBridge: PassThrough, fromBridge: PassThrough): Transport {
  const rb = new ReadBuffer();
  const t: Transport = {
    async start() {
      fromBridge.on('data', (chunk: Buffer) => {
        rb.append(chunk);
        for (;;) {
          let m: JSONRPCMessage | null;
          try {
            m = rb.readMessage();
          } catch (e) {
            t.onerror?.(e as Error);
            continue;
          }
          if (!m) break;
          t.onmessage?.(m);
        }
      });
      fromBridge.on('end', () => t.onclose?.());
    },
    async send(m) {
      toBridge.write(serializeMessage(m));
    },
    async close() {
      toBridge.end();
      t.onclose?.();
    },
  };
  return t;
}

/** Bridge + SDK client against a socket; the bridge runs as in the child process, only with fake stdio. */
async function connectClient(socketPath: string, client: string | null, name = 'claude-code', bridge: Partial<Parameters<typeof runBridge>[0]> = {}) {
  const toBridge = new PassThrough();
  const fromBridge = new PassThrough();
  const stderr: string[] = [];
  const startApp = vi.fn();
  const exit = runBridge({ socketPath, client, stdin: toBridge, stdout: fromBridge, stderr: { write: (s: string) => stderr.push(s) }, startApp, waitMs: 300, retryMs: 20, ...bridge });
  const sdk = new Client({ name, version: '1.0.0' });
  await sdk.connect(streamTransport(toBridge, fromBridge));
  cleanups.push(async () => {
    await sdk.close().catch(() => undefined);
    await exit;
  });
  return { sdk, exit, stderr, startApp, toBridge, fromBridge };
}

const envelopeOf = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as ToolResultEnvelope;

describe('mcp host: local path (no server paired)', () => {
  it('listens with mode 0600 in a 0700 dir and removes a stale socket file', async () => {
    const page = fakePage();
    const sub = path.join(dir, 'sub', 'deeper');
    const socketPath = path.join(sub, 'mcp.sock');
    await mkdir(sub, { recursive: true, mode: 0o700 });
    const stale = createMcpHost({ socketPath, version: '0', relay: page.relay, remote: async () => null, listWaitMs: 0, log: () => undefined });
    await stale.start();
    // a second start on the same path (a crashed app left the file behind) must win
    const host = createMcpHost({ socketPath, version: '0', relay: page.relay, remote: async () => null, listWaitMs: 0, log: () => undefined });
    await host.start();
    cleanups.push(() => host.close());
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    const { sdk } = await connectClient(socketPath, 'codex');
    expect((await sdk.listTools()).tools.length).toBeGreaterThan(0);
    await stale.close().catch(() => undefined);
  });

  it('initialize, tools/list without destructive or ui-only tools, read and log calls reach the page with the client name', async () => {
    const page = fakePage();
    const { socketPath, lines } = await startHost(page.relay);
    const { sdk } = await connectClient(socketPath, 'claude-code', 'claude-code');

    expect(sdk.getServerVersion()).toMatchObject({ name: 'vitals', version: '0.4.0-test' });
    const names = (await sdk.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['log_get', 'log_measurement', 'plan_shift', 'today_get']);
    expect((await sdk.listTools()).tools).toEqual(toMcpTools(manifest));
    expect(names).not.toContain('plan_end');
    expect(names).not.toContain('settings_update');

    const read = await sdk.callTool({ name: 'today_get', arguments: {} });
    expect(read.isError).toBeFalsy();
    expect(read.structuredContent).toEqual({ date: '2026-10-01', score: 80 });
    const logged = await sdk.callTool({ name: 'log_measurement', arguments: { kind: 'weight', value: 80 } });
    expect(envelopeOf(logged)).toMatchObject({ ok: true, status: 'applied', summary: 'did log_measurement' });
    expect(logged.structuredContent).toMatchObject({ ok: true, status: 'applied' });

    expect(page.calls.map((c) => [c.client, c.tool])).toEqual([
      ['claude-code', 'today_get'],
      ['claude-code', 'log_measurement'],
    ]);
    expect(page.calls[1]!.args).toEqual({ kind: 'weight', value: 80 });
    // writes with `idempotency: 'key'` carry the key main derives (the bus refuses an agent write without one); reads do not
    expect(page.calls[1]!.idempotencyKey).toMatch(/^mcp_[\w-]{43}$/);
    expect(page.calls[0]!.idempotencyKey).toBeUndefined();

    // destructive and non-MCP tools are refused before the page sees them
    const destructive = await sdk.callTool({ name: 'plan_end', arguments: {} });
    expect(destructive.isError).toBe(true);
    expect(envelopeOf(destructive).error?.code).toBe('surface_forbidden');
    expect(envelopeOf(await sdk.callTool({ name: 'nav_open', arguments: {} })).error?.code).toBe('surface_forbidden');
    expect(page.calls).toHaveLength(2);
    expect(lines.some((l) => l.includes('connected locally'))).toBe(true);
  });

  it('the MCP client name from initialize wins over the --client id; the id is the fallback', async () => {
    const page = fakePage();
    const { socketPath } = await startHost(page.relay);
    const a = await connectClient(socketPath, 'codex', 'codex-mcp-client');
    await a.sdk.callTool({ name: 'log_get', arguments: {} });
    expect(page.calls.at(-1)!.client).toBe('codex-mcp-client');
  });

  it('without a manifest: no tools and a plain "still starting" answer; a manifest later sends tools/list_changed', async () => {
    const page = fakePage({ manifest: null });
    const { socketPath } = await startHost(page.relay);
    const { sdk } = await connectClient(socketPath, 'opencode', 'opencode');
    expect((await sdk.listTools()).tools).toEqual([]);
    const r = await sdk.callTool({ name: 'today_get', arguments: {} });
    expect(r.isError).toBe(true);
    expect(envelopeOf(r)).toMatchObject({ status: 'rejected', summary: NOT_READY_MESSAGE, error: { code: 'unavailable' } });
    expect(page.calls).toHaveLength(0);

    const changed = new Promise<void>((resolve) => sdk.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()));
    page.relay.setManifest(manifestJson);
    await changed;
    expect((await sdk.listTools()).tools.map((t) => t.name)).toContain('today_get');
    expect(envelopeOf(await sdk.callTool({ name: 'today_get', arguments: {} })).ok).toBe(true);
  });

  it('a relay timeout reaches the client as the running/timeout envelope', async () => {
    const relay = createPageRelay({ send: () => undefined, timeoutMs: 50 });
    relay.setManifest(manifestJson);
    const { socketPath } = await startHost(relay);
    const { sdk } = await connectClient(socketPath, null);
    const r = await sdk.callTool({ name: 'log_get', arguments: {} });
    expect(r.isError).toBe(true);
    expect(envelopeOf(r)).toMatchObject({ status: 'running', error: { code: 'timeout' } });
  });

  it('two sessions at once are independent; closing the host ends them', async () => {
    const page = fakePage();
    const { host, socketPath } = await startHost(page.relay);
    const a = await connectClient(socketPath, 'codex', 'codex');
    const b = await connectClient(socketPath, 'opencode', 'opencode');
    await Promise.all([a.sdk.callTool({ name: 'log_get', arguments: {} }), b.sdk.callTool({ name: 'today_get', arguments: {} })]);
    expect(page.calls.map((c) => c.client).sort()).toEqual(['codex', 'opencode']);
    expect(host.sessionCount()).toBe(2);
    await host.close();
    expect(await a.exit).toBe(0);
    expect(await b.exit).toBe(0);
    expect(host.sessionCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** A stand-in for the Vitals server's `/mcp`: the Companion's session code with a backend that records calls. */
async function fakeServer() {
  const seenAuth: Array<string | undefined> = [];
  const calls: Array<{ tool: string; args: unknown; clientName: string }> = [];
  const backend: McpBackend = {
    listTools: async () => [{ name: 'today_get', title: 'Today', description: 'From the server', inputSchema: { type: 'object', properties: {} }, annotations: { title: 'Today', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }],
    call: async (tool, args, ctx) => {
      calls.push({ tool, args, clientName: ctx.clientName });
      return { ok: true, status: 'applied', summary: `server did ${tool}`, data: { from: 'server' } };
    },
  };
  const mcp = createServerMcpHttp({ version: 'srv-1', log: createRedactingLogger() });
  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const parts: Buffer[] = [];
    for await (const c of req as AsyncIterable<Buffer>) parts.push(c);
    const text = Buffer.concat(parts).toString('utf8');
    return text ? JSON.parse(text) : undefined;
  };
  const server: HttpServer = createHttpServer(async (req, res) => {
    seenAuth.push(req.headers.authorization);
    if (req.headers.authorization !== 'Bearer agent-token-xyz') {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'bad token' }, id: null }));
      return;
    }
    await mcp.handle(req, res, { personId: 'p1', tokenId: 't1', label: 'Codex' }, backend, req.method === 'POST' ? await readJson(req) : undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  cleanups.push(async () => {
    await mcp.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  return { mcpUrl: `http://127.0.0.1:${port}/mcp`, seenAuth, calls, mcp };
}

describe('mcp host: remote path (server paired)', () => {
  it('relays JSON-RPC raw to the server with the bearer token; tools and results are the server\'s', async () => {
    const srv = await fakeServer();
    const page = fakePage();
    const remote = vi.fn(async (client: string | null) => (client === 'codex' ? { mcpUrl: srv.mcpUrl, token: 'agent-token-xyz' } : null));
    const { socketPath, lines } = await startHost(page.relay, remote);
    const { sdk } = await connectClient(socketPath, 'codex', 'codex-mcp-client');

    expect(remote).toHaveBeenCalledWith('codex');
    expect(sdk.getServerVersion()).toMatchObject({ version: 'srv-1' });
    const tools = (await sdk.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(['today_get']);
    expect(tools[0]!.description).toBe('From the server');
    const r = await sdk.callTool({ name: 'today_get', arguments: { day: 'today' } });
    expect(envelopeOf(r)).toMatchObject({ ok: true, summary: 'server did today_get' });
    expect(srv.calls).toEqual([{ tool: 'today_get', args: { day: 'today' }, clientName: 'codex-mcp-client' }]);
    expect(srv.seenAuth.length).toBeGreaterThan(0);
    expect(srv.seenAuth.every((a) => a === 'Bearer agent-token-xyz')).toBe(true);
    expect(page.calls).toHaveLength(0);
    expect(srv.mcp.sessionCount()).toBe(1);
    expect(lines.join('\n')).not.toContain('agent-token-xyz');
    expect(lines.some((l) => l.includes('through the server'))).toBe(true);
  });

  it('an unknown client id gets no token and runs locally', async () => {
    const srv = await fakeServer();
    const page = fakePage();
    const remote = vi.fn(async (client: string | null) => (client ? { mcpUrl: srv.mcpUrl, token: 'agent-token-xyz' } : null));
    const { socketPath } = await startHost(page.relay, remote);
    const { sdk } = await connectClient(socketPath, 'not-a-known-tool');
    expect(remote).toHaveBeenCalledWith(null);
    await sdk.callTool({ name: 'log_get', arguments: {} });
    expect(page.calls).toHaveLength(1);
    expect(srv.calls).toHaveLength(0);
  });

  it('falls back to local when the server is not reachable at connect time', async () => {
    const page = fakePage();
    const { socketPath, lines } = await startHost(page.relay, async () => ({ mcpUrl: 'http://127.0.0.1:1/mcp', token: 'agent-token-xyz' }));
    const { sdk } = await connectClient(socketPath, 'codex', 'codex');
    expect(sdk.getServerVersion()).toMatchObject({ version: '0.4.0-test' });
    expect((await sdk.listTools()).tools.map((t) => t.name)).toContain('log_measurement');
    await sdk.callTool({ name: 'log_get', arguments: {} });
    expect(page.calls).toHaveLength(1);
    expect(lines.some((l) => l.includes('running locally'))).toBe(true);
    expect(lines.join('\n')).not.toContain('agent-token-xyz');
  });

  it('a rejected token also falls back to local, and nothing logs it', async () => {
    const srv = await fakeServer();
    const page = fakePage();
    const { socketPath, lines } = await startHost(page.relay, async () => ({ mcpUrl: srv.mcpUrl, token: 'wrong-token' }));
    const { sdk } = await connectClient(socketPath, 'codex', 'codex');
    expect(sdk.getServerVersion()).toMatchObject({ version: '0.4.0-test' });
    expect(lines.join('\n')).not.toContain('wrong-token');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('bridge: Vitals not running', () => {
  it('tries to start the app, retries, then answers initialize with an error and exits 1', async () => {
    const toBridge = new PassThrough();
    const fromBridge = new PassThrough();
    const stderr: string[] = [];
    const startApp = vi.fn();
    const out: string[] = [];
    fromBridge.on('data', (c: Buffer) => out.push(c.toString()));
    const exit = runBridge({ socketPath: path.join(dir, 'nobody.sock'), client: 'codex', stdin: toBridge, stdout: fromBridge, stderr: { write: (s: string) => stderr.push(s) }, startApp, waitMs: 150, retryMs: 20 });
    toBridge.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '1' } } })}\n`);
    expect(await exit).toBe(1);
    expect(startApp).toHaveBeenCalledTimes(1);
    expect(out.join('')).toBe(`${JSON.stringify({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: NOT_RUNNING_MESSAGE } })}\n`);
    expect(stderr.join('')).toContain(NOT_RUNNING_MESSAGE);
  });

  it('the app coming up during the wait is picked up', async () => {
    const page = fakePage();
    const socketPath = path.join(dir, 'late.sock');
    let host: ReturnType<typeof createMcpHost> | null = null;
    const startApp = vi.fn(() => {
      host = createMcpHost({ socketPath, version: '0.4.0-test', relay: page.relay, remote: async () => null, listWaitMs: 0, log: () => undefined });
      setTimeout(() => void host!.start(), 60);
    });
    cleanups.push(() => host?.close());
    const { sdk } = await connectClient(socketPath, 'codex', 'codex', { startApp, waitMs: 2000, retryMs: 20 });
    expect(startApp).toHaveBeenCalledTimes(1);
    expect((await sdk.listTools()).tools.length).toBeGreaterThan(0);
  });
});
