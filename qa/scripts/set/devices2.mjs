import { open, BASE, shot, dump } from './lib.mjs';
const { browser, page, errors } = await open({ mobile: process.argv[2] === 'mobile' });
await page.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const sec = page.locator('section#devices');
await sec.locator('input[type=file]').setInputFiles('src/biometrics/importers/__fixtures__/canonical.csv');
for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); const t = await page.evaluate(() => [...document.querySelectorAll('.lm-toast, [data-sonner-toast], [role=status]')].map(e => e.innerText).filter(t => t && !/Sync status|No AI provider|Companion status/.test(t))); if (t.length) { console.log('TOAST', t); break; } }
const state = () => sec.evaluate(s => [...s.querySelectorAll('[role=radiogroup], .lm-bank')].map(g => (g.getAttribute('aria-label') || g.getAttribute('aria-labelledby') || '') + ':' + [...g.querySelectorAll('button')].map(b => b.innerText + (b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('/')));
console.log('coach state', await state());
await sec.getByRole('radio', { name: 'daily', exact: true }).first().click();
await page.waitForTimeout(1000); console.log('after daily click', await state()); await Promise.resolve().catch(e => console.log('switch click', e.message.split('\n')[0]));
await page.waitForTimeout(1000);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
console.log('after reload coach state', await state());
console.log('switches', await sec.getByRole('switch').evaluateAll(es => es.slice(0, 3).map(e => (e.getAttribute('aria-label') || '') + '=' + (e.getAttribute('aria-checked') ?? e.checked))));
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy|GL Driver|404|CONNECTION_REFUSED/.test(e)));
await browser.close();
