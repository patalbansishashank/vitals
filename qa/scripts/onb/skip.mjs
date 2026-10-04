import { open, BASE, shot } from './lib.mjs';
import { run } from './steps.mjs';
import fs from 'node:fs';
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { browser, page, errors } = await open({ mobile: process.argv[3] === 'mobile' });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await run(page, steps);
const main = page.locator('main');
for (let i = 0; i < 10 && /onboarding\/(activity|training|food|diet|devices)/.test(page.url()); i++) {
  console.log('at', new URL(page.url()).pathname);
  const sk = main.getByRole('button', { name: 'Skip this part' }); if (!(await sk.count())) { const np = main.getByText(/^(Next part|See what we.ll use)$/).or(main.getByRole('button', { name: /Next part/ })).or(main.getByRole('link', { name: /Next part/ })); if (await np.count()) { await np.first().click(); await page.waitForTimeout(1200); continue; } console.log('NO SKIP; text:', (await main.innerText()).slice(0, 1500)); const btns = await main.getByRole('button').allInnerTexts(); console.log('BTNS', btns.slice(-8).join(' | ')); break; }
  await sk.click(); await page.waitForTimeout(1200);
  const t = await page.evaluate(() => document.body.innerText.match(/Skipped[^\n]*/)?.[0]); if (t) console.log('toast:', t);
  const c = main.getByRole('button', { name: /continue|Next/i }); if (/activity/.test(page.url()) && await c.count()) { console.log('activity after skip:', (await main.innerText()).slice(0, 900)); await c.first().click(); await page.waitForTimeout(1200); }
}
console.log('URL', page.url());
await shot(page, process.argv[3] === 'mobile' ? 'x-summary-m' : 'x-summary');
console.log((await main.innerText()).slice(0, 2500));
const b = main.getByRole('button', { name: /Looks right/ }); if (await b.count()) { await b.first().click(); await page.waitForTimeout(1500); console.log('AFTER', page.url(), (await main.innerText()).slice(0, 1200)); }
console.log('ERRORS', errors);
await browser.close();
