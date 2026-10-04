// E17 picker screenshots: /dev/picker (equipment, cuisines, staples, pantry) and /settings/kitchen at 390/768/1440 in
// light and dark. Run against `npx vite preview --outDir .e6-tmp/dist --port 5182 --strictPort --host 127.0.0.1`.
//   node qa/scripts/e17/shots.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5182';
const WIDTHS = [
  { w: 390, h: 844, mobile: true },
  { w: 768, h: 1024, mobile: true },
  { w: 1440, h: 900, mobile: false },
];
const THEMES = ['light', 'dark'];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const report = [];
try {
  for (const { w, h, mobile } of WIDTHS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
      await page.goto(`${BASE}/dev/picker`);
      await page.getByRole('searchbox').first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(600);
      // horizontal overflow check (nothing wider than the viewport)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `qa/screenshots/E17-picker-equipment-${w}-${theme}.png` });
      // search with a regional name, open a note popover on the first ticked chip
      await page.getByRole('searchbox').first().fill('bhindi');
      await page.waitForTimeout(400);
      const tab = page.getByRole('radio', { name: /pantry/i }).or(page.getByRole('tab', { name: /pantry/i })).first();
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(500);
        await page.getByRole('searchbox').first().fill('bhindi');
        await page.waitForTimeout(400);
        await page.screenshot({ path: `qa/screenshots/E17-picker-pantry-search-${w}-${theme}.png` });
      }
      const cu = page.getByRole('radio', { name: /cuisines/i }).or(page.getByRole('tab', { name: /cuisines/i })).first();
      if (await cu.count()) {
        await cu.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `qa/screenshots/E17-picker-cuisines-${w}-${theme}.png` });
      }
      await page.goto(`${BASE}/settings/kitchen`);
      await page.waitForTimeout(2500);
      const k = page.locator('#kitchen');
      if (await k.count()) {
        await k.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `qa/screenshots/E17-settings-kitchen-${w}-${theme}.png` });
      }
      const overflowSettings = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      report.push({ w, theme, overflow, overflowSettings, settings: (await k.count()) > 0, errors: errors.slice(0, 5) });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
