#!/usr/bin/env node
// Gauge (formerly Lumen Health) → home server, end to end against a REAL server process (docs/SERVER.md "Gauge"); no mocks.
// The wire names stay `lumen` (/v1/lumen/*, the `lumen` token kind, lumen.db); only the MCP tools are `gauge_*`.
//
// 1. Starts `vitals-server serve` (home role, 127.0.0.1, a free port) from this checkout with its config and data in
//    <data dir> (XDG_CONFIG_HOME / XDG_DATA_HOME), after `init` and `persons add` through the same CLI.
// 2. Issues a code with `vitals-server pair-code`, pairs as Gauge (`POST /v1/lumen/pair`, a 32-hex installation id).
// 3. Uploads the fixture gzipped in batches: history built by Gauge's own mapper (HubE2eFixtureTest.kt in the Gauge
//    repo), duplicates, malformed events, a revised reading, a reading deletion, a Reset App Data (`category: "*"`) and
//    the history the ring hands back afterwards; then hand-built short-video days (`habits/short_video`, one per local
//    date, a newer one superseding the older) that the fixture does not carry yet.
// 4. Mints an agent token with `vitals-server agent-token create` and calls every gauge_* tool over HTTP /mcp, checking
//    values, units, time zone, freshness, soft deletes and the reset rule; checks the lumen token is refused on /mcp and
//    other routes, and that a Vitals tool (briefing_get) still answers for the agent token.
// 5. Unpairs (`POST /v1/lumen/unpair`), checks the server log holds no payload, stops the server.
//
//   pnpm --filter vitals-companion build:person         # once: `serve` needs dist/person-worker.mjs
//   node packages/companion/scripts/lumen-e2e.mjs [--data-dir <dir>] [--fixture <file.json[.gz]>] [--keep]
//
// The data dir (default $PWD/.e6-tmp/lumen-e2e) is wiped first and, without --keep, at the end. Exit code 1 on any
// failed check. Regenerate the fixture (lumen-e2e.fixture.json.gz) in the Gauge repo with
//   LUMEN_HUB_FIXTURE_OUT=/abs/out.json ./gradlew :app:testDebugUnitTest --tests '*HubE2eFixture*'  && gzip -9 out.json
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const bin = join(pkgDir, 'bin', 'vitals-server.mjs');
const { values: opt } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    fixture: { type: 'string' },
    keep: { type: 'boolean' },
    verbose: { type: 'boolean' },
  },
});
const root = resolve(opt['data-dir'] ?? join(process.cwd(), '.e6-tmp', 'lumen-e2e'));
const fixturePath = resolve(opt.fixture ?? join(pkgDir, 'scripts', 'lumen-e2e.fixture.json.gz'));
const raw = readFileSync(fixturePath);
const fx = JSON.parse((fixturePath.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
const INSTALL = fx.installationId;
const TZ = fx.timeZone;
const G = fx.groups;

// ---------------------------------------------------------------------------------------------------------------
// checks

let passed = 0;
let throttled = 0; // MCP calls the server's rate limit asked to retry
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    if (opt.verbose) console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
  }
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------------------------------------------------------
// expectations, computed from the fixture itself (independently of the server's SQL)

const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const r1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => r1(xs.reduce((a, b) => a + b, 0) / xs.length);
const of = (events, category, day) => events.filter((e) => e.category === category && (!day || localDate(e.data.observed_at) === day));
const countBy = (events) => events.reduce((m, e) => ((m[e.category] = (m[e.category] ?? 0) + 1), m), {});

const D1 = fx.day1;
const D2 = fx.day2;
const hrValues = (day, events) => {
  const byAt = new Map();
  for (const e of of(events, 'metrics/hr', day)) byAt.set(e.data.observed_at, e.data.value); // later list entries are newer
  return [...byAt.values()];
};
const sleepPackets = of(G.history, 'sleep/timeline');
const stageCounts = { deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 };
for (const p of sleepPackets) for (const s of p.data.stages) stageCounts[s]++;
const sleepMinutes = sleepPackets.reduce((n, p) => n + p.data.stages.length, 0);
// the day's latest revision (energy SPEC §2.2: never the max)
const dailySteps = (day) => of(G.history, 'activity/daily', day).sort((a, b) => Date.parse(a.data.observed_at) - Date.parse(b.data.observed_at)).at(-1)?.data.steps;
const bucketSteps = (day) => of(G.history, 'activity/buckets', day).reduce((n, e) => n + e.data.steps, 0);

// Gauge's short-video day, built like the mapper builds every event (deterministic id over type|subject|observed_at|data)
const SV_TYPE = 'com.pulseloop.habits.short_video.v1';
function shortVideo(date, observedAt, receivedAt, counts, limit, limitHits, cancels) {
  const values = { date, counts, limit, limit_hits: limitHits, cancels };
  const id = `pl-${createHash('sha256').update(`${SV_TYPE}|${date}|${observedAt}|${JSON.stringify({ schema_version: 1, observed_at: observedAt, ...values })}`).digest('hex').slice(0, 40)}`;
  return {
    specversion: '1.0', id, type: SV_TYPE, source: `urn:pulseloop:installation:${INSTALL}`, subject: date, time: observedAt, datacontenttype: 'application/json',
    category: 'habits/short_video', data: { schema_version: 1, observed_at: observedAt, received_at: receivedAt, ...values },
  };
}

// (r067) any Gauge event, built the same way (deterministic id over type|subject|observed_at|data)
function gaugeEvent(category, subject, type, observedAt, values, receivedAt = observedAt) {
  const id = `pl-${createHash('sha256').update(`${type}|${subject}|${observedAt}|${JSON.stringify({ schema_version: 1, observed_at: observedAt, ...values })}`).digest('hex').slice(0, 40)}`;
  return {
    specversion: '1.0', id, type, source: `urn:pulseloop:installation:${INSTALL}`, subject, time: observedAt, datacontenttype: 'application/json',
    category, data: { schema_version: 1, observed_at: observedAt, received_at: receivedAt, ...values },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// the server, through its own CLI

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
async function startServer() {
  if (!existsSync(join(pkgDir, 'dist', 'person-worker.mjs'))) throw new Error('Build the person program first: pnpm --filter vitals-companion build:person');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const port = await freePort();
  cli('init', '--role', 'home', '--port', String(port));
  const added = cli('persons', 'add', 'Gauge E2E', '--tz', TZ);
  const personId = added.trim().split(/\s+/)[0];
  logFile = join(root, 'server.log');
  const fd = openSync(logFile, 'a');
  server = spawn(process.execPath, [bin, 'serve'], { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}); see ${logFile}`);
    const h = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
    if (h?.role === 'home') return { url, personId, health: h };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the server did not answer /health; see ${logFile}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return true;
  const exited = new Promise((r) => server.once('exit', r));
  server.kill('SIGTERM');
  const t = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(t);
  return server.signalCode !== 'SIGKILL';
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers

let BASE = '';
async function http(method, path, { token, json, body, headers = {} } = {}) {
  const h = { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (json !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, redirect: 'manual' });
  const text = await r.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: r.status, body: parsed, headers: r.headers };
}
async function upload(token, events, { gzip = true, installationId = INSTALL } = {}) {
  const raw = Buffer.from(JSON.stringify({ installationId, events }));
  return http('POST', '/v1/lumen/events', {
    token,
    body: gzip ? gzipSync(raw) : raw,
    headers: { 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}) },
  });
}
async function uploadAll(token, events, size) {
  const sum = { accepted: 0, duplicates: 0, rejected: 0, requests: 0, statuses: new Set() };
  for (let i = 0; i < events.length; i += size) {
    const r = await upload(token, events.slice(i, i + size));
    sum.statuses.add(r.status);
    sum.requests++;
    if (r.status === 200) {
      sum.accepted += r.body.accepted;
      sum.duplicates += r.body.duplicates;
      sum.rejected += r.body.rejected.length;
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------------------------------------------
// MCP

async function mcpClient(token) {
  const { Client, StreamableHTTPClientTransport } = await import('../src/mcpTestClient.ts');
  const client = new Client({ name: 'lumen-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return {
    client,
    /** One tool call; the server's per-token limits (60 tool calls a minute, 30-request bursts) answer 429: wait and retry. */
    async call(name, args = {}) {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await client.callTool({ name, arguments: args });
          const out = r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? 'null');
          if (out?.error?.code !== 'rate_limited' || attempt >= 30) return out;
        } catch (e) {
          if (!/rate_limited|429|Too many/i.test(String(e?.message)) || attempt >= 30) throw e;
        }
        throttled++;
        await new Promise((r) => setTimeout(r, 3000));
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  console.log(`fixture ${fixturePath} (${Object.entries(G).map(([k, v]) => `${k} ${v.length}`).join(', ')})`);
  const s = await startServer();
  BASE = s.url;
  console.log(`server ${s.health.version ?? ''} on ${BASE}, data in ${root}, person ${s.personId} (${TZ})`);

  section('1. Pairing');
  const wrong = await http('POST', '/v1/lumen/pair', { json: { code: '00000000', installationId: INSTALL } });
  check('a code that was never issued is 401 invalid_code (no code yet)', [401, 410].includes(wrong.status), wrong);
  const code = /Code (\d{8})/.exec(cli('pair-code'))?.[1];
  check('`vitals-server pair-code` prints an 8-digit code', Boolean(code));
  const badInstall = await http('POST', '/v1/lumen/pair', { json: { code, installationId: 'x' } });
  eq('a malformed installation id is 400', badInstall.status, 400);
  const bad = await http('POST', '/v1/lumen/pair', { json: { code: code === '12345678' ? '87654321' : '12345678', installationId: INSTALL } });
  check('a wrong code is 401 invalid_code', bad.status === 401 && bad.body?.error === 'invalid_code', bad);
  const paired = await http('POST', '/v1/lumen/pair', { json: { code, installationId: INSTALL, deviceName: 'OnePlus CPH2661', appVersion: '2.9.0' } });
  check('pairing answers 200 with a token', paired.status === 200 && typeof paired.body?.token === 'string', paired);
  const P = paired.body ?? {};
  eq('pairing names the person', P.personId, s.personId);
  eq('pairing advertises maxBatch 500 and maxBytes 1 MiB', [P.maxBatch, P.maxBytes], [500, 1048576]);
  const reused = await http('POST', '/v1/lumen/pair', { json: { code, installationId: INSTALL } });
  check('the code works once (410 used)', reused.status === 410 && reused.body?.error === 'used', reused);
  const LT = P.token;

  section('2. Agent token and token scopes');
  const agentOut = cli('agent-token', 'create', s.personId, '--client', 'claude', '--scope', 'read');
  const AT = agentOut.split('\n').map((l) => l.trim()).find((l) => l && !l.includes(' '));
  check('`vitals-server agent-token create` prints a token', Boolean(AT));
  const mcpLumen = await http('POST', '/mcp', { token: LT, json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }, headers: { accept: 'application/json, text/event-stream' } });
  check('the lumen token is refused on /mcp', [401, 403].includes(mcpLumen.status), mcpLumen);
  for (const [m, path] of [['GET', '/v1/devices'], ['GET', '/v1/agents/tokens'], ['POST', '/v1/sync/key'], ['POST', '/v1/pair/code'], ['GET', '/v1/agents/activity']]) {
    const r = await http(m, path, { token: LT, ...(m === 'POST' ? { json: {} } : {}) });
    check(`the lumen token is refused on ${m} ${path} (${r.status})`, r.status === 403 || r.status === 401, r);
  }
  const agentOnLumen = await upload(AT, []);
  check('the agent token is refused on /v1/lumen/events', agentOnLumen.status === 403, agentOnLumen);
  const noToken = await upload(null, []);
  eq('no token on /v1/lumen/events is 401', noToken.status, 401);
  const st0 = await http('GET', '/v1/lumen/status', { token: LT });
  check('status before any upload: no events', st0.status === 200 && Object.keys(st0.body.counts).length === 0 && st0.body.lastObservedAt === null && st0.body.deletions === 0, st0.body);

  section('3. Upload history (gzip, batches of 200), duplicates, malformed events');
  const t0 = Date.now();
  const hist = await uploadAll(LT, G.history, 200);
  eq('history: every batch 200', [...hist.statuses], [200]);
  eq(`history: ${G.history.length} accepted in ${hist.requests} requests, 0 duplicates, 0 rejected`, [hist.accepted, hist.duplicates, hist.rejected], [G.history.length, 0, 0]);
  console.log(`  (${G.history.length} events in ${Date.now() - t0} ms)`);
  const dup = await upload(LT, G.history.slice(0, 200));
  eq('re-sent batch: 0 accepted, 200 duplicates', [dup.body?.accepted, dup.body?.duplicates], [0, 200]);
  const otherInstall = await upload(LT, G.history.slice(0, 1), { installationId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' });
  check('an upload under another installation than the token\'s is 403 wrong_installation', otherInstall.status === 403 && otherInstall.body?.error === 'wrong_installation', otherInstall);
  const tooMany = await upload(LT, Array.from({ length: 501 }, () => G.history[0]));
  check('501 events is 413', tooMany.status === 413, tooMany);
  const badGzip = await http('POST', '/v1/lumen/events', { token: LT, body: Buffer.from('not gzip'), headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } });
  eq('a body that is not gzip is 400', badGzip.status, 400);
  const good = G.history[0];
  const { id: _drop, ...noId } = good;
  // a hand-built, valid event in a category the fixture does not use (a spot measurement the ring completed)
  const fresh = {
    specversion: '1.0', id: 'pl-e2e-fresh-0001', type: 'health.measurement.completed', source: good.source, subject: 'measurement', time: '2026-10-21T15:00:00Z',
    datacontenttype: 'application/json', category: 'state/measurement', data: { schema_version: 1, observed_at: '2026-10-21T15:00:00Z', received_at: '2026-10-21T15:00:05Z', mode: 1, success: true },
  };
  const malformed = [
    fresh,
    { ...good, id: 'pl-e2e-bad-time', time: 'yesterday' },
    noId,
    { ...good, id: 'pl-e2e-bad-source', source: 'urn:pulseloop:installation:someoneelse1' },
    'not an event',
    { ...G.deletion[0], id: 'pl-e2e-bad-range', data: { ...G.deletion[0].data, target: { category: 'metrics/hr', from: '2026-10-21T06:28:30Z' } } },
  ];
  const mal = await upload(LT, malformed);
  check('a batch with malformed events still answers 200', mal.status === 200, mal);
  eq('only the good event is accepted', mal.body?.accepted, 1);
  eq('malformed events are rejected with index and reason', mal.body?.rejected?.map((r) => [r.index, r.id, r.reason]), [
    [1, 'pl-e2e-bad-time', 'bad_time'], [2, null, 'bad_id'], [3, 'pl-e2e-bad-source', 'source_mismatch'], [4, null, 'not_an_object'], [5, 'pl-e2e-bad-range', 'bad_target_range'],
  ]);
  const revised = await upload(LT, G.revised, { gzip: false });
  eq('a revised reading (new id, same time) uploads uncompressed: 1 accepted', revised.body?.accepted, 1);
  const st1 = await http('GET', '/v1/lumen/status', { token: LT });
  const expectCounts = countBy([...G.history, ...G.revised, fresh]);
  eq('status counts per category match the fixture', st1.body?.counts, Object.fromEntries(Object.entries(expectCounts).sort()));
  check('status names the person, the version and the newest reading', st1.body?.personId === s.personId && typeof st1.body?.serverVersion === 'string' && typeof st1.body?.lastObservedAt === 'string', st1.body);

  section('4. MCP: every gauge_* tool');
  const { client, call } = await mcpClient(AT);
  const tools = (await client.listTools()).tools;
  const names = tools.map((t) => t.name);
  const gaugeNames = ['gauge_data_availability', 'gauge_metric_series', 'gauge_daily_summary', 'gauge_sleep', 'gauge_activity', 'gauge_scores', 'gauge_device_state', 'gauge_short_video',
    'gauge_workouts', 'gauge_steps', 'gauge_timeline', 'gauge_baselines', 'gauge_hc', 'gauge_changes', 'gauge_changes_state', 'gauge_detections'];
  check('tools/list has all 14 gauge_* tools (and gauge_changes_state, gauge_detections)', gaugeNames.every((n) => names.includes(n)), names);
  // (r063 S13) the change feed: no cursor answers the head and resync; from the start every imported record is listed
  const feedHead = await call('gauge_changes');
  check('gauge_changes without a cursor: the head cursor and resync', feedHead?.ok === true && feedHead.data.resync === true && /^c1\.\d+\.\d+$/.test(feedHead.data.cursor) && feedHead.data.changes.length === 0, feedHead);
  const feedAll = await call('gauge_changes', { since: 'c1.0.0' });
  check('gauge_changes from the start: a valid page, only imported kinds', feedAll?.ok === true && feedAll.data.changes.every((c) => ['workout', 'hcExercise', 'hcWeight'].includes(c.kind)), feedAll);
  // (0.6.3 FX1) the whole feed, the Reset App Data included, in pages: never resync (a large deletion is listed, paged)
  let feedCursor = 'c1.0.0';
  let feedResync = false;
  let feedPages = 0;
  for (; feedPages < 200; feedPages++) {
    const p = await call('gauge_changes', { since: feedCursor, limit: 50 });
    if (p?.ok !== true) break;
    feedResync ||= p.data.resync === true;
    feedCursor = p.data.cursor;
    if (!p.data.more) break;
  }
  check('gauge_changes walked to the end in pages, never resync', !feedResync && feedPages < 200 && typeof feedCursor === 'string', { feedCursor, feedPages });
  const feedState = await call('gauge_changes_state', { refs: 'workout:e2e-none,hcWeight:e2e-none' });
  check('gauge_changes_state: a record the server never held is unknown, never deleted', feedState?.ok === true && feedState.data.states.length === 2 && feedState.data.states.every((x) => x.state === 'unknown'), feedState);
  const tlE2e = await call('gauge_timeline', { date: D1 });
  check('gauge_timeline: steps.support per minute, hr.source and evidence', tlE2e?.ok === true && tlE2e.data.steps.support.length === tlE2e.data.minutes && tlE2e.data.hr.source.length === tlE2e.data.minutes && Array.isArray(tlE2e.data.evidence?.hr), tlE2e?.data?.evidence);
  check('tools/list has no lumen_* tools (no aliases)', !names.some((n) => n.startsWith('lumen')), names);
  check('tools/list still has the Vitals tools (briefing_get)', names.includes('briefing_get'));
  check('gauge tools say Gauge (formerly Lumen Health), separate from Vitals\' manual logs, read-only', tools.filter((t) => t.name.startsWith('gauge_')).every((t) => /Gauge/.test(t.title) && /Gauge/.test(t.description) && /formerly called Lumen Health/.test(t.description) && /separate from Vitals'( own)? manual logs/.test(t.description) && t.annotations?.readOnlyHint === true));
  check('gauge_short_video says counts only, never content', /^Gauge's on-phone count of short-form videos \(Reels\/Shorts\) watched per day — counts only, never content; separate from Vitals' manual logs/.test(tools.find((t) => t.name === 'gauge_short_video')?.description ?? ''));

  const av = await call('gauge_data_availability');
  check('availability ok', av?.ok === true, av);
  eq('availability: categories', av.data.categories.map((c) => c.category), Object.keys(expectCounts).sort());
  eq('availability: metric kinds', av.data.metricKinds, ['blood_pressure', 'hr', 'hrv', 'spo2', 'stress', 'temp', 'vendor.vascular_age']);
  check('availability: the installation, its phone and app version', av.data.installations.length === 1 && av.data.installations[0].id === INSTALL && av.data.installations[0].deviceName === 'OnePlus CPH2661' && av.data.installations[0].appVersion === '2.9.0', av.data.installations);
  check('availability: freshness (just uploaded; last reading in the person\'s zone)', av.data.freshness.minutesSinceLastUpload <= 5 && /\+05:30$/.test(av.data.freshness.lastReadingAt) && av.data.source === 'lumen_health' && av.data.timeZone === TZ, av.data.freshness);
  eq('availability: hr first/last reading', [av.data.categories.find((c) => c.category === 'metrics/hr').firstReadingAt], ['2026-10-20T00:00:00+05:30']);

  const hr2 = await call('gauge_metric_series', { kind: 'hr', from: D2, to: D2 });
  eq('hr raw day 2: unit bpm', hr2.data.unit, 'bpm');
  eq('hr raw day 2: 144 history + 1 spot reading', hr2.data.count, 145);
  const at0900 = hr2.data.points.find((p) => p.at === '2026-10-21T09:00:00+05:30');
  eq('hr raw day 2: the revised 09:00 reading shows its newest value', at0900?.value, fx.revisedHrValue);
  check('hr raw day 2: times in the person\'s zone, from/to cover the day', hr2.data.points.every((p) => p.at.endsWith('+05:30')) && hr2.data.from === '2026-10-21T00:00:00+05:30', hr2.data.from);
  const spot = hr2.data.points.find((p) => p.at === '2026-10-21T21:33:00+05:30');
  eq('hr raw day 2: the live spot reading keeps its provenance', [spot?.value, spot?.provenance], [64, 'device_spot']);
  const hrDay = await call('gauge_metric_series', { kind: 'hr', from: D1, to: D2, bucket: 'day' });
  const hr1Expected = hrValues(D1, G.history);
  const hr2Expected = hrValues(D2, [...G.history, ...G.revised]);
  eq('hr by day: count/mean/min/max per day', hrDay.data.points.map((p) => [p.date, p.count, p.mean, p.min, p.max]), [
    [D1, hr1Expected.length, mean(hr1Expected), Math.min(...hr1Expected), Math.max(...hr1Expected)],
    [D2, hr2Expected.length, mean(hr2Expected), Math.min(...hr2Expected), Math.max(...hr2Expected)],
  ]);
  const hrHour = await call('gauge_metric_series', { kind: 'hr', from: `${D1}T10:00`, to: `${D1}T11:59`, bucket: 'hour' });
  eq('hr by hour: two hours of 6 readings, starting 10:00 local', hrHour.data.points.map((p) => [p.start, p.count]), [['2026-10-20T10:00:00+05:30', 6], ['2026-10-20T11:00:00+05:30', 6]]);
  for (const [kind, unit, category] of [['spo2', '%', 'metrics/spo2'], ['hrv', 'ms', 'metrics/hrv'], ['temp', '°C', 'metrics/temp']]) {
    const r = await call('gauge_metric_series', { kind, from: D1, to: D1, bucket: 'day' });
    const xs = of(G.history, category, D1).map((e) => e.data.value);
    eq(`${kind} day 1: unit ${unit}, count and mean`, [r.data.unit, r.data.points[0]?.count, r.data.points[0]?.mean], [unit, xs.length, mean(xs)]);
  }
  const bp = await call('gauge_metric_series', { kind: 'blood_pressure', from: D1, to: D2 });
  eq('blood pressure raw: systolic/diastolic in mmHg', [bp.data.unit, bp.data.points.map((p) => [p.systolic, p.diastolic])], ['mmHg', [[118, 77], [119, 78]]]);
  const vendor = await call('gauge_metric_series', { kind: 'vendor.vascular_age', from: D1, to: D2 });
  eq('vendor metric: value and unit', [vendor.data.unit, vendor.data.points.map((p) => p.value)], ['years', [39, 40]]);
  const badKind = await call('gauge_metric_series', { kind: 'hr', from: 'monday', to: D2 });
  check('a malformed range is invalid_input, not an error', badKind.ok === false && badKind.error?.code === 'invalid_input', badKind);

  const sl = await call('gauge_sleep', { from: D1, to: D2 });
  eq('sleep: one session, waking day 2', sl.data.sessions.map((x) => x.wakingDate), [D2]);
  const ses = sl.data.sessions[0] ?? {};
  eq('sleep: 23:10 → 06:40 local, 450 min in bed', [ses.start, ses.end, ses.inBedMinutes], ['2026-10-20T23:10:00+05:30', '2026-10-21T06:40:00+05:30', sleepMinutes]);
  eq('sleep: stage minutes match the ring\'s timeline', ses.minutes, stageCounts);
  eq('sleep: asleep minutes = deep + light + rem', ses.asleepMinutes, stageCounts.deep + stageCounts.light + stageCounts.rem);
  check('sleep: blocks cover the night and carry units', ses.blocks?.reduce((n, b) => n + b.minutes, 0) === sleepMinutes && sl.data.units?.minutes === 'min', sl.data.units);

  const act = await call('gauge_activity', { from: D1, to: D2 });
  eq('activity: daily steps (latest daily total) and bucket sums', act.data.days.map((d) => [d.date, d.steps, d.bucketSteps]), [[D1, dailySteps(D1), bucketSteps(D1)], [D2, dailySteps(D2), bucketSteps(D2)]]);
  eq('activity: distance m, calories kcal, active min for day 1', act.data.days[0] && [act.data.days[0].distanceM, act.data.days[0].caloriesKcal, act.data.days[0].activeMinutes], [Math.round(dailySteps(D1) * 0.72), Math.round(dailySteps(D1) * 0.045), Math.floor(dailySteps(D1) / 120)]);
  eq('activity: 30 hourly buckets for a 2-day range', act.data.hourly?.length, 30);
  check('activity: units name steps, m and kcal', act.data.units.distanceM === 'm' && /kcal/.test(act.data.units.caloriesKcal), act.data.units);

  const sc = await call('gauge_scores', { from: D1, to: D2 });
  eq('scores: sleep_score and recovery_score per day', [sc.data.scores.sleep_score?.map((x) => [x.date, x.value]), sc.data.scores.recovery_score?.map((x) => [x.date, x.value])], [[[D1, 80], [D2, 83]], [[D1, 70], [D2, 74]]]);
  const rec = sc.data.scores.recovery_score?.[0] ?? {};
  eq('scores: unit, confidence, algorithm version, inputs, note', [rec.unit, rec.confidence, rec.algorithmVersion, rec.inputs, rec.note], ['score', 'low', 'lumen-recovery-v1', { hrv_ms: 45 }, 'Few nights of baseline']);
  const scKey = await call('gauge_scores', { from: D1, to: D2, key: 'sleep_score' });
  eq('scores: key filter', Object.keys(scKey.data.scores), ['sleep_score']);

  const ds = await call('gauge_device_state');
  const dev = ds.data.devices[0]?.state ?? {};
  eq('device state: one installation with its phone name', [ds.data.devices.length, ds.data.devices[0]?.installationId, ds.data.devices[0]?.deviceName], [1, INSTALL, 'OnePlus CPH2661']);
  eq('device state: battery %, connection, firmware, wear, sync', [dev.battery?.percent, dev.connection?.state, dev.connection?.device_type, dev.firmware?.version, dev.wear?.worn, dev.sync?.stage, dev.device?.capabilities], [76, 'connected', 'colmi_r02', 'MOY-R1K3-2.1.6', true, 'complete', ['heartRate', 'sleep', 'spo2', 'steps']]);
  check('device state: no Bluetooth address or ring name leaves the phone', !/AA:BB|R11C_1234/.test(JSON.stringify(ds)));

  const sum2 = await call('gauge_daily_summary', { date: D2 });
  eq('daily summary day 2: activity steps, the night, scores, hr stats', [sum2.data.activity?.steps, sum2.data.sleep.length, sum2.data.sleep[0]?.asleepMinutes, sum2.data.scores.sleep_score?.value, sum2.data.metrics.hr?.count, sum2.data.metrics.hr?.unit, sum2.data.metrics.hr?.mean], [dailySteps(D2), 1, stageCounts.deep + stageCounts.light + stageCounts.rem, 83, 145, 'bpm', mean(hr2Expected)]);
  eq('daily summary day 2: latest hr is the last reading of the day', [sum2.data.metrics.hr?.latest?.at, sum2.data.metrics.hr?.latest?.value], ['2026-10-21T23:50:00+05:30', of(G.history, 'metrics/hr', D2).find((e) => e.data.observed_at === '2026-10-21T18:20:00Z')?.data.value]);
  const sumBad = await call('gauge_daily_summary', { date: '2026-02-30' });
  eq('daily summary: an impossible date is invalid_input', sumBad.error?.code, 'invalid_input');
  check('daily summary day 2: derived day values and the night\'s metrics (energy SPEC §S2)', sum2.data.derived?.version === 'day-metrics/1' && sum2.data.sleep[0]?.metrics?.version === 'sleep-metrics/1' && /^sha256:/.test(sum2.data.inputsHash), sum2.data.derived);

  // energy SPEC §2.2: the derived tools
  const stp = await call('gauge_steps', { from: D1, to: D2 });
  check('steps: steps-fuse/1, a day per date, an inputsHash', stp.ok && stp.data.fusionVersion === 'steps-fuse/1' && stp.data.days.length === 2 && /^sha256:/.test(stp.data.inputsHash), stp.data.days);
  check('steps: legacy buckets are never placed in time (no assumed duration)', stp.data.intervals.every((u) => u.lineage !== 'ring' || u.support !== 'span'), stp.data.intervals.slice(0, 3));
  check('steps: the zone used is named (tz)', stp.data.tz === TZ || /^[+-]\d{2}:\d{2}$/.test(stp.data.tz ?? ''), stp.data.tz);
  const stpUtc = await call('gauge_steps', { from: D1, to: D2, tz: 'UTC' });
  check('steps: tz sets the zone and is echoed', stpUtc.ok && stpUtc.data.tz === 'UTC' && stpUtc.data.from === D1, stpUtc.data.tz);
  const badTz = await call('gauge_steps', { from: D1, to: D2, tz: 'Not/AZone' });
  check('steps: an unknown tz is invalid_input', badTz.ok === false && badTz.error?.code === 'invalid_input', badTz);
  const ctxStp = await call('gauge_steps', { from: D1, to: D2, tz: TZ, activities: [{ start: `${D2}T00:00:00Z`, end: `${D2}T23:59:00Z`, kind: 'nonLocomotor' }], preference: { stepsPreference: ['ring', 'phone'], soleSustainedGait: true } });
  check('steps: the activity context is taken (no interval of the bout is sole sustained gait)', ctxStp.ok && ctxStp.data.intervals.filter((u) => Date.parse(u.start) >= Date.parse(`${D2}T00:00:00Z`) && Date.parse(u.end) <= Date.parse(`${D2}T23:59:00Z`)).every((u) => u.selectionReason !== 'soleSustainedGait'), ctxStp.error ?? ctxStp.data.intervals.slice(0, 3));
  const tl = await call('gauge_timeline', { date: D2 });
  check('timeline: 1440 minutes of steps, heart rate and sleep', tl.ok && tl.data.minutes === 1440 && tl.data.steps.selected.length === 1440 && tl.data.hr.sampledBpm.length === 1440 && tl.data.sleep.stage.length === 1440, tl.data.minutes);
  const bl = await call('gauge_baselines', { date: D2 });
  check('baselines: still learning with fewer than 7 nights', bl.ok && bl.data.learning?.learning === true, bl.data.learning);
  const hcR = await call('gauge_hc', { type: 'Steps', from: D1, to: D2 });
  check('hc: answers by type', hcR.ok && Array.isArray(hcR.data.records), hcR.error);

  const brief = await call('briefing_get');
  check('Vitals briefing_get still answers for the agent token', brief?.ok === true || brief?.status === 'applied' || (brief && !brief.error), brief && { ok: brief.ok, status: brief.status, error: brief.error });

  section('4b. Short-video habit (habits/short_video)');
  const svD1a = shortVideo(D1, '2026-10-20T06:00:00Z', '2026-10-20T06:00:02Z', { instagram: 3, youtube: 2 }, 20, 0, 0);
  const svD1b = shortVideo(D1, '2026-10-20T17:00:00Z', '2026-10-20T17:00:02Z', { instagram: 16, youtube: 9 }, 20, 1, 2);
  const svD2 = shortVideo(D2, '2026-10-21T15:00:00Z', '2026-10-21T15:00:02Z', { instagram: 7, youtube: 4 }, 20, 0, 1);
  const svBad = { ...svD2, id: 'pl-e2e-sv-bad', subject: '2026-02-30', data: { ...svD2.data, date: '2026-02-30' } };
  const svUp = await upload(LT, [svD1b, svD1a, svD2, svD1b, svBad]);
  eq('short-video days: 3 accepted, the re-sent one a duplicate, an impossible date rejected', [svUp.body?.accepted, svUp.body?.duplicates, svUp.body?.rejected?.map((r) => [r.index, r.reason])], [3, 1, [[4, 'bad_short_video']]]);
  const sv = await call('gauge_short_video', { from: D1, to: D2 });
  eq('gauge_short_video: one row per date, the newest version (by received_at) for day 1', sv.data.days, [
    { date: D1, counts: { instagram: 16, youtube: 9 }, total: 25, limit: 20, limitHits: 1, cancels: 2 },
    { date: D2, counts: { instagram: 7, youtube: 4 }, total: 11, limit: 20, limitHits: 0, cancels: 1 },
  ]);
  eq('gauge_short_video: 7- and 30-day averages end at `to`', [sv.data.averages.last7Days, sv.data.averages.last30Days.from, sv.data.averages.last30Days.daysWithData], [
    { from: '2026-10-15', to: D2, daysWithData: 2, total: 18, counts: { instagram: 11.5, youtube: 6.5 }, limitHits: 0.5, cancels: 1.5 }, '2026-09-22', 2,
  ]);
  check('gauge_short_video: the installation and freshness in the person\'s zone', sv.data.installations?.[0]?.id === INSTALL && sv.data.freshness?.lastReadingAt === '2026-10-21T20:30:00+05:30', sv.data.freshness);
  const avSv = await call('gauge_data_availability');
  eq('availability: habits/short_video read with gauge_short_video, 2 days', [avSv.data.categories.find((c) => c.category === 'habits/short_video')?.readWith, avSv.data.shortVideoDays], ['gauge_short_video', 2]);

  section('5. Soft delete of one reading');
  const del = await upload(LT, G.deletion);
  eq('the deletion is accepted', del.body?.accepted, 1);
  const hr2d = await call('gauge_metric_series', { kind: 'hr', from: D2, to: D2 });
  eq('hr day 2 after the deletion: 144, the 12:00 reading gone', [hr2d.data.count, hr2d.data.points.some((p) => p.at === '2026-10-21T12:00:00+05:30')], [144, false]);
  const hrOther = await call('gauge_metric_series', { kind: 'hr', from: `${D2}T11:50`, to: `${D2}T12:10` });
  eq('the ±90 s range hides only that reading (11:50 and 12:10 stay)', hrOther.data.points.map((p) => p.at), ['2026-10-21T11:50:00+05:30', '2026-10-21T12:10:00+05:30']);
  const spo2After = await call('gauge_metric_series', { kind: 'spo2', from: D2, to: D2 });
  eq('other kinds are untouched by an hr deletion', spo2After.data.count, 24);
  const st2 = await http('GET', '/v1/lumen/status', { token: LT });
  eq('status: deletions 1, metrics/hr count one lower', [st2.body?.deletions, st2.body?.counts['metrics/hr']], [1, expectCounts['metrics/hr'] - 1]);
  const avDel = await call('gauge_data_availability');
  eq('availability: deletions 1', avDel.data.deletions, 1);
  const delDup = await upload(LT, G.deletion);
  eq('a re-sent deletion is a duplicate', [delDup.body?.accepted, delDup.body?.duplicates], [0, 1]);

  section('6. Reset App Data (category *), then the ring hands history back');
  const reset = await upload(LT, G.reset);
  eq('the reset is accepted', reset.body?.accepted, 1);
  const avR = await call('gauge_data_availability');
  eq('after the reset the short-video days are hidden too', (await call('gauge_short_video', { from: D1, to: D2 })).data.days, []);
  eq('after the reset nothing is visible (no categories, no metric kinds)', [avR.data.categories.length, avR.data.metricKinds, avR.data.deletions], [0, [], 2]);
  const hrR = await call('gauge_metric_series', { kind: 'hr', from: D1, to: D2 });
  const dsR = await call('gauge_device_state');
  const slR = await call('gauge_sleep', { from: D1, to: D2 });
  const scR = await call('gauge_scores', { from: D1, to: D2 });
  const actR = await call('gauge_activity', { from: D1, to: D2 });
  const sumR = await call('gauge_daily_summary', { date: D2 });
  eq('after the reset every tool is empty', [hrR.data.count, dsR.data.devices.length, slR.data.sessions.length, Object.keys(scR.data.scores).length, actR.data.days.length, sumR.summary.startsWith('No Gauge data')], [0, 0, 0, 0, 0, true]);
  const stR = await http('GET', '/v1/lumen/status', { token: LT });
  check('status after the reset: no visible categories, raw history kept (deletions 2)', Object.keys(stR.body?.counts ?? {}).length === 0 && stR.body?.deletions === 2 && stR.body?.lastObservedAt === null, stR.body);
  const resent = await uploadAll(LT, G.resent, 100);
  eq(`the handed-back history: ${G.resent.length} duplicates (same ids), 0 accepted`, [resent.accepted, resent.duplicates, resent.rejected], [0, G.resent.length, 0]);
  const hrB = await call('gauge_metric_series', { kind: 'hr', from: D2, to: D2 });
  const back0900 = hrB.data.points.find((p) => p.at === '2026-10-21T09:00:00+05:30');
  const orig0900 = G.resent.find((e) => e.data.observed_at === fx.revisedHrAt).data.value;
  eq('hr day 2 shows again: 144 (the handed-back copy, incl. 12:00)', [hrB.data.count, hrB.data.points.some((p) => p.at === '2026-10-21T12:00:00+05:30')], [144, true]);
  eq('the 09:00 reading shows the value received last (the handed-back one)', back0900?.value, orig0900);
  const hrB1 = await call('gauge_metric_series', { kind: 'hr', from: D1, to: D1 });
  eq('hr day 1 (not handed back) stays hidden', hrB1.data.count, 0);
  const slB = await call('gauge_sleep', { from: D1, to: D2 });
  eq('the handed-back night shows again with the same minutes', [slB.data.sessions.length, slB.data.sessions[0]?.minutes], [1, stageCounts]);
  const actB = await call('gauge_activity', { from: D1, to: D2 });
  eq('activity: day 2 buckets back, daily totals (not handed back) hidden', actB.data.days.map((d) => [d.date, d.steps, d.bucketSteps]), [[D2, null, bucketSteps(D2)]]);
  const dsB = await call('gauge_device_state');
  const scB = await call('gauge_scores', { from: D1, to: D2 });
  eq('device state and scores (not handed back) stay hidden', [dsB.data.devices.length, Object.keys(scB.data.scores).length], [0, 0]);
  const avB = await call('gauge_data_availability');
  eq('availability after the hand-back: hr, buckets, sleep', [avB.data.categories.map((c) => [c.category, c.count]), avB.data.metricKinds], [[['activity/buckets', 15], ['metrics/hr', 144], ['sleep/timeline', 2]], ['hr']]);
  const svAfter = shortVideo(D2, '2026-10-21T20:30:00Z', '2026-10-21T20:30:02Z', { instagram: 9, youtube: 4 }, 20, 0, 1);
  eq('a short-video day counted after the reset is accepted', (await upload(LT, [svAfter])).body?.accepted, 1);
  eq('it shows (received after the reset)', (await call('gauge_short_video', { from: D1, to: D2 })).data.days.map((d) => [d.date, d.total]), [[D2, 13]]);
  const svDel = { ...G.deletion[0], id: 'pl-e2e-sv-deletion', time: '2026-10-21T21:00:00Z', data: { schema_version: 1, observed_at: '2026-10-21T21:00:00Z', received_at: '2026-10-21T21:00:00Z', target: { category: 'habits', from: '2026-10-21T00:00:00Z', to: '2026-10-21T23:59:59Z' } } };
  eq('a habits deletion is accepted', (await upload(LT, [svDel])).body?.accepted, 1);
  eq('the deleted short-video day is gone', (await call('gauge_short_video', { from: D1, to: D2 })).data.days, []);

  section('6b. Automatic detection (detect/2, r067)');
  {
    // a 25-minute keyboard-treadmill walk two hours ago: steady phone steps, the ring's hands-fixed near zero, recognition WALKING
    const base = Math.floor((Date.now() - 3 * 3_600_000) / 60_000) * 60_000;
    const at = (min) => new Date(base + min * 60_000).toISOString();
    const BOOT = '3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c';
    const ns = (min) => String(BigInt(min + 100_000) * 60_000_000_000n);
    const evs = [
      gaugeEvent('phone/acquisition', 'phone_acquisition', 'com.pulseloop.phone.acquisition.v1', at(0), { from: at(0), to: at(90), state: 'listening', detector: 'registered', observed_zero: true }),
      gaugeEvent('phone/activity_recognition_acquisition', 'activity_recognition', 'com.pulseloop.phone.activity_recognition_acquisition.v1', at(0), { from: at(0), to: at(90), state: 'listening', registration_epoch: 1 }),
      gaugeEvent('phone/activity_transition', 'WALKING', 'com.pulseloop.phone.activity_transition.v1', at(30), { activity: 'WALKING', transition: 'ENTER', occurred_at: at(30), boot_id: BOOT, elapsed_ns: ns(30), registration_epoch: 1 }),
      gaugeEvent('phone/activity_transition', 'WALKING', 'com.pulseloop.phone.activity_transition.v1', at(55), { activity: 'WALKING', transition: 'EXIT', occurred_at: at(55), boot_id: BOOT, elapsed_ns: ns(55), registration_epoch: 1 }),
    ];
    for (let m = 30; m < 55; m++) {
      evs.push(gaugeEvent('activity/phone_steps', `phone_steps:${BOOT}:${ns(m)}`, 'com.pulseloop.activity.phone_steps.v1', at(m + 1), {
        start: at(m), end: at(m + 1), steps: 96 + (m % 3) - 1, support: 'minute', timing: 'detector', boot_id: BOOT, m_start_ns: ns(m), m_end_ns: ns(m + 1), utc_anchor_id: 'anchor-e2e',
      }));
    }
    for (let m = 25; m < 60; m++) {
      evs.push(gaugeEvent('activity/buckets', 'ring_steps', 'health.activity.bucket.observed', at(m), {
        start: at(m), duration_s: 60, steps: m >= 30 && m < 55 ? 2 : 0, distance_m: 0, support: 'minute', device_key: '0123456789abcdef', provenance: 'device_history',
      }));
    }
    const bad = gaugeEvent('phone/activity_transition', 'TILTING', 'com.pulseloop.phone.activity_transition.v1', at(31), { activity: 'TILTING', transition: 'ENTER', occurred_at: at(31), boot_id: BOOT, elapsed_ns: ns(31), registration_epoch: 1 });
    const up = await upload(LT, [...evs, bad]);
    eq('recognition and phone evidence accepted, a TILTING transition refused', [up.body?.accepted, up.body?.rejected?.map((r) => r.reason)], [evs.length, ['bad_activity_transition']]);
    const avD = await call('gauge_data_availability');
    eq('availability names the detector', avD.data.detection, 'detect/2');
    // the job runs off the request path, after a short debounce
    let det = null;
    for (let i = 0; i < 40; i++) {
      det = await call('gauge_detections', { from: at(0).slice(0, 10), to: new Date().toISOString().slice(0, 10) });
      if (det?.ok && det.data.episodes.length) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const ep = det?.data?.episodes?.[0];
    check('gauge_detections: one episode, the keyboard treadmill pattern as "walk, possibly treadmill", final', det?.ok === true && det.data.episodes.length === 1 && ep.label === 'walk_possibly_treadmill' && ep.state === 'final' && ep.reasons.includes('ar_walking') && ep.start === at(30) && ep.end === at(55), det?.data);
    check('gauge_detections: detector, cursor and processedThrough', det?.data?.detector === 'detect/2' && /^[0-9a-f]{12}\.\d+$/.test(det.data.cursor) && typeof det.data.processedThrough === 'string', det?.data && { cursor: det.data.cursor, processedThrough: det.data.processedThrough });
    const again = await call('gauge_detections', { since: det?.data?.cursor });
    eq('gauge_detections after the cursor: nothing new', [again?.data?.episodes, again?.data?.withdrawn], [[], []]);
  }
  await client.close();

  section('7. Rate limit, unpair, logs');
  let limited = null;
  for (let i = 0; i < 130 && !limited; i++) {
    const r = await upload(LT, []);
    if (r.status === 429) limited = r;
  }
  check('uploads are rate limited per token (429 with Retry-After)', limited !== null && Number(limited.headers.get('retry-after')) > 0, limited && { status: limited.status });
  const burst = [];
  let agentRetry = 0;
  for (let i = 0; i < 40; i++) {
    const r = await http('POST', '/mcp', { token: AT, json: { jsonrpc: '2.0', id: i, method: 'ping' }, headers: { accept: 'application/json, text/event-stream' } });
    burst.push(r.status);
    if (r.status === 429) agentRetry = Math.max(agentRetry, Number(r.headers.get('retry-after')) || 0);
  }
  check('an agent burst on /mcp gets 429 with Retry-After, never 500', burst.includes(429) && !burst.includes(500) && agentRetry > 0, burst.join(','));
  const unLimited = await http('POST', '/v1/lumen/unpair', { token: LT, json: {} });
  check('Unpair while the lumen token is rate limited is 429 (Gauge then unpairs locally and says the server did not confirm)', unLimited.status === 429, unLimited.status);
  // honour Retry-After, as an owner tapping Unpair a moment later would
  await new Promise((r) => setTimeout(r, (Math.max(Number(limited?.headers.get('retry-after')) || 0, agentRetry) + 1) * 1000));
  const un = await http('POST', '/v1/lumen/unpair', { token: LT, json: {} });
  eq('Unpair: POST /v1/lumen/unpair is 204', un.status, 204);
  const after = await http('GET', '/v1/lumen/status', { token: LT });
  eq('the token no longer works after Unpair (401)', after.status, 401);
  const un2 = await http('POST', '/v1/lumen/unpair', { token: LT, json: {} });
  eq('a second Unpair with the revoked token is 401 (Gauge treats it as done)', un2.status, 401);
  const devicesOut = cli('devices', 'list', s.personId);
  check('the Gauge device is gone from `vitals-server devices list`', !/lumen|gauge/i.test(devicesOut), devicesOut);
  const { client: c2, call: call2 } = await mcpClient(AT);
  const avU = await call2('gauge_data_availability');
  // the hand-back's three, and section 6b's phone steps, phone acquisition and the two recognition categories
  eq('uploads stay on the server after Unpair', avU.data.categories.length, 7);
  await c2.close();

  const stopped = await stopServer();
  check('the server stops on SIGTERM', stopped);
  const log = readFileSync(logFile, 'utf8');
  check('the server log holds no payload (no event ids, values, firmware, tokens)', !/pl-[0-9a-f]{10}|MOY-R1K3|OnePlus|vascular|"value"/.test(log) && !log.includes(LT) && !log.includes(AT), log.slice(-1500));
  check('the server log has the lumen count lines', /lumen: \d+ accepted, \d+ duplicates, \d+ rejected/.test(log));
}

let code = 0;
try {
  await main();
} catch (e) {
  failures.push(`crashed: ${e instanceof Error ? e.stack : String(e)}`);
  console.log(`\nCRASH ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  await stopServer();
  if (!opt.keep) await rm(root, { recursive: true, force: true });
}
if (throttled) console.log(`\n(${throttled} MCP calls waited for the server's per-token rate limit and were retried)`);
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `:\n - ${failures.join('\n - ')}` : ''}`);
if (opt.keep) console.log(`data and server.log kept in ${root}`);
code = failures.length ? 1 : 0;
process.exit(code);
