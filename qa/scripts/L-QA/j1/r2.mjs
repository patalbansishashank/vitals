// J1 round 2: the real ring through the packaged desktop app's own screens (after apps/desktop/e2e/ringApp.e2e.mjs).
// Phase A: first run → Settings › Devices › "Add a ring" → the list → ONE tap on the J-Style ring → card "Last read"
//          (time to first data) → counts through the read-only QA hook → /ring, /signals?tab=sleep, ?tab=heart screens.
// Phase B: close the app, relaunch with the SAME profile → the ring reconnects by itself, no list, no tap.
// Then Disconnect (frees the ring) and quit. Run under the hardware locks (ring → phone → pc-ble), ring free.
// Output (screens, page text, counts) only under qa/results/L-QA/round2/private/j1 (git-ignored). No device names or
// addresses are logged (the advertised name carries a retail brand); the scan-list label is masked to its J-Style part.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const { _electron } = createRequire(path.join(repo, 'package.json'))('playwright-core');
const APP = process.env.J1_APP || path.join(repo, '.e6-tmp', 'r2j1', 'linux-unpacked', 'vitals');
const priv = path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'private', 'j1');
mkdirSync(priv, { recursive: true });
const home = mkdtempSync(path.join(repo, '.e6-tmp', 'r2j1', 'home-'));
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
  await shot(page, 'r2j1-01-devices-before.png');
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
      if (attempt === 1) { await shot(page, 'r2j1-02-scan-list.png'); out.secretAtList = await secretFields(page); }
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

  if (added) await step('history read: the card says "Last read" (time to first data)', async () => {
    const deadline = Date.now() + 240_000;
    let last = '';
    let readingSeenAt = 0;
    while (Date.now() < deadline) {
      last = await ringsText(page);
      if (/Reading your ring/.test(last) && !readingSeenAt) readingSeenAt = Date.now();
      if (/Last read/i.test(last) && !/Reading your ring/.test(last)) {
        out.timeToFirstDataS = (Date.now() - tapAt) / 1000;
        out.cardAfterRead = last;
        return `${secs(tapAt)} after the tap`;
      }
      if (/didn’t work|didn't work/.test(last)) throw new Error(last.slice(0, 200));
      await sleep(1000);
    }
    out.cardAfterRead = last;
    throw new Error('still not read after 240 s');
  });
  await shot(page, 'r2j1-03-devices-after-read.png');
  writeFileSync(path.join(priv, 'r2j1-card-after-read.txt'), `${out.cardAfterRead ?? ''}\n`);

  await step('readings in the app (bio.sources / bio.daily / bio.series, counts)', async () => {
    out.counts = await counts(page);
    const ring = out.counts.sources?.filter((s) => /ring|jstyle/i.test(JSON.stringify(s))) ?? [];
    if (!ring.length) throw new Error('no ring source');
    return `ring sources ${ring.length}; nights with sleep (14 d) ${out.counts.daily.withSleep}; raw 14 d ${JSON.stringify(out.counts.raw14d)}`;
  });

  for (const [route, name] of [['/ring', 'r2j1-04-ring.png'], ['/signals?tab=sleep', 'r2j1-05-signals-sleep.png'], ['/signals?tab=heart', 'r2j1-06-signals-heart.png']]) {
    await step(`${route} shows the ring data`, async () => {
      await go(page, route);
      const t = await mainText(page);
      writeFileSync(path.join(priv, name.replace('.png', '.txt')), `${scrub(t)}\n`);
      await shot(page, name);
      const sf = await secretFields(page);
      if (sf.length) throw new Error(`secret-like field on ${route}: ${JSON.stringify(sf)}`);
      if (/coming soon/i.test(t)) throw new Error('placeholder "Coming soon"');
      if (/can.t (reach|connect)|not supported|Get the app/i.test(t)) throw new Error(`unsupported state: ${t.slice(0, 160)}`);
      return `${t.length} chars; mentions J-Style ${/J-Style/.test(t)}; last read ${/last read/i.test(t)}; no data words ${/no (data|readings)|nothing (yet|read)/i.test(t)}`;
    });
  }
  out.consoleA = A.consoleLog;
  await quit(A.app);
  A = null;
  log('app closed (phase A)');
  await sleep(5000);

  // ---------------- Phase B: relaunch, reconnect by itself ----------------
  A = await launch('B');
  const pb = A.page;
  const tLaunch = Date.now();
  await pb.evaluate(() => void (window.location.href = 'app://vitals/settings/devices?qa=1'));
  await pb.waitForLoadState('load');
  await step('relaunch: reconnects by itself, no list, no tap', async () => {
    const deadline = Date.now() + 120_000;
    let s = '';
    while (Date.now() < deadline) {
      s = await ringsText(pb);
      const listShown = await pb.locator('[aria-label="rings nearby"]').count();
      if (listShown) throw new Error('a scan list is shown after relaunch');
      if (/Connected|Reading your ring|Disconnect/.test(s) && !/Connecting/.test(s)) {
        out.reconnectS = (Date.now() - tLaunch) / 1000;
        return `${secs(tLaunch)} after launch (state: ${s.replace(/Heart rate now \d+ bpm/, 'live HR').slice(0, 120)})`;
      }
      await sleep(1000);
    }
    throw new Error(`not connected 120 s after relaunch: ${s.slice(0, 160)}`);
  });
  await shot(pb, 'r2j1-07-devices-relaunch.png');
  writeFileSync(path.join(priv, 'r2j1-card-relaunch.txt'), `${await ringsText(pb)}\n`);
  await go(pb, '/ring');
  await shot(pb, 'r2j1-08-ring-relaunch.png');
  writeFileSync(path.join(priv, 'r2j1-08-ring-relaunch.txt'), `${scrub(await mainText(pb))}\n`);
  out.secretRelaunch = await secretFields(pb);
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
  writeFileSync(path.join(priv, 'r2j1.json'), JSON.stringify(out, null, 2));
  writeFileSync(path.join(priv, 'r2j1.log'), `${lines.join('\n')}\n`);
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
