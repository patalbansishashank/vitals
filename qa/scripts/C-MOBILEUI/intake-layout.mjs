// Run with BASE and SYNTHETIC_STATE pointing to a dev preview and fresh synthetic storage state.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

assert(process.env.BASE, 'Set BASE to the preview origin');
assert(process.env.SYNTHETIC_STATE, 'Set SYNTHETIC_STATE to fresh synthetic storage state');
const base = new URL(process.env.BASE);
const state = JSON.parse(await readFile(process.env.SYNTHETIC_STATE, 'utf8'));
state.origins = state.origins.map((entry) => ({ ...entry, origin: base.origin }));
const output = process.env.OUT ?? '.e6-tmp/c-mobileui/intake-layout';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  for (const width of [360, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
        isMobile: width < 768,
        hasTouch: width < 768,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      try {
        // Keep this proof local: no sync or other external requests.
        await context.route(/^https?:\/\//, (route) =>
          new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort(),
        );
        const page = await context.newPage();
        await page.goto(new URL(`/onboarding/activity?theme=${theme}`, base).href);
        const table = page.locator('.lm-ik-table').first();
        await table.waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await table.getByRole('rowheader', { name: 'training', exact: true }).count(), 1);
        assert.match(await table.innerText(), /4 sessions a week/);
        assert.match(await table.innerText(), /about a tenth of what you eat/);

        const report = await table.evaluate((element) => {
          const problems = [];
          const rows = [...element.querySelectorAll('tbody tr')];
          const amounts = [];
          const sources = [];
          for (const row of rows) {
            const rr = row.getBoundingClientRect();
            const cells = [...row.children].map((cell) => ({ cell, rect: cell.getBoundingClientRect() }));
            for (const { rect } of cells) {
              if (rect.left < rr.left - 1 || rect.right > rr.right + 1) problems.push('cell outside row');
            }
            for (let i = 0; i < cells.length; i++) {
              for (let j = i + 1; j < cells.length; j++) {
                const a = cells[i].rect;
                const b = cells[j].rect;
                if (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
                )
                  problems.push('overlapping cells');
              }
            }
            const amount = row.querySelector('.lm-ik-num');
            if (amount) {
              amounts.push(amount.getBoundingClientRect().right);
              if (getComputedStyle(amount).textAlign !== 'right') problems.push('amount not right aligned');
            }
            const source = row.querySelector('.lm-ik-table__source');
            sources.push(source.getBoundingClientRect().width);
            const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              for (const match of node.textContent.matchAll(/[\p{L}\p{N}]+/gu)) {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                const lines = new Set(
                  [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
                );
                if (lines.size > 1) problems.push(`word split across lines: ${match[0]}`);
              }
            }
            const button = row.querySelector('button');
            if (button) {
              const br = button.getBoundingClientRect();
              if (
                br.left < rr.left - 1 ||
                br.right > rr.right + 1 ||
                br.top < rr.top - 1 ||
                br.bottom > rr.bottom + 1
              )
                problems.push('Change outside row');
              if (innerWidth < 768 && (br.width < 44 || br.height < 44))
                problems.push('Change touch target too small');
            }
            if (innerWidth >= 768 && getComputedStyle(row).display !== 'table-row')
              problems.push('desktop table density changed');
          }
          if (Math.max(...amounts) - Math.min(...amounts) > 1) problems.push('amount column misaligned');
          if (
            document.documentElement.scrollWidth > innerWidth + 1 ||
            element.scrollWidth > element.clientWidth + 1
          )
            problems.push('horizontal scroll');
          return {
            problems,
            sourceWidths: sources.map(Math.round),
            rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
          };
        });
        assert.deepEqual(report.problems, [], `${width} ${theme}: ${report.problems.join('; ')}`);

        // Verify the action is reachable in the scrolled viewport without changing an answer.
        const change = table.getByRole('button', { name: 'Change: training', exact: true });
        await change.scrollIntoViewIfNeeded();
        await change.click({ trial: true });
        await change.focus();
        assert.equal(await change.evaluate((button) => button === document.activeElement), true);
        await change.evaluate((button) => button.blur());

        if (width < 768) {
          await table.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `maintenance-${width}-${theme}.png`) });
          // A tall synthetic viewport also records the complete maintenance section.
          const section = page.locator('.lm-ik-result').first();
          const box = await section.boundingBox();
          await page.setViewportSize({ width, height: Math.ceil(box.height) + 400 });
          await section.scrollIntoViewIfNeeded();
          await section.evaluate((element) => {
            const stickyBottom = Math.max(
              0,
              ...[...document.querySelectorAll('.lm-topbar, .lm-ctx-slot')].map(
                (header) => header.getBoundingClientRect().bottom,
              ),
            );
            const delta = element.getBoundingClientRect().top - stickyBottom - 16;
            window.scrollBy(0, delta);
          });
          await section.screenshot({ path: path.join(output, `maintenance-${width}-${theme}-section.png`) });
        }
        console.log(JSON.stringify({ width, theme, ...report }));
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
