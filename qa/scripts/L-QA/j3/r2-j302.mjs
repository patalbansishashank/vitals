// Round 2, J3-02 re-check: the server's MCP `log_meal` (agent token, scope log) for a food that is NOT in the food table
// must not claim success. Uses the round-2 test person from .e6-tmp/r2j3/state.json; the token is created here, kept in
// memory only and revoked at the end. Results: qa/results/L-QA/round2/j3/J302-log-meal-unknown.json.
//   node qa/scripts/L-QA/j3/r2-j302.mjs
import fs from 'node:fs';
import { ROOT, SERVER, redact } from './apps.mjs';
import { mcpClient } from './harness/lib/server.mjs';
import { revokeToken, state, token } from './server.mjs';

const st = state();
if (!st.personId) throw new Error('run setup.mjs first');
const tk = await token(st.personId);
const out = { at: new Date().toISOString(), person: st.label, cases: [] };
const day = '2026-09-24';
try {
  const c = await mcpClient(SERVER, tk.token, 'l-qa-r2j3-j302');
  const tools = await c.tools();
  out.tools = { log_meal: tools.includes('log_meal'), log_get: tools.includes('log_get') };
  const read = async () => {
    const r = await c.call('log_get', { date: day });
    return JSON.stringify(r).length ? r : null;
  };
  const before = await read();
  const cases = [
    ['text only, unknown food', { date: day, text: 'R2J3 poha' }],
    ['component, unknown food', { date: day, text: 'R2J3 idli', components: [{ name: 'idli', grams: 150 }], method: 'typed', confidence: 1 }],
    ['component, unknown food 2', { date: day, text: 'R2J3 upma', components: [{ name: 'upma', grams: 150 }], method: 'typed', confidence: 1 }],
    ['component, known food (control)', { date: day, text: 'R2J3 banana', components: [{ name: 'banana', grams: 120 }], method: 'typed', confidence: 1 }],
  ];
  for (const [name, args] of cases) {
    const w = await mcpClient(SERVER, tk.token, `l-qa-r2j3-j302-${Date.now()}`); // a fresh client name per write: the bus caps writes per tool per turn
    const r = await w.call('log_meal', args);
    // (w stays open: closing it ended the shared session on the server in a trial run)
    await new Promise((res) => setTimeout(res, 1200));
    const after = await read();
    const s = JSON.stringify(after);
    const has = r.data?.entryId ? s.includes(r.data.entryId) : s.includes(args.text);
    out.cases.push({
      name,
      result: { ok: r.ok, status: r.status, summary: String(r.summary ?? '').slice(0, 200), dataStatus: r.data?.status ?? r.data?.outcome ?? null, entryId: r.data?.entryId ? 'present' : 'none', entriesAfter: (s.match(/"entryId"|"id":"01/g) ?? []).length, error: r.error?.code ?? null },
      entryExists: has,
      claimsSuccess: r.ok === true && r.status === 'applied',
      honest: (r.ok === true && r.status === 'applied') === has,
    });
  }
  out.logGetBefore = before ? 'read ok' : 'no read';
  await c.close();
} catch (e) {
  out.error = redact(e.message);
} finally {
  out.revoke = redact(String(await revokeToken(st.personId, tk.id).catch((e) => e.message))).slice(0, 120);
  fs.mkdirSync(`${ROOT}/qa/results/L-QA/round2/j3`, { recursive: true });
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/round2/j3/J302-log-meal-unknown.json`, JSON.stringify(out, null, 1) + '\n');
  console.log(redact(JSON.stringify(out, null, 1)));
}
process.exit(0);
