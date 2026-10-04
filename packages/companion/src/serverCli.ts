/**
 * Server-side CLI commands of `vitals-companion` (SUITE_SPEC §14.1, §14.3): moving the ChatGPT sign-in to a server,
 * per-person provider keys, agent tokens and remote agent registration. `runServerAiCli` returns null when the
 * arguments are not one of these commands, so `cli.ts` keeps handling everything else. Nothing here prints a key or
 * token, except `agent-token create`, which prints the new agent token once on its own line.
 */
import { homedir, hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AgentConfigError } from './agents.ts';
import { agentRecipes, CLIENT_LABELS, normaliseMcpUrl, registerRemoteAgent, TOKEN_ENV } from './agentsRemote.ts';
import { defaultConfigDir } from './config.ts';
import { AGENT_CLIENTS, AGENT_SCOPES, createFileTokenStore, credentialsDir, listPersons, PERSON_ID_RE, personDir, type AgentClient, type AgentScope } from './personContext.ts';
import { createKeyStore, KEY_PRESETS, UPSTREAMS } from './proxy.ts';
import { createRedactingLogger } from './security.ts';
import { createSiwc, exportSiwc, importSiwc, SiwcError, sshForwardHint } from './siwc.ts';
import { nodeSys, type Sys } from './sys.ts';

export const COMPANION_HEALTH_URL = 'http://127.0.0.1:4870/health';

export interface ServerCliIo {
  err?: (line: string) => void;
  stdin?: NodeJS.ReadStream;
  sys?: Sys;
  /** Tests inject a fake; never reaches the network then. */
  fetch?: typeof globalThis.fetch;
  /** Where a running Companion would answer (default http://127.0.0.1:4870/health). */
  companionHealthUrl?: string;
  hostname?: () => string;
}

type Out = (line: string) => void;

const OPTIONS = {
  out: { type: 'string' },
  'config-dir': { type: 'string' },
  'data-dir': { type: 'string' },
  force: { type: 'boolean' },
  'callback-port': { type: 'string' },
  'ssh-host': { type: 'string' },
  client: { type: 'string' },
  scope: { type: 'string' },
  label: { type: 'string' },
  url: { type: 'string' },
  remote: { type: 'string' },
  'dry-run': { type: 'boolean' },
} as const;

const expandHome = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p);

/** Null when `argv` is not a server command. */
export async function runServerAiCli(argv: string[], out: Out, io: ServerCliIo = {}): Promise<number | null> {
  let positionals: string[];
  let remote: unknown;
  try {
    const loose = parseArgs({ args: argv, allowPositionals: true, strict: false });
    positionals = loose.positionals;
    remote = loose.values.remote;
  } catch {
    return null;
  }
  const [command, sub, third] = positionals;
  const isPerson = (s: string | undefined) => s !== undefined && PERSON_ID_RE.test(s);
  const mine =
    command === 'agent-token' ||
    (command === 'siwc' && (sub === 'export' || sub === 'import' || (['login', 'status', 'logout'].includes(sub ?? '') && isPerson(third)))) ||
    (command === 'keys' && ['set', 'list', 'remove', 'import'].includes(sub ?? '') && isPerson(third)) ||
    (command === 'agents' && sub === 'register' && remote !== undefined);
  if (!mine) return null;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: OPTIONS });
  } catch (e) {
    out(`${e instanceof Error ? e.message : String(e)}\nSee: vitals-companion --help`);
    return 2;
  }
  const { values, positionals: pos } = parsed;
  const sys = io.sys ?? nodeSys();
  const home = sys.home || homedir();
  const err = io.err ?? ((l: string) => process.stderr.write(`${l}\n`));
  const dataDir = resolve(expandHome(values['data-dir'] ?? join(sys.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'vitals-server'), home));
  const ctx = { values, pos, out, err, io, sys, home, dataDir };

  if (command === 'siwc' && sub === 'export') return siwcExport(ctx);
  if (command === 'agents') return agentsRegister(ctx);
  // every remaining command works on one person of this server
  const person = pos[2];
  if (!person || !PERSON_ID_RE.test(person)) {
    out(`Usage: vitals-companion ${command} ${sub ?? '<command>'} <person> …   (<person> is the 16-character id from \`vitals-server persons list\`)`);
    return 2;
  }
  const people = await listPersons(dataDir);
  const known = people.find((p) => p.id === person);
  if (!known) {
    out(`There is no person ${person} in ${dataDir}. Check the id with \`vitals-server persons list\`, or pass --data-dir.`);
    return 1;
  }
  const full = { ...ctx, person, label: known.label };
  if (command === 'siwc') return sub === 'import' ? siwcImport(full) : siwcPerson(full, sub!);
  if (command === 'keys') return keysCommand(full, sub!);
  return agentToken(full, sub);
}

interface Ctx {
  values: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];
  pos: string[];
  out: Out;
  err: Out;
  io: ServerCliIo;
  sys: Sys;
  home: string;
  dataDir: string;
}
type PersonCtx = Ctx & { person: string; label: string };

async function siwcExport(c: Ctx): Promise<number> {
  const { values, pos, out, io, home } = c;
  if (pos.length > 2) {
    out('Usage: vitals-companion siwc export [--out <file>] [--config-dir <dir>] [--force]');
    return 2;
  }
  const configDir = resolve(expandHome(values['config-dir'] ?? defaultConfigDir(), home));
  const outFile = resolve(expandHome(values.out ?? './vitals-chatgpt-signin.json', home));
  const doFetch = io.fetch ?? globalThis.fetch;
  let running: boolean;
  try {
    running = (await doFetch(io.companionHealthUrl ?? COMPANION_HEALTH_URL, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    running = false;
  }
  if (running) {
    out('A Companion is running on this computer. It could renew the ChatGPT session while you move it, and then the moved copy would stop working.');
    out('Stop it first with: systemctl --user stop vitals-companion');
    if (!values.force) {
      out('Nothing was moved. Run this again after stopping it (or pass --force if you are sure it is not using the sign-in).');
      return 1;
    }
    out('Continuing because of --force.');
  }
  try {
    await exportSiwc(configDir, outFile);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
      out(`${outFile} already exists. Delete it or choose another file with --out. Nothing was moved.`);
      return 1;
    }
    if (e instanceof SiwcError) {
      out(e.message);
      return 1;
    }
    throw e;
  }
  out(`Saved your ChatGPT sign-in to ${outFile} (readable only by you).`);
  out('The sign-in was removed from this computer, so only this file holds it now.');
  out('Next:');
  out(`  1. Copy it to the server, for example: scp ${outFile} <server>:`);
  out('  2. On the server run: vitals-server siwc import <person> <file>');
  out('The file is the only copy. If the import cannot be done, delete the file and sign in again.');
  return 0;
}

async function siwcImport(c: PersonCtx): Promise<number> {
  const { values, pos, out, person, label, dataDir, home } = c;
  if (pos.length !== 4) {
    out('Usage: vitals-companion siwc import <person> <file> [--force] [--data-dir <dir>]');
    return 2;
  }
  try {
    await importSiwc(credentialsDir(dataDir, person), resolve(expandHome(pos[3]!, home)), { force: values.force });
  } catch (e) {
    if (e instanceof SiwcError || (e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      out(e instanceof SiwcError ? e.message : `No such file: ${pos[3]}`);
      return 1;
    }
    throw e;
  }
  out(`Signed in with ChatGPT for ${label}. The server now renews the session; the export file was deleted.`);
  return 0;
}

async function siwcPerson(c: PersonCtx, sub: string): Promise<number> {
  const { values, pos, out, err, io, person, label, dataDir } = c;
  const siwc = createSiwc({ configDir: credentialsDir(dataDir, person), log: createRedactingLogger(err), openBrowser: () => undefined });
  if (sub === 'status') {
    const s = await siwc.status();
    out(s.signedIn ? `${label}: signed in with ChatGPT (the access token renews automatically; the current one expires ${s.expiresAt}).` : `${label}: not signed in with ChatGPT.`);
    return 0;
  }
  if (sub === 'logout') {
    await siwc.logout();
    out(`Signed ${label} out of ChatGPT on this server.`);
    return 0;
  }
  const port = Number(values['callback-port']);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    out('Usage: vitals-companion siwc login <person> --callback-port <n> [--ssh-host <host>] [--data-dir <dir>]');
    return 2;
  }
  void pos;
  let login;
  try {
    login = await siwc.login({ callbackPort: port });
  } catch (e) {
    out(`Could not start the sign-in: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  out('Run this on the computer with the browser, then open the address below:');
  out(`  ${sshForwardHint(port, values['ssh-host'] ?? (io.hostname ?? hostname)())}`);
  out(`  ${login.authorizeUrl}`);
  try {
    await login.done;
  } catch (e) {
    out(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  out(`Signed in with ChatGPT for ${label}. The server now renews the session.`);
  return 0;
}

/** Reads a secret from stdin without echo (TTY) or from a pipe. */
async function readSecret(stdin: NodeJS.ReadStream, prompt: (s: string) => void): Promise<string> {
  if (!stdin.isTTY) {
    const parts: Buffer[] = [];
    for await (const chunk of stdin as AsyncIterable<Buffer>) parts.push(chunk);
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

const KEY_RE = /^[\x21-\x7e]{8,512}$/;

async function keysCommand(c: PersonCtx, sub: string): Promise<number> {
  const { pos, out, err, io, person, label, dataDir, home } = c;
  const credDir = credentialsDir(dataDir, person);
  const file = join(credDir, 'providers.json');
  const keys = createKeyStore(credDir, {}, file);
  const where = join(personDir(dataDir, person), 'credentials', 'providers.json');
  const stdin = io.stdin ?? process.stdin;
  if (sub === 'list') {
    const sources = await keys.sources();
    out(`Provider keys for ${label}:`);
    for (const id of KEY_PRESETS) out(`  ${id.padEnd(14)} ${sources[id] ? 'configured' : 'not configured'}`);
    return 0;
  }
  if (sub === 'import') {
    let text: string;
    try {
      text = pos[3] ? await readFile(resolve(expandHome(pos[3], home)), 'utf8') : await readStdinText(stdin);
    } catch {
      out(`Could not read ${pos[3]}.`);
      return 1;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      out('That is not a Companion keys file (expected {"nim": "…", "opencode-zen": "…"}). Nothing imported.');
      return 1;
    }
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const [preset, key] of Object.entries(data as Record<string, unknown>)) {
      if (KEY_PRESETS.includes(preset) && typeof key === 'string' && KEY_RE.test(key)) {
        await keys.set(preset, key);
        imported.push(preset);
      } else skipped.push(preset);
    }
    out(imported.length ? `Imported ${imported.length} key${imported.length === 1 ? '' : 's'} for ${label}: ${imported.join(', ')} (not shown).` : `No usable keys found for ${label}. Nothing imported.`);
    if (skipped.length) out(`Skipped ${skipped.join(', ')} (not a provider key Vitals uses, or not a valid key).`);
    return imported.length ? 0 : 1;
  }
  const preset = pos[3];
  if (!preset || !KEY_PRESETS.includes(preset) || pos.length > 4) {
    out(`Usage: vitals-companion keys ${sub} <person> <${KEY_PRESETS.join('|')}>`);
    return 2;
  }
  if (sub === 'remove') {
    out((await keys.remove(preset)) ? `Removed the ${preset} key for ${label}.` : `${label} has no ${preset} key.`);
    return 0;
  }
  err(`Paste the ${UPSTREAMS[preset]!.label} API key for ${label}, then press Enter.`);
  let key: string;
  try {
    key = await readSecret(stdin, (s) => process.stderr.write(s));
  } catch {
    out('Cancelled.');
    return 1;
  }
  if (!KEY_RE.test(key)) {
    out('That does not look like an API key (8–512 printable characters, no spaces). Nothing saved.');
    return 1;
  }
  await keys.set(preset, key);
  out(`Saved the ${preset} key for ${label} to ${where} (readable by the server user only).`);
  return 0;
}

async function readStdinText(stdin: NodeJS.ReadStream): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of stdin as AsyncIterable<Buffer>) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

async function agentToken(c: PersonCtx, sub: string | undefined): Promise<number> {
  const { values, pos, out, person, label, dataDir } = c;
  const tokens = createFileTokenStore(dataDir);
  if (sub === 'list') {
    const list = await tokens.list(person, 'agent');
    if (!list.length) out(`${label} has no agent tokens.`);
    for (const r of list) out(`${r.id}  client ${r.client ?? '-'}  label "${r.label}"  scope ${r.scope}  created ${r.createdAt}  last used ${r.lastSeenAt ?? 'never'}`);
    return 0;
  }
  if (sub === 'revoke') {
    const id = pos[3];
    if (!id || pos.length > 4) {
      out('Usage: vitals-companion agent-token revoke <person> <id>');
      return 2;
    }
    if (!(await tokens.revoke(person, id))) {
      out(`${label} has no active agent token ${id}. List them with: vitals-companion agent-token list ${person}`);
      return 1;
    }
    out(`Revoked agent token ${id}. The agent that used it can no longer connect.`);
    return 0;
  }
  if (sub !== 'create' || pos.length > 3) {
    out('Usage: vitals-companion agent-token create|list|revoke <person> …');
    return 2;
  }
  const client = values.client as AgentClient | undefined;
  const scope = (values.scope ?? 'read') as AgentScope;
  if (!client || !AGENT_CLIENTS.includes(client) || !AGENT_SCOPES.includes(scope)) {
    out(`Usage: vitals-companion agent-token create <person> --client <${AGENT_CLIENTS.join('|')}> [--scope ${AGENT_SCOPES.join('|')}] [--label <text>] [--url <https address of the server>]`);
    return 2;
  }
  let mcpUrl: string | null = null;
  if (values.url !== undefined) {
    try {
      mcpUrl = normaliseMcpUrl(values.url);
    } catch (e) {
      out(e instanceof AgentConfigError ? e.message : String(e));
      return 2;
    }
  }
  const { token, record } = await tokens.mint(person, { kind: 'agent', client, scope, label: values.label ?? `${CLIENT_LABELS[client]} agent` });
  out(`Agent token for ${CLIENT_LABELS[client]} (${record.scope} access) for ${label}, id ${record.id}. It is shown only once, so copy it now:`);
  out(token);
  if (mcpUrl) {
    out('');
    for (const r of agentRecipes(mcpUrl, client)) {
      out(`${r.title}:`);
      r.steps.forEach((s, i) => out(`  ${i + 1}. ${s}`));
      if (r.config) out(`  ${r.config.file}:\n${r.config.snippet}`);
    }
  } else out(`Run the same command again with --url <https address of this server> for the setup steps, or set ${TOKEN_ENV} to the token in the agent's environment.`);
  return 0;
}

async function agentsRegister(c: Ctx): Promise<number> {
  const { values, pos, out, sys } = c;
  const name = pos[2];
  const id = name === 'chatgpt' ? 'chatgpt-desktop' : name;
  if (pos.length !== 3 || !id || !['codex', 'opencode', 'claude', 'chatgpt-desktop'].includes(id) || !values.remote) {
    out('Usage: vitals-companion agents register <codex|opencode|claude|chatgpt> --remote <https address of the server> [--dry-run]');
    return 2;
  }
  try {
    const r = await registerRemoteAgent(sys, id as 'codex' | 'opencode' | 'claude' | 'chatgpt-desktop', { url: values.remote, dryRun: values['dry-run'] });
    for (const l of r.lines) out(l);
    return 0;
  } catch (e) {
    if (e instanceof AgentConfigError) {
      out(e.message);
      return 1;
    }
    throw e;
  }
}
