// E22: calls one Vitals tool through the local Companion's admin route (the paired tab runs it on its command bus).
// Usage: node qa/scripts/e22/call.mjs <tool> '<json args>' [clientName]   — prints the result envelope (no secrets).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const dir = process.env.VITALS_COMPANION_CONFIG || `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/vitals-companion`;
const admin = readFileSync(`${dir}/admin.token`, 'utf8').trim();
const [tool, args = '{}', clientName = 'e22-check'] = process.argv.slice(2);
const url = process.env.COMPANION_URL || 'http://127.0.0.1:4870';
const headers = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
if (tool === '--list') {
  const r = await fetch(`${url}/v1/agent/manifest`, { headers });
  const j = await r.json();
  console.log(JSON.stringify({ tab: j.tab, tools: j.manifest?.tools?.map((t) => ({ name: t.name, perm: t.perm, surfaces: t.surfaces })) }, null, 1));
} else {
  const r = await fetch(`${url}/v1/agent/call`, { method: 'POST', headers, body: JSON.stringify({ tool, args: JSON.parse(args), clientName, requestId: `${Date.now()}` }) });
  console.log(JSON.stringify(await r.json(), null, 1));
}
