// Production PWA route smoke with a seeded synthetic browser state and the real service worker.
// C_WEBQA_BASE_URL=<preview-url> node qa/scripts/C-WEBQA/offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.C_WEBQA_BASE_URL;
if (!base) throw new Error('C_WEBQA_BASE_URL is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, '.e6-tmp/C-WEBQA/offline');
fs.mkdirSync(dir, { recursive: true });
const snapshot = path.join(root, '.e6-tmp/C-WEBQA/seeded-signals-state.json');
const routes = ['/today', '/body', '/ring', '/signals', '/settings'];
const results = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const [width, height, theme] of [[390, 844, 'light'], [1440, 900, 'dark']]) {
    const context = await browser.newContext({ storageState: snapshot, viewport: { width, height }, colorScheme: theme,
      serviceWorkers: 'allow' });
    await context.route('**/releases/latest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"tag_name":"v0.5.0","assets":[]}' }));
    const page = await context.newPage();
    const failures = [];
    const offlineRequests = [];
    const unexpectedRequests = [];
    let wentOffline = false;
    page.on('pageerror', (error) => failures.push(`page: ${error.message.slice(0, 160)}`));
    page.on('requestfailed', (request) => {
      const cause = request.failure()?.errorText ?? 'unknown';
      const record = `${new URL(request.url()).pathname}: ${cause}`;
      if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_FAILED/.test(cause) && wentOffline) offlineRequests.push(record);
      else unexpectedRequests.push(record);
    });
    try {
      await page.goto(new URL('/today?qa=1', base).href, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => Promise.race([navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('service worker ready timed out')), 10000))]));
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 }).catch(async () => {
        await page.reload({ waitUntil: 'load', timeout: 15000 });
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 5000 });
      });
      const online = await page.evaluate(() => ({ controlled: !!navigator.serviceWorker.controller,
        cacheCount: null }));
      await context.setOffline(true);
      wentOffline = true;
      for (const route of routes) {
        const row = { width, theme, route };
        try {
          await page.goto(new URL(`${route}?qa=1`, base).href, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.locator('h1').first().waitFor({ timeout: 10000 });
          await page.waitForFunction(() => Boolean(window.__vitals), null, { timeout: 5000 });
          const data = await page.evaluate(async () => {
            const profile = await window.__vitals.read('profile.get', {});
            const plan = await window.__vitals.read('plan.get', {});
            const day = plan.output?.plan?.startDate;
            const ring = await window.__vitals.read('bio.daily', { from: day, to: day });
            return { online: navigator.onLine, controlled: !!navigator.serviceWorker.controller,
              route: location.pathname, heading: document.querySelector('h1')?.textContent?.trim(),
              body: !!profile.output?.profile?.weightKg, plan: plan.output?.plan?.status,
              ringStreams: Object.keys(ring.output?.days?.[0]?.values ?? {}).length,
              mainText: (document.querySelector('main')?.textContent ?? '').trim().length };
          });
          Object.assign(row, { ...data, route, landed: data.route });
          await page.screenshot({ path: path.join(dir, `${width}-${theme}-${route.slice(1)}.png`) });
        } catch (error) {
          row.error = String(error.message).split('\n')[0];
        }
        results.push(row);
      }
      results.push({ width, theme, online });
    } catch (error) {
      results.push({ width, theme, setupError: String(error.message).split('\n')[0] });
    } finally {
      results.push({ width, theme, pageErrors: failures, expectedOfflineRequests: offlineRequests.length,
        unexpectedRequests });
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
}
const bad = results.filter((row) => row.setupError || row.error || row.pageErrors?.length || row.unexpectedRequests?.length || (row.route && (row.online || !row.controlled || row.landed !== row.route || !row.body || row.plan !== 'active' || row.ringStreams < 1 || row.mainText < 20)));
console.log(`Offline routes: ${results.filter((row) => row.route).length}; failures: ${bad.length}`);
for (const row of bad) console.log(JSON.stringify(row));
if (bad.length) process.exitCode = 1;
