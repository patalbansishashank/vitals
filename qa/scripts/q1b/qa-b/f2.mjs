import { open, BASE, shot, text } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const mode = async (m) => fetch('http://127.0.0.1:4193/__mode', { method: 'POST', body: JSON.stringify({ mode: m }) });
const { browser, page, errors } = await open({ mobile, profile: 'p1' });
await page.clock.install({ time: new Date('2026-10-02T12:00:00') });
const meals = async () => { const t = await text(page, 9000); const i = t.indexOf('Meals'); return t.slice(i, i + 2600).replace(/\n+/g, ' / '); };
await page.goto(BASE + '/food', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
console.log('WITH PROVIDER', (await meals()).slice(0, 500));
// error state
await mode('error');
await page.getByRole('button', { name: 'Plan my day' }).click(); await page.waitForTimeout(4000);
console.log('ERROR STATE', (await meals()).slice(0, 900)); await shot(page, mobile ? '23-food-error-m' : '23-food-error');
// loading state
await mode('slow');
const retry = page.getByRole('button', { name: /Plan my day|Try again|Retry/ }).first(); console.log('retry btn text', await retry.innerText());
await retry.click(); await page.clock.runFor?.(0).catch(()=>{}); await page.waitForTimeout(2000);
console.log('LOADING STATE', (await meals()).slice(0, 900)); await shot(page, mobile ? '22-food-loading-m' : '22-food-loading');
await page.waitForTimeout(8000);
console.log('AFTER SLOW', (await meals()).slice(0, 1500));
console.log('ERRORS', errors);
await browser.close();
