// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexHasVitals, codexWith, codexWithout, detectAgents, parseAgentId, registerAgent, unregisterAgent } from './agents.ts';
import { main } from './cli.ts';
import { doctorPassed, findServeUrl, formatDoctor, nodeSupported, readOpencodeZenKey, runDoctor, type DoctorReport } from './doctor.ts';
import { installWrapper, unitFile, wrapperRoot, wrapperScript, writeUnit } from './install.ts';
import type { FetchResult, RunResult, Sys } from './sys.ts';
import { tempDir } from './testHelpers.ts';

const HOME = '/home/owner';
const CODEX = `${HOME}/.codex/config.toml`;
const OPENCODE = `${HOME}/.config/opencode/opencode.json`;
const CLAUDE = `${HOME}/.claude.json`;

const CODEX_TOML = `model = "gpt-5.5"

[projects."/x"]
trust_level = "trusted"

[mcp_servers.node_repl]
command = "/usr/lib/chatgpt/resources/cua_node/bin/node_repl"
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
A = "1"

[mcp_servers.computer-use-linux]
command = "computer-use-linux"
args = ["mcp"]
`;

interface Fake extends Sys {
  files: Map<string, { data: string; mode: number }>;
  runs: Array<{ cmd: string; args: string[] }>;
}

function fakeSys(init: Record<string, string | { data: string; mode: number }> = {}, over: Partial<Sys> & { programs?: Record<string, (args: string[]) => RunResult>; urls?: Record<string, FetchResult>; busyPorts?: number[] } = {}): Fake {
  const files = new Map<string, { data: string; mode: number }>();
  for (const [p, v] of Object.entries(init)) files.set(p, typeof v === 'string' ? { data: v, mode: 0o600 } : v);
  const programs = over.programs ?? {};
  const runs: Fake['runs'] = [];
  let tick = 0;
  return {
    files,
    runs,
    env: { PATH: `${HOME}/.local/bin:/usr/bin` },
    home: HOME,
    platform: 'linux',
    nodeVersion: '24.21.0',
    execPath: '/usr/bin/node',
    run: async (cmd, args) => {
      runs.push({ cmd, args });
      const name = cmd.split('/').pop()!;
      return programs[name]?.(args) ?? { code: null, stdout: '', stderr: 'not found' };
    },
    which: async (cmd) => (files.has(`${HOME}/.local/bin/${cmd}`) ? `${HOME}/.local/bin/${cmd}` : cmd in programs ? `/usr/bin/${cmd}` : null),
    fetchJson: async (url) => over.urls?.[url] ?? { ok: false, error: 'ECONNREFUSED' },
    readText: async (p) => files.get(p)?.data ?? null,
    stat: async (p) => {
      const f = files.get(p);
      if (f) return { mode: f.mode, isDir: false };
      const dir = [...files.keys()].some((k) => k.startsWith(`${p}/`));
      return dir ? { mode: 0o700, isDir: true } : null;
    },
    portFree: async (_h, port) => !(over.busyPorts ?? []).includes(port),
    writeText: async (p, data, mode) => void files.set(p, { data, mode }),
    mkdir: async (p, mode) => void files.set(`${p}/.keep`, { data: '', mode }),
    copy: async (from, to) => {
      if (files.has(to)) throw new Error('EEXIST');
      files.set(to, { ...files.get(from)! });
    },
    now: () => new Date(Date.UTC(2026, 9, 2, 12, 0, tick++)),
    ...over,
  } as Fake;
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const backups = (sys: Fake, path: string) => [...sys.files.keys()].filter((k) => k.startsWith(`${path}.vitals-backup-`));

describe('Codex config.toml edits', () => {
  it('adds one [mcp_servers.vitals] table and keeps every other line', () => {
    const next = codexWith(CODEX_TOML, '/home/owner/.local/bin/vitals-companion');
    expect(next.startsWith(CODEX_TOML.trimEnd())).toBe(true);
    expect(next).toContain('[mcp_servers.vitals]\ncommand = "/home/owner/.local/bin/vitals-companion"\nargs = ["mcp"]');
    expect(next).toContain('default_tools_approval_mode = "approve"');
    expect(codexHasVitals(next)).toBe(true);
    expect(codexWith(next, '/home/owner/.local/bin/vitals-companion')).toBe(next);
    expect(codexWithout(next)).toBe(CODEX_TOML);
  });

  it('replaces our table and its sub-tables in the middle of the file, and nothing else', () => {
    const mid = CODEX_TOML.replace('[mcp_servers.computer-use-linux]', '[mcp_servers.vitals]\ncommand = "old"\n\n[mcp_servers.vitals.env]\nX = "1"\n\n[mcp_servers.computer-use-linux]');
    const removed = codexWithout(mid);
    expect(removed).toBe(CODEX_TOML);
    const replaced = codexWith(mid, 'new');
    expect(replaced).not.toContain('"old"');
    expect(replaced).not.toContain('mcp_servers.vitals.env');
    expect(replaced.match(/\[mcp_servers\.vitals\]/g)).toHaveLength(1);
    expect(codexHasVitals('[mcp_servers."vitals"]\ncommand="x"\n')).toBe(true);
    expect(codexHasVitals('[mcp_servers.vitals-http]\n')).toBe(false);
  });
});

describe('agents register / unregister', () => {
  it('codex: writes with a dated backup, is idempotent, and unregister restores the original lines', async () => {
    const sys = fakeSys({ [CODEX]: CODEX_TOML }, { programs: { codex: () => ok('codex-cli 0.159.0') } });
    const first = await registerAgent(sys, 'codex', { command: '/home/owner/.local/bin/vitals-companion' });
    expect(first.changed).toBe(true);
    expect(first.backup).toMatch(/config\.toml\.vitals-backup-2026-10-02T12-00-00$/);
    expect(sys.files.get(first.backup!)!.data).toBe(CODEX_TOML);
    expect(sys.files.get(CODEX)!.mode).toBe(0o600);
    const again = await registerAgent(sys, 'codex', { command: '/home/owner/.local/bin/vitals-companion' });
    expect(again.changed).toBe(false);
    expect(backups(sys, CODEX)).toHaveLength(1);
    const [codex, , , chatgpt] = await detectAgents(sys);
    expect(codex).toMatchObject({ id: 'codex', installed: true, version: '0.159.0', registered: true });
    expect(chatgpt).toMatchObject({ id: 'chatgpt-desktop', installed: false, registered: true });
    const off = await unregisterAgent(sys, 'codex');
    expect(off.changed).toBe(true);
    expect(sys.files.get(CODEX)!.data).toBe(CODEX_TOML);
    expect((await unregisterAgent(sys, 'codex')).changed).toBe(false);
  });

  it('chatgpt shares the Codex file and says so; a dry run writes nothing', async () => {
    const sys = fakeSys({ [CODEX]: CODEX_TOML });
    expect(parseAgentId('chatgpt')).toBe('chatgpt-desktop');
    expect(parseAgentId('cursor')).toBeNull();
    const dry = await registerAgent(sys, 'chatgpt-desktop', { command: 'vitals-companion', dryRun: true });
    expect(dry.changed).toBe(false);
    expect(dry.lines.join('\n')).toContain('Would write');
    expect(sys.files.get(CODEX)!.data).toBe(CODEX_TOML);
    const r = await registerAgent(sys, 'chatgpt-desktop', { command: 'vitals-companion' });
    expect(r.lines.join('\n')).toContain('ChatGPT desktop app reads the same file');
  });

  it('opencode: sets mcp.vitals only, keeps other servers, refuses a file that is not JSON', async () => {
    const original = JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { other: { type: 'local', command: ['x'] } } }, null, 2);
    const sys = fakeSys({ [OPENCODE]: original });
    const r = await registerAgent(sys, 'opencode', { command: '/b/vitals-companion' });
    expect(r.changed).toBe(true);
    expect(sys.files.get(r.backup!)!.data).toBe(original);
    const cfg = JSON.parse(sys.files.get(OPENCODE)!.data) as { mcp: Record<string, unknown> };
    expect(cfg.mcp.other).toEqual({ type: 'local', command: ['x'] });
    expect(cfg.mcp.vitals).toEqual({ type: 'local', command: ['/b/vitals-companion', 'mcp'], enabled: true, timeout: 20000 });
    expect((await registerAgent(sys, 'opencode', { command: '/b/vitals-companion' })).changed).toBe(false);
    await unregisterAgent(sys, 'opencode');
    expect(JSON.parse(sys.files.get(OPENCODE)!.data)).toEqual(JSON.parse(original));

    const bad = fakeSys({ [OPENCODE]: '{ // comment\n}' });
    await expect(registerAgent(bad, 'opencode', { command: 'v' })).rejects.toThrow(/not plain JSON/);
    expect(bad.files.get(OPENCODE)!.data).toBe('{ // comment\n}');
  });

  it('claude: goes through `claude mcp add -s user` and skips when already registered', async () => {
    const sys = fakeSys({ [CLAUDE]: JSON.stringify({ mcpServers: {} }) }, { programs: { claude: () => ok('2.1.287 (Claude Code)') } });
    const r = await registerAgent(sys, 'claude', { command: '/b/vitals-companion' });
    expect(r.changed).toBe(true);
    expect(sys.runs.at(-1)).toEqual({ cmd: '/usr/bin/claude', args: ['mcp', 'add', '-s', 'user', 'vitals', '--', '/b/vitals-companion', 'mcp'] });
    sys.files.set(CLAUDE, { data: JSON.stringify({ mcpServers: { vitals: {} } }), mode: 0o600 });
    expect((await registerAgent(sys, 'claude', { command: '/b/vitals-companion' })).changed).toBe(false);
    expect(sys.runs.filter((x) => x.args[1] === 'add')).toHaveLength(1);
    await unregisterAgent(sys, 'claude');
    expect(sys.runs.at(-1)!.args).toEqual(['mcp', 'remove', 'vitals', '-s', 'user']);
  });
});

describe('install and service', () => {
  it('writes an executable wrapper once, and leaves a foreign file alone unless --force', async () => {
    const sys = fakeSys();
    const r = await installWrapper(sys, { root: '/repo/packages/companion' });
    expect(r.changed).toBe(true);
    const w = sys.files.get(`${HOME}/.local/bin/vitals-companion`)!;
    expect(w.mode).toBe(0o755);
    expect(w.data).toBe(wrapperScript('/usr/bin/node', '/repo/packages/companion'));
    expect(wrapperRoot(w.data)).toBe('/repo/packages/companion');
    expect(r.lines.join('\n')).toContain('on your PATH');
    expect((await installWrapper(sys, { root: '/repo/packages/companion' })).changed).toBe(false);

    const other = fakeSys({ [`${HOME}/.local/bin/vitals-companion`]: '#!/bin/sh\necho mine\n' });
    expect((await installWrapper(other, { root: '/r' })).changed).toBe(false);
    expect(other.files.get(`${HOME}/.local/bin/vitals-companion`)!.data).toContain('echo mine');
    const forced = await installWrapper(other, { root: '/r', force: true });
    expect(forced.changed).toBe(true);
    expect(backups(other, `${HOME}/.local/bin/vitals-companion`)).toHaveLength(1);
  });

  it('wrapper survives a root with spaces and quotes', () => {
    const root = '/media/DEV/Hobby/Lumen Health/packages/companion';
    expect(wrapperRoot(wrapperScript('/usr/bin/node', root))).toBe(root);
    const odd = '/a/"b"/$c';
    expect(wrapperRoot(wrapperScript('/usr/bin/node', odd))).toBe(odd);
  });

  it('builds the unit the ops contract asks for and writes it idempotently', async () => {
    const unit = unitFile({ role: 'sync', nodePath: '/usr/bin/node', root: '/home/ubuntu/vitals-companion', port: 4870, dataDir: '/home/ubuntu/.local/share/vitals-companion' });
    for (const line of [
      'ExecStart=/usr/bin/node /home/ubuntu/vitals-companion/bin/vitals-companion.mjs sync --host 127.0.0.1 --port 4870 --data /home/ubuntu/.local/share/vitals-companion',
      'Restart=on-failure',
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ReadWritePaths=/home/ubuntu/.local/share/vitals-companion',
      'WantedBy=default.target',
    ]) {
      expect(unit).toContain(line);
    }
    expect(unit).not.toMatch(/Environment=.*(KEY|TOKEN|SECRET)/i);
    const spaced = unitFile({ role: 'proxy', nodePath: '/usr/bin/node', root: '/media/x y/companion', port: 4870, dataDir: '/d', configDir: '/c d' });
    expect(spaced).toContain('ExecStart=/usr/bin/node "/media/x y/companion/bin/vitals-companion.mjs" proxy');
    expect(spaced).toContain('--config-dir "/c d"');
    expect(spaced).toContain('ReadWritePaths=/d "/c d"');

    const sys = fakeSys();
    const first = await writeUnit(sys, unit, { dataDir: '/home/ubuntu/.local/share/vitals-companion', configDir: '/home/ubuntu/.config/vitals-companion' });
    expect(first.changed).toBe(true);
    // ReadWritePaths= must exist, or systemd fails the unit at NAMESPACE before Node starts (seen 2026-10-03)
    expect(first.lines.some((l) => l.includes('Created /home/ubuntu/.local/share/vitals-companion'))).toBe(true);
    expect(sys.files.has('/home/ubuntu/.local/share/vitals-companion/.keep')).toBe(true);
    expect(sys.files.has('/home/ubuntu/.config/vitals-companion/.keep')).toBe(true);
    expect((await writeUnit(sys, unit)).changed).toBe(false);
  });

  it('passes systemd-analyze verify when that tool exists', () => {
    let have = true;
    try {
      execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' });
    } catch {
      have = false;
    }
    if (!have) return;
    const tmp = tempDir();
    try {
      const root = join(import.meta.dirname, '..');
      const path = join(tmp.dir, 'vitals-companion.service');
      writeFileSync(path, unitFile({ role: 'sync', nodePath: process.execPath, root, port: 4870, dataDir: tmp.dir }));
      let out = '';
      try {
        out = execFileSync('systemd-analyze', ['--user', 'verify', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        out = String((e as { stderr?: string }).stderr ?? e);
      }
      // only lines about our unit count (the host's other units may warn)
      expect(out.split('\n').filter((l) => l.includes('vitals-companion.service') && !/Unit is bound to inactive|not found/i.test(l))).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('doctor', () => {
  const TS_STATUS = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'my-pc.example.ts.net.' }, CertDomains: ['my-pc.example.ts.net'] });
  const SERVE = JSON.stringify({ Web: { 'vitals.example.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4870' } } } } });
  const programs = {
    codex: () => ok('codex-cli 0.159.0'),
    opencode: () => ok('v2.0.19'),
    claude: () => ok('2.1.287 (Claude Code)'),
    chromium: () => ok('Chromium 153.0.8010.52 Arch Linux'),
    systemctl: () => ({ code: 3, stdout: 'inactive\n', stderr: '' }),
    tailscale: (args: string[]) => ok(args[0] === 'serve' ? SERVE : TS_STATUS),
    'vitals-companion': () => ok(''),
  };

  it('finds the serve URL that proxies to our port', () => {
    expect(findServeUrl(JSON.parse(SERVE), 4870)).toBe('https://vitals.example.ts.net:8443');
    expect(findServeUrl({ Web: { 'h.ts.net:443': { Handlers: { '/': { Proxy: 'http://localhost:4870' } } } } }, 4870)).toBe('https://h.ts.net');
    expect(findServeUrl(JSON.parse(SERVE), 4871)).toBeUndefined();
    expect(findServeUrl({}, 4870)).toBeUndefined();
  });

  it('reports every check in the contract shape and never a secret', async () => {
    const sys = fakeSys(
      {
        [CODEX]: codexWith(CODEX_TOML, 'vitals-companion'),
        [`${HOME}/.config/vitals-companion/admin.token`]: 'ADMIN-SECRET-TOKEN-VALUE',
        [`${HOME}/.config/vitals-companion/keys.json`]: JSON.stringify({ 'opencode-zen': 'zen-secret-key-123' }),
        [`${HOME}/.local/share/opencode/auth.json`]: JSON.stringify({ opencode: { type: 'api', key: 'zen-secret-key-123' } }),
        [`${HOME}/.local/bin/vitals-companion`]: wrapperScript('/usr/bin/node', '/repo/packages/companion'),
      },
      { programs, urls: { 'https://vitals.example.ts.net:8443/health': { ok: true, status: 200, json: { version: '0.2.0', roles: ['relay'], ownerCount: 1 } } } },
    );
    const report = await runDoctor(sys, { version: '0.2.0', configDir: `${HOME}/.config/vitals-companion`, port: 4870, server: 'https://vitals.example.ts.net:8443/' });
    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual(['node', 'bin', 'configDir', 'port', 'service', 'tailscale', 'serve', 'relay', 'siwc', 'zen', 'agent:codex', 'agent:opencode', 'agent:claude', 'agent:chatgpt-desktop', 'webmcp']);
    for (const c of report.checks) {
      expect(['ok', 'warn', 'fail', 'absent']).toContain(c.status);
      expect(typeof c.required).toBe('boolean');
      expect(typeof c.detail).toBe('string');
    }
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.bin!.detail).toContain('/repo/packages/companion');
    expect(byId.relay).toMatchObject({ status: 'ok', required: true });
    expect(byId.relay!.detail).toContain('1 synced account');
    expect(byId.serve).toMatchObject({ status: 'ok', detail: 'https://vitals.example.ts.net:8443 → 127.0.0.1:4870' });
    expect(byId.zen).toMatchObject({ status: 'ok' });
    expect(byId['agent:codex']).toMatchObject({ status: 'ok' });
    expect(byId['agent:chatgpt-desktop']).toMatchObject({ status: 'absent' });
    expect(byId['agent:opencode']).toMatchObject({ status: 'warn', fix: 'vitals-companion agents register opencode' });
    expect(byId.webmcp!.detail).toContain('153.0.8010.52');
    expect(doctorPassed(report)).toBe(true);
    const text = JSON.stringify(report) + formatDoctor(report).join('\n');
    expect(text).not.toContain('ADMIN-SECRET');
    expect(text).not.toContain('zen-secret');
    expect(await readOpencodeZenKey(sys)).toBe('zen-secret-key-123');
  });

  it('fails a required check: wide config modes, a busy port, an unreachable server', async () => {
    const sys = fakeSys({ [`${HOME}/.config/vitals-companion/admin.token`]: { data: 'x', mode: 0o644 } }, { programs: {}, busyPorts: [4870] });
    const report = await runDoctor(sys, { version: '0.2.0', configDir: `${HOME}/.config/vitals-companion`, port: 4870, server: 'https://nope.ts.net:8443' });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.configDir).toMatchObject({ status: 'fail' });
    expect(byId.configDir!.detail).toContain('admin.token is 644');
    expect(byId.port).toMatchObject({ status: 'fail' });
    expect(byId.relay).toMatchObject({ status: 'fail', required: true });
    expect(byId.relay!.detail).toContain('ECONNREFUSED');
    expect(byId.tailscale).toMatchObject({ status: 'absent', required: false });
    expect(byId.zen).toMatchObject({ status: 'absent' });
    expect(doctorPassed(report)).toBe(false);
    expect(formatDoctor(report).at(-1)).toContain('failed');
  });

  it('reports a running Companion on the port as ok, and Node versions', async () => {
    const sys = fakeSys({}, { programs: {}, busyPorts: [4870], urls: { 'http://127.0.0.1:4870/health': { ok: true, status: 200, json: { version: '0.2.0', roles: ['proxy', 'agent'], ownerCount: 0 } } } });
    const report = await runDoctor(sys, { version: '0.2.0', configDir: '/c', port: 4870 });
    expect(report.checks.find((c) => c.id === 'port')).toMatchObject({ status: 'ok', detail: 'Companion 0.2.0 answers on http://127.0.0.1:4870 (proxy, agent)' });
    expect(report.checks.find((c) => c.id === 'relay')).toMatchObject({ status: 'absent', required: false });
    expect(nodeSupported('22.18.0')).toBe(true);
    expect(nodeSupported('22.17.9')).toBe(false);
    expect(nodeSupported('23.6.0')).toBe(true);
    expect(nodeSupported('24.21.0')).toBe(true);
  });

  it('`doctor --json` prints the report and exits 1 on a failed required check', async () => {
    const sys = fakeSys({}, { programs: {}, busyPorts: [4870] });
    const out: string[] = [];
    expect(await main(['doctor', '--json', '--config-dir', '/c'], (l) => out.push(l), { sys })).toBe(1);
    const report = JSON.parse(out.join('\n')) as DoctorReport;
    expect(report.version).toBe('0.4.0');
    expect(report.checks.find((c) => c.id === 'port')!.status).toBe('fail');
    const human: string[] = [];
    expect(await main(['doctor', '--config-dir', '/c', '--port', '4999'], (l) => human.push(l), { sys })).toBe(0);
    expect(human.join('\n')).toContain('All required checks passed.');
  });

  it('CLI: agents status/register, install --dry-run, service, keys import never print secrets', async () => {
    const tmp = tempDir();
    try {
      const sys = fakeSys({ [CODEX]: CODEX_TOML, [`${HOME}/.local/share/opencode/auth.json`]: JSON.stringify({ opencode: { type: 'api', key: 'zen-secret-key-123' } }) }, { programs });
      const out: string[] = [];
      expect(await main(['agents', 'register', 'codex'], (l) => out.push(l), { sys })).toBe(0);
      expect(await main(['agents', 'status'], (l) => out.push(l), { sys })).toBe(0);
      expect(out.join('\n')).toMatch(/Codex CLI\s+0\.159\.0\s+vitals registered/);
      expect(await main(['agents', 'register', 'cursor'], (l) => out.push(l), { sys })).toBe(2);
      expect(await main(['install', '--dry-run'], (l) => out.push(l), { sys })).toBe(0);
      expect(sys.files.has(`${HOME}/.local/bin/vitals-companion`)).toBe(false);
      out.length = 0;
      expect(await main(['service', '--role', 'sync'], (l) => out.push(l), { sys })).toBe(0);
      expect(out.join('\n')).toContain('tailscale serve --bg --https=8443 http://127.0.0.1:4870');
      expect(out.join('\n')).toContain('ProtectSystem=strict');
      expect(await main(['service', '--role', 'nope'], (l) => out.push(l), { sys })).toBe(2);
      out.length = 0;
      expect(await main(['keys', 'import', 'opencode-zen', '--config-dir', tmp.dir], (l) => out.push(l), { sys })).toBe(0);
      expect(out.join('\n')).not.toContain('zen-secret');
      const list: string[] = [];
      await main(['keys', 'list', '--config-dir', tmp.dir], (l) => list.push(l), { sys });
      expect(list.join('\n')).toMatch(/opencode-zen\s+configured \(keys\.json\)/);
      expect(await main(['keys', 'import', 'nim', '--config-dir', tmp.dir], (l) => out.push(l), { sys })).toBe(2);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('/v1/pair/status: detected environment and MCP clients', () => {
  it('adds the environment probe and the MCP clients that called a tool', async () => {
    const { startCompanion } = await import('./server.ts');
    const { readAdminToken } = await import('./config.ts');
    const { rawCall } = await import('./testHelpers.ts');
    const tmp = tempDir();
    const companion = await startCompanion({
      port: 0,
      relay: false,
      agent: true,
      allowedOrigins: [],
      configDir: join(tmp.dir, 'cfg'),
      environment: async () => ({
        agents: [{ id: 'codex', label: 'Codex CLI', installed: true, version: '0.159.0', registered: true }],
        tailscale: { running: true, dnsName: 'my-pc.example.ts.net' },
      }),
    });
    try {
      const admin = await readAdminToken(join(tmp.dir, 'cfg'));
      const auth = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
      for (const clientName of ['codex-mcp-client', 'cli', 'opencode', 'some-agent']) {
        await rawCall(companion.port, 'POST', '/v1/agent/call', auth, JSON.stringify({ tool: 'today_get', args: {}, clientName }));
      }
      const s = (await rawCall(companion.port, 'GET', '/v1/pair/status', auth)).json();
      expect(s.agents).toEqual([{ id: 'codex', label: 'Codex CLI', installed: true, version: '0.159.0', registered: true }]);
      expect(s.tailscale).toEqual({ running: true, dnsName: 'my-pc.example.ts.net' });
      const clients = s.mcpClients as Array<{ name: string; lastSeenAt: string }>;
      // Q5-02: product names, `cli` and `opencode` listed once as OpenCode, unknown ids unchanged.
      expect(clients.map((c) => c.name).sort()).toEqual(['Codex or the ChatGPT app', 'OpenCode', 'some-agent']);
      for (const c of clients) expect(c.lastSeenAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    } finally {
      await companion.close();
      tmp.cleanup();
    }
  });
});
