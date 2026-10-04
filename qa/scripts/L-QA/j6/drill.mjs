// J6 A: drill-down (week -> day, year -> month) by tapping a chart column. Dev fixtures, 390 light.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:4317'; process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin' });
await ctx.clock.setFixedTime(new Date('2026-10-04T14:30:00+02:00'));
const f = await ctx.newPage(); await firstRun(f); await f.close();
const p = await ctx.newPage();
await p.addInitScript((x) => { window.__VITALS_PAGES_FIXTURE__ = x; }, { ring: 'connected', signals: 'full' });
for (const [path, label] of [['/signals?tab=sleep&period=week&date=2026-10-04', 'sleep week'], ['/signals?tab=activity&period=week&date=2026-10-04', 'activity week'], ['/signals?tab=activity&period=year&date=2026-10-04', 'activity year']]) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const svg = p.locator('[role=img]').first();
  const box = await svg.boundingBox();
  // tap at 25% and 60% across the plot
  for (const fx of [0.3, 0.62]) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    const bb = await p.locator('[role=img]').first().boundingBox();
    await p.touchscreen.tap(bb.x + bb.width * fx, bb.y + bb.height * 0.7); await p.waitForTimeout(900);
    console.log(label, fx, '->', new URL(p.url()).pathname + new URL(p.url()).search);
  }
}
await b.close();
