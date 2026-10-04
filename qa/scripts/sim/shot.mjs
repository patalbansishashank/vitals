import { open, firstRun, BASE } from './lib.mjs';
const { browser, page, errors } = await open(process.argv[3] === 'm');
await firstRun(page);
await page.screenshot({ path: '/media/DEV/tmp/sim-body.png' });
await page.goto(BASE + process.argv[2]); await page.waitForTimeout(4000);
await page.screenshot({ path: '/media/DEV/tmp/sim-shot.png' });
const css = await page.evaluate(() => [...document.styleSheets].map(s => (s.href||'inline').split('/').pop()));
console.log(css.join(' ')); console.log(errors); await browser.close();
