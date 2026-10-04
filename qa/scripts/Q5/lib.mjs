// Q5 shared helpers: processes, the Companion admin route, the MCP tool list, secret stripping, the pass/fail table.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const PORT = Number(process.env.Q5_PORT || 5193);
export const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
export const COMPANION = process.env.COMPANION_URL || 'http://127.0.0.1:4870';
export const OUT = `${ROOT}/qa/results/Q5`;
export const SHOTS = `${ROOT}/qa/screenshots`;
export const TMP = `${ROOT}/.e6-tmp`;
export const WRAPPER = `${homedir()}/.local/bin/vitals-companion`;
export const DESTRUCTIVE = ['plan_end', 'plan_replace', 'coach_delete', 'bio_delete_source', 'data_import', 'data_erase_all', 'sync_unpair'];
mkdirSync(OUT, { recursive: true });

const CFG = process.env.VITALS_COMPANION_CONFIG || `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/vitals-companion`;
const admin = () => readFileSync(`${CFG}/admin.token`, 'utf8').trim();

/** Removes anything that looks like a credential before a transcript is written to disk. */
export function strip(s) {
  let out = String(s);
  try { const a = admin(); if (a) out = out.split(a).join('[admin-token]'); } catch { /* no token */ }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]')
    .replace(/\b(sk|rk|pk|nvapi|sk-ant)-[A-Za-z0-9_-]{12,}/g, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
    .replace(/("(?:access_token|refresh_token|id_token|api_?key|token|authorization)"\s*:\s*")[^"]+"/gi, '$1[redacted]"')
    .replace(/Pairing code: \d{8}/g, 'Pairing code: [code]');
}

export const today = () => { const d = new Date(Date.now() - 4 * 3600e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitHttp(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return r; } catch { /* not up */ } await sleep(500); }
  throw new Error(`no answer from ${url} within ${ms} ms`);
}

/** Starts a long-running process; its output goes to a log file (stripped of secrets as it streams). */
export function startProc(name, cmd, args, opts = {}) {
  const log = createWriteStream(`${OUT}/${name}.log`);
  const p = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => log.write(strip(d.toString())));
  return { p, stop: () => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } log.end(); } };
}

/** Runs a command to completion (no shell), with a timeout; returns { code, stdout, stderr, ms }. */
export function runCmd(cmd, args, { cwd = ROOT, input, timeoutMs = 600000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    if (input != null) { p.stdin.end(input); }
    const timer = setTimeout(() => { stderr += `\n[killed after ${timeoutMs} ms]`; try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
  });
}

/** Calls one Vitals tool through the Companion's admin route; the paired tab runs it on its command bus. */
export async function companionCall(tool, args = {}, clientName = 'q5-setup') {
  const r = await fetch(`${COMPANION}/v1/agent/call`, { method: 'POST', headers: { Authorization: `Bearer ${admin()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args, clientName, requestId: `q5-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }) });
  return r.json();
}
export async function companionStatus() {
  const r = await fetch(`${COMPANION}/v1/pair/status`, { headers: { Authorization: `Bearer ${admin()}` } });
  return r.json();
}

/** The MCP tool list exactly as an agent sees it: a stdio MCP client on `vitals-companion mcp`. */
export async function mcpTools() {
  const sdk = `${ROOT}/packages/companion/node_modules/@modelcontextprotocol/sdk/dist/esm/client`;
  const { Client } = await import(`${sdk}/index.js`);
  const { StdioClientTransport } = await import(`${sdk}/stdio.js`);
  const client = new Client({ name: 'q5-tools-list', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: WRAPPER, args: ['mcp'], stderr: 'ignore' }));
  const all = [];
  let cursor;
  do { const r = await client.listTools(cursor ? { cursor } : {}); all.push(...r.tools); cursor = r.nextCursor; } while (cursor);
  await client.close();
  return all;
}

export function table(rows) {
  const w = Math.max(...rows.map((r) => r.name.length), 10);
  const lines = [`| # | ${'check'.padEnd(w)} | result | detail |`, `|---|${'-'.repeat(w + 2)}|---|---|`];
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.name.padEnd(w)} | ${r.ok ? 'PASS' : 'FAIL'} | ${String(r.detail ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 220)} |`));
  return lines.join('\n');
}
export const save = (name, data) => writeFileSync(`${OUT}/${name}`, strip(typeof data === 'string' ? data : JSON.stringify(data, null, 1)));
