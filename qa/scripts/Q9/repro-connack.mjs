// Q9 repro attempt: does a client that drops its socket with QoS 1 PUBACKs unread (ws.terminate) stall later CONNECTs?
// Local packed server (as j3-restart.mjs). Prints PASS/FAIL lines only.
import { spawn } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, TMP, lumenClient, lumenEvent, sleep } from './lib.mjs';
const REL = resolve(join(ROOT, '.e6-tmp/dryhost/vitals-server/current'));
const req = createRequire(createRequire(join(ROOT, 'packages/companion/package.json')).resolve('mqtt'));
const mqttPacket = (await import(pathToFileURL(req.resolve('mqtt-packet')).href)).default;
const WebSocket = (await import(pathToFileURL(req.resolve('ws')).href)).default;
const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const DATA = join(TMP, 'repro'); rmSync(DATA, { recursive: true, force: true });
cpSync(join(ROOT, 'qa/scripts/Q9/j3-server.mjs'), join(REL, 'q9-j3-server.mjs'));
const srv = spawn(process.execPath, ['q9-j3-server.mjs'], { cwd: REL, env: { ...process.env, Q9_CFG: JSON.stringify({ port, dataDir: DATA, origin: `https://127.0.0.1:${port}` }) }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = []; let ready; const readyP = new Promise((r) => (ready = r));
srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith('READY')) ready(); else if (l.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(l.slice(5))); } });
const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
await readyP;
const p = await ctrl({ op: 'addPerson', label: 'q9-r', tz: 'Asia/Kolkata' });
const url = `ws://127.0.0.1:${port}/mqtt`;
const raw = () => new Promise((res) => { const ws = new WebSocket(url, 'mqtt'); ws.on('error', () => undefined); ws.on('open', () => { ws.send(mqttPacket.generate({ cmd: 'connect', protocolId: 'MQTT', protocolVersion: 4, clean: true, clientId: 'q9-phone-1', keepalive: 60, username: p.username, password: Buffer.from(p.password) })); res(ws); }); });
const ev = (i) => lumenEvent('inst', 'health.metric.observed', 'hr', 'metrics/hr', new Date(Date.UTC(2026, 9, 3, 3, i)).toISOString(), { metric: 'hr', value: 60 + i, unit: 'bpm' }, '2026-10-03T05:00:00Z');
const tryConnect = async (label) => { try { const c = await lumenClient(url, p.username, p.password, 'q9-phone-1'); await c.publishAsync(ev(50).topic, ev(50).payload, { qos: 1 }); await c.endAsync(true); console.log(`PASS ${label}: connect + publish`); } catch (e) { console.log(`FAIL ${label}: ${e.message}`); } };
await tryConnect('before');
const c0 = await lumenClient(url, p.username, p.password, 'q9-phone-1'); // a second, idle connection as in J2
for (const dup of [false, true]) {
  const ws = await raw(); await sleep(300);
  for (let i = 0; i < 3; i++) ws.send(mqttPacket.generate({ cmd: 'publish', qos: 1, dup, retain: false, messageId: 101 + i, topic: ev(i).topic, payload: Buffer.from(ev(i).payload) }));
  await sleep(dup ? 300 : 3000); ws.terminate(); await sleep(1000);
}
await c0.endAsync(true).catch(() => undefined);
await tryConnect('after two terminated raw sessions (same client id)');
await sleep(2000);
await tryConnect('2 s later');
await ctrl({ op: 'close' }).catch(() => undefined); srv.kill('SIGKILL'); rmSync(join(REL, 'q9-j3-server.mjs'), { force: true }); process.exit(0);
