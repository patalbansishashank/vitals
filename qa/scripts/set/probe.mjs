import { open, BASE } from './lib.mjs';
const { browser, page } = await open({});
await page.goto(BASE + '/settings/sync', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
console.log(page.url(), (await page.evaluate(()=>document.body.innerText)).slice(0,400)); console.log(await page.evaluate(() => { const s = document.getElementById('sync'); return s ? s.outerHTML.slice(0, 3000) : 'no #sync; ids=' + [...document.querySelectorAll('[id]')].map(x => x.id).join(','); }));
await browser.close();
