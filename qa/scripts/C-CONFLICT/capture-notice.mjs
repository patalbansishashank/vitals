/** Run against a local Vite dev server; VITALS_SCREENSHOT_BASE supplies its origin. */
import { chromium } from 'playwright-core';

const base = process.env.VITALS_SCREENSHOT_BASE;
if (!base) throw new Error('Set VITALS_SCREENSHOT_BASE to the local dev server origin.');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}/qa/scripts/C-CONFLICT/notice.fixture.html`, { waitUntil: 'networkidle' });
    await page.getByText('This meal was changed on two devices. Keep which one?').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) throw new Error(`${width}px notice overflows by ${overflow}px`);
    await page.screenshot({ path: `qa/results/C-CONFLICT/notice-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: /Keep version 2:/ }).click();
    await page.getByText('One chosen meal remains.').waitFor();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByText('This meal was changed on two devices. Keep which one?').waitFor();
    await context.close();
    process.stdout.write(`${width}px notice captured; chosen version resolved and undo restored conflict; overflow ${overflow}px\n`);
  }
} finally {
  await browser.close();
}
