/**
 * J6 R2 B (warm loads, production build; appVisible = app in DOM and no overlay or overlay opacity < 0.5): same context, caches and service worker warm, so the app mounts as fast as this machine allows.
 * Logs the start screen -> overlay -> gone sequence per reload, normal vs reduced motion, plus which request 404s.
 *   node qa/scripts/L-QA/j6/launch-warm.mjs     (env BASE, RUNS)
 */
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4336').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS || 6);
const OUT = fileURLToPath(new URL('../../../results/L-QA/round2/j6/', import.meta.url));
const REC = () => {
  const log = (window.__l = []);
  const f = () => {
    const st = document.querySelector('.vitals-launch'), ov = document.querySelector('.lm-launch');
    const el = st || ov; const m = el && el.querySelector('svg'); const r = m && m.getBoundingClientRect();
    const ring = el && el.querySelector('path');
    const root = document.getElementById('root');
    const app = !!(root && [...root.children].some((c) => !c.classList.contains('vitals-launch') && !c.classList.contains('lm-launch')));
    log.push({ t: Math.round(performance.now()), k: st ? 's' : ov ? 'o' : 'n', op: ov ? +getComputedStyle(ov).opacity : 1, ph: ov ? ov.dataset.phase : null, rect: r ? [r.left, r.top, r.width].map((v) => Math.round(v * 10) / 10) : null, off: ring ? +parseFloat(getComputedStyle(ring).strokeDashoffset).toFixed(1) : null, anims: m ? m.getAnimations({ subtree: true }).length : 0, app });
    if (log.length < 300) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
};
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const res = {};
for (const reduced of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.addInitScript(REC);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(3000); // service worker installs and precaches
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__l && window.__l.some((s) => s.app), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1300);
    const l = await page.evaluate(() => window.__l);
    const vis = l.find((s) => s.app && (s.k === 'n' || (s.k === 'o' && s.op < 0.5)));
    const idx = (f) => { const x = l.find(f); return x ? x.t : null; };
    const o = l.findIndex((s) => s.k === 'o');
    const gone = o >= 0 ? (l.find((s, i) => i > o && s.k === 'n') || {}).t ?? null : null;
    runs.push({ appVisible: vis ? vis.t : null, loadAvg: null, firstFrame: l[0]?.t, appInDom: idx((s) => s.app), overlayFirst: idx((s) => s.k === 'o'), fadeStart: idx((s) => s.ph === 'fade'), gone, statFrames: l.filter((s) => s.k === 's').length, overlayFrames: l.filter((s) => s.k === 'o').length, maxAnims: Math.max(...l.map((s) => s.anims)), handover: o > 0 && l[o - 1].k === 's' ? { static: l[o - 1].rect, overlay: l[o].rect, offS: l[o - 1].off, offO: l[o].off } : null, sample: i === 0 ? l.filter((s, k) => k % 6 === 0 || (k && s.k !== l[k - 1].k)).slice(0, 40) : undefined });
  }
  res[reduced ? 'reduced' : 'normal'] = { runs, bad: [...new Set(bad)] };
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}launch-r2-report.json`, JSON.stringify(res, null, 1));
for (const k of ['normal', 'reduced']) { console.log(k, 'bad responses', res[k].bad); for (const r of res[k].runs) console.log(JSON.stringify({ ...r, sample: undefined })); }
console.log(JSON.stringify(res.normal.runs[0].sample));
