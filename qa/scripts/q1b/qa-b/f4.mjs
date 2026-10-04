import { open, BASE, text } from './lib.mjs';
const { browser, page, errors } = await open({ profile: 'p1' });
await page.goto(BASE + '/onboarding/diet', { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
let prev = '';
for (let i = 0; i < 20; i++) {
  const q = await page.locator('legend').first().innerText().catch(() => '');
  const btns = await page.locator('main button').evaluateAll(bs => bs.map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  console.log(i, 'Q:', q, '||', btns.slice(5, 22).join(' | '));
  if (!q) break;
  if (q === prev) { console.log('stuck'); break; } prev = q;
  const opts = page.locator('main button').filter({ hasNotText: /^(Change|Add|Done|ask me later|Back|Skip|Switch)/ });
  const pref = opts.filter({ hasText: /^(none|no|default|\(default\))$/i });
  const doneBtn = page.locator('main button', { hasText: /^Done/ });
  if (await pref.count()) await pref.first().click(); else await opts.nth(0).click();
  await page.waitForTimeout(500);
  if (await doneBtn.count() && !(await doneBtn.first().getAttribute('aria-disabled'))) await doneBtn.first().click();
  await page.waitForTimeout(1200);
}
console.log((await text(page, 3000)).replace(/\n+/g, ' / ').slice(0, 800));
console.log('ERRORS', errors);
await browser.close();
