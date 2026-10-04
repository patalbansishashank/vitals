// J6 A: running animations on the Ring page while syncing, normal vs reduced motion (the ring light pulse must stop). Dev fixtures.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:4317'; process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
for (const rm of ['no-preference', 'reduce']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: rm });
  const f = await ctx.newPage(); await firstRun(f); await f.close();
  const p = await ctx.newPage();
  await p.addInitScript((x) => { window.__VITALS_PAGES_FIXTURE__ = x; }, { ring: 'syncing', signals: 'full' });
  await p.goto(BASE + '/ring', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.getByRole('link', { name: 'Settings' }).first().click().catch(() => {}); await p.waitForTimeout(600); await p.goBack(); await p.waitForTimeout(1200);
  const r = await p.evaluate(() => document.getAnimations().map((a) => `${a.animationName || a.constructor.name}:${a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? ''}`.slice(0, 80)));
  const ra = await p.evaluate(() => [...document.querySelectorAll('.rg-light,.rg-key')].map((e) => getComputedStyle(e).animationName + '/' + getComputedStyle(e, '::after').animationName));
  console.log(rm, 'animations:', JSON.stringify(r), 'light anim names:', JSON.stringify(ra));
  await ctx.close();
}
await b.close();
