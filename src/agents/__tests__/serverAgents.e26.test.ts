// @vitest-environment node
/**
 * Agents through the server (SUITE_SPEC §14.4, §14.9 "Agent through the server"): with no browser open, an MCP client
 * with an agent token lists the tools of its scope and calls them; the tools run in the person's real store (the R17
 * headless Evolu store and the app's command bus, through the same guard the browser uses). A `log` call writes a
 * log entry with undo, an `edit` call becomes a proposal, destructive tools are never listed, a `read` token cannot
 * log, and the tool-call rate limit holds.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardedCall } from '@/agents/dispatcher';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { Client, StreamableHTTPClientTransport } from '../../../packages/companion/src/mcpTestClient';
import { NOT_ON_SERVER_SEED } from '../../../packages/companion/src/agentsRemote';
import { busPersonDispatch, createFileResolver, createFileTokenStore, createPersonDir, type BusModules, type PersonDispatch } from '../../../packages/companion/src/personContext';
import { startAiServer } from '../../../packages/companion/src/serverAi';
import { attachToCommandBus, openPersonStore, type PersonStore } from '../../../packages/companion/spike/headless/personStore';

// eslint-disable-next-line no-restricted-properties -- the test's own loopback server, not app network access
const http = globalThis.fetch.bind(globalThis);
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vitals-e26-agents-'));
const dataDir = join(root, 'data');
let store: PersonStore;
let server: Awaited<ReturnType<typeof startAiServer>>;
let person: string;
let other: string;
const toks: Record<string, string> = {};
const dispatchCalls: string[] = [];

async function connect(token: string, name = 'claude-code') {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const envelopeOf = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as { ok: boolean; status: string; changeId?: string; saved?: boolean; candidates?: unknown[]; error?: { code: string }; summary: string };

beforeAll(async () => {
  // the whole registry first: the worker's manifest is built once from every registered command
  await import('@/commands');
  person = await createPersonDir(dataDir, 'Owner', 'Asia/Kolkata');
  other = await createPersonDir(dataDir, 'Other', 'UTC');
  const secret = crypto.getRandomValues(new Uint8Array(32));
  store = await openPersonStore({ dir: join(dataDir, 'persons', person, 'store'), secret, relayUrl: null, deviceId: 'SERVERE26TEST001' as never, instance: 'e26' });
  await attachToCommandBus(store);
  const real = busPersonDispatch({ guardedCall, createBusAgentDispatcher } as unknown as BusModules);
  const forPerson: PersonDispatch = {
    manifest: () => real.manifest(),
    dispatch: (id, input, actor, o) => {
      dispatchCalls.push(id);
      return real.dispatch(id, input, actor, o);
    },
  };
  // the other person has no store in this process: a call routed there would fail loudly
  const elsewhere: PersonDispatch = {
    manifest: () => real.manifest(),
    dispatch: async () => ({ ok: false, status: 'rejected', summary: 'other person', error: { code: 'other_person', message: 'other person' } }),
  };
  const tokens = createFileTokenStore(dataDir);
  toks.read = (await tokens.mint(person, { kind: 'agent', label: 'Reader', scope: 'read', client: 'other' })).token;
  toks.log = (await tokens.mint(person, { kind: 'agent', label: 'Claude Code', scope: 'log', client: 'claude' })).token;
  toks.edit = (await tokens.mint(person, { kind: 'agent', label: 'Codex', scope: 'edit', client: 'codex' })).token;
  toks.device = (await tokens.mint(person, { kind: 'device', label: 'Browser', scope: 'full' })).token;
  toks.otherLog = (await tokens.mint(other, { kind: 'agent', label: 'Other', scope: 'log', client: 'other' })).token;
  server = await startAiServer({
    resolvePerson: createFileResolver({ dataDir, tokens, dispatchFor: (id) => (id === person ? forPerson : elsewhere) }),
    tokens,
    callsPerMinute: 12,
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await store?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP on the server, no browser tab', () => {
  it('lists the tools of each scope; destructive and browser-only tools never appear', async () => {
    const names: Record<string, string[]> = {};
    for (const scope of ['read', 'log', 'edit'] as const) {
      const c = await connect(toks[scope]!);
      names[scope] = (await c.listTools()).tools.map((t) => t.name);
      await c.close();
    }
    const m = await createBusAgentDispatcher({ directApply: () => false }).manifest();
    const byName = new Map(m.tools.map((t) => [t.name, t]));
    const classOf = (n: string) => byName.get(n)!.confirm;
    expect(names.read!.every((n) => classOf(n) === 'read')).toBe(true);
    expect(names.log!.every((n) => ['read', 'log'].includes(classOf(n)))).toBe(true);
    expect(names.log!.some((n) => classOf(n) === 'log')).toBe(true);
    expect(names.edit!.some((n) => classOf(n) === 'edit')).toBe(true);
    for (const list of Object.values(names)) {
      expect(list.some((n) => classOf(n) === 'destructive')).toBe(false);
      for (const id of NOT_ON_SERVER_SEED) expect(list).not.toContain(byName.get(id.replace(/\./g, '_'))?.name ?? '__');
    }
    expect(names.read!.length).toBeLessThan(names.log!.length);
    expect(names.log!.length).toBeLessThan(names.edit!.length);
    // R17 counted 124 MCP tools; the server lists every non-destructive MCP tool except the browser-only ones
    const mcpNonDestructive = m.tools.filter((t) => t.surfaces.includes('mcp') && t.perm !== 'destructive');
    expect(names.edit!.length).toBe(mcpNonDestructive.filter((t) => !NOT_ON_SERVER_SEED.includes(t.id)).length);
  }, 120_000);

  it('a read tool and a log tool run in the person store; an edit is staged as a proposal', async () => {
    const c = await connect(toks.edit!, 'codex-mcp-client');
    const today = envelopeOf(await c.callTool({ name: 'today_get', arguments: {} }));
    expect(today).toMatchObject({ ok: true, status: 'applied' });

    const logged = envelopeOf(await c.callTool({ name: 'log_steps', arguments: { date: '2026-10-02', steps: 4321 } }));
    expect(logged).toMatchObject({ ok: true, status: 'applied' });
    expect(logged.changeId).toBeTruthy();
    const { dispatch } = await import('@/commands');
    const got = await dispatch('log.get', { from: '2026-10-02', to: '2026-10-02' });
    expect(JSON.stringify(got)).toContain('4321');

    const edit = envelopeOf(await c.callTool({ name: 'profile_patch', arguments: { figure: { frame: 0.9 } } }));
    expect(edit.status).toBe('pending_user');
    expect(edit.changeId).toBeTruthy();
    const pending = await dispatch('coach.pending', {});
    expect(JSON.stringify(pending)).toContain(edit.changeId!);
    const profile = await dispatch('profile.get', {});
    expect(JSON.stringify(profile)).not.toContain('0.9');
    await c.close();
  }, 120_000);

  it('log_meal for a food that needs a choice: needs_choice, saved false, no entry, and the activity does not count it as logged (J3-02)', async () => {
    const c = await connect(toks.edit!, 'codex-mcp-client');
    const raw = await c.callTool({ name: 'log_meal', arguments: { date: '2026-10-03', components: [{ name: 'xyzzy pie', grams: 100 }], method: 'typed' } });
    const asked = envelopeOf(raw);
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, status: 'needs_choice', saved: false });
    // a client that reads only the structured content also sees that nothing was saved, and the status and summary
    expect(raw.structuredContent).toMatchObject({ status: 'needs_choice', saved: false, summary: asked.summary, question: expect.stringMatching(/xyzzy pie/) });
    expect(asked.summary).toMatch(/^Nothing logged yet\..*xyzzy pie/);
    expect(asked.changeId).toBeUndefined();
    const { dispatch } = await import('@/commands');
    expect(JSON.stringify(await dispatch('log.get', { from: '2026-10-03', to: '2026-10-03' }))).not.toContain('xyzzy');
    const h = { Authorization: `Bearer ${toks.device}` };
    const askedRow = ((await (await http(`${server.url}/v1/agents/activity`, { headers: h })).json()) as { activity: Array<Record<string, unknown>> }).activity[0];
    expect(askedRow).toMatchObject({ tool: 'log_meal', outcome: 'needs_choice' });
    // a known food still says applied, with its entry, and counts as ok
    const logged = envelopeOf(await c.callTool({ name: 'log_meal', arguments: { date: '2026-10-03', components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }], method: 'typed' } }));
    expect(logged, JSON.stringify(logged)).toMatchObject({ ok: true, status: 'applied', summary: 'Log a meal: done.' });
    expect(logged).not.toHaveProperty('saved');
    expect(JSON.stringify(await dispatch('log.get', { from: '2026-10-03', to: '2026-10-03' }))).toContain('rice_white_cooked');
    const loggedRow = ((await (await http(`${server.url}/v1/agents/activity`, { headers: h })).json()) as { activity: Array<Record<string, unknown>> }).activity[0];
    expect(loggedRow).toMatchObject({ tool: 'log_meal', outcome: 'ok' });
    await c.close();
  }, 120_000);

  it('a read token cannot log; a destructive tool is refused by name', async () => {
    const before = dispatchCalls.length;
    const c = await connect(toks.read!);
    const r = envelopeOf(await c.callTool({ name: 'log_steps', arguments: { date: '2026-10-02', steps: 1 } }));
    expect(r).toMatchObject({ ok: false, status: 'rejected', error: { code: 'scope' } });
    expect(r.summary).not.toMatch(/scope|token|MCP/);
    const d = envelopeOf(await c.callTool({ name: 'data_erase_all', arguments: {} }));
    expect(d.error?.code).toBe('surface_forbidden');
    expect(dispatchCalls.length).toBe(before);
    await c.close();
  });

  it('device tokens cannot open /mcp; agent tokens cannot use the device routes; a token never reaches another person', async () => {
    const dev = await http(`${server.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${toks.device}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(dev.status).toBe(403);
    const agent = await http(`${server.url}/v1/agents/tokens`, { headers: { Authorization: `Bearer ${toks.log}` } });
    expect(agent.status).toBe(403);
    const c = await connect(toks.otherLog!);
    const r = envelopeOf(await c.callTool({ name: 'log_steps', arguments: { date: '2026-10-02', steps: 99999 } }));
    expect(r.error?.code).toBe('other_person'); // routed to the other person's worker, never to this store
    await c.close();
    const { dispatch } = await import('@/commands');
    expect(JSON.stringify(await dispatch('log.get', { from: '2026-10-02', to: '2026-10-02' }))).not.toContain('99999');
  });

  it('agent tokens: made from a device token, listed, activity logged without arguments, revoked at once', async () => {
    const h = { Authorization: `Bearer ${toks.device}`, 'Content-Type': 'application/json' };
    const made = await http(`${server.url}/v1/agents/tokens`, { method: 'POST', headers: h, body: JSON.stringify({ client: 'opencode', scope: 'log' }) });
    expect(made.status).toBe(200);
    const body = (await made.json()) as { token: string; id: string; mcpUrl: string; recipes: Array<{ client: string; config?: { snippet: string } }> };
    expect(body.mcpUrl).toBe(`${server.url}/mcp`);
    expect(body.recipes[0]!.client).toBe('opencode');
    expect(body.recipes[0]!.config!.snippet).toContain('{env:VITALS_TOKEN}');
    expect(JSON.stringify(body.recipes)).not.toContain(body.token);
    const list = (await (await http(`${server.url}/v1/agents/tokens`, { headers: h })).json()) as { tokens: Array<Record<string, unknown>> };
    expect(list.tokens.map((t) => t.id)).toContain(body.id);
    expect(JSON.stringify(list)).not.toMatch(/hash|token"/);

    const c = await connect(body.token, 'opencode');
    expect(envelopeOf(await c.callTool({ name: 'today_get', arguments: {} })).ok).toBe(true);
    const act = (await (await http(`${server.url}/v1/agents/activity`, { headers: h })).json()) as { activity: Array<Record<string, unknown>> };
    expect(act.activity[0]).toMatchObject({ tokenId: body.id, tool: 'today_get', outcome: 'ok' });
    expect(Object.keys(act.activity[0]!).sort()).toEqual(['at', 'outcome', 'tokenId', 'tool']);

    expect((await http(`${server.url}/v1/agents/tokens/${body.id}`, { method: 'DELETE', headers: h })).status).toBe(204);
    const after = await http(`${server.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe('revoked');
    await c.close().catch(() => undefined);
  });

  it('rate limit on tools/call per token', async () => {
    const c = await connect(toks.log!);
    const codes: string[] = [];
    for (let i = 0; i < 16; i++) codes.push(envelopeOf(await c.callTool({ name: 'today_get', arguments: {} })).error?.code ?? 'ok');
    expect(codes).toContain('rate_limited');
    expect(codes.slice(0, 5).every((x) => x === 'ok')).toBe(true);
    await c.close();
  });
});
