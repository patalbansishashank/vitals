// Q3 J5 — Start on each level (Hard, Medium, Easy, Ideal) → Living mode, no AI provider.
// Medium: depth run at desktop 1440x900. Hard: light run at mobile 390x844. Easy: light run at tablet 768x1024.
// Ideal: light run at desktop (the Ideal is started through the rung it equals, or the ladder states why).
// usage: node qa/scripts/Q3/j5-living.mjs [Medium Hard Easy Ideal]
import { fresh, go, read, closeAll, mainText, bodyText, scanForbidden, shot, results, sleep } from './lib.mjs';
import { search, startRung, nav, committed } from './j5-lib.mjs';

const R = results('J5');
const { check } = R;
const LEVELS = process.argv.slice(2).length ? process.argv.slice(2) : ['Medium', 'Hard', 'Easy', 'Ideal'];
const VP = { Medium: 'desktop', Hard: 'mobile', Easy: 'tablet', Ideal: 'desktop' };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// the app's living day (it rolls over at the day-boundary hour, not at midnight); set from today.get after Start
let TODAY = localToday();

/** A step that never aborts the journey: a throw is a failed check. */
let CUR = null;
async function step(name, fn) {
  try { return await fn(); } catch (e) {
    const where = e.message.match(/waiting for (.*)/)?.[1] ?? '';
    check(name, false, 'threw: ' + e.message.split('\n')[0] + ' ' + where.slice(0, 90));
    if (process.env.J5_DEBUG && CUR) await CUR.screenshot({ path: `${process.env.TMPDIR}/j5-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
    if (CUR) { await CUR.keyboard.press('Escape').catch(() => {}); await sleep(300); const c = CUR.getByRole('button', { name: /^(Close|Cancel)$/ }); if (await c.count().catch(() => 0)) await c.last().click({ timeout: 3000 }).catch(() => {}); }
    return undefined;
  }
}
/** Forbidden-text scan + layout (no horizontal overflow, no clipped visible controls) for the current screen. */
async function screen(page, L, name) {
  await sleep(600);
  const text = await bodyText(page);
  const hits = scanForbidden(text);
  check(`${L} ${name}: no forbidden text`, hits.length === 0, hits.join(' | '));
  const lay = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - W;
    const scrollsX = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll|hidden)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true; } return false; };
    const clipped = [...document.querySelectorAll('main button, main a[href], main input, main select, main [role=button]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1) && !scrollsX(e); })
      .map((e) => (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 40));
    return { over, clipped: clipped.slice(0, 5) };
  });
  check(`${L} ${name}: no horizontal overflow`, lay.over <= 1, `scrollWidth exceeds by ${lay.over}px`);
  check(`${L} ${name}: no clipped controls`, lay.clipped.length === 0, lay.clipped.join(' | '));
  return text;
}
const cmts = async (page) => committed(page);
const writes = (page) => page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed' && e.changeSet).map((e) => e.commandId));
async function adherence(page) {
  const a = await read(page, 'plan.adherence');
  const d = a.days.find((x) => x.date === TODAY) ?? a.days.at(-1);
  return { score: d?.score ?? null, coverage: d?.coverage ?? 0 };
}
async function waitWrite(page, id, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if ((await writes(page)).includes(id)) return true; await sleep(400); }
  return false;
}

/* ------------------------------------------------------------------ the common part (every level) */
async function common(page, L, vp) {
  // Today
  await step(`${L} today`, async () => {
    if (!/\/today/.test(page.url())) await nav(page, 'today');
    const t = await screen(page, L, 'Today');
    check(`${L} Today renders the plan`, /Today/.test(t) && /day 1 of \d+/.test(t), t.slice(0, 120));
    const tv = await read(page, 'today.get');
    check(`${L} today.get is in living mode with the plan`, tv.mode === 'living' && !!tv.plan?.id, JSON.stringify(tv.plan).slice(0, 120));
    await shot(page, 'J5', `${L.toLowerCase()}-${vp}-today`);
  });
  // Food (no provider)
  await step(`${L} food`, async () => {
    await nav(page, 'food');
    const t = await screen(page, L, 'Food');
    check(`${L} Food says honestly that recipes need a provider`, /Connect an AI provider to get recipes/.test(t));
    const plan = page.getByRole('button', { name: 'Plan my day' });
    if (await plan.count()) {
      if (await plan.first().isDisabled()) check(`${L} Food: "Plan my day" is disabled without a provider`, true, '');
      else { await plan.first().click(); await sleep(3000); }
    }
    const t2 = await mainText(page);
    const spin = await page.locator('main [aria-busy=true], main .lm-spinner, main [role=progressbar]').filter({ visible: true }).count();
    check(`${L} Food: no endless spinner after "Plan my day"`, spin === 0, `${spin} busy elements`);
    check(`${L} Food: no fake recipe without a provider`, !/\bsuggested\b|\baccepted\b|Ingredients/i.test(t2) && /Connect an AI provider/.test(t2), t2.match(/suggested[\s\S]{0,60}/)?.[0] ?? '');
    if (L !== 'Medium') {
      await page.getByRole('button', { name: /^I ate this: .* as planned$/ }).first().click();
      check(`${L} meal logged through the bus (log.meal)`, await waitWrite(page, 'log.meal'), (await writes(page)).join(','));
    }
    const tg = await read(page, 'today.get');
    check(`${L} Food: no recipe was stored`, !JSON.stringify(tg).includes('"recipe"'), '');
    await shot(page, 'J5', `${L.toLowerCase()}-${vp}-food`);
  });
  // Train: swap the first exercise
  await step(`${L} train`, async () => {
    await nav(page, 'train');
    const t = await screen(page, L, 'Train');
    check(`${L} Train shows the equipment line`, /Your equipment/.test(t) && /with your|bodyweight|home/.test(t), '');
    const ts = await read(page, 'train.session', { date: TODAY });
    const ex = ts.sessions?.[0]?.exercises?.[0] ?? ts.sessions?.[0]?.items?.[0];
    const swapBtn = page.getByRole('button', { name: /^Swap / }).first();
    if (!(await swapBtn.count())) { check(`${L} Train: a session to swap in today`, ts.rest === true, 'rest day: nothing to swap'); return; }
    const from = (await swapBtn.getAttribute('aria-label')).replace(/^Swap /, '');
    if (ex?.id) {
      const alts = await read(page, 'train.alternatives', { exerciseId: ex.id, date: TODAY });
      check(`${L} train.alternatives lists options with a credit`, Array.isArray(alts) && alts.length > 0, JSON.stringify(alts).slice(0, 160));
    }
    await swapBtn.click(); await sleep(1000);
    const use = page.getByRole('button', { name: /^Use / }).first();
    const to = (await use.innerText()).trim();
    await use.click(); await sleep(1800);
    check(`${L} Train swap committed through the bus (plan.swapExercise)`, (await writes(page)).includes('plan.swapExercise'), (await writes(page)).join(','));
    const t2 = await mainText(page);
    const m = t2.match(/instead of ([^\n]+)\n(same stimulus|[^\n]*)\n(\d+) %/);
    check(`${L} Train shows the equivalence credit for the swap`, !!m && new RegExp(from.split(' ')[0], 'i').test(m[1]), m ? m[0].replace(/\n/g, ' / ') : t2.slice(0, 200));
    const ev = await page.evaluate(() => window.__vitals.events().filter((e) => e.commandId === 'plan.swapExercise').map((e) => e.changeSet?.docs?.map((d) => d.col + ':' + d.id).join(',')));
    check(`${L} the swap is kept on the day record (dayStatus doc)`, ev.some((d) => (d ?? '').includes(`dayStatus:day:${TODAY}`)), ev.join(' | '));
    await shot(page, 'J5', `${L.toLowerCase()}-${vp}-train`);
  });
}

/* ------------------------------------------------------------------ one level */
async function level(L) {
  const vp = VP[L];
  const { ctx, page, errors } = await fresh(vp);
  CUR = page;
  await page.addInitScript(() => { window.__toasts = []; new MutationObserver(() => { for (const e of document.querySelectorAll('.lm-toast__msg')) { const t = e.textContent.trim(); if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); } }).observe(document, { childList: true, subtree: true, characterData: true }); });
  try {
    const secs = await search(page);
    check(`${L} quick search finished`, true, `${secs}s`);
    const ladder = await mainText(page);
    await screen(page, L, 'Results');
    let rung = L;
    if (L === 'Ideal') {
      const ideal = await page.locator('.lp-ladder').getByText(/^Ideal$/).count();
      const same = /the Ideal is this same plan/.test(ladder);
      check('Ideal: the ladder shows an Ideal card or states that the Ideal is Hard\'s own plan', ideal > 0 || same, same ? 'Ideal = Hard (one-liner shown)' : `ideal card ${ideal}`);
      // The Ideal has no Start key of its own (plan-ladder.md: Start is for rungs); when it equals Hard, Start on Hard starts it.
      rung = 'Hard';
    } else {
      check(`${L}: the ladder has the ${L} card`, await page.getByRole('button', { name: new RegExp(`^Select ${L} plan`) }).count() > 0, '');
    }
    const p = await startRung(page, rung);
    check(`${L}: plan.get has the adopted plan at that level`, p.plan?.rung === rung.toLowerCase() && p.plan?.status === 'active', `${p.plan?.rung} ${p.plan?.status} ${p.plan?.name}`);
    check(`${L}: Start went through the bus (plan.start)`, (await writes(page)).includes('plan.start'), '');

    TODAY = (await read(page, 'today.get')).date ?? TODAY;
    const a0 = await adherence(page);
    await common(page, L, vp);

    // one log by hand: the weight (every level)
    await step(`${L} weight`, async () => {
      await nav(page, 'today');
      const w = page.getByRole('textbox', { name: 'weight' }).or(page.getByLabel('weight', { exact: true })).first();
      await w.fill('87.6'); await w.press('Enter');
      check(`${L} weight logged through the bus (log.measurement)`, await waitWrite(page, 'log.measurement'), (await writes(page)).join(','));
      // a coalesced write lands up to ~300 ms after its committed event: wait for Today to show it
      for (let i = 0; i < 10 && !/87\.6[\s\u2060\u202f]*kg/.test(await mainText(page)); i++) await sleep(500);
      const tv = await read(page, 'today.get');
      check(`${L} the weight shows on Today (trend)`, /87\.6[\s\u2060\u202f]*kg/.test(await mainText(page)), JSON.stringify(tv.trendWeight ?? null).slice(0, 120) + ' · ' + ((await mainText(page)).match(/[^\n]*[Ww]eigh[^\n]*/g) ?? []).slice(0, 4).join(' / ').slice(0, 200));
    });
    if (L === 'Medium') await depth(page, L);
    const a1 = await adherence(page);
    check(`${L} adherence moved after logging (plan.adherence)`, a1.coverage > a0.coverage || (a1.score ?? -1) !== (a0.score ?? -1), `before ${JSON.stringify(a0)} after ${JSON.stringify(a1)}`);

    if (vp === 'desktop' && L === 'Medium') {
      // tablet layout of the same screens in the same context
      await page.setViewportSize({ width: 768, height: 1024 });
      for (const s of ['today', 'food', 'train']) { await nav(page, s); await screen(page, `${L}@768`, s); }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    check(`${L}: no console or page errors`, errors.length === 0, errors.join(' | '));
  } catch (e) {
    check(`${L}: journey completed`, false, e.message.split('\n')[0]);
    await shot(page, 'J5', `${L.toLowerCase()}-fail`).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ the depth run (Medium) */
async function depth(page, L) {
  // Pantry editor: add and remove an item (pantry.get)
  await step(`${L} pantry`, async () => {
    await nav(page, 'food');
    const t = await mainText(page);
    check(`${L} Food has a Pantry section with an editor`, /Pantry/.test(t) && (await page.getByRole('link', { name: 'Edit pantry' }).count()) > 0, '');
    await page.getByRole('link', { name: 'Edit pantry' }).click(); await sleep(1500);
    await screen(page, L, 'Pantry');
    const has = async (re) => re.test(JSON.stringify(await read(page, 'pantry.get')));
    await page.getByRole('searchbox').or(page.getByLabel(/Search what/)).first().fill('paneer'); await sleep(800);
    const chip = () => page.locator('main').getByText('Paneer', { exact: true }).first();
    await chip().click(); await sleep(1200);
    check(`${L} pantry: ticking Paneer adds it (pantry.get)`, await has(/paneer/i), JSON.stringify(await read(page, 'pantry.get')).slice(0, 200));
    await chip().click(); await sleep(1200);
    check(`${L} pantry: unticking Paneer removes it (pantry.get)`, !(await has(/"paneer"|Paneer"/)), JSON.stringify(await read(page, 'pantry.get')).slice(0, 200));
    await page.getByRole('button', { name: 'Clear search' }).click().catch(() => {});
    const free = page.getByPlaceholder(/leftover dal/);
    await free.fill('egg boiler'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await sleep(1200);
    check(`${L} pantry: "I also have…" adds a free-text item`, await has(/egg boiler/i), '');
    check(`${L} pantry edits went through the bus`, (await writes(page)).some((c) => /pantry/.test(c)), (await writes(page)).join(','));
    await page.getByRole('button', { name: 'Back to Food' }).click(); await sleep(1500);
  });
  // Meal by hand
  await step(`${L} meal`, async () => {
    await nav(page, 'food');
    await page.getByRole('button', { name: 'I ate this: breakfast as planned' }).click();
    check(`${L} meal logged through the bus (log.meal)`, await waitWrite(page, 'log.meal'), (await writes(page)).join(','));
    // the committed event can arrive before the read model has the entry: read again for a few seconds
    let log = [];
    for (let i = 0; i < 10 && !log.some((e) => e.kind === 'meal'); i++) { log = await read(page, 'log.get', { from: TODAY, to: TODAY }); if (!log.some((e) => e.kind === 'meal')) await sleep(800); }
    check(`${L} log.get has the meal`, log.some((e) => e.kind === 'meal'), JSON.stringify(log).slice(0, 200));
  });
  // Session by hand
  await step(`${L} session`, async () => {
    await nav(page, 'train');
    await page.getByRole('button', { name: 'Session done' }).click();
    check(`${L} session logged through the bus (log.session)`, await waitWrite(page, 'log.session'), (await writes(page)).join(','));
    const log = await read(page, 'log.get', { from: TODAY, to: TODAY });
    check(`${L} log.get has the session`, log.some((e) => e.kind === 'session'), '');
  });
  // Fast by hand: only possible when the day prescribes a fast (row on Today)
  await step(`${L} fast`, async () => {
    await nav(page, 'today');
    const row = page.getByRole('button', { name: /^Mark fast as planned$/ });
    if (await row.count()) {
      await row.click();
      check(`${L} fast logged through the bus`, await waitWrite(page, 'log.markDay'), '');
    } else {
      const tv = await read(page, 'today.get');
      check(`${L} fast: no fast row because the day prescribes no fast`, !tv.prescription?.fast, 'prescription has a fast but Today shows no row');
    }
  });
  // Today menu: meal out, travel (declare an event), shift (push back), check-in, re-plan
  const menu = async (item) => { await page.getByRole('button', { name: 'Today menu' }).click(); await sleep(500); await page.getByRole('menuitem', { name: item }).click(); await sleep(1200); };
  const answers = [];
  const away = async (kind, { pushBack = false, label } = {}) => {
    const before = (await writes(page)).length;
    await page.evaluate(() => { window.__toasts.length = 0; });
    await menu('I’m busy or away…');
    await page.locator('aside, [role=dialog], main, body').last().locator('button, [role=radio]').filter({ hasText: new RegExp(`^\\s*${kind}\\s*$`) }).first().click(); await sleep(400);
    if (pushBack) await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Tell the plan' }).click();
    const t = Date.now();
    const t2 = Date.now();
    const ANSWER = /no safe plan|didn’t go through|ready|proposal|changed|applied|eased|Try again/i;
    // an answer toast of the previous adaptation can be announced again: only a new answer counts
    while (Date.now() - t2 < 240000 && !(await page.evaluate(([src, prev]) => window.__toasts.some((x) => new RegExp(src, 'i').test(x) && !prev.includes(x)), [ANSWER.source, answers]))) await sleep(1000);
    answers.push(...(await page.evaluate((src) => window.__toasts.filter((x) => new RegExp(src, 'i').test(x)), ANSWER.source)));
    const status = await page.evaluate(() => window.__toasts.splice(0).join(' | ').slice(0, 220));
    console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(0)}s · toasts: ${status}`);
    await sleep(1500);
    const w = (await writes(page)).slice(before);
    if (await page.getByRole('button', { name: 'Tell the plan' }).count()) { check(`${L} ${label}: the sheet closes with an answer`, false, `still open · ${status}`); await page.getByRole('button', { name: 'Cancel' }).last().click().catch(() => {}); await sleep(800); }
    check(`${L} ${label}: the plan takes the change (a write or a proposal, not "no safe plan")`, w.length > 0 && !/no safe plan/i.test(status), `${w.join(',')} · ${status}`);
    return w;
  };
  await step(`${L} meal out`, async () => { await nav(page, 'today'); const w = await away('a meal out', { label: 'meal out' }); check(`${L} meal out → plan.declareEvent`, w.includes('plan.declareEvent'), w.join(',')); });
  await step(`${L} travel`, async () => { const w = await away('travelling', { label: 'travel (declare an event)' }); check(`${L} travel → plan.declareEvent`, w.includes('plan.declareEvent'), w.join(',')); });
  await step(`${L} busy+shift`, async () => { const w = await away('busy', { pushBack: true, label: 'busy days pushed back (shift)' }); check(`${L} push back → plan.shift`, w.includes('plan.shift'), w.join(',')); });
  await step(`${L} proposals`, async () => {
    const t = await screen(page, L, 'Today with proposals');
    await shot(page, 'J5', 'medium-desktop-today-proposals');
    const v0 = (await read(page, 'plan.get')).plan.headVersion;
    const apply = page.getByRole('button', { name: /^Apply|^Accept|^Use this/ }).first();
    if (await apply.count()) {
      await apply.click(); await sleep(2500);
      const v1 = (await read(page, 'plan.get')).plan.headVersion;
      check(`${L} applying a proposal makes a new plan version`, v1 > v0, `v${v0} → v${v1}; ${(await writes(page)).slice(-2).join(',')}`);
    } else check(`${L} event changes show as proposal cards or were applied at once`, /proposal|changed|eas/i.test(t) || (await read(page, 'plan.get')).plan.headVersion > 1, t.slice(0, 200));
  });
  await step(`${L} check-in`, async () => {
    await menu('Check in now');
    const t = await bodyText(page);
    check(`${L} check-in opens with trend, verdict, adherence`, /Weekly check-in/.test(t) && /verdict/.test(t) && /adherence/.test(t), '');
    await screen(page, L, 'Check-in');
    await page.getByRole('button', { name: 'Done' }).last().click(); await sleep(1500);
    console.log('check-in writes:', (await writes(page)).filter((c) => /check/i.test(c)).join(',') || 'none (first check-in is on day 7; "Check in now" shows the read-only summary)');
  });
  await step(`${L} re-plan`, async () => {
    const before = (await writes(page)).length;
    await page.evaluate(() => { window.__toasts.length = 0; });
    await menu('Re-plan the rest (same goals)');
    const t = Date.now();
    let toast = '';
    while (Date.now() - t < 300000) {
      toast = await page.evaluate(() => window.__toasts.join(' | '));
      if ((await writes(page)).length > before || /ready|didn|proposal|new plan|unchanged|no safe/i.test(toast.replace(/Re-planning the remaining[^|]*/g, ''))) break;
      await sleep(1000);
    }
    const w = (await writes(page)).slice(before);
    check(`${L} re-plan the rest finishes with a result (plan.replan)`, w.includes('plan.replan') || /ready|proposal/i.test(toast), `${((Date.now() - t) / 1000).toFixed(0)}s · ${w.join(',')} · ${toast.slice(0, 160)}`);
  });
  // Progress: blood markers entered → markers trend
  await step(`${L} markers`, async () => {
    await nav(page, 'progress');
    await screen(page, L, 'Progress');
    await page.getByRole('link', { name: 'Add values' }).click(); await sleep(1500);
    await page.getByRole('button', { name: 'Type the values' }).click(); await sleep(500);
    await screen(page, L, 'Markers entry');
    await shot(page, 'J5', 'medium-desktop-markers-entry');
    const ldl = page.locator('tr:has-text("LDL cholesterol") input[type=text], tr:has-text("LDL cholesterol") input:not([type])').first();
    await ldl.fill('142'); await ldl.press('Tab'); await sleep(800);
    await page.getByRole('button', { name: /^Save/ }).last().click({ timeout: 10000 }); await sleep(2500);
    check(`${L} markers saved through the bus`, (await writes(page)).some((c) => /^markers\./.test(c)), (await writes(page)).slice(-3).join(','));
    const mk = await read(page, 'markers.get');
    check(`${L} markers.get has the typed LDL`, /142/.test(JSON.stringify(mk)), JSON.stringify(mk).slice(0, 200));
    await nav(page, 'progress');
    const t = await mainText(page);
    const sec = t.slice(t.indexOf('Blood markers'), t.indexOf('Blood markers') + 400);
    check(`${L} Progress shows the marker (blood markers section)`, /LDL/i.test(sec) && /142/.test(sec), sec.slice(0, 200).replace(/\n/g, ' / '));
    await shot(page, 'J5', 'medium-desktop-progress-markers');
  });
}

for (const L of LEVELS) { console.log(`--- ${L} (${VP[L]})`); await level(L); }
const rows = R.save();
await closeAll();
const fail = rows.filter((r) => !r.ok);
console.table(rows.map((r) => ({ ok: r.ok ? 'ok' : 'FAIL', name: r.name.slice(0, 70), detail: r.ok ? '' : r.detail.slice(0, 90) })));
console.log(`J5: ${rows.length - fail.length} passed, ${fail.length} failed`);
if (globalThis.__markersText) console.log('MARKERS>>', globalThis.__markersText.slice(0, 1500));
process.exit(fail.length ? 1 : 0);
