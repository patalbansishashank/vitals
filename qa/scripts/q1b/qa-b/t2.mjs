import { open, BASE, shot, text } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, page, errors } = await open({ mobile, profile: process.argv[3] || 'p1' });
await page.clock.install({ time: new Date('2026-10-02T10:00:00') });
const p = (...a) => console.log(...a);
const T = async (n = 1500) => (await text(page, 6000)).replace(/\n+/g, ' / ').slice(0, n);
await page.goto(BASE + '/train', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Swap push-up' }).click(); await page.waitForTimeout(1200);
p('SHEET role dialog count', await page.getByRole('dialog').count(), 'aside/complementary', await page.locator('[aria-modal],[role=complementary]').count());
p('SHEET', (await page.locator('body').innerText()).split('Swap push-up')[1]?.replace(/\n+/g, ' / ').slice(0, 1800));
await shot(page, mobile ? '12-swap-sheet-m' : '11-swap-sheet');
await page.getByRole('button', { name: 'Use' }).nth(2).click(); await page.waitForTimeout(1500);
p('AFTER SWAP', await T(1800));
await shot(page, mobile ? '14-after-swap-m' : '12-after-swap');
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
p('AFTER RELOAD', await T(1800));
await shot(page, mobile ? '15-reload-m' : '13-after-reload');
if (!mobile) {
await page.getByRole('button', { name: 'Session done' }).click(); await page.waitForTimeout(1500);
p('SESSION DONE', await T(2500));
await shot(page, '14-session-done');
const dd = page.getByRole('dialog'); if (await dd.count()) p('DIALOG', (await dd.innerText()).replace(/\n+/g, ' / ').slice(0, 800));
const conf = page.getByRole('button', { name: /^(Save|Confirm|Log|Done|Yes)/i }); p('confirm btns', await conf.count());
}
p('ERRORS', errors);
await browser.close();
