// Q6 explicit layout checks, measured from bounding boxes at 390 / 768 / 1440 in light and dark:
//  1. intake summary card ("What we'll use"): footer key aligned with the row text, ≥ 16 px inset, padding above/below
//  2. supplement dose rows (Settings › Supplements and the Food tab): name, badge, dose, time keys and state never
//     overlap; below 480 px row width the time keys sit on their own line as 4 equal keys
// Ladder grid checks live in ladder.mjs (the search result is in memory). Card paddings: report.mjs over shots.json.
import fs from 'node:fs';
import { openProfile, go, sleep, ROOT, read } from './lib.mjs';
const rows = [];
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); };
const WS = (process.env.Q6_W || '390,768,1440').split(',').map(Number);
for (const w of WS) for (const theme of ['light', 'dark']) {
  const { page, errors, close } = await openProfile('checks', { from: 'full', w, theme });
  const tag = `${w} ${theme}`;
  // 1. summary card footer
  await go(page, '/onboarding/summary', { wait: 2000 });
  const s = await page.evaluate(() => {
    const face = document.querySelector('.lm-ik-summary__face'); if (!face) return null;
    const fr = face.getBoundingClientRect();
    const foot = face.querySelector(':scope > .lm-face-foot'); const key = foot?.querySelector('button, a');
    const dt = face.querySelector('.lm-ik-summary__row dt'); const ch = face.querySelector('.lm-ik-summary__change');
    const kr = key?.getBoundingClientRect(), dr = dt?.getBoundingClientRect(), cr = ch?.getBoundingClientRect(), ftr = foot?.getBoundingClientRect();
    const cs = foot && getComputedStyle(foot);
    return { faceL: fr.left, faceR: fr.right, faceB: fr.bottom, keyL: kr?.left, keyR: kr?.right, keyT: kr?.top, keyB: kr?.bottom, rowL: dr?.left, changeR: cr?.right, footT: ftr?.top, padTop: cs && parseFloat(cs.paddingTop), key: key?.innerText };
  });
  if (!s) check(`${tag} summary: card found`, false);
  else {
    check(`${tag} summary footer: key "${s.key}" left edge aligned with the row text (±1 px)`, Math.abs(s.keyL - s.rowL) <= 1, `key ${s.keyL.toFixed(1)} row ${s.rowL.toFixed(1)}`);
    check(`${tag} summary footer: key inset from the card edge ≥ 16 px`, s.keyL - s.faceL >= 16 && s.faceR - s.keyR >= 16 - 0.5, `left ${(s.keyL - s.faceL).toFixed(1)} right ${(s.faceR - s.keyR).toFixed(1)}`);
    check(`${tag} summary footer: ≥ 12 px between the divider and the key, ≥ 16 px below it`, s.keyT - s.footT >= 12 && s.faceB - s.keyB >= 16, `above ${(s.keyT - s.footT).toFixed(1)} below ${(s.faceB - s.keyB).toFixed(1)}`);
    check(`${tag} summary rows: "change" right-aligned with the key's right edge (±1 px) or the card's content edge`, s.changeR === undefined || Math.abs(s.faceR - s.changeR - (s.keyL - s.faceL)) <= 1.5 || Math.abs(s.changeR - s.keyR) <= 1, `change right inset ${(s.faceR - s.changeR).toFixed(1)}`);
  }
  // 2. dose rows
  for (const [route, label] of [['/settings/supplements', 'settings'], ['/food', 'food']]) {
    await go(page, route, { wait: 2000 });
    const r = await page.evaluate(() => [...document.querySelectorAll('.lm-supprow')].map((row) => {
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const parts = [
        ['name', row.querySelector('.lm-supprow__name')], ['badge', row.querySelector('.lm-grade, [class*=grade]')],
        ['dose', row.querySelector('.lm-supprow__dosefield, .lm-supprow__dose input')], ['state', row.querySelector('.lm-supprow__state')],
        ...[...row.querySelectorAll('.lm-supprow__bank > .lm-bank__key')].map((k, i) => [`time${i}`, k]),
        ...[...row.querySelectorAll('.lm-supprow__today button, .lm-supprow__today a')].map((k, i) => [`today${i}`, k]),
      ].filter(([, e]) => e && vis(e)).map(([n, e]) => [n, e.getBoundingClientRect().toJSON()]);
      const hits = [];
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const [a, ra] = parts[i], [b, rb] = parts[j];
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 0.5 && iy > 0.5) hits.push(`${a}×${b}`);
      }
      const rw = row.getBoundingClientRect().width;
      const times = parts.filter(([n]) => n.startsWith('time')).map(([, b]) => b);
      const dose = parts.find(([n]) => n === 'dose')?.[1];
      const rr = row.getBoundingClientRect();
      const outside = parts.filter(([, b]) => b.left < rr.left - 0.5 || b.right > rr.right + 0.5).map(([n]) => n);
      return { name: row.querySelector('.lm-supprow__name')?.innerText, rw: Math.round(rw), hits, outside, times: times.map((b) => [Math.round(b.top), Math.round(b.width), Math.round(b.height)]), doseB: dose && Math.round(dose.bottom), state: row.dataset.state, variant: row.dataset.variant };
    }));
    check(`${tag} ${label} dose rows present`, label === 'food' || r.length >= 3, `${r.length} rows`);
    for (const x of r) {
      check(`${tag} ${label} row "${x.name}" (${x.variant}, ${x.state}, ${x.rw} px): no overlapping parts, nothing outside the row`, !x.hits.length && !x.outside.length, `${x.hits.join(' ')} outside: ${x.outside.join(' ')}`);
      if (x.times.length === 4 && x.rw < 480) {
        const sameLine = x.times.every((t) => Math.abs(t[0] - x.times[0][0]) <= 1);
        const eq = Math.max(...x.times.map((t) => t[1])) - Math.min(...x.times.map((t) => t[1])) <= 1.5;
        check(`${tag} ${label} row "${x.name}": time keys on their own line below the dose, 4 equal keys${w === 390 ? ', ≥ 44 px tall' : ''}`, sameLine && eq && (!x.doseB || x.times[0][0] >= x.doseB - 1) && (w !== 390 || x.times[0][2] >= 43.5), JSON.stringify(x.times) + ' doseB ' + x.doseB);
      }
    }
  }
  const supp = await read(page, 'supplements.get', {});
  check(`${tag} bus: supplements.get has the seeded rows`, supp.rows.length >= 3, supp.rows.map((x) => `${x.supplementId}:${x.state}`).join(' '));
  check(`${tag} no page errors`, errors.filter((e) => /pageerror/.test(e)).length === 0, errors.join(' | '));
  await close();
}
fs.mkdirSync(`${ROOT}/qa/results/Q6`, { recursive: true });
fs.writeFileSync(`${ROOT}/qa/results/Q6/checks.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
const fail = rows.filter((r) => !r.ok).length;
console.log(`checks: ${rows.length - fail} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
