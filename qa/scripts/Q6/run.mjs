// Q6 runner: the visual pass end to end against the preview on :5194 (BASE to override).
//   seed:  node run.mjs --seed    → seed-full.mjs, seed-extra.mjs, seed-intake.mjs (once); the server profile: qa/scripts/Q10/srv-visual.mjs
//   shoot: node run.mjs --shoot   → shoot.mjs (every screen × 390/768/1440 × light/dark) and ladder.mjs quick|x|af|fuzz5
//   check: node run.mjs           → checks.mjs, a11y.mjs, then report.mjs over the screenshots and the ladder grid results
// Prints one pass/fail table and exits non-zero on any failure. The Companion local mode is gone (v0.4); seed-companion.mjs is kept for history only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT } from './lib.mjs';
const dir = `${ROOT}/qa/scripts/Q6`;
const node = (f, ...a) => { const r = spawnSync('node', [`${dir}/${f}`, ...a], { stdio: 'inherit', env: process.env }); return r.status ?? 1; };
const args = process.argv.slice(2);
if (args.includes('--seed')) for (const f of ['seed-full.mjs', 'seed-extra.mjs', 'seed-intake.mjs']) if (node(f)) process.exit(1);
if (args.includes('--shoot')) { node('shoot.mjs'); for (const m of ['quick', 'af', 'fuzz5', 'x']) node('ladder.mjs', m); }
const table = [];
const step = (name, code) => table.push({ name, ok: code === 0 });
step('explicit layout checks (summary footer, dose rows)', node('checks.mjs'));
step('a11y quick checks (labels, segmented controls, question-card focus)', node('a11y.mjs'));
step('every screenshot: taken, ≤ 200 kB, no horizontal scroll, contrast, insets, no page errors', node('report.mjs'));
const grids = fs.readdirSync(`${ROOT}/qa/results/Q6`).filter((f) => /^ladder-grid-.*\.json$/.test(f));
for (const g of grids) {
  const rows = JSON.parse(fs.readFileSync(`${ROOT}/qa/results/Q6/${g}`, 'utf8'));
  step(`ladder grid (${g.replace(/^ladder-grid-|\.json$/g, '')}): ${rows.length} checks`, rows.every((r) => r.ok) ? 0 : 1);
}
console.log('\n| Q6 step | result |\n|---|---|');
for (const r of table) console.log(`| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} |`);
process.exit(table.some((r) => !r.ok) ? 1 : 0);
