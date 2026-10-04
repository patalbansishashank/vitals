// @vitest-environment node
/**
 * Live check of the agent recipes (SUITE_SPEC §14.4, R18 §7 item 8), run by hand: `E26_LIVE=1 pnpm vitest run
 * src/agents/__tests__/serverAgents.live.e26.test.ts`. Starts the server's AI and agent routes on a free loopback
 * port over a real headless person store, then lets the installed agents (Claude Code, Codex, OpenCode) connect with
 * an agent token and call `today_get`. The proof is the server's own activity log, not the agent's text. Uses the
 * agents' own accounts for one short prompt each; skipped unless E26_LIVE=1. The token sits in 0600 files under
 * TMPDIR and in the child's environment only, and is never printed.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardedCall } from '@/agents/dispatcher';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { busPersonDispatch, createFileResolver, createFileTokenStore, createPersonDir, type BusModules } from '../../../packages/companion/src/personContext';
import { startAiServer } from '../../../packages/companion/src/serverAi';
import { attachToCommandBus, openPersonStore, type PersonStore } from '../../../packages/companion/spike/headless/personStore';

const LIVE = process.env.E26_LIVE === '1';
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vitals-e26-live-'));
let store: PersonStore;
let server: Awaited<ReturnType<typeof startAiServer>>;
let person: string;
const tokens = createFileTokenStore(join(root, 'data'));
const results: Record<string, unknown> = {};

function run(cmd: string, args: string[], env: Record<string, string>, timeoutMs = 240_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    const t = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

// a name of its own: the owner's agents already have a `vitals` entry (the local Companion), which would win a merge
const NAME = 'vitals_e26';
const PROMPT = `Call the tool today_get from the MCP server named ${NAME} exactly once with empty arguments, then reply with the single word DONE.`;

describe.skipIf(!LIVE)('agents connect to the server and call a tool (live)', () => {
  beforeAll(async () => {
    await import('@/commands');
    person = await createPersonDir(join(root, 'data'), 'Live check', 'Asia/Kolkata');
    store = await openPersonStore({ dir: join(root, 'data', 'persons', person, 'store'), secret: crypto.getRandomValues(new Uint8Array(32)), relayUrl: null, deviceId: 'SERVERE26LIVE001' as never, instance: 'live' });
    await attachToCommandBus(store);
    const d = busPersonDispatch({ guardedCall, createBusAgentDispatcher } as unknown as BusModules);
    server = await startAiServer({ resolvePerson: createFileResolver({ dataDir: join(root, 'data'), tokens, dispatchFor: () => d }), tokens });
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    await store?.close();
    writeFileSync(join(process.cwd(), 'qa', 'results', 'E26-agents-live.json'), `${JSON.stringify(results, null, 2)}\n`);
    rmSync(root, { recursive: true, force: true });
  });

  const calledBy = (tokenId: string) => server.ai.agents.activityOf(person).filter((a) => a.tokenId === tokenId && a.tool === 'today_get');

  it('Claude Code (Streamable HTTP with an Authorization header)', async () => {
    const { token, record } = await tokens.mint(person, { kind: 'agent', label: 'Claude Code', scope: 'log', client: 'claude' });
    const cfg = join(root, 'claude-mcp.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { [NAME]: { type: 'http', url: `${server.url}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600 });
    // through a fish login shell (the account this machine runs jobs on is set up there); the arguments go in a script
    const args = ['-p', '--strict-mcp-config', '--mcp-config', cfg, '--model', 'claude-haiku-4-5-20251001', '--allowedTools', `mcp__${NAME}__today_get`, '--output-format', 'json', PROMPT];
    const script = join(root, 'run-claude.sh');
    writeFileSync(script, `#!/bin/sh\nexec claude ${args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}\n`, { mode: 0o700 });
    const r = await run('fish', ['-l', '-c', script], {});
    rmSync(cfg, { force: true });
    const calls = calledBy(record.id);
    results.claude = { exit: r.code, toolCallsSeenByServer: calls.length, outcomes: calls.map((c) => c.outcome), tokenInOutput: r.out.includes(token), tail: calls.length ? undefined : r.out.split(token).join('[token]').slice(-600) };
    expect(r.out.includes(token)).toBe(false);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]!.outcome).toBe('ok');
  }, 300_000);

  it('Codex (url + bearer_token_env_var)', async () => {
    const { token, record } = await tokens.mint(person, { kind: 'agent', label: 'Codex', scope: 'log', client: 'codex' });
    const r = await run(
      'codex',
      [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        `mcp_servers.${NAME}.url="${server.url}/mcp"`,
        '-c',
        `mcp_servers.${NAME}.bearer_token_env_var="VITALS_TOKEN"`,
        '-c',
        `mcp_servers.${NAME}.default_tools_approval_mode="approve"`,
        PROMPT,
      ],
      { VITALS_TOKEN: token },
    );
    const calls = calledBy(record.id);
    results.codex = { exit: r.code, toolCallsSeenByServer: calls.length, outcomes: calls.map((c) => c.outcome), tokenInOutput: r.out.includes(token), tail: r.code === 0 ? undefined : r.out.split(token).join('[token]').slice(-600) };
    expect(r.out.includes(token)).toBe(false);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it('OpenCode (type remote, headers with {env:VITALS_TOKEN})', async () => {
    const { token, record } = await tokens.mint(person, { kind: 'agent', label: 'OpenCode', scope: 'log', client: 'opencode' });
    const cfg = join(root, 'opencode.json');
    writeFileSync(cfg, JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [NAME]: { type: 'remote', url: `${server.url}/mcp`, headers: { Authorization: 'Bearer {env:VITALS_TOKEN}' }, enabled: true } } }), { mode: 0o600 });
    const r = await run('opencode', ['run', PROMPT], { VITALS_TOKEN: token, OPENCODE_CONFIG: cfg });
    const calls = calledBy(record.id);
    results.opencode = { exit: r.code, toolCallsSeenByServer: calls.length, outcomes: calls.map((c) => c.outcome), tokenInOutput: r.out.includes(token), tail: calls.length ? undefined : r.out.split(token).join('[token]').slice(-600) };
    // OpenCode 2.x echoes the resolved request headers in its own output (seen 2026-10-03); recorded, never printed
    expect(calls.length).toBeGreaterThanOrEqual(1);
  }, 300_000);
});
