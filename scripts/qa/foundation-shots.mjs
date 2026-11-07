// r068 design foundation: shoot the key pages at phone (390 × 844 @2x) and desktop (1440 × 900), each as a viewport
// series (a full-page capture resizes the viewport and the charts with it).
// Usage: start Vite (`npx vite --port 4310 --strictPort`), then
//   node scripts/qa/foundation-shots.mjs <outDir>
// Living pages (Today, Food, Train) run on the dev harness (living/today/__screens__: the fixture plan on the in-memory
// stand-in); the Ring and Settings run in the real app over the seeded Gauge demo (`__VITALS_GAUGE_DEMO__`, dev only).
// Needs playwright-core and Chromium at /usr/bin/chromium (or CHROMIUM=…). ONLY=today,ring picks shots; SIZES=phone.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/tmp/foundation-shots';
const BASE = process.env.BASE ?? 'http://localhost:4310';
const HARNESS = `${BASE}/src/features/living/today/__screens__/screens.html?scene=pending&time=13:20`;
const DAY = process.env.DAY ?? '2026-10-27';
const PAGES = Number(process.env.PAGES ?? 3);
const ALL_SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
const SIZES = ALL_SIZES.filter((s) => (process.env.SIZES ? process.env.SIZES.split(',') : ['phone', 'desktop']).includes(s.name));
const SHOTS = [
  { name: 'today', url: `${HARNESS}&view=today` },
  { name: 'food', url: `${HARNESS}&view=food` },
  { name: 'train', url: `${HARNESS}&view=train` },
  { name: 'ring', url: `${BASE}/ring`, app: true },
  { name: 'ring-sleep', url: `${BASE}/ring/sleep`, app: true },
  { name: 'settings', url: `${BASE}/settings`, app: true },
];
const ONLY = process.env.ONLY?.split(',');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--force-color-profile=srgb', '--no-sandbox'] });
let failed = 0;
try {
  for (const s of SIZES) {
    for (const shot of SHOTS) {
      if (ONLY && !ONLY.includes(shot.name)) continue;
      const ctx = await browser.newContext({
        viewport: { width: s.width, height: s.height },
        deviceScaleFactor: s.deviceScaleFactor,
        isMobile: s.isMobile,
        hasTouch: s.hasTouch,
        reducedMotion: 'reduce',
        colorScheme: 'dark',
        serviceWorkers: 'block',
      });
      await ctx.addInitScript(() => {
        window.__VITALS_GAUGE_DEMO__ = true;
      });
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(`${DAY}T13:20:00`));
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      try {
        if (shot.app) {
          // clear the first-run gate once (Settings sits outside it), as the tests' `seedClearedSafety` does
          await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
          await page.evaluate(async () => {
            const m = await import('/src/features/onboarding/testing.ts');
            m.seedClearedSafety();
            const b = await import('/src/state/profileStore.ts');
            const st = b.useProfileStore.getState();
            st.setSex('male');
            st.setAge(36);
            st.setHeight(178);
            st.setWeight(80);
            const p = await import('/src/state/persistence.ts');
            p.flushPersistence?.();
          });
          await page.waitForTimeout(500);
        }
        await page.goto(shot.url, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: join(OUT, `${shot.name}-${s.name}.png`) });
        for (let n = 2; n <= PAGES; n++) {
          const before = await page.evaluate(() => window.scrollY);
          await page.mouse.wheel(0, s.height - 160);
          await page.waitForTimeout(600);
          if ((await page.evaluate(() => window.scrollY)) <= before) break;
          await page.screenshot({ path: join(OUT, `${shot.name}-${s.name}-${n}.png`) });
        }
        console.log(`${shot.name}-${s.name}`);
      } catch (e) {
        failed++;
        console.error(`${shot.name} ${s.name}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: join(OUT, `FAILED-${shot.name}-${s.name}.png`) }).catch(() => undefined);
      }
      if (errors.length) console.error(`${shot.name} ${s.name} errors:\n  ${[...new Set(errors)].slice(0, 5).join('\n  ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
