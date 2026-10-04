// Q9 journey 2: replay and resend against oci-arm (person q9-a, broker login L1, after j1-live.mjs).
// 1. the same stream again → 0 new events, 0 new records;
// 2. three new messages whose PUBACKs the client drops (raw MQTT over the WebSocket, packets read and ignored), the
//    connection closed, then resent with DUP on a new connection, as Lumen's outbox does → stored once;
// 3. a message on another installation id → dead letter `wrong_installation`, acknowledged, counted;
// 4. a 300 KB message → `too_large`, acknowledged; 5. the card's "See why" shows the reasons.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ORIGIN, ROOT, checker, exportDocs, kept, lastNightStream, log, lumenClient, lumenEvent, profile, publishAll, serverCall, sleep, startPreview, waitQa } from './lib.mjs';

const c = checker();
const L1 = kept('login-L1.json');
const night = kept('night.json');
if (!L1 || !night) throw new Error('run j1-live.mjs first');
const req = createRequire(createRequire(join(ROOT, 'packages/companion/package.json')).resolve('mqtt'));
const mqttPacket = (await import(pathToFileURL(req.resolve('mqtt-packet')).href)).default;
const WebSocket = (await import(pathToFileURL(req.resolve('ws')).href)).default;
const results = { at: new Date().toISOString() };
const preview = await startPreview();
const A = await profile('a');
const page = A.page;
const total = (st) => (st?.eventsToday ?? []).reduce((a, x) => a + x.count, 0);
const status = async () => (await serverCall(page, 'GET', '/v1/mqtt/status')).json;
const settle = async (pred, ms = 20000) => {
  const end = Date.now() + ms;
  let st = await status();
  while (Date.now() < end && !pred(st)) { await sleep(1000); st = await status(); }
  return st;
};
const bioCount = async () => (await exportDocs(page)).collections.bioRecords.length;

/** Raw MQTT 3.1.1 session over wss: CONNECT, PUBLISH QoS 1; PUBACKs are counted and otherwise ignored. */
function rawSession() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(L1.address, 'mqtt');
    const parser = mqttPacket.parser({ protocolVersion: 4 });
    const pubacks = [];
    let connack = null;
    parser.on('packet', (p) => { if (p.cmd === 'connack') connack = p; if (p.cmd === 'puback') pubacks.push(p.messageId); });
    ws.on('message', (d) => parser.parse(Buffer.from(d)));
    let opened = false;
    ws.on('error', (e) => { if (!opened) reject(e); });
    ws.on('open', async () => {
      opened = true;
      ws.send(mqttPacket.generate({ cmd: 'connect', protocolId: 'MQTT', protocolVersion: 4, clean: true, clientId: 'q9-phone-1', keepalive: 60, username: L1.username, password: Buffer.from(L1.password) }));
      for (let i = 0; i < 50 && !connack; i++) await sleep(100);
      if (connack?.returnCode !== 0) return reject(new Error(`connack ${connack?.returnCode}`));
      resolve({
        pubacks,
        publish: (m, id, dup = false) => ws.send(mqttPacket.generate({ cmd: 'publish', qos: 1, dup, retain: false, messageId: id, topic: m.topic, payload: Buffer.from(m.payload) })),
        close: () => ws.terminate(),
      });
    });
  });
}

try {
  c.journey('J2 replay and resend');
  await page.goto(`${ORIGIN}/settings?section=devices&qa=1`, { waitUntil: 'load' });
  await waitQa(page);
  const st0 = await status();
  const bio0 = await bioCount();
  const dead0 = st0.deadLetters;
  results.before = { events: total(st0), bioDocs: bio0, dead: dead0 };

  // 1. the same stream again
  const synthetic = (await import('node:fs')).readFileSync(join(ROOT, 'qa/fixtures/lumen/mqtt-stream.synthetic.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const again = [...synthetic, ...lastNightStream('install123', night.today).messages];
  const cl = await lumenClient(L1.address, L1.username, L1.password, 'q9-phone-1');
  await publishAll(cl, again);
  await cl.endAsync(true); // at most 2 connections per login: the raw sessions below need the room
  await sleep(6000);
  const st1 = await status();
  const bio1 = await bioCount();
  c.check(`replaying ${again.length} messages adds 0 events on the server`, total(st1) === total(st0), `${total(st0)} → ${total(st1)}`);
  c.check('replaying adds 0 records (bioRecords documents in the paired browser)', bio1 === bio0, `${bio0} → ${bio1}`);

  // 2. drop three PUBACKs, close, resend with DUP on a new connection
  const t = Date.parse(night.wake) + 6 * 3600000 + (Date.now() % 600) * 60000; // new instants on every run
  const three = [0, 1, 2].map((i) => lumenEvent('install123', 'health.metric.observed', 'hr', 'metrics/hr', new Date(t + i * 60000).toISOString().replace('.000Z', 'Z'), { metric: 'hr', value: 70 + i, unit: 'bpm', provenance: 'device_history', quality: 'unverified' }, new Date(t + 5 * 60000).toISOString().replace('.000Z', 'Z')));
  const s1 = await rawSession();
  three.forEach((m, i) => s1.publish(m, 101 + i));
  await sleep(3000);
  const ackedFirst = s1.pubacks.length;
  s1.close(); // the client never processed those PUBACKs
  await sleep(1000);
  const s2 = await rawSession();
  three.forEach((m, i) => s2.publish(m, 201 + i, true));
  for (let i = 0; i < 50 && s2.pubacks.length < 3; i++) await sleep(100);
  s2.close();
  const st2 = await settle((s) => total(s) >= total(st1) + 3);
  await sleep(3000);
  const st2b = await status();
  results.resend = { pubacksDroppedFirst: ackedFirst, pubacksSecond: s2.pubacks.length, events: `${total(st1)} → ${total(st2b)}` };
  c.check('three messages with dropped PUBACKs, resent with DUP: all acknowledged the second time', s2.pubacks.length === 3, `first session got ${ackedFirst} PUBACKs (ignored), second ${s2.pubacks.length}`);
  c.check('…and stored once (+3 heart-rate events, not +6)', total(st2b) === total(st1) + 3, `${total(st1)} → ${total(st2)} → ${total(st2b)}`);

  // 3. wrong installation id; 4. 300 KB
  const cl3 = await lumenClient(L1.address, L1.username, L1.password, 'q9-phone-1');
  const wrong = lumenEvent('another-phone-77', 'health.metric.observed', 'hr', 'metrics/hr', new Date(t + 10 * 60000).toISOString(), { metric: 'hr', value: 66, unit: 'bpm', provenance: 'device_history' }, new Date(t + 11 * 60000).toISOString());
  await cl3.publishAsync(wrong.topic, wrong.payload, { qos: 1 });
  c.check('wrong installation id: PUBLISH acknowledged', true);
  const st3 = await settle((s) => s.deadLetters.last7d > dead0.last7d);
  c.check('dead letter `wrong_installation` counted', st3.deadLetters.last7d === dead0.last7d + 1 && st3.deadLetters.lastReason === 'wrong_installation', JSON.stringify(st3.deadLetters));
  const big = { topic: 'lumen-health/v1/install123/metrics/hr', payload: JSON.stringify({ specversion: '1.0', id: 'pl-q9-big', type: 'health.metric.observed', source: 'urn:pulseloop:installation:install123', data: { pad: 'x'.repeat(300 * 1024) } }) };
  await cl3.publishAsync(big.topic, big.payload, { qos: 1 });
  c.check('300 KB message: PUBLISH acknowledged', true);
  const st4 = await settle((s) => s.deadLetters.last7d > st3.deadLetters.last7d);
  c.check('dead letter `too_large` counted', st4.deadLetters.last7d === dead0.last7d + 2 && st4.deadLetters.lastReason === 'too_large', JSON.stringify(st4.deadLetters));
  const st4b = await status();
  c.check('dead letters never reach the store (event count unchanged)', total(st4b) === total(st2b), `${total(st2b)} → ${total(st4b)}`);
  await cl3.endAsync(true);

  // 5. the card and "See why"
  await page.reload({ waitUntil: 'load' });
  const card = page.locator('section[aria-label="Lumen Health over MQTT"]');
  await card.getByRole('button', { name: 'See why' }).waitFor({ timeout: 20000 });
  const cardText = (await card.innerText()).replace(/\s*\n\s*/g, ' | ');
  c.check('card counts the set-aside events', new RegExp(`set aside \\| ${st4.deadLetters.today} today · ${st4.deadLetters.last7d} in the last 7 days`).test(cardText), /set aside[^]*?days/.exec(cardText)?.[0]);
  await card.getByRole('button', { name: 'See why' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  const why = (await dlg.innerText()).replace(/\s*\n\s*/g, ' | ');
  results.seeWhy = why;
  c.check('"See why" names the most recent reason in plain words (too large)', /Most recent reason: \| ?The event was far bigger than any real one/.test(why) || /Most recent reason:\s*The event was far bigger/.test(why), why.slice(0, 300));
  const perReason = /In the last 7 days/.test(why);
  c.check('"See why" lists each reason with its count (needs server ≥ the Q9 fix; oci-arm runs 0.4.0)', perReason && /1 · The event came from a different phone/.test(why) && /1 · The event was far bigger/.test(why), perReason ? why.slice(0, 300) : 'only the most recent reason and the generic list (server 0.4.0 sends no per-reason counts)');
  await dlg.screenshot({ path: join(ROOT, 'qa/screenshots/Q9-see-why-1440.png') }).catch(() => undefined);
  results.after = { events: total(st4b), dead: st4b.deadLetters };
} catch (e) {
  c.check('no exception', false, e.stack?.split('\n').slice(0, 3).join(' / '));
} finally {
  results.checks = c.checks;
  writeFileSync(join(ROOT, 'qa/results/Q9-j2-replay.json'), JSON.stringify(results, null, 2));
  log(`browser errors: ${A.errors.slice(0, 5).join(' || ')}`);
  await A.ctx.close();
  preview?.kill();
  log(JSON.stringify(c.summary()));
}
