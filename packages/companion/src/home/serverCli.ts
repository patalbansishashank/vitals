/** `vitals-server …`: the admin command line of the Vitals Server (SUITE_SPEC §14.1). Local only; no admin web page. */
import { existsSync } from 'node:fs';
import { cp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { startCompanion, VERSION } from '../server.ts';
import { runServerAiCli } from '../serverCli.ts';
import { createDeviceStore } from './devices.ts';
import { pairingQr } from './home.ts';
import { createIngestState } from './ingest.ts';
import { createPersonRegistry } from './persons.ts';
import { bindAllowed, defaultServerConfig, loopbackRelayUrl, readServerConfig, serverConfigDir, writeServerConfig, type ServerConfig } from './serverConfig.ts';
import { threadWorkerFactory, type PoolMemory } from './workers.ts';

const HELP = `vitals-server ${VERSION}

  vitals-server init [--role home|relay] [--public-origin <https url>] [--public-host <name>] [--origin <url>] [--port <n>]
  vitals-server persons add <label> [--tz <IANA zone>] [--join]   (--join reads the sync phrase from stdin)
  vitals-server persons list | remove <person>
  vitals-server pair code <person> [--label <name>]              (also: devices code)
  vitals-server devices list <person> | revoke <person> <deviceId>
  vitals-server mqtt add <person> | revoke <person> <username>
  vitals-server admin-token                                     (prints a new admin token once)
  vitals-server status
  vitals-server backup <person> | restore <person> <backup dir>  (stop the server before restore)
  vitals-server serve [--app <dist dir>]
  vitals-server keys set <person> <nim|opencode-zen> | list <person> | remove <person> <preset> | import <person> [file]
  vitals-server siwc import <person> <file> | status <person> | logout <person> | login <person> --callback-port <n>
  vitals-server agent-token create <person> --client <codex|opencode|claude> [--scope read|log|edit] | list <person> | revoke <person> <id>
`;

export async function serverMain(argv: string[], out: (l: string) => void = (l) => process.stdout.write(`${l}\n`), stdin: NodeJS.ReadStream = process.stdin): Promise<number> {
  process.umask(0o077);
  // Provider keys, the ChatGPT sign-in and agent tokens (docs/SERVER.md): these commands parse their own options and
  // work on this server's data folder unless --data-dir is given.
  if (!argv.some((a) => a === '--data-dir' || a.startsWith('--data-dir='))) {
    const dataDir = ((await readServerConfig(serverConfigDir())) ?? defaultServerConfig()).dataDir;
    const handled = await runServerAiCli([...argv, '--data-dir', dataDir], out, { stdin });
    if (handled !== null) return handled;
  } else {
    const handled = await runServerAiCli(argv, out, { stdin });
    if (handled !== null) return handled;
  }
  const { values: v, positionals: pos } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      role: { type: 'string' }, 'public-origin': { type: 'string' }, 'public-host': { type: 'string', multiple: true }, origin: { type: 'string', multiple: true },
      port: { type: 'string' }, tz: { type: 'string' }, join: { type: 'boolean' }, label: { type: 'string' }, app: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, sub, a1, a2] = pos;
  if (!cmd || v.help) return out(HELP), 0;
  const cfgDir = serverConfigDir();
  const cfg: ServerConfig = (await readServerConfig(cfgDir)) ?? defaultServerConfig();
  const persons = createPersonRegistry(cfg.dataDir);
  const devices = createDeviceStore({ dataDir: cfg.dataDir, persons });
  const need = async (id: string | undefined) => {
    if (!id || !(await persons.get(id))) throw new Error('Unknown person; see `vitals-server persons list`.');
    return id;
  };
  const relayUrl = () => (cfg.publicOrigin ? `${cfg.publicOrigin.replace(/^http/, 'ws')}/sync` : null);

  switch (['persons', 'pair', 'devices', 'mqtt'].includes(cmd) ? `${cmd} ${sub ?? ''}`.trim() : cmd) {
    case 'init': {
      const next: ServerConfig = {
        ...cfg, role: v.role === 'relay' ? 'relay' : 'home',
        ...(v['public-origin'] ? { publicOrigin: v['public-origin'] } : {}),
        ...(v['public-host'] ? { publicHosts: v['public-host'] } : {}),
        ...(v.origin ? { allowedOrigins: [...new Set([...cfg.allowedOrigins, ...v.origin])] } : {}),
        ...(v.port ? { listen: { ...cfg.listen, port: Number(v.port) } } : {}),
      };
      await writeServerConfig(cfgDir, next);
      out(`Wrote ${join(cfgDir, 'server.json')} (role ${next.role}, data in ${next.dataDir}).`);
      return 0;
    }
    case 'persons add': {
      if (!a1) throw new Error('Give the person a label.');
      const tz = v.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const secret = v.join ? await secretFromPhrase(await readHidden(stdin, out)) : new Uint8Array(randomBytes(32));
      const p = await persons.add({ label: a1, timeZone: tz, secret, relayUrl: relayUrl() });
      out(`${p.id}  ${p.label}  (time zone ${tz}${v.join ? ', joins the existing sync group' : ', new sync group'})`);
      return 0;
    }
    case 'persons list':
      for (const p of await persons.list()) out(`${p.id}  ${p.label}  ${p.createdAt}`);
      return 0;
    case 'persons remove':
      out((await persons.remove(await need(a1))) ? 'Removed.' : 'Not found.');
      return 0;
    case 'pair code':
    case 'devices code': {
      const c = await devices.issueCode(await need(a1), v.label);
      out(`Code ${c.code} (valid until ${c.expiresAt}, single use)`);
      out(pairingQr(cfg.publicOrigin, c.code, v.label));
      return 0;
    }
    case 'devices list':
      for (const d of await devices.list(await need(a1))) out(`${d.id}  ${d.kind}  ${d.label}  last seen ${d.lastSeenAt ?? 'never'}`);
      return 0;
    case 'devices revoke':
      out((await devices.revoke(await need(a1), a2 ?? '')) ? 'Revoked.' : 'Not found.');
      return 0;
    case 'mqtt add': {
      const c = await createIngestState({ persons }).addCredential(await need(a1), cfg.publicOrigin ? `${cfg.publicOrigin.replace(/^http/, 'ws')}/mqtt` : '');
      out(`Address   ${c.address}\nUser name ${c.username}\nPassword  ${c.password}   (shown once)\nBase topic ${c.baseTopic}`);
      return 0;
    }
    case 'mqtt revoke':
      out((await createIngestState({ persons }).revokeCredential(await need(a1), a2 ?? '')) ? 'Revoked (the running server disconnects it on its next check).' : 'Not found.');
      return 0;
    case 'admin-token':
      out(await devices.mintAdminToken());
      return 0;
    case 'status': {
      out(`vitals-server ${VERSION}, role ${cfg.role}, data ${cfg.dataDir}`);
      const bad = await looseModes(cfg.dataDir);
      out(bad.length ? `Files readable by others (fix with chmod): ${bad.join(', ')}` : 'File modes: ok (0700 directories, 0600 files)');
      for (const p of await persons.list()) out(`${p.id}  ${p.label}  devices ${(await devices.list(p.id)).length}`);
      const health = await fetch(`http://${cfg.listen.host}:${cfg.listen.port}/health`).then((r) => r.json()).catch(() => null);
      out(health ? `Running: ${JSON.stringify(health)}` : 'Not running on the configured port.');
      if (health) for (const l of await memoryLines(cfg.dataDir, Date.now(), new Set((await persons.list()).map((p) => p.id)))) out(l);
      return 0;
    }
    case 'backup': {
      const id = await need(sub);
      const dir = join(persons.paths(id).backup, new Date().toISOString().replace(/[:.]/g, '-'));
      for (const f of await readdir(persons.paths(id).dir)) if (f !== 'backup') await cp(join(persons.paths(id).dir, f), join(dir, f), { recursive: true });
      out(`Backup in ${dir}`);
      return 0;
    }
    case 'restore': {
      const id = await need(sub);
      const from = resolve(a1 ?? '');
      if (!existsSync(join(from, 'person.json'))) throw new Error('Not a backup directory.');
      for (const f of await readdir(persons.paths(id).dir)) if (f !== 'backup') await rm(join(persons.paths(id).dir, f), { recursive: true, force: true });
      await cp(from, persons.paths(id).dir, { recursive: true });
      out('Restored. Start the server again.');
      return 0;
    }
    case 'serve': {
      if (!bindAllowed(cfg)) throw new Error('A home server binds loopback or a tailnet address unless tls is configured.');
      const bundle = new URL('../../dist/person-worker.mjs', import.meta.url);
      if (cfg.role === 'home' && !existsSync(bundle)) throw new Error('Build the person program first: pnpm --filter vitals-companion build:person');
      const c = await startCompanion({
        host: cfg.listen.host, port: cfg.listen.port, dataDir: join(cfg.dataDir, 'relay'), allowedOrigins: cfg.allowedOrigins, log: (l) => out(l),
        ...(v.app ? { serveApp: resolve(v.app) } : {}),
        ...(cfg.role === 'home'
          ? { home: { dataDir: cfg.dataDir, allowedOrigins: [...cfg.allowedOrigins, ...(cfg.publicOrigin ? [cfg.publicOrigin] : [])], publicHosts: cfg.publicHosts ?? [], publicOrigin: cfg.publicOrigin, mqtt: { enabled: cfg.mqtt?.enabled ?? true, ...(cfg.mqtt?.tcp ? { tcp: cfg.mqtt.tcp } : {}), ...(cfg.mqtt?.tls ? { tls: cfg.mqtt.tls } : {}) }, ai: { ...(cfg.limits?.aiRequestsPerMinute !== undefined ? { requestsPerMinute: cfg.limits.aiRequestsPerMinute } : {}), ...(cfg.limits?.aiRequestsPerDay !== undefined ? { requestsPerDay: cfg.limits.aiRequestsPerDay } : {}) }, workerFactory: threadWorkerFactory(bundle), relayUrl: () => loopbackRelayUrl(cfg.listen) ?? relayUrl(), ...(cfg.maxOpenPersons ? { maxOpenPersons: cfg.maxOpenPersons } : {}) } }
          : {}),
      });
      out(`vitals-server ${VERSION} (${cfg.role}) on ${c.url}`);
      const diagPort = Number(process.env.VITALS_DIAG_PORT ?? 0);
      const diag = diagPort > 0 && c.home ? await (await import('./diag.ts')).startDiag({ port: diagPort, pool: c.home.pool, dataDir: cfg.dataDir }) : null;
      if (diag) out(`diagnostics on http://127.0.0.1:${diagPort}/diag (loopback only)`);
      await new Promise<void>((r) => {
        for (const s of ['SIGINT', 'SIGTERM'] as const) process.once(s, () => {
          diag?.close();
          void c.close().then(r);
        });
      });
      return 0;
    }
  }
  out(HELP);
  return 2;
}

/** Reads one line from stdin with echo off (never argv, never an environment variable). */
async function readHidden(stdin: NodeJS.ReadStream, out: (l: string) => void): Promise<string> {
  out('Paste the sync phrase from Settings › Sync, then Enter:');
  if (stdin.isTTY) stdin.setRawMode(true);
  let s = '';
  for await (const chunk of stdin) {
    s += String(chunk);
    if (/[\r\n]/.test(s)) break;
  }
  if (stdin.isTTY) stdin.setRawMode(false);
  return s.replace(/[\r\n].*$/s, '').trim();
}

/** The sync phrase (BIP39 English) back to the 32-byte owner secret, as the app's pairing does. */
async function secretFromPhrase(phrase: string): Promise<Uint8Array> {
  const { mnemonicToEntropy } = await import('@scure/bip39');
  const { wordlist } = await import('@scure/bip39/wordlists/english.js');
  const e = mnemonicToEntropy(phrase.toLowerCase().split(/\s+/).join(' '), wordlist);
  if (e.length !== 32) throw new Error('That phrase does not hold a 32-byte key.');
  return e;
}

/** The running server's last minute sample (`<dataDir>/memory.json`, written by the person-worker pool). */
/** `persons`: the ids that exist now; a removed person still in the sample is shown as closing and not counted. */
export async function memoryLines(dataDir: string, now = Date.now(), persons?: ReadonlySet<string>): Promise<string[]> {
  let m: PoolMemory;
  try {
    m = JSON.parse(await readFile(join(dataDir, 'memory.json'), 'utf8')) as PoolMemory;
  } catch {
    return ['Memory: no sample yet (the server writes one a minute after it starts).'];
  }
  const age = Math.round((now - Date.parse(m.at)) / 1000);
  const removed = (id: string) => persons !== undefined && !persons.has(id);
  const lines = [`Memory (${age} s ago): server rss ${m.rssMb} MB, main heap ${m.heapUsedMb} MB, ${m.persons.filter((p) => !removed(p.id)).length} of at most ${m.maxOpenPersons} persons open`];
  for (const p of m.persons) {
    const heap = p.heapUsedMb === undefined ? 'heap unknown' : `heap ${p.heapUsedMb}/${p.heapTotalMb} MB, external ${p.externalMb} MB`;
    lines.push(`  ${p.id}  ${heap}, ${removed(p.id) ? 'removed (its worker closes within a minute)' : p.busy ? `busy (${p.busy})` : `idle ${p.idleSec} s`}`);
  }
  return lines;
}

async function looseModes(dir: string): Promise<string[]> {
  const bad: string[] = [];
  if (!existsSync(dir)) return bad;
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    if ((await stat(p)).mode & 0o077) bad.push(p);
  }
  return bad;
}
