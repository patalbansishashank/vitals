// Q8 runner: the journeys in order, then a pass/fail table and qa/results/Q8-summary.json. Persons stay on the server
// until `node qa/scripts/Q8/cleanup.mjs` (it waits for the workers to close before removing them).
//   pnpm build && pnpm --filter vitals-companion build:person && node qa/scripts/Q8/run.mjs [J1 J2 …]
import fs from 'node:fs';
import { ROOT, closeBrowser, log } from './lib.mjs';

const want = process.argv.slice(2);
const all = [['J1', './j1-pair.mjs'], ['J2', './j2-providers.mjs'], ['J3', './j3-coach.mjs'], ['J4', './j4-two-devices.mjs'], ['J5', './j5-agents.mjs'], ['J6', './j6-no-companion.mjs'], ['J7', './j7-hygiene.mjs']];
const summary = {};
for (const [j, file] of all) {
  if (want.length && !want.includes(j)) continue;
  try {
    const { rows } = await (await import(file)).run();
    summary[j] = { passed: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length, failures: rows.filter((r) => !r.ok).map((r) => r.name) };
  } catch (e) { summary[j] = { passed: 0, failed: 1, failures: [e.message.split('\n')[0]] }; }
  log(`${j}: ${summary[j].passed} passed, ${summary[j].failed} failed`);
}
await closeBrowser();
fs.writeFileSync(`${ROOT}/qa/results/Q8-summary.json`, JSON.stringify({ at: new Date().toISOString(), summary }, null, 1) + '\n');
console.table(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { passed: v.passed, failed: v.failed }])));
process.exit(Object.values(summary).some((v) => v.failed) ? 1 : 0);
