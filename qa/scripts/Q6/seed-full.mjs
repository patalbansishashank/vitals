// Seeds the Q6 "full" profile: imports the q1b export, answers the screener, finds plans for fat mass + strength and
// starts the selected rung today (E23's path), so every Living screen has content. Further layers: seed-extra.mjs.
import { openProfile, go, dump, read, ROOT, sleep } from './lib.mjs';
const { page, errors, close } = await openProfile('full');
await go(page, '/settings');
await page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first().setInputFiles(`${ROOT}/qa/fixtures/q1b/export-m-veg.json`);
await page.getByRole('radio', { name: 'replace' }).check();
await page.getByRole('button', { name: 'Import', exact: true }).click();
await sleep(2500);
await go(page, '/plan/goals');
if (page.url().includes('/welcome')) {
  await page.getByRole('radio', { name: '18–64' }).click();
  const fs = page.locator('fieldset');
  const n = await fs.count();
  for (let i = 1; i < n; i++) { const no = fs.nth(i).getByRole('radio', { name: 'no', exact: true }); if (await no.count()) await no.first().click(); }
  await page.getByRole('button', { name: 'Save answers' }).click();
  await sleep(2000);
  await go(page, '/plan/goals');
}
// markers typed by hand (LDL high, HbA1c) so the ladder and Food carry "because your …" chips
await go(page, '/onboarding/markers', { wait: 2500 });
await page.getByRole('button', { name: /^Type the values/ }).click(); await sleep(1500);
await page.getByLabel('lipids, tested on').fill('2026-09-14');
await page.getByLabel('LDL cholesterol, value').fill('172');
await sleep(400);
await page.getByRole('button', { name: /^Save \d+ value/ }).click(); await sleep(2000);
console.log('markers', JSON.stringify((await read(page, 'markers.get')).doc.readings.map((r) => [r.markerId ?? r.id, r.value])));
await go(page, '/plan/goals');
await dump(page, 'goals');
const find = page.getByRole('button', { name: /Find plans/ });
if (await find.getAttribute('aria-disabled')) {
  await page.getByRole('button', { name: 'Fat mass ↓' }).click();
  await page.getByRole('button', { name: 'Strength index ↑' }).click();
}
await find.click();
const start = page.getByRole('button', { name: /^(Start this plan|Replace active plan…)$/ });
await start.first().waitFor({ timeout: 300000 });
await sleep(3000);
await dump(page, 'results');
await start.first().click();
await sleep(1500);
await page.getByRole('radio', { name: /^today/ }).last().click();
await sleep(400);
await page.getByRole('button', { name: /^(Start plan|Replace active plan…)$/ }).last().click();
await sleep(3000);
await go(page, '/today');
// logs: weigh-in, breakfast and lunch as planned
await page.getByLabel('weight').fill('91.4'); await page.keyboard.press('Enter'); await sleep(800);
// the meal names depend on the seeded plan's day; mark the first two meals that offer it (Q11: lunch is not always one)
for (let i = 0; i < 2; i++) { const b = page.getByRole('button', { name: /^Mark .+ as planned$/ }).first(); if (!(await b.count())) break; await b.click(); await sleep(800); }
// pantry: a few items
await go(page, '/food/pantry', { wait: 2000 });
await dump(page, 'pantry');
const chips = page.locator('main [role=checkbox][aria-checked=false]');
for (let i = 0; i < 6 && i < (await chips.count()); i++) { await chips.nth(i).click(); await sleep(250); }
const done = page.getByRole('button', { name: /^(Done|Save)/ });
if (await done.count()) { await done.first().click(); await sleep(1000); }
await go(page, '/today');
await dump(page, 'today');
const plan = await read(page, 'plan.get', {}).catch((e) => e.message);
console.log('plan.get', JSON.stringify(plan).slice(0, 300));
console.log('ERRORS', errors);
await close();
