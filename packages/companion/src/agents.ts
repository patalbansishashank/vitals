/**
 * `vitals-companion agents status|register|unregister <codex|opencode|claude|chatgpt>`: find the desktop agents on this
 * computer and add (or remove) the Vitals MCP server in their own config, with a dated backup of every file it edits.
 *
 * - Codex CLI and the ChatGPT desktop app share `~/.codex/config.toml` (`$CODEX_HOME`); only the `[mcp_servers.vitals]`
 *   table (and its sub-tables) is ever written or removed, every other line is kept byte for byte.
 * - OpenCode: `~/.config/opencode/opencode.json`, key `mcp.vitals` only. A file that does not parse as JSON is left alone.
 * - Claude Code keeps its user-scope servers in `~/.claude.json`, which it rewrites often; registration goes through its
 *   own CLI (`claude mcp add -s user`) instead of editing the file.
 *
 * Every registration runs `<wrapper> mcp` over stdio: the wrapper forwards to the running Companion with the admin token
 * from the config directory, so no secret is written into any agent's config.
 */
import { join } from 'node:path';
import { backupFile, xdgConfigHome, type Sys } from './sys.ts';

export const AGENT_IDS = ['codex', 'opencode', 'claude', 'chatgpt-desktop'] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export const MCP_NAME = 'vitals';

export const AGENT_LABELS: Record<AgentId, string> = {
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  claude: 'Claude Code',
  'chatgpt-desktop': 'ChatGPT desktop app',
};

/** `agents register chatgpt` is accepted as a short name. */
export function parseAgentId(name: string | undefined): AgentId | null {
  if (name === 'chatgpt') return 'chatgpt-desktop';
  return (AGENT_IDS as readonly string[]).includes(name ?? '') ? (name as AgentId) : null;
}

export interface AgentState {
  id: AgentId;
  label: string;
  installed: boolean;
  version?: string;
  /** Where the program was found. */
  path?: string;
  registered: boolean;
  /** The config file that holds (or would hold) the registration. */
  configPath: string;
}

export const codexConfigPath = (sys: Sys) => join(sys.env.CODEX_HOME || join(sys.home, '.codex'), 'config.toml');
export const opencodeConfigPath = (sys: Sys) => join(xdgConfigHome(sys), 'opencode', 'opencode.json');
export const claudeConfigPath = (sys: Sys) => join(sys.home, '.claude.json');
export const CHATGPT_METADATA = '/usr/lib/chatgpt/resources/linux-package-metadata.json';

/* ---- Codex TOML: one table, edited as text ---------------------------------------------------------------------- */

const TABLE_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

/** Line ranges `[start, end)` of `[mcp_servers.vitals]` and its sub-tables. */
function codexTableRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  const isOurs = (name: string) => {
    const n = name.replace(/"/g, '');
    return n === `mcp_servers.${MCP_NAME}` || n.startsWith(`mcp_servers.${MCP_NAME}.`);
  };
  lines.forEach((line, i) => {
    const m = TABLE_HEADER.exec(line);
    if (!m) return;
    if (start >= 0 && !isOurs(m[1]!)) {
      ranges.push([start, i]);
      start = -1;
    }
    if (start < 0 && isOurs(m[1]!)) start = i;
  });
  if (start >= 0) ranges.push([start, lines.length]);
  return ranges;
}

export function codexHasVitals(toml: string): boolean {
  return codexTableRanges(toml.split('\n')).length > 0;
}

const tomlString = (s: string) => JSON.stringify(s);

export function codexSnippet(command: string): string {
  return [
    `[mcp_servers.${MCP_NAME}]`,
    `command = ${tomlString(command)}`,
    'args = ["mcp"]',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 60',
    '# Vitals never lists destructive tools to agents and stages plan edits as proposals, so tool calls need no prompt.',
    'default_tools_approval_mode = "approve"',
    '',
  ].join('\n');
}

/** Removes our table(s) and trailing blank lines they leave; everything else is unchanged. */
export function codexWithout(toml: string): string {
  const lines = toml.split('\n');
  const ranges = codexTableRanges(lines);
  if (ranges.length === 0) return toml;
  const drop = new Set<number>();
  for (const [s, e] of ranges) for (let i = s; i < e; i++) drop.add(i);
  const kept = lines.filter((_, i) => !drop.has(i));
  return `${kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
}

export function codexWith(toml: string, command: string): string {
  const base = codexWithout(toml).replace(/\n+$/, '');
  return `${base ? `${base}\n\n` : ''}${codexSnippet(command)}`;
}

/* ---- OpenCode JSON ---------------------------------------------------------------------------------------------- */

export function opencodeEntry(command: string) {
  return { type: 'local', command: [command, 'mcp'], enabled: true, timeout: 20000 };
}

/* ---- detection -------------------------------------------------------------------------------------------------- */

async function version(sys: Sys, cmd: string): Promise<string | undefined> {
  const r = await sys.run(cmd, ['--version'], { timeoutMs: 4_000 });
  if (r.code !== 0) return undefined;
  return /\d+\.\d+(\.\d+)?/.exec(r.stdout)?.[0];
}

function jsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const hasKey = (o: unknown, key: string) => !!o && typeof o === 'object' && key in (o as Record<string, unknown>);

export async function detectAgent(sys: Sys, id: AgentId): Promise<AgentState> {
  const label = AGENT_LABELS[id];
  switch (id) {
    case 'codex': {
      const path = await sys.which('codex');
      const configPath = codexConfigPath(sys);
      const toml = await sys.readText(configPath);
      return { id, label, installed: !!path, path: path ?? undefined, version: path ? await version(sys, path) : undefined, registered: !!toml && codexHasVitals(toml), configPath };
    }
    case 'opencode': {
      const path = await sys.which('opencode');
      const configPath = opencodeConfigPath(sys);
      const cfg = jsonObject(await sys.readText(configPath));
      return { id, label, installed: !!path, path: path ?? undefined, version: path ? await version(sys, path) : undefined, registered: hasKey(cfg?.mcp, MCP_NAME), configPath };
    }
    case 'claude': {
      const path = await sys.which('claude');
      const configPath = claudeConfigPath(sys);
      const cfg = jsonObject(await sys.readText(configPath));
      return { id, label, installed: !!path, path: path ?? undefined, version: path ? await version(sys, path) : undefined, registered: hasKey(cfg?.mcpServers, MCP_NAME), configPath };
    }
    case 'chatgpt-desktop': {
      const meta = jsonObject(await sys.readText(CHATGPT_METADATA));
      const configPath = codexConfigPath(sys);
      const toml = await sys.readText(configPath);
      return {
        id,
        label,
        installed: !!meta,
        path: meta ? '/usr/lib/chatgpt' : undefined,
        version: typeof meta?.version === 'string' ? meta.version : undefined,
        registered: !!toml && codexHasVitals(toml),
        configPath,
      };
    }
  }
}

export const detectAgents = (sys: Sys) => Promise.all(AGENT_IDS.map((id) => detectAgent(sys, id)));

/* ---- register / unregister -------------------------------------------------------------------------------------- */

export interface RegisterResult {
  id: AgentId;
  changed: boolean;
  /** What was done, in plain words, one line each. */
  lines: string[];
  backup?: string;
}

export interface RegisterOptions {
  /** The command agents start (absolute path of the wrapper, or `vitals-companion`). */
  command: string;
  dryRun?: boolean;
}

export class AgentConfigError extends Error {}

export async function registerAgent(sys: Sys, id: AgentId, opts: RegisterOptions): Promise<RegisterResult> {
  switch (id) {
    case 'codex':
    case 'chatgpt-desktop': {
      const path = codexConfigPath(sys);
      const before = (await sys.readText(path)) ?? '';
      const after = codexWith(before, opts.command);
      const shared = id === 'chatgpt-desktop' ? ['The ChatGPT desktop app reads the same file as the Codex CLI; restart the app to load it (Settings › MCP servers shows "vitals").'] : [];
      if (after === before) return { id, changed: false, lines: [`${path} already has [mcp_servers.${MCP_NAME}]; nothing to do.`, ...shared] };
      if (opts.dryRun) return { id, changed: false, lines: [`Would write to ${path}:`, codexSnippet(opts.command), ...shared] };
      const backup = await backupFile(sys, path);
      const mode = (await sys.stat(path))?.mode ?? 0o600;
      await sys.writeText(path, after, mode);
      return { id, changed: true, backup: backup ?? undefined, lines: [`Added [mcp_servers.${MCP_NAME}] to ${path}.`, ...(backup ? [`Backup: ${backup}`] : []), ...shared] };
    }
    case 'opencode': {
      const path = opencodeConfigPath(sys);
      const text = await sys.readText(path);
      const cfg = text === null ? { $schema: 'https://opencode.ai/config.json' } : jsonObject(text);
      if (!cfg) throw new AgentConfigError(`${path} is not plain JSON; add the "vitals" entry by hand: ${JSON.stringify({ mcp: { [MCP_NAME]: opencodeEntry(opts.command) } })}`);
      const mcp = (cfg.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {}) as Record<string, unknown>;
      const entry = opencodeEntry(opts.command);
      if (JSON.stringify(mcp[MCP_NAME]) === JSON.stringify(entry)) return { id, changed: false, lines: [`${path} already has mcp.${MCP_NAME}; nothing to do.`] };
      const next = { ...cfg, mcp: { ...mcp, [MCP_NAME]: entry } };
      if (opts.dryRun) return { id, changed: false, lines: [`Would set mcp.${MCP_NAME} in ${path}:`, JSON.stringify(entry, null, 2)] };
      const backup = await backupFile(sys, path);
      const mode = (await sys.stat(path))?.mode ?? 0o600;
      await sys.writeText(path, `${JSON.stringify(next, null, 2)}\n`, mode);
      return { id, changed: true, backup: backup ?? undefined, lines: [`Set mcp.${MCP_NAME} in ${path}.`, ...(backup ? [`Backup: ${backup}`] : [])] };
    }
    case 'claude': {
      const state = await detectAgent(sys, 'claude');
      const args = ['mcp', 'add', '-s', 'user', MCP_NAME, '--', opts.command, 'mcp'];
      if (state.registered) return { id, changed: false, lines: [`Claude Code already has a user-scope "${MCP_NAME}" server; nothing to do. To replace it: claude mcp remove ${MCP_NAME} -s user`] };
      if (!state.installed) throw new AgentConfigError('Claude Code (claude) is not on PATH.');
      if (opts.dryRun) return { id, changed: false, lines: [`Would run: claude ${args.join(' ')}`] };
      const r = await sys.run(state.path!, args, { timeoutMs: 20_000 });
      if (r.code !== 0) throw new AgentConfigError(`claude mcp add failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      return { id, changed: true, lines: [`Ran: claude ${args.join(' ')}`, `Undo: claude mcp remove ${MCP_NAME} -s user`] };
    }
  }
}

export async function unregisterAgent(sys: Sys, id: AgentId, opts: { dryRun?: boolean } = {}): Promise<RegisterResult> {
  switch (id) {
    case 'codex':
    case 'chatgpt-desktop': {
      const path = codexConfigPath(sys);
      const before = await sys.readText(path);
      if (before === null || !codexHasVitals(before)) return { id, changed: false, lines: [`${path} has no [mcp_servers.${MCP_NAME}]; nothing to do.`] };
      if (opts.dryRun) return { id, changed: false, lines: [`Would remove [mcp_servers.${MCP_NAME}] from ${path}.`] };
      const backup = await backupFile(sys, path);
      await sys.writeText(path, codexWithout(before), (await sys.stat(path))?.mode ?? 0o600);
      return { id, changed: true, backup: backup ?? undefined, lines: [`Removed [mcp_servers.${MCP_NAME}] from ${path}.`, ...(backup ? [`Backup: ${backup}`] : [])] };
    }
    case 'opencode': {
      const path = opencodeConfigPath(sys);
      const cfg = jsonObject(await sys.readText(path));
      if (!cfg || !hasKey(cfg.mcp, MCP_NAME)) return { id, changed: false, lines: [`${path} has no mcp.${MCP_NAME}; nothing to do.`] };
      if (opts.dryRun) return { id, changed: false, lines: [`Would remove mcp.${MCP_NAME} from ${path}.`] };
      const { [MCP_NAME]: _removed, ...rest } = cfg.mcp as Record<string, unknown>;
      const backup = await backupFile(sys, path);
      await sys.writeText(path, `${JSON.stringify({ ...cfg, mcp: rest }, null, 2)}\n`, (await sys.stat(path))?.mode ?? 0o600);
      return { id, changed: true, backup: backup ?? undefined, lines: [`Removed mcp.${MCP_NAME} from ${path}.`, ...(backup ? [`Backup: ${backup}`] : [])] };
    }
    case 'claude': {
      const state = await detectAgent(sys, 'claude');
      if (!state.registered) return { id, changed: false, lines: [`Claude Code has no user-scope "${MCP_NAME}" server; nothing to do.`] };
      const args = ['mcp', 'remove', MCP_NAME, '-s', 'user'];
      if (opts.dryRun) return { id, changed: false, lines: [`Would run: claude ${args.join(' ')}`] };
      const r = await sys.run(state.path ?? 'claude', args, { timeoutMs: 20_000 });
      if (r.code !== 0) throw new AgentConfigError(`claude mcp remove failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      return { id, changed: true, lines: [`Ran: claude ${args.join(' ')}`] };
    }
  }
}
