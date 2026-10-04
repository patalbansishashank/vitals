/**
 * `vitals-companion doctor [--json] [--server <url>] [--port <n>] [--config-dir <dir>]`: what is set up on this computer
 * and what is not, with the exact command that fixes each gap. Exit 0 when every required check passes, 1 otherwise.
 *
 * Never prints a secret: credentials are reported as present or absent, file contents are never echoed. Every network
 * probe has a 3 s limit and every program probe a few seconds, so the whole report stays quick.
 */
import { platform as osPlatform, release } from 'node:os';
import { join } from 'node:path';
import { detectAgents, type AgentId, type AgentState } from './agents.ts';
import { configFiles } from './config.ts';
import { DEFAULT_HTTPS_PORT, defaultDataDir, serveCommand, wrapperRoot } from './install.ts';
import { UPSTREAMS } from './proxy.ts';
import { xdgDataHome, type Sys } from './sys.ts';

export type CheckId =
  | 'node'
  | 'bin'
  | 'configDir'
  | 'port'
  | 'tailscale'
  | 'serve'
  | 'service'
  | 'relay'
  | 'siwc'
  | 'zen'
  | `agent:${AgentId}`
  | 'webmcp';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'absent';

export interface DoctorCheck {
  id: CheckId;
  required: boolean;
  status: CheckStatus;
  detail: string;
  /** The exact command to run; never contains a secret. */
  fix?: string;
}

export interface DoctorReport {
  version: string;
  node: string;
  os: string;
  configDir: string;
  dataDir: string;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  version: string;
  configDir: string;
  dataDir?: string;
  port: number;
  /** Sync server to check (`--server`); its check is required when given. */
  server?: string;
}

const NET_MS = 3_000;
const MIN_NODE: [number, number] = [22, 18];

export function nodeSupported(v: string): boolean {
  const [maj = 0, min = 0] = v.split('.').map(Number);
  return maj > 23 || (maj === 23 && min >= 6) || (maj === 22 && min >= MIN_NODE[1]);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `{version, roles}` from a Companion `/health` body, or null. */
function health(json: unknown): { version: string; roles: string[]; ownerCount?: number } | null {
  if (!isObj(json) || typeof json.version !== 'string' || !Array.isArray(json.roles)) return null;
  return { version: json.version, roles: json.roles.map(String), ownerCount: typeof json.ownerCount === 'number' ? json.ownerCount : undefined };
}

export interface TailscaleState {
  running: boolean;
  dnsName?: string;
  httpsEnabled?: boolean;
  /** `https://<name>:<port>` when `tailscale serve` proxies to our port. */
  serveUrl?: string;
}

/** Reads `tailscale status --json` and `tailscale serve status --json`. Never throws. */
export async function detectTailscale(sys: Sys, port: number): Promise<TailscaleState & { installed: boolean }> {
  const bin = await sys.which('tailscale');
  if (!bin) return { installed: false, running: false };
  const st = await sys.run(bin, ['status', '--json'], { timeoutMs: 4_000 });
  let status: Record<string, unknown>;
  try {
    status = JSON.parse(st.stdout) as Record<string, unknown>;
  } catch {
    return { installed: true, running: false };
  }
  const self = isObj(status.Self) ? status.Self : {};
  const dnsName = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : undefined;
  const certDomains = Array.isArray(status.CertDomains) ? status.CertDomains : [];
  const running = status.BackendState === 'Running';
  let serveUrl: string | undefined;
  const sv = await sys.run(bin, ['serve', 'status', '--json'], { timeoutMs: 4_000 });
  try {
    serveUrl = findServeUrl(JSON.parse(sv.stdout || '{}') as unknown, port);
  } catch {
    // no serve config
  }
  return { installed: true, running, dnsName, httpsEnabled: certDomains.length > 0, serveUrl };
}

/** The HTTPS URL whose handler proxies to 127.0.0.1:<port> (or localhost:<port>) in a `serve status --json` body. */
export function findServeUrl(serve: unknown, port: number): string | undefined {
  if (!isObj(serve) || !isObj(serve.Web)) return undefined;
  const target = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`);
  for (const [hostPort, cfg] of Object.entries(serve.Web)) {
    if (!isObj(cfg) || !isObj(cfg.Handlers)) continue;
    for (const h of Object.values(cfg.Handlers)) {
      if (isObj(h) && typeof h.Proxy === 'string' && target.test(h.Proxy)) {
        const [host, p] = hostPort.split(':');
        return p === '443' ? `https://${host}` : `https://${host}:${p}`;
      }
    }
  }
  return undefined;
}

async function configCheck(sys: Sys, dir: string): Promise<DoctorCheck> {
  const s = await sys.stat(dir);
  if (!s) return { id: 'configDir', required: true, status: 'absent', detail: `${dir} does not exist yet (made on first start)`, fix: 'vitals-companion proxy' };
  if (!s.isDir) return { id: 'configDir', required: true, status: 'fail', detail: `${dir} is not a directory` };
  const wide: string[] = [];
  if (s.mode & 0o077) wide.push(`${dir} is ${s.mode.toString(8)}, should be 700`);
  const f = configFiles(dir);
  const present: string[] = [];
  for (const p of [f.adminToken, f.keys, f.siwc, f.pairings, f.install]) {
    const fs = await sys.stat(p);
    if (!fs) continue;
    present.push(p.slice(dir.length + 1));
    if (fs.mode & 0o077) wide.push(`${p.slice(dir.length + 1)} is ${fs.mode.toString(8)}, should be 600`);
  }
  if (wide.length) return { id: 'configDir', required: true, status: 'fail', detail: wide.join('; '), fix: `chmod 700 ${dir} && chmod 600 ${dir}/*` };
  return { id: 'configDir', required: true, status: 'ok', detail: `${dir} (700; ${present.length ? `${present.join(', ')} 600` : 'no files yet'})` };
}

function agentCheck(a: AgentState): DoctorCheck {
  const id = `agent:${a.id}` as const;
  const short = a.id === 'chatgpt-desktop' ? 'chatgpt' : a.id;
  if (!a.installed) return { id, required: false, status: 'absent', detail: `${a.label} not found` };
  const where = `${a.label}${a.version ? ` ${a.version}` : ''}${a.path ? ` at ${a.path}` : ''}`;
  if (a.registered) return { id, required: false, status: 'ok', detail: `${where}; vitals MCP registered (${a.configPath})` };
  return { id, required: false, status: 'warn', detail: `${where}; vitals MCP not registered`, fix: `vitals-companion agents register ${short}` };
}

export async function runDoctor(sys: Sys, o: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const local = `http://127.0.0.1:${o.port}`;

  checks.push(
    nodeSupported(sys.nodeVersion)
      ? { id: 'node', required: true, status: 'ok', detail: `Node ${sys.nodeVersion} at ${sys.execPath}` }
      : { id: 'node', required: true, status: 'fail', detail: `Node ${sys.nodeVersion} is too old; 22.18 or newer is needed`, fix: 'Install Node.js 22.18+ (or 24 LTS)' },
  );

  const bin = await sys.which('vitals-companion');
  if (bin) {
    const root = wrapperRoot(await sys.readText(bin));
    checks.push({ id: 'bin', required: false, status: 'ok', detail: root ? `${bin} → ${root}` : bin });
  } else checks.push({ id: 'bin', required: false, status: 'warn', detail: 'vitals-companion is not on PATH', fix: `node ${join('packages', 'companion', 'bin', 'vitals-companion.mjs')} install` });

  checks.push(await configCheck(sys, o.configDir));

  // port + running Companion
  const h = await sys.fetchJson(`${local}/health`, NET_MS);
  const mine = h.ok ? health(h.json) : null;
  if (mine) checks.push({ id: 'port', required: true, status: 'ok', detail: `Companion ${mine.version} answers on ${local} (${mine.roles.join(', ')})` });
  else if (await sys.portFree('127.0.0.1', o.port)) checks.push({ id: 'port', required: true, status: 'ok', detail: `port ${o.port} is free; the Companion is not running`, fix: 'vitals-companion serve   (or: vitals-companion proxy)' });
  else checks.push({ id: 'port', required: true, status: 'fail', detail: `another program uses 127.0.0.1:${o.port}`, fix: `vitals-companion proxy --port ${o.port + 1}` });

  // systemd user unit on this machine
  if (sys.platform === 'linux' && (await sys.which('systemctl'))) {
    const r = await sys.run('systemctl', ['--user', 'is-active', 'vitals-companion'], { timeoutMs: 3_000 });
    const state = r.stdout.trim();
    if (state === 'active') checks.push({ id: 'service', required: false, status: 'ok', detail: 'systemd user unit vitals-companion is active' });
    else if (state === 'failed') checks.push({ id: 'service', required: false, status: 'warn', detail: 'systemd user unit vitals-companion failed', fix: 'journalctl --user -u vitals-companion -n 50' });
    else checks.push({ id: 'service', required: false, status: 'absent', detail: 'no systemd user unit running (optional on a desktop)', fix: 'vitals-companion service --role proxy --write' });
  } else checks.push({ id: 'service', required: false, status: 'absent', detail: 'systemd not available' });

  // Tailscale
  const ts = await detectTailscale(sys, o.port);
  if (!ts.installed) checks.push({ id: 'tailscale', required: false, status: 'absent', detail: 'Tailscale is not installed (only needed to reach a sync server or this Companion from other devices)' });
  else if (!ts.running) checks.push({ id: 'tailscale', required: false, status: 'warn', detail: 'Tailscale is installed but not connected', fix: 'tailscale up' });
  else
    checks.push({
      id: 'tailscale',
      required: false,
      status: ts.httpsEnabled ? 'ok' : 'warn',
      detail: `connected as ${ts.dnsName ?? '?'}; HTTPS certificates ${ts.httpsEnabled ? 'enabled' : 'not enabled'}`,
      ...(ts.httpsEnabled ? {} : { fix: 'Tailscale admin console › DNS › HTTPS Certificates › Enable' }),
    });
  if (ts.serveUrl) checks.push({ id: 'serve', required: false, status: 'ok', detail: `${ts.serveUrl} → 127.0.0.1:${o.port}` });
  else checks.push({ id: 'serve', required: false, status: 'absent', detail: `tailscale serve does not point at port ${o.port} on this machine (only needed for a server)`, fix: serveCommand(o.port, DEFAULT_HTTPS_PORT) });

  // sync server
  if (o.server) {
    const url = o.server.replace(/\/+$/, '');
    const r = await sys.fetchJson(`${url}/health`, NET_MS);
    const sh = r.ok ? health(r.json) : null;
    if (sh && sh.roles.includes('relay')) checks.push({ id: 'relay', required: true, status: 'ok', detail: `${url} answers: Companion ${sh.version}, roles ${sh.roles.join(', ')}${sh.ownerCount !== undefined ? `, ${sh.ownerCount} synced account(s)` : ''}` });
    else if (sh) checks.push({ id: 'relay', required: true, status: 'fail', detail: `${url} answers but is not a sync relay (roles ${sh.roles.join(', ')})`, fix: 'Run it with: vitals-companion sync' });
    else checks.push({ id: 'relay', required: true, status: 'fail', detail: `${url}/health: ${r.error ?? `HTTP ${r.status}`}`, fix: 'On the server: systemctl --user status vitals-companion; tailscale serve status' });
  } else checks.push({ id: 'relay', required: false, status: 'absent', detail: 'no sync server given', fix: 'vitals-companion doctor --server https://<server>.<tailnet>.ts.net:8443' });

  // providers (presence only)
  const siwc = await sys.stat(configFiles(o.configDir).siwc);
  checks.push(
    siwc
      ? { id: 'siwc', required: false, status: 'ok', detail: 'Sign in with ChatGPT: signed in (token file present)' }
      : { id: 'siwc', required: false, status: 'absent', detail: 'Sign in with ChatGPT: not signed in', fix: 'vitals-companion siwc login' },
  );
  const zenEnv = UPSTREAMS['opencode-zen']?.auth.kind === 'key' ? UPSTREAMS['opencode-zen'].auth.env : 'OPENCODE_API_KEY';
  const keysText = await sys.readText(configFiles(o.configDir).keys);
  let zenFile = false;
  try {
    const k = keysText ? (JSON.parse(keysText) as Record<string, unknown>) : {};
    zenFile = typeof k['opencode-zen'] === 'string' && k['opencode-zen'] !== '';
  } catch {
    // unreadable keys.json: reported as absent
  }
  const ocAuth = await readOpencodeZenKey(sys);
  const zenSource = sys.env[zenEnv]?.trim() ? 'environment' : zenFile ? 'keys.json' : null;
  checks.push(
    zenSource
      ? { id: 'zen', required: false, status: 'ok', detail: `OpenCode Zen key present (${zenSource})` }
      : ocAuth
        ? { id: 'zen', required: false, status: 'warn', detail: "OpenCode Zen key found in OpenCode's own store, not yet in the Companion", fix: 'vitals-companion keys import opencode-zen' }
        : { id: 'zen', required: false, status: 'absent', detail: 'OpenCode Zen key absent', fix: 'vitals-companion keys set opencode-zen' },
  );

  for (const a of await detectAgents(sys)) checks.push(agentCheck(a));

  // WebMCP-capable browser
  const chromium = (await sys.which('chromium')) ?? (await sys.which('google-chrome')) ?? (await sys.which('google-chrome-stable'));
  if (chromium) {
    const v = await sys.run(chromium, ['--version'], { timeoutMs: 4_000 });
    const ver = /(\d+)\.\d+\.\d+\.\d+/.exec(v.stdout);
    const major = ver ? Number(ver[1]) : 0;
    checks.push({
      id: 'webmcp',
      required: false,
      status: major >= 149 ? 'ok' : 'warn',
      detail: `${ver ? ver[0] : 'unknown version'} at ${chromium}; agents in the browser need chrome://flags/#enable-webmcp-testing (or --enable-features=WebMCP)`,
    });
  } else checks.push({ id: 'webmcp', required: false, status: 'absent', detail: 'no Chromium or Chrome found' });

  return { version: o.version, node: sys.nodeVersion, os: `${osPlatform()} ${release()}`, configDir: o.configDir, dataDir: o.dataDir ?? defaultDataDir(sys), checks };
}

export const doctorPassed = (r: DoctorReport) => r.checks.every((c) => !c.required || c.status !== 'fail');

const MARK: Record<CheckStatus, string> = { ok: 'ok    ', warn: 'warn  ', fail: 'FAIL  ', absent: 'absent' };

export function formatDoctor(r: DoctorReport): string[] {
  const out = [`vitals-companion ${r.version} · Node ${r.node} · ${r.os}`, `config ${r.configDir}`, `data   ${r.dataDir}`, ''];
  const w = Math.max(...r.checks.map((c) => c.id.length));
  for (const c of r.checks) {
    out.push(`${MARK[c.status]}  ${c.id.padEnd(w)}  ${c.detail}`);
    if (c.fix && c.status !== 'ok') out.push(`${' '.repeat(8 + w + 2)}→ ${c.fix}`);
  }
  out.push('', doctorPassed(r) ? 'All required checks passed.' : 'Some required checks failed (FAIL rows above).');
  return out;
}

/* ---- OpenCode's own key store ----------------------------------------------------------------------------------- */

export const opencodeAuthPath = (sys: Sys) => join(xdgDataHome(sys), 'opencode', 'auth.json');

/**
 * The OpenCode Zen API key from OpenCode's `auth.json` (`{"opencode": {"type": "api", "key": "…"}}`), or null. Callers
 * must never print the value; `keys import` hands it straight to the key store.
 */
export async function readOpencodeZenKey(sys: Sys): Promise<string | null> {
  const text = await sys.readText(opencodeAuthPath(sys));
  if (!text) return null;
  try {
    const auth = JSON.parse(text) as Record<string, unknown>;
    const entry = auth.opencode;
    if (isObj(entry) && entry.type === 'api' && typeof entry.key === 'string' && entry.key.trim()) return entry.key.trim();
  } catch {
    // not JSON
  }
  return null;
}
