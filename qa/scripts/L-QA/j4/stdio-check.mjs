// J4: connect to `<app> --mcp --client <id>` with the temp HOME (as the registered entry does): initialize, tools/list,
// briefing_get. Output redacted (key-shaped strings); the briefing body goes to private/j4 only.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const R2 = process.env.J4_ROUND === '2'; // round 2: the app built in the worktree itself, results under round2/
const cand = R2 ? repo : path.join(repo, '.e6-tmp', 'cand');
const req = createRequire(path.join(cand, 'apps', 'desktop', 'package.json'));
const { Client } = req('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = req('@modelcontextprotocol/sdk/client/stdio.js');
const priv = R2 ? path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'private', 'j4') : path.join(repo, 'qa', 'results', 'L-QA', 'private', 'j4');
const base = readFileSync(path.join(priv, 'base.txt'), 'utf8').trim();
const env = { ...JSON.parse(readFileSync(path.join(base, 'env.json'), 'utf8')), XDG_SESSION_TYPE: 'wayland' };
const local = JSON.parse(readFileSync(path.join(repo, 'qa', 'local.config.json'), 'utf8'));
const redact = (s) => [local.serverUrl, new URL(local.serverUrl).host].reduce((t, x) => t.split(x).join('[server]'), String(s)).replace(/[A-Za-z0-9_-]{32,}/g, '[key-shaped]');
const client = process.argv[2] ?? 'claude-code';
const APP = path.join(cand, 'apps', 'desktop', 'release', 'linux-unpacked', 'vitals');
const t = new StdioClientTransport({ command: APP, args: ['--mcp', '--client', client], env, stderr: 'pipe' });
const errs = [];
t.stderr?.on('data', (d) => errs.push(String(d)));
const c = new Client({ name: 'j4-check', version: '0' });
t.onclose = () => console.log("transport closed; stderr: " + redact(errs.join("").slice(0, 600)));
const t0 = Date.now();
await c.connect(t, { timeout: 60000 });
const info = c.getServerVersion();
const instr = c.getInstructions() ?? '';
let tools = [];
const polls = [];
for (let i = 0; i < 15; i++) {
  tools = (await c.listTools(undefined, { timeout: 60000 })).tools;
  polls.push(`${Date.now() - t0}ms:${tools.length}`);
  if (tools.length) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`tools/list polls: ${polls.join(' ')}`);
const prompts = await c.listPrompts().catch((e) => ({ prompts: [], err: e.message }));
const resources = await c.listResources().catch((e) => ({ resources: [], err: e.message }));
console.log(redact(`server ${info?.name} ${info?.version}; ${Date.now() - t0} ms; instructions ${instr.length} chars; ${tools.length} tools; briefing_get ${tools.some((x) => x.name === 'briefing_get')}; prompts ${prompts.prompts?.map((p) => p.name).join(',')}; resources ${resources.resources?.map((r) => r.uri).join(',')}`));
console.log(redact(`instructions head: ${instr.slice(0, 300).replace(/\n/g, ' ')}`));
console.log(`tools: ${tools.map((x) => x.name).join(' ')}`);
if (tools.some((x) => x.name === 'briefing_get')) {
  const r = await c.callTool({ name: 'briefing_get', arguments: {} }, undefined, { timeout: 60000 });
  const body = JSON.stringify(r.structuredContent ?? r.content, null, 1);
  writeFileSync(path.join(priv, `briefing-${client}.json`), redact(body));
  console.log(redact(`briefing_get isError=${!!r.isError} ${body.length} bytes; head: ${body.slice(0, 600).replace(/\s+/g, ' ')}`));
}
await c.close();
if (errs.length) console.log(redact(`stderr: ${errs.join('').slice(0, 800)}`));
