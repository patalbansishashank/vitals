import { chromium, newPage, bootApp, install, shot, goRoute } from './lib.mjs';
import { onboard } from '../j1/onboard.mjs';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const { page } = await newPage(browser);
await bootApp(page); await onboard(page, () => {}); await bootApp(page, '/'); await install(page);
await page.evaluate(() => __j7.ring('jstyle2301', 'QA0001'));
for (const r of ['/ring', '/settings#devices']) {
  await goRoute(page, r); await page.waitForTimeout(1500);
  const sw = await page.evaluate(() => [...document.querySelectorAll('[role=switch],input[type=checkbox]')].map((e) => ({ n: e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.closest('div')?.innerText.slice(0, 50), c: e.getAttribute('aria-checked') ?? e.checked })));
  console.log('==', r, JSON.stringify(sw).slice(0, 1500));
  console.log((await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 1800));
}
await shot(page, 'explore.png'); await browser.close();
