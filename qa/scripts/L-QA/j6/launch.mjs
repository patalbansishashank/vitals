/**
 * J6 part B: launch animation checks against the production preview build.
 *
 *   npx vite preview --outDir .e6-tmp/web-int --port 4316 --strictPort --host 127.0.0.1 &
 *   node qa/scripts/L-QA/j6/launch.mjs            (env BASE, RUNS)
 *
 * 1. Frames: scripts blocked so only the HTML start screen runs; its animations are paused and set to
 *    0/150/300/500/900 ms, screenshots (light + dark) -> qa/results/L-QA/j6/launch-<scheme>-<ms>.png
 * 2. Timeline: a requestAnimationFrame recorder (addInitScript) logs, per frame, ms since navigation start, whether
 *    the start screen (.vitals-launch) or the overlay (.lm-launch) is present and its opacity, the mark's rectangle,
 *    running animations on the mark, and when the app's own UI exists. Compared with reduced motion (no animation).
 * 3. Replay: reload, client-side navigation, back/forward, new cold goto, background tab, slow script.
 * 4. Reduced motion: getAnimations() on the mark is empty, still mark shown.
 * Results -> qa/results/L-QA/j6/launch-report.json (+ printed summary).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:4316').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS || 6);
const OUT = fileURLToPath(new URL('../../../results/L-QA/j6/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const RECORDER = () => {
  const log = [];
  window.__launchLog = log;
  const t0 = () => performance.now();
  const sample = () => {
    const st = document.querySelector('.vitals-launch');
    const ov = document.querySelector('.lm-launch');
    const el = st || ov;
    const mark = el && el.querySelector('svg');
    const r = mark ? mark.getBoundingClientRect() : null;
    const ring = el && el.querySelector('path');
    const dot = el && el.querySelector('circle');
    const root = document.getElementById('root');
    const appUi = !!document.querySelector('nav, main, [role=main], header, button:not(.x)') && !!(root && [...root.children].some((c) => !c.classList.contains('vitals-launch') && !c.classList.contains('lm-launch')));
    log.push({
      t: Math.round(t0()),
      kind: st ? 'static' : ov ? 'overlay' : 'none',
      op: ov ? Number(getComputedStyle(ov).opacity) : st ? 1 : 0,
      phase: ov ? ov.dataset.phase : null,
      rect: r ? [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10] : null,
      ringOffset: ring ? Math.round(parseFloat(getComputedStyle(ring).strokeDashoffset) * 10) / 10 : null,
      dotScale: dot ? getComputedStyle(dot).transform : null,
      anims: mark ? mark.getAnimations({ subtree: true }).length : 0,
      appUi,
      title: document.title,
    });
    if (log.length < 400) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const report = { base: BASE, frames: {}, timeline: {}, timing: {}, replay: {}, reduced: {}, notes: [] };

/* ------------------------------------------------------------------ 1. deterministic frames (static start screen) */
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*.js', (r) => r.abort());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vitals-launch');
  const info = await page.evaluate(() => document.getAnimations().map((a) => ({ name: a.animationName, dur: a.effect.getComputedTiming().duration, delay: a.effect.getComputedTiming().delay, easing: a.effect.getTiming().easing })));
  report.frames[scheme] = { animations: info };
  for (const ms of [0, 150, 300, 500, 900]) {
    await page.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, ms);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${OUT}launch-${scheme}-${String(ms).padStart(3, '0')}.png`, clip: { x: 95, y: 322, width: 200, height: 200 } });
    if (ms === 300) await page.screenshot({ path: `${OUT}launch-${scheme}-full-300.png` });
  }
  await ctx.close();
}

/* ------------------------------------------------------------------ 2. real timeline + timing comparison */
async function oneRun({ scheme = 'light', reduced = false, path = '/', throttleJs = 0, vp = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  if (throttleJs) await page.route('**/assets/*.js', async (r) => { await new Promise((s) => setTimeout(s, throttleJs)); r.continue(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(RECORDER);
  await page.goto(BASE + path, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__launchLog && window.__launchLog.some((s) => s.appUi && s.kind !== 'static'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const log = await page.evaluate(() => window.__launchLog);
  const perf = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
    return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ...paints };
  });
  const first = (f) => (log.find(f) || {}).t ?? null;
  const summary = {
    firstFrame: log[0]?.t ?? null,
    startScreenFirstSeen: first((s) => s.kind === 'static'),
    appMounted: first((s) => s.kind !== 'static' && s.appUi),
    overlayFirstSeen: first((s) => s.kind === 'overlay'),
    overlayGone: log.length ? (() => { const i = log.findIndex((s) => s.kind === 'overlay'); if (i < 0) return null; const j = log.findIndex((s, k) => k > i && s.kind === 'none'); return j < 0 ? null : log[j].t; })() : null,
    staticSeenFrames: log.filter((s) => s.kind === 'static').length,
    overlayFrames: log.filter((s) => s.kind === 'overlay').length,
    maxAnims: Math.max(0, ...log.map((s) => s.anims)),
    perf,
    errors,
    path: new URL(page.url()).pathname,
  };
  // mark rect jump at the static -> overlay hand-over
  const i = log.findIndex((s) => s.kind === 'overlay');
  if (i > 0 && log[i - 1].kind === 'static' && log[i].rect && log[i - 1].rect) summary.handoverRectDelta = log[i].rect.map((v, k) => Math.round((v - log[i - 1].rect[k]) * 10) / 10);
  await ctx.close();
  return { summary, log };
}

const first = await oneRun({ scheme: 'light' });
report.timeline.light = first;
report.timeline.dark = await oneRun({ scheme: 'dark' });
report.timeline.lightReduced = await oneRun({ scheme: 'light', reduced: true });
report.timeline.lightDesktop = await oneRun({ scheme: 'light', vp: { width: 1440, height: 900 } });

const stats = (a) => { const v = a.filter((x) => x !== null).sort((x, y) => x - y); return v.length ? { n: v.length, min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : null; };
const runs = { normal: [], reduced: [] };
for (let i = 0; i < RUNS; i++) {
  runs.normal.push((await oneRun({ scheme: 'light' })).summary);
  runs.reduced.push((await oneRun({ scheme: 'light', reduced: true })).summary);
}
report.timing = {
  normal: { appMounted: stats(runs.normal.map((r) => r.appMounted)), overlayGone: stats(runs.normal.map((r) => r.overlayGone)), fcp: stats(runs.normal.map((r) => r.perf['first-contentful-paint'] ?? null)), staticFrames: stats(runs.normal.map((r) => r.staticSeenFrames)) },
  reduced: { appMounted: stats(runs.reduced.map((r) => r.appMounted)), overlayGone: stats(runs.reduced.map((r) => r.overlayGone)), fcp: stats(runs.reduced.map((r) => r.perf['first-contentful-paint'] ?? null)), staticFrames: stats(runs.reduced.map((r) => r.staticSeenFrames)) },
};

/* ------------------------------------------------------------------ 3. replay behaviour */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(RECORDER);
  const overlaySeen = () => page.evaluate(() => (window.__launchLog || []).some((s) => s.kind !== 'none'));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  report.replay.firstLoadShowedStart = await overlaySeen();
  const urlAfterFirst = new URL(page.url()).pathname;
  report.replay.landing = urlAfterFirst;
  // client navigation: click any internal link or button to move
  const navTargets = await page.locator('a[href^="/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')).slice(0, 5));
  report.replay.links = navTargets;
  if (navTargets[0]) {
    await page.evaluate(() => { window.__launchLog.length = 0; window.__mark = 'nav'; });
    await page.locator('a[href^="/"]').first().click().catch(() => {});
    await page.waitForTimeout(1200);
    report.replay.clientNavReplayed = await page.evaluate(() => (window.__launchLog || []).some((s) => s.kind !== 'none') && window.__mark === 'nav');
    report.replay.afterNavUrl = new URL(page.url()).pathname;
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1000);
    report.replay.backReplayed = await page.evaluate(() => (window.__launchLog || []).some((s) => s.kind === 'static' || s.kind === 'overlay') && window.__mark !== 'nav' ? 'reloaded-and-replayed' : 'no');
  }
  // reload
  await page.reload({ waitUntil: 'commit' });
  await page.waitForTimeout(1800);
  report.replay.reloadShowedStart = await overlaySeen();
  report.replay.reloadFrames = await page.evaluate(() => window.__launchLog.filter((s) => s.kind !== 'none').length);
  await ctx.close();
}
{
  // background tab: the page is opened in a tab that is not visible
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctx.newPage();
  await a.goto(BASE + '/', { waitUntil: 'load' });
  const b = await ctx.newPage();
  await b.addInitScript(RECORDER);
  await b.goto(BASE + '/', { waitUntil: 'commit' });
  await a.bringToFront();
  await a.waitForTimeout(2500);
  report.replay.backgroundTabOverlay = await b.evaluate(() => ({ visibility: document.visibilityState, overlayFrames: (window.__launchLog || []).filter((s) => s.kind === 'overlay').length, staticFrames: (window.__launchLog || []).filter((s) => s.kind === 'static').length, present: !!document.querySelector('.lm-launch,.vitals-launch') }));
  await ctx.close();
}
{
  // slow script (1.2 s): start screen stays until React mounts; no overlay afterwards
  const slow = await oneRun({ scheme: 'light', throttleJs: 1200 });
  report.replay.slowScript = slow.summary;
  const logS = slow.log;
  const i = logS.findIndex((s) => s.kind !== 'static');
  report.replay.slowScriptFirstNonStatic = i >= 0 ? logS[i] : null;
}
{
  // JS disabled: the start screen must not be left blocking
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  report.replay.noJs = await page.evaluate(() => ({ launchDisplay: getComputedStyle(document.querySelector('.vitals-launch')).display, noscript: document.querySelector('noscript')?.textContent?.trim().slice(0, 80) }));
  await page.screenshot({ path: `${OUT}launch-nojs.png` });
  await ctx.close();
}

/* ------------------------------------------------------------------ 4. reduced motion: getAnimations is empty, still mark */
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: 'reduce', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*.js', (r) => r.abort());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vitals-launch');
  const r = await page.evaluate(() => {
    const m = document.querySelector('.vitals-launch__mark');
    const ring = document.querySelector('.vitals-launch__ring');
    const dot = document.querySelector('.vitals-launch__dot');
    return { anims: document.getAnimations().length, ringOffset: getComputedStyle(ring).strokeDashoffset, ringAnimName: getComputedStyle(ring).animationName, dotAnimName: getComputedStyle(dot).animationName, dotTransform: getComputedStyle(dot).transform, markRect: m.getBoundingClientRect().width };
  });
  report.reduced[scheme + '_static'] = r;
  await page.screenshot({ path: `${OUT}launch-reduced-${scheme}.png`, clip: { x: 95, y: 322, width: 200, height: 200 } });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  report.reduced.afterMount = await page.evaluate(() => ({ overlay: !!document.querySelector('.lm-launch'), start: !!document.querySelector('.vitals-launch'), anims: document.getAnimations().filter((a) => /ringmark|launch/.test(a.animationName || '')).length }));
  await ctx.close();
}

await browser.close();
// slim the logs for the report
for (const k of Object.keys(report.timeline)) { report.timeline[k] = { summary: report.timeline[k].summary, sample: report.timeline[k].log.filter((s, i, a) => i === 0 || s.kind !== a[i - 1].kind || i % 8 === 0).slice(0, 60) }; }
writeFileSync(`${OUT}launch-report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ timing: report.timing, replay: report.replay, reduced: report.reduced, summaries: Object.fromEntries(Object.entries(report.timeline).map(([k, v]) => [k, v.summary])) }, null, 1));
