// J1: "change my training days to Tue/Thu" → proposal cards → Apply (Coach) → adopt on Today (adoption rule: the
// change adds load) → plan documents changed → Undo restores. Also: a second proposal computed against the old head,
// and the same request on the Medium and Hard plans (staged as proposals).
import { openProfile, go, read, say, cards, sleep, results, providerLog, lastTurnText, shot, ROOT, events, applyAndWait, weekSessions, nextDow } from './lib.mjs';

export async function run({ vp = 'desktop' } = {}) {
  const { check, save } = results('J1-training-days');
  await providerLog(`${ROOT}/.e6-tmp/q4-J1.jsonl`);
  const { ctx, page, errors } = await openProfile('j1', { from: 'seed-living', vp });
  try {
    await go(page, '/coach');
    const today = (await read(page, 'today.get', {})).date;
    const mon = nextDow(today, 1);
    const before = await weekSessions(page, mon);
    await say(page, 'change my training days to Tue/Thu');
    const pend = (await read(page, 'coach.pending')).filter((p) => p.status === 'pending');
    check('proposals staged, nothing applied', pend.some((p) => p.commandId === 'plan.shift') && (await weekSessions(page, mon)) === before, pend.map((p) => p.commandId).join(','));
    const c = (await cards(page)).filter((x) => x.cls === 'edit' && x.state === 'pending');
    check('proposal card shows the day diff (Mon → no training, Tue → training)', c.some((x) => /no training/.test(x.text) && /resistance training/.test(x.text)), c.map((x) => x.text.slice(0, 120)).join(' || '));
    await shot(page, `J1-proposals-${vp}`);
    await applyAndWait(page, 'Apply proposal: shift plan days');
    const v1 = await read(page, 'plan.versions', {});
    check('Apply (Coach card) leaves a proposed version for Today (load goes up)', v1.some((v) => v.status === 'proposed'), JSON.stringify(v1.map((v) => [v.version, v.status])));
    await go(page, '/today');
    await page.getByRole('button', { name: /^Apply proposal/ }).first().click();
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const after = await weekSessions(page, mon);
    check('adopted on Today: Monday no training, Tuesday training', /Mon:- Tue:resistance/.test(after), `${before} → ${after}`);
    const v2 = await read(page, 'plan.versions', {});
    check('plan documents: an adopted version whose parent is the proposal', v2.some((v) => v.status === 'adopted' && v.parent !== null && v2.some((p) => p.version === v.parent && p.status === 'proposed')), JSON.stringify(v2.map((v) => [v.version, v.status, v.parent])));
    check('the applied proposal leaves Today', (await page.getByRole('button', { name: /^Apply proposal/ }).count()) === 0);
    check("Today's toast offers Undo", (await undo.count()) > 0);
    await undo.first().click();
    await sleep(4000);
    check('Undo restores the training days', (await weekSessions(page, mon)) === before, await weekSessions(page, mon));
    // the second proposal (Wed→Thu) was computed against the old head: applying it must not fail with an error
    await go(page, '/coach');
    const n0 = errors.length;
    await applyAndWait(page, 'Apply proposal: shift plan days');
    const st = (await cards(page)).filter((x) => x.cls === 'edit').map((x) => x.state);
    check('second proposal applies or turns stale without an error', errors.length === n0, errors.slice(n0).join(' | ').slice(0, 200));
    check('second proposal card is applied or stale', st.includes('stale') || st.filter((s) => s === 'applied').length >= 2, st.join(','));
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  // two Coach proposals applied back to back (both computed against the same head)
  const b = await openProfile('j1b', { from: 'seed-living', vp });
  try {
    await go(b.page, '/coach');
    await say(b.page, 'change my training days to Tue/Thu');
    await applyAndWait(b.page, 'Apply proposal: shift plan days');
    const n0 = b.errors.length;
    await applyAndWait(b.page, 'Apply proposal: shift plan days');
    const st = (await cards(b.page)).filter((x) => x.cls === 'edit').map((x) => x.state);
    check('back-to-back Apply of two proposals: no error, second card applied or stale', b.errors.length === n0 && (st.includes('stale') || st.filter((s) => s === 'applied').length >= 2), `${st.join(',')} ${b.errors.slice(n0).join(' | ').slice(0, 200)}`);
  } catch (e) { check('back-to-back part ran', false, e.message.split('\n')[0]); }
  await b.ctx.close();
  // Medium and Hard plans (their fast from Monday to Tuesday evening once made every swap refused: Q4-09): the Coach's
  // Tue/Thu change is staged as proposals, nothing applied
  for (const [rung, label] of [['medium', 'Medium'], ['hard', 'Hard']]) {
    const m = await openProfile(`j1${rung[0]}`, { from: `seed-${rung}`, vp });
    try {
      await go(m.page, '/coach');
      const rungNow = (await read(m.page, 'plan.get')).plan?.rung;
      await say(m.page, 'change my training days to Tue/Thu');
      const pend = (await read(m.page, 'coach.pending')).filter((p) => p.status === 'pending');
      const txt = await lastTurnText(m.page);
      check(`${label} plan: Tue/Thu change accepted by the re-planner (PLAN item 12)`, rungNow === rung && pend.some((p) => p.commandId === 'plan.shift'), `rung ${rungNow}; pending ${pend.map((p) => p.commandId).join(',')}; ${txt.slice(0, 160)}`);
    } catch (e) { check(`${rung} part ran`, false, e.message.split('\n')[0]); }
    await m.ctx.close();
  }
  return save();
}
if (process.argv[1]?.endsWith('j1-training-days.mjs')) { const rows = await run(); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
