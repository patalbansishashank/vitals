// Render the viz gallery to PNG at phone (390 @2x) and desktop (1280) widths.
// Usage: start Vite on 4188 (`pnpm vite --port 4188 --strictPort`), then
//   node src/components/viz/__gallery__/render.mjs [outDir]
// Needs playwright-core and a Chromium at /usr/bin/chromium (or CHROMIUM=…).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/step1/viz';
const BASE = process.env.VIZ_BASE ?? 'http://localhost:4188/src/components/viz/__gallery__/gallery.html';
const IDS = (process.env.IDS ?? 'tick,dots,stat,trace,hypno,strip,share,level,arc,disc,monitor').split(',');
const SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--force-color-profile=srgb'] });
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.deviceScaleFactor, isMobile: s.isMobile, hasTouch: s.hasTouch, reducedMotion: 'reduce', colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const id of IDS) {
      await page.goto(`${BASE}?only=${id}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const file = join(OUT, `${id}-${s.name}.png`);
      if (id === 'monitor') await page.screenshot({ path: file });
      else {
        // the card grain is fixed to the viewport, so the viewport must hold the whole card
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: s.width, height: Math.max(s.height, h) });
        await page.locator(`[data-gallery="${id}"]`).screenshot({ path: file });
        await page.setViewportSize({ width: s.width, height: s.height });
      }
      console.log(file);
    }
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const sheet = join(OUT, `sheet-${s.name}.png`);
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: s.width, height: full });
    await page.screenshot({ path: sheet });
    console.log(sheet);
    if (errors.length) console.error(`${s.name} errors:\n${errors.join('\n')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
