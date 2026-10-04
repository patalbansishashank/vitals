// J4: "I'm travelling for three days" → plan.declareEvent staged → Apply → re-plan per the adoption rule (the change
// only lowers load and the person applied it → adopted at once; otherwise a proposal to adopt on Today) → the three
// days prescribe no training → Undo restores.
import { openProfile, go, read, say, cards, sleep, results, providerLog, shot, ROOT, events, applyAndWait, weekSessions } from './lib.mjs';

export async function run({ vp = 'desktop' } = {}) {
  const { check, save } = results(`J4-travel-${vp}`);
  await providerLog(`${ROOT}/.e6-tmp/q4-J4.jsonl`);
  const { ctx, page, errors } = await openProfile(`j4-${vp}`, { from: 'seed-living', vp });
  try {
    await go(page, '/coach');
    const today = (await read(page, 'today.get', {})).date;
    const d1 = new Date(today + 'T12:00:00Z'); d1.setUTCDate(d1.getUTCDate() + 1);
    const from = d1.toISOString().slice(0, 10);
    const before = await weekSessions(page, from);
    await say(page, "I'm travelling for three days");
    const pend = (await read(page, 'coach.pending')).filter((p) => p.status === 'pending');
    const ev0 = pend.find((p) => p.commandId === 'plan.declareEvent');
    check('travel event staged as a proposal', !!ev0 && ev0.input.kind === 'travel', JSON.stringify(pend.map((p) => [p.commandId, p.input?.kind])));
    const c = (await cards(page)).filter((x) => x.cls === 'edit' && x.state === 'pending').at(-1);
    check('proposal card explains travel days and goal-date impact', !!c && /Travel/i.test(c.text) && /goal/i.test(c.text), c?.text.slice(0, 300));
    await shot(page, `J4-proposal-${vp}`);
    const v0 = (await read(page, 'plan.versions', {})).length;
    await applyAndWait(page, 'Apply proposal: declare an event');
    let vs = await read(page, 'plan.versions', {});
    const newest = vs.at(-1);
    check('Apply runs the re-plan (a new plan version)', vs.length > v0, JSON.stringify(vs.map((v) => [v.version, v.status, v.reason])));
    // adoption rule (src/commands/living/adapt.ts, docs/LIVING_PLAN.md §9): adopted at once only when every change
    // lowers load AND the person made it; a change the Coach made is always a proposal the person adopts on Today
    check('adoption rule: the Coach-made change waits on Today as a proposal', newest?.status === 'proposed', `${newest?.status}`);
    await go(page, '/today');
    await page.getByRole('button', { name: /^Apply proposal/ }).first().click();
    const toastUndo = page.getByRole('button', { name: 'Undo', exact: true });
    await toastUndo.first().waitFor({ timeout: 30000 }).catch(() => {});
    vs = await read(page, 'plan.versions', {});
    check('adopted on Today', vs.at(-1)?.status === 'adopted', JSON.stringify(vs.map((v) => [v.version, v.status])));
    const after = await weekSessions(page, from);
    check('the three travel days prescribe no training', after.split(' ').slice(0, 3).every((x) => x.endsWith(':-')), `${before} → ${after}`);
    const t = await read(page, 'today.get', { date: from });
    check('travel day keeps food as planned (energy prescribed)', (t.prescription?.energyKcal ?? 0) > 800, String(t.prescription?.energyKcal));
    await toastUndo.first().click().catch(() => {});
    await sleep(4000);
    check("Undo (Today's toast) restores the days", (await weekSessions(page, from)) === before, await weekSessions(page, from));
    // the same change adopted again, then undone from the Coach card instead
    await page.getByRole('button', { name: /^Apply proposal/ }).first().click();
    await sleep(5000);
    await go(page, '/coach');
    await applyAndWait(page, 'Undo proposal: declare an event');
    const restored = await weekSessions(page, from);
    check('Undo on the Coach card after adoption restores the days', restored === before, `${before} → ${restored}`);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j4-travel.mjs')) { const rows = await run({ vp: process.argv[2] || 'desktop' }); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
