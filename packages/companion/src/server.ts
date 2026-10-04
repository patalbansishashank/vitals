/**
 * Vitals Companion server (R7 §4.1, SUITE_SPEC §7.2): one HTTP server, one port.
 *
 * Relay role (`sync`, `serve`): Evolu relay at `/sync` (WebSocket), encrypted blob store at `/blobs/…`.
 * Proxy role (`proxy`, `serve`): local pairing, provider proxy, Sign in with ChatGPT, agent hub bridge and `/mcp`.
 * App (`serve`, or `sync --serve-app`): the static Vitals build at `/` with a narrow CSP.
 *
 * Every route checks Host (DNS rebinding) and Origin (403 outside the allow-list). Auth per route:
 * - none: `GET /health` (nothing secret), CORS preflights;
 * - the one-time pairing code: `POST /v1/pair/local`;
 * - their own Evolu / K_auth auth: `/sync`, `/blobs` (remote devices reach them over Tailscale);
 * - paired bearer (browser token from its bound origin, client or admin token without Origin): everything else;
 *   admin token only: `POST /v1/pair/code`, `POST /v1/pair/client`, `/v1/agent/manifest`, `/v1/agent/call`.
 */
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { parseOwnerIdFromOwnerWebSocketTransportUrl } from '@evolu/common/local-first';
import { createAgentHub, type AgentHub } from './agentHub.ts';
import { createAuth, type Auth, type PairingCode, type Principal } from './auth.ts';
import { createBlobHandler } from './blobs.ts';
import { BRIDGE_PATH } from './bridgeProtocol.ts';
import { defaultConfigDir } from './config.ts';
import { mountServerAi } from './home/aiMount.ts';
import { createMcpHttp } from './mcp.ts';
import { createKeyStore, createProxy, parseProxyPath, type Upstream } from './proxy.ts';
import { createRelayHost } from './relay.ts';
import {
  answerPreflight,
  API_ALLOW_HEADERS,
  applyCors,
  bearerOf,
  createOriginPolicy,
  createRateLimiter,
  createRedactingLogger,
  DEFAULT_RATE_LIMIT,
  busyError,
  HttpError,
  MCP_ALLOW_HEADERS,
  readBody,
  readJson,
  sendError,
  sendJson,
  type RateLimitOptions,
} from './security.ts';
import { createSiwc, type SiwcEndpoints } from './siwc.ts';
import { HOME_ALLOW_HEADERS, startHome, type HomeOptions, type HomeServer } from './home/home.ts';
import { createStaticHandler } from './static.ts';
import type { ToolManifest } from './toolManifest.ts';

export const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export type CompanionRole = 'relay' | 'proxy' | 'agent' | 'app';

export interface CompanionOptions {
  /** Bind address; loopback by default so only `tailscale serve` (or a local reverse proxy) can reach it. */
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  /** Defaults to `~/.vitals`. */
  dataDir?: string;
  /** Extra browser origins (https://vitals.creative.desi, loopback dev servers and the served app are always allowed). */
  allowedOrigins: string[];
  /** A Vitals `dist` directory to serve at `/`. */
  serveApp?: string;
  quotaBytesPerOwner?: number;
  maxBlobBytes?: number;
  /** Diagnostics; every line passes through the redacting logger. */
  log?: (line: string) => void;
  /** Evolu relay + `/blobs` (default true). */
  relay?: boolean;
  /** Pairing, provider proxy, Sign in with ChatGPT, agent hub and `/mcp` (default false). */
  agent?: boolean;
  /** User config directory for secrets (default: the OS user config dir, see config.ts). */
  configDir?: string;
  /** Tool manifest used for MCP while no tab is connected (`--manifest`). */
  manifest?: ToolManifest | null;
  /** User-facing lines that are not diagnostics (the Sign in with ChatGPT URL). */
  print?: (line: string) => void;
  fetch?: typeof globalThis.fetch;
  upstreams?: Record<string, Upstream>;
  siwcEndpoints?: Partial<SiwcEndpoints>;
  openBrowser?: (url: string) => void;
  env?: NodeJS.ProcessEnv;
  rateLimit?: RateLimitOptions;
  proxyMaxBodyBytes?: number;
  callTimeoutMs?: number;
  /**
   * What this computer has set up (agents with the Vitals MCP registered, Tailscale), added to `/v1/pair/status` for
   * Settings › Agents. The CLI passes a cached probe; omitted in tests unless a test sets it.
   */
  environment?: () => Promise<CompanionEnvironment>;
  /** The `home` role (SUITE_SPEC §14.1): persons, device tokens, person workers, the MQTT broker. */
  home?: Omit<HomeOptions, 'log' | 'version'>;
}

export interface CompanionEnvironment {
  agents?: Array<{ id: string; label: string; installed: boolean; version?: string; registered: boolean }>;
  tailscale?: { running: boolean; dnsName?: string; serveUrl?: string };
}

export interface Companion {
  port: number;
  url: string;
  roles: CompanionRole[];
  /** The pairing code minted at start (agent role only). */
  pairingCode: PairingCode | null;
  home: HomeServer | null;
  close(): Promise<void>;
}

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

function rejectUpgrade(socket: Duplex, status: number, text: string) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

interface AgentParts {
  auth: Auth;
  hub: AgentHub;
  proxy: ReturnType<typeof createProxy>;
  keys: ReturnType<typeof createKeyStore>;
  siwc: ReturnType<typeof createSiwc>;
  mcp: ReturnType<typeof createMcpHttp>;
  limiter: ReturnType<typeof createRateLimiter>;
}

export async function startCompanion(options: CompanionOptions): Promise<Companion> {
  const {
    host = '127.0.0.1',
    port = 4870,
    dataDir = join(homedir(), '.vitals'),
    allowedOrigins,
    serveApp,
    quotaBytesPerOwner = 10 * GiB,
    maxBlobBytes = 1 * MiB,
    relay: relayOn = true,
    agent: agentOn = false,
  } = options;
  const log = createRedactingLogger(options.log);
  const print = options.print ?? options.log ?? (() => undefined);
  const policy = createOriginPolicy({ allowedOrigins, bindHost: host });

  const relay = relayOn ? await (async () => {
    const dir = resolve(dataDir);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return { host: await createRelayHost({ dataDir: dir, quotaBytesPerOwner }), blobs: createBlobHandler({ dataDir: dir, maxBlobBytes, quotaBytesPerOwner }) };
  })() : null;
  const serveStatic = serveApp ? createStaticHandler(serveApp) : null;
  const home = options.home ? await startHome({ ...options.home, log, version: VERSION }) : null;
  // the server's AI and agent routes (§14.3, §14.4) on the home role's persons and tokens
  const ai = home
    ? mountServerAi(home, {
        publicOrigin: options.home?.publicOrigin ?? `http://${host}:${port}`,
        version: VERSION,
        log,
        ...(options.home?.ai?.requestsPerMinute !== undefined ? { aiRequestsPerMinute: options.home.ai.requestsPerMinute } : {}),
        ...(options.home?.ai?.requestsPerDay !== undefined ? { requestsPerDay: options.home.ai.requestsPerDay } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.upstreams ? { upstreams: options.upstreams } : {}),
      })
    : null;

  let agent: AgentParts | null = null;
  let pairingCode: PairingCode | null = null;
  if (agentOn) {
    const configDir = resolve(options.configDir ?? defaultConfigDir());
    const auth = await createAuth({ configDir, log });
    const keys = createKeyStore(configDir, options.env);
    const siwc = createSiwc({ configDir, log, endpoints: options.siwcEndpoints, fetch: options.fetch, openBrowser: options.openBrowser });
    const hub = createAgentHub({ auth, log, version: VERSION, fileManifest: options.manifest ?? null, callTimeoutMs: options.callTimeoutMs });
    agent = {
      auth,
      keys,
      siwc,
      hub,
      proxy: createProxy({ keys, siwc, log, fetch: options.fetch, upstreams: options.upstreams, maxBodyBytes: options.proxyMaxBodyBytes }),
      mcp: createMcpHttp({ hub, version: VERSION, log }),
      limiter: createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT),
    };
    pairingCode = auth.newCode();
  }
  const roles: CompanionRole[] = [...(relay ? (['relay'] as const) : []), ...(agent ? (['proxy', 'agent'] as const) : []), ...(serveStatic ? (['app'] as const) : [])];

  const requirePrincipal = (req: IncomingMessage, a: AgentParts, kinds?: Principal['kind'][]): Principal => {
    const p = a.auth.verify(bearerOf(req), req.headers.origin);
    if (!p || (kinds && !kinds.includes(p.kind))) throw new HttpError(401, 'unauthorized', 'Pair this browser or client with the Companion first', { 'WWW-Authenticate': 'Bearer' });
    return p;
  };
  const rateLimit = (a: AgentParts, p: Principal) => {
    const r = a.limiter.take(p.id);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(r.retryAfterSec) });
  };
  const method = (req: IncomingMessage, ...allowed: string[]) => {
    if (!allowed.includes(req.method ?? '')) throw new HttpError(405, 'method', `Use ${allowed.join(' or ')}`, { Allow: allowed.join(', ') });
  };

  const handleAgent = async (req: IncomingMessage, res: ServerResponse, a: AgentParts, path: string, query: string): Promise<boolean | void> => {
    const isMcp = path === '/mcp';
    const proxyRoute = parseProxyPath(path);
    if (!isMcp && !path.startsWith('/v1/') && !proxyRoute) return false;
    if (req.method === 'OPTIONS') {
      return answerPreflight(res, isMcp ? 'GET, POST, DELETE' : 'GET, POST', isMcp ? MCP_ALLOW_HEADERS : API_ALLOW_HEADERS);
    }

    switch (path) {
      case '/v1/pair/local': {
        method(req, 'POST');
        const origin = req.headers.origin;
        if (!origin) throw new HttpError(400, 'origin_required', 'Pairing is for browser tabs; CLI clients use `vitals-companion pair --client <name>`');
        const body = await readJson(req, 4096);
        const r = await a.auth.pair(String(body.code ?? ''), origin, typeof body.label === 'string' ? body.label : undefined);
        if (r.ok) return void sendJson(res, 200, { token: r.token });
        const status = { invalid_code: 401, expired: 410, locked: 429, no_code: 409 }[r.error];
        return void sendJson(res, status, { error: r.error, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) });
      }
      case '/v1/pair/code': {
        method(req, 'POST');
        requirePrincipal(req, a, ['admin']);
        const c = a.auth.newCode();
        return void sendJson(res, 200, { code: c.code, expiresAt: new Date(c.expiresAt).toISOString() });
      }
      case '/v1/pair/client': {
        method(req, 'POST');
        requirePrincipal(req, a, ['admin']);
        const body = await readJson(req, 4096);
        const name = typeof body.name === 'string' ? body.name : '';
        if (!name.trim()) throw new HttpError(400, 'name_required', 'Give the client a name');
        return void sendJson(res, 200, { token: await a.auth.mintClientToken(name) });
      }
      case '/v1/pair/status': {
        method(req, 'GET');
        requirePrincipal(req, a);
        const keys = await a.keys.configured();
        const s = await a.siwc.status();
        return void sendJson(res, 200, {
          ok: true,
          version: VERSION,
          roles,
          presets: { siwc: s, nim: { configured: keys.nim ?? false }, 'opencode-zen': { configured: keys['opencode-zen'] ?? false } },
          tab: a.hub.tab(),
          mcpClients: a.hub.clients(),
          ...(options.environment ? await options.environment().catch(() => ({})) : {}),
        });
      }
      case '/v1/ai/siwc/login': {
        method(req, 'POST');
        rateLimit(a, requirePrincipal(req, a));
        await readBody(req, 4096);
        const l = await a.siwc.login();
        print(`Sign in with ChatGPT: complete the sign-in in your browser. If it did not open, visit:\n  ${l.authorizeUrl}`);
        return void sendJson(res, 202, { started: true });
      }
      case '/v1/ai/siwc/status': {
        method(req, 'GET');
        requirePrincipal(req, a);
        const s = await a.siwc.status();
        return void sendJson(res, 200, { signedIn: s.signedIn, expiresAt: s.expiresAt ?? null });
      }
      case '/v1/ai/siwc/logout': {
        method(req, 'POST');
        requirePrincipal(req, a);
        await readBody(req, 4096);
        await a.siwc.logout();
        return void sendJson(res, 200, { signedIn: false });
      }
      case '/v1/agent/manifest': {
        method(req, 'GET');
        requirePrincipal(req, a, ['admin']);
        return void sendJson(res, 200, { manifest: a.hub.manifest(), tab: a.hub.tab() });
      }
      case '/v1/agent/call': {
        method(req, 'POST');
        requirePrincipal(req, a, ['admin']);
        const body = await readJson(req, 1 * MiB);
        if (typeof body.tool !== 'string') throw new HttpError(400, 'tool_required', 'tool is required');
        const requestId = typeof body.requestId === 'string' || typeof body.requestId === 'number' ? body.requestId : String(Date.now());
        const envelope = await a.hub.call({
          tool: body.tool,
          args: body.args,
          clientName: typeof body.clientName === 'string' && body.clientName ? body.clientName.slice(0, 64) : 'mcp-stdio',
          scope: typeof body.scope === 'string' ? body.scope.slice(0, 64) : 'stdio',
          requestId,
        });
        return void sendJson(res, 200, { envelope });
      }
      case '/mcp': {
        method(req, 'GET', 'POST', 'DELETE');
        const p = requirePrincipal(req, a, ['admin', 'client']);
        res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
        let body: unknown;
        if (req.method === 'POST') {
          try {
            body = JSON.parse((await readBody(req, 4 * MiB)).toString('utf8'));
          } catch (e) {
            if (e instanceof HttpError) throw e;
            return void sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
          }
        }
        return a.mcp.handle(req, res, p, body);
      }
    }

    if (proxyRoute) {
      const p = requirePrincipal(req, a);
      if (!a.proxy.has(proxyRoute.preset, proxyRoute.path)) throw new HttpError(404, 'unknown_route', 'Unknown preset or path');
      rateLimit(a, p);
      return a.proxy.handle(req, res, proxyRoute.preset, proxyRoute.path, query);
    }
    throw new HttpError(404, 'not_found', 'Not found');
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? '/';
    const q = rawUrl.indexOf('?');
    const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
    const query = q === -1 ? '' : rawUrl.slice(q);
    res.setHeader('Vary', 'Origin');
    if (!(home ?? policy).hostAllowed(req)) return sendJson(res, 403, { error: 'host not allowed' });
    const origin = home ? home.originCheck(req) : policy.check(req);
    if (origin === 'forbidden') return sendJson(res, 403, { error: 'origin not allowed' });
    const isBlobs = rawPath.startsWith('/blobs/') || rawPath === '/blobs';
    if (origin === 'allowed' && (rawPath === '/health' || rawPath.startsWith('/v1/') || rawPath.startsWith('/proxy/') || rawPath === '/mcp' || (relay && isBlobs))) {
      applyCors(req, res, isBlobs ? 'ETag' : rawPath === '/mcp' ? 'Retry-After, mcp-session-id' : 'Retry-After');
    }

    if (rawPath === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method' });
      const ownerCount = relay ? Math.max(relay.host.ownerCount(), await relay.blobs.ownerCount()) : 0;
      return sendJson(res, 200, { version: VERSION, role: home ? 'home' : 'relay', roles, ownerCount, ...(home ? await home.health() : { persons: 0, mqtt: 'off' }) });
    }
    if (home) {
      try {
        if (await home.handle(req, res, rawPath, query)) return;
        if (ai?.owns(rawPath)) {
          if (req.method === 'OPTIONS') return answerPreflight(res, 'GET, POST, PUT, DELETE', HOME_ALLOW_HEADERS);
          return await ai.handle(req, res, rawPath, query);
        }
      } catch (e) {
        if (e instanceof HttpError) return sendError(res, e);
        const busy = busyError(e);
        if (busy) return sendError(res, busy);
        throw e;
      }
    }
    if (relay && isBlobs) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'PUT, GET, HEAD',
          'Access-Control-Allow-Headers': 'Authorization, If-None-Match, Content-Type',
          'Access-Control-Max-Age': '600',
          // Chrome Local Network Access / Private Network Access preflights.
          'Access-Control-Allow-Private-Network': 'true',
        });
        return void res.end();
      }
      return relay.blobs.handle(req, res, rawPath);
    }
    if (relay && rawPath === '/sync') return sendJson(res, 426, { error: 'WebSocket upgrade required' });
    if (agent) {
      if (rawPath === BRIDGE_PATH) return sendJson(res, 426, { error: 'WebSocket upgrade required' });
      try {
        if ((await handleAgent(req, res, agent, rawPath, query)) !== false) return;
      } catch (e) {
        if (e instanceof HttpError) return sendError(res, e);
        throw e;
      }
    }
    if (serveStatic) return serveStatic(req, res, rawPath);
    return sendJson(res, 404, { error: 'not found' });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      log(`request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      else res.destroy();
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => undefined);
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (!(home ?? policy).hostAllowed(req)) return rejectUpgrade(socket, 403, 'Forbidden');
    const origin = home ? home.originCheck(req) : policy.check(req);
    if (origin === 'forbidden') {
      log(`rejected WebSocket from a foreign origin`);
      return rejectUpgrade(socket, 403, 'Forbidden');
    }
    if (relay && path === '/sync') {
      if (!parseOwnerIdFromOwnerWebSocketTransportUrl(url)) return rejectUpgrade(socket, 400, 'Bad Request');
      return relay.host.handleUpgrade(req, socket, head);
    }
    if (home?.upgrade(req, socket, head, path ?? '')) return;
    if (agent && path === BRIDGE_PATH) {
      // The bridge is for browser tabs only: the `hello` token is checked against this Origin.
      if (origin !== 'allowed') return rejectUpgrade(socket, 403, 'Forbidden');
      return agent.hub.handleUpgrade(req, socket, head);
    }
    return rejectUpgrade(socket, 404, 'Not Found');
  });

  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolveListen();
      });
    });
  } catch (e) {
    // EADDRINUSE and friends: release the relay database and the agent parts before the caller reports the error.
    if (agent) {
      agent.siwc.close();
      await agent.mcp.close();
      await agent.hub.close();
    }
    await ai?.close();
    await home?.close();
    await relay?.host.close();
    throw e;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  const url = `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;

  let closing: Promise<void> | null = null;
  return {
    port: address.port,
    url,
    roles,
    pairingCode,
    home,
    close() {
      closing ??= (async () => {
        if (agent) {
          agent.siwc.close();
          await agent.mcp.close();
          await agent.hub.close();
        }
        await ai?.close();
        await home?.close();
        await relay?.host.close();
        await new Promise<void>((r) => {
          server.close(() => r());
          server.closeAllConnections();
        });
      })();
      return closing;
    },
  };
}
