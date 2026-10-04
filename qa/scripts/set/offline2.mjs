import { open, BASE, shot, firstRun } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, ctx, page, errors } = await open({ mobile });
await firstRun(page);
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(4000);
await page.reload({ waitUntil: 'networkidle' });
console.log('controller', await page.evaluate(() => !!navigator.serviceWorker.controller));
await ctx.setOffline(true);
await page.goto(BASE + '/body', { waitUntil: 'load' }); await page.waitForTimeout(2500);
console.log('body offline h1:', await page.evaluate(() => document.querySelector('h1')?.innerText), '|', (await page.evaluate(() => document.querySelector('main')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 160));
const links = await page.evaluate(() => [...document.querySelectorAll('nav a, header a')].filter(a => a.offsetParent).map(a => a.innerText.trim() || a.getAttribute('aria-label')).filter(Boolean));
console.log('nav links', links);
for (const n of ['simulate', 'plan', 'evidence', 'settings', 'body']) {
  try { await page.getByRole('link', { name: n, exact: true }).first().click({ timeout: 8000 }); await page.waitForTimeout(2500); console.log('nav', n, new URL(page.url()).pathname, '|', (await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)).replace(/\s+/g, ' ').slice(0, 100)); } catch (e) { console.log('nav fail', n, e.message.split('\n')[0]); }
}
// open an evidence item
await page.goto(BASE + '/evidence', { waitUntil: 'load' }); await page.waitForTimeout(2000);
const first = page.locator('main a[href^="/evidence/"]').first();
if (await first.count()) { await first.click(); await page.waitForTimeout(2500); console.log('evidence item', new URL(page.url()).pathname, (await page.evaluate(() => document.querySelector('main')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 120)); }
await shot(page, `offline-evidence-${mobile ? 'm' : 'd'}`);
await ctx.setOffline(false);
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy|INTERNET_DISCONNECTED/.test(e)));
await browser.close();
