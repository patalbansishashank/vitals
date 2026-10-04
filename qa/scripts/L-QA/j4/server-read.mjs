// J4: read the test person's log from the server's /mcp with a read-only agent token (kept in a 0600 file under
// .e6-tmp/j4-secret, never printed). Prints initialize info, the tool list and the log_get result, redacted.
// Usage: node server-read.mjs [tool] [jsonArgs]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const R2 = process.env.J4_ROUND === '2'; // round 2: the app built in the worktree itself, results under round2/
const req = createRequire(path.join(R2 ? repo : path.join(repo, '.e6-tmp', 'cand'), 'apps', 'desktop', 'package.json'));
const { Client } = req('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = req('@modelcontextprotocol/sdk/client/streamableHttp.js');
const local = JSON.parse(readFileSync(path.join(repo, 'qa', 'local.config.json'), 'utf8'));
const token = readFileSync(path.join(repo, '.e6-tmp', R2 ? 'r2j4-secret' : 'j4-secret', 'readtoken'), 'utf8').trim();
const hide = [token, local.serverUrl, new URL(local.serverUrl).host].filter(Boolean);
const redact = (s) => hide.reduce((t, x) => t.split(x).join('[redacted]'), String(s)).replace(/[A-Za-z0-9_-]{32,}/g, '[key-shaped]');

const tool = process.argv[2] ?? 'log_get';
const today = new Date().toLocaleDateString('en-CA');
const args = process.argv[3] ? JSON.parse(process.argv[3]) : { from: today, to: today };
const transport = new StreamableHTTPClientTransport(new URL('/mcp', local.serverUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
const client = new Client({ name: 'j4-qa', version: '0.0.0' });
try {
  await client.connect(transport);
  const info = client.getServerVersion();
  const instr = client.getInstructions();
  const { tools } = await client.listTools();
  console.log(redact(`server ${info?.name} ${info?.version}; instructions ${instr ? `${instr.length} chars` : 'absent'}; ${tools.length} tools; briefing_get ${tools.some((t) => t.name === 'briefing_get') ? 'listed' : 'absent'}`));
  const r = await client.callTool({ name: tool, arguments: args });
  const body = r.structuredContent ?? r.content?.map((c) => c.text).join('\n');
  console.log(redact(`${tool}(${JSON.stringify(args)}) isError=${!!r.isError}\n${typeof body === 'string' ? body : JSON.stringify(body, null, 1)}`).slice(0, 4000));
} catch (e) {
  console.log(redact(`ERROR ${e?.message ?? e}`));
} finally {
  await client.close().catch(() => {});
}
