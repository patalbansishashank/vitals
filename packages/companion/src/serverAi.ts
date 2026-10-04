/**
 * The server's AI and agent routes in one mount (SUITE_SPEC §14.3, §14.4): the server core calls `owns(path)` and
 * `handle(req, res, path, query)` after its own Host, Origin and CORS checks. `startAiServer` is a bare loopback
 * listener with the same mount, for tests and for checking agents against a real store before the server core is
 * wired; it is not the production server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createAgentRoutes, type AgentRoutesOptions } from './agentsRemote.ts';
import type { ResolvePerson, TokenStore } from './personContext.ts';
import { createProviderRoutes, type ProviderRoutesOptions } from './providers.ts';
import { createRedactingLogger, sendJson, type Logger } from './security.ts';

export interface ServerAiOptions extends Omit<ProviderRoutesOptions, 'log'>, Omit<AgentRoutesOptions, 'log' | 'resolvePerson' | 'now'> {
  resolvePerson: ResolvePerson;
  tokens: TokenStore;
  log: Logger;
}

export function createServerAi(opts: ServerAiOptions) {
  const providers = createProviderRoutes(opts);
  const agents = createAgentRoutes(opts);
  return {
    mcpUrl: agents.mcpUrl,
    providers,
    agents,
    owns: (path: string) => providers.owns(path) || agents.owns(path),
    async handle(req: IncomingMessage, res: ServerResponse, path: string, query = ''): Promise<void> {
      if (providers.owns(path)) return providers.handle(req, res, path, query);
      return agents.handle(req, res, path);
    },
    async close() {
      providers.close();
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
