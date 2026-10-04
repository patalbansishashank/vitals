// Round 2: how many MCP sessions one agent token can hold at once on the server (clients opened one after another,
// then each makes one read). Token in memory only, revoked at the end. Results: round2/j3/mcp-sessions.json.
import fs from 'node:fs';
import { ROOT, SERVER, redact } from './apps.mjs';
import { mcpClient } from './harness/lib/server.mjs';
import { revokeToken, state, token } from './server.mjs';
const st = state();
const tk = await token(st.personId);
const out = { at: new Date().toISOString(), opened: 0, reads: [] };
try {
  const cs = [];
  for (let i = 0; i < 5; i++) { cs.push(await mcpClient(SERVER, tk.token, `l-qa-r2j3-s${i}`)); out.opened += 1; }
  for (let i = 0; i < cs.length; i++) {
    await new Promise((r) => setTimeout(r, 1100));
    try { const r = await cs[i].call('app_status', {}); out.reads.push({ session: i + 1, ok: r.ok ?? null, error: r.error?.code ?? null }); }
    catch (e) { out.reads.push({ session: i + 1, error: redact(e.message).replace(/.*"message":"([^"]+)".*/, '$1').slice(0, 80) }); }
  }
} catch (e) { out.error = redact(e.message).slice(0, 200); }
finally {
  out.revoke = redact(String(await revokeToken(st.personId, tk.id).catch((e) => e.message))).slice(0, 60);
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/round2/j3/mcp-sessions.json`, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out));
}
process.exit(0);
