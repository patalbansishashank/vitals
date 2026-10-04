// Probe: after onboarding (age typed in Your body), does Body signals still say "Add your age"? (zones need an age)
import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:4336'; process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
import { fileURLToPath } from 'node:url';
const FIX = fileURLToPath(new URL('../../../../.e6-tmp/j6-r2/bio-fresh.json', import.meta.url));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await firstRun(p);
console.log('body page age fields:', await p.evaluate(() => [...document.querySelectorAll('input')].map((e) => `${e.type}:${e.value}`).join(' | ')));
await p.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' });
await p.locator('section#devices input[type=file]').setInputFiles(FIX); await p.waitForTimeout(9000);
await p.goto(BASE + '/signals?tab=heart&period=day&date=2026-10-03', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
console.log('zones note present:', await p.evaluate(() => /Add your age/.test(document.body.innerText)));
await p.goto(BASE + '/body', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
console.log('body inputs now:', await p.evaluate(() => [...document.querySelectorAll('input')].filter((e) => e.type !== 'radio').map((e) => `${e.getAttribute('aria-label') || e.name || e.type}=${e.value}`).join(' | ')));
await b.close();
