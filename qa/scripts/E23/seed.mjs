// Seeds the E23 profile (.e6-tmp/e23-profile): import the q1b export, answer the current screener, find plans for
// two goals (fat mass, strength) and start the selected rung today, so Train has sessions to log and swap.
import { open, go, dump, ROOT } from './lib.mjs';
const { ctx, page, errors } = await open(1440);
await go(page, '/settings');
await page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first().setInputFiles(`${ROOT}/qa/fixtures/q1b/export-m-veg.json`);
await page.getByRole('radio', { name: 'replace' }).check();
await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.waitForTimeout(2500);
await go(page, '/plan/goals');
if (page.url().includes('/welcome')) {
  // the export predates the current screener: answer it (18–64, no to every question)
  await page.getByRole('radio', { name: '18–64' }).click();
  const fs = page.locator('fieldset');
  const n = await fs.count();
  for (let i = 1; i < n; i++) { const no = fs.nth(i).getByRole('radio', { name: 'no', exact: true }); if (await no.count()) await no.first().click(); }
  await page.getByRole('button', { name: 'Save answers' }).click();
  await page.waitForTimeout(2000);
  await go(page, '/plan/goals');
}
const find = page.getByRole('button', { name: /Find plans/ });
if (await find.getAttribute('aria-disabled')) {
  await page.getByRole('button', { name: 'Fat mass ↓' }).click();
  await page.getByRole('button', { name: 'Strength index ↑' }).click();
}
await find.click();
const start = page.getByRole('button', { name: /^(Start this plan|Replace active plan…)$/ });
await start.first().waitFor({ timeout: 180000 });
await start.first().click();
await page.waitForTimeout(1500);
await page.getByRole('radio', { name: /^today/ }).last().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^(Start plan|Replace active plan…)$/ }).last().click();
await page.waitForTimeout(1500);
const ad = page.getByRole('alertdialog');
if (await ad.count()) {
  const word = ((await ad.innerText()).match(/type\s+[“"']?([A-Za-z]+)[”"']?/i) || [])[1] || 'replace';
  const inp = ad.locator('input');
  if (await inp.count()) await inp.first().fill(word);
  await ad.getByRole('button').last().click();
  await page.waitForTimeout(3000);
}
await go(page, '/train');
await dump(page, 'train');
console.log('ERRORS', errors);
await ctx.close();
