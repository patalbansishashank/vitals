// J4 matrix: the 17 QA planner requests driven through the Goals page, at the quick tier ("Find plans", S) and the
// exhaustive tier ("Find the best possible plan", X; capped), asserting the four ladder levels, bars, grid, drawers.
// Env: KEYS=a,b,… (default all 17) · XKEYS=… (default 6 representatives; "none" to skip) · XCAP_MIN (default 8) · DEEP=0
import fs from 'node:fs';
import { ROOT, fresh, seed, read, closeAll, results, mainText, scanForbidden, shot } from './lib.mjs';
const SHOTS = (process.env.SHOTS || 'a,af').split(',');
import { REQUESTS, applyRequest, runTier, assertLadder } from './j4-lib.mjs';
const R = results(process.env.J4_NAME || 'J4-matrix');
const keys = (process.env.KEYS || REQUESTS.map((r) => r.k).join(',')).split(',');
const xkeys = process.env.XKEYS === 'none' ? [] : (process.env.XKEYS || 'a,c,d,af,fuzz0,fuzz8').split(',');
const capMs = Number(process.env.XCAP_MIN || 8) * 60_000;
const matrix = [];
for (const k of keys) {
  const req = REQUESTS.find((r) => r.k === k);
  const { ctx, page, errors } = await fresh('desktop');
  const row = { key: k };
  try {
    await seed(page);
    const g = await applyRequest(page, req);
    R.check(`${k}: goals set through the bus`, g.goals.length === req.goals.length && g.goals.every((x, i) => x.metric === req.goals[i].metric), g.goals.map((x) => `${x.metric}:${x.mode}:${x.amount}`).join(' '));
    const td = req.constraints?.trainingDaysPerWeek;
    if (td) R.check(`${k}: training days limit`, JSON.stringify(g.constraints.trainingDays) === JSON.stringify([td.min, td.max]), JSON.stringify(g.constraints));
    if (req.constraints?.eatingWindow) R.check(`${k}: eating window limit`, g.constraints.earliestH === req.constraints.eatingWindow.earliestH && g.constraints.latestH === req.constraints.eatingWindow.latestH, JSON.stringify(g.constraints));
    R.check(`${k}: horizon`, Math.abs(g.horizonDays - req.horizonDays) <= 3, g.horizonDays);
    const hits = scanForbidden(await mainText(page)); R.check(`${k}: forbidden scan (goals)`, !hits.length, hits.join(';'));
    const s = await runTier(page, 'S');
    if (SHOTS.includes(k)) await shot(page, 'J4', `${k}-S-ladder`);
    row.S = { secs: s.secs, ...(await assertLadder(page, R.check, `${k}/S`, s.summary, { tier: 'S', deep: process.env.DEEP !== '0' })) };
    if (xkeys.includes(k)) {
      const x = await runTier(page, 'X', { capMs });
      if (SHOTS.includes(k)) await shot(page, 'J4', `${k}-X-ladder`);
      row.X = { secs: x.secs, stopped: x.stopped, complete: x.summary.complete, ...(await assertLadder(page, R.check, `${k}/X`, x.summary, { tier: 'X', deep: process.env.DEEP !== '0' })) };
      if (x.stopped) R.check(`${k}/X: stopped search says so`, /Stopped at|from the quick search|is ready|are ready/.test(await mainText(page)) || x.summary.complete, x.stopped);
    }
  } catch (e) { R.check(`${k}: journey ran`, false, e.message.slice(0, 180)); }
  R.check(`${k}: no console/page errors`, errors.length === 0, errors.join(' | '));
  matrix.push(row);
  console.log(JSON.stringify(row));
  await ctx.close();
}
fs.writeFileSync(`${ROOT}/qa/results/Q3/${process.env.J4_NAME || 'J4-matrix'}-cells.json`, JSON.stringify(matrix, null, 1));
const rows = R.save();
await closeAll();
const fail = rows.filter((r) => !r.ok);
console.log(`J4 matrix: ${rows.length - fail.length} pass / ${fail.length} fail`);
for (const f of fail) console.log(`FAIL ${f.name} — ${f.detail}`);
process.exit(fail.length ? 1 : 0);
