// Seeds the Q6 "intake" profile through the real first-run UI: screening, consent, body, then three answers in the
// activity chapter (an intake in progress). intake.get is printed to confirm the state.
import { openProfile, go, dump, read, btn, sleep } from './lib.mjs';
const { page, errors, close } = await openProfile('intake');
await go(page, '/welcome', { wait: 1500 });
await btn(page, 'Get started').first().click(); await sleep(1000);
await page.getByRole('radio', { name: '18–64' }).click(); await sleep(300);
for (let r = 0; r < 5; r++) { const l = page.getByRole('radio', { name: 'no', exact: true }); const n = await l.count(); let c = 0; for (let i = 0; i < n; i++) if ((await l.nth(i).getAttribute('aria-checked')) !== 'true') { await l.nth(i).click(); c++; await sleep(150); } if (!c) break; }
await dump(page, 'screening');
await page.getByRole('button', { name: /^(Continue|Save answers)/ }).first().click(); await sleep(1500);
await dump(page, 'consent');
await page.locator('input[type=checkbox]').first().check(); await btn(page, 'Continue').first().click(); await sleep(2500);
await dump(page, 'body');
await page.getByRole('radio', { name: 'male', exact: true }).or(btn(page, 'male')).first().click();
const t = page.locator('main input[type=text]:visible');
for (const [i, v] of [[0, '35'], [1, '175'], [2, '92']]) { await t.nth(i).click(); await page.keyboard.press('Control+a'); await page.keyboard.type(v, { delay: 30 }); await page.keyboard.press('Tab'); await sleep(200); }
await btn(page, 'Next: shape').first().click(); await sleep(1500);
await btn(page, 'Skip for now').first().click(); await sleep(2000);
await dump(page, 'after body');
await go(page, '/onboarding/activity', { wait: 2000 });
for (let k = 0; k < 3; k++) {
  const card = page.locator('fieldset').first();
  const keys = card.locator('button[aria-pressed]');
  if (await keys.count()) await keys.nth(1).click(); else break;
  await sleep(900);
  const next = btn(page, 'Next');
  if ((await next.count()) && !(await next.first().getAttribute('aria-disabled'))) { await next.first().click().catch(() => {}); await sleep(700); }
}
await dump(page, 'intake');
const i = await read(page, 'intake.get', {}).catch((e) => e.message);
console.log('intake', JSON.stringify(i).slice(0, 400));
console.log('ERRORS', errors);
await close();
