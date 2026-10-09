// Measures every control in the top bars and the action bar on every route and fails unless they are all exactly
// the bar control height (--lm-bar-control-h): 36 px for a fine pointer, 44 px under touch emulation.
//   BASE=http://127.0.0.1:5300 STATE_PLANNING=<storageState.json> STATE_LIVING=<storageState.json> \
//   KIND=fine|coarse SCHEME=light|dark [WIDTHS=390,768,1440,1920] [SHOTS=dir] node scripts/qa/bar-heights.mjs
// The state files are synthetic browser-local storage states (qa/scripts/C-DESIGN/seed.mjs makes them).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const BASE = process.env.BASE || 'http://127.0.0.1:5300';
const KIND = process.env.KIND || 'fine';
const SCHEME = process.env.SCHEME || 'light';
const EXPECT = KIND === 'coarse' ? 44 : 36;
const widths = (process.env.WIDTHS || (KIND === 'coarse' ? '390,768' : '390,768,1440,1920')).split(',').map(Number);
const planning = process.env.STATE_PLANNING || path.join(root, '.e6-tmp/live-actionbar/state-planning.json');
const living = process.env.STATE_LIVING || path.join(root, '.e6-tmp/live-actionbar/state-living.json');
const shots = process.env.SHOTS || '';
const SHOT_ROUTES = new Set((process.env.SHOT_ROUTES || '/body,/plan/goals,/plan/results,/onboarding/summary,/onboarding/devices,/settings,/simulate/starter/schedule,/today,/coach').split(','));
if (shots) fs.mkdirSync(shots, { recursive: true });

const PLANNING_ROUTES = [
  '/body', '/body?setup=basics', '/body?setup=shape', '/body?setup=habits', '/body?setup=start',
  '/plan/goals', '/simulate/starter/schedule', '/simulate/starter/results',
  '/onboarding/activity', '/onboarding/training', '/onboarding/diet', '/onboarding/kitchen', '/onboarding/supplements', '/onboarding/devices', '/onboarding/summary',
  '/settings', '/settings/units', '/evidence', '/safety', '/ring', '/signals',
];
const LIVING_ROUTES = ['/today', '/food', '/food/pantry', '/train', '/progress', '/coach', '/plan/active'];

/** In the page: every control inside a visible bar, as { bar, kind, h, w, text }. */
function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const bars = [...document.querySelectorAll('.lm-topbar, .lm-ctx, .lm-actionbar')].filter((b) => vis(b) && b.getBoundingClientRect().height > 20);
  const out = [];
  for (const bar of bars) {
    const name = bar.classList.contains('lm-actionbar') ? 'action' : bar.classList.contains('lm-topbar') ? 'top' : 'ctx';
    const cands = [...bar.querySelectorAll('button, a[href], select, input:not([type=hidden]), textarea, [role=radio], [role=tab], .lm-switch, .lm-bank, .lm-stepper, .lm-numfield, .lm-chip, .lm-runkey')];
    for (const el of cands) {
      const container = el.closest('.lm-bank, .lm-stepper, .lm-numfield, .lm-switch, .lm-runkey, .lm-chip');
      if (container && container !== el) continue; // measured as one control
      if (!vis(el) || el.closest('.lm-sr, [aria-hidden="true"], .lm-ik-progress')) continue;
      if (el.matches('a[href]') && !el.matches('.lm-key, .lm-chip, .lm-topbar__back, .lm-bank__key, [role=tab]')) continue; // plain text links
      const r = el.getBoundingClientRect();
      const run = el.matches('.lm-runkey') ? el.querySelector('.lm-runkey__cap') : null;
      const h = run ? run.getBoundingClientRect().height : r.height;
      out.push({ bar: name, kind: el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : el.tagName.toLowerCase(), h: Math.round(h * 10) / 10, w: Math.round(r.width), text: (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 28) });
    }
  }
  return { controls: out, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, bars: bars.length };
}

const failures = [];
const summary = [];
async function check(page, label, w, route) {
  const m = await page.evaluate(measure);
  const bad = m.controls.filter((c) => Math.abs(c.h - EXPECT) > 0.6);
  summary.push(`${label.padEnd(8)} ${String(w).padStart(4)} ${SCHEME.padEnd(5)} ${route.padEnd(34)} bars=${m.bars} controls=${m.controls.length} ${bad.length ? 'BAD ' + bad.length : 'ok'}${m.overflow > 1 ? ' hscroll=' + m.overflow : ''}`);
  for (const c of bad) failures.push(`${KIND} ${w} ${SCHEME} ${route}: ${c.bar} ${c.kind} "${c.text}" is ${c.h} px (want ${EXPECT})`);
  if (m.overflow > 1) failures.push(`${KIND} ${w} ${SCHEME} ${route}: horizontal scroll ${m.overflow}px`);
  if (shots && SHOT_ROUTES.has(route.split('?')[0]) && !route.includes('?')) {
    const slug = `${route.replace(/\W+/g, '_')}-${w}-${SCHEME}-${KIND}`;
    for (const [sel, tag] of [['.lm-ctx-slot', 'top'], ['.lm-actionbar-slot', 'foot']]) {
      const el = page.locator(sel).first();
      if (await el.count() && await el.isVisible().catch(() => false)) await el.screenshot({ path: path.join(shots, `${slug}-${tag}.png`) }).catch(() => undefined);
    }
    if (w < 1024) await page.screenshot({ path: path.join(shots, `${slug}-page.png`) });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
async function context(stateFile, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 1000 }, colorScheme: SCHEME, serviceWorkers: 'block', storageState: stateFile, ...(KIND === 'coarse' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route(/localhost:8400/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return { ctx, page };
}
async function goto(page, route) {
  const url = new URL(route, BASE);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.lm-ctx, .lm-actionbar, main h1').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(route.startsWith('/body') || route.includes('simulate') ? 1800 : 1000);
}

for (const w of widths) {
  for (const [stateFile, routes, label] of [[planning, PLANNING_ROUTES, 'plan'], [living, LIVING_ROUTES, 'living']]) {
    let { ctx, page } = await context(stateFile, w);
    for (const r of routes) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const t0 = Date.now();
          await goto(page, r);
          await check(page, label, w, r);
          process.stderr.write(`${label} ${w} ${r} ${Date.now() - t0} ms\n`);
          ok = true;
        } catch (e) {
          // a renderer crash or timeout: start a fresh browser context and retry once
          await ctx.close().catch(() => undefined);
          ({ ctx, page } = await context(stateFile, w));
          if (attempt) failures.push(`${KIND} ${w} ${SCHEME} ${r}: could not be measured (${String(e.message).split('\n')[0]})`);
        }
      }
    }
    await ctx.close().catch(() => undefined);
  }
}

// the run and results screens need a real run: a heavier body, suggested goals applied, Find plans
{
  const { ctx, page } = await context(planning, widths[0]);
  page.setDefaultTimeout(120000);
  await goto(page, '/body');
  const wt = page.getByRole('spinbutton', { name: /weight/i }).first();
  await wt.waitFor();
  await wt.fill('104');
  await wt.press('Tab');
  await page.waitForTimeout(800);
  await goto(page, '/plan/goals');
  await page.getByRole('button', { name: 'Suggest from my answers' }).click();
  await page.getByRole('article', { name: /Suggested goals/ }).getByRole('button', { name: /^(Apply|Replace my)/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Find plans/ }).last().click();
  await page.waitForURL(/\/plan\/(run|results)/);
  const onRun = /\/plan\/run/.test(page.url());
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 768 ? 844 : 1000 });
    if (onRun && /\/plan\/run/.test(page.url())) await check(page, 'run', w, '/plan/run');
  }
  await page.waitForURL(/\/plan\/results/, { timeout: 300000 });
  await page.locator('.lp-ladder').waitFor();
  await page.waitForTimeout(1200);
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 768 ? 844 : 1000 });
    await page.waitForTimeout(300);
    await check(page, 'results', w, '/plan/results');
    await page.getByRole('radio', { name: 'table' }).click();
    await page.waitForTimeout(300);
    await check(page, 'table', w, '/plan/results');
    await page.getByRole('radio', { name: 'cards' }).click();
  }
  await ctx.close();
}
await browser.close();
console.log(summary.join('\n'));
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):\n${failures.slice(0, 60).join('\n')}`);
  process.exit(1);
}
console.log(`\nOK: every bar control is ${EXPECT} px (${KIND}, ${SCHEME}).`);
