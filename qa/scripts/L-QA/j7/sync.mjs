// J7 step 3: two (then three) browser contexts paired to one server test person L-QA-R2J7-<hhmm>. Secrets (codes, tokens) stay in memory.
// The page is served at https://localhost (an origin the server allows) by routing it to the local dev server.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chromium, newPage, bootApp, install, shot, goRoute, rec, save, repo } from './lib.mjs';
import { startProxy } from './proxy.mjs';
import { onboard } from '../j1/onboard.mjs';
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'qa', 'local.config.json'), 'utf8'));
const SERVER = cfg.serverUrl.replace(/\/$/, ''), SSH = cfg.serverSsh;
const VS = 'node ~/vitals-server/current/bin/vitals-server.mjs';
const ssh = (cmd) => new Promise((res) => execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SSH, cmd], { timeout: 60000 }, (e, o, er) => res({ code: e ? 1 : 0, out: String(o), err: String(er) })));
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
const LABEL = `L-QA-R2J7-${hhmm}`;
let personId = null, tokenId = null; const log = [];
const L = (m) => { console.log(m); log.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cleanup() {
  try {
    if (!personId) return;
    const list = (await ssh(`${VS} persons list`)).out;
    const mine = list.split('\n').find((l) => l.startsWith(personId) && l.includes(LABEL));
    if (!mine) { L('cleanup: person not found / label mismatch, nothing removed'); return; }
    if (tokenId) await ssh(`${VS} agent-token revoke ${personId} '${tokenId}'`);
    const r = await ssh(`${VS} persons remove ${personId}`);
    const after = (await ssh(`${VS} persons list`)).out;
    L(`cleanup: removed ${LABEL}: ${r.out.trim().slice(0, 80)}; still listed=${after.includes(personId)}`);
  } catch (e) { L('cleanup error ' + String(e.message).slice(0, 100)); }
}
const WS = createRequire(path.join(repo, '.e6-tmp', 'cand', 'node_modules', '.pnpm', 'ws@8.22.0', 'node_modules', 'ws', 'package.json'))('./index.js');
const mcpReq = createRequire(path.join(repo, '.e6-tmp', 'cand', 'packages', 'companion', 'package.json'));
async function mcp(token) {
  const { Client } = await import(pathToFileURL(mcpReq.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(mcpReq.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);
  const c = new Client({ name: 'qa-j7', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${SERVER}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return { tools: async () => (await c.listTools()).tools.map((t) => t.name), call: async (n, a = {}) => { const r = await c.callTool({ name: n, arguments: a }); const t = r.content?.[0]?.text ?? '{}'; try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }, close: () => c.close().catch(() => {}) };
}
const PROXY = process.env.J7_MODE === 'proxy';
const proxySrv = PROXY ? await startProxy(SERVER, 4338, 'http://127.0.0.1:4337') : null;
const PADDR = 'http://127.0.0.1:4338';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermissionPolicy,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'] });
async function device(name) {
  const { ctx, page, errs } = await newPage(browser);
  if (PROXY) { /* the app talks to the loopback relay, nothing to route */ } else if (process.env.J7_MODE === 'direct') {
    // page stays on the dev server origin; the server's requests are re-sent with the allowed origin and CORS headers added
    const allow = { 'access-control-allow-origin': 'http://127.0.0.1:4337', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*', 'access-control-max-age': '600' };
    // the relay's WebSocket is re-opened from node with the allowed origin and the frames are passed both ways
    await ctx.routeWebSocket(/.*/, (ws) => {
      const u = ws.url();
      if (!u.startsWith('wss://' + new URL(SERVER).host) && !u.startsWith('ws://' + new URL(SERVER).host)) { ws.connectToServer(); return; }
      const up = new WS(u, { origin: 'https://localhost' }); const q = [];
      up.on('open', () => { for (const m of q.splice(0)) up.send(m); });
      up.on('message', (d, bin) => ws.send(bin ? d : d.toString()));
      up.on('close', (c, r) => ws.close({ code: c === 1005 ? 1000 : c, reason: String(r) }).catch?.(() => {}));
      up.on('error', () => ws.close({ code: 1011 }));
      ws.onMessage((m) => (up.readyState === 1 ? up.send(m) : q.push(m)));
      ws.onClose(() => { try { up.close(); } catch {} });
    });
    await ctx.route(SERVER + '/**', async (route) => {
      const rq = route.request();
      if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: allow });
      try { const r = await route.fetch({ headers: { ...rq.headers(), origin: 'https://localhost' } }); await route.fulfill({ response: r, headers: { ...r.headers(), ...allow } }); } catch { await route.abort(); }
    });
  } else await ctx.route('https://localhost/**', async (route) => {
    const u = new URL(route.request().url());
    try { const r = await route.fetch({ url: 'http://127.0.0.1:4337' + u.pathname + u.search }); await route.fulfill({ response: r }); } catch { await route.abort(); }
  });
  const ORIGIN = (process.env.J7_MODE === 'direct' || PROXY) ? 'http://127.0.0.1:4337' : 'https://localhost';
  const go = async (p) => { await page.goto(ORIGIN + p, { waitUntil: 'load' }); await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60000 }); await page.waitForFunction(() => document.querySelectorAll('button, a[href]').length > 0, null, { timeout: 90000 }).catch(() => {}); };
  await go('/'); await onboard(page, () => {}); await go('/'); await install(page);
  return { name, ctx, page, go, errs };
}
async function pair(d, code) {
  await d.go('/settings?section=server');
  const enter = d.page.getByRole('button', { name: 'Enter code' });
  await enter.first().waitFor({ timeout: 60000 }).catch(() => {});
  if (await enter.count()) await enter.first().click();
  const addr = d.page.getByLabel('server address').first();
  if (await addr.isEditable().catch(() => false)) await addr.fill(PROXY ? PADDR : SERVER);
  await d.page.getByLabel('first 4 digits').fill(code.slice(0, 4));
  await d.page.getByLabel('last 4 digits').fill(code.slice(4));
  await d.page.getByLabel('name this device').fill(d.name).catch(() => {});
  await d.page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
  let asked = null;
  for (let t = Date.now(); Date.now() - t < 40000;) {
    const dlg = d.page.getByRole('alertdialog');
    if (await dlg.count()) { asked = (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 160); await dlg.first().getByRole('button', { name: 'Merge', exact: true }).click(); break; }
    const st = await d.page.evaluate(async () => { const m = await import('/src/commands/index.ts'); const r = await m.dispatch('sync.status', {}); return r.ok ? r.output : null; }).catch(() => null);
    if (st?.paired) break;
    await sleep(400);
  }
  for (let t = Date.now(); Date.now() - t < 25000;) { const q = await d.page.evaluate(async () => { const m = await import('/src/commands/index.ts'); const r = await m.dispatch('sync.status', {}); return r.ok ? r.output : null; }).catch(() => null); if (q?.paired) break; await sleep(500); }
  await sleep(1000);
  if (process.env.J7_DEBUG) { const t = (await d.page.innerText('body')).replace(/\s+/g, ' '); const i = t.indexOf('Pair'); console.log('DEBUG page text near pair:', t.split(SERVER).join('<server>').slice(Math.max(0, t.indexOf('Enter code') - 200), t.indexOf('Enter code') + 600)); console.log('DEBUG errs', JSON.stringify(d.errs.map((x) => x.split(SERVER).join('<server>')).slice(-5))); await shot(d.page, 'pair-debug.png'); }
  const st = await d.page.evaluate(async () => { const m = await import('/src/commands/index.ts'); const r = await m.dispatch('sync.status', {}); return r.ok ? r.output : r.error; });
  return { asked, paired: !!st?.paired, status: JSON.stringify(st).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) };
}
const ensure = async (d) => { for (let i = 0; i < 3; i++) { try { await d.page.waitForLoadState('load'); await d.page.waitForFunction(() => document.querySelectorAll('button').length > 0, null, { timeout: 60000 }).catch(() => {}); if (!(await d.page.evaluate(() => !!window.__j7?.ready))) await install(d.page); return; } catch { await sleep(1500); } } };
const state = async (d) => { await ensure(d); return d.page.evaluate(() => __j7.sources().then((s) => ({ sharing: s.ringSharing, n: s.sources.length }))); };
async function until(fn, ms = 90000, step = 500) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return { ms: Date.now() - t0, v }; if (Date.now() - t0 > ms) return { ms: null, v: null }; await sleep(step); } }
let A, B, C, srv;
try {
  const add = await ssh(`${VS} persons add '${LABEL}' --tz Asia/Kolkata`);
  personId = add.out.match(/([0-9a-f]{16})\s+L-QA-R2J7-/)?.[1];
  if (!personId) throw new Error('persons add failed ' + add.err.slice(0, 100));
  const tk = await ssh(`${VS} agent-token create ${personId} --client claude --scope read --label 'L-QA-R2J7'`);
  const ls = tk.out.split('\n'); const i = ls.findIndex((l) => /shown only once/.test(l));
  tokenId = ls[i]?.match(/, id ([^\s]+?)\. It is shown/)?.[1]; const token = ls[i + 1]?.trim();
  const code = async (lab) => (await ssh(`${VS} pair code ${personId} --label '${lab}'`)).out.match(/Code (\d{8})/)?.[1];
  L(`person ${LABEL} created (id withheld); token id set=${!!tokenId}`);
  srv = await mcp(token);
  const tools = await srv.tools(); L('server MCP tools: ' + tools.length + ' ' + tools.filter((t) => /bio|brief|score|ring|daily|series|source/i.test(t)).join(','));
  A = await device('J7 A'); B = null;
  const pa = await pair(A, await code('J7 A')); await ensure(A); L('A pair: ' + JSON.stringify(pa));
  rec('Y0 origin: app at https://localhost pairs with the server (http://127.0.0.1 itself is refused 403)', pa.paired ? 'PASS' : 'FAIL', JSON.stringify(pa));
  if (!pa.paired) throw new Error('A not paired');
  const r1 = await A.page.evaluate(() => __j7.ring('jstyle2301', 'QA0101')); L('A ring: ' + JSON.stringify(r1));
  await A.page.waitForTimeout(3000);
  B = await device('J7 B');
  const pb = await pair(B, await code('J7 B')); await ensure(B); L('B pair: ' + JSON.stringify(pb));
  const gotB = await until(async () => (await state(B)).n > 0 && (await state(B)));
  rec('Y1 ring source and its default policies reach device B after pairing', gotB.v && gotB.v.sharing === 'on' ? 'PASS' : 'FAIL', `B state=${JSON.stringify(gotB.v)} after ${gotB.ms} ms (incl. pairing wait)`);
  await B.page.waitForTimeout(9000);
  const bBase = await B.page.evaluate(() => __j7.coachAndMcp());
  const srvTools = tools.filter((t) => /daily|series|score|briefing/i.test(t));
  const srvRead = async () => { const out = {}; for (const t of srvTools) { try { const T = new Date().toISOString().slice(0, 10); const Y = new Date(Date.now() - 864e5).toISOString().slice(0, 10); const args = /series/.test(t) ? { metric: 'hr', from: Y, to: T } : /daily/.test(t) ? { from: Y, to: T } : {}; out[t] = JSON.stringify(await srv.call(t, args)); } catch (e) { out[t] = 'err ' + String(e.message).slice(0, 80); } } return out; };
  const hasRing = (o) => Object.values(o).some((v) => /J-Style|asleepH|"sleep"|hr\.rhr|sleep\.tst/.test(v) && !/hidden/.test(v.slice(0, 40)));
  let sBase = await srvRead(); save('y-server-base.json', Object.fromEntries(Object.entries(sBase).map(([k, v]) => [k, v.slice(0, 300)])));
  L('server tools used: ' + srvTools.join(','));
  rec('Y2 device B (second device) shows ring data in its briefing/MCP-actor reads from the synced defaults', bBase.briefingMentionsRing && bBase.mcpDailyDays.some((d) => d.sleep) ? 'PASS' : 'FAIL', `B briefing=${bBase.briefingMentionsRing} daily=${JSON.stringify(bBase.mcpDailyDays)}`);
  // ---- A switches the master off
  const t0 = Date.now();
  await A.page.evaluate(() => __j7.dispatch('bio.setRingSharing', { on: false }));
  const gotOffB = await until(async () => (await state(B)).sharing === 'off' && true, 120000, 400);
  const bOff = await B.page.evaluate(() => __j7.coachAndMcp());
  const srvOff = await until(async () => { const o = await srvRead(); return !hasRing(o) ? o : null; }, 120000, 1500);
  save('y-offs.json', { bOff, serverStillShows: srvOff.v ? false : true });
  rec('Y3 master off on A: B shows off within one sync', gotOffB.ms !== null ? 'PASS' : 'FAIL', `B ringSharing off after ${gotOffB.ms} ms; B briefing mentions ring=${bOff.briefingMentionsRing} daily=${JSON.stringify(bOff.mcpDailyDays)}`);
  rec('Y3b server MCP read tools stop showing ring data after A turns master off', srvOff.ms !== null ? 'PASS' : 'FAIL', `server tools [${srvTools.join(',')}]; ring gone from reads after ${srvOff.ms} ms (baseline had ring data: ${hasRing(sBase)})`);
  // ---- B turns it on again, A follows
  await B.page.evaluate(() => __j7.dispatch('bio.setRingSharing', { on: true }));
  const gotOnA = await until(async () => (await state(A)).sharing === 'on', 120000, 400);
  const srvOn = await until(async () => { const o = await srvRead(); return hasRing(o) ? o : null; }, 120000, 1500);
  rec('Y4 master on from B: A and the server follow', gotOnA.ms !== null && srvOn.ms !== null ? 'PASS' : 'FAIL', `A on after ${gotOnA.ms} ms; server shows ring again after ${srvOn.ms} ms`);
  // ---- A off, then a THIRD device joins: choice survives, migration does not flip it
  await A.page.evaluate(() => __j7.dispatch('bio.setRingSharing', { on: false })); await sleep(3000);
  C = await device('J7 C');
  const pc = await pair(C, await code('J7 C')); await ensure(C); L('C pair: ' + JSON.stringify(pc));
  await until(async () => (await state(C)).n > 0, 90000, 500);
  await C.page.reload({ waitUntil: 'load' }); await C.page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0); await C.page.waitForTimeout(10000); await install(C.page);
  const sC = await state(C); const cm = await C.page.evaluate(() => __j7.coachAndMcp()); const sA = await state(A);
  const srvAfter = await srvRead();
  rec('Y5 a device that joins after master off keeps it off (policies survive a second device joining; migration does not flip them)', sC.sharing === 'off' && !cm.briefingMentionsRing && sA.sharing === 'off' && !hasRing(srvAfter) ? 'PASS' : 'FAIL', `C=${JSON.stringify(sC)} C briefing ring=${cm.briefingMentionsRing} A=${sA.sharing} server shows ring=${hasRing(srvAfter)}`);
  await shot(C.page, 'y5-device-c-devices.png');
} catch (e) { L('ERROR ' + String(e.stack || e).split(SERVER).join('<server>').slice(0, 500)); rec('Y-run', 'FAIL', String(e.message).slice(0, 200)); }
finally {
  await srv?.close?.(); await browser.close(); proxySrv?.close(); await cleanup();
  save('y-log.txt', log.join('\n').split(SERVER).join('<server>'));
}
