// J2: "make me a plan for <goal>" → goals set → ladder found → Start on the level the Coach proposes; then each of
// Hard, Medium, Easy and the Ideal via the Coach ("start the easy one", …). Each start is a staged proposal applied
// by the person and undone from its card. Leaves profile `seed-living` (the recommended plan running) for J1/J3/J4/J5.
import fs from 'node:fs';
import path from 'node:path';
import { openProfile, go, read, say, cards, sleep, results, cardButton, waitPlanner, providerLog, planNow, lastTurnText, shot, PROFILES, ROOT, events } from './lib.mjs';

export async function run({ vp = 'desktop' } = {}) {
  const { check, save } = results('J2-plan');
  await providerLog(`${ROOT}/.e6-tmp/q4-J2.jsonl`);
  const { ctx, page, errors } = await openProfile('j2', { from: 'seed-base', vp });
  try {
    await go(page, '/coach');
    await say(page, 'make me a plan for losing 6 kg of fat in 3 months');
    const g = await read(page, 'goals.get');
    check('goals set by the Coach', g.goals.some((x) => x.metric === 'fatMass' && x.mode === 'lose' && x.amount === 6) && g.horizonDays === 90, JSON.stringify(g.goals));
    const c1 = await cards(page);
    check('goal change card applied with Undo', c1.some((c) => c.cls === 'log' && c.state === 'applied' && /goal/i.test(c.text) && /Undo/.test(c.text)), JSON.stringify(c1));
    const ev = await events(page);
    check('goals.edit committed by the ai actor', ev.some((e) => e.type === 'committed' && e.commandId === 'goals.edit' && e.actor?.kind === 'ai'));
    const r = await waitPlanner(page);
    check('planner search started by the Coach finished', r?.status === 'done' && r.resultStatus === 'ok', `${r?.status} ${r?.resultStatus} ${r?.message}`);
    const rungs = (r?.ladder?.rungs ?? []).map((x) => x.kind);
    check('ladder lists every rung or a reason', ['hard', 'medium', 'easy'].every((k) => rungs.includes(k) || r.ladder.collapsed.some((c) => c.rung === k && c.text)), JSON.stringify(r?.ladder ?? {}).slice(0, 200));

    const levels = [['recommended', 'start the one you recommend'], ['hard', 'start the hard one'], ['medium', 'start the medium one'], ['easy', 'start the easy one']];
    for (const [lvl, msg] of levels) {
      await say(page, msg);
      const pend = await read(page, 'coach.pending');
      const p = pend.find((x) => x.commandId === 'plan.start' && x.status === 'pending');
      const want = lvl === 'recommended' ? null : lvl;
      const exists = !want || rungs.includes(want);
      if (!exists) { check(`${lvl}: no rung, nothing staged`, !p, JSON.stringify(pend).slice(0, 200)); continue; }
      check(`${lvl}: plan.start staged as a proposal (not applied)`, !!p && !(await planNow(page)), JSON.stringify(pend).slice(0, 200));
      const pc = (await cards(page)).filter((c) => c.cls === 'edit' && c.state === 'pending');
      check(`${lvl}: proposal card with Apply/Adjust/Discard`, pc.length >= 1 && /Apply/.test(pc.at(-1).text) && /Discard/.test(pc.at(-1).text), JSON.stringify(pc.at(-1) ?? {}));
      if (lvl === 'recommended') await shot(page, `J2-proposal-${vp}`);
      await cardButton(page, 'Apply proposal: start a plan');
      const plan = await planNow(page);
      check(`${lvl}: Apply starts the plan (${plan?.rung})`, !!plan && plan.status !== 'ended' && (!want || plan.rung === want), JSON.stringify(plan ?? null).slice(0, 200));
      if (lvl === 'recommended') check('recommended = the Coach-proposed rung (first option)', plan?.rung === p.input.source.rung, `${plan?.rung} vs ${p.input.source.rung}`);
      const ev2 = await events(page);
      check(`${lvl}: plan.start committed by the person`, ev2.some((e) => e.type === 'committed' && e.commandId === 'plan.start' && e.actor?.kind === 'user'));
      await cardButton(page, 'Undo');
      const after = await planNow(page);
      check(`${lvl}: Undo on the card removes the plan`, !after || after.status === 'discarded' || after.status === 'ended', JSON.stringify(after ?? null).slice(0, 160));
    }
    await say(page, 'start the ideal one');
    const pi = (await read(page, 'coach.pending')).filter((x) => x.commandId === 'plan.start' && x.status === 'pending');
    const ideal = await lastTurnText(page);
    check('Ideal: the app refuses plan.start for the Ideal; nothing staged, no plan', pi.length === 0 && !(await planNow(page)) && /cannot be started/i.test(ideal), ideal.slice(0, 200));
    // keep the Easy plan running for the living journeys (day edits of Hard and Medium are refused: finding Q4-02)
    await say(page, 'start the easy one');
    await cardButton(page, 'Apply proposal: start a plan');
    const kept = await planNow(page);
    check('Easy plan running for the next journeys', !!kept, JSON.stringify(kept ?? null).slice(0, 120));
    await shot(page, `J2-started-${vp}`);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  fs.rmSync(path.join(PROFILES, 'seed-living'), { recursive: true, force: true });
  fs.cpSync(path.join(PROFILES, 'j2'), path.join(PROFILES, 'seed-living'), { recursive: true });
  // a Medium plan for J1's check that its day edits are refused honestly
  // Medium and Hard plans for J1's Tue/Thu change on those rungs (Q4-09)
  for (const rung of ['medium', 'hard']) {
    const m = await openProfile(`j2${rung[0]}`, { from: 'seed-base', vp });
    try {
      await go(m.page, '/coach');
      await say(m.page, 'make me a plan for losing 6 kg of fat in 3 months');
      await waitPlanner(m.page);
      await say(m.page, `start the ${rung} one`);
      await cardButton(m.page, 'Apply proposal: start a plan');
    } catch {}
    await m.ctx.close();
    fs.rmSync(path.join(PROFILES, `seed-${rung}`), { recursive: true, force: true });
    fs.cpSync(path.join(PROFILES, `j2${rung[0]}`), path.join(PROFILES, `seed-${rung}`), { recursive: true });
  }
  return save();
}
if (process.argv[1]?.endsWith('j2-plan.mjs')) { const rows = await run(); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
