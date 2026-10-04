// J2 round 2 driver: the Vitals WebView on the phone over Chrome DevTools (adb forward done by r2.sh / lib.sh fwd).
// node r2.mjs <cmd> [args]
//   state | welcome | addring | ringcard | counts | keep | qatick <min|off> | shell | disconnect | connect | nav <path> | secret
// Output can hold health values: r2.sh writes it under qa/results/L-QA/round2/private/j2 only. Device addresses and long
// hex runs are scrubbed; the scan-list label is reduced to whether it reads "J-Style 2301".
import { createRequire } from 'node:module';
const require = createRequire('/media/DEV/Hobby/vitals-wt/L-QA/package.json');
const { chromium } = require('playwright-core');

const PORT = process.env.J2_CDP_PORT ?? '9334';
const [cmd, ...args] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a.map((x) => scrub(typeof x === 'string' ? x : JSON.stringify(x))));
const scrub = (s) => String(s).replace(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/g, '<addr>').replace(/[0-9a-fA-F]{16,}/g, '<hex>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
const pages = b.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => p.url().startsWith('https://localhost')) ?? pages[0];
if (!page) { console.log('no page'); process.exit(2); }

async function nav(path) {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
  await page.waitForTimeout(3000);
  return new URL(page.url()).pathname + new URL(page.url()).search;
}
const mainText = () => page.evaluate(() => (document.querySelector('main') ?? document.body).innerText.replace(/\n{2,}/g, '\n'));
const ringsText = () => page.locator('[aria-label="rings"]').innerText({ timeout: 4000 }).then((s) => s.replace(/\s+/g, ' ')).catch(() => '(no rings list)');
const secretFields = () => page.evaluate(() =>
  [...document.querySelectorAll('input, textarea')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => `${el.getAttribute('type') || el.tagName} ${el.getAttribute('name') || ''} ${el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''}`.slice(0, 80))
    .filter((f) => /password|pass|key|code|pin/i.test(f)));
const shellState = () => page.evaluate(async () => {
  const S = window.Capacitor?.Plugins?.VitalsShell;
  if (!S) return { error: 'no VitalsShell plugin' };
  const s = await S.getState();
  return { ...s, lastRingTickAt: s.lastRingTickAt ? new Date(s.lastRingTickAt).toISOString() : 0 };
});
async function hookReady() {
  if (await page.evaluate(() => !!window.__vitals)) return true;
  await page.evaluate(() => { const u = new URL(location.href); u.searchParams.set('qa', '1'); location.href = u.toString(); });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => !!window.__vitals);
}

try {
  switch (cmd) {
    case 'state': {
      log(await page.evaluate(() => ({ url: location.pathname + location.search, visibility: document.visibilityState, h: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()).slice(0, 10), qaHook: !!window.__vitals })));
      break;
    }
    case 'nav': log(await nav(args[0])); console.log(scrub(await mainText())); break;
    case 'secret': log('secret-like fields', await secretFields()); break;
    case 'shell': log('shell', await shellState()); break;
    case 'welcome': {
      // first run with neutral answers (adult band, "no" to each screening question, the disclaimer ticked): no health data
      if (!page.url().includes('/welcome')) { log('no first run (person exists):', new URL(page.url()).pathname); break; }
      await page.getByRole('button', { name: 'Get started' }).first().click();
      await page.locator('[role=radio]').first().waitFor({ timeout: 20000 });
      for (let round = 0; round < 4; round++) {
        const groups = await page.evaluate(() =>
          [...new Set([...document.querySelectorAll('[role=radio]')].map((r) => r.parentElement))].map((g, i) => {
            g.setAttribute('data-e2e-group', String(i));
            const opts = [...g.querySelectorAll('[role=radio]')];
            return { i, checked: opts.some((o) => o.getAttribute('aria-checked') === 'true'), names: opts.map((o) => o.textContent.trim()) };
          }));
        const todo = groups.filter((g) => !g.checked);
        if (!todo.length) break;
        for (const g of todo) {
          const pick = g.names.find((x) => x === '18–64') ?? g.names.find((x) => x === 'no') ?? g.names.at(-1);
          await page.locator(`[data-e2e-group="${g.i}"] [role=radio]`).filter({ hasText: new RegExp(`^${pick}$`) }).first().click();
        }
      }
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('checkbox').first().check({ timeout: 20000 });
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 20000 });
      log('first run done →', new URL(page.url()).pathname);
      break;
    }
    case 'addring': {
      // Settings › Devices › "Add a ring" → list → ONE tap on the J-Style ring → card → "Last read"
      log('url', await nav('/settings/devices'));
      log('secret-like fields before', await secretFields());
      const before = await ringsText();
      log('rings before', before.slice(0, 200));
      if (/Disconnect|Connected/.test(before)) { log('a ring is already kept and connected here; not adding'); break; }
      let tapAt = 0;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const start = page.getByRole('button', { name: attempt === 1 ? 'Add a ring' : 'Look again' });
        const tS = Date.now();
        await start.click({ timeout: 30000 });
        const list = page.locator('[aria-label="rings nearby"] button');
        await list.first().waitFor({ timeout: 60000 });
        const rows = (await list.allInnerTexts()).length;
        const pick = list.filter({ hasText: /J-Style/i }).first();
        if (!(await pick.count())) { log(`no J-Style ring in the list (${rows} rows)`); break; }
        log(`attempt ${attempt}: list after ${((Date.now() - tS) / 1000).toFixed(1)} s, ${rows} row(s); label reads "J-Style 2301": ${/J-Style 2301/.test(await pick.innerText())}`);
        log('secret-like fields at list', await secretFields());
        if (process.env.J2_HOLD_LIST === '1') { log('holding at the list for a screenshot'); await sleep(6000); }
        await pick.click();
        tapAt = Date.now();
        log(`TAP ${attempt}`);
        const outcome = await Promise.race([
          page.locator('[aria-label="rings"] li:has(h3)').first().waitFor({ timeout: 120000 }).then(() => 'card'),
          page.getByRole('button', { name: 'Look again' }).waitFor({ timeout: 120000 }).then(() => 'again'),
        ]).catch(() => 'timeout');
        log(`tap ${attempt}: ${outcome} after ${((Date.now() - tapAt) / 1000).toFixed(1)} s`);
        if (outcome !== 'again') break;
      }
      let last = '';
      const deadline = Date.now() + 240000;
      while (tapAt && Date.now() < deadline) {
        last = await ringsText();
        if (/Last read/i.test(last) && !/Reading your ring/.test(last)) { log(`FIRST DATA: card "Last read" ${((Date.now() - tapAt) / 1000).toFixed(1)} s after the tap`); break; }
        if (/didn’t work|didn't work/.test(last)) { log('card says it did not work'); break; }
        await sleep(1000);
      }
      log('card', last.replace(/Heart rate now \d+ bpm/, 'live HR shown'));
      log('secret-like fields after', await secretFields());
      break;
    }
    case 'ringcard': log('url', await nav(args[0] ?? '/settings/devices')); log('card', await ringsText()); break;
    case 'counts': {
      if (!(await hookReady())) { log('no QA hook'); break; }
      const r = await page.evaluate(async () => {
        const V = window.__vitals;
        const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
        const src = await V.read('bio.sources', {});
        const sources = src.ok ? src.output.sources.map((x) => ({ kind: x.kind, driver: x.driver, channel: x.channel, records: x.records, streams: x.streams?.length, firstDate: x.firstDate, lastDate: x.lastDate })) : src;
        const d = await V.read('bio.daily', { from: day(13), to: day(0) });
        const days = d.ok ? d.output.days : [];
        const out = { sources, ringSharing: src.output?.ringSharing, nightsWithSleep14d: days.filter((x) => JSON.stringify(x).includes('"sleep')).length };
        for (const m of ['hr', 'spo2', 'hrv', 'skin_temp', 'steps']) {
          const s = await V.read('bio.series', { metric: m, from: day(13), to: day(0), resolution: 'raw' });
          const pts = s.ok ? s.output.points : [];
          const ts = pts.map((p) => p.t ?? p.ts ?? p.at ?? p.time).filter(Boolean).map((t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t))).filter(Number.isFinite);
          out[`raw_${m}_14d`] = s.ok ? { points: pts.length, truncated: s.output.truncated, newest: ts.length ? new Date(Math.max(...ts)).toISOString() : null } : s.error?.code;
        }
        return out;
      });
      log('counts', r);
      if (args[0]) {
        // samples newer than an ISO time (screen-off evidence): count per metric
        const since = Date.parse(args[0]);
        const r2 = await page.evaluate(async (since) => {
          const V = window.__vitals;
          const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
          const o = {};
          for (const m of ['hr', 'spo2', 'hrv', 'skin_temp', 'steps']) {
            const s = await V.read('bio.series', { metric: m, from: day(1), to: day(0), resolution: 'raw' });
            const pts = s.ok ? s.output.points : [];
            o[m] = pts.map((p) => p.t ?? p.ts ?? p.at ?? p.time).map((t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t))).filter((t) => t >= since).length;
          }
          o.samplePointKeys = await V.read('bio.series', { metric: 'hr', from: day(1), to: day(0), resolution: 'raw' }).then((s) => Object.keys(s.output?.points?.[0] ?? {}));
          return o;
        }, since);
        log(`samples timestamped after ${args[0]}`, r2);
      }
      break;
    }
    case 'keep': {
      // the Ring page's "keep my ring connected" switch: report it, turn it on if off
      log('url', await nav('/ring'));
      const sw = page.getByRole('switch', { name: /keep my ring connected/i }).or(page.getByRole('checkbox', { name: /keep my ring connected/i })).first();
      if (!(await sw.count())) { log('no "keep my ring connected" switch on /ring'); break; }
      await sw.scrollIntoViewIfNeeded().catch(() => {});
      const on = async () => (await sw.getAttribute('aria-checked')) === 'true' || (await sw.isChecked().catch(() => false));
      log('keep my ring connected was', await on());
      if (!(await on())) { await sw.click(); await sleep(1500); log('clicked; now', await on()); }
      log('localStorage keep key', await page.evaluate(() => localStorage.getItem('vitals.ring.keepConnected')));
      break;
    }
    case 'qatick': {
      // QA knob of androidRingLink (BACKGROUND_READ_MINUTES_KEY): read every N minutes with the screen off; read at link install
      const v = args[0];
      await page.evaluate((v) => (v === 'off' ? localStorage.removeItem('vitals.ring.backgroundReadMinutes') : localStorage.setItem('vitals.ring.backgroundReadMinutes', v)), v);
      log('backgroundReadMinutes now', await page.evaluate(() => localStorage.getItem('vitals.ring.backgroundReadMinutes')));
      break;
    }
    case 'reload': {
      await page.evaluate(() => location.reload());
      await sleep(8000);
      log('reloaded', new URL(page.url()).pathname);
      break;
    }
    case 'disconnect':
    case 'connect': {
      log('url', await nav('/settings/devices'));
      const li = page.locator('[aria-label="rings"] li').first();
      const name = cmd === 'disconnect' ? 'Disconnect' : 'Connect';
      const btn = li.getByRole('button', { name, exact: true });
      if (!(await btn.count())) { log(`no ${name} button; card: ${await ringsText()}`); break; }
      const t = Date.now();
      await btn.click();
      log(`clicked ${name}`);
      const want = cmd === 'disconnect' ? /\bConnect\b/ : /Disconnect/;
      for (let i = 0; i < 120; i++) {
        await sleep(500);
        const s = await li.innerText().catch(() => '');
        if (cmd === 'disconnect' ? (await li.getByRole('button', { name: 'Connect', exact: true }).count()) > 0 : want.test(s) && !/Connecting|Looking/.test(s)) { log(`${name} done in ${((Date.now() - t) / 1000).toFixed(1)} s`); break; }
      }
      log('card', await ringsText());
      break;
    }
    case 'eval': log(await page.evaluate(`(async () => { ${args[0]} })()`)); break;
    default: console.log('unknown cmd', cmd);
  }
} catch (e) {
  console.log('ERR', scrub(String(e)).slice(0, 600));
}
await b.close().catch(() => {});
process.exit(0);
