// Memory repro for Q8-10 / the oci-arm freeze: a local server (home role) from this checkout, a fresh browser profile
// that creates a sync group, a person that joins it, an agent key, then MCP today_get + log_steps while sampling the
// server's memory every 2 s. Prints a table; exits 1 if the server grew by more than 300 MB.
//   pnpm build && pnpm --filter vitals-companion build:person && node qa/scripts/Q8/mem-repro.mjs
// MEM_REMOTE=1 runs the oci-arm variant instead (a second server on port 4871 there, idle persons, three journey-5 runs,
// per-thread diagnostics): ./mem-remote.mjs, see its header.
if (process.env.MEM_REMOTE) await import('./mem-remote.mjs');
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ROOT, DIST, PRIVATE, openProfile, go, pairByCode, setUpSync, serverCall, sleep, closeBrowser, log } from './lib.mjs';
const req = createRequire(`${ROOT}/packages/companion/package.json`);
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const serverPort = await freePort();
const proxyPort = await freePort();
const BASE = `https://127.0.0.1:${proxyPort}`;
fs.rmSync(`${PRIVATE}/mem-server`, { recursive: true, force: true });
const srv = spawn(process.execPath, [`${ROOT}/qa/scripts/Q8/local-server.mjs`], { cwd: ROOT, env: { ...process.env, SMOKE_CFG: JSON.stringify({ port: serverPort, dataDir: `${PRIVATE}/mem-server`, origin: BASE, app: DIST, standin: 'http://127.0.0.1:9/v1' }) }, stdio: ['pipe', 'pipe', 'pipe'] });
const waiters = []; let ready; const readyP = new Promise((r) => (ready = r)); const serverLog = []; let buf = '';
srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.startsWith('READY ')) ready(line.slice(6)); else if (line.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(line.slice(5))); else serverLog.push(line.slice(0, 300)); } });
srv.stderr.on('data', (d) => serverLog.push(`stderr ${String(d).trim().slice(0, 300)}`));
const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
await Promise.race([readyP, sleep(120000).then(() => { throw new Error(`local server did not start: ${serverLog.slice(-5).join(' / ')}`); })]);
const certDir = `${PRIVATE}/relay-cert`; fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
if (!fs.existsSync(`${certDir}/cert.pem`)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-subj', '/CN=127.0.0.1', '-days', '2', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
const front = https.createServer({ key: fs.readFileSync(`${certDir}/key.pem`), cert: fs.readFileSync(`${certDir}/cert.pem`) }, (rq, rs) => { const up = http.request({ host: '127.0.0.1', port: serverPort, path: rq.url, method: rq.method, headers: rq.headers }, (r) => { rs.writeHead(r.statusCode, r.headers); r.pipe(rs); }); up.on('error', () => { if (!rs.headersSent) rs.writeHead(502); rs.end(); }); rq.pipe(up); });
front.on('upgrade', (rq, sock, head) => { const up = net.connect(serverPort, '127.0.0.1', () => { up.write(`${rq.method} ${rq.url} HTTP/1.1\r\n${Object.entries(rq.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`); if (head?.length) up.write(head); sock.pipe(up).pipe(sock); }); up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy()); });
await new Promise((r) => front.listen(proxyPort, '127.0.0.1', r));
const mem = async () => { try { const r = await fetch(`http://127.0.0.1:${serverPort}/health`); return (await r.json()).memoryMb ?? -1; } catch { return -1; } };
const samples = []; const sampler = setInterval(async () => samples.push([new Date().toISOString().slice(11, 19), await mem()]), 2000);
const mark = async (what) => { const m = await mem(); samples.push([new Date().toISOString().slice(11, 19), m, what]); log(`${what}: server ${m} MB`); };
let code = 0;
try {
  await mark('server up');
  const A = await openProfile('mem-a', { site: BASE, selfSigned: true, map: false });
  const phrase = await setUpSync(A, BASE);
  await mark('browser sync group created');
  const added = await ctrl({ op: 'addPerson', label: 'mem-p', tz: 'Asia/Kolkata', secretHex: Buffer.from(mnemonicToEntropy(phrase, wordlist)).toString('hex') });
  const pc = await ctrl({ op: 'code', person: added.id, label: 'mem A' });
  await pairByCode(A, pc.code, BASE, 'mem A');
  await mark('person joined and browser paired');
  const made = await serverCall(A, 'POST', '/v1/agents/tokens', { client: 'claude', label: 'mem key', scope: 'log' });
  const token = made.body?.token;
  if (!token) throw new Error(`no agent token: ${JSON.stringify(made).slice(0, 200)}`);
  const c = new Client({ name: 'mem-repro', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${serverPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  await mark('mcp connected');
  const tools = (await c.listTools()).tools.length;
  await mark(`tools listed (${tools})`);
  const t0 = Date.now();
  const t = await Promise.race([c.callTool({ name: 'today_get', arguments: {} }), sleep(90000).then(() => ({ timedOut: true }))]);
  await mark(`today_get ${t.timedOut ? 'TIMED OUT' : 'answered'} in ${Date.now() - t0} ms`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const t1 = Date.now();
  const l = await Promise.race([c.callTool({ name: 'log_steps', arguments: { date: today, steps: 4321 } }), sleep(90000).then(() => ({ timedOut: true }))]);
  await mark(`log_steps ${l.timedOut ? 'TIMED OUT' : 'answered'} in ${Date.now() - t1} ms`);
  await sleep(30000);
  await mark('30 s idle after the calls');
  const peak = Math.max(...samples.map((s) => s[1]));
  const base = samples[0][1];
  log(`peak ${peak} MB, base ${base} MB, growth ${peak - base} MB`);
  if (peak - base > 300 || t.timedOut || l.timedOut) code = 1;
  await c.close().catch(() => undefined);
} catch (e) {
  log(`error: ${e.message}`); code = 2;
} finally {
  clearInterval(sampler);
  console.table(samples.filter((s) => s[2] || samples.indexOf(s) % 5 === 0).map(([t, m, w]) => ({ t, mb: m, what: w ?? '' })));
  fs.writeFileSync(`${ROOT}/qa/results/Q8-mem-repro.json`, JSON.stringify({ at: new Date().toISOString(), samples, serverLog: serverLog.slice(-40) }, null, 1));
  await closeBrowser().catch(() => undefined);
  await ctrl({ op: 'close' }).catch(() => undefined);
  srv.kill(); front.close();
  log(`server log tail: ${serverLog.slice(-6).join(' / ')}`);
}
process.exit(code);
