/**
 * Agents through the server (SUITE_SPEC §14.4): agent tokens per person, the `/mcp` endpoint that runs tools in the
 * person's store (no browser tab), the per-token scope, the tool-call rate limit and activity log, and the
 * connection recipes for Codex, OpenCode and Claude Code (`agents register <agent> --remote <url>` writes them).
 *
 * Routes:
 *   POST   /v1/agents/tokens        device token → { token (shown once), id, mcpUrl, recipes }
 *   GET    /v1/agents/tokens        device token → { tokens: [{ id, client, label, scope, createdAt, lastUsedAt }] }
 *   DELETE /v1/agents/tokens/{id}   device token → 204
 *   GET    /v1/agents/activity      device token → last 50 tool calls { at, tokenId, tool, outcome } (no arguments)
 *   GET|POST|DELETE /mcp            agent token  → MCP Streamable HTTP
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { codexWithout, MCP_NAME, opencodeConfigPath, codexConfigPath, AgentConfigError } from './agents.ts';
import { forbiddenEnvelope, idempotencyKeyFor } from './agentHub.ts';
import { createServerMcpHttp, type McpBackend } from './mcp.ts';
import { AGENT_CLIENTS, AGENT_SCOPES, isFailure, type AgentClient, type AgentScope, type PersonContext, type ResolvePerson, type TokenStore } from './personContext.ts';
import { AiError, sendAiError } from './providers.ts';
import { createRateLimiter, HttpError, readBody, readJson, sendJson, type Logger } from './security.ts';
import { backupFile, type Sys } from './sys.ts';
import { exposedTo, manifestForScope, rejected, scopeAllows, toMcpTools, type ToolManifestEntry, type ToolResultEnvelope } from './toolManifest.ts';

export const AGENT_CALLS_PER_MINUTE = 60;
export const ACTIVITY_KEEP = 50;
export const TOKEN_ENV = 'VITALS_TOKEN';

/**
 * Commands that need a port only the browser has (planner workers, page navigation, PDF and photo reading). Left
 * out of the server's tool list; any other command that answers `not_on_server` is added at run time.
 */
export const NOT_ON_SERVER_SEED: readonly string[] = [
  'planner.find', 'nav.open', 'markers.import', 'log.mealFromPhoto',
  // they re-plan through the planner workers (src/commands/living/adapt.ts runReplan)
  'plan.replan', 'plan.declareEvent', 'plan.shift', 'plan.editDay',
];

/** The rule docs/SERVER.md states: a command whose answer names `not_on_server` (as `detail.reason` or `detail.rule`). */
export const answersNotOnServer = (envelope: { error?: { detail?: unknown } }): boolean => {
  const d = envelope.error?.detail as { reason?: unknown; rule?: unknown } | undefined;
  return d?.reason === 'not_on_server' || d?.rule === 'not_on_server';
};

// ---------------------------------------------------------------------------------------------------------------
// Recipes (R18 §5; the token lives in the VITALS_TOKEN environment variable, snippets never carry it)

export interface AgentRecipe {
  client: string;
  title: string;
  steps: string[];
  config?: { file: string; snippet: string };
  /** False for a client with no working remote path yet. */
  available: boolean;
}

export const codexRemoteSnippet = (url: string) =>
  [
    `[mcp_servers.${MCP_NAME}]`,
    `url = ${JSON.stringify(url)}`,
    `bearer_token_env_var = "${TOKEN_ENV}"`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 60',
    '# Vitals never lists destructive tools to agents and stages plan edits as proposals, so tool calls need no prompt.',
    'default_tools_approval_mode = "approve"',
    '',
  ].join('\n');

export const opencodeRemoteEntry = (url: string) => ({ type: 'remote', url, headers: { Authorization: `Bearer {env:${TOKEN_ENV}}` }, enabled: true, timeout: 20000 });

export const claudeAddArgs = (url: string, tokenPlaceholder = `$${TOKEN_ENV}`) => ['mcp', 'add', '--transport', 'http', '-s', 'user', MCP_NAME, url, '--header', `Authorization: Bearer ${tokenPlaceholder}`];

export function agentRecipes(mcpUrl: string, only?: AgentClient): AgentRecipe[] {
  const keepToken = `Keep the token in the environment variable ${TOKEN_ENV} (for example in your shell's startup file); it is shown only once.`;
  const all: Array<AgentRecipe & { id: AgentClient }> = [
    {
      id: 'codex',
      client: 'codex',
      title: 'Codex',
      available: true,
      steps: [keepToken, 'Add this to ~/.codex/config.toml, or run: vitals-server agents register codex --remote ' + mcpUrl, 'Start Codex again; /mcp lists "vitals".'],
      config: { file: '~/.codex/config.toml', snippet: codexRemoteSnippet(mcpUrl) },
    },
    {
      id: 'opencode',
      client: 'opencode',
      title: 'OpenCode',
      available: true,
      steps: [keepToken, 'Add this under "mcp" in ~/.config/opencode/opencode.json, or run: vitals-server agents register opencode --remote ' + mcpUrl, 'Start OpenCode again.'],
      config: { file: '~/.config/opencode/opencode.json', snippet: JSON.stringify({ mcp: { [MCP_NAME]: opencodeRemoteEntry(mcpUrl) } }, null, 2) },
    },
    {
      id: 'claude',
      client: 'claude',
      title: 'Claude Code',
      available: true,
      steps: [
        keepToken,
        `Run: claude ${claudeAddArgs(mcpUrl).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
        'Claude Code stores the token itself in ~/.claude.json (readable by you only), so it works without the environment variable afterwards.',
      ],
    },
    {
      id: 'chatgpt-desktop',
      client: 'chatgpt-desktop',
      title: 'ChatGPT desktop app',
      available: false,
      steps: ['Not available yet: connecting the ChatGPT desktop app to your own server has not been confirmed to work. Use Codex, OpenCode or Claude Code for now.'],
    },
    {
      id: 'other',
      client: 'other',
      title: 'Another MCP client',
      available: true,
      steps: [keepToken, `Connect over Streamable HTTP to ${mcpUrl} with the header "Authorization: Bearer <token>".`],
    },
  ];
  return all.filter((r) => !only || r.id === only).map(({ id: _id, ...r }) => r);
}

// ---------------------------------------------------------------------------------------------------------------
// Activity (per person, in memory; names and outcomes only, never arguments)

export interface AgentActivity {
  at: string;
  tokenId: string;
  tool: string;
  outcome: 'ok' | 'staged' | 'needs_choice' | 'rejected' | 'error';
}

export function outcomeOf(e: ToolResultEnvelope): AgentActivity['outcome'] {
  if (e.status === 'pending_user') return 'staged';
  // the call was fine but wrote nothing: not "ok", which reads as "it was logged"
  if (e.status === 'needs_choice') return 'needs_choice';
  if (e.ok) return 'ok';
  return e.error?.code === 'internal' ? 'error' : 'rejected';
}

// ---------------------------------------------------------------------------------------------------------------
// Routes

export interface AgentRoutesOptions {
  resolvePerson: ResolvePerson;
  tokens: TokenStore;
  /** What agents use to reach the server, e.g. `https://<host>.<tailnet>.ts.net:8443`. */
  publicOrigin: string;
  log: Logger;
  version: string;
  callsPerMinute?: number;
  maxSessions?: number;
  maxSessionsPerToken?: number;
  now?: () => number;
}

export const CLIENT_LABELS: Record<AgentClient, string> = { codex: 'Codex', opencode: 'OpenCode', claude: 'Claude Code', 'chatgpt-desktop': 'ChatGPT desktop app', other: 'Other agent' };

const SCOPE_WORDS: Record<AgentScope, string> = { read: 'only read', log: 'read and log', edit: 'read, log and propose changes' };

export function createAgentRoutes(opts: AgentRoutesOptions) {
  const { resolvePerson, tokens, log, version, now = Date.now } = opts;
  const mcpUrl = `${opts.publicOrigin.replace(/\/+$/, '')}/mcp`;
  const perMinute = opts.callsPerMinute ?? AGENT_CALLS_PER_MINUTE;
  const limiter = createRateLimiter({ capacity: perMinute, perMinute }, now);
  const mcp = createServerMcpHttp({ version, log, maxSessions: opts.maxSessions, maxSessionsPerToken: opts.maxSessionsPerToken });
  const activity = new Map<string, AgentActivity[]>();
  const notOnServer = new Map<string, Set<string>>();
  const excludedFor = (personId: string) => {
    let s = notOnServer.get(personId);
    if (!s) notOnServer.set(personId, (s = new Set(NOT_ON_SERVER_SEED)));
    return s;
  };
  const record = (personId: string, a: AgentActivity) => {
    const list = activity.get(personId) ?? [];
    list.unshift(a);
    if (list.length > ACTIVITY_KEEP) list.length = ACTIVITY_KEEP;
    activity.set(personId, list);
  };

  /** The MCP backend of one agent token: its scope, its person, its rate limit. */
  const backendFor = (p: PersonContext): McpBackend => {
    const scope = p.scope as AgentScope;
    return {
      async listTools() {
        return toMcpTools(manifestForScope(await p.manifest(), scope, excludedFor(p.id)));
      },
      async call(tool, args, ctx) {
        const manifest = await p.manifest();
        const entry: ToolManifestEntry | undefined = manifest.tools.find((t) => t.name === tool);
        const finish = (e: ToolResultEnvelope) => {
          record(p.id, { at: new Date(now()).toISOString(), tokenId: p.deviceId, tool: String(tool).slice(0, 64), outcome: outcomeOf(e) });
          return e;
        };
        if (!entry || !exposedTo(entry, 'mcp')) return finish(forbiddenEnvelope(tool));
        if (!scopeAllows(entry, scope)) {
          return finish(rejected('scope', `This agent's connection can ${SCOPE_WORDS[scope]}. The person can give it more in Settings › Agents.`));
        }
        if (excludedFor(p.id).has(entry.id)) return finish(rejected('not_on_server', `${entry.title} works only in the Vitals app, not through the server.`));
        const r = limiter.take(p.deviceId);
        if (!r.ok) return finish(rejected('rate_limited', `Too many tool calls in a minute. Wait ${r.retryAfterSec} s and try again.`));
        if (!args || typeof args !== 'object' || Array.isArray(args)) return finish(rejected('invalid_input', 'Tool arguments must be a JSON object.'));
        const envelope = await p.dispatch(entry.id, args as Record<string, unknown>, { kind: 'mcp', id: ctx.clientName }, {
          ...(entry.idempotency === 'key' ? { idempotencyKey: idempotencyKeyFor(ctx.clientName, ctx.scope, ctx.requestId) } : {}),
          ...(entry.confirm === 'edit' ? { stage: true } : {}),
        });
        if (answersNotOnServer(envelope)) {
          excludedFor(p.id).add(entry.id);
          mcp.toolsChanged(p.id);
        }
        return finish(envelope);
      },
    };
  };

  const deviceOnly = async (req: IncomingMessage): Promise<PersonContext> => {
    const r = await resolvePerson(req);
    if (isFailure(r)) throw new AiError(r.error);
    if (r.kind !== 'device') throw new AiError('wrong_kind');
    return r;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (path === '/mcp') {
      const r = await resolvePerson(req);
      if (isFailure(r)) throw new AiError(r.error);
      if (r.kind !== 'agent' || !AGENT_SCOPES.includes(r.scope as AgentScope)) throw new AiError('wrong_kind');
      if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) throw new AiError('not_found');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
      let body: unknown;
      if (req.method === 'POST') {
        try {
          body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
        } catch (e) {
          if (e instanceof HttpError) throw new AiError('too_large');
          return void sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
        }
      }
      return mcp.handle(req, res, { personId: r.id, tokenId: r.deviceId, label: r.label }, backendFor(r), body);
    }

    if (path === '/v1/agents/tokens') {
      const p = await deviceOnly(req);
      if (req.method === 'GET') {
        const list = await tokens.list(p.id, 'agent');
        return void sendJson(res, 200, {
          tokens: list.map((t) => ({ id: t.id, client: t.client ?? 'other', label: t.label, scope: t.scope, createdAt: t.createdAt, lastUsedAt: t.lastSeenAt })),
        });
      }
      if (req.method !== 'POST') throw new AiError('not_found');
      const body = await readJson(req, 4096).catch(() => {
        throw new AiError('bad_request');
      });
      const client = body.client as AgentClient;
      const scope = (body.scope ?? 'log') as AgentScope;
      if (!AGENT_CLIENTS.includes(client) || !AGENT_SCOPES.includes(scope)) throw new AiError('bad_request');
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : CLIENT_LABELS[client];
      const { token, record: rec } = await tokens.mint(p.id, { kind: 'agent', label, scope, client });
      log.addSecret(token);
      log(`agents: token ${rec.id} made for ${client} (person ${p.id}, scope ${scope})`);
      return void sendJson(res, 200, { token, id: rec.id, mcpUrl, recipes: agentRecipes(mcpUrl, client) });
    }
    // ids: 16 hex chars (file token store) or a UUID (the home role's device store)
    const del = /^\/v1\/agents\/tokens\/([0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path);
    if (del) {
      const p = await deviceOnly(req);
      if (req.method !== 'DELETE') throw new AiError('not_found');
      const mine = (await tokens.list(p.id, 'agent')).some((t) => t.id === del[1]);
      if (!mine || !(await tokens.revoke(p.id, del[1]!))) throw new AiError('not_found');
      await mcp.revokeToken(del[1]!);
      log(`agents: token ${del[1]} removed (person ${p.id})`);
      res.writeHead(204).end();
      return;
    }
    if (path === '/v1/agents/activity') {
      const p = await deviceOnly(req);
      if (req.method !== 'GET') throw new AiError('not_found');
      return void sendJson(res, 200, { activity: activity.get(p.id) ?? [] });
    }
    throw new AiError('not_found');
  };

  return {
    mcpUrl,
    owns: (path: string) => path === '/mcp' || path.startsWith('/v1/agents/'),
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
      try {
        await handle(req, res, path);
      } catch (e) {
        if (e instanceof AiError) return sendAiError(res, e);
        log(`agents: request failed (${e instanceof Error ? e.name : 'error'})`);
        if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'Something went wrong on your server. Try again.' } });
        else res.destroy();
      }
    },
    /** Tool names an agent token of this person and scope would see (for the tool-list test and status). */
    async toolNames(p: PersonContext, scope: AgentScope) {
      return manifestForScope(await p.manifest(), scope, excludedFor(p.id)).tools.map((t) => t.name);
    },
    activityOf: (personId: string) => activity.get(personId) ?? [],
    close: () => mcp.close(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// `agents register <agent> --remote <url>` (writes the recipe into the agent's own config, backup kept)

export interface RemoteRegisterResult {
  changed: boolean;
  lines: string[];
}

export async function registerRemoteAgent(
  sys: Sys,
  agent: 'codex' | 'opencode' | 'claude' | 'chatgpt-desktop',
  opts: { url: string; dryRun?: boolean },
): Promise<RemoteRegisterResult> {
  const url = normaliseMcpUrl(opts.url);
  switch (agent) {
    case 'chatgpt-desktop':
      throw new AgentConfigError(agentRecipes(url, 'chatgpt-desktop')[0]!.steps[0]!);
    case 'codex': {
      const path = codexConfigPath(sys);
      const before = (await sys.readText(path)) ?? '';
      const base = codexWithout(before).replace(/\n+$/, '');
      const after = `${base ? `${base}\n\n` : ''}${codexRemoteSnippet(url)}`;
      const envLine = `Set ${TOKEN_ENV} in the environment Codex starts from (the token is not written to the file).`;
      if (after === before) return { changed: false, lines: [`${path} already points at ${url}; nothing to do.`, envLine] };
      if (opts.dryRun) return { changed: false, lines: [`Would write to ${path}:`, codexRemoteSnippet(url), envLine] };
      const backup = await backupFile(sys, path);
      await sys.writeText(path, after, (await sys.stat(path))?.mode ?? 0o600);
      return { changed: true, lines: [`Set [mcp_servers.${MCP_NAME}] in ${path} to ${url}.`, ...(backup ? [`Backup: ${backup}`] : []), envLine] };
    }
    case 'opencode': {
      const path = opencodeConfigPath(sys);
      const text = await sys.readText(path);
      let cfg: Record<string, unknown> | null;
      try {
        cfg = text === null ? { $schema: 'https://opencode.ai/config.json' } : (JSON.parse(text) as Record<string, unknown>);
      } catch {
        cfg = null;
      }
      const entry = opencodeRemoteEntry(url);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new AgentConfigError(`${path} is not plain JSON; add this under "mcp" by hand: ${JSON.stringify({ [MCP_NAME]: entry })}`);
      const mcp = (cfg.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {}) as Record<string, unknown>;
      const envLine = `Set ${TOKEN_ENV} in the environment OpenCode starts from (the token is not written to the file).`;
      if (JSON.stringify(mcp[MCP_NAME]) === JSON.stringify(entry)) return { changed: false, lines: [`${path} already points at ${url}; nothing to do.`, envLine] };
      if (opts.dryRun) return { changed: false, lines: [`Would set mcp.${MCP_NAME} in ${path}:`, JSON.stringify(entry, null, 2), envLine] };
      const backup = await backupFile(sys, path);
      await sys.writeText(path, `${JSON.stringify({ ...cfg, mcp: { ...mcp, [MCP_NAME]: entry } }, null, 2)}\n`, (await sys.stat(path))?.mode ?? 0o600);
      return { changed: true, lines: [`Set mcp.${MCP_NAME} in ${path} to ${url}.`, ...(backup ? [`Backup: ${backup}`] : []), envLine] };
    }
    case 'claude': {
      const token = sys.env[TOKEN_ENV]?.trim();
      const shown = `claude ${claudeAddArgs(url).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
      if (opts.dryRun) return { changed: false, lines: [`Would run: ${shown}`] };
      if (!token) throw new AgentConfigError(`Set ${TOKEN_ENV} to the agent token first; Claude Code stores the header itself.`);
      const claude = await sys.which('claude');
      if (!claude) throw new AgentConfigError('Claude Code (claude) is not on PATH.');
      const r = await sys.run(claude, claudeAddArgs(url, token), { timeoutMs: 20_000 });
      if (r.code !== 0) {
        const first = (r.stderr || r.stdout).split(token).join('[token]').trim().split('\n')[0];
        throw new AgentConfigError(`claude mcp add failed: ${first}. If a "${MCP_NAME}" server is already there: claude mcp remove ${MCP_NAME} -s user`);
      }
      return { changed: true, lines: [`Ran: ${shown}`, `Undo: claude mcp remove ${MCP_NAME} -s user`] };
    }
  }
}

/** `https://host:8443` or `…/mcp` → `…/mcp`; only https, or http on loopback. */
export function normaliseMcpUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AgentConfigError(`Not a web address: ${raw}`);
  }
  const loopback = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new AgentConfigError('Use the https:// address of your server.');
  if (u.username || u.password || u.search || u.hash) throw new AgentConfigError('The address must not carry a name, password, query or fragment.');
  const path = u.pathname.replace(/\/+$/, '');
  u.pathname = path.endsWith('/mcp') ? path : `${path}/mcp`;
  return u.toString();
}
