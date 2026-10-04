// Captures the HTML launch mark before the production entry module runs, then checks the hand-over.
// C_WEBQA_BASE_URL=<preview-url> node qa/scripts/C-WEBQA/launch.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.C_WEBQA_BASE_URL;
if (!base) throw new Error('C_WEBQA_BASE_URL is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, '.e6-tmp/C-WEBQA/launch');
fs.mkdirSync(dir, { recursive: true });
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const entry = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Production entry module missing from dist/index.html');
const rows = [];
const widths = process.env.C_WEBQA_WIDTHS ? process.env.C_WEBQA_WIDTHS.split(',').map(Number) : [390, 768, 1440];
const themes = process.env.C_WEBQA_THEMES ? process.env.C_WEBQA_THEMES.split(',') : ['light', 'dark'];
const motions = process.env.C_WEBQA_MOTIONS ? process.env.C_WEBQA_MOTIONS.split(',') : ['normal', 'reduce'];

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const width of widths) for (const theme of themes) for (const motion of motions) {
    const name = `${width}-${theme}-${motion}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 },
      colorScheme: theme, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    await context.route('**/releases/latest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"tag_name":"v0.5.0","assets":[]}' }));
    const page = await context.newPage();
    let releaseEntry;
    const intercepted = new Promise((resolve) => {
      page.route(`**${entry}`, async (route) => {
        await new Promise((release) => { releaseEntry = release; resolve(); });
        await route.continue();
      });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 180)));
    try {
      await page.goto(new URL('/welcome', base).href, { waitUntil: 'commit' });
      await intercepted;
      await page.locator('.vitals-launch__ring').waitFor();
      const initial = await page.evaluate(() => {
        const mark = document.querySelector('.vitals-launch');
        const ring = mark?.querySelector('.vitals-launch__ring');
        const dot = mark?.querySelector('.vitals-launch__dot');
        if (!mark || !ring || !dot) return null;
        const box = mark.getBoundingClientRect();
        return { arc: ring.getAttribute('d'), dot: dot.getAttribute('cx') && dot.getAttribute('cy'),
          ringAnimation: getComputedStyle(ring).animationName, dotAnimation: getComputedStyle(dot).animationName,
          dotFill: getComputedStyle(dot).fill, background: getComputedStyle(mark).backgroundColor,
          bounds: { left: box.left, top: box.top, width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight },
          coversViewport: Math.abs(box.left) < 1 && Math.abs(box.top) < 1 && innerWidth - box.width <= 12 && box.height >= innerHeight - 1 && getComputedStyle(document.documentElement).backgroundColor === getComputedStyle(mark).backgroundColor,
          accessible: mark.getAttribute('aria-hidden') === 'true' };
      });
      await page.waitForTimeout(motion === 'normal' ? 650 : 100);
      await page.screenshot({ path: path.join(dir, `${name}-static.png`) });
      releaseEntry();
      await page.locator('.vitals-launch, .lm-launch').waitFor({ state: 'hidden', timeout: 15000 });
      await page.locator('h1').first().waitFor({ timeout: 15000 });
      const final = await page.evaluate(() => ({ launchNodes: document.querySelectorAll('.vitals-launch, .lm-launch').length,
        appVisible: !!document.querySelector('h1'), markVisible: !!document.querySelector('.lm-ringmark') }));
      rows.push({ name, initial, final, errors });
    } catch (error) {
      releaseEntry?.();
      rows.push({ name, error: String(error.message).split('\n')[0], errors });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(rows, null, 2));
}
const failed = rows.filter(({ name, initial, final, error, errors }) => error || errors.length || !initial?.arc || !initial?.dot || !initial.coversViewport || !initial.accessible || !final?.appVisible || final.launchNodes || (name.endsWith('reduce') ? initial.ringAnimation !== 'none' || initial.dotAnimation !== 'none' : initial.ringAnimation === 'none' || initial.dotAnimation === 'none'));
console.log(`Launch cases: ${rows.length}; failures: ${failed.length}`);
for (const row of failed) console.log(row.name, row.error ?? JSON.stringify({ initial: row.initial, final: row.final, errors: row.errors }));
if (failed.length) process.exitCode = 1;
