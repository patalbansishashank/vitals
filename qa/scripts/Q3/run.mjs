// Runs every qa/scripts/Q3/j*.mjs journey sequentially (child processes), then prints a pass/fail table from qa/results/Q3/J*.json.
// Usage: node qa/scripts/Q3/run.mjs [j2 j3 ...]   (BASE=http://127.0.0.1:5191 by default)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const only = process.argv.slice(2).map((s) => s.toLowerCase());
const files = fs.readdirSync(dir).filter((f) => /^j\d+-.*\.mjs$/.test(f) && !/probe|-x\.|-lib|-matrix-/.test(f) && (!only.length || only.some((o) => f.startsWith(o + '-'))))
  .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
const rows = [];
for (const f of files) {
  const id = 'J' + parseInt(f.slice(1));
  const t0 = Date.now();
  const r = spawnSync('node', [path.join(dir, f)], { cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: process.env.TMPDIR || `${root}/.e6-tmp` } });
  // the result files this script wrote (J5.json, J5-diet.json, J4-matrix.json …), not a name guessed from the journey number
  let pass = 0, fail = 0;
  const dirR = `${root}/qa/results/Q3`;
  const written = fs.readdirSync(dirR).filter((n) => /^J.*\.json$/.test(n) && !/-cells\.json$/.test(n) && fs.statSync(`${dirR}/${n}`).mtimeMs >= t0);
  for (const n of written) { try { const j = JSON.parse(fs.readFileSync(`${dirR}/${n}`, 'utf8')); pass += j.filter((x) => x.ok).length; fail += j.filter((x) => !x.ok).length; } catch { fail++; } }
  if (!written.length) fail++;
  rows.push({ journey: id, script: f, results: written.join(' '), pass, fail, exit: r.status, secs: Math.round((Date.now() - t0) / 1000) });
}
console.log('\njourney  checks passed  failed  exit  secs  script');
for (const r of rows) console.log(`${r.journey.padEnd(8)} ${String(r.pass).padStart(13)}  ${String(r.fail).padStart(6)}  ${String(r.exit).padStart(4)}  ${String(r.secs).padStart(4)}  ${r.script}`);
const bad = rows.some((r) => r.fail > 0 || r.exit !== 0);
const total = rows.reduce((a, r) => ({ pass: a.pass + r.pass, fail: a.fail + r.fail }), { pass: 0, fail: 0 });
fs.writeFileSync(`${root}/qa/results/Q3/run-summary.json`, JSON.stringify({ base: process.env.BASE || 'http://127.0.0.1:5191', env: { XKEYS: process.env.XKEYS ?? null, XCAP_MIN: process.env.XCAP_MIN ?? null }, rows, total, result: bad ? 'FAIL' : 'PASS' }, null, 1));
console.log(bad ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(bad ? 1 : 0);
