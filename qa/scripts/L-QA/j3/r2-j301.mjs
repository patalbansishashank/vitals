// Round 2, J3-01 re-check: does the (paired) desktop app answer local AI tools? (a) the page relay that the app's MCP
// host uses (vitals:mcp:call → page → vitals:mcp:result), (b) `vitals --mcp` over stdio, started with the same temp
// HOME as the running app. Results: qa/results/L-QA/round2/j3/J301-desktop-mcp.json. No address, code or key printed.
//   node qa/scripts/L-QA/j3/r2-j301.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CAND, ROOT, TMP, log, openApp, redact } from './apps.mjs';

const out = { at: new Date().toISOString(), relay: {}, stdio: {} };
const dir = `${TMP}/r2j3/desktop`;
const A = await openApp('desktop', { name: 'desktop', dir });
try {
  let t = Date.now();
  const r1 = await A.mcpCall('app_status', {});
  out.relay.app_status = { ms: Date.now() - t, ok: r1?.ok ?? null, status: r1?.status ?? null, error: r1?.error?.code ?? null };
  t = Date.now();
  const r2 = await A.mcpCall('log_get', { date: new Date().toISOString().slice(0, 10) });
  out.relay.log_get = { ms: Date.now() - t, ok: r2?.ok ?? null, error: r2?.error?.code ?? null };
  log('relay', JSON.stringify(out.relay));

  const req = createRequire(`${CAND}/packages/companion/package.json`);
  const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const home = `${dir}/h`;
  const env = { ...process.env };
  for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'VITALS_MCP_BRIDGE', 'VITALS_APP_COMMAND', 'VITALS_MCP_SOCKET', 'APPIMAGE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'DISPLAY']) delete env[k];
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: `${home}/c`, XDG_DATA_HOME: `${home}/d`, XDG_CACHE_HOME: `${home}/k`, TMPDIR: `${home}/t`, VITALS_UPDATE_FEED: 'http://127.0.0.1:9/none' });
  const c = new Client({ name: 'l-qa-r2j3-stdio', version: '1.0.0' });
  const tr = new StdioClientTransport({ command: `${TMP}/r2j3/linux-unpacked/vitals`, args: ['--mcp', '--client', 'claude-code'], env, stderr: 'pipe' });
  const errLines = [];
  tr.stderr?.on('data', (b) => errLines.push(...redact(String(b)).replace(/\/home\/[^/\s]+/g, '$HOME').split('\n').filter(Boolean)));
  const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);
  t = Date.now();
  try {
    await within(c.connect(tr), 60000, 'connect');
    out.stdio.connectMs = Date.now() - t;
    const tools = (await within(c.listTools(), 30000, 'tools/list')).tools.map((x) => x.name);
    out.stdio.tools = tools.length;
    out.stdio.hasLogMeal = tools.includes('log_meal');
    t = Date.now();
    const r = await within(c.callTool({ name: 'app_status', arguments: {} }), 60000, 'app_status');
    const txt = r.content?.[0]?.text ?? '';
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    out.stdio.app_status = { ms: Date.now() - t, ok: j?.ok ?? null, status: j?.status ?? null, error: j?.error?.code ?? null, text: j ? undefined : redact(txt).slice(0, 160) };
  } catch (e) {
    out.stdio.error = redact(e.message).slice(0, 200);
    out.stdio.afterMs = Date.now() - t;
  } finally {
    await c.close().catch(() => undefined);
    out.stdio.stderr = errLines.slice(0, 8).map((l) => l.slice(0, 160));
  }
  log('stdio', JSON.stringify(out.stdio));
} catch (e) {
  out.error = redact(e.stack ?? e.message).slice(0, 400);
} finally {
  await A.close().catch(() => undefined);
  fs.writeFileSync(`${ROOT}/qa/results/L-QA/round2/j3/J301-desktop-mcp.json`, JSON.stringify(out, null, 1) + '\n');
}
process.exit(0);
