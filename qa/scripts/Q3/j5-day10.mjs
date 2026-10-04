// Q3b (Q3-J5-01): the four adaptations on day 10 of a running plan (and day 1), through the UI, no AI provider.
// Start Medium on 2 Oct 2026 (day 1), then move the browser clock to 11 Oct (day 10) and: re-plan the rest, a meal out,
// travelling, busy + push the plan back. Each must give a plan (a version write or "no change"), never "no safe plan".
import { fresh, go, read, closeAll, results, sleep } from './lib.mjs';
import { search, startRung } from './j5-lib.mjs';

const R = results('J5-day10');
const { check } = R;
const { ctx, page, errors } = await fresh('desktop');
await ctx.clock.install({ time: new Date('2026-10-02T09:00:00') });
await page.addInitScript(() => { window.__toasts = []; new MutationObserver(() => { for (const e of document.querySelectorAll('.lm-toast__msg')) { const t = e.textContent.trim(); if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); } }).observe(document, { childList: true, subtree: true, characterData: true }); });
const writes = () => page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed' && e.changeSet).map((e) => e.commandId));
const menu = async (item) => { await page.getByRole('button', { name: 'Today menu' }).click(); await sleep(500); await page.getByRole('menuitem', { name: item }).click(); await sleep(1200); };
const ANSWER = /no safe plan|didn’t go through|ready|proposal|changed|applied|eased|no change|Try again/i;
const seen = [];
async function answer(ms = 300000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const hit = await page.evaluate(([src, prev]) => window.__toasts.find((x) => new RegExp(src, 'i').test(x) && !/Fitting the plan|Re-planning the remaining/.test(x) && !prev.includes(x)) ?? null, [ANSWER.source, seen]);
    if (hit) { seen.push(hit); return { text: hit, secs: Math.round((Date.now() - t) / 1000) }; }
    await sleep(1000);
  }
  return { text: 'no answer', secs: Math.round((Date.now() - t) / 1000) };
}
async function away(kind, { pushBack = false } = {}) {
  await menu('I’m busy or away…');
  await page.locator('aside, [role=dialog], main, body').last().locator('button, [role=radio]').filter({ hasText: new RegExp(`^\\s*${kind}\\s*$`) }).first().click(); await sleep(400);
  if (pushBack) await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Tell the plan' }).click();
}
try {
  await search(page);
  await startRung(page, 'Medium');
  await ctx.clock.setSystemTime(new Date('2026-10-11T09:00:00'));
  await go(page, '/today'); await sleep(2500);
  const p = await read(page, 'plan.get');
  check('the plan is on day 10', p.plan?.day === 10, `day ${p.plan?.day} of ${p.plan?.of}`);
  for (const [label, act, cmd] of [
    ['re-plan the rest', () => menu('Re-plan the rest (same goals)'), 'plan.replan'],
    ['a meal out', () => away('a meal out'), 'plan.declareEvent'],
    ['travelling', () => away('travelling'), 'plan.declareEvent'],
    ['busy, push the plan back', () => away('busy', { pushBack: true }), 'plan.shift'],
  ]) {
    const before = (await writes()).length;
    await act();
    const a = await answer();
    await sleep(1500);
    const w = (await writes()).slice(before);
    console.log(`${label}: ${a.secs}s · ${a.text} · ${w.join(',')}`);
    check(`day 10 ${label}: a plan, not "no safe plan"`, !/no safe plan|didn’t go through|no answer/i.test(a.text), a.text.slice(0, 160));
    check(`day 10 ${label}: ${cmd} ran`, w.includes(cmd) || (cmd === 'plan.replan' && /no change|unchanged|still the best/i.test(a.text)), w.join(',') || a.text.slice(0, 120));
    if (await page.getByRole('button', { name: 'Tell the plan' }).count()) await page.getByRole('button', { name: 'Cancel' }).last().click().catch(() => {});
  }
  const vs = await read(page, 'plan.versions');
  check('plan.versions has the new versions (proposals or adopted)', vs.length >= 5, vs.map((x) => `v${x.version}:${x.status}`).join(' '));
} catch (e) { check('journey ran', false, e.message.split('\n')[0]); }
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
R.save();
await closeAll();
const bad = R.rows.filter((r) => !r.ok);
console.log(`J5-day10: ${R.rows.length - bad.length}/${R.rows.length} passed`);
process.exit(bad.length ? 1 : 0);
