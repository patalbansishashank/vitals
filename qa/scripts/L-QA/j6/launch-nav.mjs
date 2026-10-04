// J6 B: client-side navigation and history Back must not replay the start screen; a full reload does (cold HTML load).
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:4316';
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.addInitScript(() => { window.__seen = []; new MutationObserver(() => { for (const c of ['.vitals-launch', '.lm-launch']) if (document.querySelector(c)) window.__seen.push(c + '@' + Math.round(performance.now())); }).observe(document, { childList: true, subtree: true }); });
await p.goto(BASE + '/', { waitUntil: 'load' }); await p.waitForTimeout(2500);
const seen = async () => p.evaluate(() => [...new Set(window.__seen.map((s) => s.split('@')[0]))]);
console.log('cold load:', await seen(), 'url', new URL(p.url()).pathname);
await p.evaluate(() => { window.__seen = []; });
const btn = p.getByRole('button', { name: 'Get started' });
if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
console.log('after in-app navigation ->', new URL(p.url()).pathname, 'start screen seen again:', await seen());
await p.goBack(); await p.waitForTimeout(1200);
console.log('after Back ->', new URL(p.url()).pathname, 'start screen seen again:', await seen());
await p.evaluate(() => { window.__seen = []; });
await p.reload({ waitUntil: 'commit' }); await p.waitForTimeout(2500);
console.log('after reload: start screen seen:', await seen());
await b.close();
