// Q9 journey 3: restart safety on a local server from the build (oci-arm's service is not ours to restart).
// The packed server (deploy dry run: DEPLOY_TARGET=local:.e6-tmp/dryhost deploy/oci-arm.sh) runs on a free loopback
// port. A Lumen-like client publishes 120 heart-rate events, 10 in flight; after 60 PUBACKs the server is killed with
// SIGKILL, so acknowledged messages sit in the WAL without their import. On restart the WAL is replayed before the
// broker takes connections; the client resends what was never acknowledged (Lumen's outbox). Expected: every event
// stored once (120 samples), the WAL has nothing pending afterwards. Also checks the Q9 status fields (battery,
// dead letters per reason) on this build.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { ROOT, TMP, checker, lumenClient, lumenEvent, log, sleep } from './lib.mjs';

const REL = resolve(process.env.SERVER_DIR || join(ROOT, '.e6-tmp/dryhost/vitals-server/current'));
if (!existsSync(join(REL, 'node_modules'))) throw new Error(`missing ${REL}/node_modules (run the deploy dry run, see the header)`);
const DATA = join(TMP, 'j3data');
rmSync(DATA, { recursive: true, force: true });
const c = checker();
const results = { at: new Date().toISOString() };
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const port = await freePort();
cpSync(join(ROOT, 'qa/scripts/Q9/j3-server.mjs'), join(REL, 'q9-j3-server.mjs'));

function start() {
  const srv = spawn(process.execPath, ['q9-j3-server.mjs'], { cwd: REL, env: { ...process.env, Q9_CFG: JSON.stringify({ port, dataDir: DATA, origin: `https://127.0.0.1:${port}` }) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiters = [];
  const lines = [];
  let buf = '';
  let ready;
  const readyP = new Promise((r) => (ready = r));
  srv.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.startsWith('READY ')) ready();
      else if (line.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(line.slice(5)));
      else lines.push(line);
    }
  });
  srv.stderr.on('data', (d) => lines.push(`stderr ${String(d).trim().slice(0, 300)}`));
  const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
  return { srv, ctrl, lines, ready: Promise.race([readyP, sleep(60000).then(() => { throw new Error(`no READY: ${lines.slice(-5).join(' / ')}`); })]) };
}
const walState = (id) => {
  const f = join(DATA, 'persons', id, 'ingest', 'wal.jsonl');
  const entries = new Set();
  const done = new Set();
  for (const l of (existsSync(f) ? readFileSync(f, 'utf8') : '').split('\n').filter(Boolean)) {
    const v = JSON.parse(l);
    if (v.done) done.add(v.done);
    else if (v.envelopeId) entries.add(v.envelopeId);
  }
  return { entries: entries.size, pending: [...entries].filter((e) => !done.has(e)).length };
};

let s1;
let s2;
try {
  c.journey('J3 restart safety (local server)');
  s1 = start();
  await s1.ready;
  const p = await s1.ctrl({ op: 'addPerson', label: 'q9-j3', tz: 'Asia/Kolkata' });
  const url = `ws://127.0.0.1:${port}/mqtt`;
  const base = Date.parse('2026-10-03T03:00:00Z');
  const events = Array.from({ length: 120 }, (_, i) => lumenEvent('install-j3', 'health.metric.observed', 'hr', 'metrics/hr', new Date(base + i * 60000).toISOString().replace('.000Z', 'Z'), { metric: 'hr', value: 60 + (i % 30), unit: 'bpm', provenance: 'device_history', quality: 'unverified' }, '2026-10-03T05:05:00Z'));
  // publish with 10 in flight; SIGKILL the server at the 60th PUBACK
  const cl = await lumenClient(url, p.username, p.password, 'j3-phone');
  cl.on('error', () => undefined);
  const acked = new Set();
  let killed = false;
  let onKill;
  const killedP = new Promise((r) => (onKill = r));
  const queue = events.map((e, i) => ({ ...e, i }));
  // in-flight publishes never settle once the server is gone: stop waiting at the kill
  await Promise.race([killedP, Promise.all(Array.from({ length: 10 }, async () => {
    while (queue.length && !killed) {
      const m = queue.shift();
      try {
        await cl.publishAsync(m.topic, m.payload, { qos: 1 });
        acked.add(m.i);
        if (acked.size >= 60 && !killed) { killed = true; s1.srv.kill('SIGKILL'); onKill(); }
      } catch { /* connection gone */ }
    }
  }))]);
  cl.end(true);
  await sleep(1500);
  const w1 = walState(p.id);
  results.atKill = { acked: acked.size, walEntries: w1.entries, walPending: w1.pending };
  c.check('server killed (SIGKILL) after 60 PUBACKs', killed && acked.size >= 60, `acked ${acked.size}`);
  c.check('every acknowledged message is in the WAL on disk', w1.entries >= acked.size, `WAL ${w1.entries} entries, acked ${acked.size}`);
  c.check('some acknowledged messages were not yet imported at the kill (the window under test)', w1.pending > 0, `pending ${w1.pending}`);

  // restart: replay before taking connections, then the client resends the rest
  s2 = start();
  await s2.ready;
  const replayLine = s2.lines.find((l) => /imported \d+ broker messages left from the last run/.test(l)) ?? '';
  c.check('on restart the server imports the WAL entries left undone', new RegExp(`imported ${w1.pending} broker`).test(replayLine), replayLine.replace(/^log /, ''));
  const cl2 = await lumenClient(url, p.username, p.password, 'j3-phone');
  for (const e of events) await cl2.publishAsync(e.topic, e.payload, { qos: 1 }); // Lumen resends what it holds; extra resends are harmless
  await s2.ctrl({ op: 'idle', person: p.id });
  // heart rate is hidden from reads until the person shares it (Settings › Devices); share it as the person would
  await s2.ctrl({ op: 'dispatch', person: p.id, command: 'bio.setPolicy', input: { stream: 'hr', policy: { coach: 'daily+series' } }, source: 'ui' });
  const ser = await s2.ctrl({ op: 'dispatch', person: p.id, command: 'bio.series', input: { metric: 'hr', from: '2026-10-03', to: '2026-10-03', resolution: 'raw' } });
  const out = ser.res?.value?.output ?? ser.res?.value ?? {};
  const pts = JSON.stringify(out).match(/"t":/g)?.length ?? (out.points?.length ?? out.samples?.length ?? 0);
  results.series = JSON.stringify(out).slice(0, 300);
  c.check('all 120 events stored once after the restart and the resend', pts === 120, `samples ${pts}`);
  const w2 = walState(p.id);
  c.check('WAL has nothing pending afterwards', w2.pending === 0, JSON.stringify(w2));

  // Q9 status fields on this build: battery and dead letters per reason
  const bat = lumenEvent('install-j3', 'health.device.battery.updated', 'battery', 'state/battery', '2026-10-03T05:00:00Z', { percent: 64, provenance: 'device_reported' }, '2026-10-03T05:00:00Z');
  await cl2.publishAsync(bat.topic, bat.payload, { qos: 1 });
  const wrong = lumenEvent('other-phone', 'health.metric.observed', 'hr', 'metrics/hr', '2026-10-03T05:01:00Z', { metric: 'hr', value: 61, unit: 'bpm' }, '2026-10-03T05:02:00Z');
  await cl2.publishAsync(wrong.topic, wrong.payload, { qos: 1 });
  await cl2.publishAsync('lumen-health/v1/install-j3/metrics/hr', JSON.stringify({ specversion: '1.0', id: 'big', type: 'health.metric.observed', pad: 'x'.repeat(300 * 1024) }), { qos: 1 });
  await s2.ctrl({ op: 'idle', person: p.id });
  const st = await (await fetch(`http://127.0.0.1:${port}/v1/mqtt/status`, { headers: { authorization: `Bearer ${p.token}` } })).json();
  results.status = { battery: st.battery, deadLetters: st.deadLetters };
  c.check('status carries the ring battery (64 %) — Q9 fix', st.battery?.percent === 64, JSON.stringify(st.battery));
  c.check('status counts dead letters per reason — Q9 fix', st.deadLetters?.byReason?.wrong_installation === 1 && st.deadLetters?.byReason?.too_large === 1, JSON.stringify(st.deadLetters));
  await cl2.endAsync(true);
} catch (e) {
  c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  if (s2) await s2.ctrl({ op: 'close' }).catch(() => undefined);
  for (const s of [s1, s2]) s?.srv.kill('SIGKILL');
  rmSync(join(REL, 'q9-j3-server.mjs'), { force: true });
  results.checks = c.checks;
  results.serverLog = [...(s1?.lines ?? []).slice(-6), '--- restart ---', ...(s2?.lines ?? []).slice(-8)].map((l) => l.replace(/p[0-9a-f]{16}-\d+/g, 'p…'));
  writeFileSync(join(ROOT, 'qa/results/Q9-j3-restart.json'), JSON.stringify(results, null, 2));
  log(JSON.stringify(c.summary()));
  process.exit(0);
}
