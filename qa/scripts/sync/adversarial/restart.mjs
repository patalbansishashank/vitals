// Restart an isolated second copy of the installed server between committed sync writes.
// The live server's configuration, data and process are never used.
import '../lib/tsResolve.mjs';
import fs from 'node:fs';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { harnessConfig, ROOT, sleep } from '../lib/config.mjs';
import { todayIn } from '../lib/docs.mjs';
import { openReplica } from '../lib/replica.mjs';

const { newOwnerSecret, secretToWords } = await import('../../../../src/sync/pairing.ts');
const { ulid } = await import('../../../../src/store/ids.ts');
const cfg = harnessConfig();
const nonce = `C-SYNCX-restart-${process.pid}-${Date.now()}`;
const remote = `$HOME/.cache/${nonce}`;
const xdg = `XDG_CONFIG_HOME=${remote}/config XDG_DATA_HOME=${remote}/data`;
const cli = 'node ~/vitals-server/current/bin/vitals-server.mjs';
const outFile = `${ROOT}/qa/results/C-SYNCX/restart.json`;
const dir = `${ROOT}/.e6-tmp/${nonce}`;
const date = todayIn();
const secret = newOwnerSecret();
const reps = [];
let server = null;
let tunnel = null;
let port;
let localPort;
let personId = null;
let token = null;
let cleaned = false;
const cleanupReport = { stopped: false, remoteRemoved: false, localRemoved: false, error: null };
const checks = [];
const timingsMs = {};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} restart: ${name}${detail ? ` (${detail})` : ''}`);
};
const ssh = (command, input = null, timeout = 30000) => {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', cfg.sshHost, command], {
    encoding: 'utf8',
    input,
    timeout,
    maxBuffer: 1 << 20,
  });
  if (r.status !== 0) throw new Error(`remote command failed (${r.status})`);
  return r.stdout;
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const health = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${localPort}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};
const waitHealth = async (want, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await health()) === want) return true;
    await sleep(200);
  }
  return false;
};
const start = async () => {
  server = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', cfg.sshHost, `sh -c 'echo $$ > ${remote}/pid; exec env ${xdg} ${cli} serve'`],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  server.stderr.resume();
  if (!(await waitHealth(true))) throw new Error('isolated server did not start');
  const live = ssh(
    `if test -f ${remote}/pid; then p=$(cat ${remote}/pid); ps -p "$p" -o args= 2>/dev/null | grep -Fq 'vitals-server.mjs serve' && echo running; fi`,
  );
  if (!live.includes('running')) throw new Error('isolated server health did not match its tagged process');
};
const stop = async (signal = 'KILL') => {
  // The launcher re-execs under the pinned Node runtime, so stop its child as well.
  const stopped = ssh(
    `if test -f ${remote}/pid; then p=$(cat ${remote}/pid); if ps -p "$p" -o args= 2>/dev/null | grep -Fq 'vitals-server.mjs serve'; then pkill -${signal} -P "$p" 2>/dev/null || :; kill -${signal} "$p" 2>/dev/null || :; echo stopped; fi; fi`,
  );
  if (!stopped.includes('stopped')) throw new Error('isolated server pid did not match the expected command');
  if (!(await waitHealth(false, 5000))) throw new Error('isolated server still responds after stop');
};
const visible = async (rep, ids, since, limit = 30000) => {
  const end = since + limit;
  let seen = 0;
  while (Date.now() < end) {
    try {
      const d = await rep.read({ col: 'dailyLogs', date });
      seen = ids.filter((id) => id in d).length;
      if (seen === ids.length) return Date.now() - since;
    } catch {
      /* server is restarting */
    }
    await sleep(rep.kind === 'server' ? 1100 : 150);
  }
  return null;
};
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const r of reps.reverse()) await r.close().catch(() => undefined);
  try {
    await stop('TERM');
    cleanupReport.stopped = true;
  } catch (e) {
    cleanupReport.error = `stop: ${String(e.message ?? e).slice(0, 120)}`;
  }
  if (server) server.kill('SIGTERM');
  if (tunnel) tunnel.kill('SIGTERM');
  if (cleanupReport.stopped) {
    try {
      ssh(`rm -rf ${remote}`);
      cleanupReport.remoteRemoved = true;
    } catch (e) {
      cleanupReport.error = `remote cleanup: ${String(e.message ?? e).slice(0, 120)}`;
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  cleanupReport.localRemoved = true;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => cleanup().finally(() => process.exit(130)));
let error = null;
try {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Choose the remote port from the high range and prove it was free before starting.
  port = 49000 + Math.floor(Math.random() * 9000);
  localPort = await freePort();
  ssh(
    `mkdir -p ${remote}/config ${remote}/data && chmod 700 ${remote} ${remote}/config ${remote}/data && node -e 'const s=require("node:net").createServer();s.once("error",()=>process.exit(1));s.listen(${port},"127.0.0.1",()=>s.close())'`,
  );
  ssh(`env ${xdg} ${cli} init --role home --port ${port}`);
  ssh(
    `node -e 'const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p));c.mqtt={enabled:false};fs.writeFileSync(p,JSON.stringify(c));' ${remote}/config/vitals-server/server.json`,
  );
  tunnel = spawn(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-N',
      '-L',
      `127.0.0.1:${localPort}:127.0.0.1:${port}`,
      cfg.sshHost,
    ],
    { stdio: 'ignore' },
  );
  await start();
  const joined = ssh(
    `env ${xdg} ${cli} persons add C-SYNCX-restart --join`,
    `${secretToWords(secret).join(' ')}\n`,
  );
  personId = joined.match(/^([0-9a-f]{16})\s+C-SYNCX-restart/m)?.[1];
  if (!personId) throw new Error('isolated person was not created');
  const issued = ssh(
    `env ${xdg} ${cli} agent-token create ${personId} --client claude --scope log --label C-SYNCX-restart`,
  );
  const lines = issued.split('\n');
  const i = lines.findIndex((s) => /shown only once/.test(s));
  token = lines[i + 1]?.trim();
  if (!token) throw new Error('isolated agent token was not created');
  const url = `http://127.0.0.1:${localPort}`;
  const S = await openReplica('server', { name: 'S', serverBaseUrl: url, token });
  reps.push(S);
  await S.read({ col: 'dailyLogs', date });
  const A = await openReplica('node', { name: 'A', secret, relayTarget: url, dir: `${dir}/A` });
  reps.push(A);
  const B = await openReplica('node', { name: 'B', secret, relayTarget: url, dir: `${dir}/B` });
  reps.push(B);
  const ids = [];
  const write = async (n) => {
    const id = ulid();
    ids.push(id);
    await A.write({ op: 'logFood', id, date, text: `C-SYNCX restart entry ${n}`, kcal: 200 + n });
  };
  await A.goOffline();
  for (let n = 0; n < 4; n++) await write(n);
  const queued = await A.read({ col: 'dailyLogs', date });
  check(
    'four committed writes remain on A during outage',
    ids.every((id) => id in queued),
  );
  const before = await B.read({ col: 'dailyLogs', date });
  check(
    'B has no queued writes before reconnect',
    ids.every((id) => !(id in before)),
  );
  const t0 = Date.now();
  await A.goOnline();
  const first = await visible(B, ids, t0);
  check('first upload reached B before the server restart', first !== null, `${first ?? 'timeout'} ms`);
  A.pauseNextSyncUpload();
  for (let n = 4; n < 6; n++) await write(n);
  const paused = await A.waitForPausedSyncUpload(10000);
  check(
    'sync frame held in flight before restart',
    paused.started && paused.bytesForwarded === 1,
    `${paused.bytesForwarded} byte forwarded`,
  );
  await stop('KILL');
  A.releasePausedSyncUpload();
  check('isolated server stopped in the sync sequence', !(await health()));
  const atStop = await B.read({ col: 'dailyLogs', date });
  const deliveredBeforeRestart = ids.filter((id) => id in atStop).length;
  check(
    'server stopped before paused writes arrived',
    deliveredBeforeRestart === 4,
    `${deliveredBeforeRestart}/6 visible on B`,
  );
  for (let n = 6; n < 18; n++) await write(n);
  const allLocal = await A.read({ col: 'dailyLogs', date });
  check(
    'all 18 writes committed locally across restart',
    ids.every((id) => id in allLocal),
  );
  await start();
  const restarted = Date.now();
  const [onB, onS] = await Promise.all([visible(B, ids, restarted), visible(S, ids, restarted)]);
  timingsMs.reconnectToB = onB;
  timingsMs.reconnectToServer = onS;
  timingsMs.fullRace = Date.now() - t0;
  check('all 18 writes visible on B within 30 s of restart', onB !== null, `${onB ?? 'timeout'} ms`);
  check(
    'all 18 writes visible to server person within 30 s of restart',
    onS !== null,
    `${onS ?? 'timeout'} ms`,
  );
  const a = await A.read({ col: 'dailyLogs', date });
  const b = await B.read({ col: 'dailyLogs', date });
  const s = await S.read({ col: 'dailyLogs', date });
  check(
    'exactly one copy of each write on A, B and server',
    [a, b, s].every((d) => Object.keys(d).length === ids.length && ids.every((id) => id in d)),
  );
} catch (e) {
  error = e?.name ?? 'Error';
  console.error(`FAIL restart: ${error}`);
} finally {
  await cleanup();
  fs.mkdirSync(`${ROOT}/qa/results/C-SYNCX`, { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        scenario: 'isolated server restart between sync writes',
        at: new Date().toISOString(),
        server: 'installed second instance',
        writes: 18,
        checks,
        timingsMs,
        cleanup: cleanupReport,
        error,
      },
      null,
      2,
    ) + '\n',
  );
}
process.exitCode = error || cleanupReport.error || checks.some((c) => !c.ok) ? 1 : 0;
