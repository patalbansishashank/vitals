// I3 end-to-end smoke of batch 03 (local only; never touches oci-arm or port 4870).
//
//   node qa/scripts/I3/smoke.mjs
//
// Needs: the web app built to .e6-tmp/dist (`npx vite build --outDir .e6-tmp/dist`) and the packed server installed by
// the deploy dry run (`DEPLOY_TARGET=local:.e6-tmp/dryhost PORT=5281 deploy/oci-arm.sh`), i.e.
// .e6-tmp/dryhost/vitals-server/current with node_modules. Override with APP_DIST / SERVER_DIR.
//
// What it does, all on 127.0.0.1:
//  1. a scripted OpenAI-compatible stand-in (chat/completions, streamed tool calls)
//  2. the packed server (home role, MQTT on) serving the built web app, OpenCode Zen pointed at the stand-in
//  3. an https proxy in front (the website accepts only https server addresses), self-signed, Chromium ignores it
//  4. headless Chromium: sync set up against the server's relay; the server adds a person that joins that sync group
//  5. pairing by code in Settings › Server
//  6. a key for OpenCode Zen set through the server; OpenCode Zen (via your server) chosen in Settings › Coach
//  7. a Coach message → a streamed `log_steps` call → the log changes → the reply streams back
//  8. the Lumen fixture stream through mqtt.js into the broker → the records reach the browser by sync
//  9. a correction through the Coach (`biometrics_correct`, applied from the proposal card) → a replayed and a newer
//     device value arrive over MQTT → the day still shows the correction
// Secrets (the 24 words, the device token, the MQTT password) stay in memory and are never printed.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
// mqtt.js is a dev dependency of packages/companion only
const { default: mqtt } = await import(pathToFileURL(createRequire(join(ROOT, 'packages/companion/package.json')).resolve('mqtt')).href);
const TMP = join(ROOT, '.e6-tmp', 'i3-smoke');
const APP = resolve(process.env.APP_DIST || join(ROOT, '.e6-tmp/dist'));
const REL = resolve(process.env.SERVER_DIR || join(ROOT, '.e6-tmp/dryhost/vitals-server/current'));
const SHOTS = join(ROOT, 'qa/screenshots');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok) });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const today = new Date().toLocaleDateString('en-CA');
const DAY = '2026-09-14'; // the fixture's activity day
const STEPS = 12345;
const CORRECTED = 7777;

for (const p of [APP, join(APP, 'index.html'), join(REL, 'node_modules'), join(REL, 'dist/person-worker.mjs')]) {
  if (!existsSync(p)) throw new Error(`missing ${p} (see the header of this script)`);
}
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true, mode: 0o700 });

// ---- 1. stand-in ---------------------------------------------------------------------------------------------------
const seen = [];
const standin = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ? 'present' : 'absent' });
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
    const j = JSON.parse(body || '{}');
    seen.at(-1).tools = (j.tools || []).map((t) => t.function?.name).filter(Boolean);
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const toolName = (suffix) => (j.tools || []).map((t) => t.function?.name).find((n) => n === suffix || n?.endsWith(`_${suffix}`) || n?.endsWith(`.${suffix}`));
    const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '');
    let call = null;
    let reply = 'Hello from the stand-in.';
    if (last.role === 'tool') {
      const prevCall = [...msgs].reverse().find((m) => m.tool_calls)?.tool_calls?.[0]?.function?.name ?? '';
      reply = prevCall.includes('correct') || msgs.some((m) => typeof m.content === 'string' && /really/.test(m.content)) ? `I put in your correction: ${CORRECTED} steps on ${DAY}.` : `Logged ${STEPS} steps for today.`;
    } else if (/walked/i.test(text) && toolName('log_steps')) {
      call = { name: toolName('log_steps'), args: { date: today, steps: STEPS } };
    } else if (/really/i.test(text) && toolName('biometrics_correct')) {
      call = { name: toolName('biometrics_correct'), args: { target: { kind: 'daily', localDate: DAY, metric: 'steps' }, value: { fields: { steps: CORRECTED } }, note: 'The ring missed a walk.' } };
    } else if (/really/i.test(text) && toolName('log_steps')) {
      // the Coach's tool list has no biometrics_correct; logging steps on a day the ring owns becomes a correction
      // proposal (the redirect of SUITE_SPEC §14.6)
      call = { name: toolName('log_steps'), args: { date: DAY, steps: CORRECTED } };
    }
    const id = `chatcmpl-${seen.length}`;
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    if (!j.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      const message = call ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: 'assistant', content: reply };
      return res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }], usage }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ch = (delta, fr = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [{ index: 0, delta, finish_reason: fr }] })}\n\n`);
    ch({ role: 'assistant', content: '' });
    if (call) {
      const a = JSON.stringify(call.args);
      ch({ tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: call.name, arguments: a.slice(0, 20) } }] });
      ch({ tool_calls: [{ index: 0, function: { arguments: a.slice(20) } }] });
      ch({}, 'tool_calls');
    } else {
      for (const w of reply.match(/.{1,10}/g)) ch({ content: w });
      ch({}, 'stop');
    }
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: j.model, choices: [], usage })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
const standinPort = await freePort();
await new Promise((r) => standin.listen(standinPort, '127.0.0.1', r));

// ---- 2. server -----------------------------------------------------------------------------------------------------
const serverPort = await freePort();
const proxyPort = await freePort();
const BASE = `https://127.0.0.1:${proxyPort}`;
cpSync(join(ROOT, 'qa/scripts/I3/smoke-server.mjs'), join(REL, 'smoke-server.mjs'));
const srv = spawn(process.execPath, ['smoke-server.mjs'], {
  cwd: REL,
  env: { ...process.env, SMOKE_CFG: JSON.stringify({ port: serverPort, dataDir: join(TMP, 'data'), origin: BASE, app: APP, standin: `http://127.0.0.1:${standinPort}/v1` }) },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const waiters = [];
let ready;
const readyP = new Promise((r) => (ready = r));
const serverLog = [];
let buf = '';
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.startsWith('READY ')) ready(line.slice(6));
    else if (line.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(line.slice(5)));
    else serverLog.push(line);
  }
});
srv.stderr.on('data', (d) => serverLog.push(`stderr ${String(d).trim().slice(0, 400)}`));
const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
log(`server ready at ${await Promise.race([readyP, sleep(60000).then(() => { throw new Error(`server did not start:\n${serverLog.join('\n')}`); })])}`);

// ---- 3. https proxy ------------------------------------------------------------------------------------------------
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(TMP, 'key.pem'), '-out', join(TMP, 'cert.pem'), '-subj', '/CN=127.0.0.1', '-days', '1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
const proxy = https.createServer({ key: readFileSync(join(TMP, 'key.pem')), cert: readFileSync(join(TMP, 'cert.pem')) }, (req, res) => {
  const up = http.request({ host: '127.0.0.1', port: serverPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});
proxy.on('upgrade', (req, sock, head) => {
  const up = net.connect(serverPort, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});
await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r));
const health = await (await fetch(`http://127.0.0.1:${serverPort}/health`)).json();
check('server /health answers role home', health.role === 'home', JSON.stringify(health));

// ---- 4. browser ----------------------------------------------------------------------------------------------------
function webmcpPolyfill() {
  localStorage.setItem('vitals-agents.webmcp', 'true');
  window.__tools = {};
  Object.defineProperty(navigator, 'modelContext', {
    value: { registerTool(t) { window.__tools[t.name] = t; return { unregister() { delete window.__tools[t.name]; } }; }, unregisterTool(n) { delete window.__tools[n]; } },
    configurable: true,
  });
}
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  // the LNA flags of docs/COMPANION.md are not needed here: the app and the server share one origin
  args: ['--no-sandbox', '--ignore-certificate-errors'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(webmcpPolyfill);
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) log(`navigated: ${f.url()}`); });
page.on('websocket', (ws) => {
  log(`websocket ${ws.url().replace(/\?.*/, '?…')}`);
  ws.on('close', () => log('websocket closed'));
  ws.on('socketerror', (e) => log(`websocket error ${e}`));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
const tool = async (name, input = {}) => {
  await page.waitForFunction((n) => window.__tools?.[n], name, { timeout: name === 'sync_now' ? 2000 : 20000 });
  return JSON.parse(await page.evaluate(async ([n, i]) => (await window.__tools[n].execute(i)).content[0].text, [name, input]));
};
/** Documents of a collection in this device's IndexedDB mirror whose JSON contains `needle`. */
const idbHas = (col, needle) =>
  page.evaluate(
    ([col, needle]) =>
      new Promise((resolve) => {
        const open = indexedDB.open('vitals-docs');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          const store = [...db.objectStoreNames].find((s) => db.transaction(s).objectStore(s).indexNames.contains('col'));
          if (!store) return resolve(-1);
          const req = db.transaction(store).objectStore(store).index('col').getAll(col);
          req.onsuccess = () => resolve(req.result.filter((r) => JSON.stringify(r).includes(needle)).length);
          req.onerror = () => resolve(-1);
        };
      }),
    [col, needle],
  );
const bioDay = async () => {
  const r = await tool('bio_daily', { from: DAY, to: DAY }).catch((e) => ({ error: e.message.split('\n')[0] }));
  return JSON.stringify(r).slice(0, 4000);
};
const sectionText = async (sel) => ((await page.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s*\n\s*/g, ' | ').slice(0, 400);

let personId = null;
try {
  // a profile first (the living screens need one): the Q1b fixture export, then the current screener
  await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
  await page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first().setInputFiles(join(ROOT, 'qa/fixtures/q1b/export-m-veg.json'));
  await page.getByRole('radio', { name: 'replace' }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await sleep(2500);
  await page.goto(`${BASE}/coach`, { waitUntil: 'load' });
  await sleep(1500);
  if (await page.getByRole('button', { name: 'Save answers' }).count()) {
    await page.getByRole('radio', { name: '18–64' }).click();
    const fs = page.locator('fieldset');
    for (let i = 1; i < (await fs.count()); i++) {
      const no = fs.nth(i).getByRole('radio', { name: 'no', exact: true });
      if (await no.count()) await no.first().click();
    }
    await page.getByRole('button', { name: 'Save answers' }).click();
    await sleep(2000);
  }
  log(`profile: ${page.url()}`);
  // sync on this browser against the server's relay; the person joins with the same owner secret
  await page.goto(`${BASE}/settings#sync`, { waitUntil: 'load' });
  const sync = page.locator('section#sync');
  await sync.getByLabel('sync server address').fill(BASE);
  await sync.getByRole('button', { name: 'Set up sync on this device' }).click();
  const words = page.locator('ol[aria-label="The 24 words"] li span:last-child');
  await words.first().waitFor({ timeout: 30000 });
  const phrase = (await words.allTextContents()).join(' ');
  check('sync set up against the server relay (24 words shown, not printed)', phrase.split(' ').length === 24);
  await sync.getByLabel("I've saved the words").check();
  await sync.getByRole('button', { name: 'Hide', exact: true }).click();
  await sleep(1500);
  log(`sync after setup: ${JSON.stringify(await tool('sync_status').catch((e) => e.message)).slice(0, 200)}`);
  await page.reload({ waitUntil: 'load' });
  await sleep(3000);
  log(`sync after a reload: ${JSON.stringify(await tool('sync_status').catch((e) => e.message)).slice(0, 200)}`);
  const secretHex = Buffer.from(mnemonicToEntropy(phrase, wordlist)).toString('hex');
  const added = await ctrl({ op: 'addPerson', label: 'Smoke', tz: 'Asia/Kolkata', secretHex });
  personId = added.id;
  check('server person added, joining the browser sync group', /^[0-9a-f]{16}$/.test(personId ?? ''), added.error ?? '');

  // ---- 5. pairing by code
  const { code } = await ctrl({ op: 'code', person: personId, label: 'Smoke browser' });
  await page.goto(`${BASE}/settings?section=server`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Enter code' }).first().click();
  await page.getByLabel('server address').first().fill(BASE);
  const first = page.getByLabel('first 4 digits');
  if (await first.count()) {
    await first.fill(code.slice(0, 4));
    await page.getByLabel('last 4 digits').fill(code.slice(4));
  } else {
    await page.getByLabel('pairing code').first().fill(code);
  }
  await page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
  await page.getByText(/Paired with/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
  const paired = await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('vitals.server.v1') || 'null')?.token));
  check('paired by code (device token stored on this device)', paired, await sectionText('section[aria-labelledby]'));
  await page.screenshot({ path: join(SHOTS, 'I3-smoke-server-1440.png') });

  // ---- 6. provider through the server: key on the server, preset chosen in Settings › Coach
  const keyStatus = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1'));
    const r = await fetch(`${s.baseUrl}/v1/ai/keys/opencode-zen`, { method: 'PUT', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'sk-smoke-stand-in-key-0001' }) });
    return r.status;
  });
  check('OpenCode Zen key set on the server (PUT /v1/ai/keys/opencode-zen)', keyStatus === 204, String(keyStatus));
  await page.goto(`${BASE}/settings/ai`, { waitUntil: 'load' });
  const radio = page.locator('input[type=radio][value="opencode-zen"]');
  await radio.waitFor({ state: 'attached' });
  await radio.evaluate((e) => e.click());
  await sleep(1000);
  const model = page.getByLabel(/^model$/i).first();
  if (await model.count()) {
    const tag = await model.evaluate((e) => e.tagName);
    if (tag === 'SELECT') {
      const opts = await model.locator('option').allTextContents();
      if (opts.some((o) => o.includes('fake-model'))) await model.selectOption({ label: 'fake-model' });
      else { await model.selectOption({ index: opts.length - 1 }); await sleep(300); }
    }
  }
  const other = page.getByLabel(/model id/i).first();
  if (await other.count()) await other.fill('fake-model');
  await page.getByRole('button', { name: 'Save provider' }).click();
  await sleep(1500);
  log(`Coach settings: ${(await page.locator('section').filter({ hasText: /via your server/ }).first().innerText().catch(() => '')).replace(/\s*\n\s*/g, ' | ').slice(0, 500)}`);

  // ---- 7. Coach message → tool call → document changed → reply
  const before = JSON.stringify(await tool('log_get', { from: today, to: today }));
  await page.goto(`${BASE}/coach`, { waitUntil: 'load' });
  const box = page.locator('textarea.lv-composer__field, input.lv-composer__field').first();
  if (!(await box.waitFor({ timeout: 15000 }).then(() => true, () => false))) log(`Coach page: ${await sectionText('main')}`);
  await box.fill('I walked a lot today');
  await box.press('Enter');
  const replied = await page.getByText(`Logged ${STEPS} steps for today.`).first().waitFor({ timeout: 45000 }).then(() => true, () => false);
  check('Coach reply streamed back through the server', replied, replied ? '' : await sectionText('main'));
  const after = JSON.stringify(await tool('log_get', { from: today, to: today }));
  check('the tool call changed a document (steps in today’s log)', !before.includes(String(STEPS)) && after.includes(String(STEPS)), after.slice(0, 200));
  check('the stand-in saw only the server (key added by the server)', seen.some((s) => s.url.endsWith('/chat/completions') && s.auth === 'present'));
  await page.screenshot({ path: join(SHOTS, 'I3-smoke-coach-1440.png') });

  // ---- 8. Lumen stream over MQTT → records in the browser
  const cred = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1'));
    const r = await fetch(`${s.baseUrl}/v1/mqtt/credentials`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: '{}' });
    return r.ok ? r.json() : { status: r.status };
  });
  check('broker login created for the person', typeof cred.username === 'string');
  const stream = readFileSync(join(ROOT, 'qa/fixtures/lumen/mqtt-stream.synthetic.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const client = await mqtt.connectAsync(`ws://127.0.0.1:${serverPort}/mqtt`, { username: cred.username, password: cred.password, reconnectPeriod: 0, protocolVersion: 4 });
  for (const m of stream) await client.publishAsync(m.topic, m.payload, { qos: 1 });
  await ctrl({ op: 'idle', person: personId });
  log(`published ${stream.length} messages`);
  log(`browser sync_status: ${JSON.stringify(await tool('sync_status').catch((e) => e.message)).slice(0, 300)}`);
  log(`agent tools here: ${await page.evaluate(() => Object.keys(window.__tools || {}).filter((n) => /sync|bio_|log_get/.test(n)).join(', '))}`);
  let got = 0;
  for (let i = 0; i < 30 && got < 1; i++) {
    await sleep(2000);
    got = await idbHas('bioRecords', '"steps":6400');
  }
  check('MQTT records reached the browser by sync (the fixture day’s 6,400 steps record)', got > 0, `bioRecords with it: ${got}`);
  const personLog = JSON.stringify(await ctrl({ op: 'dispatch', person: personId, command: 'log.get', input: { from: today, to: today } }));
  log(`diagnostics: browser bioRecords ${await idbHas('bioRecords', '')}, browser log entries ${await idbHas('logEntries', '')}; server person sees the Coach's ${STEPS} steps: ${personLog.includes(String(STEPS))}; health ${JSON.stringify(await (await fetch(`http://127.0.0.1:${serverPort}/health`)).json())}`);
  log(`tools offered to the model: ${seen.filter((x) => x.tools).at(-1)?.tools.length ?? 0}, with "correct": ${seen.filter((x) => x.tools).at(-1)?.tools.filter((n) => /correct/.test(n)).join(', ') || 'none'}`);

  // ---- 9. correction through the Coach wins over a replay
  await box.fill(`My steps on ${DAY} were really ${CORRECTED}`);
  await box.press('Enter');
  const apply = page.getByRole('button', { name: /^Apply/ }).first();
  const proposal = await apply.waitFor({ timeout: 45000 }).then(() => true, () => false);
  check('correction proposed by the Coach (proposal card)', proposal, proposal ? '' : await sectionText('main'));
  if (proposal) await apply.click();
  if (!proposal) {
    // fallback, reported as such: the same command through this page's agent surface
    const r = await tool('biometrics_correct', { target: { kind: 'daily', localDate: DAY, metric: 'steps' }, value: { fields: { steps: CORRECTED } } }).catch((e) => ({ error: e.message }));
    log(`correction through the page's agent surface instead: ${JSON.stringify(r).slice(0, 200)}`);
  }
  let corr = 0;
  for (let i = 0; i < 10 && corr < 1; i++) { await sleep(1500); corr = await idbHas('bioCorrections', String(CORRECTED)); }
  check('correction stored and synced (bioCorrections holds 7,777)', corr > 0);
  // replay: the same stream again, plus a newer device value for the same day
  const daily = stream.find((m) => m.topic.endsWith('/activity/daily'));
  const ev = JSON.parse(daily.payload);
  const newer = { ...ev, id: `${ev.id}-newer`, data: { ...ev.data, steps: 6999, received_at: '2026-09-15T08:00:00Z' } };
  for (const m of [...stream, { topic: daily.topic, payload: JSON.stringify(newer) }]) await client.publishAsync(m.topic, m.payload, { qos: 1 });
  await ctrl({ op: 'idle', person: personId });
  let newerArrived = 0;
  for (let i = 0; i < 20 && newerArrived < 1; i++) { await sleep(1500); newerArrived = await idbHas('bioRecords', '"steps":6999'); }
  check('the newer device value arrived by sync', newerArrived > 0);
  const day = await bioDay();
  log(`bio_daily on this device: ${day.slice(0, 400)}`);
  const onServer = await ctrl({ op: 'dispatch', person: personId, command: 'bio.daily', input: { from: DAY, to: DAY } });
  const serverDay = JSON.stringify(onServer.res ?? onServer);
  log(`bio.daily on the server person: ${serverDay.slice(0, 400)}`);
  // the steps stream is hidden from views until the person shares it (§4.5); share it as the person would in Settings
  const pol = await ctrl({ op: 'dispatch', person: personId, command: 'bio.setPolicy', input: { stream: 'steps', policy: { coach: 'daily' } }, source: 'ui' });
  log(`share steps on the server person: ${JSON.stringify(pol).slice(0, 160)}`);
  const res = JSON.stringify(await ctrl({ op: 'dispatch', person: personId, command: 'bio.daily', input: { from: DAY, to: DAY } }));
  check('after the replay and a newer device value the correction still wins (bio.daily on the server person)', new RegExp(`"steps":\\{"value":${CORRECTED},[^}]*"basis":"correction"`).test(res), res.slice(0, 400));
  await page.goto(`${BASE}/today`, { waitUntil: 'load' }).catch(() => undefined);
  await client.endAsync(true);
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
} finally {
  log(`browser errors (${errors.length}): ${errors.slice(0, 10).join(' || ')}`);
  log(`server log (last 15):\n  ${serverLog.slice(-15).join('\n  ')}`);
  await browser.close();
  await ctrl({ op: 'close' }).catch(() => undefined);
  srv.kill();
  proxy.close();
  standin.close();
  rmSync(join(REL, 'smoke-server.mjs'), { force: true });
  const failed = checks.filter((c) => !c.ok);
  log(`RESULT: ${checks.length - failed.length}/${checks.length} passed${failed.length ? `; failed: ${failed.map((c) => c.name).join('; ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}
