// Q3 shared helpers: browser, viewports, error capture, command-bus reads (window.__vitals, ?qa=1), forbidden-text scan.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
export const ROOT = process.env.VITALS_ROOT || new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
process.env.TMPDIR = process.env.TMPDIR || `${ROOT}/.e6-tmp`;
export const BASE = process.env.BASE || 'http://127.0.0.1:5191';
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 768, height: 1024 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};
let browser;
export async function launch(args = []) {
  // LNA flags (as in the QA brief): a public-origin page may reach the tailnet server without the permission prompt
  browser ??= await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarningOnly', ...args] });
  return browser;
}
export async function closeAll() { await browser?.close(); browser = undefined; }
/** Fresh context per journey. Returns { ctx, page, errors }. */
export async function fresh(vp = 'desktop', extra = {}) {
  const b = await launch(extra.args ?? []);
  // extra.site: serve this branch's build (BASE) under another origin, e.g. https://vitals.creative.desi, the only
  // browser origin the oci-arm server allows (v0.4). Every request to that origin is answered from BASE; nothing is
  // sent to the live site; service workers are blocked so every request is routed.
  const ctx = await b.newContext({ ...VIEWPORTS[vp], ...(extra.site ? { serviceWorkers: 'block' } : {}), ...(extra.ctx ?? {}) });
  if (extra.site) {
    await ctx.route(`${extra.site}/**`, async (route) => {
      const u = new URL(route.request().url());
      const r = await route.fetch({ url: `${BASE}${u.pathname}${u.search}`, maxRedirects: 0, timeout: 60000 });
      await route.fulfill({ response: r });
    });
  }
  const page = await ctx.newPage();
  if (extra.site) page.__site = extra.site;
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));
  return { ctx, page, errors };
}
/** Opens a route with the QA hook enabled. */
export async function go(page, route = '/') {
  const u = new URL(route, page.__site ?? BASE);
  u.searchParams.set('qa', '1');
  await page.goto(u.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 });
}
/** Runs a read command through the bus; throws on error unless {raw:true}. */
export async function read(page, id, input = {}, { raw = false } = {}) {
  const r = await page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  if (raw) return r;
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error)}`);
  return r.output ?? r.value ?? r;
}
export const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
export const bodyText = (page) => page.evaluate(() => document.body.innerText);
/** Internal references that must never reach a screen (Q1 brief "high"). */
export const FORBIDDEN = [
  /dossier/i, /§\s?\d/, /\bR-?\d{1,2}\b/, /MODEL_SPEC|SUITE_SPEC|PLANNER_V2_SPEC|LIVING_PLAN|CATALOGUES\.md/, /\bE\d{1,2}b?\b(?= |:|\))/,
  /\bPlan [ABC]\b/, /\bstreak/i, /\bTODO\b|\bFIXME\b|lorem ipsum/i, /\bundefined\b|\bNaN\b|\[object Object\]/,
  /\bLumen\b(?! Health)/, // the product is Vitals (renamed 2026-10-01; Q3-J6-02); "Lumen Health" is the ring's own phone app (Q10-08)
];
/** Internal names in a URL a person can reach (path and query; Q3-J7-02). */
export const FORBIDDEN_URL = [/dossier/i, /\bR-?\d{1,2}\b/, /\bE\d{1,2}b?\b/, /lumen/i];
export function scanUrl(url) {
  const u = String(url).replace(/[?&]qa=1\b/, '');
  return FORBIDDEN_URL.filter((re) => re.test(u)).map((re) => `${re} → ${u}`);
}
export function scanForbidden(text) {
  const hits = [];
  for (const re of FORBIDDEN) { const m = text.match(re); if (m) hits.push(`${re} → "${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}"`); }
  return hits;
}
export async function shot(page, id, name) {
  const p = `${ROOT}/qa/screenshots/Q3-${id}-${name}.png`;
  await page.screenshot({ path: p });
  return path.relative(ROOT, p);
}
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend')].filter(vis).map((h) => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox]')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.type && e.tagName !== 'BUTTON' ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}${e.disabled ? '{dis}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
/** Result collector: check(name, ok, detail) and a printed table. */
export function results(journey) {
  const rows = [];
  const check = (name, ok, detail = '') => { rows.push({ journey, name, ok: !!ok, detail: String(detail).slice(0, 200) }); if (!ok) console.log(`FAIL ${journey}: ${name} ${detail}`); return !!ok; };
  const save = () => {
    fs.mkdirSync(`${ROOT}/qa/results/Q3`, { recursive: true });
    fs.writeFileSync(`${ROOT}/qa/results/Q3/${journey}.json`, JSON.stringify(rows, null, 1));
    return rows;
  };
  return { rows, check, save };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Seeds a profile by importing a Vitals export through Settings › Your data (replace). Returns profile.get output. */
export async function seed(page, file = `${ROOT}/qa/fixtures/q1b/export-m-veg.json`) {
  await go(page, '/settings');
  await page.locator('#your-data input[type=file], section:has(h2:text("Your data")) input[type=file]').first().setInputFiles(file);
  await page.getByRole('radio', { name: 'replace' }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForTimeout(2500);
  await go(page, '/');
  await page.waitForTimeout(1000);
  if (/screening/.test(page.url())) await answerScreening(page);
  return read(page, 'profile.get');
}
/** Answers the safety screening: 18–64, no to every question, save. */
export async function answerScreening(page) {
  const main = page.locator('body');
  await main.locator('button').filter({ hasText: /^18–64$/ }).first().click();
  for (const fs of await main.locator('fieldset').all()) {
    const no = fs.locator('button').filter({ hasText: /^no$/ });
    if (await no.count()) await no.first().click();
  }
  await main.getByRole('button', { name: /Save answers|Continue/ }).first().click();
  await page.waitForTimeout(1500);
}
/** (J7) Goal "Fat mass", Find plans, Start the selected plan → Living mode. Returns the path it ends on. */
export async function startLiving(page) {
  await go(page, '/plan/goals');
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Fat mass/ }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Find plans/ }).first().click();
  await page.waitForURL(/plan\/results/, { timeout: 240000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Start this plan' }).first().click();
  await page.waitForTimeout(800);
  await page.locator('button').filter({ hasText: /^today$/ }).first().click();
  await page.getByRole('button', { name: 'Start plan', exact: true }).click();
  await page.waitForURL(/\/today/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return new URL(page.url()).pathname;
}
