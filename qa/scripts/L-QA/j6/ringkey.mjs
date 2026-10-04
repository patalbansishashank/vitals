// Is the Ring key present in the top bar (phone) / context bar (desktop)? Polls at several delays. Dev server fixtures.
//   node qa/scripts/L-QA/j6/ringkey.mjs [390|1440] [light|dark] [state...]
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:4317';
process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const [w = '390', scheme = 'light', ...states] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: Number(w), height: w === '390' ? 844 : 900 }, colorScheme: scheme, ...(w === '390' ? { isMobile: true, hasTouch: true } : {}) });
const first = await ctx.newPage(); await firstRun(first); await first.close();
for (const st of states.length ? states : ['connected']) {
  const p = await ctx.newPage();
  await p.addInitScript((f) => { window.__VITALS_PAGES_FIXTURE__ = f; }, { ring: st, signals: 'full' });
  await p.goto(BASE + '/ring', { waitUntil: 'networkidle' });
  // dev fixtures install after the shell's first render and useRingEnv() is not reactive: a client-side round trip re-renders the key
  await p.waitForFunction(() => !!window.__VITALS_PAGES_FIXTURE_LOADED__).catch(() => {});
  if (process.env.ROUNDTRIP !== '0') { await p.getByRole('link', { name: 'Settings' }).first().click().catch(() => {}); await p.waitForTimeout(800); await p.goBack(); await p.waitForTimeout(800); }
  const res = [];
  for (const d of [500, 1500, 4000]) {
    await p.waitForTimeout(d === 500 ? 500 : d === 1500 ? 1000 : 2500);
    res.push(d + 'ms: ' + JSON.stringify(await p.evaluate(() => ({ keys: [...document.querySelectorAll('a,button')].filter((e) => /^ring\b/i.test(e.getAttribute('aria-label') || '')).map((e) => { const r = e.getBoundingClientRect(); return `${e.getAttribute('aria-label')} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; }), fx: !!window.__VITALS_PAGES_FIXTURE_LOADED__, hdr: [...document.querySelectorAll('header button, header a')].map((e) => e.getAttribute('aria-label') || e.innerText.trim()).filter(Boolean).slice(0, 8) }))));
  }
  console.log(w, scheme, st, '\n  ' + res.join('\n  '));
  await p.screenshot({ path: `qa/results/L-QA/j6/ringkey-${w}-${scheme}-${st}.png`, clip: { x: 0, y: 0, width: Number(w), height: 110 } });
  await p.close();
}
await b.close();
