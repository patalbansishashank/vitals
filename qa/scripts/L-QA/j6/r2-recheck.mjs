/** Round 2 J6 C: spot re-checks on the production build (404 URL, SpO2 wording, tier wording, ring key size/position, manifest + favicon). */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = (process.env.BASE || 'http://127.0.0.1:4336').replace(/\/$/, '');
process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUTD = join(ROOT, 'qa/results/L-QA/round2/j6');
const FIX = join(ROOT, '.e6-tmp/j6-r2/bio-fresh.json');
const BT = () => Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true, requestDevice: async () => { throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'); }, addEventListener() {}, removeEventListener() {} } });
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const res = { bad: [], keys: {}, text: {} };
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(BT);
  const p = await ctx.newPage();
  p.on('response', (r) => { if (r.status() >= 400) res.bad.push(`${w}: ${r.status()} ${r.url().replace(BASE, '')}`); });
  await firstRun(p);
  await p.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' });
  await p.locator('section#devices input[type=file]').setInputFiles(FIX);
  await p.waitForTimeout(9000);
  for (const path of ['/ring', '/today']) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    res.keys[`${w}${path}`] = await p.evaluate(() => [...document.querySelectorAll('a,button')].filter((e) => /^ring\b/i.test(e.getAttribute('aria-label') || '')).map((e) => { const r = e.getBoundingClientRect(); const sib = [...(e.parentElement?.children ?? [])].map((c) => (c.getAttribute('aria-label') || c.innerText || '').trim().slice(0, 14)); const cs = getComputedStyle(e); return { label: e.getAttribute('aria-label'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, siblings: sib, parent: e.parentElement?.tagName }; }));
    await p.screenshot({ path: join(OUTD, `ringkey-${w}${path.replace('/', '-')}.png`), clip: { x: 0, y: 0, width: w, height: 120 } });
  }
  for (const [tab, per, date] of [['heart', 'day', '2026-10-03'], ['heart', 'week', '2026-10-04'], ['sleep', 'day', '2026-10-03'], ['sleep', 'week', '2026-10-04'], ['activity', 'day', '2026-10-03']]) {
    await p.goto(`${BASE}/signals?tab=${tab}&period=${per}&date=${date}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    res.text[`${w}-${tab}-${per}`] = await p.evaluate(() => document.querySelector('main').innerText);
  }
  // Ring page: scan (stub chooser ends with no pick) and the page text in the 'idle/none' state
  await p.goto(BASE + '/ring', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  res.text[`${w}-ring`] = await p.evaluate(() => document.querySelector('main').innerText);
  const look = p.getByRole('button', { name: /look for rings/i }).first();
  if (await look.count()) { await look.click(); await p.waitForTimeout(2500); res.text[`${w}-ring-after-look`] = await p.evaluate(() => document.querySelector('main').innerText); await p.screenshot({ path: join(OUTD, `ring-after-look-${w}.png`), fullPage: true }); }
  await ctx.close();
}
// manifest + favicon
const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'networkidle' });
res.manifest = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); const out = []; for (const i of m.icons) { const r = await fetch(new URL(i.src, l.href)); const bl = await r.blob(); const bmp = await createImageBitmap(bl).catch(() => null); out.push({ src: i.src, declared: i.sizes, status: r.status, type: r.headers.get('content-type'), px: bmp ? `${bmp.width}x${bmp.height}` : 'n/a (svg or undecodable)' }); } const links = [...document.querySelectorAll('link[rel*=icon]')].map((e) => ({ rel: e.rel, href: e.getAttribute('href'), sizes: e.sizes?.toString() })); return { name: m.name, icons: out, links }; });
await p.goto(BASE + '/favicon.svg'); await p.setViewportSize({ width: 256, height: 256 }); await p.screenshot({ path: join(OUTD, 'favicon-svg.png') });
writeFileSync(join(OUTD, 'recheck-report.json'), JSON.stringify(res, null, 1));
await b.close();
console.log(JSON.stringify({ bad: res.bad, keys: res.keys, manifest: res.manifest }, null, 1));
