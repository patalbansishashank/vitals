// E34: the Q8 journey-5 memory repro against a SECOND server on oci-arm (port 4871, data in ~/e34-data, its own
// systemd-run unit with MemoryMax), never the real service on 4870. Started by `node qa/scripts/Q8/mem-repro.mjs` with
// MEM_REMOTE=1 (see the header there). Steps:
//   1. start the e34 unit (node from MEM_NODE, default /usr/bin/node), diagnostics on 127.0.0.1:4872 on the host
//   2. the browser, the MCP client and the person workers reach the server through `tailscale serve` on :8444 (as on
//      :8443 in production: `tailscale serve --bg --https=8444 http://127.0.0.1:4871`, removed afterwards with
//      `tailscale serve --https=8444 off`); an ssh tunnel 14872 → 4872 reads the diagnostics
//   3. MEM_IDLE persons (default 2): a browser profile sets up sync, an e34-idle-N person joins, the browser pairs, an
//      MCP today_get opens the worker; the profile stays open (its replica keeps syncing)
//   4. MEM_RUNS journey-5 runs (default 3): fresh profile, sync group, e34-j5-N joins, pair, two agent keys, MCP through
//      tailscale serve, list tools, today_get, log_steps, then 60 s of sampling
// Every 5 s it reads /diag (RSS, heaps, event-loop use, pending requests per worker) into qa/results/E34-mem-remote.json.
// MEM_TARGET=real: the same journey against the REAL service after a deploy (https://…:8443, its CLI, `e34-` persons
// only, removed at the end; the service is never restarted; RSS from /health `memoryMb`, no per-thread diagnostics).
// Exit 1 if a run grew RSS by more than 350 MB over the RSS just before it, or a today_get took 2 s or more.
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, openProfile, pairByCode, setUpSync, serverCall, sleep, closeBrowser, log } from './lib.mjs';
import { serverUrl, serverUrlWithPort, localConfig } from '../lib/localConfig.mjs';

const req = createRequire(`${ROOT}/packages/companion/package.json`);
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);

const HOST = localConfig(['serverSsh']).serverSsh;
const NODE = process.env.MEM_NODE || '/usr/bin/node';
const IDLE = Number(process.env.MEM_IDLE ?? 2);
const RUNS = Number(process.env.MEM_RUNS ?? 3);
const REAL = process.env.MEM_TARGET === 'real';
// the real service does not serve the web app: the browser loads the local preview (lib.mjs SITE) and talks to the server
const PROFILE_OPTS = REAL ? {} : { site: undefined, map: false };
const BASE = process.env.MEM_BASE || (REAL ? serverUrl() : serverUrlWithPort(8444));
const RELEASE = process.env.MEM_RELEASE || 'release';
const ENV = 'XDG_CONFIG_HOME=$HOME/e34-data/config XDG_DATA_HOME=$HOME/e34-data/share';
const VS = REAL ? 'node ~/vitals-server/current/bin/vitals-server.mjs' : `cd ~/e34/${RELEASE} && ${ENV} ${NODE} bin/vitals-server.mjs`;
const ssh = (cmd, input = null, timeout = 90000) =>
  new Promise((resolve) => {
    const c = execFile('ssh', ['-o', 'BatchMode=yes', HOST, cmd], { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    c.stdin.end(input ?? '');
  });

async function startUnit() {
  await ssh('systemctl --user stop e34-server 2>/dev/null; systemctl --user reset-failed e34-server 2>/dev/null; true');
  const flags = (process.env.MEM_NODE_FLAGS ?? '').split(' ').filter(Boolean).join(' ');
  const r = await ssh(
    `systemd-run --user --unit=e34-server --collect -p MemoryHigh=1900M -p MemoryMax=2048M -p MemorySwapMax=256M -p WorkingDirectory=$HOME/e34/${RELEASE} ` +
      `--setenv=XDG_CONFIG_HOME=$HOME/e34-data/config --setenv=XDG_DATA_HOME=$HOME/e34-data/share --setenv=VITALS_DIAG_PORT=4872 --setenv=NODE_ENV=production ` +
      `-p StandardOutput=append:$HOME/e34/server.log -p StandardError=append:$HOME/e34/server.log ${NODE} ${flags} $HOME/e34/${RELEASE}/bin/vitals-server.mjs serve --app $HOME/e34/app`,
  );
  if (r.code) throw new Error(`systemd-run: ${r.stderr.slice(0, 300)}`);
}
async function addPerson(label, phrase) {
  const r = await ssh(`${VS} persons add '${label}' --tz Asia/Kolkata --join`, `${phrase}\n`);
  const m = r.stdout.match(/([0-9a-f]{16})\s+e34-/);
  if (!m) throw new Error(`persons add: ${r.stderr.slice(0, 200)}`);
  return m[1];
}
async function pairCode(id, label) {
  const r = await ssh(`${VS} pair code ${id} --label '${label}'`);
  const m = r.stdout.match(/Code (\d{8})/);
  if (!m) throw new Error(`pair code: ${r.stderr.slice(0, 200)}`);
  return m[1];
}

const tunnel = REAL ? { kill() {} } : spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '14872:127.0.0.1:4872', HOST], { stdio: 'ignore' });

const MB = 1 << 20;
const samples = [];
const diag = async () => {
  if (REAL) {
    try {
      const h = await (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) })).json();
      return { main: { rss: h.memoryMb * MB, heapUsed: 0, external: 0, arrayBuffers: 0 }, persons: [] };
    } catch (e) { return { error: String(e.message ?? e) }; }
  }
  try {
    const r = await fetch('http://127.0.0.1:14872/diag', { signal: AbortSignal.timeout(8000) });
    return await r.json();
  } catch (e) { return { error: String(e.message ?? e) }; }
};
const brief = (d) =>
  d.error ? `diag error ${d.error}` : `rss ${Math.round(d.main.rss / MB)} main heap ${Math.round(d.main.heapUsed / MB)} ext ${Math.round(d.main.external / MB)} ab ${Math.round(d.main.arrayBuffers / MB)} | ` +
    d.persons.map((p) => `${p.id.slice(0, 6)} elu ${p.elu} pend ${p.pending} ${p.report ? `heap ${Math.round(p.report.heap.used / MB)}/${Math.round(p.report.heap.total / MB)} mall ${Math.round(p.report.heap.malloced / MB)} ext ${Math.round(p.report.heap.external / MB)} lag ${p.report.maxLagMs} cur ${p.report.current?.op ?? '-'}` : 'NO REPORT'}`).join(' | ');
let label = 'start';
const sampler = setInterval(async () => { const d = await diag(); samples.push({ t: new Date().toISOString().slice(11, 19), label, d }); log(`[${label}] ${brief(d)}`); }, 5000);
const ok = (from) => samples.slice(from).filter((s) => !s.d.error);
const rss = (from = 0) => Math.max(0, ...ok(from).map((s) => s.d.main.rss / MB));
/** The busiest any other open person's thread was since sample `from` (an idle worker should stay near 0). */
const idleElu = (from, self) => Math.max(0, ...ok(from).flatMap((s) => s.d.persons.filter((p) => p.id !== self && typeof p.elu === 'number').map((p) => p.elu)));

async function mcp(token) {
  const c = new Client({ name: 'e34-repro', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return c;
}
const timed = async (p) => { const t0 = Date.now(); const r = await Promise.race([p, sleep(90000).then(() => ({ timedOut: true }))]); return { ms: Date.now() - t0, r }; };

let code = 0;
const runs = [];
const profiles = [];
try {
  if (!REAL && process.env.MEM_RESTART !== '0') await startUnit();
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok && !(await diag()).error) break; } catch { /* starting */ } await sleep(1000); }
  await sleep(6000);
  const base = (await diag()).main.rss / MB;
  log(`server up, base rss ${Math.round(base)} MB, node ${NODE}, ${RELEASE}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  for (let i = 1; i <= IDLE; i++) {
    label = `idle ${i}`;
    const P = await openProfile(`e34-idle-${i}-${Date.now()}`, { ...PROFILE_OPTS, ...(REAL ? {} : { site: BASE }) });
    profiles.push(P);
    const phrase = await setUpSync(P, BASE);
    const id = await addPerson(`e34-idle-${i}`, phrase);
    await pairByCode(P, await pairCode(id, `e34 idle ${i}`), BASE, `e34 idle ${i}`);
    const tok = (await serverCall(P, 'POST', '/v1/agents/tokens', { client: 'claude', label: `e34 idle ${i}`, scope: 'log' })).body?.token;
    const c = await mcp(tok);
    const t = await timed(c.callTool({ name: 'today_get', arguments: {} }));
    await c.close().catch(() => undefined);
    log(`idle person ${i} (${id}) open; today_get ${t.ms} ms`);
  }
  label = 'idle settle';
  await sleep(30000);

  for (let i = 1; i <= RUNS; i++) {
    label = `j5 run ${i}`;
    const before = (await diag()).main?.rss / MB;
    const from = samples.length;
    const A = await openProfile(`e34-j5-${i}-${Date.now()}`, { ...PROFILE_OPTS, ...(REAL ? {} : { site: BASE }) });
    const phrase = await setUpSync(A, BASE);
    const id = await addPerson(`e34-j5-${i}`, phrase);
    await pairByCode(A, await pairCode(id, `e34 J5 ${i}`), BASE, `e34 J5 ${i}`);
    const k1 = (await serverCall(A, 'POST', '/v1/agents/tokens', { client: 'claude', label: 'e34 claude', scope: 'log' })).body?.token;
    const k2 = (await serverCall(A, 'POST', '/v1/agents/tokens', { client: 'codex', label: 'e34 codex', scope: 'edit' })).body?.token;
    if (!k1 || !k2) throw new Error('no agent token');
    const c = await mcp(k1);
    const tools = (await c.listTools()).tools.length;
    const t = await timed(c.callTool({ name: 'today_get', arguments: {} }));
    const l = await timed(c.callTool({ name: 'log_steps', arguments: { date: today, steps: 4000 + i } }));
    log(`run ${i}: ${tools} tools, today_get ${t.r.timedOut ? 'TIMED OUT' : `${t.ms} ms`}, log_steps ${l.r.timedOut ? 'TIMED OUT' : `${l.ms} ms`}`);
    label = `j5 run ${i} after`;
    await sleep(60000);
    await c.close().catch(() => undefined);
    await A.ctx.close().catch(() => undefined);
    const peak = rss(from);
    runs.push({ run: i, person: id, tools, todayMs: t.ms, todayTimedOut: !!t.r.timedOut, logMs: l.ms, logTimedOut: !!l.r.timedOut, rssBefore: Math.round(before), peakRss: Math.round(peak), growth: Math.round(peak - before), otherElu: REAL ? null : idleElu(from, id), emptyServer: Math.round(base) });
    if (peak - before > 350 || t.ms >= 2000 || t.r.timedOut || l.r.timedOut) code = 1;
  }
  // MEM_HOLD=<s>: keep the profiles and the server up for manual diagnostics (POST /profile, /snapshot on the host)
  label = 'hold';
  await sleep(Number(process.env.MEM_HOLD ?? 0) * 1000);
} catch (e) {
  log(`error: ${e.message}`);
  code = 2;
} finally {
  clearInterval(sampler);
  console.table(runs);
  fs.mkdirSync(`${ROOT}/qa/results`, { recursive: true });
  fs.writeFileSync(`${ROOT}/qa/results/E34-mem-remote${process.env.MEM_TAG ? `-${process.env.MEM_TAG}` : ''}.json`, JSON.stringify({ at: new Date().toISOString(), node: NODE, release: RELEASE, idle: IDLE, runs, samples }, null, 1));
  for (const P of profiles) await P.ctx.close().catch(() => undefined);
  await closeBrowser().catch(() => undefined);
  if (process.env.MEM_KEEP !== '1') {
    if (!REAL) await ssh('systemctl --user stop e34-server; true');
    // the e34 persons go with the data dir of this second server; the real service's persons are never touched
    await ssh(`for id in $(${VS} persons list | awk '/ e34-/{print $1}'); do ${VS} persons remove $id >/dev/null; done; true`);
  }
  tunnel.kill();
}
process.exit(code);
