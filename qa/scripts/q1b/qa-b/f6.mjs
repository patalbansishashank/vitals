import { open, BASE, shot, text } from './lib.mjs';
const { browser, page, errors } = await open({ profile: 'p1' });
await page.clock.install({ time: new Date('2026-10-02T12:00:00') });
await page.goto(BASE + '/food', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
console.log('PERSISTED RECIPES AFTER RELOAD?', (await text(page, 3000)).includes('QA dal bowl'));
if (!(await text(page, 3000)).includes('QA dal bowl')) { await page.getByRole('button', { name: 'Plan my day' }).click(); await page.getByText('QA dal bowl').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1000); }
await page.getByRole('button', { name: 'Open breakfast details' }).click(); await page.waitForTimeout(1500);
const t = await text(page, 9000);
const body = await page.locator('body').innerText();
console.log('SHEET', body.slice(body.indexOf('QA dal bowl', body.indexOf('QA dal bowl') + 20)).replace(/\n+/g, ' / ').slice(0, 2200));
await shot(page, '26-recipe-sheet');
console.log('ERRORS', errors);
await browser.close();
