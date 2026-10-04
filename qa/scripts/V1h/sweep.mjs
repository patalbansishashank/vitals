// V1h sweep: every route × 390/768/1440 × light/dark on a copy of the Q6 "full" profile (and a fresh one);
// collects console/page errors, unnamed controls, internal names on screen, kcal without kJ, horizontal overflow.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const WT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5273';
const SRC = '/media/DEV/Hobby/Lumen Health/.e6-tmp/q6-profiles/full';
const PROF = `${WT}/.e6-tmp/v1h-prof`;
const W = { 390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 768: { viewport: { width: 768, height: 1024 } }, 1440: { viewport: { width: 1440, height: 900 } } };
const routes = (process.env.ROUTES || '/today,/food,/food/pantry,/train,/coach,/progress,/plan/active,/body,/simulate,/plan,/plan/goals,/plan/results,/onboarding/activity,/onboarding/summary,/onboarding/markers,/evidence,/evidence/validation,/evidence?group=topic,/settings,/settings/ai,/safety,/welcome,/nope-route').split(',');
const widths = (process.env.WIDTHS || '390,768,1440').split(',');
const themes = (process.env.THEMES || 'light,dark').split(',');
const profile = process.env.PROFILE || 'full';
const SHOT = process.env.SHOT === '1';
const out = [];
for (const theme of themes) for (const w of widths) {
  fs.rmSync(PROF, { recursive: true, force: true });
  if (profile === 'full') fs.cpSync(SRC, PROF, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROF, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], colorScheme: theme, serviceWorkers: 'block', ...W[w] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let errs = [];
  if (process.env.KJ === '1') { await page.goto(BASE + '/settings?qa=1', { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 }); await page.waitForTimeout(1500); const k = page.getByRole('radio', { name: 'kJ', exact: true }).or(page.getByRole('button', { name: 'kJ', exact: true })); await k.first().click(); await page.waitForTimeout(800); console.log('kJ set', await k.first().getAttribute('aria-checked'), await k.first().getAttribute('aria-pressed')); }
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 240)));
  for (const r of routes) {
    errs = [];
    try { await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) { errs.push('goto: ' + e.message.slice(0, 100)); }
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden'; };
      const accName = (el) => {
        const l = el.getAttribute('aria-label'); if (l) return l;
        const lb = el.getAttribute('aria-labelledby'); if (lb) return lb.split(' ').map((i) => document.getElementById(i)?.textContent || '').join(' ');
        if (el.labels && el.labels.length) return [...el.labels].map((x) => x.textContent).join(' ');
        if (el.closest('label')) return el.closest('label').textContent;
        return (el.textContent || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') || '').trim();
      };
      const unnamed = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=slider]')]
        .filter(vis).filter((e) => !accName(e).trim()).map((e) => e.outerHTML.slice(0, 140));
      const txt = document.body.innerText;
      const leak = (txt.match(/(§\s?\d|\bR-?\d{2}\b|MODEL_SPEC|SUITE_SPEC|dossier|\bE\d{2}\b|\bQ\d\b|\bLIV-\d+|undefined|NaN|\[object Object\]|Infinity|null\b)/g) || []);
      const lines = txt.split('\n');
      const kcalNoKj = lines.filter((l) => /\bkcal\b|kilocalorie|calories/i.test(l)).slice(0, 5);
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const h1 = [...document.querySelectorAll('h1')].filter(vis).map((h) => h.textContent.trim()).slice(0, 3);
      const imgs = [...document.querySelectorAll('img:not([alt])')].length;
      const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
      const dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k).slice(0, 5);
      return { url: location.pathname + location.search, title: document.title, h1, unnamed: unnamed.slice(0, 6), nUnnamed: unnamed.length, leak: [...new Set(leak)], kcalNoKj, overflow, imgs, dupIds };
    });
    const rec = { theme, w, route: r, ...info, errs: [...new Set(errs)].slice(0, 6) };
    out.push(rec);
    if (SHOT) await page.screenshot({ path: `${WT}/.e6-tmp/shots/${theme}-${w}-${r.replace(/[^a-z0-9]+/gi, '_')}.png` });
    const bad = rec.errs.length || rec.nUnnamed || rec.leak.length || rec.kcalNoKj.length || rec.overflow || !rec.h1.length || rec.dupIds.length;
    if (bad) console.log(JSON.stringify(rec));
  }
  await ctx.close();
}
fs.writeFileSync(`${WT}/.e6-tmp/v1h-sweep-${profile}${process.env.KJ === '1' ? '-kj' : ''}.json`, JSON.stringify(out, null, 1));
console.log('records', out.length);
