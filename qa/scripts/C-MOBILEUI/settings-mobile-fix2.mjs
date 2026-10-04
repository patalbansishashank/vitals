// Synthetic mobile Settings layout proof. BASE and STATE are supplied locally.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { localConfig } from '../lib/localConfig.mjs';

const base = process.env.BASE || localConfig(['siteUrl']).siteUrl;
assert(process.env.STATE, 'Set STATE to the fresh synthetic storage-state file');
const state = JSON.parse(readFileSync(process.env.STATE, 'utf8'));
state.origins = state.origins.map((entry) => ({ ...entry, origin: new URL(base).origin }));
const out = process.env.OUT;
if (out) {
  assert(out.includes('.e6-tmp'), 'Screenshots must stay in an ignored synthetic folder');
  mkdirSync(out, { recursive: true });
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
let cases = 0;
try {
  for (const width of [360, 390]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
        storageState: state, serviceWorkers: 'block', colorScheme: theme,
      });
      await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.abort());
      const page = await context.newPage();
      for (const section of ['units', 'appearance', 'agents']) {
        await page.goto(new URL(`/settings/${section}?qa=1&theme=${theme}`, base).href);
        await page.locator(`#settings-${section}-title`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Match the companion touch-target patch without changing its shared source.
        // Verify containment both with current keys and with actual 44 px key bounds.
        for (const enlarged of [false, true]) {
          if (enlarged) await page.addStyleTag({ content:
            '@media (pointer: coarse) { .lm-bank__key { height: 44px; min-height: 44px; min-width: 44px; } }' });
          await page.waitForTimeout(350);
          const geometry = await page.evaluate((sectionId) => {
            const rect = (el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            };
            const nav = [...document.querySelectorAll('nav[aria-label="Settings sections"]')]
              .find((el) => el.getBoundingClientRect().height > 0);
            const rows = [...document.querySelectorAll('.settings-unit-rows > div, .settings-appearance-rows > div')].map((row) => {
              const text = row.firstElementChild;
              const control = row.lastElementChild;
              return { row: rect(row), text: rect(text), control: rect(control),
                bank: control.querySelector('.lm-bank') ? rect(control.querySelector('.lm-bank')) : null,
                keys: [...control.querySelectorAll('[role=radio]')].map(rect) };
            });
            const heading = document.querySelector(`#settings-${sectionId}-title`);
            return { nav: rect(nav), targets: [...nav.querySelectorAll('a')].map(rect),
              heading: rect(heading), rows, theme: document.documentElement.dataset.theme };
          }, section);
          const label = `${width}/${theme}/${section}/${enlarged ? '44px banks' : 'current banks'}`;
          assert.equal(geometry.theme, theme, label);
          for (const target of geometry.targets) {
            assert(target.height >= 44 && target.width >= 44, `${label}: nav target below 44px`);
          }
          assert(geometry.heading.top >= geometry.nav.bottom + 8 - 1, `${label}: sticky nav obscures deep-link heading`);
          assert(geometry.heading.bottom < 780, `${label}: deep-link heading outside content viewport`);
          for (const { row, text, control, bank, keys } of geometry.rows) {
            const gapX = control.left - text.right;
            const gapY = control.top - text.bottom;
            assert(gapX >= 12 - 0.5 || gapY >= 12 - 0.5, `${label}: label/control gap below 12px`);
            assert(control.left >= row.left - 1 && control.right <= row.right + 1, `${label}: control outside row`);
            assert(control.top >= row.top - 1 && control.bottom <= row.bottom + 1, `${label}: vertical containment`);
            if (bank) {
              assert(bank.left >= row.left - 1 && bank.right <= row.right + 1, `${label}: bank outside row`);
              for (const key of keys) {
                assert(key.left >= bank.left && key.right <= bank.right, `${label}: key outside bank`);
                if (enlarged) assert(key.height >= 44 && key.width >= 44, `${label}: shared touch-size fixture`);
              }
            }
          }
          cases++;
        }
        if (out) await page.screenshot({ path: `${out}/settings-${section}-${width}-${theme}.png` });
      }
      await context.close();
    }
  }
  console.log(`Settings mobile: ${cases} layout cases passed (360/390, light/dark, current/44px banks).`);
} finally {
  await browser.close();
}
