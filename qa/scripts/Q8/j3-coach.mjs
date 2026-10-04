// J3: the Coach through the server with the scripted stand-in (Q4's fakeprovider + qa/fixtures/Q4/script.json).
//
// How (recorded in docs/wp/Q8.md): the deployed server on oci-arm has no base-URL override for OpenCode Zen or NIM
// (upstreams are fixed in packages/companion/src/proxy.ts; only tests can pass `upstreams`), and this package may not
// change the host. So this journey runs this branch's server code on this PC (qa/scripts/Q8/local-server.mjs: home
// role, OpenCode Zen → the stand-in), behind a self-signed https front (the website accepts only https server
// addresses), serving the production build. Everything between the page and the stand-in is the production path:
// pairing by code, the key set through the server, "OpenCode Zen (via your server)" chosen in Settings › Coach, the
// Coach's requests sent to /v1/ai/opencode-zen/chat/completions with the device token, the server adding its key.
//
// Messages typed into the real Coach UI: "change my training days to Tue/Thu", "I ate dal, rice and two eggs", "I did
// 30 min on the treadmill", "I'm travelling for three days", "suggest goals from my answers". Each gets a reply with a
// tool call; the document change is asserted through the bus; Undo works.
//   pnpm build && pnpm --filter vitals-companion build:person && node qa/scripts/Q8/j3-coach.mjs
// With Q8_PRESET=siwc the same journeys run against oci-arm with the owner's ChatGPT sign-in: see j3-siwc.mjs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { results, ROOT, DIST, PRIVATE, openProfile, go, read, pairByCode, setUpSync, serverCall, sleep, closeBrowser, log, shot, mainText } from './lib.mjs';
import { coachJourneys, seedProfile, makePlan, chooseServerPreset } from './coach-lib.mjs';

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const PROVIDER_LOG = `${PRIVATE}/j3-provider.jsonl`;

export async function run() {
  const { check, save } = results('J3-coach-standin');
  fs.rmSync(PROVIDER_LOG, { force: true });
  const fakePort = await freePort();
  const fake = spawn(process.execPath, [`${ROOT}/qa/scripts/Q4/fakeprovider.mjs`, String(fakePort)], { env: { ...process.env, Q4_LOG: PROVIDER_LOG }, stdio: 'ignore' });
  const serverPort = await freePort();
  const proxyPort = await freePort();
  const BASE = `https://127.0.0.1:${proxyPort}`;
  fs.rmSync(`${PRIVATE}/j3-server`, { recursive: true, force: true });
  const srv = spawn(process.execPath, [`${ROOT}/qa/scripts/Q8/local-server.mjs`], {
    cwd: ROOT,
    env: { ...process.env, SMOKE_CFG: JSON.stringify({ port: serverPort, dataDir: `${PRIVATE}/j3-server`, origin: BASE, app: DIST, standin: `http://127.0.0.1:${fakePort}/v1` }) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = [];
  let ready;
  const readyP = new Promise((r) => (ready = r));
  const serverLog = [];
  let buf = '';
  srv.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('READY ')) ready(line.slice(6));
      else if (line.startsWith('CTRL ')) waiters.shift()?.(JSON.parse(line.slice(5)));
      else serverLog.push(line.slice(0, 300));
    }
  });
  srv.stderr.on('data', (d) => serverLog.push(`stderr ${String(d).trim().slice(0, 300)}`));
  const ctrl = (m) => new Promise((r) => { waiters.push(r); srv.stdin.write(`${JSON.stringify(m)}\n`); });
  await Promise.race([readyP, sleep(120000).then(() => { throw new Error(`local server did not start: ${serverLog.slice(-5).join(' / ')}`); })]);
  // self-signed https front (the page accepts only https server addresses)
  const certDir = `${PRIVATE}/relay-cert`;
  fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(`${certDir}/cert.pem`)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-subj', '/CN=127.0.0.1', '-days', '2', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const front = https.createServer({ key: fs.readFileSync(`${certDir}/key.pem`), cert: fs.readFileSync(`${certDir}/cert.pem`) }, (req, res) => {
    const up = http.request({ host: '127.0.0.1', port: serverPort, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  front.on('upgrade', (req, sock, head) => {
    const up = net.connect(serverPort, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  await new Promise((r) => front.listen(proxyPort, '127.0.0.1', r));
  log(`local server ${BASE} (stand-in on ${fakePort})`);

  const P = await openProfile('j3', { site: BASE, selfSigned: true, map: false });
  let personId = null;
  try {
    check('first run, screening and body through the intake', await seedProfile(P));
    const phrase = await setUpSync(P, BASE);
    const added = await ctrl({ op: 'addPerson', label: 'q8-j3', tz: 'Asia/Kolkata', secretHex: Buffer.from(mnemonicToEntropy(phrase, wordlist)).toString('hex') });
    personId = added.id;
    check('server person joined the browser’s sync group', /^[0-9a-f]{16}$/.test(personId ?? ''), added.error ?? '');
    const { code } = await ctrl({ op: 'code', person: personId, label: 'Q8 J3' });
    check('paired by code', await pairByCode(P, code, BASE, 'Q8 J3'));
    const put = await serverCall(P, 'PUT', '/v1/ai/keys/opencode-zen', { key: 'sk-q8-standin-key-0001' });
    check('OpenCode Zen key set on the server (204)', put.status === 204, String(put.status));
    check('Settings › Coach: OpenCode Zen (via your server) chosen, model loaded, saved', await chooseServerPreset(P, 'opencode-zen', 'q4-scripted'));
    const plan = await makePlan(P);
    check('a plan started through the Coach (goals, planner, Apply)', plan.ok, plan.detail);
    for (const r of await coachJourneys(P, { providerLog: PROVIDER_LOG })) check(r.name, r.ok, r.detail);
    const lines = fs.readFileSync(PROVIDER_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    check(`the stand-in got every Coach request from the server with the server’s key (${lines.length} requests)`, lines.length > 0 && lines.every((l) => l.authorization === 'present'));
    const usage = await serverCall(P, 'GET', '/v1/ai/usage');
    check('the server counted the requests for this person', usage.body?.today?.requests >= lines.length, JSON.stringify(usage.body));
    const day = (await read(P, 'today.get', {})).date;
    let onServer = null;
    for (let i = 0; i < 30; i++) { onServer = await ctrl({ op: 'dispatch', person: personId, command: 'log.get', input: { from: day, to: day } }); if (/dal/.test(JSON.stringify(onServer))) break; await sleep(1000); }
    check('the Coach’s meal reached the server person by sync', /dal/.test(JSON.stringify(onServer)), JSON.stringify(onServer).slice(0, 160));
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no page errors', P.errors.filter((x) => x.startsWith('pageerror')).length === 0, P.errors.join(' | ').slice(0, 300));
  await P.ctx.close();
  await ctrl({ op: 'close' }).catch(() => {});
  srv.kill(); fake.kill(); front.close();
  fs.writeFileSync(`${PRIVATE}/j3-server.log`, serverLog.join('\n'));
  return { rows: save({ how: 'local server from this branch, OpenCode Zen upstream = stand-in (no override on oci-arm)' }) };
}
if (process.argv[1]?.endsWith('j3-coach.mjs')) { const { rows } = await run(); await closeBrowser(); log(`${rows.filter((r) => r.ok).length}/${rows.length} passed`); process.exit(0); }
