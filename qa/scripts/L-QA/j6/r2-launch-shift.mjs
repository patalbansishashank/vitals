/**
 * J6 R2 B (simulated fast load, production build; reports app-in-DOM vs app-visible). The machine running QA was at load average 60-90, so the real app never mounted inside the
 * 600 ms window in which LaunchScreen shows its overlay. To still exercise the overlay, the entry bundle is prefixed
 * with a shim that (a) restarts performance.now() at START ms and (b) freezes the HTML start screen's animations at that
 * time. This is a time SHIFT, not a speed change: it models "the app mounted START ms after navigation start".
 *   node qa/scripts/L-QA/j6/launch-sim.mjs     (env BASE, START=120)
 * Screenshots of the live overlay frames: qa/results/L-QA/round2/j6/launch-sim-<scheme>-<n>.png ; JSON: launch-r2-sim-report.json
 */
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4336').replace(/\/$/, '');
const START = Number(process.env.START || 120);
const OUT = fileURLToPath(new URL('../../../results/L-QA/round2/j6/', import.meta.url));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const html = await (await fetch(BASE + '/')).text();
const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
const SHIM = `{const __r=performance.now.bind(performance),__s=__r();performance.now=()=>__r()-__s+${START};for(const a of document.getAnimations()){a.pause();a.currentTime=${START};}}\n`;
const REC = () => {
  const log = (window.__l = []);
  const f = () => {
    const st = document.querySelector('.vitals-launch'), ov = document.querySelector('.lm-launch');
    const el = st || ov; const m = el && el.querySelector('svg'); const r = m && m.getBoundingClientRect();
    const ring = el && el.querySelector('path'), dot = el && el.querySelector('circle');
    const root = document.getElementById('root'); const app = !!(root && [...root.children].some((c) => !c.classList.contains('vitals-launch') && !c.classList.contains('lm-launch')));
    log.push({ app, r: Math.round(performance.now()), k: st ? 's' : ov ? 'o' : 'n', op: ov ? +getComputedStyle(ov).opacity : 1, ph: ov ? ov.dataset.phase : null, rect: r ? [r.left, r.top, r.width].map((v) => Math.round(v * 10) / 10) : null, off: ring ? +parseFloat(getComputedStyle(ring).strokeDashoffset).toFixed(1) : null, dot: dot ? getComputedStyle(dot).transform : null, anims: m ? m.getAnimations({ subtree: true }).length : 0, nb: document.querySelectorAll('.lm-launch').length });
    if (log.length < 500) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
};
const out = {};
const plan = [...Array(6).fill('light'), ...Array(3).fill('dark')];
let runNo = 0;
for (const scheme of plan) {
  runNo++;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.route(`**${entry.replace(/^\./, '')}`, async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: SHIM + (await r.text()) });
  });
  await page.addInitScript(REC);
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  // grab screenshots while the overlay is present
  let n = 0;
  const shots = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const present = await page.evaluate(() => !!document.querySelector('.lm-launch')).catch(() => false);
    if (present && n < 6) { await page.screenshot({ path: `${OUT}launch-r2-sim-${scheme}-${n}.png`, clip: { x: 95, y: 322, width: 200, height: 200 } }); shots.push(Date.now() - t0); n++; }
    if (!present && n > 0) break;
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1200);
  const l = await page.evaluate(() => window.__l);
  const o = l.findIndex((s) => s.k === 'o');
  const gone = o >= 0 ? l.findIndex((s, i) => i > o && s.k === 'n') : -1;
  const fade = l.find((s) => s.ph === 'fade');
  // is the app clickable beneath the overlay? check pointer-events of the overlay
  const appIn = l.find((s) => s.app); const vis = l.find((s) => s.app && (s.k === 'n' || (s.k === 'o' && s.op < 0.5)));
  out[`${scheme}-${runNo}`] = {
    appInDomClock: appIn ? appIn.r : null, appVisibleClock: vis ? vis.r : null,
    overlayShown: o >= 0,
    shots: n,
    overlayFirstClock: o >= 0 ? l[o].r : null,
    fadeClock: fade ? fade.r : null,
    goneClock: gone >= 0 ? l[gone].r : null,
    overlayLifeMs: o >= 0 && gone >= 0 ? l[gone].r - l[o].r : null,
    handover: o > 0 && l[o - 1].k === 's' ? { static: { rect: l[o - 1].rect, off: l[o - 1].off }, overlay: { rect: l[o].rect, off: l[o].off } } : null,
    maxOverlays: Math.max(...l.map((s) => s.nb)),
    
    leftoverAnims: l[l.length - 1].anims,
    finalKind: l[l.length - 1].k,
  };
  // can a click go through during the overlay? check computed pointer-events when present
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}launch-r2-sim-report.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
