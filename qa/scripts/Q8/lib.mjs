// Q8 shared helpers: the production build (vite preview on 127.0.0.1:5281, production CSP) opened under the live
// site's origin, the Vitals Server on oci-arm, its CLI over ssh (only for persons whose label starts with "q8-"), and
// pass/fail rows written to qa/results/Q8-<journey>.json.
//
// Why the origin mapping: oci-arm's server.json allows only https://vitals.creative.desi as a browser origin, and this
// package may not change the host's config. Every request a test browser makes to https://vitals.creative.desi is
// answered by Playwright from the local preview (same files, same CSP headers), so the page runs this branch's build
// with the allowed origin. Nothing is sent to the live site. Service workers are blocked so every request is routed.
//
// Secrets (sync words, pairing codes, device and agent tokens) stay in memory. Values that must outlive one process are
// written to .e6-tmp/q8/ (0600) and never printed.
import { chromium } from 'playwright-core';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverUrl, localConfig } from '../lib/localConfig.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.env.TMPDIR = process.env.TMPDIR || `${ROOT}/.e6-tmp`;
export const SERVER = process.env.Q8_SERVER || serverUrl();
export const SITE = 'https://vitals.creative.desi';
export const PREVIEW = `http://127.0.0.1:${process.env.Q8_PORT || 5281}`;
export const DIST = process.env.Q8_DIST || `${ROOT}/dist`;
export const PRIVATE = `${ROOT}/.e6-tmp/q8`;
fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// ------------------------------------------------------------------------------------------------ results
export function results(journey) {
  const rows = [];
  const check = (name, ok, detail = '') => {
    rows.push({ journey, name, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 300) });
    log(`${ok ? 'PASS' : 'FAIL'} ${journey}: ${name}${ok || !detail ? '' : ` — ${String(detail).slice(0, 300)}`}`);
    return Boolean(ok);
  };
  const save = (extra = {}) => {
    fs.mkdirSync(`${ROOT}/qa/results`, { recursive: true });
    const failed = rows.filter((r) => !r.ok).length;
    fs.writeFileSync(`${ROOT}/qa/results/Q8-${journey}.json`, JSON.stringify({ journey, at: new Date().toISOString(), server: SERVER, passed: rows.length - failed, failed, ...extra, checks: rows }, null, 1) + '\n');
    return rows;
  };
  return { rows, check, save };
}
/** Fails if any secret value appears in a string about to be stored or printed. */
export function scrub(text, secrets) {
  let s = String(text ?? '');
  for (const v of secrets.filter((x) => x && x.length >= 6)) s = s.split(v).join('[secret]');
  return s;
}

// ------------------------------------------------------------------------------------------------ preview server
export async function ensurePreview() {
  const up = async () => { try { return (await fetch(`${PREVIEW}/`)).ok; } catch { return false; } };
  if (await up()) return;
  if (!fs.existsSync(`${DIST}/index.html`)) throw new Error(`no build in ${DIST}: run pnpm build`);
  const out = fs.openSync(`${PRIVATE}/preview.log`, 'a');
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', new URL(PREVIEW).port, '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error('vite preview did not start');
}

// ------------------------------------------------------------------------------------------------ browser
let browser = null;
let insecure = null;
const ARGS = ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarningOnly'];
export async function launch({ selfSigned = false } = {}) {
  // selfSigned: a separate browser that accepts the self-signed certificate of a local relay in front of the server
  if (selfSigned) return (insecure ??= await chromium.launch({ executablePath: '/usr/bin/chromium', args: [...ARGS, '--ignore-certificate-errors'] }));
  browser ??= await chromium.launch({ executablePath: '/usr/bin/chromium', args: ARGS });
  return browser;
}
export async function closeBrowser() { await browser?.close().catch(() => {}); await insecure?.close().catch(() => {}); browser = null; insecure = null; }
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } };
/** A fresh browser profile (its own storage) whose https://vitals.creative.desi is this branch's build. */
export async function openProfile(name, { vp = 'desktop', site = SITE, selfSigned = false, map = true } = {}) {
  await ensurePreview();
  const b = await launch({ selfSigned });
  const ctx = await b.newContext({ viewport: VIEWPORTS[vp], serviceWorkers: 'block', ...(vp === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
  if (map && site !== PREVIEW) {
    await ctx.route(`${site}/**`, async (route) => {
      const u = new URL(route.request().url());
      // the machine is shared and often loaded: retry a failed local fetch before giving up
      for (let i = 0; i < 4; i++) {
        try {
          const r = await route.fetch({ url: `${PREVIEW}${u.pathname}${u.search}`, maxRedirects: 0, timeout: 60000 });
          return await route.fulfill({ response: r });
        } catch { await sleep(500 * (i + 1)); }
      }
      await route.abort().catch(() => {});
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  return { name, ctx, page, errors, site };
}
export async function go(p, route = '/') {
  const u = new URL(route, p.site);
  u.searchParams.set('qa', '1');
  await p.page.goto(u.toString(), { waitUntil: 'load' });
  await p.page.waitForFunction(() => !!window.__vitals, null, { timeout: 90000 });
  await sleep(800);
}
export async function read(p, id, input = {}, { raw = false } = {}) {
  const r = await p.page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  if (raw) return r;
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.output ?? r.value ?? r;
}
export const pairing = (p) => p.page.evaluate(() => JSON.parse(localStorage.getItem('vitals.server.v1') || 'null'));
export const mainText = (p) => p.page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s*\n\s*/g, ' | '));
export async function shot(p, file) {
  const out = `${ROOT}/qa/screenshots/Q8-${file}.png`;
  await p.page.screenshot({ path: out, type: 'png' });
  if (fs.statSync(out).size > 200_000) await p.page.screenshot({ path: out, type: 'png', scale: 'css', clip: { x: 0, y: 0, ...(p.page.viewportSize()), height: Math.min(900, p.page.viewportSize().height) } });
  return path.relative(ROOT, out);
}
/** Calls the server from the page with this profile's device token (the token never leaves the page). */
export function serverCall(p, method, route, body) {
  return p.page.evaluate(async ([method, route, body]) => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1') || 'null');
    if (!s) return { status: 0, body: 'not paired' };
    const r = await fetch(`${s.baseUrl}${route}`, { method, headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = t; try { j = JSON.parse(t); } catch { /* text */ }
    return { status: r.status, body: j };
  }, [method, route, body ?? null]);
}

// ------------------------------------------------------------------------------------------------ Settings flows
/** Settings › Sync: sets up a new sync group against `server`; returns the 24 words (kept in memory by the caller). */
export async function setUpSync(p, server = SERVER) {
  await go(p, '/settings#sync');
  const sync = p.page.locator('section#sync');
  const addr = sync.getByLabel('sync server address');
  await addr.fill(server);
  await sync.getByRole('button', { name: 'Set up sync on this device' }).click();
  const words = p.page.locator('ol[aria-label="The 24 words"] li span:last-child');
  await words.first().waitFor({ timeout: 45000 });
  const phrase = (await words.allTextContents()).map((w) => w.trim()).join(' ');
  await sync.getByLabel("I've saved the words").check();
  await sync.getByRole('button', { name: 'Hide', exact: true }).click();
  await sleep(1500);
  return phrase;
}
/** Settings › Sync on another profile: joins with the 24 words. */
export async function joinSync(p, phrase, server = SERVER, { choice = 'Replace with synced data' } = {}) {
  await go(p, '/settings#sync');
  const sync = p.page.locator('section#sync');
  await sync.getByLabel('sync server address').fill(server);
  const join = sync.getByRole('button', { name: 'Join with a pairing code' });
  if (await join.count()) await join.first().click();
  await sync.getByLabel('pairing code').fill(phrase);
  await sync.getByRole('button', { name: 'Join', exact: true }).click();
  const pick = p.page.getByRole('button', { name: choice });
  if (await pick.first().waitFor({ timeout: 8000 }).then(() => true, () => false)) await pick.first().click();
  await sleep(2500);
}
/** Settings › Server: pairs by code typed into the two 4-digit fields. */
export async function pairByCode(p, code, server = SERVER, label = null) {
  await go(p, '/settings?section=server');
  const enter = p.page.getByRole('button', { name: 'Enter code' });
  if (await enter.count()) await enter.first().click();
  const addr = p.page.getByLabel('server address').first();
  if (await addr.isEditable().catch(() => false)) await addr.fill(server);
  await p.page.getByLabel('first 4 digits').fill(code.slice(0, 4));
  await p.page.getByLabel('last 4 digits').fill(code.slice(4));
  if (label) { const n = p.page.getByLabel('name this device'); if (await n.count()) await n.fill(label); }
  await p.page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
  await p.page.getByText(/Paired with/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
  await sleep(1000);
  return Boolean((await pairing(p))?.token);
}

// ------------------------------------------------------------------------------------------------ server CLI over ssh
const VS = 'node ~/vitals-server/current/bin/vitals-server.mjs';
const mine = new Map(); // person id → label, only persons this process created or found with a q8- label
export function sshRun(cmd, input = null, timeout = 60000) {
  return new Promise((resolve) => {
    const c = execFile('ssh', ['-o', 'BatchMode=yes', localConfig(['serverSsh']).serverSsh, cmd], { timeout, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    if (input !== null) c.stdin.end(input); else c.stdin.end();
  });
}
const safeArg = (s) => { if (!/^[A-Za-z0-9 _./:-]+$/.test(s)) throw new Error('unsafe argument'); return `'${s}'`; };
export async function personsList() {
  const r = await sshRun(`${VS} persons list`);
  return r.stdout.split('\n').map((l) => l.match(/^([0-9a-f]{16})\s+(.+?)\s+(\S+)$/)).filter(Boolean).map((m) => ({ id: m[1], label: m[2], createdAt: m[3] }));
}
/** Adds a q8- person; with `phrase` it joins that sync group (phrase on stdin, never on the command line). */
export async function addPerson(label, phrase = null) {
  if (!label.startsWith('q8-')) throw new Error('Q8 only creates persons labelled q8-…');
  const r = await sshRun(`${VS} persons add ${safeArg(label)} --tz Asia/Kolkata${phrase ? ' --join' : ''}`, phrase ? `${phrase}\n` : null);
  const m = r.stdout.match(/([0-9a-f]{16})\s+q8-/);
  if (!m) throw new Error(`persons add failed: ${r.stderr.slice(0, 200)}`);
  mine.set(m[1], label);
  fs.appendFileSync(`${PRIVATE}/persons.txt`, `${m[1]} ${label}\n`, { mode: 0o600 });
  return m[1];
}
function own(id) {
  if (!mine.has(id)) throw new Error(`refusing to touch person ${id}: not created by Q8`);
  return id;
}
/** Adopts q8- persons left by an earlier run (for cleanup). */
export async function adoptLeftovers() {
  for (const p of await personsList()) if (p.label.startsWith('q8-')) mine.set(p.id, p.label);
  return [...mine.keys()];
}
/** One-use 8-digit pairing code for a q8 person (never printed). */
export async function pairCode(id, label = 'Q8 browser') {
  const r = await sshRun(`${VS} pair code ${own(id)} --label ${safeArg(label)}`);
  const m = r.stdout.match(/Code (\d{8})/);
  if (!m) throw new Error(`pair code failed: ${r.stderr.slice(0, 200)}`);
  return m[1];
}
export async function devicesList(id) {
  const r = await sshRun(`${VS} devices list ${own(id)}`);
  return r.stdout.split('\n').map((l) => l.match(/^(\S+)\s+(\w+)\s+(.+?)\s+last seen (\S+)$/)).filter(Boolean).map((m) => ({ id: m[1], kind: m[2], label: m[3], lastSeenAt: m[4] }));
}
export async function devicesRevoke(id, deviceId) { return (await sshRun(`${VS} devices revoke ${own(id)} ${safeArg(deviceId)}`)).stdout.trim(); }
export async function personsRemove(id) {
  const r = await sshRun(`${VS} persons remove ${own(id)}`);
  mine.delete(id);
  return r.stdout.trim();
}
/** `ls -la` of a q8 person's directory tree (read-only). */
export async function lsPerson(id) {
  return (await sshRun(`cd ~/.local/share/vitals-server/persons && ls -laR ${own(id)}`)).stdout;
}
export const health = async () => (await fetch(`${SERVER}/health`)).json();

// ------------------------------------------------------------------------------------------------ switchable relay
/**
 * A local https relay in front of the server (self-signed, 127.0.0.1) that a profile can use as its sync address, so a
 * test can take that one device offline: `off()` cuts every open connection and refuses new ones, `on()` lets them
 * through again. Evolu's socket lives in a worker, where page-level routing and `setOffline` do not reach.
 */
export async function switchableRelay() {
  const { execFileSync } = await import('node:child_process');
  const https = await import('node:https');
  const tls = await import('node:tls');
  const target = new URL(SERVER);
  const dir = `${PRIVATE}/relay-cert`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(`${dir}/cert.pem`)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`, '-subj', '/CN=127.0.0.1', '-days', '2', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  let offline = false;
  const open = new Set();
  const srv = https.createServer({ key: fs.readFileSync(`${dir}/key.pem`), cert: fs.readFileSync(`${dir}/cert.pem`) }, (req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const up = https.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host }, servername: target.hostname }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  srv.on('upgrade', (req, sock, head) => {
    if (offline) { sock.destroy(); return; }
    const up = tls.connect({ host: target.hostname, port: Number(target.port), servername: target.hostname }, () => {
      const headers = { ...req.headers, host: target.host };
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    open.add(sock); open.add(up);
    const done = () => { open.delete(sock); open.delete(up); sock.destroy(); up.destroy(); };
    up.on('error', done); sock.on('error', done); up.on('close', done); sock.on('close', done);
  });
  srv.on('connection', (s) => { open.add(s); s.on('close', () => open.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `https://127.0.0.1:${srv.address().port}`,
    off() { offline = true; for (const s of open) s.destroy(); open.clear(); },
    on() { offline = false; },
    close() { offline = true; for (const s of open) s.destroy(); srv.close(); },
  };
}
