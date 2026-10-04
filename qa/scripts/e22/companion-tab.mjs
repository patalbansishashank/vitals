// E22: keeps one headless Vitals tab open, paired with the local Companion and with "agents on this computer" on,
// so MCP clients (Codex, OpenCode, Claude Code) reach the app's command bus. Stops when .e6-tmp/e22-tab.stop exists.
// Usage: node qa/scripts/e22/companion-tab.mjs [baseUrl]   (Companion must run: vitals-companion proxy)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:5187';
const STOP = '.e6-tmp/e22-tab.stop';
rmSync(STOP, { force: true });
const ctx = await chromium.launchPersistentContext('.e6-tmp/e22-tab-profile', { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(30000);
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 200)); });
await page.goto(`${BASE}/settings#agents`, { waitUntil: 'networkidle' });
const sec = page.locator('#agents');
const look = sec.getByRole('button', { name: /Look for the Companion|Check again/ });
if (await look.count()) await look.first().click();
await page.waitForTimeout(1500);
if (await sec.getByLabel('pairing code').count()) {
  const code = /Pairing code: (\d{8})/.exec(execFileSync('fish', ['-l', '-c', 'vitals-companion pair'], { encoding: 'utf8' }))?.[1];
  if (!code) throw new Error('no pairing code from vitals-companion pair');
  await sec.getByLabel('pairing code').fill(code);
  await sec.getByRole('button', { name: 'Pair' }).click();
  await page.waitForTimeout(1500);
}
const bridge = sec.getByRole('switch', { name: 'agents on this computer' });
if ((await bridge.getAttribute('aria-checked')) !== 'true') await bridge.check({ force: true });
await page.waitForTimeout(2500);
console.log('agents section:', (await sec.innerText()).replace(/\s+/g, ' ').slice(0, 900));
await page.screenshot({ path: 'qa/screenshots/E22-companion-paired.png', clip: await sec.boundingBox().then((b) => ({ x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 1400) })) }).catch((e) => console.log('shot failed', e.message));
console.log('READY');
// Touch .e6-tmp/e22-tab.shot to refresh the Companion status and save qa/screenshots/E22-companion-state.png.
const SHOT = '.e6-tmp/e22-tab.shot';
while (!existsSync(STOP)) {
  if (existsSync(SHOT)) {
    rmSync(SHOT, { force: true });
    await sec.getByRole('button', { name: /Check again/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(2500);
    console.log('state:', (await sec.innerText()).replace(/\s+/g, ' ').slice(0, 1500));
    const b = await sec.boundingBox();
    await page.screenshot({ path: 'qa/screenshots/E22-companion-state.png', clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 1600) } }).catch((e) => console.log('shot failed', e.message));
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await ctx.close();
console.log('stopped');
