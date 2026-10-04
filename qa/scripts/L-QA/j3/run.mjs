// J3 binding tests with the real apps (plan 04 item 3 "Tests (binding)"): A = the candidate desktop app (Electron),
// B = the candidate website build in Chromium (site origin served locally), S = the test person on the real server
// (MCP, agent token, scope log). Both apps sit behind their own switchable CONNECT proxy: goOffline() cuts every socket
// to the server. Run qa/scripts/L-QA/j3/setup.mjs first (pairs both apps to the person). Results: qa/results/L-QA/j3/T*.json.
//   node qa/scripts/L-QA/j3/run.mjs [T2 T1 T3 T5 T6]     J3_OFFLINE_S=30 (T1's offline period)
import fs from 'node:fs';
import { ROOT, TMP, ensurePreview, log, openApp, redact, sleep, SERVER } from './apps.mjs';
import { revokeToken, state, token as newToken } from './server.mjs';
import { openReplica } from './harness/lib/replica.mjs';

const OFFLINE_S = Number(process.env.J3_OFFLINE_S ?? 30);
const TZ = 'Asia/Kolkata';
const todayIn = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const day = (n) => {
  const d = new Date(`${todayIn()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const fmt = (ms) => (ms === null ? 'not within the limit' : `${(ms / 1000).toFixed(2)} s`);
const used = new Set();

function results(test, meta = {}) {
  const rows = [];
  const timings = {};
  const observed = {};
  return {
    check(name, ok, detail = '') {
      rows.push({ name, ok: Boolean(ok), detail: redact(String(detail ?? '')).slice(0, 500) });
      log(`${ok ? 'PASS' : 'FAIL'} ${test}: ${name}${detail ? ` (${String(detail).slice(0, 300)})` : ''}`);
      return Boolean(ok);
    },
    time(name, ms) {
      timings[name] = ms === null ? null : Math.round(ms);
      return ms;
    },
    observe(name, v) {
      observed[name] = JSON.parse(redact(JSON.stringify(v ?? null)));
      log(`OBSERVED ${test}: ${name} = ${redact(JSON.stringify(v))}`);
    },
    save(extra = {}) {
      const failed = rows.filter((r) => !r.ok).length;
      const out = { test, at: new Date().toISOString(), replicas: { A: 'desktop app (candidate Electron, real)', B: 'website (candidate web build in Chromium, real)', S: 'server person (real server, MCP agent token)' }, ...meta, passed: rows.length - failed, failed, timingsMs: timings, observed, ...extra, checks: rows };
      fs.mkdirSync(`${ROOT}/qa/results/L-QA/j3`, { recursive: true });
      fs.writeFileSync(`${ROOT}/qa/results/L-QA/j3/${test}.json`, JSON.stringify(out, null, 1) + '\n');
      return out;
    },
  };
}

async function visible(x, date, pred, t0, timeoutMs = 30000) {
  const step = x.kind === 'server' ? 1100 : 150;
  const end = t0 + timeoutMs;
  while (Date.now() < end) {
    let docs = null;
    try {
      docs = await x.read({ col: 'dailyLogs', date });
    } catch {}
    if (docs && pred(docs)) return Date.now() - t0;
    await sleep(step);
  }
  return null;
}
const has = (id) => (d) => Boolean(d[id]);

async function converge(r, reps, dates, timeoutMs = 45000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const sets = {};
    try {
      for (const x of reps) {
        sets[x.name] = [];
        for (const d of dates) sets[x.name].push(...Object.keys(await x.read({ col: 'dailyLogs', date: d })));
        sets[x.name].sort();
      }
      const ref = JSON.stringify(sets[reps[0].name]);
      last = { ok: reps.every((x) => JSON.stringify(sets[x.name]) === ref), counts: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length])) };
      if (last.ok) break;
    } catch (e) {
      last = { ok: false, error: e.message };
    }
    await sleep(2000);
  }
  r.check(`convergence: the same food entries for ${dates.join(', ')} on ${reps.map((x) => x.name).join(', ')}`, last?.ok, JSON.stringify(last));
  return last?.ok;
}

/** Person-visible: the meal text shows on the app's Today page (the UI, not the bus). */
async function inUi(x, text, route = '/') {
  await x.go(route);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const body = await x.page.evaluate(() => document.body.innerText).catch(() => '');
    if (body.toLowerCase().includes(text.toLowerCase())) return true;
    await sleep(500);
  }
  return false;
}

/* --------------------------------------------------------------------------------------------- tests */

async function T2({ A, B, S }) {
  const r = results('T2-online', { plan: 'item 3: the same food logged online appears everywhere within 5 s' });
  const date = day(0);
  used.add(date);
  const t0 = Date.now();
  const w = await A.write({ op: 'logFood', date, text: 'J3 T2 desktop moong dal', food: 'moong dal' });
  r.check('A (desktop) logged a meal through the app WebMCP tools (in-page command bus)', Boolean(w.id), JSON.stringify(w.result).slice(0, 200));
  r.time('A write call', Date.now() - t0);
  if (w.id) {
    const [b, s] = await Promise.all([visible(B, date, has(w.id), t0, 15000), visible(S, date, has(w.id), t0, 15000)]);
    r.time('A→B (website)', b);
    r.time('A→S (server)', s);
    r.check(`desktop meal on the website within 5 s (${fmt(b)})`, b !== null && b <= 5000);
    r.check(`desktop meal on the server within 5 s (${fmt(s)})`, s !== null && s <= 5000);
  }
  const t1 = Date.now();
  const w2 = await B.write({ op: 'logFood', date, text: 'J3 T2 website cooked rice', food: 'cooked rice' });
  r.check('B (website) logged a meal through the app WebMCP tools (in-page command bus)', Boolean(w2.id), JSON.stringify(w2.result).slice(0, 200));
  if (w2.id) {
    const [a, s] = await Promise.all([visible(A, date, has(w2.id), t1, 15000), visible(S, date, has(w2.id), t1, 15000)]);
    r.time('B→A (desktop)', a);
    r.time('B→S (server)', s);
    r.check(`website meal on the desktop within 5 s (${fmt(a)})`, a !== null && a <= 5000);
    r.check(`website meal on the server within 5 s (${fmt(s)})`, s !== null && s <= 5000);
  }
  // person-visible: each meal on the other device's Today page
  r.check('person-visible: the website meal shows on the desktop app\'s Food page (/food/<date>)', await inUi(A, 'cooked rice', `/food/${date}`));
  r.check('person-visible: the desktop meal shows on the website\'s Food page (/food/<date>)', await inUi(B, 'moong dal', `/food/${date}`));
  await converge(r, [A, B, S], [date]);
  return r.save();
}

async function T1({ A, B, S }) {
  const r = results('T1-offline', { plan: 'item 3: food logged on the desktop while OFFLINE appears on the server, phone and website within 30 s of reconnecting', offlineSeconds: OFFLINE_S, cut: 'desktop relay through a switchable CONNECT proxy (--proxy-server); every socket to the server destroyed and refused' });
  const date = day(1);
  used.add(date);
  await A.goOffline();
  await sleep(1500);
  r.observe('A sync status 1.5 s after the cut', await A.syncStatus().catch((e) => e.message));
  const wa = await A.write({ op: 'logFood', date, text: 'J3 T1 desktop offline upma', food: 'banana' });
  const wb = await B.write({ op: 'logFood', date, text: 'J3 T1 website meanwhile idli', food: 'cooked rice' });
  r.check('A logged a meal while offline; B logged one meanwhile', Boolean(wa.id && wb.id), JSON.stringify({ a: wa.result?.status ?? wa.result?.ok, b: wb.result?.status ?? wb.result?.ok }));
  log(`T1: desktop offline for ${OFFLINE_S} s`);
  await sleep(OFFLINE_S * 1000);
  r.observe('A sync status while offline', await A.syncStatus().catch((e) => e.message));
  const leaked = (await B.read({ col: 'dailyLogs', date }))[wa.id] || (await S.read({ col: 'dailyLogs', date }))[wa.id];
  r.check("while A is offline its meal reaches nobody (the cut is real)", !leaked);
  r.check("while A is offline it does not have B's meal", !(await A.read({ col: 'dailyLogs', date }))[wb.id]);
  const t0 = Date.now();
  await A.goOnline();
  const [b, s, back] = await Promise.all([visible(B, date, has(wa.id), t0, 60000), visible(S, date, has(wa.id), t0, 60000), visible(A, date, has(wb.id), t0, 60000)]);
  r.time('A online → on B (website)', b);
  r.time('A online → on S (server)', s);
  r.time('A online → B\'s meal on A', back);
  r.check(`desktop offline meal on the website within 30 s of reconnecting (${fmt(b)})`, b !== null && b <= 30000);
  r.check(`desktop offline meal on the server within 30 s (${fmt(s)})`, s !== null && s <= 30000);
  r.check(`the desktop gets the website's meanwhile meal within 30 s (${fmt(back)})`, back !== null && back <= 30000);
  r.observe('A tunnels opened so far (reconnects)', A.proxy.tunnels);
  await converge(r, [A, B, S], [date]);
  return r.save();
}

async function T3({ A, B, S }) {
  const r = results('T3-mcp', { plan: 'item 3: a meal logged through MCP by an AI appears on all devices' });
  const date = day(2);
  used.add(date);
  const t0 = Date.now();
  const w = await S.write({ op: 'logFood', date, text: 'J3 T3 boiled egg', food: 'boiled egg' });
  const id = w.result?.data?.entryId;
  r.check('log_meal through the server MCP (agent token, scope log) logged an entry', w.result?.data?.status === 'logged' && Boolean(id), JSON.stringify(w.result).slice(0, 200));
  if (id) {
    const [a, b] = await Promise.all([visible(A, date, has(id), t0, 20000), visible(B, date, has(id), t0, 20000)]);
    r.time('server → A (desktop)', a);
    r.time('server → B (website)', b);
    r.check(`the MCP meal on the desktop within 5 s (${fmt(a)})`, a !== null && a <= 5000);
    r.check(`the MCP meal on the website within 5 s (${fmt(b)})`, b !== null && b <= 5000);
  }
  await converge(r, [A, B, S], [date]);
  return r.save({ entryId: id ?? null });
}

async function T5({ A, B, S }) {
  const r = results('T5-fields', { plan: 'item 3: two devices editing different fields offline merge' });
  const q = { col: 'settings', id: 'me' };
  const t0 = Date.now();
  const base = await A.write({ op: 'patch', col: 'settings', fields: { units: 'metric', energyUnit: 'kcal' } });
  r.observe('baseline write on A', JSON.stringify(base.result).slice(0, 160));
  const isBase = (d) => d.me?.units === 'metric' && d.me?.energyUnit === 'kcal';
  const seen = async (x, pred, t, ms) => {
    const end = t + ms;
    while (Date.now() < end) {
      try {
        if (pred(await x.read(q))) return Date.now() - t;
      } catch {}
      await sleep(x.kind === 'server' ? 1100 : 200);
    }
    return null;
  };
  const b0 = await Promise.all([B, S].map((x) => seen(x, isBase, t0, 20000)));
  r.check('baseline (metric, kcal) on the website and the server', b0.every((x) => x !== null), b0.map(fmt).join(', '));
  const round = async (label, first, second, f1, f2) => {
    await first.goOffline();
    await second.goOffline();
    await sleep(1000);
    const w1 = await first.write({ op: 'patch', col: 'settings', fields: f1 });
    const w2 = await second.write({ op: 'patch', col: 'settings', fields: f2 });
    r.observe(`${label} writes`, { first: JSON.stringify(w1.result).slice(0, 120), second: JSON.stringify(w2.result).slice(0, 120) });
    await sleep(2000);
    const t1 = Date.now();
    await first.goOnline();
    await sleep(3000);
    await second.goOnline();
    const want = { ...f1, ...f2 };
    const both = (d) => Object.entries(want).every(([k, v]) => d.me?.[k] === v);
    const s = await Promise.all([A, B, S].map((x) => seen(x, both, t1, 45000)));
    s.forEach((ms, i) => r.time(`${label}: both edits on ${[A, B, S][i].name}`, ms));
    r.check(`${label}: ${first.name} sets ${Object.keys(f1)} and ${second.name} sets ${Object.keys(f2)} offline, ${first.name} online first: both edits on desktop, website and server`, s.every((x) => x !== null), s.map(fmt).join(', '));
    if (!s.every((x) => x !== null)) r.observe(`${label}: settings seen`, Object.fromEntries(await Promise.all([A, B, S].map(async (x) => [x.name, await x.read(q).then((d) => ({ units: d.me?.units, energyUnit: d.me?.energyUnit }), (e) => e.message)]))));
  };
  await round('round 1', A, B, { units: 'imperial' }, { energyUnit: 'kJ' });
  await round('round 2', B, A, { units: 'metric' }, { energyUnit: 'kcal' });
  return r.save();
}

async function T6({ A, B, S }) {
  const r = results('T6-kill-restart', { plan: 'item 3: kill-and-restart of each client mid-sync loses nothing', kills: 'desktop: SIGKILL of the Electron main process; website: SIGKILL of the Chromium browser process' });
  const date = day(3);
  used.add(date);
  // (a) the desktop writes while cut off and is SIGKILLed 100 ms after the write resolved; then 0 ms
  for (const delay of [100, 0]) {
    await A.goOffline();
    await sleep(800);
    const w = await A.write({ op: 'logFood', date, text: `J3 T6 desktop killed ${delay} ms`, food: 'boiled egg' });
    await sleep(delay);
    await A.kill();
    const tr = Date.now();
    await A.restart();
    r.time(`desktop restart after kill (${delay} ms)`, Date.now() - tr);
    const kept = Boolean((await A.read({ col: 'dailyLogs', date }))[w.id]);
    r.check(`desktop killed ${delay} ms after an offline write: the meal is still there after restart`, kept);
    const t0 = Date.now();
    await A.goOnline();
    const [b, s] = await Promise.all([visible(B, date, has(w.id), t0, 60000), visible(S, date, has(w.id), t0, 60000)]);
    r.time(`killed desktop write (${delay} ms) → website`, b);
    r.time(`killed desktop write (${delay} ms) → server`, s);
    r.check(`after restart and reconnect the desktop's meal reaches the website and the server (${fmt(b)}, ${fmt(s)})`, b !== null && s !== null);
  }
  // (b) the website writes offline, its browser process is SIGKILLed, restarted, back online
  {
    await B.goOffline();
    await sleep(800);
    const w = await B.write({ op: 'logFood', date, text: 'J3 T6 website killed', food: 'banana' });
    await sleep(100);
    await B.kill();
    const tr = Date.now();
    await B.restart();
    r.time('website restart after kill', Date.now() - tr);
    r.check('website browser killed 100 ms after an offline write: the meal is still there after restart', Boolean((await B.read({ col: 'dailyLogs', date }))[w.id]));
    const t0 = Date.now();
    await B.goOnline();
    const [a, s] = await Promise.all([visible(A, date, has(w.id), t0, 60000), visible(S, date, has(w.id), t0, 60000)]);
    r.time('killed website write → desktop', a);
    r.time('killed website write → server', s);
    r.check(`after restart and reconnect the website's meal reaches the desktop and the server (${fmt(a)}, ${fmt(s)})`, a !== null && s !== null);
  }
  // (c) mid-sync: a burst on the desktop; the website is killed while receiving, restarted, ends with all
  {
    const burstDates = [day(4), day(5)];
    burstDates.forEach((d) => used.add(d));
    const ids = [];
    const t1 = Date.now();
    for (let i = 0; i < 12; i++) ids.push((await A.write({ op: 'logFood', date: burstDates[i % 2], text: `J3 T6 burst ${i + 1}`, food: 'cooked rice' })).id);
    r.time('12 desktop writes', Date.now() - t1);
    const readAll = async (x) => Object.assign({}, ...(await Promise.all(burstDates.map((d) => x.read({ col: 'dailyLogs', date: d })))));
    let got = 0;
    const tStart = Date.now();
    while (Date.now() - tStart < 20000) {
      got = Object.keys(await readAll(B).catch(() => ({}))).filter((k) => ids.includes(k)).length;
      if (got > 0) break;
      await sleep(50);
    }
    await B.kill();
    r.observe('website held this many of 12 burst meals when killed', got);
    const t2 = Date.now();
    await B.restart();
    let all = null;
    while (Date.now() - t2 < 60000) {
      const d = await readAll(B).catch(() => ({}));
      if (ids.every((id) => d[id])) {
        all = Date.now() - t2;
        break;
      }
      await sleep(300);
    }
    r.time('website restart → all 12 burst meals', all);
    r.check(`website killed while receiving, restarted: holds all 12 burst meals (${fmt(all)})`, all !== null);
    let srv = null;
    const t3 = Date.now();
    while (Date.now() - t3 < 30000) {
      const d = await readAll(S).catch(() => ({}));
      if (ids.every((id) => d[id])) {
        srv = Date.now() - t1;
        break;
      }
      await sleep(1100);
    }
    r.check(`the server holds all 12 burst meals (${fmt(srv)} after the first write)`, srv !== null);
  }
  await converge(r, [A, B, S], [date, day(4), day(5)]);
  return r.save();
}

/* --------------------------------------------------------------------------------------------- main */
const ALL = { T2, T1, T3, T5, T6 };
const want = process.argv.slice(2).filter((a) => ALL[a]);
const list = want.length ? want : Object.keys(ALL);
const st = state();
if (!st.personId) throw new Error('run setup.mjs first');
await ensurePreview();
const summary = {};
let tok = null;
const reps = [];
try {
  tok = await newToken(st.personId);
  const S = await openReplica('server', { name: 'server', serverBaseUrl: SERVER, token: tok.token });
  reps.push(S);
  await S.read({ col: 'dailyLogs', date: day(0) });
  const A = await openApp('desktop', { name: 'desktop', dir: `${TMP}/j3/desktop` });
  reps.push(A);
  const B = await openApp('browser', { name: 'website', dir: `${TMP}/j3/website` });
  reps.push(B);
  for (const x of [A, B]) {
    let s = null;
    for (let i = 0; i < 60; i++) {
      s = await x.syncStatus().catch((e) => ({ error: e.message }));
      if (s.state === 'synced') break;
      await sleep(500);
    }
    log(`${x.name}: ${JSON.stringify(s)}`);
  }
  for (const t of list) {
    try {
      const out = await ALL[t]({ A, B, S });
      summary[t] = { passed: out.passed, failed: out.failed, timingsMs: out.timingsMs };
    } catch (e) {
      log(`FAIL ${t}: ${e.stack ?? e.message}`);
      summary[t] = { passed: 0, failed: 1, error: redact(e.message).slice(0, 300) };
      for (const x of [A, B]) await x.goOnline().catch(() => undefined);
    }
  }
  for (const x of [A, B]) summary[`${x.name} page errors`] = x.errors.slice(0, 8).map(redact);
} finally {
  for (const x of reps) await x.close().catch(() => undefined);
  if (tok) log(`agent token revoked: ${await revokeToken(st.personId, tok.id).catch((e) => e.message)}`);
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/j3/apps-summary.json`, JSON.stringify({ at: new Date().toISOString(), scenarios: summary }, null, 1) + '\n');
  console.table(Object.fromEntries(Object.entries(summary).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => [k, { passed: v.passed, failed: v.failed }])));
}
process.exit(0);
