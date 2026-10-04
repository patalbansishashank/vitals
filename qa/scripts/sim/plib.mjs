import { BASE, firstRun } from './lib.mjs';
export const ABC = /\b([Pp]lan|[Oo]ption|[Rr]ung|[Ss]cenario)s? [ABC]\b|(^|\n)\s*[ABC] ·|\b[ABC] vs\b|\bvs [ABC]\b|constraints\.[a-zA-Z]+|\bundefined\b|\bNaN\b/g;
export const abcHits = (t) => [...t.matchAll(ABC)].map(m => t.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' '));
export async function planSetup(page, { goals = [/^Autophagy signal.*add as a goal/, 'Fat mass ↓'], longest = '72 h', optIn = true, log = console.log } = {}) {
  await firstRun(page);
  await page.goto(BASE + '/plan'); await page.waitForTimeout(2500);
  if (optIn) {
    await page.getByText('Safety settings').first().click(); await page.waitForTimeout(500);
    await page.getByRole('switch', { name: /allow fasts over 24 hours/ }).click({ force: true }); await page.waitForTimeout(800);
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('radio', { name: 'no' }).first().click(); await page.waitForTimeout(300);
    await dlg.getByRole('radio', { name: 'yes' }).nth(1).click(); await page.waitForTimeout(500);
    await dlg.getByRole('radio', { name: 'up to 72 hours' }).click(); await page.waitForTimeout(300);
    const cbs = dlg.getByRole('checkbox'); for (let i = 0; i < await cbs.count(); i++) await cbs.nth(i).check({ force: true });
    await dlg.getByRole('button', { name: 'Allow longer fasts' }).click(); await page.waitForTimeout(800);
  }
  for (const g of goals) {
    if (typeof g === 'string') await page.getByRole('button', { name: g, exact: true }).click();
    else { await page.getByRole('button', { name: 'Add a goal' }).click(); await page.waitForTimeout(600); await page.getByRole('button', { name: g }).click(); await page.keyboard.press('Escape'); }
    await page.waitForTimeout(600);
  }
  const pre = async () => (await page.locator('main').innerText()).match(/Before you run[\s\S]{0,900}?(?=Practical limits)/)?.[0]?.replace(/\n+/g, ' / ');
  log('PREFLIGHT before longest:', await pre());
  if (longest) { await page.getByRole('radio', { name: longest, exact: true }).click(); await page.waitForTimeout(1500); log('PREFLIGHT after ' + longest + ':', await pre()); }
}
export async function runPlan(page, log = console.log) {
  const t0 = Date.now();
  await page.getByRole('button', { name: /Find plans/ }).click();
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(3000);
    const tx = await page.locator('main').innerText();
    if (/results/.test(page.url()) && !/Optimiser progress/.test(tx)) break;
  }
  log('RUNTIME', Math.round((Date.now() - t0) / 1000), 's', page.url());
  await page.waitForTimeout(1500);
}
