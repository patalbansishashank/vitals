import { open, dump, BASE } from './lib.mjs';
const { browser, page, errors } = await open();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await dump(page, 'start');
console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
console.log(errors);
await browser.close();
