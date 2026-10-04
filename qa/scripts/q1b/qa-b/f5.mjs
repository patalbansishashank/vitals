import { open, BASE, shot, text } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const mode = async (m) => fetch('http://127.0.0.1:4193/__mode', { method: 'POST', body: JSON.stringify({ mode: m }) });
const { browser, page, errors } = await open({ mobile, profile: 'p1' });
await page.clock.install({ time: new Date('2026-10-02T12:00:00') });
const meals = async (n = 3500) => { const t = await text(page, 12000); const i = t.indexOf('Meals'); return t.slice(i, i + n).replace(/\n+/g, ' / '); };
await mode('ok');
await page.goto(BASE + '/food', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Plan my day' }).click();
await page.getByText('QA dal bowl').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
console.log('RECIPES', await meals());
await shot(page, mobile ? '25-food-recipes-m' : '24-food-recipes');
// open lunch recipe sheet
const open1 = page.getByRole('button', { name: /recipe|open|›|details/i }); console.log('open btns', await open1.count());
const names = await page.locator('main button').evaluateAll(bs => bs.map(b => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ').trim()).filter(Boolean));
console.log('BUTTONS', names.join(' | ').slice(0, 1500));
console.log('ERRORS', errors);
await browser.close();
