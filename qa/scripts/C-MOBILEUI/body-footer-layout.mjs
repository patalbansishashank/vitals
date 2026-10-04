import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.BASE;
const statePath = process.env.STATE;
assert(base && statePath, 'Provide BASE and STATE for a fresh synthetic storage state');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const width of [360, 390]) for (const theme of ['light', 'dark']) {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.origins.forEach((origin) => { origin.origin = new URL(base).origin; });
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, colorScheme: theme, storageState: state, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(new URL('/body?setup=shape', base).href);
    await page.locator('.lm-actionbar button').first().waitFor();
    await page.evaluate(async (value) => { document.documentElement.dataset.theme = value; await document.fonts.ready; }, theme);
    const measured = await page.evaluate(() => {
      const bar = document.querySelector('.lm-actionbar');
      const rect = bar.getBoundingClientRect();
      const main = document.querySelector('.lm-main');
      const gutter = parseFloat(getComputedStyle(bar).getPropertyValue('--lm-gutter'));
      return {
        gutter, barHeight: rect.height, barBottom: rect.bottom,
        tabTop: document.querySelector('.lm-tabbar').getBoundingClientRect().top,
        reserved: parseFloat(getComputedStyle(document.querySelector('.lm-app')).getPropertyValue('--lm-actionbar-h')),
        paddingBottom: parseFloat(getComputedStyle(main).paddingBottom),
        buttons: [...bar.querySelectorAll('button')].map((button) => {
          const box = button.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          return { label: button.textContent, left: box.left, right: box.right, height: box.height, textLeft: text.left, textRight: text.right, clientWidth: button.clientWidth, scrollWidth: button.scrollWidth };
        }),
      };
    });
    if (process.env.OUT) { await mkdir(process.env.OUT, { recursive: true }); await page.screenshot({ path: `${process.env.OUT}/body-shape-${width}-${theme}.png` }); }
    console.log(JSON.stringify({ width, theme, ...measured }));
    assert.equal(measured.buttons.length, 3);
    for (const button of measured.buttons) {
      assert(button.left >= measured.gutter - 0.5 && button.right <= width - measured.gutter + 0.5, `${button.label}: viewport gutters`);
      assert(button.height >= 44, `${button.label}: touch target`);
      assert(button.textLeft >= button.left && button.textRight <= button.right && button.scrollWidth <= button.clientWidth, `${button.label}: complete label`);
    }
    assert(measured.barBottom <= measured.tabTop + 0.5, 'Footer clears bottom navigation');
    assert(measured.reserved >= measured.barHeight, 'Shell reserves the full footer height');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await page.evaluate(() => document.querySelector('.lm-body').lastElementChild.getBoundingClientRect().bottom <= document.querySelector('.lm-actionbar').getBoundingClientRect().top);
    assert(clearance, 'Last content scrolls completely above footer');
    await context.close();
  }
} finally { await browser.close(); }
