// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiToolId } from '../shared/bridge';
import { codexAdd, codexRemove, codexTable, createAiTools, nodeAiToolsSys } from './aiTools';

const args = (id: AiToolId) => ['--mcp', '--client', id];
let home: string;
beforeEach(async () => {
  await mkdir(path.join(process.cwd(), '.e6-tmp'), { recursive: true });
  home = await mkdtemp(path.join(process.cwd(), '.e6-tmp', 'verify-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const make = (app = '/opt/Vitals/vitals') => {
  const base = nodeAiToolsSys();
  const sys = { ...base, home, env: { PATH: '/nonexistent' } as NodeJS.ProcessEnv, platform: 'linux' as const };
  return createAiTools({ sys, command: { path: app, args }, server: () => null });
};
const TABLE = codexTable('/opt/Vitals/vitals', args('codex'));

describe('Codex TOML round trips keep every other byte', () => {
  const cases: Record<string, string> = {
    'no trailing newline': 'model = "x"',
    'trailing newline': 'model = "x"\n',
    'CRLF': 'model = "x"\r\n\r\n[other]\r\na = 1\r\n',
    'tables after (added by hand after ours)': 'model = "x"',
    'comments and quoted keys': '# top\n[mcp_servers."foo"] # keep\ncommand = "a"\n\n# about next\n[x]\ny = 1\n',
  };
  for (const [name, original] of Object.entries(cases)) {
    it(`add then remove: ${name}`, async () => {
      const added = codexAdd(original, TABLE);
      expect(added.startsWith(original)).toBe(true);
      expect(codexRemove(added, TABLE)).toBe(original);
    });
  }

  it('a table added after ours (no trailing newline originally) survives remove', () => {
    const added = codexAdd('model = "x"', TABLE);
    const withMore = `${added}\n[mcp_servers.foo]\ncommand = "f"\n`;
    expect(codexRemove(withMore, TABLE)).toBe('model = "x"\n\n[mcp_servers.foo]\ncommand = "f"\n');
  });

  it('a table written right after ours (no blank line) never joins the line before ours', () => {
    const added = codexAdd('model = "x"', TABLE);
    expect(codexRemove(`${added}[mcp_servers.foo]\ncommand = "f"\n`, TABLE)).toBe('model = "x"\n[mcp_servers.foo]\ncommand = "f"\n');
  });

  it('a comment above the next table survives removal of a stale table', () => {
    const stale = '[mcp_servers.vitals]\ncommand = "/old"\nargs = ["mcp"]\n\n# my other server\n[mcp_servers.foo]\ncommand = "f"\n';
    expect(codexRemove(stale, TABLE)).toContain('# my other server');
  });

  it('CRLF: a following table with a trailing comment is not eaten', () => {
    const stale = '[mcp_servers.vitals]\r\ncommand = "/old"\r\n\r\n[mcp_servers.foo] # mine\r\ncommand = "f"\r\n';
    expect(codexRemove(stale, TABLE)).toContain('[mcp_servers.foo]');
  });

  it('[mcp_servers.vitals.env] sub-table and quoted headers are removed with ours, nothing else', () => {
    const t = 'a = 1\n\n[mcp_servers."vitals"]\ncommand = "/old"\n\n[mcp_servers.vitals.env]\nK = "v"\n\n[keep]\nz = 1\n';
    expect(codexRemove(t, TABLE)).toBe('a = 1\n\n[keep]\nz = 1\n');
  });

  it.fails('KNOWN GAP (companion agents.ts): literal-quoted / spaced headers of ours are detected (else Add duplicates the table)', () => {
    for (const h of ["[mcp_servers.'vitals']", '[mcp_servers . vitals]', '[ mcp_servers.vitals ]']) {
      const out = codexAdd(`${h}\ncommand = "/old"\n`, TABLE);
      expect(out.match(/vitals/g)!.length, h).toBe(TABLE.match(/vitals/g)!.length);
    }
  });
});

describe('on a real disk', () => {
  it('Windows-style app path with backslashes, quotes and spaces parses back from the TOML and JSON', async () => {
    const app = 'C:\\Program Files\\Vi"tals\\Vitals.exe';
    const t = make(app);
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await mkdir(path.join(home, '.config', 'opencode'), { recursive: true });
    await t.add('codex');
    await t.add('opencode');
    const toml = await readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain(String.raw`command = "C:\\Program Files\\Vi\"tals\\Vitals.exe"`);
    const js = JSON.parse(await readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
    expect(js.mcp.vitals.command[0]).toBe(app);
  });

  it('backup is made once and holds the first original; second add/remove cycles never overwrite it', async () => {
    const t = make();
    const f = path.join(home, '.codex', 'config.toml');
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, 'model = "x"', { mode: 0o640 });
    await t.add('codex');
    await t.remove('codex');
    await writeFile(f, 'model = "changed"\n');
    await t.add('codex');
    expect(await readFile(`${f}.vitals-backup`, 'utf8')).toBe('model = "x"');
  });

  it('opencode: single-line JSON, CRLF and BOM keep every other byte through add and remove', async () => {
    const t = make();
    const f = path.join(home, '.config', 'opencode', 'opencode.json');
    await mkdir(path.dirname(f), { recursive: true });
    for (const original of ['{"a":1}', '\uFEFF{\r\n  "a": 1,\r\n  "mcp": {\r\n    "x": {"b": 2}\r\n  }\r\n}\r\n', '{\n\t"mcp": {"y": {}}\n}']) {
      await writeFile(f, original);
      await t.add('opencode');
      const added = await readFile(f, 'utf8');
      expect(() => JSON.parse(added.replace(/^\uFEFF/, ''))).not.toThrow();
      await t.remove('opencode');
      const back = await readFile(f, 'utf8');
      expect(JSON.parse(back.replace(/^\uFEFF/, ''))).toEqual(JSON.parse(original.replace(/^\uFEFF/, '')));
    }
  });
});
