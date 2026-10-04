import { open, BASE } from './lib.mjs';
const { browser, page, errors } = await open({});
page.on('requestfailed', r => console.log('FAILED', r.url(), r.failure()?.errorText));
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await page.goto(BASE + (process.argv[2] || '/settings'), { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
console.log('ERRORS', errors);
await browser.close();
