#!/usr/bin/env node
// A real agent over the server's MCP, end to end and local: builds the person-worker bundle from this checkout, starts a
// Vitals Server in the home role on 127.0.0.1 (random port, data under $PWD/.e6-tmp/), adds a throwaway person
// (label L-MCP-…), seeds it through the person's command bus as the person (profile, goals, a running plan started from
// the starter scenario, kitchen, pantry, meals yesterday and today), mints a read-scope agent token through
// POST /v1/agents/tokens and writes a `claude --mcp-config` file for it ($PWD/.e6-tmp/mcp-e2e/mcp.json, 0600; the
// token is never printed). At the end the server stops and the data dir, the person and its token go.
//
//   node packages/companion/scripts/mcp-briefing-e2e.mjs serve                     # prints the port and the config path, runs until killed
//   node packages/companion/scripts/mcp-briefing-e2e.mjs run [--expect-briefing]   # one `claude -p` turn, transcript in .e6-tmp/mcp-e2e/
//
// Options: --model <alias> (default sonnet), --prompt <text>, --reuse-bundle (skip the build when dist/mcp-e2e has one),
// --max-budget-usd <n> (default 1), --login-shell (start claude from a clean `fish -l`, for a CLI whose sign-in only
// loads there; the harness never reads it). `run --expect-briefing` exits 1 when the agent did not call briefing_get.
//
// Also importable (`startE2E()`): the probes and tests open fresh persons on the same real paths.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const BUNDLE_DIR = 'dist/mcp-e2e';
const bundlePath = join(pkgDir, BUNDLE_DIR, 'person-worker.mjs');

/** Builds the person program the way the server ships it (src/home/memory.test.ts does the same). */
export function buildBundle({ reuse = false } = {}) {
  if (reuse && existsSync(bundlePath)) return bundlePath;
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '-c', 'vite.person.config.ts', '--outDir', BUNDLE_DIR], { cwd: pkgDir, stdio: 'pipe' });
  } catch (e) {
    process.stderr.write(String(e.stderr ?? e.message).slice(-4000));
    throw new Error('Building the person program failed.');
  }
  return bundlePath;
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const dayBefore = (day) => isoDay(new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000));

/**
 * Starts the server and returns helpers. `person()` adds a fresh person (nothing seeded); `seed(id)` fills it;
 * `agentToken(id, scope)` mints an agent token through the real route and returns it (callers must not print it).
 */
export async function startE2E({ root = join(process.cwd(), '.e6-tmp'), reuseBundle = false, relay = false, log } = {}) {
  const { installPolyfills } = await import('@evolu/common/polyfills');
  installPolyfills();
  const [{ startCompanion }, { threadWorkerFactory }] = await Promise.all([import('../src/server.ts'), import('../src/home/workers.ts')]);
  const bundle = buildBundle({ reuse: reuseBundle });
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(join(root, 'mcp-e2e-data-'));
  const c = await startCompanion({
    host: '127.0.0.1',
    port: 0,
    dataDir: join(dataDir, 'relay'),
    relay,
    allowedOrigins: [],
    log: log ?? (() => undefined),
    home: { dataDir, mqtt: { enabled: false }, rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: threadWorkerFactory(bundle) },
  });
  const home = c.home;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const post = async (path, token, body) => {
    const r = await fetch(`${c.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${path} answered ${r.status} ${JSON.stringify(json?.error ?? json)}`);
    return json;
  };
  const devices = new Map();

  const api = {
    url: c.url,
    mcpUrl: `${c.url}/mcp`,
    home,
    dataDir,
    /**
     * Adds a person; nothing is opened or written in its store yet. `secret` (32 bytes) makes it another device of an
     * existing owner; `sync` joins it to this server's relay (start with `relay: true`).
     */
    async person(label = `L-MCP-e2e-${randomBytes(3).toString('hex')}`, o = {}) {
      const secret = o.secret ?? new Uint8Array(randomBytes(32));
      const p = await home.persons.add({ label, timeZone, secret, relayUrl: o.sync ? `${c.url.replace('http', 'ws')}/sync` : null });
      return p.id;
    },
    /** One command as the person (the app's `ui` source, as the person's own device runs it). */
    async dispatch(personId, command, input = {}) {
      const r = await home.pool.call(personId, { op: 'dispatch', command, input, source: 'ui' });
      if (!r.ok) throw new Error(`${command}: ${r.error.code} ${r.error.message}`);
      if (!r.value.ok) throw new Error(`${command}: ${JSON.stringify(r.value.error ?? r.value).slice(0, 300)}`);
      return r.value.output;
    },
    /** A paired device of the person (`POST /v1/pair/device`), its token kept here. */
    async deviceToken(personId) {
      if (!devices.has(personId)) {
        const { code } = await home.devices.issueCode(personId);
        devices.set(personId, (await post('/v1/pair/device', null, { code, label: 'e2e phone' })).token);
      }
      return devices.get(personId);
    },
    /** An agent token minted by the person's device through `POST /v1/agents/tokens`. Never print it. */
    async agentToken(personId, scope = 'read') {
      return (await post('/v1/agents/tokens', await api.deviceToken(personId), { client: 'claude', scope, label: 'L-MCP e2e' })).token;
    },
    /** Profile, goals, a plan running from today, kitchen, pantry and meals logged yesterday and today. */
    async seed(personId) {
      const d = (command, input) => api.dispatch(personId, command, input);
      await d('profile.patch', { sex: 'male', ageYears: 38, heightCm: 176, weightKg: 84, habits: { typicalSteps: 7000 } });
      await d('goals.edit', { ops: [{ op: 'add', goal: { key: 'lose-fat', metric: 'fatMass', mode: 'lose', amount: 4, strength: 'should', functional: null } }, { op: 'setHorizon', days: 84 }] });
      const today = (await d('today.get', {})).date;
      const yesterday = dayBefore(today);
      // the Planner does not run on the server (personProgram.ts NOT_ON_SERVER): start from the Simulator's starter
      // scenario instead, the same `plan.start` the app runs for "Start this plan" on a scenario
      await d('scenario.ensureActive', {});
      await d('plan.start', { source: { scenarioId: 'starter' }, startDate: today, name: 'E2E plan' });
      await d('kitchen.set', { equipment: [{ id: 'eq.otg' }], cuisines: [{ id: 'cu.punjabi' }], staples: [{ id: 'st.atta' }] });
      await d('kitchen.add', { items: [{ label: 'pressure cooker' }, { label: 'mixer grinder' }] });
      await d('pantry.add', { items: [{ label: 'eggs', qtyApprox: '12' }, { label: 'paneer', qtyApprox: '400 g' }, { label: 'moong dal' }, { label: 'onions', qtyApprox: '2 kg' }] });
      const meal = (date, slot, clockH, components) => d('log.meal', { date, slot, clockH, components, method: 'typed', complete: true });
      const logged = [
        await meal(yesterday, 'breakfast', 8, [{ name: 'boiled egg', grams: 150 }]),
        await meal(yesterday, 'lunch', 13, [{ name: 'paneer', grams: 120 }, { name: 'cooked rice', grams: 200 }]),
        await meal(yesterday, 'dinner', 20, [{ name: 'paneer', grams: 100 }, { name: 'cooked rice', grams: 150 }]),
        await meal(today, 'breakfast', 8, [{ name: 'boiled egg', grams: 100 }, { name: 'banana', grams: 120 }]),
      ];
      const t = await d('today.get', {});
      return { today, yesterday, meals: logged.map((m) => m.status ?? 'logged'), plan: Boolean(t.plan), prescription: Boolean(t.prescription), pantry: (await d('pantry.get', {})).items.length, kitchen: (await d('kitchen.get', {})).equipment.length };
    },
    /** Writes the `claude --mcp-config` file (0600). The token goes only into the file. */
    async writeMcpConfig(file, token) {
      await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify({ mcpServers: { vitals: { type: 'http', url: api.mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2), { mode: 0o600 });
      await chmod(file, 0o600);
      return file;
    },
    async close() {
      await c.close().catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// The CLI

function parseArgs(argv) {
  const o = { mode: 'run', expectBriefing: false, model: 'sonnet', prompt: 'what should I eat today?', reuseBundle: false, budget: '1', loginShell: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'serve' || a === 'run') o.mode = a;
    else if (a === '--expect-briefing') o.expectBriefing = true;
    else if (a === '--reuse-bundle') o.reuseBundle = true;
    else if (a === '--login-shell') o.loginShell = true;
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--prompt') o.prompt = argv[++i];
    else if (a === '--max-budget-usd') o.budget = argv[++i];
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

/** Tool calls, their outcome and the final answer from a `--output-format stream-json` transcript. */
export function summarise(lines) {
  const calls = new Map();
  const out = { mcp: null, vitalsTools: 0, calls: [], answer: '', isError: false, costUsd: null, denials: [] };
  for (const line of lines) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      out.mcp = (m.mcp_servers ?? []).map((s) => `${s.name}: ${s.status}`).join(', ');
      out.vitalsTools = (m.tools ?? []).filter((t) => t.startsWith('mcp__vitals__')).length;
      out.otherTools = (m.tools ?? []).filter((t) => !t.startsWith('mcp__vitals__'));
    }
    for (const part of m.message?.content ?? []) {
      if (m.type === 'assistant' && part.type === 'tool_use') {
        const call = { tool: part.name.replace(/^mcp__vitals__/, ''), ok: null, detail: '' };
        calls.set(part.id, call);
        out.calls.push(call);
      }
      if (m.type === 'user' && part.type === 'tool_result' && calls.has(part.tool_use_id)) {
        const call = calls.get(part.tool_use_id);
        const text = typeof part.content === 'string' ? part.content : (part.content ?? []).map((x) => x.text ?? '').join('');
        call.ok = !part.is_error && !/"ok"\s*:\s*false/.test(text.slice(0, 200));
        if (!call.ok) call.detail = text.slice(0, 300);
      }
    }
    if (m.type === 'result') {
      out.answer = m.result ?? '';
      out.isError = Boolean(m.is_error);
      out.costUsd = m.total_cost_usd ?? null;
      out.denials = (m.permission_denials ?? []).map((d) => d.tool_name);
    }
  }
  return out;
}

async function runClaude(o, configFile, transcriptFile, cwd) {
  const args = ['-p', o.prompt, '--mcp-config', configFile, '--strict-mcp-config', '--model', o.model, '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'mcp__vitals__*', '--tools', '', '--no-session-persistence', '--max-budget-usd', o.budget];
  const { HOME, USER, LANG } = process.env;
  const child = o.loginShell
    ? spawn('fish', ['-l', '-c', 'claude $argv', '--', ...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { HOME, USER, LOGNAME: USER, LANG: LANG ?? 'en_US.UTF-8', TERM: 'xterm-256color', PATH: `${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin` },
      })
    : spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const file = createWriteStream(transcriptFile, { mode: 0o600 });
  child.stdout.pipe(file);
  let stderr = '';
  child.stderr.on('data', (b) => (stderr += b.toString()));
  const code = await new Promise((r) => child.on('close', r));
  await new Promise((r) => file.end(r));
  return { code, stderr };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = join(process.cwd(), '.e6-tmp');
  const outDir = join(root, 'mcp-e2e');
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const logFile = createWriteStream(join(outDir, 'server.log'), { mode: 0o600 });
  const e2e = await startE2E({ root, reuseBundle: o.reuseBundle, log: (l) => logFile.write(`${l}\n`) });
  const configFile = join(outDir, 'mcp.json');
  let finished = false;
  const finish = async (code) => {
    if (finished) return;
    finished = true;
    await e2e.close();
    await rm(configFile, { force: true });
    logFile.end();
    process.exit(code);
  };
  process.on('SIGINT', () => void finish(130));
  process.on('SIGTERM', () => void finish(143));
  try {
    const id = await e2e.person();
    const seeded = await e2e.seed(id);
    await e2e.writeMcpConfig(configFile, await e2e.agentToken(id, 'read'));
    if (o.mode === 'serve') {
      process.stdout.write(`port ${new URL(e2e.url).port}\nconfig ${configFile}\n`);
      return;
    }
    process.stdout.write(`seeded: plan ${seeded.plan}, prescription today ${seeded.prescription}, kitchen ${seeded.kitchen}, pantry ${seeded.pantry}, meals ${seeded.meals.join('/')}\n`);
    const transcript = join(outDir, 'transcript.jsonl');
    const r = await runClaude(o, configFile, transcript, outDir);
    const s = summarise((await readFile(transcript, 'utf8')).split('\n'));
    process.stdout.write(`claude exit ${r.code}; MCP servers: ${s.mcp ?? '(none)'}; vitals tools listed: ${s.vitalsTools}; other tools: ${s.otherTools?.join(', ') || 'none'}\n`);
    process.stdout.write(`tool calls (${s.calls.length}):\n${s.calls.map((c) => `  ${c.tool} ${c.ok === null ? 'no result' : c.ok ? 'ok' : `FAILED ${c.detail}`}`).join('\n') || '  (none)'}\n`);
    if (s.denials.length) process.stdout.write(`permission denials: ${s.denials.join(', ')}\n`);
    process.stdout.write(`answer${s.isError ? ' (error)' : ''}:\n${s.answer}\n`);
    if (s.costUsd !== null) process.stdout.write(`cost: $${s.costUsd.toFixed(4)}\n`);
    process.stdout.write(`transcript: ${transcript}\n`);
    if (r.code !== 0 && r.stderr) process.stderr.write(r.stderr.slice(0, 2000));
    const briefing = s.calls.some((c) => c.tool === 'briefing_get');
    if (o.expectBriefing) process.stdout.write(briefing ? 'briefing_get was called\n' : 'briefing_get was NOT called\n');
    await finish(r.code !== 0 || s.isError || (o.expectBriefing && !briefing) ? 1 : 0);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    await finish(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
