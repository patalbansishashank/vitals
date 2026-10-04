/** Supplement axe's SVG contrast gaps and exercise chart keyboard/table alternatives with synthetic fixtures. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE;
if (!BASE) throw new Error('Set BASE to the development audit server');
const { firstRun } = await import('../set/lib.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const checks = [];
const contrast = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'connected', signals: 'full' }; });
    const page = await context.newPage();
    await firstRun(page);
    for (const tab of ['sleep', 'heart', 'activity']) for (const period of ['day', 'year']) {
      const route = `/signals?tab=${tab}&period=${period}`;
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.locator('main [role="img"][tabindex="0"]').first().waitFor();
      const apps = page.locator('main [role="img"][tabindex="0"]');
      for (let i = 0; i < await apps.count(); i++) {
        const app = apps.nth(i);
        await app.focus();
        await app.press('Home');
        await page.waitForTimeout(550); // chart announcements debounce for 400 ms
        const first = await page.locator('main [aria-live="polite"]').allTextContents();
        await app.press('End');
        await page.waitForFunction((before) => JSON.stringify([...document.querySelectorAll('main [aria-live="polite"]')].map((el) => el.textContent)) !== before, JSON.stringify(first), { timeout: 5000 }).catch(() => {});
        const last = await page.locator('main [aria-live="polite"]').allTextContents();
        checks.push({ theme, route, test: `chart ${i + 1} Home/End update reading`, passed: JSON.stringify(first) !== JSON.stringify(last) });
      }
      const tableButtons = page.getByRole('button', { name: /^Show .+ data table$/ });
      const names = await tableButtons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      for (const name of names) {
        const button = page.getByRole('button', { name, exact: true });
        await button.focus(); await button.press('Enter');
        const hide = page.getByRole('button', { name: name.replace(/^Show /, 'Hide '), exact: true });
        checks.push({ theme, route, test: name, passed: await page.getByRole('table').count() > 0 && await hide.getAttribute('aria-expanded') === 'true' });
        await hide.press('Enter');
      }
      contrast.push({ theme, route, ...await page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const rgba = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
        const over = (fg, bg) => [0,1,2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
        const lum = (rgb) => rgb.reduce((v, c, i) => { c /= 255; return v + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126,0.7152,0.0722][i]; }, 0);
        const values = [...document.querySelectorAll('main svg text')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
          const style = getComputedStyle(el); const layers = []; let opacity = 1;
          for (let a = el; a; a = a.parentElement) { const st = getComputedStyle(a); opacity *= Number(st.opacity); const bg = rgba(st.backgroundColor); if (bg[3]) layers.push(bg); }
          let bg = [255,255,255]; for (const layer of layers.reverse()) bg = over(layer, bg);
          const fg = rgba(style.fill === 'none' ? style.color : style.fill); fg[3] *= opacity * Number(style.fillOpacity || 1);
          const fl = lum(over(fg, bg)), bl = lum(bg); const ratio = (Math.max(fl,bl) + 0.05) / (Math.min(fl,bl) + 0.05);
          return { text: el.textContent.trim().slice(0,60), ratio: Math.round(ratio * 100) / 100 };
        });
        return { svgTextCount: values.length, minimumRatio: Math.min(...values.map((v) => v.ratio)), belowAA: values.filter((v) => v.ratio < 4.5) };
      }) });
    }
    await page.getByRole('tab', { name: 'sleep', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tab', { name: /heart/i, selected: true }).waitFor();
    checks.push({ theme, test: 'Tabs ArrowRight moves focus and selection to heart', passed: await page.getByRole('tab', { name: /heart/i }).getAttribute('aria-selected') === 'true' });
    await page.keyboard.press('End');
    await page.getByRole('tab', { name: 'activity', exact: true, selected: true }).waitFor();
    checks.push({ theme, test: 'Tabs End selects activity', passed: await page.getByRole('tab', { name: 'activity', exact: true }).getAttribute('aria-selected') === 'true' });
    await page.goto(BASE + '/body', { waitUntil: 'networkidle' });
    const rail = page.getByRole('region', { name: 'Body estimates' });
    await rail.focus();
    const before = await rail.evaluate((el) => el.scrollLeft);
    await rail.press('ArrowRight'); await rail.press('ArrowRight');
    await page.waitForTimeout(400);
    checks.push({ theme, test: 'Body estimates rail scrolls by keyboard', passed: await rail.evaluate((el) => el.scrollLeft) > before });
    await context.close();
  }
} finally { await browser.close(); }
mkdirSync('qa/results/C-A11Y', { recursive: true });
writeFileSync('qa/results/C-A11Y/keyboard-contrast.json', JSON.stringify({ note: 'Synthetic dev fixtures; SVG foreground/background computed from CSS, alpha-composited through ancestor backgrounds. Does not sample chart geometry behind labels. Axe handles other text; screenshots provide visual review.', checks, contrast }, null, 2) + '\n');
console.log(`${checks.filter((c) => c.passed).length}/${checks.length} keyboard checks pass; ${contrast.filter((c) => c.belowAA.length).length}/${contrast.length} routes have SVG text below 4.5`);
console.log(JSON.stringify(checks.filter((c) => !c.passed)));
