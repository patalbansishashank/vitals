/**
 * "Connect your AI tools" (SUITE_SPEC §15.6): finds Claude Code, Codex, OpenCode and the ChatGPT desktop app, and adds
 * or removes the `vitals` MCP entry that starts this app with `--mcp`. Add writes exactly the row's preview (plus the
 * line break or comma that joins it to what is there); the file is backed up once to `<file>.vitals-backup`; every byte
 * that is not ours is kept, and so is the file mode. Claude Code goes through its own CLI. ChatGPT desktop reads Codex's
 * file on Linux and takes remote servers only on macOS and Windows.
 */
import { exec, execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CHATGPT_METADATA, MCP_NAME, codexHasVitals } from '../../../../packages/companion/src/agents.ts';
import { nodeSys, xdgConfigHome, type RunResult, type Sys } from '../../../../packages/companion/src/sys.ts';
import type { AiToolId, AiToolRow, McpServerInfo } from '../shared/bridge';

export interface AiToolsOptions {
  sys: Sys;
  /** What an AI tool runs: the app binary, and its arguments for that tool (`[...base, '--mcp', '--client', id]`). */
  command: { path: string; args: (id: AiToolId) => string[] };
  /** The paired server's MCP address, or null. */
  server: () => McpServerInfo | null;
  /** Lists a directory (finds the ChatGPT Store package on Windows); without it only the usual package name is tried. */
  readDir?: (dir: string) => Promise<string[]>;
}

export interface AiTools {
  list(): Promise<AiToolRow[]>;
  add(id: AiToolId): Promise<AiToolRow>;
  remove(id: AiToolId): Promise<AiToolRow>;
}

export const AI_TOOL_LABELS: Record<AiToolId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  'chatgpt-desktop': 'ChatGPT desktop',
};

const NOT_FOUND = 'Not found on this computer.';
const STALE = 'Points to another copy of Vitals; Add updates it.';
const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';
const CHATGPT_STORE_PACKAGE = 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0';

/* ---- Codex TOML: our table, edited as text ---------------------------------------------------------------------- */

const tomlString = (s: string) => JSON.stringify(s);
const TABLE_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#[^\n]*)?$/;

/** The `[mcp_servers.vitals]` table Add appends. */
export function codexTable(command: string, args: string[]): string {
  return [
    `[mcp_servers.${MCP_NAME}]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 60',
    '# Vitals never offers destructive tools and stages plan changes as proposals you approve, so calls need no prompt.',
    'default_tools_approval_mode = "approve"',
    '',
  ].join('\n');
}

/** Start of the whole table `block` in `text` (at a line start, followed by another table or the end), or -1. */
function blockAt(text: string, block: string): number {
  for (let i = text.indexOf(block); i >= 0; i = text.indexOf(block, i + 1)) {
    if (i > 0 && text[i - 1] !== '\n') continue;
    const next = text
      .slice(i + block.length)
      .split('\n')
      .find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (next === undefined || TABLE_HEADER.test(next)) return i;
  }
  return -1;
}

/**
 * Removes our table(s). The exact table Add wrote goes with the line break Add put before it; any other `vitals` table
 * (an older path, a hand edit, sub-tables) goes line by line with one blank line before it. Every other line stays.
 */
export function codexRemove(toml: string, table: string): string {
  let text = toml;
  const at = blockAt(text, table);
  if (at >= 0) {
    // Add put one line break (a blank line when the file ended with a newline) before the table; take it back only when
    // it is a blank line or the table ends the file, so a table that follows never joins the line before ours.
    const end = at + table.length;
    const cut = at > 0 && (text[at - 2] === '\n' || end >= text.length) ? at - 1 : at;
    text = text.slice(0, cut) + text.slice(end);
  }
  if (!codexHasVitals(text)) return text;
  const lines = text.split('\n');
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; ) {
    if (!codexHasVitals(lines[i]!)) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !(TABLE_HEADER.test(lines[end]!) && !codexHasVitals(lines[end]!))) end++;
    let last = end;
    while (last > i + 1 && (lines[last - 1]!.trim() === '' || lines[last - 1]!.trim().startsWith('#'))) last--; // a comment above the next table is its own
    for (let k = i; k < last; k++) drop.add(k);
    if (i > 0 && lines[i - 1]!.trim() === '') drop.add(i - 1);
    i = end;
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

/** The file with exactly `table` at the end (after one line break) and no other `vitals` table; unchanged when so. */
export function codexAdd(toml: string, table: string): string {
  const at = blockAt(toml, table);
  if (at >= 0 && !codexHasVitals(toml.slice(0, at) + toml.slice(at + table.length))) return toml;
  const without = codexRemove(toml, table);
  return without === '' ? table : `${without}\n${table}`;
}

/* ---- OpenCode JSON: our member, edited as text ------------------------------------------------------------------ */

interface JsonMember {
  key: string;
  keyStart: number;
  valueEnd: number;
  value: JsonNode;
}
type JsonNode = { kind: 'object'; start: number; end: number; members: JsonMember[] } | { kind: 'other'; start: number; end: number };

/** Spans of a text that `JSON.parse` accepts. */
function scanJson(text: string): JsonNode {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
  };
  const str = (): string => {
    const s = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(s, i)) as string;
  };
  const value = (): JsonNode => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const members: JsonMember[] = [];
      ws();
      if (text[i] === '}') return (i++, { kind: 'object', start, end: i, members });
      for (;;) {
        ws();
        const keyStart = i;
        const key = str();
        ws();
        i++; // :
        const v = value();
        members.push({ key, keyStart, valueEnd: v.end, value: v });
        ws();
        if (text[i++] === '}') return { kind: 'object', start, end: i, members };
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') i++;
      else
        for (;;) {
          value();
          ws();
          if (text[i++] === ']') break;
        }
      return { kind: 'other', start, end: i };
    }
    if (c === '"') return (str(), { kind: 'other', start, end: i });
    while (i < text.length && !',}] \t\n\r'.includes(text[i]!)) i++;
    return { kind: 'other', start, end: i };
  };
  return value();
}

const lineIndent = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', pos - 1) + 1))![0];
const indentUnit = (text: string) => /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
const memberText = (key: string, value: unknown, indent: string, unit: string) =>
  `${indent}${JSON.stringify(key)}: ${JSON.stringify(value, null, unit).split('\n').join(`\n${indent}`)}`;

function insertMember(text: string, obj: Extract<JsonNode, { kind: 'object' }>, key: string, value: unknown) {
  const outer = lineIndent(text, obj.start);
  const preview = memberText(key, value, outer + indentUnit(text), indentUnit(text));
  const last = obj.members.at(-1);
  const next = last
    ? `${text.slice(0, last.valueEnd)},\n${preview}${text.slice(last.valueEnd)}`
    : `${text.slice(0, obj.start + 1)}\n${preview}\n${outer}${text.slice(obj.end - 1)}`;
  return { next, preview };
}

function removeMember(text: string, obj: Extract<JsonNode, { kind: 'object' }>, index: number): string {
  const m = obj.members[index]!;
  if (index > 0) return text.slice(0, obj.members[index - 1]!.valueEnd) + text.slice(m.valueEnd);
  const next = obj.members[1];
  if (next) return text.slice(0, m.keyStart) + text.slice(next.keyStart);
  return text.slice(0, obj.start + 1) + text.slice(obj.end - 1);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Comments and trailing commas out, strings kept: only to read a `.jsonc` file. */
function stripJsonc(text: string): string {
  return text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, s: string | undefined) => s ?? '')
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, s: string | undefined, close: string | undefined) => s ?? close ?? m);
}

function parseJson(text: string, loose = false): unknown {
  try {
    const body = text.replace(/^\uFEFF/, '');
    return JSON.parse(loose ? stripJsonc(body) : body) as unknown;
  } catch {
    return undefined;
  }
}

type OpencodePlan =
  | { kind: 'write'; next: string; preview: string; added: boolean }
  | { kind: 'same'; preview: string }
  | { kind: 'refuse'; preview: string; added: boolean; note: string };

function opencodePlan(text: string | null, entry: Record<string, unknown>): OpencodePlan {
  if (text === null || text.trim() === '') {
    const next = `${JSON.stringify({ $schema: OPENCODE_SCHEMA, mcp: { [MCP_NAME]: entry } }, null, 2)}\n`;
    return { kind: 'write', next, preview: next, added: false };
  }
  const cfg = parseJson(text);
  if (!isObject(cfg) || (cfg.mcp !== undefined && !isObject(cfg.mcp))) {
    const loose = parseJson(text, true);
    const added = isObject(loose) && isObject(loose.mcp) && MCP_NAME in loose.mcp;
    const why = cfg === undefined ? 'This file has comments or is not plain JSON' : 'This file is not laid out as Vitals expects';
    return { kind: 'refuse', preview: memberText(MCP_NAME, entry, '', '  '), added, note: `${why}, so Vitals leaves it alone; put the entry under "mcp" by hand.` };
  }
  let body = text;
  let root = scanJson(body) as Extract<JsonNode, { kind: 'object' }>;
  let mcp = root.members.findLast((m) => m.key === 'mcp');
  const had = isObject(cfg.mcp) && MCP_NAME in cfg.mcp;
  if (had && sameJson((cfg.mcp as Record<string, unknown>)[MCP_NAME], entry)) {
    const obj = mcp!.value as Extract<JsonNode, { kind: 'object' }>;
    const m = obj.members.findLast((x) => x.key === MCP_NAME)!;
    return { kind: 'same', preview: lineIndent(body, m.keyStart) + body.slice(m.keyStart, m.valueEnd) };
  }
  if (had) {
    const obj = mcp!.value as Extract<JsonNode, { kind: 'object' }>;
    const at = obj.members.findLastIndex((x) => x.key === MCP_NAME);
    body = removeMember(body, obj, at);
    root = scanJson(body) as Extract<JsonNode, { kind: 'object' }>;
    mcp = root.members.findLast((m) => m.key === 'mcp');
  }
  const { next, preview } =
    mcp && mcp.value.kind === 'object' ? insertMember(body, mcp.value, MCP_NAME, entry) : insertMember(body, root, 'mcp', { [MCP_NAME]: entry });
  return { kind: 'write', next, preview, added: had };
}

/** The file without our member (and without `"mcp"` when ours was its only member). */
function opencodeRemove(text: string): string {
  const root = scanJson(text) as Extract<JsonNode, { kind: 'object' }>;
  const mcpAt = root.members.findLastIndex((m) => m.key === 'mcp');
  const mcp = root.members[mcpAt]!.value as Extract<JsonNode, { kind: 'object' }>;
  if (mcp.members.every((m) => m.key === MCP_NAME)) return removeMember(text, root, mcpAt);
  return removeMember(text, mcp, mcp.members.findLastIndex((m) => m.key === MCP_NAME));
}

/* ---- finding programs and files --------------------------------------------------------------------------------- */

function envGet(sys: Sys, name: string): string | undefined {
  if (sys.platform !== 'win32') return sys.env[name] || undefined;
  const key = Object.keys(sys.env).find((k) => k.toUpperCase() === name);
  return (key && sys.env[key]) || undefined;
}

interface Found {
  path: string;
  /** Found through PATH, so `claude` alone runs it in a terminal. */
  onPath: boolean;
}

/** The program on PATH or in the usual install folders a GUI app's PATH lacks. */
async function findProgram(sys: Sys, name: string, extra: string[] = []): Promise<Found | null> {
  const win = sys.platform === 'win32';
  const P = win ? path.win32 : path.posix;
  const home = sys.home;
  const names = win ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
  const onPath = (envGet(sys, 'PATH') ?? '')
    .split(win ? ';' : ':')
    .map((d) => d.replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const appData = envGet(sys, 'APPDATA') ?? P.join(home, 'AppData', 'Roaming');
  const localAppData = envGet(sys, 'LOCALAPPDATA') ?? P.join(home, 'AppData', 'Local');
  const npmPrefix = envGet(sys, 'NPM_CONFIG_PREFIX');
  const usual = win
    ? [P.join(appData, 'npm'), P.join(home, '.local', 'bin'), P.join(home, '.bun', 'bin'), P.join(home, 'scoop', 'shims'), P.join(localAppData, 'Microsoft', 'WinGet', 'Links'), ...(npmPrefix ? [npmPrefix] : [])]
    : [P.join(home, '.local', 'bin'), P.join(home, '.npm-global', 'bin'), P.join(home, '.bun', 'bin'), P.join(home, '.volta', 'bin'), ...(npmPrefix ? [P.join(npmPrefix, 'bin')] : []), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];
  for (const [dirs, isPath] of [[onPath, true], [[...extra, ...usual], false]] as const) {
    for (const dir of dirs) {
      for (const n of names) {
        const p = P.join(dir, n);
        const st = await sys.stat(p);
        if (st && !st.isDir && (win || st.mode & 0o111)) return { path: p, onPath: isPath };
      }
    }
  }
  return null;
}

/** A command line as a person would type it (POSIX shell quoting, or Windows double quotes). */
function commandLine(platform: NodeJS.Platform, argv: string[]): string {
  if (platform === 'win32') return argv.map((a) => (/^[\w\-.:\\/=@]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).join(' ');
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

const firstLine = (r: RunResult) => (r.stderr || r.stdout).trim().split('\n')[0]?.trim() || 'it gave no reason';

/* ---- the tools -------------------------------------------------------------------------------------------------- */

export function createAiTools(o: AiToolsOptions): AiTools {
  const { sys } = o;
  const win = sys.platform === 'win32';
  const P = win ? path.win32 : path.posix;
  const isDir = async (p: string) => (await sys.stat(p))?.isDir === true;

  const codexHome = () => envGet(sys, 'CODEX_HOME') ?? P.join(sys.home, '.codex');
  const codexFile = () => P.join(codexHome(), 'config.toml');
  const codexTableNow = () => codexTable(o.command.path, o.command.args('codex'));
  const opencodeDir = () => P.join(win ? envGet(sys, 'XDG_CONFIG_HOME') ?? P.join(sys.home, '.config') : xdgConfigHome(sys), 'opencode');
  const opencodeEntry = () => ({ type: 'local', command: [o.command.path, ...o.command.args('opencode')], enabled: true, timeout: 30000 });
  const claudeFile = () => P.join(envGet(sys, 'CLAUDE_CONFIG_DIR') ?? sys.home, '.claude.json');
  const claudeArgs = () => [o.command.path, ...o.command.args('claude-code')];

  /** Backs `file` up once, keeps its mode, and creates it (0600) and its folder when missing. */
  async function writeConfig(file: string, after: string) {
    const st = await sys.stat(file);
    if (st) {
      const backup = `${file}.vitals-backup`;
      if (!(await sys.stat(backup))) await sys.copy(file, backup);
    } else await sys.mkdir(P.dirname(file), 0o700);
    await sys.writeText(file, after, st?.mode ?? 0o600);
  }

  async function codexRow(id: 'codex' | 'chatgpt-desktop', found: boolean): Promise<AiToolRow> {
    const file = codexFile();
    const text = await sys.readText(file);
    const table = codexTableNow();
    const added = text !== null && codexHasVitals(text);
    const current = added && codexAdd(text, table) === text;
    const note = !found
      ? NOT_FOUND
      : added && !current
        ? STALE
        : id === 'chatgpt-desktop'
          ? 'Uses the same settings file as Codex; restart ChatGPT after adding.'
          : undefined;
    return { id, label: AI_TOOL_LABELS[id], found, added, file, preview: table, note, canAdd: found };
  }

  async function chatgptFound(): Promise<boolean> {
    if (sys.platform === 'linux') return !!(await sys.stat(CHATGPT_METADATA));
    if (sys.platform === 'darwin') return (await isDir('/Applications/ChatGPT.app')) || isDir(P.join(sys.home, 'Applications', 'ChatGPT.app'));
    if (!win) return false;
    const local = envGet(sys, 'LOCALAPPDATA') ?? P.join(sys.home, 'AppData', 'Local');
    if (await isDir(P.join(local, 'Programs', 'ChatGPT'))) return true;
    const packages = P.join(local, 'Packages');
    const names = o.readDir ? await o.readDir(packages).catch(() => []) : [CHATGPT_STORE_PACKAGE];
    for (const n of names) if (n.startsWith('OpenAI.ChatGPT') && (await isDir(P.join(packages, n)))) return true;
    return false;
  }

  const rows: Record<AiToolId, () => Promise<AiToolRow>> = {
    async codex() {
      const found = !!(await findProgram(sys, 'codex')) || (await isDir(codexHome()));
      return codexRow('codex', found);
    },

    async opencode() {
      const dir = opencodeDir();
      const json = P.join(dir, 'opencode.json');
      const jsonc = P.join(dir, 'opencode.jsonc');
      const file = !(await sys.stat(json)) && (await sys.stat(jsonc)) ? jsonc : json;
      const found = !!(await findProgram(sys, 'opencode', [P.join(sys.home, '.opencode', 'bin')])) || (await isDir(dir));
      const plan = opencodePlan(await sys.readText(file), opencodeEntry());
      const base = { id: 'opencode' as const, label: AI_TOOL_LABELS.opencode, found, file, preview: plan.preview };
      if (plan.kind === 'same') return { ...base, added: true, canAdd: found, note: found ? undefined : NOT_FOUND };
      if (plan.kind === 'refuse') return { ...base, added: plan.added, canAdd: false, note: plan.note };
      return { ...base, added: plan.added, canAdd: found, note: !found ? NOT_FOUND : plan.added ? STALE : undefined };
    },

    async 'claude-code'() {
      const file = claudeFile();
      const program = await findProgram(sys, 'claude', [P.join(sys.home, '.claude', 'local')]);
      const text = await sys.readText(file);
      const cfg = text === null ? undefined : parseJson(text);
      const entry = isObject(cfg) && isObject(cfg.mcpServers) ? cfg.mcpServers[MCP_NAME] : undefined;
      const added = entry !== undefined;
      const [cmd, ...args] = claudeArgs();
      const current = isObject(entry) && entry.command === cmd && sameJson(entry.args ?? [], args);
      const found = !!program || text !== null;
      const preview = commandLine(sys.platform, [program && !program.onPath ? program.path : 'claude', 'mcp', 'add', '-s', 'user', MCP_NAME, '--', ...claudeArgs()]);
      const note = !found
        ? NOT_FOUND
        : !program
          ? "Claude Code's command (claude) was not found; run this line in a terminal."
          : added && !current
            ? STALE
            : undefined;
      return { id: 'claude-code', label: AI_TOOL_LABELS['claude-code'], found, added, file, preview, note, canAdd: !!program };
    },

    async 'chatgpt-desktop'() {
      const found = await chatgptFound();
      if (sys.platform === 'linux') return codexRow('chatgpt-desktop', found);
      const server = o.server();
      const note = server ? `Add this address in ChatGPT's settings: ${server.mcpUrl}, with a key from Settings › Agents` : 'Needs your Vitals server';
      return { id: 'chatgpt-desktop', label: AI_TOOL_LABELS['chatgpt-desktop'], found, added: false, note, canAdd: false };
    },
  };

  async function runClaude(args: string[], verb: string) {
    const program = await findProgram(sys, 'claude', [P.join(sys.home, '.claude', 'local')]);
    if (!program) throw new Error("Claude Code's command (claude) was not found on this computer.");
    const file = claudeFile();
    if ((await sys.stat(file)) && !(await sys.stat(`${file}.vitals-backup`))) await sys.copy(file, `${file}.vitals-backup`);
    const r = await sys.run(program.path, args, { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(`Claude Code could not ${verb} Vitals: ${firstLine(r)}`);
  }

  async function add(id: AiToolId): Promise<AiToolRow> {
    const row = await rows[id]();
    if (!row.canAdd) throw new Error(row.note && row.note !== NOT_FOUND ? row.note : `${row.label} was not found on this computer.`);
    if (id === 'codex' || id === 'chatgpt-desktop') {
      const before = (await sys.readText(row.file!)) ?? '';
      const after = codexAdd(before, codexTableNow());
      if (after !== before) await writeConfig(row.file!, after);
    } else if (id === 'opencode') {
      const plan = opencodePlan(await sys.readText(row.file!), opencodeEntry());
      if (plan.kind === 'refuse') throw new Error(plan.note);
      if (plan.kind === 'write') await writeConfig(row.file!, plan.next);
    } else if (!(row.added && row.note !== STALE)) {
      if (row.added) await runClaude(['mcp', 'remove', MCP_NAME, '-s', 'user'], 'replace');
      await runClaude(['mcp', 'add', '-s', 'user', MCP_NAME, '--', ...claudeArgs()], 'add');
    }
    return rows[id]();
  }

  async function remove(id: AiToolId): Promise<AiToolRow> {
    const row = await rows[id]();
    if (!row.added) return row;
    if (id === 'codex' || id === 'chatgpt-desktop') {
      const before = (await sys.readText(row.file!)) ?? '';
      await writeConfig(row.file!, codexRemove(before, codexTableNow()));
    } else if (id === 'opencode') {
      const text = (await sys.readText(row.file!)) ?? '';
      if (!isObject(parseJson(text))) throw new Error(`${row.file} has comments or is not plain JSON, so Vitals leaves it alone; remove the "${MCP_NAME}" entry by hand.`);
      await writeConfig(row.file!, opencodeRemove(text));
    } else await runClaude(['mcp', 'remove', MCP_NAME, '-s', 'user'], 'remove');
    return rows[id]();
  }

  // one change at a time: two clicks never interleave their read and write of the same file
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = queue.then(f, f);
    queue = p.catch(() => undefined);
    return p;
  };

  return {
    list: () => serial(() => Promise.all((['claude-code', 'codex', 'opencode', 'chatgpt-desktop'] as const).map((id) => rows[id]()))),
    add: (id) => serial(() => add(id)),
    remove: (id) => serial(() => remove(id)),
  };
}

/* ---- the real computer ------------------------------------------------------------------------------------------ */

/**
 * `nodeSys()` with what a GUI app needs on top: a program's own folder leads PATH (a `#!/usr/bin/env node` script next
 * to its `node` runs), Windows `.cmd` shims run through `cmd.exe`, and a symlinked config is written through the link.
 */
export function nodeAiToolsSys(base: Sys = nodeSys()): Sys {
  const cmdQuote = (a: string) => (/^[\w\-.:\\/=@]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  return {
    ...base,
    run: (cmd, args, opts = {}) =>
      new Promise((resolve) => {
        const env = { ...process.env };
        const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
        env[key] = [path.dirname(cmd), env[key]].filter(Boolean).join(path.delimiter);
        const options = { timeout: opts.timeoutMs ?? 5_000, maxBuffer: 4 * 1024 * 1024, env, windowsHide: true };
        const done = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          const raw = (error as { code?: unknown } | null)?.code;
          const code = error ? (typeof raw === 'number' ? raw : null) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        };
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) exec([cmd, ...args].map(cmdQuote).join(' '), options, done);
        else execFile(cmd, args, options, done);
      }),
    async writeText(p, data, mode) {
      await base.writeText(await realpath(p).catch(() => p), data, mode);
    },
  };
}

/** `createAiTools` on this computer. */
export function createNodeAiTools(o: Omit<AiToolsOptions, 'sys' | 'readDir'>): AiTools {
  return createAiTools({ ...o, sys: nodeAiToolsSys(), readDir: (dir) => readdir(dir) });
}
