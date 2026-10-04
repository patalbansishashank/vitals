// @vitest-environment node
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHATGPT_METADATA } from '../../../../packages/companion/src/agents.ts';
import { nodeSys, type RunResult, type Sys } from '../../../../packages/companion/src/sys.ts';
import type { AiToolId, McpServerInfo } from '../shared/bridge';
import { codexTable, createAiTools, nodeAiToolsSys } from './aiTools';

const argsFor = (id: AiToolId) => ['--mcp', '--client', id];
const APP = '/opt/Vitals/vitals';

/** An in-memory computer: files, folders and recorded program runs. */
function memSys(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv = {}, onRun?: (cmd: string, args: string[]) => RunResult) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const files = new Map<string, { data: string; mode: number }>();
  const dirs = new Set<string>();
  const parents = (p: string) => {
    for (let d = P.dirname(p); !dirs.has(d); d = P.dirname(d)) {
      dirs.add(d);
      if (P.dirname(d) === d) break;
    }
  };
  const runs: string[][] = [];
  const writes: string[] = [];
  const sys: Sys = {
    env,
    home,
    platform,
    nodeVersion: '26.0.0',
    execPath: '/usr/bin/node',
    run: async (cmd, args) => {
      runs.push([cmd, ...args]);
      return onRun?.(cmd, args) ?? { code: 0, stdout: '', stderr: '' };
    },
    which: () => Promise.reject(new Error('aiTools looks programs up itself')),
    fetchJson: async () => ({ ok: false }),
    readText: async (p) => files.get(p)?.data ?? null,
    stat: async (p) => (files.has(p) ? { mode: files.get(p)!.mode, isDir: false } : dirs.has(p) ? { mode: 0o755, isDir: true } : null),
    portFree: async () => true,
    writeText: async (p, data, mode) => {
      parents(p);
      writes.push(p);
      files.set(p, { data, mode });
    },
    mkdir: async (p) => {
      parents(p);
      dirs.add(p);
    },
    copy: async (from, to) => {
      if (files.has(to)) throw new Error('EEXIST');
      files.set(to, { ...files.get(from)! });
    },
    now: () => new Date(0),
  };
  const put = (p: string, data: string, mode = 0o644) => {
    parents(p);
    files.set(p, { data, mode });
  };
  const dir = (p: string) => {
    parents(p);
    dirs.add(p);
  };
  const text = (p: string) => files.get(p)?.data;
  return { sys, files, put, dir, runs, writes, text };
}

const tools = (sys: Sys, o: { app?: string; server?: McpServerInfo | null; readDir?: (d: string) => Promise<string[]> } = {}) =>
  createAiTools({ sys, command: { path: o.app ?? APP, args: argsFor }, server: () => o.server ?? null, readDir: o.readDir });

const row = async (t: ReturnType<typeof tools>, id: AiToolId) => (await t.list()).find((r) => r.id === id)!;

describe('where each tool lives', () => {
  it('Linux: Codex in ~/.codex (or CODEX_HOME), OpenCode in XDG config, Claude Code in ~/.claude.json, ChatGPT shares Codex', async () => {
    const m = memSys('linux', '/home/p', { PATH: '/usr/bin' });
    m.dir('/home/p/.codex');
    m.put('/home/p/.local/bin/claude', '#!', 0o755);
    m.put('/home/p/.opencode/bin/opencode', '#!', 0o755);
    m.put(CHATGPT_METADATA, '{}');
    const rows = await tools(m.sys).list();
    expect(rows.map((r) => [r.id, r.found, r.file, r.canAdd])).toEqual([
      ['claude-code', true, '/home/p/.claude.json', true],
      ['codex', true, '/home/p/.codex/config.toml', true],
      ['opencode', true, '/home/p/.config/opencode/opencode.json', true],
      ['chatgpt-desktop', true, '/home/p/.codex/config.toml', true],
    ]);
    expect(rows[3]!.note).toBe('Uses the same settings file as Codex; restart ChatGPT after adding.');
    expect(rows[3]!.preview).toBe(rows[1]!.preview);
    // not on PATH: the preview names the full path so it can be pasted
    expect(rows[0]!.preview).toBe('/home/p/.local/bin/claude mcp add -s user vitals -- /opt/Vitals/vitals --mcp --client claude-code');

    const m2 = memSys('linux', '/home/p', { PATH: '/usr/bin:/home/p/.local/bin', CODEX_HOME: '/data/codex', XDG_CONFIG_HOME: '/data/cfg' });
    m2.put('/home/p/.local/bin/claude', '#!', 0o755);
    m2.dir('/data/codex');
    const rows2 = await tools(m2.sys).list();
    expect(rows2[0]!.preview).toBe('claude mcp add -s user vitals -- /opt/Vitals/vitals --mcp --client claude-code');
    expect(rows2[1]).toMatchObject({ found: true, file: '/data/codex/config.toml' });
    expect(rows2[2]).toMatchObject({ found: false, canAdd: false, file: '/data/cfg/opencode/opencode.json', note: 'Not found on this computer.' });
    expect(rows2[3]).toMatchObject({ found: false, canAdd: false });
  });

  it('a program without the execute bit, or a folder, is not a program', async () => {
    const m = memSys('linux', '/home/p', { PATH: '/usr/bin' });
    m.put('/usr/bin/claude', 'text', 0o644);
    m.dir('/home/p/.local/bin/codex');
    const rows = await tools(m.sys).list();
    expect(rows[0]!.found).toBe(false);
    expect(rows[1]!.found).toBe(false);
  });

  it('Windows: %USERPROFILE%\\.codex, %USERPROFILE%\\.config\\opencode, npm .cmd shims, ChatGPT is remote only', async () => {
    const home = 'C:\\Users\\P Q';
    const env = { Path: 'C:\\Windows;C:\\Windows\\System32', APPDATA: `${home}\\AppData\\Roaming`, LOCALAPPDATA: `${home}\\AppData\\Local` };
    const m = memSys('win32', home, env);
    m.put(`${home}\\AppData\\Roaming\\npm\\claude.cmd`, '@echo off');
    m.put(`${home}\\AppData\\Roaming\\npm\\codex.cmd`, '@echo off');
    m.put(`${home}\\.opencode\\bin\\opencode.exe`, 'MZ');
    m.dir(`${home}\\AppData\\Local\\Programs\\ChatGPT`);
    const app = 'C:\\Program Files\\Vitals\\Vitals.exe';
    const rows = await tools(m.sys, { app, server: { mcpUrl: 'https://vitals.example/mcp' } }).list();
    expect(rows.map((r) => [r.found, r.file])).toEqual([
      [true, `${home}\\.claude.json`],
      [true, `${home}\\.codex\\config.toml`],
      [true, `${home}\\.config\\opencode\\opencode.json`],
      [true, undefined],
    ]);
    expect(rows[0]!.preview).toBe(`"${home}\\AppData\\Roaming\\npm\\claude.cmd" mcp add -s user vitals -- "${app}" --mcp --client claude-code`);
    expect(rows[1]!.preview).toContain('command = "C:\\\\Program Files\\\\Vitals\\\\Vitals.exe"\n');
    expect(rows[3]).toMatchObject({ canAdd: false, added: false, note: "Add this address in ChatGPT's settings: https://vitals.example/mcp, with a key from Settings › Agents" });
    await expect(tools(m.sys).add('chatgpt-desktop')).rejects.toThrow('Needs your Vitals server');
  });

  it('Windows: claude.exe on Path (any case) is "claude"; the Store ChatGPT package is found', async () => {
    const home = 'C:\\Users\\p';
    const m = memSys('win32', home, { PATH: `"${home}\\.local\\bin";C:\\Windows` });
    m.put(`${home}\\.local\\bin\\claude.exe`, 'MZ');
    m.dir(`${home}\\AppData\\Local\\Packages\\OpenAI.ChatGPT-Desktop_abc`);
    const t = tools(m.sys, { readDir: async () => ['Microsoft.Foo_1', 'OpenAI.ChatGPT-Desktop_abc'] });
    const rows = await t.list();
    expect(rows[0]!.preview!.startsWith('claude mcp add')).toBe(true);
    expect(rows[3]).toMatchObject({ found: true, canAdd: false, note: 'Needs your Vitals server' });
    expect(rows[1]).toMatchObject({ found: false, note: 'Not found on this computer.' });
  });

  it('Windows: CODEX_HOME and XDG_CONFIG_HOME are honoured', async () => {
    const m = memSys('win32', 'C:\\Users\\p', { CODEX_HOME: 'D:\\codex', XDG_CONFIG_HOME: 'D:\\cfg' });
    const rows = await tools(m.sys).list();
    expect(rows[1]!.file).toBe('D:\\codex\\config.toml');
    expect(rows[2]!.file).toBe('D:\\cfg\\opencode\\opencode.json');
  });

  it('macOS: Homebrew and app bundles; ChatGPT is remote only', async () => {
    const m = memSys('darwin', '/Users/p', { PATH: '/usr/bin:/bin' });
    m.put('/opt/homebrew/bin/codex', '#!', 0o755);
    m.put('/opt/homebrew/bin/opencode', '#!', 0o755);
    m.put('/Users/p/.claude.json', '{}');
    m.dir('/Users/p/Applications/ChatGPT.app');
    const rows = await tools(m.sys).list();
    expect(rows.map((r) => [r.found, r.canAdd, r.file])).toEqual([
      [true, false, '/Users/p/.claude.json'],
      [true, true, '/Users/p/.codex/config.toml'],
      [true, true, '/Users/p/.config/opencode/opencode.json'],
      [true, false, undefined],
    ]);
    expect(rows[0]!.note).toBe("Claude Code's command (claude) was not found; run this line in a terminal.");
    expect(rows[0]!.preview).toBe('claude mcp add -s user vitals -- /opt/Vitals/vitals --mcp --client claude-code');
    expect(rows[3]!.note).toBe('Needs your Vitals server');
    await expect(tools(m.sys).add('claude-code')).rejects.toThrow("run this line in a terminal");
  });
});

describe('Codex', () => {
  const FILE = '/home/p/.codex/config.toml';
  const setup = () => {
    const m = memSys('linux', '/home/p', {});
    m.dir('/home/p/.codex');
    return m;
  };

  it('the table runs the app with the Codex client id', () => {
    expect(codexTable(APP, argsFor('codex'))).toBe(
      [
        '[mcp_servers.vitals]',
        'command = "/opt/Vitals/vitals"',
        'args = ["--mcp", "--client", "codex"]',
        'startup_timeout_sec = 30',
        'tool_timeout_sec = 60',
        '# Vitals never offers destructive tools and stages plan changes as proposals you approve, so calls need no prompt.',
        'default_tools_approval_mode = "approve"',
        '',
      ].join('\n'),
    );
  });

  it('add on a missing file creates it (0600) and its folder with exactly the preview; no backup', async () => {
    const m = memSys('linux', '/home/p', { PATH: '/bin' });
    m.put('/bin/codex', '#!', 0o755);
    const t = tools(m.sys);
    const before = await row(t, 'codex');
    expect(before).toMatchObject({ found: true, added: false });
    const after = await t.add('codex');
    expect(after).toMatchObject({ added: true, note: undefined });
    expect(m.text(FILE)).toBe(before.preview);
    expect(m.files.get(FILE)!.mode).toBe(0o600);
    expect(m.files.has(`${FILE}.vitals-backup`)).toBe(false);
    await t.remove('codex');
    expect(m.text(FILE)).toBe('');
  });

  it.each([
    ['ends with a line break', 'model = "o5"\n\n[profiles.x]\nmodel = "o5-mini"\n'],
    ['has no final line break', 'model = "o5"'],
    ['has Windows line breaks and blank runs', 'model = "o5"\r\n\r\n\r\n[a]\r\nb = 1\r\n'],
  ])('add keeps every other byte, backs up once, keeps the mode; remove restores it (file %s)', async (_, original) => {
    const m = setup();
    m.put(FILE, original, 0o640);
    const t = tools(m.sys);
    const preview = (await row(t, 'codex')).preview!;
    await t.add('codex');
    const added = m.text(FILE)!;
    expect(added).toBe(`${original}\n${preview}`);
    expect(m.files.get(FILE)!.mode).toBe(0o640);
    expect(m.text(`${FILE}.vitals-backup`)).toBe(original);

    m.writes.length = 0;
    await t.add('codex'); // twice: no change
    expect(m.writes).toEqual([]);
    expect(m.text(FILE)).toBe(added);

    expect((await t.remove('codex')).added).toBe(false);
    expect(m.text(FILE)).toBe(original);
    m.writes.length = 0;
    expect((await t.remove('codex')).added).toBe(false); // remove when absent
    expect(m.writes).toEqual([]);

    // a later add/remove keeps the first backup
    m.put(FILE, 'changed = true\n', 0o640);
    await t.add('codex');
    expect(m.text(`${FILE}.vitals-backup`)).toBe(original);
  });

  it('an entry for another copy of Vitals (or a hand-edited one) is replaced; its sub-tables go too, the rest stays', async () => {
    const m = setup();
    const original = [
      'model = "o5"',
      '',
      '[mcp_servers.vitals]',
      'command = "/old/vitals-companion"',
      'args = ["mcp"]',
      '',
      '[mcp_servers.vitals.env]',
      'X = "1"',
      '',
      '',
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
    ].join('\n');
    m.put(FILE, original);
    const t = tools(m.sys);
    const r = await row(t, 'codex');
    expect(r).toMatchObject({ added: true, canAdd: true, note: 'Points to another copy of Vitals; Add updates it.' });
    await t.add('codex');
    const kept = 'model = "o5"\n\n\n\n[mcp_servers.other]\ncommand = "other"\n';
    expect(m.text(FILE)).toBe(`${kept}\n${r.preview}`);
    expect((await row(t, 'codex')).note).toBeUndefined();
    await t.remove('codex');
    expect(m.text(FILE)).toBe(kept);
  });

  it('extra keys a person added inside our table make it "another copy", and are not orphaned on remove', async () => {
    const m = setup();
    const table = codexTable(APP, argsFor('codex'));
    m.put(FILE, `a = 1\n\n${table}env_vars = ["X"]\n\n[b]\nc = 2\n`);
    const t = tools(m.sys);
    expect((await row(t, 'codex')).note).toBe('Points to another copy of Vitals; Add updates it.');
    await t.remove('codex');
    expect(m.text(FILE)).toBe('a = 1\n\n[b]\nc = 2\n');
  });

  it('spaces, quotes and backslashes in the app path are escaped as TOML strings', async () => {
    const m = setup();
    const app = '/home/p/My "Vitals" App/v\\1 ü';
    const t = tools(m.sys, { app });
    await t.add('codex');
    const text = m.text(FILE)!;
    const command = /^command = (.*)$/m.exec(text)![1]!;
    const args = /^args = (.*)$/m.exec(text)![1]!;
    expect(command).toBe('"/home/p/My \\"Vitals\\" App/v\\\\1 ü"');
    expect(JSON.parse(command)).toBe(app); // a TOML basic string with these escapes reads like a JSON string
    expect(JSON.parse(args)).toEqual(['--mcp', '--client', 'codex']);
  });

  it('CODEX_HOME is honoured for the file and for detection', async () => {
    const m = memSys('linux', '/home/p', { CODEX_HOME: '/srv/codex' });
    m.dir('/srv/codex');
    const t = tools(m.sys);
    await t.add('codex');
    expect(m.text('/srv/codex/config.toml')).toBe((await row(t, 'codex')).preview);
    expect(m.files.has(FILE)).toBe(false);
  });

  it('not found: add refuses in plain words, nothing is written', async () => {
    const m = memSys('linux', '/home/p', {});
    await expect(tools(m.sys).add('codex')).rejects.toThrow('Codex was not found on this computer.');
    expect(m.writes).toEqual([]);
  });

  it('ChatGPT on Linux adds and removes the same Codex table', async () => {
    const m = setup();
    m.put(CHATGPT_METADATA, '{"version":"1.0"}');
    const t = tools(m.sys);
    expect(await t.add('chatgpt-desktop')).toMatchObject({ added: true, file: FILE });
    expect((await row(t, 'codex')).added).toBe(true);
    m.writes.length = 0;
    await t.add('codex'); // same table: nothing to do
    expect(m.writes).toEqual([]);
    expect((await t.remove('chatgpt-desktop')).added).toBe(false);
    expect((await row(t, 'codex')).added).toBe(false);
  });
});

describe('OpenCode', () => {
  const DIR = '/home/p/.config/opencode';
  const FILE = `${DIR}/opencode.json`;
  const entry = (app = APP) => ({ type: 'local', command: [app, '--mcp', '--client', 'opencode'], enabled: true, timeout: 30000 });
  const setup = () => {
    const m = memSys('linux', '/home/p', {});
    m.dir(DIR);
    return m;
  };

  it('add on a missing file writes exactly the preview: a new config with the entry', async () => {
    const m = setup();
    const t = tools(m.sys);
    const r = await row(t, 'opencode');
    expect(r).toMatchObject({ found: true, added: false, canAdd: true, file: FILE });
    await t.add('opencode');
    expect(m.text(FILE)).toBe(r.preview);
    expect(JSON.parse(m.text(FILE)!)).toEqual({ $schema: 'https://opencode.ai/config.json', mcp: { vitals: entry() } });
    expect(m.files.get(FILE)!.mode).toBe(0o600);
  });

  it('adds "mcp" to a config without one, byte for byte; backs up once; keeps the mode; remove restores it', async () => {
    const m = setup();
    const original = '{\n    "$schema": "https://opencode.ai/config.json",\n    "theme": "opencode"\n}\n';
    m.put(FILE, original, 0o640);
    const t = tools(m.sys);
    const r = await row(t, 'opencode');
    expect(r.preview).toBe(
      [
        '    "mcp": {',
        '        "vitals": {',
        '            "type": "local",',
        '            "command": [',
        '                "/opt/Vitals/vitals",',
        '                "--mcp",',
        '                "--client",',
        '                "opencode"',
        '            ],',
        '            "enabled": true,',
        '            "timeout": 30000',
        '        }',
        '    }',
      ].join('\n'),
    );
    await t.add('opencode');
    const at = original.indexOf('"opencode"') + '"opencode"'.length;
    expect(m.text(FILE)).toBe(`${original.slice(0, at)},\n${r.preview}${original.slice(at)}`);
    expect(JSON.parse(m.text(FILE)!).mcp).toEqual({ vitals: entry() });
    expect(m.text(`${FILE}.vitals-backup`)).toBe(original);
    expect(m.files.get(FILE)!.mode).toBe(0o640);

    m.writes.length = 0;
    expect(await t.add('opencode')).toMatchObject({ added: true, note: undefined });
    expect(m.writes).toEqual([]);

    await t.remove('opencode');
    expect(m.text(FILE)).toBe(original);
    m.writes.length = 0;
    await t.remove('opencode');
    expect(m.writes).toEqual([]);
  });

  it('adds under an existing "mcp" next to other servers (tabs kept); remove takes only ours', async () => {
    const m = setup();
    const original = '{\n\t"mcp": {\n\t\t"other": { "type": "remote", "url": "https://x.example/mcp" }\n\t},\n\t"model": "m"\n}';
    m.put(FILE, original);
    const t = tools(m.sys);
    const r = await row(t, 'opencode');
    expect(r.preview!.startsWith('\t\t"vitals": {\n\t\t\t"type": "local",')).toBe(true);
    await t.add('opencode');
    const at = original.indexOf('}') + 1;
    expect(m.text(FILE)).toBe(`${original.slice(0, at)},\n${r.preview}${original.slice(at)}`);
    expect(Object.keys(JSON.parse(m.text(FILE)!).mcp)).toEqual(['other', 'vitals']);
    await t.remove('opencode');
    expect(m.text(FILE)).toBe(original);
  });

  it('ours first among other servers, and an empty object, are removed cleanly', async () => {
    const m = setup();
    const t = tools(m.sys);
    m.put(FILE, `{"mcp": {"vitals": ${JSON.stringify(entry())}, "b": {"type": "local", "command": ["b"]}}, "x": [1, {"y": "}"}]}`);
    await t.remove('opencode');
    expect(m.text(FILE)).toBe('{"mcp": {"b": {"type": "local", "command": ["b"]}}, "x": [1, {"y": "}"}]}');
    m.put(FILE, '{}');
    await t.add('opencode');
    expect(JSON.parse(m.text(FILE)!)).toEqual({ mcp: { vitals: entry() } });
    await t.remove('opencode');
    expect(m.text(FILE)).toBe('{}');
  });

  it('an entry for another copy of Vitals is replaced', async () => {
    const m = setup();
    m.put(FILE, JSON.stringify({ mcp: { vitals: entry('/old/vitals') } }, null, 2));
    const t = tools(m.sys);
    expect((await row(t, 'opencode')).note).toBe('Points to another copy of Vitals; Add updates it.');
    await t.add('opencode');
    expect(JSON.parse(m.text(FILE)!)).toEqual({ mcp: { vitals: entry() } });
    expect((await row(t, 'opencode')).note).toBeUndefined();
  });

  it('spaces, quotes and backslashes in the app path are escaped as JSON', async () => {
    const m = setup();
    const app = 'C:\\Users\\P Q\\Vitals "beta"\\Vitals.exe';
    const t = tools(m.sys, { app });
    m.put(FILE, '{"a": 1}');
    const r = await row(t, 'opencode');
    await t.add('opencode');
    expect(m.text(FILE)).toBe(`{"a": 1,\n${r.preview}}`);
    expect(JSON.parse(m.text(FILE)!).mcp.vitals.command[0]).toBe(app);
  });

  it('an opencode.jsonc with comments is never rewritten: no Add, a note, the entry to paste', async () => {
    const m = setup();
    const original = '{\n  // my settings\n  "mcp": {\n    "vitals": { "type": "local", "command": ["x"], }, /* mine */\n  },\n}\n';
    m.put(`${DIR}/opencode.jsonc`, original);
    const t = tools(m.sys);
    const r = await row(t, 'opencode');
    expect(r).toMatchObject({ file: `${DIR}/opencode.jsonc`, added: true, canAdd: false });
    expect(r.note).toBe('This file has comments or is not plain JSON, so Vitals leaves it alone; put the entry under "mcp" by hand.');
    expect(JSON.parse(`{${r.preview}}`)).toEqual({ vitals: entry() });
    await expect(t.add('opencode')).rejects.toThrow('put the entry under "mcp" by hand');
    await expect(t.remove('opencode')).rejects.toThrow('remove the "vitals" entry by hand');
    expect(m.text(`${DIR}/opencode.jsonc`)).toBe(original);
    expect(m.writes).toEqual([]);
  });

  it('a plain-JSON opencode.jsonc is edited; opencode.json wins when both exist', async () => {
    const m = setup();
    m.put(`${DIR}/opencode.jsonc`, '{"a": 1}\n');
    const t = tools(m.sys);
    await t.add('opencode');
    expect(JSON.parse(m.text(`${DIR}/opencode.jsonc`)!).mcp.vitals).toEqual(entry());
    m.put(FILE, '{}');
    expect((await row(t, 'opencode')).file).toBe(FILE);
  });

  it('"mcp" that is not an object is refused', async () => {
    const m = setup();
    m.put(FILE, '{"mcp": true}');
    const t = tools(m.sys);
    expect((await row(t, 'opencode')).canAdd).toBe(false);
    await expect(t.add('opencode')).rejects.toThrow('not laid out as Vitals expects');
  });
});

describe('Claude Code', () => {
  const CLAUDE = '/home/p/.local/bin/claude';
  const FILE = '/home/p/.claude.json';
  /** A pretend `claude` CLI that edits the in-memory ~/.claude.json. */
  const setup = (fail = false) => {
    const m = memSys('linux', '/home/p', { PATH: '/home/p/.local/bin' }, (_cmd, a) => {
      if (fail) return { code: 1, stdout: '', stderr: 'MCP server vitals already exists\nmore' };
      const cfg = JSON.parse(m.text(FILE) ?? '{}');
      cfg.mcpServers ??= {};
      if (a[1] === 'add') cfg.mcpServers[a[4]!] = { type: 'stdio', command: a[6], args: a.slice(7), env: {} };
      else delete cfg.mcpServers[a[2]!];
      m.put(FILE, JSON.stringify(cfg));
      return { code: 0, stdout: '', stderr: '' };
    });
    m.put(CLAUDE, '#!', 0o755);
    return m;
  };

  it('add runs exactly the previewed command; twice does nothing; remove runs claude mcp remove', async () => {
    const m = setup();
    m.put(FILE, '{"numStartups": 3}');
    const app = "/home/p/Apps/Vitals 'beta'.AppImage";
    const t = tools(m.sys, { app });
    const r = await row(t, 'claude-code');
    expect(r).toMatchObject({ found: true, added: false, canAdd: true, file: FILE });
    expect(r.preview).toBe(`claude mcp add -s user vitals -- '/home/p/Apps/Vitals '\\''beta'\\''.AppImage' --mcp --client claude-code`);
    expect(await t.add('claude-code')).toMatchObject({ added: true, note: undefined });
    expect(m.runs).toEqual([[CLAUDE, 'mcp', 'add', '-s', 'user', 'vitals', '--', app, '--mcp', '--client', 'claude-code']]);
    expect(m.text(`${FILE}.vitals-backup`)).toBe('{"numStartups": 3}');
    await t.add('claude-code');
    expect(m.runs).toHaveLength(1);
    expect(await t.remove('claude-code')).toMatchObject({ added: false });
    expect(m.runs[1]).toEqual([CLAUDE, 'mcp', 'remove', 'vitals', '-s', 'user']);
    await t.remove('claude-code');
    expect(m.runs).toHaveLength(2);
  });

  it('an entry for another copy is replaced (remove, then add)', async () => {
    const m = setup();
    m.put(FILE, JSON.stringify({ mcpServers: { vitals: { command: '/old/vitals', args: ['--mcp'] } } }));
    const t = tools(m.sys);
    expect((await row(t, 'claude-code')).note).toBe('Points to another copy of Vitals; Add updates it.');
    await t.add('claude-code');
    expect(m.runs.map((r) => r[2])).toEqual(['remove', 'add']);
    expect((await row(t, 'claude-code')).note).toBeUndefined();
  });

  it('the CLI failing becomes a plain error', async () => {
    const m = setup(true);
    await expect(tools(m.sys).add('claude-code')).rejects.toThrow('Claude Code could not add Vitals: MCP server vitals already exists');
  });

  it('not installed at all', async () => {
    const m = memSys('linux', '/home/p', { PATH: '/usr/bin' });
    const r = await row(tools(m.sys), 'claude-code');
    expect(r).toMatchObject({ found: false, added: false, canAdd: false, note: 'Not found on this computer.' });
    await expect(tools(m.sys).add('claude-code')).rejects.toThrow('Claude Code was not found on this computer.');
  });

  it('CLAUDE_CONFIG_DIR moves the file it reads', async () => {
    const m = memSys('linux', '/home/p', { CLAUDE_CONFIG_DIR: '/home/p/.claude-alt' });
    m.put('/home/p/.claude-alt/.claude.json', JSON.stringify({ mcpServers: { vitals: { command: APP, args: argsFor('claude-code') } } }));
    expect(await row(tools(m.sys), 'claude-code')).toMatchObject({ found: true, added: true, file: '/home/p/.claude-alt/.claude.json' });
  });
});

describe('on a real disk (temp HOME, fake claude)', () => {
  const base = path.resolve(process.cwd(), '.e6-tmp');
  let tmp: string;
  let home: string;
  let sys: Sys;
  beforeEach(async () => {
    await mkdir(base, { recursive: true });
    tmp = await mkdtemp(path.join(base, 'aitools-'));
    home = path.join(tmp, 'home');
    const bin = path.join(tmp, 'bin');
    await mkdir(home);
    await mkdir(bin);
    const script = path.join(tmp, 'fake-claude.cjs');
    await writeFile(
      script,
      `const fs = require('fs');
const file = ${JSON.stringify(path.join(home, '.claude.json'))};
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(tmp, 'claude-args.log'))}, JSON.stringify(a) + '\\n');
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
cfg.mcpServers = cfg.mcpServers || {};
if (a[1] === 'add') { const i = a.indexOf('--'); cfg.mcpServers[a[i - 1]] = { type: 'stdio', command: a[i + 1], args: a.slice(i + 2), env: {} }; }
else if (a[1] === 'remove' && cfg.mcpServers[a[2]]) delete cfg.mcpServers[a[2]];
else { console.error('No MCP server found with name: ' + a[2]); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
`,
    );
    await writeFile(path.join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
    await chmod(path.join(bin, 'claude'), 0o755);
    sys = { ...nodeAiToolsSys(nodeSys()), home, env: { HOME: home, PATH: bin } };
  });
  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('Codex: bytes, mode, single backup, remove; a symlinked config stays a symlink', async () => {
    const real = path.join(tmp, 'dotfiles', 'config.toml');
    await mkdir(path.dirname(real));
    await mkdir(path.join(home, '.codex'));
    const original = '# mine\nmodel = "o5"\n';
    await writeFile(real, original, { mode: 0o640 });
    await chmod(real, 0o640);
    const file = path.join(home, '.codex', 'config.toml');
    await symlink(real, file);
    const t = tools(sys);
    const r = (await t.list()).find((x) => x.id === 'codex')!;
    await t.add('codex');
    expect(await readFile(real, 'utf8')).toBe(`${original}\n${r.preview}`);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect((await stat(real)).mode & 0o777).toBe(0o640);
    expect(await readFile(`${file}.vitals-backup`, 'utf8')).toBe(original);
    await t.remove('codex');
    expect(await readFile(real, 'utf8')).toBe(original);
  });

  it('OpenCode: a missing folder and file are created, 0600', async () => {
    const t = tools(sys);
    await mkdir(path.join(home, '.opencode', 'bin'), { recursive: true });
    await writeFile(path.join(home, '.opencode', 'bin', 'opencode'), '', { mode: 0o755 });
    const r = (await t.list()).find((x) => x.id === 'opencode')!;
    expect(r.found).toBe(true);
    await t.add('opencode');
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    expect(await readFile(file, 'utf8')).toBe(r.preview);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('Claude Code: the fake CLI gets the exact arguments (spaces and quotes) and edits the temp ~/.claude.json', async () => {
    const app = path.join(tmp, 'My "Vitals" App', 'vitals');
    const t = tools(sys, { app });
    expect(await t.add('claude-code')).toMatchObject({ found: true, added: true });
    const cfg = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8'));
    expect(cfg.mcpServers.vitals).toMatchObject({ command: app, args: ['--mcp', '--client', 'claude-code'] });
    expect(await t.remove('claude-code')).toMatchObject({ added: false });
    const log = (await readFile(path.join(tmp, 'claude-args.log'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(log).toEqual([
      ['mcp', 'add', '-s', 'user', 'vitals', '--', app, '--mcp', '--client', 'claude-code'],
      ['mcp', 'remove', 'vitals', '-s', 'user'],
    ]);
  });
});
