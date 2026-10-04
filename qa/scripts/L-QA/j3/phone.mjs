// J3 phone part (run ONLY through phone.sh, inside the ring + phone locks): C = the Vitals app on the phone (candidate
// APK), driven over its WebView's DevTools socket (adb forward to 127.0.0.1:9334), with the desktop app (A), the
// website (B) and the server person (S) as in run.mjs. The phone has no network switch for us (never a phone setting):
// it is an always-online replica plus force-stop/restart. Results: qa/results/L-QA/round2/j3/P-phone.json.
//   node qa/scripts/L-QA/j3/phone.mjs            (phone.sh has paired nothing yet: this script presses "Pair this device")
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CAND, ROOT, SERVER, TMP, busRead, ensurePreview, log, openApp, redact, sleep, tool, webmcpPolyfill } from './apps.mjs';
import { pairCode, revokeToken, state, token as newToken } from './server.mjs';
import { openReplica } from './harness/lib/replica.mjs';

const ADB = `${process.env.HOME}/.local/share/codex-android/sdk/platform-tools/adb`;
const PKG = 'desi.creative.vitals';
const { chromium } = createRequire(`${CAND}/package.json`)('playwright-core');
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', timeout: 60000 }).trim();
const focused = () => adb('shell', 'dumpsys', 'window').split('\n').filter((l) => l.includes('mCurrentFocus')).join(' ').includes(PKG);
const TZ = 'Asia/Kolkata';
const todayIn = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const day = (n) => {
  const d = new Date(`${todayIn()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const fmt = (ms) => (ms === null ? 'not within the limit' : `${(ms / 1000).toFixed(2)} s`);

const rows = [];
const timings = {};
const observed = {};
const check = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail: redact(String(detail)).slice(0, 500) });
  log(`${ok ? 'PASS' : 'FAIL'} phone: ${name} ${redact(String(detail)).slice(0, 300)}`);
};
const time = (n, ms) => (timings[n] = ms === null ? null : Math.round(ms));
const observe = (n, v) => {
  observed[n] = JSON.parse(redact(JSON.stringify(v ?? null)));
  log(`OBSERVED phone: ${n} = ${redact(JSON.stringify(v)).slice(0, 400)}`);
};

/** The phone replica over CDP. */
async function openPhone() {
  let browser = null;
  let page = null;
  const connect = async () => {
    if (!focused()) throw new Error('Vitals is not in front on the phone: stopping');
    const pid = adb('shell', 'pidof', PKG);
    adb('forward', 'tcp:9334', `localabstract:webview_devtools_remote_${pid}`);
    browser = await chromium.connectOverCDP('http://127.0.0.1:9334');
    const ctx = browser.contexts()[0];
    page = ctx.pages().find((p) => p.url().startsWith('https://localhost')) ?? ctx.pages()[0];
    page.setDefaultTimeout(30000);
    await ctx.addInitScript(webmcpPolyfill);
  };
  const go = async (route = '/') => {
    const u = new URL(route, 'https://localhost/');
    u.searchParams.set('qa', '1');
    await page.evaluate((h) => void (window.location.href = h), u.toString()).catch(() => undefined);
    await page.waitForLoadState('load').catch(() => undefined);
    await page.waitForFunction(() => !!window.__vitals, null, { timeout: 60000 });
    await sleep(500);
  };
  const ensureQa = async () => {
    if (!(await page.evaluate(() => !!window.__vitals && !!window.__tools).catch(() => false))) await go('/');
  };
  await connect();
  const self = {
    kind: 'phone',
    name: 'phone',
    get page() {
      return page;
    },
    go,
    ensureQa,
    async read(q) {
      await ensureQa();
      const out = await busRead(page, 'log.get', { from: q.date, to: q.date });
      const list = Array.isArray(out) ? out : (out.entries ?? []);
      return Object.fromEntries(list.map(({ id, ...rest }) => [id, rest]));
    },
    async write(cmd) {
      await ensureQa();
      const r = await tool(page, 'log_meal', { date: cmd.date, text: cmd.text, method: 'aiText', slot: 'snack', confidence: 0.8, components: [{ name: cmd.food ?? 'banana', grams: 100 }] });
      return { id: r?.data?.entryId ?? null, result: r };
    },
    syncStatus: async () => {
      await ensureQa();
      return busRead(page, 'sync.status', {});
    },
    async kill() {
      await browser?.close().catch(() => undefined);
      adb('shell', 'am', 'force-stop', PKG);
    },
    async restart() {
      adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
      await sleep(7000);
      await connect();
      await go('/');
    },
    close: () => browser?.close().catch(() => undefined),
  };
  return self;
}

async function visible(x, date, id, t0, timeoutMs) {
  const end = t0 + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await x.read({ col: 'dailyLogs', date }))[id]) return Date.now() - t0;
    } catch {}
    await sleep(x.kind === 'server' ? 1100 : 200);
  }
  return null;
}

const st = state();
const reps = [];
let tok = null;
const MODE = process.argv[2] ?? 'main';

/** Settings flows on the phone (taps through the WebView): leave the old sync group and forget the old server. */
async function prep() {
  const C = await openPhone();
  const page = C.page;
  const before = await C.syncStatus().catch((e) => ({ error: e.message }));
  observe('prep: sync status before', { paired: before.paired, enabled: before.enabled, state: before.state });
  if (before.paired) {
    await C.go('/settings#sync');
    if (!focused()) throw new Error('Vitals not in front');
    await page.getByRole('button', { name: 'Stop syncing on this device', exact: true }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stop syncing', exact: true }).click();
    await sleep(2500);
  }
  await C.go('/settings?section=server');
  const forget = page.locator('#server').getByRole('button', { name: 'Forget this server', exact: true });
  if (await forget.count()) {
    if (!focused()) throw new Error('Vitals not in front');
    await forget.first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Forget server', exact: true }).click();
    await sleep(2000);
  }
  const after = await C.syncStatus().catch((e) => ({ error: e.message }));
  const paired = await page.evaluate(() => !!localStorage.getItem('vitals.server.v1'));
  observe('prep: after (sync paired, server paired)', { sync: after.paired, server: paired });
  check('prep: the phone left its old sync group and server (Settings, not app data)', after.paired === false && !paired);
  await C.close();
}

/** Test 4: the phone reads the ring (Settings › Devices: Sync now / Connect); the night shows in the desktop app. */
async function ring() {
  const C = await openPhone();
  reps.push(C);
  const page = C.page;
  const A = await openApp('desktop', { name: 'desktop', dir: `${TMP}/r2j3/desktop` });
  reps.push(A);
  const srcA0 = await busRead(A.page, 'bio.sources', {}).catch((e) => ({ error: e.message }));
  const count = (x) => (Array.isArray(x) ? x.length : Array.isArray(x?.sources) ? x.sources.length : null);
  observe('ring: desktop bio sources before', count(srcA0));
  page.on('console', (m) => {
    const t = m.text();
    if (/ingestRingBatch|ring|error/i.test(t)) observed.ringConsole = [...(observed.ringConsole ?? []), redact(t).replace(/[0-9a-f]{12,}/gi, '<hex>').slice(0, 200)].slice(-12);
  });
  await C.go('/ring'); // round 2: the Ring page's connection card has "Sync now"
  await sleep(2500);
  let block = page.getByRole('main');
  if (!(await block.getByRole('button', { name: 'Sync now', exact: true }).count())) {
    await C.go('/settings?section=devices');
    await sleep(2500);
    block = page.getByRole('group', { name: 'rings' });
  }
  const text0 = (await block.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  observe('ring: Devices › rings before', text0);
  const t0 = Date.now();
  let btn = block.getByRole('button', { name: 'Sync now', exact: true });
  if (!(await btn.count())) btn = block.getByRole('button', { name: /^Connect/ });
  if (!(await btn.count())) btn = page.getByRole('button', { name: /^Connect J-Style/ });
  if (await btn.count()) {
    if (!focused()) throw new Error('Vitals not in front');
    await btn.first().click();
  } else observe('ring: no Sync now / Connect button', true);
  let toast = '';
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const t = await page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map((e) => e.textContent).join(' | '));
    if (t && t !== toast) {
      toast = t;
      log('ring toast', redact(t).slice(0, 200));
    }
    if (/added|imported|record|reading|failed|could not|not a function|error/i.test(t) && !/importing|connecting|syncing/i.test(t)) break;
  }
  time('ring: phone read (button → toast)', Date.now() - t0);
  observe('ring: toast / status text (no values)', redact(toast).replace(/\d+(\.\d+)?\s*(bpm|%|h|min)/g, '<v>').slice(0, 300));
  const srcC = await busRead(page, 'bio.sources', {}).catch((e) => ({ error: e.message }));
  observe('ring: phone bio sources after', count(srcC));
  const range = { from: day(1), to: day(0) };
  const dailyC = await busRead(page, 'bio.daily', range).catch((e) => ({ error: e.message }));
  const nights = (d) => (Array.isArray(d?.days) ? d.days : Array.isArray(d) ? d : []).filter((x) => x?.sleep).length;
  observe('ring: phone bio.daily days with a night (last 2 days)', nights(dailyC));
  let shown = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 90000) {
    const dA = await busRead(A.page, 'bio.daily', range).catch(() => null);
    const sA = await busRead(A.page, 'bio.sources', {}).catch(() => null);
    if (nights(dA) > 0 && (count(sA) ?? 0) > (count(srcA0) ?? 0)) {
      shown = Date.now() - t1;
      break;
    }
    await sleep(1500);
  }
  time('ring: phone read → desktop holds the night and the ring source', shown);
  check(`test 4: a ring night read by the phone shows in the desktop app (${fmt(shown)})`, shown !== null && nights(dailyC) > 0, JSON.stringify({ phoneNights: nights(dailyC), phoneSources: count(srcC) }));
  await A.go('/ring');
  const ui = (await A.page.evaluate(() => document.body.innerText).catch(() => '')).includes('J-Style');
  observe('ring: desktop /ring page names the J-Style ring', ui);
  await A.go('/signals');
  await sleep(2000);
  const sig = (await A.page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
  // no values: only whether the page shows a sleep night and the ring as a source
  observe('ring: desktop /signals (sleep shown, J-Style named, no-data text)', { sleep: /sleep/i.test(sig), jstyle: /J-Style/.test(sig), noData: /no (data|readings)|nothing yet/i.test(sig) });
}

try {
  if (MODE === 'prep') {
    await prep();
    throw null;
  }
  if (MODE === 'ring') {
    await ring();
    throw null;
  }
  await ensurePreview();
  const C = await openPhone();
  reps.push(C);
  // pairing: phone.sh opened the pairing link; press "Pair this device", answer the existing-data question with Merge
  const page = C.page;
  if (process.env.J3_PAIR_BY_CODE === '1') {
    // round 2: pair through Settings › Server by typing a CLI pairing code (and the server address the phone can reach,
    // read from a 0600 file; neither is printed)
    const code = await pairCode(st.personId, 'R2J3 phone');
    const addrFile = `${TMP}/r2j3/phone-server`;
    const address = fs.existsSync(addrFile) ? fs.readFileSync(addrFile, 'utf8').trim() : null;
    await C.go('/settings?section=server');
    if (!focused()) throw new Error('Vitals not in front');
    const enter = page.getByRole('button', { name: 'Enter code' });
    if (await enter.count()) await enter.first().click();
    const addr = page.getByLabel('server address').first();
    if (address && (await addr.isEditable().catch(() => false))) await addr.fill(address);
    await page.getByLabel('first 4 digits').fill(code.slice(0, 4));
    await page.getByLabel('last 4 digits').fill(code.slice(4));
    const n = page.getByLabel('name this device');
    if (await n.count()) await n.fill('R2J3 phone');
    if (!focused()) throw new Error('Vitals not in front');
    await page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
    observe('pairing', 'typed code in Settings › Server');
    const t = Date.now();
    let asked = null;
    while (Date.now() - t < 30000) {
      const dlg = page.getByRole('alertdialog');
      if (await dlg.count()) {
        asked = (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 200);
        if (!focused()) throw new Error('Vitals not in front');
        await dlg.first().getByRole('button', { name: 'Merge', exact: true }).click();
        break;
      }
      if ((await C.syncStatus().catch(() => ({})))?.paired) break;
      await sleep(400);
    }
    observe('existing-data question at pairing', asked);
  }
  const pairBtn = page.getByRole('button', { name: /^Pair this device$/ }).first();
  if (process.env.J3_PAIR_BY_CODE === '1') {
    // paired above
  } else if (await pairBtn.waitFor({ timeout: 20000 }).then(() => true, () => false)) {
    if (!focused()) throw new Error('Vitals not in front');
    await pairBtn.click();
    const t = Date.now();
    let asked = null;
    while (Date.now() - t < 30000) {
      const dlg = page.getByRole('alertdialog');
      if (await dlg.count()) {
        asked = (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 200);
        await dlg.first().getByRole('button', { name: 'Merge', exact: true }).click();
        break;
      }
      await sleep(400);
    }
    observe('existing-data question at pairing', asked);
  } else observe('pair button', 'not shown (already paired?)');
  let s = null;
  const tp = Date.now();
  for (let i = 0; i < 60; i++) {
    s = await C.syncStatus().catch((e) => ({ error: e.message }));
    if (s.paired && s.enabled && s.state === 'synced') break;
    await sleep(500);
  }
  check('phone: pairing turned sync on by itself (decision 5)', s?.paired === true && s?.enabled === true, `${Date.now() - tp} ms: ${JSON.stringify(s)}`);

  tok = await newToken(st.personId);
  const S = await openReplica('server', { name: 'server', serverBaseUrl: SERVER, token: tok.token });
  reps.push(S);
  const A = await openApp('desktop', { name: 'desktop', dir: `${TMP}/r2j3/desktop` });
  reps.push(A);
  const B = await openApp('browser', { name: 'website', dir: `${TMP}/r2j3/website` });
  reps.push(B);

  // history: every meal the earlier runs logged (days 0..5) is on the phone
  const days = [0, 1, 2, 3, 4, 5].map(day);
  let same = null;
  const th = Date.now();
  while (Date.now() - th < 60000) {
    same = {};
    for (const d of days) {
      const [a, c] = [Object.keys(await A.read({ col: 'dailyLogs', date: d })).sort(), Object.keys(await C.read({ col: 'dailyLogs', date: d })).sort()];
      same[d] = { desktop: a.length, phone: c.length, equal: JSON.stringify(a) === JSON.stringify(c) };
    }
    if (Object.values(same).every((v) => v.equal)) break;
    await sleep(2000);
  }
  time('phone catches up with the history (6 days)', Date.now() - th);
  check('phone holds every meal of days 0..5 that the desktop holds (history after pairing)', Object.values(same).every((v) => v.equal), JSON.stringify(same));

  // T2 phone: desktop online meal → phone within 5 s; phone meal → desktop, website, server within 5 s
  const d0 = day(0);
  let t0 = Date.now();
  const wa = await A.write({ op: 'logFood', date: d0, text: 'J3 P desktop banana', food: 'banana' });
  const pa = await visible(C, d0, wa.id, t0, 20000);
  time('T2 desktop → phone', pa);
  check(`T2: desktop meal on the phone within 5 s (${fmt(pa)})`, pa !== null && pa <= 5000);
  t0 = Date.now();
  const wc = await C.write({ date: d0, text: 'J3 P phone apple', food: 'cooked rice' });
  check('phone logged a meal (WebMCP tool in the WebView)', Boolean(wc.id), JSON.stringify(wc.result).slice(0, 160));
  const [ca, cb, cs] = await Promise.all([visible(A, d0, wc.id, t0, 20000), visible(B, d0, wc.id, t0, 20000), visible(S, d0, wc.id, t0, 20000)]);
  time('T2 phone → desktop', ca);
  time('T2 phone → website', cb);
  time('T2 phone → server', cs);
  check(`T2: phone meal on desktop, website, server within 5 s (${fmt(ca)}, ${fmt(cb)}, ${fmt(cs)})`, [ca, cb, cs].every((x) => x !== null && x <= 5000));

  // T1 phone: desktop offline meal → phone within 30 s of reconnecting
  const d1 = day(1);
  await A.goOffline();
  await sleep(1500);
  const wo = await A.write({ op: 'logFood', date: d1, text: 'J3 P desktop offline banana', food: 'banana' });
  await sleep(15000);
  check('T1: while the desktop is offline its meal is not on the phone', !(await C.read({ col: 'dailyLogs', date: d1 }))[wo.id]);
  t0 = Date.now();
  await A.goOnline();
  const po = await visible(C, d1, wo.id, t0, 60000);
  time('T1 desktop online → phone', po);
  check(`T1: desktop offline meal on the phone within 30 s of reconnecting (${fmt(po)})`, po !== null && po <= 30000);

  // T3 phone: MCP meal → phone within 5 s
  const d2 = day(2);
  t0 = Date.now();
  const wm = await S.write({ op: 'logFood', date: d2, text: 'J3 P mcp boiled egg', food: 'boiled egg' });
  const mid = wm.result?.data?.entryId;
  const pm = mid ? await visible(C, d2, mid, t0, 20000) : null;
  time('T3 server MCP → phone', pm);
  check(`T3: the MCP meal on the phone within 5 s (${fmt(pm)})`, pm !== null && pm <= 5000);

  // T6 phone: force-stop mid-sync (a burst from the desktop arriving), restart: nothing lost; a phone write just before
  // the force-stop reaches everyone
  const d3 = day(3);
  const ids = [];
  for (let i = 0; i < 8; i++) {
    const w = await A.write({ op: 'logFood', date: d3, text: `J3 P burst ${i + 1}`, food: 'cooked rice' });
    if (w.id) ids.push(w.id); // the bus caps WebMCP writes per tool per turn: count only writes that made an entry
  }
  observe('T6: burst writes that made an entry (of 8)', ids.length);
  const wk = await C.write({ date: d3, text: 'J3 P phone before force-stop', food: 'banana' });
  await sleep(100);
  const held = Object.keys(await C.read({ col: 'dailyLogs', date: d3 })).filter((k) => ids.includes(k)).length;
  if (!focused()) throw new Error('Vitals not in front before force-stop');
  await C.kill();
  observe('T6: burst meals on the phone at force-stop (of 8)', held);
  const tr = Date.now();
  await C.restart();
  let all = null;
  while (Date.now() - tr < 60000) {
    const d = await C.read({ col: 'dailyLogs', date: d3 }).catch(() => ({}));
    if (ids.every((id) => d[id]) && d[wk.id]) {
      all = Date.now() - tr;
      break;
    }
    await sleep(500);
  }
  time('T6 phone restart → all 8 burst meals + its own', all);
  check(`T6: phone force-stopped mid-sync, restarted: all 8 burst meals and its own write are there (${fmt(all)})`, all !== null);
  t0 = Date.now();
  const [ka, ks] = await Promise.all([visible(A, d3, wk.id, t0, 45000), visible(S, d3, wk.id, t0, 45000)]);
  check(`T6: the phone's write from just before the force-stop reaches the desktop and the server (${fmt(ka)}, ${fmt(ks)})`, ka !== null && ks !== null);
  for (const x of [A, B, C]) observe(`${x.name} sync status at the end`, await x.syncStatus().catch((e) => e.message));
  fs.writeFileSync(`${TMP}/r2j3/phone-ok`, new Date().toISOString());
} catch (e) {
  if (e !== null) check(`phone ${MODE} error`, false, e.stack ?? e.message);
} finally {
  for (const x of reps) await x.close().catch(() => undefined);
  if (tok) log(`agent token revoked: ${await revokeToken(st.personId, tok.id).catch((e) => e.message)}`);
  const failed = rows.filter((r) => !r.ok).length;
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/round2/j3/P-phone-${MODE}.json`, JSON.stringify({ test: `P-phone-${MODE}`, at: new Date().toISOString(), replicas: { C: 'phone app (candidate APK, real device, always online; force-stop for kill)', A: 'desktop app (real)', B: 'website (real)', S: 'server person (real, MCP)' }, passed: rows.length - failed, failed, timingsMs: timings, observed, checks: rows }, null, 1) + '\n');
}
process.exit(0);
