// Render the V4c screens (Today with its activities, the activity sheet, a hand-logged
// activity, an over-plan day, a no-device day, a recording, quiet mode, the charts) at phone 390×844 @2x and desktop
// 1440×900. Usage: start Vite on 4192 (`npx vite --port 4192 --strictPort`; another port through V4C_BASE), then
//   node src/features/living/today/__screens__/render.mjs [outDir]
// Needs playwright-core and a Chromium at /usr/bin/chromium (or CHROMIUM=…). The page clock is fixed per scene, so the
// harness day, the ring demo (`__VITALS_GAUGE_DEMO__`, device scenes only) and the recording agree.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? '/media/DEV/Hobby/vitals-research/step1/screens-v4c';
const BASE = process.env.V4C_BASE ?? 'http://localhost:4192/src/features/living/today/__screens__/screens.html';
const DAY = process.env.V4C_DAY ?? '2026-10-27';
const ALL_SIZES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'narrow', width: 288, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
// SIZES=phone,narrow picks sizes (default phone and desktop)
const SIZES = ALL_SIZES.filter((s) => (process.env.SIZES ? process.env.SIZES.split(',') : ['phone', 'desktop']).includes(s.name));

/** The open sheet (phone) or side panel (desktop). */
const panel = (page) => page.locator('dialog[open], [role="dialog"]:visible, aside.lm-sidepanel:visible').first();
// (r070) no review sheet: a row of Today's list opens the activity sheet
const review = async (page) => {
  await page.getByRole('button', { name: /^Brisk walk, / }).first().click();
  await panel(page).waitFor();
};

const SCENES = [
  { id: 'pending', scene: 'pending', time: '13:20', full: true },
  {
    id: 'edit-sheet',
    scene: 'pending',
    time: '13:20',
    act: async (page) => {
      await review(page);
      await page.getByRole('button', { name: 'End there' }).waitFor();
      await page.getByRole('button', { name: 'End there' }).click();
    },
  },
  { id: 'edit-sheet-details', scene: 'pending', time: '13:20', act: async (page) => {
      await review(page);
      await page.getByRole('button', { name: 'End there' }).click();
      await page.getByText('Estimate', { exact: true }).last().scrollIntoViewIfNeeded();
    } },
  { id: 'energy-chart', scene: 'pending', time: '13:20', act: async (page) => page.getByRole('button', { name: 'Through the day' }).click() },
  {
    id: 'energy-table',
    scene: 'pending',
    time: '13:20',
    act: async (page) => {
      await page.getByRole('button', { name: 'Through the day' }).click();
      await panel(page).getByRole('button', { name: 'Table' }).click();
      await panel(page).getByRole('region', { name: /table$/ }).scrollIntoViewIfNeeded();
    },
  },
  { id: 'energy-active', scene: 'pending', time: '13:20', act: async (page) => {
      await page.getByRole('button', { name: 'Through the day' }).click();
      await panel(page).getByRole('radio', { name: 'Active' }).click();
    } },
  { id: 'steps-chart', scene: 'pending', time: '13:20', act: async (page) => page.getByRole('button', { name: /^Ring and phone/ }).click() },
  {
    id: 'steps-table',
    scene: 'pending',
    time: '13:20',
    act: async (page) => {
      await page.getByRole('button', { name: /^Ring and phone/ }).click();
      await panel(page).getByRole('button', { name: 'Table' }).click();
      await panel(page).getByRole('region', { name: /table$/ }).scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'needs-weight',
    scene: 'noweight',
    time: '13:20',
    act: async (page) => {
      await review(page);
      await page.getByRole('button', { name: 'End there' }).click();
      await page.getByText('Needs weight', { exact: true }).last().scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'edit-sheet-zones',
    scene: 'pending',
    time: '13:20',
    act: async (page) => {
      await review(page);
      await page.getByText('Heart rate', { exact: true }).last().scrollIntoViewIfNeeded();
    },
  },
  { id: 'manual-log', scene: 'manual', time: '13:20', full: true, second: 'Today’s activities' },
  { id: 'no-device', scene: 'nodevice', time: '09:40', full: true },
  { id: 'over-plan', scene: 'overplan', time: '21:40', full: true },
  { id: 'recording', scene: 'recording', time: '07:28' },
  { id: 'record-sheet', scene: 'pending', time: '13:20', act: async (page) => page.getByRole('button', { name: 'Record' }).click() },
  { id: 'quiet', scene: 'pending', time: '13:20', quiet: true, full: true },
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
      const device = sc.scene !== 'nodevice' && sc.scene !== 'manual';
      await ctx.addInitScript((demo) => {
        window.__VITALS_GAUGE_DEMO__ = demo;
      }, device);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(`${DAY}T${sc.time}:00`));
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        await page.goto(`${BASE}?scene=${sc.scene}&time=${sc.time}${sc.quiet ? '&quiet=1' : ''}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(700);
        if (sc.act) await sc.act(page);
        await page.waitForTimeout(600);
        const file = join(OUT, `${sc.id}-${s.name}.png`);
        await page.screenshot({ path: file });
        console.log(file);
        // a long page: a second frame at the activity card (phone) or the side column's lower cards (desktop)
        if (sc.full) {
          const target = sc.second ? page.getByRole('region', { name: sc.second }) : s.name === 'phone' ? page.getByRole('region', { name: 'Activity' }) : page.getByRole('region', { name: /^(So far|Day total)$/ });
          await target.first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.mouse.wheel(0, -72);
          await page.waitForTimeout(500);
          const f2 = join(OUT, `${sc.id}-${s.name}-2.png`);
          await page.screenshot({ path: f2 });
          console.log(f2);
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
