// @vitest-environment node
/**
 * Agents through the server: every tools/call is its own turn for the bus's per-turn limit (20 reads, 5 writes of
 * one tool per turn). Without that a real agent session ran into "Too many calls of this tool in one turn" after
 * about 20 reads and stayed there; the per-token limit (60 calls a minute) is the throttle that holds.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardedCall } from '@/agents/dispatcher';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { Client, StreamableHTTPClientTransport } from '../../../packages/companion/src/mcpTestClient';
import { AGENT_CALLS_PER_MINUTE } from '../../../packages/companion/src/agentsRemote';
import { busPersonDispatch, createFileResolver, createFileTokenStore, createPersonDir, type BusModules } from '../../../packages/companion/src/personContext';
import { startAiServer } from '../../../packages/companion/src/serverAi';
import { attachToCommandBus, openPersonStore, type PersonStore } from '../../../packages/companion/spike/headless/personStore';

const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vitals-turns-'));
const dataDir = join(root, 'data');
let store: PersonStore;
let server: Awaited<ReturnType<typeof startAiServer>>;
let person: string;
const tokens = createFileTokenStore(dataDir);

type Envelope = { ok: boolean; status: string; summary: string; error?: { code: string } };
const envelopeOf = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text) as Envelope;
const logGet = (c: Client) => c.callTool({ name: 'log_get', arguments: { from: '2026-10-02', to: '2026-10-02' } }).then(envelopeOf);

async function connectNew(name: string) {
  const { token } = await tokens.mint(person, { kind: 'agent', label: name, scope: 'read', client: 'other' });
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

beforeAll(async () => {
  await import('@/commands');
  person = await createPersonDir(dataDir, 'Owner', 'Asia/Kolkata');
  store = await openPersonStore({ dir: join(dataDir, 'persons', person, 'store'), secret: crypto.getRandomValues(new Uint8Array(32)), relayUrl: null, deviceId: 'SERVERTURN00001' as never, instance: 'turns' });
  await attachToCommandBus(store);
  const real = busPersonDispatch({ guardedCall, createBusAgentDispatcher } as unknown as BusModules);
  // the default per-token limit (AGENT_CALLS_PER_MINUTE), as the real server runs it
  server = await startAiServer({ resolvePerson: createFileResolver({ dataDir, tokens, dispatchFor: () => real }), tokens });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await store?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP on the server: one tools/call is one turn', () => {
  it('25 reads of one tool in a row all succeed (the bus limit is 20 per turn)', async () => {
    const c = await connectNew('claude-code');
    const results: Envelope[] = [];
    for (let i = 0; i < 25; i++) results.push(await logGet(c));
    expect(results.filter((r) => !r.ok).map((r) => r.summary)).toEqual([]);
    await c.close();
  }, 60_000);

  it('the per-minute token limit still holds: the call after the allowance is refused with its own message', async () => {
    const c = await connectNew('codex-mcp-client');
    // sent together, so the minute's refill cannot hand back a call while they run
    const sent = await Promise.all(Array.from({ length: AGENT_CALLS_PER_MINUTE + 1 }, () => logGet(c)));
    const refused = sent.filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ status: 'rejected', error: { code: 'rate_limited' } });
    expect(refused[0]!.summary).toMatch(/^Too many tool calls in a minute\. Wait \d+ s and try again\.$/);
    expect(sent.filter((r) => r.ok)).toHaveLength(AGENT_CALLS_PER_MINUTE);
    await c.close();
  }, 60_000);
});
