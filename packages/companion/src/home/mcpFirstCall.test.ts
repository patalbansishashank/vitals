// @vitest-environment node
/**
 * "profile_get over MCP failed once on a freshly opened person" (plan/04-next, carried over), on the production shape:
 * the bundled person program in a real Worker, `/mcp` with an agent token and the MCP SDK's own client.
 *
 * The cause was not the fresh person: the SDK client (and every agent built on it) checks `structuredContent` against
 * the tool's `outputSchema` from `tools/list` with Ajv's draft-07, which reads a draft 2020-12 tuple (`prefixItems`,
 * `items: false`) as "no items at all". `profile_get`'s `estimate.maintenanceBand80` is a tuple, so every call after a
 * tools/list failed with "Structured content does not match the tool's output schema", and only a first call made
 * before any tools/list (no schema known yet) passed. `toMcpTools` now lists portable schemas (`portableSchema`).
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { threadWorkerFactory } from './workers.ts';

const pkg = new URL('../../', import.meta.url);
const outDir = `dist/mcpfirst-${process.pid}`;
const bundle = new URL(`${outDir}/person-worker.mjs`, pkg);
const done: Array<() => Promise<unknown>> = [];
let c: Companion;

beforeAll(async () => {
  execFileSync('pnpm', ['exec', 'vite', 'build', '-c', 'vite.person.config.ts', '--outDir', outDir], { cwd: pkg, stdio: 'ignore' });
  const dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'mcp-first-'));
  done.push(() => rm(dataDir, { recursive: true, force: true }));
  c = await startCompanion({ port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], home: { dataDir, mqtt: { enabled: false }, rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: threadWorkerFactory(bundle) } });
  done.push(() => c.close());
}, 300_000);
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  await rm(new URL(outDir, pkg), { recursive: true, force: true });
});

const post = async (path: string, token: string | null, body: unknown) =>
  (await (await fetch(`${c.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json()) as { token: string };

/** A new person (nothing opened yet) and a read-scope agent token its paired device minted. */
async function freshPerson(o: { secret?: Uint8Array; sync?: boolean } = {}) {
  const home = c.home!;
  const p = await home.persons.add({ label: 'First call', timeZone: 'Asia/Kolkata', secret: o.secret ?? crypto.getRandomValues(new Uint8Array(32)), relayUrl: o.sync ? `${c.url.replace('http', 'ws')}/sync` : null });
  const { code } = await home.devices.issueCode(p.id);
  const device = (await post('/v1/pair/device', null, { code, label: 'phone' })).token;
  const agent = (await post('/v1/agents/tokens', device, { client: 'claude', scope: 'read' })).token;
  return { id: p.id, agent };
}

async function connect(token: string) {
  const client = new Client({ name: 'first-call', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  done.push(() => client.close());
  return client;
}

type Profile = { profile: { weightKg: number | null }; estimate: { maintenanceBand80: number[] } };
/** The data of a successful call; throws what the SDK client throws (its output-schema check included). */
async function profileGet(client: Client): Promise<Profile> {
  const r = await client.callTool({ name: 'profile_get', arguments: {} });
  expect(r.isError).toBeFalsy();
  return r.structuredContent as Profile;
}

it('profile_get answers on 20 freshly opened persons: first call, after tools/list, and while the worker is still opening', async () => {
  for (let i = 0; i < 20; i++) {
    const p = await freshPerson();
    const client = await connect(p.agent);
    if (i % 2 === 0) {
      // the call is the first thing the person's worker sees
      expect((await profileGet(client)).profile.weightKg).toBeNull();
      await client.listTools();
    } else {
      // tools/list and the call in flight together while the worker opens; the call is checked against the listed schema
      await Promise.all([client.listTools(), client.callTool({ name: 'today_get', arguments: {} })]);
    }
    // after tools/list the SDK checks structuredContent against outputSchema: this is the call that failed
    const out = await profileGet(client);
    expect(out.estimate.maintenanceBand80).toHaveLength(2);
    expect((await client.callTool({ name: 'profile_explain_maintenance', arguments: {} })).isError).toBeFalsy();
    await client.close();
  }
}, 300_000);

it('every listed output schema reads the same in the SDK client (no 2020-12 tuples) and every schema compiles there', async () => {
  const p = await freshPerson();
  const { tools } = await (await connect(p.agent)).listTools();
  expect(tools.length).toBeGreaterThan(30);
  const ajv = new AjvJsonSchemaValidator();
  for (const t of tools) {
    expect(JSON.stringify(t.outputSchema ?? null), t.name).not.toContain('prefixItems');
    expect(() => ajv.getValidator(t.inputSchema as Record<string, unknown>), t.name).not.toThrow();
    if (t.outputSchema) expect(() => ajv.getValidator(t.outputSchema as Record<string, unknown>), t.name).not.toThrow();
  }
}, 120_000);

it('profile_get answers on a second device of an owner right after it joins the relay, and shows the synced profile', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const first = await freshPerson({ secret, sync: true });
  const w = await c.home!.pool.call(first.id, { op: 'dispatch', command: 'profile.patch', input: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 60 }, source: 'ui' });
  expect(w.ok).toBe(true);
  await c.home!.pool.call(first.id, { op: 'flush' });
  const second = await freshPerson({ secret, sync: true });
  const client = await connect(second.agent);
  await client.listTools();
  let weight = (await profileGet(client)).profile.weightKg;
  for (let i = 0; i < 50 && weight !== 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    weight = (await profileGet(client)).profile.weightKg;
  }
  expect(weight).toBe(60);
}, 120_000);
