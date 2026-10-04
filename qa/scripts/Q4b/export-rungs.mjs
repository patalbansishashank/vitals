// Q4b probe (Q4-09): the Coach's own flow ("make me a plan …", "start the <rung> one", Apply) for Hard, Medium and Easy;
// after each start the plan documents are exported (data.export, read-only) to .e6-tmp/q4b-<rung>.json, then undone.
// The exports become the fixture of src/commands/living/__tests__/replanRungs.test.ts.
//   BASE=http://127.0.0.1:5196 Q4_DIST=.e6-tmp/dist-Q4b node qa/scripts/Q4b/export-rungs.mjs
import fs from 'node:fs';
import { openProfile, go, read, say, sleep, cardButton, waitPlanner, planNow, ROOT } from '../Q4/lib.mjs';
import { seedBase } from '../Q4/seed.mjs';
import { spawn } from 'node:child_process';

let fake = null;
const up = async (u) => { try { return (await fetch(u)).ok; } catch { return false; } };
if (!(await up('http://127.0.0.1:4192/v1/models'))) {
  fake = spawn(process.execPath, [`${ROOT}/qa/scripts/Q4/fakeprovider.mjs`], { stdio: 'ignore' });
  for (let i = 0; i < 20 && !(await up('http://127.0.0.1:4192/v1/models')); i++) await sleep(250);
}
console.log('seed', await seedBase());
const { ctx, page, errors } = await openProfile('q4b-rungs', { from: 'seed-base' });
try {
  await go(page, '/coach');
  await say(page, 'make me a plan for losing 6 kg of fat in 3 months');
  const r = await waitPlanner(page);
  fs.writeFileSync(`${ROOT}/.e6-tmp/q4b-ladder.json`, JSON.stringify(r));
  for (const rung of ['hard', 'medium', 'easy']) {
    await say(page, `start the ${rung} one`);
    await cardButton(page, 'Apply proposal: start a plan');
    const plan = await planNow(page);
    const ex = await read(page, 'data.export');
    fs.writeFileSync(`${ROOT}/.e6-tmp/q4b-${rung}.json`, ex.text);
    console.log(rung, plan?.rung, ex.bytes);
    await cardButton(page, 'Undo');
    await sleep(1000);
  }
} catch (e) { console.log('ERR', e.message.split('\n')[0]); }
console.log('errors', errors);
await ctx.close();
fake?.kill();
