// E18: SupplementRow at 390 / 768 / 1440 px in light and dark (Settings › Supplements), with an overlap check.
// Run against a preview build: BASE=http://127.0.0.1:5183 node qa/scripts/e18/supplement-rows.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5183';
const WIDTHS = [
  { w: 390, h: 844, mobile: true },
  { w: 768, h: 1024, mobile: true },
  { w: 1440, h: 900, mobile: false },
];
const THEMES = ['light', 'dark'];

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];
let failed = false;
for (const { w, h, mobile } of WIDTHS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/settings#supplements`, { waitUntil: 'networkidle' });
    const sec = page.locator('section#supplements');
    await sec.waitFor();
    for (const name of ['Creatine monohydrate', 'Whey protein', 'Vitamin D3', 'Caffeine']) {
      await sec.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(150);
    }
    await sec.getByLabel('Something else').fill('shilajit');
    await sec.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(200);
    // creatine: taking in the morning; vitamin D: morning and night; whey: have it; caffeine: not for me; shilajit: have it
    await sec.getByRole('button', { name: 'Creatine monohydrate in the morning' }).click();
    await sec.getByRole('button', { name: 'Vitamin D3 in the morning' }).click();
    await sec.getByRole('button', { name: 'Vitamin D3 at night' }).click();
    const setState = async (name, label) => {
      const group = sec.getByRole('group', { name, exact: true });
      const radio = group.getByRole('radio', { name: label, exact: true });
      if (await radio.count()) await radio.click();
      else await group.locator('select').first().selectOption({ label });
      await page.waitForTimeout(250);
    };
    await setState('Whey protein', 'have it, don’t take');
    await setState('Caffeine', 'not for me');
    await setState('shilajit', 'have it, don’t take');
    await page.waitForTimeout(800);

    // overlap check: inside each row, the visible boxes of the name block, the dose field, the unit, the time keys and
    // the state control must not intersect and must stay inside the row
    const report = await page.evaluate(() => {
      const out = [];
      for (const row of document.querySelectorAll('section#supplements .lm-supprow')) {
        const rr = row.getBoundingClientRect();
        const parts = [
          ...row.querySelectorAll('.lm-supprow__title, .lm-supprow__dosefield, .lm-supprow__unit, .lm-supprow__each, .lm-supprow__bank .lm-bank__key, .lm-supprow__state > *'),
        ].filter((e) => e.getBoundingClientRect().width > 0);
        const boxes = parts.map((e) => ({ e: e.className || e.tagName, r: e.getBoundingClientRect() }));
        const name = row.querySelector('.lm-supprow__name')?.textContent;
        for (const b of boxes) if (b.r.left < rr.left - 1 || b.r.right > rr.right + 1) out.push(`${name}: ${b.e} outside the row`);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].r;
            const b = boxes[j].r;
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 1 && iy > 1) out.push(`${name}: ${boxes[i].e} overlaps ${boxes[j].e}`);
          }
        // controls sit on the right: beside the name they start after it; on their own line they end at the row's right
        const dose = row.querySelector('.lm-supprow__dosefield')?.getBoundingClientRect();
        const ctl = row.querySelector('.lm-supprow__controls')?.getBoundingClientRect();
        const title = row.querySelector('.lm-supprow__left')?.getBoundingClientRect();
        if (dose && ctl && title) {
          const ownLine = dose.top >= title.bottom - 1;
          const kids = [...row.querySelectorAll('.lm-supprow__controls > *')].map((e) => e.getBoundingClientRect().right);
          if (!ownLine && dose.left < title.right - 1) out.push(`${name}: dose field left of the name`);
          if (ownLine && Math.abs(Math.max(...kids) - rr.right) > 2) out.push(`${name}: controls not at the right (${Math.round(rr.right - Math.max(...kids))} px short)`);
        }
      }
      const scroll = document.documentElement.scrollWidth > window.innerWidth + 1 ? ['page scrolls sideways'] : [];
      return [...out, ...scroll];
    });
    // a viewport taller than the section, so the sticky header never covers it; no focus ring on the skip link
    await page.setViewportSize({ width: w, height: Math.max(h, Math.ceil((await sec.boundingBox()).height) + 400) });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await sec.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const file = `qa/screenshots/E18-supplement-rows-${w}-${theme}.png`;
    await sec.screenshot({ path: file });
    results.push({ w, theme, problems: report, errors });
    if (report.length || errors.length) failed = true;
    await ctx.close();
  }
}
await browser.close();
for (const r of results) console.log(`${r.w} ${r.theme}: ${r.problems.length ? r.problems.join('; ') : 'no overlap'}${r.errors.length ? ` · errors: ${r.errors.join(' | ')}` : ''}`);
process.exit(failed ? 1 : 0);
