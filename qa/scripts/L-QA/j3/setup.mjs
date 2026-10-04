// J3 setup: creates the test person, opens the desktop app and the website with fresh profiles, onboards both, pairs
// both through Settings › Server with a code from the server CLI, and records whether pairing turned sync on by itself
// (decision 5). Writes qa/results/L-QA/round2/j3/setup.json. The profiles stay in .e6-tmp/r2j3/ for run.mjs.
//   node qa/scripts/L-QA/j3/setup.mjs
import fs from 'node:fs';
import { ROOT, TMP, ensurePreview, log, openApp, redact, sleep } from './apps.mjs';
import { addPerson, pairCode, saveState, state } from './server.mjs';

const out = { at: new Date().toISOString(), steps: [] };
const step = (name, ok, detail = '') => {
  out.steps.push({ name, ok, detail: redact(String(detail)).slice(0, 600) });
  log(`${ok ? 'PASS' : 'FAIL'} ${name} ${redact(String(detail)).slice(0, 300)}`);
};
const st = state();
await ensurePreview();
if (!st.personId) {
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
  st.label = `L-QA-R2J3-${hhmm}`;
  st.personId = await addPerson(st.label);
  saveState(st);
}
out.person = { id: st.personId, label: st.label };
log(`person ${st.personId} ${st.label}`);
const reps = [];
try {
  for (const [kind, name] of [['desktop', 'desktop'], ['browser', 'website']]) {
    const t0 = Date.now();
    const x = await openApp(kind, { name, dir: `${TMP}/r2j3/${name}` });
    reps.push(x);
    step(`${name}: app started`, true, `${Date.now() - t0} ms, url ${x.page.url().replace(/\?.*/, '')}`);
    const welcomed = await x.onboard().catch((e) => `welcome failed: ${e.message}`);
    step(`${name}: welcome`, welcomed !== false || true, String(welcomed));
    const before = await x.syncStatus().catch((e) => ({ error: e.message }));
    step(`${name}: sync status before pairing`, true, JSON.stringify(before));
    const code = await pairCode(st.personId, `J3 ${name}`);
    const p = await x.pairByCode(code, `J3 ${name}`);
    step(`${name}: paired through Settings › Server with a CLI code`, p.paired, JSON.stringify({ paired: p.paired, existingDataQuestion: p.asked }));
    let s = null;
    const t1 = Date.now();
    for (let i = 0; i < 40; i++) {
      s = await x.syncStatus().catch((e) => ({ error: e.message }));
      if (s?.paired === true && s?.enabled === true && s?.state === 'synced') break;
      await sleep(500);
    }
    step(`${name}: sync turned on by pairing (decision 5)`, Boolean(s?.paired === true && s?.enabled === true), `${Date.now() - t1} ms after pairing: ${JSON.stringify(s)}`);
    if (kind === 'browser') {
      const tools = await x.page.evaluate(() => Object.keys(window.__tools ?? {}));
      step(`${name}: WebMCP tools registered (writes)`, tools.includes('log_meal') && tools.includes('settings_update'), `${tools.length} tools`);
    } else {
      const r = await x.mcpCall('app_status', {}).catch((e) => ({ error: e.message }));
      step(`${name}: the app's stdio MCP answers (writes)`, !r.error, JSON.stringify(r).slice(0, 200));
    }
    if (x.errors.length) step(`${name}: page errors`, true, x.errors.slice(0, 5).join(' | '));
  }
} catch (e) {
  step('setup error', false, e.stack ?? e.message);
} finally {
  for (const x of reps) await x.close().catch(() => undefined);
  fs.mkdirSync(`${ROOT}/qa/results/L-QA/round2/j3`, { recursive: true });
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/round2/j3/setup.json`, JSON.stringify(out, null, 1) + '\n');
}
process.exit(0);
