// @vitest-environment node
/**
 * Adversarial checks of the MCP host over a real socket (raw lines, no SDK on the client side): hello parsing, an
 * unreachable server after the hello, connections that go away mid-start, oversized lines.
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AiToolId } from '../shared/bridge';
import { createMcpHost, type RemoteTarget } from './mcpHost';
import { createPageRelay } from './pageRelay';

const FIXTURE = fileURLToPath(new URL('../../../../packages/companion/fixtures/tool-manifest.json', import.meta.url));
const base = path.resolve(process.cwd(), '.e6-tmp');
let dir: string;
let n = 0;
const cleanups: Array<() => Promise<unknown> | unknown> = [];

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'mcpverify-'));
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } };

async function host(remote: (c: AiToolId | null) => Promise<RemoteTarget | null>) {
  const relay = createPageRelay({ send: () => undefined, timeoutMs: 200 });
  relay.setManifest(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const socketPath = path.join(dir, `v${++n}.sock`);
  const logs: string[] = [];
  const h = createMcpHost({ socketPath, version: '0', relay, remote, listWaitMs: 0, log: (l) => void logs.push(l) });
  await h.start();
  cleanups.push(() => h.close());
  return { h, socketPath, logs };
}

/** A raw client: collects the lines the host writes. */
async function raw(socketPath: string) {
  const s: Socket = connect(socketPath);
  await new Promise<void>((ok, no) => s.once('connect', ok).once('error', no));
  const lines: string[] = [];
  let buf = '';
  s.on('data', (c) => {
    buf += c.toString();
    let at: number;
    while ((at = buf.indexOf('\n')) !== -1) {
      lines.push(buf.slice(0, at));
      buf = buf.slice(at + 1);
    }
  });
  s.on('error', () => undefined);
  cleanups.push(() => s.destroy());
  const waitFor = async (pred: (l: string) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = lines.find(pred);
      if (hit) return hit;
      await sleep(10);
    }
    return null;
  };
  return { s, lines, waitFor };
}

describe('mcp host (verify)', () => {
  it('a hello with a forged or odd client id never reaches remote() as an id', async () => {
    const seen: Array<AiToolId | null> = [];
    const { socketPath } = await host(async (c) => {
      seen.push(c);
      return null;
    });
    for (const hello of ['{"client":"../codex"}', '{"client":"codex\\n"}', '{"client":["codex"]}', '{"client":"admin"}']) {
      const c = await raw(socketPath);
      c.s.write(`${hello}\n${JSON.stringify(INIT)}\n`);
      expect(await c.waitFor((l) => l.includes('"id":1'))).not.toBeNull();
    }
    expect(seen).toEqual([null, null, null, null]);
  });

  it('a paired server that is down still answers initialize when it arrives after the hello was handled (fallback to local)', async () => {
    // a closed port: the POST fails at once
    const { socketPath, logs } = await host(async () => ({ mcpUrl: 'http://127.0.0.1:9/mcp', token: 'tok-secret-123' }));
    const c = await raw(socketPath);
    c.s.write('{"client":"codex"}\n');
    await sleep(150); // remote() has resolved; the AI tool sends initialize a moment later
    c.s.write(`${JSON.stringify(INIT)}\n`);
    const reply = await c.waitFor((l) => l.includes('"id":1'), 5000);
    expect(reply).not.toBeNull();
    expect(JSON.parse(reply!).result?.serverInfo).toBeTruthy();
    expect(logs.join('\n')).not.toContain('tok-secret-123');
  });

  it('a connection that closes while the session is starting leaves no session behind', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { h, socketPath } = await host(async () => {
      await gate;
      return null;
    });
    const c = await raw(socketPath);
    c.s.write(`{"client":"codex"}\n${JSON.stringify(INIT)}\n`);
    await sleep(50);
    c.s.destroy();
    await sleep(50);
    release();
    await sleep(100);
    expect(h.sessionCount()).toBe(0);
  });

  it('a close while the server probe is in flight leaves no session behind', async () => {
    // a server that takes its time and then refuses: the host falls back to local after the socket is gone
    const slow = createHttpServer((_req, res) => void setTimeout(() => res.writeHead(503).end(), 200));
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => slow.close(r)));
    const port = (slow.address() as AddressInfo).port;
    const { h, socketPath } = await host(async () => ({ mcpUrl: `http://127.0.0.1:${port}/mcp`, token: 't' }));
    const c = await raw(socketPath);
    c.s.write(`{"client":"codex"}\n${JSON.stringify(INIT)}\n`);
    await sleep(80);
    c.s.destroy();
    await sleep(400);
    expect(h.sessionCount()).toBe(0);
  });

  it('a first line that is not JSON-RPC does not leave a server session that swallows the next failure', async () => {
    const { socketPath } = await host(async () => ({ mcpUrl: 'http://127.0.0.1:9/mcp', token: 't' }));
    const c = await raw(socketPath);
    c.s.write('{"client":"codex"}\n{oops\n');
    expect(await c.waitFor((l) => l.includes('-32700'))).not.toBeNull();
    c.s.write(`${JSON.stringify(INIT)}\n`);
    expect(await c.waitFor((l) => l.includes('"id":1'), 4000)).not.toBeNull();
  });

  it('garbage instead of a hello gets a JSON-RPC parse error, not a crash', async () => {
    const { socketPath } = await host(async () => null);
    const c = await raw(socketPath);
    c.s.write('not json at all\n');
    const reply = await c.waitFor(() => true);
    expect(JSON.parse(reply!)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('a line over the limit ends the connection', async () => {
    const { socketPath } = await host(async () => null);
    const c = await raw(socketPath);
    c.s.write('{"client":"codex"}\n');
    const closed = new Promise<void>((r) => c.s.once('close', () => r()));
    c.s.write(Buffer.alloc(5 * 1024 * 1024, 0x61));
    await expect(Promise.race([closed.then(() => 'closed'), sleep(3000).then(() => 'open')])).resolves.toBe('closed');
  });
});
