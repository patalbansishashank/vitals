// J4 helpers: drive the Planner UI to a test request, run a tier, and assert the ladder (plan 02 items 8, 10, 11).
import fs from 'node:fs';
import { ROOT, go, read, mainText, scanForbidden, shot, sleep } from './lib.mjs';

/** The 17 QA requests (src/engine/planner/__tests__/qa/requests.ts), dumped from qaRequest(key) into j4-requests.json. */
export const REQUESTS = JSON.parse(fs.readFileSync(`${ROOT}/qa/scripts/Q3/j4-requests.json`, 'utf8'));
const PICK = {
  fatMass: /^Fat mass kg/, skeletalMuscle: /^Skeletal muscle kg/, autophagyIdx: /^Autophagy signal/, hunger: /^Hunger pressure index/,
  strength: /^Strength index/, ldl: /^LDL cholesterol mmol/, vo2max: /^VO₂max mL/,
};
const NAME = { fatMass: 'Fat mass', skeletalMuscle: 'Skeletal muscle', autophagyIdx: 'Autophagy signal', hunger: 'Hunger pressure index', strength: 'Strength index', ldl: 'LDL cholesterol', vo2max: 'VO₂max' };

/** Opts in to the 24–72-h fasting tier through Safety settings (same steps as qa/scripts/sim/plib.mjs). */
export async function optInT3(page) {
  await page.locator('.lp-safety summary').click(); await sleep(500);
  await page.getByRole('switch', { name: /allow fasts over 24 hours/ }).click({ force: true }); await sleep(800);
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: 'no' }).first().click(); await sleep(300);
  await dlg.getByRole('radio', { name: 'yes' }).nth(1).click(); await sleep(400);
  await dlg.getByRole('radio', { name: 'up to 72 hours' }).click(); await sleep(300);
  const cbs = dlg.getByRole('checkbox'); for (let i = 0; i < await cbs.count(); i++) await cbs.nth(i).check({ force: true });
  await dlg.getByRole('button', { name: 'Allow longer fasts' }).click(); await sleep(800);
}

/** Sets the goals page to a request: ranked goals with mode/amount, horizon, training days, eating window, fasting tier. */
export async function applyRequest(page, req) {
  await go(page, '/plan/goals'); await sleep(2000);
  if (req.safety?.optIns?.fastingTier === 'T3') await optInT3(page);
  for (const g of req.goals) {
    await page.getByRole('button', { name: 'Add a goal' }).click(); await sleep(400);
    await page.getByRole('button', { name: PICK[g.metric] }).first().click(); await page.keyboard.press('Escape'); await sleep(400);
    if (g.target !== undefined && g.targetKind === 'change') {
      const row = page.locator('li, [role=listitem], .lp-rank__item').filter({ has: page.getByRole('button', { name: `Remove ${NAME[g.metric]}`, exact: true }) }).last();
      if (g.target === 0) { const k = row.getByRole('button', { name: 'keep', exact: true }); if (await k.count()) await k.click(); }
      else {
        const mode = g.target < 0 ? 'lose' : 'gain';
        const m = row.getByRole('button', { name: mode, exact: true }); if (await m.count()) await m.click();
        const sb = row.getByRole('spinbutton').first();
        if (await sb.count()) { await sb.fill(String(Math.abs(g.target))); await sb.press('Enter'); }
      }
      await sleep(300);
    }
  }
  const pl = page.getByRole('spinbutton', { name: 'plan length' });
  await pl.fill(String(Math.round(req.horizonDays / 7))); await pl.press('Enter');
  const td = req.constraints?.trainingDaysPerWeek;
  if (td) { await page.getByRole('slider', { name: 'most days' }).fill(String(td.max)); await page.getByRole('slider', { name: 'fewest days' }).fill(String(td.min)); }
  const ew = req.constraints?.eatingWindow;
  if (ew) { await page.getByRole('slider', { name: 'earliest first meal' }).fill(String(ew.earliestH)); await page.getByRole('slider', { name: 'latest last meal' }).fill(String(ew.latestH)); }
  if (req.safety?.fasting?.maxFastHours === 72) await page.getByRole('button', { name: '72 h', exact: true }).click().catch(() => {});
  await sleep(800);
  return read(page, 'goals.get');
}

/** Runs "Find plans" (tier S) or "Find the best possible plan" (tier X); returns { summary, secs, stopped }. */
export async function runTier(page, tier, { capMs = 8 * 60_000 } = {}) {
  const t0 = Date.now();
  let stopped = false;
  if (tier === 'X') {
    if (!/\/plan\/results/.test(page.url())) throw new Error('X needs a results page');
    await page.getByRole('button', { name: 'Find the best possible plan' }).first().click(); await sleep(600);
    // the popover's start key is "Start the long search" (Q3 clicked the trigger twice, so no run started)
    await page.getByRole('button', { name: 'Start the long search' }).first().click();
  } else {
    await page.getByRole('button', { name: /^Find plans/ }).first().click();
  }
  // the run starts asynchronously (an exhaustive run starts in the background): wait for it to be running
  for (let i = 0; i < 20; i++) { const st = (await read(page, 'planner.result')).status; if (st === 'running' || st === 'stopping') break; await sleep(1500); }
  for (;;) {
    const s = await read(page, 'planner.result');
    if (!['running', 'stopping'].includes(s.status)) break;
    const plateau = page.getByRole('button', { name: 'Stop here' });
    if (await plateau.count() && await plateau.first().isVisible()) { await plateau.first().click(); stopped = 'plateau'; }
    if (Date.now() - t0 > capMs && !stopped) {
      await go(page, '/plan/run'); await sleep(1500);
      const b = page.getByRole('button', { name: /Stop and keep/ });
      if (await b.count()) { await b.first().click(); stopped = 'cap'; }
    }
    await sleep(3000);
  }
  const summary = await read(page, 'planner.result');
  if (!/\/plan\/results/.test(page.url())) { await go(page, '/plan/results'); }
  await page.locator('.lp-ladder-face, .lp-nosafe, .lp-results').first().waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return { summary, secs: Math.round((Date.now() - t0) / 1000), stopped };
}

const RUNG = ['hard', 'medium', 'easy'];
const SAME_LINE = 'None of your limits is binding; the Ideal is this same plan.';

/** WCAG contrast of two rgb(a) strings (fg composited on bg). */
export function contrast(fg, bg) {
  const p = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const [r1, g1, b1] = p(fg); const [r2, g2, b2] = p(bg);
  const L = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const a = L(r1, g1, b1), b = L(r2, g2, b2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every ladder assertion on the shown results; `check(name, ok, detail)`; returns a compact matrix cell. */
export async function assertLadder(page, check, label, summary, { tier, deep = true } = {}) {
  const L = summary.ladder;
  const cell = { levels: [], chips: [], ok: true };
  const c = (n, ok, d = '') => { if (!check(`${label}: ${n}`, ok, d)) cell.ok = false; return ok; };
  c('run done with a result', summary.status === 'done' && summary.resultStatus, `${summary.status}/${summary.resultStatus} ${summary.message ?? ''}`);
  if (!c('planner.result carries the ladder', !!L)) return cell;
  // a stopped longer search that found nothing better keeps the earlier ladder and says so (Q7, keptAfterStop)
  const kept = L.keptAfterStop ?? summary.keptAfterStop;
  c(`search tier is ${tier}`, L.tier === tier || kept === tier, `${L.tier}${kept ? ` kept after a stopped ${kept}` : ''}`);
  if (kept) c('the page says the long search was stopped and the earlier plans are kept', /long search was stopped|search was stopped/i.test(await mainText(page)));
  if (summary.resultStatus !== 'ok') { cell.levels.push(summary.resultStatus); c('no-safe-plan screen explains', /No safe plan|can’t/.test(await mainText(page))); return cell; }
  const dom = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cards = [...document.querySelectorAll('article[data-rung]')].filter(vis).map((a) => ({
      kind: a.dataset.rung,
      effort: Number((a.querySelector('.lp-lcard__effort')?.textContent || '').match(/\d+/)?.[0]),
      same: (a.querySelector('.lp-lcard__same-line')?.textContent || '').trim(),
      legend: !!a.querySelector('.lp-burden__legend'),
      rows: [...a.querySelectorAll('.lp-burden__row')].map((r) => {
        const bar = r.querySelector('.lp-burden__bar'); const fill = r.querySelector('.lp-burden__fill'); const over = r.querySelector('.lp-burden__over');
        return { track: bar?.getBoundingClientRect().width ?? 0, fill: fill ? fill.getBoundingClientRect().width : null, over: over ? over.getBoundingClientRect().width : 0, limitX: (r.querySelector('.lp-burden__limit')?.getBoundingClientRect().left ?? 0) - (bar?.getBoundingClientRect().left ?? 0) };
      }),
    }));
    const chips = [...document.querySelectorAll('.lp-lchip[data-rung]')].filter(vis).map((l) => ({ kind: l.dataset.rung, text: l.textContent.replace(/\s+/g, ' ').trim() }));
    const cols = [...document.querySelectorAll('.lp-ladder__col--card')].filter(vis);
    const grid = cols[0]?.parentElement;
    const gb = grid?.getBoundingClientRect();
    const boxes = cols.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: r.width }; });
    const tracks = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter((x) => /px$/.test(x)).map(parseFloat) : [];
    const conv = document.querySelector('.lp-scale[data-mode="search"]') ?? document.querySelector('.lp-conv');
    return { cards, chips, grid: gb ? { l: gb.left, r: gb.right, w: gb.width } : null, boxes, tracks, conv: conv ? { vis: vis(conv), paths: conv.querySelectorAll('path,polyline,circle').length } : null, docW: document.documentElement.scrollWidth, winW: innerWidth };
  });
  const byKind = Object.fromEntries(dom.cards.map((x) => [x.kind, x]));
  // the four levels: a card, or a chip whose text is the payload's reason
  for (const k of RUNG) {
    const rung = L.rungs.find((r) => r.kind === k);
    if (rung) {
      cell.levels.push(k[0].toUpperCase());
      c(`${k} card shown`, !!byKind[k], dom.cards.map((x) => x.kind).join(','));
      if (byKind[k]) c(`${k} card effort = payload`, byKind[k].effort === rung.effort, `${byKind[k].effort} vs ${rung.effort}`);
    } else {
      const why = L.collapsed.find((x) => x.rung === k);
      const chip = dom.chips.find((x) => x.kind === k);
      cell.chips.push(`${k[0]}:${why?.reason ?? 'none'}`);
      c(`${k} not kept → chip with the payload reason`, !!chip && !!why && chip.text.includes(why.text.trim()), `${chip?.text ?? 'no chip'} | payload ${why ? why.reason + ': ' + why.text : 'no collapse entry'}`);
      c(`${k} not kept → no card`, !byKind[k]);
    }
  }
  if (!L.ideal && L.idealSkipped === 'stopped') { cell.levels.push('I-stopped'); c('no Ideal on a stopped search: the page says it was not searched', /Ideal[^.]*wasn.t searched/.test(await mainText(page)), 'idealSkipped stopped'); }
  else if (!L.ideal) { cell.levels.push('no-Ideal'); c('Ideal present (card or same-as-Hard line)', false, 'payload ideal null'); }
  else if (L.ideal.sameAsHard) {
    cell.levels.push('I=H');
    c('Ideal equals Hard → one-liner on Hard', byKind.hard?.same === SAME_LINE, byKind.hard?.same);
    c('Ideal equals Hard → no Ideal card', !byKind.ideal);
  } else {
    cell.levels.push('I');
    c('Ideal card shown', !!byKind.ideal);
    c('Hard card has no same-as-Ideal line', !byKind.hard?.same);
    if (byKind.ideal) c('Ideal card effort = payload', byKind.ideal.effort === L.ideal.effort, `${byKind.ideal.effort} vs ${L.ideal.effort}`);
  }
  // same-scale bars
  const vals = [];
  for (const card of dom.cards) {
    const p = card.kind === 'ideal' ? L.ideal : L.rungs.find((r) => r.kind === card.kind);
    if (!p) continue;
    c(`${card.kind} legend present`, card.legend);
    c(`${card.kind} has 7 burden rows`, card.rows.length === 7, card.rows.length);
    card.rows.forEach((r, i) => {
      const b = p.burdens[i];
      if (!b || !b.active || r.fill === null) return;
      vals.push({ kind: card.kind, i, v: b.value, px: r.fill, track: r.limitX || r.track });
      if (r.over > 0) c(`${card.kind} overflow only on Ideal and only at the limit`, card.kind === 'ideal' && b.value >= 0.999, `${b.id} v=${b.value}`);
    });
  }
  const tracks = [...new Set(vals.map((x) => Math.round(x.track)))];
  c('one track width (habit → limit) on every card', tracks.length <= 1 || Math.max(...tracks) - Math.min(...tracks) <= 2, tracks.join(','));
  let worst = 0, pair = '';
  for (const a of vals) for (const b of vals) if (a.kind !== b.kind && Math.abs(a.v - b.v) < 0.0015) { const d = Math.abs(a.px - b.px); if (d > worst) { worst = d; pair = `${a.kind}#${a.i} ${a.px.toFixed(1)} vs ${b.kind}#${b.i} ${b.px.toFixed(1)} (v=${a.v})`; } }
  c('equal values draw equal bars across cards', worst <= 1.5, pair || 'no equal pairs');
  const ratio = vals.filter((x) => x.track > 0).map((x) => Math.abs(x.px / x.track - Math.min(1, x.v)));
  c('bar length = value × track', ratio.every((d) => d < 0.03), Math.max(0, ...ratio).toFixed(3));
  // no empty grid column
  if (dom.grid && dom.boxes.length) {
    const rows = {};
    for (const b of dom.boxes) (rows[Math.round(b.t / 20)] ||= []).push(b);
    let maxGap = 0;
    for (const r of Object.values(rows)) { r.sort((a, b) => a.l - b.l); for (let i = 1; i < r.length; i++) maxGap = Math.max(maxGap, r[i].l - r[i - 1].r); }
    const used = Math.max(...dom.boxes.map((b) => b.r)) - Math.min(...dom.boxes.map((b) => b.l));
    c('no gap between card columns', maxGap <= 48, `max gap ${maxGap.toFixed(0)} px`);
    c('cards start at the grid left edge (left-aligned, no leading empty column)', Math.min(...dom.boxes.map((b) => b.l)) - dom.grid.l <= 40, `first card at +${(Math.min(...dom.boxes.map((b) => b.l)) - dom.grid.l).toFixed(0)} px`);
    c('grid has no empty track', dom.tracks.filter((w) => w >= 40).length <= dom.boxes.length, `${dom.tracks.length} tracks for ${dom.boxes.length} cards: ${dom.tracks.map(Math.round).join(",")}`);
  }
  c('no horizontal overflow', dom.docW <= dom.winW + 1, `${dom.docW} > ${dom.winW}`);
  if (tier === 'X') c('convergence graph shown on exhaustive', !!dom.conv?.vis && dom.conv.paths > 0 && L.convergencePoints > 0, JSON.stringify(dom.conv) + ' pts ' + L.convergencePoints);
  const text = await mainText(page);
  const hits = scanForbidden(text);
  c('forbidden-text scan (results)', hits.length === 0, hits.join(' ; '));
  if (deep) {
    // Explain drawer on every card
    for (const card of dom.cards) {
      const btn = page.locator(`article[data-rung="${card.kind}"] .lp-rowbtn`).first();
      if (!(await btn.count())) { c(`${card.kind} Explain drawer opens`, false, 'no explain row'); continue; }
      await btn.scrollIntoViewIfNeeded(); await btn.click(); await sleep(900);
      const dlg = page.locator('dialog[open], [role=dialog]:visible, aside.lm-sidepanel:visible');
      const open = (await dlg.count()) > 0;
      const dtext = open ? await dlg.first().innerText() : '';
      c(`${card.kind} Explain drawer opens`, open && dtext.length > 40, dtext.slice(0, 60).replace(/\s+/g, ' '));
      if (open) { const h = scanForbidden(dtext); c(`${card.kind} Explain drawer forbidden scan`, !h.length, h.join(';')); }
      await page.keyboard.press('Escape'); await sleep(500);
      if (await page.locator('dialog[open], [role=dialog]:visible, aside.lm-sidepanel:visible').count()) { await page.locator('aside.lm-sidepanel:visible button[aria-label^=Close], [role=dialog]:visible button[aria-label^=Close], aside.lm-sidepanel:visible button:has-text("Close")').first().click().catch(() => {}); await sleep(400); }
    }
    // hover keeps text colour and contrast on interactive rows
    const rows = page.locator('article[data-rung] .lp-rowbtn, article[data-rung] .lp-lcard__line--btn, article[data-rung] .lp-lcard__safety--btn');
    const n = Math.min(await rows.count(), 6);
    for (let i = 0; i < n; i++) {
      const el = rows.nth(i);
      await page.mouse.move(0, 0); await sleep(150);
      const before = await el.evaluate((e) => getComputedStyle(e.querySelector('span, p') || e).color);
      await el.hover(); await sleep(300);
      const after = await el.evaluate((e) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const t = e.querySelector('span, p') || e; const fgc = rgba(getComputedStyle(t).color); const fg = `rgb(${fgc[0]}, ${fgc[1]}, ${fgc[2]})`;
        // effective background: composite translucent layers from the row up to the first opaque ancestor
        const layers = []; let n = e;
        while (n && n.nodeType === 1) { const bgc = getComputedStyle(n).backgroundColor; const m = bgc === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(bgc) ? [0, 0, 0, 0] : rgba(bgc); const a = m[3]; if (a > 0) layers.push([m[0], m[1], m[2], a]); if (a >= 1) break; n = n.parentElement; }
        if (!layers.length || layers[layers.length - 1][3] < 1) layers.push([255, 255, 255, 1]);
        let [r, g, b] = layers.pop();
        while (layers.length) { const [r2, g2, b2, a] = layers.pop(); r = r2 * a + r * (1 - a); g = g2 * a + g * (1 - a); b = b2 * a + b * (1 - a); }
        return { fg, raw: getComputedStyle(t).color, bg: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` };
      });
      c(`hover row ${i} keeps text colour`, before === after.raw, `${before} → ${after.fg}`);
      const k = contrast(after.fg, after.bg);
      c(`hover row ${i} contrast ≥ 4.5`, k >= 4.5, `${k.toFixed(2)} ${after.fg} on ${after.bg}`);
    }
    await page.mouse.move(0, 0);
  }
  if (!cell.ok) await shot(page, 'J4', `fail-${label.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => {});
  return cell;
}
