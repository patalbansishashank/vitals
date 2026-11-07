// @vitest-environment node
/**
 * The server coach (`/v1/coach/*`, docs/SERVER.md "Coach") against a fake Claude Code (`fixtures/fake-claude.mjs`) that
 * speaks stream-json and calls the server's real `/mcp` with the session's token: streaming, resume, proposals, expiry
 * and cleanup, limits (429), auth (device, lumen and agent tokens) and status.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import type { PersonRequest, PersonResponse } from '../home/personRpc.ts';
import type { WorkerFactory } from '../home/workers.ts';
import type { ToolManifest } from '../toolManifest.ts';
import { claudeArgs, claudeProjectSlug, createClaudeMapper, createCodexMapper, createThinkingProgress, spawnPlan, THINKING_TOOL, type CoachEvent } from './backends.ts';
import type { CoachSettings } from './config.ts';
import { resolveCoachConfig } from './config.ts';
import { systemPrompt } from './personas.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const FAKE = fileURLToPath(new URL('../../fixtures/fake-claude.mjs', import.meta.url));
const SITE = 'https://vitals.creative.desi';
const START = Date.parse('2026-10-23T04:00:00Z');
const HOUR = 3_600_000;

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/tool-manifest.json', import.meta.url)), 'utf8')) as ToolManifest;
const shift = FIXTURE.tools.find((t) => t.id === 'plan.shift')!;
/** The fixture plus an edit tool the server does run (plan.shift is browser-only on the server). */
const MANIFEST: ToolManifest = { ...FIXTURE, tools: [...FIXTURE.tools, { ...shift, id: 'goal.set', name: 'goal_set', title: 'Set goal' }] };

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

function workers() {
  const calls: PersonRequest[] = [];
  const factory: WorkerFactory = async () => ({
    async call(req: PersonRequest): Promise<PersonResponse> {
      calls.push(req);
      if (req.op === 'agentManifest') return { ok: true, value: MANIFEST };
      if (req.op === 'agentCall') {
        return req.stage
          ? { ok: true, value: { ok: true, status: 'pending_user', changeId: 'chg-1', summary: 'Goal date moves two weeks later' } }
          : { ok: true, value: { ok: true, status: 'applied', summary: `did ${req.command}`, data: req.command === 'today.get' ? { date: '2026-10-23', score: 80 } : undefined } };
      }
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  return { factory, calls };
}

async function boot(o: { coach?: CoachSettings | null } = {}) {
  const root = mkdtempSync(join(TMP, 'coach-'));
  const home = join(root, 'home');
  mkdirSync(home);
  const clock = { now: START };
  const w = workers();
  const coach: CoachSettings | undefined =
    o.coach === null ? undefined : { claudePath: FAKE, isolation: 'none', runtimeDir: join(root, 'run'), home, claudeConfigDir: join(home, '.claude'), ...o.coach };
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(root, 'relay'), allowedOrigins: [], relay: false,
    home: { dataDir: join(root, 'data'), allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: w.factory, now: () => clock.now, ...(coach ? { coach } : {}) },
  });
  cleanup.push(() => rmSync(root, { recursive: true, force: true }), () => c.close());
  const h = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const r = await fetch(`${c.url}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test answers are read field by field
    return { status: r.status, body: (text ? JSON.parse(text) : null) as any, headers: r.headers };
  };
  /** One turn: the SSE events in order (or the HTTP error). */
  const turn = async (token: string, id: string, text: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch(`${c.url}/v1/coach/sessions/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ text, ...extra }) });
    if (r.headers.get('content-type')?.startsWith('text/event-stream') !== true) return { status: r.status, headers: r.headers, events: [] as CoachEvent[], error: (await r.json()) as { error: { code: string } } };
    const raw = await r.text();
    const events = raw.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)) as CoachEvent);
    return { status: r.status, headers: r.headers, events, error: null };
  };
  const person = async (label: string) => {
    const p = await h.persons.add({ label, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(label.length), relayUrl: null });
    const device = await h.devices.mint(p.id, { kind: 'device', label: `${label} phone` });
    const lumen = await h.devices.mint(p.id, { kind: 'lumen', label: 'Gauge' });
    const agent = await h.devices.mint(p.id, { kind: 'agent', label: 'Codex', scope: 'log', client: 'codex' });
    return { id: p.id, device: device.token, lumen: lumen.token, agent: agent.token };
  };
  const open = async (token: string, body: Record<string, unknown> = { app: 'vitals' }) => {
    const r = await call('/v1/coach/sessions', { method: 'POST', token, body });
    expect(r.status).toBe(200);
    return r.body as { sessionId: string; expiresAt: string; greeting: string };
  };
  const runs = () => (existsSync(join(home, 'fake-claude.log')) ? readFileSync(join(home, 'fake-claude.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; envKeys: string[]; token: string | null; home: string; cwd: string; text: string; images: string[] }) : []);
  return { c, h, call, turn, person, open, runs, clock, root, home, runDir: join(root, 'run'), w };
}

const deltas = (events: CoachEvent[]) => events.filter((e): e is Extract<CoachEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.text).join('');

describe('server coach', () => {
  it('streams an answer and resumes the same CLI session on the next turn', async () => {
    const t = await boot();
    const p = await t.person('Asha');
    const s = await t.open(p.device, { app: 'vitals', title: 'Breakfast', context: { screen: 'Today', date: '2026-10-23' } });
    expect(s.greeting).toMatch(/Vitals/);
    expect(Date.parse(s.expiresAt)).toBe(START + 24 * HOUR);

    const one = await t.turn(p.device, s.sessionId, 'hello');
    expect(one.status).toBe(200);
    expect(one.headers.get('cache-control')).toMatch(/no-cache/);
    expect(deltas(one.events)).toBe('turn 1: you said "hello"');
    expect(one.events.at(-1)).toMatchObject({ type: 'done' });

    const two = await t.turn(p.device, s.sessionId, 'and again');
    expect(deltas(two.events)).toBe('turn 2: you said "and again"');

    const [r1, r2] = t.runs();
    // the first turn chose the session id and carried the context block; the second resumed it, without the block
    const sid = r1!.argv[r1!.argv.indexOf('--session-id') + 1];
    expect(r2!.argv[r2!.argv.indexOf('--resume') + 1]).toBe(sid);
    expect(r1!.text).toMatch(/^\[Context from Vitals: today is 2026-10-23 in the person's time zone Asia\/Kolkata\. Opened from the Today screen\./);
    expect(r2!.text).toBe('and again');
    expect(r1!.cwd).toBe(join(t.runDir, s.sessionId));
    // the token only through the environment, never argv; the environment is the coach's small fixed set
    expect(r1!.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(r1!.argv.join(' ')).not.toContain(r1!.token!);
    expect(r1!.envKeys).not.toContain('NODE_ENV');
    expect(r1!.envKeys).toEqual(expect.arrayContaining(['HOME', 'PATH', 'VITALS_TOKEN', 'DISABLE_AUTOUPDATER', 'CLAUDE_CONFIG_DIR', 'TMPDIR']));
    expect(r1!.home).toBe(t.home);

    const got = await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device });
    expect(got.body).toMatchObject({ sessionId: s.sessionId, app: 'vitals', title: 'Breakfast' });
    expect(got.body.messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
      ['user', 'hello'], ['assistant', 'turn 1: you said "hello"'], ['user', 'and again'], ['assistant', 'turn 2: you said "and again"'],
    ]);
    const list = await t.call('/v1/coach/sessions', { token: p.device });
    expect(list.body.sessions).toEqual([expect.objectContaining({ sessionId: s.sessionId, app: 'vitals', title: 'Breakfast' })]);
  });

  it('runs Claude Code isolated: no user settings or hooks, only the vitals MCP and its tools', () => {
    const args = claudeArgs({ dir: '/run/user/1/vitals-coach/x', systemPrompt: 'p', sessionId: 'id', first: true });
    const after = (f: string) => args[args.indexOf(f) + 1];
    expect(args).toEqual(expect.arrayContaining(['-p', '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--include-partial-messages']));
    expect(after('--setting-sources')).toBe('');
    expect(JSON.parse(after('--settings')!)).toEqual({ disableAllHooks: true });
    expect(after('--tools')).toBe('');
    expect(after('--allowedTools')).toBe('mcp__vitals');
    expect(after('--mcp-config')).toBe('/run/user/1/vitals-coach/x/mcp.json');
    expect(after('--permission-mode')).toBe('dontAsk');
    const cfg = resolveCoachConfig({ claudePath: '/bin/true', systemdRunPath: '/usr/bin/systemd-run', isolation: 'systemd', memoryMaxMB: 700, turnTimeoutSec: 240 });
    const plan = spawnPlan(cfg, '/home/u/.npm-global/bin/claude', ['-p']);
    expect(plan.command).toBe('/usr/bin/systemd-run');
    expect(plan.args).toEqual(['--user', '--scope', '--quiet', '--collect', '--slice=vitals-coach.slice', '-p', 'MemoryMax=700M', '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=150%', '-p', 'RuntimeMaxSec=270', '--', '/home/u/.npm-global/bin/claude', '-p']);
  });

  it('maps tool calls on /mcp to tool and proposal events; the coach token is edit scope, loopback only and hidden', async () => {
    const t = await boot();
    const p = await t.person('Ravi');
    const s = await t.open(p.lumen, { app: 'gauge' });
    const r = await t.turn(p.lumen, s.sessionId, 'check my day [mcp]');
    const ev = r.events;
    expect(ev.filter((e) => e.type === 'tool' && e.name !== THINKING_TOOL)).toEqual([
      { type: 'tool', name: 'today_get', status: 'start' }, { type: 'tool', name: 'today_get', status: 'done' },
      { type: 'tool', name: 'goal_set', status: 'start' }, { type: 'tool', name: 'goal_set', status: 'done' },
      { type: 'tool', name: 'gauge_data_availability', status: 'start' }, { type: 'tool', name: 'gauge_data_availability', status: 'done' },
    ]);
    expect(ev).toContainEqual({ type: 'proposal', id: 'chg-1', summary: 'Goal date moves two weeks later' });
    // edit scope: goal_set listed and staged (never applied on the server); the Gauge tools are there too
    expect(deltas(ev)).toMatch(/^tools \d+; today_get:ok, goal_set:pending_user, gauge_data_availability:/);
    expect(t.w.calls.find((x) => x.op === 'agentCall' && x.command === 'goal.set')).toMatchObject({ stage: true });
    // the gauge persona and context
    const run = t.runs()[0]!;
    expect(run.argv[run.argv.indexOf('--system-prompt') + 1]).toBe(systemPrompt('gauge'));
    expect(run.text).toMatch(/^\[Context from the old ring app/);

    // the token works only on loopback, straight to the listener
    const viaProxy = await t.call('/mcp', { method: 'POST', token: run.token!, headers: { 'x-forwarded-for': '100.64.0.2', accept: 'application/json, text/event-stream' }, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } } });
    expect(viaProxy.status).toBe(403);
    // fetch cannot set Host: a raw request, as tailscale serve would send it
    const viaTailnet = await new Promise<number>((resolve, reject) => {
      const req = request(`${t.c.url}/mcp`, { method: 'POST', headers: { host: 'host.tail0.ts.net', authorization: `Bearer ${run.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }));
    });
    expect(viaTailnet).toBe(403);
    // not in the person's agent or device lists
    expect((await t.call('/v1/agents/tokens', { token: p.device })).body.tokens.map((x: { label: string }) => x.label)).toEqual(['Codex']);
    expect((await t.call('/v1/devices', { token: p.device })).body.devices.some((d: { label: string }) => d.label.startsWith('coach:'))).toBe(false);
    // a person cannot make a token look like the coach's
    const made = await t.call('/v1/agents/tokens', { method: 'POST', token: p.device, body: { client: 'codex', label: 'coach:abc' } });
    expect((await t.call('/v1/agents/tokens', { token: p.device })).body.tokens.find((x: { id: string }) => x.id === made.body.id).label).toBe('Codex');
  });

  it('shows a thinking line while the model thinks: start on the first thinking chunk (or after 300 ms), done on the first text', async () => {
    const t = await boot();
    const p = await t.person('Mira');
    const s = await t.open(p.device);
    const thinkingOnly = (ev: CoachEvent[]) => ev.filter((e) => e.type === 'tool' && e.name === THINKING_TOOL);
    const order = (ev: CoachEvent[]) => ev.map((e) => (e.type === 'tool' ? `${e.name}:${e.status}` : e.type)).filter((x, i, a) => x !== 'delta' || a[i - 1] !== 'delta');
    // a thinking block, then 1.5 s of silence, then text
    const thought = await t.turn(p.device, s.sessionId, 'plan my week [think:1500]');
    expect(order(thought.events)).toEqual(['thinking:start', 'thinking:done', 'delta', 'done']);
    expect(deltas(thought.events)).toMatch(/^turn 1: /);
    // no thinking chunk at all, but a slow first word: the line goes up after 300 ms anyway
    const slow = await t.turn(p.device, s.sessionId, 'and now [slow:800]');
    expect(order(slow.events)).toEqual(['thinking:start', 'thinking:done', 'delta', 'done']);
    // a failed turn closes the line before its error
    const failed = await t.turn(p.device, s.sessionId, '[think:10] [limit]');
    expect(thinkingOnly(failed.events)).toEqual([{ type: 'tool', name: 'thinking', status: 'start' }, { type: 'tool', name: 'thinking', status: 'done' }]);
    expect(failed.events.at(-1)).toMatchObject({ type: 'error', code: 'usage_limit' });
  });

  it('passes JPEG attachments to the CLI as image blocks and names the one-off task screens', async () => {
    const t = await boot();
    const p = await t.person('Mia');
    const s = await t.open(p.lumen, { app: 'gauge', context: { screen: 'meal_estimate' } });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');
    const r = await t.turn(p.lumen, s.sessionId, 'what is this', { attachments: [{ kind: 'image', mime: 'image/jpeg', data: jpeg }] });
    expect(deltas(r.events)).toBe('turn 1: you said "what is this" with image/jpeg');
    expect(t.runs()[0]!.text).toMatch(/This is a meal estimate: look at the attached photo/);
    expect(systemPrompt('gauge')).toMatch(/asks for JSON only, answer with just that JSON text/);
    const pdf = await t.turn(p.lumen, s.sessionId, 'x', { attachments: [{ kind: 'image', mime: 'application/pdf', data: jpeg }] });
    expect(pdf.status).toBe(400);
    const keep = await t.call(`/v1/coach/sessions/${s.sessionId}/keep`, { method: 'POST', token: p.lumen });
    expect(keep.status).toBe(200);
    expect(typeof keep.body.expiresAt).toBe('string');
  });

  it('deletes a session 24 h after its last message, with its folder, transcript and token; keep extends it', async () => {
    const t = await boot();
    const p = await t.person('Lea');
    const s = await t.open(p.device);
    await t.turn(p.device, s.sessionId, 'hi');
    const dir = join(t.runDir, s.sessionId);
    const projects = join(t.home, '.claude', 'projects', claudeProjectSlug(dir));
    expect(existsSync(join(dir, 'mcp.json'))).toBe(true);
    expect(readFileSync(join(dir, 'mcp.json'), 'utf8')).toContain('${VITALS_TOKEN}');
    expect(readdirSync(projects)).toHaveLength(1);
    const coachTokens = async () => (await t.h.devices.list(p.id)).filter((d) => d.label.startsWith('coach:'));
    expect(await coachTokens()).toHaveLength(1);
    expect((await coachTokens())[0]).toMatchObject({ kind: 'agent', scope: 'edit' });

    t.clock.now += 23 * HOUR;
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device })).status).toBe(200);
    const kept = await t.call(`/v1/coach/sessions/${s.sessionId}/keep`, { method: 'POST', token: p.device });
    expect(Date.parse(kept.body.expiresAt)).toBe(START + 48 * HOUR);
    t.clock.now = START + 47 * HOUR;
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device })).status).toBe(200);
    t.clock.now = START + 49 * HOUR;
    const gone = await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device });
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('session_expired');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(projects)).toBe(false);
    expect(await coachTokens()).toHaveLength(0);
    expect(JSON.parse(readFileSync(t.h.persons.paths(p.id).devices, 'utf8')).some((d: { label: string }) => d.label.startsWith('coach:'))).toBe(false);
    expect((await t.turn(p.device, s.sessionId, 'still there?')).status).toBe(404);
  });

  it('DELETE removes the session at once; another token of the same person cannot see it', async () => {
    const t = await boot();
    const p = await t.person('Noor');
    const s = await t.open(p.device);
    await t.turn(p.device, s.sessionId, 'hi');
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.lumen })).status).toBe(404);
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { method: 'DELETE', token: p.lumen })).status).toBe(404);
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { method: 'DELETE', token: p.device })).status).toBe(204);
    expect(existsSync(join(t.runDir, s.sessionId))).toBe(false);
    expect(existsSync(join(t.home, '.claude', 'projects', claudeProjectSlug(join(t.runDir, s.sessionId))))).toBe(false);
    expect((await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device })).status).toBe(404);
  });

  it('answers 429 with Retry-After past one turn per person and maxConcurrent on the server', async () => {
    const t = await boot({ coach: { maxConcurrent: 2, maxConcurrentPerPerson: 1 } });
    const a = await t.person('Ana');
    const b = await t.person('Ben');
    const c = await t.person('Cal');
    const [a1, a2, b1, c1] = [await t.open(a.device), await t.open(a.device), await t.open(b.device), await t.open(c.device)];
    const slow = t.turn(a.device, a1.sessionId, 'wait [slow:1500]');
    await new Promise((r) => setTimeout(r, 300));
    const same = await t.turn(a.device, a1.sessionId, 'again');
    expect(same.status).toBe(429);
    expect(same.error?.error.code).toBe('busy');
    expect(same.headers.get('retry-after')).toBe('5');
    const other = await t.turn(a.device, a2.sessionId, 'other chat');
    expect(other.status).toBe(429);
    expect(other.error?.error.code).toBe('busy');
    const bSlow = t.turn(b.device, b1.sessionId, 'wait [slow:1500]');
    await new Promise((r) => setTimeout(r, 300));
    const full = await t.turn(c.device, c1.sessionId, 'me too');
    expect(full.status).toBe(429);
    expect(full.error?.error.code).toBe('server_busy');
    expect(full.headers.get('retry-after')).toBe('20');
    expect(deltas((await slow).events)).toMatch(/^turn 1/);
    expect(deltas((await bSlow).events)).toMatch(/^turn 1/);
    expect(deltas((await t.turn(c.device, c1.sessionId, 'now')).events)).toMatch(/^turn 1/);
  });

  it('stops a turn that says nothing (timeout), and maps usage limits and crashes to SSE errors', async () => {
    const t = await boot({ coach: { idleTimeoutSec: 1 } });
    const p = await t.person('Ola');
    const s = await t.open(p.device);
    const hung = await t.turn(p.device, s.sessionId, 'think [hang]');
    expect(hung.events.at(-1)).toMatchObject({ type: 'error', code: 'timeout' });
    const limit = await t.turn(p.device, s.sessionId, 'go [limit]');
    expect(limit.events.at(-1)).toMatchObject({ type: 'error', code: 'usage_limit' });
    expect((await t.call('/v1/coach/status', { token: p.device })).body).toMatchObject({ available: true, reason: "The server's AI is busy; replies may be slow." });
    const crash = await t.turn(p.device, s.sessionId, 'go [crash]');
    expect(crash.events.at(-1)).toMatchObject({ type: 'error', code: 'backend_error' });
    // the user messages stay, no answer was added; the turn slot is free again
    const got = await t.call(`/v1/coach/sessions/${s.sessionId}`, { token: p.device });
    expect(got.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'user', 'user']);
    expect(deltas((await t.turn(p.device, s.sessionId, 'ok now')).events)).toMatch(/you said "ok now"/);
  });

  it('auth: device and lumen tokens may use /v1/coach; agent tokens may not; lumen still nothing else', async () => {
    const t = await boot();
    const p = await t.person('Ivy');
    expect((await t.call('/v1/coach/status')).status).toBe(401);
    expect((await t.call('/v1/coach/status', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await t.call('/v1/coach/status', { token: p.device })).status).toBe(200);
    expect((await t.call('/v1/coach/status', { token: p.lumen })).status).toBe(200);
    const agent = await t.call('/v1/coach/sessions', { method: 'POST', token: p.agent, body: { app: 'vitals' } });
    expect(agent.status).toBe(403);
    expect(agent.body.error.code).toBe('wrong_kind');
    expect((await t.call('/v1/ai/status', { token: p.lumen })).status).toBe(403);
    expect((await t.call('/v1/agents/tokens', { token: p.lumen })).status).toBe(403);
    // a lumen session defaults to the Gauge persona
    const s = await t.call('/v1/coach/sessions', { method: 'POST', token: p.lumen, body: {} });
    expect(s.body.greeting).toMatch(/your phone/);
    expect((await t.call('/v1/coach/sessions', { method: 'POST', token: p.lumen, body: { app: 'other' } })).status).toBe(400);
    // the coach's own token cannot open coach sessions either
    await t.turn(p.lumen, s.body.sessionId, 'hi');
    const coachToken = t.runs()[0]!.token!;
    expect((await t.call('/v1/coach/sessions', { method: 'POST', token: coachToken, body: {} })).status).toBe(403);
  });

  it('status: ready, not signed in (cached a few minutes), and off without a coach block', async () => {
    const t = await boot();
    const p = await t.person('Zed');
    const ok = await t.call('/v1/coach/status', { token: p.device });
    expect(ok.body).toEqual({ available: true, backend: 'claude', retentionHours: 24 });
    writeFileSync(join(t.home, 'fake-claude.json'), JSON.stringify({ loggedOut: true }));
    expect((await t.call('/v1/coach/status', { token: p.device })).body.available).toBe(true);
    t.clock.now += 4 * 60_000;
    const out = await t.call('/v1/coach/status', { token: p.device });
    expect(out.body).toEqual({ available: false, backend: 'claude', retentionHours: 24, reason: "The server's AI is not signed in." });
    const create = await t.call('/v1/coach/sessions', { method: 'POST', token: p.device, body: { app: 'vitals' } });
    expect(create.status).toBe(503);
    expect(create.body.error.code).toBe('coach_unavailable');

    const off = await boot({ coach: null });
    const q = await off.person('Off');
    expect((await off.call('/v1/coach/status', { token: q.device })).body).toEqual({ available: false, backend: 'claude', retentionHours: 24, reason: 'The coach is not set up on your server.' });
    const missing = await boot({ coach: { claudePath: join(t.root, 'no-such-claude') } });
    const m = await missing.person('Missing');
    expect((await missing.call('/v1/coach/status', { token: m.device })).body.reason).toBe("The server's AI is not installed.");
  });

  it('a restart drops every session: folders, transcripts and coach tokens are swept at start', async () => {
    const root = mkdtempSync(join(TMP, 'coach-restart-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'home'));
    const settings: CoachSettings = { claudePath: FAKE, isolation: 'none', runtimeDir: join(root, 'run'), home: join(root, 'home'), claudeConfigDir: join(root, 'home', '.claude') };
    const w = workers();
    const start = () => startCompanion({ port: 0, dataDir: join(root, 'relay'), allowedOrigins: [], relay: false, home: { dataDir: join(root, 'data'), rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: w.factory, coach: settings } });
    const c1 = await start();
    const p = await c1.home!.persons.add({ label: 'R', timeZone: 'UTC', secret: new Uint8Array(32).fill(1), relayUrl: null });
    const { token } = await c1.home!.devices.mint(p.id, { kind: 'device', label: 'phone' });
    const s = (await (await fetch(`${c1.url}/v1/coach/sessions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' })).json()) as { sessionId: string };
    await (await fetch(`${c1.url}/v1/coach/sessions/${s.sessionId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'hi' }) })).text();
    // a crash: nothing cleaned up (close() would), so copy what a dead process leaves
    const leftover = join(root, 'run', 'left-over');
    const leftProject = join(root, 'home', '.claude', 'projects', claudeProjectSlug(leftover));
    await c1.close();
    for (const d of [leftover, leftProject]) mkdirSync(d, { recursive: true });
    await c1.home!.devices.mint(p.id, { kind: 'agent', label: 'coach:deadbeef', scope: 'edit' });
    const c2 = await start();
    cleanup.push(() => c2.close());
    await fetch(`${c2.url}/v1/coach/status`, { headers: { authorization: `Bearer ${token}` } });
    expect((await fetch(`${c2.url}/v1/coach/sessions/${s.sessionId}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(leftProject)).toBe(false);
    expect((await c2.home!.devices.list(p.id)).some((d) => d.label.startsWith('coach:'))).toBe(false);
  });
});

describe('stream mapping', () => {
  it('Claude: partial text deltas, tool starts once, blank line between messages, subagent output ignored', () => {
    const ev: CoachEvent[] = [];
    const m = createClaudeMapper((e) => ev.push(e));
    const se = (event: unknown, parent: string | null = null) => m.feed({ type: 'stream_event', event, parent_tool_use_id: parent });
    se({ type: 'content_block_start', content_block: { type: 'text' } });
    se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me look.' } });
    se({ type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'mcp__vitals__briefing_get' } });
    m.feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'mcp__vitals__briefing_get' }] } });
    se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hidden' } }, 'toolu_sub');
    se({ type: 'content_block_start', content_block: { type: 'text' } });
    se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } });
    se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'All good.' } });
    m.feed({ type: 'result', subtype: 'success', is_error: false, result: 'All good.' });
    expect(ev).toEqual([
      { type: 'delta', text: 'Let me look.' }, { type: 'tool', name: 'briefing_get', status: 'start' }, { type: 'delta', text: '\n\n' }, { type: 'delta', text: 'All good.' },
    ]);
    expect(m.text).toBe('Let me look.\n\nAll good.');
    expect(m.result).toEqual({ ok: true, failure: null });
    const bad = createClaudeMapper(() => undefined);
    bad.feed({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Invalid API key · Please run /login' });
    expect(bad.result?.failure).toBe('coach_unavailable');
  });

  it('thinking progress: one start (chunk or timer), one done at the first text; late thinking is ignored', async () => {
    const ev: CoachEvent[] = [];
    const m = createClaudeMapper(createThinkingProgress((e) => ev.push(e), 50).emit);
    const se = (event: unknown) => m.feed({ type: 'stream_event', event, parent_tool_use_id: null });
    se({ type: 'content_block_start', content_block: { type: 'thinking' } });
    se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } });
    se({ type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'mcp__vitals__briefing_get' } });
    se({ type: 'content_block_start', content_block: { type: 'thinking' } });
    se({ type: 'content_block_start', content_block: { type: 'text' } });
    se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi.' } });
    se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'more' } });
    se({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' Bye.' } });
    await new Promise((r) => setTimeout(r, 80));
    expect(ev).toEqual([
      { type: 'tool', name: 'thinking', status: 'start' }, { type: 'tool', name: 'briefing_get', status: 'start' }, { type: 'tool', name: 'thinking', status: 'done' },
      { type: 'delta', text: 'Hi.' }, { type: 'delta', text: ' Bye.' },
    ]);
    // nothing from the backend: the timer puts the line up; end() takes it down once
    const quiet: CoachEvent[] = [];
    const p = createThinkingProgress((e) => quiet.push(e), 20);
    await new Promise((r) => setTimeout(r, 40));
    p.end();
    p.end();
    expect(quiet).toEqual([{ type: 'tool', name: 'thinking', status: 'start' }, { type: 'tool', name: 'thinking', status: 'done' }]);
    // a fast first word: no line at all
    const fast: CoachEvent[] = [];
    const f = createThinkingProgress((e) => fast.push(e), 20);
    f.emit({ type: 'delta', text: 'Quick.' });
    await new Promise((r) => setTimeout(r, 40));
    f.end();
    expect(fast).toEqual([{ type: 'delta', text: 'Quick.' }]);
  });

  it('Codex: thread id, MCP tool starts, whole agent messages', () => {
    const ev: CoachEvent[] = [];
    const m = createCodexMapper((e) => ev.push(e));
    m.feed({ type: 'thread.started', thread_id: '0199a0b1-aaaa-bbbb-cccc-0123456789ab' });
    m.feed({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'vitals', tool: 'gauge_sleep' } });
    m.feed({ type: 'item.completed', item: { type: 'agent_message', text: 'You slept 7 h.' } });
    m.feed({ type: 'turn.completed' });
    expect(m.threadId).toBe('0199a0b1-aaaa-bbbb-cccc-0123456789ab');
    expect(ev).toEqual([{ type: 'tool', name: 'gauge_sleep', status: 'start' }, { type: 'delta', text: 'You slept 7 h.' }]);
    expect(m.result).toEqual({ ok: true, failure: null });
  });

  it('config: fallback is off by default, CLIs by absolute path', () => {
    const cfg = resolveCoachConfig({}, {});
    expect(cfg.enabled).toBe(true);
    expect(cfg.backend).toBe('claude');
    expect(cfg.fallback).toBe('none');
    expect(cfg.retentionHours).toBe(24);
    expect(cfg.maxConcurrent).toBe(2);
    expect(cfg.maxConcurrentPerPerson).toBe(1);
    expect(resolveCoachConfig(undefined, {}).enabled).toBe(false);
    expect(resolveCoachConfig({ fallback: 'codex' }, {}).fallback).toBe('codex');
    for (const p of [cfg.claudePath, cfg.codexPath]) if (p) expect(p.startsWith('/')).toBe(true);
  });
});
