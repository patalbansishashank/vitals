// J4 goals: "Suggest from my answers" (plan 02 item 8) — never pre-filled, proposal → Clear/Apply, reasons kept, no provider.
import { fresh, seed, read, go, closeAll, results, mainText, scanForbidden, shot, sleep } from './lib.mjs';
const R = results('J4-goals');
const { page, errors } = await fresh('desktop');
const ev = () => page.evaluate(() => window.__vitals.events().filter((e) => (e.type === 'committed' || e.type === 'read')).map((e) => ({ id: e.commandId, write: !!e.changeSet })));
try {
  await seed(page);
  await go(page, '/plan/goals'); await sleep(2500);
  let g = await read(page, 'goals.get');
  R.check('goals empty before pressing Suggest (bus)', g.goals.length === 0 && !g.suggested, JSON.stringify(g.goals));
  let t = await mainText(page);
  R.check('goals empty before pressing Suggest (DOM)', /0 of 6/.test(t) && !/Suggested goals/.test(t));
  R.check('no suggest command ran on open', !(await ev()).some((e) => e.id === 'goals.suggest'));
  await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
  g = await read(page, 'goals.get');
  R.check('still empty after a reload', g.goals.length === 0);
  R.check('forbidden scan (goals page)', !scanForbidden(await mainText(page)).length, scanForbidden(await mainText(page)).join(';'));
  // proposal, then Clear: nothing written
  await page.getByRole('button', { name: 'Suggest from my answers' }).click(); await sleep(2500);
  t = await mainText(page);
  R.check('proposal shown', /Suggested goals/.test(t));
  R.check('rule-based without a provider (labelled, no provider claim)', /rules · from your answers/.test(t) && !/thinking|AI provider|Coach is/i.test(t.match(/Suggested goals[\s\S]*?Apply/)?.[0] ?? ''));
  const card = t.match(/Suggested goals[\s\S]*?\nApply\n/)?.[0] ?? '';
  const hits = scanForbidden(card);
  R.check('forbidden scan (suggestion card)', !hits.length, hits.join(' ; '));
  g = await read(page, 'goals.get');
  R.check('proposal does not write goals', g.goals.length === 0);
  R.check('goals.suggest ran through the bus as a read', (await ev()).some((e) => e.id === 'goals.suggest' && !e.write));
  await shot(page, 'J4', 'goals-suggestion');
  await page.getByRole('button', { name: 'Clear', exact: true }).first().click(); await sleep(1000);
  R.check('Clear drops the proposal, goals still empty', !/Suggested goals/.test(await mainText(page)) && (await read(page, 'goals.get')).goals.length === 0);
  // proposal again, Apply
  await page.getByRole('button', { name: 'Suggest from my answers' }).click(); await sleep(2500);
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await sleep(2000);
  g = await read(page, 'goals.get');
  const sug = g.suggested?.suggestion;
  R.check('Apply populates goals (bus)', g.goals.length > 0 && sug && g.goals.length === sug.goals.length && g.goals.every((x, i) => x.metric === sug.goals[i].metric), g.goals.map((x) => `${x.metric}:${x.mode}:${x.amount}`).join(' '));
  R.check('each goal carries its reason', !!sug && sug.goals.every((x) => typeof x.why === 'string' && x.why.length > 20));
  R.check('provenance stored (rule source)', sug?.source === 'rule' && !!sug?.version, `${sug?.source} ${sug?.version}`);
  const e = await ev();
  R.check('Apply committed one goals.edit write', e.filter((x) => x.id === 'goals.edit' && x.write).length === 1, JSON.stringify(e.filter((x) => x.write)));
  t = await mainText(page);
  R.check('goal rows shown after Apply', new RegExp(`${g.goals.length} of 6`).test(t));
  const shown = (sug?.goals ?? []).filter((x) => t.includes(x.why.slice(0, 40)));
  R.check('each reason visible on the goals page after Apply', shown.length === (sug?.goals.length ?? -1), `${shown.length}/${sug?.goals.length}`);
  R.check('suggested limits applied', JSON.stringify(g.constraints.trainingDays) === JSON.stringify(sug?.constraints?.trainingDays), JSON.stringify(g.constraints));
  R.check('missing answers listed instead of guessing', Array.isArray(sug?.missing) && sug.missing.length > 0, (sug?.missing ?? []).map((m) => m.field).join(','));
  await shot(page, 'J4', 'goals-applied');
} catch (err) { R.check('journey ran', false, err.message.slice(0, 180)); }
R.check('no console/page errors', errors.length === 0, errors.join(' | '));
const rows = R.save(); await closeAll();
const fail = rows.filter((r) => !r.ok);
console.log(`J4 goals: ${rows.length - fail.length} pass / ${fail.length} fail`); for (const f of fail) console.log(`FAIL ${f.name} — ${f.detail}`);
process.exit(fail.length ? 1 : 0);
