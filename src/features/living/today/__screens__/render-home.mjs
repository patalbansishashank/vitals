// 0.6.3 "Today is home in every mode": Today without a plan (Planning mode) and with one (Living), each with the ring
// reachable (the seeded demo) and unreachable (no demo, no server: the one quiet line), at phone 390×844 @2x and desktop
// 1440×900. Usage: start Vite on 4192 (`npx vite --port 4192 --strictPort`; another port through V4C_BASE), then
//   node src/features/living/today/__screens__/render-home.mjs [outDir]
// Same harness page as ./render.mjs (screens.html), with `plan=none` for Planning mode.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/r063/screens-today';
const BASE = process.env.V4C_BASE ?? 'http://localhost:4192/src/features/living/today/__screens__/screens.html';
const DAY = process.env.V4C_DAY ?? '2026-10-27';
const SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
const SCENES = [
  { id: 'planning', plan: 'none', ring: true },
  { id: 'planning-offline', plan: 'none', ring: false },
  { id: 'living', plan: 'live', ring: true },
  { id: 'living-offline', plan: 'live', ring: false },
  { id: 'planning-nobody', plan: 'none', ring: true, body: 'none' },
  { id: 'planning-quiet', plan: 'none', ring: true, quiet: true },
  { id: 'living-quiet', plan: 'live', ring: true, quiet: true },
];

mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--force-color-profile=srgb', '--no-sandbox'] });
let failed = 0;
try {
  for (const s of SIZES) {
    for (const sc of SCENES) {
      if (only && !only.includes(sc.id)) continue;
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.deviceScaleFactor, isMobile: s.isMobile, hasTouch: s.hasTouch, reducedMotion: 'reduce', colorScheme: 'dark', serviceWorkers: 'block' });
      await ctx.addInitScript((demo) => {
        window.__VITALS_GAUGE_DEMO__ = demo;
      }, sc.ring);
      // TEXTURE=raw: the demo with the owner's raw texture (r064 VIZ)
      if (process.env.TEXTURE) await ctx.addInitScript((t) => (window.__VITALS_GAUGE_DEMO_TEXTURE__ = t), process.env.TEXTURE);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(`${DAY}T13:20:00`));
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        const qs = `scene=pending&time=13:20${sc.plan === 'none' ? '&plan=none' : ''}${sc.body === 'none' ? '&body=none' : ''}${sc.quiet ? '&quiet=1' : ''}`;
        await page.goto(`${BASE}?${qs}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);
        const file = join(OUT, `${sc.id}-${s.name}.png`);
        await page.screenshot({ path: file });
        console.log(file);
        // the rest of the page, a viewport at a time (a full-page capture resizes the viewport and the charts with it)
        for (let n = 2; n <= 8; n++) {
          const before = await page.evaluate(() => window.scrollY);
          await page.mouse.wheel(0, s.height - 160);
          await page.waitForTimeout(500);
          if ((await page.evaluate(() => window.scrollY)) <= before) break;
          const f = join(OUT, `${sc.id}-${s.name}-${n}.png`);
          await page.screenshot({ path: f });
          console.log(f);
        }
      } catch (e) {
        failed++;
        console.error(`${sc.id} ${s.name}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: join(OUT, `FAILED-${sc.id}-${s.name}.png`) }).catch(() => undefined);
      }
      if (errors.length) console.error(`${sc.id} ${s.name} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
