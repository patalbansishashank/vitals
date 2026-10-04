// Focused mobile shape mini-card clearance check in the SVG fallback renderer.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.BASE;
if (!base) throw new Error('Set BASE to the production preview URL');
const phase = process.argv[2] || 'after';
const root = path.resolve(import.meta.dirname, '../../..');
const out = path.join(root, '.e6-tmp/c-design');
const folder = path.join(out, phase);
fs.mkdirSync(folder, { recursive: true });
const origin = new URL(base).origin;
const state = JSON.parse(fs.readFileSync(path.join(out, 'synthetic-state.json'), 'utf8'));
state.origins = state.origins.map((entry) => ({ ...entry, origin }));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'] });
const rows = [];
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, storageState: state, serviceWorkers: 'block' });
    try {
      const page = await ctx.newPage();
      await page.goto(`${origin}/body?setup=shape&qa=1`, { waitUntil: 'domcontentloaded' });
      await page.locator('.lm-body[data-mode="shape"]').waitFor();
      const slider = page.locator('.lm-body-shape input[type=range]').first();
      await slider.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await slider.press('ArrowRight');
      await page.locator('.lm-body-mini[data-visible="true"]').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);
      const boxes = await page.evaluate(() => ({
        miniTop: document.querySelector('.lm-body-mini')?.getBoundingClientRect().top,
        headerBottom: document.querySelector('.lm-ctx')?.getBoundingClientRect().bottom,
      }));
      const gap = boxes.miniTop - boxes.headerBottom;
      const row = { scheme, ...boxes, gap, ok: gap >= 8 };
      rows.push(row);
      await page.screenshot({ path: path.join(folder, `body-shape-mini-390-${scheme}.png`), animations: 'disabled' });
      console.log(`${scheme}: mini/header gap ${gap}px ${row.ok ? 'ok' : 'FAIL'}`);
    } finally { await ctx.close(); }
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, `${phase}-mini.json`), JSON.stringify(rows, null, 2));
if (rows.some((row) => !row.ok)) process.exitCode = 1;
