// R18 probe: Streamable HTTP MCP client against a Companion on another address (the tailnet IP), as Codex, OpenCode and
// Claude Code would connect. Reads the client token from a file (never printed). Also sends raw requests with a foreign
// Host and with an Origin to show what the Host/Origin checks in server.ts do.
// Usage: node qa/scripts/R18/mcp-remote-probe.mjs <url, e.g. http://<tailnetIPv4>:4892/mcp> <token-file>
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { localConfig } from '../lib/localConfig.mjs';
import { Client } from '../../../packages/companion/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../packages/companion/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
const cfg = localConfig(['pcHost']);
const [url, tokenFile] = process.argv.slice(2);
const token = readFileSync(tokenFile, 'utf8').trim();
const out = { url };
const client = new Client({ name: 'r18-probe', version: '0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools();
  out.initialize = 'ok';
  out.toolCount = tools.tools.length;
  out.destructiveListed = tools.tools.filter((t) => /plan_end|plan_replace|erase|delete_all/.test(t.name)).map((t) => t.name);
  try { const r = await client.callTool({ name: 'today_get', arguments: {} }); out.todayGet = JSON.stringify(r.content).slice(0, 160); } catch (e) { out.todayGet = 'error: ' + e.message.slice(0, 160); }
  await client.close();
} catch (e) { out.initialize = 'error: ' + e.message.slice(0, 200); }
const raw = (headers) => new Promise((resolve) => {
  const u = new URL(url);
  const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...headers } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(`${res.statusCode} ${b.slice(0, 80)}`)); });
  req.on('error', (e) => resolve('error ' + e.message));
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } }));
});
out.rawHostPublicName = await raw({ Host: 'server.example.com' });
out.rawHostTsNet = await raw({ Host: `${cfg.pcHost}:4892` });
out.rawWithSiteOrigin = await raw({ Origin: 'https://vitals.creative.desi' });
out.rawNoBearer = await raw({ Authorization: '' });
console.log(JSON.stringify(out, null, 1));
