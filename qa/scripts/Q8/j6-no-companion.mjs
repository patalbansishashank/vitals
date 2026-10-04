// J6: nothing Companion-only left. Runs the noCompanion guard test, then scans the built dist/ for sentences (string
// literals with a space) that name the Companion, its command or the old local-pairing wording, and lists every
// "pairing code" sentence with the place it belongs to. Allowed: "pairing code" in Sync (the sync group's code: 24
// words or vitals-sync:1?) and in Settings › Server (the server's 8-digit code), and in command descriptions.
//   pnpm build && node qa/scripts/Q8/j6-no-companion.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { results, ROOT, DIST, log } from './lib.mjs';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const SENTENCE = /(["'`])((?:(?!\1)[^\\\n]|\\.){0,400}?)\1/g;

export async function run() {
  const { check, save } = results('J6-no-companion');
  try {
    let out = '';
    let ok = true;
    try {
      out = execFileSync('pnpm', ['vitest', 'run', '--maxWorkers=25%', 'src/features/settings/server/__tests__/noCompanion.test.ts'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TMPDIR: `${ROOT}/.e6-tmp` }, timeout: 600000 });
    } catch (e) { ok = false; out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    check('noCompanion guard test passes', ok && /passed/.test(out), (out.match(/Tests? .*$/m) ?? [out.slice(-200)])[0]);

    const files = walk(DIST).filter((f) => /\.(js|html|json|webmanifest)$/.test(f));
    check('dist/ has the build', files.length > 10, String(files.length));
    const companion = [];
    const pairing = [];
    const old = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(SENTENCE)) {
        const s = m[2];
        if (!s.includes(' ')) continue; // identifiers, ids, class names
        const where = path.relative(ROOT, f).replace(/-[\w-]{8}\.js$/, '.js');
        if (/\bCompanion\b/.test(s)) companion.push(`${where}: ${s.slice(0, 160)}`);
        if (/vitals-companion|code (shown )?(in|from) (the|your) (terminal|Companion window)/i.test(s)) old.push(`${where}: ${s.slice(0, 160)}`);
        if (/pairing code/i.test(s)) pairing.push({ where, s: s.slice(0, 160) });
      }
    }
    check('no sentence in dist/ names the Companion', companion.length === 0, companion.join(' || '));
    check('no Companion command or old local-pairing wording in dist/', old.length === 0, old.join(' || '));
    const allowed = (p) => /sync|SettingsPage|commands|manifest/i.test(p.where);
    const odd = pairing.filter((p) => !allowed(p));
    check(`"pairing code" appears only in Sync, Settings › Server and command descriptions (${pairing.length} sentences)`, odd.length === 0, odd.map((p) => `${p.where}: ${p.s}`).join(' || '));
    fs.writeFileSync(`${ROOT}/qa/results/Q8-J6-pairing-code-sentences.json`, JSON.stringify(pairing, null, 1) + '\n');
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  return { rows: save() };
}
if (process.argv[1]?.endsWith('j6-no-companion.mjs')) { const { rows } = await run(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); }
