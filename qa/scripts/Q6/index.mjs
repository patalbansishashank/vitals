// Prints the "all screens" index for qa/findings-Q6.md from qa/results/Q6/shots*.json and report.json:
// one row per screen, a link per width × theme, and the report verdict over its six shots.
import fs from 'node:fs';
import { ROOT } from './lib.mjs';
const dir = `${ROOT}/qa/results/Q6`;
const all = Object.assign({}, ...fs.readdirSync(dir).filter((f) => /^shots.*\.json$/.test(f) && !/before/.test(f)).sort((a, b) => (a === "shots.json" ? -1 : b === "shots.json" ? 1 : a.localeCompare(b))).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))));
const report = Object.fromEntries((fs.existsSync(`${dir}/report.json`) ? JSON.parse(fs.readFileSync(`${dir}/report.json`, 'utf8')) : []).map((r) => [r.name.split(':')[0], r]));
const ids = [...new Set(Object.values(all).map((v) => v.id))];
const cols = [[390, 'light'], [390, 'dark'], [768, 'light'], [768, 'dark'], [1440, 'light'], [1440, 'dark']];
const out = ['| # | screen | route | 390 light | 390 dark | 768 light | 768 dark | 1440 light | 1440 dark | checks |', '|---|---|---|---|---|---|---|---|---|---|'];
ids.forEach((id, i) => {
  const cells = cols.map(([w, t]) => { const v = all[`${id}-${w}-${t}`]; return v?.file ? `[shot](${v.file.replace(/^qa\//, '')})` : v?.error ? 'not opened' : '—'; });
  const verdicts = cols.map(([w, t]) => report[`${id}-${w}-${t}`]).filter(Boolean);
  const ok = verdicts.length && verdicts.every((r) => r.ok);
  const route = Object.values(all).find((v) => v.id === id)?.url ?? '';
  out.push(`| ${i + 1} | ${id} | \`${route}\` | ${cells.join(' | ')} | ${ok ? 'pass' : verdicts.length ? 'see report' : '—'} |`);
});
console.log(out.join('\n'));
