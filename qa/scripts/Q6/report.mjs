// Q6 report over qa/results/Q6/shots*.json: per screenshot — taken, ≤ 200 kB, no horizontal page scroll, no text off
// screen, text contrast ≥ 4.5:1 (3:1 large), no page errors; plus card paddings (left = right inset, 15–25 px).
// Prints a pass/fail table and writes qa/results/Q6/report.json; exit 1 on failure.
import fs from 'node:fs';
import { ROOT } from './lib.mjs';
const dir = `${ROOT}/qa/results/Q6`;
const all = Object.assign({}, ...fs.readdirSync(dir).filter((f) => /^shots.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))));
const rows = [];
const check = (name, ok, detail = '') => rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
// the Agents section probes the default Companion address once; the browser logs the refused connection itself
// faceplates that are full-bleed by design (checked by eye in the screenshots): the perforated figure stage runs edge to
// edge (DESIGN_DIRECTION §3.3), the Coach composer bar spans the conversation face, the simulator raster and readout
// rail are dense reading surfaces (§3.4), evidence list rows and articles pad themselves
const FULL_BLEED = /lm-body-figure|rs-figure|lv-coach-conv|sim-rasterface|sim-summary|ev-article|"Mechanisms"/;
const benign = (e) => /ERR_CONNECTION_REFUSED|status of 404/.test(e);
for (const [k, v] of Object.entries(all).sort()) {
  if (v.error) { check(`${k}: screen opened`, false, v.error); continue; }
  const size = fs.existsSync(`${ROOT}/${v.file}`) ? fs.statSync(`${ROOT}/${v.file}`).size : -1;
  // a faceplate's content starts 15–25 px in (flush faces pad their rows instead) and never sits closer to the right
  // edge than to the left; content inside a scroll rail is excluded (r < 0 means a rail in older measurements)
  const faces = (v.faces ?? []).filter((f) => !FULL_BLEED.test(f.face) && f.variant !== 'flush' && f.r >= 0 && (f.l < 15 || f.l > 25 || f.r < f.l - 2));
  const bad = [
    size < 0 && 'no screenshot', size > 200 * 1024 && `screenshot ${Math.round(size / 1024)} kB`,
    v.overflowX > 0 && `horizontal scroll ${v.overflowX}px`, v.offscreen.length && `off screen: ${v.offscreen[0]}`,
    v.lowContrast.length && `contrast: ${v.lowContrast[0]}`, v.forbidden?.length && `internal name on screen: ${v.forbidden[0]}`, v.errors.filter((e) => !benign(e)).length && `errors: ${v.errors[0]}`,
    faces.length && `card inset: ${faces.map((f) => `${f.face} l${f.l}/r${f.r}`).join('; ')}`,
  ].filter(Boolean);
  check(`${k}`, !bad.length, bad.join(' · '));
}
fs.writeFileSync(`${dir}/report.json`, JSON.stringify(rows, null, 1));
for (const r of rows) if (!r.ok || process.env.Q6_ALL) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
const fail = rows.filter((r) => !r.ok).length;
console.log(`screens: ${rows.length - fail} pass / ${fail} fail (of ${rows.length})`);
process.exit(fail ? 1 : 0);
