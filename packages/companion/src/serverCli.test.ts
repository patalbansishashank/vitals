// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPersonDir } from './personContext.ts';
import { runServerAiCli, type ServerCliIo } from './serverCli.ts';
import { nodeSys } from './sys.ts';

let root: string;
let dataDir: string;
let pcConfig: string;
let lines: string[];
const out = (l: string) => void lines.push(l);
const text = () => lines.join('\n');
const noCompanion: typeof fetch = async () => {
  throw new Error('refused');
};
const stdinOf = (s: string) => Readable.from([Buffer.from(s)]) as unknown as NodeJS.ReadStream;
const run = (argv: string[], io: ServerCliIo = {}) => runServerAiCli(argv, out, { fetch: noCompanion, err: () => undefined, ...io });
const mode = async (p: string) => (await stat(p)).mode & 0o777;

const tokens = (n: string) => ({ accessToken: `fake-access-${n}`, refreshToken: `fake-refresh-${n}`, expiresAt: Date.now() + 3_600_000, clientId: 'oaiapp_test1234' });

beforeEach(async () => {
  root = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'servercli-'));
  dataDir = join(root, 'data');
  pcConfig = join(root, 'pc-config');
  lines = [];
  await mkdir(pcConfig, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const seedSignIn = async (n = 'a') => writeFile(join(pcConfig, 'siwc.json'), JSON.stringify(tokens(n)), { mode: 0o600 });

describe('siwc export / import', () => {
  it('moves the sign-in out of the config dir into a 0600 file and prints no token', async () => {
    await seedSignIn();
    const file = join(root, 'move.json');
    expect(await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig])).toBe(0);
    expect(existsSync(join(pcConfig, 'siwc.json'))).toBe(false);
    expect(await mode(file)).toBe(0o600);
    expect(text()).toContain('removed from this computer');
    expect(text()).toContain('scp');
    expect(text()).toContain('vitals-server siwc import');
    expect(text()).not.toContain('fake-refresh');
    expect(text()).not.toContain('fake-access');
  });

  it('refuses when the export file already exists, and keeps the local sign-in', async () => {
    await seedSignIn();
    const file = join(root, 'move.json');
    await writeFile(file, 'x');
    expect(await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig])).toBe(1);
    expect(existsSync(join(pcConfig, 'siwc.json'))).toBe(true);
  });

  it('refuses while a Companion answers, unless --force; never touches port 4870', async () => {
    await seedSignIn();
    const file = join(root, 'move.json');
    const asked: string[] = [];
    const running: typeof fetch = async (u) => {
      asked.push(String(u));
      return new Response('{}', { status: 200 });
    };
    const io = { fetch: running, companionHealthUrl: 'http://127.0.0.1:1/health' };
    expect(await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig], io)).toBe(1);
    expect(text()).toContain('systemctl --user stop vitals-companion');
    expect(existsSync(join(pcConfig, 'siwc.json'))).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig, '--force'], io)).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(asked.every((u) => !u.includes('4870'))).toBe(true);
  });

  it('says so when there is no sign-in to move', async () => {
    expect(await run(['siwc', 'export', '--out', join(root, 'm.json'), '--config-dir', pcConfig])).toBe(1);
    expect(text()).toContain('no ChatGPT sign-in');
  });

  it('imports into a person, keeps the install id, deletes the file, refuses a second import without --force', async () => {
    await seedSignIn('one');
    const file = join(root, 'move.json');
    await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig]);
    const id = await createPersonDir(dataDir, 'Ada');
    const cred = join(dataDir, 'persons', id, 'credentials');
    await writeFile(join(cred, 'install.json'), JSON.stringify({ installId: 'install-keep-1' }), { mode: 0o600 });
    lines = [];
    expect(await run(['siwc', 'import', id, file, '--data-dir', dataDir])).toBe(0);
    expect(text()).toBe('Signed in with ChatGPT for Ada. The server now renews the session; the export file was deleted.');
    expect(existsSync(file)).toBe(false);
    expect(await mode(join(cred, 'siwc.json'))).toBe(0o600);
    const install = JSON.parse(await readFile(join(cred, 'install.json'), 'utf8'));
    expect(install.installId).toBe('install-keep-1');
    expect(install.siwcClientId).toBe('oaiapp_test1234');

    await seedSignIn('two');
    await run(['siwc', 'export', '--out', file, '--config-dir', pcConfig]);
    expect(await run(['siwc', 'import', id, file, '--data-dir', dataDir])).toBe(1);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(await readFile(join(cred, 'siwc.json'), 'utf8')).refreshToken).toBe('fake-refresh-one');
    expect(await run(['siwc', 'import', id, file, '--data-dir', dataDir, '--force'])).toBe(0);
    expect(JSON.parse(await readFile(join(cred, 'siwc.json'), 'utf8')).refreshToken).toBe('fake-refresh-two');
  });

  it('unknown person exits 1 with a plain message', async () => {
    await createPersonDir(dataDir, 'Ada');
    expect(await run(['siwc', 'import', '0123456789abcdef', join(root, 'x.json'), '--data-dir', dataDir])).toBe(1);
    expect(text()).toContain('There is no person 0123456789abcdef');
  });

  it('status and logout work per person', async () => {
    const id = await createPersonDir(dataDir, 'Ada');
    expect(await run(['siwc', 'status', id, '--data-dir', dataDir])).toBe(0);
    expect(text()).toContain('not signed in');
  });
});

describe('keys per person', () => {
  it('imports, lists and removes without crossing persons', async () => {
    const a = await createPersonDir(dataDir, 'Ada');
    const b = await createPersonDir(dataDir, 'Bo');
    const file = join(root, 'keys.json');
    await writeFile(file, JSON.stringify({ nim: 'nvapi-fake-key-12345', 'opencode-zen': 'zen-fake-key-12345', other: 'ignored-key-12345' }));
    expect(await run(['keys', 'import', a, file, '--data-dir', dataDir])).toBe(0);
    expect(text()).toContain('Imported 2 keys');
    expect(text()).not.toContain('fake-key');
    const providers = join(dataDir, 'persons', a, 'credentials', 'providers.json');
    expect(await mode(providers)).toBe(0o600);
    expect(existsSync(join(dataDir, 'persons', b, 'credentials', 'providers.json'))).toBe(false);

    lines = [];
    await run(['keys', 'list', a, '--data-dir', dataDir]);
    expect(text()).toMatch(/nim\s+configured/);
    lines = [];
    await run(['keys', 'list', b, '--data-dir', dataDir]);
    expect(text()).toMatch(/nim\s+not configured/);

    expect(await run(['keys', 'set', b, 'nim', '--data-dir', dataDir], { stdin: stdinOf('nvapi-bo-key-98765\n') })).toBe(0);
    expect(await run(['keys', 'remove', a, 'nim', '--data-dir', dataDir])).toBe(0);
    lines = [];
    await run(['keys', 'list', a, '--data-dir', dataDir]);
    expect(text()).toMatch(/nim\s+not configured/);
    expect(text()).toMatch(/opencode-zen\s+configured/);
    lines = [];
    await run(['keys', 'list', b, '--data-dir', dataDir]);
    expect(text()).toMatch(/nim\s+configured/);
    expect(text()).not.toContain('bo-key');
  });

  it('imports a keys file from stdin and rejects junk', async () => {
    const a = await createPersonDir(dataDir, 'Ada');
    expect(await run(['keys', 'import', a, '--data-dir', dataDir], { stdin: stdinOf('{"nim":"nvapi-stdin-key-1"}') })).toBe(0);
    expect(await run(['keys', 'import', a, '--data-dir', dataDir], { stdin: stdinOf('nope') })).toBe(1);
  });
});

describe('agent-token', () => {
  it('creates once, lists without a hash, revokes', async () => {
    const id = await createPersonDir(dataDir, 'Ada');
    expect(await run(['agent-token', 'create', id, '--client', 'codex', '--scope', 'log', '--label', 'Laptop', '--url', 'https://vitals.example.ts.net:8443', '--data-dir', dataDir])).toBe(0);
    const token = lines.find((l) => /^[A-Za-z0-9_-]{40,}$/.test(l))!;
    expect(token).toBeTruthy();
    expect(lines.filter((l) => l.includes(token))).toHaveLength(1);
    expect(text()).toContain('https://vitals.example.ts.net:8443/mcp');
    lines = [];
    await run(['agent-token', 'list', id, '--data-dir', dataDir]);
    expect(text()).toContain('codex');
    expect(text()).toContain('Laptop');
    expect(text()).toContain('log');
    expect(text()).not.toContain(token);
    const devices = JSON.parse(await readFile(join(dataDir, 'persons', id, 'devices.json'), 'utf8'));
    expect(text()).not.toContain(devices[0].hash);
    const tid = devices[0].id as string;
    lines = [];
    expect(await run(['agent-token', 'revoke', id, tid, '--data-dir', dataDir])).toBe(0);
    expect(await run(['agent-token', 'revoke', id, tid, '--data-dir', dataDir])).toBe(1);
    lines = [];
    await run(['agent-token', 'list', id, '--data-dir', dataDir]);
    expect(text()).toContain('no agent tokens');
  });

  it('rejects a missing client with exit 2', async () => {
    const id = await createPersonDir(dataDir, 'Ada');
    expect(await run(['agent-token', 'create', id, '--data-dir', dataDir])).toBe(2);
  });
});

describe('agents register --remote', () => {
  const sysAt = (env: NodeJS.ProcessEnv = {}) => ({ ...nodeSys(), home: root, env: { ...env } });
  const URL_ = 'https://vitals.example.ts.net:8443';

  it('codex writes the url and the env var name, never a token', async () => {
    expect(await run(['agents', 'register', 'codex', '--remote', URL_], { sys: sysAt() })).toBe(0);
    const toml = await readFile(join(root, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('https://vitals.example.ts.net:8443/mcp');
    expect(toml).toContain('bearer_token_env_var');
    expect(toml).toContain('VITALS_TOKEN');
  });

  it('opencode writes a remote entry with {env:VITALS_TOKEN}', async () => {
    expect(await run(['agents', 'register', 'opencode', '--remote', URL_], { sys: sysAt() })).toBe(0);
    const cfg = JSON.parse(await readFile(join(root, '.config', 'opencode', 'opencode.json'), 'utf8'));
    expect(cfg.mcp.vitals.type).toBe('remote');
    expect(cfg.mcp.vitals.headers.Authorization).toBe('Bearer {env:VITALS_TOKEN}');
  });

  it('claude --dry-run prints the command with $VITALS_TOKEN', async () => {
    expect(await run(['agents', 'register', 'claude', '--remote', URL_, '--dry-run'], { sys: sysAt() })).toBe(0);
    expect(text()).toContain('claude mcp add');
    expect(text()).toContain('$VITALS_TOKEN');
  });

  it('chatgpt explains it is not available (exit 1) and a bad url is exit 1', async () => {
    expect(await run(['agents', 'register', 'chatgpt', '--remote', URL_], { sys: sysAt() })).toBe(1);
    expect(await run(['agents', 'register', 'codex', '--remote', 'http://example.com'], { sys: sysAt() })).toBe(1);
  });
});

describe('routing', () => {
  it('leaves the old commands to cli.ts', async () => {
    const calls = [
      ['keys', 'set', 'nim'],
      ['keys', 'list'],
      ['keys', 'import', 'opencode-zen'],
      ['siwc', 'status'],
      ['siwc', 'login'],
      ['siwc', 'logout', '--config-dir', pcConfig],
      ['agents', 'register', 'codex'],
      ['agents', 'status'],
      ['doctor'],
    ];
    for (const argv of calls) expect(await run(argv)).toBeNull();
    expect(lines).toEqual([]);
  });
});
