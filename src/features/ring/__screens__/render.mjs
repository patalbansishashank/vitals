// Render the Ring and sleep screens over the seeded Gauge data (`fixtures.ts`, the owner's readings) at phone
// (390 × 844 @2x) and desktop (1440 × 900).
// Usage: start Vite on 4189 (`npx vite --port 4189 --strictPort`), then
//   node src/features/ring/__screens__/render.mjs [outDir]
// Needs playwright-core and a Chromium at /usr/bin/chromium (or CHROMIUM=…). The tab sets `__VITALS_GAUGE_DEMO__`
// (development builds only), so the screens read the demo client and an in-memory Gauge command channel.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/step1/screens-v4b';
const BASE = process.env.RING_BASE ?? 'http://localhost:4196';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const ALL_SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'w288', width: 288, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'phone-quiet', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, quiet: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
// SIZES=phone,w288,phone-quiet picks the sizes (default phone and desktop)
const SIZES = ALL_SIZES.filter((s) => (process.env.SIZES ? process.env.SIZES.split(',') : ['phone', 'desktop']).includes(s.name));

/** [name, path, optional action before the shot]. */
const SHOTS = [
  ['overview', '/ring'],
  ['overview-monitor', '/ring', async (p) => p.getByRole('button', { name: /^(Edit|Add signals)$/ }).click()],
  ['sleep', '/ring/sleep'],
  ['sleep-contributors', '/ring/sleep', async (p) => p.getByRole('button', { name: 'What went into it' }).first().click()],
  ['sleep-page', '/sleep'],
  ['activity', '/ring/activity'],
  ['scores', '/ring/scores'],
  ['scores-target', '/ring/scores', async (p) => p.getByRole('button', { name: 'Edit target' }).click()],
  ['activity-steps-sources', '/ring/activity', async (p) => p.locator('.rg-move__lineage').first().click()],
  ['sleep-lights-out', '/ring/sleep', async (p) => p.getByRole('button', { name: 'Add lights-out time' }).click()],
  ['signal-hr', '/ring/signals/hr', async (p) => p.getByRole('button', { name: 'Measure now' }).first().click()],
  ['signal-hr-day', '/ring/signals/hr'],
  ['signal-stress', '/ring/signals/stress'],
  ['signal-hrv', '/ring/signals/hrv'],
  ['signal-temp', '/ring/signals/temp'],
  ['workout', 'RUN'],
  ['short-videos', '/ring/short-videos'],
  ['short-videos-editor', '/ring/short-videos', async (p) => p.getByRole('button', { name: 'Change limit' }).click()],
];

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--force-color-profile=srgb'] });
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.deviceScaleFactor, isMobile: s.isMobile, hasTouch: s.hasTouch, reducedMotion: 'reduce', colorScheme: 'dark' });
    // TEXTURE=raw: the demo with the owner's raw texture (minute stage flips, spiky minute readings; r064 VIZ)
    if (process.env.TEXTURE) await ctx.addInitScript((t) => (window.__VITALS_GAUGE_DEMO_TEXTURE__ = t), process.env.TEXTURE);
    await ctx.addInitScript(() => {
      window.__VITALS_GAUGE_DEMO__ = true;
      // before 04:00 the demo's last night is still running: shoot at 12:00 of the same day (time still flows)
      const RealDate = Date;
      if (new RealDate().getHours() < 4) {
        const noon = new RealDate();
        noon.setHours(12, 0, 0, 0);
        const offset = noon.getTime() - RealDate.now();
        class ShiftedDate extends RealDate {
          constructor(...a) {
            if (a.length === 0) super(RealDate.now() + offset);
            else super(...a);
          }
          static now() {
            return RealDate.now() + offset;
          }
        }
        window.Date = ShiftedDate;
      }
    });
    const page = await ctx.newPage();
    // AT=2026-10-28T19:40:00: shoot at a fixed wall-clock time (timers still run)
    if (process.env.AT) await page.clock.setFixedTime(new Date(process.env.AT));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    // clear the first-run gate once (Settings sits outside it), as the tests' `seedClearedSafety` does
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const m = await import('/src/features/onboarding/testing.ts');
      m.seedClearedSafety();
      // a body profile, so the workout zones have an HRmax (Tanaka from the age)
      const b = await import('/src/state/profileStore.ts');
      const st = b.useProfileStore.getState();
      st.setSex('male');
      st.setAge(36);
      st.setHeight(178);
      st.setWeight(80);
      const p = await import('/src/state/persistence.ts');
      p.flushPersistence?.();
    });
    if (s.quiet) {
      await page.evaluate(async () => {
        const c = await import('/src/commands/index.ts');
        await c.dispatch('settings.update', { patch: { quietMode: true } });
        const p = await import('/src/state/persistence.ts');
        p.flushPersistence?.();
      });
    }
    await page.waitForTimeout(800);
    let runPath = null;
    for (const [name, path, act] of SHOTS) {
      if (ONLY && !ONLY.includes(name)) continue;
      let to = path;
      if (path === 'RUN') {
        if (!runPath) {
          await page.goto(`${BASE}/ring/activity`, { waitUntil: 'networkidle' });
          await settle(page);
          runPath = await page.evaluate(() => [...document.querySelectorAll('a[href^="/ring/workouts/run-"]')][0]?.getAttribute('href') ?? null);
        }
        if (!runPath) continue;
        to = runPath;
      }
      await page.setViewportSize({ width: s.width, height: s.height });
      await page.goto(`${BASE}${to}`, { waitUntil: 'networkidle' });
      await settle(page);
      if (act) {
        try {
          await act(page);
        } catch (e) {
          console.error(`${name}-${s.name}: ${String(e).split('\n')[0]}`);
          continue;
        }
        await page.waitForTimeout(act.toString().includes('Measure') ? 3200 : 700);
      }
      const file = join(OUT, `${name}-${s.name}.png`);
      if (act && name !== 'signal-hr' && name !== 'sleep-contributors') {
        await page.screenshot({ path: file });
      } else {
        // the grain is fixed to the viewport, so the viewport holds the whole page
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: s.width, height: Math.max(s.height, h) });
        await page.waitForTimeout(300);
        await page.screenshot({ path: file });
      }
      console.log(file);
    }
    if (errors.length) console.error(`${s.name} errors:\n${[...new Set(errors)].join('\n')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
