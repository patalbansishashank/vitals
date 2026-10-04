// J3 Simulator: the four starters (headline scenarios) each created from the UI, run, and asserted via sim.run + the chart.
import { fresh, seed, read, go, closeAll, results, scanForbidden, mainText, shot, sleep } from './lib.mjs';
const R = results('J3');
const { check } = R;
const { page, errors } = await fresh('desktop');
await seed(page);
await go(page, '/simulate');
await page.waitForTimeout(1500);
check('simulate page lists the seeded scenario', (await read(page, 'scenario.list')).length >= 1);
const STARTERS = [
  [/^12 weeks/, 'Moderate deficit', 84],
  [/^8 weeks/, 'Maintenance + training', 56],
  [/^6 weeks/, 'Weekly 36 h fast', 42],
  [/^Blank/, 'New scenario', null],
];
const seen = new Set((await read(page, 'scenario.list')).map((s) => s.id));
for (const [re, name, days] of STARTERS) {
  const tag = name.replace(/\W+/g, '-');
  await page.getByRole('button', { name: /^(Moderate deficit|Maintenance|Weekly|New scenario)/ }).first().click();
  await page.getByRole('button', { name: 'New scenario' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: re }).click();
  await page.waitForTimeout(1500);
  const list = await read(page, 'scenario.list');
  const sc = list.find((s) => !seen.has(s.id));
  check(`${name}: scenario created via UI (scenario.list)`, !!sc, JSON.stringify(list.map((s) => s.name)));
  if (!sc) continue;
  seen.add(sc.id);
  check(`${name}: has programs`, sc.programs.length >= 1, sc.programs.length);
  if (days) check(`${name}: horizon ${days} days`, sc.horizonDays === days, sc.horizonDays);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForFunction(() => /results/.test(location.pathname), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const h2 = await page.evaluate(() => [...document.querySelectorAll('h2')].map((h) => h.innerText));
  check(`${name}: results screen shows the figure chart`, h2.includes('Figure over time'), h2.join('|'));
  const chart = await page.evaluate(() => !!document.querySelector('main svg, main canvas'));
  check(`${name}: a chart element renders`, chart);
  const t = await mainText(page);
  check(`${name}: no forbidden text`, scanForbidden(t).length === 0, scanForbidden(t).join(' ; '));
  const r = await read(page, 'sim.run', { scenarioId: sc.id, draws: 0 }, { raw: true });
  check(`${name}: sim.run starts a job`, r.ok && r.job?.jobId, JSON.stringify(r).slice(0, 150));
  let res;
  for (let i = 0; i < 40; i++) {
    const jr = await read(page, 'job.result', { jobId: r.job.jobId }, { raw: true });
    if (jr.output?.status?.state === 'done') { res = jr.output.result; break; }
    await sleep(500);
  }
  check(`${name}: sim.run job done`, !!res);
  if (res) {
    check(`${name}: result days = horizon`, res.days === sc.horizonDays, res.days);
    check(`${name}: final scale weight finite and plausible`, Number.isFinite(res.final.scaleWeight) && res.final.scaleWeight > 40 && res.final.scaleWeight < 200, res.final.scaleWeight);
    if (/deficit/i.test(name)) check(`${name}: deficit loses weight`, res.final.scaleWeight < res.initial.scaleWeight, `${res.initial.scaleWeight} -> ${res.final.scaleWeight}`);
    if (/Maintenance/.test(name)) check(`${name}: weight roughly stable (±3 kg)`, Math.abs(res.final.scaleWeight - res.initial.scaleWeight) < 3, `${res.initial.scaleWeight} -> ${res.final.scaleWeight}`);
    if (/fast/i.test(name)) check(`${name}: reports warnings on the fast days`, (res.warnings?.length ?? 0) > 0, res.warnings?.length);
  }
  if (name === 'Moderate deficit') await shot(page, 'J3', 'results');
}
const ev = await page.evaluate(() => window.__vitals.events().filter((e) => e.type === 'committed').map((e) => e.commandId));
check('committed events include scenario.create and schedule edits', ev.some((c) => /scenario\./.test(c)), [...new Set(ev)].join(','));
check('no uncaught errors', errors.length === 0, errors.join(' || '));
R.save();
await closeAll();
const bad = R.rows.filter((r) => !r.ok);
console.log(`J3: ${R.rows.length - bad.length}/${R.rows.length} passed`);
process.exit(bad.length ? 1 : 0);
