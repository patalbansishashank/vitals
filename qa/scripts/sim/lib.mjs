import { chromium } from 'playwright-core';
export const BASE = process.env.BASE || 'http://127.0.0.1:4173';
export async function open(mobile = false) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  if (process.env.LAYERFIX) { await ctx.route(/sw\.js/, (r) => r.abort()); await ctx.route(/assets\/index-.*\.css$/, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: '@layer theme, base, components, utilities;' + await r.text() }); }); }
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
  return { browser, ctx, page, errors };
}
export async function controls(page) {
  return page.evaluate(() => [...document.querySelectorAll('button,a,input,select,[role=radio],[role=tab],[role=switch],[role=checkbox]')]
    .filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}${e.getAttribute('role') ? '{' + e.getAttribute('role') + '}' : ''} "${(e.innerText || e.getAttribute('aria-label') || e.name || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 60)}"${e.disabled ? ' DISABLED' : ''}`));
}
export const FORBID = [/dossier/i, /§/, /\bR-[A-Z]{2,}/, /MODEL_SPEC/, /\bWP\d/];
export async function forbidden(page) {
  const t = await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label')||'') + ' ' + (e.getAttribute('title')||'')).join('\n'));
  const hits = [];
  for (const re of FORBID) { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m; while ((m = g.exec(t))) hits.push(t.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ')); }
  return hits;
}
export const text = (page) => page.evaluate(() => document.body.innerText);
export async function firstRun(page, { sex = 'male', age = '40', height = '178', weight = '95' } = {}) {
  await page.goto(BASE + '/welcome'); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Get started' }).click(); await page.waitForTimeout(800);
  await page.getByRole('radio', { name: '18–64' }).click();
  const nos = page.getByRole('radio', { name: 'no', exact: true }); for (let i = 0; i < await nos.count(); i++) await nos.nth(i).click();
  await page.getByRole('button', { name: 'Continue' }).click(); await page.waitForTimeout(800);
  await page.getByLabel('I understand').check(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/body/); await page.waitForTimeout(1000);
  await page.getByRole('radio', { name: sex, exact: true }).click();
  const sp = page.getByRole('spinbutton');
  for (const [i, v] of [[0, age], [1, height], [2, weight]]) { await sp.nth(i).click(); await page.keyboard.press('Control+A'); await page.keyboard.type(v, { delay: 30 }); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.waitForTimeout(300); }
  await page.waitForTimeout(800);
}
