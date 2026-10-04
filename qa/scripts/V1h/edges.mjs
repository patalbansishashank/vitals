// V1h: edge routes (bad dates, unknown ids) and fast navigation on the seeded profile; prints h1, notable text, errors.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const WT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5194';
const PROF = `${WT}/.e6-tmp/v1h-prof-e`;
fs.rmSync(PROF, { recursive: true, force: true });
fs.cpSync('/media/DEV/Hobby/Lumen Health/.e6-tmp/q6-profiles/full', PROF, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROF, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = ctx.pages()[0];
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
const R = (process.env.ROUTES || '/today/2020-01-01,/today/2031-05-05,/today/garbage,/food/2020-01-01,/food/xx,/train/2099-01-01,/train/zz,/progress/nonsense,/coach/unknown-id,/plan/active/versions/999,/plan/active/versions/abc,/evidence/no-such-mechanism,/evidence/topics/no-such-topic,/settings/bogus,/simulate/nope/results,/simulate/nope/schedule,/onboarding/bogus').split(',');
for (const r of R) {
  errs = [];
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const i = await page.evaluate(() => ({ url: location.pathname, h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).join(' | '), txt: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 220) }));
  console.log(JSON.stringify({ r, ...i, errs }));
}
// fast navigation through the tab bar
errs = [];
await page.goto(BASE + '/today', { waitUntil: 'networkidle' });
for (let k = 0; k < 3; k++) for (const n of ['Food', 'Train', 'Coach', 'Progress', 'Today']) { await page.getByRole('link', { name: n, exact: true }).first().click({ timeout: 3000 }).catch((e) => errs.push('nav ' + n + ': ' + e.message.slice(0, 80))); await page.waitForTimeout(60); }
await page.waitForTimeout(2500);
console.log('fastnav', page.url(), JSON.stringify(errs), await page.evaluate(() => document.querySelector('h1')?.textContent));
await ctx.close();
