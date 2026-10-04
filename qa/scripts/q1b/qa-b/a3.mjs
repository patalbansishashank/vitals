import { open, BASE, shot, text } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, page, errors } = await open({ mobile, profile: process.argv[3] || 'p1' });
const sec = () => page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => /Body signals/.test(x.innerText)); return (h.closest('section') || h.parentElement).innerText; });
await page.goto(BASE + '/settings/devices', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const devSec = page.locator('section', { has: page.locator('h2', { hasText: 'Devices and streams' }) });
console.log('DEV checkboxes', await devSec.locator('input[type=checkbox]').count());
const vend = devSec.getByLabel(/vendor scores/i);
console.log('vendor label count', await vend.count());
const last = devSec.locator('input[type=checkbox]').last();
console.log('vendor toggle checked?', await last.isChecked());
await vend.click({ force: true }).catch(e => console.log('click fail', e.message.slice(0, 100))); console.log('now', await last.isChecked());
await page.waitForTimeout(800);

await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(3000);
const h = page.getByRole('heading', { name: 'Body signals' }); await h.scrollIntoViewIfNeeded();
await page.waitForTimeout(500); await shot(page, mobile ? '05-signals-mobile' : '04-signals-vendor');
console.log('SIGNALS last night', await sec());
for (const r of ['7 days', '28 days']) { await page.getByText(r, { exact: true }).first().click(); await page.waitForTimeout(800); console.log('RANGE', r, (await sec()).slice(0, 1200)); }
await shot(page, mobile ? '06-signals28-mobile' : '05-signals-28');
console.log('ERRORS', errors);
await browser.close();
