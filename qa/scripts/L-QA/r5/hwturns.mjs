// R5 check 3: real J-Style 2301 ring, round-5 packaged desktop app: Add a ring → one tap → history read, then live heart
// rate must start only AFTER the read with no 'another command is running on this ring'; then Sync now while live HR
// runs → no error, live resumes. Derived from qa/scripts/L-QA/j1/r2.mjs (phase A only). Run under ring → phone → pc-ble.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const { _electron } = createRequire(path.join(repo, 'package.json'))('playwright-core');
const APP = process.env.R5_APP || path.join(repo, '.e6-tmp', 'r5', 'apps', 'desktop', 'release', 'linux-unpacked', 'vitals');
const priv = path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'private', 'r5');
mkdirSync(priv, { recursive: true });
const home = mkdtempSync(path.join(repo, '.e6-tmp', 'r5home-hw-'));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_CACHE_HOME: path.join(home, '.cache') };
for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'DISPLAY']) delete env[k];
env.WAYLAND_DISPLAY ||= 'wayland-1';
env.XDG_RUNTIME_DIR ||= `/run/user/${process.getuid?.() ?? 1000}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const secs = (from) => `${((Date.now() - from) / 1000).toFixed(1)} s`;
const scrub = (s) => String(s).replace(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/g, '<addr>').replace(/[0-9a-fA-F]{16,}/g, '<hex>');
const lines = [];
const mainLog = [];
const out = { steps: [] };
const log = (s) => { const l = `${new Date().toISOString()} ${scrub(s)}`; lines.push(l); console.log(l); };
async function step(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    out.steps.push({ name, ok: true, note, s: (Date.now() - started) / 1000 });
    log(`PASS ${name}${note ? ` — ${note}` : ''} (${secs(started)})`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    out.steps.push({ name, ok: false, note: msg, s: (Date.now() - started) / 1000 });
    log(`FAIL ${name} — ${msg} (${secs(started)})`);
    return false;
  }
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const from14 = iso(new Date(today.getTime() - 14 * 86_400_000));

async function launch(tag) {
  const app = await _electron.launch({ executablePath: APP, args: ['--ozone-platform=wayland', `--user-data-dir=${path.join(home, 'udd')}`], env, timeout: 60_000 });
  app.process().stderr?.on('data', (d) => mainLog.push(...String(d).split('\n').filter((l) => /vitals:|bluetooth|ble|gatt|bluez/i.test(l)).map((l) => `${tag} ${scrub(l).slice(0, 300)}`)));
  const page = await app.firstWindow({ timeout: 60_000 });
  const consoleLog = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || /ring|bluetooth|gatt|connect/i.test(m.text())) consoleLog.push(`${tag} ${m.type()}: ${scrub(m.text()).slice(0, 300)}`); });
  page.on('pageerror', (e) => consoleLog.push(`${tag} pageerror ${scrub(e.message).slice(0, 300)}`));
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  return { app, page, consoleLog };
}
async function quit(app) {
  await Promise.race([app.close().catch(() => undefined), sleep(10_000)]);
  try { app.process().kill('SIGKILL'); } catch { /* gone */ }
}
async function go(page, route) {
  await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
  await page.waitForTimeout(3000);
}
const mainText = (page) => page.evaluate(() => (document.querySelector('main') ?? document.body).innerText.replace(/\n{2,}/g, '\n'));
async function shot(page, name) {
  await page.screenshot({ path: path.join(priv, name), fullPage: true, timeout: 20_000 }).catch((e) => log(`screenshot ${name} failed: ${e.message.split('\n')[0]}`));
  return name;
}
/** Any visible field that asks for a password, passcode, PIN or key (none may exist for a ring). */
const secretFields = (page) => page.evaluate(() =>
  [...document.querySelectorAll('input, textarea')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => `${el.getAttribute('type') || el.tagName} ${el.getAttribute('name') || ''} ${el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''}`.slice(0, 80))
    .filter((f) => /password|pass|key|code|pin/i.test(f)));
const ringsText = (page) => page.locator('[aria-label="rings"]').innerText({ timeout: 5000 }).then((s) => s.replace(/\s+/g, ' ')).catch(() => '');

async function counts(page) {
  return page.evaluate(async ([from, to]) => {
    const V = window.__vitals;
    if (!V) return { error: 'no QA hook' };
    const src = await V.read('bio.sources', {});
    const list = src.ok && src.output ? src.output.sources : [];
    const r = { sources: list.map((x) => ({ kind: x.kind, driver: x.driver, channel: x.channel, records: x.records, streams: x.streams?.length, firstDate: x.firstDate, lastDate: x.lastDate })), ringSharing: src.output?.ringSharing };
    const d = await V.read('bio.daily', { from, to });
    const days = d.ok ? d.output.days : [];
    r.daily = { days: days.length, withSleep: days.filter((x) => JSON.stringify(x).includes('"sleep')).length, sleepDates: days.filter((x) => JSON.stringify(x).includes('"sleep')).map((x) => x.date) };
    r.raw14d = {};
    for (const metric of ['hr', 'hrv', 'spo2', 'skin_temp', 'steps']) {
      const s = await V.read('bio.series', { metric, from, to, resolution: 'raw' });
      r.raw14d[metric] = s.ok && s.output ? `${s.output.points.length}${s.output.truncated ? '+' : ''}` : (s.error?.code ?? 'no output');
    }
    return r;
  }, [from14, iso(today)]);
}

let A;
try {
  // ---------------- Phase A ----------------
  A = await launch('A');
  const { page } = A;
  out.bridge = await page.evaluate(() => ({ bluetooth: typeof window.vitalsDesktop?.bluetooth, webBluetooth: typeof navigator.bluetooth }));
  log(`bridge ${JSON.stringify(out.bridge)} url ${new URL(page.url()).pathname}`);
  await step('first run (neutral answers, no health data)', async () => { await completeWelcome(page); return new URL(page.url()).pathname; });
  await page.evaluate(() => void (window.location.href = 'app://vitals/settings/devices?qa=1'));
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  await shot(page, 'r5hw-01-devices-before.png');
  out.secretBefore = await secretFields(page);
  log(`Devices before: secret-like fields ${JSON.stringify(out.secretBefore)}`);

  const card = () => page.locator('[aria-label="rings"] li:has(h3)').first();
  let tapAt = 0;
  out.taps = 0;
  const added = await step('Add a ring → list → ONE tap → ring card', async () => {
    const notes = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const start = page.getByRole('button', { name: attempt === 1 ? 'Add a ring' : 'Look again' });
      const tStart = Date.now();
      await start.click({ timeout: 30_000 });
      const list = page.locator('[aria-label="rings nearby"] button');
      await list.first().waitFor({ timeout: 60_000 });
      const rows = (await list.allInnerTexts()).length;
      const pick = list.filter({ hasText: /J-Style/i }).first();
      if (!(await pick.count())) throw new Error(`no J-Style ring in the list (${rows} rows)`);
      const label = (await pick.innerText()).replace(/\s+/g, ' ');
      out.listLabelHasJStyle = /J-Style 2301/.test(label);
      out.listLabelLen = label.length;
      notes.push(`list after ${secs(tStart)} (${rows} row(s))`);
      if (attempt === 1) { await shot(page, 'r5hw-02-scan-list.png'); out.secretAtList = await secretFields(page); }
      await pick.click();
      out.taps++;
      tapAt = Date.now();
      const outcome = await Promise.race([
        card().waitFor({ timeout: 120_000 }).then(() => 'card'),
        page.getByRole('button', { name: 'Look again' }).waitFor({ timeout: 120_000 }).then(() => 'again'),
      ]).catch(() => 'timeout');
      notes.push(`tap ${attempt}: ${outcome} after ${secs(tapAt)}`);
      if (outcome === 'card') return notes.join(', ');
      if (outcome === 'timeout') break;
    }
    throw new Error(notes.join(', '));
  });
  out.secretAfterTap = await secretFields(page);
  const busyRe = /another command|is running on this ring|busy|didn.t work|went wrong|error/i;
  const timeline = [];
  let prev = '';
  const norm = (s) => s.replace(/Heart rate now \d+ bpm/, 'Heart rate now N bpm').replace(/\d+ ?%/g, 'P%').replace(/Last read [^·\n]*/, 'Last read …').slice(0, 220);
  const watch = async (label, ms, until) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await ringsText(page);
      const n = norm(s);
      if (n !== prev) { timeline.push({ t: ((Date.now() - tapAt) / 1000).toFixed(1), phase: label, card: n }); prev = n; }
      if (until && until(s)) return s;
      await sleep(500);
    }
    return null;
  };
  if (added) {
    await step('history read finishes ("Last read"), live HR not shown while reading', async () => {
      const s = await watch('read', 240_000, (x) => /Last read/i.test(x) && !/Reading/.test(x));
      if (!s) throw new Error('no "Last read" in 240 s');
      out.readDoneS = (Date.now() - tapAt) / 1000;
      const overlap = timeline.filter((x) => /Reading/.test(x.card) && /Heart rate now/.test(x.card));
      out.liveDuringRead = overlap.length;
      if (overlap.length) throw new Error(`live HR shown during the read ${overlap.length}×`);
      return `read done ${out.readDoneS.toFixed(1)} s after the tap`;
    });
    await step('live HR starts AFTER the read, no busy error', async () => {
      const t = Date.now();
      const s = await watch('live', 90_000, (x) => /Heart rate now \d+ bpm/.test(x));
      out.liveAfterReadS = s ? (Date.now() - t) / 1000 : null;
      const errs = [...A.consoleLog, ...mainLog].filter((l) => /another command|busy/i.test(l));
      out.busyLogA = errs.length;
      if (!s) throw new Error('no live HR within 90 s after the read');
      if (errs.length) throw new Error(`busy errors in logs: ${errs.length}`);
      return `live HR ${out.liveAfterReadS.toFixed(1)} s after "Last read"`;
    });
    await shot(page, 'r5hw-01-live-after-read.png');
    await step('Sync now while live HR runs: no error, live resumes', async () => {
      const btn = page.locator('[aria-label="rings"] li').first().getByRole('button', { name: 'Sync now' });
      await btn.click({ timeout: 10_000 });
      const tS = Date.now();
      let sawSync = false;
      const s = await watch('syncnow', 150_000, (x) => { if (/Reading/.test(x)) sawSync = true; return sawSync && !/Reading/.test(x) && /Heart rate now \d+ bpm/.test(x); });
      out.syncNowS = (Date.now() - tS) / 1000;
      out.sawSyncReading = sawSync;
      const cardErr = timeline.filter((x) => x.phase === 'syncnow' && busyRe.test(x.card));
      const errs = [...A.consoleLog, ...mainLog].filter((l) => /another command|busy/i.test(l));
      out.busyLogB = errs.length;
      if (cardErr.length || errs.length) throw new Error(`error on the card ${cardErr.length}× / busy in logs ${errs.length}×: ${cardErr[0]?.card ?? errs[0]}`);
      if (!s) throw new Error(`live HR not back within 150 s (saw a read: ${sawSync})`);
      return `read seen ${sawSync}; live back ${out.syncNowS.toFixed(1)} s after the tap on Sync now`;
    });
    await shot(page, 'r5hw-02-after-syncnow.png');
    out.cardErrorsAll = timeline.filter((x) => busyRe.test(x.card)).length;
  }
  out.timeline = timeline;
  out.counts = await counts(page).catch((e) => ({ error: String(e).slice(0, 100) }));
  out.consoleA = A.consoleLog;
} catch (e) {
  log(`FAIL ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  out.error = String(e).slice(0, 300);
} finally {
  if (A) {
    // free the ring: Disconnect on the card, then quit
    await go(A.page, '/settings/devices').catch(() => {});
    await A.page.locator('[aria-label="rings"] li').first().getByRole('button', { name: 'Disconnect' }).click({ timeout: 5_000 }).then(() => log('Disconnect clicked'), () => log('no Disconnect button'));
    await sleep(2000);
    out.consoleB = A.consoleLog;
    await quit(A.app);
  }
  out.mainLog = mainLog.slice(-60);
  out.totalS = (Date.now() - t0) / 1000;
  writeFileSync(path.join(priv, 'r5hw.json'), JSON.stringify(out, null, 2));
  writeFileSync(path.join(priv, 'r5hw.log'), `${lines.join('\n')}\n`);
  log(`done in ${out.totalS}s; app closed`);
}
process.exit(out.steps.every((s) => s.ok) && !out.error ? 0 : 1);

async function completeWelcome(p) {
  if (!p.url().includes('/welcome')) return;
  await p.getByRole('button', { name: 'Get started' }).first().click();
  await p.locator('[role=radio]').first().waitFor({ timeout: 20_000 });
  for (let round = 0; round < 4; round++) {
    const groups = await p.evaluate(() =>
      [...new Set([...document.querySelectorAll('[role=radio]')].map((r) => r.parentElement))].map((g, i) => {
        g.setAttribute('data-e2e-group', String(i));
        const opts = [...g.querySelectorAll('[role=radio]')];
        return { i, checked: opts.some((o) => o.getAttribute('aria-checked') === 'true'), names: opts.map((o) => o.textContent.trim()) };
      }),
    );
    const todo = groups.filter((g) => !g.checked);
    if (!todo.length) break;
    for (const g of todo) {
      const pick = g.names.find((x) => x === '18–64') ?? g.names.find((x) => x === 'no') ?? g.names.at(-1);
      await p.locator(`[data-e2e-group="${g.i}"] [role=radio]`).filter({ hasText: new RegExp(`^${pick}$`) }).first().click();
    }
  }
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('checkbox').first().check({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 20_000 });
}
