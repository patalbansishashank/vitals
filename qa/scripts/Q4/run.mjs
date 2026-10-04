// Q4 runner: Coach journeys against the production build (vite preview, production CSP) with the scripted model
// (qa/scripts/Q4/fakeprovider.mjs + qa/fixtures/Q4/script.json) or a real provider (see seed.mjs: Q4_REAL_PRESET,
// Q4_REAL_KEY, Q4_REAL_MODEL). Prints a pass/fail table, writes qa/results/Q4/*.json and the sanitised exchanges to
// qa/fixtures/Q4/exchanges/, exits 1 on any failure.
//   npx vite build --outDir .e6-tmp/dist-Q4 && node qa/scripts/Q4/run.mjs [J1 J3 …]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT, ensureServer, sleep } from './lib.mjs';
import { seedBase, REAL, FAKE_URL } from './seed.mjs';
import { sanitize } from './sanitize.mjs';

const want = process.argv.slice(2);
const pick = (id) => want.length === 0 || want.includes(id);
let fake = null;
async function up(url) { try { return (await fetch(url)).ok; } catch { return false; } }
if (!REAL && !(await up(FAKE_URL + '/models'))) {
  fake = spawn(process.execPath, [`${ROOT}/qa/scripts/Q4/fakeprovider.mjs`], { stdio: 'ignore' });
  for (let i = 0; i < 20 && !(await up(FAKE_URL + '/models')); i++) await sleep(250);
}
await ensureServer();

const rows = [];
const journeys = [
  ['J2', './j2-plan.mjs', {}], // first: leaves seed-living (Easy plan) and seed-medium
  ['J1', './j1-training-days.mjs', {}],
  ['J3', './j3-logging.mjs', { vp: 'mobile' }],
  ['J4', './j4-travel.mjs', {}],
  ['J5', './j5-pantry-recipe.mjs', { vp: 'tablet' }],
  ['J6', './j6-suggest.mjs', {}],
  ['J7', './j7-markers.mjs', {}],
  ['J8', './j8-safety.mjs', {}],
  ['J9', './j9-tabs.mjs', { vp: 'mobile' }],
];
const t0 = Date.now();
rows.push({ journey: 'seed', name: 'first run, body, AI provider through the UI', ok: await seedBase(), detail: '' });
for (const [id, file, opts] of journeys) {
  if (!pick(id) && id !== 'J2') continue;
  const t = Date.now();
  try { rows.push(...(await (await import(file)).run(opts))); } catch (e) { rows.push({ journey: id, name: 'ran', ok: false, detail: e.message }); }
  console.log(`${id} done in ${Math.round((Date.now() - t) / 1000)} s`);
}

sanitize();

const fails = rows.filter((r) => !r.ok);
const byJourney = {};
for (const r of rows) (byJourney[r.journey] ??= { passed: 0, failed: 0 })[r.ok ? 'passed' : 'failed']++;
fs.writeFileSync(`${ROOT}/qa/results/Q4/run-summary.json`, JSON.stringify({ provider: REAL ? `real provider ${REAL}` : 'scripted model', journeys: want.length ? want : 'all', checks: rows.length, passed: rows.length - fails.length, failed: fails.length, byJourney, failures: fails.map((f) => ({ journey: f.journey, check: f.name, detail: f.detail })) }, null, 1) + '\n');
console.log(`\nQ4 Coach journeys (${REAL ? 'real provider ' + REAL : 'scripted model'}), ${Math.round((Date.now() - t0) / 60000)} min`);
console.table(rows.map((r) => ({ journey: r.journey, check: r.name.slice(0, 90), result: r.ok ? 'pass' : 'FAIL' })));
console.log(`${rows.length - fails.length} passed, ${fails.length} failed`);
for (const f of fails) console.log(`FAIL ${f.journey}: ${f.name} — ${f.detail}`);
fake?.kill();
process.exit(fails.length ? 1 : 0);
