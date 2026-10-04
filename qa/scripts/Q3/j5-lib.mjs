// J5 helpers: one planner search (quick tier, the default "Find plans") and Start on a level.
import { seed, go, read, sleep } from './lib.mjs';
export const GOALS = ['Fat mass ↓', 'Lean tissue (protein-based): keep'];
/** Seeds the returning user, picks two goals and a 2-month horizon, runs "Find plans" (quick tier). Returns secs. */
export async function search(page, { limits, goals = GOALS } = {}) {
  await seed(page);
  await go(page, '/plan/goals'); await sleep(1000);
  for (const g of goals) await page.getByRole('button', { name: g }).click();
  await page.locator('button').filter({ hasText: /^2 mo$/ }).first().click();
  if (limits) await limits(page);
  const t0 = Date.now();
  await page.getByRole('button', { name: /Find plans/ }).first().click();
  await page.getByRole('button', { name: 'Start this plan' }).first().waitFor({ timeout: 600000 });
  await sleep(1500);
  return (Date.now() - t0) / 1000;
}
/** Selects a rung card ('Hard' | 'Medium' | 'Easy') and starts it today. */
export async function startRung(page, title) {
  // desktop/tablet: the ladder strip's "Select X plan" keys; mobile: the rail's position dots ("Plan n of N: X")
  await page.getByRole('button', { name: new RegExp(`^(Select ${title} plan|Plan \\d of \\d: ${title})`) }).first().evaluate((el) => el.click());
  await sleep(600);
  await page.getByRole('button', { name: 'Start this plan' }).first().click();
  await sleep(800);
  await page.locator('button').filter({ hasText: /^today$/ }).first().click();
  await page.getByRole('button', { name: 'Start plan', exact: true }).click();
  await page.waitForURL(/\/today/, { timeout: 60000 });
  await sleep(2500);
  return read(page, 'plan.get');
}
/** In-app navigation through the nav bar (keeps the QA hook's event list). */
export async function nav(page, name) {
  await page.locator(`a[href="/${name}"], a[href^="/${name}?"]`).filter({ visible: true }).first().click();
  await sleep(2000);
}
export const committed = (page) => page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed').map((e) => e.commandId ?? e.id));
