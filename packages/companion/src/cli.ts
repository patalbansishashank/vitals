/** `vitals-companion …` command line. */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentConfigError, AGENT_IDS, detectAgents, parseAgentId, registerAgent, unregisterAgent } from './agents.ts';
import { defaultConfigDir, readAdminToken } from './config.ts';
import { detectTailscale, doctorPassed, formatDoctor, readOpencodeZenKey, runDoctor } from './doctor.ts';
import { DEFAULT_HTTPS_PORT, defaultDataDir, installWrapper, packageRoot, serveCommand, unitFile, writeUnit, type ServiceRole } from './install.ts';
import { nodeSys, type Sys } from './sys.ts';
import { createMcpServer, remoteBackend } from './mcp.ts';
import { createKeyStore, KEY_PRESETS, UPSTREAMS } from './proxy.ts';
import { createRedactingLogger } from './security.ts';
import { startCompanion, VERSION, type Companion } from './server.ts';
import { createSiwc } from './siwc.ts';
import { runServerAiCli } from './serverCli.ts';
import { parseToolManifest, type ToolManifest } from './toolManifest.ts';

export const DEFAULT_ORIGINS = ['https://vitals.creative.desi', 'http://localhost:5173', 'http://localhost:4173'];
export const DEFAULT_PORT = 4870;

const HELP = `vitals-companion ${VERSION}

Usage:
  vitals-companion sync [options]   Run the sync relay, blob store and (optionally) the Vitals app
  vitals-companion serve [options]  Serve a Vitals build with the relay, AI proxy, pairing and agent hub on one port
  vitals-companion proxy [options]  AI proxy, pairing, agent hub and /mcp only (no relay, no app)
  vitals-companion pair [--client <name>]
                                    Print a fresh pairing code from the running Companion, or mint a token for an
                                    MCP client that connects over HTTP (printed once)
  vitals-companion mcp [--manifest <file>]
                                    MCP over stdio for Claude, Codex, Hermes, OpenClaw (forwards to the running Companion)
  vitals-companion keys set|list|remove [<preset>]
                                    Provider keys for ${KEY_PRESETS.join(', ')} (set reads the key from stdin, hidden)
  vitals-companion siwc login|status|logout
                                    Sign in with ChatGPT (tokens stay in the Companion's config directory)
  vitals-companion doctor [--json] [--server <url>]
                                    Check this computer: Node, config, port, Tailscale, sync server, agents, keys
  vitals-companion install [--bin-dir <dir>] [--force] [--dry-run]
                                    Put a vitals-companion wrapper on PATH (default ~/.local/bin)
  vitals-companion service [--role sync|proxy|serve] [--write] [--https-port <n>]
                                    Print (or write) a systemd user unit and the tailscale serve command
  vitals-companion agents status|register|unregister [codex|opencode|claude|chatgpt] [--dry-run]
                                    Add the Vitals MCP server to an agent's own config (backup kept)
  vitals-companion keys import opencode-zen
                                    Copy the OpenCode Zen key from OpenCode's own store (never printed)
  vitals-companion siwc export [--out <file>]      On the PC: move the ChatGPT sign-in into a file for the server
  vitals-companion siwc import|login|status|logout <person> …   On the server (--data-dir <dir>): sign a person in with ChatGPT
  vitals-companion keys set|list|remove|import <person> [<preset>|<file>]   On the server: one person's provider keys
  vitals-companion agent-token create|list|revoke <person> …    On the server: tokens for Codex, OpenCode, Claude Code
  vitals-companion agents register <agent> --remote <https url> [--dry-run]   Point an agent at the server's MCP address
  vitals-companion --help | --version

Options for sync:
  --port <n>          Port to listen on (default ${DEFAULT_PORT})
  --host <addr>       Address to bind (default 127.0.0.1, loopback only; --listen is the same)
  --data <dir>        Data directory (default ${defaultDataDir(nodeSys())}; ~/.vitals if that already exists)
  --origin <url>      Extra browser origin allowed to connect (repeatable). Always allowed:
                      ${DEFAULT_ORIGINS.join(', ')} and the served app itself
  --serve-app <dist>  Serve a Vitals build directory at /

Options for serve and proxy (plus --port, --host, --data, --origin above):
  --dist <dir>        Vitals build to serve (serve only; default ./dist)
  --config-dir <dir>  Where pairings, keys and sign-in tokens live (default: ${defaultConfigDir()})
  --manifest <file>   Tool manifest for MCP while no Vitals tab is connected

Options for pair, mcp, keys, siwc:
  --url <url>         Running Companion (default http://127.0.0.1:${DEFAULT_PORT}; or use --host/--port)
  --config-dir <dir>  As above; must match the running Companion's
  --client <name>     pair: mint a named MCP client token instead of a pairing code
  --manifest <file>   mcp: tools to list when the Companion is not running
`;

const expandHome = (p: string) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

export interface CliIo {
  /** Diagnostics and prompts (stderr). */
  err?: (line: string) => void;
  stdin?: NodeJS.ReadStream;
  /** Called with the running Companion (tests close it). */
  onStarted?: (companion: Companion) => void;
  /** Do not install SIGINT/SIGTERM handlers (tests). */
  noSignals?: boolean;
  /** The OS probes for doctor, install, service and agents (tests stub them). */
  sys?: Sys;
}

const COMMANDS: Record<string, readonly string[] | null> = {
  sync: null,
  serve: null,
  proxy: null,
  pair: null,
  mcp: null,
  doctor: null,
  install: null,
  service: null,
  agents: ['status', 'register', 'unregister'],
  keys: ['set', 'list', 'remove', 'import'],
  siwc: ['login', 'status', 'logout'],
};

export function parseCli(argv: string[]) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      port: { type: 'string' },
      host: { type: 'string' },
      data: { type: 'string' },
      origin: { type: 'string', multiple: true },
      'serve-app': { type: 'string' },
      dist: { type: 'string' },
      'config-dir': { type: 'string' },
      manifest: { type: 'string' },
      client: { type: 'string' },
      url: { type: 'string' },
      listen: { type: 'string' },
      json: { type: 'boolean' },
      server: { type: 'string' },
      'bin-dir': { type: 'string' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      role: { type: 'string' },
      write: { type: 'boolean' },
      'https-port': { type: 'string' },
    },
  });
  const { values, positionals } = parsed;
  const [command, sub, arg, ...extra] = positionals;
  return { values, positionals, command, sub, arg, extra };
}

async function loadManifest(file: string): Promise<ToolManifest> {
  return parseToolManifest(JSON.parse(await readFile(resolve(expandHome(file)), 'utf8')));
}

/** Reads a secret from stdin without echo (TTY) or from a pipe. */
async function readSecret(stdin: NodeJS.ReadStream, prompt: (s: string) => void): Promise<string> {
  if (!stdin.isTTY) {
    const parts: Buffer[] = [];
    for await (const c of stdin as AsyncIterable<Buffer>) parts.push(c);
    return Buffer.concat(parts).toString('utf8').trim();
  }
  prompt('(input hidden) ');
  return new Promise((resolveSecret, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (e?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      prompt('\n');
      if (e) reject(e);
      else resolveSecret(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Runs the CLI; resolves once the server is up (sync, serve, proxy, mcp) or the output is printed. Returns the exit code. */
export async function main(argv: string[], out: (line: string) => void = (l) => process.stdout.write(`${l}\n`), io: CliIo = {}): Promise<number> {
  const err = io.err ?? ((l: string) => process.stderr.write(`${l}\n`));
  const handled = await runServerAiCli(argv, out, io);
  if (handled !== null) return handled;
  let cli;
  try {
    cli = parseCli(argv);
  } catch (e) {
    out(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals, command, sub, arg, extra } = cli;
  if (values.version) {
    out(VERSION);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    out(HELP);
    return values.help ? 0 : 2;
  }
  const subs = command !== undefined && command in COMMANDS ? COMMANDS[command] : undefined;
  const maxPositionals = subs ? ((command === 'keys' && sub !== 'list') || (command === 'agents' && sub !== 'status') ? 3 : 2) : 1;
  if (subs === undefined || positionals.length > maxPositionals || (subs && (!sub || !subs.includes(sub))) || extra.length) {
    out(`Unknown command: ${positionals.join(' ')}\n\n${HELP}`);
    return 2;
  }
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    out(`Invalid --port: ${values.port}`);
    return 2;
  }
  const host = values.host ?? values.listen ?? '127.0.0.1';
  const configDir = resolve(expandHome(values['config-dir'] ?? defaultConfigDir()));
  const companionUrl = (values.url ?? `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`).replace(/\/+$/, '');

  const sys = io.sys ?? nodeSys();
  if (command === 'doctor') {
    const report = await runDoctor(sys, { version: VERSION, configDir, port, server: values.server, dataDir: values.data ? resolve(expandHome(values.data)) : undefined });
    if (values.json) out(JSON.stringify(report, null, 2));
    else for (const l of formatDoctor(report)) out(l);
    return doctorPassed(report) ? 0 : 1;
  }
  if (command === 'install') {
    const r = await installWrapper(sys, { binDir: values['bin-dir'] ? resolve(expandHome(values['bin-dir'])) : undefined, force: values.force, dryRun: values['dry-run'] });
    for (const l of r.lines) out(l);
    return r.changed || r.lines[0]!.includes('already') || values['dry-run'] ? 0 : 1;
  }
  if (command === 'service') return serviceCommand(sys, values, port, configDir, out);
  if (command === 'agents') return agentsCommand(sys, sub!, arg, values['dry-run'] === true, out);
  if (command === 'keys' && sub === 'import') return keysImport(sys, arg, configDir, out);
  if (command === 'keys') return keysCommand(sub!, arg, configDir, out, err, io.stdin ?? process.stdin);
  if (command === 'siwc') return siwcCommand(sub!, configDir, out, err);
  if (command === 'pair') return pairCommand(companionUrl, configDir, values.client, out);

  let manifest: ToolManifest | null = null;
  if (values.manifest) {
    try {
      manifest = await loadManifest(values.manifest);
    } catch (e) {
      (command === 'mcp' ? err : out)(`Could not load --manifest: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  if (command === 'mcp') {
    // stdout carries MCP JSON-RPC only; everything else goes to stderr.
    const log = createRedactingLogger((l) => err(`vitals-companion mcp: ${l}`));
    const server = createMcpServer(remoteBackend({ url: companionUrl, adminToken: await readAdminToken(configDir), fileManifest: manifest, log }), {
      version: VERSION,
      fallbackClientName: 'mcp-stdio',
      scope: (() => {
        const scope = randomUUID();
        return () => scope;
      })(),
    });
    await server.connect(new StdioServerTransport());
    return 0;
  }

  const serveApp =
    command === 'serve' ? resolve(expandHome(values.dist ?? 'dist')) : command === 'sync' && values['serve-app'] ? resolve(expandHome(values['serve-app'])) : undefined;
  if (command === 'serve' && !(await stat(join(serveApp!, 'index.html')).catch(() => null))?.isFile()) {
    out(`No Vitals build at ${serveApp} (index.html missing). Build it with \`pnpm build\` or pass --dist <dir>.`);
    return 2;
  }
  const agent = command !== 'sync';
  let companion: Companion;
  try {
    companion = await startCompanion({
    host,
    port,
    dataDir: resolve(expandHome(values.data ?? (existsSync(join(homedir(), '.vitals')) ? '~/.vitals' : defaultDataDir(sys)))),
    allowedOrigins: [...DEFAULT_ORIGINS, ...(values.origin ?? [])],
    serveApp,
    relay: command !== 'proxy',
    agent,
    configDir,
    manifest,
    log: (line) => out(line),
    ...(agent ? { environment: cachedEnvironment(sys, port) } : {}),
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw e;
    // A plain answer instead of a Node stack: usually a Companion is already running (the common case after a reboot
    // of the terminal, or when another window started one).
    const other = await probeOtherCompanion(host, port);
    if (other) {
      out(`A Companion is already running on ${other.url} (version ${other.version}, roles ${other.roles.join(', ')}).`);
      out(`  To pair this browser with it, run: vitals-companion pair`);
      out(`  To run a second one, choose another port: vitals-companion ${command} --port ${port + 1}`);
    } else {
      out(`Port ${port} on ${host} is in use by another program. Choose another port: vitals-companion ${command} --port ${port + 1}`);
    }
    return 2;
  }
  io.onStarted?.(companion);

  out(`Vitals Companion ${VERSION} listening on ${companion.url}`);
  if (command === 'sync') {
    out(`  sync relay  ${companion.url.replace(/^http/, 'ws')}/sync`);
    out(`  blob store  ${companion.url}/blobs/`);
    if (serveApp) out(`  app         ${companion.url}/ (from ${serveApp})`);
  } else {
    if (serveApp) out(`  app           ${companion.url}/ (from ${serveApp})`);
    if (command === 'serve') {
      out(`  sync relay    ${companion.url.replace(/^http/, 'ws')}/sync`);
      out(`  blob store    ${companion.url}/blobs/`);
    }
    out(`  AI proxy      ${companion.url}/v1/ai/<preset>/… (${Object.keys(UPSTREAMS).join(', ')})`);
    out(`  agent bridge  ${companion.url.replace(/^http/, 'ws')}/v1/agent/bridge`);
    out(`  MCP           ${companion.url}/mcp (or \`vitals-companion mcp\` over stdio)`);
    out(`  config        ${configDir}`);
    if (manifest) out(`  tool manifest ${manifest.tools.length} tools from ${values.manifest}`);
    out('');
    const code = companion.pairingCode!;
    out(`Pairing code: ${code.code}  (single use, expires in 10 minutes)`);
    out('  Enter it in Vitals › Settings › Companion. For a new code run: vitals-companion pair');
  }
  out('');
  if (command !== 'proxy') {
    out('Reach it from your other devices with Tailscale:');
    out(`  1. ${serveCommand(companion.port, DEFAULT_HTTPS_PORT)}`);
    out(`     (port ${DEFAULT_HTTPS_PORT}, so a web server already on this machine's port 443 keeps its sites; use --https=443 if nothing else serves there)`);
    if (serveApp) out('  2. Open https://<this-machine>.<tailnet>.ts.net on each device to use Vitals from here,');
    out(`  ${serveApp ? '3' : '2'}. In Vitals › Settings › Sync, enter https://<this-machine>.<tailnet>.ts.net:${DEFAULT_HTTPS_PORT} as the sync address.`);
    out('Notes: HTTPS certificates must be enabled in the tailnet admin console (DNS › HTTPS Certificates).');
    out('       The machine name appears in public certificate transparency logs.');
  }
  out('Press Ctrl-C to stop.');

  if (io.noSignals) return 0;
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(130);
    stopping = true;
    out(`\n${signal}: shutting down…`);
    companion.close().then(
      () => process.exit(0),
      (e: unknown) => {
        out(`shutdown failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  return 0;
}

async function pairCommand(url: string, configDir: string, client: string | undefined, out: (l: string) => void): Promise<number> {
  const admin = await readAdminToken(configDir);
  if (!admin) {
    out(`No admin token in ${configDir}. Start the Companion first (vitals-companion serve or proxy), with the same --config-dir.`);
    return 1;
  }
  const path = client !== undefined ? '/v1/pair/client' : '/v1/pair/code';
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(client !== undefined ? { name: client } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    out(`The Companion is not running at ${url}. Start it with: vitals-companion serve (or proxy)`);
    return 1;
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; token?: string; error?: string; message?: string };
  if (!res.ok) {
    out(`Pairing failed: ${body.message ?? body.error ?? res.status}`);
    return 1;
  }
  if (body.token) {
    out(`MCP client token for "${client}" (shown once; it is a Vitals local token, not a provider secret):`);
    out(body.token);
    out(`Use it as "Authorization: Bearer <token>" for ${url}/mcp`);
  } else {
    out(`Pairing code: ${body.code}  (single use, expires in 10 minutes)`);
  }
  return 0;
}

async function keysCommand(sub: string, preset: string | undefined, configDir: string, out: (l: string) => void, err: (l: string) => void, stdin: NodeJS.ReadStream): Promise<number> {
  const keys = createKeyStore(configDir);
  if (sub === 'list') {
    const sources = await keys.sources();
    for (const id of KEY_PRESETS) {
      const s = sources[id];
      out(`${id.padEnd(14)} ${s ? `configured (${s === 'env' ? 'environment' : 'keys.json'})` : 'not configured'}`);
    }
    return 0;
  }
  if (!preset || !KEY_PRESETS.includes(preset)) {
    out(`Usage: vitals-companion keys ${sub} <${KEY_PRESETS.join('|')}>`);
    return 2;
  }
  if (sub === 'remove') {
    out((await keys.remove(preset)) ? `Removed the ${preset} key.` : `No ${preset} key in keys.json.`);
    return 0;
  }
  err(`Paste the ${UPSTREAMS[preset]!.label} API key, then press Enter.`);
  let key: string;
  try {
    key = await readSecret(stdin, (s) => process.stderr.write(s));
  } catch {
    out('Cancelled.');
    return 1;
  }
  if (!/^[\x21-\x7e]{8,512}$/.test(key)) {
    out('That does not look like an API key (8–512 printable characters, no spaces). Nothing saved.');
    return 1;
  }
  await keys.set(preset, key);
  out(`Saved the ${preset} key to ${join(configDir, 'keys.json')} (readable by you only).`);
  return 0;
}

async function siwcCommand(sub: string, configDir: string, out: (l: string) => void, err: (l: string) => void): Promise<number> {
  const log = createRedactingLogger(err);
  const siwc = createSiwc({ configDir, log });
  if (sub === 'status') {
    const s = await siwc.status();
    out(s.signedIn ? `Signed in with ChatGPT (access token renews automatically; current one expires ${s.expiresAt}).` : 'Not signed in. Run: vitals-companion siwc login');
    return 0;
  }
  if (sub === 'logout') {
    await siwc.logout();
    out('Signed out. To disconnect Vitals from your ChatGPT account entirely, use ChatGPT › Settings › Security and login.');
    return 0;
  }
  const login = await siwc.login();
  out('Opening your browser to sign in with ChatGPT. If it does not open, visit:');
  out(`  ${login.authorizeUrl}`);
  try {
    await login.done;
  } catch (e) {
    out(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  out('Signed in with ChatGPT. Vitals can now use your plan through this Companion.');
  return 0;
}

/** Agents and Tailscale for `/v1/pair/status`, probed at most once a minute (the probes start programs). */
function cachedEnvironment(sys: Sys, port: number) {
  let last: { at: number; value: Promise<Awaited<ReturnType<typeof probe>>> } | null = null;
  const probe = async () => {
    const [agents, ts] = await Promise.all([detectAgents(sys), detectTailscale(sys, port)]);
    return {
      agents: agents.map(({ id, label, installed, version, registered }) => ({ id, label, installed, version, registered })),
      tailscale: { running: ts.running, dnsName: ts.dnsName, serveUrl: ts.serveUrl },
    };
  };
  return () => {
    if (!last || Date.now() - last.at > 60_000) last = { at: Date.now(), value: probe() };
    return last.value;
  };
}

async function serviceCommand(sys: Sys, values: ReturnType<typeof parseCli>['values'], port: number, configDir: string, out: (l: string) => void): Promise<number> {
  const role = (values.role ?? 'sync') as ServiceRole;
  if (!['sync', 'proxy', 'serve'].includes(role)) {
    out('Usage: vitals-companion service [--role sync|proxy|serve] [--write]');
    return 2;
  }
  const httpsPort = values['https-port'] === undefined ? DEFAULT_HTTPS_PORT : Number(values['https-port']);
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
    out(`Invalid --https-port: ${values['https-port']}`);
    return 2;
  }
  const dataDir = values.data ? resolve(expandHome(values.data)) : defaultDataDir(sys);
  const unit = unitFile({
    role,
    nodePath: sys.execPath,
    root: packageRoot(),
    port,
    dataDir,
    configDir,
    dist: role === 'serve' ? resolve(expandHome(values.dist ?? 'dist')) : undefined,
  });
  if (values.write) {
    const r = await writeUnit(sys, unit, { dryRun: values['dry-run'], dataDir, configDir });
    for (const l of r.lines) out(l);
  } else {
    out(unit);
  }
  out('Then run:');
  out('  systemctl --user daemon-reload && systemctl --user enable --now vitals-companion');
  out(`  ${serveCommand(port, httpsPort)}`);
  out(`  curl -s https://<this-machine>.<tailnet>.ts.net${httpsPort === 443 ? '' : `:${httpsPort}`}/health`);
  return 0;
}

async function agentsCommand(sys: Sys, sub: string, name: string | undefined, dryRun: boolean, out: (l: string) => void): Promise<number> {
  if (sub === 'status') {
    for (const a of await detectAgents(sys)) {
      out(`${a.label.padEnd(20)} ${a.installed ? `${a.version ?? 'installed'}`.padEnd(14) : 'not installed '} ${a.installed ? (a.registered ? `vitals registered (${a.configPath})` : 'vitals not registered') : ''}`.trimEnd());
    }
    return 0;
  }
  const id = parseAgentId(name);
  if (!id) {
    out(`Usage: vitals-companion agents ${sub} <${AGENT_IDS.join('|').replace('chatgpt-desktop', 'chatgpt')}>`);
    return 2;
  }
  const command = (await sys.which('vitals-companion')) ?? 'vitals-companion';
  try {
    const r = sub === 'register' ? await registerAgent(sys, id, { command, dryRun }) : await unregisterAgent(sys, id, { dryRun });
    for (const l of r.lines) out(l);
    if (sub === 'register' && command === 'vitals-companion') out('Note: vitals-companion is not on PATH yet; run vitals-companion install so the agent can start it.');
    return 0;
  } catch (e) {
    if (e instanceof AgentConfigError) {
      out(e.message);
      return 1;
    }
    throw e;
  }
}

async function keysImport(sys: Sys, preset: string | undefined, configDir: string, out: (l: string) => void): Promise<number> {
  if (preset !== 'opencode-zen') {
    out('Usage: vitals-companion keys import opencode-zen');
    return 2;
  }
  const key = await readOpencodeZenKey(sys);
  if (!key) {
    out("No OpenCode Zen key in OpenCode's store. Sign in there first (opencode auth login, provider OpenCode Zen), or run: vitals-companion keys set opencode-zen");
    return 1;
  }
  await createKeyStore(configDir).set('opencode-zen', key);
  out(`Copied the OpenCode Zen key into ${join(configDir, 'keys.json')} (readable by you only; the key was not shown).`);
  return 0;
}

/** `GET /health` of whatever listens on host:port; a Companion answers with its version and roles. */
async function probeOtherCompanion(host: string, port: number): Promise<{ url: string; version: string; roles: string[] } | null> {
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown; roles?: unknown };
    if (typeof body.version !== 'string' || !Array.isArray(body.roles)) return null;
    return { url, version: body.version, roles: body.roles.map(String) };
  } catch {
    return null;
  }
}
