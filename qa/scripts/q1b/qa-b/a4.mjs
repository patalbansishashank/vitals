import { open, BASE, shot } from './lib.mjs';
const { browser, page, errors } = await open({ profile: process.argv[2] || 'p1' });
await page.goto(BASE + '/settings/devices', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const devSec = page.locator('section', { has: page.locator('h2', { hasText: 'Devices and streams' }) });
const cbs = devSec.locator('input[type=checkbox]');
const st = []; for (let i = 0; i < await cbs.count(); i++) st.push((await cbs.nth(i).getAttribute('aria-label') || 'x') + '=' + await cbs.nth(i).isChecked());
console.log('CB', st.join(' | '));
await page.getByRole('heading', { name: /Acme R1/ }).scrollIntoViewIfNeeded(); await shot(page, '06-devices-policies');
for (let i = 0; i < await cbs.count(); i++) { if (!(await cbs.nth(i).isChecked())) await cbs.nth(i).click({ force: true }).catch(()=>{}); }
await page.waitForTimeout(1000);
const st2 = []; for (let i = 0; i < await cbs.count(); i++) st2.push((await cbs.nth(i).getAttribute('aria-label') || 'x') + '=' + await cbs.nth(i).isChecked());
console.log('CB2', st2.join(' | '));
await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(3500);
const h = page.getByRole('heading', { name: 'Body signals' }); await h.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
await shot(page, '07-signals-allon');
console.log(await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => /Body signals/.test(x.innerText)); return (h.closest('section') || h.parentElement).innerText.replace(/\n+/g, ' / ').slice(0, 1500); }));
console.log('ERRORS', errors);
await browser.close();
