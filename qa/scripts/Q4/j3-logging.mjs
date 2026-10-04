// J3: "I ate dal, rice and two eggs" → meal logged with estimates; "I did 30 min on the treadmill" → session logged;
// adherence updates; Undo on the meal card retracts it. Mobile viewport by default.
import { openProfile, go, read, say, cards, sleep, results, providerLog, shot, ROOT, events, cardButton } from './lib.mjs';

export async function run({ vp = 'mobile' } = {}) {
  const { check, save } = results(`J3-logging-${vp}`);
  await providerLog(`${ROOT}/.e6-tmp/q4-J3.jsonl`);
  const { ctx, page, errors } = await openProfile(`j3-${vp}`, { from: 'seed-living', vp });
  try {
    await go(page, '/coach');
    const t0 = await read(page, 'today.get', {});
    const date = t0.date;
    const adh0 = await read(page, 'plan.adherence', { from: date, to: date });
    await say(page, 'I ate dal, rice and two eggs');
    const log1 = await read(page, 'log.get', { from: date, to: date });
    const meal = log1.find((e) => e.kind === 'meal' || e.type === 'meal' || e.components);
    check('meal entry logged by the Coach', !!meal, JSON.stringify(log1).slice(0, 200));
    const names = JSON.stringify(meal ?? {}).toLowerCase();
    check('meal has dal, rice and eggs as components', /dal/.test(names) && /rice/.test(names) && /egg/.test(names), names.slice(0, 200));
    const t1 = await read(page, 'today.get', {});
    const kcal = t1.logged.totals.energyKcal;
    check('energy estimated with an uncertainty band', kcal.value > 300 && kcal.value < 1500 && kcal.sd > 0, JSON.stringify(kcal));
    check('protein estimated', t1.logged.totals.proteinG.value > 10, JSON.stringify(t1.logged.totals.proteinG));
    const mc = (await cards(page)).filter((c) => c.cls === 'log' && c.state === 'applied');
    check('meal card applied with Undo', mc.some((c) => /Undo/.test(c.text) && /kcal|dal/i.test(c.text)), mc.map((c) => c.text.slice(0, 120)).join(' || '));
    await shot(page, `J3-meal-${vp}`);
    await say(page, 'I did 30 min on the treadmill');
    const log2 = await read(page, 'log.get', { from: date, to: date });
    const sess = log2.find((e) => /session/i.test(e.kind ?? e.type ?? '') || e.performed);
    check('session logged (30 min treadmill)', !!sess && /treadmill/.test(JSON.stringify(sess)) && /30/.test(JSON.stringify(sess)), JSON.stringify(sess ?? log2).slice(0, 200));
    const adh1 = await read(page, 'plan.adherence', { from: date, to: date });
    check('adherence updated after logging', JSON.stringify(adh1) !== JSON.stringify(adh0), `${JSON.stringify(adh0).slice(0, 120)} → ${JSON.stringify(adh1).slice(0, 120)}`);
    const ev = await events(page);
    check('log.meal and log.session committed by the ai actor', ['log.meal', 'log.session'].every((id) => ev.some((e) => e.type === 'committed' && e.commandId === id && e.actor?.kind === 'ai')));
    await cardButton(page, 'Undo');
    const t2 = await read(page, 'today.get', {});
    check('Undo on the latest card retracts that entry', (await read(page, 'log.get', { from: date, to: date })).filter((e) => !e.retracted && e.kind !== 'retract').length < log2.length || t2.logged.entries.length < t1.logged.entries.length + 1, JSON.stringify(t2.logged.entries.map((e) => e.kind ?? e.type)));
    await go(page, '/today');
    await shot(page, `J3-today-${vp}`);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j3-logging.mjs')) { const rows = await run({ vp: process.argv[2] || 'mobile' }); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
