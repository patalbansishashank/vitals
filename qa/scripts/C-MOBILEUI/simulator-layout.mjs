import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

// Use a fresh synthetic storage state for every viewport and theme.
const base = process.env.BASE;
assert.ok(base, 'Set BASE to the preview origin');
assert.ok(process.env.SYNTHETIC_STATE, 'Set SYNTHETIC_STATE to the synthetic storage-state file');
const state = JSON.parse(await readFile(process.env.SYNTHETIC_STATE, 'utf8'));
for (const origin of state.origins) origin.origin = new URL(base).origin;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
});
const measurements = [];
try {
  for (const width of [360, 390, 1280]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        storageState: structuredClone(state),
        viewport: { width, height: width === 390 ? 844 : 800 },
        isMobile: width < 768,
        hasTouch: width < 768,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      for (const view of ['schedule', 'results']) {
        await page.goto(new URL(`/simulate/starter/${view}?theme=${theme}`, base).href);
        const rail = view === 'schedule' ? '.sim-summary__items' : '.rs-strip';
        await page.locator(rail).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.locator(rail).evaluate((root, view) => {
          const face = root.getBoundingClientRect();
          const items = Array.from(root.querySelectorAll('.lm-strip__item'));
          const selector = view === 'schedule'
            ? '.lm-eng, .sim-summary__big, .sim-summary__sub'
            : '.lm-readout__name, .lm-readout__value, .lm-readout__caption';
          return {
            face: { left: face.left, right: face.right },
            items: items.map((item) => {
              const bounds = item.getBoundingClientRect();
              return {
                width: bounds.width,
                overflow: item.scrollWidth - item.clientWidth,
                text: Array.from(item.querySelectorAll(selector)).flatMap((el) => {
                  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                  const rects = [];
                  while (walker.nextNode()) {
                    if (walker.currentNode.parentElement.closest('.lm-sr')) continue;
                    const range = document.createRange();
                    range.selectNodeContents(walker.currentNode);
                    for (const rect of range.getClientRects()) {
                      if (rect.width) rects.push({ left: rect.left, right: rect.right });
                    }
                  }
                  return rects;
                }),
              };
            }),
          };
        }, view);
        assert.ok(geometry.items.length >= 2, `${view}: expected metric panels`);
        // The two initial readouts must be readable without scrolling the rail.
        for (const item of geometry.items.slice(0, 2)) {
          assert.ok(item.overflow <= 1, `${width}/${theme}/${view}: panel overflow`);
          for (const rect of item.text) {
            assert.ok(rect.left >= geometry.face.left - 1 && rect.right <= geometry.face.right + 1,
              `${width}/${theme}/${view}: text outside face (${rect.right} > ${geometry.face.right})`);
          }
        }
        // Preserve the existing desktop dimensions and mobile rail above the narrow breakpoint.
        if (width === 390) {
          assert.equal(Math.round(geometry.items[0].width), view === 'schedule' ? 176 : 200);
        }
        if (width === 360) {
          assert.ok(Math.abs(geometry.items[0].width * 2 -
            (geometry.face.right - geometry.face.left)) <= 2);
        }
        measurements.push({ width, theme, view, panelWidth: geometry.items[0].width });
        if (process.env.SCREENSHOT_DIR) {
          await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `simulator-${view}-${width}-${theme}.png`) });
        }
      }
      await context.close();
    }
  }
  console.log(JSON.stringify({ status: 'passed', measurements }, null, 2));
} finally {
  await browser.close();
}
