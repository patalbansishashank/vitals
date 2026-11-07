// Render the V4d screens (Food targets, Train rest day, Log an activity, Something else, a swap) at phone 390×844 @2x
// and desktop 1440×900. Usage: start Vite on 4190 (`npx vite --port 4190 --strictPort`), then
//   node src/features/living/train/__screens__/render.mjs [outDir]
// Needs playwright-core and a Chromium at /usr/bin/chromium (or CHROMIUM=…).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/step1/screens-v4d';
const BASE = process.env.V4D_BASE ?? 'http://localhost:4190/src/features/living/train/__screens__/screens.html';
const SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

/** The open sheet (phone) or side panel (desktop). */
const panel = (page) => page.locator('dialog[open], [role="dialog"]:visible, aside.lm-sidepanel:visible').first();

/** Open the header's one ⋯ and pick an item. */
async function menu(page, item) {
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: item }).click();
}

const SCENES = [
  { id: 'food-targets', path: '/food' },
  { id: 'food-targets-empty', path: '/food/2026-10-02' },
  { id: 'train-rest', path: '/train' },
  {
    id: 'train-log-common',
    path: '/train',
    act: async (page) => {
      await page.getByRole('button', { name: 'Log an activity' }).first().click();
      await panel(page).waitFor();
    },
  },
  {
    id: 'train-log-walk',
    path: '/train',
    act: async (page) => {
      await page.getByRole('button', { name: 'Log an activity' }).first().click();
      const d = panel(page);
      await d.getByRole('textbox').first().fill('treadmill incline walk 40 min');
      await d.getByRole('button', { name: /^Treadmill incline walk/ }).first().click();
      await d.getByRole('spinbutton', { name: 'Speed' }).fill('5.5');
      await d.getByRole('spinbutton', { name: 'Speed' }).press('Tab');
      await d.getByRole('spinbutton', { name: 'Incline' }).fill('6');
      await d.getByRole('spinbutton', { name: 'Incline' }).press('Tab');
      await d.getByRole('radio', { name: 'Moderate' }).click();
    },
  },
  {
    id: 'train-log-quiet',
    path: '/train',
    quiet: true,
    act: async (page) => {
      await page.getByRole('button', { name: 'Log an activity' }).first().click();
      const d = panel(page);
      await d.getByRole('button', { name: /^Air bike/ }).first().click();
      await d.getByRole('radio', { name: 'Hard' }).click();
    },
  },
  {
    id: 'train-else-airbike',
    path: '/train/2026-09-30',
    act: async (page) => {
      await menu(page, 'I did something else');
      const d = panel(page);
      await d.getByRole('textbox').first().fill('air bike 25 min');
      await d.getByRole('button', { name: /^Air bike/ }).first().click();
      await d.getByRole('radio', { name: 'Hard' }).click();
      await d.getByText('how it compares').click();
    },
  },
  {
    id: 'train-swap-meter',
    path: '/train/2026-09-30',
    act: async (page) => {
      await page.getByRole('button', { name: 'Dand (Hindu push-up)' }).click();
      const d = panel(page);
      await d.getByRole('button', { name: /^Use Dand with gar nal/ }).click();
      await page.getByRole('heading', { level: 3, name: /Dand with gar nal/ }).waitFor();
    },
  },
];

mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY?.split(',');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: ['--force-color-profile=srgb', '--no-sandbox'] });
let failed = 0;
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.deviceScaleFactor, isMobile: s.isMobile, hasTouch: s.hasTouch, reducedMotion: 'reduce', colorScheme: 'dark', serviceWorkers: 'block' });
    for (const sc of SCENES) {
      if (only && !only.includes(sc.id)) continue;
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        await page.goto(`${BASE}?path=${encodeURIComponent(sc.path)}${sc.quiet ? '&quiet=1' : ''}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (sc.act) await sc.act(page);
        await page.waitForTimeout(500);
        const file = join(OUT, `${sc.id}-${s.name}.png`);
        await page.screenshot({ path: file, fullPage: !!sc.full });
        console.log(file);
      } catch (e) {
        failed++;
        console.error(`${sc.id} ${s.name}: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: join(OUT, `FAILED-${sc.id}-${s.name}.png`) }).catch(() => undefined);
      }
      if (errors.length) console.error(`${sc.id} ${s.name} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
