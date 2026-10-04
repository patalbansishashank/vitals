import { chromium } from 'playwright-core';
export const BASE = process.env.BASE || 'http://127.0.0.1:4173';
export const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
export const DESKTOP = { viewport: { width: 1280, height: 800 } };
function wire(page, errors) {
  page.setDefaultTimeout(30000);
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
}
export async function open({ mobile = false, args = [] } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', ...args] });
  const ctx = await browser.newContext({ ...(mobile ? MOBILE : DESKTOP), acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; wire(page, errors);
  return { browser, ctx, page, errors };
}
export async function openPersistent(dir, { mobile = false } = {}) {
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], ...(mobile ? MOBILE : DESKTOP), acceptDownloads: true });
  const page = ctx.pages()[0] || await ctx.newPage(); const errors = []; wire(page, errors);
  return { ctx, page, errors };
}
export async function dump(page, label = '', sel = 'main') {
  const info = await page.evaluate((sel) => {
    const root = document.querySelector(sel) || document.body;
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = el => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const hs = [...root.querySelectorAll('h1,h2,h3,legend')].filter(vis).map(h => h.tagName + ':' + name(h));
    const ctl = [...root.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=switch],[role=radio]')].filter(vis).map(e => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}${e.checked ? '{x}' : ''}${e.disabled ? '{dis}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search + location.hash, hs, ctl };
  }, sel);
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
export const text = (page, sel = 'main', n = 3000) => page.evaluate(([s, n]) => (document.querySelector(s) || document.body).innerText.slice(0, n), [sel, n]);
export const shot = (page, name) => page.screenshot({ path: `qa/screenshots/set-${name}.png` });
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
