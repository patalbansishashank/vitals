#!/usr/bin/env node
// The command channel from Vitals to Gauge (energy SPEC §A.4; docs/GAUGE-COMMANDS.md), end to end against a REAL server
// process; Gauge is simulated here by a hold-open poll loop that runs each command like the app's CommandExecutor would.
//
// 1. Starts `vitals-server serve` (home role, 127.0.0.1, a free port) after `init` and `persons add` through the CLI.
// 2. Pairs a Vitals device (`pair-code` + `POST /v1/pair/device`) and a Gauge (`POST /v1/lumen/pair`).
// 3. Checks a held poll is woken by an enqueue in under a second; then runs every command type over the channel with
//    `running` / terminal acks and Gauge's state post, and watches each from Vitals' side with held reads.
// 4. Idempotent retry, coalescing, cancel while queued, expiry when Gauge is away (the network cut mid-command),
//    wrong-kind 403s, and that the server log holds ids and types but no payload, result or token.
//
//   pnpm --filter vitals-companion build:person         # once: `serve` needs dist/person-worker.mjs
//   node packages/companion/scripts/commands-e2e.mjs [--data-dir <dir>] [--keep] [--verbose]
//
// The data dir (default $PWD/.e6-tmp/commands-e2e) is wiped first and, without --keep, at the end. Exit code 1 on any
// failed check. The emulator run of §A.4 (Gauge .debug against this server) follows the same steps with the real app.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const bin = join(pkgDir, 'bin', 'vitals-server.mjs');
const { values: opt } = parseArgs({ options: { 'data-dir': { type: 'string' }, keep: { type: 'boolean' }, verbose: { type: 'boolean' } } });
const root = resolve(opt['data-dir'] ?? join(process.cwd(), '.e6-tmp', 'commands-e2e'));
const INSTALL = randomUUID().replaceAll('-', '');
const SITE = 'https://vitals.creative.desi';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    if (opt.verbose) console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') };
function cli(...args) {
  const r = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vitals-server ${args[0]} failed (${r.status}): ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
}
const freePort = () => new Promise((res, rej) => {
  const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

let server = null;
let logFile = '';
let BASE = '';
async function startServer() {
  if (!existsSync(join(pkgDir, 'dist', 'person-worker.mjs'))) throw new Error('Build the person program first: pnpm --filter vitals-companion build:person');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const port = await freePort();
  cli('init', '--role', 'home', '--port', String(port));
  cli('persons', 'add', 'Commands E2E', '--tz', 'Asia/Kolkata');
  logFile = join(root, 'server.log');
  const fd = openSync(logFile, 'a');
  server = spawn(process.execPath, [bin, 'serve'], { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}); see ${logFile}`);
    if ((await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null))?.role === 'home') return;
    await sleep(200);
  }
  throw new Error(`the server did not answer /health; see ${logFile}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((r) => server.once('exit', r));
  server.kill('SIGTERM');
  const t = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(t);
}

async function http(method, path, { token, json, origin } = {}) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined, redirect: 'manual' });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body };
}
const pairCode = () => /Code (\d{8})/.exec(cli('pair-code'))?.[1];

// ---------------------------------------------------------------------------------------------------------------
// a simulated Gauge: the CommandLoop's poll, lanes collapsed into one, the CommandExecutor's results

function simulatedGauge(token) {
  const state = { reels: { enabled: true, dailyLimit: 30, countdownSeconds: 5, apps: ['instagram', 'youtube'] }, recording: null };
  const ran = [];
  let stopped = false;
  let lastPoll = 0;
  const postState = () => http('POST', '/v1/lumen/commands/state', { token, json: { appVersion: '2.8.0', capabilities: ['reels.set', 'workout.start', 'workout.pause', 'workout.resume', 'workout.stop', 'hr.measure', 'update.check'], ...state } });
  async function run(c) {
    ran.push(c.id);
    const ack = (json) => http('POST', `/v1/lumen/commands/${c.id}/ack`, { token, json });
    const sid = c.payload.sessionId;
    if (sid && state.recording && state.recording.sessionId !== sid) return ack({ status: 'rejected', code: 'wrong_workout' });
    switch (c.type) {
      case 'reels.set':
        Object.assign(state.reels, Object.fromEntries(Object.entries(c.payload).filter(([k]) => k !== 'apps')), c.payload.apps ? { apps: c.payload.apps } : {});
        await ack({ status: 'done', result: { applied: state.reels } });
        break;
      case 'workout.start':
        if (state.recording) return ack({ status: 'rejected', code: 'already_recording' });
        state.recording = { sessionId: `w-${c.id.slice(0, 8)}`, status: 'recording', type: c.payload.type, startedAt: new Date().toISOString() };
        await ack({ status: 'done', result: { state: 'recording', ...state.recording } });
        break;
      case 'workout.pause':
        if (!state.recording) return ack({ status: 'rejected', code: 'no_active_workout' });
        if (state.recording.status === 'paused') return ack({ status: 'noop', result: { state: 'paused' } });
        state.recording.status = 'paused';
        await ack({ status: 'done', result: { state: 'paused' } });
        break;
      case 'workout.resume':
        if (!state.recording) return ack({ status: 'rejected', code: 'no_active_workout' });
        state.recording.status = 'recording';
        await ack({ status: 'done', result: { state: 'recording' } });
        break;
      case 'workout.stop': {
        if (!state.recording) return ack({ status: 'noop', result: { state: 'idle' } });
        const sessionId = state.recording.sessionId;
        state.recording = null;
        await ack({ status: 'done', result: { state: 'idle', sessionId } });
        break;
      }
      case 'hr.measure':
        await ack({ status: 'running' });
        await sleep(1500);
        await ack({ status: 'done', result: { bpm: 187, observedAt: new Date().toISOString() } });
        break;
      case 'update.check':
        await ack({ status: 'done', result: { outcome: 'UP_TO_DATE' } });
        break;
    }
    await postState();
  }
  const loop = (async () => {
    await postState();
    while (!stopped) {
      const gap = lastPoll + 2100 - Date.now();
      if (gap > 0) await sleep(gap);
      lastPoll = Date.now();
      const r = await http('GET', '/v1/lumen/commands?wait=5', { token });
      if (r.status !== 200) {
        await sleep(2000);
        continue;
      }
      if (stopped) break;
      for (const c of r.body.commands) if (Date.parse(r.body.now) < Date.parse(c.expiresAt)) await run(c);
    }
  })();
  return { ran, state, stop: async () => { stopped = true; await loop; } };
}

// ---------------------------------------------------------------------------------------------------------------

let exitCode = 0;
try {
  await startServer();
  section('pairing');
  const d = await http('POST', '/v1/pair/device', { origin: SITE, json: { code: pairCode(), label: 'E2E phone' } });
  check('Vitals device pairs', d.status === 200, d);
  const device = d.body.token;
  const g = await http('POST', '/v1/lumen/pair', { json: { code: pairCode(), installationId: INSTALL, deviceName: 'Emulator', appVersion: '2.8.0' } });
  check('Gauge pairs', g.status === 200, g);
  const lumen = g.body.token;
  const send = (type, payload = {}, id = randomUUID(), extra = {}) => http('POST', '/v1/gauge/commands', { token: device, origin: SITE, json: { id, type, payload, ...extra } });
  const watch = async (id) => {
    let since = 'queued';
    for (let i = 0; i < 20; i++) {
      const r = await http('GET', `/v1/gauge/commands/${id}?wait=25&since=${since}`, { token: device, origin: SITE });
      if (r.body?.terminal) return r.body.command;
      since = r.body?.command?.state ?? since;
    }
    return null;
  };

  section('held poll');
  const held = http('GET', '/v1/lumen/commands?wait=10', { token: lumen });
  await sleep(300);
  const t0 = Date.now();
  const first = await send('update.check');
  const delivered = await held;
  check('an enqueue wakes the held poll in under a second', delivered.body?.commands?.[0]?.id === first.body.command.id && Date.now() - t0 < 1000, { ms: Date.now() - t0 });
  await http('POST', `/v1/lumen/commands/${first.body.command.id}/ack`, { token: lumen, json: { status: 'done', result: { outcome: 'UP_TO_DATE' } } });
  await sleep(2100);

  section('every command over the server channel');
  const gauge = simulatedGauge(lumen);
  const reels = await send('reels.set', { dailyLimit: 417, apps: ['youtube'] });
  check('reels.set is done', (await watch(reels.body.command.id))?.state === 'done');
  const st = await http('GET', '/v1/gauge/commands/state', { token: device, origin: SITE });
  check('state.reels shows the limit at once', st.body?.reels?.dailyLimit === 417 && st.body?.online === true, st.body);
  const start = await send('workout.start', { type: 'walk' });
  const started = await watch(start.body.command.id);
  check('workout.start is done with the session', started?.state === 'done' && typeof started?.result?.sessionId === 'string', started);
  const sessionId = started?.result?.sessionId;
  check('workout.pause is done', (await watch((await send('workout.pause', { sessionId })).body.command.id))?.state === 'done');
  check('a second pause is a noop', (await watch((await send('workout.pause', { sessionId })).body.command.id))?.state === 'noop');
  check('workout.resume is done', (await watch((await send('workout.resume', { sessionId })).body.command.id))?.state === 'done');
  check('a stop for another session is wrong_workout', (await watch((await send('workout.stop', { sessionId: 'w-other' })).body.command.id))?.code === 'wrong_workout');
  const stop = await watch((await send('workout.stop', { sessionId })).body.command.id);
  check('workout.stop is done and names the session', stop?.state === 'done' && stop?.result?.sessionId === sessionId, stop);
  const hr = await send('hr.measure');
  check('a second measurement coalesces', (await send('hr.measure')).body?.coalesced === true);
  const measured = await watch(hr.body.command.id);
  check('hr.measure goes running, then done', measured?.state === 'done' && measured?.result?.bpm === 187, measured);
  check('update.check is done', (await watch((await send('update.check')).body.command.id))?.state === 'done');

  section('idempotency, cancel, expiry');
  const id = randomUUID();
  const a = await send('reels.set', { enabled: false }, id);
  const b = await send('reels.set', { enabled: false }, id);
  check('a retry with the same id is deduped', b.status === 200 && b.body.deduped === true && b.body.command.id === a.body.command.id);
  check('the same id with another body is id_reused', (await send('reels.set', { enabled: true }, id)).body?.error === 'id_reused');
  await watch(id);
  await gauge.stop();
  await sleep(2100);
  const cancel = await send('update.check');
  const del = await http('DELETE', `/v1/gauge/commands/${cancel.body.command.id}`, { token: device, origin: SITE });
  check('a queued command cancels', del.body?.command?.state === 'cancelled', del.body);
  const late = await send('update.check', {}, randomUUID(), { ttlS: 2 });
  await sleep(2500);
  const expired = await http('GET', `/v1/gauge/commands/${late.body.command.id}`, { token: device, origin: SITE });
  check('with Gauge away the command expires', expired.body?.command?.state === 'expired', expired.body);
  const after = await http('GET', '/v1/lumen/commands?wait=0', { token: lumen });
  check('an expired command is never delivered', after.status === 200 && after.body.commands.length === 0, after.body);

  section('tokens and logs');
  check('a lumen token is refused on the Vitals routes', (await http('GET', '/v1/gauge/commands/state', { token: lumen })).status === 403);
  check('a device token is refused on the Gauge routes', (await http('GET', '/v1/lumen/commands?wait=0', { token: device, origin: SITE })).status === 403);
  await stopServer();
  const log = readFileSync(logFile, 'utf8');
  check('the log names command ids and types', log.includes(reels.body.command.id) && log.includes('reels.set'));
  // the payload values in context, not as substrings: random ids, hex tokens and times can hold any digits, so they are
  // taken out first and a value counts only as a number of its own (or its key); the tokens are long and checked whole
  const scrubbed = log
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?/g, '<time>');
  const holdsNumber = (n) => new RegExp(`(^|[^\\w.-])${n}($|[^\\w.-])`).test(scrubbed);
  for (const [key, value] of [['dailyLimit', 417], ['bpm', 187]]) check(`the log never holds the ${key} payload (${value})`, !log.includes(key) && !holdsNumber(value));
  for (const token of [device, lumen]) check('the log never holds a token', !log.includes(token));
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await stopServer();
  if (!opt.keep) await rm(root, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length || exitCode ? 1 : 0);
