// Render V4e's screens to PNG: phone 390×844 @2x and desktop 1440×900.
// Usage: start Vite on 4191 (`npx vite --port 4191 --strictPort`), then
//   node src/features/living/progress/__screens__/render.mjs [outDir]
// Needs playwright-core and a Chromium at /usr/bin/chromium (or CHROMIUM=…).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/step1/screens-v4e';
const BASE =
  process.env.V4E_BASE ?? 'http://127.0.0.1:4191/src/features/living/progress/__screens__/screens.html';
const SHOTS = [
  { name: 'progress', q: 'page=progress' },
  { name: 'progress-quiet', q: 'page=progress&quiet=1' },
  { name: 'progress-no-weigh-in', q: 'page=progress&scene=no-weigh-in' },
  { name: 'progress-empty', q: 'page=progress&scene=empty' },
  { name: 'heart', q: 'page=heart' },
  { name: 'heart-rest', q: 'page=heart&rest=58' },
  { name: 'settings', q: 'page=settings' },
];
const SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  args: ['--force-color-profile=srgb', '--no-sandbox'],
});
try {
  for (const s of SIZES) {
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.name)) continue;
      const ctx = await browser.newContext({
        viewport: { width: s.width, height: s.height },
        deviceScaleFactor: s.deviceScaleFactor,
        isMobile: s.isMobile,
        hasTouch: s.hasTouch,
        reducedMotion: 'reduce',
        colorScheme: 'dark',
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${BASE}?${shot.q}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      if (process.env.OPEN) {
        for (const label of process.env.OPEN.split(','))
          await page
            .getByRole('button', { name: label })
            .first()
            .click()
            .catch(() => {});
        await page.waitForTimeout(200);
      }
      const file = join(OUT, `${shot.name}-${s.name}.png`);
      // the card grain is fixed to the viewport, so the viewport holds the whole page
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: s.width, height: Math.max(s.height, h) });
      await page.waitForTimeout(200);
      await page.screenshot({ path: file });
      console.log(file);
      if (errors.length) console.error(`${shot.name}-${s.name} errors:\n${errors.join('\n')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
