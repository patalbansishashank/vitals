// @vitest-environment node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from './cli.ts';
import { startCompanion, VERSION, type Companion } from './server.ts';
import { rawCall, tempDir } from './testHelpers.ts';

/** `--version` prints the package's own version (it follows every release). */
const PKG_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

describe('vitals-companion CLI', () => {
  it('prints the version and help', async () => {
    const out: string[] = [];
    expect(await main(['--version'], (l) => out.push(l))).toBe(0);
    expect(out).toEqual([PKG_VERSION]);
    expect(await main(['--help'], (l) => out.push(l))).toBe(0);
    expect(out[1]).toContain('vitals-companion sync [options]');
    expect(out[1]).toContain('--serve-app <dist>');
  });

  it('rejects unknown commands and bad ports', async () => {
    const out: string[] = [];
    expect(await main(['bogus'], (l) => out.push(l))).toBe(2);
    expect(await main(['sync', '--port', 'x'], (l) => out.push(l))).toBe(2);
    expect(await main(['sync', '--bogus'], (l) => out.push(l))).toBe(2);
    expect(out.join('\n')).toContain('Invalid --port');
  });
});

describe('vitals-companion CLI: new subcommands', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeAll(() => {
    tmp = tempDir();
  });
  afterAll(() => tmp.cleanup());

  it('documents every subcommand and flag in --help', async () => {
    const out: string[] = [];
    await main(['--help'], (l) => out.push(l));
    for (const s of ['serve [options]', 'proxy [options]', 'pair [--client <name>]', 'mcp [--manifest <file>]', 'keys set|list|remove', 'siwc login|status|logout', '--dist <dir>', '--config-dir <dir>', '--url <url>']) {
      expect(out[0]).toContain(s);
    }
  });

  it('rejects unknown subcommands and extra positionals', async () => {
    const out: string[] = [];
    for (const argv of [['keys'], ['keys', 'show'], ['siwc'], ['siwc', 'whoami'], ['sync', 'extra'], ['pair', 'x'], ['keys', 'set', 'nim', 'extra']]) {
      expect(await main(argv, (l) => out.push(l)), argv.join(' ')).toBe(2);
    }
    expect(await main(['keys', 'set', 'openai', '--config-dir', tmp.dir], (l) => out.push(l))).toBe(2);
    expect(await main(['serve', '--dist', join(tmp.dir, 'missing'), '--config-dir', tmp.dir], (l) => out.push(l))).toBe(2);
    expect(out.join('\n')).toContain('No Vitals build');
  });

  it('keys set reads the key from stdin, writes keys.json 0600 and never prints it; list shows yes/no only', async () => {
    const configDir = join(tmp.dir, 'keys');
    const out: string[] = [];
    const err: string[] = [];
    const stdin = Readable.from([Buffer.from('nvapi-SECRET-from-stdin-123\n')]) as unknown as NodeJS.ReadStream;
    expect(await main(['keys', 'set', 'nim', '--config-dir', configDir], (l) => out.push(l), { err: (l) => err.push(l), stdin })).toBe(0);
    const file = join(configDir, 'keys.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ nim: 'nvapi-SECRET-from-stdin-123' });
    await main(['keys', 'list', '--config-dir', configDir], (l) => out.push(l));
    expect(out.join('\n')).toMatch(/nim\s+configured \((keys\.json|environment)\)/);
    expect([...out, ...err].join('\n')).not.toContain('nvapi-SECRET');
    expect(await main(['keys', 'remove', 'nim', '--config-dir', configDir], (l) => out.push(l))).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
  });

  it('pair prints a fresh code and pair --client prints a client token once', async () => {
    const configDir = join(tmp.dir, 'pair');
    const out: string[] = [];
    expect(await main(['pair', '--config-dir', configDir, '--url', 'http://127.0.0.1:9'], (l) => out.push(l))).toBe(1);
    const companion = await startCompanion({ port: 0, allowedOrigins: [], relay: false, agent: true, configDir });
    try {
      expect(await main(['pair', '--config-dir', configDir, '--url', companion.url], (l) => out.push(l))).toBe(0);
      const code = /Pairing code: (\d{8})/.exec(out.join('\n'))![1]!;
      const paired = await rawCall(companion.port, 'POST', '/v1/pair/local', { Origin: 'https://vitals.creative.desi', 'Content-Type': 'application/json' }, JSON.stringify({ code }));
      expect(paired.status).toBe(200);
      out.length = 0;
      expect(await main(['pair', '--client', 'Claude Code', '--config-dir', configDir, '--url', companion.url], (l) => out.push(l))).toBe(0);
      const token = out[1]!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await rawCall(companion.port, 'GET', '/v1/pair/status', { Authorization: `Bearer ${token}` })).status).toBe(200);
    } finally {
      await companion.close();
    }
  });

  it('proxy starts on one port and prints the pairing code; sync output is unchanged', async () => {
    const out: string[] = [];
    let started: Companion | undefined;
    expect(await main(['proxy', '--port', '0', '--config-dir', join(tmp.dir, 'p')], (l) => out.push(l), { noSignals: true, onStarted: (c) => (started = c) })).toBe(0);
    try {
      expect(out.join('\n')).toMatch(/Pairing code: \d{8}/);
      expect(out.join('\n')).toContain('/v1/agent/bridge');
      expect(out.join('\n')).not.toContain('sync relay');
      expect(started!.roles).toEqual(['proxy', 'agent']);
    } finally {
      await started?.close();
    }
    const sync: string[] = [];
    let s: Companion | undefined;
    expect(await main(['sync', '--port', '0', '--data', join(tmp.dir, 'd')], (l) => sync.push(l), { noSignals: true, onStarted: (c) => (s = c) })).toBe(0);
    try {
      expect(sync[1]).toMatch(/^ {2}sync relay {2}ws:\/\/127\.0\.0\.1:\d+\/sync$/);
      expect(sync.join('\n')).not.toContain('Pairing code');
      expect(s!.roles).toEqual(['relay']);
    } finally {
      await s?.close();
    }
  });

  it('says plainly when a Companion already holds the port, instead of a stack trace', async () => {
    const first: string[] = [];
    let running: Companion | undefined;
    expect(await main(['proxy', '--port', '0', '--config-dir', join(tmp.dir, 'busy1')], (l) => first.push(l), { noSignals: true, onStarted: (c) => (running = c) })).toBe(0);
    try {
      const port = Number(new URL(running!.url).port);
      const out: string[] = [];
      expect(await main(['proxy', '--port', String(port), '--config-dir', join(tmp.dir, 'busy2')], (l) => out.push(l), { noSignals: true })).toBe(2);
      const text = out.join('\n');
      expect(text).toContain(`A Companion is already running on http://127.0.0.1:${port} (version ${VERSION}, roles proxy, agent).`);
      expect(text).toContain('vitals-companion pair');
      expect(text).toContain(`--port ${port + 1}`);
      expect(text).not.toMatch(/EADDRINUSE|at Server/);
    } finally {
      await running?.close();
    }
  });

  it('siwc status reports signed-out without touching the network', async () => {
    const out: string[] = [];
    expect(await main(['siwc', 'status', '--config-dir', join(tmp.dir, 's')], (l) => out.push(l))).toBe(0);
    expect(out[0]).toContain('Not signed in');
  });
});
