// Q6 ladder screens. Planner results live in memory, so one page runs the search once and is then re-laid-out for
// every width and theme (setViewportSize + emulateMedia, no reload; the 390 px pass is not a touch device here).
// usage: node ladder.mjs [quick|x|<request key>]   quick = "Find plans" (default); x = then "Find the best possible plan"
// (≈ 5–10 min); a Q3 test request key (e.g. af: Hard, Medium, Easy + "Ideal = Hard"; fuzz5: a distinct Ideal card) first
// replaces the goals with that request through the Goals page (qa/scripts/Q3/j4-lib.mjs).
import fs from 'node:fs';
import { openProfile, go, shot, sleep, btn, ROOT, WIDTHS, dump, read } from './lib.mjs';
import { measure } from './measure.mjs';
import { click, scrollTo, heading, OVERLAY } from './screens.mjs';
const mode = process.argv[2] || 'quick';
const P = mode === 'x' ? 'ladder-x' : mode === 'quick' ? 'ladder' : `ladder-${mode}`;
const bank = async (page, name) => { await page.getByRole('radio', { name, exact: true }).locator('visible=true').first().click(); await sleep(900); };
const top = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400); };
const SCREENS = [
  { id: `${P}-results`, prep: top },
  { id: `${P}-grid`, prep: scrollTo('.lp-ladder-wrap, .lp-ladder') },
  { id: `${P}-lower`, prep: heading('Effort') },
  { id: `${P}-table`, prep: async (page) => { await bank(page, 'table'); await scrollTo('main table')(page); }, after: (page) => bank(page, 'cards') },
  { id: `${P}-explain`, prep: async (page) => { await top(page); await page.locator('.lp-ladder').getByRole('button', { name: /^[a-z][a-zA-Z₂ ()-]+: (minus|plus|↑|↓|\+|−)/ }).first().click(); await sleep(1000); }, scope: OVERLAY },
  { id: `${P}-because`, prep: async (page) => { const b = page.getByRole('button', { name: /because your/i }).first(); await b.scrollIntoViewIfNeeded(); await b.click(); await sleep(800); } },
  { id: `${P}-start`, prep: async (page) => { await top(page); await btn(page, /^(Start this plan|Replace active plan…)$/).first().click(); await sleep(1000); }, scope: OVERLAY },
];
const outFile = `${ROOT}/qa/results/Q6/shots-${P}.json`;
const { page, errors, close } = await openProfile(`run-${P}`, { w: 1440, from: 'full' });
await go(page, '/plan/goals', { wait: 2000 });
if (mode !== 'quick' && mode !== 'x') {
  process.env.BASE = process.env.BASE || 'http://127.0.0.1:5194';
  const { REQUESTS, applyRequest } = await import('../Q3/j4-lib.mjs');
  for (let i = 0; i < 8; i++) { const rm = page.getByRole('button', { name: /^Remove / }); if (!(await rm.count())) break; await rm.first().click(); await sleep(400); }
  await applyRequest(page, REQUESTS.find((r) => r.k === mode));
}
await btn(page, /Find plans/).first().click();
await btn(page, /^(Start this plan|Replace active plan…)$/).first().waitFor({ timeout: 300000 });
await sleep(3000);
if (mode === 'x') {
  await btn(page, 'Find the best possible plan').click(); await sleep(600);
  await btn(page, 'Start the long search').click();
  const t0 = Date.now();
  // done when the bus reports the X-tier ladder (or 15 min pass)
  for (let i = 0; i < 180; i++) {
    const r = await read(page, 'planner.result', {}).catch(() => null);
    if (r?.ladder?.tier === 'X') break;
    await sleep(5000);
  }
  await sleep(5000);
  console.log('X tier finished in', Math.round((Date.now() - t0) / 1000), 's');
}
const lad = await read(page, 'planner.result', {}).catch((e) => ({ err: e.message }));
console.log('ladder', JSON.stringify(lad.ladder ?? lad).slice(0, 700));
await dump(page, 'results');
const db = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
for (const w of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
  await page.setViewportSize(WIDTHS[w].viewport);
  await page.emulateMedia({ colorScheme: theme });
  await sleep(800);
  for (const s of SCREENS) {
    const key = `${s.id}-${w}-${theme}`;
    errors.length = 0;
    try {
      await s.prep(page); await sleep(500); await page.mouse.move(0, 0);
      const m = await measure(page, { scope: s.scope, vw: w });
      const file = await shot(page, key);
      db[key] = { id: s.id, w, theme, route: '/plan/results', url: new URL(page.url()).pathname, file, ...m, errors: errors.slice(), http: [] };
      console.log(key, `ox=${m.overflowX} off=${m.offscreen.length} ovl=${m.overlaps.length} lc=${m.lowContrast.length} clip=${m.clipped.length} err=${errors.length}`);
    } catch (e) { db[key] = { id: s.id, w, theme, error: String(e.message).split('\n')[0] }; console.log(key, 'ERROR', String(e.message).split('\n')[0]); }
    await page.keyboard.press('Escape').catch(() => {}); await sleep(300);
    if (s.after) await s.after(page).catch(() => {});
  }
}
fs.writeFileSync(outFile, JSON.stringify(db, null, 1));
// ladder grid: the columns are the cards that exist (no empty column or gap), cards align in rows, nothing spills
const rows = [];
for (const w of [390, 768, 1440]) {
  await page.setViewportSize(WIDTHS[w].viewport); await sleep(800);
  await page.locator('.lp-ladder').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
  const g = await page.evaluate(() => {
    const L = document.querySelector('.lp-ladder'); if (!L) return null;
    const lr = L.getBoundingClientRect(); const cs = getComputedStyle(L);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean);
    const cards = [...L.querySelectorAll(':scope > .lp-ladder__col')].map((c) => c.getBoundingClientRect());
    const rule = L.querySelector(':scope > .lp-ladder__rule');
    const titles = [...L.querySelectorAll('.lp-lcard__title, h3')].slice(0, cards.length).map((t) => Math.round(t.getBoundingClientRect().top));
    const gaps = cards.slice(1).map((c, i) => Math.round(c.left - cards[i].right));
    const used = cards.length + (rule ? 1 : 0);
    const right = cards.length ? Math.max(...cards.map((c) => c.right)) : 0;
    return { n: cards.length, cols: cols.length, rule: !!rule, gaps, titles, widths: cards.map((c) => Math.round(c.width)), scrollW: L.scrollWidth, clientW: L.clientWidth, used, overflowX: cs.overflowX, lrRight: Math.round(lr.right), right: Math.round(right), vw: innerWidth };
  });
  const key = `ladder grid ${mode} ${w}`;
  if (!g) { rows.push({ name: `${key}: grid found`, ok: false }); continue; }
  rows.push({ name: `${key}: ${g.n} cards → ${g.cols} grid columns (no empty column)`, ok: g.cols === g.used, detail: JSON.stringify(g) });
  // the gap before a distinct Ideal holds the "your limits" rule column (plan-ladder.md §12.3), so it is wider by design
  const inside = g.rule ? g.gaps.slice(0, -1) : g.gaps;
  rows.push({ name: `${key}: equal card widths and even gaps between the rung cards`, ok: Math.max(...g.widths) - Math.min(...g.widths) <= 1 && (inside.length < 2 || Math.max(...inside) - Math.min(...inside) <= 1), detail: `${g.widths} gaps ${g.gaps}${g.rule ? ' (last holds the limits rule)' : ''}` });
  rows.push({ name: `${key}: card titles on one line across cards`, ok: g.titles.every((t) => Math.abs(t - g.titles[0]) <= 1 || w < 768), detail: g.titles.join(',') });
  rows.push({ name: `${key}: no page overflow (a rail scrolls inside itself only)`, ok: (await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1)), detail: `rail ${g.scrollW}/${g.clientW}` });
}
fs.writeFileSync(`${ROOT}/qa/results/Q6/ladder-grid-${mode}.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
await close();
process.exit(rows.some((r) => !r.ok) ? 1 : 0);
