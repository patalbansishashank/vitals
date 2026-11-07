/**
 * The server's AI and agent routes in one mount (SUITE_SPEC §14.3, §14.4): the server core calls `owns(path)` and
 * `handle(req, res, path, query)` after its own Host, Origin and CORS checks. `startAiServer` is a bare loopback
 * listener with the same mount, for tests and for checking agents against a real store before the server core is
 * wired; it is not the production server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createAgentRoutes, type AgentRoutesOptions } from './agentsRemote.ts';
import type { CoachConfig } from './coach/config.ts';
import { createCoachRoutes } from './coach/routes.ts';
import { createCoach, type CoachCaller, type CoachOptions, type CoachTokens } from './coach/sessions.ts';
import type { ResolvePerson, TokenStore } from './personContext.ts';
import { createProviderRoutes, type ProviderRoutesOptions } from './providers.ts';
import { createRedactingLogger, sendJson, type Logger } from './security.ts';

/** The server coach (`/v1/coach/*`), when the home role mounts it. */
export interface ServerCoachOptions {
  cfg: CoachConfig;
  /** Vitals device and Gauge lumen tokens → the caller; throws CoachError (401/403) otherwise. */
  resolve: (req: IncomingMessage) => Promise<CoachCaller>;
  /** The coach's tokens; `closeMcp` closes a removed token's open MCP sessions. */
  tokens: (closeMcp: (tokenId: string) => Promise<void>) => CoachTokens;
  mcpUrl: () => string | null;
  now?: () => number;
  backends?: CoachOptions['backends'];
}

export interface ServerAiOptions extends Omit<ProviderRoutesOptions, 'log'>, Omit<AgentRoutesOptions, 'log' | 'resolvePerson' | 'now' | 'onToolCall'> {
  resolvePerson: ResolvePerson;
  tokens: TokenStore;
  log: Logger;
  coach?: ServerCoachOptions;
}

export function createServerAi(opts: ServerAiOptions) {
  const providers = createProviderRoutes(opts);
  let observe: AgentRoutesOptions['onToolCall'];
  const agents = createAgentRoutes({ ...opts, onToolCall: (e) => observe?.(e) });
  const coach = opts.coach
    ? createCoach({
        cfg: opts.coach.cfg,
        tokens: opts.coach.tokens((id) => agents.revokeToken(id)),
        mcpUrl: opts.coach.mcpUrl,
        log: opts.log,
        ...(opts.coach.now ? { now: opts.coach.now } : {}),
        ...(opts.coach.backends ? { backends: opts.coach.backends } : {}),
      })
    : null;
  if (coach) observe = (e) => coach.onToolCall(e);
  const coachRoutes = coach && opts.coach ? createCoachRoutes({ coach, resolve: opts.coach.resolve, log: opts.log }) : null;
  return {
    mcpUrl: agents.mcpUrl,
    providers,
    agents,
    coach,
    owns: (path: string) => providers.owns(path) || agents.owns(path) || Boolean(coachRoutes?.owns(path)),
    async handle(req: IncomingMessage, res: ServerResponse, path: string, query = ''): Promise<void> {
      if (providers.owns(path)) return providers.handle(req, res, path, query);
      if (coachRoutes?.owns(path)) return coachRoutes.handle(req, res, path);
      return agents.handle(req, res, path);
    },
    async close() {
      providers.close();
      await coach?.close();
      await agents.close();
    },
  };
}

export async function startAiServer(
  opts: Omit<ServerAiOptions, 'log' | 'publicOrigin' | 'version'> & { log?: (line: string) => void; port?: number; version?: string; publicOrigin?: string },
): Promise<{ url: string; port: number; ai: ReturnType<typeof createServerAi>; close(): Promise<void> }> {
  const log = createRedactingLogger(opts.log);
  let ai: ReturnType<typeof createServerAi> | null = null;
  const server = createServer((req, res) => {
    const raw = req.url ?? '/';
    const q = raw.indexOf('?');
    const path = q === -1 ? raw : raw.slice(0, q);
    if (!ai?.owns(path)) return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
    ai.handle(req, res, path, q === -1 ? '' : raw.slice(q)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'internal' } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  // the MCP address in recipes follows the real port when no public origin was given
  const mounted = createServerAi({ ...opts, log, version: opts.version ?? '0.0.0-dev', publicOrigin: opts.publicOrigin ?? url });
  ai = mounted;
  return {
    url,
    port,
    ai: mounted,
    async close() {
      await mounted.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    },
  };
}
