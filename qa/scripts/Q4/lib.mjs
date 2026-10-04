// Q4 shared helpers: browser, viewports, error capture, command-bus reads (window.__vitals, ?qa=1).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
export const ROOT = process.env.VITALS_ROOT || new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
process.env.TMPDIR = process.env.TMPDIR || `${ROOT}/.e6-tmp`;
export const BASE = process.env.BASE || 'http://127.0.0.1:5198';
export const PROFILES = `${ROOT}/.e6-tmp/q4-profiles`;
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 768, height: 1024 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};
const LAUNCH = { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] };
function wire(page, errors) {
  page.setDefaultTimeout(30000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));
}
/** Persistent context in PROFILES/<name>; `from` copies a seeded profile first (fresh copy per journey). */
export async function openProfile(name, { vp = 'desktop', from = null, keep = false } = {}) {
  const dir = path.join(PROFILES, name);
  if (!keep || from) fs.rmSync(dir, { recursive: true, force: true });
  if (from) fs.cpSync(path.join(PROFILES, from), dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, { ...LAUNCH, ...VIEWPORTS[vp], serviceWorkers: 'block' });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  wire(page, errors);
  return { ctx, page, errors, close: () => ctx.close() };
}
/** Starts `vite preview` of DIST on BASE's port when nothing answers there (other jobs share the machine). */
export async function ensureServer() {
  const up = async () => { try { return (await fetch(BASE + '/')).ok; } catch { return false; } };
  if (await up()) return;
  const { spawn } = await import('node:child_process');
  const dist = process.env.Q4_DIST || '.e6-tmp/dist-Q4';
  const port = new URL(BASE).port;
  const out = fs.openSync(`${ROOT}/.e6-tmp/q4-preview.log`, 'a');
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dist, '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
export async function go(page, route = '/') {
  await ensureServer();
  const u = new URL(route, BASE);
  u.searchParams.set('qa', '1');
  await page.goto(u.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 });
}
export async function read(page, id, input = {}, { raw = false } = {}) {
  const r = await page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  if (raw) return r;
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.output ?? r.value ?? r;
}
export const events = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__vitals.events())));
export const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
export const bodyText = (page) => page.evaluate(() => document.body.innerText);
export async function shot(page, name) {
  const p = `${ROOT}/qa/screenshots/Q4-${name}.png`;
  await page.screenshot({ path: p });
  return path.relative(ROOT, p);
}
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend')].filter(vis).map((h) => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox]')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.type && e.tagName !== 'BUTTON' ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}${e.disabled ? '{dis}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
export function results(journey) {
  const rows = [];
  const check = (name, ok, detail = '') => { rows.push({ journey, name, ok: !!ok, detail: String(detail).slice(0, 240) }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${journey}: ${name} ${ok ? '' : detail}`); return !!ok; };
  const save = () => {
    fs.mkdirSync(`${ROOT}/qa/results/Q4`, { recursive: true });
    fs.writeFileSync(`${ROOT}/qa/results/Q4/${journey}.json`, JSON.stringify(rows, null, 1));
    return rows;
  };
  return { rows, check, save };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Any button-like control whose visible text is exactly `text` (case-insensitive). */
export const btn = (page, text, scope = 'main') => page.locator(scope).locator('button,[role=radio],[role=checkbox],[role=tab],[role=switch],a').filter({ hasText: new RegExp('^\\s*' + esc(text) + '\\s*$', 'i') });
export async function clickAll(page, text) { const l = btn(page, text); const n = await l.count(); for (let i = 0; i < n; i++) { await l.nth(i).click(); await sleep(120); } return n; }
/** Sends a message from the Coach page composer and waits for the turn to end (Stop button gone, log stable). */
export async function say(page, text, { timeout = 300000 } = {}) {
  const box = page.getByLabel('Message to the Coach').first();
  await box.fill(text);
  const n0 = (await coachLog(page)).length;
  await page.getByRole('button', { name: 'Send', exact: true }).first().click();
  const stop = page.getByRole('button', { name: 'Stop the Coach' });
  const t0 = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    await sleep(500);
    const busy = await stop.count();
    const len = (await coachLog(page)).length;
    if (!busy && len > n0 + text.length) { stable = len === last ? stable + 1 : 0; if (stable >= 3) break; }
    last = len;
  }
  await sleep(500);
}
/** Change cards in the Coach log: [{ cls, state, text }] */
export const cards = (page) => page.evaluate(() => [...document.querySelectorAll('[data-class][data-state]')].map((c) => ({ cls: c.getAttribute('data-class'), state: c.getAttribute('data-state'), text: c.innerText.replace(/\s+/g, ' ').slice(0, 900) })));
export const coachLog = (page) => page.evaluate(() => (document.querySelector('[role=log]')?.innerText || '').replace(/\n{2,}/g, '\n'));
/** Clicks the last card button whose accessible name starts with `action` (e.g. 'Apply proposal: start a plan'). */
export async function cardButton(page, name) {
  const b = page.getByRole('button', { name: new RegExp('^' + esc(name), 'i') }).last();
  await b.click();
  await sleep(2500);
}
export async function waitPlanner(page, maxMs = 900000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < maxMs) { r = await read(page, 'planner.result'); if (r.status !== 'running' && r.status !== 'stopping') return r; await sleep(5000); }
  return r;
}
/** Sets which file the scripted model appends this journey's requests to. */
export async function providerLog(file) {
  await fetch(new URL('/__log', process.env.Q4_FAKE_URL || 'http://127.0.0.1:4192/v1'), { method: 'POST', body: file });
}
export const lastTurnText = async (page) => { const t = await coachLog(page); const parts = t.split(/\ncoach\n/); return parts[parts.length - 1] || ''; };
export const planNow = async (page) => (await read(page, 'plan.get')).plan ?? null;
/** Clicks a button (by accessible-name prefix, first match) and waits until the change cards' states change. */
export async function applyAndWait(page, name, maxMs = 120000) {
  const before = JSON.stringify((await cards(page)).map((c) => c.state));
  const b = page.getByRole('button', { name: new RegExp('^' + esc(name), 'i') }).first();
  await b.click();
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { await sleep(1000); if (JSON.stringify((await cards(page)).map((c) => c.state)) !== before) break; }
  await sleep(1000);
}
/** Training sessions of the next 7 days from `from` as 'dd:kind+kind'. */
export async function weekSessions(page, from) {
  const out = [];
  for (let k = 0; k < 7; k++) {
    const d = new Date(from + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k);
    const iso = d.toISOString().slice(0, 10);
    const t = await read(page, 'today.get', { date: iso });
    out.push(`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}:${(t.prescription?.sessions ?? []).map((s) => s.kind).join('+') || '-'}`);
  }
  return out.join(' ');
}
export function nextDow(fromIso, dow) { for (let k = 1; k <= 7; k++) { const d = new Date(fromIso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); if (d.getUTCDay() === dow) return d.toISOString().slice(0, 10); } }
/** Answers the open intake chapter with each question's default (or first) answer until it leaves `path`. */
export async function answerChapter(page, path, { max = 40, prefs = {} } = {}) {
  await go(page, path);
  for (let i = 0; i < max; i++) {
    if (!page.url().includes(path.split('?')[0])) break;
    const st = await page.evaluate(() => {
      const fs = [...document.querySelectorAll('main fieldset')].filter((f) => f.getBoundingClientRect().height > 0);
      const f = fs[fs.length - 1];
      const lg = f?.querySelector('legend')?.innerText.replace(/\s+/g, ' ').trim() ?? null;
      const btns = f ? [...f.querySelectorAll('button,[role=radio],[role=checkbox]')].map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()) : [];
      return { lg, btns };
    });
    const main = page.locator('main');
    try {
      if (st.lg) {
        const pref = Object.entries(prefs).find(([k]) => st.lg.includes(k))?.[1];
        const pick = pref ?? st.btns.find((b) => /\(default\)/.test(b)) ?? st.btns.find((b) => b && !/ask me later|why we ask|^Done|Decrease|Increase|Remove|Add one|^Back|^Next|Skip/i.test(b));
        if (pick) {
          const byLabel = main.locator(`fieldset [aria-label="${pick.replace(/"/g, '\\"')}"]`);
          await ((await byLabel.count()) ? byLabel.last() : main.locator('button,[role=radio],[role=checkbox]').filter({ hasText: pick }).last()).click({ timeout: 5000 });
        }
        await sleep(300);
      }
      for (const n of [/^Done/, /^Next$/, /Looks right/, /^Continue/, /Next chapter/]) {
        const b = main.getByRole('button', { name: n });
        if ((await b.count()) && (await b.last().isVisible()) && (await b.last().isEnabled())) { await b.last().click(); break; }
      }
    } catch (e) { console.log('answerChapter', st.lg, e.message.split('\n')[0]); }
    await sleep(600);
  }
}
export async function providerMode(mode) { await fetch(new URL('/__mode', process.env.Q4_FAKE_URL || 'http://127.0.0.1:4192/v1'), { method: 'POST', body: JSON.stringify(mode) }); }
/** The markers review card: answer the context questions (fasted yes, the rest no / none), tick the confident rows, save. */
export async function confirmMarkersReview(page) {
  const log = page.locator('[role=log]');
  const yes = log.getByRole('button', { name: 'yes', exact: true });
  const no = log.getByRole('button', { name: 'no', exact: true });
  if (await yes.count()) await yes.first().click();
  for (let i = 1; i < (await no.count()); i++) await no.nth(i).click();
  const none = log.getByRole('button', { name: 'none of these' });
  if (await none.count()) await none.last().click();
  const tick = log.getByRole('button', { name: /^Tick all high-confidence/ });
  if (await tick.count()) await tick.last().click();
  await sleep(500);
  const save = log.getByRole('button', { name: /^Save \d+ confirmed value/ }).last();
  const label = (await save.getAttribute('aria-label')) || (await save.innerText());
  await save.click();
  await sleep(3000);
  return label;
}
