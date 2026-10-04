// Probe: does the Ring page change its mind when Web Bluetooth exists (stub, no hardware)?
import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:4336'; process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true, requestDevice: async () => { throw new DOMException('cancel', 'NotFoundError'); } } }));
const p = await ctx.newPage();
await firstRun(p);
await p.goto(BASE + '/ring', { waitUntil: 'networkidle' });
for (const t of [1000, 4000, 8000]) { await p.waitForTimeout(t); console.log(t, (await p.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 260)); }
console.log(await p.evaluate(() => ({ url: location.href, bt: typeof navigator.bluetooth, redirected: location.pathname })));
await b.close();
