// @vitest-environment node
/**
 * Memory over the sequence the 2026-10-03 incident log shows, on the production shape: the bundled person program in
 * a real `worker_threads` Worker (with its heap limits), the relay in the same process with the person syncing to it,
 * the HTTP routes, `/mcp` and the MQTT broker. After each step it reads the worker's heap and the main thread's heap
 * and fails if a step grows the worker by more than 100 MB or the main thread by more than 50 MB. The table it prints
 * is what docs/wp/E32.md reports.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import mqtt from 'mqtt';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { SITE } from './testHome.ts';
import { threadWorkerFactory } from './workers.ts';

const pkg = new URL('../../', import.meta.url);
const repo = new URL('../../../../', import.meta.url);
const outDir = `dist/memtest-${process.pid}`;
const bundle = new URL(`${outDir}/person-worker.mjs`, pkg);
const done: Array<() => Promise<unknown>> = [];
// a full collection before each reading, so the numbers are what is kept and not garbage waiting for the collector
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

beforeAll(() => {
  // the bundle under test is built from this checkout, next to the package's node_modules (its externals resolve there)
  execFileSync('pnpm', ['exec', 'vite', 'build', '-c', 'vite.person.config.ts', '--outDir', outDir], { cwd: pkg, stdio: 'ignore' });
}, 300_000);
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  await rm(new URL(outDir, pkg), { recursive: true, force: true });
});

it('no step of the incident sequence grows the worker by 100 MB or the main thread by 50 MB', async () => {
  const dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'memory-'));
  done.push(() => rm(dataDir, { recursive: true, force: true }));
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', mqtt: { enabled: true }, rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: threadWorkerFactory(bundle) },
  });
  done.push(() => c.close());
  const home = c.home!;
  const api = async (path: string, token: string, body?: unknown) => {
    const r = await fetch(`${c.url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: SITE }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return (await r.json()) as Record<string, unknown>;
  };

  const rows: Array<{ step: string; workerHeapMb: number; mainHeapMb: number; rssMb: number }> = [];
  let personId = '';
  const measure = async (step: string) => {
    gc();
    const m = await home.pool.memory();
    const w = m.persons.find((p) => p.id === personId);
    rows.push({ step, workerHeapMb: w?.heapUsedMb ?? 0, mainHeapMb: m.heapUsedMb, rssMb: m.rssMb });
  };

  // a person syncing to the relay in this same process, as on oci-arm
  const p = await home.persons.add({ label: 'Mem', timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(7), relayUrl: `${c.url.replace('http', 'ws')}/sync` });
  personId = p.id;
  const { code } = await home.devices.issueCode(p.id);
  const paired = await (await fetch(`${c.url}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ code, label: 'phone' }) })).json() as { token: string };
  const device = paired.token;
  expect(device).toBeTruthy();
  expect((await home.pool.call(p.id, { op: 'stats' })).ok).toBe(true);
  await measure('open + pair device');

  const agents = [await api('/v1/agents/tokens', device, { client: 'codex', scope: 'log' }), await api('/v1/agents/tokens', device, { client: 'claude', scope: 'log' })];
  await measure('two agent tokens');

  const sessions: Client[] = [];
  for (const a of agents) {
    const client = new Client({ name: `mem-${sessions.length}`, version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${a.token as string}` } } }));
    done.push(() => client.close());
    sessions.push(client);
    expect((await client.listTools()).tools.length).toBeGreaterThan(5);
  }
  await measure('two MCP sessions');

  for (const s of sessions) {
    const today = await s.callTool({ name: 'today_get', arguments: {} });
    expect(JSON.stringify(today)).toContain('"ok\\":true');
    const steps = await s.callTool({ name: 'log_steps', arguments: { steps: 4000 } });
    expect(JSON.stringify(steps)).toContain('"ok\\":true');
  }
  await measure('today_get + log_steps x2');

  const ring = (await readFile(new URL('spike/headless/fixtures/ring.jsonl', pkg), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as unknown);
  const imported = await home.pool.call(p.id, { op: 'ingestLumen', events: ring, installations: {} });
  expect(imported.ok).toBe(true);
  await measure('Lumen import ring.jsonl');

  const cred = await api('/v1/mqtt/credentials', device, {});
  const m = await mqtt.connectAsync(`${c.url.replace('http', 'ws')}/mqtt`, { username: cred.username as string, password: cred.password as string, reconnectPeriod: 0 });
  done.push(() => m.endAsync(true));
  const stream = (await readFile(new URL('qa/fixtures/lumen/mqtt-stream.synthetic.jsonl', repo), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { topic: string; payload: string });
  for (let round = 0; round < 5; round++) for (const msg of stream) await m.publishAsync(msg.topic, msg.payload, { qos: 1 });
  await home.broker!.idle();
  await measure('MQTT stream x5');

  // living automation runs from the open; give its timers, the debounced rescoring and the sync loop time to fire
  await new Promise((r) => setTimeout(r, 8000));
  await measure('8 s idle (automation, rescoring, sync)');

  for (let i = 0; i < 30; i++) await sessions[i % 2]!.callTool({ name: 'today_get', arguments: {} });
  await measure('30 more MCP calls');

  // sessions beyond the per-token cap replace the oldest: twelve more must not keep growing the main thread
  for (let i = 0; i < 12; i++) {
    const client = new Client({ name: `churn-${i}`, version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agents[i % 2]!.token as string}` } } }));
    await client.listTools();
    await client.close();
  }
  await measure('12 more MCP sessions opened and closed');

  console.log(['| step | worker heap MB | main heap MB | process RSS MB |', '|---|---:|---:|---:|', ...rows.map((r) => `| ${r.step} | ${r.workerHeapMb} | ${r.mainHeapMb} | ${r.rssMb} |`)].join('\n'));
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i]!.workerHeapMb - rows[i - 1]!.workerHeapMb, rows[i]!.step).toBeLessThan(100);
    expect(rows[i]!.mainHeapMb - rows[i - 1]!.mainHeapMb, rows[i]!.step).toBeLessThan(50);
  }
  expect(rows.every((r) => r.workerHeapMb > 0)).toBe(true);
  const health = (await (await fetch(`${c.url}/health`)).json()) as { memoryMb: number };
  expect(health.memoryMb).toBeGreaterThan(rows[0]!.mainHeapMb);
}, 300_000);
