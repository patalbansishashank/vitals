// Q10 visual pass of the server states: a local Vitals Server (home role, MQTT on) from the packed build serves the
// web app behind an https proxy on 127.0.0.1:5284; a Q6 profile "server" on that origin is paired with it, has the
// ring's data (an MQTT stream for today, the Lumen archive shifted to the three days before), a correction made in
// the Correct sheet and a correction the Coach proposed (left staged). Then the Q6 harness shoots the srv-* screens,
// and again with the server unreachable (srvdown-*), reporting an old version (srvold-*) and after this device was
// revoked (srvrev-*). Never touches oci-arm.
//
//   node qa/scripts/Q10/srv-visual.mjs [--seed] [--no-shoot] [screen ids for shoot.mjs …]
//
// Needs: `pnpm build` (dist/), the packed server with node_modules in .e6-tmp/srv (`pnpm --filter vitals-companion
// build`, copy packages/companion/dist/server, `npm install --omit=dev`), the Q6 "full" profile (qa/scripts/Q6/run.mjs
// --seed) for the data export. Secrets (sync words, device token, broker password, pairing codes) stay in memory.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { chromium } from 'playwright-core';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
process.env.TMPDIR ||= join(ROOT, '.e6-tmp');
const { default: mqtt } = await import(pathToFileURL(createRequire(join(ROOT, 'packages/companion/package.json')).resolve('mqtt')).href);
const args = process.argv.slice(2);
const SEED = args.includes('--seed');
const SHOOT = !args.includes('--no-shoot');
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--hold');
const TMP = join(ROOT, '.e6-tmp', 'q10-srv');
const APP = resolve(process.env.Q10_APP || join(ROOT, 'dist'));
const REL = join(ROOT, '.e6-tmp/srv');
const PROFILE = join(ROOT, '.e6-tmp/q6-profiles/server');
const PROXY_PORT = Number(process.env.Q10_SRV_PORT || 5284);
const BASE = `https://127.0.0.1:${PROXY_PORT}`;
const HTTP_BASE = process.env.Q10_HTTP_BASE || 'http://127.0.0.1:5283';
const OUT = join(ROOT, 'qa/results/Q10-srv-seed.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const log = (...a) => console.log('[srv]', ...a);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`); };
const localDate = (d) => d.toLocaleDateString('en-CA');
const TODAY = localDate(new Date());
const YESTERDAY = localDate(new Date(Date.now() - 864e5));

// ---- data: the Lumen fixtures moved to recent days --------------------------------------------------------------
/** Shifts ISO timestamps and dates inside a string by `days`. */
const shiftIso = (s, days) => s.replace(/\b(20\d\d-\d\d-\d\d)(T[\d:.]+Z)?/g, (m, d, t) => {
  const x = new Date(`${d}T${t ? t.slice(1) : '12:00:00Z'}`); x.setUTCDate(x.getUTCDate() + days);
  return t ? x.toISOString().replace('.000Z', 'Z') : x.toISOString().slice(0, 10);
});
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5);
// the MQTT stream: its activity day (2026-09-14) becomes today
const streamDays = dayDiff(TODAY, '2026-09-14');
const stream = readFileSync(join(ROOT, 'qa/fixtures/lumen/mqtt-stream.synthetic.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).map((m) => ({ ...m, payload: shiftIso(m.payload, streamDays) }));
// the archive: epoch-ms fields moved so its last day is yesterday
const archive = JSON.parse(readFileSync(join(ROOT, 'src/biometrics/importers/__fixtures__/lumen-archive.json'), 'utf8'));
const shiftMs = Date.now() - 864e5 - archive.exportedAt;
const shiftDeep = (v) => (Array.isArray(v) ? v.map(shiftDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shiftDeep(x)])) : typeof v === 'number' && v > 1.6e12 && v < 1.9e12 ? v + shiftMs : v);
writeFileSync(join(ROOT, '.e6-tmp/q10-lumen-archive.json'), JSON.stringify(shiftDeep(archive)));

// ---- 1. stand-in model: a log_steps call on yesterday (a ring-owned day) → the staged correction -------------
const standin = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] })); }
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
    const j = JSON.parse(body || '{}');
    const msgs = j.messages || [];
    const last = msgs.at(-1) || {};
    const text = typeof last.content === 'string' ? last.content : '';
    const toolName = (sfx) => (j.tools || []).map((t) => t.function?.name).find((n) => n === sfx || n?.endsWith(`_${sfx}`));
    let call = null;
    let reply = 'I can help with that.';
    if (last.role === 'tool') reply = 'Your ring counted fewer steps. I put your number in as a correction for you to check.';
    else if (/really/i.test(text) && toolName('log_steps')) call = { name: toolName('log_steps'), args: { date: YESTERDAY, steps: 9100 } };
    const id = `c${Date.now()}`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ch = (delta, fr = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta, finish_reason: fr }] })}\n\n`);
    ch({ role: 'assistant', content: '' });
    if (call) { ch({ tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }); ch({}, 'tool_calls'); }
    else { for (const w of reply.match(/.{1,12}/g)) ch({ content: w }); ch({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
});
const standinPort = await freePort();
await new Promise((r) => standin.listen(standinPort, '127.0.0.1', r));

// ---- 2. server (the I3 smoke's control script) ---------------------------------------------------------------
if (SEED) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true, mode: 0o700 });
const serverPort = await freePort();
cpSync(join(ROOT, 'qa/scripts/Q10/srv-control.mjs'), join(REL, 'q10-server.mjs'));
const srv = spawn(process.execPath, ['q10-server.mjs'], { cwd: REL, env: { ...process.env, SMOKE_CFG: JSON.stringify({ port: serverPort, dataDir: join(TMP, 'data'), origin: BASE, app: APP, standin: `http://127.0.0.1:${standinPort}/v1` }) }, stdio: ['pipe', 'pipe', 'pipe'] });
const waiters = [];
let ready;
const readyP = new Promise((r) => (ready = r));
const serverLog = [];
let buf = '';
srv.stdout.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.startsWith('READY ')) ready(line.slice(6)); else if (line.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(line.slice(5))); else serverLog.push(line);
  }
});
srv.stderr.on('data', (d) => serverLog.push(`stderr ${String(d).trim().slice(0, 300)}`));
const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
await Promise.race([readyP, sleep(60000).then(() => { throw new Error(`server did not start:\n${serverLog.join('\n')}`); })]);

// ---- 3. https proxy with modes: up | down (502, as an unreachable host) | old (reports version 0.3.9) ---------
let mode = 'up';
if (!existsSync(join(TMP, 'cert.pem'))) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(TMP, 'key.pem'), '-out', join(TMP, 'cert.pem'), '-subj', '/CN=127.0.0.1', '-days', '2', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
const proxy = https.createServer({ key: readFileSync(join(TMP, 'key.pem')), cert: readFileSync(join(TMP, 'cert.pem')) }, (req, res) => {
  const api = /^\/(v1|health|sync|mcp|mqtt)/.test(req.url);
  if (mode === 'down' && api) { req.socket.destroy(); return; }
  const up = http.request({ host: '127.0.0.1', port: serverPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (mode === 'old' && api && /json/.test(r.headers['content-type'] || '')) {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { const out = b.replace(/"version":"0\.4\.\d+"/g, '"version":"0.3.9"'); const h = { ...r.headers }; delete h['content-length']; res.writeHead(r.statusCode, h); res.end(out); });
      return;
    }
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});
proxy.on('upgrade', (req, sock, head) => {
  if (mode === 'down') return sock.destroy();
  const up = net.connect(serverPort, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
log(`server up behind ${BASE}`);

const stop = async (code) => {
  await ctrl({ op: 'close' }).catch(() => undefined);
  srv.kill(); proxy.close(); standin.close();
  rmSync(join(REL, 'q10-server.mjs'), { force: true });
  writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), checks }, null, 1));
  process.exit(code);
};

// ---- 4. seed the profile ------------------------------------------------------------------------------------------
async function seed() {
  // the Q6 "full" profile's data, exported on the preview origin
  rmSync(join(ROOT, '.e6-tmp/q6-profiles/q10-export'), { recursive: true, force: true });
  cpSync(join(ROOT, '.e6-tmp/q6-profiles/full'), join(ROOT, '.e6-tmp/q6-profiles/q10-export'), { recursive: true });
  const ex = await chromium.launchPersistentContext(join(ROOT, '.e6-tmp/q6-profiles/q10-export'), { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], serviceWorkers: 'block' });
  const ep = ex.pages()[0] || (await ex.newPage());
  await ep.goto(`${HTTP_BASE}/today?qa=1`, { waitUntil: 'networkidle' });
  await ep.waitForFunction(() => !!window.__vitals);
  const exp = await ep.evaluate(() => window.__vitals.read('data.export', {}));
  await ex.close();
  const o = exp.output ?? exp.value;
  const file = typeof o === 'string' ? o : typeof o?.json === 'string' ? o.json : typeof o?.text === 'string' ? o.text : JSON.stringify(o?.file ?? o?.data ?? o);
  writeFileSync(join(ROOT, '.e6-tmp/q10-full-export.json'), file);
  check('export of the full profile', exp.ok && file.length > 1000, `${file.length} chars`);

  rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'], ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  try { await seedIn(page, errors); } finally { await ctx.close(); }
}
async function seedIn(page, errors) {
  const go = async (route, wait = 1500) => { await page.goto(`${BASE}${route}${route.includes('?') ? '&' : '?'}qa=1`, { waitUntil: 'load' }); await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 }).catch(() => {}); await sleep(wait); };
  const read = async (id, input = {}) => page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  const btn = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });

  await go('/settings/data');
  await page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first().setInputFiles(join(ROOT, '.e6-tmp/q10-full-export.json'));
  await page.getByRole('radio', { name: 'replace' }).check();
  await btn('Import').click();
  await sleep(3000);
  // the imported safety answers need a review on this device (as in qa/scripts/Q6/seed-full.mjs)
  await go('/today');
  if (page.url().includes('/welcome')) {
    await page.getByRole('radio', { name: '18–64' }).click();
    const fs = page.locator('fieldset');
    for (let i = 1; i < (await fs.count()); i++) { const no = fs.nth(i).getByRole('radio', { name: 'no', exact: true }); if (await no.count()) await no.first().click(); }
    await btn('Save answers').click();
    await sleep(2000);
  }
  const plan = await read('plan.get');
  check('profile imported on the server origin (active plan)', plan.ok && JSON.stringify(plan).includes('"status"'), JSON.stringify(plan).slice(0, 160));

  // sync with the server's relay, then the person joins with the same owner secret
  await go('/settings/sync');
  const sync = page.locator('section#sync');
  await sync.getByLabel('sync server address').fill(BASE);
  await sync.getByRole('button', { name: 'Set up sync on this device' }).click();
  const words = page.locator('ol[aria-label="The 24 words"] li span:last-child');
  await words.first().waitFor({ timeout: 30000 });
  const phrase = (await words.allTextContents()).join(' ');
  await sync.getByLabel("I've saved the words").check();
  await sync.getByRole('button', { name: 'Hide', exact: true }).click();
  await sleep(1500);
  const added = await ctrl({ op: 'addPerson', label: 'q10-a', tz: 'Asia/Kolkata', secretHex: Buffer.from(mnemonicToEntropy(phrase, wordlist)).toString('hex') });
  const personId = added.id;
  check('server person added (joins the sync group)', /^[0-9a-f]{16}$/.test(personId ?? ''), added.error ?? '');
  writeFileSync(join(TMP, 'person.json'), JSON.stringify({ personId }));

  // pairing by code in Settings › Server
  const { code } = await ctrl({ op: 'code', person: personId, label: 'Q10 browser' });
  await go('/settings/server');
  await btn('Enter code').first().click();
  await page.getByLabel('server address').first().fill(BASE);
  await page.getByLabel(/^first 4/).fill(code.slice(0, 4));
  await page.getByLabel(/^last 4/).fill(code.slice(4));
  await btn(/^Pair( this device)?$/).first().click();
  await page.getByText(/Paired with/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
  const paired = await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('vitals.server.v1') || 'null')?.token));
  check('paired by code', paired);

  // a provider key on the server, OpenCode Zen via your server for the Coach
  const keyStatus = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1'));
    return (await fetch(`${s.baseUrl}/v1/ai/keys/opencode-zen`, { method: 'PUT', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'sk-q10-stand-in-0001' }) })).status;
  });
  check('provider key set on the server', keyStatus === 204, keyStatus);
  // an agent key (Q11): the Server page lists it among the devices, and its revoke dialog is shot
  const agentStatus = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1'));
    const h = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' };
    const list = await (await fetch(`${s.baseUrl}/v1/agents/tokens`, { headers: h })).json().catch(() => ({}));
    if ((list.tokens ?? []).some((t) => t.label === 'QA Claude Code')) return 'exists';
    return (await fetch(`${s.baseUrl}/v1/agents/tokens`, { method: 'POST', headers: h, body: JSON.stringify({ client: 'claude', scope: 'log', label: 'QA Claude Code' }) })).status;
  });
  check('agent key made on the server', agentStatus === 'exists' || (agentStatus >= 200 && agentStatus < 300), agentStatus);
  await go('/settings/ai');
  await page.locator('input[type=radio][value="opencode-zen"]').evaluate((e) => e.click());
  await sleep(800);
  const model = page.getByLabel(/^model$/i).first();
  if ((await model.count()) && (await model.evaluate((e) => e.tagName)) === 'SELECT') {
    const opts = await model.locator('option').allTextContents();
    await model.selectOption(opts.some((o) => o.includes('fake-model')) ? { label: 'fake-model' } : { index: opts.length - 1 });
  }
  const other = page.getByLabel(/model id/i).first();
  if (await other.count()) await other.fill('fake-model');
  await btn('Save provider').click();
  await sleep(1500);

  // broker login through the Devices card (shown-once block shot with its values masked), then the stream
  await go('/settings/devices', 2500);
  await btn('Create broker login').click();
  const once = page.getByRole('group', { name: /shown once|copy it now/i }).first();
  await once.waitFor({ timeout: 20000 });
  const cred = { username: (await once.getByTestId('once-username').innerText()).trim(), password: (await once.getByTestId('once-password').innerText()).trim() };
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
    await once.scrollIntoViewIfNeeded(); await sleep(500);
    await page.screenshot({ path: join(ROOT, `qa/screenshots/Q10/mqtt-shown-once-${w}.png`), mask: [once.locator('dd')] });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await once.getByRole('checkbox').check();
  await once.getByRole('button', { name: 'Done' }).click();
  let client;
  try {
    client = await mqtt.connectAsync(`ws://127.0.0.1:${serverPort}/mqtt`, { username: cred.username, password: cred.password, reconnectPeriod: 0, protocolVersion: 4 });
    for (const m of stream) await client.publishAsync(m.topic, m.payload, { qos: 1 });
    await client.endAsync(true);
    check('broker login from the card works; the stream is published', true, `${stream.length} messages for ${TODAY}`);
  } catch (e) { check('broker login from the card works; the stream is published', false, e.message); }
  await ctrl({ op: 'idle', person: personId });

  // history: the archive through the Devices card's import
  await go('/settings/devices', 2000);
  const hist = page.locator('input[type=file][aria-label^="Import your Lumen Health history"]');
  check('the Devices card offers the history import (broker connected)', await hist.count() > 0);
  await (await hist.count() ? hist : page.locator('input[type=file]').first()).setInputFiles(join(ROOT, '.e6-tmp/q10-lumen-archive.json'));
  await sleep(2500);
  for (const w of [1440, 390]) { await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await sleep(500); await page.screenshot({ path: join(ROOT, `qa/screenshots/Q10/archive-import-${w}.png`) }); }
  await page.setViewportSize({ width: 1440, height: 900 });
  const imp = page.getByRole('button', { name: /^(Import|Bring in|Import \d+)/ }).last();
  if (await imp.count()) { await imp.click().catch(() => {}); await sleep(4000); }
  const sources = JSON.stringify(await read('bio.sources'));
  check('archive imported (a Lumen source with records)', /lumen/i.test(sources), sources.slice(0, 200));

  // wait for the ring's records to reach this device; then the Correct sheet on Today
  let rec = 0;
  for (let i = 0; i < 30 && !rec; i++) { await sleep(2000); const r = await read('bio.series', { metric: 'hr', from: YESTERDAY, to: TODAY, resolution: 'raw' }); rec = r.output?.points?.length ?? 0; }
  check('ring data readable on this device', rec > 0);
  await go('/today', 2500);
  const correct = btn(/^Correct /).first();
  if (await correct.count()) {
    await correct.click(); await sleep(1000);
    const f = page.getByLabel(/^(steps|hours asleep)$/).locator('visible=true').first();
    await f.fill((await f.getAttribute('aria-label').catch(() => null)) === 'steps' || /steps/.test(await f.evaluate((e) => e.labels?.[0]?.innerText ?? '')) ? '8800' : '7');
    await page.getByLabel('note (optional)').locator('visible=true').first().fill('The ring was charging.').catch(() => {});
    await btn('Confirm').locator('visible=true').first().click();
    await sleep(2500);
  }
  check('a correction made in the Correct sheet (marker on Today)', await page.getByText(/corrected/i).count() > 0);

  // the Coach proposes a correction for yesterday (log_steps on a ring-owned day) and it stays staged
  await go('/coach', 2000);
  const box = page.locator('textarea.lv-composer__field, input.lv-composer__field').first();
  await box.fill(`My steps yesterday were really 9100`);
  await box.press('Enter');
  const staged = await btn(/^Apply/).first().waitFor({ timeout: 45000 }).then(() => true, () => false);
  check('the Coach’s correction is staged (proposal card)', staged);
  await sleep(2000);
  check('no page errors while seeding', errors.length === 0, errors.join(' | '));
}

let code = 0;
try {
  mkdirSync(join(ROOT, 'qa/screenshots/Q10'), { recursive: true });
  if (SEED || !existsSync(PROFILE)) await seed();
  // --hold <s>: keep the server up for manual probes
  if (args.includes('--hold')) { log('holding'); await sleep(Number(args[args.indexOf('--hold') + 1]) * 1000); }
  if (SHOOT) {
    // async: this process hosts the proxy and the stand-in, so it must keep serving while shoot.mjs runs
    const shoot = (ids) => new Promise((r) => spawn('node', [join(ROOT, 'qa/scripts/Q6/shoot.mjs'), ...ids], { stdio: 'inherit', env: { ...process.env, Q6_SERVER: '1', BASE } }).on('exit', (c) => r(c ?? 1)));
    const want = (p) => (only.length ? only.filter((o) => o.startsWith(p)) : [`${p}-*`]);
    for (const [m, p] of [['up', 'srv'], ['down', 'srvdown'], ['old', 'srvold'], ['rev', 'srvrev']]) {
      const ids = want(p).filter((o) => m === 'up' ? /^srv-/.test(o) : true);
      if (!ids.length) continue;
      if (m === 'rev') {
        const { personId } = JSON.parse(readFileSync(join(TMP, 'person.json'), 'utf8'));
        // revoke every device of the QA person through the server's own store (as `vitals-server devices revoke`)
        const res = await ctrl({ op: 'revokeAll', person: personId });
        check('this device revoked on the server', !res.error, JSON.stringify(res).slice(0, 160));
        mode = 'up';
      } else mode = m;
      log(`shooting ${ids.join(' ')} with the server ${m}`);
      code ||= await shoot(ids);
    }
  }
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  log(serverLog.slice(-15).join('\n'));
  code = 1;
}
await stop(checks.some((c) => !c.ok) ? 1 : code);
