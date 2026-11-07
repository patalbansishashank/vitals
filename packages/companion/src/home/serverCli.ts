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
import { DEDUPE_CATEGORIES, dedupeCategoryOk, openLumenStore } from './lumenStore.ts';
import { localDate, sleepNights } from './lumenTools.ts';
import { createPersonRegistry } from './persons.ts';
import { fileUrl, isReleaseApp, publishApk, publishWeb, readReleaseIndex, ReleaseError, RELEASE_APPS, isReleaseChannel } from './releases.ts';
import { bindAllowed, defaultServerConfig, loopbackRelayUrl, readServerConfig, serverConfigDir, writeServerConfig, type ServerConfig } from './serverConfig.ts';
import { threadWorkerFactory, type PoolMemory } from './workers.ts';

const HELP = `vitals-server ${VERSION}

  vitals-server init [--role home|relay] [--public-origin <https url>] [--public-host <name>] [--origin <url>] [--port <n>]
  vitals-server persons add <label> [--tz <IANA zone>] [--join]   (--join reads the sync phrase from stdin)
  vitals-server persons list | remove <person>
  vitals-server pair code <person> [--label <name>]              (also: devices code)
  vitals-server pair-code [--person <id>] [--label <name>]       (the same code; --person may be left out with one person;
                                                                 Vitals devices and the Gauge app pair with it)
  vitals-server devices list <person> | revoke <person> <deviceId>
  vitals-server admin-token                                     (prints a new admin token once)
  vitals-server status
  vitals-server backup <person> | restore <person> <backup dir>  (stop the server before restore)
  vitals-server gauge dedupe <person> [--dry-run] [--category <c>]… [--offset-ms <n>] [--undo]
                                                                (soft-deletes the copies Gauge 2.7.3's ring-clock fix
                                                                left; default category sleep/timeline; stop the server first)
  vitals-server serve [--app <dist dir>]
  vitals-server keys set <person> <nim|opencode-zen> | list <person> | remove <person> <preset> | import <person> [file]
  vitals-server siwc import <person> <file> | status <person> | logout <person> | login <person> --callback-port <n>
  vitals-server agent-token create <person> --client <codex|opencode|claude> [--scope read|log|edit] | list <person> | revoke <person> <id>
  vitals-server release publish <vitals|gauge> --apk <file> [--version-name <x> --version-code <n>] [--notes <text>] [--sha256 <hex>]
  vitals-server release publish vitals --web <bundle.zip> --sig <file> [--version <v>] [--sha256 <hex>]
  vitals-server release list <vitals|gauge>                     (over-the-air updates; channel stable, the last 3 of each kind kept)
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
      person: { type: 'string' },
      apk: { type: 'string' }, web: { type: 'string' }, sig: { type: 'string' }, version: { type: 'string' }, 'version-name': { type: 'string' }, 'version-code': { type: 'string' },
      notes: { type: 'string' }, sha256: { type: 'string' }, channel: { type: 'string' },
      'dry-run': { type: 'boolean' }, undo: { type: 'boolean' }, category: { type: 'string', multiple: true }, 'offset-ms': { type: 'string' },
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

  switch (['persons', 'pair', 'devices', 'gauge'].includes(cmd) ? `${cmd} ${sub ?? ''}`.trim() : cmd) {
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
    case 'devices code':
    case 'pair-code': {
      let who = cmd === 'pair-code' ? v.person : a1;
      if (cmd === 'pair-code' && !who) {
        const all = await persons.list();
        if (all.length !== 1) throw new Error(all.length ? 'Name the person: vitals-server pair-code --person <id> (see `vitals-server persons list`).' : 'Add a person first: vitals-server persons add <label>.');
        who = all[0]!.id;
      }
      const c = await devices.issueCode(await need(who), v.label);
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
    case 'gauge dedupe': {
      const id = await need(a1);
      const p = (await persons.get(id))!;
      return gaugeDedupe(persons.paths(id).lumen, id, p.timeZone, v, out);
    }
    case 'release':
      return releaseCommand(cfg.dataDir, sub, a1, pos.length, v, out);
    case 'serve': {
      if (!bindAllowed(cfg)) throw new Error('A home server binds loopback or a tailnet address unless tls is configured.');
      const bundle = new URL('../../dist/person-worker.mjs', import.meta.url);
      if (cfg.role === 'home' && !existsSync(bundle)) throw new Error('Build the person program first: pnpm --filter vitals-companion build:person');
      const c = await startCompanion({
        host: cfg.listen.host, port: cfg.listen.port, dataDir: join(cfg.dataDir, 'relay'), allowedOrigins: cfg.allowedOrigins, log: (l) => out(l),
        ...(v.app ? { serveApp: resolve(v.app) } : {}),
        ...(cfg.role === 'home'
          ? { home: { dataDir: cfg.dataDir, allowedOrigins: [...cfg.allowedOrigins, ...(cfg.publicOrigin ? [cfg.publicOrigin] : [])], publicHosts: cfg.publicHosts ?? [], publicOrigin: cfg.publicOrigin, ai: { ...(cfg.limits?.aiRequestsPerMinute !== undefined ? { requestsPerMinute: cfg.limits.aiRequestsPerMinute } : {}), ...(cfg.limits?.aiRequestsPerDay !== undefined ? { requestsPerDay: cfg.limits.aiRequestsPerDay } : {}) }, workerFactory: threadWorkerFactory(bundle), relayUrl: () => loopbackRelayUrl(cfg.listen) ?? relayUrl(), ...(cfg.maxOpenPersons ? { maxOpenPersons: cfg.maxOpenPersons } : {}), ...(cfg.coach ? { coach: cfg.coach } : {}), ...(cfg.releases ? { releases: cfg.releases } : {}) } }
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

const RELEASE_USAGE = `Usage: vitals-server release publish <${RELEASE_APPS.join('|')}> --apk <file> [--version-name <x> --version-code <n>] [--notes <text>] [--sha256 <hex>]
       vitals-server release publish vitals --web <bundle.zip> --sig <file> [--version <v>] [--sha256 <hex>]
       vitals-server release list <${RELEASE_APPS.join('|')}>`;

/** `vitals-server release publish|list` (docs/SERVER.md "Updates"). Prints versions, sizes and hashes only. */
async function releaseCommand(
  dataDir: string, sub: string | undefined, app: string | undefined, count: number,
  v: { apk?: string; web?: string; sig?: string; version?: string; 'version-name'?: string; 'version-code'?: string; notes?: string; sha256?: string; channel?: string },
  out: (l: string) => void,
): Promise<number> {
  const channel = v.channel ?? 'stable';
  if (!isReleaseApp(app) || count !== 3 || !isReleaseChannel(channel) || (sub !== 'publish' && sub !== 'list')) return out(RELEASE_USAGE), 2;
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  if (sub === 'list') {
    const index = await readReleaseIndex(dataDir, app, channel);
    out(`${app} (${channel}): ${index.apk.length} APK${index.apk.length === 1 ? '' : 's'}, ${index.web.length} web bundle${index.web.length === 1 ? '' : 's'}`);
    for (const a of index.apk) out(`  apk  ${a.versionName} (versionCode ${a.versionCode})  ${mb(a.size)}  sha256 ${a.sha256}  published ${a.publishedAt}  ${fileUrl(app, channel, a.file)}`);
    for (const w of index.web) out(`  web  ${w.version} (needs versionCode ${w.minNativeVersionCode}+, built ${w.builtAt})  ${mb(w.size)}  sha256 ${w.sha256}  published ${w.publishedAt}  ${fileUrl(app, channel, w.file)}`);
    return 0;
  }
  if (Boolean(v.apk) === Boolean(v.web)) return out(RELEASE_USAGE), 2;
  try {
    if (v.apk) {
      const code = v['version-code'];
      if (code !== undefined && !/^\d{1,10}$/.test(code)) throw new ReleaseError('--version-code must be a whole number.');
      const r = await publishApk(dataDir, app, resolve(v.apk), {
        ...(v['version-name'] !== undefined ? { versionName: v['version-name'] } : {}), ...(code !== undefined ? { versionCode: Number(code) } : {}),
        ...(v.notes !== undefined ? { notes: v.notes } : {}), ...(v.sha256 !== undefined ? { sha256: v.sha256 } : {}), channel,
      });
      const a = r.release;
      out(r.unchanged ? `${app} ${a.versionName} (versionCode ${a.versionCode}) is already published with this file; nothing changed.` : `Published ${app} APK ${a.versionName} (versionCode ${a.versionCode}), ${mb(a.size)}, sha256 ${a.sha256}.`);
      return 0;
    }
    if (!v.sig) return out('A web bundle needs its detached signature: --sig <file>.'), 2;
    const r = await publishWeb(dataDir, app, resolve(v.web!), { sig: resolve(v.sig), ...(v.version !== undefined ? { version: v.version } : {}), ...(v.sha256 !== undefined ? { sha256: v.sha256 } : {}), channel });
    const w = r.release;
    out(r.unchanged ? `Web bundle ${w.version} is already published with this file; nothing changed.` : `Published ${app} web bundle ${w.version} (needs versionCode ${w.minNativeVersionCode}+), ${mb(w.size)}, sha256 ${w.sha256}.`);
    return 0;
  } catch (e) {
    if (e instanceof ReleaseError) return out(e.message), 1;
    throw e;
  }
}

/** `vitals-server gauge dedupe` (docs/SERVER.md "Gauge"): counts per category and day, and each changed night. */
function gaugeDedupe(
  file: string, personId: string, tz: string,
  v: { 'dry-run'?: boolean; undo?: boolean; category?: string[]; 'offset-ms'?: string },
  out: (l: string) => void,
): number {
  if (!existsSync(file)) return out('No ring data for this person.'), 0;
  const dryRun = v['dry-run'] === true;
  const offset = v['offset-ms'];
  if (offset !== undefined && !/^-?\d{1,9}$/.test(offset)) return out('--offset-ms is the ring clock offset in whole milliseconds (raw - corrected), e.g. 383118.'), 2;
  const store = openLumenStore(file);
  try {
    if (v.undo) {
      const n = store.undoDedupe({ dryRun });
      out(dryRun ? `${n} dedupe deletions would be removed.` : `Removed ${n} dedupe deletions; those copies show again.`);
      return 0;
    }
    const bad = (v.category ?? []).filter((c) => !dedupeCategoryOk(c));
    if (bad.length) return out(`Not a ring-history category: ${bad.join(', ')} (use ${DEDUPE_CATEGORIES.join(', ')} or metrics/<kind>).`), 2;
    const range = store.get<{ lo: number | null; hi: number | null }>("SELECT MIN(observed_ms) AS lo, MAX(observed_ms) AS hi FROM sleep_timeline");
    const nights = () => (range?.lo != null && range.hi != null ? sleepNights(store, tz, localDate(range.lo, tz), localDate(range.hi + 86_400_000, tz)) : []);
    const before = nights();
    let after: ReturnType<typeof nights> = [];
    const r = store.dedupe({ ...(v.category?.length ? { categories: v.category } : {}), ...(offset !== undefined ? { offsetMs: Number(offset) } : {}), dryRun, inspect: () => (after = nights()) });
    out(`Ring data dedupe for ${personId}${dryRun ? ' (dry run: nothing is written)' : ''}`);
    for (const o of r.offsets) {
      const how = o.source === 'inferred' ? `inferred from ${o.twins} identical sleep packets` : o.source === 'given' ? 'given' : 'none found: near copies only';
      out(`  installation ${o.installationId}: ring clock offset ${o.offsetMs === null ? '-' : `${o.offsetMs / 1000} s`} (${how})`);
    }
    const per = new Map<string, Map<string, { clock_twin: number; near_copy: number }>>();
    for (const x of r.removals) {
      const days = per.get(x.row.category) ?? new Map<string, { clock_twin: number; near_copy: number }>();
      per.set(x.row.category, days);
      const day = localDate(x.row.observed_ms, tz);
      const c = days.get(day) ?? { clock_twin: 0, near_copy: 0 };
      days.set(day, c);
      c[x.reason]++;
    }
    for (const [category, days] of [...per].sort(([a], [b]) => a.localeCompare(b))) {
      const all = [...days.values()];
      out(`${category}: ${all.reduce((n, c) => n + c.clock_twin, 0)} clock twins, ${all.reduce((n, c) => n + c.near_copy, 0)} near copies (by local date of the reading)`);
      for (const [day, c] of [...days].sort(([a], [b]) => a.localeCompare(b))) out(`  ${day}  ${c.clock_twin} clock twins, ${c.near_copy} near copies`);
    }
    if (!r.removals.length) out('No copies found.');
    const fmt = (s: (typeof before)[number] | undefined) => (s ? `${s.asleepMinutes} asleep, ${s.minutes.unknown} unknown, ${s.noDataMinutes} no data, ${s.inBedMinutes} in bed` : 'none');
    const key = (s: (typeof before)[number]) => `${s.wakingDate} ${s.start}`;
    const changed = [...new Set([...before, ...after].map((s) => s.wakingDate))].sort().filter((d) => {
      const [b, a] = [before.filter((s) => s.wakingDate === d), after.filter((s) => s.wakingDate === d)];
      return JSON.stringify(b.map((s) => [key(s), s.minutes, s.inBedMinutes])) !== JSON.stringify(a.map((s) => [key(s), s.minutes, s.inBedMinutes]));
    });
    if (changed.length) out('Sleep by waking day (minutes), before -> after:');
    for (const d of changed) {
      const [b, a] = [before.filter((s) => s.wakingDate === d), after.filter((s) => s.wakingDate === d)];
      for (let i = 0; i < Math.max(b.length, a.length); i++) out(`  ${d}  ${fmt(b[i])} -> ${fmt(a[i])}`);
    }
    out(dryRun ? `Would soft-delete ${r.removals.length} events. Run again without --dry-run to apply.` : `Soft-deleted ${r.written} events (undo: vitals-server gauge dedupe ${personId} --undo).`);
    return 0;
  } finally {
    store.close();
  }
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
