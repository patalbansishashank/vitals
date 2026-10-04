/** Round 2 J6 part A: Ring (/ring) and Body signals (/signals) on the PRODUCTION build, real ingest path (Settings > Devices file import).
 *  BASE (default http://127.0.0.1:4336), OUT, VIEWPORTS, SCHEMES, JOBS. Input: FIXTURE file (default .e6-tmp/j6-r2/bio-fresh.json, made by gen-fresh.mjs). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:4336').replace(/\/$/, '');
process.env.BASE = BASE; // set/lib.mjs reads it at import
const { firstRun } = await import('../../set/lib.mjs');

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUT = process.env.OUT || join(ROOT, '.e6-tmp/j6-r2/shots');
const VIEWPORTS = { 390: 844, 768: 1024, 1440: 900 };
const widths = (process.env.VIEWPORTS || '390,768,1440').split(',').map((s) => Number(s.trim())).filter((w) => VIEWPORTS[w]);
const schemes = (process.env.SCHEMES || 'light,dark').split(',').map((s) => s.trim()).filter((s) => s === 'light' || s === 'dark');
const ONLY = process.env.ONLY || '';
const JOBS = Math.max(1, Number(process.env.JOBS || 2));
const NOW = new Date('2026-10-04T14:30:00+02:00'); // FIXTURE_TODAY at 14:30 in Europe/Berlin (CEST)
const TODAY = '2026-10-04';

const RING_UNUSED = ['unsupported', 'none', 'bluetooth_off', 'permission_needed', 'idle', 'searching', 'connecting', 'connected', 'syncing', 'elsewhere', 'stale', 'error', 'low_battery', 'sync_failed', 'two_rings'];
const TABS = ['sleep', 'heart', 'activity'];
const PERIODS = ['day', 'week', 'month', 'year'];

const FIXTURE = process.env.FIXTURE || join(ROOT, '.e6-tmp/j6-r2/bio-fresh.json');
const LAST = '2026-10-03';
function shotList(phase) {
  const sig = (tab, period, date) => `/signals?tab=${tab}&period=${period}&date=${date}`;
  const out = [];
  if (phase === 'empty') {
    out.push({ name: 'ring-empty', path: '/ring' });
    for (const t of TABS) out.push({ name: `signals-${t}-day-empty`, path: sig(t, 'day', TODAY) });
  } else {
    out.push({ name: 'ring-data', path: '/ring' });
    for (const t of TABS) for (const p of PERIODS) out.push({ name: `signals-${t}-${p}`, path: sig(t, p, p === 'day' ? LAST : TODAY) });
    out.push({ name: 'signals-sleep-day-missing', path: sig('sleep', 'day', '2026-09-30') });
    out.push({ name: 'signals-sleep-week-gap', path: sig('sleep', 'week', '2026-09-30') });
    out.push({ name: 'ring-scanlist', path: '/ring', click: /look for rings/i, wait: 2500 });
  }
  return out.filter((x) => x.name.includes(ONLY));
}

/* ------------------------------------------------------------------------------------------------ forbidden text */

function loadNeedle() {
  try {
    const src = execFileSync('git', ['show', 'origin/wp/L-PUB:tests/publicHygiene/ringBrand.test.ts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 });
    const m = /^const NEEDLE = String\.fromCharCode\(([\d,\s]+)\)/m.exec(src);
    if (!m) return null;
    const codes = m[1].split(',').map((s) => Number(s.trim()));
    return codes.length && codes.every(Number.isInteger) ? String.fromCharCode(...codes).toLowerCase() : null;
  } catch {
    return null;
  }
}
const NEEDLE = loadNeedle();
const UNITS = NEEDLE ? new RegExp(`(me|gi)${NEEDLE}`, 'g') : null;
const brandHit = (s) => NEEDLE !== null && s.toLowerCase().replace(UNITS, '').includes(NEEDLE);

const FORBIDDEN = [
  ['password', /\bpassword/i],
  ['passcode', /\bpasscode/i],
  ['credential', /\bcredential/i],
  ['PIN', /\bpin\b/i],
  ['firmware password', /\bfirmware password/i],
  ['MQTT', /\bmqtt\b/i],
  ['lease', /\blease\b/i],
  ['GATT', /\bgatt\b/i],
  ['central', /\bcentral\b/i],
  ['bond', /\bbond(ed|ing)?\b/i],
  ['handshake', /\bhandshake/i],
  ['advanced', /\badvanced\b/i],
  ['ring key', /\bring key\b/i],
  ['raw id or address', /\b(ble|BLE):|[0-9A-F]{2}(:[0-9A-F]{2}){5}/],
];

/** The rules the text breaks. The brand is named by rule only; other hits carry a little context unless it holds the brand. */
function forbiddenHits(text) {
  const hits = [];
  if (brandHit(text)) hits.push({ rule: 'ring retail brand' });
  for (const [rule, re] of FORBIDDEN) {
    const m = re.exec(text);
    if (!m) continue;
    const ctx = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ');
    hits.push({ rule, context: brandHit(ctx) ? '[withheld]' : ctx });
  }
  return hits;
}

/* ------------------------------------------------------------------------------------------------ one shot */

async function takeShot(ctx, shot, dir, tag) {
  const file = join(dir, `${shot.name}.png`);
  const rec = { name: shot.name, viewport: tag, path: file, url: shot.path, fixture: shot.fixture, errors: [], consoleErrors: [], overflow: false, forbidden: [], blank: false, fixtureLoaded: false, failure: null };
  const page = await ctx.newPage();
  try {
    page.on('pageerror', (e) => rec.errors.push(String(e.message).slice(0, 300)));
    page.on('console', (m) => {
      if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300));
    });
    await page.goto(BASE + shot.path, { waitUntil: 'networkidle', timeout: 90_000 });
    // under heavy machine load the lazy route chunk can arrive late: wait for real content (retry reloads twice)
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await page.waitForFunction(() => (document.querySelector('main') ? document.querySelector('main').innerText.trim().length : 0) >= 40, null, { timeout: 25_000 }).then(() => true, () => false);
      if (ok) break;
      rec.retries = attempt + 1;
      await page.reload({ waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    if (shot.click) { try { await page.getByRole('button', { name: shot.click }).first().click({ timeout: 5000 }); } catch (e) { rec.clickFailed = String(e.message).split('\n')[0]; } await page.waitForTimeout(shot.wait || 1500); }
    const info = await page.evaluate(() => {
      const attrs = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'aria-description'];
      const parts = [document.body.innerText];
      for (const el of document.body.querySelectorAll('*')) for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v) parts.push(v);
      }
      const wide = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1 && wide.length < 4) wide.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} +${Math.round(r.right - window.innerWidth)}px`);
      }
      const main = document.querySelector('main');

      const inputs = [...document.querySelectorAll('input,textarea,select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 || e.type === 'password'; }).map((e) => `${e.tagName.toLowerCase()}[${e.type || ''}] name=${e.name || ''} label=${e.getAttribute('aria-label') || ''} ac=${e.autocomplete || ''}`);
      const pw = document.querySelectorAll('input[type=password]').length;
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const bgOf = (el) => { let acc = [0, 0, 0]; const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { chain.push(c); if (c[3] >= 1) break; } } let base = [255, 255, 255]; const cs = getComputedStyle(document.documentElement).colorScheme; if (chain.length === 0 || chain[chain.length - 1][3] < 1) base = cs.includes('dark') ? [20, 22, 25] : [255, 255, 255]; for (let i = chain.length - 1; i >= 0; i--) { const c = chain[i]; base = [0, 1, 2].map((k) => c[k] * c[3] + base[k] * (1 - c[3])); } return base; };
      const lowContrast = []; const clipped = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) { const n = walker.currentNode; const t = n.textContent.trim(); const el = n.parentElement; if (!t || !el || seen.has(el)) continue; seen.add(el); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue; if (el.closest('svg')) { /* svg text: fill */ } const fg = parse(el.closest('svg') ? cs.fill : cs.color); if (!fg) continue; const bg = bgOf(el); const a = fg[3]; const f = [0, 1, 2].map((k) => fg[k] * a + bg[k] * (1 - a)); const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const size = parseFloat(cs.fontSize); const big = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700); if (ratio < (big ? 3 : 4.5) && lowContrast.length < 12) lowContrast.push(`${ratio.toFixed(2)} ${size}px "${t.slice(0, 40)}"`); if ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && cs.overflow !== 'visible' && !el.closest('svg') && clipped.length < 8) clipped.push(`${el.tagName.toLowerCase()} "${t.slice(0, 40)}" sw${el.scrollWidth}/cw${el.clientWidth} sh${el.scrollHeight}/ch${el.clientHeight}`); }
      const ringKey = [...document.querySelectorAll('header a,header button,[role=banner] a,[role=banner] button,a,button')].filter((e) => /^ring(:|$)/i.test((e.getAttribute('aria-label') || '').trim())).map((e) => { const r = e.getBoundingClientRect(); return `${e.getAttribute('aria-label')} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
      const small = [...document.querySelectorAll('a,button,[role=tab],[role=radio],[role=switch],input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32) && !e.closest('svg'); }).slice(0, 6).map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      // component styles intact? buttons/tabs/radios need padding and (for filled ones) a fill; page gutter; layer order
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const btns = [...document.querySelectorAll('main button, main [role=tab], main [role=radio]')].filter(vis);
      const flat = btns.filter((e) => { const c = getComputedStyle(e); return (e.innerText || '').trim().length > 1 && c.paddingLeft === '0px' && c.paddingRight === '0px'; }).slice(0, 5).map((e) => (e.innerText || '').trim().slice(0, 24));
      const filled = btns.filter((e) => { const c = getComputedStyle(e); const m = c.backgroundColor.match(/rgba?\(([^)]+)\)/); return m && !(/, ?0\)$|\/ ?0\)$/.test(c.backgroundColor)) && c.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).length;
      const mainEl = document.querySelector('main');
      const mr = mainEl ? mainEl.getBoundingClientRect() : null;
      const first = mainEl ? [...mainEl.querySelectorAll('*')].find((e) => vis(e) && e.getBoundingClientRect().height > 20) : null;
      const gutterL = first ? Math.round(first.getBoundingClientRect().left) : null;
      const style = { buttons: btns.length, zeroPadText: flat, filledButtons: filled, mainLeft: mr ? Math.round(mr.left) : null, firstChildLeft: gutterL, fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 40) };
      const zeroish = null;
      return {
        style: null, inputs, pw, lowContrast, clipped, ringKey, small,
        path: location.pathname,
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        text: parts.join('\n'),
        mainChars: (main ? main.innerText : document.body.innerText).trim().length,
        style,
        wide,
      };
    });
    rec.finalPath = info.path; Object.assign(rec, { inputs: info.inputs, pw: info.pw, lowContrast: info.lowContrast, clipped: info.clipped, ringKey: info.ringKey, small: info.small });
    rec.style = info.style;
    rec.mainChars = info.mainChars;
    rec.blank = info.mainChars < 40;
    if (info.sw > info.iw + 1) rec.overflow = { scrollWidth: info.sw, innerWidth: info.iw, wide: info.wide };
    rec.forbidden = forbiddenHits(info.text);
    await page.screenshot({ path: file, fullPage: true });
  } catch (e) {
    rec.failure = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);
  } finally {
    await page.close().catch(() => {});
  }
  return rec;
}

async function runContext(browser, width, scheme) {
  const tag = `${width}-${scheme}`;
  const dir = join(OUT, tag);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width, height: VIEWPORTS[width] },
    colorScheme: scheme,
    locale: 'en-GB',
    deviceScaleFactor: 1,
    ...(width < 768 ? { isMobile: true, hasTouch: true } : {}),
    ...(process.env.REDUCED ? { reducedMotion: 'reduce' } : {}),
  });
  const out = [];
  if (process.env.BT) {
    // a person on desktop Chrome: Web Bluetooth exists. A stub with no devices and no radio (no hardware is touched): the chooser always ends with 'no ring picked'.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true, requestDevice: async () => { throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'); }, addEventListener() {}, removeEventListener() {} } });
    });
  }
  try {
    const first = await ctx.newPage();
    try {
      await firstRun(first);
    } catch (e) {
      out.push({ name: '(first run)', viewport: tag, failure: String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300), errors: [], consoleErrors: [], forbidden: [], overflow: false, blank: false, fixtureLoaded: false });
    }
    await first.close().catch(() => {});
    for (const shot of shotList('empty')) out.push(await takeShot(ctx, { ...shot, name: shot.name }, dir, tag));
    // import through the app's own path: Settings > Devices file input
    const ip = await ctx.newPage();
    const imp = { name: '(import)', viewport: tag, errors: [], consoleErrors: [], forbidden: [], overflow: false, blank: false };
    ip.on('console', (m) => { if (m.type() === 'error') imp.consoleErrors.push(m.text().slice(0, 300)); });
    ip.on('pageerror', (e) => imp.errors.push(String(e.message).slice(0, 300)));
    try {
      await ip.goto(BASE + '/settings#devices', { waitUntil: 'networkidle', timeout: 90_000 });
      const sec = ip.locator('section#devices');
      await sec.waitFor({ timeout: 30_000 });
      imp.before = (await sec.innerText()).replace(/\s+/g, ' ').slice(0, 200);
      await sec.locator('input[type=file]').setInputFiles(FIXTURE);
      await ip.waitForTimeout(9000);
      imp.after = (await sec.innerText()).replace(/\s+/g, ' ').slice(0, 300);
      await ip.screenshot({ path: join(dir, 'settings-devices-imported.png'), fullPage: true });
    } catch (e) { imp.failure = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300); }
    await ip.close().catch(() => {});
    out.push(imp);
    for (const shot of shotList('data')) out.push(await takeShot(ctx, shot, dir, tag));
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ main */

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const jobs = widths.flatMap((w) => schemes.map((s) => [w, s]));
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [w, s] = jobs[next++];
      results.push(...(await runContext(browser, w, s)));
    }
  }),
);
await browser.close();

const order = new Map(jobs.map(([w, s], i) => [`${w}-${s}`, i]));
results.sort((a, b) => (order.get(a.viewport) ?? 0) - (order.get(b.viewport) ?? 0));
const summary = [];
for (const [w, s] of jobs) {
  const tag = `${w}-${s}`;
  const rs = results.filter((r) => r.viewport === tag);
  const count = (f) => rs.filter(f).length;
  const line = {
    viewport: tag,
    shots: rs.filter((r) => r.name !== '(first run)').length,
    pageErrors: rs.reduce((n, r) => n + r.errors.length, 0),
    consoleErrors: rs.reduce((n, r) => n + r.consoleErrors.length, 0),
    overflow: count((r) => r.overflow),
    forbidden: count((r) => r.forbidden.length),
    blank: count((r) => r.blank),
    fixtureNotLoaded: 0,
    failed: count((r) => r.failure),
  };
  summary.push(line);
  console.log(`${w} ${s}: ${line.shots} shots · page errors ${line.pageErrors} · console errors ${line.consoleErrors} · overflow ${line.overflow} · forbidden ${line.forbidden} · blank ${line.blank} · fixture not loaded ${line.fixtureNotLoaded} · failed ${line.failed}`);
}
const report = { base: BASE, outDir: OUT, brandCheck: NEEDLE ? 'on' : 'skipped (L-PUB guard not readable)', summary, shots: results };
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join(OUT, 'report.json')}${NEEDLE ? '' : ' (brand check skipped: could not read the L-PUB guard)'}`);
process.exit(results.some((r) => r.errors.length || r.overflow || r.forbidden.length || r.failure) ? 1 : 0);
