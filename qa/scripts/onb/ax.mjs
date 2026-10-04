import { open, BASE } from './lib.mjs';
const { browser, page } = await open();
await page.goto(BASE + '/welcome?step=screening', { waitUntil: 'networkidle' });
const snap = await page.locator('main').ariaSnapshot();
console.log(snap.slice(0, 2000));
await browser.close();
