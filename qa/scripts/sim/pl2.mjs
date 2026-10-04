import { open, BASE, text, forbidden, controls } from './lib.mjs';
import { planSetup, runPlan, abcHits } from './plib.mjs';
import fs from 'node:fs';
const mobile = process.argv[2] === 'm'; const tag = mobile ? 'm' : 'd';
const { browser, page, errors } = await open(mobile);
await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
await planSetup(page);
await runPlan(page);
const check = async (label) => { const t = await text(page); const f = await forbidden(page); const a = abcHits(t); console.log(`CHECK ${label}: forbidden=${JSON.stringify(f.slice(0, 4))} abc=${JSON.stringify(a.slice(0, 6))}`); return t; };
await check('cards');
if (mobile) await page.screenshot({ path: `qa/screenshots/sim-23-ladder-m.png` });
await page.getByRole('radio', { name: 'table', exact: true }).click(); await page.waitForTimeout(1500);
let t = await check('table'); fs.writeFileSync(`/media/DEV/tmp/pl-table-${tag}.txt`, t);
await page.screenshot({ path: `qa/screenshots/sim-24-table-${tag}.png` });
await page.getByRole('radio', { name: 'cards', exact: true }).click(); await page.waitForTimeout(1000);
for (const tab of ['days', 'curves', 'limits', 'safety']) {
  await page.getByRole('tab', { name: tab, exact: true }).click(); await page.waitForTimeout(1500);
  t = await check('tab ' + tab); fs.writeFileSync(`/media/DEV/tmp/pl-tab-${tab}-${tag}.txt`, t);
  if (tab === 'days') {
    const pb = page.getByRole('button', { name: /Print day by day/ });
    if (await pb.count()) { await pb.click(); await page.waitForTimeout(2500); const pt = await page.evaluate(() => document.body.innerText); console.log('PRINTED', await page.evaluate(() => window.__printed)); console.log('PRINT abc', JSON.stringify(abcHits(pt).slice(0, 5))); fs.writeFileSync(`/media/DEV/tmp/pl-print-${tag}.txt`, pt); }
  }
}
await page.getByRole('tab', { name: 'overview', exact: true }).click(); await page.waitForTimeout(800);
// Open in Simulator from Hard
await page.getByRole('button', { name: 'Open in Simulator' }).first().click(); await page.waitForTimeout(3000);
console.log('OPEN IN SIM ->', page.url()); t = await check('simulator from plan'); console.log(t.replace(/\s+/g, ' ').slice(0, 500));
await page.screenshot({ path: `qa/screenshots/sim-25-opensim-${tag}.png` });
await page.goBack(); await page.waitForTimeout(2500);
console.log('BACK ->', page.url());
const st = page.getByRole('button', { name: 'Start this plan' }).first();
if (await st.count()) { await st.click(); await page.waitForTimeout(2000); const d = page.getByRole('dialog'); console.log('START DIALOG', await d.count(), (await d.count()) ? (await d.first().innerText()).replace(/\s+/g, ' ').slice(0, 800) : ''); await page.screenshot({ path: `qa/screenshots/sim-26-start-${tag}.png` }); console.log('start forbidden', await forbidden(page), abcHits(await text(page)).slice(0, 4)); }
else console.log('NO START BUTTON after back', (await controls(page)).slice(0, 30));
console.log(errors); await browser.close();
