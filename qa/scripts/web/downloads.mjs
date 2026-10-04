// Front-page "Get the app" block: 390 / 768 / 1440, light and dark, with the release API mocked.
// Checks: the main key and its link, version and size, the others beneath, no layout shift when the data arrives,
// and screenshots into .e6-tmp/downloads-shots (git-ignored). Run: node qa/scripts/web/downloads.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '.e6-tmp/downloads-shots';
mkdirSync(OUT, { recursive: true });
const MB = 1024 * 1024;
const FILES = { 'Vitals-android.apk': 31, 'Vitals-linux-x86_64.AppImage': 118, 'Vitals-linux-amd64.deb': 84, 'Vitals-windows-x64-setup.exe': 92, 'Vitals-macos-universal.dmg': 131 };
const REL = `https://github.com/patalbansishashank/vitals/releases/download/v0.5.0/`;
const release = { tag_name: 'v0.5.0', assets: Object.entries(FILES).map(([name, mb]) => ({ name, size: mb * MB, browser_download_url: REL + name })) };

const server = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', msg); } };

for (const width of [390, 768, 1440]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    let arrivedAt = Infinity;
    await page.route('https://api.github.com/**', async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      arrivedAt = await page.evaluate(() => performance.now());
      await route.fulfill({ json: release });
    });
    await page.addInitScript(() => {
      window.__shifts = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__shifts.push({ v: e.value, t: e.startTime, n: e.sources?.map((s) => s.node?.className ?? '') });
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${BASE}/welcome`);
    const block = page.locator('.lm-dl');
    await block.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const before = await block.boundingBox();
    const sizeBefore = await page.locator('.lm-onb-intro').boundingBox();
    await page.screenshot({ path: `${OUT}/${width}-${scheme}-before.png`, fullPage: true });
    await page.getByText(/Version 0\.5\.0/).waitFor();
    await page.waitForTimeout(1200);
    const after = await block.boundingBox();
    const sizeAfter = await page.locator('.lm-onb-intro').boundingBox();
    const tag = `${width} ${scheme}`;
    check(before.height === after.height && before.y === after.y, `${tag}: block moved ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    check(sizeBefore.height === sizeAfter.height, `${tag}: intro height ${sizeBefore.height} -> ${sizeAfter.height}`);
    // only shifts within a second of the data arriving (the page's own mount animation is not this block's)
    const shifts = await page.evaluate((t) => window.__shifts.filter((s) => s.v > 0.001 && s.t > t - 50 && s.t < t + 1000), arrivedAt);
    check(shifts.length === 0, `${tag}: layout shifts when the data arrived ${JSON.stringify(shifts)}`);
    // a full-page shot resizes the viewport, so it is taken after the shifts were counted
    await page.screenshot({ path: `${OUT}/${width}-${scheme}-after.png`, fullPage: true });
    const key = page.locator('a.lm-dl__key');
    check((await key.getAttribute('href'))?.startsWith(REL), `${tag}: main key href ${await key.getAttribute('href')}`);
    check((await page.locator('.lm-dl__others a').count()) === 4, `${tag}: others count`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `${tag}: horizontal overflow`);
    console.log(tag, 'block', JSON.stringify(after), 'ok');
    await ctx.close();
  }
}
await browser.close();
stop();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
