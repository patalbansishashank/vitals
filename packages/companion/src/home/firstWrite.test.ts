// @vitest-environment node
/**
 * Q8-10: the first `log_steps` over MCP right after a person's worker opened sometimes hung past the client's 60 s.
 * Production shape: the bundled person program in a real Worker, the relay in this process with the person syncing
 * to it, `/mcp` with an agent token. For 20 fresh persons: open, then at once `log_steps`; each must answer in 5 s.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { SITE } from './testHome.ts';
import { threadWorkerFactory } from './workers.ts';

const pkg = new URL('../../', import.meta.url);
const outDir = `dist/firstwrite-${process.pid}`;
const bundle = new URL(`${outDir}/person-worker.mjs`, pkg);
const done: Array<() => Promise<unknown>> = [];
const PERSONS = Number(process.env.FIRST_WRITE_PERSONS ?? 20);

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'vite', 'build', '-c', 'vite.person.config.ts', '--outDir', outDir], { cwd: pkg, stdio: 'ignore' });
}, 300_000);
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  await rm(new URL(outDir, pkg), { recursive: true, force: true });
});

const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms))]);

it('the first log_steps after a person opens answers within 5 s, for 20 fresh persons', async () => {
  const dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'first-write-'));
  done.push(() => rm(dataDir, { recursive: true, force: true }));
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: threadWorkerFactory(bundle), maxOpenPersons: 2 },
  });
  done.push(() => c.close());
  const home = c.home!;
  const times: number[] = [];
  for (let i = 0; i < PERSONS; i++) {
    const p = await home.persons.add({ label: `P${i}`, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(i + 1), relayUrl: `${c.url.replace('http', 'ws')}/sync` });
    const { code } = await home.devices.issueCode(p.id);
    const paired = (await (await fetch(`${c.url}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ code, label: 'phone' }) })).json()) as { token: string };
    const agent = (await (await fetch(`${c.url}/v1/agents/tokens`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}`, 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ client: 'codex', scope: 'log' }) })).json()) as { token: string };
    // the pairing opened the worker; close it so the MCP call is the first request of a fresh open
    await home.pool.close(p.id);
    const client = new Client({ name: `fw-${i}`, version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agent.token}` } } }));
    const t0 = performance.now();
    const r = await within(client.callTool({ name: 'log_steps', arguments: { steps: 4000 + i } }, undefined, { timeout: 60_000 }), 5000, `person ${i}: first log_steps`);
    times.push(Math.round(performance.now() - t0));
    expect(JSON.stringify(r)).toContain('"ok\\":true');
    await client.close();
  }
  console.log(JSON.stringify({ firstLogStepsMs: times }));
}, 600_000);

it('a fresh server replica of a group that already holds data: today_get, then log_steps within 5 s', async () => {
  const dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'first-write-group-'));
  done.push(() => rm(dataDir, { recursive: true, force: true }));
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: threadWorkerFactory(bundle) },
  });
  done.push(() => c.close());
  const home = c.home!;
  const relayUrl = `${c.url.replace('http', 'ws')}/sync`;
  const ring = (await readFile(new URL('spike/headless/fixtures/ring.jsonl', pkg), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as unknown);
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    const secret = new Uint8Array(32).fill(100 + i);
    // the group's history, written by another replica (a browser in production)
    const seed = await home.persons.add({ label: `S${i}`, timeZone: 'Asia/Kolkata', secret, relayUrl });
    expect((await home.pool.call(seed.id, { op: 'ingestLumen', events: ring, installations: {} })).ok).toBe(true);
    for (let d = 1; d <= 30; d++) await home.pool.call(seed.id, { op: 'dispatch', command: 'log.steps', input: { date: `2026-09-${String(d).padStart(2, '0')}`, steps: 1000 + d }, source: 'ui' });
    await home.pool.call(seed.id, { op: 'flush' });
    await home.pool.close(seed.id);
    // a new server person of the same group: its replica starts empty and pulls the history while the agent calls
    const p = await home.persons.add({ label: `F${i}`, timeZone: 'Asia/Kolkata', secret, relayUrl });
    const { code } = await home.devices.issueCode(p.id);
    const paired = (await (await fetch(`${c.url}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ code, label: 'phone' }) })).json()) as { token: string };
    const agent = (await (await fetch(`${c.url}/v1/agents/tokens`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}`, 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ client: 'codex', scope: 'log' }) })).json()) as { token: string };
    const client = new Client({ name: `fwg-${i}`, version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agent.token}` } } }));
    const today = await within(client.callTool({ name: 'today_get', arguments: {} }, undefined, { timeout: 60_000 }), 5000, `group ${i}: today_get`);
    const date = /"date\\?":\\?"(\d{4}-\d{2}-\d{2})/.exec(JSON.stringify(today))?.[1];
    expect(date).toBeTruthy();
    const t0 = performance.now();
    const r = await within(client.callTool({ name: 'log_steps', arguments: { date, steps: 7000 + i } }, undefined, { timeout: 60_000 }), 5000, `group ${i}: first log_steps`);
    times.push(Math.round(performance.now() - t0));
    expect(JSON.stringify(r)).toContain('"ok\\":true');
    await client.close();
    await home.pool.close(p.id);
  }
  console.log(JSON.stringify({ firstLogStepsOnSyncedGroupMs: times }));
}, 600_000);
