// E19: "Suggest from my answers" proposal card at 390 / 768 / 1440 px, light and dark.
// BASE=http://127.0.0.1:5184 node qa/scripts/e19/shots.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const errors = [];
for (const width of [390, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const click = async (name, o = {}) => {
    const loc = page.getByRole('button', { name, exact: true, ...o }).or(page.getByRole('radio', { name, exact: true, ...o })).or(page.getByRole('link', { name, exact: true, ...o }));
    await loc.first().click();
    await page.waitForTimeout(o.wait ?? 500);
  };
  const type = async (name, value) => {
    const el = page.getByRole('textbox', { name }).or(page.getByRole('spinbutton', { name })).first();
    await el.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(String(value), { delay: 20 });
    await page.keyboard.press('Tab');
  };
  // safety screening (all "no") and Your body basics
  await click('Get started');
  for (let i = 0; i < 40; i++) {
    const g = page.locator('[role=radiogroup]:not(:has([aria-checked=true]))').first();
    if (!(await g.count())) break;
    const r = g.getByRole('radio', { name: /^(no|18–64)$/ });
    if (await r.count()) await r.first().click();
    else await g.getByRole('radio').first().click();
  }
  await click('Continue');
  await page.getByRole('checkbox', { name: 'I understand' }).first().check();
  await click('Continue', { wait: 1500 });
  await click('male');
  await type('age', 38);
  await type('height', 178);
  await type('weight', 92);
  await page.goto(BASE + '/plan/goals', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Suggest from my answers' }).click();
  await page.getByText('missing', { exact: true }).waitFor();
  await page.waitForTimeout(600);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    const card = page.getByRole('article', { name: /Suggested goals/ });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `qa/screenshots/E19-card-${width}-${theme}.png` });
    if (theme === 'light') await page.screenshot({ path: `qa/screenshots/E19-page-${width}.png` });
    // overlap check: every goal's reason starts below its target line
    const bad = await card.evaluate((el) =>
      [...el.querySelectorAll('.lp-sg__goal')].filter((g) => {
        const h = g.querySelector('.lp-sg__head').getBoundingClientRect();
        const w = g.querySelector('.lp-sg__why').getBoundingClientRect();
        return w.top < h.bottom - 1 || w.right > el.getBoundingClientRect().right + 1;
      }).length,
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${width} ${theme}: overlapping rows ${bad}, page overflow ${overflow}`);
  }
  await ctx.close();
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
