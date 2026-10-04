import { open, firstRun, controls, BASE, text, forbidden } from './lib.mjs';
const mobile = process.argv[2] === 'm';
const { browser, page, errors } = await open(mobile);
await firstRun(page);
await page.goto(BASE + '/simulate'); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Insert a water-only fast' }).click(); await page.waitForTimeout(500);
await page.getByRole('radio', { name: '72 h' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Insert fast' }).click().catch(async () => { await page.locator('.sim-pop__foot').getByRole('button', { name: 'Insert fast' }).click(); });
await page.waitForTimeout(800);
if (mobile) { await page.getByRole('gridcell').nth(9).click(); await page.waitForTimeout(1200); await page.screenshot({ path: 'qa/screenshots/sim-04-dayeditor-m.png' }); } else for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Next day' }).click(); await page.waitForTimeout(200); }
await page.getByRole('radio', { name: /^all \d+ A days/ }).click(); await page.waitForTimeout(300);
const sl = page.getByRole('slider', { name: /% of maintenance/ }); console.log('sliders', await sl.count());
await sl.first().focus(); await page.keyboard.press('Home'); await page.waitForTimeout(500);
console.log('slider now', await sl.first().getAttribute('aria-valuetext'));
await page.getByRole('button', { name: 'Add an extra session' }).click(); await page.waitForTimeout(800);
await page.getByRole('menuitem', { name: 'Resistance training' }).click(); await page.waitForTimeout(800);
const tag = mobile ? 'm' : 'd';
await page.screenshot({ path: `qa/screenshots/sim-01-schedule-${tag}.png` });
if (mobile) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } await page.locator('.sim-runkey:visible').first().click();
await page.waitForURL(/results/, { timeout: 60000 }); await page.waitForTimeout(6000);
await page.screenshot({ path: `qa/screenshots/sim-02-results-${tag}.png` });
console.log('URL', page.url());
console.log((await text(page)).slice(0, 8000));
console.log('FORBIDDEN', await forbidden(page));
const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(h => h && h.includes('evidence')))]);
console.log('EVIDENCE HREFS', hrefs.length, hrefs.slice(0, 15));
await page.locator('input[type=checkbox]').first().check();
await page.getByRole('button', { name: 'Show the projection' }).click(); await page.waitForTimeout(3000);
console.log('FORBIDDEN2', await forbidden(page));
await page.getByRole('radio', { name: 'visceral', exact: true }).first().click(); await page.waitForTimeout(1500);
const vv = page.getByTestId('rs-visceral'); await vv.scrollIntoViewIfNeeded();
const readV = async () => (await vv.innerText()).replace(/\s+/g, ' ').slice(0, 300);
console.log('VISCERAL END', await readV());
await page.screenshot({ path: `qa/screenshots/sim-03-visceral-${tag}${process.env.LAYERFIX ? '-lf' : ''}${process.env.BASE ? '-fix' : ''}.png` });
// hover the main chart at ~20% width
const svgs = await page.evaluate(() => [...document.querySelectorAll('svg')].map((s, i) => { const r = s.getBoundingClientRect(); return [i, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), s.getAttribute('class') || '', s.getAttribute('aria-label') || '']; }).filter(x => x[3] > 250));
console.log('SVGS', JSON.stringify(svgs));
const cands = await page.evaluate(() => [...document.querySelectorAll('canvas, [class*=plot], [class*=chart]')].map(e => { const r = e.getBoundingClientRect(); return [e.tagName, (e.getAttribute('class')||'').slice(0,50), Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[4] > 300 && x[5] > 100));
console.log('CANDS', JSON.stringify(cands.slice(0, 10)));
const dayLbl = async () => (await page.locator('.rs-figure').innerText()).split('\n').slice(0, 3).join(' | ');
const big = cands.find(c => c[0] !== 'svg') || cands[0];
if (big) {
  for (const f of [0.1, 0.5, 0.9]) {
    await page.evaluate((y) => window.scrollTo(0, y - 200), big[3]); await page.waitForTimeout(300);
    const box = await page.locator(`${big[0].toLowerCase()}`).filter({ hasNot: page.locator('xx') }).first().boundingBox();
    const y = big[3] - (await page.evaluate(() => scrollY)) + big[5] / 2;
    await page.mouse.move(big[2] + big[4] * f, y); await page.waitForTimeout(800);
    console.log('HOVER', f, await dayLbl(), '::', (await readV()).slice(0, 80));
  }
}
await page.getByRole('button', { name: 'Play' }).click(); await page.waitForTimeout(1000);
console.log('MIDPLAY', await dayLbl(), '::', (await readV()).slice(0, 80));
await page.waitForTimeout(2500);
console.log('AFTERPLAY', await dayLbl(), '::', (await readV()).slice(0, 80));
globalThis.__svgs = svgs;
console.log(errors); await browser.close();
